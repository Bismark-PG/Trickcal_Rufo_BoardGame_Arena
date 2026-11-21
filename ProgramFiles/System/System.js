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

/**
 * 로컬 개발 환경(localhost/127.0.0.1/::1/file:) 또는 ?debug=1 접속 시 리소스 보호 가드 면제 여부 판별
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
    if (tag === 'IMG' || tag === 'CANVAS') return true;
    if (typeof target.closest === 'function') {
        return Boolean(target.closest('img, canvas'));
    }
    return false;
}

export function isBlockedInspectShortcut(e) {
    if (!e) return false;
    const key = String(e.key || '');
    const lower = key.toLowerCase();
    if (key === 'F12' || e.keyCode === 123) return true;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && lower === 'u') return true;
    if (e.ctrlKey && e.shiftKey && (lower === 'i' || lower === 'j' || lower === 'c')) return true;
    if (e.metaKey && e.altKey && (lower === 'i' || lower === 'j' || lower === 'c')) return true;
    return false;
}

/**
 * 외부 접속 전용 클라이언트 리소스 보호 가드 (F12·개발자도구 단축키·우클릭·IMG/CANVAS 드래그 방지)
 * @returns {boolean} 가드 장착 여부 (로컬/debug 환경에서는 false 반환)
 */
export function installResourceProtectionGuard(win = (typeof window !== 'undefined' ? window : null), doc = (typeof document !== 'undefined' ? document : null)) {
    if (!win || !doc || _resourceGuardInstalled) return false;
    if (shouldBypassResourceGuard(win.location)) return false;

    doc.addEventListener('contextmenu', (e) => {
        if (isEditableInputTarget(e.target)) return;
        e.preventDefault();
    });

    doc.addEventListener('dragstart', (e) => {
        if (isProtectedMediaDragTarget(e.target)) {
            e.preventDefault();
        }
    });

    doc.addEventListener('keydown', (e) => {
        if (isBlockedInspectShortcut(e)) {
            e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
    }, true);

    _resourceGuardInstalled = true;
    return true;
}