// ProgramFiles/System/Server/MarbleServerSession.js
// 룸 단위로 MarbleGameEngine 인스턴스를 관리하며 클라이언트에 개인화된 스냅샷과 이벤트를 중계

import { MarbleGameEngine } from '../../Marble/MarbleEngine.js';

export class MarbleServerSession {
    constructor({ room, broadcastToPlayer, broadcastToRoom, onGameFinished }) {
        this.room = room;
        this.broadcastToPlayer = broadcastToPlayer;
        this.broadcastToRoom = broadcastToRoom;
        this.onGameFinished = onGameFinished;

        this.engine = new MarbleGameEngine({
            room,
            customOptions: room.customOptions,
            callbacks: {
                onStateChange: () => this.pushStateToAll(),
                onEvent: (event) => {
                    this.broadcastToRoom({
                        type: 'GAME_EVENT',
                        roomId: this.room.id,
                        event
                    });
                    if (event?.type === 'GAME_OVER' && typeof this.onGameFinished === 'function') {
                        this.onGameFinished(event.results);
                    }
                },
                onTimerTick: (tick) => {
                    this.broadcastToRoom({
                        type: 'GAME_TIMER',
                        roomId: this.room.id,
                        ...tick
                    });
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
