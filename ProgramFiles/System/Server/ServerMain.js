// ProgramFiles/System/Server/ServerMain.js
// Rufo BoardGame Arena 멀티플레이 통합 서버 진입점 (HTTP + WebSocket)

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from './WebSocketServer.js';
import { LobbyServer } from './LobbyServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');

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

export async function startArenaServer({ port = Number(process.env.PORT) || 3000, host = process.env.HOST || '0.0.0.0', quiet = false } = {}) {
    const lobby = new LobbyServer();
    const server = createRealtimeServer({
        publicDir: projectRoot,
        onConnection: (client) => lobby.attachClient(client),
        onHealthCheck: ({ clientCount }) => ({
            status: 'ok',
            uptimeSec: Math.round(process.uptime()),
            ...lobby.getStats(),
            clientCount
        })
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
