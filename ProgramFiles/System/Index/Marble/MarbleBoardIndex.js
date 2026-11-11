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