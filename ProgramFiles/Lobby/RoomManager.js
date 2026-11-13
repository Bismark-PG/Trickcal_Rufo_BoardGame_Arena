// ProgramFiles/Lobby/RoomManager.js
// 온라인 WebSocket 서버 연동 + 오프라인 로컬 엔진 폴백을 통합 제공하는 방/매치 매니저

import { getGameMeta, pickRandomBotName } from '../System/GameRegistry.js';
import { LangState } from '../System/LanguageManager.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { NetworkClient } from '../System/NetworkClient.js';
import { SystemLogManager } from '../System/Log/SystemLogManager.js';
import { MarbleGameEngine } from '../Marble/MarbleEngine.js';

const SLOT_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#2ecc71', '#e67e22'];
const AI_ARCHETYPES = ['random', 'aggressive', 'defensive', 'marathon'];
const MOCK_NAMES = ['에르핀', '네르', '다야', '티그', '루포', '슈로', '코미', '버터'];
const CODE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const SERVER_ERROR_TO_KEY = {
    EMPTY_CODE: 'ERR_EMPTY_CODE',
    ROOM_NOT_FOUND: 'ERR_NOT_FOUND',
    WRONG_GAME: 'ERR_WRONG_GAME',
    ROOM_FULL: 'ERR_ROOM_FULL',
    ALREADY_STARTED: 'ERR_ALREADY_PLAYING',
    WRONG_PASSWORD: 'ERR_WRONG_PASSWORD',
    NOT_ENOUGH_PLAYERS: 'TOAST_NEED_MIN_PLAYERS',
    NEED_HUMAN: 'TOAST_NEED_MIN_PLAYERS',
    NOT_ALL_READY: 'TOAST_NEED_MIN_PLAYERS',
    GAME_IN_DEVELOPMENT: 'ERR_GAME_IN_DEVELOPMENT',
    INVALID_NICKNAME: 'NICK_EMPTY_ERR'
};

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

function mapServerError(errorCode) {
    return SERVER_ERROR_TO_KEY[errorCode] || errorCode || 'ERR_NOT_FOUND';
}

function getDefaultCustomOptions() {
    return {
        maxTurn: GAME_CONSTANTS.MAX_TURN,
        initialMoney: GAME_CONSTANTS.INITIAL_MONEY
    };
}

export const RoomManager = {
    localPlayer: {
        id: 'local_player_1',
        name: NetworkClient.nickname || LobbyLang[LangState.current]?.DEFAULT_NICKNAME || '교주'
    },

    // 오프라인/온라인 통합 캐시 상태
    rooms: [], // 오프라인 방 캐시
    onlineRoomsByGame: {}, // 게임별 온라인 방 목록 캐시 { [gameId]: room[] }
    seededGames: new Set(),
    currentRoomId: null,
    onlineCurrentRoom: null,
    activeSnapshot: null,
    localEngine: null,
    _nextRoomSeq: 1,
    _nextMockSeq: 1,
    _netInitialized: false,
    _uiListeners: new Set(),
    _gameListeners: new Set(),

    subscribe(listener) {
        this._uiListeners.add(listener);
        return () => this._uiListeners.delete(listener);
    },

    _emitUi(eventName, data = null) {
        for (const fn of Array.from(this._uiListeners)) {
            try { fn(eventName, data); } catch (e) { console.error('[RoomManager] UI listener error:', e); }
        }
    },

    subscribeGame(listener) {
        this._gameListeners.add(listener);
        return () => this._gameListeners.delete(listener);
    },

    _emitGame(eventName, payload = null) {
        for (const fn of Array.from(this._gameListeners)) {
            try { fn(eventName, payload); } catch (e) { console.error('[RoomManager] Game listener error:', e); }
        }
    },

    isOnline() {
        return NetworkClient.isOnline();
    },

    getNetworkStatus() {
        return NetworkClient.getStatus();
    },

    async initNetwork() {
        if (!this._netInitialized) {
            this._netInitialized = true;

            NetworkClient.subscribe('NETWORK_STATUS', (st) => {
                this._emitUi('NETWORK_STATUS', st);
            });

            NetworkClient.subscribe('HELLO_ACK', (msg) => {
                if (msg.playerId) this.localPlayer.id = msg.playerId;
                if (msg.nickname) {
                    this.localPlayer.name = msg.nickname;
                    NetworkClient.setStoredNickname(msg.nickname);
                }
                this.onlineCurrentRoom = msg.room || null;
                this.currentRoomId = msg.room ? msg.room.id : null;
                this.activeSnapshot = msg.gameSnapshot || null;
                this._emitUi('HELLO_ACK', msg);
                if (msg.gameSnapshot) {
                    this._emitGame('STATE', msg.gameSnapshot);
                }
            });

            NetworkClient.subscribe('LOBBY_ROOMS', (msg) => {
                if (Array.isArray(msg.rooms)) {
                    const gid = msg.gameId || msg.rooms[0]?.gameId || 'marble';
                    this.onlineRoomsByGame[gid] = msg.rooms;
                    this._emitUi('LOBBY_ROOMS', { ...msg, gameId: gid });
                }
            });

            NetworkClient.subscribe('ROOM_UPDATED', (msg) => {
                if (msg.room) {
                    this.onlineCurrentRoom = msg.room;
                    this.currentRoomId = msg.room.id;
                    this._emitUi('ROOM_UPDATED', msg.room);
                    this._emitGame('ROOM_UPDATED', msg.room);
                }
            });

            NetworkClient.subscribe('COUNTDOWN', (msg) => {
                if (msg.room) {
                    this.onlineCurrentRoom = msg.room;
                }
                this._emitUi('COUNTDOWN', msg);
            });

            NetworkClient.subscribe('GAME_START', (msg) => {
                if (msg.room) {
                    this.onlineCurrentRoom = msg.room;
                    this.currentRoomId = msg.room.id;
                }
                if (msg.snapshot) {
                    this.activeSnapshot = msg.snapshot;
                }
                this._emitUi('GAME_START', msg);
            });

            NetworkClient.subscribe('GAME_STATE', (msg) => {
                if (msg.snapshot) {
                    this.activeSnapshot = msg.snapshot;
                    this._emitGame('STATE', msg.snapshot);
                }
            });

            NetworkClient.subscribe('GAME_EVENT', (msg) => {
                if (msg.event) {
                    this._emitGame('EVENT', msg.event);
                }
            });

            NetworkClient.subscribe('GAME_TIMER', (msg) => {
                this._emitGame('TIMER', msg);
            });

            NetworkClient.subscribe('RETURNED_TO_ROOM', (msg) => {
                this.activeSnapshot = null;
                if (msg.room) {
                    this.onlineCurrentRoom = msg.room;
                    this.currentRoomId = msg.room.id;
                }
                this._emitGame('RETURNED_TO_ROOM', msg.room);
                this._emitUi('RETURNED_TO_ROOM', msg.room);
            });

            NetworkClient.subscribe('KICKED_FROM_ROOM', (msg) => {
                this.onlineCurrentRoom = null;
                this.currentRoomId = null;
                this.activeSnapshot = null;
                this._emitUi('KICKED_FROM_ROOM', msg);
                this._emitGame('KICKED', msg);
            });
        }

        const res = await NetworkClient.connect();
        if (res.online && res.helloAck) {
            this.localPlayer.id = res.helloAck.playerId || this.localPlayer.id;
            if (res.helloAck.nickname) {
                this.localPlayer.name = res.helloAck.nickname;
            }
            this.onlineCurrentRoom = res.helloAck.room || null;
            this.currentRoomId = res.helloAck.room ? res.helloAck.room.id : null;
            this.activeSnapshot = res.helloAck.gameSnapshot || null;
        }
        return res;
    },

    async fetchRooms(gameId) {
        if (this.isOnline()) {
            const res = await NetworkClient.request('GET_ROOMS', { gameId });
            if (res.ok && res.data?.rooms) {
                this.onlineRoomsByGame[gameId] = res.data.rooms;
                return this.onlineRoomsByGame[gameId];
            }
        }
        return this.getRoomsByGame(gameId);
    },

    async setNickname(newName) {
        const trimmed = (newName || '').trim().slice(0, 16);
        if (!trimmed) return false;

        if (this.isOnline()) {
            const res = await NetworkClient.request('SET_NICKNAME', { nickname: trimmed });
            if (!res.ok) return false;
            this.localPlayer.name = res.data?.nickname || trimmed;
            NetworkClient.setStoredNickname(this.localPlayer.name);
            return true;
        }

        this.localPlayer.name = trimmed;
        NetworkClient.setStoredNickname(trimmed);
        const cur = this.getCurrentRoom();
        if (cur) {
            const mySlot = this.getMySlot(cur);
            if (mySlot) mySlot.name = this.localPlayer.name;
        }
        return true;
    },

    generateUniqueCode(prefix = 'ROOM') {
        const p = String(prefix || 'ROOM').slice(0, 4).toUpperCase().padEnd(4, 'X');
        for (let attempt = 0; attempt < 200; attempt++) {
            let suffix = '';
            for (let i = 0; i < 6; i++) {
                suffix += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
            }
            const candidate = `${p}${suffix}`;
            if (!this.rooms.some(r => r.code.toUpperCase() === candidate)) {
                return candidate;
            }
        }
        return `${p}${Math.floor(100000 + Math.random() * 900000)}`;
    },

    seedSampleRooms(gameId) {
        if (this.isOnline() || this.seededGames.has(gameId)) return;
        this.seededGames.add(gameId);

        const meta = getGameMeta(gameId);
        if (!meta || (!meta.lobbyEnabled && meta.status !== 'active')) return;

        const lang = LangState.current;
        const samples = gameId === 'unos'
            ? (lang === 'en'
                ? [
                    { code: 'UNOSSMP101', title: 'UNOS 1v1 Lobby Test Room', host: 'Rufo', max: 2, aiCount: 0, isPrivate: false },
                    { code: 'UNOSSMP777', title: 'Private 1v1 Tactics Test', host: 'Suro', max: 2, aiCount: 1, isPrivate: true }
                ]
                : (lang === 'ja'
                    ? [
                        { code: 'UNOSSMP101', title: 'ウノス 1対1 テストルーム', host: 'ルポ', max: 2, aiCount: 0, isPrivate: false },
                        { code: 'UNOSSMP777', title: '秘密の1対1練習ルーム', host: 'シュロ', max: 2, aiCount: 1, isPrivate: true }
                    ]
                    : [
                        { code: 'UNOSSMP101', title: '우노스 1대1 대기방 테스트', host: '루포', max: 2, aiCount: 0, isPrivate: false },
                        { code: 'UNOSSMP777', title: '우노스 비공개 1대1 연습실', host: '슈로', max: 2, aiCount: 1, isPrivate: true }
                    ]))
            : (lang === 'en'
                ? [
                    { code: 'EMRBSMP101', title: 'Beginners Welcome! Friendly Match', host: 'Erpin', max: 4, aiCount: 1, isPrivate: false },
                    { code: 'EMRBSMP204', title: 'Fast 2-Player Tactics', host: 'Ner', max: 2, aiCount: 0, isPrivate: false },
                    { code: 'EMRBSMP777', title: 'Secret Cult Practice Room', host: 'Rufo', max: 4, aiCount: 2, isPrivate: true }
                ]
                : (lang === 'ja'
                    ? [
                        { code: 'EMRBSMP101', title: '初心者歓迎！まったりマルチ', host: 'エルフィン', max: 4, aiCount: 1, isPrivate: false },
                        { code: 'EMRBSMP204', title: 'サクッと2人対戦部屋', host: 'ネル', max: 2, aiCount: 0, isPrivate: false },
                        { code: 'EMRBSMP777', title: '教団秘密練習ルーム', host: 'ルポ', max: 4, aiCount: 2, isPrivate: true }
                    ]
                    : [
                        { code: 'EMRBSMP101', title: '초보 환영! 즐겁게 한 판 하실 분', host: '에르핀', max: 4, aiCount: 1, isPrivate: false },
                        { code: 'EMRBSMP204', title: '빠른 2인 전략전 테스트', host: '네르', max: 2, aiCount: 0, isPrivate: false },
                        { code: 'EMRBSMP777', title: '교단 비밀 연습실', host: '루포', max: 4, aiCount: 2, isPrivate: true }
                    ]));

        samples.forEach((s, idx) => {
            const roomId = `sample_${gameId}_${idx + 1}`;
            const slots = Array.from({ length: s.max }, (_, i) => createEmptySlot(i));
            slots[0] = {
                slotIndex: 0,
                type: 'human',
                id: `sample_host_${idx + 1}`,
                name: s.host,
                color: SLOT_COLORS[0],
                isHost: true,
                isReady: true,
                isMockHuman: true,
                isConnected: true,
                aiType: null
            };
            for (let a = 1; a <= s.aiCount && a < s.max; a++) {
                const usedNames = slots.filter(sl => sl.type !== 'empty' && sl.name).map(sl => sl.name);
                slots[a] = {
                    slotIndex: a,
                    type: 'ai',
                    id: `sample_ai_${idx}_${a}`,
                    name: pickRandomBotName(usedNames),
                    color: SLOT_COLORS[a % SLOT_COLORS.length],
                    isHost: false,
                    isReady: true,
                    isMockHuman: false,
                    isConnected: true,
                    aiType: AI_ARCHETYPES[Math.floor(Math.random() * AI_ARCHETYPES.length)]
                };
            }

            this.rooms.push({
                id: roomId,
                code: s.code,
                gameId,
                title: s.title,
                isPrivate: s.isPrivate,
                hasPassword: false,
                maxPlayers: s.max,
                hostId: slots[0].id,
                status: 'waiting',
                countdownSec: 0,
                isSample: true,
                createdAt: Date.now() - (samples.length - idx) * 10000,
                customOptions: getDefaultCustomOptions(),
                slots
            });
        });
    },

    getRoomsByGame(gameId) {
        if (this.isOnline()) {
            return (this.onlineRoomsByGame[gameId] || []).filter(r => r.gameId === gameId);
        }
        this.seedSampleRooms(gameId);
        return this.rooms
            .filter(r => r.gameId === gameId)
            .sort((a, b) => b.createdAt - a.createdAt);
    },

    getPublicRooms(gameId) {
        return this.getRoomsByGame(gameId).filter(r => !r.isPrivate);
    },

    getCurrentRoom() {
        if (this.isOnline()) {
            return this.onlineCurrentRoom;
        }
        if (!this.currentRoomId) return null;
        return this.rooms.find(r => r.id === this.currentRoomId) || null;
    },

    getMySlot(room = this.getCurrentRoom()) {
        if (!room) return null;
        return room.slots.find(s => s.id === this.localPlayer.id) || null;
    },

    getHostName(room) {
        const host = room?.slots?.find(s => s.isHost);
        return host?.name || '-';
    },

    getOccupiedCount(room) {
        return room ? room.slots.filter(s => s.type !== 'empty').length : 0;
    },

    async createRoom({ gameId, title, isPrivate = false, password = '', maxPlayers = 4, customOptions = null }) {
        void customOptions;
        const trimmedTitle = (title || '').trim().slice(0, 32);
        if (!trimmedTitle) {
            return { ok: false, errorCode: 'ERR_TITLE_EMPTY' };
        }
        const fixedOptions = getDefaultCustomOptions();

        if (this.isOnline()) {
            const res = await NetworkClient.request('CREATE_ROOM', {
                gameId,
                title: trimmedTitle,
                isPrivate,
                password,
                maxPlayers,
                customOptions: fixedOptions
            });
            if (!res.ok) {
                return { ok: false, errorCode: mapServerError(res.error) };
            }
            this.onlineCurrentRoom = res.data.room;
            this.currentRoomId = res.data.room.id;
            return { ok: true, room: res.data.room };
        }

        const meta = getGameMeta(gameId);
        const clampedMax = meta
            ? Math.min(meta.maxPlayers, Math.max(meta.minPlayers, Number(maxPlayers) || meta.maxPlayers))
            : 4;

        const roomId = `room_${Date.now()}_${this._nextRoomSeq++}`;
        const code = this.generateUniqueCode(meta ? meta.codePrefix : 'RM');

        const slots = Array.from({ length: clampedMax }, (_, idx) => createEmptySlot(idx));
        slots[0] = {
            slotIndex: 0,
            type: 'human',
            id: this.localPlayer.id,
            name: this.localPlayer.name,
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
            title: trimmedTitle,
            isPrivate: Boolean(isPrivate),
            hasPassword: Boolean(password),
            maxPlayers: clampedMax,
            hostId: this.localPlayer.id,
            status: 'waiting',
            countdownSec: 0,
            isSample: false,
            createdAt: Date.now(),
            customOptions: fixedOptions,
            slots
        };

        this.rooms.push(room);
        this.currentRoomId = roomId;
        return { ok: true, room };
    },

    async joinRoomById(roomId, expectedGameId = null, password = '') {
        if (this.isOnline()) {
            const res = await NetworkClient.request('JOIN_ROOM_BY_ID', { roomId, password });
            if (!res.ok) {
                return { ok: false, errorCode: mapServerError(res.error) };
            }
            this.onlineCurrentRoom = res.data.room;
            this.currentRoomId = res.data.room.id;
            return { ok: true, room: res.data.room };
        }

        const room = this.rooms.find(r => r.id === roomId);
        return this._joinOfflineRoom(room, expectedGameId);
    },

    async joinRoomByCode(rawCode, expectedGameId = null, password = '') {
        const normalized = (rawCode || '').replace(/\s+/g, '').trim().toUpperCase();
        if (!normalized) {
            return { ok: false, errorCode: 'ERR_EMPTY_CODE' };
        }

        if (this.isOnline()) {
            const res = await NetworkClient.request('JOIN_ROOM_BY_CODE', {
                gameId: expectedGameId || null,
                code: normalized,
                password
            });
            if (!res.ok) {
                return { ok: false, errorCode: mapServerError(res.error) };
            }
            this.onlineCurrentRoom = res.data.room;
            this.currentRoomId = res.data.room.id;
            return { ok: true, room: res.data.room };
        }

        if (!expectedGameId) {
            this.seedSampleRooms('marble');
            this.seedSampleRooms('unos');
        }
        const room = this.rooms.find(r => r.code.toUpperCase() === normalized);
        return this._joinOfflineRoom(room, expectedGameId);
    },

    _joinOfflineRoom(room, expectedGameId) {
        if (!room) return { ok: false, errorCode: 'ERR_NOT_FOUND' };
        if (expectedGameId && room.gameId !== expectedGameId) {
            return { ok: false, errorCode: 'ERR_WRONG_GAME' };
        }
        if (room.status !== 'waiting') {
            return { ok: false, errorCode: 'ERR_ALREADY_PLAYING' };
        }
        if (room.slots.some(s => s.id === this.localPlayer.id)) {
            this.currentRoomId = room.id;
            return { ok: true, room };
        }
        const emptySlot = room.slots.find(s => s.type === 'empty');
        if (!emptySlot) return { ok: false, errorCode: 'ERR_ROOM_FULL' };

        room.slots[emptySlot.slotIndex] = {
            slotIndex: emptySlot.slotIndex,
            type: 'human',
            id: this.localPlayer.id,
            name: this.localPlayer.name,
            color: getNextUnusedColor(room, emptySlot.slotIndex),
            isHost: false,
            isReady: false,
            isMockHuman: false,
            isConnected: true,
            aiType: null
        };
        this.currentRoomId = room.id;
        return { ok: true, room };
    },

    async leaveCurrentRoom() {
        this.stopLocalGameSession();
        if (this.isOnline()) {
            this.onlineCurrentRoom = null;
            this.currentRoomId = null;
            this.activeSnapshot = null;
            await NetworkClient.request('LEAVE_ROOM', {});
            return;
        }

        const room = this.getCurrentRoom();
        if (!room) {
            this.currentRoomId = null;
            return;
        }

        const myIdx = room.slots.findIndex(s => s.id === this.localPlayer.id);
        if (myIdx !== -1) {
            room.slots[myIdx] = createEmptySlot(myIdx);
        }

        const realHumans = room.slots.filter(s => s.type === 'human' && !s.isMockHuman);
        if (!room.isSample && realHumans.length === 0) {
            this.rooms = this.rooms.filter(r => r.id !== room.id);
        } else if (room.hostId === this.localPlayer.id) {
            const nextHost = room.slots.find(s => s.type === 'human');
            if (nextHost) {
                nextHost.isHost = true;
                nextHost.isReady = true;
                room.hostId = nextHost.id;
            }
        }

        room.status = 'waiting';
        this.currentRoomId = null;
    },

    async toggleReady(slotIndex = null) {
        if (this.isOnline()) {
            const res = await NetworkClient.request('TOGGLE_READY', {});
            if (res.ok && res.data?.room) {
                this.onlineCurrentRoom = res.data.room;
            }
            return { ok: res.ok, errorCode: res.ok ? null : mapServerError(res.error) };
        }

        const room = this.getCurrentRoom();
        if (!room) return { ok: false };
        const target = slotIndex !== null
            ? room.slots[slotIndex]
            : this.getMySlot(room);
        if (!target || target.type !== 'human') return { ok: false };
        if (target.isHost) {
            const check = this.canStart(room);
            return {
                ok: check.canStart,
                errorCode: check.canStart ? null : (check.reason || 'TOAST_NEED_MIN_PLAYERS'),
                startOfflineNow: check.canStart
            };
        }
        target.isReady = !target.isReady;
        return { ok: true };
    },

    async fillSlotWithAi(slotIndex, aiType = 'random') {
        if (this.isOnline()) {
            const res = await NetworkClient.request('ADD_AI', { slotIndex, aiType });
            if (res.ok && res.data?.room) this.onlineCurrentRoom = res.data.room;
            return res.ok;
        }
        const room = this.getCurrentRoom();
        if (!room || !room.slots[slotIndex] || room.slots[slotIndex].type !== 'empty') return false;
        const usedNames = room.slots.filter(s => s.type !== 'empty' && s.name).map(s => s.name);
        room.slots[slotIndex] = {
            slotIndex,
            type: 'ai',
            id: `ai_${room.id}_${slotIndex}`,
            name: pickRandomBotName(usedNames),
            color: getNextUnusedColor(room, slotIndex),
            isHost: false,
            isReady: true,
            isMockHuman: false,
            isConnected: true,
            aiType: AI_ARCHETYPES.includes(aiType) ? aiType : 'random'
        };
        return true;
    },

    async fillAllEmptyWithAi() {
        if (this.isOnline()) {
            const res = await NetworkClient.request('ADD_ALL_AI', {});
            if (res.ok && res.data?.room) this.onlineCurrentRoom = res.data.room;
            return Boolean(res.ok && res.data?.added);
        }
        const room = this.getCurrentRoom();
        if (!room) return false;
        let changed = false;
        room.slots.forEach(s => {
            if (s.type === 'empty') {
                const usedNames = room.slots.filter(sl => sl.type !== 'empty' && sl.name).map(sl => sl.name);
                room.slots[s.slotIndex] = {
                    slotIndex: s.slotIndex,
                    type: 'ai',
                    id: `ai_${room.id}_${s.slotIndex}`,
                    name: pickRandomBotName(usedNames),
                    color: getNextUnusedColor(room, s.slotIndex),
                    isHost: false,
                    isReady: true,
                    isMockHuman: false,
                    isConnected: true,
                    aiType: 'random'
                };
                changed = true;
            }
        });
        return changed;
    },

    async clearAllAiSlots() {
        if (this.isOnline()) {
            const res = await NetworkClient.request('CLEAR_AI', {});
            if (res.ok && res.data?.room) this.onlineCurrentRoom = res.data.room;
            return Boolean(res.ok && res.data?.cleared);
        }
        const room = this.getCurrentRoom();
        if (!room) return false;
        let changed = false;
        room.slots.forEach((s, idx) => {
            if (s.type === 'ai') {
                room.slots[idx] = createEmptySlot(idx);
                changed = true;
            }
        });
        return changed;
    },

    async cycleAiArchetype(slotIndex) {
        if (this.isOnline()) {
            const res = await NetworkClient.request('CYCLE_AI', { slotIndex });
            if (res.ok && res.data?.room) this.onlineCurrentRoom = res.data.room;
            return res.ok;
        }
        const room = this.getCurrentRoom();
        const slot = room?.slots[slotIndex];
        if (!slot || slot.type !== 'ai') return false;
        const curIdx = AI_ARCHETYPES.indexOf(slot.aiType || 'random');
        slot.aiType = AI_ARCHETYPES[(curIdx + 1) % AI_ARCHETYPES.length];
        return true;
    },

    addMockHuman(slotIndex) {
        if (this.isOnline()) return false;
        const room = this.getCurrentRoom();
        const slot = room?.slots[slotIndex];
        if (!slot || slot.type !== 'empty') return false;
        const usedNames = new Set(room.slots.map(s => s.name));
        const pickName = MOCK_NAMES.find(n => !usedNames.has(n)) || `유저${this._nextMockSeq}`;
        room.slots[slotIndex] = {
            slotIndex,
            type: 'human',
            id: `mock_human_${this._nextMockSeq++}`,
            name: pickName,
            color: getNextUnusedColor(room, slotIndex),
            isHost: false,
            isReady: false,
            isMockHuman: true,
            isConnected: true,
            aiType: null
        };
        return true;
    },

    async clearSlot(slotIndex) {
        if (this.isOnline()) {
            const res = await NetworkClient.request('CLEAR_SLOT', { slotIndex });
            if (res.ok && res.data?.room) this.onlineCurrentRoom = res.data.room;
            return res.ok;
        }
        const room = this.getCurrentRoom();
        const slot = room?.slots[slotIndex];
        if (!slot || slot.type === 'empty' || slot.isHost) return false;
        room.slots[slotIndex] = createEmptySlot(slotIndex);
        return true;
    },

    async updateCustomOptions(customOptions) {
        void customOptions;
        const fixedOptions = getDefaultCustomOptions();
        if (this.isOnline()) {
            const res = await NetworkClient.request('UPDATE_OPTIONS', { customOptions: fixedOptions });
            if (res.ok && res.data?.room) this.onlineCurrentRoom = res.data.room;
            return res.ok;
        }
        const room = this.getCurrentRoom();
        if (!room) return false;
        room.customOptions = fixedOptions;
        return true;
    },

    async returnToRoom() {
        this.stopLocalGameSession();
        if (this.isOnline()) {
            const res = await NetworkClient.request('RETURN_TO_ROOM', {});
            if (res.ok && res.data?.room) {
                this.onlineCurrentRoom = res.data.room;
                this.activeSnapshot = null;
                return { ok: true, room: res.data.room };
            }
            return { ok: false, errorCode: res.error };
        }
        const room = this.getCurrentRoom();
        if (room) {
            room.status = 'waiting';
            return { ok: true, room };
        }
        return { ok: false };
    },

    getReadinessSummary(room = this.getCurrentRoom()) {
        if (!room) {
            return { occupied: 0, humanCount: 0, readyHumanCount: 0, aiCount: 0, hasMinPlayers: false, allHumansReady: false };
        }
        const meta = getGameMeta(room.gameId);
        const minP = meta ? meta.minPlayers : 2;
        const active = room.slots.filter(s => s.type !== 'empty');
        const humans = active.filter(s => s.type === 'human');
        const readyHumans = humans.filter(s => s.isReady);
        const ais = active.filter(s => s.type === 'ai');

        return {
            occupied: active.length,
            humanCount: humans.length,
            readyHumanCount: readyHumans.length,
            aiCount: ais.length,
            hasMinPlayers: active.length >= minP,
            allHumansReady: humans.length >= 1 && readyHumans.length === humans.length
        };
    },

    canStart(room = this.getCurrentRoom()) {
        const meta = room ? getGameMeta(room.gameId) : null;
        const s = this.getReadinessSummary(room);
        if (meta && meta.gameSupported === false) {
            return { canStart: false, reason: 'ERR_GAME_IN_DEVELOPMENT', summary: s };
        }
        return {
            canStart: s.hasMinPlayers && s.allHumansReady,
            reason: (s.hasMinPlayers && s.allHumansReady) ? null : 'TOAST_NEED_MIN_PLAYERS',
            summary: s
        };
    },

    // --- 인게임 로컬 오프라인 폴백 엔진 브리지 & 온라인 액션 송신 ---
    startLocalGameSession(room) {
        this.stopLocalGameSession();
        const myId = this.localPlayer.id;
        let currentViewerId = myId;
        const resolveViewer = (eng) => {
            if (!eng) return currentViewerId;
            const active = eng.turnManager?.getCurrentPlayer();
            if (active && !active.isAi()) {
                currentViewerId = active.id;
                return active.id;
            }
            return myId;
        };

        this.localEngine = new MarbleGameEngine({
            room,
            customOptions: room?.customOptions,
            callbacks: {
                onStateChange: (eng) => {
                    const viewer = resolveViewer(eng);
                    currentViewerId = viewer;
                    const snap = eng.getSnapshotForPlayer(viewer);
                    snap.viewerId = viewer;
                    this.activeSnapshot = snap;
                    this._emitGame('STATE', snap);
                },
                onEvent: (event) => {
                    const viewer = this.localEngine ? resolveViewer(this.localEngine) : currentViewerId;
                    if (event?.targetPlayerId && event.targetPlayerId !== viewer) {
                        return;
                    }
                    if (event?.type === 'GAME_OVER' && event.matchLogData) {
                        const logGameId = room?.gameId || 'marble';
                        SystemLogManager.recordGameResult(logGameId, event.matchLogData).catch(() => {});
                        if (logGameId === 'marble') {
                            SystemLogManager.recordGameResult('marble_10', event.matchLogData).catch(() => {});
                        }
                    }
                    this._emitGame('EVENT', event);
                },
                onTimerTick: (tick) => {
                    this._emitGame('TIMER', tick);
                },
                onPlayerAfkKick: ({ playerId, aiType }) => {
                    const kickPayload = {
                        roomId: room?.id || 'local_marble',
                        gameId: room?.gameId || 'marble',
                        reason: 'AFK_KICKED',
                        aiType
                    };
                    if (playerId === this.localPlayer.id || (room?.slots || []).filter(s => s.type === 'human' && !s.isMockHuman).length <= 1) {
                        this.stopLocalGameSession();
                        this.currentRoomId = null;
                        this.activeSnapshot = null;
                        this._emitUi('KICKED_FROM_ROOM', kickPayload);
                        this._emitGame('KICKED', kickPayload);
                    }
                }
            }
        });

        this.localEngine.start();
        const viewer = resolveViewer(this.localEngine);
        const snap = this.localEngine.getSnapshotForPlayer(viewer);
        snap.viewerId = viewer;
        this.activeSnapshot = snap;
        return snap;
    },

    stopLocalGameSession() {
        if (this.localEngine) {
            this.localEngine.destroy();
            this.localEngine = null;
        }
    },

    async sendGameAction(action) {
        if (this.isOnline()) {
            const room = this.getCurrentRoom();
            const res = await NetworkClient.request('GAME_ACTION', {
                roomId: room ? room.id : this.activeSnapshot?.roomId,
                action
            });
            return res;
        }
        if (this.localEngine) {
            const active = this.localEngine.turnManager?.getCurrentPlayer();
            const actorId = (action?.type === 'AFK_RETURN')
                ? (this.activeSnapshot?.viewerId || this.localPlayer.id)
                : ((active && !active.isAi()) ? active.id : this.localPlayer.id);
            return this.localEngine.handleAction(actorId, action);
        }
        return { ok: false, error: 'NO_ACTIVE_SESSION' };
    },

    getActiveSnapshot() {
        return this.activeSnapshot;
    }
};
