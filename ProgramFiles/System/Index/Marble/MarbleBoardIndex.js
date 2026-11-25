export const BoardNames = [
    // 1열 (0~9)
    { ko: "알현실", en: "Throne room", ja: "謁見の間" },
    { ko: "요정왕국거리", en: "Erpien Street", ja: "エルフィンランド通り" },
    { ko: "차원열쇠카드", en: "Card", ja: "カード" },
    { ko: "빵집 거리", en: "Restaurant Street", ja: "レストラン街" },
    { ko: "에슈르의 빵집", en: "Ashur's Bakery", ja: "エシュールベーカリー" },
    { ko: "엘리아스 극장", en: "Elias Theater", ja: "エーリアス劇場" },
    { ko: "요정왕국 주변", en: "Outskirts of Erpien", ja: "エルフィンランド周辺" },
    { ko: "차원열쇠카드", en: "Card", ja: "カード" },
    { ko: "수인의 숲", en: "Beastmen's Forest", ja: "獣人の森" },
    { ko: "수인 부락", en: "Beastmen's Village", ja: "獣人の村" },
    
    // 2열 (10~19)
    { ko: "볼케니카", en: "Volcanica", ja: "ボルケニカ" },
    { ko: "망가진 제단", en: "Broken Altar", ja: "壊れた祭壇" },
    { ko: "차원열쇠카드", en: "Card", ja: "カード" },
    { ko: "수인의 숲 협곡", en: "Beastmen's Forest Canyon", ja: "獣人の森の峡谷" },
    { ko: "모나티엄 변두리", en: "Outskirts of Monatium", ja: "モナティアムの辺境" },
    { ko: "모나티엄 25", en: "Monati-Mart", ja: "モナティーマート" },
    { ko: "모나티엄 거리", en: "Monatium Street", ja: "モナティアム通り" },
    { ko: "차원열쇠카드", en: "Card", ja: "カード" },
    { ko: "모나티엄 시청", en: "Monatium City Hall", ja: "モナティアム市庁舎" },
    { ko: "정령호수 댐", en: "Elemental Lake Dam", ja: "精霊の湖ダム" },
    
    // 3열 (20~29)
    { ko: "정령산 정상", en: "Summit of Elemental Mountain", ja: "精霊の山・頂上" },
    { ko: "블랑셰의 정원", en: "Blanchet's Garden", ja: "ブランセの庭園" },
    { ko: "차원열쇠카드", en: "Card", ja: "カード" },
    { ko: "정령산 지하", en: "Elemental Mountain Underground", ja: "精霊山地下" },
    { ko: "정령의 숲", en: "Elemental Forest", ja: "精霊の森" },
    { ko: "정령 호수", en: "Elemental Lake", ja: "精霊の湖" },
    { ko: "유령늪", en: "Phantom Marsh", ja: "幽霊の沼" },
    { ko: "림의 집", en: "Rim's House", ja: "リムの家" },
    { ko: "셰이디의 차원", en: "Shaydi's Dimension", ja: "シェイディの次元" },
    { ko: "마녀왕국 주변", en: "Outskirts of Belitien", ja: "ベリティエン周辺" },
    
    // 4열 (30~39)
    { ko: "빵주", en: "The Breadk", ja: "パン粉舟(パンコブネ)" },
    { ko: "마녀왕국거리", en: "Belitien Street", ja: "ベリティエン通り" },
    { ko: "마녀 도서관", en: "Witches' Library", ja: "魔女図書館" },
    { ko: "UFC직영점", en: "UFC Store", ja: "UFC直営店" },
    { ko: "불길과 물길의 터", en: "Where Fire and Water Meet", ja: "水と炎の地" },
    { ko: "차원열쇠카드", en: "Card", ja: "カード" },
    { ko: "다야의 궁전", en: "Daya's Palace", ja: "ダーヤの宮殿" },
    { ko: "에르피엔 대평원", en: "Erpien Great Plains", ja: "エルフィンランド大平原" },
    { ko: "달바라기 정원", en: "Garden of Moonflowers", ja: "向月葵の花畑" },
    { ko: "요정왕국 광장", en: "Erpien Square", ja: "エルフィンランド広場" }
];

export const BOARD_TILES = {
    START: 0,
    ASHUR: 4,
    THEATER: 5,
    VOLCANICA: 10,
    ALTAR: 11,
    MONATIUM_25: 15,
    CITY_HALL: 18,
    MOUNTAIN: 20,
    LAKE: 25,
    RIM_HOUSE: 27,
    VOID: 28,
    BBANGJU: 30,
    LIBRARY: 32,
    UFC: 33,
    DAYA: 36,
    MOON: 38
};

// 1~3턴 동안 표시될 빵주 정비소 명칭
export const BbangjuWorkshopName = {
    ko: "빵주 정비소",
    en: "The Breadk Workshop",
    ja: "パン粉舟整備所"
};

// 카드 칸 인덱스 목록
export const CARD_TILE_IDS = [2, 7, 12, 17, 22, 35];

// 구매 가능한 특수 칸 목록
export const SPECIAL_BUY_TILE_IDS = [
    BOARD_TILES.THEATER,
    BOARD_TILES.MONATIUM_25,
    BOARD_TILES.LAKE,
    BOARD_TILES.LIBRARY,
    BOARD_TILES.DAYA
];

// 특수 영토 (요충지 - 통행료 +0.2배) 목록
export const SPECIAL_TERRITORY_IDS = [
    BOARD_TILES.ASHUR,
    BOARD_TILES.CITY_HALL,
    BOARD_TILES.RIM_HOUSE,
    BOARD_TILES.UFC
];

// 타일 ID로 타일 타입을 반환하는 헬퍼
export function getBoardTileType(id) {
    if (id === BOARD_TILES.START) return "start";
    if (id === BOARD_TILES.VOLCANICA) return "island";
    if (id === BOARD_TILES.ALTAR) return "altar";
    if (id === BOARD_TILES.MOUNTAIN) return "mountain";
    if (id === BOARD_TILES.VOID) return "void";
    if (id === BOARD_TILES.BBANGJU) return "bread";
    if (id === BOARD_TILES.MOON) return "moon";
    if (CARD_TILE_IDS.includes(id)) return "card";
    if (SPECIAL_BUY_TILE_IDS.includes(id)) return "special_buy";
    return "normal";
}

export const TimeSlotConfig = {
    // 극장, 모나티엄25, 아공간, 궁정도서관, 달바라기언덕, 다야의 보금자리 (그 외 코너 특수/카드칸 포함)
    IMMUNE: [
        BOARD_TILES.START, BOARD_TILES.THEATER, BOARD_TILES.VOLCANICA, BOARD_TILES.ALTAR,
        BOARD_TILES.MONATIUM_25, BOARD_TILES.MOUNTAIN, BOARD_TILES.LAKE, BOARD_TILES.VOID,
        BOARD_TILES.BBANGJU, BOARD_TILES.LIBRARY, BOARD_TILES.DAYA, BOARD_TILES.MOON,
        ...CARD_TILE_IDS
    ], 
    // 빵집거리, 수인 숲, 정령 호수댐, 블랑셰의 정원, 에르피엔 대평원, 요정왕국 광장
    FIXED_DAY: [3, 8, 19, 21, 37, 39],
    // 수인 숲 협곡, 림의 집, 마녀왕국 주변, 마녀왕국거리, UFC직영점, 불길과 물길의 터
    FIXED_NIGHT: [13, 27, 29, 31, 33, 34]
};

/**
 * 확정 배치된 칸별 세부 배경(`Resource/Texture/BG/`) 변형 매니페스트.
 * 신규 BG 에셋이 추가되면 해당 타일 ID의 지원 변형(`''` 단일, `'Day'`/`'Night'`, `'Normal'`/`'Special'`)을 등록한다.
 */
export const TILE_BG_VARIANTS = {
    0: [''],
    1: ['Day', 'Night'],
    3: ['Day'],
    4: ['Day', 'Night'],
    5: [''],
    6: ['Day', 'Night'],
    8: ['Day'],
    9: ['Day', 'Night'],
    10: [''],
    11: ['Normal', 'Special'],
    13: ['Night'],
    14: ['Day', 'Night'],
    15: [''],
    16: ['Day', 'Night'],
    18: ['Day', 'Night'],
    19: [''],
    20: [''],
    21: [''],
    23: ['Day', 'Night'],
    24: ['Day', 'Night'],
    25: ['Normal', 'Special'],
    26: ['Day', 'Night'],
    27: [''],
    28: [''],
    29: [''],
    30: ['Normal', 'Special'],
    31: [''],
    32: [''],
    33: [''],
    34: [''],
    36: [''],
    37: [''],
    38: [''],
    39: ['']
};

export function formatTileBgSlug(tileId) {
    const rawEn = BoardNames[tileId]?.en || '';
    return rawEn.replace(/'/g, '').trim().replace(/\s+/g, '_');
}

/**
 * 공용 배경 경로(`Resource/Texture/BG/BG_<영문명>[_<상태/시간대>].webp`)를 조합한다.
 */
export function formatTileBgPath(tileId, tag = '') {
    const slug = formatTileBgSlug(tileId);
    if (!slug) return null;
    const suffix = (tag && tag !== 'Common') ? `_${tag}` : '';
    return `./Resource/Texture/BG/BG_${slug}${suffix}.webp`;
}

export function isBbangjuCompleted(worldState = null) {
    if (!worldState) return false;
    const mode = worldState.gameMode;
    const turn = Number(worldState.currentTurn || 1);
    if (worldState.bbangjuState === 'finished' || worldState.bbangjuState === 'vacant') return true;
    if (worldState.bbangjuState === 'occupied') {
        if (mode === 'basic' || mode === 'speed') return true;
        return turn >= 4;
    }
    if (worldState.bbangjuState === 'recruiting' || worldState.bbangjuState === 'locked') {
        if (mode === 'speed' && turn >= 3) return true;
        if ((mode === 'ember' || mode === 'feast') && turn >= 4) return true;
        return false;
    }
    if (mode === 'basic') return true;
    if (mode === 'speed') return turn >= 3;
    return turn >= 4;
}

/**
 * 아트 리소스 사용설명서 4절 규약에 따라 칸 ID · 시간대 · 제단/호수/빵주 상태에 맞는 BG 텍스처 경로를 반환한다.
 * 확정된 BG 파일이 없는 타일은 null을 반환한다.
 */
export function resolveTileBgPath(tileOrId, worldState = null, playerState = null, options = {}) {
    const tile = (tileOrId && typeof tileOrId === 'object') ? tileOrId : null;
    const tileId = tile ? tile.id : Number(tileOrId);
    if (!Number.isInteger(tileId) || tileId < 0 || tileId >= BoardNames.length) return null;

    const variants = TILE_BG_VARIANTS[tileId];
    if (!Array.isArray(variants) || variants.length === 0) return null;

    let tag = variants[0];
    if (variants.includes('') || variants.includes('Common')) {
        tag = '';
    } else if (variants.includes('Normal') || variants.includes('Special')) {
        let isSpecial = false;
        if (tileId === BOARD_TILES.LAKE) {
            isSpecial = Boolean(worldState?.isFurryBeach);
        } else if (tileId === BOARD_TILES.BBANGJU) {
            isSpecial = isBbangjuCompleted(worldState);
        } else {
            const visits = Number(playerState?.altarVisitCount || 0);
            isSpecial = options.isArrival
                ? visits >= 2
                : Boolean(playerState?.hasVisitedAltar || visits >= 1);
        }
        tag = (isSpecial && variants.includes('Special')) ? 'Special' : 'Normal';
    } else {
        const currentPhase = worldState?.timeSlot?.currentPhase;
        const isNight = tile?.timeType === 'night' || currentPhase === 'night' && tile?.timeType !== 'day';
        if (isNight && variants.includes('Night')) {
            tag = 'Night';
        } else if (variants.includes('Day')) {
            tag = 'Day';
        }
    }

    return formatTileBgPath(tileId, tag);
}

const CARD_TILE_KO_DESC = "차원 열쇠 카드를 뽑을 수 있습니다.\n과연 원하는 카드가 나올까요?";

const TERRITORY_KO_DESCS = {
    // 1열 (0~9)
    0: "달달한 향이 은은하게 나는 알현실입니다.\n이곳을 지날 때 마다 순회보상을 얻을 수 있습니다.",
    1: "요정들로 북적북적한 요정왕국거리입니다.\n왠지모르게 골목 어딘가에서 시선이 느껴집니다.",
    2: CARD_TILE_KO_DESC,
    3: "배가 고파지는 고소한 빵냄새가 퍼지는 빵집 거리입니다.\n당장이라도 따뜻한 빵을 입에 넣고 싶어집니다.",
    4: "마법학교를 가장한 빵집입니다.\n민트가 들어간 빵이 악성재고로 가득합니다.",
    5: "엘리아스 유일의 극장입니다.\n늘 같은 점원이 매표소를 지키고 있습니다.",
    6: "왕국 주변의 산책로입니다.\n산뜻한 바람이 불어옵니다.",
    7: CARD_TILE_KO_DESC,
    8: "주변이 우거진 나무들이 가득한 수인의 숲입니다.\n이따금씩 땅에 묻혀있는 사료캔들이 보입니다.",
    9: "어린 수인들이 뛰어노는 수인들의 부락입니다.\n활기찬 모습에 기분이 좋아집니다.",

    // 2열 (10~19)
    10: "엘리아스와 조금 떨어진 곳에 있는 휴양지입니다.\n따뜻하면서 시원한 바람이 불어옵니다.",
    11: "존재의미를 알 수 없는 제단입니다.\n무언가 꺼림직한 느낌이 듭니다...",
    12: CARD_TILE_KO_DESC,
    13: "수인부락 근처의 협곡입니다.\n길을 잃으면 큰일날 것 같습니다.",
    14: "모나티엄의 근처에 있는 풀밭입니다.\n저 멀리 높게 솟은 건물이 보입니다.",
    15: "모나티엄의 시민인 엘프들의 편의를 책임지는 모나티엄 25입니다.\n매일 보이는 알바가 꽤나 덜-크한 이미지입니다.",
    16: "미래적인 느낌이 가득한 모나티엄의 거리입니다.\n꺼지지 않는 건물의 불빛들로 거리는 밤에도 항상 밝습니다.",
    17: CARD_TILE_KO_DESC,
    18: "삼엄한 경비로 가득한 모나티엄의 시청입니다.\n가끔씩 어슬렁거리는 엘프가 있습니다.",
    19: "나름 합의적으로 지어진 정령호수의 댐입니다.\n압도적인 크기의 댐은 엘프의 기술력을 느끼게 해줍니다.",

    // 3열 (20~29)
    20: "현자가 살고있다는 정령산 정상입니다.\n눈때문에 춥지만, 엘리아스가 한눈에 보이는 풍경은 장관입니다.",
    21: "푸른 장미가 가득한 정원입니다.\n은은한 꽃 향기덕분에 편해집니다.",
    22: CARD_TILE_KO_DESC,
    23: "정령산의 지하에 있는 동굴입니다.\n서늘하고 칙칙하여 빨리 나가고 싶습니다.",
    24: "따뜻한 느낌이 드는 정령산 주변의 숲입니다.\n가끔씩 열매를 나눠주는 나무정령이 보입니다.",
    25: "탁 트인 풍경이 마음을 환기시켜주는 정령 호수입니다.\n가끔씩 놀자고 졸라대며 장난을 치는 정령이 보입니다.",
    26: "유령들이 모여있는 유령늪입니다.\n어디선가 감시당하는듯한 시선이 느껴집니다.",
    27: "유령들이 기피하는 림의 집입니다.\n아무도 없지만 무언가 서늘한 기분이 듭니다.",
    28: "동서쪽으로 0.4광년만큼 걸어가면 들어갈 수 있는 셰이디의 차원입니다.\n한번 들어오면 나갈 수 없지만, 남북쪽으로 -0.4광년 걸으면 나올 수 있을 것 같습니다.",
    29: "마녀왕국 벨리티엔의 주변입니다.\n세계수의 뿌리가 압도적인 위압감을 내뿜습니다.",

    // 4열 (30~39)
    30: "엘프들의 기술의 집약체인 빵주입니다.\n압도적인 크기와 빠른 속도로 어디로든 날라갈 수 있습니다.",
    31: "지하인데도 불구하고 밝은 마녀왕국의 거리입니다.\n바쁘게 뛰어다니는 한 마녀가 보입니다.",
    32: "마녀들의 지식이 모여있는 마녀 도서관입니다.\n늘 자리를 지키고있는 사서가 있습니다.",
    33: "손님들로 가득한 UFC직영점입니다.\n거리에서도 본듯한 마녀가 바쁘게 일하고 있습니다.",
    34: "용족들의 광장인 불길과 물길의 터 입니다.\n소란스러운걸 보니 서열싸움이 일어나고 있는 것 같습니다.",
    35: CARD_TILE_KO_DESC,
    36: "용족의 우두머리인 다야가 거주하는 곳입니다.\n들어가기 위해선 수많은 용족을 꺾고 들어가야합니다.",
    37: "요정들의 왕국인 에르피엔이 보이는 대평원입니다.\n높게 가지를 뻗은 세계수가 당신을 압도합니다.",
    38: "달바라기 꽃이 가득한 정원입니다.\n가끔 춤을 추는 키작은 무녀가 보입니다.",
    39: "여러 요정들의 모습이 보이는 요정왕국의 광장입니다.\n가끔 사제장이 산책을 나온다는 소식이 있습니다."
};

export const BBANGJU_WORKSHOP_DESC = {
    ko: "엘프들의 기술을 맛볼 수 있는 빵주 정비소입니다.\n지금은 빵주가 제작되고있는 상태입니다.",
    en: "A workshop of The Breadk brimming with Elven technology.\nThe Breadk is currently under construction.",
    ja: "エルフたちの技術を味わえるパン粉舟整備所です。\n現在パン粉舟を建造している状態です。"
};

export const BoardDescIndex = BoardNames.reduce((acc, item, idx) => {
    acc[idx] = {
        ko: TERRITORY_KO_DESCS[idx] || `이 영토는 ${item.ko}입니다.`,
        en: `This territory is ${item.en}.`,
        ja: `この領土は${item.ja}です。`
    };
    return acc;
}, {});

export function getTileIntroDesc(tileOrName, lang = 'ko', worldState = null) {
    const resolvedId = (typeof tileOrName === 'number')
        ? tileOrName
        : (tileOrName && typeof tileOrName === 'object' && typeof tileOrName.id === 'number' ? tileOrName.id : null);

    if (resolvedId === BOARD_TILES.BBANGJU && worldState && !isBbangjuCompleted(worldState)) {
        return BBANGJU_WORKSHOP_DESC[lang] || BBANGJU_WORKSHOP_DESC.ko;
    }
    if (resolvedId !== null && BoardDescIndex[resolvedId]) {
        return BoardDescIndex[resolvedId][lang] || BoardDescIndex[resolvedId].ko;
    }
    const nameStr = typeof tileOrName === 'string'
        ? tileOrName
        : (tileOrName?.name || BoardNames[tileOrName?.id]?.[lang] || '');
    if (lang === 'en') return `This territory is ${nameStr}.`;
    if (lang === 'ja') return `この領土は${nameStr}です。`;
    return `이 영토는 ${nameStr}입니다.`;
}