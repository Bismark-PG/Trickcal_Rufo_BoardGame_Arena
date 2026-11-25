import { ErrorTracker } from './ErrorTracker.js';

const hasAudio = typeof Audio !== 'undefined';
const bgm = hasAudio ? new Audio() : { volume: 0.5, paused: true, src: '', loop: true, play: async () => {} };
bgm.volume = 0.5;
if (hasAudio) {
    ErrorTracker.trackAudio(bgm, { label: 'BGM' });
}

export const AudioManager = {
    bgmPlayer: bgm,
    sfxVolume: 0.5,
    currentTrack: null,

    playBGM(path) {
        if (!hasAudio) return;
        if (this.currentTrack === path) {
            if (this.bgmPlayer.paused) {
                this.bgmPlayer.play().catch(() => {});
            }
            return;
        }
        this.currentTrack = path;
        this.bgmPlayer.src = path;
        this.bgmPlayer.loop = true;
        this.bgmPlayer.play().catch(e => console.log("자동재생 대기중..."));
    },
    
    setBGMVolume(val) { this.bgmPlayer.volume = val; },
    setSFXVolume(val) { this.sfxVolume = val; }
};

export const SettingsManager = {
    useGulimFont: false,
    
    toggleFont(isGulim) {
        this.useGulimFont = isGulim;
        if (typeof document === 'undefined' || !document.body) return;
        if (isGulim) document.body.classList.add('gulim-font');
        else document.body.classList.remove('gulim-font');
    },

    getCanvasFont() {
        return this.useGulimFont ? "'Gulim', 'Dotum', sans-serif" : "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
    }
};

const LOCAL_EXEMPT_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);
let _resourceGuardInstalled = false;
let _mediaDragGuardInstalled = false;

/**
 * 로컬 개발 환경(localhost/127.0.0.1/::1/file:) 또는 ?debug=1 접속 시 개발자 예외 면제 여부 판별
 */
export function shouldBypassResourceGuard(loc) {
    if (!loc) return true;
    const proto = String(loc.protocol || '').toLowerCase();
    if (proto === 'file:') return true;

    const host = String(loc.hostname || '').toLowerCase();
    if (LOCAL_EXEMPT_HOSTS.has(host)) return true;

    try {
        const search = String(loc.search || '');
        if (search && new URLSearchParams(search).get('debug') === '1') {
            return true;
        }
    } catch {
        // URLSearchParams 파싱 실패 시 무시
    }
    return false;
}

/**
 * 개발자 도구(F12)·우클릭 차단 가드 활성 여부 판별 (외부 접속 자동 활성, 로컬에서도 ?guard=1 시 강제 테스트 가능)
 */
export function shouldEnforceInspectGuard(loc) {
    if (!loc) return false;
    try {
        const search = String(loc.search || '');
        if (search && new URLSearchParams(search).get('guard') === '1') {
            return true;
        }
    } catch {
        // URLSearchParams 파싱 실패 시 무시
    }
    return !shouldBypassResourceGuard(loc);
}

export function isEditableInputTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (target.isContentEditable) return true;
    if (typeof target.closest === 'function') {
        return Boolean(target.closest('input, textarea, [contenteditable="true"]'));
    }
    return false;
}

export function isProtectedMediaDragTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (tag === 'IMG' || tag === 'CANVAS' || tag === 'SVG' || tag === 'PICTURE') return true;
    if (typeof target.closest === 'function') {
        return Boolean(target.closest('img, canvas, svg, picture'));
    }
    return false;
}

export function isBlockedInspectShortcut(e) {
    if (!e) return false;
    const key = String(e.key || '');
    const lower = key.toLowerCase();
    if (key === 'F12' || e.keyCode === 123) return true;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (lower === 'u' || lower === 's')) return true;
    if (e.ctrlKey && e.shiftKey && (lower === 'i' || lower === 'j' || lower === 'c')) return true;
    if (e.metaKey && e.altKey && (lower === 'i' || lower === 'j' || lower === 'c' || lower === 'u')) return true;
    return false;
}

/**
 * 클라이언트 리소스 보호 가드 (이미지/캔버스 드래그 차단 상시 적용 + 외부 접속 시 F12·개발자도구 단축키·우클릭 차단)
 * @returns {boolean} F12·우클릭 가드 장착 여부 (로컬/debug 환경에서는 드래그 가드만 장착하고 false 반환)
 */
export function installResourceProtectionGuard(win = (typeof window !== 'undefined' ? window : null), doc = (typeof document !== 'undefined' ? document : null)) {
    if (!win || !doc) return false;

    // 1. 이미지/캔버스 등 미디어 클릭·드래그 저장 방지는 로컬/외부 무관 상시 장착
    if (!_mediaDragGuardInstalled) {
        doc.addEventListener('dragstart', (e) => {
            if (isProtectedMediaDragTarget(e.target)) {
                e.preventDefault();
            }
        }, true);
        _mediaDragGuardInstalled = true;
    }

    if (_resourceGuardInstalled) return false;
    if (!shouldEnforceInspectGuard(win.location)) return false;

    // 2. 마우스 우클릭 및 개발자도구/저장 단축키 차단
    doc.addEventListener('contextmenu', (e) => {
        if (isEditableInputTarget(e.target)) return;
        e.preventDefault();
    }, true);

    doc.addEventListener('keydown', (e) => {
        if (isBlockedInspectShortcut(e)) {
            e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
    }, true);

    _resourceGuardInstalled = true;
    return true;
}