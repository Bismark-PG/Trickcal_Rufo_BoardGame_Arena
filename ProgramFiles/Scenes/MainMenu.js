import { changeScene } from '../Main.js';
import { AudioManager, SettingsManager } from '../System/System.js';
import { LangState } from '../System/LanguageManager.js';
import { MenuLang } from '../System/Index/MainMenuIndex.js';
import { getAllRegisteredGames } from '../System/GameRegistry.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import { openQuickJoinModal } from '../Lobby/QuickJoinUI.js';
import { showLobbyToast, escapeHtml } from '../Lobby/LobbyUI.js';

export function initMenu(container) {
    const renderUI = () => {
        const text = MenuLang[LangState.current];
        const games = getAllRegisteredGames();
        const emptyCount = Math.max(0, 9 - games.length);

        const gameCardsHtml = games.map(g => {
            const isActive = g.lobbyEnabled || g.status === 'active';
            const title = text[g.nameKey] || g.id;
            const desc = text[g.descKey] || '';
            const bg = isActive ? '#165b7a' : 'rgba(22, 91, 122, 0.72)';
            const border = isActive ? `3px solid ${g.accentColor}` : '2px dashed rgba(255,255,255,0.28)';
            return `
                <button class="game-select-btn" data-game-id="${escapeHtml(g.id)}" style="font-family: inherit; height: 250px; background: ${bg}; color: ${isActive ? '#fff' : 'rgba(255,255,255,0.75)'}; border: ${border}; border-radius: 20px; cursor: pointer; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 12px; padding: 20px;">
                    <span style="font-size: 34px; font-weight: bold;">${escapeHtml(title)}</span>
                    <span style="font-size: 19px; color: ${isActive ? '#f1c40f' : 'rgba(255,255,255,0.6)'};">${escapeHtml(desc)}</span>
                </button>
            `;
        }).join('');

        container.innerHTML = `
            <div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; position: relative; padding-top: 50px;">
                <div style="position: absolute; top: 50px; right: 50px; display: flex; gap: 20px;">
                    <button id="btn-quick-join" style="font-family: inherit; padding: 15px 28px; font-size: 24px; font-weight: bold; background: #f39c12; color: #fff; border: none; border-radius: 10px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.18);">${escapeHtml(text.QUICK_JOIN)}</button>
                    <button id="btn-settings" style="font-family: inherit; padding: 15px 30px; font-size: 24px; background: #165b7a; color: #fff; border: none; border-radius: 10px; cursor: pointer;">${text.SETTINGS}</button>
                    <button id="btn-info" style="font-family: inherit; padding: 15px 30px; font-size: 24px; background: #165b7a; color: #fff; border: none; border-radius: 10px; cursor: pointer;">${text.INFO}</button>
                </div>

                <div style="text-align: center; margin-bottom: 50px;">
                    <img src="./Resource/Texture/Main_Chara.png" alt="캐릭터" style="max-height: 150px;">
                    <h1 style="font-size: 48px; margin: 10px 0;">${text.TITLE}</h1>
                </div>

                <div style="width: 1200px; height: 650px; background: #216a8c; border-radius: 30px; padding: 40px; overflow-y: auto; box-sizing: border-box; display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px;">
                    ${gameCardsHtml}
                    ${Array(emptyCount).fill(`<div style="height: 250px; font-size: 32px; background: #165b7a; color: rgba(255,255,255,0.5); border: none; border-radius: 20px; display:flex; justify-content:center; align-items:center;">${text.PREPARING}</div>`).join('')}
                </div>

                <div id="popup-settings" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; padding: 50px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 10; width: 500px; border: 5px solid #165b7a;">
                    <h2 style="margin-top:0; font-size: 36px; text-align: center;">${text.SETTINGS}</h2>
                    <div style="font-size: 24px; margin-bottom: 20px;"><label>${text.BGM}: <input type="range" id="bgm-slider" min="0" max="1" step="0.1" value="${AudioManager.bgmPlayer.volume}" style="width:100%;"></label></div>
                    <div style="font-size: 24px; margin-bottom: 30px;"><label>${text.SFX}: <input type="range" id="sfx-slider" min="0" max="1" step="0.1" value="${AudioManager.sfxVolume}" style="width:100%;"></label></div>
                    
                    <div style="font-size: 24px; margin-bottom: 30px; text-align: center;">
                        <p style="margin:0 0 10px 0;">${text.FONT}</p>
                        <button id="font-gothic" style="font-family: 'Malgun Gothic', sans-serif; padding: 10px 20px; font-size: 20px;">${text.FONT_GOTHIC}</button>
                        <button id="font-gulim" style="font-family: 'Gulim', 'Dotum', sans-serif; padding: 10px 20px; font-size: 20px;">${text.FONT_GULIM}</button>
                    </div>

                    <div style="font-size: 24px; margin-bottom: 30px; text-align: center;">
                        <p style="margin:0 0 10px 0;">${text.LANG}</p>
                        <button id="lang-ko" style="padding: 10px; font-size: 18px; font-family: inherit;">한글</button>
                        <button id="lang-en" style="padding: 10px; font-size: 18px; font-family: inherit;">Eng</button>
                        <button id="lang-ja" style="padding: 10px; font-size: 18px; font-family: inherit;">日本語</button>
                    </div>
                    
                    <button id="close-settings" style="font-family: inherit; width: 100%; padding: 15px; font-size: 24px; background: #e74c3c; color: white; border: none; border-radius: 10px; cursor: pointer;">${text.CLOSE}</button>
                </div>

                <div id="popup-info" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; padding: 50px; border-radius: 20px; z-index: 10; width: 400px; text-align: center; border: 5px solid #165b7a;">
                    <h2 style="font-size: 40px;">${text.INFO}</h2>
                    <button id="close-info" style="font-family: inherit; width: 100%; padding: 15px; font-size: 24px; background: #e74c3c; color: white; border: none; border-radius: 10px; cursor: pointer; margin-top: 30px;">${text.CLOSE}</button>
                </div>
            </div>
        `;

        if (!RoomManager.isOnline()) {
            RoomManager.initNetwork();
        }

        const quickJoinBtn = container.querySelector('#btn-quick-join');
        if (quickJoinBtn) {
            quickJoinBtn.onclick = () => openQuickJoinModal(container);
        }

        container.querySelectorAll('.game-select-btn').forEach(btn => {
            btn.onclick = () => {
                const gameId = btn.dataset.gameId;
                const meta = games.find(g => g.id === gameId);
                if (!meta) return;
                if (meta.lobbyEnabled || meta.status === 'active') {
                    changeScene(meta.sceneMain);
                } else {
                    showLobbyToast(container, text.UNOS_PREPARING_MSG);
                }
            };
        });
        document.getElementById('btn-settings').onclick = () => document.getElementById('popup-settings').style.display = 'block';
        document.getElementById('close-settings').onclick = () => document.getElementById('popup-settings').style.display = 'none';
        document.getElementById('btn-info').onclick = () => document.getElementById('popup-info').style.display = 'block';
        document.getElementById('close-info').onclick = () => document.getElementById('popup-info').style.display = 'none';

        document.getElementById('bgm-slider').oninput = (e) => AudioManager.setBGMVolume(e.target.value);
        document.getElementById('sfx-slider').oninput = (e) => AudioManager.setSFXVolume(e.target.value);

        document.getElementById('font-gothic').onclick = () => SettingsManager.toggleFont(false);
        document.getElementById('font-gulim').onclick = () => SettingsManager.toggleFont(true);

        document.getElementById('lang-ko').onclick = () => LangState.set('ko');
        document.getElementById('lang-en').onclick = () => LangState.set('en');
        document.getElementById('lang-ja').onclick = () => LangState.set('ja');
    };

    const langHandler = () => renderUI();
    document.addEventListener('languageChanged', langHandler);
    container._cleanupScene = () => document.removeEventListener('languageChanged', langHandler);
    renderUI();
}