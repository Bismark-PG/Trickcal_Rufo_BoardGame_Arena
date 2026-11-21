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
    THINK_TIME: 10,         // 기본 고민 시간 (굴리기 전 및 일반 선택 10초)
    BUY_THINK_TIME: 15,     // 영토 구매·건설·확장·인수 고민 시간 (15초, 굴림 10초와 합산 총 25초 사용 가능)
    ALERT_THINK_TIME: 5,    // 도착/알림형 단일 확인 팝업 자동 넘김 시간 (5초)
    PORTAL_THINK_TIME: 20,  // 빵주 포탈 보드판 직접 선택 제한 시간 (20초)
    TURN_ORDER_ROLL_TIME: 5, // 시작 전 선후공 주사위 자동 굴림 제한 시간 (5초)

    // 게이지 주사위(Soft-Weighted 2d6) 규격 상수
    DICE_GAUGE_HOLD_THRESHOLD_MS: 150, // 짧은 클릭/홀드 구분 기준 (ms)
    DICE_GAUGE_CYCLE_MS: 1200,         // 0~100~0 왕복 1주기 (ms)
    DICE_GAUGE_DEFAULT_POWER: 50,      // 탭/타임아웃/AI/특수탈출 기본 파워
    DICE_GAUGE_NEUTRAL_MIN: 45,        // 순수 균등 2d6 유지 하한
    DICE_GAUGE_NEUTRAL_MAX: 55,        // 순수 균등 2d6 유지 상한
    DICE_GAUGE_WEIGHT_CLOSE: 1.6,      // |s - T| <= 2 가중치
    DICE_GAUGE_WEIGHT_MID: 1.25,       // 2 < |s - T| <= 3 가중치
    DICE_GAUGE_WEIGHT_FAR: 0.85,       // |s - T| > 3 가중치

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
    SETTLE_SPECIAL_TILE_UNIT: 100000, // 극장/모나티엄25/정령호수/태초의엘리프 정산 단위 (10만)
    SETTLE_LIBRARY_UNIT: 50000,       // 마녀 도서관 정산 단위 (5만)
    SETTLE_FURRY_BEACH_UNIT: 150000,  // 퍼리비이치 상태일 때 호수 정산 단위 (15만)
    SETTLE_LAP_LEADER_UNIT: 150000,   // 정산 최다 순회자 보너스 단위 (순회 횟수 * 15만)
    SETTLE_BBANGJU_BASE: 1500000,     // 빵주 정비반장 기본 고정 정산 수당 (150만)
    SETTLE_BBANGJU_UNIT: 200000,      // 빵주 정비반장 이용 횟수당 정산 단위 (20만)
    SETTLE_STEAL_UNIT: 250000,        // 김씨노동기 / 달바라기 한 송이 횟수당 수금 단위 (25만)   

    // 카드 및 파산 관련 비용
    SIST_DEAL_COST: 500000,   // 시스트의 거래 획득 시 강제 지불 비용 (50만)
    
    // 대출 관련 상수
    LOAN_MAX_COUNT: 2,                 // 최대 대출 횟수
    LOAN_CRISIS_BONUS: 750000,         // 대출 시 추가 지급되는 보너스 고정값
    LOAN_FIXED_INTEREST_RATE: 0.10,    // 대출 실행 시 고정 이자율 10%
    LOAN_PIRA_FIXED_INTEREST_RATE: 0.20, // 피라의 대부업명함 보유 시 고정 이자율 20%
    LOAN_SETTLEMENT_RATE: 0.025,       // 미상환 정산 경과 턴당 기본 이율 2.5% (모드별 오버라이드 사용)
    LOAN_PIRA_SETTLEMENT_MULT: 2,      // 피라의 대부업명함 보유 시 정산 미상환 이율 배수 (2배)
    LOAN_INTEREST_RATE: 0.025,         // 하위 호환용 기본 정산 이율 2.5%
    LOAN_PIRA_INTEREST_RATE: 0.05,     // 하위 호환용 피라 이율 5%
    LOAN_PIRA_AMOUNT_MULT: 0.5,        // 피라의 대부업명함 보유 시 대출 원금 배율 0.5배
    LOAN_REPAY_PERCENTS: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], // 턴 시작 중도 상환 선택 비율(%) (원리금 균등 10% 단위)

    // 그을음/윤회·빛무리 기본 파라미터
    REINCARNATION_SKILL_COST_RATE: 0.10,
    HALO_CARD_PRECHECK_PROB: 0.50, // 그을음 비윤회자 [113/114] 최상위 선판정 확률
    HALO_POSITIVE_MULT: 2.0        // 빛무리 수혜자 긍정 효과 배율
};

// ==========================================
// 게임 모드 3종 정의 (스피드: mode 1 / 기본: mode 2 / 불씨: mode 3)
// ==========================================
export const MARBLE_MODES = {
    speed: {
        id: 'speed',
        modeIndex: 1,
        maxTurn: 10,
        estimatedMinutes: '10~15',
        gridUnits: 11,
        boardTexture: './Resource/Texture/Marble/Board_Mode_Speed.png',
        excludedTileIds: [1, 8, 13, 16, 21, 23, 31, 39], // 1열(1,8), 2열(13,16), 3열(21,23), 4열(31,39) 총 8칸 제외 -> 32칸
        activeTileCount: 32,
        initialMoney: 5000000,
        initialMoneyByOrder: [5000000, 5250000, 5500000, 5750000],
        firstLapBonusByOrder: [700000, 800000, 900000, 1000000],
        startBonus: 1250000,       // 2회차 순회 보상 (100 + (2-1)*25 = 125만)
        lapBonus3: 1500000,        // 3회차 순회 보상 (150만)
        lapBonus4: 1750000,        // 4회차 순회 보상 (175만)
        lapBonus5PlusStep: 250000, // 5회차+: 100만 + (횟수 - 1) * 25만
        loanSettlementRate: 0.05,  // 미상환 정산 이율: 경과 턴당 5%
        timeDayStartTurn: 4,       // 4~6턴 낮(3턴), 7~9턴 밤(3턴), 10턴 통상
        timeSlotDuration: 3,
        worldGimmickEndTurn: 10,
        enableBbangjuChief: false, // 정비반장 모집/정산 없음 (3턴 자동 개방, 1~2턴 도착 시 50만 지불 즉시 전체 개방)
        bbangjuOpenTurn: 3,
        bbangjuEarlyOpenFee: 500000,
        bbangjuSupportInstallment: 0,
        bbangjuDirectPurchase: 0,
        settleBbangjuBase: 0,
        settleBbangjuUnit: 0,
        enableTreasureAndRequiem: false, // 보물 카드 및 그을음/빛무리/윤회 미등장
        cardNormalProb: 85,        // 차원 열쇠 카드 확률: 일반 85% / 특수 15%
        cardSpecialProb: 15,
        firstVisitMaxLevel: 3,     // 3턴부터 (또는 1순회 완료 시 즉시) 왕국(Lv.3)까지 한 번에 건설 허용
        firstVisitUnlockTurn: 3,   // 전원 1~2턴 마을(Lv.2) 제한 -> 1회 순회 완료 또는 3턴부터 왕국(Lv.3) 해금
        firstVisitUnlockOnFirstLap: true,
        altarWarpToRandomCardTile: true // 망가진 제단 도착 시 랜덤 차원 열쇠 칸 워프
    },
    basic: {
        id: 'basic',
        modeIndex: 2,
        maxTurn: 15,
        estimatedMinutes: '20~25',
        gridUnits: 12,
        boardTexture: './Resource/Texture/Marble/Board_Mode_Basic.png',
        excludedTileIds: [8, 13, 23, 31], // 1열(8:수인의 숲), 2열(13:수인의 숲 협곡), 3열(23:정령산 지하), 4열(31:마녀왕국거리) 총 4칸 제외 -> 36칸
        activeTileCount: 36,
        initialMoney: 5500000,
        initialMoneyByOrder: [5500000, 5750000, 6000000, 6250000],
        firstLapBonusByOrder: [650000, 750000, 850000, 950000],
        startBonus: 850000,        // 2회차 순회 보상 (85만)
        lapBonus3: 1000000,        // 3회차 순회 보상 (100만)
        lapBonus4: 1200000,        // 4회차 순회 보상 (120만)
        lapBonus5PlusStep: 150000, // 5회차+: 120만 + (횟수 - 4) * 15만
        loanSettlementRate: 0.03,  // 미상환 정산 이율: 경과 턴당 3%
        timeDayStartTurn: 5,       // 5~9턴 낮(5턴), 10~14턴 밤(5턴), 15턴 통상
        timeSlotDuration: 5,
        worldGimmickEndTurn: 15,
        enableBbangjuChief: true,  // 정비반장 기믹 활성화 (지원금 회당 25만, 즉시 구매 100만)
        bbangjuOpenTurn: 4,
        bbangjuEarlyOpenFee: 0,
        bbangjuSupportInstallment: 250000,
        bbangjuDirectPurchase: 1000000,
        settleBbangjuBase: 750000, // 기본 모드 빵주 정산 보너스: 75만 + 10만 * 전체 이용 횟수
        settleBbangjuUnit: 100000,
        enableTreasureAndRequiem: false, // 보물 카드 및 그을음/빛무리/윤회 미등장
        cardNormalProb: 90,        // 차원 열쇠 카드 확률: 일반 90% / 특수 10%
        cardSpecialProb: 10,
        firstVisitMaxLevel: 3,     // 4턴부터 (또는 1순회 완료 시 즉시) 왕국(Lv.3)까지 한 번에 프리패스 건설 허용
        firstVisitUnlockTurn: 4,   // 1~3턴은 첫 방문 시 마을(Lv.2)까지만 건설 -> 1회 순회 완료 또는 4턴부터 왕국(Lv.3) 해금
        firstVisitUnlockOnFirstLap: true,
        turn1Order12MaxLevel: 2,
        altarWarpToRandomCardTile: true // 망가진 제단 도착 시 랜덤 차원 열쇠 칸 워프
    },
    ember: {
        id: 'ember',
        modeIndex: 3,
        maxTurn: 15,
        estimatedMinutes: '20~25',
        gridUnits: 13,
        boardTexture: './Resource/Texture/Marble/Board_Mode_Ember.png',
        excludedTileIds: [],
        activeTileCount: 40,
        initialMoney: 5000000,
        initialMoneyByOrder: [5000000, 5250000, 5500000, 5750000],
        firstLapBonusByOrder: [500000, 600000, 700000, 800000],
        startBonus: 750000,        // 2회차 순회 보상 (75만)
        lapBonus3: 850000,         // 3회차 순회 보상 (85만)
        lapBonus4: 1000000,        // 4회차 순회 보상 (100만)
        lapBonus5PlusStep: 100000, // 5회차+: 100만 + (횟수 - 4) * 10만
        loanSettlementRate: 0.025, // 미상환 정산 이율: 경과 턴당 2.5%
        timeDayStartTurn: 5,       // 5~9턴 낮(5턴), 10~14턴 밤(5턴), 15턴 통상
        timeSlotDuration: 5,
        worldGimmickEndTurn: 15,
        enableBbangjuChief: true,  // 정비반장 기믹 활성화 (지원금 회당 50만, 즉시 구매 200만)
        bbangjuOpenTurn: 4,
        bbangjuEarlyOpenFee: 0,
        bbangjuSupportInstallment: 500000,
        bbangjuDirectPurchase: 2000000,
        settleBbangjuBase: 1500000, // 불씨 모드 빵주 정산 보너스: 150만 + 20만 * 전체 이용 횟수
        settleBbangjuUnit: 200000,
        enableTreasureAndRequiem: true,  // 보물 카드 및 그을음/빛무리/윤회 전체 등장
        startWithTreasureUnlocked: true, // 불씨(15턴): 제단 방문 없이 1턴부터 보물 즉시 활성화
        treasureProbTable: [
            [75.0, 15.0, 10.0], // 0장: 일반 75% / 특수 15% / 보물 10%
            [70.0, 10.0, 20.0], // 1장: 일반 70% / 특수 10% / 보물 20%
            [55.0, 5.0,  40.0], // 2장: 일반 55% / 특수 5% / 보물 40%
            [37.5, 2.5,  60.0], // 3장: 일반 37.5% / 특수 2.5% / 보물 60%
            [19.0, 1.0,  80.0], // 4장: 일반 19% / 특수 1% / 보물 80%
            [0.0,  0.0,  100.0] // 5장: 보물 100%
        ],
        cardNormalProb: 75,        // 불씨 0장 기준 기본 확률 참조치
        cardSpecialProb: 15,
        firstVisitMaxLevel: 2,     // 첫 방문 시 마을(Lv.2)까지 건설 허용
        turn1Order12MaxLevel: 2,
        altarWarpToRandomCardTile: false // 망가진 제단: 2회차+ 확정 보물 포탈 (1턴부터 보물 상시 활성)
    },
    feast: {
        id: 'feast',
        modeIndex: 4,
        maxTurn: 20,
        estimatedMinutes: '25~30',
        gridUnits: 13,
        boardTexture: './Resource/Texture/Marble/Board_Mode_Ember.png',
        excludedTileIds: [],
        activeTileCount: 40,
        initialMoney: 5000000,
        initialMoneyByOrder: [5000000, 5250000, 5500000, 5750000],
        firstLapBonusByOrder: [500000, 600000, 700000, 800000],
        startBonus: 750000,        // 2회차 순회 보상 (75만)
        lapBonus3: 850000,         // 3회차 순회 보상 (85만)
        lapBonus4: 1000000,        // 4회차 순회 보상 (100만)
        lapBonus5PlusStep: 100000, // 5회차+: 100만 + (횟수 - 4) * 10만
        loanSettlementRate: 0.025, // 미상환 정산 이율: 경과 턴당 2.5%
        timeDayStartTurn: 10,      // 10~14턴 낮(5턴), 15~19턴 밤(5턴), 20턴 통상
        timeSlotDuration: 5,
        worldGimmickEndTurn: 20,
        enableBbangjuChief: true,  // 정비반장 기믹 활성화 (지원금 회당 50만, 즉시 구매 200만)
        bbangjuOpenTurn: 4,
        bbangjuEarlyOpenFee: 0,
        bbangjuSupportInstallment: 500000,
        bbangjuDirectPurchase: 2000000,
        settleBbangjuBase: 1500000, // 특식(20턴) 모드 빵주 정산 보너스: 150만 + 20만 * 전체 이용 횟수
        settleBbangjuUnit: 200000,
        enableTreasureAndRequiem: true, // 보물 카드 및 그을음/빛무리/윤회 전체 등장
        startWithTreasureUnlocked: false, // 특식(20턴): 제단 첫 방문 시 보물 해금
        cardNormalProb: 85,        // 차원 열쇠 카드 확률: 보물 미개방 시 85/15, 개방 시 70/10/20
        cardSpecialProb: 10,
        firstVisitMaxLevel: 2,     // 첫 방문 시 마을(Lv.2)까지 건설 허용
        turn1Order12MaxLevel: 2,
        altarWarpToRandomCardTile: false // 망가진 제단: 1회차 보물 개방, 2회차+ 확정 보물 포탈
    }
};

export function normalizeMarbleMode(mode) {
    if (!mode) return 'ember';
    const raw = String(mode).trim().toLowerCase();
    if (raw === 'speed' || raw === 'casual' || raw === '1' || raw === 'mode1') return 'speed';
    if (raw === 'basic' || raw === '2' || raw === 'mode2') return 'basic';
    if (raw === 'feast' || raw === '4' || raw === 'mode4' || raw === 'full') return 'feast';
    return 'ember';
}

export function getModeConfig(mode = 'ember') {
    const key = normalizeMarbleMode(mode);
    return MARBLE_MODES[key] || MARBLE_MODES.ember;
}

/**
 * 해당 플레이어에게 보물 카드 및 오디세이아(#111) 등장 조건이 개방되었는지 판정한다.
 * - 불씨(ember): 제단 미방문 상태여도 1턴부터 즉시 해금
 * - 특식(feast): 망가진 제단 1회 이상 방문 시 해금
 * - 간식(speed)/정식(basic): 보물 미등장(false)
 */
export function isPlayerTreasureUnlocked(player, gameMode = 'ember') {
    const cfg = getModeConfig(gameMode);
    if (!cfg.enableTreasureAndRequiem) return false;
    return Boolean(cfg.startWithTreasureUnlocked || player?.hasVisitedAltar);
}

export function isTileExcludedInMode(tileId, mode = 'ember') {
    const cfg = getModeConfig(mode);
    const ex = cfg.excludedTileIds || [];
    return ex.includes(Number(tileId));
}

export function getActiveBoardSize(tilesOrMode = 'ember') {
    if (Array.isArray(tilesOrMode) && tilesOrMode.length > 0 && typeof tilesOrMode[0] === 'object') {
        const activeCount = tilesOrMode.filter(t => !t?.isDisabled && t?.type !== 'disabled').length;
        return activeCount > 0 ? activeCount : 40;
    }
    const cfg = getModeConfig(tilesOrMode || 'ember');
    return cfg.activeTileCount || (40 - (cfg.excludedTileIds?.length || 0));
}

/**
 * 모드별 비활성 칸(isDisabled)을 건너뛰며 deltaSteps만큼 이동한 최종 칸과 출발지(0번 칸) 통과 여부를 반환한다.
 */
export function stepActiveBoardPos(startPos, deltaSteps, tilesOrMode = 'ember') {
    let pos = ((Number(startPos) || 0) % 40 + 40) % 40;
    const steps = Math.trunc(Number(deltaSteps) || 0);
    if (steps === 0) return { pos, passedStart: false };

    let isDisabledFn;
    if (Array.isArray(tilesOrMode) && tilesOrMode.length > 0 && typeof tilesOrMode[0] === 'object') {
        isDisabledFn = (idx) => Boolean(tilesOrMode[idx]?.isDisabled || tilesOrMode[idx]?.type === 'disabled');
    } else if (Array.isArray(tilesOrMode)) {
        isDisabledFn = (idx) => tilesOrMode.includes(idx);
    } else if (tilesOrMode instanceof Set) {
        isDisabledFn = (idx) => tilesOrMode.has(idx);
    } else {
        const cfg = getModeConfig(tilesOrMode || 'ember');
        const ex = cfg.excludedTileIds || [];
        isDisabledFn = (idx) => ex.includes(idx);
    }

    const dir = steps > 0 ? 1 : -1;
    let remaining = Math.abs(steps);
    let passedStart = false;
    let guard = 0;
    while (remaining > 0 && guard < 400) {
        pos = (pos + dir + 40) % 40;
        if (dir > 0 && pos === 0) {
            passedStart = true;
        }
        if (!isDisabledFn(pos)) {
            remaining--;
        }
        guard++;
    }
    return { pos, passedStart };
}

export function getModeLoanSettlementRate(mode = 'ember') {
    const cfg = getModeConfig(mode);
    return cfg.loanSettlementRate ?? GAME_CONSTANTS.LOAN_SETTLEMENT_RATE ?? 0.025;
}

export function getMaxAllowedBuildLevel(currentTileLevel = -1, mode = 'ember', playerOrderIdx = null, globalTurn = null, hasFirstLapPassed = false) {
    const cfg = getModeConfig(mode);
    let firstMax = cfg.firstVisitMaxLevel || 2;
    const turn = Number(globalTurn) || 1;
    if (cfg.firstVisitUnlockTurn && turn < cfg.firstVisitUnlockTurn) {
        const unlockedByLap = Boolean(cfg.firstVisitUnlockOnFirstLap && hasFirstLapPassed);
        if (!unlockedByLap) {
            firstMax = 2;
        }
    }
    if (firstMax >= 3) {
        return currentTileLevel < 3 ? 3 : 4;
    }
    return currentTileLevel < 2 ? 2 : (currentTileLevel === 2 ? 3 : 4);
}

/**
 * 진행 순서·첫 바퀴 여부·직전 누적 순회 횟수(priorLaps)·게임 모드에 따른 기본 순회 보상을 산출한다.
 * - 스피드(speed): 1회차 70/80/90/100만 -> 2회차 125만 -> 3회차 150만 -> 4회차 175만 -> 5회차+ 100만+(횟수-1)*25만
 * - 기본(basic):   1회차 65/75/85/95만 -> 2회차 85만  -> 3회차 100만 -> 4회차 120만 -> 5회차+ 120만+(횟수-4)*15만
 * - 불씨(ember):   1회차 50/60/70/80만 -> 2회차 75만  -> 3회차 85만  -> 4회차 100만 -> 5회차+ 100만+(횟수-4)*10만
 */
export function resolveLapBaseBonus(playerOrderIdx = 0, hasFirstLapPassed = false, priorLaps = 0, mode = 'ember') {
    const cfg = getModeConfig(mode);
    const idx = Math.max(0, Math.min(3, Number(playerOrderIdx) || 0));
    if (!hasFirstLapPassed || priorLaps <= 0) {
        return cfg.firstLapBonusByOrder?.[idx] ?? cfg.startBonus ?? GAME_CONSTANTS.START_BONUS;
    }
    const nextLap = Math.max(1, (Number(priorLaps) || 0) + 1);
    if (nextLap >= 5) {
        const base = cfg.lapBonus4 || GAME_CONSTANTS.LAP_COMBO_STEP_BASE || 1000000;
        const inc = cfg.lapBonus5PlusStep || GAME_CONSTANTS.LAP_COMBO_STEP_INCREMENT || 100000;
        return base + (nextLap - 4) * inc;
    }
    if (nextLap >= 4) {
        return cfg.lapBonus4 || 1000000;
    }
    if (nextLap >= 3) {
        return cfg.lapBonus3 || 850000;
    }
    return cfg.startBonus || GAME_CONSTANTS.START_BONUS;
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
    SELL_RETURN: 0.8,

    // 정산시 환급 배율 [ 영토, 오두막, 마을, 왕국, 엘리프 조각상 ]
    SETTLEMENT: [1.0, 1.0, 1.5, 1.75, 2.0]
};