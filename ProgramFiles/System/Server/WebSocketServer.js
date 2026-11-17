// ProgramFiles/System/Server/WebSocketServer.js
// 외부 라이브러리(ws/express 등) 없이 Node.js 내장 모듈만으로 구현한 HTTP 정적 파일 서빙 + RFC 6455 WebSocket 서버

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 256 * 1024;
const HEARTBEAT_MS = 25000;

export const MAX_WS_CONNS_PER_IP = 10;
export const MAX_WS_CONNS_PER_LOOPBACK_IP = 50;
export const MAX_WS_MSG_PER_SEC = 25;
export const WS_MSG_BURST_LIMIT = 40;
export const MAX_WS_RATE_VIOLATIONS = 3;

export const SECURITY_HEADERS = Object.freeze({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
});

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

const ALLOWED_STATIC_EXTS = {
    root: new Set(['.html', '.ico']),
    clientCode: new Set(['.js', '.mjs', '.css']),
    texture: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico']),
    audio: new Set(['.mp3', '.wav', '.ogg']),
    font: new Set(['.otf', '.ttf', '.woff', '.woff2'])
};

export function normalizeIp(rawIp) {
    const raw = String(rawIp || '').trim();
    if (!raw) return 'unknown';
    if (raw.startsWith('::ffff:')) {
        return raw.slice(7);
    }
    return raw;
}

export function isLoopbackIp(rawIp) {
    const ip = normalizeIp(rawIp);
    return ip === '127.0.0.1' || ip === '::1';
}

export function getClientIp(req, { trustProxy = false } = {}) {
    if (trustProxy) {
        const forwarded = req.headers?.['x-forwarded-for'];
        if (typeof forwarded === 'string' && forwarded.trim()) {
            const firstIp = forwarded.split(',')[0].trim();
            if (firstIp) return normalizeIp(firstIp);
        }
    }
    return normalizeIp(req.socket?.remoteAddress);
}

export function isAllowedStaticRelPath(relPath) {
    if (!relPath || relPath.includes('\\') || relPath.includes('\0')) return false;
    const segments = relPath.split('/');
    if (segments.some(seg => !seg || seg === '.' || seg === '..' || seg.startsWith('.'))) {
        return false;
    }

    const ext = path.extname(relPath).toLowerCase();
    if (relPath === 'index.html' || relPath === 'favicon.ico') {
        return ALLOWED_STATIC_EXTS.root.has(ext);
    }
    if (relPath.startsWith('ProgramFiles/')) {
        if (relPath.startsWith('ProgramFiles/System/Server/')) return false;
        return ALLOWED_STATIC_EXTS.clientCode.has(ext);
    }
    if (relPath.startsWith('Resource/Texture/')) {
        return ALLOWED_STATIC_EXTS.texture.has(ext);
    }
    if (relPath.startsWith('Resource/Audio/')) {
        return ALLOWED_STATIC_EXTS.audio.has(ext);
    }
    if (relPath.startsWith('Resource/Font/')) {
        return ALLOWED_STATIC_EXTS.font.has(ext);
    }
    return false;
}

function isOriginAllowed(req) {
    const originHeader = req.headers?.origin;
    if (originHeader === undefined) return true;
    const rawOrigin = String(originHeader).trim();
    if (!rawOrigin || rawOrigin.toLowerCase() === 'null') return false;

    const hostHeader = String(req.headers?.host || '').trim().toLowerCase();
    if (!hostHeader) return false;

    try {
        const parsedOrigin = new URL(rawOrigin);
        return parsedOrigin.host.toLowerCase() === hostHeader;
    } catch {
        return false;
    }
}

function writePlainResponse(res, statusCode, text, extraHeaders = {}) {
    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...SECURITY_HEADERS,
        ...extraHeaders
    });
    res.end(text);
}

function encodeWsFrame(opcode, payloadBuffer = Buffer.alloc(0)) {
    const len = payloadBuffer.length;
    let header;
    if (len <= 125) {
        header = Buffer.alloc(2);
        header[0] = 0x80 | opcode;
        header[1] = len;
    } else if (len <= 65535) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payloadBuffer]);
}

function tryParseWsFrame(buffer) {
    if (buffer.length < 2) return null;

    const firstByte = buffer[0];
    const secondByte = buffer[1];
    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLen = secondByte & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
        if (buffer.length < offset + 2) return null;
        payloadLen = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (payloadLen === 127) {
        if (buffer.length < offset + 8) return null;
        const bigLen = buffer.readBigUInt64BE(offset);
        if (bigLen > BigInt(MAX_FRAME_BYTES)) {
            throw new Error('FRAME_TOO_LARGE');
        }
        payloadLen = Number(bigLen);
        offset += 8;
    }

    if (payloadLen > MAX_FRAME_BYTES) {
        throw new Error('FRAME_TOO_LARGE');
    }

    let maskKey = null;
    if (masked) {
        if (buffer.length < offset + 4) return null;
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
    }

    if (buffer.length < offset + payloadLen) return null;

    const payload = Buffer.alloc(payloadLen);
    buffer.copy(payload, 0, offset, offset + payloadLen);

    if (maskKey) {
        for (let i = 0; i < payloadLen; i++) {
            payload[i] ^= maskKey[i % 4];
        }
    }

    return {
        fin,
        opcode,
        payload,
        bytesConsumed: offset + payloadLen
    };
}

export function createRealtimeServer({
    publicDir,
    onConnection,
    onHealthCheck,
    onHttpRequest = null,
    verifyOrigin = process.env.VERIFY_WS_ORIGIN !== 'false',
    trustProxy = process.env.TRUST_PROXY === 'true',
    maxConnsPerIp = MAX_WS_CONNS_PER_IP,
    maxConnsPerLoopbackIp = MAX_WS_CONNS_PER_LOOPBACK_IP,
    maxMsgPerSec = MAX_WS_MSG_PER_SEC,
    msgBurstLimit = WS_MSG_BURST_LIMIT,
    maxRateViolations = MAX_WS_RATE_VIOLATIONS
}) {
    const publicRoot = path.resolve(publicDir);
    const clients = new Set();
    const ipConnCounts = new Map();
    let connSeq = 0;

    const server = http.createServer(async (req, res) => {
        try {
            if (!req.url) {
                writePlainResponse(res, 400, 'Bad Request');
                return;
            }

            const clientIp = getClientIp(req, { trustProxy });
            const isLoopback = isLoopbackIp(clientIp);
            const urlObj = new URL(req.url, 'http://localhost');

            if (urlObj.pathname === '/health') {
                const payload = typeof onHealthCheck === 'function'
                    ? onHealthCheck({ clientCount: clients.size })
                    : { status: 'ok', clientCount: clients.size, uptimeSec: Math.round(process.uptime()) };
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store',
                    ...SECURITY_HEADERS
                });
                res.end(JSON.stringify(payload));
                return;
            }

            if (typeof onHttpRequest === 'function') {
                const handled = await onHttpRequest(req, res, urlObj, { clientIp, isLoopback });
                if (handled) return;
            }

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                writePlainResponse(res, 405, 'Method Not Allowed');
                return;
            }

            let decodedPath;
            try {
                decodedPath = decodeURIComponent(urlObj.pathname);
            } catch {
                writePlainResponse(res, 400, 'Invalid URL');
                return;
            }

            const relPath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
            if (!isAllowedStaticRelPath(relPath)) {
                writePlainResponse(res, 403, 'Forbidden');
                return;
            }

            const targetPath = path.resolve(publicRoot, relPath);
            if (targetPath !== publicRoot && !targetPath.startsWith(publicRoot + path.sep)) {
                writePlainResponse(res, 403, 'Forbidden');
                return;
            }

            let stat;
            try {
                stat = await fs.stat(targetPath);
            } catch {
                writePlainResponse(res, 404, 'Not Found');
                return;
            }

            if (!stat.isFile()) {
                writePlainResponse(res, 403, 'Forbidden');
                return;
            }

            const ext = path.extname(targetPath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            const data = await fs.readFile(targetPath);

            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-cache',
                ...SECURITY_HEADERS
            });
            if (req.method === 'HEAD') {
                res.end();
            } else {
                res.end(data);
            }
        } catch {
            if (!res.headersSent) {
                writePlainResponse(res, 500, 'Internal Server Error');
            } else {
                res.end();
            }
        }
    });

    server.on('upgrade', (req, socket) => {
        const upgradeHeader = String(req.headers.upgrade || '').toLowerCase();
        const wsKey = req.headers['sec-websocket-key'];

        if (upgradeHeader !== 'websocket' || !wsKey) {
            socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        if (verifyOrigin && !isOriginAllowed(req)) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        const clientIp = getClientIp(req, { trustProxy });
        const isLoopback = isLoopbackIp(clientIp);
        const ipLimit = isLoopback ? maxConnsPerLoopbackIp : maxConnsPerIp;
        const currentIpConns = ipConnCounts.get(clientIp) || 0;
        if (currentIpConns >= ipLimit) {
            socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        const acceptKey = crypto
            .createHash('sha1')
            .update(String(wsKey).trim() + WS_MAGIC_GUID)
            .digest('base64');

        socket.write([
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptKey}`,
            '',
            ''
        ].join('\r\n'));

        socket.setNoDelay(true);
        ipConnCounts.set(clientIp, currentIpConns + 1);

        const client = {
            connId: `ws_${++connSeq}`,
            remoteIp: clientIp,
            isLoopback,
            socket,
            isAlive: true,
            closed: false,
            sendJson(obj) {
                if (this.closed || socket.destroyed || !socket.writable) return false;
                try {
                    const textBuf = Buffer.from(JSON.stringify(obj), 'utf8');
                    socket.write(encodeWsFrame(0x1, textBuf));
                    return true;
                } catch {
                    return false;
                }
            },
            close(code = 1000, reason = '') {
                if (this.closed) return;
                this.closed = true;
                try {
                    const reasonBuf = Buffer.from(reason, 'utf8');
                    const payload = Buffer.alloc(2 + reasonBuf.length);
                    payload.writeUInt16BE(code, 0);
                    reasonBuf.copy(payload, 2);
                    if (!socket.destroyed && socket.writable) {
                        socket.write(encodeWsFrame(0x8, payload));
                    }
                } catch {
                    // ignore write failure during close
                }
                socket.end();
            }
        };

        clients.add(client);

        let rxBuffer = Buffer.alloc(0);
        let fragChunks = [];
        let fragOpcode = null;
        let rateTokens = msgBurstLimit;
        let lastTokenRefillMs = Date.now();
        let rateViolations = 0;

        let cleanedUp = false;
        const handlers = (typeof onConnection === 'function' ? onConnection(client, req) : null) || {};

        const cleanupClient = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            client.closed = true;
            clients.delete(client);
            const prevCount = ipConnCounts.get(clientIp) || 0;
            if (prevCount <= 1) {
                ipConnCounts.delete(clientIp);
            } else {
                ipConnCounts.set(clientIp, prevCount - 1);
            }
            if (typeof handlers.onClose === 'function') {
                handlers.onClose();
            }
        };

        const consumeMessageToken = () => {
            const now = Date.now();
            const elapsedSec = Math.max(0, (now - lastTokenRefillMs) / 1000);
            lastTokenRefillMs = now;
            rateTokens = Math.min(msgBurstLimit, rateTokens + elapsedSec * maxMsgPerSec);
            if (rateTokens >= 1) {
                rateTokens -= 1;
                rateViolations = 0;
                return true;
            }
            rateViolations += 1;
            return false;
        };

        socket.on('data', (chunk) => {
            client.isAlive = true;
            rxBuffer = Buffer.concat([rxBuffer, chunk]);
            if (rxBuffer.length > MAX_FRAME_BYTES * 2) {
                client.close(1009, 'Payload Too Large');
                socket.destroy();
                return;
            }

            while (rxBuffer.length > 0) {
                let frame;
                try {
                    frame = tryParseWsFrame(rxBuffer);
                } catch {
                    client.close(1009, 'Frame Too Large');
                    socket.destroy();
                    return;
                }
                if (!frame) break;
                rxBuffer = rxBuffer.subarray(frame.bytesConsumed);

                if (frame.opcode === 0x8) {
                    client.close(1000, 'Normal Closure');
                    cleanupClient();
                    return;
                }
                if (frame.opcode === 0x9) {
                    if (!socket.destroyed && socket.writable) {
                        socket.write(encodeWsFrame(0xA, frame.payload));
                    }
                    continue;
                }
                if (frame.opcode === 0xA) {
                    client.isAlive = true;
                    continue;
                }

                if (frame.opcode === 0x1 || frame.opcode === 0x2) {
                    fragOpcode = frame.opcode;
                    fragChunks = [frame.payload];
                } else if (frame.opcode === 0x0 && fragOpcode !== null) {
                    fragChunks.push(frame.payload);
                } else {
                    continue;
                }

                const totalFragBytes = fragChunks.reduce((acc, b) => acc + b.length, 0);
                if (totalFragBytes > MAX_FRAME_BYTES) {
                    client.close(1009, 'Message Too Large');
                    socket.destroy();
                    return;
                }

                if (frame.fin) {
                    const fullPayload = Buffer.concat(fragChunks);
                    const finalOpcode = fragOpcode;
                    fragChunks = [];
                    fragOpcode = null;

                    if (finalOpcode === 0x1) {
                        if (!consumeMessageToken()) {
                            client.sendJson({ type: 'ERROR', error: 'RATE_LIMITED' });
                            if (rateViolations >= maxRateViolations) {
                                client.close(1008, 'Policy Violation');
                                cleanupClient();
                                socket.destroy();
                                return;
                            }
                            continue;
                        }
                        if (typeof handlers.onMessage === 'function') {
                            try {
                                const parsed = JSON.parse(fullPayload.toString('utf8'));
                                handlers.onMessage(parsed);
                            } catch {
                                client.sendJson({ type: 'ERROR', error: 'INVALID_JSON' });
                            }
                        }
                    }
                }
            }
        });

        socket.on('end', () => {
            if (!socket.destroyed) socket.end();
            cleanupClient();
        });
        socket.on('close', cleanupClient);
        socket.on('error', cleanupClient);
    });

    const heartbeatTimer = setInterval(() => {
        for (const client of clients) {
            if (!client.isAlive) {
                client.close(1001, 'Heartbeat timeout');
                client.socket.destroy();
                continue;
            }
            client.isAlive = false;
            if (!client.socket.destroyed && client.socket.writable) {
                try {
                    client.socket.write(encodeWsFrame(0x9, Buffer.alloc(0)));
                } catch {
                    // ignore
                }
            }
        }
    }, HEARTBEAT_MS);
    heartbeatTimer.unref?.();

    return {
        httpServer: server,
        clients,
        async listen(port = 3000, host = '0.0.0.0') {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, host, () => {
                    server.off('error', reject);
                    resolve();
                });
            });
            return server.address();
        },
        async close() {
            clearInterval(heartbeatTimer);
            for (const client of Array.from(clients)) {
                client.close(1001, 'Server Shutdown');
                client.socket.destroy();
            }
            clients.clear();
            await new Promise((resolve) => server.close(() => resolve()));
        }
    };
}
