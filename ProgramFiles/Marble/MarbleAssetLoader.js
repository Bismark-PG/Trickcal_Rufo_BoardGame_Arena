// ProgramFiles/Marble/MarbleAssetLoader.js
// 엘리아스 마블 전용 텍스처 매니페스트 생성 · 우선순위 프리로딩(decode) · 메모리 캐시 유지 모듈

import { ErrorTracker } from '../System/ErrorTracker.js';
import { MARBLE_MODES } from '../System/Index/Marble/MarblePriceIndex.js';
import { TILE_BG_VARIANTS, formatTileBgPath } from '../System/Index/Marble/MarbleBoardIndex.js';

const DICE_NORMAL_PREFIX = './Resource/Texture/Marble/Dice/Dice_N_';
const DICE_ERPIN_PREFIX = './Resource/Texture/Marble/Dice/Dice_E_';
const ASSET_TIMEOUT_MS = 20000;

const _imageCache = new Map();
const _statusCache = new Map();
const _inFlightImages = new Map();
const _progressSubscribers = new Set();

let _preloadPromise = null;
let _preloadDone = false;
let _lastProgress = {
    gameId: 'marble',
    loaded: 0,
    total: 0,
    percent: 0,
    failedCount: 0,
    currentAsset: '',
    phase: 'core'
};

/**
 * 마블 인게임에서 사용하는 핵심(보드 3종·주사위 12종) 및 확정 BG 텍스처 목록을 인덱스 기반으로 동적 수집한다.
 */
export function getMarblePreloadManifest() {
    const core = [];
    const backgrounds = [];
    const seen = new Set();

    const pushUnique = (target, path) => {
        if (!path || seen.has(path)) return;
        seen.add(path);
        target.push(path);
    };

    Object.values(MARBLE_MODES).forEach((cfg) => {
        if (cfg?.boardTexture) {
            pushUnique(core, cfg.boardTexture);
        }
    });

    for (let pip = 1; pip <= 6; pip++) {
        pushUnique(core, `${DICE_NORMAL_PREFIX}${pip}.png`);
    }
    for (let pip = 1; pip <= 6; pip++) {
        pushUnique(core, `${DICE_ERPIN_PREFIX}${pip}.png`);
    }

    Object.entries(TILE_BG_VARIANTS).forEach(([rawId, variants]) => {
        const tileId = Number(rawId);
        if (!Number.isInteger(tileId) || !Array.isArray(variants)) return;
        variants.forEach((tag) => {
            if (tag === undefined || tag === null) return;
            pushUnique(backgrounds, formatTileBgPath(tileId, tag));
        });
    });

    return {
        core,
        backgrounds,
        all: [...core, ...backgrounds]
    };
}

/**
 * 디코딩 완료된 마블 텍스처(HTMLImageElement)를 반환한다.
 */
export function getCachedMarbleImage(src) {
    if (!src) return null;
    const img = _imageCache.get(src);
    if (img && img.complete && img.naturalWidth > 0) {
        return img;
    }
    return null;
}

export function isMarbleImageOk(src) {
    return _statusCache.get(src) === 'ok' || Boolean(getCachedMarbleImage(src));
}

export function isMarbleImageError(src) {
    return _statusCache.get(src) === 'error';
}

export function isMarblePreloaded() {
    return _preloadDone;
}

function notifySubscribers(progress) {
    _lastProgress = progress;
    _progressSubscribers.forEach((cb) => {
        try {
            cb(progress);
        } catch {
            // ignore progress listener errors
        }
    });
}

function loadAndDecodeImage(src) {
    if (!src) return Promise.resolve(false);
    if (getCachedMarbleImage(src)) {
        _statusCache.set(src, 'ok');
        return Promise.resolve(true);
    }
    if (_statusCache.get(src) === 'error') {
        return Promise.resolve(false);
    }
    if (_inFlightImages.has(src)) {
        return _inFlightImages.get(src);
    }
    if (typeof Image !== 'function') {
        return Promise.resolve(false);
    }

    const promise = new Promise((resolve) => {
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
            _inFlightImages.delete(src);
            if (ok && img.naturalWidth > 0) {
                _imageCache.set(src, img);
                _statusCache.set(src, 'ok');
                resolve(true);
            } else {
                _statusCache.set(src, 'error');
                resolve(false);
            }
        };

        ErrorTracker.trackImage(img, {
            critical: false,
            label: 'MarblePreload',
            onFallback: () => finish(false)
        });

        img.onload = async () => {
            if (typeof img.decode === 'function') {
                try {
                    await img.decode();
                } catch {
                    // 디코딩 힌트 실패 시에도 naturalWidth > 0이면 렌더에 사용 가능
                }
            }
            finish(img.naturalWidth > 0);
        };

        timeoutId = setTimeout(() => finish(false), ASSET_TIMEOUT_MS);
        img.src = src;
    });

    _inFlightImages.set(src, promise);
    return promise;
}

async function runPool(items, concurrency, workerFn) {
    const queue = [...items];
    const limit = Math.max(1, Math.min(concurrency, queue.length || 1));
    const workers = Array.from({ length: limit }, async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            await workerFn(item);
        }
    });
    await Promise.all(workers);
}

/**
 * 엘리아스 마블 전체 텍스처를 1단계(보드+주사위) -> 2단계(BG) 순으로 프리로딩 및 디코딩한다.
 * 동일 세션 내 중복 호출 시 진행 중인 단일 Promise를 공유한다.
 */
export function preloadMarbleAssets({ onProgress = null, concurrency = 4 } = {}) {
    if (typeof onProgress === 'function') {
        _progressSubscribers.add(onProgress);
        if (_lastProgress.total > 0) {
            try {
                onProgress(_lastProgress);
            } catch {
                // ignore
            }
        }
    }

    if (_preloadDone) {
        const result = {
            gameId: 'marble',
            total: _lastProgress.total,
            loaded: _lastProgress.loaded - _lastProgress.failedCount,
            failedCount: _lastProgress.failedCount
        };
        if (typeof onProgress === 'function') {
            _progressSubscribers.delete(onProgress);
        }
        return Promise.resolve(result);
    }

    if (_preloadPromise) {
        return _preloadPromise.finally(() => {
            if (typeof onProgress === 'function') {
                _progressSubscribers.delete(onProgress);
            }
        });
    }

    const manifest = getMarblePreloadManifest();
    const total = manifest.all.length;
    let settledCount = 0;
    let failedCount = 0;

    notifySubscribers({
        gameId: 'marble',
        loaded: 0,
        total,
        percent: total === 0 ? 100 : 0,
        failedCount: 0,
        currentAsset: '',
        phase: 'core'
    });

    const loadPhase = async (list, phaseName) => {
        await runPool(list, concurrency, async (src) => {
            const ok = await loadAndDecodeImage(src);
            settledCount += 1;
            if (!ok) failedCount += 1;
            const percent = total === 0 ? 100 : Math.min(100, Math.round((settledCount / total) * 100));
            notifySubscribers({
                gameId: 'marble',
                loaded: settledCount,
                total,
                percent,
                failedCount,
                currentAsset: src,
                phase: phaseName
            });
        });
    };

    _preloadPromise = (async () => {
        await loadPhase(manifest.core, 'core');
        await loadPhase(manifest.backgrounds, 'backgrounds');
        _preloadDone = true;
        return {
            gameId: 'marble',
            total,
            loaded: settledCount - failedCount,
            failedCount
        };
    })().finally(() => {
        if (typeof onProgress === 'function') {
            _progressSubscribers.delete(onProgress);
        }
    });

    return _preloadPromise;
}

/**
 * 이미 프리로드된 이미지를 기반으로 단일 보드/BG 텍스처를 필요 시 즉시 캐시에 추가 로드한다.
 */
export function ensureMarbleAssetLoaded(src) {
    return loadAndDecodeImage(src);
}
