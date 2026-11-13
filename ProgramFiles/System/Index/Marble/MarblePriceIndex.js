// 각 영토별 매입가격
export const TILE_BASE_PRICES = [
    // 1열 (0~9)
    0, 150000, 0, 200000, 300000, 150000, 200000, 0, 150000, 250000,
    // 2열 (10~19)
    0, 0, 0, 200000, 250000, 200000, 300000, 0, 500000, 300000,
    // 3열 (20~29)
    0, 350000, 0, 300000, 350000, 500000, 400000, 600000, 0, 450000,
    // 4열 (30~39)
    0, 450000, 750000, 700000, 500000, 0, 1000000, 600000, 0, 550000
];

// 보드판의 건설비
// [오두막, 마을, 왕국, 엘리프 조각상]
export const BUILDING_COSTS = [
    // 1열 (0~9)
    [150000, 300000, 500000, 1000000], 
    // 2열 (10~19)
    [300000, 450000, 750000, 1250000], 
    // 3열 (20~29)
    [300000, 500000, 700000, 1500000], 
    // 4열 (30~39)
    [500000, 700000, 900000, 1800000] 
];

// 경제 관련
export const GAME_CONSTANTS = {
    // 기본 게임 설정 (진행 순서 1~4번 기준 차등 시작금 & 첫 바퀴 순회보상)
    INITIAL_MONEY: 5000000, 
    INITIAL_MONEY_BY_ORDER: [5000000, 5250000, 5500000, 5750000],
    MAX_TURN: 20,           
    START_BONUS: 750000,    
    FIRST_LAP_BONUS_BY_ORDER: [500000, 600000, 700000, 800000],
    // 누적 순회 횟수 기준 속도 순회 콤보 보상: 2회 75만 -> 3회 85만 -> 4회 100만 -> 5회+ (100만 + (순회횟수-4)*10만)
    LAP_COMBO_TIERS: [
        { minNextLap: 4, bonus: 1000000 }, // 4회째 (100만)
        { minNextLap: 3, bonus: 850000 }    // 3회째 (85만)
    ],
    LAP_COMBO_STEP_START_LAP: 5,
    LAP_COMBO_STEP_BASE: 1000000,
    LAP_COMBO_STEP_INCREMENT: 100000,
    THINK_TIME: 10,         // 기본 고민 시간 (굴리기 전 10초 / 굴리기 후 10초)

    // 월드 기믹 (시간대) 턴 설정
    TIME_DAY_START_TURN: 10,    // 낮 시간대 시작 글로벌 턴 (10턴)
    TIME_SLOT_DURATION: 5,      // 각 시간대(낮/밤) 지속 글로벌 턴 수 (5턴씩)
    WORLD_GIMMICK_END_TURN: 20, // 모든 월드 기믹이 강제 종료되는 마지막 턴 (20턴)

    // 빵주 기믹
    BBANGJU_SUPPORT_INSTALLMENT: 500000, 
    BBANGJU_DIRECT_PURCHASE: 2000000,    
    BBANGJU_BASE_FEE: 100000,            
    BBANGJU_CHIEF_FEE: 200000,           
    BBANGJU_DIVIDE: { 1: 200000, 2: 100000, 3: 65000 }, 
    BBANGJU_TURN_INCOME: { 1: 150000, 2: 75000, 3: 50000 },
    BBANGJU_ALL_VACANT_REFUND: 750000, // 4인 전원 완납 공석 무산 시 참여자 각자 위로금 환급 (75만)
    
    // 매입 및 인수 비용
    THEATER_BUY: 150000,
    THEATER_TAKE: 300000,
    THEATER_TURN_PROFIT: 100000,
    MONATIUM_BUY: 200000,
    MONATIUM_EXPAND_1: 400000,
    MONATIUM_EXPAND_2: 800000,
    LAKE_BUY: 500000,
    LIBRARY_BUY: 750000,
    DAYA_BUY: 1000000,
    DAYA_TAKE: 1500000,

    // 특수칸 통행료
    TOLL_MONATIUM_0: 150000,
    TOLL_MONATIUM_1: 300000,
    TOLL_MONATIUM_2: 500000,
    TOLL_LAKE: 600000,
    TOLL_LIBRARY: 500000,
    TOLL_DAYA: 2000000,

    LAKE_ROLL_FEE: 600000,  
    LAKE_SUMMON_FEE: 900000,
    FURRY_BEACH_FEE: 500000,
    FURRY_MANUAL_OPEN_FEE: 500000,
    
    PORTAL_FEE: 150000,
    PORTAL_BONUS: 300000,

    // 특수칸 지급 보너스 및 교환금
    MOON_BONUS: 500000,     
    MOUNTAIN_FEE: 150000,   
    ALTAR_REWARD: 1000000,  // 망가진 제단 보물 카드 개당 교환 보상금 (100만)

    // 정산 관련 보너스 상수
    SETTLE_SPECIAL_TILE_UNIT: 100000, // 극장/모나티엄25/정령호수/도서관/태초의엘리프 정산 단위 (10만)
    SETTLE_FURRY_BEACH_UNIT: 150000,  // 퍼리비이치 상태일 때 호수 정산 단위 (15만)
    SETTLE_LAP_LEADER_UNIT: 150000,   // 정산 최다 순회자 보너스 단위 (순회 횟수 * 15만)
    SETTLE_BBANGJU_BASE: 1500000,     // 빵주 정비반장 기본 고정 정산 수당 (150만)
    SETTLE_BBANGJU_UNIT: 200000,      // 빵주 정비반장 이용 횟수당 정산 단위 (20만)
    SETTLE_STEAL_UNIT: 250000,        // 김씨노동기 / 달바라기 한 송이 횟수당 수금 단위 (25만)   

    // 카드 및 파산 관련 비용
    SIST_DEAL_COST: 500000,   // 시스트의 거래 획득 시 강제 지불 비용 (50만)
    
    // 대출 관련 상수
    LOAN_MAX_COUNT: 2,         // 최대 대출 횟수
    LOAN_CRISIS_BONUS: 750000, // 대출 시 추가 지급되는 1순회 보너스 고정값 (START_BONUS 동일)
    LOAN_INTEREST_RATE: 0.025, // 기본 턴당 이자율 2.5%
    LOAN_PIRA_INTEREST_RATE: 0.05, // 피라의 대부업명함 보유 시 턴당 이자율 5%
    LOAN_PIRA_AMOUNT_MULT: 0.5,    // 피라의 대부업명함 보유 시 대출 원금 배율 0.5배
    LOAN_REPAY_PERCENTS: [10, 25, 50, 75, 100], // 턴 시작 중도 상환 선택 비율(%) (원금 기준)

    // 그을음/윤회·빛무리 기본 파라미터
    REINCARNATION_SKILL_COST_RATE: 0.10,
    HALO_CARD_PRECHECK_PROB: 0.50, // 그을음 비윤회자 [113/114] 최상위 선판정 확률
    HALO_POSITIVE_MULT: 2.0        // 빛무리 수혜자 긍정 효과 배율
};

/**
 * 진행 순서·첫 바퀴 여부·직전 누적 순회 횟수(priorLaps)에 따른 기본 순회 보상을 산출한다.
 * @param {number} playerOrderIdx 0-based 좌석 인덱스
 * @param {boolean} hasFirstLapPassed 첫 바퀴 통과 완료 여부
 * @param {number} priorLaps 이번 통과 직전까지의 누적 순회 횟수
 * @returns {number}
 */
export function resolveLapBaseBonus(playerOrderIdx = 0, hasFirstLapPassed = false, priorLaps = 0) {
    if (!hasFirstLapPassed) {
        return GAME_CONSTANTS.FIRST_LAP_BONUS_BY_ORDER?.[playerOrderIdx] ?? GAME_CONSTANTS.START_BONUS;
    }
    const nextLap = Math.max(1, (Number(priorLaps) || 0) + 1);
    const stepStart = GAME_CONSTANTS.LAP_COMBO_STEP_START_LAP || 5;
    if (nextLap >= stepStart) {
        const base = GAME_CONSTANTS.LAP_COMBO_STEP_BASE || 1000000;
        const inc = GAME_CONSTANTS.LAP_COMBO_STEP_INCREMENT || 100000;
        return base + (nextLap - (stepStart - 1)) * inc;
    }
    for (const tier of GAME_CONSTANTS.LAP_COMBO_TIERS || []) {
        if (nextLap >= tier.minNextLap) {
            return tier.bonus;
        }
    }
    return GAME_CONSTANTS.START_BONUS;
}

// 산정배율 관련
export const MULTIPLIERS = {
    // 통행료 산정 배율 [ 영토, 오두막, 마을, 왕국, 엘리프 조각상 ]
    BUILDING: [0.25, 0.5, 0.8, 1.2, 1.5], 

    // 특수 영토 배율
    SPECIAL_TILE: 0.2,

    // 정령산 정상 효과 배율
    MOUNTAIN_BUFF: 0.2,

    // 시간대 배율 (1.2배 상승 -> +0.2)
    TIME_MATCH: 0.2,

    // 회생 매각 반환 배율
    SELL_RETURN: 0.5,

    // 정산시 환급 배율 [ 영토, 오두막, 마을, 왕국, 엘리프 조각상 ]
    SETTLEMENT: [0.5, 1.0, 1.5, 1.75, 2.0]
};