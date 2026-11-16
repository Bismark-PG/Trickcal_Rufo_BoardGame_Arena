export const AI_BOT_NAMES = [
    '베니', '티그', '버터', '코미', '슈로', '에르핀',
    '네르', '에슈르', '다야', '셰이디', '프리클', '엘레나'
];

export const AI_DIFFICULTIES = ['mild', 'spicy', 'nuclear', 'magma'];
export const AI_ARCHETYPE_POOL = ['aggressive', 'defensive', 'marathon'];

export function normalizeAiDifficulty(raw, fallback = 'mild') {
    const val = String(raw ?? '').trim().toLowerCase();
    if (val === 'mild' || val === 'easy' || val === '1' || val === '순한맛') return 'mild';
    if (val === 'spicy' || val === 'normal' || val === '2' || val === '매운맛') return 'spicy';
    if (val === 'nuclear' || val === 'hard' || val === '3' || val === '핵불맛') return 'nuclear';
    if (val === 'magma' || val === 'very_hard' || val === 'veryhard' || val === '4' || val === '마그맛') return 'magma';
    return AI_DIFFICULTIES.includes(fallback) ? fallback : 'mild';
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
        status: 'preparing',
        lobbyEnabled: true,
        gameSupported: false,
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
