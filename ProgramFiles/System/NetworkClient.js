// ProgramFiles/System/NetworkClient.js
// 브라우저 전용 WebSocket 실시간 통신 클라이언트 (세션 토큰 재접속 / RPC 요청 / 푸시 이벤트 / 다중 탭 제어 / 오프라인 폴백 지원)

import { ErrorTracker } from './ErrorTracker.js';
import { SystemLogManager } from './Log/SystemLogManager.js';

const STORAGE_TOKEN_KEY = 'rufo_session_token';
const STORAGE_NICK_KEY = 'rufo_nickname';
const STORAGE_CLIENT_ID_KEY = 'rufo_client_id';

function safeSessionGet(key) {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
    } catch {
        return null;
    }
}

function safeSessionSet(key, val) {
    try {
        if (typeof sessionStorage !== 'undefined' && val !== undefined && val !== null) {
            sessionStorage.setItem(key, String(val));
        }
    } catch {
        // private browsing / unavailable storage ignored
    }
}

function safeLocalGet(key) {
    try {
        return (typeof window !== 'undefined' && typeof localStorage !== 'undefined')
            ? localStorage.getItem(key)
            : null;
    } catch {
        return null;
    }
}

function safeLocalSet(key, val) {
    try {
        if (typeof window !== 'undefined' && typeof localStorage !== 'undefined' && val !== undefined && val !== null) {
            localStorage.setItem(key, String(val));
        }
    } catch {
        // private browsing / unavailable storage ignored
    }
}

function getOrCreateClientId() {
    const existing = safeLocalGet(STORAGE_CLIENT_ID_KEY);
    if (existing) return existing;
    const generated = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? `cli_${crypto.randomUUID()}`
        : `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    safeLocalSet(STORAGE_CLIENT_ID_KEY, generated);
    return generated;
}

class ArenaNetworkClient {
    constructor() {
        this.ws = null;
        this.status = 'offline'; // 'offline' | 'connecting' | 'online' | 'reconnecting'
        this.sessionToken = safeSessionGet(STORAGE_TOKEN_KEY) || '';
        this.clientId = getOrCreateClientId();
        this.playerId = null;
        this.nickname = safeSessionGet(STORAGE_NICK_KEY) || '';
        this.hasConnectedOnce = false;
        this.activeRegisteredGameId = null;
        this._reqSeq = 1;
        this._pending = new Map();
        this._listeners = new Map();
        this._connectPromise = null;
        this._reconnectAttempts = 0;
        this._desyncNotified = false;
        this._reconnectTimer = null;
        this._shouldAutoReconnect = false;
    }

    isSupportedEnvironment() {
        if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return false;
        const proto = window.location?.protocol;
        return proto === 'http:' || proto === 'https:';
    }

    getWsUrl() {
        if (!this.isSupportedEnvironment()) return null;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}`;
    }

    isOnline() {
        return this.status === 'online' && this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    getStatus() {
        return {
            status: this.status,
            isOnline: this.isOnline(),
            playerId: this.playerId,
            nickname: this.nickname
        };
    }

    setStoredNickname(nick) {
        if (nick) {
            this.nickname = nick;
            safeSessionSet(STORAGE_NICK_KEY, nick);
        }
    }

    subscribe(type, handler) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }
        this._listeners.get(type).add(handler);
        return () => {
            const set = this._listeners.get(type);
            if (set) set.delete(handler);
        };
    }

    _emit(type, payload) {
        const direct = this._listeners.get(type);
        if (direct) {
            for (const fn of Array.from(direct)) {
                try { fn(payload); } catch (e) { console.error('[NetworkClient] listener error:', e); }
            }
        }
        const wildcard = this._listeners.get('*');
        if (wildcard) {
            for (const fn of Array.from(wildcard)) {
                try { fn({ type, payload }); } catch (e) { console.error('[NetworkClient] listener error:', e); }
            }
        }
    }

    _setStatus(newStatus) {
        if (this.status === newStatus) return;
        this.status = newStatus;
        this._emit('NETWORK_STATUS', this.getStatus());
    }

    async connect({ timeoutMs = 2500 } = {}) {
        if (this.isOnline()) {
            return { online: true, playerId: this.playerId, nickname: this.nickname };
        }
        if (this._connectPromise) {
            return this._connectPromise;
        }
        const wsUrl = this.getWsUrl();
        if (!wsUrl) {
            this._setStatus('offline');
            return { online: false };
        }

        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        this._setStatus(this._shouldAutoReconnect ? 'reconnecting' : 'connecting');

        this._connectPromise = new Promise((resolve) => {
            let settled = false;
            const finish = (res) => {
                if (settled) return;
                settled = true;
                this._connectPromise = null;
                resolve(res);
            };

            let ws;
            try {
                ws = new WebSocket(wsUrl);
            } catch {
                this._setStatus('offline');
                finish({ online: false });
                return;
            }
            this.ws = ws;

            const timer = setTimeout(() => {
                if (!settled) {
                    try { ws.close(); } catch { /* ignore */ }
                    this._setStatus('offline');
                    finish({ online: false });
                }
            }, timeoutMs);

            ws.onopen = () => {
                if (this.ws !== ws) return;
                ErrorTracker.addBreadcrumb('WS_TX', 'HELLO');
                ws.send(JSON.stringify({
                    type: 'HELLO',
                    reqId: 0,
                    sessionToken: this.sessionToken || undefined,
                    clientId: this.clientId || undefined,
                    nickname: this.nickname || undefined
                }));
            };

            ws.onmessage = (evt) => {
                if (this.ws !== ws) return;
                let msg;
                try {
                    msg = JSON.parse(evt.data);
                } catch {
                    return;
                }

                if (msg.type && msg.type !== 'GAME_TIMER' && msg.type !== 'PONG') {
                    const extra = msg.type === 'RPC_RESULT'
                        ? `RPC_RESULT(${msg.ok ? 'ok' : (msg.error || 'err')})`
                        : (msg.error ? `${msg.type}:${msg.error}` : msg.type);
                    ErrorTracker.addBreadcrumb('WS_RX', extra);
                }

                if (msg.type === 'HELLO_ACK') {
                    clearTimeout(timer);
                    this.sessionToken = msg.sessionToken || this.sessionToken;
                    this.playerId = msg.playerId || this.playerId;
                    this.nickname = msg.nickname || this.nickname;
                    this.activeRegisteredGameId = msg.activeGameId || null;
                    this.hasConnectedOnce = true;
                    safeSessionSet(STORAGE_TOKEN_KEY, this.sessionToken);
                    if (this.nickname) safeSessionSet(STORAGE_NICK_KEY, this.nickname);
                    this._reconnectAttempts = 0;
                    this._desyncNotified = false;
                    this._shouldAutoReconnect = true;
                    this._setStatus('online');
                    this._emit('HELLO_ACK', msg);
                    finish({ online: true, helloAck: msg });
                    return;
                }

                if (msg.type === 'RPC_RESULT' && msg.reqId !== undefined) {
                    const entry = this._pending.get(msg.reqId);
                    if (entry) {
                        clearTimeout(entry.timer);
                        this._pending.delete(msg.reqId);
                        entry.resolve({
                            ok: Boolean(msg.ok),
                            data: msg.data || null,
                            error: msg.error || null
                        });
                    }
                    return;
                }

                if (msg.type === 'TAB_REPLACED') {
                    this.activeRegisteredGameId = null;
                }

                this._emit(msg.type, msg);
            };

            ws.onclose = () => {
                clearTimeout(timer);
                if (this.ws === ws) {
                    this.ws = null;
                }
                this._flushPendingOnDisconnect();
                if (!settled) {
                    if (!this._shouldAutoReconnect) {
                        this._setStatus('offline');
                    } else {
                        this._scheduleReconnect();
                    }
                    finish({ online: false });
                } else if (this._shouldAutoReconnect) {
                    this._scheduleReconnect();
                } else {
                    this._setStatus('offline');
                }
            };

            ws.onerror = () => {
                // handled via onclose / timeout
            };
        });

        return this._connectPromise;
    }

    _flushPendingOnDisconnect() {
        for (const [reqId, entry] of this._pending.entries()) {
            clearTimeout(entry.timer);
            entry.resolve({ ok: false, data: null, error: 'NETWORK_DISCONNECTED' });
            this._pending.delete(reqId);
        }
    }

    _scheduleReconnect() {
        if (!this._shouldAutoReconnect || this._reconnectTimer) return;
        this._setStatus('reconnecting');
        if (this.hasConnectedOnce && this._reconnectAttempts >= 3 && !this._desyncNotified) {
            this._desyncNotified = true;
            this._emit('NETWORK_RECONNECT_EXHAUSTED', { attempts: this._reconnectAttempts });
        }
        const delay = Math.min(8000, 1000 * Math.pow(2, Math.min(this._reconnectAttempts, 3)));
        this._reconnectAttempts += 1;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connect({ timeoutMs: 3000 });
        }, delay);
    }

    disconnect({ disableReconnect = true } = {}) {
        if (disableReconnect) {
            this._shouldAutoReconnect = false;
        }
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this._connectPromise = null;
        this.activeRegisteredGameId = null;
        const oldWs = this.ws;
        this.ws = null;
        if (oldWs) {
            try { oldWs.close(1000, 'Client disconnect'); } catch { /* ignore */ }
        }
        this._flushPendingOnDisconnect();
        this._setStatus('offline');
    }

    async registerGameTab(gameId, { force = false, strictTab = false } = {}) {
        if (!gameId) return { ok: false, error: 'INVALID_GAME_ID' };
        if (!this.isOnline()) {
            return { ok: true, offline: true, gameId };
        }
        const res = await this.request('REGISTER_GAME_TAB', {
            gameId,
            clientId: this.clientId,
            force: Boolean(force),
            strictTab: Boolean(strictTab || ErrorTracker.isStrictTabMode())
        });
        if (res.ok) {
            this.activeRegisteredGameId = gameId;
        }
        return res;
    }

    async unregisterGameTab() {
        this.activeRegisteredGameId = null;
        if (!this.isOnline()) {
            return { ok: true, offline: true };
        }
        return this.request('UNREGISTER_GAME_TAB', {});
    }

    async reportClientError(report) {
        if (!this.isOnline()) {
            return { ok: false, handled: false, error: 'NOT_CONNECTED' };
        }
        const res = await this.request('REPORT_CLIENT_ERROR', { report });
        return { ...res, handled: true };
    }

    async submitFeedback(rawPayload) {
        if (this.isOnline()) {
            const res = await this.request('SUBMIT_FEEDBACK', { feedback: rawPayload });
            if (res.ok) {
                return {
                    ok: true,
                    mode: 'ws',
                    feedbackId: res.data?.feedbackId || null,
                    category: res.data?.category || rawPayload?.category || null,
                    storedCount: res.data?.storedCount ?? 0
                };
            }
            if (res.error && res.error !== 'NETWORK_DISCONNECTED' && res.error !== 'NOT_CONNECTED') {
                return {
                    ok: false,
                    mode: 'ws',
                    error: res.error,
                    retryAfterMs: res.data?.retryAfterMs ?? null
                };
            }
        }
        return SystemLogManager.recordFeedback(rawPayload);
    }

    send(type, payload = {}) {
        if (!this.isOnline()) return false;
        try {
            if (type !== 'PING' && type !== 'PONG') {
                ErrorTracker.addBreadcrumb('WS_TX', type);
            }
            this.ws.send(JSON.stringify({ type, ...payload }));
            return true;
        } catch {
            return false;
        }
    }

    request(type, payload = {}, timeoutMs = 6000) {
        if (!this.isOnline()) {
            return Promise.resolve({ ok: false, data: null, error: 'NOT_CONNECTED' });
        }
        const reqId = ++this._reqSeq;
        if (type !== 'PING' && type !== 'PONG') {
            ErrorTracker.addBreadcrumb('WS_TX', type);
        }
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (this._pending.has(reqId)) {
                    this._pending.delete(reqId);
                    resolve({ ok: false, data: null, error: 'REQUEST_TIMEOUT' });
                }
            }, timeoutMs);

            this._pending.set(reqId, { resolve, timer });
            try {
                this.ws.send(JSON.stringify({ type, reqId, ...payload }));
            } catch {
                clearTimeout(timer);
                this._pending.delete(reqId);
                resolve({ ok: false, data: null, error: 'SEND_FAILED' });
            }
        });
    }
}

export const NetworkClient = new ArenaNetworkClient();
