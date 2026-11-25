// ProgramFiles/Scenes/GameUnos.js
// 우노스(UNOS) 인게임 클라이언트 씬 진입점 (initUnos)
// 온라인(RoomManager/NetworkClient) ↔ 오프라인(UnosEngine 직접 구동) 브리지 및 _cleanupScene / ErrorTracker 연동

import { changeScene } from '../Main.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import { getGameMeta } from '../System/GameRegistry.js';
import { ErrorTracker } from '../System/ErrorTracker.js';
import { SystemLogManager } from '../System/Log/SystemLogManager.js';
import { UnosEngine } from '../Game/Unos/UnosEngine.js';
import { UnosUIController } from '../Game/Unos/UnosUI.js';
import { preloadUnosAssets } from '../Game/Unos/UnosAssetLoader.js';

export function initUnos(container, sceneParams = null) {
    ErrorTracker.markTransitionComplete('unos');
    ErrorTracker.clearTransitionWatchdog();
    preloadUnosAssets().catch(() => {});

    let isCleanedUp = false;
    let localEngine = null;
    let latestSnapshot = null;

    const resolveOfflineViewerId = (engine) => {
        const myId = RoomManager.localPlayer?.id || 'local_player_1';
        if (!engine) return myId;
        if (engine.turnState?.phase === 'TURN_ORDER') {
            const directMe = engine.players.find(p => p.id === myId);
            if (directMe) return directMe.id;
            const realHuman = engine.players.find(p => p.type !== 'ai' && !p.isMockHuman);
            if (realHuman) return realHuman.id;
        }
        const active = engine.getCurrentPlayer();
        if (active && active.type !== 'ai') {
            return active.id;
        }
        const humanPlayer = engine.players.find(p => p.type !== 'ai');
        return humanPlayer ? humanPlayer.id : myId;
    };

    const handleSendAction = async (action) => {
        if (isCleanedUp || !action) return;
        ErrorTracker.addBreadcrumb('GAME', `Unos action: ${action.type}`);

        if (RoomManager.isOnline()) {
            const res = await RoomManager.sendGameAction(action);
            if (!res?.ok && !isCleanedUp) {
                if (res?.requiresConfirm && res?.side) {
                    ui.pendingUnsafeCastleSide = res.side;
                    if (latestSnapshot) ui.renderSnapshot(latestSnapshot);
                } else if (res?.message) {
                    ui.showToast(res.message);
                }
            }
            return;
        }

        if (localEngine) {
            let actorId = resolveOfflineViewerId(localEngine);
            if ((action.type === 'TURN_ORDER_DRAW' || action.type === 'TURN_ORDER_ROLL') && localEngine.turnOrderState?.players) {
                const viewerEntry = localEngine.turnOrderState.players.find(e => e.id === actorId);
                if (!viewerEntry || viewerEntry.drawn) {
                    const pendingHuman = localEngine.turnOrderState.players.find(e => !e.isAi && !e.drawn);
                    if (pendingHuman) actorId = pendingHuman.id;
                }
            }
            const res = localEngine.handleAction(actorId, action);
            if (!res?.ok && !isCleanedUp) {
                if (res?.requiresConfirm && res?.side) {
                    ui.pendingUnsafeCastleSide = res.side;
                    if (latestSnapshot) ui.renderSnapshot(latestSnapshot);
                } else if (res?.message) {
                    ui.showToast(res.message);
                }
            }
        }
    };

    const handleExitMatch = async () => {
        if (isCleanedUp) return;
        const curRoom = RoomManager.getCurrentRoom();
        const meta = getGameMeta(curRoom?.gameId || 'unos');
        await RoomManager.leaveCurrentRoom();
        changeScene(meta?.sceneMain || 'unos_main');
    };

    const handleReturnToRoom = () => {
        if (isCleanedUp) return;
        const curRoom = RoomManager.getCurrentRoom();
        if (curRoom) {
            curRoom.status = 'waiting';
            changeScene('room');
        } else {
            const meta = getGameMeta('unos');
            changeScene(meta?.sceneMain || 'unos_main');
        }
    };

    const ui = new UnosUIController({
        container,
        onSendAction: handleSendAction,
        onExitMatch: handleExitMatch,
        onReturnToRoom: handleReturnToRoom
    });

    const applySnapshot = (snapshot) => {
        if (isCleanedUp || !snapshot) return;
        latestSnapshot = snapshot;
        ErrorTracker.markTransitionComplete('unos');
        ErrorTracker.clearTransitionWatchdog();
        ui.renderSnapshot(snapshot);
    };

    const unsubscribeGame = RoomManager.subscribeGame((evtName, payload) => {
        if (isCleanedUp) return;
        if (evtName === 'STATE') {
            if (payload?.gameId === 'unos') {
                applySnapshot(payload);
            }
        } else if (evtName === 'TIMER') {
            if (latestSnapshot) {
                latestSnapshot.timerLeft = payload?.timeLeft ?? latestSnapshot.timerLeft;
            }
            ui.updateTimerDom(payload?.timeLeft);
        } else if (evtName === 'EVENT') {
            if (payload?.type === 'TOAST' && payload.message) {
                ui.showToast(payload.message, payload.duration || 2800);
            }
        } else if (evtName === 'RETURNED_TO_ROOM') {
            changeScene('room');
        } else if (evtName === 'KICKED') {
            const meta = getGameMeta(payload?.gameId || 'unos');
            changeScene(meta?.sceneMain || 'unos_main');
        }
    });

    const langHandler = () => {
        if (!isCleanedUp && latestSnapshot) {
            ui.renderSnapshot(latestSnapshot);
        }
    };
    if (typeof document !== 'undefined') {
        document.addEventListener('languageChanged', langHandler);
    }

    container._cleanupScene = () => {
        isCleanedUp = true;
        unsubscribeGame();
        if (typeof document !== 'undefined') {
            document.removeEventListener('languageChanged', langHandler);
        }
        ui.destroy();
        if (localEngine) {
            localEngine.destroy();
            if (RoomManager.localEngine === localEngine) {
                RoomManager.localEngine = null;
            }
            localEngine = null;
        }
    };

    // 온라인 초기 스냅샷 또는 오프라인 로컬 UnosEngine 구동
    const initialSnapshot = (sceneParams?.initialSnapshot?.gameId === 'unos' ? sceneParams.initialSnapshot : null)
        || (RoomManager.getActiveSnapshot()?.gameId === 'unos' ? RoomManager.getActiveSnapshot() : null);

    if (initialSnapshot && RoomManager.isOnline()) {
        applySnapshot(initialSnapshot);
    } else if (!RoomManager.isOnline()) {
        RoomManager.stopLocalGameSession();
        const targetRoom = sceneParams?.room || RoomManager.getCurrentRoom() || {
            id: 'local_unos_room',
            code: 'UNOSSOLO',
            gameId: 'unos',
            slots: [
                {
                    slotIndex: 0,
                    type: 'human',
                    id: RoomManager.localPlayer?.id || 'local_player_1',
                    name: RoomManager.localPlayer?.name || '교주',
                    color: '#e74c3c',
                    isHost: true,
                    isReady: true,
                    isConnected: true
                },
                {
                    slotIndex: 1,
                    type: 'ai',
                    id: 'local_unos_ai',
                    name: '루포',
                    color: '#3498db',
                    isHost: false,
                    isReady: true,
                    isConnected: true,
                    aiDifficulty: 'normal'
                }
            ]
        };

        localEngine = new UnosEngine({
            room: targetRoom,
            customOptions: targetRoom.customOptions,
            callbacks: {
                onStateChange: (eng) => {
                    if (isCleanedUp) return;
                    const viewerId = resolveOfflineViewerId(eng);
                    const snap = eng.getSnapshotForPlayer(viewerId);
                    RoomManager.activeSnapshot = snap;
                    applySnapshot(snap);
                },
                onEvent: (event) => {
                    if (isCleanedUp) return;
                    if (event?.type === 'TOAST' && event.message) {
                        const viewerId = resolveOfflineViewerId(localEngine);
                        const msg = (event.actorId && (event.selfMessage || event.otherMessage))
                            ? (event.actorId === viewerId ? (event.selfMessage || event.message) : (event.otherMessage || event.message))
                            : event.message;
                        ui.showToast(msg);
                    } else if (event?.type === 'GAME_OVER' && event.matchLogData) {
                        RoomManager.resetOfflineHostIdleStrikes?.();
                        SystemLogManager.recordGameResult('unos', event.matchLogData).catch(() => {});
                        SystemLogManager.recordGameResult('unos_10', event.matchLogData).catch(() => {});
                    }
                },
                onTimerTick: (tick) => {
                    if (isCleanedUp) return;
                    if (latestSnapshot) {
                        latestSnapshot.timerLeft = tick?.timeLeft ?? latestSnapshot.timerLeft;
                    }
                    ui.updateTimerDom(tick?.timeLeft);
                }
            }
        });

        RoomManager.localEngine = localEngine;
        localEngine.start();
        const viewerId = resolveOfflineViewerId(localEngine);
        const snap = localEngine.getSnapshotForPlayer(viewerId);
        RoomManager.activeSnapshot = snap;
        applySnapshot(snap);
    }
}
