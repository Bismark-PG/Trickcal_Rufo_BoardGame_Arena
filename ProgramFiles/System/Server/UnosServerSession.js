// ProgramFiles/System/Server/UnosServerSession.js
// 룸 단위로 UnosEngine 인스턴스를 관리하며 클라이언트에 개인화된 스냅샷(비공개 손패 마스킹)과 이벤트를 중계
// MarbleServerSession.js와 동일한 서버 세션 어댑터 인터페이스 준수

import { UnosEngine } from '../../Game/Unos/UnosEngine.js';

export class UnosServerSession {
    constructor({ room, broadcastToPlayer, broadcastToRoom, onGameFinished, onPlayerAfkKick }) {
        this.room = room;
        this.broadcastToPlayer = broadcastToPlayer;
        this.broadcastToRoom = broadcastToRoom;
        this.onGameFinished = onGameFinished;
        this.onPlayerAfkKick = onPlayerAfkKick;

        this.engine = new UnosEngine({
            room,
            customOptions: room?.customOptions,
            callbacks: {
                onStateChange: () => this.pushStateToAll(),
                onEvent: (event) => {
                    if (event?.targetPlayerId) {
                        this.broadcastToPlayer(event.targetPlayerId, {
                            type: 'GAME_EVENT',
                            roomId: this.room.id,
                            event
                        });
                    } else if (event?.type === 'TOAST' && (event.selfMessage || event.otherMessage) && event.actorId) {
                        for (const slot of this.room.slots) {
                            if (slot.type === 'human' && slot.id) {
                                const personalMsg = slot.id === event.actorId
                                    ? (event.selfMessage || event.message)
                                    : (event.otherMessage || event.message);
                                this.broadcastToPlayer(slot.id, {
                                    type: 'GAME_EVENT',
                                    roomId: this.room.id,
                                    event: { ...event, message: personalMsg }
                                });
                            }
                        }
                    } else {
                        this.broadcastToRoom({
                            type: 'GAME_EVENT',
                            roomId: this.room.id,
                            event
                        });
                    }
                    if (event?.type === 'GAME_OVER' && typeof this.onGameFinished === 'function') {
                        this.onGameFinished(
                            event.results,
                            event.matchLogData || this.engine?.lastMatchLogInput || null
                        );
                    }
                },
                onTimerTick: (tick) => {
                    this.broadcastToRoom({
                        type: 'GAME_TIMER',
                        roomId: this.room.id,
                        ...tick
                    });
                },
                onPlayerAfkKick: (info) => {
                    if (typeof this.onPlayerAfkKick === 'function') {
                        this.onPlayerAfkKick(info);
                    }
                }
            }
        });
    }

    start() {
        this.engine.start();
    }

    pushStateToAll() {
        for (const slot of this.room.slots) {
            if (slot.type === 'human' && slot.id) {
                const snapshot = this.engine.getSnapshotForPlayer(slot.id);
                this.broadcastToPlayer(slot.id, {
                    type: 'GAME_STATE',
                    roomId: this.room.id,
                    snapshot
                });
            }
        }
    }

    getSnapshotForPlayer(playerId) {
        return this.engine.getSnapshotForPlayer(playerId);
    }

    handleAction(playerId, action) {
        return this.engine.handleAction(playerId, action);
    }

    onPlayerDisconnect(playerId) {
        this.engine.markPlayerConnected(playerId, false);
    }

    onPlayerReconnect(playerId) {
        this.engine.markPlayerConnected(playerId, true);
        const snapshot = this.engine.getSnapshotForPlayer(playerId);
        this.broadcastToPlayer(playerId, {
            type: 'GAME_STATE',
            roomId: this.room.id,
            snapshot
        });
    }

    onPlayerLeave(playerId) {
        this.engine.convertPlayerToAi(playerId);
    }

    destroy() {
        this.engine.destroy();
    }
}
