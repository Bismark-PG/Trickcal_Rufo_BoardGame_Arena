import { initMenu } from './Scenes/MainMenu.js';
import { initArenaLoading } from './Scenes/ArenaLoading.js';
import { initMarbleMain } from './Scenes/GameMain/MarbleMain.js';
import { initUnosMain } from './Scenes/GameMain/UnosMain.js';
import { initRoom } from './Scenes/GameRoom.js';
import { initMarble } from './Scenes/GameMarble.js';
import { initUnos } from './Scenes/GameUnos.js';
import { RoomManager } from './Lobby/RoomManager.js';
import { renderTabBlockedScreen } from './Lobby/LobbyUI.js';
import { AudioManager, installResourceProtectionGuard } from './System/System.js';
import { NetworkClient } from './System/NetworkClient.js';
import { getGameMeta } from './System/GameRegistry.js';
import { hasCompletedArenaPreload } from './System/AssetPreloader.js';
import { SystemLogManager } from './System/Log/SystemLogManager.js';
import { ErrorTracker } from './System/ErrorTracker.js';
import { ensureGlobalToastLayer, showGlobalArenaToast } from './System/GlobalToast.js';
import { OnboardingLang, ONBOARDING_LIMITS } from './System/Index/ArenaOnboardingIndex.js';
import { LangState } from './System/LanguageManager.js';

export { showGlobalArenaToast };

const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
const VALID_SCENES = new Set(['loading', 'menu', 'marble_main', 'unos_main', 'room', 'marble', 'unos', 'tab_blocked']);

let currentSceneName = null;
let currentGameId = 'arena';

function resizeApp() {
    if (!app) return;
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    app.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
if (typeof window !== 'undefined') {
    window.addEventListener('resize', resizeApp);
}

function resolveSafeSceneForRecovery(report, detail) {
    if (detail?.preferMenu) return 'menu';
    const gid = detail?.gameId || report?.gameId || currentGameId;
    if (gid && gid !== 'arena') {
        const meta = getGameMeta(gid);
        if (meta?.sceneMain) return meta.sceneMain;
    }
    return 'menu';
}

function main() {
    ErrorTracker.init({
        getContainer: () => app,
        getContext: () => {
            const room = RoomManager.getCurrentRoom();
            return {
                scene: currentSceneName || 'boot',
                gameId: room?.gameId || currentGameId || 'arena',
                roomCode: room?.code || null,
                isOnline: RoomManager.isOnline(),
                playerId: NetworkClient.playerId || RoomManager.localPlayer?.id || null
            };
        },
        recoverToSafeScene: (_errorCode, report, detail) => {
            const safeScene = resolveSafeSceneForRecovery(report, detail);
            RoomManager.clearGhostSession();
            changeScene(safeScene);
        },
        sendReportWs: (report) => NetworkClient.reportClientError(report),
        sendReportHttp: (report) => SystemLogManager.recordClientError(report)
    });

    NetworkClient.subscribe('TAB_REPLACED', (msg) => {
        RoomManager.clearGhostSession({ skipServerLeave: true });
        NetworkClient.disconnect({ disableReconnect: true });
        changeScene('tab_blocked', {
            gameId: msg?.gameId || currentGameId || null,
            reason: msg?.reason || 'REPLACED_BY_NEW_TAB'
        });
    });

    NetworkClient.subscribe('HELLO_ACK', (msg) => {
        queueMicrotask(() => {
            if (currentSceneName !== 'menu') return;
            if (msg?.room || RoomManager.getCurrentRoom()) {
                RoomManager.leaveCurrentRoom();
            }
            if (msg?.activeGameId || NetworkClient.activeRegisteredGameId) {
                NetworkClient.unregisterGameTab();
            }
        });
    });

    ErrorTracker.inspectAndSanitizeInitialUrl();
    installResourceProtectionGuard();

    resizeApp();
    ensureGlobalToastLayer();
    const hasSessionNick = Boolean(NetworkClient.getStoredNickname());
    changeScene(hasCompletedArenaPreload() && hasSessionNick ? 'menu' : 'loading');

    // 브라우저 자동 재생 정책에 대응하기 위해, 
    // 로딩 화면이 아닐 때의 첫 번째 클릭(예: [아레나에 뛰어들기!]) 시 보류되었던 BGM을 재생합니다.
    const unlockAudio = () => {
        if (currentSceneName === 'loading') return;
        AudioManager.bgmPlayer.play().catch(() => {});
        document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
}

export function changeScene(sceneName, sceneParams = null) {
    if (!VALID_SCENES.has(sceneName)) {
        ErrorTracker.reportRouteTamper(sceneName, 'Unregistered scene name');
        return;
    }

    if (sceneName === 'room' || sceneName === 'marble' || sceneName === 'unos') {
        const hasValidSession = Boolean(
            RoomManager.getCurrentRoom() ||
            sceneParams?.room ||
            sceneParams?.initialSnapshot ||
            RoomManager.getActiveSnapshot()
        );
        if (!hasValidSession) {
            ErrorTracker.reportRouteTamper(sceneName, 'Missing active room or session');
            return;
        }
    }

    const prevScene = currentSceneName || 'boot';
    ErrorTracker.addBreadcrumb('SCENE', `${prevScene} -> ${sceneName}`);
    currentSceneName = sceneName;

    if (sceneName === 'marble_main') {
        currentGameId = 'marble';
    } else if (sceneName === 'unos_main' || sceneName === 'unos') {
        currentGameId = 'unos';
    } else if (sceneName === 'room' || sceneName === 'marble') {
        currentGameId = RoomManager.getCurrentRoom()?.gameId || sceneParams?.room?.gameId || currentGameId || 'marble';
    } else {
        currentGameId = 'arena';
    }

    if (app && typeof app._cleanupScene === 'function') {
        app._cleanupScene();
        app._cleanupScene = null;
    }
    if (app) {
        app.innerHTML = '';
    }

    if (sceneName === 'loading') {
        ErrorTracker.clearTransitionWatchdog();
        if (app) initArenaLoading(app, sceneParams);
    } else if (sceneName === 'menu') {
        ErrorTracker.clearTransitionWatchdog();
        if (RoomManager.getCurrentRoom()) RoomManager.leaveCurrentRoom();
        NetworkClient.unregisterGameTab();
        AudioManager.playBGM('./Resource/Audio/Main_Furry_Forest.mp3');
        if (sceneParams && sceneParams.showWelcomeToast) {
            const onbText = OnboardingLang[LangState.current] || OnboardingLang.ko;
            showGlobalArenaToast(onbText.WELCOME_TOAST, ONBOARDING_LIMITS.WELCOME_TOAST_MS, '#f1c40f');
        }
        if (app) initMenu(app, sceneParams);
    } else if (sceneName === 'marble_main') {
        ErrorTracker.clearTransitionWatchdog();
        AudioManager.playBGM('./Resource/Audio/Main_Furry_Forest.mp3');
        if (app) initMarbleMain(app, sceneParams);
    } else if (sceneName === 'unos_main') {
        ErrorTracker.clearTransitionWatchdog();
        AudioManager.playBGM('./Resource/Audio/Main_Furry_Forest.mp3');
        if (app) initUnosMain(app, sceneParams);
    } else if (sceneName === 'room') {
        ErrorTracker.startTransitionWatchdog('room', { timeoutMs: 9500, gameId: currentGameId });
        AudioManager.playBGM('./Resource/Audio/Main_Furry_Forest.mp3');
        if (app) initRoom(app, sceneParams);
    } else if (sceneName === 'marble') {
        ErrorTracker.startTransitionWatchdog('marble', { timeoutMs: 9500, gameId: currentGameId || 'marble' });
        AudioManager.playBGM('./Resource/Audio/Game_Let\'s_Go.mp3');
        if (app) initMarble(app, sceneParams);
    } else if (sceneName === 'unos') {
        ErrorTracker.startTransitionWatchdog('unos', { timeoutMs: 9500, gameId: currentGameId || 'unos' });
        AudioManager.playBGM('./Resource/Audio/Game_Let\'s_Go.mp3');
        if (app) initUnos(app, sceneParams);
    } else if (sceneName === 'tab_blocked') {
        ErrorTracker.clearTransitionWatchdog();
        if (app) renderTabBlockedScreen(app, sceneParams);
    }

    if (app && sceneName !== 'loading') {
        ErrorTracker.flushPendingModal(app);
    }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && app) {
    main();
}