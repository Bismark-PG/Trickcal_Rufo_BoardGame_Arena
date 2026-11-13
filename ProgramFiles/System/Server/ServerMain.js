// ProgramFiles/System/Server/ServerMain.js
// Rufo BoardGame Arena 멀티플레이 통합 서버 진입점 (HTTP + WebSocket)

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from './WebSocketServer.js';
import { LobbyServer } from './LobbyServer.js';
import { SystemLogManager } from '../Log/SystemLogManager.js';

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
                const err = new Error('PAYLOAD_TOO_LARGE');
                err.code = 'PAYLOAD_TOO_LARGE';
                reject(err);
                req.destroy();
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
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
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
    disableDiskWrite = false
} = {}) {
    if (!disableDiskWrite || logDir) {
        await SystemLogManager.initializeGameLogs('marble', { logDir }).catch(() => {});
    }

    const lobby = new LobbyServer({ logDir, disableDiskWrite });
    const server = createRealtimeServer({
        publicDir: projectRoot,
        onConnection: (client) => lobby.attachClient(client),
        onHealthCheck: ({ clientCount }) => ({
            status: 'ok',
            uptimeSec: Math.round(process.uptime()),
            ...lobby.getStats(),
            clientCount
        }),
        onHttpRequest: async (req, res, urlObj) => {
            if (urlObj.pathname !== '/api/logs/record') {
                return false;
            }
            if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
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
        port: boundPort,
        async stop() {
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
