// ProgramFiles/Scenes/GameRoom.js
// 대기방 UI (온라인 서버 실시간 동기화 + 오프라인 로컬 AI 연습 겸용)

import { changeScene } from '../Main.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import { escapeHtml, showLobbyToast } from '../Lobby/LobbyUI.js';
import { getGameMeta } from '../System/GameRegistry.js';
import { LangState } from '../System/LanguageManager.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { MenuLang } from '../System/Index/MainMenuIndex.js';
import { AudioManager, SettingsManager } from '../System/System.js';
import { getModeConfig, normalizeMarbleMode } from '../System/Index/Marble/MarblePriceIndex.js';

function getAiLabel(slotOrDiff, text) {
    const raw = (typeof slotOrDiff === 'object' && slotOrDiff !== null)
        ? (slotOrDiff.aiDifficulty || slotOrDiff.aiType)
        : slotOrDiff;
    switch (String(raw || '').toLowerCase()) {
        case 'mild':
        case 'easy':
            return text.AI_DIFF_MILD || '순한맛 (쉬움)';
        case 'spicy':
        case 'normal':
            return text.AI_DIFF_SPICY || '매운맛 (보통)';
        case 'nuclear':
        case 'hard':
            return text.AI_DIFF_NUCLEAR || '핵불맛 (어려움)';
        case 'magma':
        case 'very_hard':
            return text.AI_DIFF_MAGMA || '마그맛 (매우어려움)';
        default:
            return text.AI_DIFF_MILD || '순한맛 (쉬움)';
    }
}

export function initRoom(container, sceneParams = null) {
    let localCountdownTimer = null;
    let localCountdownSec = null;

    const clearLocalCountdown = () => {
        if (localCountdownTimer) {
            clearInterval(localCountdownTimer);
            localCountdownTimer = null;
        }
        localCountdownSec = null;
    };

    const syncLocalCountdownState = () => {
        if (RoomManager.isOnline()) return;
        const room = RoomManager.getCurrentRoom();
        if (!room) {
            clearLocalCountdown();
            return;
        }
        const gameMeta = getGameMeta(room.gameId);
        const { canStart } = RoomManager.canStart(room);

        if (canStart && localCountdownTimer === null) {
            localCountdownSec = 3;
            localCountdownTimer = setInterval(() => {
                if (!RoomManager.canStart(RoomManager.getCurrentRoom()).canStart) {
                    clearLocalCountdown();
                    render();
                    return;
                }
                localCountdownSec -= 1;
                if (localCountdownSec <= 0) {
                    const liveRoom = RoomManager.getCurrentRoom();
                    clearLocalCountdown();
                    const initialSnapshot = RoomManager.startLocalGameSession(liveRoom);
                    changeScene(gameMeta.sceneGame, { room: liveRoom, initialSnapshot });
                    return;
                }
                render();
            }, 1000);
        } else if (!canStart && localCountdownTimer !== null) {
            clearLocalCountdown();
        }
    };

    const render = () => {
        const room = RoomManager.getCurrentRoom();
        if (!room) {
            clearLocalCountdown();
            changeScene('menu');
            return;
        }

        const isOnline = RoomManager.isOnline();
        const text = LobbyLang[LangState.current] || LobbyLang.ko;
        const menuText = MenuLang[LangState.current] || MenuLang.ko;
        const gameMeta = getGameMeta(room.gameId);
        const gameTitle = (gameMeta.title && gameMeta.title[LangState.current]) || gameMeta.id;
        const mySlot = RoomManager.getMySlot(room);
        const summary = RoomManager.getReadinessSummary(room);
        const isMyHost = room.hostId === RoomManager.localPlayer.id;
        const isMyReady = Boolean(mySlot && mySlot.isReady);
        const canEditMode = isMyHost && room.status === 'waiting';
        const currentMode = normalizeMarbleMode(room.customOptions?.gameMode);
        const currentModeCfg = getModeConfig(currentMode);

        const modeItems = [
            {
                id: 'speed',
                label: text.MODE_SPEED || '스피드',
                turns: 10,
                time: text.MODE_SPEED_TIME || '약 10~15분',
                desc: text.MODE_SPEED_DESC || ''
            },
            {
                id: 'basic',
                label: text.MODE_BASIC || '기본',
                turns: 15,
                time: text.MODE_BASIC_TIME || '약 20~25분',
                desc: text.MODE_BASIC_DESC || ''
            },
            {
                id: 'ember',
                label: text.MODE_EMBER || '불씨',
                turns: 20,
                time: text.MODE_EMBER_TIME || '약 25~30분',
                desc: text.MODE_EMBER_DESC || ''
            }
        ];
        const selectedModeMeta = modeItems.find(m => m.id === currentMode) || modeItems[2];
        const modeButtonsHtml = modeItems.map(m => {
            const active = m.id === currentMode;
            const bg = active ? 'linear-gradient(135deg, #f39c12, #e67e22)' : 'rgba(0,0,0,0.28)';
            const border = active ? '3px solid #f1c40f' : '2px solid rgba(255,255,255,0.22)';
            const cursor = canEditMode ? 'pointer' : 'default';
            const opacity = (!canEditMode && !active) ? '0.35' : '1';
            const pointerEvents = canEditMode ? 'auto' : 'none';
            return `
                <button type="button" class="btn-room-mode" data-mode="${m.id}" ${!canEditMode ? 'disabled' : ''} style="font-family: inherit; flex: 1; padding: 12px 8px; border-radius: 14px; background: ${bg}; border: ${border}; color: #fff; cursor: ${cursor}; opacity: ${opacity}; pointer-events: ${pointerEvents}; display: flex; flex-direction: column; align-items: center; gap: 4px; box-shadow: ${active ? '0 6px 16px rgba(0,0,0,0.28)' : 'none'};">
                    <span style="font-size: 22px; font-weight: 900; white-space: nowrap;">${escapeHtml(m.label)}</span>
                    <span style="font-size: 14px; font-weight: bold; color: ${active ? '#fff9db' : '#dceefb'}; white-space: nowrap;">${m.turns} Turn</span>
                    <span style="font-size: 13px; color: ${active ? '#ffffff' : 'rgba(255,255,255,0.75)'}; white-space: nowrap;">⏱ ${escapeHtml(m.time)}</span>
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
                const hostSlotControls = (!isOnline || isMyHost) ? `
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-slot-add-ai" data-idx="${slot.slotIndex}" style="font-family: inherit; padding: 8px 14px; font-size: 16px; font-weight: bold; background: #8e44ad; color: #fff; border: none; border-radius: 8px; cursor: pointer;">${escapeHtml(text.BTN_ADD_AI)}</button>
                        ${!isOnline ? `<button class="btn-slot-add-mock" data-idx="${slot.slotIndex}" style="font-family: inherit; padding: 8px 14px; font-size: 16px; font-weight: bold; background: #3498db; color: #fff; border: none; border-radius: 8px; cursor: pointer;">${escapeHtml(text.BTN_ADD_TEST_USER)}</button>` : ''}
                    </div>
                ` : '';
                return `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; border-radius: 16px; border: 2px dashed rgba(255,255,255,0.28); background: rgba(0,0,0,0.14); color: rgba(255,255,255,0.65);">
                        <div style="display: flex; align-items: center; gap: 14px; font-size: 20px;">
                            <span style="width: 24px; height: 24px; border-radius: 50%; background: rgba(255,255,255,0.18); display: inline-block;"></span>
                            <span>${slot.slotIndex + 1}. ${escapeHtml(text.ROLE_EMPTY)}</span>
                        </div>
                        ${hostSlotControls}
                    </div>
                `;
            }

            const isMe = slot.id === RoomManager.localPlayer.id;
            const roleLabel = slot.type === 'ai'
                ? `${text.ROLE_AI} (${getAiLabel(slot, text)})`
                : (slot.isHost ? text.ROLE_HOST : text.ROLE_GUEST);
            const meTag = isMe ? `<span style="color: #f1c40f; font-weight: bold;">${escapeHtml(text.TAG_ME)}</span>` : '';
            const offlineTag = (slot.type === 'human' && slot.isConnected === false)
                ? `<span style="margin-left: 8px; padding: 2px 8px; font-size: 14px; border-radius: 6px; background: #c0392b; color: #fff;">${escapeHtml(text.TAG_OFFLINE || 'OFFLINE')}</span>`
                : '';

            const statusBadge = slot.isReady
                ? `<span style="padding: 6px 14px; border-radius: 10px; background: #27ae60; color: #fff; font-size: 17px; font-weight: bold;">${escapeHtml(text.STATE_READY)}</span>`
                : `<span style="padding: 6px 14px; border-radius: 10px; background: #7f8c8d; color: #fff; font-size: 17px; font-weight: bold;">${escapeHtml(text.STATE_WAITING)}</span>`;

            let actionBtns = '';
            if (slot.type === 'ai' && (!isOnline || isMyHost)) {
                actionBtns = `
                    <button class="btn-slot-ai-cycle" data-idx="${slot.slotIndex}" style="font-family: inherit; padding: 7px 12px; font-size: 15px; font-weight: bold; background: #9b59b6; color: #fff; border: none; border-radius: 8px; cursor: pointer;">${escapeHtml(text.BTN_AI_CYCLE)}</button>
                    <button class="btn-slot-clear" data-idx="${slot.slotIndex}" style="font-family: inherit; padding: 7px 12px; font-size: 15px; font-weight: bold; background: #c0392b; color: #fff; border: none; border-radius: 8px; cursor: pointer;">${escapeHtml(text.BTN_CLEAR_SLOT)}</button>
                `;
            } else if (slot.isMockHuman && !isOnline) {
                actionBtns = `
                    <button class="btn-slot-mock-ready" data-idx="${slot.slotIndex}" style="font-family: inherit; padding: 7px 12px; font-size: 15px; font-weight: bold; background: #2980b9; color: #fff; border: none; border-radius: 8px; cursor: pointer;">${escapeHtml(text.BTN_TOGGLE_TEST_READY)}</button>
                    <button class="btn-slot-clear" data-idx="${slot.slotIndex}" style="font-family: inherit; padding: 7px 12px; font-size: 15px; font-weight: bold; background: #c0392b; color: #fff; border: none; border-radius: 8px; cursor: pointer;">${escapeHtml(text.BTN_CLEAR_SLOT)}</button>
                `;
            } else if (slot.type === 'human' && !slot.isHost && isOnline && isMyHost) {
                actionBtns = `
                    <button class="btn-slot-clear" data-idx="${slot.slotIndex}" style="font-family: inherit; padding: 7px 12px; font-size: 15px; font-weight: bold; background: #c0392b; color: #fff; border: none; border-radius: 8px; cursor: pointer;">${escapeHtml(text.BTN_CLEAR_SLOT)}</button>
                `;
            }

            return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 15px 22px; border-radius: 16px; border: 3px solid ${isMe ? '#f1c40f' : 'rgba(255,255,255,0.2)'}; background: #165b7a; color: #fff;">
                    <div style="display: flex; align-items: center; gap: 16px; min-width: 0;">
                        <span style="width: 24px; height: 24px; border-radius: 50%; background: ${slot.color}; border: 2px solid #fff; flex-shrink: 0;"></span>
                        <div style="min-width: 0;">
                            <div style="font-size: 22px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${escapeHtml(slot.name)}${meTag}${offlineTag}
                            </div>
                            <div style="font-size: 15px; color: #dceefb; margin-top: 2px;">${escapeHtml(roleLabel)}</div>
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
            statusBannerHtml = `<div style="padding: 16px 24px; border-radius: 14px; background: #27ae60; color: #fff; font-size: 24px; font-weight: bold; text-align: center;">${escapeHtml(msg)}</div>`;
        } else if (!summary.hasMinPlayers) {
            const msg = text.STATUS_NEED_MIN_PLAYERS
                .replace('{min}', gameMeta.minPlayers)
                .replace('{cur}', summary.occupied);
            statusBannerHtml = `<div style="padding: 16px 24px; border-radius: 14px; background: rgba(231, 76, 60, 0.85); color: #fff; font-size: 20px; font-weight: bold; text-align: center;">${escapeHtml(msg)}</div>`;
        } else {
            const msg = text.STATUS_WAIT_ALL_READY
                .replace('{ready}', summary.readyHumanCount)
                .replace('{cur}', summary.humanCount);
            statusBannerHtml = `<div style="padding: 16px 24px; border-radius: 14px; background: rgba(0, 0, 0, 0.28); color: #dceefb; font-size: 20px; font-weight: bold; text-align: center;">${escapeHtml(msg)}</div>`;
        }

        let readyBtnLabel = isMyReady ? text.BTN_READY_CANCEL : text.BTN_READY;
        let readyBtnBg = isMyReady ? '#e67e22' : '#2ecc71';
        if (isMyHost && isOnline) {
            readyBtnLabel = room.status === 'countdown'
                ? (text.BTN_CANCEL_START || '시작 취소')
                : (text.BTN_START_GAME || '게임 시작');
            readyBtnBg = room.status === 'countdown' ? '#e74c3c' : '#2ecc71';
        } else if (isMyHost && !isOnline) {
            readyBtnLabel = text.BTN_START_GAME || '게임 시작';
            readyBtnBg = '#2ecc71';
        }

        container.innerHTML = `
            <div style="width: 100%; height: 100%; background: #bee8fc; padding: 38px 56px; box-sizing: border-box; display: flex; flex-direction: column;">
                <!-- 상단 헤더 -->
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; flex-wrap: nowrap;">
                    <div style="display: flex; align-items: center; gap: 18px; min-width: 0; flex: 1;">
                        <button id="btn-leave-room" style="font-family: inherit; padding: 14px 22px; font-size: 21px; font-weight: bold; background: #c0392b; color: #fff; border: none; border-radius: 12px; cursor: pointer; white-space: nowrap; flex-shrink: 0;">${escapeHtml(text.BACK_TO_GAME_MAIN)}</button>
                        <div style="min-width: 0; flex: 1;">
                            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;">
                                <span style="padding: 5px 12px; border-radius: 18px; background: ${gameMeta.accentColor}; color: #fff; font-size: 16px; font-weight: bold; white-space: nowrap; flex-shrink: 0;">${escapeHtml(gameTitle)}</span>
                                <span style="padding: 5px 12px; border-radius: 18px; background: #165b7a; color: #fff; font-size: 16px; white-space: nowrap; flex-shrink: 0;">${escapeHtml(room.isPrivate ? text.VISIBILITY_PRIVATE_BADGE : text.VISIBILITY_PUBLIC_BADGE)}</span>
                                <span style="padding: 5px 12px; border-radius: 18px; background: ${isOnline ? '#27ae60' : '#7f8c8d'}; color: #fff; font-size: 15px; font-weight: bold; white-space: nowrap; flex-shrink: 0;">${escapeHtml(isOnline ? (text.NET_ONLINE || '🟢 온라인') : (text.NET_OFFLINE || '🟠 오프라인'))}</span>
                            </div>
                            <h1 style="margin: 6px 0 0 0; font-size: 36px; color: #165b7a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(room.title)}</h1>
                        </div>
                    </div>

                    <!-- 우측 상단: 닉네임 변경 + 방 코드 공유 + 설정 버튼 -->
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: nowrap; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; background: #216a8c; padding: 10px 14px; border-radius: 14px; color: #fff; box-shadow: 0 6px 14px rgba(0,0,0,0.14); flex-shrink: 0;">
                            <span style="font-size: 16px; font-weight: bold; white-space: nowrap;">${escapeHtml(text.NICKNAME_LABEL)}:</span>
                            <input id="input-room-nickname" type="text" maxlength="16" value="${escapeHtml(RoomManager.localPlayer.name)}" style="font-family: inherit; width: 128px; padding: 6px 9px; font-size: 17px; border-radius: 8px; border: none; outline: none;">
                            <button id="btn-room-save-nick" style="font-family: inherit; padding: 6px 12px; font-size: 16px; font-weight: bold; background: #f39c12; color: #fff; border: none; border-radius: 8px; cursor: pointer; white-space: nowrap; flex-shrink: 0;">${escapeHtml(text.BTN_CHANGE_NICK)}</button>
                        </div>

                        <div style="display: flex; align-items: center; gap: 12px; background: #216a8c; padding: 10px 16px; border-radius: 14px; color: #fff; box-shadow: 0 6px 14px rgba(0,0,0,0.14); flex-shrink: 0;">
                            <div style="white-space: nowrap;">
                                <div style="font-size: 13px; color: #dceefb;">${escapeHtml(text.ROOM_CODE_LABEL)}</div>
                                <div id="room-code-display" style="font-family: monospace; font-size: 25px; font-weight: bold; letter-spacing: 1.5px; color: #f1c40f;">${escapeHtml(room.code)}</div>
                            </div>
                            <button id="btn-copy-room-code" style="font-family: inherit; padding: 9px 14px; font-size: 17px; font-weight: bold; background: #f39c12; color: #fff; border: none; border-radius: 10px; cursor: pointer; white-space: nowrap; flex-shrink: 0;">${escapeHtml(text.BTN_COPY_CODE)}</button>
                        </div>

                        <button id="btn-room-settings" style="font-family: inherit; padding: 14px 20px; font-size: 19px; font-weight: bold; background: #165b7a; color: #fff; border: none; border-radius: 14px; cursor: pointer; box-shadow: 0 6px 14px rgba(0,0,0,0.14); white-space: nowrap; flex-shrink: 0;">${escapeHtml(text.BTN_ROOM_SETTINGS || menuText.SETTINGS)}</button>
                    </div>
                </div>

                <!-- 룸 본문 2열 -->
                <div style="flex: 1; display: grid; grid-template-columns: 1fr 480px; gap: 32px; min-height: 0;">
                    <!-- 좌측: 플레이어 슬롯 -->
                    <div style="background: #216a8c; border-radius: 26px; padding: 30px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 12px 26px rgba(0,0,0,0.16);">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                <h2 style="margin: 0; font-size: 30px; color: #fff;">${escapeHtml(text.SLOT_LIST_TITLE)} (${summary.occupied} / ${room.maxPlayers})</h2>
                                ${(!isOnline || isMyHost) ? `
                                <div style="display: flex; gap: 10px;">
                                    <button id="btn-fill-all-ai" style="font-family: inherit; padding: 10px 18px; font-size: 18px; font-weight: bold; background: #8e44ad; color: #fff; border: none; border-radius: 10px; cursor: pointer;">${escapeHtml(text.BTN_FILL_ALL_AI)}</button>
                                    <button id="btn-clear-all-ai" style="font-family: inherit; padding: 10px 18px; font-size: 18px; font-weight: bold; background: #165b7a; color: #fff; border: 2px solid rgba(255,255,255,0.25); border-radius: 10px; cursor: pointer;">${escapeHtml(text.BTN_CLEAR_ALL_AI)}</button>
                                </div>` : ''}
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 16px;">
                                ${slotsHtml}
                            </div>
                        </div>

                        ${statusBannerHtml}
                    </div>

                    <!-- 우측: 커스텀 설정 + 준비/시작 버튼 -->
                    <div style="background: #165b7a; border-radius: 26px; padding: 30px; color: #fff; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 12px 26px rgba(0,0,0,0.16);">
                        <div>
                            <h2 style="margin: 0 0 16px 0; font-size: 26px; color: #f1c40f;">${escapeHtml(text.ROOM_SETTINGS_TITLE)}</h2>
                            ${room.gameId === 'unos' ? `
                                <div style="display: flex; flex-direction: column; gap: 14px; font-size: 20px; background: rgba(0,0,0,0.22); padding: 22px; border-radius: 16px;">
                                    <div>• ${escapeHtml(text.UNOS_SETTING_PLAYERS)}</div>
                                    <div>• ${escapeHtml(text.UNOS_SETTING_MODE)}</div>
                                    <div>• ${escapeHtml(text.SETTING_AI_MODE)}</div>
                                </div>
                            ` : `
                                <div style="margin-bottom: 14px;">
                                    <div style="font-size: 17px; font-weight: bold; color: #dceefb; margin-bottom: 8px;">${escapeHtml(text.MODE_SELECT_LABEL || '게임 모드 선택')}</div>
                                    <div style="display: flex; gap: 10px;">
                                        ${modeButtonsHtml}
                                    </div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 10px; font-size: 17px; background: rgba(0,0,0,0.22); padding: 18px; border-radius: 16px; line-height: 1.45;">
                                    <div>• <strong>${escapeHtml(text.OPTION_TURNS_LABEL || '최대 턴 수')}:</strong> ${selectedModeMeta.turns} Turn (${escapeHtml(selectedModeMeta.time)})</div>
                                    <div>• <strong>${escapeHtml(text.OPTION_MONEY_LABEL || '초기 자금')}:</strong> ${escapeHtml(initialMoneyOrderStr)}</div>
                                    <div style="color: #ffeaa7;">• ${escapeHtml(selectedModeMeta.desc)}</div>
                                    <div style="color: #dceefb; font-size: 15px;">• ${escapeHtml(text.SETTING_AI_MODE)}</div>
                                </div>
                            `}
                        </div>

                        <button id="btn-toggle-ready" style="font-family: inherit; width: 100%; padding: 26px; font-size: 32px; font-weight: bold; background: ${readyBtnBg}; color: #fff; border: none; border-radius: 18px; cursor: pointer; box-shadow: 0 10px 22px rgba(0,0,0,0.3);">
                            ${escapeHtml(readyBtnLabel)}
                        </button>
                    </div>
                </div>

                <!-- 대기실 설정 팝업 (메인 메뉴 설정과 동일) -->
                <div id="popup-room-settings" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; padding: 50px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 1000; width: 500px; border: 5px solid #165b7a; color: #1a202c;">
                    <h2 style="margin-top:0; font-size: 36px; text-align: center; color: #165b7a;">${escapeHtml(menuText.SETTINGS)}</h2>
                    <div style="font-size: 24px; margin-bottom: 20px;"><label>${escapeHtml(menuText.BGM)}: <input type="range" id="room-bgm-slider" min="0" max="1" step="0.1" value="${AudioManager.bgmPlayer.volume}" style="width:100%;"></label></div>
                    <div style="font-size: 24px; margin-bottom: 30px;"><label>${escapeHtml(menuText.SFX)}: <input type="range" id="room-sfx-slider" min="0" max="1" step="0.1" value="${AudioManager.sfxVolume}" style="width:100%;"></label></div>

                    <div style="font-size: 24px; margin-bottom: 30px; text-align: center;">
                        <p style="margin:0 0 10px 0;">${escapeHtml(menuText.FONT)}</p>
                        <button id="room-font-gothic" type="button" style="font-family: 'Malgun Gothic', sans-serif; padding: 10px 20px; font-size: 20px; cursor: pointer;">${escapeHtml(menuText.FONT_GOTHIC)}</button>
                        <button id="room-font-gulim" type="button" style="font-family: 'Gulim', 'Dotum', sans-serif; padding: 10px 20px; font-size: 20px; cursor: pointer;">${escapeHtml(menuText.FONT_GULIM)}</button>
                    </div>

                    <div style="font-size: 24px; margin-bottom: 30px; text-align: center;">
                        <p style="margin:0 0 10px 0;">${escapeHtml(menuText.LANG)}</p>
                        <button id="room-lang-ko" type="button" style="padding: 10px; font-size: 18px; font-family: inherit; cursor: pointer;">한글</button>
                        <button id="room-lang-en" type="button" style="padding: 10px; font-size: 18px; font-family: inherit; cursor: pointer;">Eng</button>
                        <button id="room-lang-ja" type="button" style="padding: 10px; font-size: 18px; font-family: inherit; cursor: pointer;">日本語</button>
                    </div>

                    <button id="close-room-settings" type="button" style="font-family: inherit; width: 100%; padding: 15px; font-size: 24px; background: #e74c3c; color: white; border: none; border-radius: 10px; cursor: pointer;">${escapeHtml(menuText.CLOSE)}</button>
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

        const nickInput = container.querySelector('#input-room-nickname');
        const saveNickBtn = container.querySelector('#btn-room-save-nick');
        const saveRoomNick = async () => {
            const val = nickInput ? nickInput.value : '';
            if (!(await RoomManager.setNickname(val))) {
                showLobbyToast(container, text.NICK_EMPTY_ERR);
                return;
            }
            render();
            showLobbyToast(container, `${text.NICK_UPDATED} ${RoomManager.localPlayer.name}`);
        };
        if (saveNickBtn) saveNickBtn.onclick = saveRoomNick;
        if (nickInput) {
            nickInput.onkeydown = (e) => {
                if (e.key === 'Enter') saveRoomNick();
            };
        }

        const settingsPopup = container.querySelector('#popup-room-settings');
        const openSettingsBtn = container.querySelector('#btn-room-settings');
        const closeSettingsBtn = container.querySelector('#close-room-settings');
        if (openSettingsBtn && settingsPopup) {
            openSettingsBtn.onclick = () => { settingsPopup.style.display = 'block'; };
        }
        if (closeSettingsBtn && settingsPopup) {
            closeSettingsBtn.onclick = () => { settingsPopup.style.display = 'none'; };
        }
        const bgmSlider = container.querySelector('#room-bgm-slider');
        if (bgmSlider) bgmSlider.oninput = (e) => AudioManager.setBGMVolume(e.target.value);
        const sfxSlider = container.querySelector('#room-sfx-slider');
        if (sfxSlider) sfxSlider.oninput = (e) => AudioManager.setSFXVolume(e.target.value);
        const fontGothicBtn = container.querySelector('#room-font-gothic');
        if (fontGothicBtn) fontGothicBtn.onclick = () => SettingsManager.toggleFont(false);
        const fontGulimBtn = container.querySelector('#room-font-gulim');
        if (fontGulimBtn) fontGulimBtn.onclick = () => SettingsManager.toggleFont(true);
        const langKoBtn = container.querySelector('#room-lang-ko');
        if (langKoBtn) langKoBtn.onclick = () => LangState.set('ko');
        const langEnBtn = container.querySelector('#room-lang-en');
        if (langEnBtn) langEnBtn.onclick = () => LangState.set('en');
        const langJaBtn = container.querySelector('#room-lang-ja');
        if (langJaBtn) langJaBtn.onclick = () => LangState.set('ja');

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
            let toastMsg = null;
            if (room.gameId !== 'unos' && !isMyReady && !RoomManager.getReadinessSummary(room).hasMinPlayers) {
                toastMsg = text.TOAST_NEED_MIN_PLAYERS;
            }
            const res = await RoomManager.toggleReady();
            if (res && res.ok === false && res.errorCode) {
                toastMsg = text[res.errorCode] || text.TOAST_NEED_MIN_PLAYERS;
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
                await RoomManager.fillSlotWithAi(Number(btn.dataset.idx), 'mild');
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

        container.querySelectorAll('.btn-slot-mock-ready').forEach(btn => {
            btn.onclick = async () => {
                await RoomManager.toggleReady(Number(btn.dataset.idx));
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
            if (payload?.cancelled && payload.message) {
                showLobbyToast(container, payload.message, 3000);
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
            const meta = getGameMeta(RoomManager.getCurrentRoom()?.gameId || 'marble');
            changeScene(meta?.sceneMain || 'marble_main');
        }
    });

    container._cleanupScene = () => {
        clearLocalCountdown();
        document.removeEventListener('languageChanged', langHandler);
        unsubscribeRoom();
    };

    syncLocalCountdownState();
    render();

    if (sceneParams && sceneParams.toastMsg) {
        showLobbyToast(container, sceneParams.toastMsg, 3000);
    }
}
