// ProgramFiles/Lobby/InfoPopupUI.js
// 공용 엘리아스 주민 증명서(닉네임) 유틸, 비복원 로딩 팁 추출기, 공용 [설정]/[정보] 팝업 모듈

import { LangState } from '../System/LanguageManager.js';
import { AudioManager, SettingsManager } from '../System/System.js';
import {
    ONBOARDING_LIMITS,
    ARENA_LEGAL_NOTICE_LINES,
    NICKNAME_POOLS,
    OnboardingLang,
    getNicknameMaxLength
} from '../System/Index/ArenaOnboardingIndex.js';
import { RoomManager } from './RoomManager.js';
import { NetworkClient } from '../System/NetworkClient.js';
import { openBugReportModal, openSuggestionModal } from './FeedbackUI.js';
import { showGlobalArenaToast } from '../System/GlobalToast.js';

function escapeHtmlSafe(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getSafeStorage(kind) {
    try {
        if (typeof window === 'undefined') return null;
        return kind === 'local' ? window.localStorage : window.sessionStorage;
    } catch {
        return null;
    }
}

export function getSessionNickname() {
    const store = getSafeStorage('session');
    try {
        return (store?.getItem(ONBOARDING_LIMITS.SESSION_NICK_STORAGE_KEY) || '').trim();
    } catch {
        return '';
    }
}

export function saveSessionNickname(nickname) {
    const clean = String(nickname ?? '').trim();
    if (!clean) return;
    const store = getSafeStorage('session');
    try {
        store?.setItem(ONBOARDING_LIMITS.SESSION_NICK_STORAGE_KEY, clean);
    } catch {
        // private browsing ignored
    }
}

export function getRememberedNickname() {
    const store = getSafeStorage('local');
    try {
        return (store?.getItem(ONBOARDING_LIMITS.REMEMBERED_NICK_STORAGE_KEY) || '').trim();
    } catch {
        return '';
    }
}

export function saveRememberedNickname(nickname) {
    const clean = String(nickname ?? '').trim();
    if (!clean) return;
    const store = getSafeStorage('local');
    try {
        store?.setItem(ONBOARDING_LIMITS.REMEMBERED_NICK_STORAGE_KEY, clean);
    } catch {
        // private browsing ignored
    }
}

/**
 * [수식어] [성격] [종족] 조합의 12자 이하 엘리아스 주민 랜덤 닉네임 생성 (한/영/일 지원)
 * @param {string} [lang='ko']
 * @param {() => number} [rng=Math.random]
 * @returns {string}
 */
export function generateRandomResidentName(lang = 'ko', rng = Math.random) {
    const pool = NICKNAME_POOLS[lang] || NICKNAME_POOLS.ko;
    const modifiers = pool?.modifiers || ['배고픈'];
    const personalities = pool?.personalities || ['순수한'];
    const races = pool?.races || ['요정'];
    const sep = pool?.separator ?? ' ';
    const maxLen = ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH;
    const allowedRegex = ONBOARDING_LIMITS.ALLOWED_CHAR_REGEX;

    const pick = (arr) => {
        const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(rng() * arr.length)));
        return arr[idx];
    };

    const isValidLenAndChars = (s) =>
        s.length > 0 && s.length <= maxLen && (!allowedRegex || allowedRegex.test(s));

    for (let attempt = 0; attempt < 60; attempt++) {
        const candidate = `${pick(modifiers)}${sep}${pick(personalities)}${sep}${pick(races)}`.trim();
        if (isValidLenAndChars(candidate)) {
            return candidate;
        }
    }

    // 풀 확장에 따른 안전 폴백: 가장 짧은 조합 탐색
    for (const m of modifiers) {
        for (const p of personalities) {
            for (const r of races) {
                const candidate = `${m}${sep}${p}${sep}${r}`.trim();
                if (isValidLenAndChars(candidate)) return candidate;
            }
        }
    }
    return ONBOARDING_LIMITS.EASTER_EGG_NICK;
}

/**
 * 비복원 무작위 로딩 팁 추출기 (모든 팁을 1바퀴 소진한 뒤에만 풀 초기화)
 * @param {string[]} tipsList
 * @param {() => number} [rng=Math.random]
 */
export function createTipCycler(tipsList, rng = Math.random) {
    const items = Array.isArray(tipsList) ? tipsList.filter(Boolean) : [];
    let remainingIndices = [];

    const refill = () => {
        remainingIndices = items.map((_, idx) => idx);
    };

    const next = () => {
        if (items.length === 0) return '';
        if (remainingIndices.length === 0) refill();
        const pickIdx = Math.min(
            remainingIndices.length - 1,
            Math.max(0, Math.floor(rng() * remainingIndices.length))
        );
        const itemIndex = remainingIndices.splice(pickIdx, 1)[0];
        return items[itemIndex];
    };

    const reset = () => {
        remainingIndices = [];
    };

    refill();
    return { next, reset, size: items.length };
}

function resolveNicknameSuccessOutcome(nickname, text) {
    const clean = String(nickname ?? '').trim();
    const norm = clean.toLowerCase();

    if ((ONBOARDING_LIMITS.MASTER_EXACT_TERMS || ['교주']).includes(norm)) {
        return {
            code: 'EASTER_EGG',
            toastType: 'easter',
            nickname: clean,
            message: text.MSG_NICK_EASTER_EGG
        };
    }
    if ((ONBOARDING_LIMITS.TIG_EXACT_TERMS || ['티그']).includes(norm)) {
        return {
            code: 'EASTER_EGG_TIG',
            toastType: 'easter',
            nickname: clean,
            message: text.MSG_NICK_EASTER_TIG || '대장! 어서오는것이다!'
        };
    }
    if ((ONBOARDING_LIMITS.BENI_EXACT_TERMS || ['베니']).includes(norm)) {
        return {
            code: 'EASTER_EGG_BENI',
            toastType: 'easter',
            nickname: clean,
            message: text.MSG_NICK_EASTER_BENI || '으앗! 베니! 손에 묻은 꿀은 닦고 오는것이다!'
        };
    }
    if (ONBOARDING_LIMITS.MASTER_REGEX && ONBOARDING_LIMITS.MASTER_REGEX.test(clean)) {
        return {
            code: 'EASTER_EGG_MODIFIED',
            toastType: 'easter',
            nickname: clean,
            message: text.MSG_NICK_EASTER_EGG_MODIFIED
        };
    }
    if (ONBOARDING_LIMITS.BEASTKIN_REGEX && ONBOARDING_LIMITS.BEASTKIN_REGEX.test(clean)) {
        return {
            code: 'EASTER_EGG_BEASTKIN',
            toastType: 'easter',
            nickname: clean,
            message: text.MSG_NICK_EASTER_BEASTKIN || '흐음? 사료스탕스의 새로운 맴버인것이냐? 환영한다!'
        };
    }
    return {
        code: 'OK',
        toastType: 'success',
        nickname: clean,
        message: text.MSG_NICK_SAVED.replace('{nickname}', clean)
    };
}

/**
 * 제3단원 3-3 닉네임 유효성 검사 · 금지어 · 다국어 이스터에그 공용 밸리데이터
 * 검사 순서: 1) 빈 문자열 -> 2) 12자 초과 -> 3) 허용 문자 -> 4) 금지어 -> 5) 이스터에그 / 정상
 * @param {string} rawInput
 * @param {string} [lang='ko']
 */
export function validateNicknameInput(rawInput, lang = 'ko') {
    const text = OnboardingLang[lang] || OnboardingLang.ko;
    const trimmed = String(rawInput ?? '').trim();

    if (trimmed.length === 0) {
        return {
            ok: false,
            code: 'EMPTY',
            toastType: 'error',
            message: text.ERR_NICK_EMPTY
        };
    }

    if (trimmed.length > getNicknameMaxLength(trimmed)) {
        return {
            ok: false,
            code: 'TOO_LONG',
            toastType: 'error',
            message: text.ERR_NICK_TOO_LONG
        };
    }

    if (ONBOARDING_LIMITS.ALLOWED_CHAR_REGEX && !ONBOARDING_LIMITS.ALLOWED_CHAR_REGEX.test(trimmed)) {
        return {
            ok: false,
            code: 'INVALID_CHARS',
            toastType: 'error',
            message: text.ERR_NICK_INVALID_CHARS
        };
    }

    const lower = trimmed.toLowerCase();
    if (ONBOARDING_LIMITS.FORBIDDEN_TERMS.some(term => lower.includes(term))) {
        return {
            ok: false,
            code: 'FORBIDDEN',
            toastType: 'error',
            message: text.ERR_NICK_FORBIDDEN
        };
    }

    return {
        ok: true,
        ...resolveNicknameSuccessOutcome(trimmed, text)
    };
}

/**
 * 닉네임 검증 후 sessionStorage / localStorage / RoomManager 에 반영한다.
 * @param {{ rawInput: string, remember?: boolean, lang?: string, syncNetwork?: boolean }} options
 */
export async function applyCertificateNickname({
    rawInput,
    remember = true,
    lang = LangState.current,
    syncNetwork = true
} = {}) {
    const text = OnboardingLang[lang] || OnboardingLang.ko;
    const check = validateNicknameInput(rawInput, lang);
    if (!check.ok) return check;

    let finalNick = check.nickname;

    if (syncNetwork) {
        const netRes = await RoomManager.setNicknameWithResult(finalNick);
        if (!netRes.ok) {
            let errMsg = text.ERR_NICK_EMPTY;
            if (netRes.errorCode === 'FORBIDDEN_NICKNAME') errMsg = text.ERR_NICK_FORBIDDEN;
            else if (netRes.errorCode === 'NICKNAME_TOO_LONG') errMsg = text.ERR_NICK_TOO_LONG;
            else if (netRes.errorCode === 'INVALID_NICKNAME_CHARS') errMsg = text.ERR_NICK_INVALID_CHARS;
            return {
                ok: false,
                code: netRes.errorCode || 'SERVER_REJECTED',
                toastType: 'error',
                message: errMsg
            };
        }
        finalNick = netRes.nickname || finalNick;
    } else {
        if (RoomManager.localPlayer) RoomManager.localPlayer.name = finalNick;
        NetworkClient.setStoredNickname(finalNick);
    }

    saveSessionNickname(finalNick);
    if (remember) {
        saveRememberedNickname(finalNick);
    }

    return {
        ok: true,
        ...resolveNicknameSuccessOutcome(finalNick, text)
    };
}

/**
 * 열려 있는 공용 [정보] 팝업 및 하위 도움말·이용약관·피드백 모달을 닫는다.
 * @param {HTMLElement} container
 */
export function closeInfoPopup(container) {
    if (!container) return;
    const infoModal = container.querySelector('#modal-arena-info');
    if (infoModal && infoModal.parentNode) infoModal.remove();
    const helpModal = container.querySelector('#modal-arena-help');
    if (helpModal && helpModal.parentNode) helpModal.remove();
    const termsModal = container.querySelector('#modal-arena-terms');
    if (termsModal && termsModal.parentNode) termsModal.remove();
    const fbModal = container.querySelector('#modal-arena-feedback');
    if (fbModal && fbModal.parentNode) fbModal.remove();
}

/**
 * [설정] 팝업 내부용 공용 "내 증명서 (닉네임 변경)" 섹션 HTML 생성
 * @param {{ lang?: string, currentNickname?: string, idPrefix?: string }} [options]
 */
export function renderSettingsNicknameSectionHtml({
    lang = LangState.current,
    currentNickname = RoomManager.localPlayer?.name || getSessionNickname() || '',
    idPrefix = 'settings'
} = {}) {
    const text = OnboardingLang[lang] || OnboardingLang.ko;
    const prefix = escapeHtmlSafe(idPrefix);
    return `
        <div style="background: rgba(110, 61, 30, 0.08); border: 2px dashed rgba(138, 86, 44, 0.35); border-radius: 16px; padding: 14px 16px; margin-bottom: 18px;">
            <div style="font-size: 17px; font-weight: 900; color: #4E2812; margin-bottom: 10px;">
                ${escapeHtmlSafe(text.INFO_SECTION_CERT)}
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button id="${prefix}-btn-random-nick" type="button" class="btn-blue" style="padding: 10px 14px; font-size: 16px; white-space: nowrap; flex-shrink: 0;">
                    ${escapeHtmlSafe(text.BTN_RANDOM_NICK)}
                </button>
                <input id="${prefix}-input-nickname" type="text" class="modal-input"
                    maxlength="${ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH}"
                    value="${escapeHtmlSafe(currentNickname)}"
                    placeholder="${escapeHtmlSafe(text.NICKNAME_PLACEHOLDER)}"
                    style="flex: 1; min-width: 0; padding: 9px 12px; font-size: 17px; text-align: center;"
                />
                <button id="${prefix}-btn-save-nick" type="button" class="btn-orange" style="padding: 10px 16px; font-size: 16px; white-space: nowrap; flex-shrink: 0;">
                    ${escapeHtmlSafe(text.INFO_BTN_CHANGE_NICK)}
                </button>
            </div>
        </div>
    `;
}

/**
 * [설정] 팝업 내부 공용 "내 증명서 (닉네임 변경)" 이벤트 바인딩
 * @param {{ container: HTMLElement, idPrefix?: string, onNicknameApplied?: ((nickname: string) => void) | null }} options
 */
export function bindSettingsNicknameHandlers({
    container,
    idPrefix = 'settings',
    onNicknameApplied = null
} = {}) {
    if (!container) return;
    const lang = LangState.current || 'ko';
    const nickInput = container.querySelector(`#${idPrefix}-input-nickname`);
    const randomBtn = container.querySelector(`#${idPrefix}-btn-random-nick`);
    const saveBtn = container.querySelector(`#${idPrefix}-btn-save-nick`);

    if (nickInput) {
        nickInput.oninput = () => {
            if (nickInput.value.length > ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH) {
                nickInput.value = nickInput.value.slice(0, ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH);
            }
        };
    }

    if (randomBtn && nickInput) {
        randomBtn.onclick = () => {
            nickInput.value = generateRandomResidentName(lang);
            nickInput.focus();
        };
    }

    let isSaving = false;
    const handleApplyNick = async () => {
        if (isSaving || !nickInput) return;
        isSaving = true;
        if (saveBtn) saveBtn.disabled = true;
        try {
            const res = await applyCertificateNickname({
                rawInput: nickInput.value,
                remember: true,
                lang,
                syncNetwork: true
            });
            const accent = !res.ok
                ? '#e74c3c'
                : (res.toastType === 'easter' ? '#F7C744' : '#77C242');
            showGlobalArenaToast(res.message, 2800, accent);
            if (res.ok) {
                nickInput.value = res.nickname;
                if (typeof onNicknameApplied === 'function') {
                    onNicknameApplied(res.nickname);
                }
            }
        } finally {
            isSaving = false;
            if (saveBtn && saveBtn.isConnected !== false) saveBtn.disabled = false;
        }
    };

    if (saveBtn) saveBtn.onclick = handleApplyNick;
    if (nickInput) {
        nickInput.onkeydown = (e) => {
            if (e.key === 'Enter') handleApplyNick();
        };
    }
}

/**
 * 아레나 전 씬(MainMenu, LobbyUI, GameRoom) 공용 보드게임 아레나 스타일 [설정] 모달 HTML 생성
 */
export function renderArenaSettingsModalHtml({
    popupId = 'popup-settings',
    idPrefix = 'settings',
    bgmSliderId = 'bgm-slider',
    sfxSliderId = 'sfx-slider',
    fontGothicId = 'font-gothic',
    fontGulimId = 'font-gulim',
    langKoId = 'lang-ko',
    langEnId = 'lang-en',
    langJaId = 'lang-ja',
    closeBtnId = 'close-settings',
    lang = LangState.current || 'ko',
    menuText = {},
    currentNickname = RoomManager.localPlayer?.name || getSessionNickname() || ''
} = {}) {
    const isGulim = Boolean(SettingsManager.useGulimFont);
    return `
        <div id="${escapeHtmlSafe(popupId)}" class="arena-modal-backdrop" style="z-index: 1200;">
            <div class="arena-settings-box">
                <h2 style="margin: 0 0 20px; font-size: 32px; font-weight: 900; text-align: center; color: #4E2812;">⚙️ ${escapeHtmlSafe(menuText.SETTINGS || '설정')}</h2>
                ${renderSettingsNicknameSectionHtml({ lang, currentNickname, idPrefix })}

                <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px;">
                    <label style="font-size: 19px; font-weight: 800; color: #4E2812;">
                        ${escapeHtmlSafe(menuText.BGM || 'BGM 음량')}
                        <input type="range" id="${escapeHtmlSafe(bgmSliderId)}" min="0" max="1" step="0.1" value="${AudioManager.bgmPlayer.volume}" style="width: 100%; margin-top: 6px; accent-color: #D95318;">
                    </label>
                    <label style="font-size: 19px; font-weight: 800; color: #4E2812;">
                        ${escapeHtmlSafe(menuText.SFX || 'SFX 음량')}
                        <input type="range" id="${escapeHtmlSafe(sfxSliderId)}" min="0" max="1" step="0.1" value="${AudioManager.sfxVolume}" style="width: 100%; margin-top: 6px; accent-color: #D95318;">
                    </label>
                </div>

                <div style="margin-bottom: 18px; text-align: center;">
                    <p style="margin: 0 0 10px; font-size: 18px; font-weight: 900; color: #4E2812;">${escapeHtmlSafe(menuText.FONT || '폰트 설정')}</p>
                    <div style="display: flex; justify-content: center; gap: 10px;">
                        <button id="${escapeHtmlSafe(fontGothicId)}" type="button" class="arena-choice-btn ${!isGulim ? 'active' : ''}" style="font-family: 'Malgun Gothic', sans-serif;">${escapeHtmlSafe(menuText.FONT_GOTHIC || '고딕')}</button>
                        <button id="${escapeHtmlSafe(fontGulimId)}" type="button" class="arena-choice-btn ${isGulim ? 'active' : ''}" style="font-family: 'Gulim', 'Dotum', sans-serif;">${escapeHtmlSafe(menuText.FONT_GULIM || '굴림')}</button>
                    </div>
                </div>

                <div style="margin-bottom: 22px; text-align: center;">
                    <p style="margin: 0 0 10px; font-size: 18px; font-weight: 900; color: #4E2812;">${escapeHtmlSafe(menuText.LANG || '언어 설정')}</p>
                    <div style="display: flex; justify-content: center; gap: 10px;">
                        <button id="${escapeHtmlSafe(langKoId)}" type="button" class="arena-choice-btn ${lang === 'ko' ? 'active' : ''}">한글</button>
                        <button id="${escapeHtmlSafe(langEnId)}" type="button" class="arena-choice-btn ${lang === 'en' ? 'active' : ''}">Eng</button>
                        <button id="${escapeHtmlSafe(langJaId)}" type="button" class="arena-choice-btn ${lang === 'ja' ? 'active' : ''}">日本語</button>
                    </div>
                </div>

                <button id="${escapeHtmlSafe(closeBtnId)}" type="button" class="btn-danger" style="width: 100%; padding: 14px; font-size: 22px;">${escapeHtmlSafe(menuText.CLOSE || '닫기')}</button>
            </div>
        </div>
    `;
}

/**
 * 아레나 전 씬 공용 [설정] 모달 이벤트 바인딩
 */
export function bindArenaSettingsHandlers({
    container,
    popupId = 'popup-settings',
    openBtnId = 'btn-settings',
    idPrefix = 'settings',
    bgmSliderId = 'bgm-slider',
    sfxSliderId = 'sfx-slider',
    fontGothicId = 'font-gothic',
    fontGulimId = 'font-gulim',
    langKoId = 'lang-ko',
    langEnId = 'lang-en',
    langJaId = 'lang-ja',
    closeBtnId = 'close-settings',
    canOpen = null,
    onNicknameApplied = null
} = {}) {
    if (!container) return;

    bindSettingsNicknameHandlers({ container, idPrefix, onNicknameApplied });

    const popup = container.querySelector(`#${popupId}`);
    const openBtn = container.querySelector(`#${openBtnId}`);
    const closeBtn = container.querySelector(`#${closeBtnId}`);

    if (openBtn && popup) {
        openBtn.onclick = () => {
            if (typeof canOpen === 'function' && !canOpen()) return;
            const nickEl = container.querySelector(`#${idPrefix}-input-nickname`);
            if (nickEl) nickEl.value = RoomManager.localPlayer?.name || getSessionNickname() || nickEl.value || '';
            popup.classList.add('open');
        };
    }
    if (closeBtn && popup) {
        closeBtn.onclick = () => popup.classList.remove('open');
    }
    if (popup) {
        popup.onclick = (e) => {
            if (e.target === popup) popup.classList.remove('open');
        };
    }

    const bgmSlider = container.querySelector(`#${bgmSliderId}`);
    if (bgmSlider) bgmSlider.oninput = (e) => AudioManager.setBGMVolume(e.target.value);
    const sfxSlider = container.querySelector(`#${sfxSliderId}`);
    if (sfxSlider) sfxSlider.oninput = (e) => AudioManager.setSFXVolume(e.target.value);

    const gothicBtn = container.querySelector(`#${fontGothicId}`);
    const gulimBtn = container.querySelector(`#${fontGulimId}`);
    if (gothicBtn) {
        gothicBtn.onclick = () => {
            SettingsManager.toggleFont(false);
            gothicBtn.classList.add('active');
            gulimBtn?.classList.remove('active');
        };
    }
    if (gulimBtn) {
        gulimBtn.onclick = () => {
            SettingsManager.toggleFont(true);
            gulimBtn.classList.add('active');
            gothicBtn?.classList.remove('active');
        };
    }

    const koBtn = container.querySelector(`#${langKoId}`);
    const enBtn = container.querySelector(`#${langEnId}`);
    const jaBtn = container.querySelector(`#${langJaId}`);
    if (koBtn) koBtn.onclick = () => LangState.set('ko');
    if (enBtn) enBtn.onclick = () => LangState.set('en');
    if (jaBtn) jaBtn.onclick = () => LangState.set('ja');
}

/**
 * 공용 [정보 → 도움말] 임시 안내 팝업을 연다.
 * @param {HTMLElement} container
 */
export function openHelpModal(container) {
    if (!container || typeof document === 'undefined') return;
    const prev = container.querySelector('#modal-arena-help');
    if (prev && prev.parentNode) prev.remove();

    const lang = LangState.current;
    const text = OnboardingLang[lang] || OnboardingLang.ko;

    const modal = document.createElement('div');
    modal.id = 'modal-arena-help';
    modal.className = 'arena-modal-backdrop open';
    modal.style.zIndex = '12100';

    modal.innerHTML = `
        <div class="arena-modal-box" style="width: 600px; display: flex; flex-direction: column; gap: 18px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 30px; font-weight: 900; color: #4E2812;">${escapeHtmlSafe(text.HELP_MODAL_TITLE)}</h2>
                <button id="help-btn-close-x" type="button" class="btn-wood" style="width: 42px; height: 42px; border-radius: 50%; font-size: 20px; padding: 0;">✕</button>
            </div>
            <div style="background: rgba(110, 61, 30, 0.08); border: 2px dashed rgba(138, 86, 44, 0.35); border-radius: 18px; padding: 26px 24px; text-align: center;">
                <div style="font-size: 42px; margin-bottom: 10px;">🚧</div>
                <div style="font-size: 22px; font-weight: 900; color: #4E2812; margin-bottom: 10px;">
                    ${escapeHtmlSafe(text.HELP_MODAL_PLACEHOLDER_TITLE)}
                </div>
                <p style="margin: 0; font-size: 16px; font-weight: bold; line-height: 1.6; word-break: keep-all; color: #6E3D1E;">
                    ${escapeHtmlSafe(text.HELP_MODAL_PLACEHOLDER_DESC)}
                </p>
            </div>
            <div style="display: flex; justify-content: flex-end;">
                <button id="help-btn-close" type="button" class="btn-orange" style="padding: 12px 32px; font-size: 19px;">${escapeHtmlSafe(text.INFO_BTN_CLOSE)}</button>
            </div>
        </div>
    `;

    const mountTarget = container.querySelector('.arena-stage') || container;
    mountTarget.appendChild(modal);

    const closeHelp = () => modal.remove();
    const closeBtn = modal.querySelector('#help-btn-close');
    const closeXBtn = modal.querySelector('#help-btn-close-x');
    if (closeBtn) closeBtn.onclick = closeHelp;
    if (closeXBtn) closeXBtn.onclick = closeHelp;
    modal.onclick = (e) => {
        if (e.target === modal) closeHelp();
    };
}

/**
 * 공용 [정보 → 이용약관] 비영리 2차 창작 및 저작권 안내 팝업을 연다.
 * @param {HTMLElement} container
 */
export function openTermsModal(container) {
    if (!container || typeof document === 'undefined') return;
    const prev = container.querySelector('#modal-arena-terms');
    if (prev && prev.parentNode) prev.remove();

    const lang = LangState.current;
    const text = OnboardingLang[lang] || OnboardingLang.ko;

    const linesHtml = ARENA_LEGAL_NOTICE_LINES.map((line, idx) => `
        <p style="margin: ${idx === ARENA_LEGAL_NOTICE_LINES.length - 1 ? '0' : '0 0 10px 0'}; font-size: 16px; font-weight: 700; line-height: 1.8; letter-spacing: -0.2px; white-space: nowrap; color: ${idx === 2 ? '#A93022' : '#46230F'};">
            ${escapeHtmlSafe(line)}
        </p>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'modal-arena-terms';
    modal.className = 'arena-modal-backdrop open';
    modal.style.zIndex = '12100';

    modal.innerHTML = `
        <div class="arena-modal-box" style="width: 1200px; max-width: calc(100% - 80px); display: flex; flex-direction: column; gap: 18px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 30px; font-weight: 900; color: #4E2812;">${escapeHtmlSafe(text.TERMS_MODAL_TITLE)}</h2>
                <button id="terms-btn-close-x" type="button" class="btn-wood" style="width: 42px; height: 42px; border-radius: 50%; font-size: 20px; padding: 0;">✕</button>
            </div>
            <div style="background: rgba(110, 61, 30, 0.08); border: 2px dashed rgba(138, 86, 44, 0.35); border-radius: 18px; padding: 24px 28px;">
                ${linesHtml}
            </div>
            <div style="display: flex; justify-content: flex-end;">
                <button id="terms-btn-close" type="button" class="btn-orange" style="padding: 12px 32px; font-size: 19px;">${escapeHtmlSafe(text.INFO_BTN_CLOSE)}</button>
            </div>
        </div>
    `;

    const mountTarget = container.querySelector('.arena-stage') || container;
    mountTarget.appendChild(modal);

    const closeTerms = () => modal.remove();
    const closeBtn = modal.querySelector('#terms-btn-close');
    const closeXBtn = modal.querySelector('#terms-btn-close-x');
    if (closeBtn) closeBtn.onclick = closeTerms;
    if (closeXBtn) closeXBtn.onclick = closeTerms;
    modal.onclick = (e) => {
        if (e.target === modal) closeTerms();
    };
}

/**
 * 아레나 공용 [정보] 팝업을 연다. (MainMenu, LobbyUI, GameRoom 공용 — 프로젝트 정보·도움말·이용약관·버그 제보/건의)
 * @param {HTMLElement} container
 * @param {{ gameId?: string }} [options]
 */
export function openInfoPopup(container, { gameId = 'arena' } = {}) {
    if (!container || typeof document === 'undefined') return;
    closeInfoPopup(container);

    const lang = LangState.current;
    const text = OnboardingLang[lang] || OnboardingLang.ko;
    const projectDescLines = Array.isArray(text.INFO_PROJECT_DESC_LINES)
        ? text.INFO_PROJECT_DESC_LINES
        : String(text.INFO_PROJECT_DESC || '').split('\n');
    const projectDescHtml = projectDescLines.map((line, idx) => `
        <p style="margin: 0; font-size: ${idx === 0 ? '16px' : '15px'}; font-weight: ${idx === 0 ? '900' : '700'}; line-height: 1.55; word-break: keep-all; color: ${idx === 0 ? '#4E2812' : '#6E3D1E'};">
            ${escapeHtmlSafe(line)}
        </p>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'modal-arena-info';
    modal.className = 'arena-modal-backdrop open';
    modal.style.zIndex = '12000';

    modal.innerHTML = `
        <div id="modal-arena-info-card" class="arena-modal-box" style="width: 680px; display: flex; flex-direction: column; gap: 18px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 32px; font-weight: 900; color: #4E2812;">${escapeHtmlSafe(text.INFO_MODAL_TITLE)}</h2>
                <button id="info-btn-close-x" type="button" class="btn-wood" style="width: 42px; height: 42px; border-radius: 50%; font-size: 20px; padding: 0;">✕</button>
            </div>

            <!-- 프로젝트 정보 · 도움말 · 이용약관 -->
            <div style="background: rgba(110, 61, 30, 0.08); border: 2px dashed rgba(138, 86, 44, 0.35); border-radius: 18px; padding: 20px 24px;">
                <div style="font-size: 21px; font-weight: 900; color: #4E2812; margin-bottom: 8px;">
                    ${escapeHtmlSafe(text.INFO_SECTION_PROJECT)}
                </div>
                <div style="margin: 0 0 16px 0; display: flex; flex-direction: column; gap: 4px;">
                    ${projectDescHtml}
                </div>
                <div style="display: flex; gap: 14px;">
                    <button id="info-btn-help" type="button" class="btn-blue" style="flex: 1; padding: 13px 16px; font-size: 19px;">${escapeHtmlSafe(text.INFO_BTN_HELP)}</button>
                    <button id="info-btn-terms" type="button" class="btn-wood" style="flex: 1; padding: 13px 16px; font-size: 19px;">${escapeHtmlSafe(text.INFO_BTN_TERMS)}</button>
                </div>
            </div>

            <!-- 버그 제보 및 건의하기 -->
            <div style="background: rgba(110, 61, 30, 0.08); border: 2px dashed rgba(138, 86, 44, 0.35); border-radius: 18px; padding: 20px 24px;">
                <div style="font-size: 21px; font-weight: 900; color: #4E2812; margin-bottom: 6px;">
                    ${escapeHtmlSafe(text.INFO_SECTION_FEEDBACK)}
                </div>
                <p style="margin: 0 0 16px 0; font-size: 15px; font-weight: bold; color: #6E3D1E;">
                    ${escapeHtmlSafe(text.INFO_FEEDBACK_DESC)}
                </p>
                <div style="display: flex; gap: 14px;">
                    <button id="info-btn-bug-report" type="button" class="btn-orange" style="flex: 1; padding: 13px 16px; font-size: 19px;">${escapeHtmlSafe(text.INFO_BTN_BUG)}</button>
                    <button id="info-btn-suggestion" type="button" class="btn-green" style="flex: 1; padding: 13px 16px; font-size: 19px;">${escapeHtmlSafe(text.INFO_BTN_SUGGEST)}</button>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end;">
                <button id="info-btn-close" type="button" class="btn-danger" style="padding: 12px 30px; font-size: 20px;">${escapeHtmlSafe(text.INFO_BTN_CLOSE)}</button>
            </div>
        </div>
    `;

    const mountTarget = container.querySelector('.arena-stage') || container;
    mountTarget.appendChild(modal);

    const helpBtn = modal.querySelector('#info-btn-help');
    const termsBtn = modal.querySelector('#info-btn-terms');
    const bugBtn = modal.querySelector('#info-btn-bug-report');
    const suggestBtn = modal.querySelector('#info-btn-suggestion');
    const closeBtn = modal.querySelector('#info-btn-close');
    const closeXBtn = modal.querySelector('#info-btn-close-x');

    const closeSelf = () => closeInfoPopup(container);
    if (closeBtn) closeBtn.onclick = closeSelf;
    if (closeXBtn) closeXBtn.onclick = closeSelf;
    modal.onclick = (e) => {
        if (e.target === modal) closeSelf();
    };

    if (helpBtn) {
        helpBtn.onclick = () => openHelpModal(container);
    }
    if (termsBtn) {
        termsBtn.onclick = () => openTermsModal(container);
    }
    if (bugBtn) {
        bugBtn.onclick = () => {
            closeSelf();
            openBugReportModal(container, { defaultGameId: gameId });
        };
    }
    if (suggestBtn) {
        suggestBtn.onclick = () => {
            closeSelf();
            openSuggestionModal(container, { defaultGameId: gameId });
        };
    }
}
