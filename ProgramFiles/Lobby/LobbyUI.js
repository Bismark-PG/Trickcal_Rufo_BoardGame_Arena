import { changeScene } from '../Main.js';
import { RoomManager } from './RoomManager.js';
import { NetworkClient } from '../System/NetworkClient.js';
import { ErrorTracker } from '../System/ErrorTracker.js';
import { getGameMeta } from '../System/GameRegistry.js';
import { LangState } from '../System/LanguageManager.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { MenuLang } from '../System/Index/MainMenuIndex.js';
import { OnboardingLang } from '../System/Index/ArenaOnboardingIndex.js';
import {
    openInfoPopup,
    renderArenaSettingsModalHtml,
    bindArenaSettingsHandlers
} from './InfoPopupUI.js';

export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function showLobbyToast(container, msg, duration = 2400) {
    if (!container) return;
    const mountTarget = container.querySelector('.arena-stage') || container;
    const existing = mountTarget.querySelector('#lobby-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'lobby-toast';
    toast.style.cssText = `
        position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%);
        background: rgba(68, 35, 16, 0.96); color: #FFF7DF; padding: 14px 30px;
        border-radius: 16px; font-size: 20px; font-weight: bold; z-index: 13000;
        border: 3px solid #F7C744; box-shadow: 0 12px 30px rgba(0,0,0,0.45);
        pointer-events: none; text-align: center; font-family: inherit; white-space: nowrap;
    `;
    toast.innerText = msg;
    mountTarget.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, duration);
}

function openDuplicateTabModal(container) {
    return new Promise((resolve) => {
        if (!container || typeof document === 'undefined') {
            resolve(false);
            return;
        }
        const mountTarget = container.querySelector('.arena-stage') || container;
        const existing = container.querySelector('#modal-duplicate-tab');
        if (existing) existing.remove();

        const text = LobbyLang[LangState.current] || LobbyLang.ko;
        const modal = document.createElement('div');
        modal.id = 'modal-duplicate-tab';
        modal.className = 'arena-modal-backdrop open';
        modal.style.zIndex = '11500';
        modal.innerHTML = `
            <div class="arena-modal-box" style="width: 560px; text-align: center;">
                <h2 style="margin: 0 0 16px 0; font-size: 30px; font-weight: 900; color: #9E4412;">⚠️ ${escapeHtml(text.DUP_TAB_TITLE || '중복 접속 확인')}</h2>
                <p style="margin: 0 0 28px 0; font-size: 19px; font-weight: bold; line-height: 1.65; color: #4E2812; white-space: pre-line;">${escapeHtml(text.DUP_TAB_DESC || '이미 다른 경로로 접속중입니다.\n현재 페이지로 재접속하시겠습니까?')}</p>
                <div style="display: flex; justify-content: center; gap: 14px;">
                    <button id="btn-dup-tab-no" type="button" class="btn-wood" style="min-width: 140px; padding: 13px 26px; font-size: 20px;">${escapeHtml(text.DUP_TAB_NO || '아니요')}</button>
                    <button id="btn-dup-tab-yes" type="button" class="btn-orange" style="min-width: 140px; padding: 13px 26px; font-size: 20px;">${escapeHtml(text.DUP_TAB_YES || '예')}</button>
                </div>
            </div>
        `;
        mountTarget.appendChild(modal);

        const cleanup = (answer) => {
            if (modal.parentNode) modal.remove();
            resolve(answer);
        };
        modal.querySelector('#btn-dup-tab-yes').onclick = () => cleanup(true);
        modal.querySelector('#btn-dup-tab-no').onclick = () => cleanup(false);
    });
}

export async function ensureGameTabAccess(container, gameId) {
    if (!gameId || !NetworkClient.isOnline()) {
        return { allowed: true, offline: true };
    }
    if (NetworkClient.activeRegisteredGameId === gameId) {
        return { allowed: true, alreadyRegistered: true };
    }

    const res = await NetworkClient.registerGameTab(gameId);
    if (res.ok) {
        return { allowed: true };
    }
    if (res.error !== 'DUPLICATE_GAME_TAB') {
        return { allowed: true };
    }

    ErrorTracker.addBreadcrumb('WARN', `Duplicate tab detected for ${gameId}`);
    const wantsTakeover = await openDuplicateTabModal(container);
    if (wantsTakeover) {
        ErrorTracker.addBreadcrumb('UI_ACTION', `Duplicate tab takeover confirmed (${gameId})`);
        const forceRes = await NetworkClient.registerGameTab(gameId, { force: true });
        if (forceRes.ok) {
            return { allowed: true, tookOver: true };
        }
    }

    ErrorTracker.addBreadcrumb('UI_ACTION', `Duplicate tab declined (${gameId})`);
    await RoomManager.leaveCurrentRoom();
    NetworkClient.disconnect({ disableReconnect: true });
    changeScene('tab_blocked', { gameId, reason: 'DECLINED' });
    return { allowed: false, reason: 'DECLINED' };
}

export function renderTabBlockedScreen(container, sceneParams = null) {
    if (!container) return;
    const reason = sceneParams?.reason || 'REPLACED_BY_NEW_TAB';

    const render = () => {
        const text = LobbyLang[LangState.current] || LobbyLang.ko;
        const title = text.TAB_BLOCKED_TITLE || '접속이 종료되었습니다';
        const desc = reason === 'DECLINED'
            ? (text.TAB_BLOCKED_DESC_DECLINED || '기존 경로의 접속을 유지하기 위해 현재 페이지의 접속을 중단했습니다.')
            : (text.TAB_BLOCKED_DESC_REPLACED || '다른 탭 또는 경로에서 동일 게임으로 재접속하여 현재 탭의 연결이 종료되었습니다.');
        const btnLabel = text.TAB_BLOCKED_BTN_MENU || '아레나 메인으로 이동';

        container.innerHTML = `
            <div class="arena-stage" style="display: flex; align-items: center; justify-content: center; padding: 40px;">
                <div class="wood-panel" style="width: 680px; max-width: 92vw; padding: 48px 44px; text-align: center;">
                    <div style="font-size: 64px; margin-bottom: 16px;">🚫</div>
                    <h1 style="margin: 0 0 18px 0; font-size: 36px; font-weight: 900; color: #FFE68B;">${escapeHtml(title)}</h1>
                    <p style="margin: 0 0 36px 0; font-size: 21px; font-weight: bold; line-height: 1.65; color: #FFF4DC; white-space: pre-line;">${escapeHtml(desc)}</p>
                    <button id="btn-tab-blocked-menu" type="button" class="btn-orange" style="padding: 16px 38px; font-size: 22px;">${escapeHtml(btnLabel)}</button>
                </div>
            </div>
        `;

        const menuBtn = container.querySelector('#btn-tab-blocked-menu');
        if (menuBtn) {
            menuBtn.onclick = () => changeScene('menu');
        }
    };

    const langHandler = () => render();
    document.addEventListener('languageChanged', langHandler);
    container._cleanupScene = () => document.removeEventListener('languageChanged', langHandler);
    render();
}

export function renderGameMainPage(container, config) {
    const {
        gameId,
        titleKey,
        badgeKey,
        rulesKey,
        defaultRoomTitleKey,
        sceneParams = null
    } = config;

    const meta = getGameMeta(gameId);
    const kickReason = sceneParams?.kickNotice?.reason || (sceneParams?.afkPenalty ? 'AFK_KICKED' : null);
    let showAfkPenalty = Boolean(
        kickReason === 'AFK_KICKED' ||
        kickReason === 'HOST_IDLE_KICKED' ||
        kickReason === 'HOST_IDLE_BANNED'
    );
    let afkPenaltyFaded = false;

    const pickRandomCreateTitle = (text, fallback) => {
        const presets = Array.isArray(text?.ROOM_TITLE_PRESETS) && text.ROOM_TITLE_PRESETS.length > 0
            ? text.ROOM_TITLE_PRESETS
            : [fallback].filter(Boolean);
        return presets[Math.floor(Math.random() * presets.length)] || fallback || '';
    };

    const render = () => {
        const lang = LangState.current || 'ko';
        const text = LobbyLang[lang] || LobbyLang.ko;
        const menuText = MenuLang[lang] || MenuLang.ko;
        const rooms = RoomManager.getPublicRooms(gameId);
        const gameTitle = text[titleKey] || gameId;
        const gameBadge = text[badgeKey] || '';
        const rulesList = Array.isArray(text[rulesKey]) ? text[rulesKey] : [];
        const defaultTitle = pickRandomCreateTitle(text, text[defaultRoomTitleKey] || gameTitle);

        const isUnos = gameId === 'unos';
        const badgeBg = isUnos ? '#5E72E4' : '#76C140';
        const badgeColor = isUnos ? '#ffffff' : '#16330A';
        const badgeBorder = isUnos ? '#C5CEFF' : '#D6F5B3';
        const bannerBg = isUnos ? './Resource/Texture/BG/BG_Broken_Altar_Special.png' : './Resource/Texture/BG/BG_Throne_room.png';
        const bannerChar = isUnos ? './Resource/Texture/Char/Char_Erpin_Unos.png' : './Resource/Texture/Char/Char_Erpin_Marble.png';
        const bannerVerText = isUnos
            ? (lang === 'en' ? 'Alpha' : (lang === 'ja' ? 'アルファ' : '알파'))
            : (lang === 'en' ? 'Version 1.0' : (lang === 'ja' ? 'バージョン 1.0' : '버전 1.0'));

        const netStatus = RoomManager.getNetworkStatus().status;
        const isOnline = RoomManager.isOnline();
        const netPillStyle = isOnline
            ? 'background: #FFFBF0; border: 3px solid #77C242; color: #2B6213;'
            : (netStatus === 'reconnecting'
                ? 'background: #FFF7DF; border: 3px solid #F38221; color: #9E4412;'
                : 'background: #FFF7DF; border: 3px solid #C9965B; color: #724929;');
        const netPillText = isOnline
            ? (text.NET_ONLINE || '🟢 온라인')
            : (netStatus === 'reconnecting'
                ? (text.NET_RECONNECTING || '🟡 재연결 중')
                : (text.NET_OFFLINE || '🟠 오프라인 AI 모드'));

        const roomRowsHtml = rooms.length === 0
            ? `<div style="flex: 1; min-height: 360px; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; color: #FDEAC8; text-align: center; padding: 24px;">${escapeHtml(text.EMPTY_ROOM_LIST)}</div>`
            : rooms.map(room => {
                const occ = RoomManager.getOccupiedCount(room);
                const isFull = occ >= room.maxPlayers;
                const isPlaying = room.status === 'playing';
                const statusText = isPlaying
                    ? text.STATUS_PLAYING
                    : (room.status === 'starting' ? text.STATUS_STARTING : text.STATUS_WAITING);
                const statusPill = isPlaying
                    ? `<span class="pill-badge" style="background: #5E72E4; color: #fff; border: 2px solid #C7D0FF;">${escapeHtml(statusText)}</span>`
                    : (room.status === 'starting'
                        ? `<span class="pill-badge" style="background: #F38221; color: #fff; border: 2px solid #FFE4AC;">${escapeHtml(statusText)}</span>`
                        : `<span class="pill-badge" style="background: #77C242; color: #16330A; border: 2px solid #DFF5BE;">${escapeHtml(statusText)}</span>`);
                const joinDisabled = isFull || isPlaying;

                return `
                    <div class="room-row-card">
                        <div style="font-size: 21px; font-weight: 900; padding-right: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${room.isPrivate ? '🔒 ' : ''}${escapeHtml(room.title)}
                        </div>
                        <div style="font-size: 18px; font-weight: bold; color: #6E3D1E; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">👑 ${escapeHtml(RoomManager.getHostName(room))}</div>
                        <div style="font-size: 19px; font-weight: 900; color: #4E2812;">${occ} / ${room.maxPlayers}${escapeHtml(text.PLAYERS_UNIT)}</div>
                        <div>${statusPill}</div>
                        <div style="text-align: right;">
                            <button type="button" class="btn-join-room-row ${joinDisabled ? 'btn-wood' : 'btn-orange'}" data-room-id="${escapeHtml(room.id)}" ${joinDisabled ? 'disabled' : ''} style="padding: 10px 24px; font-size: 17px; border-radius: 12px;">
                                ${escapeHtml(isFull ? text.BTN_ROOM_FULL : text.BTN_JOIN_ROOM)}
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

        let selectedCreateMax = meta.maxPlayers;
        const playerCountButtons = [];
        for (let n = meta.minPlayers; n <= meta.maxPlayers; n++) {
            const isSel = n === selectedCreateMax;
            playerCountButtons.push(`
                <button type="button" class="btn-create-max-players ${isSel ? 'btn-orange' : 'btn-wood'}" data-max="${n}" style="flex: 1; padding: 12px; font-size: 19px;">
                    ${n}${escapeHtml(text.PLAYERS_UNIT)}
                </button>
            `);
        }

        container.innerHTML = `
            <div class="arena-stage">
                <div class="page-shell">
                    <!-- 상단 헤더 -->
                    <div class="top-bar">
                        <div class="top-bar-left">
                            <button id="btn-back-arena" type="button" class="btn-wood" style="padding: 14px 24px; font-size: 21px; flex-shrink: 0;">${escapeHtml(text.BACK_TO_ARENA)}</button>
                            <div class="top-bar-titles" style="min-width: 0;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <span class="pill-badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 2px solid ${badgeBorder};">${escapeHtml(gameBadge)}</span>
                                </div>
                                <h1>${escapeHtml(gameTitle)}</h1>
                                <p>${escapeHtml(text.GAME_MAIN_SUBTITLE)}</p>
                            </div>
                        </div>

                        <div class="top-bar-right">
                            <span id="net-status-badge" class="pill-badge" style="height: 44px; padding: 0 18px; font-size: 16px; ${netPillStyle}">${escapeHtml(netPillText)}</span>
                            <button id="btn-lobby-settings" type="button" class="btn-green" style="padding: 14px 22px; font-size: 20px;">${escapeHtml(text.BTN_ROOM_SETTINGS || menuText.SETTINGS)}</button>
                            <button id="btn-lobby-info" type="button" class="btn-green" style="padding: 14px 22px; font-size: 20px;">${escapeHtml((OnboardingLang[lang] || OnboardingLang.ko).BTN_INFO || menuText.INFO)}</button>
                        </div>
                    </div>

                    <!-- 메인 컨텐츠 2열 -->
                    <div class="lobby-grid">
                        <section class="wood-panel lobby-list-panel">
                            <div class="lobby-list-toolbar">
                                <h2>${escapeHtml(text.ROOM_LIST_TITLE)} (${rooms.length})</h2>
                                <div style="display: flex; gap: 10px;">
                                    <button id="btn-refresh-rooms" type="button" class="btn-wood" style="padding: 11px 18px; font-size: 18px;">${escapeHtml(text.BTN_REFRESH)}</button>
                                    <button id="btn-open-join-code" type="button" class="btn-blue" style="padding: 11px 20px; font-size: 18px;">${escapeHtml(text.BTN_JOIN_BY_CODE)}</button>
                                    <button id="btn-open-create-room" type="button" class="btn-green" style="padding: 11px 24px; font-size: 18px;">${escapeHtml(text.BTN_CREATE_ROOM)}</button>
                                </div>
                            </div>

                            <div class="lobby-table-head">
                                <div>${escapeHtml(text.COL_TITLE)}</div>
                                <div>${escapeHtml(text.COL_HOST)}</div>
                                <div>${escapeHtml(text.COL_PLAYERS)}</div>
                                <div>${escapeHtml(text.COL_STATUS)}</div>
                                <div style="text-align: right;">${escapeHtml(text.COL_ACTION)}</div>
                            </div>

                            <div class="lobby-rows-scroll">
                                ${roomRowsHtml}
                            </div>
                        </section>

                        <aside class="wood-panel-deep lobby-rule-panel">
                            <div class="lobby-rule-banner">
                                <img class="rule-bg" src="${escapeHtml(bannerBg)}" alt="">
                                <div class="rule-scrim"></div>
                                <img class="rule-char" src="${escapeHtml(bannerChar)}" alt="${escapeHtml(gameTitle)}">
                                <div class="lobby-rule-banner-text">
                                    <span class="pill-badge" style="width: fit-content; background: ${badgeBg}; color: ${badgeColor}; border: 2px solid ${badgeBorder};">${escapeHtml(bannerVerText)}</span>
                                    <div style="font-size: 26px; font-weight: 900; color: #FFF8EE; text-shadow: 0 2px 8px rgba(0,0,0,0.7);">${escapeHtml(gameTitle)}</div>
                                </div>
                            </div>

                            <div class="parchment-card lobby-rule-card">
                                <h2>📜 ${escapeHtml(text.RULE_SUMMARY_TITLE)}</h2>
                                ${rulesList.map(line => `<div class="rule-line">${escapeHtml(line)}</div>`).join('')}
                            </div>
                        </aside>
                    </div>

                    <!-- 모달: 새로운 게임룸 생성 -->
                    <div id="modal-create-room" class="arena-modal-backdrop" style="z-index: 500;">
                        <div class="arena-modal-box">
                            <h2 style="margin: 0 0 22px; font-size: 32px; font-weight: 900; text-align: center; color: #4E2812;">${escapeHtml(text.CREATE_MODAL_TITLE)}</h2>

                            <div style="margin-bottom: 18px;">
                                <label style="display: block; font-size: 18px; font-weight: 800; margin-bottom: 8px;">${escapeHtml(text.ROOM_TITLE_LABEL)}</label>
                                <input id="create-room-title" class="modal-input" type="text" maxlength="20" value="${escapeHtml(defaultTitle)}">
                            </div>

                            <div style="margin-bottom: 18px;">
                                <label style="display: block; font-size: 18px; font-weight: 800; margin-bottom: 8px;">${escapeHtml(text.MAX_PLAYERS_LABEL)}</label>
                                <div id="create-room-max-group" style="display: flex; gap: 10px;">
                                    ${playerCountButtons.join('')}
                                </div>
                            </div>

                            <div style="margin-bottom: 24px;">
                                <label style="display: block; font-size: 18px; font-weight: 800; margin-bottom: 8px;">${escapeHtml(text.VISIBILITY_LABEL)}</label>
                                <div style="display: flex; gap: 20px; font-size: 18px; font-weight: bold;">
                                    <label style="cursor: pointer;"><input type="radio" name="room-visibility" value="public" checked> ${escapeHtml(text.PUBLIC_ROOM)}</label>
                                    <label style="cursor: pointer;"><input type="radio" name="room-visibility" value="private"> ${escapeHtml(text.PRIVATE_ROOM)}</label>
                                </div>
                                <input id="create-room-password" class="modal-input" type="password" maxlength="16" placeholder="${escapeHtml(text.JOIN_PASSWORD_OPTIONAL || '비밀번호 (비공개 시 선택)')}" style="margin-top: 10px; padding: 10px 14px; font-size: 17px;">
                            </div>

                            <div style="display: flex; gap: 14px;">
                                <button id="btn-cancel-create" type="button" class="btn-wood" style="flex: 1; padding: 14px; font-size: 20px;">${escapeHtml(text.BTN_CANCEL)}</button>
                                <button id="btn-confirm-create" type="button" class="btn-orange" style="flex: 1.4; padding: 14px; font-size: 20px;">${escapeHtml(text.BTN_CONFIRM_CREATE)}</button>
                            </div>
                        </div>
                    </div>

                    <!-- 모달: 방 코드로 참가 -->
                    <div id="modal-join-code" class="arena-modal-backdrop" style="z-index: 500;">
                        <div class="arena-modal-box">
                            <h2 style="margin: 0 0 18px; font-size: 32px; font-weight: 900; text-align: center; color: #4E2812;">${escapeHtml(text.JOIN_MODAL_TITLE)}</h2>

                            <div style="margin-bottom: 12px;">
                                <label style="display: block; font-size: 18px; font-weight: 800; margin-bottom: 8px;">${escapeHtml(text.JOIN_CODE_LABEL)}</label>
                                <input id="input-join-code" class="modal-input" type="text" maxlength="16" placeholder="${escapeHtml(text.JOIN_CODE_PLACEHOLDER)}" style="font-family: monospace; text-align: center; letter-spacing: 3px; font-size: 26px; text-transform: uppercase;">
                            </div>

                            <div style="margin-bottom: 12px;">
                                <input id="input-join-password" class="modal-input" type="password" maxlength="16" placeholder="${escapeHtml(text.JOIN_PASSWORD_OPTIONAL || '비밀번호 (설정된 경우)')}" style="padding: 10px 14px; font-size: 17px;">
                            </div>

                            <p style="margin: 0 0 24px; font-size: 15px; color: #724929; text-align: center; font-weight: bold;">${escapeHtml(text.JOIN_CODE_HINT)}</p>

                            <div style="display: flex; gap: 14px;">
                                <button id="btn-cancel-join" type="button" class="btn-wood" style="flex: 1; padding: 14px; font-size: 20px;">${escapeHtml(text.BTN_CANCEL)}</button>
                                <button id="btn-confirm-join" type="button" class="btn-blue" style="flex: 1.4; padding: 14px; font-size: 20px;">${escapeHtml(text.BTN_CONFIRM_JOIN)}</button>
                            </div>
                        </div>
                    </div>

                    ${renderArenaSettingsModalHtml({
                        popupId: 'popup-lobby-settings',
                        idPrefix: 'lobby-settings',
                        bgmSliderId: 'lobby-bgm-slider',
                        sfxSliderId: 'lobby-sfx-slider',
                        fontGothicId: 'lobby-font-gothic',
                        fontGulimId: 'lobby-font-gulim',
                        langKoId: 'lobby-lang-ko',
                        langEnId: 'lobby-lang-en',
                        langJaId: 'lobby-lang-ja',
                        closeBtnId: 'close-lobby-settings',
                        lang,
                        menuText,
                        currentNickname: RoomManager.localPlayer?.name || ''
                    })}

                    ${showAfkPenalty ? (() => {
                        const penaltyTitle = kickReason === 'HOST_IDLE_BANNED'
                            ? (text.HOST_IDLE_BAN_TITLE || text.AFK_PENALTY_TITLE)
                            : (kickReason === 'HOST_IDLE_KICKED'
                                ? (text.HOST_IDLE_KICK_TITLE || text.AFK_PENALTY_TITLE)
                                : text.AFK_PENALTY_TITLE);
                        const penaltyDesc = kickReason === 'HOST_IDLE_BANNED'
                            ? (text.HOST_IDLE_BAN_DESC || text.AFK_PENALTY_DESC)
                            : (kickReason === 'HOST_IDLE_KICKED'
                                ? (text.HOST_IDLE_KICK_DESC || text.AFK_PENALTY_DESC)
                                : text.AFK_PENALTY_DESC);
                        return `
                    <div id="modal-afk-penalty" class="arena-modal-backdrop open" style="z-index: 9600; opacity: ${afkPenaltyFaded ? 1 : 0}; transition: opacity 0.35s ease;">
                        <div class="arena-modal-box" style="width: 580px; text-align: center; border-color: #D9483B;">
                            <h2 style="margin: 0 0 18px 0; font-size: 32px; font-weight: 900; color: #B02E24;">⚠️ ${escapeHtml(penaltyTitle)}</h2>
                            <p style="margin: 0 0 28px 0; font-size: 19px; font-weight: bold; line-height: 1.65; color: #4E2812; white-space: pre-line;">${escapeHtml(penaltyDesc)}</p>
                            <button id="btn-afk-penalty-confirm" type="button" class="btn-danger" style="padding: 14px 44px; font-size: 21px;">${escapeHtml(text.AFK_PENALTY_BTN)}</button>
                        </div>
                    </div>
                    `;
                    })() : ''}
                </div>
            </div>
        `;

        if (showAfkPenalty) {
            const penaltyModal = container.querySelector('#modal-afk-penalty');
            const confirmPenaltyBtn = container.querySelector('#btn-afk-penalty-confirm');
            if (penaltyModal && !afkPenaltyFaded) {
                afkPenaltyFaded = true;
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => { penaltyModal.style.opacity = '1'; });
                } else {
                    penaltyModal.style.opacity = '1';
                }
            }
            if (confirmPenaltyBtn) {
                confirmPenaltyBtn.onclick = () => {
                    showAfkPenalty = false;
                    if (penaltyModal && penaltyModal.parentNode) penaltyModal.remove();
                };
            }
        }

        // 이벤트 바인딩
        container.querySelector('#btn-back-arena').onclick = () => changeScene('menu');
        container.querySelector('#btn-refresh-rooms').onclick = async () => {
            await RoomManager.fetchRooms(gameId);
            render();
        };

        const openLobbyInfoBtn = container.querySelector('#btn-lobby-info');
        if (openLobbyInfoBtn) {
            openLobbyInfoBtn.onclick = () => openInfoPopup(container, { gameId });
        }

        bindArenaSettingsHandlers({
            container,
            popupId: 'popup-lobby-settings',
            openBtnId: 'btn-lobby-settings',
            idPrefix: 'lobby-settings',
            bgmSliderId: 'lobby-bgm-slider',
            sfxSliderId: 'lobby-sfx-slider',
            fontGothicId: 'lobby-font-gothic',
            fontGulimId: 'lobby-font-gulim',
            langKoId: 'lobby-lang-ko',
            langEnId: 'lobby-lang-en',
            langJaId: 'lobby-lang-ja',
            closeBtnId: 'close-lobby-settings'
        });

        // 방 생성 / 코드 참가 모달 제어
        const createModal = container.querySelector('#modal-create-room');
        const joinModal = container.querySelector('#modal-join-code');
        const joinInput = container.querySelector('#input-join-code');
        const joinPassInput = container.querySelector('#input-join-password');
        const createPassInput = container.querySelector('#create-room-password');
        const titleInput = container.querySelector('#create-room-title');

        const maxBtns = container.querySelectorAll('.btn-create-max-players');
        const syncCreateMaxBtnStyles = () => {
            maxBtns.forEach(btn => {
                const isSel = Number(btn.dataset.max) === selectedCreateMax;
                btn.classList.toggle('btn-orange', isSel);
                btn.classList.toggle('btn-wood', !isSel);
            });
        };
        maxBtns.forEach(btn => {
            btn.onclick = () => {
                selectedCreateMax = Number(btn.dataset.max) || meta.maxPlayers;
                syncCreateMaxBtnStyles();
            };
        });

        container.querySelector('#btn-open-create-room').onclick = () => {
            titleInput.value = pickRandomCreateTitle(text, text[defaultRoomTitleKey] || gameTitle);
            selectedCreateMax = meta.maxPlayers;
            syncCreateMaxBtnStyles();
            createModal.classList.add('open');
            titleInput.focus();
        };
        container.querySelector('#btn-cancel-create').onclick = () => {
            createModal.classList.remove('open');
        };
        if (createModal) createModal.onclick = (e) => { if (e.target === createModal) createModal.classList.remove('open'); };

        const submitCreate = async () => {
            const title = titleInput.value;
            const maxPlayers = selectedCreateMax || meta.maxPlayers;
            const vis = container.querySelector('input[name="room-visibility"]:checked')?.value;
            const res = await RoomManager.createRoom({
                gameId,
                title,
                isPrivate: vis === 'private',
                password: createPassInput ? createPassInput.value : '',
                maxPlayers
            });
            if (!res.ok) {
                if (res.errorCode === 'ERR_ROOM_CREATE_BANNED') {
                    const remainMs = Math.max(60000, Number(res.errorData?.bannedUntil || 0) - Date.now());
                    const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
                    const banMsg = (text.ERR_ROOM_CREATE_BANNED || '방 생성이 제한되었습니다. ({min}분)')
                        .replace('{min}', String(remainMin));
                    showLobbyToast(container, banMsg, 4000);
                    return;
                }
                showLobbyToast(container, text[res.errorCode] || text.ERR_TITLE_EMPTY);
                return;
            }
            changeScene('room', { toastMsg: text.TOAST_ROOM_CREATED });
        };
        container.querySelector('#btn-confirm-create').onclick = submitCreate;
        titleInput.onkeydown = (e) => {
            if (e.key === 'Enter') submitCreate();
        };

        container.querySelector('#btn-open-join-code').onclick = () => {
            joinModal.classList.add('open');
            joinInput.value = '';
            if (joinPassInput) joinPassInput.value = '';
            joinInput.focus();
        };
        container.querySelector('#btn-cancel-join').onclick = () => {
            joinModal.classList.remove('open');
        };
        if (joinModal) joinModal.onclick = (e) => { if (e.target === joinModal) joinModal.classList.remove('open'); };

        const submitJoinByCode = async () => {
            const res = await RoomManager.joinRoomByCode(
                joinInput.value,
                gameId,
                joinPassInput ? joinPassInput.value : ''
            );
            if (!res.ok) {
                showLobbyToast(container, text[res.errorCode] || text.ERR_NOT_FOUND);
                return;
            }
            changeScene('room');
        };
        container.querySelector('#btn-confirm-join').onclick = submitJoinByCode;
        joinInput.onkeydown = (e) => {
            if (e.key === 'Enter') submitJoinByCode();
        };

        container.querySelectorAll('.btn-join-room-row').forEach(btn => {
            btn.onclick = async () => {
                const roomId = btn.dataset.roomId;
                const res = await RoomManager.joinRoomById(roomId, gameId);
                if (!res.ok) {
                    showLobbyToast(container, text[res.errorCode] || text.ERR_NOT_FOUND);
                    await RoomManager.fetchRooms(gameId);
                    render();
                    return;
                }
                changeScene('room');
            };
        });
    };

    const langHandler = () => render();
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            container.querySelector('#modal-create-room')?.classList.remove('open');
            container.querySelector('#modal-join-code')?.classList.remove('open');
        }
    };
    document.addEventListener('languageChanged', langHandler);
    document.addEventListener('keydown', escHandler);

    let isCleanedUp = false;
    let tabCheckInFlight = false;

    const verifyTabThenLoad = async () => {
        if (isCleanedUp || tabCheckInFlight) return true;
        if (!RoomManager.isOnline()) return true;
        tabCheckInFlight = true;
        try {
            const tabRes = await ensureGameTabAccess(container, gameId);
            return Boolean(tabRes?.allowed);
        } finally {
            tabCheckInFlight = false;
        }
    };

    const unsubscribeRoom = RoomManager.subscribe((evtName, payload) => {
        if (isCleanedUp) return;
        if (evtName === 'NETWORK_STATUS' || evtName === 'HELLO_ACK') {
            verifyTabThenLoad().then((allowed) => {
                if (!allowed || isCleanedUp) return;
                RoomManager.fetchRooms(gameId).then(() => {
                    if (!isCleanedUp) render();
                });
            });
        } else if (evtName === 'LOBBY_ROOMS' && payload?.gameId === gameId) {
            render();
        }
    });

    container._cleanupScene = () => {
        isCleanedUp = true;
        document.removeEventListener('languageChanged', langHandler);
        document.removeEventListener('keydown', escHandler);
        unsubscribeRoom();
    };

    render();
    RoomManager.initNetwork().then(async (netRes) => {
        if (isCleanedUp) return;
        const allowed = await verifyTabThenLoad();
        if (!allowed || isCleanedUp) return;

        const activeRoom = netRes?.helloAck?.room;
        if (activeRoom && activeRoom.gameId === gameId) {
            if (activeRoom.status === 'playing' && netRes.helloAck.gameSnapshot) {
                changeScene(meta.sceneGame, {
                    room: activeRoom,
                    initialSnapshot: netRes.helloAck.gameSnapshot
                });
                return;
            }
            if (activeRoom.status === 'waiting' || activeRoom.status === 'countdown') {
                changeScene('room');
                return;
            }
        }
        await RoomManager.fetchRooms(gameId);
        if (!isCleanedUp) render();
    });
}
