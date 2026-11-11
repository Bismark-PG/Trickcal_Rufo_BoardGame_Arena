// ProgramFiles/Scenes/GameRoom.js
// 대기방 UI (온라인 서버 실시간 동기화 + 오프라인 로컬 AI 연습 겸용)

import { changeScene } from '../Main.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import { escapeHtml, showLobbyToast } from '../Lobby/LobbyUI.js';
import { getGameMeta } from '../System/GameRegistry.js';
import { LangState } from '../System/LanguageManager.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';

function getAiLabel(aiType, text) {
    switch (aiType) {
        case 'aggressive': return text.AI_TYPE_AGGRESSIVE;
        case 'defensive': return text.AI_TYPE_DEFENSIVE;
        case 'marathon': return text.AI_TYPE_MARATHON;
        default: return text.AI_TYPE_RANDOM;
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
        const gameMeta = getGameMeta(room.gameId);
        const gameTitle = (gameMeta.title && gameMeta.title[LangState.current]) || gameMeta.id;
        const mySlot = RoomManager.getMySlot(room);
        const summary = RoomManager.getReadinessSummary(room);
        const isMyHost = room.hostId === RoomManager.localPlayer.id;
        const isMyReady = Boolean(mySlot && mySlot.isReady);

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
                ? `${text.ROLE_AI} (${getAiLabel(slot.aiType, text)})`
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

        const customTurns = room.customOptions?.maxTurn || GAME_CONSTANTS.MAX_TURN;
        const customMoney = room.customOptions?.initialMoney || GAME_CONSTANTS.INITIAL_MONEY;
        const canEditOptions = !isOnline || isMyHost;

        container.innerHTML = `
            <div style="width: 100%; height: 100%; background: #bee8fc; padding: 38px 56px; box-sizing: border-box; display: flex; flex-direction: column;">
                <!-- 상단 헤더 -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <div style="display: flex; align-items: center; gap: 22px;">
                        <button id="btn-leave-room" style="font-family: inherit; padding: 14px 26px; font-size: 22px; font-weight: bold; background: #c0392b; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BACK_TO_GAME_MAIN)}</button>
                        <div>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <span style="padding: 6px 14px; border-radius: 18px; background: ${gameMeta.accentColor}; color: #fff; font-size: 18px; font-weight: bold;">${escapeHtml(gameTitle)}</span>
                                <span style="padding: 6px 14px; border-radius: 18px; background: #165b7a; color: #fff; font-size: 18px;">${escapeHtml(room.isPrivate ? text.VISIBILITY_PRIVATE_BADGE : text.VISIBILITY_PUBLIC_BADGE)}</span>
                                <span style="padding: 6px 14px; border-radius: 18px; background: ${isOnline ? '#27ae60' : '#7f8c8d'}; color: #fff; font-size: 16px; font-weight: bold;">${escapeHtml(isOnline ? (text.NET_ONLINE || '🟢 온라인') : (text.NET_OFFLINE || '🟠 오프라인'))}</span>
                            </div>
                            <h1 style="margin: 8px 0 0 0; font-size: 40px; color: #165b7a;">${escapeHtml(room.title)}</h1>
                        </div>
                    </div>

                    <!-- 방 코드 공유 박스 -->
                    <div style="display: flex; align-items: center; gap: 16px; background: #216a8c; padding: 14px 24px; border-radius: 18px; color: #fff; box-shadow: 0 8px 18px rgba(0,0,0,0.16);">
                        <div>
                            <div style="font-size: 15px; color: #dceefb;">${escapeHtml(text.ROOM_CODE_LABEL)}</div>
                            <div id="room-code-display" style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 3px; color: #f1c40f;">${escapeHtml(room.code)}</div>
                        </div>
                        <button id="btn-copy-room-code" style="font-family: inherit; padding: 12px 20px; font-size: 20px; font-weight: bold; background: #f39c12; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_COPY_CODE)}</button>
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
                    <div style="background: #165b7a; border-radius: 26px; padding: 32px; color: #fff; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 12px 26px rgba(0,0,0,0.16);">
                        <div>
                            <h2 style="margin: 0 0 20px 0; font-size: 28px; color: #f1c40f;">${escapeHtml(text.ROOM_SETTINGS_TITLE)}</h2>
                            <div style="display: flex; flex-direction: column; gap: 16px; font-size: 20px; background: rgba(0,0,0,0.22); padding: 22px; border-radius: 16px;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span>• ${escapeHtml(text.OPTION_TURNS_LABEL || '최대 턴 수')}</span>
                                    <select id="opt-max-turn" ${!canEditOptions ? 'disabled' : ''} style="font-family: inherit; padding: 8px 14px; font-size: 18px; border-radius: 8px; border: none;">
                                        ${[10, 15, 20, 25, 30].map(t => `<option value="${t}" ${customTurns === t ? 'selected' : ''}>${t} Turn</option>`).join('')}
                                    </select>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span>• ${escapeHtml(text.OPTION_MONEY_LABEL || '초기 자금')}</span>
                                    <select id="opt-init-money" ${!canEditOptions ? 'disabled' : ''} style="font-family: inherit; padding: 8px 14px; font-size: 18px; border-radius: 8px; border: none;">
                                        ${[1000000, 1500000, 2000000, 3000000].map(m => `<option value="${m}" ${customMoney === m ? 'selected' : ''}>${m.toLocaleString()}</option>`).join('')}
                                    </select>
                                </div>
                                <div>• ${escapeHtml(text.SETTING_AI_MODE)}</div>
                            </div>
                            <p style="margin: 18px 0 0 0; font-size: 18px; line-height: 1.5; color: #dceefb;">
                                ${escapeHtml(text.SETTING_CUSTOM_DESC)}
                            </p>
                        </div>

                        <button id="btn-toggle-ready" style="font-family: inherit; width: 100%; padding: 28px; font-size: 34px; font-weight: bold; background: ${readyBtnBg}; color: #fff; border: none; border-radius: 18px; cursor: pointer; box-shadow: 0 10px 22px rgba(0,0,0,0.3);">
                            ${escapeHtml(readyBtnLabel)}
                        </button>
                    </div>
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

        const turnSelect = container.querySelector('#opt-max-turn');
        const moneySelect = container.querySelector('#opt-init-money');
        if (canEditOptions && turnSelect && moneySelect) {
            const onOptionChange = async () => {
                await RoomManager.updateCustomOptions({
                    maxTurn: Number(turnSelect.value),
                    initialMoney: Number(moneySelect.value)
                });
                render();
            };
            turnSelect.onchange = onOptionChange;
            moneySelect.onchange = onOptionChange;
        }

        container.querySelector('#btn-toggle-ready').onclick = async () => {
            if (!isMyReady && !RoomManager.getReadinessSummary(room).hasMinPlayers) {
                showLobbyToast(container, text.TOAST_NEED_MIN_PLAYERS);
            }
            const res = await RoomManager.toggleReady();
            if (res && res.ok === false && res.errorCode) {
                showLobbyToast(container, text[res.errorCode] || text.TOAST_NEED_MIN_PLAYERS);
            }
            if (!isOnline && res?.startOfflineNow) {
                syncLocalCountdownState();
            } else {
                syncLocalCountdownState();
            }
            render();
        };

        container.querySelectorAll('.btn-slot-add-ai').forEach(btn => {
            btn.onclick = async () => {
                await RoomManager.fillSlotWithAi(Number(btn.dataset.idx), 'random');
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
