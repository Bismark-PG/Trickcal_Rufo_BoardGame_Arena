// ProgramFiles/System/Index/Marble/MarbleCardIndex.js
import { BOARD_TILES } from './MarbleBoardIndex.js';

export const CARD_IDS = {
    // 1. 일반 카드 (1 ~ 48)
    MOVE_START: 1,
    MOVE_VOLCANICA: 2,
    MOVE_MOUNTAIN: 3,
    MOVE_BBANGJU: 4,
    MOVE_THEATER: 5,
    MOVE_MONATIUM_25: 6,
    MOVE_LAKE: 7,
    MOVE_VOID: 8,
    MOVE_LIBRARY: 9,
    MOVE_MOON: 10,

    ERRAND_ASHUR: 11,
    MEETING_CITY_HALL: 12,
    HUMOR_RIM: 13,
    SHIFT_UFC: 14,

    ALICE_FORTUNE: 15,
    WITH_SYLLA: 16,
    STRATEGIC_RETREAT: 17,

    PRAISE_FOR_YOU: 18,
    TAX_LAND: 19,
    CREPE_CLEANING: 20,
    TAX_BUILD: 21,
    RIOT: 22,
    FESTIVAL: 23,
    SIST_LOTTERY: 24,
    GOLDIE_LOTTERY: 25,
    HONOR_CITIZEN_SUPPORT: 26,
    HOMELESS_SUPPORT: 27,

    LOOT_TIME: 28,
    MAGIC_SCHOOL_REC: 29,
    HUMOR_BOOK: 30,
    UFC_VIP_GUEST: 31,
    BBANGJU_RESEARCHER: 32,
    RANK_2_PRIVILEGE: 33,
    RIM_MEMORY: 34,
    SHAYDI_BIG_EVENT: 35,
    OTHERWORLD: 36,

    VIP_CARD: 37,
    NER_ESCAPE: 38,
    LIBRARY_ASSIST: 39,
    BUILD_CONTRACT: 40,
    UPGRADE_CONTRACT: 41,
    LANDMARK_CONTRACT: 42,
    SIST_DEAL: 43,
    GOLDIE_PROPOSAL: 44,
    MAYO_DEAL: 45,
    MARI_SWITCH: 46,
    REVERSE_TIME: 47,
    RUFO_DICE: 48,

    // 2. 특수 카드 - 일반/보물 관련 (101 ~ 114)
    SPEC_DOUBLE_DRAW: 101,
    SPEC_SHUFFLE: 102,
    SPEC_TAKE_DAYA: 103,
    SPEC_ERPIN_DICE: 104,
    SPEC_BBANGJU_INTRUDE: 105,

    SPEC_SECOND_CHANCE: 106,
    SPEC_VVVIP: 107,
    SPEC_MOON_FLOWER: 108,
    SPEC_SMUGGLER_BADGE: 109,
    SPEC_TIME_ACCEL: 110,

    SPEC_ODYSSEY: 111,
    SPEC_WOLF_STEAL: 112,
    SPEC_JUDGMENT: 113,
    SPEC_CULT_WISH: 114,

    // 3. 특수 카드 - 특수 칸(정령 호수 / 정령산) 관련 (201 ~ 206)
    SPEC_FURRY_OPEN: 201,
    SPEC_KOMI_JUICE: 202,
    SPEC_DIANA_PUNCH: 203,
    SPEC_KIM_WORKER: 204,
    SPEC_FORGOTTEN_MEM: 205,
    SPEC_ORIGIN_ELIF: 206,

    // 4. 보물 카드 (501 ~ 506)
    TREASURE_CROWN: 501,
    TREASURE_BOW: 502,
    TREASURE_SWORD: 503,
    TREASURE_SHROUD: 504,
    TREASURE_ROPE: 505,
    TREASURE_STAFF: 506
};

// ==========================================
// 1. 일반 카드 (ID: 1 ~ 47) - 기획서 32~33p 순서 기준
// ==========================================
export const normalCards = [
    // [특수 칸 이동관련 / 발동] (1 ~ 10)
    { id: 1, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.START, bonusMoney: 0, name: "알현요청", desc: "'알현실'로 이동합니다." },
    { id: 2, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.VOLCANICA, bonusMoney: 0, name: "교주의 휴가장", desc: "'볼케니카'로 이동합니다." },
    { id: 3, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.MOUNTAIN, bonusMoney: 0, name: "현자의 초대장", desc: "'정령산 정상'으로 이동합니다." },
    { id: 4, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.BBANGJU, bonusMoney: 0, name: "빵주 시운전", desc: "'빵주' 혹은 '빵주 정비소'로 이동합니다." },
    { id: 5, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.THEATER, bonusMoney: 0, name: "영화 시사회", desc: "'엘리아스 극장'으로 이동합니다." },
    { id: 6, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.MONATIUM_25, bonusMoney: 0, name: "야식 구매", desc: "'모나티엄 25'로 이동합니다." },
    { id: 7, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.LAKE, bonusMoney: 0, name: "나이아의 호출", desc: "'정령 호수'로 이동합니다." },
    { id: 8, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.VOID, bonusMoney: 0, name: "셰이디의 장난", desc: "'셰이디의 차원'으로 이동합니다." },
    { id: 9, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.LIBRARY, bonusMoney: 0, name: "독서의 날", desc: "'마녀 도서관'으로 이동합니다." },
    { id: 10, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.MOON, bonusMoney: 0, name: "달맞이", desc: "'달바라기 언덕'으로 이동합니다." },

    // [일반 칸 이동관련 / 발동] (11 ~ 17)
    { id: 11, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.ASHUR, bonusMoney: 200000, name: "에프린의 심부름", desc: "20만 달러를 받고 에슈르의 빵집으로 이동합니다." },
    { id: 12, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.CITY_HALL, bonusMoney: 300000, name: "엘레나의 회의소집", desc: "30만 달러를 받고 모나티엄 시청으로 이동합니다." },
    { id: 13, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.RIM_HOUSE, bonusMoney: 400000, name: "깔깔호호 유머대회", desc: "40만 달러를 받고 림의 집으로 이동합니다." },
    { id: 14, category: "normal", subType: "instant", actionType: "move_fixed", targetId: BOARD_TILES.UFC, bonusMoney: 500000, name: "레비의 대타부탁", desc: "50만 달러를 받고 UFC직영점으로 이동합니다." },
    { id: 15, category: "normal", subType: "instant", actionType: "move_choice", maxSpaces: 6, name: "앨리스의 카드 점", desc: "현재 위치에서 앞뒤로 6칸씩 원하는 수치만큼 이동할 수 있습니다." },
    { id: 16, category: "normal", subType: "instant", actionType: "move_forward", maxSpaces: 3, name: "실라와 함께", desc: "원하는 수치만큼 최대 3칸까지 앞으로 이동할 수 있습니다." },
    { id: 17, category: "normal", subType: "instant", actionType: "move_backward", maxSpaces: 3, name: "전략적 후퇴", desc: "원하는 수치만큼 최대 3칸까지 뒤로 이동할 수 있습니다." },

    // [플레이 관련 / 발동] (18 ~ 27)
    { id: 18, category: "normal", subType: "instant", actionType: "instant_steal_all", value: 300000, minFullTake: 150000, name: "그대를 위한 찬사", desc: "모든 플레이어로부터 30만 달러를 수금합니다. (15만 달러 이하 소지 시 전액, 파산 등 수금 불가 상태 제외)" },
    { id: 19, category: "normal", subType: "instant", actionType: "tax_land", value: 100000, name: "탈세점검 - 토지세", desc: "보유한 영토의 수 * 10만 달러만큼 납부합니다." },
    { id: 20, category: "normal", subType: "instant", actionType: "tax_build", valArr: [0, 10000, 30000, 50000, 100000], name: "크레페의 청소", desc: "보유한 건물의 개수(1단계: 1만, 2단계: 3만, 3단계: 5만, 랜드마크: 10만)만큼 비용을 냅니다." },
    { id: 21, category: "normal", subType: "instant", actionType: "tax_build", valArr: [0, 30000, 70000, 150000, 300000], name: "탈세점검 - 건축세", desc: "보유한 건물의 개수(1단계: 3만, 2단계: 7만, 3단계: 15만, 랜드마크: 30만)만큼 비용을 냅니다." },
    { id: 22, category: "normal", subType: "instant", actionType: "buff_toll", multiplier: 0.5, turns: 2, name: "왕국폭동", desc: "2턴간 보유한 영토의 통행료가 0.5배로 하락합니다." },
    { id: 23, category: "normal", subType: "instant", actionType: "buff_toll", multiplier: 1.5, turns: 2, name: "축제개최", desc: "2턴간 보유한 영토의 통행료가 1.5배로 상승합니다." },
    { id: 24, category: "normal", subType: "instant", actionType: "lottery", multiplier: 100000, name: "시스트의 복권", desc: "주사위 1개를 굴려 눈금 수 * 10만 달러를 받습니다." },
    { id: 25, category: "normal", subType: "instant", actionType: "lottery", multiplier: 200000, name: "골디의 고급복권", desc: "주사위 1개를 굴려 눈금 수 * 20만 달러를 받습니다." },
    { id: 26, category: "normal", subType: "instant", actionType: "instant_receive", value: 1500000, fallbackValue: 500000, minTerritory: 5, name: "명예시민 지원금", desc: "보유한 영토가 5개 이상이라면 150만 달러를 지급받습니다. (5개 미만일 경우 50만 달러 지급)" },
    { id: 27, category: "normal", subType: "instant", actionType: "instant_receive", value: 1500000, fallbackValue: 500000, maxTerritory: 3, name: "노숙시민 지원금", desc: "보유한 영토가 3개 이하라면 150만 달러를 지급받습니다. (3개 초과일 경우 50만 달러 지급)" },

    // [플레이 관련 / 보유] (28 ~ 36)
    { id: 28, category: "normal", subType: "hold", actionType: "hold_immune", targetId: BOARD_TILES.MONATIUM_25, name: "약탈의 시간이다!", desc: "모나티엄 25에 도착시 통행료를 면제받습니다." },
    { id: 29, category: "normal", subType: "hold", actionType: "hold_immune", targetId: BOARD_TILES.ASHUR, name: "마법학교 추천서", desc: "에슈르의 빵집에 도착시 통행료를 면제받습니다." },
    { id: 30, category: "normal", subType: "hold", actionType: "hold_immune", targetId: BOARD_TILES.RIM_HOUSE, name: "깔깔호호 유머집", desc: "림의 집에 도착시 통행료를 면제받습니다." },
    { id: 31, category: "normal", subType: "hold", actionType: "hold_immune", targetId: BOARD_TILES.UFC, name: "UFC 명예손놈", desc: "UFC직영점에 도착시 통행료를 면제받습니다." },
    { id: 32, category: "normal", subType: "hold", actionType: "hold_bbangju", name: "빵주 연구원", desc: "빵주의 기본 이용료를 면제받습니다. (정비반장에게 납부하는 요금 제외)" },
    { id: 33, category: "normal", subType: "hold", actionType: "hold_immune", targetId: BOARD_TILES.DAYA, name: "서열 2위의 특권", desc: "다야의 궁전 통행료를 면제받습니다. (인수/서열싸움으로 보유 시 파괴)" },
    { id: 34, category: "normal", subType: "hold", actionType: "hold_shaydi", name: "림의 기역", desc: "셰이디의 차원의 효과를 무시할 수 있습니다." },
    { id: 35, category: "normal", subType: "hold", actionType: "hold_event", name: "셰이디의 빅 이벤트", desc: "셰이디의 차원에 도착 시, 플레이어를 한 명 데려올 수 있습니다." },
    { id: 36, category: "normal", subType: "hold", actionType: "hold_reverse", name: "이면세계", desc: "자신이 보유한 모든 영토의 시간대가 모두 역전됩니다." },

    // [플레이 관련 / 사용] (37 ~ 48)
    { id: 37, category: "normal", subType: "use", actionType: "use_vip", name: "VIP카드", desc: "통행료가 얼마든 1회 면제할 수 있습니다." },
    { id: 38, category: "normal", subType: "use", actionType: "use_escape", name: "네르의 소환장", desc: "볼케니카에서 즉시 탈출할 수 있습니다." },
    { id: 39, category: "normal", subType: "use", actionType: "use_library", name: "셰럼의 일일조교", desc: "마녀 도서관에서 능력을 얻을 시 통행료를 지불하지 않습니다. (1회)" },
    { id: 40, category: "normal", subType: "use", actionType: "use_build", name: "건축계약서", desc: "보유한 영토 중 마을 미만인 곳 하나에 무료로 마을(2단계)까지 건설합니다." },
    { id: 41, category: "normal", subType: "use", actionType: "use_upgrade", name: "증축계약서", desc: "보유한 건물이 있는 영토(오두막·마을) 중 하나의 건설 단계를 무료로 올립니다." },
    { id: 42, category: "normal", subType: "use", actionType: "use_landmark", name: "엘드르유산등록서", desc: "보유한 왕국(3단계) 중 하나를 골라 무료로 엘리프 조각상으로 증축합니다." },
    { id: 43, category: "normal", subType: "use", actionType: "use_discount", name: "시스트의 거래", desc: "획득 시 강제 50만 달러 지불 후, 매입/건설/증축비를 0.5배만 납부합니다." },
    { id: 44, category: "normal", subType: "use", actionType: "use_sell", name: "골디의 제안", desc: "보유한 영토 중 하나를 매입가+건설비 합의 1.5배 가격으로 매각합니다." },
    { id: 45, category: "normal", subType: "use", actionType: "use_takeover", name: "마요의 암거래", desc: "상대를 고른 후 상대의 영토 하나를 토지 매입가 + 통행료의 1.5배를 내고 인수합니다. (엘리프 조각상 불가)" },
    { id: 46, category: "normal", subType: "use", actionType: "use_destroy", name: "마리의 스위치", desc: "상대를 한 명 고른 후 상대의 건물 하나를 랜덤으로 철거하여 건설 단계를 2단계 낮춥니다. (엘리프 조각상 포함, 2단계 이하는 토지만 소유)" },
    { id: 47, category: "normal", subType: "use", actionType: "use_reverse_one", name: "주야역전", desc: "보유한 영토 중 하나를 골라 시간대를 역전시킵니다." },
    { id: 48, category: "normal", subType: "use", actionType: "use_dice_cheat", name: "루포의 주사위", desc: "1회에 한해 던지는 주사위가 3개가 되고, 1개의 눈은 6으로 고정됩니다." }
];

// ==========================================
// 2. 특수 카드 (ID: 101 ~ 114, 201 ~ 206) - 기획서 34~35p 순서 기준
// ==========================================
export const specialCards = [
    // [플레이 관련 / 발동] (101 ~ 105)
    { id: 101, category: "special", subType: "instant", actionType: "spec_double_draw", name: "밑장빼기", desc: "다음번 뽑을 차원 이동 카드가 2장이 됩니다." },
    { id: 102, category: "special", subType: "instant", actionType: "spec_shuffle", name: "뒤집어버리기", desc: "사용된 모든 차원 이동 카드를 다시 덱에 추가하고 순서를 뒤섞습니다." },
    { id: 103, category: "special", subType: "instant", actionType: "spec_take_daya", name: "서열싸움", desc: "다야의 궁전을 보유자로부터 뺏어오거나 확정적으로 보유합니다." },
    { id: 104, category: "special", subType: "instant", actionType: "spec_erpin_dice", name: "에르핀의 주사위", desc: "주사위 중 한 개가 '에르핀 주사위'로 변화합니다." },
    { id: 105, category: "special", subType: "instant", actionType: "spec_bbangju_intrude", name: "빵주 난입", desc: "현재 위치에서 아무런 조건 없이 원하는 칸으로 이동할 수 있습니다. (카드 칸 제외)" },

    // [플레이 관련 / 보유] (106 ~ 110)
    { id: 106, category: "special", subType: "hold", actionType: "hold_second_chance", name: "두번째 기회", desc: "파산하였을 경우 300만 달러를 지급받으며 그 즉시 파괴됩니다. (단, 영토를 보유한 상태의 파산일 경우 150만 달러 지급)" },
    { id: 107, category: "special", subType: "hold", actionType: "hold_vvvip", name: "VVVIP카드", desc: "지불해야 할 모든 통행료가 0.8배로 감소됩니다." },
    { id: 108, category: "special", subType: "hold", actionType: "hold_moon_double", name: "달바라기 한 송이", desc: "달바라기 언덕에서 받는 금액이 2배가 됩니다." },
    { id: 109, category: "special", subType: "hold", actionType: "hold_start_buff", name: "암거래상의 증표", desc: "알현실의 순회 보상이 1.5배로 증가합니다." },
    { id: 110, category: "special", subType: "use", actionType: "spec_time_accel", name: "시간가속", desc: "현재 시간대의 남은 턴을 최대 2턴 단축하고 즉시 주사위를 한 번 더 굴리며, 남은 현재 시간대 동안 주사위를 총 2번 굴릴 수 있습니다." },

    // [보물카드 관련 / 발동] (111 ~ 114)
    { id: 111, category: "special", subType: "instant", actionType: "spec_get_treasure", name: "오디세이아", desc: "보물 카드를 확정적으로 1장 획득합니다." },
    { id: 112, category: "special", subType: "instant", actionType: "spec_steal_treasure", name: "애증의 늑대", desc: "보물 카드를 소유한 플레이어에게서 보물 카드를 1개 뺏어옵니다." },
    { id: 113, category: "special", subType: "instant", actionType: "spec_judgment", name: "심판의 시간", desc: "그을음을 빛무리 상태로 변화시키며, 몽환살이를 획득하고 주사위를 한 번 더 굴립니다." },
    { id: 114, category: "special", subType: "instant", actionType: "spec_wish", name: "교주의 염원", desc: "그을음을 빛무리 상태로 변화시키며, 염원살이를 획득하고 주사위를 한 번 더 굴립니다." },

    // [정령 호수 관련 / 발동] (201 ~ 203)
    { id: 201, category: "special_tile", subType: "instant", actionType: "spec_furry_open", name: "퍼리비이치 개장", desc: "정령 호수가 퍼리비이치로 변화합니다. (정령 호수 소유자 전용)" },
    { id: 202, category: "special_tile", subType: "instant", actionType: "spec_komi_juice", name: "코미주스 한잔해", desc: "퍼리비이치의 입장료가 1.5배 상승합니다." },
    { id: 203, category: "special_tile", subType: "instant", actionType: "spec_diana", name: "디아나의 꿀밤", desc: "퍼리비이치 상태가 정령 호수로 복구됩니다. (비소유자 전용)" },

    // [정령 호수 관련 / 보유] (204)
    { id: 204, category: "special_tile", subType: "hold", actionType: "hold_worker", name: "김씨노동기", desc: "퍼리비이치의 강제 휴식 효과를 받지 않습니다. (비소유자 전용)" },

    // [정령산 관련 / 보유] (205 ~ 206)
    { id: 205, category: "special_tile", subType: "hold", actionType: "hold_forget", name: "잊혀진 기억", desc: "정령산 정상의 효과를 받지 않습니다. (정령산 정상 방문 시 '되찾은 기억'으로 변화)" },
    { id: 206, category: "special_tile", subType: "hold", actionType: "hold_origin", name: "태초의 엘리프", desc: "정령산 정상의 효과를 대가 지불 없이 영구 고정으로 소유합니다." }
];

// ==========================================
// 3. 보물 카드 (ID: 501 ~ 506) - 기획서 36p 순서 기준
// ==========================================
export const treasureCards = [
    {
        id: 501,
        category: "treasure",
        subType: "treasure",
        actionType: "treasure_acquire",
        treasureKey: "crown",
        cancelsDebuffOf: 506, // 왕관 보유 시 지팡이(506)의 부작용 상쇄
        debuffCanceledBy: 504, // 수의(504) 보유 시 왕관(501)의 부작용 상쇄
        maxUses: 0,
        name: "???의 왕관",
        desc: "매 턴마다 15만 달러를 획득합니다. 단, 자신의 고민 시간이 0.5배 감소합니다."
    },
    {
        id: 502,
        category: "treasure",
        subType: "treasure",
        actionType: "treasure_acquire",
        treasureKey: "bow",
        cancelsDebuffOf: 503, // 활 보유 시 검(503)의 부작용 상쇄
        debuffCanceledBy: 506, // 지팡이(506) 보유 시 활(502)의 부작용 상쇄
        maxUses: 0,
        name: "???의 활",
        desc: "매 턴마다 주사위를 2번 굴릴 수 있습니다. 단, 영토 구매 시 무조건 마을까지 건설해야 합니다."
    },
    {
        id: 503,
        category: "treasure",
        subType: "treasure",
        actionType: "treasure_acquire",
        treasureKey: "sword",
        cancelsDebuffOf: 505, // 검 보유 시 밧줄(505)의 부작용 상쇄
        debuffCanceledBy: 502, // 활(502) 보유 시 검(503)의 부작용 상쇄
        maxUses: 0,
        name: "???가 담긴 검",
        desc: "영토의 매입비와 건설비가 0.8배로 하락합니다. 단, 주사위가 2개에서 1개로 줄어듭니다."
    },
    {
        id: 504,
        category: "treasure",
        subType: "treasure",
        actionType: "treasure_acquire",
        treasureKey: "shroud",
        cancelsDebuffOf: 501, // 수의 보유 시 왕관(501)의 부작용 상쇄
        debuffCanceledBy: 505, // 밧줄(505) 보유 시 수의(504)의 부작용 상쇄
        maxUses: 3,
        name: "???의 수의",
        desc: "플레이 동안 3회에 한해 1~6칸 원하는 수치만큼 이동할 수 있습니다. 단, 지불 통행료가 1.2배가 됩니다."
    },
    {
        id: 505,
        category: "treasure",
        subType: "treasure",
        actionType: "treasure_acquire",
        treasureKey: "rope",
        cancelsDebuffOf: 504, // 밧줄 보유 시 수의(504)의 부작용 상쇄
        debuffCanceledBy: 503, // 검(503) 보유 시 밧줄(505)의 부작용 상쇄
        maxUses: 1,
        name: "???의 밧줄",
        desc: "플레이 동안 1회에 한해 상대의 영토를 강제 매각시킬 수 있습니다. 단, 내 영토 통행료가 0.8배로 하락합니다."
    },
    {
        id: 506,
        category: "treasure",
        subType: "treasure",
        actionType: "treasure_acquire",
        treasureKey: "staff",
        cancelsDebuffOf: 502, // 지팡이 보유 시 활(502)의 부작용 상쇄
        debuffCanceledBy: 501, // 왕관(501) 보유 시 지팡이(506)의 부작용 상쇄
        maxUses: 1,
        name: "???의 지팡이",
        desc: "플레이 동안 1회에 한해 특수 칸을 제외한 원하는 영토를 대가 없이 뺏어옵니다. 단, 매 턴 15만 달러를 지불합니다."
    }
];

export const CardIndex = {
    ko: [...normalCards, ...specialCards, ...treasureCards],
    en: [...normalCards, ...specialCards, ...treasureCards],
    ja: [...normalCards, ...specialCards, ...treasureCards]
};
