// ProgramFiles/System/Server/GameSessionRegistry.js
// 게임 종목(gameId)별 서버 게임 세션 생성기 레지스트리 (우노스 등 신규 게임 확장 지점)

import { MarbleServerSession } from './MarbleServerSession.js';

const SESSION_FACTORIES = {
    marble: (deps) => new MarbleServerSession(deps)
};

export function createGameSession(gameId, deps) {
    const factory = SESSION_FACTORIES[gameId];
    if (!factory) {
        throw new Error(`UNSUPPORTED_GAME_SESSION: ${gameId}`);
    }
    return factory(deps);
}

export function hasGameSessionSupport(gameId) {
    return Boolean(SESSION_FACTORIES[gameId]);
}
