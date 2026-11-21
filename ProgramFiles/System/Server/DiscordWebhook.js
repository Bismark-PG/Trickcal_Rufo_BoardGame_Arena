// ProgramFiles/System/Server/DiscordWebhook.js
// 루트 .env 로더 + Discord 4채널(오류알림/일일통계/버그제보/건의함) 비동기 보안 웹훅 전송기

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULT_TIMEOUT_MS = 5000;
const ERROR_THROTTLE_MS = 30000;
const MAX_EMBED_TITLE = 256;
const MAX_EMBED_DESC = 2048;
const MAX_EMBED_FIELD = 1024;

export const DISCORD_COLORS = Object.freeze({
    ERROR: 0xE74C3C,      // #E74C3C 빨간색 (#오류알림)
    STATS: 0x3498DB,      // #3498DB 파란색 (#일일통계)
    BUG: 0xE67E22,        // #E67E22 주황색 (#버그제보)
    SUGGESTION: 0x2ECC71  // #2ECC71 에메랄드색 (#건의함)
});

// 유저(디렉터)가 문구/이모지/제목을 쉽게 수정할 수 있도록 템플릿 라벨을 분리 관리
export const DISCORD_TEMPLATES = Object.freeze({
    BOT_NAME: '루포 아레나 관제봇',
    ERROR_TITLE_PREFIX: '🚨 [오류 보고]',
    ERROR_FOOTER: 'Rufo BoardGame Arena · 오류 감지 시스템',
    STATS_TITLE_PREFIX: '📊 [일일 운영 통계]',
    STATS_FOOTER: 'Rufo BoardGame Arena · 일일 통계 시스템',
    BUG_TITLE_PREFIX: '🐛 [버그 제보]',
    BUG_FOOTER: 'Rufo BoardGame Arena · 버그 제보 시스템',
    SUGGESTION_TITLE_PREFIX: '💡 [유저 건의]',
    SUGGESTION_FOOTER: 'Rufo BoardGame Arena · 유저 건의 시스템'
});

const MODE_LABELS_KO = Object.freeze({
    speed: '간식',
    basic: '정식',
    ember: '불씨',
    feast: '특식',
    standard: '기본(1:1)',
    default: '정식'
});

const MARBLE_MODE_ORDER = ['speed', 'basic', 'feast', 'ember'];

const GAME_LABELS_KO = Object.freeze({
    arena: '아레나 공통',
    marble: '엘리아스 마블',
    unos: '우노스 (UNOS)'
});

const errorThrottleMap = new Map(); // key: `${errorCode}::${summary}` -> { lastSentAt, suppressedCount }

export function escapeDiscordMarkdown(val) {
    return String(val ?? '').replace(/([\\*_~`|>#\[\]()])/g, '\\$1');
}

function sanitizeInlineCode(val) {
    return String(val ?? '').replace(/`/g, "'");
}

function clampText(val, maxLen = MAX_EMBED_FIELD, fallback = '-') {
    const cleaned = String(val ?? '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
        .trim();
    if (!cleaned) return fallback;
    if (cleaned.length <= maxLen) return cleaned;
    const sliced = cleaned.slice(0, Math.max(0, maxLen - 3)).replace(/\\+$/, '');
    return `${sliced}...`;
}

function formatKstDateTime(isoOrDate = new Date()) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return '-';
    const kstMs = d.getTime() + 9 * 60 * 60 * 1000;
    const kst = new Date(kstMs);
    const yyyy = kst.getUTCFullYear();
    const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const mi = String(kst.getUTCMinutes()).padStart(2, '0');
    const ss = String(kst.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} KST`;
}

/**
 * 외부 패키지 없이 루트 .env 파일을 동기 로드해 process.env에 주입한다.
 * 이미 환경변수가 설정된 키는 덮어쓰지 않는다.
 */
export function loadEnvFile(envFilePath = path.join(DEFAULT_PROJECT_ROOT, '.env')) {
    try {
        if (!fs.existsSync(envFilePath)) {
            return { loaded: false, keys: [] };
        }
        const raw = fs.readFileSync(envFilePath, 'utf8');
        const loadedKeys = [];
        for (const rawLine of raw.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const normalizedLine = line.startsWith('export ') ? line.slice(7).trim() : line;
            const eqIdx = normalizedLine.indexOf('=');
            if (eqIdx <= 0) continue;

            const key = normalizedLine.slice(0, eqIdx).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

            let val = normalizedLine.slice(eqIdx + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
                (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
            ) {
                val = val.slice(1, -1);
            }

            if (process.env[key] === undefined || process.env[key] === '') {
                process.env[key] = val;
                loadedKeys.push(key);
            }
        }
        return { loaded: true, keys: loadedKeys };
    } catch {
        return { loaded: false, keys: [] };
    }
}

export function isValidDiscordWebhookUrl(rawUrl, { allowLocalTestUrl = false } = {}) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    const trimmed = rawUrl.trim();
    if (!trimmed) return false;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'https:') {
            const host = parsed.hostname.toLowerCase();
            return (host === 'discord.com' || host === 'discordapp.com') &&
                parsed.pathname.startsWith('/api/webhooks/');
        }
        if (allowLocalTestUrl && parsed.protocol === 'http:') {
            const host = parsed.hostname.toLowerCase();
            return host === '127.0.0.1' || host === 'localhost' || host === '::1';
        }
        return false;
    } catch {
        return false;
    }
}

export async function postDiscordWebhook(webhookUrl, rawPayload, {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchFn = globalThis.fetch,
    allowLocalTestUrl = false
} = {}) {
    if (!isValidDiscordWebhookUrl(webhookUrl, { allowLocalTestUrl })) {
        return { ok: false, skipped: true, reason: 'WEBHOOK_NOT_CONFIGURED' };
    }
    if (typeof fetchFn !== 'function') {
        return { ok: false, skipped: true, reason: 'FETCH_UNAVAILABLE' };
    }

    // @everyone / @here / 역할·유저 멘션 알림 원천 차단
    const safePayload = {
        username: DISCORD_TEMPLATES.BOT_NAME,
        ...rawPayload,
        allowed_mentions: { parse: [] }
    };

    try {
        const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(timeoutMs)
            : undefined;
        const res = await fetchFn(webhookUrl.trim(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(safePayload),
            ...(signal ? { signal } : {})
        });
        if (!res.ok) {
            return { ok: false, status: res.status, reason: `HTTP_${res.status}` };
        }
        return { ok: true, status: res.status };
    } catch (err) {
        return { ok: false, reason: err?.name || err?.message || 'NETWORK_ERROR' };
    }
}

export function buildErrorAlertPayload(report, { suppressedCount = 0 } = {}) {
    const gameLabel = GAME_LABELS_KO[report?.gameId] || escapeDiscordMarkdown(report?.gameId) || 'arena';
    const crumbs = Array.isArray(report?.breadcrumbs) ? report.breadcrumbs.slice(-5) : [];
    const crumbLines = crumbs.length > 0
        ? crumbs.map(c => `\`[${sanitizeInlineCode(clampText(c.t, 16, '0ms'))}]\` **${escapeDiscordMarkdown(clampText(c.cat, 16, 'EVENT'))}**: ${escapeDiscordMarkdown(clampText(c.msg, 120, ''))}`).join('\n')
        : '기록 없음';

    const summaryBase = escapeDiscordMarkdown(clampText(report?.summary, 280, '오류 요약 없음'));
    const summaryText = suppressedCount > 0
        ? `${summaryBase}\n*(직전 30초 내 동일 오류 ${suppressedCount}건 추가 발생)*`
        : summaryBase;

    const fields = [
        { name: '발생 시각', value: formatKstDateTime(report?.occurredAt || report?.receivedAt), inline: true },
        { name: '씬 / 방 코드', value: `\`${sanitizeInlineCode(clampText(report?.scene, 32))}\` / \`${sanitizeInlineCode(clampText(report?.roomCode, 24, '없음'))}\``, inline: true },
        { name: '플레이어 ID', value: `\`${sanitizeInlineCode(clampText(report?.playerId, 48, '익명/오프라인'))}\``, inline: true },
        { name: '요약', value: clampText(summaryText, MAX_EMBED_FIELD), inline: false },
        { name: '에러 상세 메시지', value: `\`${sanitizeInlineCode(clampText(report?.errorDetail?.message, 900, '메시지 없음'))}\``, inline: false },
        { name: '최근 블랙박스 (최대 5줄)', value: clampText(crumbLines, MAX_EMBED_FIELD, '기록 없음'), inline: false }
    ];

    if (report?.errorDetail?.failedUrl) {
        fields.push({
            name: '실패 리소스 URL',
            value: `\`${sanitizeInlineCode(clampText(report.errorDetail.failedUrl, 900))}\``,
            inline: false
        });
    }

    return {
        embeds: [{
            title: clampText(`${DISCORD_TEMPLATES.ERROR_TITLE_PREFIX} ${escapeDiscordMarkdown(report?.errorCode || 'ERR_UNKNOWN')} (${gameLabel})`, MAX_EMBED_TITLE),
            color: DISCORD_COLORS.ERROR,
            fields,
            timestamp: new Date().toISOString(),
            footer: { text: DISCORD_TEMPLATES.ERROR_FOOTER }
        }]
    };
}

export function buildDailyStatsPayload(stats) {
    const gamesObj = stats?.games && typeof stats.games === 'object' ? stats.games : {};
    let totalMatches = 0;
    let pureHumanMatches = 0;
    let withAiMatches = 0;
    const gameDetailBlocks = [];

    for (const [gameId, entry] of Object.entries(gamesObj)) {
        const gTotal = Number(entry?.total) || 0;
        const gPure = Number(entry?.pureHuman) || 0;
        const gAi = Number(entry?.withAi) || 0;
        totalMatches += gTotal;
        pureHumanMatches += gPure;
        withAiMatches += gAi;

        const gameName = GAME_LABELS_KO[gameId] || escapeDiscordMarkdown(gameId);
        const byMode = entry?.byMode && typeof entry.byMode === 'object' ? entry.byMode : {};
        const lines = [`**${gameName}** - 총 **${gTotal}판**`];

        if (gameId === 'marble') {
            const seenModes = new Set();
            for (const modeKey of MARBLE_MODE_ORDER) {
                seenModes.add(modeKey);
                const mv = byMode[modeKey];
                const mLabel = MODE_LABELS_KO[modeKey] || modeKey;
                lines.push(`> ${mLabel} : **${Number(mv?.total) || 0}판** (순수 플레이어 다인전 **${Number(mv?.pureHuman) || 0}판** / AI포함 **${Number(mv?.withAi) || 0}판**)`);
            }
            for (const [m, mv] of Object.entries(byMode)) {
                if (seenModes.has(m)) continue;
                const mLabel = MODE_LABELS_KO[m] || escapeDiscordMarkdown(m);
                lines.push(`> ${mLabel} : **${Number(mv?.total) || 0}판** (순수 플레이어 다인전 **${Number(mv?.pureHuman) || 0}판** / AI포함 **${Number(mv?.withAi) || 0}판**)`);
            }
        } else {
            const modeEntries = Object.entries(byMode);
            if (modeEntries.length > 0) {
                for (const [m, mv] of modeEntries) {
                    const mLabel = MODE_LABELS_KO[m] || escapeDiscordMarkdown(m);
                    lines.push(`> ${mLabel} : **${Number(mv?.total) || 0}판** (순수 플레이어 다인전 **${Number(mv?.pureHuman) || 0}판** / AI포함 **${Number(mv?.withAi) || 0}판**)`);
                }
            } else {
                lines.push(`> 전체 : **${gTotal}판** (순수 플레이어 다인전 **${gPure}판** / AI포함 **${gAi}판**)`);
            }
        }

        gameDetailBlocks.push(lines.join('\n'));
    }

    const matchBreakdown = gameDetailBlocks.length > 0
        ? gameDetailBlocks.join('\n\n')
        : '완주된 경기가 없습니다.';

    const fields = [
        { name: '기준 일자 (KST)', value: `**${clampText(stats?.date, 20)}**`, inline: true },
        { name: '총 신규 세션 (HELLO)', value: `**${Number(stats?.newSessions) || 0}명**`, inline: true },
        { name: '최대 동시 접속 / 방', value: `접속 **${Number(stats?.peakClients) || 0}명** / 방 **${Number(stats?.peakRooms) || 0}개**`, inline: true },
        {
            name: '완주된 경기 수',
            value: `총 **${totalMatches}판** (순수 플레이어 다인전 **${pureHumanMatches}판** / AI포함 **${withAiMatches}판**)`,
            inline: false
        },
        { name: '게임 모드별 상세', value: clampText(matchBreakdown, MAX_EMBED_FIELD), inline: false },
        {
            name: '제보 접수현황',
            value: `오류보고 **${Number(stats?.errorReportsCount) || 0}건**\n버그제보 **${Number(stats?.bugCount) || 0}건**\n유저건의 **${Number(stats?.suggestionCount) || 0}건**`,
            inline: false
        }
    ];

    return {
        embeds: [{
            title: clampText(`${DISCORD_TEMPLATES.STATS_TITLE_PREFIX} ${stats?.date || ''} 운영 리포트`, MAX_EMBED_TITLE),
            color: DISCORD_COLORS.STATS,
            fields,
            timestamp: new Date().toISOString(),
            footer: { text: DISCORD_TEMPLATES.STATS_FOOTER }
        }]
    };
}

export function buildFeedbackPayload(feedback, options = {}) {
    const isBug = feedback?.category === 'bug';
    const gameLabel = GAME_LABELS_KO[feedback?.gameId] || escapeDiscordMarkdown(feedback?.gameId) || '아레나 공통';
    const authorText = feedback?.nickname
        ? `${escapeDiscordMarkdown(clampText(feedback.nickname, 32))} (\`${sanitizeInlineCode(clampText(feedback.playerId, 32, '오프라인'))}\`)`
        : `\`${sanitizeInlineCode(clampText(feedback?.playerId, 32, '익명/오프라인'))}\``;
    const submittedKst = formatKstDateTime(feedback?.createdAt);
    const parsedCreatedMs = feedback?.createdAt ? Date.parse(feedback.createdAt) : NaN;
    const embedTimestamp = !Number.isNaN(parsedCreatedMs)
        ? new Date(parsedCreatedMs).toISOString()
        : new Date().toISOString();

    const fields = [
        { name: '대상 게임', value: clampText(gameLabel, 64), inline: true },
        { name: '작성자', value: clampText(authorText, 128), inline: true },
        { name: '접수 시각', value: submittedKst, inline: true },
        { name: '내용', value: clampText(escapeDiscordMarkdown(feedback?.content), MAX_EMBED_FIELD, '-'), inline: false }
    ];

    if (isBug && Array.isArray(feedback?.breadcrumbs) && feedback.breadcrumbs.length > 0) {
        const crumbText = feedback.breadcrumbs
            .slice(-15)
            .map(c => `\`[${sanitizeInlineCode(clampText(c.t, 16, '0ms'))}]\` **${escapeDiscordMarkdown(clampText(c.cat, 16, 'EVENT'))}**: ${escapeDiscordMarkdown(clampText(c.msg, 120, ''))}`)
            .join('\n');
        fields.push({
            name: '첨부 블랙박스 (최근 최대 15줄)',
            value: clampText(crumbText, MAX_EMBED_FIELD, '-'),
            inline: false
        });
    }

    const batchTag = Number.isInteger(options?.batchIndex) && Number.isInteger(options?.batchTotal)
        ? `일일 일괄 보고 (${options.batchIndex}/${options.batchTotal}${options.batchDate ? ` · ${options.batchDate}` : ''}) · `
        : '';

    return {
        embeds: [{
            title: clampText(
                `${isBug ? DISCORD_TEMPLATES.BUG_TITLE_PREFIX : DISCORD_TEMPLATES.SUGGESTION_TITLE_PREFIX} ${escapeDiscordMarkdown(feedback?.title || '(제목 없음)')}`,
                MAX_EMBED_TITLE
            ),
            description: clampText(`${batchTag}접수 ID: \`${sanitizeInlineCode(feedback?.feedbackId || '-')}\` · 채널: \`${sanitizeInlineCode(feedback?.channel || 'ws')}\``, MAX_EMBED_DESC),
            color: isBug ? DISCORD_COLORS.BUG : DISCORD_COLORS.SUGGESTION,
            fields,
            timestamp: embedTimestamp,
            footer: { text: isBug ? DISCORD_TEMPLATES.BUG_FOOTER : DISCORD_TEMPLATES.SUGGESTION_FOOTER }
        }]
    };
}

export async function sendErrorAlertWebhook(report, options = {}) {
    const webhookUrl = options.webhookUrl ?? process.env.DISCORD_WEBHOOK_ERROR;
    if (!isValidDiscordWebhookUrl(webhookUrl, { allowLocalTestUrl: options.allowLocalTestUrl })) {
        return { ok: false, skipped: true, reason: 'WEBHOOK_NOT_CONFIGURED' };
    }

    const now = options.now ?? Date.now();
    const throttleMs = options.throttleMs ?? ERROR_THROTTLE_MS;
    const throttleKey = `${report?.errorCode || 'ERR'}::${clampText(report?.summary, 120, '')}`;
    const prev = errorThrottleMap.get(throttleKey);

    let suppressedCount = 0;
    if (prev && throttleMs > 0 && (now - prev.lastSentAt) < throttleMs) {
        prev.suppressedCount += 1;
        return { ok: true, throttled: true, suppressedCount: prev.suppressedCount };
    }
    if (prev) {
        suppressedCount = prev.suppressedCount || 0;
    }
    errorThrottleMap.set(throttleKey, { lastSentAt: now, suppressedCount: 0 });
    if (errorThrottleMap.size > 500) {
        for (const [k, v] of errorThrottleMap.entries()) {
            if ((now - v.lastSentAt) >= throttleMs * 2) {
                errorThrottleMap.delete(k);
            }
        }
    }

    const payload = buildErrorAlertPayload(report, { suppressedCount });
    return postDiscordWebhook(webhookUrl, payload, options);
}

export async function sendDailyStatsWebhook(statsSummary, options = {}) {
    const webhookUrl = options.webhookUrl ?? process.env.DISCORD_WEBHOOK_STATS;
    const payload = buildDailyStatsPayload(statsSummary);
    return postDiscordWebhook(webhookUrl, payload, options);
}

export function sendFeedbackWebhook(feedback, options = {}) {
    const webhookUrl = options.webhookUrl ?? (
        feedback?.category === 'bug'
            ? process.env.DISCORD_WEBHOOK_BUG
            : process.env.DISCORD_WEBHOOK_SUGGESTION
    );
    const payload = buildFeedbackPayload(feedback, options);
    return postDiscordWebhook(webhookUrl, payload, options);
}

/**
 * 누적된 유저 건의 목록을 건별로 각각 독립된 디스코드 메시지로 순차 발송한다.
 * 누적 건수가 0건이면 발송을 생략한다.
 */
export async function sendSuggestionBatchWebhooks(suggestions, options = {}) {
    const list = Array.isArray(suggestions) ? suggestions : [];
    if (list.length === 0) {
        return { ok: true, skipped: true, reason: 'NO_SUGGESTIONS', sentCount: 0, total: 0, sentIds: [] };
    }

    const webhookUrl = options.webhookUrl ?? process.env.DISCORD_WEBHOOK_SUGGESTION;
    if (!isValidDiscordWebhookUrl(webhookUrl, { allowLocalTestUrl: options.allowLocalTestUrl })) {
        return { ok: false, skipped: true, reason: 'WEBHOOK_NOT_CONFIGURED', sentCount: 0, total: list.length, sentIds: [] };
    }

    const delayMs = options.delayMs !== undefined ? Math.max(0, Number(options.delayMs)) : 250;
    const sentIds = [];
    const results = [];

    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const payload = buildFeedbackPayload(item, {
            batchIndex: i + 1,
            batchTotal: list.length,
            batchDate: options.batchDate || ''
        });
        const res = await postDiscordWebhook(webhookUrl, payload, options);
        results.push({ feedbackId: item?.feedbackId || null, ...res });
        if (res?.ok && item?.feedbackId) {
            sentIds.push(item.feedbackId);
        }
        if (delayMs > 0 && i < list.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return {
        ok: sentIds.length === list.length,
        sentCount: sentIds.length,
        total: list.length,
        sentIds,
        results
    };
}

export function resetErrorThrottleCacheForTests() {
    errorThrottleMap.clear();
}
