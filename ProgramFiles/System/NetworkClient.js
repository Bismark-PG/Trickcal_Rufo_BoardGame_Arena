// ProgramFiles/System/NetworkClient.js
// 브라우저 전용 WebSocket 실시간 통신 클라이언트 (세션 토큰 재접속 / RPC 요청 / 푸시 이벤트 / 오프라인 폴백 지원)

const STORAGE_TOKEN_KEY = 'rufo_session_token';
const STORAGE_NICK_KEY = 'rufo_nickname';

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

class ArenaNetworkClient {
    constructor() {
        this.ws = null;
        this.status = 'offline'; // 'offline' | 'connecting' | 'online' | 'reconnecting'
        this.sessionToken = safeSessionGet(STORAGE_TOKEN_KEY) || '';
        this.playerId = null;
        this.nickname = safeSessionGet(STORAGE_NICK_KEY) || '';
        this._reqSeq = 1;
        this._pending = new Map();
        this._listeners = new Map();
        this._connectPromise = null;
        this._reconnectAttempts = 0;
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
                ws.send(JSON.stringify({
                    type: 'HELLO',
                    reqId: 0,
                    sessionToken: this.sessionToken || undefined,
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

                if (msg.type === 'HELLO_ACK') {
                    clearTimeout(timer);
                    this.sessionToken = msg.sessionToken || this.sessionToken;
                    this.playerId = msg.playerId || this.playerId;
                    this.nickname = msg.nickname || this.nickname;
                    safeSessionSet(STORAGE_TOKEN_KEY, this.sessionToken);
                    if (this.nickname) safeSessionSet(STORAGE_NICK_KEY, this.nickname);
                    this._reconnectAttempts = 0;
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
        const delay = Math.min(8000, 1000 * Math.pow(2, Math.min(this._reconnectAttempts, 3)));
        this._reconnectAttempts += 1;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connect({ timeoutMs: 3000 });
        }, delay);
    }

    send(type, payload = {}) {
        if (!this.isOnline()) return false;
        try {
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
