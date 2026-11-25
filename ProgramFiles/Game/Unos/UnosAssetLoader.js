// ProgramFiles/Game/Unos/UnosAssetLoader.js
// 우노스(UNOS) 전용 텍스처 매니페스트 생성 · 우선순위 프리로딩(decode) · 메모리 캐시 유지 모듈

import { ErrorTracker } from '../../System/ErrorTracker.js';
import { getAllUnosTexturePaths } from '../../System/Index/Unos/UnosCardIndex.js';

const ASSET_TIMEOUT_MS = 20000;

const _imageCache = new Map();
const _statusCache = new Map();
const _inFlightImages = new Map();
const _progressSubscribers = new Set();

let _preloadPromise = null;
let _preloadDone = false;
let _lastProgress = {
    gameId: 'unos',
    loaded: 0,
    total: 0,
    percent: 0,
    failedCount: 0,
    currentAsset: '',
    phase: 'core'
};

/**
 * 우노스 인게임에서 사용하는 확정 텍스처 목록(25종 .webp)을 인덱스 기반으로 동적 수집한다.
 */
export function getUnosPreloadManifest() {
    const core = getAllUnosTexturePaths();
    return {
        core,
        all: [...core]
    };
}

/**
 * 디코딩 완료된 우노스 텍스처(HTMLImageElement)를 반환한다.
 */
export function getCachedUnosImage(src) {
    if (!src) return null;
    const img = _imageCache.get(src);
    if (img && img.complete && img.naturalWidth > 0) {
        return img;
    }
    return null;
}

export function isUnosImageOk(src) {
    return _statusCache.get(src) === 'ok' || Boolean(getCachedUnosImage(src));
}

export function isUnosImageError(src) {
    return _statusCache.get(src) === 'error';
}

export function isUnosPreloaded() {
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
    if (getCachedUnosImage(src)) {
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
            label: 'UnosPreload',
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
 * 우노스 전체 텍스처(25종)를 프리로딩 및 디코딩한다.
 * 동일 세션 내 중복 호출 시 진행 중인 단일 Promise를 공유한다.
 */
export function preloadUnosAssets({ onProgress = null, concurrency = 4 } = {}) {
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
            gameId: 'unos',
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

    const manifest = getUnosPreloadManifest();
    const total = manifest.all.length;
    let settledCount = 0;
    let failedCount = 0;

    notifySubscribers({
        gameId: 'unos',
        loaded: 0,
        total,
        percent: total === 0 ? 100 : 0,
        failedCount: 0,
        currentAsset: '',
        phase: 'core'
    });

    _preloadPromise = (async () => {
        await runPool(manifest.core, concurrency, async (src) => {
            const ok = await loadAndDecodeImage(src);
            settledCount += 1;
            if (!ok) failedCount += 1;
            const percent = total === 0 ? 100 : Math.min(100, Math.round((settledCount / total) * 100));
            notifySubscribers({
                gameId: 'unos',
                loaded: settledCount,
                total,
                percent,
                failedCount,
                currentAsset: src,
                phase: 'core'
            });
        });
        _preloadDone = true;
        return {
            gameId: 'unos',
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

export function ensureUnosAssetLoaded(src) {
    return loadAndDecodeImage(src);
}
