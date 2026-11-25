export const AI_BOT_NAMES = [
    '베니', '티그', '버터', '코미', '슈로', '에르핀',
    '네르', '에슈르', '다야', '셰이디', '프리클', '엘레나'
];

export const AI_DIFFICULTIES = ['mild', 'normal', 'spicy', 'nuclear', 'magma'];
export const AI_ARCHETYPE_POOL = ['aggressive', 'defensive', 'marathon'];

export const UNOS_AI_DIFFICULTIES = ['mild', 'normal', 'spicy'];

export function normalizeAiDifficulty(raw, fallback = 'normal') {
    const val = String(raw ?? '').trim().toLowerCase();
    if (val === 'mild' || val === 'very_easy' || val === 'veryeasy' || val === '1' || val === '순한맛') return 'mild';
    if (val === 'normal' || val === 'easy' || val === '2' || val === '보통맛' || val === '보통') return 'normal';
    if (val === 'spicy' || val === 'medium' || val === '3' || val === '매운맛') return 'spicy';
    if (val === 'nuclear' || val === 'hard' || val === '4' || val === '핵불맛') return 'nuclear';
    if (val === 'magma' || val === 'very_hard' || val === 'veryhard' || val === '5' || val === '마그맛') return 'magma';
    return AI_DIFFICULTIES.includes(fallback) ? fallback : 'normal';
}

export function normalizeUnosAiDifficulty(raw, fallback = 'normal') {
    const val = String(raw ?? '').trim().toLowerCase();
    if (val === 'mild' || val === 'easy' || val === '1' || val === '순한맛') return 'mild';
    if (val === 'normal' || val === 'medium' || val === '2' || val === '보통맛' || val === '보통') return 'normal';
    if (val === 'spicy' || val === 'hard' || val === 'nuclear' || val === 'magma' || val === '3' || val === '매운맛') return 'spicy';
    return UNOS_AI_DIFFICULTIES.includes(fallback) ? fallback : 'normal';
}

export function getGameAiDifficulties(gameId) {
    return gameId === 'unos' ? UNOS_AI_DIFFICULTIES : AI_DIFFICULTIES;
}

export function normalizeGameAiDifficulty(gameId, raw, fallback = null) {
    if (gameId === 'unos') {
        return normalizeUnosAiDifficulty(raw, fallback || 'normal');
    }
    return normalizeAiDifficulty(raw, fallback || 'normal');
}

/**
 * 이미 사용 중인 이름과 겹치지 않게 12종의 봇 이름 중 하나를 무작위로 선택한다.
 * @param {Iterable<string>} usedNames
 * @returns {string}
 */
export function pickRandomBotName(usedNames = []) {
    const usedSet = new Set(Array.from(usedNames || []).filter(Boolean));
    const available = AI_BOT_NAMES.filter(n => !usedSet.has(n));
    const pool = available.length > 0 ? available : AI_BOT_NAMES;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (!usedSet.has(picked)) return picked;

    let seq = 2;
    while (usedSet.has(`${picked} ${seq}`)) seq++;
    return `${picked} ${seq}`;
}

export const GAME_REGISTRY = {
    marble: {
        id: 'marble',
        codePrefix: 'EMRB',
        nameKey: 'GAME_MARBLE',
        descKey: 'GAME_MARBLE_DESC',
        minPlayers: 2,
        maxPlayers: 4,
        status: 'active',
        lobbyEnabled: true,
        gameSupported: true,
        preloadOnBoot: true, // 아레나 최초 접속 시 공용 로딩 대상 (싱글/아이들러 등은 false로 분리)
        sceneMain: 'marble_main',
        sceneGame: 'marble',
        bgm: "./Resource/Audio/Game_Let's_Go.mp3",
        accentColor: '#e74c3c'
    },
    unos: {
        id: 'unos',
        codePrefix: 'UNOS',
        nameKey: 'GAME_UNOS',
        descKey: 'GAME_UNOS_DESC',
        minPlayers: 2,
        maxPlayers: 2,
        status: 'active',
        lobbyEnabled: true,
        gameSupported: true,
        preloadOnBoot: true, // 향후 우노스 인게임 에셋 추가 시 부팅 공용 로딩 자동 합류
        sceneMain: 'unos_main',
        sceneGame: 'unos',
        bgm: './Resource/Audio/Main_Furry_Forest.mp3',
        accentColor: '#9b59b6'
    }
};

export function getGameMeta(gameId) {
    return GAME_REGISTRY[gameId] || null;
}

export function getAllRegisteredGames() {
    return Object.values(GAME_REGISTRY);
}

/**
 * 게임 로비 입장 및 방 생성 허용 여부 판별 (단일 진실 원천)
 * - 레지스트리에 등록된 게임은 표시 태그(알파/베타/릴리즈 등)와 무관하게 기본 허용.
 * - 명시적 차단(lobbyEnabled: false 또는 status: 'preparing' | 'disabled')이거나
 *   임시 테스트 기간(testWindow: { startAt, endAt }) 외일 때만 로비를 비활성화.
 */
export function isGameLobbyOpen(metaOrId, nowMs = Date.now()) {
    const meta = typeof metaOrId === 'string' ? GAME_REGISTRY[metaOrId] : metaOrId;
    if (!meta) return false;
    if (meta.lobbyEnabled === false) return false;
    if (meta.status === 'preparing' || meta.status === 'disabled') return false;
    if (meta.testWindow && typeof meta.testWindow === 'object') {
        const startMs = meta.testWindow.startAt ? Date.parse(meta.testWindow.startAt) : NaN;
        const endMs = meta.testWindow.endAt ? Date.parse(meta.testWindow.endAt) : NaN;
        if (Number.isFinite(startMs) && nowMs < startMs) return false;
        if (Number.isFinite(endMs) && nowMs > endMs) return false;
    }
    return true;
}

/**
 * 아레나 메인 최초 접속 시 선로딩할 대상 게임 목록 반환 (싱글플레이 등 preloadOnBoot: false 제외)
 */
export function getBootPreloadGames() {
    return Object.values(GAME_REGISTRY).filter(
        (g) => g.preloadOnBoot !== false && isGameLobbyOpen(g)
    );
}

export function inferGameIdFromCode(rawCode) {
    const normalized = String(rawCode || '').replace(/\s+/g, '').trim().toUpperCase();
    if (!normalized) return null;
    const match = Object.values(GAME_REGISTRY).find(g => g.codePrefix && normalized.startsWith(g.codePrefix.toUpperCase()));
    return match ? match.id : null;
}
