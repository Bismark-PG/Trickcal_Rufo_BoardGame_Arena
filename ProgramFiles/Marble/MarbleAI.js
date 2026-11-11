import { GAME_CONSTANTS, BUILDING_COSTS, MULTIPLIERS } from '../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';
import { calculateToll, applySpecialTileTollModifiers, getTileSellValue } from './MarbleLogic.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import {
    RequiemState,
    canPlayerUseBbangju,
    getPositiveEffectMultiplier
} from './MarbleRequiem.js';
import { isTreasureDebuffActive, isBowVillageForced } from './MarbleCardTreasure.js';

export const AIManager = {
    // ==========================================
    // 0. 공통 상황 평가 헬퍼 (내부/공용)
    // ==========================================
    getTurnPhase(globalTurn = 1) {
        if (globalTurn <= 7) return 'early';
        if (globalTurn <= 14) return 'mid';
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
        const hasSmuggler = player.buffs && player.buffs['hold_start_buff'] && player.buffs['hold_start_buff'].length > 0;
        const baseBonus = hasSmuggler ? Math.round(GAME_CONSTANTS.START_BONUS * 1.5) : GAME_CONSTANTS.START_BONUS;
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
        if (globalTurn >= 8 && globalTurn < GAME_CONSTANTS.TIME_DAY_START_TURN) return 'day';
        return 'none';
    },

    evaluatePlayerThreat(target, tiles = []) {
        if (!target || target.isBankrupt) return -99999999;
        let score = target.money - (target.loanPrincipal + target.loanInterest);
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
            const tile = tiles[(player.pos + step) % 40];
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
        let baseMargin = 500000;

        if (player.aiType === 'aggressive') {
            baseMargin = phase === 'mid' ? 500000 : 300000;
        } else if (player.aiType === 'defensive') {
            baseMargin = phase === 'early' ? 1200000 : (phase === 'mid' ? 1500000 : 1000000);
        } else if (player.aiType === 'marathon') {
            baseMargin = phase === 'early' ? 600000 : (phase === 'mid' ? 800000 : 500000);
        }

        // [그을음] 0.5배 매입/건설 할인 기간에는 공격적/운영형 기준 완화
        if (RequiemState.isSootState && !player.isReincarnated) {
            baseMargin = Math.round(baseMargin * (player.aiType === 'defensive' ? 0.85 : 0.5));
        }

        // 전방 위험 통행료 보정 (18턴 이후 막판 올인 제외)
        if (tiles && tiles.length >= 40 && globalTurn <= 17) {
            const { maxToll } = this.evaluateDangerAhead(player, tiles, 2, 12);
            if (player.aiType === 'defensive' && maxToll > baseMargin) {
                baseMargin = Math.min(2000000, Math.round(maxToll * 0.8));
            } else if (player.aiType === 'marathon' && maxToll > baseMargin) {
                baseMargin = Math.min(1200000, Math.round(maxToll * 0.5));
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
        if (player.aiType === 'defensive') {
            if (globalTurn <= 15 && cheapest.level <= 1 && cheapest.side <= 1) {
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
            if (globalTurn >= 19 && cheapest.level === 0 && getTileSellValue(cheapest) > emergencyLoanAmount) {
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

        const allLowTier = picked.every(t => t.level <= 1 && !t.isSpecialToll);
        const allEmpty = picked.every(t => t.level === 0 && !t.isSpecialToll);

        if (player.aiType === 'defensive' && allLowTier) {
            return { action: 'sell', tiles: picked };
        }
        if (player.aiType === 'marathon' && allEmpty) {
            return { action: 'sell', tiles: picked };
        }
        if (player.aiType === 'aggressive' && globalTurn >= 19 && allEmpty) {
            return { action: 'sell', tiles: picked };
        }

        return { action: 'loan', tiles: [] };
    },

    // ==========================================
    // 3. 일반/특수 영토 매입·건설 및 시스트 할인 판단
    // ==========================================
    shouldUseSistDiscount(player, tile, targetLevel, rawCost) {
        if (!player.inventory || targetLevel < 0 || tile.type !== 'normal') return false;
        if (!player.inventory.some(c => c.id === CARD_IDS.SIST_DEAL)) return false;

        // 100만 이상 지출 시 50만+ 절약되므로 즉시 사용, 혹은 현재 현금이 정가는 부족하고 50% 할인가로 구매 가능할 때 사용
        if (rawCost >= 1000000) return true;
        const halfCost = Math.round(rawCost * 0.5);
        if (player.money < rawCost && player.money >= halfCost + 100000) return true;
        return false;
    },

    decidePurchase(ctx) {
        const { player, tile, tiles, calcCosts, turnManager } = ctx;
        const globalTurn = turnManager ? turnManager.globalTurn : 1;
        const currentMoney = player.money;
        const safetyMargin = this.getSafetyMargin(player, globalTurn, tiles);
        const maxAllowedLvl = tile.level < 2 ? 2 : (tile.level === 2 ? 3 : 4);
        const minLvl = (!tile.owner && tile.type === 'normal' && isBowVillageForced(player)) ? 2 : 0;

        const hasSist = player.inventory && player.inventory.some(c => c.id === CARD_IDS.SIST_DEAL);
        const getEffCost = (lvl) => {
            const raw = calcCosts[lvl];
            if (hasSist && raw >= 1000000) return Math.round(raw * 0.5);
            return raw;
        };

        if (player.aiType === 'aggressive') {
            const highValueSpot = tile.isSpecialToll || tile.side >= 2 || RequiemState.isSootState || globalTurn >= 14;
            const effMargin = highValueSpot ? Math.min(safetyMargin, 200000) : safetyMargin;

            for (let lvl = maxAllowedLvl; lvl >= minLvl; lvl--) {
                if (tile.level >= lvl) continue;
                // 1열 일반 땅은 자금이 아주 넉넉하지 않으면 조각상(100만) 과투자 억제
                if (lvl === 4 && tile.side === 0 && !tile.isSpecialToll && currentMoney < getEffCost(lvl) + 1200000) {
                    continue;
                }
                const cost = getEffCost(lvl);
                if (currentMoney - cost >= effMargin || (tile.isSpecialToll && currentMoney >= cost + 150000)) {
                    return lvl;
                }
            }
            return -1;
        }

        if (player.aiType === 'defensive') {
            const reqReserve = tile.level >= 2 ? (safetyMargin + 400000) : safetyMargin;
            const maxWantedLvl = maxAllowedLvl;
            for (let lvl = maxWantedLvl; lvl >= minLvl; lvl--) {
                if (tile.level >= lvl) continue;
                const cost = getEffCost(lvl);
                if (currentMoney - cost >= reqReserve) {
                    return lvl;
                }
            }
            return -1;
        }

        if (player.aiType === 'marathon') {
            const upcomingTime = this.getUpcomingTimePhase(globalTurn);
            const isTimeMatch = upcomingTime !== 'none' && tile.timeType === upcomingTime;
            const isPriorityTile = tile.isSpecialToll || isTimeMatch || tile.level >= 2 || tile.side >= 2;
            const effMargin = isPriorityTile ? Math.round(safetyMargin * 0.7) : safetyMargin;

            // 이미 건물(Lv.2~3)이 있거나 고가치 구역이면 최고 허용 단계까지 적극 증축
            if (tile.level >= 2 || tile.isSpecialToll || tile.side >= 2) {
                for (let lvl = maxAllowedLvl; lvl >= minLvl; lvl--) {
                    if (tile.level >= lvl) continue;
                    if (currentMoney - getEffCost(lvl) >= effMargin) return lvl;
                }
                return -1;
            }

            // 1~2열 일반 땅은 2단계(마을) > 1단계(오두막) 순으로 균형 투자
            const prefOrder = tile.level < 2 ? [2, 1, 0] : [maxAllowedLvl];
            for (const lvl of prefOrder) {
                if (lvl < minLvl || lvl > maxAllowedLvl || tile.level >= lvl) continue;
                if (currentMoney - getEffCost(lvl) >= effMargin) return lvl;
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
        const type = player.aiType;

        if (tile.id === BOARD_TILES.THEATER) {
            if (!tile.owner && globalTurn <= 18) {
                const reqReserve = type === 'defensive' ? 600000 : 250000;
                return money - GAME_CONSTANTS.THEATER_BUY >= reqReserve ? 'buy' : 'skip';
            }
            if (tile.owner && tile.owner !== player && globalTurn <= 17) {
                const reqReserve = type === 'defensive' ? margin : Math.round(margin * 0.4);
                return money - GAME_CONSTANTS.THEATER_TAKE >= reqReserve ? 'takeover' : 'skip';
            }
            return 'skip';
        }

        if (tile.id === BOARD_TILES.MONATIUM_25) {
            if (!tile.owner && globalTurn <= 17) {
                return money - GAME_CONSTANTS.MONATIUM_BUY >= Math.round(margin * 0.5) ? 'buy' : 'skip';
            }
            if (tile.owner === player && tile.level < 2) {
                const expCost = tile.level === 0 ? GAME_CONSTANTS.MONATIUM_EXPAND_1 : GAME_CONSTANTS.MONATIUM_EXPAND_2;
                const turnLimit = tile.level === 0 ? 15 : 13;
                if (globalTurn > turnLimit) return 'skip';
                if (tile.level === 1 && type === 'defensive' && money < 2800000) return 'skip';
                const reqReserve = type === 'defensive' ? margin : Math.round(margin * 0.65);
                return money - expCost >= reqReserve ? 'expand' : 'skip';
            }
            return 'skip';
        }

        if (tile.id === BOARD_TILES.LAKE) {
            if (!tile.owner && globalTurn <= 16) {
                const mult = type === 'defensive' ? 0.9 : 0.5;
                return money - GAME_CONSTANTS.LAKE_BUY >= Math.round(margin * mult) ? 'buy' : 'skip';
            }
            return 'skip';
        }

        if (tile.id === BOARD_TILES.LIBRARY) {
            if (!tile.owner && globalTurn <= 16) {
                const mult = type === 'defensive' ? 1.0 : (type === 'marathon' ? 0.35 : 0.5);
                return money - GAME_CONSTANTS.LIBRARY_BUY >= Math.round(margin * mult) ? 'buy' : 'skip';
            }
            if (tile.owner && tile.owner !== player && mode === 'ability' && !player.hasLibraryBuff) {
                if (player.inventory && player.inventory.some(c => c.id === CARD_IDS.LIBRARY_ASSIST)) {
                    return 'use_assist';
                }
                if (globalTurn <= 15 && type !== 'defensive') {
                    const toll = applySpecialTileTollModifiers(GAME_CONSTANTS.TOLL_LIBRARY, tile, player);
                    if (money - toll >= 1000000) return 'buy_ability';
                }
            }
            return 'skip';
        }

        if (tile.id === BOARD_TILES.DAYA) {
            if (!tile.owner && globalTurn <= 18) {
                if (type === 'defensive' && this.hasTileImmunity(player, BOARD_TILES.DAYA) && money < 2500000) {
                    return 'skip';
                }
                const reqReserve = type === 'defensive' ? 1000000 : 300000;
                return money - GAME_CONSTANTS.DAYA_BUY >= reqReserve ? 'buy' : 'skip';
            }
            if (tile.owner && tile.owner !== player && mode === 'takeover' && globalTurn <= 15) {
                const reqReserve = type === 'defensive' ? 1300000 : Math.round(margin * 0.5);
                return money - GAME_CONSTANTS.DAYA_TAKE >= reqReserve ? 'takeover' : 'skip';
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
            const riskMult = type === 'defensive' ? 1.5 : 1.1;
            let penalty = -Math.round(toll * riskMult);
            if (money < toll) penalty -= 2000000;
            return penalty;
        }

        // 2. 본인 소유 타일 도착 시
        if (tile.owner === player) {
            if (tile.type === 'normal' && tile.level < 4) {
                const nextLvl = tile.level < 2 ? 2 : tile.level + 1;
                const upgCost = tile.level === 0
                    ? BUILDING_COSTS[tile.side][nextLvl - 1]
                    : (nextLvl === 4 ? BUILDING_COSTS[tile.side][3] : BUILDING_COSTS[tile.side][nextLvl - 1] * 0.5);
                if (money >= upgCost + margin * 0.5) {
                    let bonus = 260000 + tile.side * 60000;
                    if (tile.isSpecialToll) bonus += 200000;
                    if (upcomingTime !== 'none' && tile.timeType === upcomingTime) bonus += 150000;
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
            const minCost = isBowVillageForced(player)
                ? tile.basePrice + BUILDING_COSTS[tile.side][1]
                : tile.basePrice;
            if (money >= minCost + margin * 0.4) {
                let score = 200000 + tile.side * 80000;
                if (tile.isSpecialToll) score += 350000;
                if (upcomingTime !== 'none' && tile.timeType === upcomingTime) score += 120000;
                if (RequiemState.isSootState && !player.isReincarnated) score += 220000;
                return score;
            }
            return 10000;
        }

        if (tile.id === BOARD_TILES.DAYA && globalTurn <= 18 && money >= GAME_CONSTANTS.DAYA_BUY + 300000) {
            return type === 'defensive' ? 500000 : 950000;
        }
        if (tile.id === BOARD_TILES.THEATER && globalTurn <= 18 && money >= GAME_CONSTANTS.THEATER_BUY + 250000) {
            return 550000;
        }
        if (tile.id === BOARD_TILES.MONATIUM_25 && globalTurn <= 17 && money >= GAME_CONSTANTS.MONATIUM_BUY + 300000) {
            return 450000;
        }
        if (tile.id === BOARD_TILES.LIBRARY && globalTurn <= 16 && money >= GAME_CONSTANTS.LIBRARY_BUY + 350000) {
            return type === 'marathon' ? 700000 : 500000;
        }
        if (tile.id === BOARD_TILES.LAKE && globalTurn <= 16 && money >= GAME_CONSTANTS.LAKE_BUY + 350000) {
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
            if (!player.hasVisitedAltar && !RequiemState.hasSootEverTriggered) return 480000;
            if (player.treasureCards && player.treasureCards.length > 0 && this.decideAltarTrade(player, allPlayers, globalTurn)) {
                return 350000;
            }
            return 0;
        }
        if (tile.id === BOARD_TILES.BBANGJU) {
            if (globalTurn < 4) {
                const reqCost = player.bbangjuPaidTotal > 0 ? GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE - player.bbangjuPaidTotal : GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE;
                return this.decideBbangjuTakeover(player, reqCost) ? 600000 : 10000;
            }
            return canPlayerUseBbangju(player) ? 320000 : 0;
        }
        if (tile.id === BOARD_TILES.VOLCANICA) {
            return globalTurn >= 16 && type === 'defensive' ? -100000 : -600000;
        }
        if (tile.id === BOARD_TILES.VOID) {
            const hasRim = player.buffs && ((player.buffs['hold_shaydi'] && player.buffs['hold_shaydi'].length > 0) || (player.buffs['todo_hold_shaydi'] && player.buffs['todo_hold_shaydi'].length > 0));
            const hasEvent = player.buffs && ((player.buffs['hold_event'] && player.buffs['hold_event'].length > 0) || (player.buffs['todo_hold_event'] && player.buffs['todo_hold_event'].length > 0));
            if (hasRim && hasEvent) return 400000;
            if (hasRim) return 40000;
            return -500000;
        }
        if (tile.type === 'card') {
            if (RequiemState.isSootState && !player.isReincarnated) return 600000; // 심판/염원 탐색
            if (player.hasLibraryBuff || tiles[BOARD_TILES.LIBRARY]?.owner === player) return 450000;
            return 280000;
        }

        return 0;
    },

    decidePortalDestination(ctx, isFreeCard = false) {
        const { player, tiles, allPlayers, turnManager } = ctx;
        const globalTurn = turnManager ? turnManager.globalTurn : 1;

        let reqMoney = 0;
        if (!isFreeCard) {
            if (!canPlayerUseBbangju(player)) return -1;
            const chiefs = WorldGimmickManager.bbangjuChiefs.length === 4 ? [] : WorldGimmickManager.bbangjuChiefs;
            const isFree = player.isBbangjuChief;
            const hasResearcher = player.buffs && ((player.buffs['hold_bbangju'] && player.buffs['hold_bbangju'].length > 0) || (player.buffs['todo_hold_bbangju'] && player.buffs['todo_hold_bbangju'].length > 0));
            const baseFee = (isFree || hasResearcher) ? 0 : GAME_CONSTANTS.BBANGJU_BASE_FEE;
            const chiefFee = (!isFree && chiefs.length > 0) ? GAME_CONSTANTS.BBANGJU_CHIEF_FEE : 0;
            reqMoney = baseFee + chiefFee;
            if (player.money < reqMoney) return -1;
        }

        const startBonus = this.getExpectedStartBonus(player);
        let bestId = -1;
        let bestScore = -9999999;

        tiles.forEach(tile => {
            if (isFreeCard) {
                if (tile.type === 'card' || tile.id === player.pos) return;
            } else {
                if (tile.id === BOARD_TILES.BBANGJU) return;
            }

            let score = this.scoreLandingTile(player, tile, tiles, allPlayers, globalTurn);
            if (tile.id < player.pos || tile.id === BOARD_TILES.START) {
                score += startBonus;
            }
            if (score > bestScore) {
                bestScore = score;
                bestId = tile.id;
            }
        });

        if (!isFreeCard && bestScore < (reqMoney > 0 ? Math.max(120000, reqMoney * 1.2) : 50000)) {
            return -1;
        }
        return bestId;
    },

    decideRelativeMoveCard(player, options, tiles, allPlayers = [], globalTurn = 1) {
        if (!options || options.length === 0) return 1;
        let bestOpt = options[0];
        let bestScore = -9999999;
        const startBonus = this.getExpectedStartBonus(player);

        options.forEach(step => {
            const targetIdx = (player.pos + step + 40) % 40;
            const targetTile = tiles[targetIdx];
            let score = this.scoreLandingTile(player, targetTile, tiles, allPlayers, globalTurn);
            if (step > 0 && (player.pos + step) >= 40) {
                score += startBonus;
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
        let bestVal = 6;
        let bestScore = -9999999;
        const startBonus = this.getExpectedStartBonus(player);

        for (let v = 1; v <= 6; v++) {
            const totalSteps = fixedOtherSum + v;
            const targetIdx = (player.pos + totalSteps) % 40;
            const targetTile = tiles[targetIdx];
            let score = this.scoreLandingTile(player, targetTile, tiles, allPlayers, globalTurn);
            if (player.pos + totalSteps >= 40) score += startBonus;
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
        if (player.aiType === 'marathon') return Math.random() < 0.75;
        if (player.aiType === 'aggressive') return Math.random() < 0.50;
        return false;
    },

    decideBbangjuTakeover(player, reqCost) {
        if (player.money < reqCost) return false;
        if (player.aiType === 'defensive') {
            return reqCost < 2000000 && (player.money - reqCost) >= 1500000;
        }
        return (player.money - reqCost) >= 600000;
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
            if (globalTurn <= 12 && !RequiemState.isSootState && !player.hasRegretState && player.money >= rollFee + 1600000) {
                return { action: 'roll', target: null };
            }
            return { action: 'rest', target: null };
        }

        // 운영형
        if (globalTurn <= 15 && player.money >= rollFee + 500000) {
            return { action: 'roll', target: null };
        }
        return { action: 'rest', target: null };
    },

    decideMountainBuy(player, allPlayers = [], tiles = [], globalTurn = 1) {
        if (globalTurn >= 19 || player.money < GAME_CONSTANTS.MOUNTAIN_FEE + 300000) return false;
        const ownedNormal = tiles.filter(t => t.owner === player && t.type === 'normal');

        if (player.aiType === 'marathon') {
            return player.money >= GAME_CONSTANTS.MOUNTAIN_FEE + 450000;
        }
        if (player.aiType === 'aggressive') {
            const hasGoodLand = ownedNormal.length >= 2 || ownedNormal.some(t => t.level >= 2 || t.isSpecialToll);
            return hasGoodLand && player.money >= GAME_CONSTANTS.MOUNTAIN_FEE + 350000;
        }
        if (player.aiType === 'defensive') {
            return ownedNormal.length >= 3 && player.money >= 1800000;
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
            if (myCount >= 3 && maxOtherCount < 2) return false; // 본인이 압도적 1위면 유지
            return true;
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
        const cost = Math.floor(player.money * 0.25);
        const remain = player.money - cost;
        const hasHighValue = enemyOwned.some(t => t.level >= 2 || t.isSpecialToll);

        if (player.aiType === 'aggressive') {
            return remain >= 200000 && (hasHighValue || cost <= 600000);
        }
        if (player.aiType === 'defensive') {
            return remain >= 1000000 && hasHighValue;
        }
        return remain >= 500000 && hasHighValue;
    },

    // ==========================================
    // 7. 마녀 도서관 3장 중 1장 선택 AI
    // ==========================================
    decideLibraryCardChoice(player, cards, ctx) {
        if (!cards || cards.length === 0) return null;
        const tiles = ctx.tiles || [];
        const allPlayers = ctx.allPlayers || [];

        const scoreCard = (c) => {
            if (c.id >= 500) return 2000;
            if (RequiemState.isSootState && !player.isReincarnated && (c.id === CARD_IDS.SPEC_JUDGMENT || c.id === CARD_IDS.SPEC_CULT_WISH)) return 1900;
            if (c.id === CARD_IDS.SPEC_ODYSSEY) return 1750;
            if (c.id === CARD_IDS.SPEC_TAKE_DAYA) return 1550;
            if (c.id === CARD_IDS.SPEC_WOLF_STEAL) return 1350;
            if (c.id === CARD_IDS.SPEC_VVVIP) return 1200;
            if (c.id === CARD_IDS.SPEC_BBANGJU_INTRUDE || c.id === CARD_IDS.SPEC_TIME_ACCEL || c.id === CARD_IDS.SPEC_ERPIN_DICE) return 1150;
            if (c.id === CARD_IDS.SPEC_SMUGGLER_BADGE || c.id === CARD_IDS.SPEC_MOON_FLOWER || c.id === CARD_IDS.SPEC_ORIGIN_ELIF) return 1050;
            if (c.id === CARD_IDS.HONOR_CITIZEN_SUPPORT) {
                const cnt = tiles.filter(t => t.owner === player && t.type === 'normal').length;
                return cnt >= 5 ? 1250 : 450;
            }
            if (c.id === CARD_IDS.HOMELESS_SUPPORT) {
                const cnt = tiles.filter(t => t.owner === player && t.type === 'normal').length;
                return cnt <= 3 ? 1250 : 450;
            }
            if (c.id === CARD_IDS.PRAISE_FOR_YOU || c.id === CARD_IDS.FESTIVAL || c.id === CARD_IDS.GOLDIE_LOTTERY) return 950;
            if (c.id === CARD_IDS.MAYO_DEAL || c.id === CARD_IDS.LANDMARK_CONTRACT || c.id === CARD_IDS.UPGRADE_CONTRACT || c.id === CARD_IDS.BUILD_CONTRACT) return 900;
            if (c.id === CARD_IDS.SIST_DEAL) return player.money >= 1500000 ? 600 : -300;
            if (c.id === CARD_IDS.TAX_LAND || c.id === CARD_IDS.TAX_BUILD || c.id === CARD_IDS.CREPE_CLEANING || c.id === CARD_IDS.RIOT || c.id === CARD_IDS.MOVE_VOLCANICA || c.id === CARD_IDS.MOVE_VOID) return -400;
            return 500;
        };

        return [...cards].sort((a, b) => scoreCard(b) - scoreCard(a))[0];
    },

    // ==========================================
    // 8. 인벤토리/보물 액티브 카드 타겟 지정 AI
    // ==========================================
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
        const margin = this.getSafetyMargin(player, globalTurn, tiles);
        const reqReserve = player.aiType === 'defensive' ? 1200000 : Math.round(margin * 0.5);

        const scored = candidates.map(t => {
            const cost = t.basePrice + Math.round(calculateToll(t, player) * 1.5);
            const futureVal = this.getTileSettlementValue(t) + (t.isSpecialToll ? 500000 : 0) + t.side * 100000;
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

        const candidates = tiles.filter(t => t.owner && t.owner !== player && !t.owner.isBankrupt && t.type === 'normal');
        candidates.sort((a, b) => {
            const scoreA = calculateToll(a, player) + (a.isSpecialToll ? 400000 : 0) + (a.level >= 3 ? 500000 : 0);
            const scoreB = calculateToll(b, player) + (b.isSpecialToll ? 400000 : 0) + (b.level >= 3 ? 500000 : 0);
            return scoreB - scoreA;
        });
        return candidates[0] || null;
    },

    selectStaffTargetTile(player, tiles) {
        const enemyTiles = tiles.filter(t => t.type === 'normal' && t.owner && t.owner !== player && !t.owner.isBankrupt);
        if (enemyTiles.length > 0) {
            return [...enemyTiles].sort((a, b) => {
                const scoreA = this.getTileSettlementValue(a) + (a.isSpecialToll ? 600000 : 0) + a.level * 300000;
                const scoreB = this.getTileSettlementValue(b) + (b.isSpecialToll ? 600000 : 0) + b.level * 300000;
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

        const danger = this.evaluateDangerAhead(player, tiles, 1, 12);

        // 1. 볼케니카 탈출 카드
        if (player.islandTurns > 0) {
            const escapeCard = inv.find(c => c.id === CARD_IDS.NER_ESCAPE);
            if (escapeCard) {
                if (globalTurn <= 15) return escapeCard;
                if (player.aiType !== 'defensive' && danger.maxToll < 1200000) return escapeCard;
            }
            // 볼케니카 수감 중에도 사용 가능한 견제/건설 카드만 제한적으로 판단
            const landmarkOnly = inv.find(c => c.id === CARD_IDS.LANDMARK_CONTRACT);
            if (landmarkOnly && this.selectBestUpgradeTile(player, tiles, t => t.level === 3, true, globalTurn)) {
                return landmarkOnly;
            }
            return null;
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
            if (target && (target.level >= 2 || target.isSpecialToll || globalTurn >= 15)) {
                return ropeCard;
            }
        }

        // 4. [506: ???의 지팡이] (1회 무상 강탈)
        const staffCard = usableTreasures.find(tc => tc.id === CARD_IDS.TREASURE_STAFF);
        if (staffCard) {
            const target = this.selectStaffTargetTile(player, tiles);
            if (target && ((target.owner && (target.level >= 2 || target.isSpecialToll)) || globalTurn >= 15)) {
                return staffCard;
            }
        }

        // 5. [45: 마요의 암거래]
        const mayoCard = inv.find(c => c.id === CARD_IDS.MAYO_DEAL);
        if (mayoCard && (player.aiType !== 'defensive' || player.money >= 2500000)) {
            if (this.selectMayoTarget(player, tiles, allPlayers, globalTurn)) {
                return mayoCard;
            }
        }

        // 6. [46: 마리의 스위치]
        const mariCard = inv.find(c => c.id === CARD_IDS.MARI_SWITCH);
        if (mariCard) {
            const targetEnemy = this.selectMariTargetPlayer(player, tiles, allPlayers);
            if (targetEnemy) {
                const hasLv2Plus = tiles.some(t => t.owner === targetEnemy && t.level >= 2);
                if (player.aiType !== 'defensive' || hasLv2Plus || globalTurn >= 12) {
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

        // 8. [47: 주야역전]
        const revCard = inv.find(c => c.id === CARD_IDS.REVERSE_TIME);
        if (revCard && this.selectReverseTimeTile(player, tiles, globalTurn)) {
            return revCard;
        }

        // 9. [504: ???의 수의] (1~6칸 중 고이득 착지 또는 고위험 회피)
        const shroudCard = usableTreasures.find(tc => tc.id === CARD_IDS.TREASURE_SHROUD);
        if (shroudCard && player.restTurns === 0) {
            const bestStep = this.decideRelativeMoveCard(player, [1, 2, 3, 4, 5, 6], tiles, allPlayers, globalTurn);
            const targetTile = tiles[(player.pos + bestStep) % 40];
            let bestScore = this.scoreLandingTile(player, targetTile, tiles, allPlayers, globalTurn);
            if (player.pos + bestStep >= 40) bestScore += this.getExpectedStartBonus(player);

            const dangerNear = this.evaluateDangerAhead(player, tiles, 2, 7);
            if (bestScore >= 350000 || (dangerNear.maxToll >= 500000 && bestScore > -100000)) {
                return shroudCard;
            }
        }

        // 10. [48: 루포의 주사위] (전방 1~6칸 위험 회피 or 고효율 점프)
        const rufoCard = inv.find(c => c.id === CARD_IDS.RUFO_DICE);
        if (rufoCard && !player.hasRufoDiceBuff) {
            const dangerNear = this.evaluateDangerAhead(player, tiles, 2, 7);
            if (dangerNear.dangerCount >= 1 && dangerNear.maxToll >= 400000) {
                return rufoCard;
            }
            const farBestStep = this.decideRelativeMoveCard(player, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], tiles, allPlayers, globalTurn);
            const farScore = this.scoreLandingTile(player, tiles[(player.pos + farBestStep) % 40], tiles, allPlayers, globalTurn);
            if (farScore >= 550000) return rufoCard;
        }

        // 11. [44: 골디의 제안] (초중반 현금 부족 시 저열/저단계 매각, 후반 19~20턴 절대 금지)
        const goldieCard = inv.find(c => c.id === CARD_IDS.GOLDIE_PROPOSAL);
        if (goldieCard && globalTurn <= 18) {
            const sellCandidate = this.selectGoldieSellTile(player, tiles);
            if (sellCandidate && (player.money < 400000 || (sellCandidate.side <= 1 && sellCandidate.level <= 1 && player.money < 800000))) {
                return goldieCard;
            }
        }

        return null;
    }
};
