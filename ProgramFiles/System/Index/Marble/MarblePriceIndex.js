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
    // 기본 게임 설정
    INITIAL_MONEY: 5000000, 
    MAX_TURN: 20,           
    START_BONUS: 500000,    
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
    
    PORTAL_FEE: 150000,
    PORTAL_BONUS: 300000,

    // 특수칸 지급 보너스 및 교환금
    MOON_BONUS: 500000,     
    MOUNTAIN_FEE: 150000,   
    ALTAR_REWARD: 1000000,  // 망가진 제단 보물 카드 개당 교환 보상금 (100만)

    // 정산 관련 보너스 상수
    SETTLE_SPECIAL_TILE_UNIT: 100000, // 극장/모나티엄25/정령호수/도서관/태초의엘리프 정산 단위 (10만)
    SETTLE_FURRY_BEACH_UNIT: 150000,  // 퍼리비이치 상태일 때 호수 정산 단위 (15만)
    SETTLE_BBANGJU_BASE: 1000000,     // 빵주 정비반장 기본 고정 정산 수당 (100만)
    SETTLE_BBANGJU_UNIT: 100000,      // 빵주 정비반장 이용 횟수당 정산 단위 (10만)
    SETTLE_STEAL_UNIT: 250000,        // 김씨노동기 / 달바라기 한 송이 횟수당 수금 단위 (25만)   

    // 카드 및 파산 관련 비용
    SIST_DEAL_COST: 500000,   // 시스트의 거래 획득 시 강제 지불 비용 (50만)
    
    // 대출 관련 상수
    LOAN_MAX_COUNT: 2,         // 최대 대출 횟수
    LOAN_CRISIS_BONUS: 500000, // 대출 시 추가 지급되는 1순회 보너스 고정값
    LOAN_INTEREST_RATE: 0.05   // 턴당 이자율 5%
};

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