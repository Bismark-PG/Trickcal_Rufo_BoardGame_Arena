import { renderGameMainPage } from '../../Lobby/LobbyUI.js';

/**
 * 우노스(UNOS) 전용 메인 로비 씬 초기화 함수.
 */
export function initUnosMain(container, sceneParams = null) {
    renderGameMainPage(container, {
        gameId: 'unos',
        titleKey: 'UNOS_TITLE',
        badgeKey: 'UNOS_BADGE',
        rulesKey: 'UNOS_RULES',
        defaultRoomTitleKey: 'UNOS_DEFAULT_ROOM_TITLE',
        sceneParams
    });
}
