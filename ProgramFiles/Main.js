import { initMenu } from './Scenes/MainMenu.js';
import { initMarbleMain } from './Scenes/GameMain/MarbleMain.js';
import { initGameRoom } from './Scenes/GameRoom.js';
import { initMarble } from './Scenes/GameMarble.js';
import { RoomManager } from './Lobby/RoomManager.js';
import { AudioManager } from './System/System.js';

const app = document.getElementById('app');

function resizeApp() {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    app.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
window.addEventListener('resize', resizeApp);

function main() {
    resizeApp();

    changeScene('menu'); 

    // 브라우저 자동 재생 정책에 대응하기 위해, 
    // 사용자의 첫 번째 클릭(화면 어디든) 발생 시 보류되었던 BGM을 강제 재생합니다.
    const unlockAudio = () => {
        AudioManager.bgmPlayer.play().catch(() => {});
        document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
}

export function changeScene(sceneName, sceneParams = null) {
    if (typeof app._cleanupScene === 'function') {
        app._cleanupScene();
        app._cleanupScene = null;
    }
    app.innerHTML = '';

    if (sceneName === 'menu') {
        if (RoomManager.getCurrentRoom()) RoomManager.leaveCurrentRoom();
        AudioManager.playBGM('./Resource/Audio/Main_Furry_Forest.mp3');
        initMenu(app, sceneParams);
    } else if (sceneName === 'marble_main') {
        AudioManager.playBGM('./Resource/Audio/Main_Furry_Forest.mp3');
        initMarbleMain(app, sceneParams);
    } else if (sceneName === 'room') {
        AudioManager.playBGM('./Resource/Audio/Main_Furry_Forest.mp3');
        initGameRoom(app, sceneParams);
    } else if (sceneName === 'marble') {
        AudioManager.playBGM('./Resource/Audio/Game_Let\'s_Go.mp3');
        initMarble(app, sceneParams);
    }
}

main();