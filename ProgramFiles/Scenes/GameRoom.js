// ProgramFiles/Scenes/GameRoom.js
// 대기방 UI (온라인 서버 실시간 동기화 + 오프라인 로컬 AI 연습 겸용)

import { changeScene } from '../Main.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import { escapeHtml, showLobbyToast, ensureGameTabAccess } from '../Lobby/LobbyUI.js';
import { getGameMeta } from '../System/GameRegistry.js';
import { ErrorTracker } from '../System/ErrorTracker.js';
import { LangState } from '../System/LanguageManager.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { MenuLang } from '../System/Index/MainMenuIndex.js';
import { OnboardingLang } from '../System/Index/ArenaOnboardingIndex.js';
import {
    openInfoPopup,
    closeInfoPopup,
    renderArenaSettingsModalHtml,
    bindArenaSettingsHandlers
} from '../Lobby/InfoPopupUI.js';
import { getModeConfig, normalizeMarbleMode } from '../System/Index/Marble/MarblePriceIndex.js';

const HOST_START_IDLE_TIMEOUT_MS = 30000;

function getAiLabel(slotOrDiff, text, gameId = 'marble') {
    const raw = (typeof slotOrDiff === 'object' && slotOrDiff !== null)
        ? (slotOrDiff.aiDifficulty || slotOrDiff.aiType)
        : slotOrDiff;
    const key = String(raw || '').toLowerCase();

    if (gameId === 'unos') {
        if (key === 'mild' || key === 'easy' || key === '1' || key === '순한맛') {
            return text.AI_DIFF_MILD || '순한맛';
        }
        if (key === 'spicy' || key === 'hard' || key === 'nuclear' || key === 'magma' || key === '3' || key === '매운맛') {
            return text.AI_DIFF_SPICY || '매운맛';
        }
        return text.AI_DIFF_NORMAL || '보통맛';
    }

    switch (key) {
        case 'mild':
        case 'very_easy':
            return text.AI_DIFF_MILD || '순한맛';
        case 'normal':
        case 'easy':
            return text.AI_DIFF_NORMAL || '보통맛';
        case 'spicy':
        case 'medium':
            return text.AI_DIFF_SPICY || '매운맛';
        case 'nuclear':
        case 'hard':
            return text.AI_DIFF_NUCLEAR || '핵불맛';
        case 'magma':
        case 'very_hard':
            return text.AI_DIFF_MAGMA || '마그맛';
        default:
            return text.AI_DIFF_NORMAL || '보통맛';
    }
}

function buildModeDetailHtml(modeId, modeCfg, moneyStr, modeMeta) {
    const maxTurn = Number(modeCfg?.maxTurn) || modeMeta.turns || 20;
    const dayStart = Number(modeCfg?.timeDayStartTurn) || 5;
    const slotDur = Number(modeCfg?.timeSlotDuration) || 5;
    const nightEnd = Math.min(maxTurn, dayStart + (slotDur * 2) - 1);
    const hasTreasure = Boolean(modeCfg?.enableTreasureAndRequiem);

    let ruleLines = [];
    if (modeId === 'speed') {
        ruleLines = [
            '"보물 카드"가 등장하지 않습니다.',
            '빵주정비반장이 공석이 됩니다.',
            '빵주가 3턴부터 해금되며, 그 전에 도착시 50만 달러를 지불하고 개방할 수 있습니다.',
            '1회를 완주하거나 3턴까지 왕국을 지을 수 없습니다.'
        ];
    } else if (modeId === 'basic') {
        ruleLines = [
            '"보물 카드"가 등장하지 않습니다.',
            '빵주가 4턴부터 해금됩니다.',
            '1회를 완주하거나 4턴까지 왕국을 지을 수 없습니다.'
        ];
    } else {
        ruleLines = [
            '획득한 보물카드는 망가진제단에서 100만 달러로 바꿀 수 있습니다.',
            '보물카드가 6장이 모이면 세상은 그을음상태가 됩니다.',
            '그을음상태가 되었을때 제단에 교환된 보물카드가 없다면, 보물카드를 가장 많이 보유하고있거나, 가장 오랫동안 들고있는 플레이어가 윤회를 얻습니다.',
            '그을음이 발생되면 모든 영토의 매입비와 건물의 건설비가 0.5배로 하락하게 됩니다.',
            '빛무리가 발생되면 모든 수입이 1.5배(긍정 효과 2배)로 증가합니다.'
        ];
        if (modeId === 'ember') {
            ruleLines.push('제단에 도착하지 않아도 1턴부터 보물 카드가 활성화됩니다.');
        }
    }

    const gimmickLines = hasTreasure
        ? [
            `시간대 : ${dayStart}턴 ~ ${nightEnd}턴`,
            '그을음 : 3턴',
            '빛무리 : 2턴'
        ]
        : [`시간대 : ${dayStart}턴 ~ ${nightEnd}턴`];

    return `
        <div class="parchment-card mode-detail-parchment">
            <div><strong>• 최대 턴수 :</strong> ${maxTurn}턴 (${escapeHtml(modeMeta.time)})</div>
            <div><strong>• 초기자금 :</strong> 시작 순서대로 ${escapeHtml(moneyStr)}</div>
            <div>
                <div style="font-weight: 900; color: #9E4412;">• 월드 기믹</div>
                <div style="padding-left: 10px; font-weight: bold; display: flex; flex-direction: column; gap: 2px;">
                    ${gimmickLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
                </div>
            </div>
            <div>
                <div style="font-weight: 900; color: #6E3D1E;">• 제한요소</div>
                <div style="padding-left: 10px; display: flex; flex-direction: column; gap: 3px;">
                    ${ruleLines.map(line => `<div>- ${escapeHtml(line)}</div>`).join('')}
                </div>
            </div>
            <div style="margin-top: 4px; padding-top: 8px; border-top: 2px dashed rgba(138, 86, 44, 0.3); font-size: 13.5px; color: #724929; font-weight: bold; display: flex; flex-direction: column; gap: 2px;">
                <div>• AI 난이도는 순한맛이 가장 쉽고, 마그맛이 가장 어렵습니다.</div>
                <div>• 룰에 익숙하지 않은 분은 순한맛이나 보통맛을 추천합니다.</div>
                <div>• 적당한 긴장감이 좋으시면 매운맛을 추천합니다.</div>
                <div>• 도전을 좋아하신다면 핵불맛과 마그맛이 준비되어있습니다.</div>
                <div>• AI의 플레이 성향은 랜덤으로 배정됩니다.</div>
            </div>
        </div>
    `;
}

export function initRoom(container, sceneParams = null) {
    let localCountdownTimer = null;
    let localCountdownSec = null;
    let localHostIdleTimer = null;
    let prevIdleWarningActive = false;
    let isHostIdleWarningOpen = false;

    const clearLocalHostIdleTimer = () => {
        if (localHostIdleTimer) {
            clearTimeout(localHostIdleTimer);
            localHostIdleTimer = null;
        }
    };

    const clearLocalCountdown = () => {
        clearLocalHostIdleTimer();
        if (localCountdownTimer) {
            clearInterval(localCountdownTimer);
            localCountdownTimer = null;
        }
        localCountdownSec = null;
        const room = RoomManager.getCurrentRoom();
        if (!RoomManager.isOnline() && room && room.status === 'countdown') {
            room.status = 'waiting';
            room.countdownSec = 0;
        }
    };

    const startLocalCountdown = () => {
        if (RoomManager.isOnline()) return;
        const room = RoomManager.getCurrentRoom();
        if (!room || localCountdownTimer !== null) return;
        const gameMeta = getGameMeta(room.gameId);
        if (!RoomManager.canStart(room).canStart) return;

        clearLocalHostIdleTimer();
        closeInfoPopup(container);
        room.status = 'countdown';
        localCountdownSec = 3;
        room.countdownSec = 3;
        localCountdownTimer = setInterval(() => {
            const liveRoom = RoomManager.getCurrentRoom();
            if (!liveRoom || !RoomManager.canStart(liveRoom).canStart) {
                clearLocalCountdown();
                render();
                return;
            }
            localCountdownSec -= 1;
            liveRoom.countdownSec = localCountdownSec;
            if (localCountdownSec <= 0) {
                clearLocalCountdown();
                const initialSnapshot = liveRoom.gameId === 'unos'
                    ? null
                    : RoomManager.startLocalGameSession(liveRoom);
                const targetScene = gameMeta?.sceneGame || (liveRoom.gameId === 'unos' ? 'unos' : 'marble');
                changeScene(targetScene, { room: liveRoom, initialSnapshot });
                return;
            }
            render();
        }, 1000);
    };

    const syncLocalCountdownState = () => {
        if (RoomManager.isOnline()) return;
        const room = RoomManager.getCurrentRoom();
        if (!room) {
            clearLocalCountdown();
            return;
        }
        const { canStart } = RoomManager.canStart(room);
        if (!canStart && localCountdownTimer !== null) {
            clearLocalCountdown();
        }
        if (localCountdownTimer === null && RoomManager.shouldRunOfflineHostIdleTimer(room)) {
            if (!localHostIdleTimer) {
                const gameMeta = getGameMeta(room.gameId);
                localHostIdleTimer = setTimeout(() => {
                    localHostIdleTimer = null;
                    const kickNotice = RoomManager.handleOfflineHostIdleTimeout();
                    if (kickNotice) {
                        clearLocalCountdown();
                        changeScene(gameMeta?.sceneMain || 'marble_main', { kickNotice });
                    }
                }, HOST_START_IDLE_TIMEOUT_MS);
            }
        } else {
            clearLocalHostIdleTimer();
        }
    };

    const render = () => {
        const room = RoomManager.getCurrentRoom();
        if (!room) {
            clearLocalCountdown();
            changeScene('menu');
            return;
        }
        ErrorTracker.markTransitionComplete('room');

        const isOnline = RoomManager.isOnline();
        const lang = LangState.current || 'ko';
        const text = LobbyLang[lang] || LobbyLang.ko;
        const menuText = MenuLang[lang] || MenuLang.ko;
        const gameMeta = getGameMeta(room.gameId);
        const gameTitle = menuText[gameMeta?.nameKey]
            || (room.gameId === 'unos' ? (text.UNOS_TITLE || '우노스 (UNOS)') : (text.MARBLE_TITLE || '엘리아스 마블'));
        const isUnos = room.gameId === 'unos';
        const badgeBg = isUnos ? '#5E72E4' : '#76C140';
        const badgeColor = isUnos ? '#ffffff' : '#16330A';
        const badgeBorder = isUnos ? '#C5CEFF' : '#D6F5B3';
        const netPillStyle = isOnline
            ? 'background: #FFFBF0; color: #2B6213; border: 2px solid #77C242;'
            : 'background: #FFF7DF; color: #724929; border: 2px solid #C9965B;';

        const mySlot = RoomManager.getMySlot(room);
        const summary = RoomManager.getReadinessSummary(room);
        const isMyHost = room.hostId === RoomManager.localPlayer.id;
        const isMyReady = Boolean(mySlot && mySlot.isReady);
        const canEditMode = isMyHost && room.status === 'waiting';
        const currentMode = normalizeMarbleMode(room.customOptions?.gameMode);
        const currentModeCfg = getModeConfig(currentMode);

        const idleWarningActive = RoomManager.shouldShowHostIdleWarning(room);
        if (!prevIdleWarningActive && idleWarningActive) {
            isHostIdleWarningOpen = true;
        } else if (!idleWarningActive) {
            isHostIdleWarningOpen = false;
        }
        prevIdleWarningActive = idleWarningActive;

        const modeItems = [
            { id: 'speed', label: text.MODE_SPEED || '간식', turns: 10, time: text.MODE_SPEED_TIME || '약 10~15분' },
            { id: 'basic', label: text.MODE_BASIC || '정식', turns: 15, time: text.MODE_BASIC_TIME || '약 20~25분' },
            { id: 'feast', label: text.MODE_FEAST || '특식', turns: 20, time: text.MODE_FEAST_TIME || '약 25~30분' },
            { id: 'ember', label: text.MODE_EMBER || '불씨', turns: 15, time: text.MODE_EMBER_TIME || '약 20~25분' }
        ];
        const selectedModeMeta = modeItems.find(m => m.id === currentMode) || modeItems[3];
        const modeButtonsHtml = modeItems.map(m => {
            const active = m.id === currentMode;
            return `
                <button type="button" class="btn-room-mode mode-btn ${active ? 'active' : ''}" data-mode="${m.id}" ${!canEditMode ? 'disabled' : ''}>
                    <span style="font-size: 20px; font-weight: 900; white-space: nowrap;">${escapeHtml(m.label)}</span>
                    <span style="font-size: 14px; font-weight: bold; white-space: nowrap;">${m.turns} Turn</span>
                    <span style="font-size: 13px; opacity: 0.9; white-space: nowrap;">⏱ ${escapeHtml(m.time)}</span>
                </button>
            `;
        }).join('');
        const initialMoneyOrderStr = (currentModeCfg.initialMoneyByOrder || [5000000, 5250000, 5500000, 5750000])
            .map(v => `${Math.round(v / 10000)}만`)
            .join(' / ');

        const activeCountdown = isOnline
            ? (room.status === 'countdown' ? (room.countdownSec || 3) : null)
            : localCountdownSec;

        const slotsHtml = room.slots.map(slot => {
            if (slot.type === 'empty') {
                const hostSlotControls = isMyHost ? `
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn-slot-add-ai btn-blue" data-idx="${slot.slotIndex}" style="padding: 8px 16px; font-size: 16px; border-radius: 10px;">${escapeHtml(text.BTN_ADD_AI)}</button>
                        ${!isOnline ? `<button type="button" class="btn-slot-add-mock btn-wood" data-idx="${slot.slotIndex}" style="padding: 8px 16px; font-size: 16px; border-radius: 10px;">${escapeHtml(text.BTN_ADD_TEST_USER)}</button>` : ''}
                    </div>
                ` : '';
                return `
                    <div class="slot-empty">
                        <div style="display: flex; align-items: center; gap: 14px; font-size: 20px; font-weight: bold;">
                            <span style="width: 24px; height: 24px; border-radius: 50%; background: rgba(255, 224, 173, 0.28); display: inline-block;"></span>
                            <span>${slot.slotIndex + 1}. ${escapeHtml(text.ROLE_EMPTY)}</span>
                        </div>
                        ${hostSlotControls}
                    </div>
                `;
            }

            const isMe = slot.id === RoomManager.localPlayer.id;
            const roleLabel = slot.type === 'ai'
                ? `${text.ROLE_AI} (${getAiLabel(slot, text, room.gameId)})`
                : (slot.isHost ? text.ROLE_HOST : text.ROLE_GUEST);
            const meTag = isMe ? ` <span style="color: #D95318;">${escapeHtml(text.TAG_ME)}</span>` : '';
            const offlineTag = (slot.type === 'human' && slot.isConnected === false)
                ? `<span class="pill-badge" style="margin-left: 8px; height: 26px; padding: 0 10px; font-size: 13px; background: #B02E24; color: #fff;">${escapeHtml(text.TAG_OFFLINE || 'OFFLINE')}</span>`
                : '';

            const statusBadge = slot.isHost
                ? `<span class="pill-badge" style="background: linear-gradient(135deg, #F38221, #D95318); color: #fff; border: 2px solid #FFE4AC;">${escapeHtml(text.ROLE_HOST)}</span>`
                : (slot.isReady
                    ? `<span class="pill-badge" style="background: #77C242; color: #16330A; border: 2px solid #DFF5BE;">${escapeHtml(text.STATE_READY)}</span>`
                    : `<span class="pill-badge" style="background: #8B7363; color: #fff;">${escapeHtml(text.STATE_WAITING)}</span>`);

            let actionBtns = '';
            if (isMyHost && room.status === 'waiting') {
                if (slot.type === 'ai') {
                    actionBtns = `
                        <button type="button" class="btn-slot-ai-cycle btn-blue" data-idx="${slot.slotIndex}" style="padding: 7px 13px; font-size: 15px; border-radius: 10px;">${escapeHtml(text.BTN_AI_CYCLE)}</button>
                        <button type="button" class="btn-slot-clear btn-danger" data-idx="${slot.slotIndex}" style="padding: 7px 13px; font-size: 15px; border-radius: 10px;">${escapeHtml(text.BTN_CLEAR_SLOT)}</button>
                    `;
                } else if (slot.type === 'human' && !slot.isHost && (isOnline || slot.isMockHuman)) {
                    actionBtns = `
                        <button type="button" class="btn-slot-transfer-host btn-orange" data-idx="${slot.slotIndex}" style="padding: 7px 13px; font-size: 15px; border-radius: 10px;">${escapeHtml(text.BTN_TRANSFER_HOST || '방장 위임')}</button>
                        <button type="button" class="btn-slot-clear btn-danger" data-idx="${slot.slotIndex}" style="padding: 7px 13px; font-size: 15px; border-radius: 10px;">${escapeHtml(text.BTN_CLEAR_SLOT)}</button>
                    `;
                }
            }

            return `
                <div class="slot-card ${isMe ? 'is-me' : ''}">
                    <div style="display: flex; align-items: center; gap: 16px; min-width: 0;">
                        <span style="width: 26px; height: 26px; border-radius: 50%; background: ${slot.color}; border: 3px solid #4E2812; flex-shrink: 0;"></span>
                        <div style="min-width: 0;">
                            <div style="font-size: 22px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${escapeHtml(slot.name)}${meTag}${offlineTag}
                            </div>
                            <div style="font-size: 15px; font-weight: bold; color: #724929; margin-top: 2px;">${escapeHtml(roleLabel)}</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                        ${actionBtns}
                        ${statusBadge}
                    </div>
                </div>
            `;
        }).join('');

        let statusBannerHtml = '';
        if (activeCountdown !== null) {
            const msg = text.STATUS_ALL_READY_COUNTDOWN.replace('{sec}', activeCountdown);
            statusBannerHtml = `<div class="room-status-banner" style="background: linear-gradient(135deg, #77C242, #4E8F26); color: #fff; border: 2px solid #DFF5BE;">${escapeHtml(msg)}</div>`;
        } else if (!summary.hasMinPlayers) {
            const msg = text.STATUS_NEED_MIN_PLAYERS
                .replace('{min}', gameMeta.minPlayers)
                .replace('{cur}', summary.occupied);
            statusBannerHtml = `<div class="room-status-banner" style="background: #B02E24; color: #fff; border: 2px solid #FFC4BE;">⚠️ ${escapeHtml(msg)}</div>`;
        } else if (summary.humanCount === 0 || summary.allHumansReady) {
            const readyMsg = isMyHost
                ? (text.STATUS_HOST_READY_TO_START || '🎉 전원 준비 완료! 게임 시작 버튼을 눌러주는것이다!')
                : (text.STATUS_GUEST_READY_WAIT || '🎉 전원 준비 완료! 게임이 시작될 때 까지 잠시 기다리는것이다!');
            statusBannerHtml = `<div class="room-status-banner" style="background: rgba(119, 194, 66, 0.25); color: #E4FACC; border: 2px solid #77C242;">${escapeHtml(readyMsg)}</div>`;
        } else {
            const msg = text.STATUS_WAIT_ALL_READY
                .replace('{ready}', summary.readyHumanCount)
                .replace('{cur}', summary.humanCount);
            statusBannerHtml = `<div class="room-status-banner" style="background: rgba(42, 20, 8, 0.45); color: #FDEAC8; border: 2px solid rgba(247, 199, 68, 0.4);">⏳ ${escapeHtml(msg)}</div>`;
        }

        const isCountdown = activeCountdown !== null || room.status === 'countdown';
        const isReadyBtnDisabled = !isMyHost && isCountdown;
        let readyBtnLabel = isMyReady ? text.BTN_READY_CANCEL : text.BTN_READY;
        let readyBtnClass = isMyReady ? 'btn-orange' : 'btn-green';
        if (isMyHost) {
            readyBtnLabel = isCountdown
                ? `❌ ${text.BTN_CANCEL_START || '시작 취소'}`
                : `🚀 ${text.BTN_START_GAME || '게임 시작'}`;
            readyBtnClass = isCountdown ? 'btn-danger' : 'btn-green';
        }

        container.innerHTML = `
            <div class="arena-stage">
                <div class="page-shell">
                    <!-- 상단 헤더 -->
                    <div class="top-bar">
                        <div class="top-bar-left">
                            <button id="btn-leave-room" type="button" class="btn-danger" style="padding: 14px 22px; font-size: 20px; flex-shrink: 0;">${escapeHtml(text.BACK_TO_GAME_MAIN)}</button>
                            <div class="top-bar-titles" style="min-width: 0; flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;">
                                    <span class="pill-badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 2px solid ${badgeBorder};">${escapeHtml(gameTitle)}</span>
                                    <span class="pill-badge" style="background: #6E3D1E; color: #FFF4DC; border: 2px solid #C9965B;">${escapeHtml(room.isPrivate ? text.VISIBILITY_PRIVATE_BADGE : text.VISIBILITY_PUBLIC_BADGE)}</span>
                                    <span class="pill-badge" style="${netPillStyle}">${escapeHtml(isOnline ? (text.NET_ONLINE || '🟢 온라인') : (text.NET_OFFLINE || '🟠 오프라인'))}</span>
                                </div>
                                <h1>${escapeHtml(room.title)}</h1>
                            </div>
                        </div>

                        <!-- 우측 상단: 방 코드 공유 + [설정] + [정보] 바 -->
                        <div class="top-bar-right">
                            <div class="room-code-box">
                                <div>
                                    <div style="font-size: 13px; color: #FDEAC8; font-weight: bold;">${escapeHtml(text.ROOM_CODE_LABEL)}</div>
                                    <div id="room-code-display" style="font-family: monospace; font-size: 24px; font-weight: 900; letter-spacing: 1.5px; color: #FFE68B;">${escapeHtml(room.code)}</div>
                                </div>
                                <button id="btn-copy-room-code" type="button" class="btn-orange" style="padding: 9px 15px; font-size: 16px;">${escapeHtml(text.BTN_COPY_CODE)}</button>
                            </div>

                            <button id="btn-room-settings" type="button" class="btn-green" ${isCountdown ? 'disabled' : ''} style="padding: 14px 20px; font-size: 19px;">${escapeHtml(text.BTN_ROOM_SETTINGS || menuText.SETTINGS)}</button>
                            <button id="btn-room-info" type="button" class="btn-green" ${isCountdown ? 'disabled' : ''} style="padding: 14px 20px; font-size: 19px;">${escapeHtml((OnboardingLang[lang] || OnboardingLang.ko).BTN_INFO || menuText.INFO)}</button>
                        </div>
                    </div>

                    <!-- 룸 본문 2열 -->
                    <div class="room-grid">
                        <!-- 좌측: 플레이어 슬롯 -->
                        <section class="wood-panel room-slots-panel">
                            <div>
                                <div class="room-slots-toolbar" style="margin-bottom: 18px;">
                                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                        <h2 style="margin: 0; font-size: 28px; font-weight: 900; color: #FFE68B;">${escapeHtml(text.SLOT_LIST_TITLE)} (${summary.occupied} / ${room.maxPlayers})</h2>
                                        ${isMyHost ? `
                                        <div style="display: flex; gap: 8px;">
                                            <button id="btn-fill-all-ai" type="button" class="btn-blue" style="padding: 8px 14px; font-size: 15px; border-radius: 10px;">${escapeHtml(text.BTN_FILL_ALL_AI)}</button>
                                            <button id="btn-clear-all-ai" type="button" class="btn-wood" style="padding: 8px 14px; font-size: 15px; border-radius: 10px;">${escapeHtml(text.BTN_CLEAR_ALL_AI)}</button>
                                        </div>` : ''}
                                    </div>
                                    ${isMyHost ? `<button id="btn-edit-room-info" type="button" class="btn-orange" ${isCountdown || room.status !== 'waiting' ? 'disabled' : ''} style="padding: 9px 18px; font-size: 16px; border-radius: 12px;">${escapeHtml(text.BTN_EDIT_ROOM_INFO || '⚙️ 게임룸 설정')}</button>` : ''}
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 14px;">
                                    ${slotsHtml}
                                </div>
                            </div>

                            ${statusBannerHtml}
                        </section>

                        <!-- 우측: 게임 규칙 상세 설명 + 준비/시작 버튼 -->
                        <aside class="wood-panel-deep room-settings-panel">
                            <div style="min-height: 0; display: flex; flex-direction: column; gap: 12px; flex: 1;">
                                <h2 style="margin: 0; font-size: 26px; font-weight: 900; color: #FFE68B;">${escapeHtml(text.ROOM_SETTINGS_TITLE)}</h2>
                                ${isUnos ? `
                                    <div class="lobby-rule-banner" style="height: 195px;">
                                        <img class="rule-bg" src="./Resource/Texture/BG/BG_Broken_Altar_Special.png" alt="">
                                        <div class="rule-scrim"></div>
                                        <img class="rule-char" src="./Resource/Texture/Char/Char_Erpin_Unos.png" alt="에르핀 우노스" style="height: 186px;">
                                        <div class="lobby-rule-banner-text">
                                            <span class="pill-badge" style="width: fit-content; background: #5E72E4; color: #fff; border: 2px solid #C5CEFF;">${lang === 'en' ? 'Alpha' : (lang === 'ja' ? 'アルファ' : '알파')}</span>
                                            <div style="font-size: 24px; font-weight: 900; color: #FFF8EE;">${escapeHtml(gameTitle)}</div>
                                        </div>
                                    </div>
                                    <div class="parchment-card mode-detail-parchment" style="font-size: 17px; gap: 12px;">
                                        <div>• ${escapeHtml(text.UNOS_SETTING_PLAYERS)}</div>
                                        <div>• ${escapeHtml(text.UNOS_SETTING_MODE)}</div>
                                        ${text.UNOS_SETTING_BOARD ? `<div>• ${escapeHtml(text.UNOS_SETTING_BOARD)}</div>` : ''}
                                        ${text.UNOS_SETTING_WIN ? `<div>• ${escapeHtml(text.UNOS_SETTING_WIN)}</div>` : ''}
                                        <div style="margin-top: 6px; padding-top: 10px; border-top: 2px dashed rgba(138, 86, 44, 0.3); font-size: 15px; color: #724929; font-weight: bold;">
                                            • ${escapeHtml(text.UNOS_SETTING_AI_MODE || 'AI 난이도: 순한맛(쉬움) · 보통맛 · 매운맛 3단계 선택 가능')}
                                        </div>
                                    </div>
                                ` : `
                                    <div>
                                        <div style="font-size: 15px; font-weight: bold; color: #FDEAC8; margin-bottom: 8px;">${escapeHtml(text.MODE_SELECT_LABEL || '게임 모드 선택')}</div>
                                        <div class="mode-btn-row">${modeButtonsHtml}</div>
                                    </div>
                                    ${buildModeDetailHtml(currentMode, currentModeCfg, initialMoneyOrderStr, selectedModeMeta)}
                                `}
                            </div>

                            <button id="btn-toggle-ready" type="button" class="${readyBtnClass}" ${isReadyBtnDisabled ? 'disabled' : ''} style="width: 100%; height: 82px; font-size: 29px; border-radius: 18px; flex-shrink: 0;">
                                ${escapeHtml(readyBtnLabel)}
                            </button>
                        </aside>
                    </div>

                    ${renderArenaSettingsModalHtml({
                        popupId: 'popup-room-settings',
                        idPrefix: 'room-settings',
                        bgmSliderId: 'room-bgm-slider',
                        sfxSliderId: 'room-sfx-slider',
                        fontGothicId: 'room-font-gothic',
                        fontGulimId: 'room-font-gulim',
                        langKoId: 'room-lang-ko',
                        langEnId: 'room-lang-en',
                        langJaId: 'room-lang-ja',
                        closeBtnId: 'close-room-settings',
                        lang,
                        menuText,
                        currentNickname: RoomManager.localPlayer?.name || ''
                    })}

                    <!-- 방장 전용: 게임룸 설정 모달 -->
                    <div id="modal-edit-room-info" class="arena-modal-backdrop" style="z-index: 1200;">
                        <div class="arena-modal-box">
                            <h2 style="margin: 0 0 22px; font-size: 32px; font-weight: 900; text-align: center; color: #4E2812;">⚙️ ${escapeHtml(text.EDIT_ROOM_MODAL_TITLE || '게임룸 설정')}</h2>

                            <div style="margin-bottom: 18px;">
                                <label style="display: block; font-size: 18px; font-weight: 800; margin-bottom: 8px;">${escapeHtml(text.ROOM_TITLE_LABEL)}</label>
                                <input id="edit-room-title" class="modal-input" type="text" maxlength="20" value="${escapeHtml(room.title)}">
                            </div>

                            <div style="margin-bottom: 18px;">
                                <label style="display: block; font-size: 18px; font-weight: 800; margin-bottom: 8px;">${escapeHtml(text.MAX_PLAYERS_LABEL)}</label>
                                <div id="edit-room-max-group" style="display: flex; gap: 10px;">
                                    ${Array.from({ length: Math.max(1, (gameMeta?.maxPlayers || 4) - (gameMeta?.minPlayers || 2) + 1) }, (_, idx) => {
                                        const n = (gameMeta?.minPlayers || 2) + idx;
                                        const isSel = n === room.maxPlayers;
                                        return `<button type="button" class="btn-edit-max-players ${isSel ? 'btn-orange' : 'btn-wood'}" data-max="${n}" style="flex: 1; padding: 11px 10px; font-size: 19px;">${n}${escapeHtml(text.PLAYERS_UNIT)}</button>`;
                                    }).join('')}
                                </div>
                            </div>

                            <div style="margin-bottom: 24px;">
                                <label style="display: block; font-size: 18px; font-weight: 800; margin-bottom: 8px;">${escapeHtml(text.VISIBILITY_LABEL)}</label>
                                <div style="display: flex; gap: 20px; font-size: 18px; font-weight: bold;">
                                    <label style="cursor: pointer;"><input type="radio" name="edit-room-visibility" value="public" ${!room.isPrivate ? 'checked' : ''}> ${escapeHtml(text.PUBLIC_ROOM)}</label>
                                    <label style="cursor: pointer;"><input type="radio" name="edit-room-visibility" value="private" ${room.isPrivate ? 'checked' : ''}> ${escapeHtml(text.PRIVATE_ROOM)}</label>
                                </div>
                                <input id="edit-room-password" class="modal-input" type="password" maxlength="16" value="${escapeHtml(room.password || '')}" placeholder="${escapeHtml(text.JOIN_PASSWORD_OPTIONAL || '비밀번호 (비공개 시 선택)')}" style="margin-top: 10px; padding: 10px 14px; font-size: 17px;">
                            </div>

                            <div style="display: flex; gap: 14px;">
                                <button id="btn-cancel-edit-room" type="button" class="btn-wood" style="flex: 1; padding: 14px; font-size: 20px;">${escapeHtml(text.BTN_CANCEL)}</button>
                                <button id="btn-confirm-edit-room" type="button" class="btn-orange" style="flex: 1.4; padding: 14px; font-size: 20px;">${escapeHtml(text.BTN_SAVE_ROOM_INFO || '변경 저장')}</button>
                            </div>
                        </div>
                    </div>

                    <!-- 방장 준비완료 30초 시작 대기 중앙 알림 팝업 -->
                    ${isHostIdleWarningOpen && !isCountdown ? `
                    <div id="modal-host-idle-warning" class="arena-modal-backdrop open" style="z-index: 2200; cursor: pointer;">
                        <div class="arena-modal-box" style="width: 600px; text-align: center; border-color: #F38221; cursor: pointer;">
                            <h2 style="margin: 0 0 14px 0; font-size: 30px; font-weight: 900; color: #9E4412;">⏰ ${escapeHtml(text.HOST_IDLE_WARNING_TITLE || '게임 시작 대기 안내')}</h2>
                            <p style="margin: 0 0 26px 0; font-size: 20px; font-weight: bold; line-height: 1.55; color: #4E2812;">${escapeHtml(text.HOST_IDLE_WARNING_MSG || '모든 플레이어가 준비를 완료했습니다! 일정 시간 안에 시작하지 않으면 자동으로 강퇴됩니다!')}</p>
                            <button id="btn-dismiss-idle-warning" type="button" class="btn-orange" style="padding: 13px 44px; font-size: 20px;">${escapeHtml(text.HOST_IDLE_WARNING_CONFIRM || '확인')}</button>
                        </div>
                    </div>` : ''}
                </div>
            </div>
        `;

        // 이벤트 연결
        container.querySelector('#btn-leave-room').onclick = async () => {
            clearLocalCountdown();
            await RoomManager.leaveCurrentRoom();
            changeScene(gameMeta.sceneMain);
        };

        container.querySelector('#btn-copy-room-code').onclick = async () => {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(room.code);
                }
            } catch (_) { /* 클립보드 미지원 환경에서도 알림 표시 */ }
            showLobbyToast(container, `${text.CODE_COPIED} ${room.code}`);
        };

        bindArenaSettingsHandlers({
            container,
            popupId: 'popup-room-settings',
            openBtnId: 'btn-room-settings',
            idPrefix: 'room-settings',
            bgmSliderId: 'room-bgm-slider',
            sfxSliderId: 'room-sfx-slider',
            fontGothicId: 'room-font-gothic',
            fontGulimId: 'room-font-gulim',
            langKoId: 'room-lang-ko',
            langEnId: 'room-lang-en',
            langJaId: 'room-lang-ja',
            closeBtnId: 'close-room-settings',
            canOpen: () => !isCountdown,
            onNicknameApplied: () => {
                if (!RoomManager.isOnline()) return;
                render();
            }
        });

        const settingsPopup = container.querySelector('#popup-room-settings');
        const openInfoBtn = container.querySelector('#btn-room-info');
        if (isCountdown) {
            if (settingsPopup) settingsPopup.classList.remove('open');
            closeInfoPopup(container);
        }
        if (openInfoBtn) {
            openInfoBtn.onclick = () => {
                if (isCountdown) return;
                openInfoPopup(container, { gameId: room.gameId || 'marble' });
            };
        }

        const editRoomModal = container.querySelector('#modal-edit-room-info');
        const openEditRoomBtn = container.querySelector('#btn-edit-room-info');
        const editTitleInput = container.querySelector('#edit-room-title');
        const editPwInput = container.querySelector('#edit-room-password');
        const cancelEditRoomBtn = container.querySelector('#btn-cancel-edit-room');
        const confirmEditRoomBtn = container.querySelector('#btn-confirm-edit-room');
        const editMaxBtns = container.querySelectorAll('.btn-edit-max-players');
        let selectedEditMax = room.maxPlayers;

        if (isCountdown && editRoomModal) {
            editRoomModal.classList.remove('open');
        }
        const syncEditMaxStyles = () => {
            editMaxBtns.forEach(btn => {
                const isSel = Number(btn.dataset.max) === selectedEditMax;
                btn.classList.toggle('btn-orange', isSel);
                btn.classList.toggle('btn-wood', !isSel);
            });
        };
        editMaxBtns.forEach(btn => {
            btn.onclick = () => {
                selectedEditMax = Number(btn.dataset.max) || room.maxPlayers;
                syncEditMaxStyles();
            };
        });
        if (openEditRoomBtn && editRoomModal) {
            openEditRoomBtn.onclick = () => {
                if (isCountdown || room.status !== 'waiting') return;
                selectedEditMax = room.maxPlayers;
                syncEditMaxStyles();
                if (editTitleInput) editTitleInput.value = room.title || '';
                if (editPwInput) editPwInput.value = room.password || '';
                const pubRadio = container.querySelector('input[name="edit-room-visibility"][value="public"]');
                const prvRadio = container.querySelector('input[name="edit-room-visibility"][value="private"]');
                if (pubRadio && prvRadio) {
                    pubRadio.checked = !room.isPrivate;
                    prvRadio.checked = Boolean(room.isPrivate);
                }
                editRoomModal.classList.add('open');
                if (editTitleInput) editTitleInput.focus();
            };
        }
        if (cancelEditRoomBtn && editRoomModal) {
            cancelEditRoomBtn.onclick = () => editRoomModal.classList.remove('open');
        }
        if (editRoomModal) {
            editRoomModal.onclick = (e) => {
                if (e.target === editRoomModal) editRoomModal.classList.remove('open');
            };
        }
        const submitEditRoom = async () => {
            const nextTitle = editTitleInput ? editTitleInput.value : room.title;
            const vis = container.querySelector('input[name="edit-room-visibility"]:checked')?.value;
            const res = await RoomManager.updateRoomInfo({
                title: nextTitle,
                isPrivate: vis === 'private',
                password: editPwInput ? editPwInput.value : '',
                maxPlayers: selectedEditMax
            });
            if (!res.ok) {
                showLobbyToast(container, text[res.errorCode] || text.ERR_TITLE_EMPTY);
                return;
            }
            if (editRoomModal) editRoomModal.classList.remove('open');
            syncLocalCountdownState();
            render();
            showLobbyToast(container, text.TOAST_ROOM_INFO_UPDATED || '게임룸 설정이 변경되었습니다.');
        };
        if (confirmEditRoomBtn) confirmEditRoomBtn.onclick = submitEditRoom;
        if (editTitleInput) {
            editTitleInput.onkeydown = (e) => {
                if (e.key === 'Enter') submitEditRoom();
            };
        }

        const idleWarnModal = container.querySelector('#modal-host-idle-warning');
        if (idleWarnModal) {
            idleWarnModal.onclick = () => {
                isHostIdleWarningOpen = false;
                if (idleWarnModal.parentNode) idleWarnModal.remove();
            };
        }

        container.querySelectorAll('.btn-room-mode').forEach(btn => {
            btn.onclick = async () => {
                if (!canEditMode) return;
                const mode = btn.dataset.mode;
                if (!mode || mode === currentMode) return;
                clearLocalCountdown();
                await RoomManager.updateCustomOptions({ gameMode: mode });
                syncLocalCountdownState();
                render();
            };
        });

        const fillAllBtn = container.querySelector('#btn-fill-all-ai');
        if (fillAllBtn) {
            fillAllBtn.onclick = async () => {
                await RoomManager.fillAllEmptyWithAi();
                syncLocalCountdownState();
                render();
            };
        }

        const clearAllBtn = container.querySelector('#btn-clear-all-ai');
        if (clearAllBtn) {
            clearAllBtn.onclick = async () => {
                await RoomManager.clearAllAiSlots();
                syncLocalCountdownState();
                render();
            };
        }

        container.querySelector('#btn-toggle-ready').onclick = async () => {
            if (!isOnline && isMyHost && localCountdownTimer !== null) {
                clearLocalCountdown();
                render();
                showLobbyToast(container, '방장이 게임 시작을 취소했습니다.');
                return;
            }
            if (!isMyHost && isCountdown) {
                showLobbyToast(container, text.ERR_COUNTDOWN_LOCKED || '카운트다운 중에는 방장만 시작을 취소할 수 있습니다.');
                return;
            }
            let toastMsg = null;
            if (!isMyReady && !RoomManager.getReadinessSummary(room).hasMinPlayers) {
                toastMsg = text.TOAST_NEED_MIN_PLAYERS;
            }
            const res = await RoomManager.toggleReady();
            if (res && res.ok === false && res.errorCode) {
                toastMsg = text[res.errorCode] || text.TOAST_NEED_MIN_PLAYERS;
            } else if (!isOnline && isMyHost && res?.startOfflineNow) {
                startLocalCountdown();
            }
            syncLocalCountdownState();
            render();
            // render()가 container.innerHTML을 다시 그리므로 토스트는 render 이후에 띄워야 유지된다.
            if (toastMsg) {
                showLobbyToast(container, toastMsg);
            }
        };

        container.querySelectorAll('.btn-slot-add-ai').forEach(btn => {
            btn.onclick = async () => {
                await RoomManager.fillSlotWithAi(Number(btn.dataset.idx));
                syncLocalCountdownState();
                render();
            };
        });

        container.querySelectorAll('.btn-slot-add-mock').forEach(btn => {
            btn.onclick = () => {
                RoomManager.addMockHuman(Number(btn.dataset.idx));
                syncLocalCountdownState();
                render();
            };
        });

        container.querySelectorAll('.btn-slot-ai-cycle').forEach(btn => {
            btn.onclick = async () => {
                await RoomManager.cycleAiArchetype(Number(btn.dataset.idx));
                render();
            };
        });

        container.querySelectorAll('.btn-slot-transfer-host').forEach(btn => {
            btn.onclick = async () => {
                const res = await RoomManager.transferHost(Number(btn.dataset.idx));
                if (res && res.ok === false && res.errorCode) {
                    showLobbyToast(container, text[res.errorCode] || text.ERR_CANNOT_TRANSFER_HOST || '방장 위임 실패');
                }
                syncLocalCountdownState();
                render();
            };
        });

        container.querySelectorAll('.btn-slot-clear').forEach(btn => {
            btn.onclick = async () => {
                await RoomManager.clearSlot(Number(btn.dataset.idx));
                syncLocalCountdownState();
                render();
            };
        });
    };

    const langHandler = () => render();
    document.addEventListener('languageChanged', langHandler);

    const unsubscribeRoom = RoomManager.subscribe((evtName, payload) => {
        if (evtName === 'ROOM_UPDATED') {
            render();
        } else if (evtName === 'COUNTDOWN') {
            if (payload?.cancelled) {
                ErrorTracker.clearTransitionWatchdog();
                if (payload.message) {
                    showLobbyToast(container, payload.message, 3000);
                }
            } else {
                closeInfoPopup(container);
                if (typeof payload?.seconds === 'number' && payload.seconds <= 0) {
                    const curGameId = RoomManager.getCurrentRoom()?.gameId || 'marble';
                    const targetScene = getGameMeta(curGameId)?.sceneGame || 'marble';
                    ErrorTracker.startTransitionWatchdog(targetScene, {
                        timeoutMs: 9500,
                        gameId: curGameId,
                        reason: 'Waiting for GAME_START after countdown'
                    });
                }
            }
            render();
        } else if (evtName === 'GAME_START') {
            clearLocalCountdown();
            const meta = getGameMeta(payload?.gameId || RoomManager.getCurrentRoom()?.gameId || 'marble');
            changeScene(payload?.sceneGame || meta?.sceneGame || 'marble', {
                room: payload?.room || RoomManager.getCurrentRoom(),
                initialSnapshot: payload?.snapshot || null
            });
        } else if (evtName === 'KICKED_FROM_ROOM') {
            clearLocalCountdown();
            const meta = getGameMeta(payload?.gameId || RoomManager.getCurrentRoom()?.gameId || 'marble');
            changeScene(meta?.sceneMain || 'marble_main', { kickNotice: payload || null });
        }
    });

    container._cleanupScene = () => {
        clearLocalCountdown();
        document.removeEventListener('languageChanged', langHandler);
        unsubscribeRoom();
    };

    syncLocalCountdownState();
    render();

    const initialRoom = RoomManager.getCurrentRoom();
    if (RoomManager.isOnline() && initialRoom?.gameId) {
        ensureGameTabAccess(container, initialRoom.gameId);
    }

    if (sceneParams && sceneParams.toastMsg) {
        showLobbyToast(container, sceneParams.toastMsg, 3000);
    }
}
