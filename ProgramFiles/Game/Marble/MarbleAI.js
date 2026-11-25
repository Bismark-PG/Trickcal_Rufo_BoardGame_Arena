import {
    GAME_CONSTANTS,
    BUILDING_COSTS,
    MULTIPLIERS,
    resolveLapBaseBonus,
    getModeConfig,
    getMaxAllowedBuildLevel,
    stepActiveBoardPos
} from '../../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES, CARD_TILE_IDS } from '../../System/Index/Marble/MarbleBoardIndex.js';
import { CARD_IDS } from '../../System/Index/Marble/MarbleCardIndex.js';
import { calculateToll, applySpecialTileTollModifiers, getTileSellValue } from './MarbleLogic.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import { getActiveWorld } from './MarbleRuntime.js';
import {
    RequiemState,
    canPlayerUseBbangju,
    getPositiveEffectMultiplier
} from './MarbleRequiem.js';
import { isTreasureDebuffActive, isBowVillageForced } from './MarbleCardTreasure.js';
import { getDrawnTreasures } from './MarbleOdyssey.js';
import { normalizeAiDifficulty } from '../../System/GameRegistry.js';

export const AI_DIFFICULTY_CONFIG = {
    // 1단계: 순한맛 (매우 쉬움) - 높은 현금 유보율, 낮은 전방 위험 감지, 증축 단계 하향 확률, 착지·도서관 오차, 낮은 전술 카드 발동률
    mild: {
        id: 'mild',
        label: '순한맛 (매우 쉬움)',
        marginScale: { aggressive: 1.45, defensive: 1.35, marathon: 1.40 },
        dangerLookaheadScale: 0.50,
        buildStepDownProb: { aggressive: 0.35, defensive: 0.42, marathon: 0.38 },
        specialTileSkipProb: 0.30,
        specialReserveScale: 1.35,
        landingScoreNoise: 220000,
        portalSuboptimalProb: 0.28,
        librarySuboptimalProb: 0.35,
        activeCardUseProb: { aggressive: 0.60, defensive: 0.52, marathon: 0.58 },
        loanRepayReserveScale: 1.45,
        loanRepayMinTurnsAdd: 2,
        sistThreshold: 1350000,
        sistSpecialThreshold: 1350000,
        leaderFocusBonus: 0.0,
        tacticalTier: 0,
        portalLookaheadRiskWeight: 0.0,
        portalLookaheadMaxStep: 7,
        bbangjuSupportProbScale: 0.60,
        diceGaugePowers: null,
        endgameRoiBoost: false
    },
    // 2단계: 보통맛 (쉬움) - 기존 매운맛 이관: 완만한 유보율, 약간의 증축 양보·평가 오차, 가벼운 캐주얼 대전
    normal: {
        id: 'normal',
        label: '보통맛 (쉬움)',
        marginScale: { aggressive: 1.18, defensive: 1.14, marathon: 1.16 },
        dangerLookaheadScale: 0.80,
        buildStepDownProb: { aggressive: 0.14, defensive: 0.18, marathon: 0.15 },
        specialTileSkipProb: 0.10,
        specialReserveScale: 1.15,
        landingScoreNoise: 80000,
        portalSuboptimalProb: 0.10,
        librarySuboptimalProb: 0.12,
        activeCardUseProb: { aggressive: 0.84, defensive: 0.80, marathon: 0.82 },
        loanRepayReserveScale: 1.18,
        loanRepayMinTurnsAdd: 1,
        sistThreshold: 1150000,
        sistSpecialThreshold: 1150000,
        leaderFocusBonus: 0.0,
        tacticalTier: 0,
        portalLookaheadRiskWeight: 0.0,
        portalLookaheadMaxStep: 7,
        bbangjuSupportProbScale: 0.85,
        diceGaugePowers: null,
        endgameRoiBoost: false
    },
    // 3단계: 매운맛 (보통) - 기존 핵불맛 이관: 10만 사이클 밸런스 검증 표준 파라미터 (오차 0, 최적 판단 100%, 순수 2d6)
    spicy: {
        id: 'spicy',
        label: '매운맛 (보통)',
        marginScale: { aggressive: 1.00, defensive: 1.00, marathon: 1.00 },
        dangerLookaheadScale: 1.00,
        buildStepDownProb: { aggressive: 0.0, defensive: 0.0, marathon: 0.0 },
        specialTileSkipProb: 0.0,
        specialReserveScale: 1.00,
        landingScoreNoise: 0,
        portalSuboptimalProb: 0.0,
        librarySuboptimalProb: 0.0,
        activeCardUseProb: { aggressive: 1.00, defensive: 1.00, marathon: 1.00 },
        loanRepayReserveScale: 1.00,
        loanRepayMinTurnsAdd: 0,
        sistThreshold: 1000000,
        sistSpecialThreshold: 1000000,
        leaderFocusBonus: 0.0,
        tacticalTier: 0,
        portalLookaheadRiskWeight: 0.0,
        portalLookaheadMaxStep: 7,
        bbangjuSupportProbScale: 1.00,
        diceGaugePowers: null,
        endgameRoiBoost: false
    },
    // 4단계: 핵불맛 (어려움) - 기존 마그맛 전술 계승 + 3단 게이지 주사위(0/50/100) 전략 조절, 1위 견제, 포탈 2중 위험 탐색
    nuclear: {
        id: 'nuclear',
        label: '핵불맛 (어려움)',
        marginScale: { aggressive: 0.92, defensive: 0.88, marathon: 0.90 },
        dangerLookaheadScale: 1.15,
        buildStepDownProb: { aggressive: 0.0, defensive: 0.0, marathon: 0.0 },
        specialTileSkipProb: 0.0,
        specialReserveScale: 0.78,
        landingScoreNoise: 0,
        portalSuboptimalProb: 0.0,
        librarySuboptimalProb: 0.0,
        activeCardUseProb: { aggressive: 1.00, defensive: 1.00, marathon: 1.00 },
        loanRepayReserveScale: 0.82,
        loanRepayMinTurnsAdd: -1,
        sistThreshold: 750000,
        sistSpecialThreshold: 600000,
        leaderFocusBonus: 0.35,
        tacticalTier: 1,
        portalLookaheadRiskWeight: 0.14,
        portalLookaheadMaxStep: 7,
        bbangjuSupportProbScale: 1.45,
        diceGaugePowers: [0, 50, 100],
        endgameRoiBoost: false
    },
    // 5단계: 마그맛 (매우 어려움) - 최상위 보스급: 5단 정밀 게이지 최적화, 1위 집중 저격(0.55), 2~12칸 2중 위험 탐색, 막판 정산 ROI 극대화
    magma: {
        id: 'magma',
        label: '마그맛 (매우 어려움)',
        marginScale: { aggressive: 0.84, defensive: 0.80, marathon: 0.82 },
        dangerLookaheadScale: 1.30,
        buildStepDownProb: { aggressive: 0.0, defensive: 0.0, marathon: 0.0 },
        specialTileSkipProb: 0.0,
        specialReserveScale: 0.68,
        landingScoreNoise: 0,
        portalSuboptimalProb: 0.0,
        librarySuboptimalProb: 0.0,
        activeCardUseProb: { aggressive: 1.00, defensive: 1.00, marathon: 1.00 },
        loanRepayReserveScale: 0.72,
        loanRepayMinTurnsAdd: -1,
        sistThreshold: 600000,
        sistSpecialThreshold: 450000,
        leaderFocusBonus: 0.55,
        tacticalTier: 2,
        portalLookaheadRiskWeight: 0.22,
        portalLookaheadMaxStep: 12,
        bbangjuSupportProbScale: 1.65,
        diceGaugePowers: [0, 25, 50, 75, 100],
        endgameRoiBoost: true
    }
};

export const AIManager = {
    // ==========================================
    // 0. 공통 상황 평가 헬퍼 (내부/공용)
    // ==========================================
    getDifficultyKey(player) {
        return normalizeAiDifficulty(player?.aiDifficulty || 'spicy', 'spicy');
    },

    getDifficultyConfig(player) {
        const key = this.getDifficultyKey(player);
        return AI_DIFFICULTY_CONFIG[key] || AI_DIFFICULTY_CONFIG.spicy;
    },

    getMaxTurn() {
        return getActiveWorld()?.maxTurn || GAME_CONSTANTS.MAX_TURN;
    },

    getTurnPhase(globalTurn = 1) {
        const maxTurn = this.getMaxTurn();
        if (globalTurn <= Math.ceil(maxTurn * 0.35)) return 'early';
        if (globalTurn <= Math.ceil(maxTurn * 0.70)) return 'mid';
        return 'late';
    },

    getTileInvestedValue(tile) {
        if (!tile || tile.level < 0) return 0;
        return tile.level === 0
            ? tile.basePrice
            : tile.basePrice + BUILDING_COSTS[tile.side][tile.level - 1];
    },

    getTileSettlementValue(tile) {
        if (!tile || tile.type !== 'normal' || tile.level < 0) return 0;
        const settleMult = MULTIPLIERS.SETTLEMENT[tile.level] + tile.level;
        return Math.round(tile.basePrice * settleMult);
    },

    getExpectedStartBonus(player) {
        if (!player) return 0;
        if (RequiemState.isSootState && !player.isReincarnated) return 0;
        if (RequiemState.isHaloState && (player.hasKarmaState || player.hasRegretState)) return 0;
        const idx = Math.max(0, (Number(player.playerIndex) || 1) - 1);
        const priorLaps = Number(player.tracker?.lapPassCount) || 0;
        const rawBase = resolveLapBaseBonus(idx, Boolean(player.hasFirstLapPassed), priorLaps, getActiveWorld()?.gameMode);
        const hasSmuggler = player.buffs && player.buffs['hold_start_buff'] && player.buffs['hold_start_buff'].length > 0;
        const baseBonus = hasSmuggler ? Math.round(rawBase * 1.5) : rawBase;
        return Math.round(baseBonus * getPositiveEffectMultiplier(player));
    },

    hasTileImmunity(player, tileId) {
        if (!player || !player.buffs) return false;
        const list = [
            ...(player.buffs['hold_immune'] || []),
            ...(player.buffs['todo_hold_immune'] || [])
        ];
        return list.some(c => c && c.targetId === tileId);
    },

    getUpcomingTimePhase(globalTurn = 1) {
        const active = WorldGimmickManager.getActiveGimmickType();
        if (active === 'day' || active === 'night') return active;
        const dayStart = getModeConfig(getActiveWorld()?.gameMode).timeDayStartTurn || GAME_CONSTANTS.TIME_DAY_START_TURN;
        if (globalTurn >= Math.max(1, dayStart - 2) && globalTurn < dayStart) return 'day';
        return 'none';
    },

    hasReincarnatedRival(player) {
        return Boolean(
            RequiemState.isSootState &&
            RequiemState.reincarnatedPlayer &&
            RequiemState.reincarnatedPlayer !== player &&
            !RequiemState.reincarnatedPlayer.isBankrupt
        );
    },

    isHaloBeneficiary(player) {
        return Boolean(
            RequiemState.isHaloState &&
            player &&
            !player.hasKarmaState &&
            !player.hasRegretState
        );
    },

    isHaloSpecialBeneficiary(player) {
        return Boolean(
            this.isHaloBeneficiary(player) &&
            RequiemState.haloTriggeredByCard &&
            (player.hasDreamState || player.hasWishState)
        );
    },

    evaluatePlayerThreat(target, tiles = []) {
        if (!target || target.isBankrupt) return -99999999;
        const debt = target.getTotalLoanDebt
            ? target.getTotalLoanDebt()
            : ((target.loanPrincipal || 0) + (target.loanInterestPrincipal || 0) + (target.loanInterest || 0));
        let score = target.money - debt;
        tiles.forEach(t => {
            if (t.owner === target && t.type === 'normal') {
                score += this.getTileSettlementValue(t);
            } else if (t.owner === target && t.type === 'special_buy') {
                score += (t.basePrice || 500000) * 1.5;
            }
        });
        score += (target.treasureCards ? target.treasureCards.length : 0) * 500000;
        if (target.isReincarnated) score += 3000000;
        if (target.hasOriginElif) score += 1000000;
        return score;
    },

    evaluateDangerAhead(player, tiles = [], minStep = 1, maxStep = 12) {
        let maxToll = 0;
        let dangerCount = 0;
        const dangerTiles = [];
        if (!tiles || tiles.length < 40) return { maxToll, dangerCount, dangerTiles };

        for (let step = minStep; step <= maxStep; step++) {
            const { pos: destIdx } = stepActiveBoardPos(player.pos, step, tiles);
            const tile = tiles[destIdx];
            if (!tile || !tile.owner || tile.owner === player) continue;
            if (tile.id === BOARD_TILES.THEATER) continue;
            if (this.hasTileImmunity(player, tile.id)) continue;

            let expectedToll = 0;
            if (tile.type === 'normal' || tile.id === BOARD_TILES.MONATIUM_25 || tile.id === BOARD_TILES.DAYA) {
                expectedToll = calculateToll(tile, player);
            } else if (tile.id === BOARD_TILES.LAKE && WorldGimmickManager.isFurryBeach) {
                expectedToll = applySpecialTileTollModifiers(
                    Math.round(GAME_CONSTANTS.FURRY_BEACH_FEE * WorldGimmickManager.furryBeachFeeMultiplier),
                    tile,
                    player
                );
            }

            if (expectedToll > 0) {
                if (expectedToll >= 300000) dangerCount++;
                if (expectedToll > maxToll) maxToll = expectedToll;
                dangerTiles.push({ step, tile, toll: expectedToll });
            }
        }
        return { maxToll, dangerCount, dangerTiles };
    },

    // ==========================================
    // 1. 동적 안전 자금 계산
    // ==========================================
    getSafetyMargin(player, globalTurn = 1, tiles = []) {
        const phase = this.getTurnPhase(globalTurn);
        const diffCfg = this.getDifficultyConfig(player);
        let baseMargin = 500000;

        if (player.aiType === 'aggressive') {
            baseMargin = phase === 'mid' ? 500000 : 300000;
        } else if (player.aiType === 'defensive') {
            baseMargin = phase === 'early' ? 650000 : (phase === 'mid' ? 850000 : 500000);
        } else if (player.aiType === 'marathon') {
            baseMargin = phase === 'early' ? 700000 : (phase === 'mid' ? 1000000 : 600000);
        }

        const scaleByDiff = diffCfg.marginScale?.[player.aiType] ?? 1.0;
        baseMargin = Math.round(baseMargin * scaleByDiff);

        const isSoot = RequiemState.isSootState;
        const isHalo = RequiemState.isHaloState;
        const hasReincarnatedRival = this.hasReincarnatedRival(player);

        // [그을음] 0.5배 매입/건설 할인 기간: 비윤회자는 성향별 유보 완화(윤회 경쟁 시 약간 보수 보정), 윤회자는 권능/생존 자금 유지
        if (isSoot) {
            if (!player.isReincarnated) {
                const factorMap = hasReincarnatedRival
                    ? { aggressive: 0.55, defensive: 0.72, marathon: 0.65 }
                    : { aggressive: 0.45, defensive: 0.58, marathon: 0.5 };
                baseMargin = Math.round(baseMargin * (factorMap[player.aiType] || 0.6));
            } else {
                const bossFactorMap = { aggressive: 0.9, defensive: 1.0, marathon: 1.0 };
                baseMargin = Math.round(baseMargin * (bossFactorMap[player.aiType] || 1.0));
            }
        } else if (isHalo) {
            // [빛무리] 후회(+0.5x 피통행료), 죄업(-0.5x 수취), 정상/몽환/염원 성향별 반영
            if (player.hasRegretState) {
                const regretMap = { aggressive: 1.05, defensive: 1.15, marathon: 1.15 };
                baseMargin = Math.round(baseMargin * (regretMap[player.aiType] || 1.15));
            } else if (player.hasKarmaState) {
                const karmaMap = { aggressive: 0.9, defensive: 1.05, marathon: 1.0 };
                baseMargin = Math.round(baseMargin * (karmaMap[player.aiType] || 1.0));
            } else {
                const haloMap = this.isHaloSpecialBeneficiary(player)
                    ? { aggressive: 0.7, defensive: 0.78, marathon: 0.75 }
                    : { aggressive: 0.85, defensive: 0.88, marathon: 0.9 };
                baseMargin = Math.round(baseMargin * (haloMap[player.aiType] || 0.9));
            }
        }

        // 전방 위험 통행료 보정 (막판 올인 구간 제외)
        const maxTurn = this.getMaxTurn();
        if (tiles && tiles.length >= 40 && globalTurn <= Math.max(1, maxTurn - 2)) {
            const { maxToll } = this.evaluateDangerAhead(player, tiles, 2, 12);
            const scaledMaxToll = Math.round(maxToll * (diffCfg.dangerLookaheadScale ?? 1.0));
            if (player.aiType === 'defensive' && scaledMaxToll > baseMargin) {
                if (isSoot && !player.isReincarnated) {
                    const cap = hasReincarnatedRival ? 1350000 : 1000000;
                    const mult = hasReincarnatedRival ? 0.62 : 0.45;
                    baseMargin = Math.min(cap, Math.max(baseMargin, Math.round(scaledMaxToll * mult)));
                } else {
                    const cap = player.hasRegretState ? 1450000 : 1250000;
                    const mult = player.hasRegretState ? 0.65 : 0.55;
                    baseMargin = Math.min(cap, Math.max(baseMargin, Math.round(scaledMaxToll * mult)));
                }
            } else if (player.aiType === 'marathon' && scaledMaxToll > baseMargin) {
                if (isSoot && !player.isReincarnated) {
                    const cap = hasReincarnatedRival ? 1500000 : 1100000;
                    const mult = hasReincarnatedRival ? 0.65 : 0.5;
                    baseMargin = Math.min(cap, Math.max(baseMargin, Math.round(scaledMaxToll * mult)));
                } else {
                    baseMargin = Math.min(1400000, Math.max(baseMargin, Math.round(scaledMaxToll * 0.65)));
                }
            } else if (player.aiType === 'aggressive' && (diffCfg.tacticalTier || 0) >= 1 && !(isSoot && !player.isReincarnated)) {
                const triggerToll = (diffCfg.tacticalTier || 0) >= 2 ? 1000000 : 1200000;
                if (maxToll >= triggerToll) {
                    const mult = (diffCfg.tacticalTier || 0) >= 2 ? 0.42 : 0.38;
                    const cap = (diffCfg.tacticalTier || 0) >= 2 ? 950000 : 900000;
                    baseMargin = Math.min(cap, Math.max(baseMargin, Math.round(maxToll * mult)));
                }
            }
        }

        return baseMargin;
    },

    // ==========================================
    // 2. 자금 위기 관리 (턴 시작 위기 / 통행료 위기)
    // ==========================================
    getSortedSellableTiles(player, tiles) {
        return tiles
            .filter(t => t.owner === player && t.type === 'normal')
            .sort((a, b) => {
                // 특수 영토(요충지)와 고단계 건물은 최후순위 보존
                const scoreA = this.getTileSettlementValue(a) + (a.isSpecialToll ? 5000000 : 0) + (a.level >= 2 ? 1000000 : 0);
                const scoreB = this.getTileSettlementValue(b) + (b.isSpecialToll ? 5000000 : 0) + (b.level >= 2 ? 1000000 : 0);
                return scoreA - scoreB;
            });
    },

    pickTilesToCoverAmount(sortedTiles, targetAmount) {
        const picked = [];
        let sum = 0;
        for (const t of sortedTiles) {
            if (sum >= targetAmount) break;
            picked.push(t);
            sum += getTileSellValue(t);
        }
        return { picked, sum, covered: sum >= targetAmount };
    },

    decideTurnStartCrisis(player, tiles, emergencyLoanAmount, globalTurn = 1) {
        const canLoan = player.loanCount < GAME_CONSTANTS.LOAN_MAX_COUNT;
        const sellables = this.getSortedSellableTiles(player, tiles);

        if (sellables.length === 0) {
            return { action: canLoan ? 'loan' : 'bankrupt', tiles: [] };
        }

        const cheapest = sellables[0];
        const maxTurn = this.getMaxTurn();
        if (player.aiType === 'defensive') {
            if (cheapest.level === 0 && !cheapest.isSpecialToll && (globalTurn <= Math.max(1, maxTurn - 5) || getTileSellValue(cheapest) > emergencyLoanAmount)) {
                return { action: 'sell', tiles: [cheapest] };
            }
            if (canLoan) return { action: 'loan', tiles: [] };
            return { action: 'sell', tiles: [cheapest] };
        }

        if (player.aiType === 'marathon') {
            if (cheapest.level === 0) {
                return { action: 'sell', tiles: [cheapest] };
            }
            if (canLoan) return { action: 'loan', tiles: [] };
            return { action: 'sell', tiles: [cheapest] };
        }

        // 공격형
        if (canLoan) {
            if (globalTurn >= Math.max(1, maxTurn - 1) && cheapest.level === 0 && getTileSellValue(cheapest) > emergencyLoanAmount) {
                return { action: 'sell', tiles: [cheapest] };
            }
            return { action: 'loan', tiles: [] };
        }
        return { action: 'sell', tiles: [cheapest] };
    },

    decideTollCrisis(player, tiles, reqAmount, globalTurn = 1) {
        const canLoan = player.loanCount < GAME_CONSTANTS.LOAN_MAX_COUNT;
        const sellables = this.getSortedSellableTiles(player, tiles);
        const { picked, covered } = this.pickTilesToCoverAmount(sellables, reqAmount);

        if (!canLoan) {
            return covered ? { action: 'sell', tiles: picked } : { action: 'bankrupt', tiles: [] };
        }

        if (!covered) {
            return { action: 'loan', tiles: [] };
        }

        const allEmpty = picked.every(t => t.level === 0 && !t.isSpecialToll);

        if (player.aiType === 'defensive' && allEmpty) {
            return { action: 'sell', tiles: picked };
        }
        if (player.aiType === 'marathon' && allEmpty) {
            return { action: 'sell', tiles: picked };
        }
        if (player.aiType === 'aggressive' && globalTurn >= Math.max(1, this.getMaxTurn() - 1) && allEmpty) {
            return { action: 'sell', tiles: picked };
        }

        return { action: 'loan', tiles: [] };
    },

    decideTurnLoanRepay(player, tiles = [], globalTurn = 1) {
        if (!player || player.isBankrupt) return 0;
        const totalDebt = player.getTotalLoanDebt ? player.getTotalLoanDebt() : Math.round((player.loanPrincipal || 0) + (player.loanInterest || 0));
        if (totalDebt <= 0) return 0;

        const maxTurn = this.getMaxTurn();
        const remainingTurns = Math.max(0, maxTurn - (Number(globalTurn) || 1));
        if (remainingTurns <= 0) return 0; // 마지막 턴에는 정산으로 직행 (고정이자 상환 불필요)

        const activeMode = getActiveWorld()?.gameMode || 'ember';
        const fixedRate = player.getFixedLoanInterestRate
            ? player.getFixedLoanInterestRate()
            : (GAME_CONSTANTS.LOAN_FIXED_INTEREST_RATE ?? 0.10);
        const settleRate = player.getLoanSettlementRate
            ? player.getLoanSettlementRate(activeMode)
            : (GAME_CONSTANTS.LOAN_SETTLEMENT_RATE ?? 0.025);

        const diffCfg = this.getDifficultyConfig(player);
        const baseReserveMap = {
            defensive: remainingTurns >= 8 ? 600000 : (remainingTurns >= 3 ? 380000 : 200000),
            marathon: remainingTurns >= 8 ? 1050000 : (remainingTurns >= 3 ? 650000 : 300000),
            aggressive: remainingTurns >= 8 ? 1300000 : (remainingTurns >= 3 ? 850000 : 350000)
        };
        let cashReserve = Math.round((baseReserveMap[player.aiType] ?? 900000) * (diffCfg.loanRepayReserveScale ?? 1.0));
        if (RequiemState.isSootState && player.isReincarnated) {
            cashReserve = Math.max(cashReserve, 700000);
        }

        const availableExcess = player.money - cashReserve;
        if (availableExcess <= 0) return 0;

        // 고정 이율(10%/20%)보다 정산 시 누적될 경과 턴 이자(settleRate * 남은턴)가 더 클 때만 상환 이익 발생
        const breakEvenTurns = Math.ceil(fixedRate / Math.max(0.005, settleRate));
        const minTurnsWorth = Math.max(1, breakEvenTurns + (diffCfg.loanRepayMinTurnsAdd ?? 0));
        if (remainingTurns <= minTurnsWorth && player.money < totalDebt + cashReserve) {
            return 0;
        }

        const options = player.getLoanRepayOptions
            ? player.getLoanRepayOptions()
            : (GAME_CONSTANTS.LOAN_REPAY_PERCENTS || [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]).map(pct => ({
                mode: pct >= 100 ? 'all' : 'combined',
                pct,
                amount: pct >= 100 ? totalDebt : Math.max(1, Math.round((totalDebt * pct) / 100)),
                affordable: totalDebt > 0 && player.money >= (pct >= 100 ? totalDebt : Math.max(1, Math.round((totalDebt * pct) / 100)))
            }));

        const weight = (pct) => (pct === 'all' ? 200 : Number(pct) || 0);
        const descending = [...options].sort((a, b) => weight(b.pct) - weight(a.pct));
        for (const opt of descending) {
            if (opt.affordable !== false && opt.amount > 0 && opt.amount <= availableExcess) {
                return opt.pct;
            }
        }
        return 0;
    },

    // ==========================================
    // 3. 일반/특수 영토 매입·건설 및 시스트 할인 판단
    // ==========================================
    shouldUseSistDiscount(player, tile, targetLevel, rawCost) {
        if (!player.inventory || targetLevel < 0 || tile.type !== 'normal') return false;
        if (!player.inventory.some(c => c.id === CARD_IDS.SIST_DEAL)) return false;

        const diffCfg = this.getDifficultyConfig(player);
        const sistThreshold = tile.isSpecialToll
            ? (diffCfg.sistSpecialThreshold ?? diffCfg.sistThreshold ?? 1000000)
            : (diffCfg.sistThreshold ?? 1000000);
        if (rawCost >= sistThreshold) return true;
        const halfCost = Math.round(rawCost * 0.5);
        if (player.money < rawCost && player.money >= halfCost + 100000) return true;
        return false;
    },

    _applyBuildDifficultyStepDown(player, tile, chosenLvl, minLvl, calcCosts, getEffCost, minRemain) {
        if (chosenLvl < 2 || chosenLvl <= minLvl) return chosenLvl;
        const diffCfg = this.getDifficultyConfig(player);
        const stepDownProb = diffCfg.buildStepDownProb?.[player.aiType] ?? 0;
        if (stepDownProb <= 0 || Math.random() >= stepDownProb) return chosenLvl;

        const lowerLvl = chosenLvl - 1;
        if (lowerLvl >= minLvl && lowerLvl > tile.level && calcCosts[lowerLvl] !== undefined) {
            if (player.money - getEffCost(lowerLvl) >= minRemain) {
                return lowerLvl;
            }
        }
        return chosenLvl;
    },

    decidePurchase(ctx) {
        const { player, tile, tiles, calcCosts, turnManager } = ctx;
        const globalTurn = turnManager ? turnManager.globalTurn : 1;
        const currentMoney = player.money;
        const safetyMargin = this.getSafetyMargin(player, globalTurn, tiles);
        const diffCfg = this.getDifficultyConfig(player);
        const activeMode = getActiveWorld()?.gameMode;
        const maxAllowedLvl = getMaxAllowedBuildLevel(tile.level, activeMode, player.playerIndex, globalTurn, Boolean(player.hasFirstLapPassed));
        const minLvl = (!tile.owner && tile.type === 'normal' && isBowVillageForced(player)) ? 2 : 0;
        const isLatePhase = this.getTurnPhase(globalTurn) === 'late';

        const hasSist = player.inventory && player.inventory.some(c => c.id === CARD_IDS.SIST_DEAL);
        const tier = diffCfg.tacticalTier || 0;
        const sistThreshold = tile.isSpecialToll
            ? (diffCfg.sistSpecialThreshold ?? diffCfg.sistThreshold ?? 1000000)
            : (diffCfg.sistThreshold ?? 1000000);
        const getEffCost = (lvl) => {
            const raw = calcCosts[lvl];
            if (hasSist && raw >= sistThreshold) return Math.round(raw * 0.5);
            return raw;
        };

        // 마그맛(endgameRoiBoost): 잔여 2턴 이내(maxTurn-1 ~ maxTurn) 막판 구간에서는 정산 순자산 환산 이익(정산가치 증가 - 지출) 극대화
        const maxTurn = this.getMaxTurn();
        const remainingTurns = maxTurn - globalTurn;
        if (diffCfg.endgameRoiBoost && tile.type === 'normal' && remainingTurns <= 1) {
            const curSettleVal = tile.level >= 0
                ? Math.round(tile.basePrice * (MULTIPLIERS.SETTLEMENT[tile.level] + tile.level))
                : 0;
            const endgameReserve = remainingTurns <= 0 ? 0 : Math.min(Math.round(safetyMargin * 0.55), 400000);
            let bestEndLvl = -1;
            let bestEndGain = 0;
            for (let lvl = maxAllowedLvl; lvl >= minLvl; lvl--) {
                if (tile.level >= lvl || calcCosts[lvl] === undefined) continue;
                const cost = getEffCost(lvl);
                if (currentMoney - cost < endgameReserve) continue;
                const nextSettleVal = Math.round(tile.basePrice * (MULTIPLIERS.SETTLEMENT[lvl] + lvl));
                const netGain = (nextSettleVal - curSettleVal) - cost;
                if (netGain > bestEndGain) {
                    bestEndGain = netGain;
                    bestEndLvl = lvl;
                }
            }
            if (bestEndLvl >= 0) {
                return bestEndLvl;
            }
            // 최종 턴에 정산 순손실 지출은 강제 건설(활)이 아닌 한 차단
            if (remainingTurns <= 0 && minLvl === 0) {
                return -1;
            }
        }

        const isSootDiscount = RequiemState.isSootState && !player.isReincarnated;
        const hasReincarnatedRival = this.hasReincarnatedRival(player);
        const isHaloBenefit = this.isHaloBeneficiary(player);

        if (player.aiType === 'aggressive') {
            const isHaloKarmaEarly = RequiemState.isHaloState && player.hasKarmaState && !isLatePhase && !tile.isSpecialToll && tile.side < 2;
            const highValueSpot = !isHaloKarmaEarly && (tile.isSpecialToll || tile.side >= 2 || isSootDiscount || isHaloBenefit || isLatePhase);
            const baseSootCap = isSootDiscount ? (hasReincarnatedRival ? 220000 : 150000) : (tier >= 2 ? 110000 : (tier >= 1 ? 140000 : 200000));
            const sootCap = Math.round(baseSootCap * (diffCfg.marginScale?.aggressive ?? 1.0));
            const effMargin = highValueSpot ? Math.min(safetyMargin, sootCap) : safetyMargin;
            const side0StatueCushion = isSootDiscount
                ? 600000
                : (tier >= 2 ? 700000 : (tier >= 1 ? 850000 : 1200000));

            for (let lvl = maxAllowedLvl; lvl >= minLvl; lvl--) {
                if (tile.level >= lvl) continue;
                // 1열 일반 땅은 자금이 아주 넉넉하지 않으면 조각상(100만, 그을음 시 50만) 과투자 억제
                if (lvl === 4 && tile.side === 0 && !tile.isSpecialToll && currentMoney < getEffCost(lvl) + side0StatueCushion) {
                    continue;
                }
                const cost = getEffCost(lvl);
                if (currentMoney - cost >= effMargin || (tile.isSpecialToll && currentMoney >= cost + 150000)) {
                    return this._applyBuildDifficultyStepDown(player, tile, lvl, minLvl, calcCosts, getEffCost, 0);
                }
            }
            return -1;
        }

        if (player.aiType === 'defensive') {
            const upcomingTime = this.getUpcomingTimePhase(globalTurn);
            const isTimeMatch = upcomingTime !== 'none' && tile.timeType === upcomingTime;
            const isPriorityTile = isSootDiscount || tile.isSpecialToll || tile.side >= 2 || tile.level >= 2 || isTimeMatch || isHaloBenefit;
            let marginMult = isPriorityTile ? 0.72 : 0.90;
            if (isSootDiscount) marginMult = hasReincarnatedRival ? 0.72 : 0.55;
            else if (isLatePhase && tile.level >= 2) marginMult = 0.60;
            if (tier >= 1 && isPriorityTile) marginMult *= (tier >= 2 ? 0.76 : 0.82);
            const baseReserve = Math.round(safetyMargin * marginMult);

            for (let lvl = maxAllowedLvl; lvl >= minLvl; lvl--) {
                if (tile.level >= lvl) continue;
                const cost = getEffCost(lvl);
                if (currentMoney - cost >= baseReserve) {
                    return this._applyBuildDifficultyStepDown(player, tile, lvl, minLvl, calcCosts, getEffCost, baseReserve);
                }
            }
            return -1;
        }

        if (player.aiType === 'marathon') {
            const upcomingTime = this.getUpcomingTimePhase(globalTurn);
            const isTimeMatch = upcomingTime !== 'none' && tile.timeType === upcomingTime;
            const isHaloTarget = isHaloBenefit && (tile.level >= 1 || tile.side >= 1 || tile.isSpecialToll);
            const isKarmaSettlementTarget = RequiemState.isHaloState && player.hasKarmaState && (tile.level >= 2 || tile.side >= 2);
            const isPriorityTile = isSootDiscount || tile.isSpecialToll || isTimeMatch || tile.level >= 2 || tile.side >= 2 || isHaloTarget || isKarmaSettlementTarget;
            let marginMult = isPriorityTile ? 0.85 : 1.0;
            if (isSootDiscount) marginMult = hasReincarnatedRival ? 0.82 : 0.65;
            if (tier >= 1 && isPriorityTile) marginMult *= (tier >= 2 ? 0.74 : 0.80);
            const effMargin = Math.round(safetyMargin * marginMult);

            // 이미 건물(Lv.2~3)이 있거나 고가치 구역·그을음 0.5배 할인 구간·고난이도(핵불맛/마그맛) 시간대 일치 타일이면 최고 허용 단계까지 적극 증축
            if (isSootDiscount || tile.level >= 2 || tile.isSpecialToll || tile.side >= 2 || (tier >= 1 && isTimeMatch)) {
                for (let lvl = maxAllowedLvl; lvl >= minLvl; lvl--) {
                    if (tile.level >= lvl) continue;
                    if (currentMoney - getEffCost(lvl) >= effMargin) {
                        return this._applyBuildDifficultyStepDown(player, tile, lvl, minLvl, calcCosts, getEffCost, effMargin);
                    }
                }
                return -1;
            }

            // 1~2열 일반 땅은 스피드/기본 4턴+ 모드(최대 Lv.3)일 때 [3, 2, 1, 0], 일반 모드일 때 [2, 1, 0] 순으로 균형 투자
            const prefOrder = tile.level < 2
                ? (maxAllowedLvl >= 3 ? [3, 2, 1, 0] : [2, 1, 0])
                : [maxAllowedLvl];
            for (const lvl of prefOrder) {
                if (lvl < minLvl || lvl > maxAllowedLvl || tile.level >= lvl) continue;
                if (currentMoney - getEffCost(lvl) >= effMargin) {
                    return this._applyBuildDifficultyStepDown(player, tile, lvl, minLvl, calcCosts, getEffCost, effMargin);
                }
            }
            return -1;
        }

        return -1;
    },

    // ==========================================
    // 4. 구매 가능 특수 칸 5곳 AI 분기
    // ==========================================
    decideSpecialTilePurchase(player, tile, globalTurn = 1, tiles = [], mode = 'visit') {
        const money = player.money;
        const margin = this.getSafetyMargin(player, globalTurn, tiles);
        const diffCfg = this.getDifficultyConfig(player);
        const resScale = diffCfg.specialReserveScale ?? 1.0;
        const skipProb = diffCfg.specialTileSkipProb ?? 0;
        const type = player.aiType;
        const maxTurn = this.getMaxTurn();

        const maybeHesitate = (action) => {
            if (action === 'skip' || skipProb <= 0) return action;
            return Math.random() < skipProb ? 'skip' : action;
        };

        if (tile.id === BOARD_TILES.THEATER) {
            if (!tile.owner && globalTurn <= maxTurn - 2) {
                return maybeHesitate(money - GAME_CONSTANTS.THEATER_BUY >= Math.round(250000 * resScale) ? 'buy' : 'skip');
            }
            if (tile.owner && tile.owner !== player && globalTurn <= maxTurn - 3) {
                const reqReserve = Math.round((type === 'defensive' ? margin * 0.50 : margin * 0.4) * resScale);
                return maybeHesitate(money - GAME_CONSTANTS.THEATER_TAKE >= reqReserve ? 'takeover' : 'skip');
            }
            return 'skip';
        }

        if (tile.id === BOARD_TILES.MONATIUM_25) {
            if (!tile.owner && globalTurn <= maxTurn - 3) {
                return maybeHesitate(money - GAME_CONSTANTS.MONATIUM_BUY >= Math.round(margin * 0.5 * resScale) ? 'buy' : 'skip');
            }
            if (tile.owner === player && tile.level < 2) {
                const expCost = tile.level === 0 ? GAME_CONSTANTS.MONATIUM_EXPAND_1 : GAME_CONSTANTS.MONATIUM_EXPAND_2;
                const turnLimit = tile.level === 0 ? Math.max(4, maxTurn - 5) : Math.max(3, maxTurn - 7);
                if (globalTurn > turnLimit) return 'skip';
                if (tile.level === 1 && type === 'defensive' && money < Math.round(1100000 * resScale)) return 'skip';
                const reqReserve = Math.round((type === 'defensive' ? margin * 0.60 : margin * 0.65) * resScale);
                return maybeHesitate(money - expCost >= reqReserve ? 'expand' : 'skip');
            }
            return 'skip';
        }

        if (tile.id === BOARD_TILES.LAKE) {
            if (!tile.owner && globalTurn <= maxTurn - 4) {
                const mult = type === 'defensive' ? 0.55 : 0.5;
                return maybeHesitate(money - GAME_CONSTANTS.LAKE_BUY >= Math.round(margin * mult * resScale) ? 'buy' : 'skip');
            }
            return 'skip';
        }

        if (tile.id === BOARD_TILES.LIBRARY) {
            if (!tile.owner && globalTurn <= maxTurn - 4) {
                const mult = type === 'marathon' ? 0.35 : 0.5;
                return maybeHesitate(money - GAME_CONSTANTS.LIBRARY_BUY >= Math.round(margin * mult * resScale) ? 'buy' : 'skip');
            }
            if (tile.owner && tile.owner !== player && mode === 'ability' && !player.hasLibraryBuff) {
                if (player.inventory && player.inventory.some(c => c.id === CARD_IDS.LIBRARY_ASSIST)) {
                    return 'use_assist';
                }
                if (globalTurn <= maxTurn - 5) {
                    const toll = applySpecialTileTollModifiers(GAME_CONSTANTS.TOLL_LIBRARY, tile, player);
                    if (money - toll >= Math.round(1000000 * resScale)) return maybeHesitate('buy_ability');
                }
            }
            return 'skip';
        }

        if (tile.id === BOARD_TILES.DAYA) {
            if (!tile.owner && globalTurn <= maxTurn - 2) {
                if (type === 'defensive' && this.hasTileImmunity(player, BOARD_TILES.DAYA) && money < Math.round(1100000 * resScale)) {
                    return 'skip';
                }
                const reqReserve = Math.round((type === 'defensive' ? 350000 : 300000) * resScale);
                return maybeHesitate(money - GAME_CONSTANTS.DAYA_BUY >= reqReserve ? 'buy' : 'skip');
            }
            if (tile.owner && tile.owner !== player && mode === 'takeover' && globalTurn <= maxTurn - 5) {
                const reqReserve = Math.round((type === 'defensive' ? margin * 0.60 : margin * 0.5) * resScale);
                return maybeHesitate(money - GAME_CONSTANTS.DAYA_TAKE >= reqReserve ? 'takeover' : 'skip');
            }
            return 'skip';
        }

        return 'skip';
    },

    // ==========================================
    // 5. 공용 착지 기대 가치 평가 및 이동/포탈 목적지 선택
    // ==========================================
    scoreLandingTile(player, tile, tiles, allPlayers = [], globalTurn = 1) {
        if (!tile) return -999999;
        const type = player.aiType;
        const money = player.money;
        const margin = this.getSafetyMargin(player, globalTurn, tiles);
        const diffCfg = this.getDifficultyConfig(player);
        const upcomingTime = this.getUpcomingTimePhase(globalTurn);

        // 1. 타인 소유 타일 도착 시
        if (tile.owner && tile.owner !== player) {
            if (tile.id === BOARD_TILES.THEATER) {
                return (globalTurn <= 17 && money >= GAME_CONSTANTS.THEATER_TAKE + 400000) ? 350000 : 0;
            }
            if (tile.id === BOARD_TILES.DAYA) {
                if (this.hasTileImmunity(player, BOARD_TILES.DAYA)) return 50000;
                const toll = calculateToll(tile, player);
                if (money >= toll + GAME_CONSTANTS.DAYA_TAKE + 500000 && globalTurn <= 15) return -toll + 600000;
                return money >= toll ? -toll * 1.1 : -2500000;
            }
            if (tile.id === BOARD_TILES.LAKE) {
                if (WorldGimmickManager.isFurryBeach) {
                    const fee = applySpecialTileTollModifiers(
                        Math.round(GAME_CONSTANTS.FURRY_BEACH_FEE * WorldGimmickManager.furryBeachFeeMultiplier),
                        tile,
                        player
                    );
                    return -fee - 250000;
                }
                return money >= GAME_CONSTANTS.LAKE_ROLL_FEE + 500000 ? -150000 : -250000;
            }
            if (tile.id === BOARD_TILES.LIBRARY) {
                return player.hasLibraryBuff ? 0 : 40000;
            }

            // 일반/특수 영토 및 모나티엄25
            if (this.hasTileImmunity(player, tile.id)) return 30000;
            const toll = calculateToll(tile, player);
            if (player.hasVipShield || (player.inventory && player.inventory.some(c => c.id === CARD_IDS.VIP_CARD))) {
                return toll >= 400000 ? -80000 : -200000; // 소액 땅에 VIP 낭비 회피
            }
            let riskMult = type === 'defensive' ? 1.18 : 1.1;
            if (type === 'defensive' && tile.owner.isReincarnated) riskMult = 1.28;
            else if (type === 'defensive' && this.isHaloSpecialBeneficiary(tile.owner)) riskMult = 1.28;
            else if (type === 'defensive' && player.hasRegretState) riskMult = 1.25;
            const tier = diffCfg.tacticalTier || 0;
            if (tier >= 1) riskMult += (tier >= 2 ? 0.14 : 0.08);
            let penalty = -Math.round(toll * riskMult);
            if (money < toll) penalty -= 2000000;
            return penalty;
        }

        // 2. 본인 소유 타일 도착 시
        if (tile.owner === player) {
            const tier = diffCfg.tacticalTier || 0;
            const isSootDiscount = RequiemState.isSootState && !player.isReincarnated;
            const isHaloBenefit = this.isHaloBeneficiary(player);
            if (tile.type === 'normal' && tile.level < 4) {
                const nextLvl = tile.level < 2 ? 2 : tile.level + 1;
                const rawUpgCost = tile.level === 0
                    ? BUILDING_COSTS[tile.side][nextLvl - 1]
                    : (nextLvl === 4 ? BUILDING_COSTS[tile.side][3] : BUILDING_COSTS[tile.side][nextLvl - 1] * 0.5);
                const upgCost = isSootDiscount ? Math.round(rawUpgCost * 0.5) : rawUpgCost;
                if (money >= upgCost + margin * 0.5) {
                    let bonus = 260000 + tile.side * 60000;
                    if (tile.isSpecialToll) bonus += (tier >= 2 ? 400000 : (tier >= 1 ? 320000 : 200000));
                    if (upcomingTime !== 'none' && tile.timeType === upcomingTime) bonus += 150000;
                    if (isSootDiscount) bonus += 180000;
                    if (isHaloBenefit) bonus += this.isHaloSpecialBeneficiary(player) ? 120000 : 60000;
                    if (RequiemState.isHaloState && player.hasKarmaState && globalTurn < 16) bonus -= 40000;
                    return bonus;
                }
            }
            if (tile.id === BOARD_TILES.MONATIUM_25 && tile.level < 2) {
                const expCost = tile.level === 0 ? GAME_CONSTANTS.MONATIUM_EXPAND_1 : GAME_CONSTANTS.MONATIUM_EXPAND_2;
                if (money >= expCost + margin * 0.5) return 300000;
            }
            return 60000; // 안전한 내 땅
        }

        // 3. 미소유 구매 가능 타일
        if (tile.type === 'normal') {
            const tier = diffCfg.tacticalTier || 0;
            const isSootDiscount = RequiemState.isSootState && !player.isReincarnated;
            const rawMinCost = isBowVillageForced(player)
                ? tile.basePrice + BUILDING_COSTS[tile.side][1]
                : tile.basePrice;
            const minCost = isSootDiscount ? Math.round(rawMinCost * 0.5) : rawMinCost;
            if (money >= minCost + margin * 0.4) {
                let score = 200000 + tile.side * 80000;
                if (tile.isSpecialToll) score += (tier >= 2 ? 560000 : (tier >= 1 ? 480000 : 350000));
                if (upcomingTime !== 'none' && tile.timeType === upcomingTime) score += 120000;
                if (isSootDiscount) {
                    score += this.hasReincarnatedRival(player) ? 200000 : 260000;
                }
                return score;
            }
            return 10000;
        }

        const maxTurn = this.getMaxTurn();
        if (tile.id === BOARD_TILES.DAYA && globalTurn <= maxTurn - 2 && money >= GAME_CONSTANTS.DAYA_BUY + 300000) {
            return type === 'defensive' ? 800000 : 950000;
        }
        if (tile.id === BOARD_TILES.THEATER && globalTurn <= maxTurn - 2 && money >= GAME_CONSTANTS.THEATER_BUY + 250000) {
            return 550000;
        }
        if (tile.id === BOARD_TILES.MONATIUM_25 && globalTurn <= maxTurn - 3 && money >= GAME_CONSTANTS.MONATIUM_BUY + 300000) {
            return 450000;
        }
        if (tile.id === BOARD_TILES.LIBRARY && globalTurn <= maxTurn - 4 && money >= GAME_CONSTANTS.LIBRARY_BUY + 350000) {
            return type === 'marathon' ? 700000 : 500000;
        }
        if (tile.id === BOARD_TILES.LAKE && globalTurn <= maxTurn - 4 && money >= GAME_CONSTANTS.LAKE_BUY + 350000) {
            return 450000;
        }

        // 4. 비구매 특수/이벤트 칸
        if (tile.id === BOARD_TILES.MOON) {
            const hasMoonFlower = player.buffs && (player.buffs['hold_moon_double'] || player.buffs['todo_hold_moon_double']);
            const base = GAME_CONSTANTS.MOON_BONUS * (hasMoonFlower && hasMoonFlower.length > 0 ? 2 : 1);
            return Math.round(base * getPositiveEffectMultiplier(player) * (type === 'defensive' ? 1.2 : 1.0));
        }
        if (tile.id === BOARD_TILES.MOUNTAIN) {
            const hasForgotten = player.buffs && player.buffs['hold_forget'] && player.buffs['hold_forget'].length > 0 && !player.hasRecoveredMemory;
            if (hasForgotten) return 1200000; // 되찾은 기억 해금 최우선
            const originHolder = allPlayers.find(op => op.hasOriginElif && !op.isBankrupt);
            if (!originHolder && !player.hasMountainBuff && this.decideMountainBuy(player, allPlayers, tiles, globalTurn)) {
                return type === 'marathon' ? 550000 : 400000;
            }
            return 20000;
        }
        if (tile.id === BOARD_TILES.ALTAR) {
            const modeCfg = getModeConfig(getActiveWorld()?.gameMode);
            if (modeCfg.altarWarpToRandomCardTile) {
                return 320000 + Math.round(this.getExpectedStartBonus(player) / 3);
            }
            if (!player.hasVisitedAltar && !RequiemState.hasSootEverTriggered) {
                return modeCfg.startWithTreasureUnlocked ? 320000 : 480000;
            }
            if ((player.altarVisitCount || 0) >= 1 && !RequiemState.hasSootEverTriggered && !RequiemState.isSootState && getDrawnTreasures().size < 6) {
                return 550000;
            }
            if (player.treasureCards && player.treasureCards.length > 0 && this.decideAltarTrade(player, allPlayers, globalTurn)) {
                return 350000;
            }
            return 0;
        }
        if (tile.id === BOARD_TILES.BBANGJU) {
            const modeCfg = getModeConfig(getActiveWorld()?.gameMode);
            if (modeCfg.enableBbangjuChief && globalTurn < 4) {
                const directPurchase = modeCfg.bbangjuDirectPurchase || GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE;
                const reqCost = player.bbangjuPaidTotal > 0 ? directPurchase - player.bbangjuPaidTotal : directPurchase;
                return this.decideBbangjuTakeover(player, reqCost) ? 600000 : 10000;
            }
            return canPlayerUseBbangju(player) ? 320000 : 0;
        }
        if (tile.id === BOARD_TILES.VOLCANICA) {
            return globalTurn >= Math.max(1, maxTurn - 4) && type === 'defensive' ? -100000 : -600000;
        }
        if (tile.id === BOARD_TILES.VOID) {
            const hasRim = player.buffs && ((player.buffs['hold_shaydi'] && player.buffs['hold_shaydi'].length > 0) || (player.buffs['todo_hold_shaydi'] && player.buffs['todo_hold_shaydi'].length > 0));
            const hasEvent = player.buffs && ((player.buffs['hold_event'] && player.buffs['hold_event'].length > 0) || (player.buffs['todo_hold_event'] && player.buffs['todo_hold_event'].length > 0));
            if (hasRim && hasEvent) return 400000;
            if (hasRim) return 40000;
            return -500000;
        }
        if (tile.type === 'card') {
            if (RequiemState.isSootState && !player.isReincarnated) {
                if (this.hasReincarnatedRival(player)) {
                    if (type === 'aggressive') return 850000;
                    if (type === 'marathon') return 750000;
                    return 650000;
                }
                return 480000; // 분기 1(윤회 공석): 0.5배 건설과 균형 평가
            }
            if (this.isHaloBeneficiary(player)) {
                return (this.isHaloSpecialBeneficiary(player) || player.hasLibraryBuff || tiles[BOARD_TILES.LIBRARY]?.owner === player)
                    ? 600000
                    : 520000;
            }
            if (player.hasLibraryBuff || tiles[BOARD_TILES.LIBRARY]?.owner === player) return 450000;
            return 280000;
        }

        return 0;
    },

    decidePortalDestination(ctx, isFreeCard = false, overrideFee = null) {
        const { player, tiles, allPlayers, turnManager } = ctx;
        const globalTurn = turnManager ? turnManager.globalTurn : 1;
        const diffCfg = this.getDifficultyConfig(player);

        let reqMoney = 0;
        if (!isFreeCard) {
            if (!canPlayerUseBbangju(player)) return -1;
            if (overrideFee !== null && overrideFee !== undefined) {
                reqMoney = Math.max(0, Number(overrideFee) || 0);
            } else {
                const chiefs = WorldGimmickManager.bbangjuChiefs.length === 4 ? [] : WorldGimmickManager.bbangjuChiefs;
                const isFree = player.isBbangjuChief;
                const hasResearcher = player.buffs && ((player.buffs['hold_bbangju'] && player.buffs['hold_bbangju'].length > 0) || (player.buffs['todo_hold_bbangju'] && player.buffs['todo_hold_bbangju'].length > 0));
                const baseFee = (isFree || hasResearcher) ? 0 : GAME_CONSTANTS.BBANGJU_BASE_FEE;
                const chiefFee = (!isFree && chiefs.length > 0) ? GAME_CONSTANTS.BBANGJU_CHIEF_FEE : 0;
                reqMoney = baseFee + chiefFee;
            }
            if (player.money < reqMoney) return -1;
        }

        const startBonus = this.getExpectedStartBonus(player);
        const candidates = [];
        const prevPos = player.pos;

        tiles.forEach(tile => {
            if (tile.isDisabled || tile.type === 'disabled') return;
            if (isFreeCard) {
                if (tile.type === 'card' || tile.id === player.pos) return;
            } else {
                if (tile.id === BOARD_TILES.BBANGJU) return;
            }

            let score = this.scoreLandingTile(player, tile, tiles, allPlayers, globalTurn);
            if (tile.id < player.pos || tile.id === BOARD_TILES.START) {
                score += startBonus;
            }
            if ((diffCfg.portalLookaheadRiskWeight || 0) > 0) {
                let nextThreat;
                try {
                    player.pos = tile.id;
                    nextThreat = this.evaluateDangerAhead(player, tiles, 2, diffCfg.portalLookaheadMaxStep || 7);
                } finally {
                    player.pos = prevPos;
                }
                score -= Math.round((nextThreat?.maxToll || 0) * diffCfg.portalLookaheadRiskWeight);
            } else if ((diffCfg.landingScoreNoise || 0) > 0) {
                score += Math.round((Math.random() * 2 - 1) * diffCfg.landingScoreNoise);
            }
            candidates.push({ id: tile.id, score });
        });

        if (candidates.length === 0) return -1;
        candidates.sort((a, b) => b.score - a.score);

        let chosen = candidates[0];
        if (candidates.length >= 2 && (diffCfg.portalSuboptimalProb || 0) > 0 && Math.random() < diffCfg.portalSuboptimalProb) {
            if (candidates[1].score > 0) chosen = candidates[1];
        }

        if (!isFreeCard && chosen.score < (reqMoney > 0 ? Math.max(120000, reqMoney * 1.2) : 50000)) {
            return -1;
        }
        return chosen.id;
    },

    decideRelativeMoveCard(player, options, tiles, allPlayers = [], globalTurn = 1) {
        if (!options || options.length === 0) return 1;
        const diffCfg = this.getDifficultyConfig(player);
        let bestOpt = options[0];
        let bestScore = -9999999;
        const startBonus = this.getExpectedStartBonus(player);

        options.forEach(step => {
            const { pos: targetIdx, passedStart } = stepActiveBoardPos(player.pos, step, tiles);
            const targetTile = tiles[targetIdx];
            let score = this.scoreLandingTile(player, targetTile, tiles, allPlayers, globalTurn);
            if (step > 0 && passedStart) {
                score += startBonus;
            }
            if ((diffCfg.landingScoreNoise || 0) > 0) {
                score += Math.round((Math.random() * 2 - 1) * diffCfg.landingScoreNoise);
            }
            if (score > bestScore) {
                bestScore = score;
                bestOpt = step;
            }
        });
        return bestOpt;
    },

    decideErpinDieValue(player, d1, d2, d3, baseDiceCount, tiles, allPlayers = [], globalTurn = 1) {
        const fixedOtherSum = (d1 === 1 ? (baseDiceCount >= 2 ? d2 : 0) : d1) + d3;
        const diffCfg = this.getDifficultyConfig(player);
        let bestVal = 6;
        let bestScore = -9999999;
        const startBonus = this.getExpectedStartBonus(player);

        for (let v = 1; v <= 6; v++) {
            const totalSteps = fixedOtherSum + v;
            const { pos: targetIdx, passedStart } = stepActiveBoardPos(player.pos, totalSteps, tiles);
            const targetTile = tiles[targetIdx];
            let score = this.scoreLandingTile(player, targetTile, tiles, allPlayers, globalTurn);
            if (passedStart) score += startBonus;
            if ((diffCfg.landingScoreNoise || 0) > 0) {
                score += Math.round((Math.random() * 2 - 1) * diffCfg.landingScoreNoise);
            }
            if (score > bestScore) {
                bestScore = score;
                bestVal = v;
            }
        }
        return bestVal;
    },

    // ==========================================
    // 6. 보드 특수 기믹 의사결정 (빵주 / 호수 / 정령산 / 제단 / 셰이디 / 윤회)
    // ==========================================
    decideBbangjuSupport(player) {
        const modeCfg = getModeConfig(getActiveWorld()?.gameMode);
        if (!modeCfg.enableBbangjuChief) return false;
        const diffCfg = this.getDifficultyConfig(player);
        const isBasic = modeCfg.id === 'basic';
        const marathonMin = isBasic ? 3000000 : 3800000;
        const defMin = isBasic ? 3450000 : 5100000;
        const probScale = diffCfg.bbangjuSupportProbScale ?? 1.0;
        if (player.aiType === 'marathon') return player.money >= marathonMin && Math.random() < Math.min(0.95, 0.60 * probScale);
        if (player.aiType === 'aggressive') return Math.random() < Math.min(0.90, 0.50 * probScale);
        return player.money >= defMin && Math.random() < Math.min(0.85, 0.30 * probScale);
    },

    decideBbangjuTakeover(player, reqCost) {
        if (player.money < reqCost) return false;
        const diffCfg = this.getDifficultyConfig(player);
        const resScale = diffCfg.specialReserveScale ?? 1.0;
        if (player.aiType === 'defensive') {
            return reqCost <= 2000000 && (player.money - reqCost) >= Math.round(700000 * resScale);
        }
        return (player.money - reqCost) >= Math.round(600000 * resScale);
    },

    decideLakeAction(ctx) {
        const { player, tiles = [], turnManager } = ctx;
        const globalTurn = turnManager ? turnManager.globalTurn : 1;
        const allPlayers = ctx.allPlayers || [];
        const lakeTile = tiles[BOARD_TILES.LAKE];
        const rollFee = lakeTile ? applySpecialTileTollModifiers(GAME_CONSTANTS.LAKE_ROLL_FEE, lakeTile, player) : GAME_CONSTANTS.LAKE_ROLL_FEE;
        const summonFee = lakeTile ? applySpecialTileTollModifiers(GAME_CONSTANTS.LAKE_SUMMON_FEE, lakeTile, player) : GAME_CONSTANTS.LAKE_SUMMON_FEE;

        if (player.aiType === 'aggressive') {
            if (player.money >= summonFee + 500000) {
                const targets = allPlayers
                    .filter(p => p !== player && !p.isBankrupt)
                    .sort((a, b) => this.evaluatePlayerThreat(b, tiles) - this.evaluatePlayerThreat(a, tiles));
                if (targets.length > 0 && this.evaluatePlayerThreat(targets[0], tiles) > 3000000) {
                    return { action: 'summon', target: targets[0] };
                }
            }
            if (player.money >= rollFee + 300000) return { action: 'roll', target: null };
            return { action: 'rest', target: null };
        }

        if (player.aiType === 'defensive') {
            if (globalTurn <= this.getMaxTurn() - 5 && !player.hasRegretState && !player.hasKarmaState && player.money >= rollFee + 650000) {
                return { action: 'roll', target: null };
            }
            return { action: 'rest', target: null };
        }

        // 운영형
        if (globalTurn <= this.getMaxTurn() - 5 && !player.hasRegretState && player.money >= rollFee + 500000) {
            return { action: 'roll', target: null };
        }
        return { action: 'rest', target: null };
    },

    decideLakeManualFurryOpen(player, allPlayers = [], globalTurn = 1) {
        if (!player || player.isBankrupt || globalTurn > this.getMaxTurn() - 3) return false;
        const margin = this.getSafetyMargin(player, globalTurn);
        const minRemain = player.aiType === 'aggressive'
            ? Math.max(300000, Math.round(margin * 0.6))
            : Math.max(500000, Math.round(margin * 0.75));
        return (player.money - GAME_CONSTANTS.FURRY_MANUAL_OPEN_FEE) >= minRemain;
    },

    decideMountainBuy(player, allPlayers = [], tiles = [], globalTurn = 1) {
        if (globalTurn >= this.getMaxTurn() - 1 || player.money < GAME_CONSTANTS.MOUNTAIN_FEE + 300000) return false;
        const diffCfg = this.getDifficultyConfig(player);
        const resScale = diffCfg.specialReserveScale ?? 1.0;
        const ownedNormal = tiles.filter(t => t.owner === player && t.type === 'normal');

        if (player.aiType === 'marathon') {
            const hasBase = ownedNormal.length >= 2 || ownedNormal.some(t => t.level >= 2 || t.isSpecialToll);
            return hasBase && player.money >= GAME_CONSTANTS.MOUNTAIN_FEE + Math.round(750000 * resScale);
        }
        if (player.aiType === 'aggressive') {
            const hasGoodLand = ownedNormal.length >= 2 || ownedNormal.some(t => t.level >= 2 || t.isSpecialToll);
            return hasGoodLand && player.money >= GAME_CONSTANTS.MOUNTAIN_FEE + Math.round(350000 * resScale);
        }
        if (player.aiType === 'defensive') {
            const hasBase = ownedNormal.length >= 2 || ownedNormal.some(t => t.level >= 2 || t.isSpecialToll);
            return hasBase && player.money >= GAME_CONSTANTS.MOUNTAIN_FEE + Math.round(550000 * resScale);
        }
        return false;
    },

    decideAltarTrade(player, allPlayers = [], globalTurn = 1) {
        if (!player.treasureCards || player.treasureCards.length === 0) return false;
        const myCount = player.treasureCards.length;
        const maxOtherCount = allPlayers
            .filter(op => op !== player && !op.isBankrupt)
            .reduce((max, op) => Math.max(max, op.treasureCards ? op.treasureCards.length : 0), 0);

        if (player.aiType === 'aggressive') {
            // 상대가 3장 이상으로 윤회 독식 위험이 크고 내가 뒤처졌으면 분기 1(윤회 저지) 유도
            if (maxOtherCount >= 3 && myCount < maxOtherCount) return true;
            return false;
        }

        if (player.aiType === 'defensive') {
            const allJunk = player.treasureCards.every(tc =>
                (tc.maxUses > 0 && tc.remainingUses === 0 && isTreasureDebuffActive(player, tc.id))
            );
            if (allJunk || player.money < 600000) return true;
            if (myCount >= 3 && maxOtherCount < 3) return false;
            if (myCount >= 2 && maxOtherCount <= myCount) return false;
            return maxOtherCount >= 2 || myCount < maxOtherCount;
        }

        // 운영형: 횟수가 다 닳고 부작용만 남은 카드 위주이거나 자금 극심한 위기 시 교환
        const allJunk = player.treasureCards.every(tc =>
            (tc.maxUses > 0 && tc.remainingUses === 0 && isTreasureDebuffActive(player, tc.id))
        );
        if (allJunk || (player.money < 300000 && globalTurn >= 10)) return true;
        if (maxOtherCount >= 4 && myCount <= 1) return true;
        return false;
    },

    decideShaydiTarget(player, targets, allPlayers = [], tiles = []) {
        if (!targets || targets.length === 0) return null;
        return [...targets].sort((a, b) => this.evaluatePlayerThreat(b, tiles) - this.evaluatePlayerThreat(a, tiles))[0];
    },

    decideWolfTarget(player, holders, allPlayers = [], tiles = []) {
        if (!holders || holders.length === 0) return null;
        return [...holders].sort((a, b) => {
            const countDiff = (b.treasureCards ? b.treasureCards.length : 0) - (a.treasureCards ? a.treasureCards.length : 0);
            if (countDiff !== 0) return countDiff;
            return this.evaluatePlayerThreat(b, tiles) - this.evaluatePlayerThreat(a, tiles);
        })[0];
    },

    decideReincarnationSkill(player, tiles = []) {
        const enemyOwned = tiles.filter(t => t.type === 'normal' && t.owner && t.owner !== player);
        if (enemyOwned.length === 0 || player.money <= 0) return false;
        const cost = Math.floor(player.money * GAME_CONSTANTS.REINCARNATION_SKILL_COST_RATE);
        const remain = player.money - cost;
        const lv2PlusCount = enemyOwned.filter(t => t.level >= 2).length;
        const lv2PlusRatio = lv2PlusCount / enemyOwned.length;
        const hasSpecial = enemyOwned.some(t => t.level >= 3 || t.isSpecialToll);

        if (player.aiType === 'aggressive') {
            return remain >= 150000 && (lv2PlusRatio >= 0.50 || (enemyOwned.length >= 2 && (lv2PlusCount >= 2 || hasSpecial)) || cost <= 600000);
        }
        if (player.aiType === 'defensive') {
            return remain >= 300000 && (lv2PlusRatio >= 0.50 || (lv2PlusCount >= 2 && hasSpecial));
        }
        // marathon (운영형)
        return remain >= 350000 && lv2PlusRatio >= 0.50 && (enemyOwned.length >= 2 || hasSpecial);
    },

    // ==========================================
    // 7. 마녀 도서관 3장 중 1장 선택 AI
    // ==========================================
    decideLibraryCardChoice(player, cards, ctx) {
        if (!cards || cards.length === 0) return null;
        const diffCfg = this.getDifficultyConfig(player);
        const tiles = ctx.tiles || [];
        const hasReincarnatedRival = this.hasReincarnatedRival(player);
        const isHaloBenefit = this.isHaloBeneficiary(player);

        const scoreCard = (c) => {
            if (c.id >= 500) return 2000;
            if (RequiemState.isSootState && !player.isReincarnated && (c.id === CARD_IDS.SPEC_JUDGMENT || c.id === CARD_IDS.SPEC_CULT_WISH)) {
                return hasReincarnatedRival ? 1950 : 1850;
            }
            if (c.id === CARD_IDS.SPEC_ODYSSEY) return 1750;
            if (c.id === CARD_IDS.SPEC_TAKE_DAYA) return 1550;
            if (c.id === CARD_IDS.SPEC_WOLF_STEAL) return 1350;
            if (c.id === CARD_IDS.SPEC_VVVIP) return 1200;
            if (c.id === CARD_IDS.SPEC_BBANGJU_INTRUDE || c.id === CARD_IDS.SPEC_TIME_ACCEL || c.id === CARD_IDS.SPEC_ERPIN_DICE) return 1150;
            if (c.id === CARD_IDS.SPEC_SMUGGLER_BADGE || c.id === CARD_IDS.SPEC_MOON_FLOWER || c.id === CARD_IDS.SPEC_ORIGIN_ELIF) return 1050;
            if (c.id === CARD_IDS.HONOR_CITIZEN_SUPPORT) {
                const cnt = tiles.filter(t => t.owner === player && t.type === 'normal').length;
                return (cnt >= 5 ? 1250 : 450) + (isHaloBenefit ? 250 : 0);
            }
            if (c.id === CARD_IDS.HOMELESS_SUPPORT) {
                const cnt = tiles.filter(t => t.owner === player && t.type === 'normal').length;
                return (cnt <= 3 ? 1250 : 450) + (isHaloBenefit ? 250 : 0);
            }
            if (c.id === CARD_IDS.PRAISE_FOR_YOU || c.id === CARD_IDS.FESTIVAL || c.id === CARD_IDS.GOLDIE_LOTTERY) {
                return 950 + (isHaloBenefit ? 250 : 0);
            }
            if (c.id === CARD_IDS.MAYO_DEAL || c.id === CARD_IDS.LANDMARK_CONTRACT || c.id === CARD_IDS.UPGRADE_CONTRACT || c.id === CARD_IDS.BUILD_CONTRACT) return 900;
            if (c.id === CARD_IDS.SIST_DEAL) return player.money >= 1500000 ? 600 : -300;
            if (c.id === CARD_IDS.TAX_LAND || c.id === CARD_IDS.TAX_BUILD || c.id === CARD_IDS.CREPE_CLEANING || c.id === CARD_IDS.RIOT || c.id === CARD_IDS.MOVE_VOLCANICA || c.id === CARD_IDS.MOVE_VOID) return -400;
            return 500;
        };

        const sorted = [...cards].sort((a, b) => scoreCard(b) - scoreCard(a));
        if (sorted.length >= 2 && (diffCfg.librarySuboptimalProb || 0) > 0 && Math.random() < diffCfg.librarySuboptimalProb) {
            return sorted[1];
        }
        return sorted[0];
    },

    // ==========================================
    // 8. 인벤토리/보물 액티브 카드 타겟 지정 AI
    // ==========================================
    _findTopThreatEnemy(player, allPlayers = [], tiles = []) {
        const rivals = allPlayers.filter(p => p && p !== player && !p.isBankrupt);
        if (rivals.length === 0) return null;
        rivals.sort((a, b) => this.evaluatePlayerThreat(b, tiles) - this.evaluatePlayerThreat(a, tiles));
        return rivals[0];
    },

    selectBestUpgradeTile(player, tiles, validFilter, preferLevelDesc = true, globalTurn = 1) {
        const upcomingTime = this.getUpcomingTimePhase(globalTurn);
        const candidates = tiles.filter(t => t.owner === player && t.type === 'normal' && validFilter(t));
        if (candidates.length === 0) return null;

        return [...candidates].sort((a, b) => {
            if (preferLevelDesc && b.level !== a.level) return b.level - a.level;
            if (!preferLevelDesc && a.level !== b.level) return a.level - b.level;
            const matchA = (a.isSpecialToll ? 30 : 0) + (upcomingTime !== 'none' && a.timeType === upcomingTime ? 20 : 0) + a.side * 10;
            const matchB = (b.isSpecialToll ? 30 : 0) + (upcomingTime !== 'none' && b.timeType === upcomingTime ? 20 : 0) + b.side * 10;
            return matchB - matchA;
        })[0];
    },

    selectGoldieSellTile(player, tiles) {
        const owned = tiles.filter(t => t.owner === player && t.type === 'normal');
        if (owned.length === 0) return null;
        return [...owned].sort((a, b) => {
            const valA = a.level * 1000000 + (a.isSpecialToll ? 3000000 : 0) + a.side * 200000;
            const valB = b.level * 1000000 + (b.isSpecialToll ? 3000000 : 0) + b.side * 200000;
            return valA - valB;
        })[0];
    },

    selectMayoTarget(player, tiles, allPlayers = [], globalTurn = 1) {
        const candidates = tiles.filter(t => t.owner && t.owner !== player && !t.owner.isBankrupt && t.type === 'normal' && t.level < 4);
        if (candidates.length === 0) return null;
        const diffCfg = this.getDifficultyConfig(player);
        const topRival = (diffCfg.leaderFocusBonus || 0) > 0 ? this._findTopThreatEnemy(player, allPlayers, tiles) : null;
        const margin = this.getSafetyMargin(player, globalTurn, tiles);
        const reqReserve = player.aiType === 'defensive' ? Math.round(margin * 0.60) : Math.round(margin * 0.5);

        const scored = candidates.map(t => {
            const cost = t.basePrice + Math.round(calculateToll(t, player) * 1.5);
            let futureVal = this.getTileSettlementValue(t) + (t.isSpecialToll ? 500000 : 0) + t.side * 100000;
            if (topRival && t.owner === topRival) {
                futureVal = Math.round(futureVal * (1 + diffCfg.leaderFocusBonus));
            }
            return { tile: t, cost, score: futureVal - cost };
        }).filter(item =>
            player.money >= item.cost + reqReserve &&
            (item.tile.level >= 2 || item.tile.isSpecialToll || item.tile.side >= 2)
        );

        if (scored.length === 0) return null;
        scored.sort((a, b) => b.score - a.score);
        return scored[0];
    },

    selectMariTargetPlayer(player, tiles, allPlayers = []) {
        const validEnemies = allPlayers.filter(enemy =>
            enemy !== player && !enemy.isBankrupt &&
            tiles.some(t => t.owner === enemy && t.type === 'normal' && t.level >= 1)
        );
        if (validEnemies.length === 0) return null;

        return [...validEnemies].sort((a, b) => {
            const highA = tiles.filter(t => t.owner === a && t.level >= 3).length;
            const highB = tiles.filter(t => t.owner === b && t.level >= 3).length;
            if (highB !== highA) return highB - highA;
            return this.evaluatePlayerThreat(b, tiles) - this.evaluatePlayerThreat(a, tiles);
        })[0];
    },

    selectReverseTimeTile(player, tiles, globalTurn = 1) {
        const targetPhase = this.getUpcomingTimePhase(globalTurn);
        if (targetPhase === 'none') return null;

        const candidates = tiles.filter(t =>
            t.owner === player && (t.timeType === 'day' || t.timeType === 'night') && t.timeType !== targetPhase
        );
        if (candidates.length === 0) return null;
        return [...candidates].sort((a, b) => calculateToll(b, player) - calculateToll(a, player))[0];
    },

    selectRopeTargetTile(player, tiles, allPlayers = []) {
        const enemies = allPlayers.filter(e =>
            e !== player && !e.isBankrupt &&
            tiles.some(t => t.owner === e && t.type === 'normal')
        );
        if (enemies.length === 0) return null;

        const diffCfg = this.getDifficultyConfig(player);
        const topRival = (diffCfg.leaderFocusBonus || 0) > 0 ? this._findTopThreatEnemy(player, allPlayers, tiles) : null;
        const candidates = tiles.filter(t => t.owner && t.owner !== player && !t.owner.isBankrupt && t.type === 'normal');
        candidates.sort((a, b) => {
            let scoreA = calculateToll(a, player) + (a.isSpecialToll ? 400000 : 0) + (a.level >= 3 ? 500000 : 0);
            let scoreB = calculateToll(b, player) + (b.isSpecialToll ? 400000 : 0) + (b.level >= 3 ? 500000 : 0);
            if (topRival && a.owner === topRival) scoreA = Math.round(scoreA * (1 + diffCfg.leaderFocusBonus));
            if (topRival && b.owner === topRival) scoreB = Math.round(scoreB * (1 + diffCfg.leaderFocusBonus));
            return scoreB - scoreA;
        });
        return candidates[0] || null;
    },

    selectStaffTargetTile(player, tiles, allPlayers = []) {
        const diffCfg = this.getDifficultyConfig(player);
        const topRival = (diffCfg.leaderFocusBonus || 0) > 0 ? this._findTopThreatEnemy(player, allPlayers, tiles) : null;
        const enemyTiles = tiles.filter(t => t.type === 'normal' && t.owner && t.owner !== player && !t.owner.isBankrupt);
        if (enemyTiles.length > 0) {
            return [...enemyTiles].sort((a, b) => {
                let scoreA = this.getTileSettlementValue(a) + (a.isSpecialToll ? 600000 : 0) + a.level * 300000;
                let scoreB = this.getTileSettlementValue(b) + (b.isSpecialToll ? 600000 : 0) + b.level * 300000;
                if (topRival && a.owner === topRival) scoreA = Math.round(scoreA * (1 + diffCfg.leaderFocusBonus));
                if (topRival && b.owner === topRival) scoreB = Math.round(scoreB * (1 + diffCfg.leaderFocusBonus));
                return scoreB - scoreA;
            })[0];
        }
        const emptyTiles = tiles.filter(t => t.type === 'normal' && !t.owner);
        if (emptyTiles.length > 0) {
            return [...emptyTiles].sort((a, b) => b.basePrice - a.basePrice)[0];
        }
        return null;
    },

    // ==========================================
    // 9. 턴 시작 시 인벤토리/보물 액티브 카드 통합 사용 결정
    // ==========================================
    decideUseCard(ctx) {
        const { player, tiles, allPlayers = [], turnManager } = ctx;
        const globalTurn = turnManager ? turnManager.globalTurn : 1;
        const inv = player.inventory || [];
        const treasures = player.treasureCards || [];
        const usableTreasures = treasures.filter(tc => tc.remainingUses > 0);
        if (inv.length === 0 && usableTreasures.length === 0) return null;

        const diffCfg = this.getDifficultyConfig(player);
        const tier = diffCfg.tacticalTier || 0;
        const maxTurn = this.getMaxTurn();
        const danger = this.evaluateDangerAhead(player, tiles, 1, 12);

        // 1. 볼케니카 탈출 카드 (수감 탈출은 난이도 확률 제한 없이 판단)
        if (player.islandTurns > 0) {
            const escapeCard = inv.find(c => c.id === CARD_IDS.NER_ESCAPE);
            if (escapeCard) {
                if (globalTurn <= Math.max(1, maxTurn - 5)) return escapeCard;
                if (danger.maxToll < (player.aiType === 'defensive' ? Math.max(1000000, player.money * 0.45) : 1200000)) return escapeCard;
            }
            // 볼케니카 수감 중에도 사용 가능한 견제/건설 카드만 제한적으로 판단
            const landmarkOnly = inv.find(c => c.id === CARD_IDS.LANDMARK_CONTRACT);
            if (landmarkOnly && this.selectBestUpgradeTile(player, tiles, t => t.level === 3, true, globalTurn)) {
                return landmarkOnly;
            }
            return null;
        }

        // 순한맛/매운맛은 전술 액티브 카드 발동 타이밍을 일정 확률로 놓침
        const cardUseProb = diffCfg.activeCardUseProb?.[player.aiType] ?? 1.0;
        if (cardUseProb < 1.0 && Math.random() > cardUseProb) {
            return null;
        }

        // 1.5 [51: 골디의 부동산명함] (대출 보유 시 사용: 오두막 이하면 즉시 사용, 2단계 이상이면 순자산 손익 비교 후 사용)
        const goldieRealtyCard = inv.find(c => c.id === CARD_IDS.GOLDIE_REALTY);
        const currentDebt = player.getTotalLoanDebt ? player.getTotalLoanDebt() : ((player.loanPrincipal || 0) + (player.loanInterest || 0));
        if (goldieRealtyCard && currentDebt > 0) {
            const ownedNormal = tiles.filter(t => t.owner === player && t.type === 'normal');
            const maxLevel = ownedNormal.reduce((mx, t) => Math.max(mx, t.level || 0), -1);
            if (maxLevel <= 1) {
                return goldieRealtyCard;
            }
            const topTiles = ownedNormal.filter(t => t.level === maxLevel);
            const avgTopLoss = topTiles.reduce((sum, t) => {
                const beforeInvest = t.basePrice + BUILDING_COSTS[t.side][t.level - 1];
                const afterLvl = Math.max(0, t.level - 2);
                const afterInvest = afterLvl === 0 ? t.basePrice : t.basePrice + BUILDING_COSTS[t.side][afterLvl - 1];
                const beforeVal = beforeInvest * (MULTIPLIERS.SETTLEMENT[t.level] || 1);
                const afterVal = afterInvest * (MULTIPLIERS.SETTLEMENT[afterLvl] || 1.0);
                return sum + Math.max(0, beforeVal - afterVal);
            }, 0) / Math.max(1, topTiles.length);
            const savedDebt = Math.round(currentDebt * 0.5);
            if (savedDebt >= avgTopLoss * 0.75 || globalTurn >= Math.max(1, this.getMaxTurn() - 2)) {
                return goldieRealtyCard;
            }
        }

        // 2. [110: 시간가속] (낮/밤 진행 중: 유리할 때 2회 굴림 극대화 또는 상대 유리 시간대 단축)
        const timeAccel = inv.find(c => c.id === CARD_IDS.SPEC_TIME_ACCEL);
        const activeGimmick = WorldGimmickManager.getActiveGimmickType();
        if (timeAccel && (activeGimmick === 'day' || activeGimmick === 'night')) {
            let myScore = 0, enemyScore = 0;
            tiles.forEach(t => {
                if (t.owner && t.type === 'normal' && t.timeType === activeGimmick) {
                    const val = t.basePrice * (t.level + 1);
                    if (t.owner === player) myScore += val;
                    else enemyScore += val;
                }
            });
            if (myScore >= enemyScore || (enemyScore - myScore) >= 800000) {
                return timeAccel;
            }
        }

        // 3. [505: ???의 밧줄] (1회 강제 매각)
        const ropeCard = usableTreasures.find(tc => tc.id === CARD_IDS.TREASURE_ROPE);
        if (ropeCard) {
            const target = this.selectRopeTargetTile(player, tiles, allPlayers);
            if (target && (target.level >= 2 || target.isSpecialToll || globalTurn >= Math.max(1, maxTurn - 5))) {
                return ropeCard;
            }
        }

        // 4. [506: ???의 지팡이] (1회 무상 강탈)
        const staffCard = usableTreasures.find(tc => tc.id === CARD_IDS.TREASURE_STAFF);
        if (staffCard) {
            const target = this.selectStaffTargetTile(player, tiles, allPlayers);
            if (target && ((target.owner && (target.level >= 2 || target.isSpecialToll)) || globalTurn >= Math.max(1, maxTurn - 5))) {
                return staffCard;
            }
        }

        // 5. [47: 마요의 암거래] (후회·죄업 방어형과 그을음 0.5배 구간에서는 과지출 억제)
        const mayoCard = inv.find(c => c.id === CARD_IDS.MAYO_DEAL);
        const allowMayo = player.aiType !== 'defensive'
            ? !(RequiemState.isSootState && !player.isReincarnated && !this.hasReincarnatedRival(player))
            : (player.money >= 1300000 && !player.hasRegretState);
        if (mayoCard && allowMayo) {
            if (this.selectMayoTarget(player, tiles, allPlayers, globalTurn)) {
                return mayoCard;
            }
        }

        // 6. [48: 마리의 스위치]
        const mariCard = inv.find(c => c.id === CARD_IDS.MARI_SWITCH);
        if (mariCard) {
            const targetEnemy = this.selectMariTargetPlayer(player, tiles, allPlayers);
            if (targetEnemy) {
                const hasHighThreat = tiles.some(t => t.owner === targetEnemy && (t.level >= 2 || t.isSpecialToll));
                if (player.aiType !== 'defensive' || hasHighThreat || globalTurn >= Math.ceil(maxTurn * 0.5)) {
                    return mariCard;
                }
            }
        }

        // 7. 무료 건설·증축 계약서 (엘드르 > 증축 > 건축)
        const landmarkCard = inv.find(c => c.id === CARD_IDS.LANDMARK_CONTRACT);
        if (landmarkCard && this.selectBestUpgradeTile(player, tiles, t => t.level === 3, true, globalTurn)) {
            return landmarkCard;
        }
        const upgradeCard = inv.find(c => c.id === CARD_IDS.UPGRADE_CONTRACT);
        if (upgradeCard && this.selectBestUpgradeTile(player, tiles, t => t.level === 1 || t.level === 2, true, globalTurn)) {
            return upgradeCard;
        }
        const buildCard = inv.find(c => c.id === CARD_IDS.BUILD_CONTRACT);
        if (buildCard && this.selectBestUpgradeTile(player, tiles, t => t.level < 2, false, globalTurn)) {
            return buildCard;
        }

        // 8. [49: 주야역전]
        const revCard = inv.find(c => c.id === CARD_IDS.REVERSE_TIME);
        if (revCard && this.selectReverseTimeTile(player, tiles, globalTurn)) {
            return revCard;
        }

        // 9. [504: ???의 수의] (1~6칸 중 고이득 착지 또는 고위험 회피)
        const shroudCard = usableTreasures.find(tc => tc.id === CARD_IDS.TREASURE_SHROUD);
        if (shroudCard && player.restTurns === 0) {
            const bestStep = this.decideRelativeMoveCard(player, [1, 2, 3, 4, 5, 6], tiles, allPlayers, globalTurn);
            const { pos: targetIdx, passedStart } = stepActiveBoardPos(player.pos, bestStep, tiles);
            const targetTile = tiles[targetIdx];
            let bestScore = this.scoreLandingTile(player, targetTile, tiles, allPlayers, globalTurn);
            if (passedStart) bestScore += this.getExpectedStartBonus(player);

            const dangerNear = this.evaluateDangerAhead(player, tiles, 2, 7);
            const evadeByTier = tier >= 2 ? 320000 : (tier >= 1 ? 380000 : 500000);
            const baseEvadeThreshold = (this.hasReincarnatedRival(player) || player.hasRegretState) ? Math.min(350000, evadeByTier) : evadeByTier;
            if (bestScore >= 350000 || (dangerNear.maxToll >= baseEvadeThreshold && bestScore > -100000)) {
                return shroudCard;
            }
        }

        // 10. [50: 루포의 주사위] (전방 1~6칸 위험 회피 or 고효율 점프)
        const rufoCard = inv.find(c => c.id === CARD_IDS.RUFO_DICE);
        if (rufoCard && !player.hasRufoDiceBuff) {
            const dangerNear = this.evaluateDangerAhead(player, tiles, 2, 7);
            const rufoByTier = tier >= 2 ? 250000 : (tier >= 1 ? 300000 : 400000);
            const rufoTollThreshold = (this.hasReincarnatedRival(player) || player.hasRegretState) ? Math.min(320000, rufoByTier) : rufoByTier;
            if (dangerNear.dangerCount >= 1 && dangerNear.maxToll >= rufoTollThreshold) {
                return rufoCard;
            }
            const farBestStep = this.decideRelativeMoveCard(player, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], tiles, allPlayers, globalTurn);
            const { pos: farTargetIdx } = stepActiveBoardPos(player.pos, farBestStep, tiles);
            const farScore = this.scoreLandingTile(player, tiles[farTargetIdx], tiles, allPlayers, globalTurn);
            if (farScore >= 550000) return rufoCard;
        }

        // 11. [46: 골디의 제안] (초중반 현금 부족 시 저열/저단계 매각, 후반 19~20턴 절대 금지)
        const goldieCard = inv.find(c => c.id === CARD_IDS.GOLDIE_PROPOSAL);
        if (goldieCard && globalTurn <= Math.max(1, this.getMaxTurn() - 2)) {
            const sellCandidate = this.selectGoldieSellTile(player, tiles);
            if (sellCandidate && (player.money < 400000 || (sellCandidate.side <= 1 && sellCandidate.level <= 1 && player.money < 800000))) {
                return goldieCard;
            }
        }

        return null;
    },

    // ==========================================
    // 9. 망가진 제단 2회차+ 방문 시 차원열쇠카드 칸 선택
    // ==========================================
    decideAltarCardPortal(player, tiles, allPlayers = [], globalTurn = 1) {
        const startBonus = this.getExpectedStartBonus(player);
        let bestId = CARD_TILE_IDS[0];
        let bestScore = -Infinity;

        const prevPos = player.pos;
        for (const tid of CARD_TILE_IDS) {
            const tile = tiles[tid];
            if (!tile) continue;
            let score = this.scoreLandingTile(player, tile, tiles, allPlayers, globalTurn);
            if ((tid < prevPos || tid === BOARD_TILES.START) && tid !== prevPos) {
                score += startBonus;
            }
            // 착지 후 전방 2~7칸 고위험 통행료 구간을 약간 반영해 안정적인 차원카드 칸 우선
            let nextThreat;
            try {
                player.pos = tid;
                nextThreat = this.evaluateDangerAhead(player, tiles, 2, 7);
            } finally {
                player.pos = prevPos;
            }
            score -= Math.round((nextThreat?.maxToll || 0) * 0.15);
            if (score > bestScore) {
                bestScore = score;
                bestId = tid;
            }
        }
        return bestId;
    },

    // ==========================================
    // 10. 잠수·이탈 유저 대체 AI 성향 자동 결정 (현금·영토·특수카드·버프 종합)
    // ==========================================
    chooseReplacementAiArchetype(player, tiles = []) {
        if (!player) return 'aggressive';
        const money = Number(player.money) || 0;
        const ownedNormal = tiles.filter(t => t.owner === player && t.type === 'normal');
        const highTierCount = ownedNormal.filter(t => t.level >= 3).length;
        const specialTollCount = ownedNormal.filter(t => t.isSpecialToll).length;
        const ownedSpecialCount = tiles.filter(t => t.owner === player && t.type !== 'normal').length;
        const ownsDaya = tiles[BOARD_TILES.DAYA]?.owner === player;
        const ownsTheater = tiles[BOARD_TILES.THEATER]?.owner === player;
        const ownsLake = tiles[BOARD_TILES.LAKE]?.owner === player;

        const inv = Array.isArray(player.inventory) ? player.inventory : [];
        const treasures = Array.isArray(player.treasureCards) ? player.treasureCards : [];
        const buffEntries = player.buffs ? Object.values(player.buffs).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0) : 0;

        const offensiveCardIds = new Set([
            CARD_IDS.MAYO_DEAL,
            CARD_IDS.MARI_SWITCH,
            CARD_IDS.LANDMARK_CONTRACT,
            CARD_IDS.UPGRADE_CONTRACT,
            CARD_IDS.RUFO_DICE
        ]);
        const offensiveCardCount = inv.filter(c => offensiveCardIds.has(c.id)).length;

        let aggressiveScore = 0;
        aggressiveScore += money >= 3500000 ? 35 : (money >= 2000000 ? 18 : 0);
        aggressiveScore += highTierCount * 15 + specialTollCount * 14;
        aggressiveScore += (ownsDaya ? 18 : 0) + (ownsTheater ? 8 : 0);
        aggressiveScore += treasures.length * 8 + offensiveCardCount * 8;
        aggressiveScore += (player.hasErpinDiceBuff || player.hasRufoDiceBuff) ? 10 : 0;
        aggressiveScore += player.hasSistDiscountBuff ? 12 : 0;
        if (player.loanCount > 0) aggressiveScore -= 25 * player.loanCount;
        if (money < 1200000) aggressiveScore -= 20;

        let defensiveScore = 0;
        defensiveScore += player.loanCount * 30;
        defensiveScore += money < 1500000 ? 28 : (money < 2500000 ? 10 : 0);
        defensiveScore += ownedNormal.length <= 2 ? 18 : 0;
        defensiveScore += highTierCount === 0 ? 10 : 0;
        defensiveScore += (player.hasVipShield ? 15 : 0) + (ownsLake ? 10 : 0) + Math.min(buffEntries, 4) * 5;
        if (money >= 5000000 && player.loanCount === 0) defensiveScore -= 15;

        let marathonScore = 5;
        marathonScore += ownedNormal.length * 9 + ownedSpecialCount * 14;
        marathonScore += (player.isBbangjuChief ? 22 : 0);
        marathonScore += (player.hasMountainBuff ? 16 : 0) + (player.hasOriginElif ? 20 : 0) + (player.hasLibraryBuff ? 12 : 0);
        marathonScore += inv.length * 6 + treasures.length * 6 + Math.min(buffEntries, 4) * 5;
        if (money >= 1500000 && money < 4500000) marathonScore += 14;

        const candidates = [
            { type: 'aggressive', score: aggressiveScore },
            { type: 'defensive', score: defensiveScore },
            { type: 'marathon', score: marathonScore }
        ];
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0].type;
    },

    // ==========================================
    // 8. 게이지 주사위(Soft-Weighted 2d6) 기대값 최적화 (핵불맛 3단 / 마그맛 5단)
    // ==========================================
    decideDicePower(ctx) {
        const {
            player,
            tiles = [],
            allPlayers = [],
            turnManager = null,
            diceCount = 2,
            hasRufoDiceBuff = false,
            computeDiceTable = null
        } = ctx || {};
        const defaultPower = GAME_CONSTANTS.DICE_GAUGE_DEFAULT_POWER ?? 50;
        const diffCfg = this.getDifficultyConfig(player);
        const candidates = diffCfg?.diceGaugePowers;
        if (!Array.isArray(candidates) || candidates.length === 0 || typeof computeDiceTable !== 'function') {
            return defaultPower;
        }
        if (!player || player.restTurns > 0 || player.islandTurns > 0 || !Array.isArray(tiles) || tiles.length === 0) {
            return defaultPower;
        }

        const globalTurn = turnManager ? turnManager.globalTurn : 1;
        const startBonus = this.getExpectedStartBonus(player);
        const d3Offset = hasRufoDiceBuff ? 6 : 0;
        const tier = diffCfg.tacticalTier || 0;

        const stepScoreCache = new Map();
        const getStepScore = (steps) => {
            if (stepScoreCache.has(steps)) return stepScoreCache.get(steps);
            const { pos: targetIdx, passedStart } = stepActiveBoardPos(player.pos, steps, tiles);
            const targetTile = tiles[targetIdx];
            let score = targetTile ? this.scoreLandingTile(player, targetTile, tiles, allPlayers, globalTurn) : 0;
            if (passedStart) score += startBonus;
            // 마그맛(tacticalTier >= 2): 착지 후 다음 턴 2~12칸 전방 최대 통행료 위협까지 경량 선행 감점
            if (tier >= 2 && targetTile) {
                const prevPos = player.pos;
                let nextThreat;
                try {
                    player.pos = targetTile.id;
                    nextThreat = this.evaluateDangerAhead(player, tiles, 2, 12);
                } finally {
                    player.pos = prevPos;
                }
                score -= Math.round((nextThreat?.maxToll || 0) * 0.08);
            }
            stepScoreCache.set(steps, score);
            return score;
        };

        let bestPower = defaultPower;
        let bestEV = -Infinity;
        for (const power of candidates) {
            const table = computeDiceTable(diceCount, power);
            if (!table?.stepProbs) continue;
            let ev = 0;
            for (const [sum, prob] of table.stepProbs.entries()) {
                ev += prob * getStepScore(sum + d3Offset);
            }
            if (ev > bestEV) {
                bestEV = ev;
                bestPower = power;
            }
        }
        return bestPower;
    }
};
