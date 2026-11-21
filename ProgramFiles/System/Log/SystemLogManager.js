// ProgramFiles/System/Log/SystemLogManager.js
// 전 게임 통합 시스템 로그 총괄 매니저
// - 게임별 로그 어댑터(MarbleLogAdapter 등)를 등록해 사이클 단위 로그 및 100사이클 통계를 관리
// - Node.js 환경에서는 Resource/Log 폴더에 직접 기록하고, 브라우저 환경에서는 HTTP API(/api/logs/record)
//   또는 localStorage 폴백을 사용하여 브라우저 ESM 모듈 안전성을 보장한다.

import {
    MarbleLogAdapter,
    MarbleLog10Adapter,
    MarbleMode1LogAdapter,
    MarbleMode1Log10Adapter,
    MarbleMode2LogAdapter,
    MarbleMode2Log10Adapter,
    MarbleMode3LogAdapter,
    MarbleMode3Log10Adapter,
    MarbleMode4LogAdapter,
    MarbleMode4Log10Adapter
} from '../../Marble/MarbleLogManager.js';
import {
    UnosLogAdapter,
    UnosLog10Adapter
} from '../../Unos/UnosLogManager.js';

const STORAGE_PREFIX = 'rufo_system_logs_v1_';
const ERROR_LOG_JSON_FILE = '아레나_오류보고_로그.json';
const ERROR_LOG_MD_FILE = '아레나_오류보고_로그.md';
const FEEDBACK_LOG_JSON_FILE = '아레나_피드백_로그.json';
export const MAX_ERROR_REPORT_BYTES = 16 * 1024;
export const MAX_ERROR_REPORT_HISTORY = 100;
export const MAX_ERROR_BREADCRUMBS = 30;
export const MAX_ERROR_FIELD_CHARS = 300;
export const MAX_FEEDBACK_BYTES = 16 * 1024;
export const MAX_FEEDBACK_HISTORY = 200;
export const FEEDBACK_TITLE_MIN = 2;
export const FEEDBACK_TITLE_MAX = 80;
export const FEEDBACK_CONTENT_MIN = 5;
export const FEEDBACK_CONTENT_MAX = 1000;
export const FEEDBACK_BREADCRUMBS_MAX = 15;
export const FEEDBACK_BREADCRUMB_MSG_MAX = 200;

function isNodeRuntime() {
    return typeof process !== 'undefined' && Boolean(process.versions && process.versions.node);
}

function getUtf8ByteLength(str) {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(String(str ?? '')).length;
    }
    return String(str ?? '').length * 3;
}

function sanitizeErrorStr(val, maxLen = MAX_ERROR_FIELD_CHARS, fallback = '') {
    const cleaned = String(val ?? '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, maxLen);
    return cleaned || fallback;
}

function escapeMdCell(val, maxLen = MAX_ERROR_FIELD_CHARS) {
    return sanitizeErrorStr(val, maxLen, '-')
        .replace(/\|/g, '\\|')
        .replace(/`/g, '\'');
}

class SystemLogManagerImpl {
    constructor() {
        this.adapters = new Map();
        this.storageOptions = {
            logDir: null,
            errorLogDir: null,
            feedbackLogDir: null,
            disableDiskWrite: false
        };
        this._serverHooks = {
            onErrorRecorded: null,
            onFeedbackRecorded: null
        };
        this._writeLocks = new Map();
        this.registerGameLogger('marble', MarbleLogAdapter);
        this.registerGameLogger('marble_10', MarbleLog10Adapter);
        this.registerGameLogger('marble_mode1', MarbleMode1LogAdapter);
        this.registerGameLogger('marble_mode1_10', MarbleMode1Log10Adapter);
        this.registerGameLogger('marble_mode2', MarbleMode2LogAdapter);
        this.registerGameLogger('marble_mode2_10', MarbleMode2Log10Adapter);
        this.registerGameLogger('marble_mode3', MarbleMode3LogAdapter);
        this.registerGameLogger('marble_mode3_10', MarbleMode3Log10Adapter);
        this.registerGameLogger('marble_mode4', MarbleMode4LogAdapter);
        this.registerGameLogger('marble_mode4_10', MarbleMode4Log10Adapter);
        this.registerGameLogger('unos', UnosLogAdapter);
        this.registerGameLogger('unos_10', UnosLog10Adapter);
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
        if (options.errorLogDir !== undefined) {
            this.storageOptions.errorLogDir = options.errorLogDir || null;
        }
        if (options.feedbackLogDir !== undefined) {
            this.storageOptions.feedbackLogDir = options.feedbackLogDir || null;
        }
        if (options.disableDiskWrite !== undefined) {
            this.storageOptions.disableDiskWrite = Boolean(options.disableDiskWrite);
        }
    }

    setServerHooks(hooks = {}) {
        this._serverHooks = {
            ...this._serverHooks,
            ...hooks
        };
    }

    async _resolveNodeLogDir(overrideLogDir = null, subFolder = 'Test') {
        const pathMod = await import('node:path');
        const urlMod = await import('node:url');
        let configured = overrideLogDir;
        if (!configured) {
            if (subFolder === 'Error') configured = this.storageOptions.errorLogDir || this.storageOptions.logDir;
            else if (subFolder === 'Feedback') configured = this.storageOptions.feedbackLogDir || this.storageOptions.logDir;
            else configured = this.storageOptions.logDir;
        }
        if (configured) {
            return pathMod.resolve(configured);
        }
        const selfDir = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
        const projectRoot = pathMod.resolve(selfDir, '..', '..', '..');
        return subFolder
            ? pathMod.join(projectRoot, 'Resource', 'Log', subFolder)
            : pathMod.join(projectRoot, 'Resource', 'Log');
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
        let resolvedId = String(gameId || 'marble');
        if ((resolvedId === 'marble' || resolvedId === 'marble_10') && rawMatchData?.gameMode) {
            const is10 = resolvedId === 'marble_10';
            if (rawMatchData.gameMode === 'speed') resolvedId = is10 ? 'marble_mode1_10' : 'marble_mode1';
            else if (rawMatchData.gameMode === 'basic') resolvedId = is10 ? 'marble_mode2_10' : 'marble_mode2';
            else if (rawMatchData.gameMode === 'ember') resolvedId = is10 ? 'marble_mode3_10' : 'marble_mode3';
            else if (rawMatchData.gameMode === 'feast') resolvedId = is10 ? 'marble_mode4_10' : 'marble_mode4';
        }
        const adapter = this.getLogger(resolvedId);
        if (!adapter) {
            return { ok: false, error: `UNKNOWN_GAME_LOGGER:${resolvedId}` };
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
        const logDir = await this._resolveNodeLogDir(overrideLogDir, 'Test');
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
            if (replaceExisting && retentionPolicy === 'quantile_preserve' && typeof adapter?.compactCycles === 'function') {
                updatedCycles = incomingCycles.length > maxCycles
                    ? adapter.compactCycles(incomingCycles, maxCycles)
                    : [...incomingCycles];
            } else {
                for (const item of incomingCycles) {
                    updatedCycles = this._pushBoundedCycle(updatedCycles, item, maxCycles, adapter, retentionPolicy);
                }
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
        const logDir = await this._resolveNodeLogDir(options.logDir || null, 'Test');
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
        const logDir = await this._resolveNodeLogDir(options.logDir || null, 'Test');
        try {
            const raw = await fs.readFile(path.join(logDir, adapter.fileNames.RAW_DATA), 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.cycles) ? parsed.cycles : [];
        } catch {
            return [];
        }
    }

    normalizeErrorReport(rawReport, serverContext = null) {
        if (!rawReport || typeof rawReport !== 'object' || Array.isArray(rawReport)) {
            return { ok: false, error: 'INVALID_ERROR_REPORT' };
        }

        let rawSerialized = '';
        try {
            rawSerialized = JSON.stringify(rawReport);
        } catch {
            return { ok: false, error: 'INVALID_ERROR_REPORT' };
        }
        if (getUtf8ByteLength(rawSerialized) > MAX_ERROR_REPORT_BYTES) {
            return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
        }

        const nowIso = new Date().toISOString();
        const rawOccurred = sanitizeErrorStr(rawReport.occurredAt, 40, '');
        const occurredAt = rawOccurred && !Number.isNaN(Date.parse(rawOccurred))
            ? new Date(rawOccurred).toISOString()
            : nowIso;

        const rawBreadcrumbs = Array.isArray(rawReport.breadcrumbs) ? rawReport.breadcrumbs : [];
        const breadcrumbs = rawBreadcrumbs
            .slice(-MAX_ERROR_BREADCRUMBS)
            .filter(item => item && typeof item === 'object')
            .map(item => ({
                t: sanitizeErrorStr(item.t, 32, '0ms'),
                cat: sanitizeErrorStr(item.cat, 32, 'EVENT'),
                msg: sanitizeErrorStr(item.msg, MAX_ERROR_FIELD_CHARS, '')
            }));

        const rawEnv = rawReport.clientEnv && typeof rawReport.clientEnv === 'object' ? rawReport.clientEnv : {};
        const rawDetail = rawReport.errorDetail && typeof rawReport.errorDetail === 'object' ? rawReport.errorDetail : {};

        const report = {
            reportId: sanitizeErrorStr(
                rawReport.reportId,
                64,
                `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            ),
            occurredAt,
            receivedAt: nowIso,
            errorCode: sanitizeErrorStr(rawReport.errorCode, 64, 'ERR_UNKNOWN'),
            summary: sanitizeErrorStr(rawReport.summary, MAX_ERROR_FIELD_CHARS, '클라이언트 오류 보고'),
            gameId: sanitizeErrorStr(rawReport.gameId, 64, 'arena'),
            scene: sanitizeErrorStr(rawReport.scene, 64, 'unknown'),
            roomCode: rawReport.roomCode ? sanitizeErrorStr(rawReport.roomCode, 32, '') : null,
            isOnline: Boolean(rawReport.isOnline),
            playerId: serverContext?.playerId
                ? sanitizeErrorStr(serverContext.playerId, 64, '')
                : (rawReport.playerId ? sanitizeErrorStr(rawReport.playerId, 64, '') : null),
            channel: serverContext?.channel ? sanitizeErrorStr(serverContext.channel, 16, 'unknown') : 'unknown',
            clientEnv: {
                url: sanitizeErrorStr(rawEnv.url, MAX_ERROR_FIELD_CHARS, ''),
                viewport: sanitizeErrorStr(rawEnv.viewport, 64, ''),
                userAgent: sanitizeErrorStr(rawEnv.userAgent, MAX_ERROR_FIELD_CHARS, '')
            },
            errorDetail: {
                message: sanitizeErrorStr(rawDetail.message, MAX_ERROR_FIELD_CHARS, ''),
                failedUrl: rawDetail.failedUrl ? sanitizeErrorStr(rawDetail.failedUrl, MAX_ERROR_FIELD_CHARS, '') : null,
                stack: sanitizeErrorStr(rawDetail.stack, MAX_ERROR_FIELD_CHARS, '')
            },
            breadcrumbs
        };

        return { ok: true, report };
    }

    renderErrorReportMarkdown(reports = []) {
        const list = Array.isArray(reports) ? reports : [];
        const lines = [
            '# 🚨 루포의 보드게임 아레나 — 오류 보고 로그 (`Resource/Log/Error/`)',
            '',
            `> 최근 업데이트: \`${new Date().toISOString()}\` · 보관 건수: **${list.length} / ${MAX_ERROR_REPORT_HISTORY}건** (FIFO Ring Buffer)`,
            '',
            '| # | 수신 시각 (UTC) | 오류 코드 | 게임 / 씬 | 방 코드 | 채널 | 요약 |',
            '| :---: | :--- | :--- | :--- | :--- | :---: | :--- |'
        ];

        const newestFirst = [...list].reverse();
        newestFirst.forEach((rep, idx) => {
            lines.push(
                `| ${idx + 1} | \`${escapeMdCell(rep.receivedAt || rep.occurredAt, 32)}\` | \`${escapeMdCell(rep.errorCode, 48)}\` | ${escapeMdCell(rep.gameId, 24)} / ${escapeMdCell(rep.scene, 24)} | ${escapeMdCell(rep.roomCode, 24)} | ${escapeMdCell(rep.channel, 12)} | ${escapeMdCell(rep.summary, 120)} |`
            );
        });

        lines.push('', '---', '', '## 상세 보고 내역 (최신순)', '');

        newestFirst.forEach((rep, idx) => {
            lines.push(
                `### ${idx + 1}. \`${escapeMdCell(rep.reportId, 64)}\` — \`${escapeMdCell(rep.errorCode, 64)}\``,
                `- **발생/수신**: \`${escapeMdCell(rep.occurredAt, 40)}\` → \`${escapeMdCell(rep.receivedAt, 40)}\``,
                `- **컨텍스트**: game=\`${escapeMdCell(rep.gameId, 32)}\`, scene=\`${escapeMdCell(rep.scene, 32)}\`, room=\`${escapeMdCell(rep.roomCode, 32)}\`, online=\`${Boolean(rep.isOnline)}\`, player=\`${escapeMdCell(rep.playerId, 48)}\``,
                `- **요약**: ${escapeMdCell(rep.summary, MAX_ERROR_FIELD_CHARS)}`,
                `- **오류 상세**: message=\`${escapeMdCell(rep.errorDetail?.message, MAX_ERROR_FIELD_CHARS)}\`, failedUrl=\`${escapeMdCell(rep.errorDetail?.failedUrl, MAX_ERROR_FIELD_CHARS)}\``,
                `- **환경**: url=\`${escapeMdCell(rep.clientEnv?.url, MAX_ERROR_FIELD_CHARS)}\`, viewport=\`${escapeMdCell(rep.clientEnv?.viewport, 64)}\``
            );
            if (rep.errorDetail?.stack) {
                lines.push(`- **스택 요약**: \`${escapeMdCell(rep.errorDetail.stack, MAX_ERROR_FIELD_CHARS)}\``);
            }
            const crumbs = Array.isArray(rep.breadcrumbs) ? rep.breadcrumbs : [];
            if (crumbs.length > 0) {
                lines.push('- **블랙박스 (최근 최대 30건)**:');
                for (const c of crumbs) {
                    lines.push(`  - \`[${escapeMdCell(c.t, 24)}]\` **${escapeMdCell(c.cat, 24)}**: ${escapeMdCell(c.msg, MAX_ERROR_FIELD_CHARS)}`);
                }
            }
            lines.push('');
        });

        return lines.join('\n');
    }

    async recordClientError(rawReport, options = {}) {
        const normalized = this.normalizeErrorReport(rawReport, options.serverContext || null);
        if (!normalized.ok) {
            return normalized;
        }
        const report = normalized.report;

        if (!isNodeRuntime()) {
            const isHttpOrigin = typeof window !== 'undefined' &&
                window.location &&
                (window.location.protocol === 'http:' || window.location.protocol === 'https:');
            if (isHttpOrigin && typeof fetch === 'function') {
                try {
                    const res = await fetch('/api/logs/error', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(report)
                    });
                    const data = await res.json().catch(() => null);
                    if (res.ok && data) return { ok: true, mode: 'http', ...data };
                    return {
                        ok: false,
                        error: data?.error || `HTTP_${res.status}`,
                        retryAfterMs: data?.retryAfterMs ?? null
                    };
                } catch {
                    return { ok: false, error: 'ERROR_REPORT_SEND_FAILED' };
                }
            }
            return { ok: false, error: 'OFFLINE_NO_SERVER' };
        }

        const overrideDir = options.errorLogDir || options.logDir || null;
        if ((this.storageOptions.disableDiskWrite || options.disableDiskWrite) && !overrideDir) {
            return { ok: true, skippedDiskWrite: true, reportId: report.reportId, storedCount: 0 };
        }

        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const errorDir = await this._resolveNodeLogDir(overrideDir, 'Error');

        return this._withWriteLock(`error:${errorDir}`, async () => {
            await fs.mkdir(errorDir, { recursive: true });
            const jsonPath = path.join(errorDir, ERROR_LOG_JSON_FILE);
            const mdPath = path.join(errorDir, ERROR_LOG_MD_FILE);

            let reports = [];
            try {
                const existingRaw = await fs.readFile(jsonPath, 'utf8');
                const parsed = JSON.parse(existingRaw);
                if (Array.isArray(parsed?.reports)) {
                    reports = parsed.reports;
                }
            } catch {
                reports = [];
            }

            reports.push(report);
            while (reports.length > MAX_ERROR_REPORT_HISTORY) {
                reports.shift();
            }

            const jsonPayload = JSON.stringify({
                maxReports: MAX_ERROR_REPORT_HISTORY,
                updatedAt: new Date().toISOString(),
                reportCount: reports.length,
                reports
            }, null, 2);
            const mdPayload = this.renderErrorReportMarkdown(reports);

            await Promise.all([
                fs.writeFile(jsonPath, jsonPayload, 'utf8'),
                fs.writeFile(mdPath, mdPayload, 'utf8')
            ]);

            if (typeof this._serverHooks.onErrorRecorded === 'function') {
                Promise.resolve(this._serverHooks.onErrorRecorded(report, {
                    skipWebhook: Boolean(options.skipWebhook),
                    webhookOptions: options.webhookOptions
                })).catch(() => {});
            } else if (!options.skipWebhook) {
                import('../Server/DiscordWebhook.js')
                    .then(mod => mod.sendErrorAlertWebhook(report, options.webhookOptions || {}))
                    .catch(() => {});
            }

            return {
                ok: true,
                mode: 'node',
                errorDir,
                reportId: report.reportId,
                storedCount: reports.length,
                files: {
                    json: jsonPath,
                    markdown: mdPath
                }
            };
        });
    }

    async readErrorReports(options = {}) {
        if (!isNodeRuntime()) return [];
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const errorDir = await this._resolveNodeLogDir(options.errorLogDir || options.logDir || null, 'Error');
        try {
            const raw = await fs.readFile(path.join(errorDir, ERROR_LOG_JSON_FILE), 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.reports) ? parsed.reports : [];
        } catch {
            return [];
        }
    }

    normalizeFeedbackPayload(rawFeedback, serverContext = null) {
        if (!rawFeedback || typeof rawFeedback !== 'object' || Array.isArray(rawFeedback)) {
            return { ok: false, error: 'INVALID_FEEDBACK' };
        }

        let rawSerialized = '';
        try {
            rawSerialized = JSON.stringify(rawFeedback);
        } catch {
            return { ok: false, error: 'INVALID_FEEDBACK' };
        }
        if (getUtf8ByteLength(rawSerialized) > MAX_FEEDBACK_BYTES) {
            return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
        }

        const category = String(rawFeedback.category || '').trim().toLowerCase();
        if (category !== 'bug' && category !== 'suggestion') {
            return { ok: false, error: 'INVALID_CATEGORY' };
        }

        const title = sanitizeErrorStr(rawFeedback.title, FEEDBACK_TITLE_MAX, '');
        if (title.length < FEEDBACK_TITLE_MIN) {
            return { ok: false, error: 'INVALID_FEEDBACK_TITLE' };
        }

        const content = String(rawFeedback.content ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
            .trim()
            .slice(0, FEEDBACK_CONTENT_MAX);
        if (content.length < FEEDBACK_CONTENT_MIN) {
            return { ok: false, error: 'INVALID_FEEDBACK_CONTENT' };
        }

        const attachBreadcrumbs = category === 'bug' && rawFeedback.attachBreadcrumbs !== false;
        const rawCrumbs = attachBreadcrumbs && Array.isArray(rawFeedback.breadcrumbs)
            ? rawFeedback.breadcrumbs
            : [];
        const breadcrumbs = rawCrumbs
            .slice(-FEEDBACK_BREADCRUMBS_MAX)
            .filter(item => item && typeof item === 'object')
            .map(item => ({
                t: sanitizeErrorStr(item.t, 32, '0ms'),
                cat: sanitizeErrorStr(item.cat, 32, 'EVENT'),
                msg: sanitizeErrorStr(item.msg, FEEDBACK_BREADCRUMB_MSG_MAX, '')
            }));

        const feedback = {
            feedbackId: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: new Date().toISOString(),
            category,
            gameId: sanitizeErrorStr(rawFeedback.gameId, 64, 'arena'),
            title,
            content,
            playerId: serverContext?.playerId
                ? sanitizeErrorStr(serverContext.playerId, 64, '')
                : (rawFeedback.playerId ? sanitizeErrorStr(rawFeedback.playerId, 64, '') : null),
            nickname: serverContext?.nickname
                ? sanitizeErrorStr(serverContext.nickname, 32, '')
                : (rawFeedback.nickname ? sanitizeErrorStr(rawFeedback.nickname, 32, '') : null),
            channel: serverContext?.channel ? sanitizeErrorStr(serverContext.channel, 16, 'unknown') : 'unknown',
            breadcrumbs
        };

        return { ok: true, feedback };
    }

    async recordFeedback(rawFeedback, options = {}) {
        const normalized = this.normalizeFeedbackPayload(rawFeedback, options.serverContext || null);
        if (!normalized.ok) {
            return normalized;
        }
        const feedback = normalized.feedback;

        if (!isNodeRuntime()) {
            const isHttpOrigin = typeof window !== 'undefined' &&
                window.location &&
                (window.location.protocol === 'http:' || window.location.protocol === 'https:');
            if (isHttpOrigin && typeof fetch === 'function') {
                try {
                    const res = await fetch('/api/feedback', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(feedback)
                    });
                    const data = await res.json().catch(() => null);
                    if (res.ok && data) return { ok: true, mode: 'http', ...data };
                    return {
                        ok: false,
                        error: data?.error || `HTTP_${res.status}`,
                        retryAfterMs: data?.retryAfterMs ?? null
                    };
                } catch {
                    return { ok: false, error: 'FEEDBACK_SEND_FAILED' };
                }
            }
            return { ok: false, error: 'OFFLINE_NO_SERVER' };
        }

        const overrideDir = options.feedbackLogDir || options.logDir || null;
        if ((this.storageOptions.disableDiskWrite || options.disableDiskWrite) && !overrideDir) {
            return { ok: true, skippedDiskWrite: true, feedbackId: feedback.feedbackId, storedCount: 0 };
        }

        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const feedbackDir = await this._resolveNodeLogDir(overrideDir, 'Feedback');

        return this._withWriteLock(`feedback:${feedbackDir}`, async () => {
            await fs.mkdir(feedbackDir, { recursive: true });
            const jsonPath = path.join(feedbackDir, FEEDBACK_LOG_JSON_FILE);

            let items = [];
            try {
                const existingRaw = await fs.readFile(jsonPath, 'utf8');
                const parsed = JSON.parse(existingRaw);
                if (Array.isArray(parsed?.items)) {
                    items = parsed.items;
                }
            } catch {
                items = [];
            }

            items.push(feedback);
            while (items.length > MAX_FEEDBACK_HISTORY) {
                items.shift();
            }

            await fs.writeFile(jsonPath, JSON.stringify({
                maxItems: MAX_FEEDBACK_HISTORY,
                updatedAt: new Date().toISOString(),
                itemCount: items.length,
                items
            }, null, 2), 'utf8');

            if (typeof this._serverHooks.onFeedbackRecorded === 'function') {
                Promise.resolve(this._serverHooks.onFeedbackRecorded(feedback, {
                    skipWebhook: Boolean(options.skipWebhook),
                    webhookOptions: options.webhookOptions
                })).catch(() => {});
            } else if (!options.skipWebhook && feedback.category === 'bug') {
                import('../Server/DiscordWebhook.js')
                    .then(mod => mod.sendFeedbackWebhook(feedback, options.webhookOptions || {}))
                    .catch(() => {});
            }

            return {
                ok: true,
                mode: 'node',
                feedbackDir,
                feedbackId: feedback.feedbackId,
                category: feedback.category,
                storedCount: items.length,
                file: jsonPath
            };
        });
    }

    async readFeedbacks(options = {}) {
        if (!isNodeRuntime()) return [];
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const feedbackDir = await this._resolveNodeLogDir(options.feedbackLogDir || options.logDir || null, 'Feedback');
        try {
            const raw = await fs.readFile(path.join(feedbackDir, FEEDBACK_LOG_JSON_FILE), 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.items) ? parsed.items : [];
        } catch {
            return [];
        }
    }
}

export const SystemLogManager = new SystemLogManagerImpl();
