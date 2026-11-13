import { renderGameMainPage } from '../../Lobby/LobbyUI.js';

export function initMarbleMain(container, sceneParams = null) {
    renderGameMainPage(container, {
        gameId: 'marble',
        titleKey: 'MARBLE_TITLE',
        badgeKey: 'MARBLE_BADGE',
        rulesKey: 'MARBLE_RULES',
        defaultRoomTitleKey: 'DEFAULT_ROOM_TITLE',
        sceneParams
    });
}
