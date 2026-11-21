// ProgramFiles/Scenes/ArenaLoading.js
// 루포의 보드게임 아레나 온보딩 로딩 · 엘리아스 주민 증명서(닉네임) 설정 · 5초 비복원 팁 순환 씬

import { changeScene } from '../Main.js';
import { LangState } from '../System/LanguageManager.js';
import {
    ONBOARDING_LIMITS,
    LOADING_TIPS,
    OnboardingLang
} from '../System/Index/ArenaOnboardingIndex.js';
import { escapeHtml } from '../Lobby/LobbyUI.js';
import { runArenaPreload } from '../System/AssetPreloader.js';
import { ErrorTracker } from '../System/ErrorTracker.js';
import { showGlobalArenaToast } from '../System/GlobalToast.js';
import {
    generateRandomResidentName,
    createTipCycler,
    getSessionNickname,
    getRememberedNickname,
    applyCertificateNickname
} from '../Lobby/InfoPopupUI.js';

const BOOT_PRELOAD_TIMEOUT_MS = 25000;
const BOOT_SLOW_HINT_MS = 5000;

function resolveStageDescription(progress, text) {
    if (!progress || progress.gameId === 'arena' || progress.stepId === 'arena') {
        return text.STAGE_DESC_ARENA;
    }
    const gameName = (text.GAME_NAMES && text.GAME_NAMES[progress.gameId])
        || progress.gameId
        || progress.stepId;
    return `${text.STAGE_DESC_GAME_PREFIX || ''}${gameName}${text.STAGE_DESC_GAME_SUFFIX || ''}`;
}

function fitTipBoxLayout(stageEl) {
    if (!stageEl) return;
    const apply = () => {
        stageEl.style.whiteSpace = 'nowrap';
        stageEl.style.fontSize = '20px';
        for (const size of [20, 19, 18, 17, 16]) {
            stageEl.style.fontSize = `${size}px`;
            if (stageEl.scrollWidth <= stageEl.clientWidth + 1) {
                return;
            }
        }
        stageEl.style.whiteSpace = 'normal';
    };
    apply();
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(apply);
    }
}

export function initArenaLoading(container, sceneParams = null) {
    let isCleanedUp = false;
    let slowHintTimer = null;
    let tipRotateTimer = null;
    let lastProgress = null;
    let showSlowActions = false;
    let isPreloadFinished = false;

    const initialLang = LangState.current;
    const existingSessionNick = getSessionNickname();
    let draftNickname = existingSessionNick || generateRandomResidentName(initialLang);
    let isNameConfirmed = Boolean(existingSessionNick);

    const makeCyclerForLang = (lang) => createTipCycler(LOADING_TIPS[lang] || LOADING_TIPS.ko);
    let tipCycler = makeCyclerForLang(initialLang);
    let currentTip = tipCycler.next();

    const showToastForResult = (res) => {
        if (!res || !res.message) return;
        const accent = !res.ok
            ? '#e74c3c'
            : (res.toastType === 'easter' ? '#F7C744' : '#77C242');
        showGlobalArenaToast(res.message, 2800, accent);
    };

    const openCertRequiredModal = () => {
        const modal = container.querySelector('#modal-cert-required');
        if (modal) modal.classList.add('open');
    };

    const enterMenuWithCertificate = async (reason = 'enter') => {
        if (isCleanedUp) return;
        if (!isNameConfirmed) {
            openCertRequiredModal();
            return;
        }
        const lang = LangState.current;
        const res = await applyCertificateNickname({
            rawInput: draftNickname,
            remember: false,
            lang,
            syncNetwork: true
        });
        if (!res.ok) {
            isNameConfirmed = false;
            showToastForResult(res);
            const inputEl = container.querySelector('#input-cert-nickname');
            if (inputEl && typeof inputEl.focus === 'function') inputEl.focus();
            return;
        }
        draftNickname = res.nickname;
        if (reason === 'skip') {
            ErrorTracker.addBreadcrumb('UI_ACTION', 'Arena preload skipped by user -> menu');
        } else {
            ErrorTracker.addBreadcrumb('UI_ACTION', 'Arena onboarding complete -> menu');
        }
        changeScene('menu', { ...(sceneParams || {}), showWelcomeToast: true });
    };

    const updateProgressDomOnly = () => {
        if (isCleanedUp) return;
        const lang = LangState.current;
        const text = OnboardingLang[lang] || OnboardingLang.ko;
        const pct = isPreloadFinished
            ? 100
            : Math.max(0, Math.min(100, Number(lastProgress?.percent) || 0));
        const loaded = Number(lastProgress?.overallLoaded) || 0;
        const total = Number(lastProgress?.overallTotal) || 0;

        const fillEl = container.querySelector('#arena-loading-fill');
        const fileEl = container.querySelector('#arena-loading-file');
        const countEl = container.querySelector('#arena-loading-count');
        const progressWrap = container.querySelector('#arena-loading-progress-wrap');
        const slowBox = container.querySelector('#arena-loading-slow-box');
        const enterWrap = container.querySelector('#arena-enter-wrap');

        if (fillEl) fillEl.style.width = `${pct}%`;
        if (fileEl) fileEl.textContent = resolveStageDescription(lastProgress, text);
        if (countEl) countEl.textContent = `${pct}% (${loaded} / ${total})`;

        if (isPreloadFinished) {
            if (progressWrap) progressWrap.style.display = 'none';
            if (slowBox) slowBox.style.display = 'none';
            if (enterWrap) enterWrap.style.display = 'flex';
        }
    };

    const rotateTip = () => {
        if (isCleanedUp) return;
        currentTip = tipCycler.next();
        const text = OnboardingLang[LangState.current] || OnboardingLang.ko;
        const stageEl = container.querySelector('#arena-loading-stage');
        if (stageEl) {
            stageEl.textContent = `${text.TIP_PREFIX || ''}${currentTip}`;
            fitTipBoxLayout(stageEl);
        }
    };

    const render = () => {
        if (isCleanedUp) return;
        const lang = LangState.current;
        const text = OnboardingLang[lang] || OnboardingLang.ko;
        const pct = isPreloadFinished
            ? 100
            : Math.max(0, Math.min(100, Number(lastProgress?.percent) || 0));
        const loaded = Number(lastProgress?.overallLoaded) || 0;
        const total = Number(lastProgress?.overallTotal) || 0;
        const stageDesc = resolveStageDescription(lastProgress, text);
        const rememberedNick = getRememberedNickname();

        container.innerHTML = `
            <div class="arena-stage">
                <div class="loading-page">
                    <div class="wood-panel loading-board">
                        <div class="loading-hero-row">
                            <img id="arena-loading-logo" class="loading-rufo-avatar" src="./Resource/Texture/Char/Char_Rufo_Sit.png" alt="루포">
                            <div class="loading-headings">
                                <img class="loading-logo-mini" src="./Resource/Texture/Logo_Trickcal.png" alt="트릭컬 로고">
                                <h1>${escapeHtml(text.WELCOME_HEADING)}</h1>
                                <p>${escapeHtml(text.CERTIFICATE_PROMPT)}</p>
                            </div>
                        </div>

                        <!-- 중앙: 엘리아스 주민 증명서(닉네임) 입력 카드 -->
                        <div class="parchment-card cert-card">
                            <div class="cert-inner-dashed">
                                <div class="cert-header">
                                    <span class="cert-header-title">${escapeHtml(text.CERT_CARD_TITLE)}</span>
                                    <span class="cert-limit-pill">${escapeHtml(text.NICKNAME_LIMIT_PILL || '한/영/일/숫자 최대 12자')}</span>
                                    <button id="btn-cert-restore" type="button" class="btn-green cert-scale-btn"
                                        style="width: 206px; height: 38px; padding: 0 12px; font-size: 15px; visibility: ${rememberedNick ? 'visible' : 'hidden'};">
                                        ${escapeHtml(text.BTN_RESTORE_PREV_NICK)}
                                    </button>
                                </div>
                                <div class="cert-controls-row">
                                    <button id="btn-cert-random" type="button" class="btn-blue cert-scale-btn" style="width: 100%; height: 56px; padding: 0 14px; font-size: 20px;">
                                        ${escapeHtml(text.BTN_RANDOM_NICK)}
                                    </button>
                                    <input id="input-cert-nickname" class="cert-input" type="text"
                                        maxlength="${ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH}"
                                        value="${escapeHtml(draftNickname)}"
                                        placeholder="${escapeHtml(text.NICKNAME_PLACEHOLDER)}"
                                    />
                                    <button id="btn-cert-remember" type="button" class="btn-orange cert-scale-btn" style="width: 100%; height: 56px; padding: 0 14px; font-size: 20px;">
                                        ${escapeHtml(text.BTN_REMEMBER_NICK)}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- 하단: 5초 비복원 랜덤 팁 (클릭 시에도 즉시 전환) -->
                        <div id="arena-loading-stage" class="tip-banner">
                            ${escapeHtml(`${text.TIP_PREFIX || ''}${currentTip}`)}
                        </div>

                        <!-- 로딩 게이지 영역 (100% 완료 시 숨김) -->
                        <div id="arena-loading-progress-wrap" class="progress-area" style="display: ${isPreloadFinished ? 'none' : 'flex'};">
                            <div class="progress-track">
                                <div id="arena-loading-fill" class="progress-fill" style="width: ${pct}%;"></div>
                            </div>
                            <div class="progress-meta">
                                <span id="arena-loading-file" style="max-width: 68%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;">
                                    ${escapeHtml(stageDesc)}
                                </span>
                                <span id="arena-loading-count" style="color: #FFE68B;">${pct}% (${loaded} / ${total})</span>
                            </div>
                        </div>

                        <!-- 5초 지연 시 건너뛰기 안내 -->
                        <div id="arena-loading-slow-box" style="display: ${!isPreloadFinished && showSlowActions ? 'flex' : 'none'}; margin-top: 6px; flex-direction: column; align-items: center; gap: 10px;">
                            <span style="font-size: 16px; font-weight: bold; color: #FFE68B;">${escapeHtml(text.LOADING_SLOW_HINT)}</span>
                            <button id="btn-loading-skip" type="button" class="btn-wood" style="padding: 10px 26px; font-size: 16px;">
                                ${escapeHtml(text.BTN_SKIP_LOADING)}
                            </button>
                        </div>

                        <!-- 100% 완료 후 [아레나에 뛰어들기!] 버튼 -->
                        <div id="arena-enter-wrap" style="display: ${isPreloadFinished ? 'flex' : 'none'}; justify-content: center; width: 100%; padding-top: 6px;">
                            <button id="btn-enter-arena" type="button" class="btn-orange" style="height: 76px; padding: 0 60px; font-size: 28px; border-radius: 20px;">
                                ${escapeHtml(text.BTN_ENTER_ARENA)}
                            </button>
                        </div>
                    </div>

                    <!-- 모달: 증명서 미등록 안내 -->
                    <div id="modal-cert-required" class="arena-modal-backdrop">
                        <div class="arena-modal-box" style="width: 700px; text-align: center;">
                            <h2 style="margin: 0 0 16px; font-size: 30px; font-weight: 900; color: #4E2812; white-space: nowrap;">
                                ${escapeHtml(text.CERT_REQUIRED_TITLE || '🪪 먼저 증명서를 보여주는 것이다!')}
                            </h2>
                            <p style="margin: 0 0 26px; font-size: 19px; font-weight: bold; line-height: 1.55; color: #6E3D1E;">
                                <span style="color: #D95318;">${escapeHtml(text.CERT_REQUIRED_HIGHLIGHT || '[📝 이름 기억하기!]')}</span>${escapeHtml(text.CERT_REQUIRED_DESC_SUFFIX || ' 버튼을 눌러주어야 들어보내줄 수 있는것이다!')}
                            </p>
                            <button type="button" id="btn-cert-modal-ok" class="btn-orange" style="width: 100%; padding: 14px; font-size: 20px;">
                                ${escapeHtml(text.CERT_REQUIRED_OK || '알았다는것이다')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const stageEl = container.querySelector('#arena-loading-stage');
        if (stageEl) {
            fitTipBoxLayout(stageEl);
            stageEl.onclick = rotateTip;
        }

        const rufoLogo = container.querySelector('#arena-loading-logo');
        if (rufoLogo) {
            rufoLogo.onclick = () => {
                const liveText = OnboardingLang[LangState.current] || OnboardingLang.ko;
                showGlobalArenaToast(
                    liveText.LOADING_RUFO_CLICK_TOAST || '🦊 어서 오는것이다! 어서 너의 멋진 이름이 적힌 증명서를 보여주는것이다!',
                    2800,
                    '#F7C744'
                );
            };
        }

        const certModal = container.querySelector('#modal-cert-required');
        const certModalOk = container.querySelector('#btn-cert-modal-ok');
        const closeCertModal = () => {
            certModal?.classList.remove('open');
            container.querySelector('#input-cert-nickname')?.focus?.();
        };
        if (certModalOk) certModalOk.onclick = closeCertModal;
        if (certModal) certModal.onclick = (e) => { if (e.target === certModal) closeCertModal(); };

        const nickInput = container.querySelector('#input-cert-nickname');
        const randomBtn = container.querySelector('#btn-cert-random');
        const rememberBtn = container.querySelector('#btn-cert-remember');
        const restoreBtn = container.querySelector('#btn-cert-restore');
        const skipBtn = container.querySelector('#btn-loading-skip');
        const enterBtn = container.querySelector('#btn-enter-arena');

        if (nickInput) {
            nickInput.oninput = (e) => {
                if (e.target.value.length > ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH) {
                    e.target.value = e.target.value.slice(0, ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH);
                }
                draftNickname = e.target.value;
                isNameConfirmed = false;
            };
            nickInput.onkeydown = (e) => {
                if (e.key === 'Enter' && rememberBtn) rememberBtn.click();
            };
        }

        if (randomBtn && nickInput) {
            randomBtn.onclick = () => {
                draftNickname = generateRandomResidentName(LangState.current);
                nickInput.value = draftNickname;
                isNameConfirmed = false;
            };
        }

        if (rememberBtn && nickInput) {
            rememberBtn.onclick = async () => {
                const res = await applyCertificateNickname({
                    rawInput: nickInput.value,
                    remember: true,
                    lang: LangState.current,
                    syncNetwork: true
                });
                if (res.ok) {
                    draftNickname = res.nickname;
                    nickInput.value = res.nickname;
                    isNameConfirmed = true;
                    if (restoreBtn) restoreBtn.style.visibility = 'visible';
                    showToastForResult(res);
                } else {
                    isNameConfirmed = false;
                    if (res.code === 'EMPTY') {
                        openCertRequiredModal();
                    } else {
                        showToastForResult(res);
                    }
                }
            };
        }

        if (restoreBtn && nickInput) {
            restoreBtn.onclick = async () => {
                const saved = getRememberedNickname();
                if (!saved) return;
                const sliced = saved.slice(0, ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH);
                nickInput.value = sliced;
                draftNickname = sliced;
                const res = await applyCertificateNickname({
                    rawInput: sliced,
                    remember: true,
                    lang: LangState.current,
                    syncNetwork: true
                });
                showToastForResult(res);
                if (res.ok) {
                    draftNickname = res.nickname;
                    nickInput.value = res.nickname;
                    isNameConfirmed = true;
                }
            };
        }

        if (skipBtn) {
            skipBtn.onclick = () => enterMenuWithCertificate('skip');
        }

        if (enterBtn) {
            enterBtn.onclick = () => enterMenuWithCertificate('enter');
        }
    };

    const langHandler = () => {
        tipCycler = makeCyclerForLang(LangState.current);
        currentTip = tipCycler.next();
        render();
    };
    document.addEventListener('languageChanged', langHandler);

    container._cleanupScene = () => {
        isCleanedUp = true;
        if (slowHintTimer) {
            clearTimeout(slowHintTimer);
            slowHintTimer = null;
        }
        if (tipRotateTimer) {
            clearInterval(tipRotateTimer);
            tipRotateTimer = null;
        }
        tipCycler.reset();
        document.removeEventListener('languageChanged', langHandler);
    };

    render();

    tipRotateTimer = setInterval(rotateTip, ONBOARDING_LIMITS.TIP_ROTATE_MS);

    slowHintTimer = setTimeout(() => {
        if (isCleanedUp || isPreloadFinished) return;
        showSlowActions = true;
        const slowBox = container.querySelector('#arena-loading-slow-box');
        if (slowBox) slowBox.style.display = 'flex';
    }, BOOT_SLOW_HINT_MS);

    runArenaPreload({
        overallTimeoutMs: BOOT_PRELOAD_TIMEOUT_MS,
        onProgress: (progress) => {
            if (isCleanedUp) return;
            lastProgress = progress;
            if (progress?.done || Number(progress?.percent) >= 100) {
                isPreloadFinished = true;
                if (slowHintTimer) {
                    clearTimeout(slowHintTimer);
                    slowHintTimer = null;
                }
            }
            updateProgressDomOnly();
        }
    }).then((result) => {
        if (isCleanedUp) return;
        isPreloadFinished = true;
        if (result?.timedOut) {
            ErrorTracker.addBreadcrumb('WARN', 'Arena preload timed out after 25s -> ready to enter menu');
        }
        if (slowHintTimer) {
            clearTimeout(slowHintTimer);
            slowHintTimer = null;
        }
        updateProgressDomOnly();
    });
}
