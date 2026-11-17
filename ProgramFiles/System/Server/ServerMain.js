// ProgramFiles/System/Server/ServerMain.js
// Rufo BoardGame Arena 멀티플레이 통합 서버 진입점 (HTTP + WebSocket)

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer, SECURITY_HEADERS, isLoopbackIp } from './WebSocketServer.js';
import {
    LobbyServer,
    ERROR_REPORT_WINDOW_MS,
    ERROR_REPORT_MAX_PER_WINDOW,
    consumeFeedbackQuota
} from './LobbyServer.js';
import {
    SystemLogManager,
    MAX_ERROR_REPORT_BYTES,
    MAX_FEEDBACK_BYTES
} from '../Log/SystemLogManager.js';
import {
    loadEnvFile,
    sendErrorAlertWebhook,
    sendFeedbackWebhook
} from './DiscordWebhook.js';
import { DailyStatsCollector } from './DailyStatsCollector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');
const MAX_LOG_BODY_BYTES = 512 * 1024;

function readRequestBodyJson(req, maxBytes = MAX_LOG_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let settled = false;

        req.on('data', (chunk) => {
            if (settled) return;
            total += chunk.length;
            if (total > maxBytes) {
                settled = true;
                req.pause();
                const err = new Error('PAYLOAD_TOO_LARGE');
                err.code = 'PAYLOAD_TOO_LARGE';
                reject(err);
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (settled) return;
            settled = true;
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                const parsed = raw ? JSON.parse(raw) : {};
                resolve(parsed);
            } catch {
                const err = new Error('INVALID_JSON');
                err.code = 'INVALID_JSON';
                reject(err);
            }
        });

        req.on('error', (err) => {
            if (settled) return;
            settled = true;
            reject(err);
        });
    });
}

function sendJson(res, statusCode, payload) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...SECURITY_HEADERS
    };
    if (statusCode === 413) {
        headers.Connection = 'close';
    }
    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(payload));
}

function consumeIpErrorReportQuota(rateMap, ip, now = Date.now()) {
    const key = String(ip || 'unknown');
    const prev = rateMap.get(key) || [];
    const active = prev.filter(ts => (now - ts) < ERROR_REPORT_WINDOW_MS);
    if (active.length >= ERROR_REPORT_MAX_PER_WINDOW) {
        rateMap.set(key, active);
        return false;
    }
    active.push(now);
    rateMap.set(key, active);
    if (rateMap.size > 2000) {
        for (const [k, list] of rateMap.entries()) {
            const valid = list.filter(ts => (now - ts) < ERROR_REPORT_WINDOW_MS);
            if (valid.length === 0) rateMap.delete(k);
            else rateMap.set(k, valid);
        }
    }
    return true;
}

function getLanAddresses() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const items of Object.values(interfaces)) {
        if (!Array.isArray(items)) continue;
        for (const info of items) {
            if (info.family === 'IPv4' && !info.internal) {
                ips.push(info.address);
            }
        }
    }
    return ips;
}

export async function startArenaServer({
    port = Number(process.env.PORT) || 3000,
    host = process.env.HOST || '0.0.0.0',
    quiet = false,
    logDir = null,
    errorLogDir = null,
    feedbackLogDir = null,
    statsDir = null,
    disableDiskWrite = false,
    skipWebhook = false,
    webhookOptions = {},
    allowExternalLogApi = process.env.ALLOW_EXTERNAL_LOG_API === 'true',
    allowMultiTabTest = process.env.ALLOW_MULTI_TAB_TEST === 'true',
    verifyOrigin = process.env.VERIFY_WS_ORIGIN !== 'false',
    trustProxy = process.env.TRUST_PROXY === 'true'
} = {}) {
    loadEnvFile(path.join(projectRoot, '.env'));

    if (!disableDiskWrite || logDir) {
        await SystemLogManager.initializeGameLogs('marble', { logDir }).catch(() => {});
    }

    const statsCollector = new DailyStatsCollector({
        statsDir,
        disableDiskWrite,
        webhookOptions,
        ...(skipWebhook
            ? {
                webhookSender: async () => ({ ok: false, skipped: true }),
                suggestionBatchSender: async () => ({ ok: false, skipped: true, sentCount: 0, sentIds: [] })
            }
            : {})
    });
    await statsCollector.init();

    SystemLogManager.setServerHooks({
        onErrorRecorded: (report, hookOpts = {}) => {
            statsCollector.recordErrorReport();
            if (!skipWebhook && !hookOpts.skipWebhook) {
                sendErrorAlertWebhook(report, hookOpts.webhookOptions || webhookOptions).catch(() => {});
            }
        },
        onFeedbackRecorded: (feedback, hookOpts = {}) => {
            statsCollector.recordFeedback(feedback.category);
            if (feedback.category === 'bug') {
                if (!skipWebhook && !hookOpts.skipWebhook) {
                    sendFeedbackWebhook(feedback, hookOpts.webhookOptions || webhookOptions).catch(() => {});
                }
            } else if (feedback.category === 'suggestion') {
                statsCollector.recordSuggestion(feedback);
            }
        }
    });

    const errorApiRateMap = new Map();
    const feedbackIpRateMap = new Map();
    const lobby = new LobbyServer({
        logDir,
        errorLogDir,
        feedbackLogDir,
        disableDiskWrite,
        skipWebhook,
        statsCollector,
        allowMultiTabTest
    });
    const server = createRealtimeServer({
        publicDir: projectRoot,
        verifyOrigin,
        trustProxy,
        onConnection: (client) => {
            statsCollector.updatePeakClients(Math.max(1, server?.clients?.size || 1));
            return lobby.attachClient(client);
        },
        onHealthCheck: ({ clientCount }) => ({
            status: 'ok',
            uptimeSec: Math.round(process.uptime()),
            ...lobby.getStats(),
            clientCount
        }),
        onHttpRequest: async (req, res, urlObj, reqMeta = {}) => {
            if (urlObj.pathname === '/api/logs/record') {
                if (req.method !== 'POST') {
                    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
                    return true;
                }
                const clientIp = reqMeta.clientIp || req.socket?.remoteAddress || '';
                const isLocal = typeof reqMeta.isLoopback === 'boolean'
                    ? reqMeta.isLoopback
                    : isLoopbackIp(clientIp);
                if (!isLocal && !allowExternalLogApi) {
                    sendJson(res, 403, { ok: false, error: 'EXTERNAL_LOG_WRITE_FORBIDDEN' });
                    return true;
                }
                try {
                    const body = await readRequestBodyJson(req, MAX_LOG_BODY_BYTES);
                    const gameId = typeof body?.gameId === 'string' && body.gameId.trim()
                        ? body.gameId.trim()
                        : 'marble';
                    const matchData = body?.matchData || null;
                    if (!matchData) {
                        sendJson(res, 400, { ok: false, error: 'MISSING_MATCH_DATA' });
                        return true;
                    }
                    if (disableDiskWrite && !logDir) {
                        sendJson(res, 200, { ok: true, skippedDiskWrite: true, cycleCount: 0 });
                        return true;
                    }
                    const result = await SystemLogManager.recordGameResult(gameId, matchData, { logDir });
                    sendJson(res, result.ok ? 200 : 400, result);
                } catch (err) {
                    const status = err?.code === 'PAYLOAD_TOO_LARGE' ? 413 : (err?.code === 'INVALID_JSON' ? 400 : 500);
                    sendJson(res, status, { ok: false, error: err?.code || 'LOG_RECORD_FAILED' });
                }
                return true;
            }

            if (urlObj.pathname === '/api/logs/error') {
                if (req.method !== 'POST') {
                    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
                    return true;
                }
                const clientIp = reqMeta.clientIp || req.socket?.remoteAddress || 'unknown';
                try {
                    const body = await readRequestBodyJson(req, MAX_ERROR_REPORT_BYTES);
                    const precheck = SystemLogManager.normalizeErrorReport(body, { channel: 'http' });
                    if (!precheck.ok) {
                        const errStatus = precheck.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
                        sendJson(res, errStatus, precheck);
                        return true;
                    }
                    if (!consumeIpErrorReportQuota(errorApiRateMap, clientIp)) {
                        sendJson(res, 429, { ok: false, error: 'ERROR_REPORT_RATE_LIMITED' });
                        return true;
                    }
                    const result = await SystemLogManager.recordClientError(body, {
                        errorLogDir: errorLogDir || logDir || null,
                        disableDiskWrite,
                        skipWebhook,
                        webhookOptions,
                        serverContext: {
                            channel: 'http'
                        }
                    });
                    const status = result.ok ? 200 : (result.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400);
                    sendJson(res, status, result);
                } catch (err) {
                    const status = err?.code === 'PAYLOAD_TOO_LARGE' ? 413 : (err?.code === 'INVALID_JSON' ? 400 : 500);
                    sendJson(res, status, { ok: false, error: err?.code || 'ERROR_REPORT_FAILED' });
                }
                return true;
            }

            if (urlObj.pathname === '/api/feedback') {
                if (req.method !== 'POST') {
                    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
                    return true;
                }
                const clientIp = reqMeta.clientIp || req.socket?.remoteAddress || 'unknown';
                try {
                    const body = await readRequestBodyJson(req, MAX_FEEDBACK_BYTES);
                    const precheck = SystemLogManager.normalizeFeedbackPayload(body, { channel: 'http' });
                    if (!precheck.ok) {
                        const errStatus = precheck.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
                        sendJson(res, errStatus, precheck);
                        return true;
                    }
                    const quota = consumeFeedbackQuota(feedbackIpRateMap.get(clientIp));
                    feedbackIpRateMap.set(clientIp, quota.timestamps);
                    if (feedbackIpRateMap.size > 2000) {
                        for (const [k, list] of feedbackIpRateMap.entries()) {
                            if (list.length === 0) feedbackIpRateMap.delete(k);
                        }
                    }
                    if (!quota.allowed) {
                        sendJson(res, 429, {
                            ok: false,
                            error: 'FEEDBACK_RATE_LIMITED',
                            retryAfterMs: quota.retryAfterMs
                        });
                        return true;
                    }

                    const result = await SystemLogManager.recordFeedback(body, {
                        feedbackLogDir: feedbackLogDir || logDir || null,
                        disableDiskWrite,
                        skipWebhook,
                        webhookOptions,
                        serverContext: {
                            channel: 'http'
                        }
                    });
                    const status = result.ok ? 200 : (result.error === 'PAYLOAD_TOO_LARGE' ? 413 : 400);
                    sendJson(res, status, result);
                } catch (err) {
                    const status = err?.code === 'PAYLOAD_TOO_LARGE' ? 413 : (err?.code === 'INVALID_JSON' ? 400 : 500);
                    sendJson(res, status, { ok: false, error: err?.code || 'FEEDBACK_SEND_FAILED' });
                }
                return true;
            }

            if (urlObj.pathname === '/api/admin/stats/flush' || urlObj.pathname === '/api/admin/suggestions/flush') {
                if (req.method !== 'POST') {
                    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
                    return true;
                }
                const clientIp = reqMeta.clientIp || req.socket?.remoteAddress || '';
                const isLocal = typeof reqMeta.isLoopback === 'boolean'
                    ? reqMeta.isLoopback
                    : isLoopbackIp(clientIp);
                if (!isLocal) {
                    sendJson(res, 403, { ok: false, error: 'ADMIN_FORBIDDEN' });
                    return true;
                }
                const flushRes = urlObj.pathname === '/api/admin/suggestions/flush'
                    ? await statsCollector.flushSuggestionsNowToWebhook()
                    : await statsCollector.flushNowToWebhook();
                sendJson(res, 200, flushRes);
                return true;
            }

            return false;
        }
    });

    const address = await server.listen(port, host);
    const boundPort = typeof address === 'object' && address ? address.port : port;

    if (!quiet) {
        console.log('======================================================');
        console.log(' Rufo BoardGame Arena Multiplayer Server Started');
        console.log(` - Local : http://localhost:${boundPort}`);
        for (const ip of getLanAddresses()) {
            console.log(` - LAN   : http://${ip}:${boundPort}`);
        }
        console.log(` - Health: http://localhost:${boundPort}/health`);
        console.log('======================================================');
    }

    return {
        server,
        lobby,
        statsCollector,
        port: boundPort,
        async stop() {
            SystemLogManager.setServerHooks({ onErrorRecorded: null, onFeedbackRecorded: null });
            await statsCollector.stop();
            lobby.destroy();
            await server.close();
        }
    };
}

const isDirectEntry = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectEntry) {
    let instance = null;
    startArenaServer().then((srv) => {
        instance = srv;
    }).catch((err) => {
        console.error('[ServerMain] Failed to start server:', err);
        process.exit(1);
    });

    const shutdown = async () => {
        if (instance) {
            await instance.stop();
        }
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
