// ProgramFiles/System/Server/DailyStatsCollector.js
// KST 기준 일일 운영 통계 집계기 (14일 날짜별 백업 · 미발송 전일 통계 재기동 복구 · KST 00:00 자동 브리핑)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendDailyStatsWebhook, sendSuggestionBatchWebhooks } from './DiscordWebhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

export const STATS_RETENTION_DAYS = 14;
const STATS_FILE_PREFIX = '아레나_통계_';
const STATS_FILE_REGEX = /^아레나_통계_(\d{4}-\d{2}-\d{2})\.json$/;
const CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_PERSIST_DEBOUNCE_MS = 1000;

export function getKstDateString(nowMs = Date.now()) {
    const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

function createEmptyDayStats(dateStr) {
    return {
        date: dateStr,
        dispatched: false,
        dispatchedAt: null,
        suggestionDispatched: false,
        suggestionDispatchedAt: null,
        newSessions: 0,
        peakClients: 0,
        peakRooms: 0,
        errorReportsCount: 0,
        bugCount: 0,
        suggestionCount: 0,
        games: {},
        pendingSuggestions: []
    };
}

function normalizeLoadedStats(raw, expectedDate) {
    const base = createEmptyDayStats(expectedDate);
    if (!raw || typeof raw !== 'object') return base;
    base.dispatched = Boolean(raw.dispatched);
    base.dispatchedAt = raw.dispatchedAt || null;
    base.suggestionDispatched = Boolean(raw.suggestionDispatched);
    base.suggestionDispatchedAt = raw.suggestionDispatchedAt || null;
    base.newSessions = Math.max(0, Number(raw.newSessions) || 0);
    base.peakClients = Math.max(0, Number(raw.peakClients) || 0);
    base.peakRooms = Math.max(0, Number(raw.peakRooms) || 0);
    base.errorReportsCount = Math.max(0, Number(raw.errorReportsCount) || 0);
    base.bugCount = Math.max(0, Number(raw.bugCount) || 0);
    base.suggestionCount = Math.max(0, Number(raw.suggestionCount) || 0);
    if (raw.games && typeof raw.games === 'object' && !Array.isArray(raw.games)) {
        base.games = raw.games;
    }
    if (Array.isArray(raw.pendingSuggestions)) {
        base.pendingSuggestions = raw.pendingSuggestions
            .filter(item => item && typeof item === 'object')
            .slice(-200);
    }
    return base;
}

function daysBetweenDateStrings(olderDateStr, newerDateStr) {
    const olderMs = Date.parse(`${olderDateStr}T00:00:00Z`);
    const newerMs = Date.parse(`${newerDateStr}T00:00:00Z`);
    if (Number.isNaN(olderMs) || Number.isNaN(newerMs)) return 0;
    return Math.floor((newerMs - olderMs) / (24 * 60 * 60 * 1000));
}

export class DailyStatsCollector {
    constructor(options = {}) {
        this.statsDir = options.statsDir
            ? path.resolve(options.statsDir)
            : path.join(DEFAULT_PROJECT_ROOT, 'Resource', 'Log', 'Stats');
        this.disableDiskWrite = Boolean(options.disableDiskWrite) && !options.statsDir;
        this.retentionDays = Math.max(1, Number(options.retentionDays) || STATS_RETENTION_DAYS);
        this.persistDebounceMs = options.persistDebounceMs !== undefined
            ? Math.max(0, Number(options.persistDebounceMs))
            : DEFAULT_PERSIST_DEBOUNCE_MS;
        this.nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
        this.webhookSender = typeof options.webhookSender === 'function'
            ? options.webhookSender
            : (summary, opts) => sendDailyStatsWebhook(summary, opts);
        this.suggestionBatchSender = typeof options.suggestionBatchSender === 'function'
            ? options.suggestionBatchSender
            : (suggestions, opts) => sendSuggestionBatchWebhooks(suggestions, opts);
        this.suggestionBatchDelayMs = options.suggestionBatchDelayMs;
        this.webhookOptions = options.webhookOptions || {};

        this.current = createEmptyDayStats(getKstDateString(this.nowFn()));
        this._dirty = false;
        this._persistTimer = null;
        this._rolloverTimer = null;
        this._writeChain = Promise.resolve();
        this._stopped = false;
    }

    _getFilePathForDate(dateStr) {
        return path.join(this.statsDir, `${STATS_FILE_PREFIX}${dateStr}.json`);
    }

    _enqueueDiskOp(task) {
        this._writeChain = this._writeChain.then(() => task(), () => task());
        return this._writeChain;
    }

    async _writeStatsFile(statsObj) {
        if (this.disableDiskWrite) return;
        const filePath = this._getFilePathForDate(statsObj.date);
        await this._enqueueDiskOp(async () => {
            await fs.mkdir(this.statsDir, { recursive: true });
            await fs.writeFile(filePath, JSON.stringify({
                ...statsObj,
                updatedAt: new Date(this.nowFn()).toISOString()
            }, null, 2), 'utf8');
        });
    }

    _schedulePersist() {
        this._dirty = true;
        if (this.disableDiskWrite || this._stopped) return;
        if (this.persistDebounceMs === 0) {
            this.flushToDisk().catch(() => {});
            return;
        }
        if (this._persistTimer) return;
        this._persistTimer = setTimeout(() => {
            this._persistTimer = null;
            this.flushToDisk().catch(() => {});
        }, this.persistDebounceMs);
        this._persistTimer.unref?.();
    }

    async flushToDisk() {
        if (this._persistTimer) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
        }
        if (!this._dirty || this.disableDiskWrite) return;
        this._dirty = false;
        await this._writeStatsFile(this.current);
    }

    async pruneOldFiles(referenceDateStr = getKstDateString(this.nowFn())) {
        if (this.disableDiskWrite) return 0;
        try {
            const entries = await fs.readdir(this.statsDir);
            let removed = 0;
            for (const name of entries) {
                const match = STATS_FILE_REGEX.exec(name);
                if (!match) continue;
                const fileDate = match[1];
                if (daysBetweenDateStrings(fileDate, referenceDateStr) >= this.retentionDays) {
                    await fs.unlink(path.join(this.statsDir, name)).catch(() => {});
                    removed += 1;
                }
            }
            return removed;
        } catch {
            return 0;
        }
    }

    async _recoverAndPruneExistingFiles(todayStr) {
        if (this.disableDiskWrite) return;
        await fs.mkdir(this.statsDir, { recursive: true });
        const entries = await fs.readdir(this.statsDir).catch(() => []);
        const dateFiles = [];
        for (const name of entries) {
            const match = STATS_FILE_REGEX.exec(name);
            if (match) dateFiles.push({ name, date: match[1] });
        }
        dateFiles.sort((a, b) => a.date.localeCompare(b.date));

        for (const item of dateFiles) {
            const filePath = path.join(this.statsDir, item.name);
            let parsed = null;
            try {
                parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
            } catch {
                parsed = null;
            }
            if (!parsed) continue;

            if (item.date === todayStr) {
                this.current = normalizeLoadedStats(parsed, todayStr);
            } else if (item.date < todayStr) {
                const normalizedPast = normalizeLoadedStats(parsed, item.date);
                let pastChanged = false;
                if (!normalizedPast.dispatched) {
                    const sendRes = await this.webhookSender(normalizedPast, this.webhookOptions).catch(() => ({ ok: false }));
                    if (sendRes?.ok) {
                        normalizedPast.dispatched = true;
                        normalizedPast.dispatchedAt = new Date(this.nowFn()).toISOString();
                        pastChanged = true;
                    }
                }
                const unsentSuggestions = (normalizedPast.pendingSuggestions || []).filter(s => !s.dispatched);
                if (!normalizedPast.suggestionDispatched && unsentSuggestions.length > 0) {
                    const sugRes = await this._dispatchSuggestionsForStats(normalizedPast, this.nowFn());
                    if (sugRes.sentCount > 0 || normalizedPast.suggestionDispatched) {
                        pastChanged = true;
                    }
                }
                if (pastChanged) {
                    await this._writeStatsFile(normalizedPast);
                }
            }
        }

        await this.pruneOldFiles(todayStr);
        await this._writeStatsFile(this.current);
    }

    async init({ testOnBoot = process.env.DISCORD_STATS_TEST_ON_BOOT === 'true' } = {}) {
        const todayStr = getKstDateString(this.nowFn());
        this.current = createEmptyDayStats(todayStr);

        await this._recoverAndPruneExistingFiles(todayStr);

        if (testOnBoot) {
            this.webhookSender(this.getSummary(), this.webhookOptions).catch(() => {});
        }

        if (!this._rolloverTimer) {
            this._rolloverTimer = setInterval(() => {
                this.checkDateRollover().catch(() => {});
            }, CHECK_INTERVAL_MS);
            this._rolloverTimer.unref?.();
        }
    }

    async _dispatchSuggestionsForStats(statsObj, nowMs = this.nowFn()) {
        const allItems = Array.isArray(statsObj?.pendingSuggestions) ? statsObj.pendingSuggestions : [];
        const unsent = allItems.filter(item => !item?.dispatched);
        if (unsent.length === 0) {
            return { ok: true, skipped: true, reason: 'NO_SUGGESTIONS', sentCount: 0, total: 0 };
        }

        const sendOpts = {
            ...this.webhookOptions,
            batchDate: statsObj.date,
            ...(this.suggestionBatchDelayMs !== undefined ? { delayMs: this.suggestionBatchDelayMs } : {})
        };
        const res = await this.suggestionBatchSender(unsent, sendOpts).catch(() => ({
            ok: false,
            sentCount: 0,
            total: unsent.length,
            sentIds: []
        }));

        const sentIdSet = new Set(Array.isArray(res?.sentIds) ? res.sentIds : []);
        const sentIso = new Date(nowMs).toISOString();
        let markedCount = 0;
        for (const item of allItems) {
            if (!item || item.dispatched) continue;
            if (sentIdSet.has(item.feedbackId) || (res?.ok && sentIdSet.size === 0)) {
                item.dispatched = true;
                item.dispatchedAt = sentIso;
                markedCount++;
            }
        }
        if (allItems.every(item => item?.dispatched)) {
            statsObj.suggestionDispatched = true;
            statsObj.suggestionDispatchedAt = sentIso;
        }
        return {
            ok: Boolean(res?.ok),
            skipped: Boolean(res?.skipped),
            reason: res?.reason || null,
            sentCount: markedCount || Number(res?.sentCount) || 0,
            total: unsent.length,
            webhook: res
        };
    }

    async checkDateRollover() {
        const nowMs = this.nowFn();
        const todayStr = getKstDateString(nowMs);
        if (todayStr === this.current.date) {
            return { rolledOver: false, date: todayStr };
        }

        const closingDay = {
            ...this.current,
            games: structuredClone(this.current.games),
            pendingSuggestions: structuredClone(this.current.pendingSuggestions || [])
        };
        this.current = createEmptyDayStats(todayStr);
        this._dirty = false;

        if (!closingDay.dispatched) {
            const res = await this.webhookSender(closingDay, this.webhookOptions).catch(() => ({ ok: false }));
            if (res?.ok) {
                closingDay.dispatched = true;
                closingDay.dispatchedAt = new Date(nowMs).toISOString();
            }
        }

        const sugRes = await this._dispatchSuggestionsForStats(closingDay, nowMs);

        await this._writeStatsFile(closingDay);
        await this._writeStatsFile(this.current);
        await this.pruneOldFiles(todayStr);
        return {
            rolledOver: true,
            closedDate: closingDay.date,
            newDate: todayStr,
            webhookSent: closingDay.dispatched,
            suggestionsSent: sugRes.sentCount,
            suggestionsSkipped: Boolean(sugRes.skipped)
        };
    }

    async flushNowToWebhook() {
        const snapshot = this.getSummary();
        const sendRes = await this.webhookSender(snapshot, this.webhookOptions);
        await this.flushToDisk();
        return { ok: Boolean(sendRes?.ok), webhook: sendRes, summary: snapshot };
    }

    async flushSuggestionsNowToWebhook() {
        this._ensureCurrentDateSync();
        const res = await this._dispatchSuggestionsForStats(this.current, this.nowFn());
        if (res.sentCount > 0) {
            this._dirty = true;
        }
        await this.flushToDisk();
        return {
            ...res,
            date: this.current.date
        };
    }

    _ensureCurrentDateSync() {
        const todayStr = getKstDateString(this.nowFn());
        if (todayStr !== this.current.date) {
            // 비동기 롤오버 트리거 (호출 흐름은 블로킹하지 않음)
            this.checkDateRollover().catch(() => {});
        }
    }

    recordNewSession() {
        this._ensureCurrentDateSync();
        this.current.newSessions += 1;
        this._schedulePersist();
    }

    updatePeakClients(clientCount) {
        const n = Math.max(0, Number(clientCount) || 0);
        if (n > this.current.peakClients) {
            this.current.peakClients = n;
            this._schedulePersist();
        }
    }

    updatePeakRooms(roomCount) {
        const n = Math.max(0, Number(roomCount) || 0);
        if (n > this.current.peakRooms) {
            this.current.peakRooms = n;
            this._schedulePersist();
        }
    }

    /**
     * 완주된 온라인 멀티플레이 경기 결과를 범용 games[gameId] 구조로 집계한다.
     * 추후 싱글플레이/우노스 확장 시에도 동일 인터페이스를 재사용한다.
     */
    recordOnlineMatchFinished({ gameId = 'marble', gameMode = 'default', hasAi = false } = {}) {
        this._ensureCurrentDateSync();
        const gid = String(gameId || 'marble');
        const mode = String(gameMode || 'default');

        if (!this.current.games[gid]) {
            this.current.games[gid] = { total: 0, pureHuman: 0, withAi: 0, byMode: {} };
        }
        const g = this.current.games[gid];
        g.total += 1;
        if (hasAi) g.withAi += 1;
        else g.pureHuman += 1;

        if (!g.byMode[mode]) {
            g.byMode[mode] = { total: 0, pureHuman: 0, withAi: 0 };
        }
        g.byMode[mode].total += 1;
        if (hasAi) g.byMode[mode].withAi += 1;
        else g.byMode[mode].pureHuman += 1;

        this._schedulePersist();
    }

    recordErrorReport() {
        this._ensureCurrentDateSync();
        this.current.errorReportsCount += 1;
        this._schedulePersist();
    }

    recordFeedback(category) {
        this._ensureCurrentDateSync();
        if (category === 'bug') {
            this.current.bugCount += 1;
        } else if (category === 'suggestion') {
            this.current.suggestionCount += 1;
        }
        this._schedulePersist();
    }

    recordSuggestion(feedback) {
        if (!feedback || feedback.category !== 'suggestion') return;
        this._ensureCurrentDateSync();
        if (!Array.isArray(this.current.pendingSuggestions)) {
            this.current.pendingSuggestions = [];
        }
        this.current.pendingSuggestions.push({
            feedbackId: feedback.feedbackId || `fb_${this.nowFn()}`,
            createdAt: feedback.createdAt || new Date(this.nowFn()).toISOString(),
            category: 'suggestion',
            gameId: feedback.gameId || 'arena',
            title: feedback.title || '(제목 없음)',
            content: feedback.content || '',
            playerId: feedback.playerId || null,
            nickname: feedback.nickname || null,
            channel: feedback.channel || 'ws',
            dispatched: false,
            dispatchedAt: null
        });
        while (this.current.pendingSuggestions.length > 200) {
            this.current.pendingSuggestions.shift();
        }
        this.current.suggestionDispatched = false;
        this._schedulePersist();
    }

    getSummary() {
        return {
            ...this.current,
            games: structuredClone(this.current.games),
            pendingSuggestions: structuredClone(this.current.pendingSuggestions || [])
        };
    }

    async stop() {
        this._stopped = true;
        if (this._rolloverTimer) {
            clearInterval(this._rolloverTimer);
            this._rolloverTimer = null;
        }
        if (this._persistTimer) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
        }
        if (this._dirty && !this.disableDiskWrite) {
            this._dirty = false;
            await this._writeStatsFile(this.current);
        }
        await this._writeChain;
    }
}
