// ProgramFiles/System/Server/LobbyServer.js
// 서버 권위적 로비, 대기방 관리, 카운트다운, 재접속/이탈 처리 및 게임 세션 오케스트레이션

import crypto from 'node:crypto';
import { getGameMeta, pickRandomBotName } from '../GameRegistry.js';
import { GAME_CONSTANTS } from '../Index/Marble/MarblePriceIndex.js';
import { createGameSession, hasGameSessionSupport } from './GameSessionRegistry.js';
import { SystemLogManager } from '../Log/SystemLogManager.js';

const SLOT_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#2ecc71', '#e67e22'];
const AI_ARCHETYPES = ['random', 'aggressive', 'defensive', 'marathon'];
const CODE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const WAITING_DISCONNECT_GRACE_MS = 20000;
const PLAYING_EMPTY_ROOM_GRACE_MS = 60000;

function sanitizeText(str, maxLen = 24, fallback = '') {
    const cleaned = String(str ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, maxLen);
    return cleaned || fallback;
}

function clampCustomOptions(raw) {
    // 추후 턴/자금 커스텀 및 세부 파라미터 연동 전까지는 기본 기획 수치(20턴 / 500만)로 고정
    void raw;
    return {
        maxTurn: GAME_CONSTANTS.MAX_TURN,
        initialMoney: GAME_CONSTANTS.INITIAL_MONEY
    };
}

function createEmptySlot(slotIndex) {
    return {
        slotIndex,
        type: 'empty',
        id: null,
        name: null,
        color: SLOT_COLORS[slotIndex % SLOT_COLORS.length],
        isHost: false,
        isReady: false,
        isMockHuman: false,
        isConnected: true,
        aiType: null
    };
}

function getNextUnusedColor(room, fallbackIdx) {
    const used = new Set(room.slots.filter(s => s.type !== 'empty').map(s => s.color));
    return SLOT_COLORS.find(c => !used.has(c)) || SLOT_COLORS[fallbackIdx % SLOT_COLORS.length];
}

export class LobbyServer {
    constructor(options = {}) {
        this.logDir = options.logDir || null;
        this.disableDiskWrite = Boolean(options.disableDiskWrite);
        this.sessions = new Map(); // sessionToken -> sessionObj
        this.sessionsByPlayerId = new Map(); // playerId -> sessionObj
        this.rooms = new Map(); // roomId -> roomObj
        this.disconnectTimers = new Map(); // playerId -> timeoutId
        this.emptyRoomTimers = new Map(); // roomId -> timeoutId
        this._nextRoomSeq = 1;
    }

    getStats() {
        let waitingRooms = 0;
        let playingRooms = 0;
        for (const room of this.rooms.values()) {
            if (room.status === 'playing') playingRooms++;
            else waitingRooms++;
        }
        return {
            rooms: this.rooms.size,
            waitingRooms,
            playingRooms,
            sessions: this.sessions.size
        };
    }

    attachClient(client) {
        let boundSession = null;

        return {
            onMessage: (msg) => {
                if (!msg || typeof msg !== 'object' || !msg.type) return;

                if (msg.type === 'HELLO') {
                    boundSession = this._handleHello(client, msg, boundSession);
                    return;
                }

                if (!boundSession) {
                    this._sendReply(client, msg, false, null, 'NOT_AUTHENTICATED');
                    return;
                }

                try {
                    this._handleAuthedMessage(boundSession, client, msg);
                } catch (err) {
                    console.error('[LobbyServer] Error handling message:', msg.type, err);
                    this._sendReply(client, msg, false, null, 'SERVER_ERROR');
                }
            },
            onClose: () => {
                if (boundSession && boundSession.client === client) {
                    this._handleDisconnect(boundSession);
                }
            }
        };
    }

    _sendReply(client, reqMsg, ok, data = null, error = null) {
        if (!client || client.closed) return;
        if (reqMsg && reqMsg.reqId !== undefined) {
            client.sendJson({
                type: 'RPC_RESULT',
                reqId: reqMsg.reqId,
                ok: Boolean(ok),
                data,
                error
            });
        } else if (!ok && error) {
            client.sendJson({ type: 'ERROR', error });
        }
    }

    _sendToPlayer(playerId, payload) {
        const sess = this.sessionsByPlayerId.get(playerId);
        if (sess && sess.client && !sess.client.closed) {
            sess.client.sendJson(payload);
        }
    }

    _broadcastToRoom(room, payload, excludePlayerId = null) {
        for (const slot of room.slots) {
            if (slot.type === 'human' && slot.id && slot.id !== excludePlayerId) {
                this._sendToPlayer(slot.id, payload);
            }
        }
    }

    _broadcastLobbyUpdate(gameId) {
        const list = this._getRoomList(gameId);
        for (const sess of this.sessions.values()) {
            if (!sess.currentRoomId && sess.client && !sess.client.closed) {
                sess.client.sendJson({
                    type: 'LOBBY_ROOMS',
                    gameId,
                    rooms: list
                });
            }
        }
    }

    _serializeRoom(room) {
        if (!room) return null;
        return {
            id: room.id,
            code: room.code,
            gameId: room.gameId,
            title: room.title,
            isPrivate: Boolean(room.isPrivate),
            hasPassword: Boolean(room.password),
            maxPlayers: room.maxPlayers,
            hostId: room.hostId,
            status: room.status,
            countdownSec: room.countdownSec || 0,
            isSample: false,
            createdAt: room.createdAt,
            customOptions: { ...room.customOptions },
            slots: room.slots.map(s => ({
                slotIndex: s.slotIndex,
                type: s.type,
                id: s.id,
                name: s.name,
                color: s.color,
                isHost: s.isHost,
                isReady: s.isReady,
                isMockHuman: Boolean(s.isMockHuman),
                isConnected: s.isConnected !== false,
                aiType: s.aiType
            }))
        };
    }

    _handleHello(client, msg, prevBound) {
        const requestedToken = typeof msg.sessionToken === 'string' ? msg.sessionToken.trim() : '';
        let session = requestedToken ? this.sessions.get(requestedToken) : null;

        if (!session && prevBound) {
            session = prevBound;
        }

        const reqNick = sanitizeText(msg.nickname, 16, '');

        if (session) {
            if (session.client && session.client !== client && !session.client.closed) {
                session.client.close(1000, 'Replaced by reconnecting session');
            }
            session.client = client;
            if (reqNick) {
                session.nickname = reqNick;
            }
        } else {
            const sessionToken = crypto.randomUUID();
            const playerId = `usr_${crypto.randomUUID().slice(0, 8)}`;
            session = {
                sessionToken,
                playerId,
                nickname: reqNick || '교주',
                currentRoomId: null,
                client
            };
            this.sessions.set(sessionToken, session);
            this.sessionsByPlayerId.set(playerId, session);
        }

        this._cancelDisconnectTimer(session.playerId);

        let room = session.currentRoomId ? this.rooms.get(session.currentRoomId) : null;
        if (!room) {
            session.currentRoomId = null;
        } else {
            const mySlot = room.slots.find(s => s.id === session.playerId);
            if (!mySlot) {
                session.currentRoomId = null;
                room = null;
            } else {
                mySlot.isConnected = true;
                mySlot.name = session.nickname;
                this._cancelEmptyRoomTimer(room.id);
                this._broadcastToRoom(room, {
                    type: 'ROOM_UPDATED',
                    room: this._serializeRoom(room)
                });
                if (room.status === 'playing' && room.gameSession) {
                    room.gameSession.onPlayerReconnect(session.playerId);
                }
            }
        }

        const gameSnapshot = (room && room.status === 'playing' && room.gameSession)
            ? room.gameSession.getSnapshotForPlayer(session.playerId)
            : null;

        const ackPayload = {
            sessionToken: session.sessionToken,
            playerId: session.playerId,
            nickname: session.nickname,
            room: this._serializeRoom(room),
            gameSnapshot
        };

        client.sendJson({
            type: 'HELLO_ACK',
            reqId: msg.reqId ?? null,
            ...ackPayload
        });

        if (msg.reqId !== undefined) {
            this._sendReply(client, msg, true, ackPayload);
        }

        return session;
    }

    _handleAuthedMessage(session, client, msg) {
        switch (msg.type) {
            case 'PING':
                client.sendJson({ type: 'PONG', reqId: msg.reqId ?? null, serverTime: Date.now() });
                return;

            case 'GET_ROOMS': {
                const gameId = String(msg.gameId || 'marble');
                this._sendReply(client, msg, true, { gameId, rooms: this._getRoomList(gameId) });
                return;
            }

            case 'SET_NICKNAME': {
                const nick = sanitizeText(msg.nickname, 16, '');
                if (!nick) {
                    this._sendReply(client, msg, false, null, 'INVALID_NICKNAME');
                    return;
                }
                session.nickname = nick;
                const room = this._getSessionRoom(session);
                if (room && room.status === 'waiting') {
                    const slot = room.slots.find(s => s.id === session.playerId);
                    if (slot) {
                        slot.name = nick;
                        this._broadcastToRoom(room, { type: 'ROOM_UPDATED', room: this._serializeRoom(room) });
                        this._broadcastLobbyUpdate(room.gameId);
                    }
                }
                this._sendReply(client, msg, true, { nickname: session.nickname });
                return;
            }

            case 'CREATE_ROOM': {
                const gameId = String(msg.gameId || 'marble');
                const meta = getGameMeta(gameId);
                if (!meta || (!meta.lobbyEnabled && meta.status !== 'active')) {
                    this._sendReply(client, msg, false, null, 'GAME_NOT_AVAILABLE');
                    return;
                }
                if (session.currentRoomId) {
                    this._leaveRoomInternal(session);
                }

                const maxPlayers = Math.min(
                    meta.maxPlayers,
                    Math.max(meta.minPlayers, Number(msg.maxPlayers) || meta.maxPlayers)
                );
                const roomId = `room_${Date.now()}_${this._nextRoomSeq++}`;
                const code = this._generateUniqueCode(meta.codePrefix || 'RM');
                const isPrivate = Boolean(msg.isPrivate);
                const password = isPrivate ? sanitizeText(msg.password, 16, '') : '';
                const title = sanitizeText(msg.title, 32, `${session.nickname}의 방`);
                const customOptions = clampCustomOptions(msg.customOptions);

                const slots = Array.from({ length: maxPlayers }, (_, idx) => createEmptySlot(idx));
                slots[0] = {
                    slotIndex: 0,
                    type: 'human',
                    id: session.playerId,
                    name: session.nickname,
                    color: SLOT_COLORS[0],
                    isHost: true,
                    isReady: true,
                    isMockHuman: false,
                    isConnected: true,
                    aiType: null
                };

                const room = {
                    id: roomId,
                    code,
                    gameId,
                    title,
                    isPrivate,
                    password,
                    maxPlayers,
                    hostId: session.playerId,
                    status: 'waiting',
                    countdownSec: 0,
                    countdownTimer: null,
                    customOptions,
                    slots,
                    gameSession: null,
                    createdAt: Date.now()
                };

                this.rooms.set(roomId, room);
                session.currentRoomId = roomId;

                const serialized = this._serializeRoom(room);
                this._broadcastLobbyUpdate(gameId);
                this._sendReply(client, msg, true, { room: serialized });
                return;
            }

            case 'JOIN_ROOM_BY_ID': {
                const room = this.rooms.get(String(msg.roomId || ''));
                const res = this._joinRoomInternal(session, room, msg.password || '');
                this._sendReply(client, msg, res.ok, res.ok ? { room: res.room } : null, res.reason || null);
                return;
            }

            case 'JOIN_ROOM_BY_CODE': {
                const expectedGameId = msg.gameId ? String(msg.gameId) : null;
                const code = String(msg.code || '').replace(/\s+/g, '').trim().toUpperCase();
                if (!code) {
                    this._sendReply(client, msg, false, null, 'EMPTY_CODE');
                    return;
                }
                const room = Array.from(this.rooms.values()).find(
                    r => r.code.toUpperCase() === code
                );
                if (!room) {
                    this._sendReply(client, msg, false, null, 'ROOM_NOT_FOUND');
                    return;
                }
                if (expectedGameId && room.gameId !== expectedGameId) {
                    this._sendReply(client, msg, false, null, 'WRONG_GAME');
                    return;
                }
                const res = this._joinRoomInternal(session, room, msg.password || '');
                this._sendReply(client, msg, res.ok, res.ok ? { room: res.room } : null, res.reason || null);
                return;
            }

            case 'LEAVE_ROOM': {
                this._leaveRoomInternal(session);
                this._sendReply(client, msg, true, { left: true });
                return;
            }

            case 'TOGGLE_READY': {
                const room = this._getSessionRoom(session);
                if (!room) {
                    this._sendReply(client, msg, false, null, 'NO_ROOM');
                    return;
                }
                if (room.hostId === session.playerId) {
                    if (room.status === 'countdown') {
                        this._cancelCountdown(room, '방장이 게임 시작을 취소했습니다.');
                        this._sendReply(client, msg, true, { room: this._serializeRoom(room), cancelled: true });
                        return;
                    }
                    if (room.status !== 'waiting') {
                        this._sendReply(client, msg, false, null, 'INVALID_ROOM_STATUS');
                        return;
                    }
                    const check = this._canStart(room);
                    if (!check.canStart) {
                        this._sendReply(client, msg, false, null, check.reason);
                        return;
                    }
                    this._startCountdown(room);
                    this._sendReply(client, msg, true, { room: this._serializeRoom(room), countdownStarted: true });
                    return;
                }

                if (room.status !== 'waiting' && room.status !== 'countdown') {
                    this._sendReply(client, msg, false, null, 'INVALID_ROOM_STATUS');
                    return;
                }
                const slot = room.slots.find(s => s.id === session.playerId);
                if (!slot) {
                    this._sendReply(client, msg, false, null, 'SLOT_NOT_FOUND');
                    return;
                }
                slot.isReady = !slot.isReady;
                if (room.status === 'countdown' && !slot.isReady) {
                    this._cancelCountdown(room, '참가자 준비 해제로 시작이 취소되었습니다.');
                } else {
                    this._broadcastToRoom(room, { type: 'ROOM_UPDATED', room: this._serializeRoom(room) });
                }
                this._sendReply(client, msg, true, { room: this._serializeRoom(room) });
                return;
            }

            case 'ADD_AI': {
                const room = this._requireWaitingHost(session, client, msg);
                if (!room) return;
                const slotIdx = Number(msg.slotIndex);
                const slot = room.slots[slotIdx];
                if (!slot || slot.type !== 'empty') {
                    this._sendReply(client, msg, false, null, 'SLOT_NOT_EMPTY');
                    return;
                }
                this._cancelCountdownIfActive(room);
                this._assignAiSlot(room, slot, msg.aiType || 'random');
                this._syncRoomState(room);
                this._sendReply(client, msg, true, { room: this._serializeRoom(room) });
                return;
            }

            case 'ADD_ALL_AI': {
                const room = this._requireWaitingHost(session, client, msg);
                if (!room) return;
                this._cancelCountdownIfActive(room);
                let added = false;
                for (const slot of room.slots) {
                    if (slot.type === 'empty') {
                        this._assignAiSlot(room, slot, 'random');
                        added = true;
                    }
                }
                if (added) this._syncRoomState(room);
                this._sendReply(client, msg, true, { room: this._serializeRoom(room), added });
                return;
            }

            case 'CLEAR_AI': {
                const room = this._requireWaitingHost(session, client, msg);
                if (!room) return;
                this._cancelCountdownIfActive(room);
                let cleared = false;
                room.slots.forEach((slot, idx) => {
                    if (slot.type === 'ai') {
                        room.slots[idx] = createEmptySlot(idx);
                        cleared = true;
                    }
                });
                if (cleared) this._syncRoomState(room);
                this._sendReply(client, msg, true, { room: this._serializeRoom(room), cleared });
                return;
            }

            case 'CYCLE_AI': {
                const room = this._requireWaitingHost(session, client, msg);
                if (!room) return;
                const slot = room.slots[Number(msg.slotIndex)];
                if (!slot || slot.type !== 'ai') {
                    this._sendReply(client, msg, false, null, 'NOT_AI_SLOT');
                    return;
                }
                const curIdx = AI_ARCHETYPES.indexOf(slot.aiType || 'random');
                slot.aiType = AI_ARCHETYPES[(curIdx + 1) % AI_ARCHETYPES.length];
                this._syncRoomState(room);
                this._sendReply(client, msg, true, { room: this._serializeRoom(room) });
                return;
            }

            case 'CLEAR_SLOT': {
                const room = this._requireWaitingHost(session, client, msg);
                if (!room) return;
                const slotIdx = Number(msg.slotIndex);
                const slot = room.slots[slotIdx];
                if (!slot || slot.type === 'empty' || slot.isHost) {
                    this._sendReply(client, msg, false, null, 'CANNOT_CLEAR_SLOT');
                    return;
                }
                const kickedPlayerId = slot.type === 'human' ? slot.id : null;
                this._cancelCountdownIfActive(room);
                room.slots[slotIdx] = createEmptySlot(slotIdx);

                if (kickedPlayerId) {
                    const kickedSess = this.sessionsByPlayerId.get(kickedPlayerId);
                    if (kickedSess) {
                        kickedSess.currentRoomId = null;
                        this._sendToPlayer(kickedPlayerId, {
                            type: 'KICKED_FROM_ROOM',
                            roomId: room.id,
                            gameId: room.gameId,
                            reason: 'HOST_KICKED'
                        });
                    }
                }
                this._syncRoomState(room);
                this._sendReply(client, msg, true, { room: this._serializeRoom(room) });
                return;
            }

            case 'UPDATE_OPTIONS': {
                const room = this._requireWaitingHost(session, client, msg);
                if (!room) return;
                this._cancelCountdownIfActive(room);
                room.customOptions = clampCustomOptions(msg.customOptions);
                this._syncRoomState(room);
                this._sendReply(client, msg, true, { room: this._serializeRoom(room) });
                return;
            }

            case 'RETURN_TO_ROOM': {
                const room = this._getSessionRoom(session);
                if (!room) {
                    this._sendReply(client, msg, false, null, 'NO_ROOM');
                    return;
                }
                if (room.status === 'waiting') {
                    this._sendReply(client, msg, true, { room: this._serializeRoom(room) });
                    return;
                }
                if (room.status !== 'finished') {
                    this._sendReply(client, msg, false, null, 'GAME_STILL_RUNNING');
                    return;
                }
                this._resetRoomToWaiting(room);
                this._sendReply(client, msg, true, { room: this._serializeRoom(room) });
                return;
            }

            case 'GAME_ACTION': {
                const room = this._getSessionRoom(session);
                if (!room || room.status !== 'playing' || !room.gameSession) {
                    this._sendReply(client, msg, false, null, 'GAME_NOT_ACTIVE');
                    return;
                }
                const result = room.gameSession.handleAction(session.playerId, msg.action);
                this._sendReply(client, msg, Boolean(result?.ok), result?.ok ? { accepted: true } : null, result?.error || null);
                return;
            }

            default:
                this._sendReply(client, msg, false, null, 'UNKNOWN_MESSAGE_TYPE');
        }
    }

    _requireWaitingHost(session, client, msg) {
        const room = this._getSessionRoom(session);
        if (!room) {
            this._sendReply(client, msg, false, null, 'NO_ROOM');
            return null;
        }
        if (room.hostId !== session.playerId) {
            this._sendReply(client, msg, false, null, 'NOT_HOST');
            return null;
        }
        if (room.status !== 'waiting' && room.status !== 'countdown') {
            this._sendReply(client, msg, false, null, 'INVALID_ROOM_STATUS');
            return null;
        }
        return room;
    }

    _getSessionRoom(session) {
        if (!session?.currentRoomId) return null;
        return this.rooms.get(session.currentRoomId) || null;
    }

    _getRoomList(gameId) {
        return Array.from(this.rooms.values())
            .filter(r => r.gameId === gameId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(r => this._serializeRoom(r));
    }

    _generateUniqueCode(prefix = 'ROOM') {
        const p = String(prefix || 'ROOM').slice(0, 4).toUpperCase().padEnd(4, 'X');
        for (let attempt = 0; attempt < 200; attempt++) {
            let suffix = '';
            for (let i = 0; i < 6; i++) {
                suffix += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
            }
            const code = `${p}${suffix}`;
            const exists = Array.from(this.rooms.values()).some(r => r.code === code);
            if (!exists) return code;
        }
        return `${p}${crypto.randomInt(100000, 999999)}`;
    }

    _assignAiSlot(room, slot, aiType = 'random') {
        const usedNames = room.slots.filter(s => s.type !== 'empty' && s !== slot && s.name).map(s => s.name);
        slot.type = 'ai';
        slot.id = `ai_${room.id}_${slot.slotIndex}`;
        slot.name = pickRandomBotName(usedNames);
        slot.color = getNextUnusedColor(room, slot.slotIndex);
        slot.isHost = false;
        slot.isReady = true;
        slot.isMockHuman = false;
        slot.isConnected = true;
        slot.aiType = AI_ARCHETYPES.includes(aiType) ? aiType : 'random';
    }

    _syncRoomState(room) {
        const serialized = this._serializeRoom(room);
        this._broadcastToRoom(room, { type: 'ROOM_UPDATED', room: serialized });
        this._broadcastLobbyUpdate(room.gameId);
    }

    _joinRoomInternal(session, room, password = '') {
        if (!room) return { ok: false, reason: 'ROOM_NOT_FOUND' };
        if (session.currentRoomId === room.id) {
            return { ok: true, room: this._serializeRoom(room) };
        }
        if (room.status !== 'waiting') return { ok: false, reason: 'ALREADY_STARTED' };
        if (room.isPrivate && room.password && room.password !== String(password || '')) {
            return { ok: false, reason: 'WRONG_PASSWORD' };
        }

        const emptyIdx = room.slots.findIndex(s => s.type === 'empty');
        if (emptyIdx === -1) return { ok: false, reason: 'ROOM_FULL' };

        if (session.currentRoomId) {
            this._leaveRoomInternal(session);
        }

        room.slots[emptyIdx] = {
            slotIndex: emptyIdx,
            type: 'human',
            id: session.playerId,
            name: session.nickname,
            color: getNextUnusedColor(room, emptyIdx),
            isHost: false,
            isReady: false,
            isMockHuman: false,
            isConnected: true,
            aiType: null
        };
        session.currentRoomId = room.id;
        this._cancelEmptyRoomTimer(room.id);

        const serialized = this._serializeRoom(room);
        this._broadcastToRoom(room, { type: 'ROOM_UPDATED', room: serialized });
        this._broadcastLobbyUpdate(room.gameId);
        return { ok: true, room: serialized };
    }

    _convertSlotToAi(room, slotIdx, aiType = 'aggressive') {
        const oldSlot = room.slots[slotIdx];
        if (!oldSlot) return null;
        room.slots[slotIdx] = {
            slotIndex: slotIdx,
            type: 'ai',
            id: oldSlot.id,
            name: `${oldSlot.name} (AI)`,
            color: oldSlot.color,
            isHost: false,
            isReady: true,
            isMockHuman: false,
            isConnected: true,
            aiType: aiType || 'aggressive'
        };
        return room.slots[slotIdx];
    }

    _finalizeHumanRemovalFromRoom(room, removedPlayerId) {
        const remainingHumans = room.slots.filter(s => s.type === 'human');
        if (remainingHumans.length === 0) {
            this._destroyRoom(room.id);
            return;
        }

        if (room.hostId === removedPlayerId) {
            const nextHost = remainingHumans.find(s => s.isConnected) || remainingHumans[0];
            nextHost.isHost = true;
            if (room.status === 'waiting') nextHost.isReady = true;
            room.hostId = nextHost.id;
        }

        this._syncRoomState(room);
    }

    _kickPlayerForAfk(room, playerId, aiType = 'aggressive') {
        if (!room || !this.rooms.has(room.id)) return;
        this._cancelDisconnectTimer(playerId);
        const sess = this.sessionsByPlayerId.get(playerId);
        if (sess && sess.currentRoomId === room.id) {
            sess.currentRoomId = null;
        }

        const slotIdx = room.slots.findIndex(s => s.id === playerId);
        if (slotIdx !== -1 && room.status === 'playing') {
            this._convertSlotToAi(room, slotIdx, aiType);
        }

        this._sendToPlayer(playerId, {
            type: 'KICKED_FROM_ROOM',
            roomId: room.id,
            gameId: room.gameId,
            reason: 'AFK_KICKED',
            aiType
        });

        this._finalizeHumanRemovalFromRoom(room, playerId);
    }

    _leaveRoomInternal(session) {
        this._cancelDisconnectTimer(session.playerId);
        const room = this._getSessionRoom(session);
        session.currentRoomId = null;
        if (!room) return;

        const slotIdx = room.slots.findIndex(s => s.id === session.playerId);
        if (slotIdx === -1) return;

        if (room.status === 'playing' && room.gameSession) {
            this._convertSlotToAi(room, slotIdx, 'aggressive');
            room.gameSession.onPlayerLeave(session.playerId);
        } else {
            room.slots[slotIdx] = createEmptySlot(slotIdx);
            this._cancelCountdownIfActive(room);
        }

        this._finalizeHumanRemovalFromRoom(room, session.playerId);
    }

    _canStart(room) {
        if (!hasGameSessionSupport(room.gameId)) {
            return { canStart: false, reason: 'GAME_IN_DEVELOPMENT' };
        }
        const meta = getGameMeta(room.gameId);
        const minP = meta ? meta.minPlayers : 2;
        const activeSlots = room.slots.filter(s => s.type !== 'empty');
        const humanSlots = activeSlots.filter(s => s.type === 'human');

        if (activeSlots.length < minP) {
            return { canStart: false, reason: 'NOT_ENOUGH_PLAYERS' };
        }
        if (humanSlots.length < 1) {
            return { canStart: false, reason: 'NEED_HUMAN' };
        }
        if (humanSlots.some(s => !s.isReady)) {
            return { canStart: false, reason: 'NOT_ALL_READY' };
        }
        if (humanSlots.some(s => s.isConnected === false)) {
            return { canStart: false, reason: 'DISCONNECTED_MEMBER' };
        }
        return { canStart: true };
    }

    _cancelCountdownIfActive(room, message = '방 구성 변경으로 게임 시작이 취소되었습니다.') {
        if (room.status === 'countdown') {
            this._cancelCountdown(room, message);
        }
    }

    _cancelCountdown(room, message = '') {
        if (room.countdownTimer) {
            clearInterval(room.countdownTimer);
            room.countdownTimer = null;
        }
        room.countdownSec = 0;
        if (room.status === 'countdown') {
            room.status = 'waiting';
            this._broadcastToRoom(room, {
                type: 'COUNTDOWN',
                roomId: room.id,
                seconds: 0,
                cancelled: true,
                message,
                room: this._serializeRoom(room)
            });
            this._broadcastLobbyUpdate(room.gameId);
        }
    }

    _startCountdown(room) {
        this._cancelCountdown(room);
        room.status = 'countdown';
        room.countdownSec = 3;

        const emitTick = () => {
            this._broadcastToRoom(room, {
                type: 'COUNTDOWN',
                roomId: room.id,
                seconds: room.countdownSec,
                cancelled: false,
                room: this._serializeRoom(room)
            });
        };

        emitTick();
        this._broadcastLobbyUpdate(room.gameId);

        room.countdownTimer = setInterval(() => {
            if (!this.rooms.has(room.id) || room.status !== 'countdown') {
                clearInterval(room.countdownTimer);
                room.countdownTimer = null;
                return;
            }
            const check = this._canStart(room);
            if (!check.canStart) {
                this._cancelCountdown(room, '참가자 상태가 변경되어 시작이 취소되었습니다.');
                return;
            }
            room.countdownSec -= 1;
            if (room.countdownSec <= 0) {
                clearInterval(room.countdownTimer);
                room.countdownTimer = null;
                this._beginGameSession(room);
            } else {
                emitTick();
            }
        }, 1000);
    }

    _beginGameSession(room) {
        const meta = getGameMeta(room.gameId);
        room.status = 'playing';
        room.countdownSec = 0;

        let initialStarted = false;
        const gameSession = createGameSession(room.gameId, {
            room,
            broadcastToPlayer: (playerId, payload) => {
                if (!initialStarted) return;
                this._sendToPlayer(playerId, payload);
            },
            broadcastToRoom: (payload) => {
                if (!initialStarted) return;
                this._broadcastToRoom(room, payload);
            },
            onGameFinished: (results, matchLogData = null) => {
                if (this.rooms.has(room.id)) {
                    room.status = 'finished';
                    if (matchLogData && (!this.disableDiskWrite || this.logDir)) {
                        SystemLogManager.recordGameResult(room.gameId || 'marble', matchLogData, {
                            logDir: this.logDir
                        }).catch((err) => {
                            console.error('[LobbyServer] Failed to record game log:', err);
                        });
                    }
                    this._broadcastToRoom(room, {
                        type: 'ROOM_UPDATED',
                        room: this._serializeRoom(room)
                    });
                    this._broadcastLobbyUpdate(room.gameId);
                }
            },
            onPlayerAfkKick: ({ playerId, aiType }) => {
                if (this.rooms.has(room.id)) {
                    this._kickPlayerForAfk(room, playerId, aiType);
                }
            }
        });

        room.gameSession = gameSession;
        gameSession.start();
        initialStarted = true;

        const serialized = this._serializeRoom(room);
        for (const slot of room.slots) {
            if (slot.type === 'human' && slot.id) {
                this._sendToPlayer(slot.id, {
                    type: 'GAME_START',
                    roomId: room.id,
                    gameId: room.gameId,
                    sceneGame: meta?.sceneGame || 'marble',
                    room: serialized,
                    snapshot: gameSession.getSnapshotForPlayer(slot.id)
                });
            }
        }
        this._broadcastLobbyUpdate(room.gameId);
    }

    _resetRoomToWaiting(room) {
        if (room.gameSession) {
            room.gameSession.destroy();
            room.gameSession = null;
        }
        room.status = 'waiting';
        room.countdownSec = 0;

        room.slots.forEach((slot, idx) => {
            if (slot.type === 'human') {
                if (slot.isConnected === false) {
                    const sess = this.sessionsByPlayerId.get(slot.id);
                    if (sess) sess.currentRoomId = null;
                    room.slots[idx] = createEmptySlot(idx);
                } else {
                    slot.isReady = slot.id === room.hostId;
                    slot.isHost = slot.id === room.hostId;
                }
            }
        });

        const remainingHumans = room.slots.filter(s => s.type === 'human');
        if (remainingHumans.length === 0) {
            this._destroyRoom(room.id);
            return;
        }

        if (!remainingHumans.some(s => s.id === room.hostId)) {
            const newHost = remainingHumans[0];
            room.hostId = newHost.id;
            newHost.isHost = true;
            newHost.isReady = true;
        }

        const serialized = this._serializeRoom(room);
        this._broadcastToRoom(room, {
            type: 'RETURNED_TO_ROOM',
            roomId: room.id,
            room: serialized
        });
        this._broadcastLobbyUpdate(room.gameId);
    }

    _handleDisconnect(session) {
        const room = this._getSessionRoom(session);
        if (!room) return;

        const slot = room.slots.find(s => s.id === session.playerId);
        if (!slot) return;

        slot.isConnected = false;

        if (room.status === 'waiting' || room.status === 'countdown') {
            this._cancelCountdownIfActive(room, '참가자 연결이 끊어져 시작이 취소되었습니다.');
            this._broadcastToRoom(room, { type: 'ROOM_UPDATED', room: this._serializeRoom(room) });
            this._scheduleWaitingDisconnectCleanup(session.playerId, room.id);
            return;
        }

        if (room.status === 'playing' && room.gameSession) {
            room.gameSession.onPlayerDisconnect(session.playerId);
            this._broadcastToRoom(room, { type: 'ROOM_UPDATED', room: this._serializeRoom(room) });

            const connectedHumans = room.slots.filter(s => s.type === 'human' && s.isConnected !== false).length;
            if (connectedHumans === 0) {
                this._scheduleEmptyRoomTimer(room.id, PLAYING_EMPTY_ROOM_GRACE_MS);
            }
        } else if (room.status === 'finished') {
            const connectedHumans = room.slots.filter(s => s.type === 'human' && s.isConnected !== false).length;
            if (connectedHumans === 0) {
                this._scheduleEmptyRoomTimer(room.id, WAITING_DISCONNECT_GRACE_MS);
            }
        }
    }

    _scheduleWaitingDisconnectCleanup(playerId, roomId) {
        this._cancelDisconnectTimer(playerId);
        const timerId = setTimeout(() => {
            this.disconnectTimers.delete(playerId);
            const sess = this.sessionsByPlayerId.get(playerId);
            if (!sess || sess.currentRoomId !== roomId) return;
            const room = this.rooms.get(roomId);
            if (!room) return;
            const slot = room.slots.find(s => s.id === playerId);
            if (slot && slot.isConnected === false && (room.status === 'waiting' || room.status === 'countdown')) {
                this._leaveRoomInternal(sess);
            }
        }, WAITING_DISCONNECT_GRACE_MS);
        this.disconnectTimers.set(playerId, timerId);
    }

    _cancelDisconnectTimer(playerId) {
        const prev = this.disconnectTimers.get(playerId);
        if (prev) {
            clearTimeout(prev);
            this.disconnectTimers.delete(playerId);
        }
    }

    _scheduleEmptyRoomTimer(roomId, delayMs) {
        this._cancelEmptyRoomTimer(roomId);
        const timerId = setTimeout(() => {
            this.emptyRoomTimers.delete(roomId);
            const room = this.rooms.get(roomId);
            if (!room) return;
            const connectedHumans = room.slots.filter(s => s.type === 'human' && s.isConnected !== false).length;
            if (connectedHumans === 0) {
                this._destroyRoom(roomId);
            }
        }, delayMs);
        this.emptyRoomTimers.set(roomId, timerId);
    }

    _cancelEmptyRoomTimer(roomId) {
        const prev = this.emptyRoomTimers.get(roomId);
        if (prev) {
            clearTimeout(prev);
            this.emptyRoomTimers.delete(roomId);
        }
    }

    _destroyRoom(roomId) {
        this._cancelEmptyRoomTimer(roomId);
        const room = this.rooms.get(roomId);
        if (!room) return;
        const gameId = room.gameId;
        if (room.countdownTimer) {
            clearInterval(room.countdownTimer);
            room.countdownTimer = null;
        }
        if (room.gameSession) {
            room.gameSession.destroy();
            room.gameSession = null;
        }
        for (const slot of room.slots) {
            if (slot.type === 'human' && slot.id) {
                this._cancelDisconnectTimer(slot.id);
                const sess = this.sessionsByPlayerId.get(slot.id);
                if (sess && sess.currentRoomId === roomId) {
                    sess.currentRoomId = null;
                }
            }
        }
        this.rooms.delete(roomId);
        this._broadcastLobbyUpdate(gameId);
    }

    destroy() {
        for (const t of this.disconnectTimers.values()) clearTimeout(t);
        this.disconnectTimers.clear();
        for (const t of this.emptyRoomTimers.values()) clearTimeout(t);
        this.emptyRoomTimers.clear();
        for (const roomId of Array.from(this.rooms.keys())) {
            this._destroyRoom(roomId);
        }
        this.sessions.clear();
        this.sessionsByPlayerId.clear();
    }
}
