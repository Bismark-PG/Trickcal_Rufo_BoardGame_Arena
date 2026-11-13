// ProgramFiles/System/Log/SystemLogManager.js
// 전 게임 통합 시스템 로그 총괄 매니저
// - 게임별 로그 어댑터(MarbleLogAdapter 등)를 등록해 사이클 단위 로그 및 100사이클 통계를 관리
// - Node.js 환경에서는 Resource/Log 폴더에 직접 기록하고, 브라우저 환경에서는 HTTP API(/api/logs/record)
//   또는 localStorage 폴백을 사용하여 브라우저 ESM 모듈 안전성을 보장한다.

import { MarbleLogAdapter, MarbleLog10Adapter } from '../../Marble/MarbleLogManager.js';

const STORAGE_PREFIX = 'rufo_system_logs_v1_';

function isNodeRuntime() {
    return typeof process !== 'undefined' && Boolean(process.versions && process.versions.node);
}

class SystemLogManagerImpl {
    constructor() {
        this.adapters = new Map();
        this.storageOptions = {
            logDir: null,
            disableDiskWrite: false
        };
        this._writeLocks = new Map();
        this.registerGameLogger('marble', MarbleLogAdapter);
        this.registerGameLogger('marble_10', MarbleLog10Adapter);
    }

    _withWriteLock(lockKey, task) {
        const key = String(lockKey || 'default');
        const prev = this._writeLocks.get(key) || Promise.resolve();
        const next = prev.then(() => task(), () => task());
        const tail = next.finally(() => {
            if (this._writeLocks.get(key) === tail) {
                this._writeLocks.delete(key);
            }
        });
        this._writeLocks.set(key, tail);
        return next;
    }

    /**
     * 추후 신규 보드게임(우노스 등) 추가 시 게임 ID와 어댑터를 등록해 확장한다.
     */
    registerGameLogger(gameId, adapter) {
        if (!gameId || !adapter) return;
        this.adapters.set(String(gameId), adapter);
    }

    getLogger(gameId) {
        return this.adapters.get(String(gameId)) || null;
    }

    setStorageOptions(options = {}) {
        if (options.logDir !== undefined) {
            this.storageOptions.logDir = options.logDir || null;
        }
        if (options.disableDiskWrite !== undefined) {
            this.storageOptions.disableDiskWrite = Boolean(options.disableDiskWrite);
        }
    }

    async _resolveNodeLogDir(overrideLogDir = null) {
        const pathMod = await import('node:path');
        const urlMod = await import('node:url');
        const configured = overrideLogDir || this.storageOptions.logDir;
        if (configured) {
            return pathMod.resolve(configured);
        }
        const selfDir = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
        const projectRoot = pathMod.resolve(selfDir, '..', '..', '..');
        return pathMod.join(projectRoot, 'Resource', 'Log');
    }

    _pushBoundedCycle(existingCycles, normalizedCycle, maxCycles = 100, adapter = null, policy = 'fifo') {
        const list = Array.isArray(existingCycles) ? [...existingCycles] : [];
        if (normalizedCycle) list.push(normalizedCycle);
        if (list.length <= maxCycles) return list;

        if ((policy === 'density_preserve' || policy === 'quantile_preserve') && typeof adapter?.compactCycles === 'function') {
            return adapter.compactCycles(list, maxCycles);
        }

        while (list.length > maxCycles) {
            list.shift();
        }
        return list;
    }

    /**
     * 경기 종료 결과를 지정된 게임 로거를 통해 최근 100사이클 로그로 기록한다.
     */
    async recordGameResult(gameId, rawMatchData, options = {}) {
        const adapter = this.getLogger(gameId);
        if (!adapter) {
            return { ok: false, error: `UNKNOWN_GAME_LOGGER:${gameId}` };
        }

        const cycle = typeof adapter.normalizeMatchData === 'function'
            ? adapter.normalizeMatchData(rawMatchData)
            : rawMatchData;
        if (!cycle) {
            return { ok: false, error: 'INVALID_MATCH_LOG_DATA' };
        }

        const maxCycles = Math.max(1, Number(adapter.maxCycles) || 100);
        const policy = options.retentionPolicy || 'fifo';

        if (isNodeRuntime()) {
            if (this.storageOptions.disableDiskWrite && !options.logDir) {
                return { ok: true, skippedDiskWrite: true, cycleCount: 0 };
            }
            return await this._recordInNode(adapter, [cycle], maxCycles, {
                overrideLogDir: options.logDir || null,
                retentionPolicy: policy,
                replaceExisting: Boolean(options.replaceExisting),
                meta: options.meta || null
            });
        }

        return await this._recordInBrowser(String(gameId), adapter, cycle, maxCycles);
    }

    /**
     * 다수 시뮬레이션(예: 250판 배치 실행) 결과를 한 번에 압축·기록한다.
     */
    async recordBatchGameResults(gameId, rawMatchList, options = {}) {
        const adapter = this.getLogger(gameId);
        if (!adapter) {
            return { ok: false, error: `UNKNOWN_GAME_LOGGER:${gameId}` };
        }
        const normalized = (Array.isArray(rawMatchList) ? rawMatchList : [])
            .map(raw => (typeof adapter.normalizeMatchData === 'function' ? adapter.normalizeMatchData(raw) : raw))
            .filter(Boolean);
        const maxCycles = Math.max(1, Number(adapter.maxCycles) || 100);
        const policy = options.retentionPolicy || 'density_preserve';
        const meta = options.meta || (
            typeof adapter.computePopulationSummary === 'function'
                ? { populationSummary: adapter.computePopulationSummary(normalized, policy, maxCycles) }
                : null
        );

        if (isNodeRuntime()) {
            if (this.storageOptions.disableDiskWrite && !options.logDir) {
                return { ok: true, skippedDiskWrite: true, cycleCount: 0 };
            }
            return await this._recordInNode(adapter, normalized, maxCycles, {
                overrideLogDir: options.logDir || null,
                retentionPolicy: policy,
                replaceExisting: options.replaceExisting !== undefined ? Boolean(options.replaceExisting) : true,
                meta
            });
        }

        return { ok: false, error: 'NODE_ONLY' };
    }

    async _recordInNode(adapter, incomingCycles, maxCycles, {
        overrideLogDir = null,
        retentionPolicy = 'fifo',
        replaceExisting = false,
        meta = null
    } = {}) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const logDir = await this._resolveNodeLogDir(overrideLogDir);
        return this._withWriteLock(logDir, async () => {
            await fs.mkdir(logDir, { recursive: true });

            const rawFilePath = path.join(logDir, adapter.fileNames.RAW_DATA);
            const detailFilePath = path.join(logDir, adapter.fileNames.CYCLE_DETAIL);
            const avgFilePath = path.join(logDir, adapter.fileNames.AVERAGE_100);

            let existingCycles = [];
            let existingMeta = null;
            if (!replaceExisting) {
                try {
                    const rawStr = await fs.readFile(rawFilePath, 'utf8');
                    const parsed = JSON.parse(rawStr);
                    if (Array.isArray(parsed?.cycles)) existingCycles = parsed.cycles;
                    if (parsed?.meta) existingMeta = parsed.meta;
                } catch {
                    existingCycles = [];
                }
            }

            let updatedCycles = existingCycles;
            for (const item of incomingCycles) {
                updatedCycles = this._pushBoundedCycle(updatedCycles, item, maxCycles, adapter, retentionPolicy);
            }

            const finalMeta = meta !== null ? meta : existingMeta;
            const detailText = adapter.renderCycleDetailText(updatedCycles);
            const avgText = adapter.renderAverageSummaryText(updatedCycles, finalMeta);
            const rawPayload = JSON.stringify({
                gameId: adapter.gameId,
                maxCycles,
                retentionPolicy,
                updatedAt: new Date().toISOString(),
                cycleCount: updatedCycles.length,
                ...(finalMeta ? { meta: finalMeta } : {}),
                cycles: updatedCycles
            }, null, 2);

            await Promise.all([
                fs.writeFile(rawFilePath, rawPayload, 'utf8'),
                fs.writeFile(detailFilePath, detailText, 'utf8'),
                fs.writeFile(avgFilePath, avgText, 'utf8')
            ]);

            return {
                ok: true,
                mode: 'node',
                logDir,
                retentionPolicy,
                cycleCount: updatedCycles.length,
                meta: finalMeta,
                files: {
                    raw: rawFilePath,
                    detail: detailFilePath,
                    average: avgFilePath
                }
            };
        });
    }

    async _recordInBrowser(gameId, adapter, cycle, maxCycles) {
        const isHttpOrigin = typeof window !== 'undefined' &&
            window.location &&
            (window.location.protocol === 'http:' || window.location.protocol === 'https:');

        if (isHttpOrigin && typeof fetch === 'function') {
            try {
                const res = await fetch('/api/logs/record', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gameId, matchData: cycle })
                });
                if (res.ok) {
                    const data = await res.json();
                    return { ok: true, mode: 'http', ...data };
                }
            } catch {
                // 서버 연결 불가 시 localStorage 폴백으로 계속 진행
            }
        }

        if (typeof localStorage !== 'undefined') {
            try {
                const storageKey = `${STORAGE_PREFIX}${gameId}`;
                const existingRaw = localStorage.getItem(storageKey);
                const parsed = existingRaw ? JSON.parse(existingRaw) : { cycles: [] };
                const updatedCycles = this._pushBoundedCycle(parsed.cycles, cycle, maxCycles);
                localStorage.setItem(storageKey, JSON.stringify({
                    gameId,
                    maxCycles,
                    updatedAt: new Date().toISOString(),
                    cycleCount: updatedCycles.length,
                    cycles: updatedCycles
                }));
                return { ok: true, mode: 'localStorage', cycleCount: updatedCycles.length };
            } catch {
                return { ok: false, error: 'BROWSER_STORAGE_FAILED' };
            }
        }

        return { ok: false, error: 'NO_STORAGE_AVAILABLE' };
    }

    /**
     * 초기 빈 로그 파일 구조(또는 현재 저장된 사이클 재렌더링)를 Node 디스크에 생성한다.
     */
    async initializeGameLogs(gameId, options = {}) {
        if (!isNodeRuntime()) return { ok: false, error: 'NODE_ONLY' };
        const adapter = this.getLogger(gameId);
        if (!adapter) return { ok: false, error: `UNKNOWN_GAME_LOGGER:${gameId}` };

        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const logDir = await this._resolveNodeLogDir(options.logDir || null);
        await fs.mkdir(logDir, { recursive: true });

        const rawFilePath = path.join(logDir, adapter.fileNames.RAW_DATA);
        const detailFilePath = path.join(logDir, adapter.fileNames.CYCLE_DETAIL);
        const avgFilePath = path.join(logDir, adapter.fileNames.AVERAGE_100);

        let existingCycles = [];
        let existingMeta = null;
        try {
            const rawStr = await fs.readFile(rawFilePath, 'utf8');
            const parsed = JSON.parse(rawStr);
            if (Array.isArray(parsed?.cycles)) existingCycles = parsed.cycles;
            if (parsed?.meta) existingMeta = parsed.meta;
        } catch {
            existingCycles = [];
        }

        const detailText = adapter.renderCycleDetailText(existingCycles);
        const avgText = adapter.renderAverageSummaryText(existingCycles, existingMeta);
        const rawPayload = JSON.stringify({
            gameId: adapter.gameId,
            maxCycles: adapter.maxCycles || 100,
            updatedAt: new Date().toISOString(),
            cycleCount: existingCycles.length,
            ...(existingMeta ? { meta: existingMeta } : {}),
            cycles: existingCycles
        }, null, 2);

        await Promise.all([
            fs.writeFile(rawFilePath, rawPayload, 'utf8'),
            fs.writeFile(detailFilePath, detailText, 'utf8'),
            fs.writeFile(avgFilePath, avgText, 'utf8')
        ]);

        return { ok: true, logDir, cycleCount: existingCycles.length };
    }

    async readCycles(gameId, options = {}) {
        if (!isNodeRuntime()) return [];
        const adapter = this.getLogger(gameId);
        if (!adapter) return [];
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const logDir = await this._resolveNodeLogDir(options.logDir || null);
        try {
            const raw = await fs.readFile(path.join(logDir, adapter.fileNames.RAW_DATA), 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.cycles) ? parsed.cycles : [];
        } catch {
            return [];
        }
    }
}

export const SystemLogManager = new SystemLogManagerImpl();
