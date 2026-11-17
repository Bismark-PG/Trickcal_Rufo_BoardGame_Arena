// ProgramFiles/System/AssetPreloader.js
// 아레나 최초 접속 시 공용 및 부팅 대상 멀티플레이 게임 리소스를 단계별로 프리로딩하는 허브

import { getBootPreloadGames } from './GameRegistry.js';
import { getMarblePreloadManifest, preloadMarbleAssets } from '../Marble/MarbleAssetLoader.js';
import { ErrorTracker } from './ErrorTracker.js';

const ARENA_COMMON_ASSETS = [
    './Resource/Texture/Main_Chara.png'
];

const _commonImageCache = new Map();
const _gamePreloaders = new Map();

let _arenaPreloadCompleted = false;
let _arenaPreloadPromise = null;
let _lastProgress = null;
const _subscribers = new Set();

/**
 * 게임별 리소스 프리로더를 등록한다. (향후 UNOS·신규 게임 확장 표준 진입점)
 * @param {string} gameId
 * @param {{ getAssetCount: () => number, preload: (opts: { onProgress?: Function }) => Promise<any> }} spec
 */
export function registerGameAssetLoader(gameId, spec) {
    if (!gameId || !spec || typeof spec.preload !== 'function') return;
    _gamePreloaders.set(gameId, spec);
}

registerGameAssetLoader('marble', {
    getAssetCount: () => getMarblePreloadManifest().all.length,
    preload: preloadMarbleAssets
});

export function getCachedCommonImage(src) {
    if (!src) return null;
    const img = _commonImageCache.get(src);
    if (img && img.complete && img.naturalWidth > 0) {
        return img;
    }
    return null;
}

export function hasCompletedArenaPreload() {
    return _arenaPreloadCompleted;
}

export function getArenaBootPreloadPlan() {
    const steps = [
        {
            stepId: 'arena',
            gameId: 'arena',
            nameKey: null,
            total: ARENA_COMMON_ASSETS.length
        }
    ];

    getBootPreloadGames().forEach((game) => {
        const spec = _gamePreloaders.get(game.id);
        if (!spec) return;
        const count = typeof spec.getAssetCount === 'function' ? Number(spec.getAssetCount()) || 0 : 0;
        if (count <= 0) return;
        steps.push({
            stepId: game.id,
            gameId: game.id,
            nameKey: game.nameKey,
            total: count
        });
    });

    const overallTotal = steps.reduce((acc, s) => acc + s.total, 0);
    return { steps, overallTotal };
}

/**
 * 부팅 제외 대상(preloadOnBoot: false 등) 또는 개별 게임 진입 시 온디맨드 프리로딩을 실행한다.
 */
export async function preloadGameAssets(gameId, { onProgress = null } = {}) {
    const spec = _gamePreloaders.get(gameId);
    if (!spec || typeof spec.preload !== 'function') {
        return { gameId, total: 0, loaded: 0, failedCount: 0, skipped: true };
    }
    try {
        return await spec.preload({ onProgress });
    } catch (err) {
        ErrorTracker.addBreadcrumb('WARN', `On-demand preload failed (${gameId}): ${err?.message || err}`);
        return { gameId, total: 0, loaded: 0, failedCount: 0, error: true };
    }
}

function loadCommonAsset(src) {
    if (!src) return Promise.resolve(false);
    if (getCachedCommonImage(src)) return Promise.resolve(true);
    if (typeof Image !== 'function') return Promise.resolve(false);

    return new Promise((resolve) => {
        const img = new Image();
        let settled = false;
        let timeoutId = null;
        const finish = (ok) => {
            if (settled) return;
            settled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (ok && img.naturalWidth > 0) {
                _commonImageCache.set(src, img);
                resolve(true);
            } else {
                resolve(false);
            }
        };

        ErrorTracker.trackImage(img, {
            critical: false,
            label: 'ArenaCommonPreload',
            onFallback: () => finish(false)
        });

        img.onload = async () => {
            if (typeof img.decode === 'function') {
                try {
                    await img.decode();
                } catch {
                    // ignore decode hint error
                }
            }
            finish(img.naturalWidth > 0);
        };
        timeoutId = setTimeout(() => finish(false), 12000);
        img.src = src;
    });
}

function emitProgress(payload) {
    _lastProgress = payload;
    _subscribers.forEach((cb) => {
        try {
            cb(payload);
        } catch {
            // ignore UI listener errors
        }
    });
}

/**
 * 아레나 부팅 공용/게임별 리소스를 순차 실행하고 전체 진행률을 보고한다.
 * overallTimeoutMs가 지정되면 제한 시간 초과 시에도 거부하지 않고 메뉴 진입 폴백을 반환한다(백그라운드 캐싱 지속).
 */
export function runArenaPreload({ onProgress = null, overallTimeoutMs = 0 } = {}) {
    if (typeof onProgress === 'function') {
        _subscribers.add(onProgress);
        if (_lastProgress && !_arenaPreloadCompleted) {
            try {
                onProgress(_lastProgress);
            } catch {
                // ignore
            }
        }
    }

    if (_arenaPreloadCompleted) {
        const plan = getArenaBootPreloadPlan();
        emitProgress({
            stepId: 'done',
            gameId: 'arena',
            nameKey: null,
            stageLoaded: 0,
            stageTotal: 0,
            overallLoaded: plan.overallTotal,
            overallTotal: plan.overallTotal,
            percent: 100,
            currentAsset: '',
            done: true
        });
        if (typeof onProgress === 'function') _subscribers.delete(onProgress);
        return Promise.resolve({ overallTotal: plan.overallTotal, failedCount: 0, done: true, timedOut: false });
    }

    if (!_arenaPreloadPromise) {
        _arenaPreloadPromise = (async () => {
            const plan = getArenaBootPreloadPlan();
            const overallTotal = Math.max(1, plan.overallTotal);
            let baseOffset = 0;
            let totalFailed = 0;

            for (const step of plan.steps) {
                emitProgress({
                    stepId: step.stepId,
                    gameId: step.gameId,
                    nameKey: step.nameKey,
                    stageLoaded: 0,
                    stageTotal: step.total,
                    overallLoaded: baseOffset,
                    overallTotal,
                    percent: Math.min(100, Math.round((baseOffset / overallTotal) * 100)),
                    currentAsset: '',
                    done: false
                });

                try {
                    if (step.stepId === 'arena') {
                        let stageLoaded = 0;
                        for (const src of ARENA_COMMON_ASSETS) {
                            const ok = await loadCommonAsset(src);
                            if (!ok) totalFailed += 1;
                            stageLoaded += 1;
                            const overallLoaded = baseOffset + stageLoaded;
                            emitProgress({
                                stepId: step.stepId,
                                gameId: step.gameId,
                                nameKey: null,
                                stageLoaded,
                                stageTotal: step.total,
                                overallLoaded,
                                overallTotal,
                                percent: Math.min(100, Math.round((overallLoaded / overallTotal) * 100)),
                                currentAsset: src,
                                done: false
                            });
                        }
                    } else {
                        const spec = _gamePreloaders.get(step.gameId);
                        if (spec && typeof spec.preload === 'function') {
                            const res = await spec.preload({
                                onProgress: (p) => {
                                    const stageLoaded = Math.min(step.total, Number(p?.loaded) || 0);
                                    const overallLoaded = Math.min(overallTotal, baseOffset + stageLoaded);
                                    emitProgress({
                                        stepId: step.stepId,
                                        gameId: step.gameId,
                                        nameKey: step.nameKey,
                                        stageLoaded,
                                        stageTotal: step.total,
                                        overallLoaded,
                                        overallTotal,
                                        percent: Math.min(100, Math.round((overallLoaded / overallTotal) * 100)),
                                        currentAsset: p?.currentAsset || '',
                                        done: false
                                    });
                                }
                            });
                            totalFailed += Number(res?.failedCount) || 0;
                        }
                    }
                } catch (err) {
                    totalFailed += step.total;
                    ErrorTracker.addBreadcrumb('WARN', `Preload step failed (${step.stepId}): ${err?.message || err}`);
                }

                baseOffset += step.total;
            }

            _arenaPreloadCompleted = true;
            ErrorTracker.addBreadcrumb('RESOURCE', `Arena preload done: ${overallTotal - totalFailed}/${overallTotal} ok`);
            emitProgress({
                stepId: 'done',
                gameId: 'arena',
                nameKey: null,
                stageLoaded: 0,
                stageTotal: 0,
                overallLoaded: overallTotal,
                overallTotal,
                percent: 100,
                currentAsset: '',
                done: true
            });
            return { overallTotal, failedCount: totalFailed, done: true, timedOut: false };
        })().finally(() => {
            if (typeof onProgress === 'function') _subscribers.delete(onProgress);
        });
    }

    const basePromise = _arenaPreloadPromise.finally(() => {
        if (typeof onProgress === 'function') _subscribers.delete(onProgress);
    });

    if (Number(overallTimeoutMs) > 0) {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                if (typeof onProgress === 'function') _subscribers.delete(onProgress);
                ErrorTracker.addBreadcrumb('WARN', `Arena preload soft timeout (${overallTimeoutMs}ms) -> entering menu`);
                resolve({
                    overallTotal: _lastProgress?.overallTotal || 0,
                    failedCount: 0,
                    done: false,
                    timedOut: true
                });
            }, Number(overallTimeoutMs));

            basePromise.then((res) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(res);
            }).catch(() => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ overallTotal: 0, failedCount: 0, done: false, timedOut: false, error: true });
            });
        });
    }

    return basePromise;
}
