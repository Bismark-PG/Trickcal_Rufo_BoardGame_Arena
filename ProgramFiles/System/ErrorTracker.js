// ProgramFiles/System/ErrorTracker.js
// 아레나 전 게임 공통 5대 대표 오류 감지 · 자동 복구 · 30줄 블랙박스(Breadcrumb) · 오류 보고 전송 모듈

import { LangState } from './LanguageManager.js';
import { LobbyLang } from './Index/LobbyIndex.js';

export const ERROR_CODES = {
    ERR_SCENE_INFINITE_LOAD: 'ERR_SCENE_INFINITE_LOAD',
    ERR_RESOURCE_LOAD_FAIL: 'ERR_RESOURCE_LOAD_FAIL',
    ERR_URL_OR_ROUTE_TAMPER: 'ERR_URL_OR_ROUTE_TAMPER',
    ERR_RUNTIME_CRASH: 'ERR_RUNTIME_CRASH',
    ERR_NETWORK_DESYNC: 'ERR_NETWORK_DESYNC'
};

export const MAX_BREADCRUMBS = 30;
const MAX_FIELD_CHARS = 300;
const MAX_REPORT_BYTES = 16 * 1024;
const RECOVERY_COOLDOWN_MS = 1500;
const DEFAULT_WATCHDOG_MS = 9500;

function sanitizeStr(val, maxLen = MAX_FIELD_CHARS, fallback = '') {
    if (val === undefined || val === null) return fallback;
    const str = String(val).replace(/[\r\n\t]+/g, ' ').trim();
    if (!str) return fallback;
    return str.length > maxLen ? `${str.slice(0, maxLen - 3)}...` : str;
}

function escapeModalHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function utf8ByteLength(str) {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(str).length;
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.byteLength(str, 'utf8');
    }
    return String(str).length * 2;
}

function isRetryableResourceUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;
    return true;
}

function buildRetryUrl(src) {
    try {
        const base = (typeof window !== 'undefined' && window.location?.href)
            ? window.location.href
            : 'http://localhost/';
        const u = new URL(src, base);
        u.searchParams.set('err_retry', '1');
        return u.pathname + u.search;
    } catch {
        const sep = src.includes('?') ? '&' : '?';
        return `${src}${sep}err_retry=1`;
    }
}

export class ErrorTrackerManager {
    constructor() {
        this._breadcrumbs = [];
        this._hooks = {
            getContext: () => ({}),
            recoverToSafeScene: null,
            sendReportWs: null,
            sendReportHttp: null,
            getContainer: () => (typeof document !== 'undefined' ? document.getElementById('app') : null)
        };
        this._watchdogTimer = null;
        this._watchdogScene = null;
        this._watchdogMeta = null;
        this._listenersInstalled = false;
        this._lastRecoveryAt = 0;
        this._pendingModalReport = null;
        this._strictTabMode = false;
        this._retriedSrcMap = new WeakMap();
        this._globalRetriedUrls = new Set();
        this._onWindowError = null;
        this._onUnhandledRejection = null;
    }

    configure(hooks = {}) {
        this._hooks = { ...this._hooks, ...hooks };
    }

    init(hooks = {}) {
        this.configure(hooks);
        this.installGlobalListeners();
    }

    isStrictTabMode() {
        if (this._strictTabMode) return true;
        if (typeof window !== 'undefined' && window.location?.search) {
            try {
                const params = new URLSearchParams(window.location.search);
                const val = (params.get('strictTab') || '').trim().toLowerCase();
                if (val === '1' || val === 'true') {
                    this._strictTabMode = true;
                    return true;
                }
            } catch {
                // ignore malformed search
            }
        }
        return false;
    }

    addBreadcrumb(cat, msg, ts = Date.now()) {
        const entry = {
            ts: Number.isFinite(ts) ? ts : Date.now(),
            cat: sanitizeStr(cat, 32, 'EVENT'),
            msg: sanitizeStr(msg, MAX_FIELD_CHARS, '')
        };
        if (!entry.msg) return;
        this._breadcrumbs.push(entry);
        while (this._breadcrumbs.length > MAX_BREADCRUMBS) {
            this._breadcrumbs.shift();
        }
    }

    getBreadcrumbs(nowTs = Date.now()) {
        return this._breadcrumbs.map(item => {
            const delta = Math.max(0, Math.round(nowTs - item.ts));
            return {
                t: `-${delta}ms`,
                cat: item.cat,
                msg: item.msg
            };
        });
    }

    clearBreadcrumbs() {
        this._breadcrumbs = [];
    }

    buildErrorReport(errorCode, detail = {}) {
        const now = Date.now();
        const ctx = (typeof this._hooks.getContext === 'function' ? this._hooks.getContext() : {}) || {};
        const envUrl = (typeof window !== 'undefined' && window.location?.href)
            ? window.location.href
            : (detail.url || '');
        const viewport = (typeof window !== 'undefined')
            ? `${window.innerWidth || 0}x${window.innerHeight || 0}`
            : 'node';
        const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent)
            ? navigator.userAgent
            : 'Node.js';

        const report = {
            reportId: `err_${now}_${Math.random().toString(36).slice(2, 6)}`,
            occurredAt: new Date(now).toISOString(),
            errorCode: sanitizeStr(errorCode, 64, ERROR_CODES.ERR_RUNTIME_CRASH),
            summary: sanitizeStr(detail.summary, MAX_FIELD_CHARS, '클라이언트 오류 감지 및 자동 복구'),
            gameId: sanitizeStr(detail.gameId || ctx.gameId, 64, 'arena'),
            scene: sanitizeStr(detail.scene || ctx.scene, 64, 'unknown'),
            roomCode: (detail.roomCode || ctx.roomCode)
                ? sanitizeStr(detail.roomCode || ctx.roomCode, 32, '')
                : null,
            isOnline: Boolean(detail.isOnline ?? ctx.isOnline),
            playerId: (detail.playerId || ctx.playerId)
                ? sanitizeStr(detail.playerId || ctx.playerId, 64, '')
                : null,
            clientEnv: {
                url: sanitizeStr(envUrl, MAX_FIELD_CHARS, ''),
                viewport: sanitizeStr(viewport, 64, ''),
                userAgent: sanitizeStr(userAgent, MAX_FIELD_CHARS, '')
            },
            errorDetail: {
                message: sanitizeStr(detail.message, MAX_FIELD_CHARS, ''),
                failedUrl: detail.failedUrl ? sanitizeStr(detail.failedUrl, MAX_FIELD_CHARS, '') : null,
                stack: sanitizeStr(detail.stack, MAX_FIELD_CHARS, '')
            },
            breadcrumbs: this.getBreadcrumbs(now)
        };

        // 16KB 상한 초과 시 breadcrumbs부터 안전하게 축소
        while (utf8ByteLength(JSON.stringify(report)) > MAX_REPORT_BYTES && report.breadcrumbs.length > 0) {
            report.breadcrumbs.shift();
        }
        return report;
    }

    inspectAndSanitizeInitialUrl() {
        if (typeof window === 'undefined' || !window.location) {
            return { tampered: false };
        }
        const pathname = window.location.pathname || '/';
        const search = window.location.search || '';
        const hash = window.location.hash || '';

        let hasUnauthorizedQuery = false;
        if (search) {
            try {
                const params = new URLSearchParams(search);
                for (const [key, val] of params.entries()) {
                    if (key === 'strictTab') {
                        const norm = String(val).trim().toLowerCase();
                        if (norm === '1' || norm === 'true') {
                            this._strictTabMode = true;
                        } else {
                            hasUnauthorizedQuery = true;
                        }
                    } else {
                        hasUnauthorizedQuery = true;
                    }
                }
            } catch {
                hasUnauthorizedQuery = true;
            }
        }

        const allowedPath = pathname === '/' || pathname === '/index.html';
        const hasTamperedHash = Boolean(hash && hash !== '#');
        const tampered = !allowedPath || hasUnauthorizedQuery || hasTamperedHash;

        if (!tampered) {
            return { tampered: false, strictTab: this._strictTabMode };
        }

        const rawUrl = `${pathname}${search}${hash}`;
        this.addBreadcrumb('WARN', `URL sanitized from ${rawUrl}`);
        if (typeof window.history?.replaceState === 'function') {
            try {
                window.history.replaceState(null, '', '/');
            } catch {
                // ignore history errors
            }
        }

        const report = this.buildErrorReport(ERROR_CODES.ERR_URL_OR_ROUTE_TAMPER, {
            summary: '비정상 URL 경로/파라미터가 감지되어 기본 주소로 정화되었습니다.',
            message: `Invalid initial URL: ${rawUrl}`,
            scene: 'boot'
        });
        this._pendingModalReport = report;
        return { tampered: true, strictTab: this._strictTabMode, report };
    }

    startTransitionWatchdog(targetScene, options = {}) {
        this.clearTransitionWatchdog();
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_WATCHDOG_MS;
        this._watchdogScene = targetScene;
        this._watchdogMeta = {
            gameId: options.gameId || null,
            reason: options.reason || ''
        };
        this.addBreadcrumb('SCENE', `Watchdog armed for ${targetScene} (${timeoutMs}ms)`);

        this._watchdogTimer = setTimeout(() => {
            const expiredScene = this._watchdogScene;
            const meta = this._watchdogMeta || {};
            this._watchdogTimer = null;
            this._watchdogScene = null;
            this._watchdogMeta = null;

            this.addBreadcrumb('WARN', `Watchdog expired: ${expiredScene} (${timeoutMs}ms)`);
            this.triggerRecovery(ERROR_CODES.ERR_SCENE_INFINITE_LOAD, {
                summary: `${expiredScene} 화면 전환이 ${Math.round(timeoutMs / 1000)}초 이상 응답하지 않아 로비로 복구했습니다.`,
                message: `Scene transition watchdog timeout (${timeoutMs}ms) waiting for ${expiredScene}`,
                gameId: meta.gameId,
                scene: expiredScene
            });
        }, timeoutMs);
    }

    markTransitionComplete(expectedScene = null) {
        if (!this._watchdogTimer) return false;
        if (expectedScene && this._watchdogScene && this._watchdogScene !== expectedScene) {
            return false;
        }
        const doneScene = this._watchdogScene;
        this.clearTransitionWatchdog();
        this.addBreadcrumb('SCENE', `Transition ready: ${doneScene || expectedScene || 'unknown'}`);
        return true;
    }

    clearTransitionWatchdog() {
        if (this._watchdogTimer) {
            clearTimeout(this._watchdogTimer);
            this._watchdogTimer = null;
        }
        this._watchdogScene = null;
        this._watchdogMeta = null;
    }

    reportRouteTamper(sceneName, detail = '') {
        this.addBreadcrumb('WARN', `Invalid route attempt: ${sceneName} (${detail})`);
        if (typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
            try {
                if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
                    window.history.replaceState(null, '', '/');
                }
            } catch {
                // ignore
            }
        }
        return this.triggerRecovery(ERROR_CODES.ERR_URL_OR_ROUTE_TAMPER, {
            summary: '유효하지 않은 씬 경로 또는 세션 없는 직접 진입이 차단되었습니다.',
            message: `Blocked route '${sceneName}': ${detail}`,
            scene: String(sceneName || 'unknown'),
            preferMenu: true
        });
    }

    reportNetworkDesync({ reason = 'NETWORK_DESYNC', message = '', gameId = null, scene = null } = {}) {
        this.addBreadcrumb('WARN', `Network desync: ${reason} ${message}`);
        return this.triggerRecovery(ERROR_CODES.ERR_NETWORK_DESYNC, {
            summary: '서버와의 연결 또는 방 상태 동기화가 끊어져 대기실로 안전 복귀했습니다.',
            message: message || reason,
            gameId,
            scene
        });
    }

    trackImage(img, { critical = false, label = 'Image', onFallback = null, onFatal = null } = {}) {
        if (!img || typeof img !== 'object') return img;
        if (img._errTrackerBound) return img;
        img._errTrackerBound = true;

        img.addEventListener('error', () => {
            const rawSrc = img.getAttribute?.('src') || img.src || '';
            const cleanSrc = rawSrc.replace(/[?&]err_retry=1(&|$)/, '$1').replace(/[?&]$/, '');
            const retryKey = cleanSrc || rawSrc;
            const triedSrc = this._retriedSrcMap.get(img);

            if (isRetryableResourceUrl(rawSrc) && triedSrc !== retryKey && !rawSrc.includes('err_retry=1')) {
                this._retriedSrcMap.set(img, retryKey);
                this.addBreadcrumb('RESOURCE', `Retry ${label}: ${cleanSrc}`);
                img.src = buildRetryUrl(rawSrc);
                return;
            }

            this.addBreadcrumb('RESOURCE', `Load failed (${label}): ${cleanSrc}`);
            if (typeof onFallback === 'function') {
                try { onFallback(img, cleanSrc); } catch { /* ignore */ }
            }
            if (critical) {
                if (typeof onFatal === 'function') {
                    try { onFatal(img, cleanSrc); } catch { /* ignore */ }
                }
                this.triggerRecovery(ERROR_CODES.ERR_RESOURCE_LOAD_FAIL, {
                    summary: `필수 게임 리소스(${label})를 불러오지 못해 로비로 복구했습니다.`,
                    message: `Critical resource failed: ${label}`,
                    failedUrl: cleanSrc
                });
            }
        });
        return img;
    }

    trackAudio(audio, { label = 'Audio' } = {}) {
        if (!audio || typeof audio !== 'object' || audio._errTrackerBound) return audio;
        audio._errTrackerBound = true;
        if (typeof audio.addEventListener === 'function') {
            audio.addEventListener('error', () => {
                const rawSrc = audio.currentSrc || audio.src || '';
                this.addBreadcrumb('RESOURCE', `Audio load failed (${label}): ${rawSrc}`);
            });
        }
        return audio;
    }

    installGlobalListeners() {
        if (this._listenersInstalled || typeof window === 'undefined') return;
        this._listenersInstalled = true;

        this._onWindowError = (event) => {
            const target = event?.target;
            if (target && target !== window && typeof target.tagName === 'string') {
                const tag = target.tagName.toUpperCase();
                if (tag === 'IMG' || tag === 'AUDIO' || tag === 'SCRIPT' || tag === 'LINK') {
                    const failedUrl = target.src || target.href || '';
                    if ((tag === 'IMG' || tag === 'AUDIO') && isRetryableResourceUrl(failedUrl) && !this._globalRetriedUrls.has(failedUrl)) {
                        this._globalRetriedUrls.add(failedUrl);
                        this.addBreadcrumb('RESOURCE', `Retry <${tag.toLowerCase()}>: ${failedUrl}`);
                        if (tag === 'IMG') target.src = buildRetryUrl(failedUrl);
                        else target.src = buildRetryUrl(failedUrl);
                        return;
                    }

                    this.addBreadcrumb('RESOURCE', `<${tag.toLowerCase()}> failed: ${failedUrl}`);
                    if (tag === 'IMG') {
                        target.style.opacity = '0.25';
                    }
                    const isSameOriginScript = (() => {
                        if (tag !== 'SCRIPT' || !failedUrl || typeof window === 'undefined') return false;
                        try {
                            return new URL(failedUrl, window.location.href).origin === window.location.origin;
                        } catch {
                            return false;
                        }
                    })();
                    const isCritical = isSameOriginScript || target.dataset?.critical === 'true';
                    if (isCritical) {
                        this.triggerRecovery(ERROR_CODES.ERR_RESOURCE_LOAD_FAIL, {
                            summary: '필수 실행 리소스 로드에 실패하여 안전 화면으로 복구했습니다.',
                            message: `Critical <${tag.toLowerCase()}> failed to load`,
                            failedUrl
                        });
                    }
                    return;
                }
            }

            const errObj = event?.error;
            const message = event?.message || errObj?.message || 'Uncaught script error';
            const stack = errObj?.stack || `${event?.filename || ''}:${event?.lineno || 0}:${event?.colno || 0}`;
            this.addBreadcrumb('ERROR', `Runtime error: ${message}`);
            this.triggerRecovery(ERROR_CODES.ERR_RUNTIME_CRASH, {
                summary: '예기치 않은 스크립트 오류가 발생해 안전 화면으로 복구했습니다.',
                message,
                stack
            });
        };

        this._onUnhandledRejection = (event) => {
            const reason = event?.reason;
            if (reason && typeof reason === 'object' && reason.name === 'AbortError') {
                return;
            }
            const message = (reason && typeof reason === 'object')
                ? (reason.message || String(reason))
                : String(reason || 'Unhandled promise rejection');
            const stack = (reason && typeof reason === 'object' && reason.stack) ? reason.stack : '';

            this.addBreadcrumb('ERROR', `Unhandled rejection: ${message}`);
            this.triggerRecovery(ERROR_CODES.ERR_RUNTIME_CRASH, {
                summary: '비동기 처리 중 오류가 발생해 안전 화면으로 복구했습니다.',
                message,
                stack
            });
        };

        window.addEventListener('error', this._onWindowError, true);
        window.addEventListener('unhandledrejection', this._onUnhandledRejection);
    }

    uninstallGlobalListeners() {
        if (!this._listenersInstalled || typeof window === 'undefined') return;
        if (this._onWindowError) {
            window.removeEventListener('error', this._onWindowError, true);
        }
        if (this._onUnhandledRejection) {
            window.removeEventListener('unhandledrejection', this._onUnhandledRejection);
        }
        this._listenersInstalled = false;
    }

    triggerRecovery(errorCode, detail = {}) {
        const now = Date.now();
        if (now - this._lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
            return null;
        }
        this._lastRecoveryAt = now;
        this.clearTransitionWatchdog();

        const report = this.buildErrorReport(errorCode, detail);
        this._pendingModalReport = report;

        if (typeof this._hooks.recoverToSafeScene === 'function') {
            try {
                this._hooks.recoverToSafeScene(errorCode, report, detail);
            } catch (err) {
                console.error('[ErrorTracker] recoverToSafeScene failed:', err);
            }
        }

        this.flushPendingModal();
        return report;
    }

    consumePendingModalReport() {
        const rep = this._pendingModalReport;
        this._pendingModalReport = null;
        return rep;
    }

    flushPendingModal(container = null) {
        if (!this._pendingModalReport || typeof document === 'undefined') return false;
        const targetContainer = container || this._hooks.getContainer?.();
        if (!targetContainer) return false;
        const report = this.consumePendingModalReport();
        this.showErrorReportModal(targetContainer, report);
        return true;
    }

    async sendErrorReport(report) {
        if (!report) return { ok: false, error: 'INVALID_ERROR_REPORT' };
        if (typeof this._hooks.sendReportWs === 'function') {
            try {
                const wsRes = await this._hooks.sendReportWs(report);
                if (wsRes && wsRes.handled) {
                    return wsRes;
                }
            } catch {
                // fallback to HTTP
            }
        }
        if (typeof this._hooks.sendReportHttp === 'function') {
            try {
                return await this._hooks.sendReportHttp(report);
            } catch {
                return { ok: false, error: 'ERROR_REPORT_SEND_FAILED' };
            }
        }
        return { ok: false, error: 'OFFLINE_NO_SERVER' };
    }

    showErrorReportModal(container, report) {
        if (!container || !report || typeof document === 'undefined') return;
        const existing = container.querySelector('#modal-arena-error-report');
        if (existing) existing.remove();

        const text = LobbyLang[LangState.current] || LobbyLang.ko;
        const title = text.ERR_MODAL_TITLE || '오류 복구 및 보고 안내';
        const desc = text.ERR_MODAL_DESC || '문제가 감지되어 안전한 화면으로 복구되었습니다.\n원인 분석을 위해 아래 오류 보고서를 개발자에게 전송할 수 있습니다.';
        const codeLabel = text.ERR_MODAL_CODE_LABEL || '오류 코드';
        const sendLabel = text.ERR_MODAL_BTN_SEND || '오류 보고 전송';
        const closeLabel = text.ERR_MODAL_BTN_CLOSE || '닫기';

        const modal = document.createElement('div');
        modal.id = 'modal-arena-error-report';
        modal.style.cssText = 'position: absolute; inset: 0; background: rgba(34, 16, 6, 0.70); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 12000; padding: 24px; box-sizing: border-box;';
        modal.innerHTML = `
            <div style="width: 650px; max-width: 92vw; background: linear-gradient(180deg, #8F542B 0%, #6E3D1E 100%); border: 4px solid #4E2812; border-radius: 26px; padding: 12px; box-shadow: 0 22px 54px rgba(32, 14, 5, 0.62); font-family: inherit; box-sizing: border-box;">
                <div style="background: linear-gradient(180deg, #FFF9EB 0%, #F7E7C4 100%); border: 3px solid #C9965B; border-radius: 18px; padding: 28px 32px; color: #3D2010; box-shadow: inset 0 2px 8px rgba(105, 57, 29, 0.12); box-sizing: border-box;">
                    <h2 style="margin: 0 0 12px 0; font-size: 28px; font-weight: 900; color: #B84214;">🚨 ${escapeModalHtml(title)}</h2>
                    <p style="margin: 0 0 18px 0; font-size: 17px; line-height: 1.6; color: #4E2812; font-weight: 700; white-space: pre-line; word-break: keep-all;">${escapeModalHtml(desc)}</p>
                    <div style="background: rgba(255, 255, 255, 0.72); border: 2px dashed #CFA067; border-radius: 14px; padding: 14px 18px; margin-bottom: 18px; font-size: 15px; line-height: 1.55;">
                        <div style="color: #8A4A18; font-weight: 900; margin-bottom: 6px;">${escapeModalHtml(codeLabel)}: <code style="background: #FFE3DD; color: #9E2710; border: 1px solid #E5A092; padding: 2px 8px; border-radius: 8px; font-weight: 900;">${escapeModalHtml(report.errorCode)}</code></div>
                        <div style="color: #5D361A; font-weight: 700; word-break: break-word;">${escapeModalHtml(report.summary)}</div>
                    </div>
                    <div id="err-report-status" style="min-height: 24px; margin-bottom: 14px; font-size: 15px; font-weight: 900; color: #8A562C; text-align: center;"></div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button id="btn-err-report-close" type="button" style="font-family: inherit; padding: 11px 22px; font-size: 17px; font-weight: 900; background: linear-gradient(180deg, #8F542B 0%, #6E3D1E 100%); color: #FFF8EE; border: 2px solid #4E2812; border-radius: 14px; cursor: pointer; box-shadow: 0 4px 10px rgba(46, 22, 8, 0.25);">${escapeModalHtml(closeLabel)}</button>
                        <button id="btn-err-report-send" type="button" style="font-family: inherit; padding: 11px 26px; font-size: 17px; font-weight: 900; background: linear-gradient(135deg, #F38221, #D95318); color: #FFFFFF; border: 2px solid #FFE4AC; border-radius: 14px; cursor: pointer; box-shadow: 0 4px 12px rgba(217, 83, 24, 0.35);">${escapeModalHtml(sendLabel)}</button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(modal);

        const statusEl = modal.querySelector('#err-report-status');
        const closeBtn = modal.querySelector('#btn-err-report-close');
        const sendBtn = modal.querySelector('#btn-err-report-send');

        if (closeBtn) {
            closeBtn.onclick = () => {
                if (modal.parentNode) modal.remove();
            };
        }

        if (sendBtn) {
            sendBtn.onclick = async () => {
                sendBtn.disabled = true;
                sendBtn.style.opacity = '0.65';
                if (statusEl) statusEl.innerText = text.ERR_MODAL_SENDING || '오류 보고서를 전송하는 중...';

                const res = await this.sendErrorReport(report);
                if (res && res.ok) {
                    if (statusEl) {
                        statusEl.style.color = '#2ecc71';
                        statusEl.innerText = text.ERR_MODAL_SENT_OK || '✅ 오류 보고서가 정상 접수되었습니다. 감사합니다!';
                    }
                    sendBtn.style.display = 'none';
                    return;
                }

                if (res?.error === 'ERROR_REPORT_RATE_LIMITED') {
                    if (statusEl) {
                        statusEl.style.color = '#f39c12';
                        statusEl.innerText = text.ERR_MODAL_RATE_LIMITED || '⏳ 잠시 후 다시 시도해 주세요. (1분당 최대 2회 전송 가능)';
                    }
                } else {
                    if (statusEl) {
                        statusEl.style.color = '#ff7675';
                        statusEl.innerText = text.ERR_MODAL_SEND_FAIL || '⚠️ 서버에 연결할 수 없어 전송하지 못했습니다.';
                    }
                }
                sendBtn.disabled = false;
                sendBtn.style.opacity = '1';
            };
        }
    }
}

export const ErrorTracker = new ErrorTrackerManager();
