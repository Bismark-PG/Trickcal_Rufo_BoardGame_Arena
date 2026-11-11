import { changeScene } from '../Main.js';
import { RoomManager } from './RoomManager.js';
import { getGameMeta } from '../System/GameRegistry.js';
import { LangState } from '../System/LanguageManager.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';

export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function showLobbyToast(container, msg, duration = 2400) {
    const existing = container.querySelector('#lobby-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'lobby-toast';
    toast.style.cssText = `
        position: absolute; bottom: 45px; left: 50%; transform: translateX(-50%);
        background: rgba(15, 25, 35, 0.94); color: #fff; padding: 16px 34px;
        border-radius: 14px; font-size: 22px; font-weight: bold; z-index: 9999;
        border: 3px solid #f39c12; box-shadow: 0 10px 28px rgba(0,0,0,0.45);
        pointer-events: none; text-align: center;
    `;
    toast.innerText = msg;
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, duration);
}

export function renderGameMainPage(container, config) {
    const {
        gameId,
        titleKey,
        badgeKey,
        rulesKey,
        defaultRoomTitleKey
    } = config;

    const meta = getGameMeta(gameId);

    const render = () => {
        const text = LobbyLang[LangState.current] || LobbyLang.ko;
        const rooms = RoomManager.getPublicRooms(gameId);
        const gameTitle = text[titleKey] || gameId;
        const gameBadge = text[badgeKey] || '';
        const rulesList = Array.isArray(text[rulesKey]) ? text[rulesKey] : [];
        const defaultTitle = text[defaultRoomTitleKey] || gameTitle;

        const roomRowsHtml = rooms.length === 0
            ? `<div style="height: 360px; display:flex; align-items:center; justify-content:center; font-size: 24px; color: rgba(255,255,255,0.75);">${escapeHtml(text.EMPTY_ROOM_LIST)}</div>`
            : rooms.map(room => {
                const occ = RoomManager.getOccupiedCount(room);
                const isFull = occ >= room.maxPlayers;
                const statusText = room.status === 'playing'
                    ? text.STATUS_PLAYING
                    : (room.status === 'starting' ? text.STATUS_STARTING : text.STATUS_WAITING);
                const statusColor = room.status === 'playing' ? '#e74c3c' : '#2ecc71';
                const joinDisabled = isFull || room.status === 'playing';

                return `
                    <div style="display: grid; grid-template-columns: 140px 1fr 160px 110px 120px 140px; align-items: center; background: #165b7a; border-radius: 16px; padding: 18px 24px; margin-bottom: 14px; color: #fff; font-size: 21px; border: 2px solid rgba(255,255,255,0.12);">
                        <div style="font-family: monospace; font-size: 22px; font-weight: bold; color: #f1c40f; letter-spacing: 1px;">${escapeHtml(room.code)}</div>
                        <div style="font-weight: bold; padding-right: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(room.title)}</div>
                        <div style="color: #dceefb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">👑 ${escapeHtml(RoomManager.getHostName(room))}</div>
                        <div style="font-weight: bold;">${occ} / ${room.maxPlayers}${escapeHtml(text.PLAYERS_UNIT)}</div>
                        <div><span style="display: inline-block; padding: 5px 12px; border-radius: 8px; background: ${statusColor}; color: #fff; font-size: 16px; font-weight: bold;">${escapeHtml(statusText)}</span></div>
                        <div style="text-align: right;">
                            <button class="btn-join-room-row" data-room-id="${escapeHtml(room.id)}" ${joinDisabled ? 'disabled' : ''} style="font-family: inherit; padding: 10px 24px; font-size: 19px; font-weight: bold; border: none; border-radius: 10px; cursor: ${joinDisabled ? 'not-allowed' : 'pointer'}; background: ${joinDisabled ? '#7f8c8d' : '#f39c12'}; color: #fff;">
                                ${escapeHtml(isFull ? text.BTN_ROOM_FULL : text.BTN_JOIN_ROOM)}
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

        const playerCountOptions = [];
        for (let n = meta.minPlayers; n <= meta.maxPlayers; n++) {
            playerCountOptions.push(`<option value="${n}" ${n === meta.maxPlayers ? 'selected' : ''}>${n}${escapeHtml(text.PLAYERS_UNIT)}</option>`);
        }

        container.innerHTML = `
            <div style="width: 100%; height: 100%; box-sizing: border-box; padding: 42px 60px; display: flex; flex-direction: column; position: relative;">
                <!-- 상단 헤더 -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px;">
                    <div style="display: flex; align-items: center; gap: 24px;">
                        <button id="btn-back-arena" style="font-family: inherit; padding: 14px 26px; font-size: 22px; font-weight: bold; background: #165b7a; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BACK_TO_ARENA)}</button>
                        <div>
                            <div style="display: flex; align-items: center; gap: 14px;">
                                <h1 style="margin: 0; font-size: 46px; color: #165b7a;">${escapeHtml(gameTitle)}</h1>
                                <span style="padding: 6px 14px; border-radius: 20px; background: ${meta.accentColor}; color: #fff; font-size: 18px; font-weight: bold;">${escapeHtml(gameBadge)}</span>
                            </div>
                            <p style="margin: 6px 0 0 0; font-size: 21px; color: #4a5568;">${escapeHtml(text.GAME_MAIN_SUBTITLE)}</p>
                        </div>
                    </div>

                    <!-- 닉네임 설정 & 네트워크 상태 바 -->
                    <div style="display: flex; align-items: center; gap: 14px;">
                        <div id="net-status-badge" style="padding: 12px 18px; border-radius: 14px; font-size: 18px; font-weight: bold; color: #fff; background: ${RoomManager.isOnline() ? '#27ae60' : (RoomManager.getNetworkStatus().status === 'reconnecting' ? '#d35400' : '#7f8c8d')};">
                            ${escapeHtml(RoomManager.isOnline() ? (text.NET_ONLINE || '🟢 온라인') : (RoomManager.getNetworkStatus().status === 'reconnecting' ? (text.NET_RECONNECTING || '🟡 재연결 중') : (text.NET_OFFLINE || '🟠 오프라인 AI 모드')))}
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px; background: #216a8c; padding: 14px 22px; border-radius: 16px; color: #fff;">
                            <span style="font-size: 19px; font-weight: bold;">${escapeHtml(text.NICKNAME_LABEL)}:</span>
                            <input id="input-nickname" type="text" maxlength="16" value="${escapeHtml(RoomManager.localPlayer.name)}" style="font-family: inherit; width: 180px; padding: 8px 12px; font-size: 20px; border-radius: 8px; border: none; outline: none;">
                            <button id="btn-save-nick" style="font-family: inherit; padding: 8px 18px; font-size: 19px; font-weight: bold; background: #f39c12; color: #fff; border: none; border-radius: 8px; cursor: pointer;">${escapeHtml(text.BTN_CHANGE_NICK)}</button>
                        </div>
                    </div>
                </div>

                <!-- 메인 컨텐츠 2열 -->
                <div style="flex: 1; display: grid; grid-template-columns: 1fr 440px; gap: 32px; min-height: 0;">
                    <!-- 좌측: 대기실 목록 + 방 생성/참가 액션 -->
                    <div style="background: #216a8c; border-radius: 26px; padding: 30px; display: flex; flex-direction: column; min-height: 0; box-shadow: 0 12px 26px rgba(0,0,0,0.16);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                            <h2 style="margin: 0; font-size: 32px; color: #fff;">${escapeHtml(text.ROOM_LIST_TITLE)} (${rooms.length})</h2>
                            <div style="display: flex; gap: 12px;">
                                <button id="btn-refresh-rooms" style="font-family: inherit; padding: 12px 20px; font-size: 20px; font-weight: bold; background: #165b7a; color: #fff; border: 2px solid rgba(255,255,255,0.25); border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_REFRESH)}</button>
                                <button id="btn-open-join-code" style="font-family: inherit; padding: 12px 22px; font-size: 20px; font-weight: bold; background: #3498db; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_JOIN_BY_CODE)}</button>
                                <button id="btn-open-create-room" style="font-family: inherit; padding: 12px 26px; font-size: 20px; font-weight: bold; background: #27ae60; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_CREATE_ROOM)}</button>
                            </div>
                        </div>

                        <!-- 테이블 헤더 -->
                        <div style="display: grid; grid-template-columns: 140px 1fr 160px 110px 120px 140px; padding: 0 24px 12px 24px; color: rgba(255,255,255,0.75); font-size: 18px; font-weight: bold;">
                            <div>${escapeHtml(text.COL_CODE)}</div>
                            <div>${escapeHtml(text.COL_TITLE)}</div>
                            <div>${escapeHtml(text.COL_HOST)}</div>
                            <div>${escapeHtml(text.COL_PLAYERS)}</div>
                            <div>${escapeHtml(text.COL_STATUS)}</div>
                            <div style="text-align: right;">${escapeHtml(text.COL_ACTION)}</div>
                        </div>

                        <!-- 목록 스크롤 영역 -->
                        <div style="flex: 1; overflow-y: auto; padding-right: 4px;">
                            ${roomRowsHtml}
                        </div>
                    </div>

                    <!-- 우측: 게임 소개 및 규칙 요약 -->
                    <div style="background: #165b7a; border-radius: 26px; padding: 32px; color: #fff; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 12px 26px rgba(0,0,0,0.16);">
                        <div>
                            <h2 style="margin: 0 0 18px 0; font-size: 30px; color: #f1c40f;">${escapeHtml(text.RULE_SUMMARY_TITLE)}</h2>
                            <div style="display: flex; flex-direction: column; gap: 14px; font-size: 21px; line-height: 1.55; color: #ecf0f1;">
                                ${rulesList.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
                            </div>
                        </div>

                        <div style="background: rgba(0,0,0,0.22); border-radius: 16px; padding: 20px; font-size: 18px; line-height: 1.5; color: #dceefb;">
                            ${escapeHtml(text.CUSTOM_PREVIEW_NOTE)}
                        </div>
                    </div>
                </div>

                <!-- 모달: 방 생성 -->
                <div id="modal-create-room" style="display: none; position: absolute; inset: 0; background: rgba(0,0,0,0.58); z-index: 500; justify-content: center; align-items: center;">
                    <div style="width: 580px; background: #fff; border-radius: 22px; padding: 38px; border: 5px solid #165b7a; box-shadow: 0 15px 40px rgba(0,0,0,0.45); color: #1a202c;">
                        <h2 style="margin: 0 0 26px 0; font-size: 34px; text-align: center; color: #165b7a;">${escapeHtml(text.CREATE_MODAL_TITLE)}</h2>

                        <div style="margin-bottom: 20px;">
                            <label style="display: block; font-size: 20px; font-weight: bold; margin-bottom: 8px;">${escapeHtml(text.ROOM_TITLE_LABEL)}</label>
                            <input id="create-room-title" type="text" maxlength="32" value="${escapeHtml(defaultTitle)}" style="font-family: inherit; width: 100%; box-sizing: border-box; padding: 12px 16px; font-size: 22px; border: 2px solid #cbd5e0; border-radius: 10px;">
                        </div>

                        <div style="margin-bottom: 20px;">
                            <label style="display: block; font-size: 20px; font-weight: bold; margin-bottom: 8px;">${escapeHtml(text.MAX_PLAYERS_LABEL)}</label>
                            <select id="create-room-max" style="font-family: inherit; width: 100%; padding: 12px 16px; font-size: 22px; border: 2px solid #cbd5e0; border-radius: 10px;">
                                ${playerCountOptions.join('')}
                            </select>
                        </div>

                        <div style="margin-bottom: 28px;">
                            <label style="display: block; font-size: 20px; font-weight: bold; margin-bottom: 10px;">${escapeHtml(text.VISIBILITY_LABEL)}</label>
                            <div style="display: flex; flex-direction: column; gap: 10px; font-size: 20px;">
                                <label style="cursor: pointer;"><input type="radio" name="room-visibility" value="public" checked> ${escapeHtml(text.PUBLIC_ROOM)}</label>
                                <label style="cursor: pointer;"><input type="radio" name="room-visibility" value="private"> ${escapeHtml(text.PRIVATE_ROOM)}</label>
                            </div>
                            <input id="create-room-password" type="password" maxlength="16" placeholder="${escapeHtml(text.JOIN_PASSWORD_OPTIONAL || '비밀번호 (비공개 시 선택)')}" style="font-family: inherit; width: 100%; box-sizing: border-box; margin-top: 10px; padding: 10px 14px; font-size: 18px; border: 2px solid #cbd5e0; border-radius: 10px;">
                        </div>

                        <div style="display: flex; gap: 16px;">
                            <button id="btn-cancel-create" style="font-family: inherit; flex: 1; padding: 16px; font-size: 22px; font-weight: bold; background: #95a5a6; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_CANCEL)}</button>
                            <button id="btn-confirm-create" style="font-family: inherit; flex: 1.4; padding: 16px; font-size: 22px; font-weight: bold; background: #27ae60; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_CONFIRM_CREATE)}</button>
                        </div>
                    </div>
                </div>

                <!-- 모달: 방 코드로 참가 -->
                <div id="modal-join-code" style="display: none; position: absolute; inset: 0; background: rgba(0,0,0,0.58); z-index: 500; justify-content: center; align-items: center;">
                    <div style="width: 540px; background: #fff; border-radius: 22px; padding: 38px; border: 5px solid #165b7a; box-shadow: 0 15px 40px rgba(0,0,0,0.45); color: #1a202c;">
                        <h2 style="margin: 0 0 22px 0; font-size: 34px; text-align: center; color: #165b7a;">${escapeHtml(text.JOIN_MODAL_TITLE)}</h2>

                        <div style="margin-bottom: 14px;">
                            <label style="display: block; font-size: 20px; font-weight: bold; margin-bottom: 10px;">${escapeHtml(text.JOIN_CODE_LABEL)}</label>
                            <input id="input-join-code" type="text" maxlength="10" placeholder="${escapeHtml(text.JOIN_CODE_PLACEHOLDER)}" style="font-family: monospace; width: 100%; box-sizing: border-box; padding: 14px 18px; font-size: 28px; text-transform: uppercase; text-align: center; letter-spacing: 3px; border: 2px solid #cbd5e0; border-radius: 12px;">
                        </div>

                        <div style="margin-bottom: 14px;">
                            <input id="input-join-password" type="password" maxlength="16" placeholder="${escapeHtml(text.JOIN_PASSWORD_OPTIONAL || '비밀번호 (설정된 경우)')}" style="font-family: inherit; width: 100%; box-sizing: border-box; padding: 10px 14px; font-size: 18px; border: 2px solid #cbd5e0; border-radius: 10px;">
                        </div>

                        <p style="margin: 0 0 26px 0; font-size: 16px; color: #555; text-align: center;">${escapeHtml(text.JOIN_CODE_HINT)}</p>

                        <div style="display: flex; gap: 16px;">
                            <button id="btn-cancel-join" style="font-family: inherit; flex: 1; padding: 16px; font-size: 22px; font-weight: bold; background: #95a5a6; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_CANCEL)}</button>
                            <button id="btn-confirm-join" style="font-family: inherit; flex: 1.4; padding: 16px; font-size: 22px; font-weight: bold; background: #3498db; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_CONFIRM_JOIN)}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 이벤트 바인딩
        container.querySelector('#btn-back-arena').onclick = () => changeScene('menu');
        container.querySelector('#btn-refresh-rooms').onclick = async () => {
            await RoomManager.fetchRooms(gameId);
            render();
        };

        const saveNick = async () => {
            const val = container.querySelector('#input-nickname').value;
            if (!(await RoomManager.setNickname(val))) {
                showLobbyToast(container, text.NICK_EMPTY_ERR);
                return;
            }
            showLobbyToast(container, `${text.NICK_UPDATED} ${RoomManager.localPlayer.name}`);
        };
        container.querySelector('#btn-save-nick').onclick = saveNick;

        // 모달 제어
        const createModal = container.querySelector('#modal-create-room');
        const joinModal = container.querySelector('#modal-join-code');
        const joinInput = container.querySelector('#input-join-code');
        const joinPassInput = container.querySelector('#input-join-password');
        const createPassInput = container.querySelector('#create-room-password');
        const titleInput = container.querySelector('#create-room-title');

        container.querySelector('#btn-open-create-room').onclick = () => {
            createModal.style.display = 'flex';
            titleInput.focus();
        };
        container.querySelector('#btn-cancel-create').onclick = () => {
            createModal.style.display = 'none';
        };

        const submitCreate = async () => {
            const title = titleInput.value;
            const maxPlayers = Number(container.querySelector('#create-room-max').value);
            const vis = container.querySelector('input[name="room-visibility"]:checked')?.value;
            const res = await RoomManager.createRoom({
                gameId,
                title,
                isPrivate: vis === 'private',
                password: createPassInput ? createPassInput.value : '',
                maxPlayers
            });
            if (!res.ok) {
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
            joinModal.style.display = 'flex';
            joinInput.value = '';
            if (joinPassInput) joinPassInput.value = '';
            joinInput.focus();
        };
        container.querySelector('#btn-cancel-join').onclick = () => {
            joinModal.style.display = 'none';
        };

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
            const cm = container.querySelector('#modal-create-room');
            const jm = container.querySelector('#modal-join-code');
            if (cm) cm.style.display = 'none';
            if (jm) jm.style.display = 'none';
        }
    };
    document.addEventListener('languageChanged', langHandler);
    document.addEventListener('keydown', escHandler);

    let isCleanedUp = false;
    const unsubscribeRoom = RoomManager.subscribe((evtName, payload) => {
        if (isCleanedUp) return;
        if (evtName === 'NETWORK_STATUS' || evtName === 'HELLO_ACK') {
            RoomManager.fetchRooms(gameId).then(() => {
                if (!isCleanedUp) render();
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
        const activeRoom = netRes?.helloAck?.room;
        if (activeRoom && activeRoom.gameId === gameId) {
            if (activeRoom.status === 'playing' && netRes.helloAck.gameSnapshot) {
                changeScene(gameMeta.sceneGame, {
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
