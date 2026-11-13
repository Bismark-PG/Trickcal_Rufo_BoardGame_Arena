import {
    RuntimePopup,
    getActiveWorld,
    getCardUIText,
    createMarbleWorldMetrics
} from './MarbleRuntime.js';
import { RequiemState, checkAndTriggerClimax } from './MarbleRequiem.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';

// 보물 카드 확률 테이블 [일반%, 특수%, 보물%] - 인덱스 = 가진 보물 개수 (기획서 38p)
const PROB_TABLE = [
    [90.25, 4.75, 5.0],  // 0장 소유 시 (보물 5%)
    [85.50, 4.50, 10.0], // 1장 소유 시 (보물 10%)
    [76.00, 4.00, 20.0], // 2장 소유 시 (보물 20%)
    [57.00, 3.00, 40.0], // 3장 소유 시 (보물 40%)
    [19.00, 1.00, 80.0], // 4장 소유 시 (보물 80%)
    [0.0,   0.0,  100.0] // 5장 소유 시 (5장 보유시 다음 카드는 무조건 보물카드)
];

export function getDrawnTreasures() {
    return getActiveWorld().globalDrawnTreasures;
}

export function getAltarTradedCards() {
    return getActiveWorld().altarTradedCards;
}

export function resetOdysseyState() {
    const world = getActiveWorld();
    world.globalDrawnTreasures.clear();
    world.altarTradedCards.length = 0;
    world.metrics = createMarbleWorldMetrics();
}

const LEVEL_RANK_BONUSES = [0.2, 0.4, 0.6, 0.8, 1.0];
const ROW_RANK_BONUSES = [0.8, 1.0, 1.2, 1.5];
const BBANGJU_CHIEF_BONUSES = { 1: 1.0, 2: 0.5, 3: 0.3 };
const MOUNTAIN_VISIT_PROBS = [5, 10, 17.5, 20];

/**
 * 생존 플레이어들의 현금(0~5점)과 영토·특수칸·정비반장 보너스를 합산해
 * 순위 및 구간(최상위권/상위권/중위권/하위권/최하위권) 정보를 산출한다.
 */
export function computePlayerRankTiers(allPlayers = [], tiles = []) {
    const alive = (allPlayers || []).filter(p => p && !p.isBankrupt);
    const tierMap = new Map();
    if (alive.length === 0) return tierMap;

    const moneys = alive.map(p => Number(p.money) || 0);
    const minCash = Math.min(...moneys);
    const maxCash = Math.max(...moneys);
    const bbangjuCount = alive.filter(p => p.isBbangjuChief).length;
    const bbangjuBonus = BBANGJU_CHIEF_BONUSES[bbangjuCount] || 0;

    const scored = alive.map(p => {
        const cash = Number(p.money) || 0;
        let score = maxCash > minCash ? (5 * (cash - minCash)) / (maxCash - minCash) : 5;
        if (p.isBbangjuChief) score += bbangjuBonus;

        for (const t of tiles || []) {
            if (!t || t.owner !== p) continue;
            if (t.id === BOARD_TILES.THEATER || t.id === BOARD_TILES.DAYA) {
                score += 0.5;
            } else if (t.id === BOARD_TILES.MONATIUM_25 || t.id === BOARD_TILES.LAKE || t.id === BOARD_TILES.LIBRARY) {
                score += 1.0;
            } else if (t.type === 'normal') {
                if (t.isSpecialToll) score += 1.0;
                score += LEVEL_RANK_BONUSES[t.level] || 0;
                score += ROW_RANK_BONUSES[t.side] || 0;
            }
        }
        return { player: p, score, cash };
    });

    scored.sort((a, b) => (b.score - a.score) || (b.cash - a.cash) || ((a.player.playerIndex || 0) - (b.player.playerIndex || 0)));
    const count = scored.length;
    const topScore = scored[0].score;
    const bottomScore = scored[count - 1].score;
    const diff = topScore - bottomScore;

    scored.forEach((entry, idx) => {
        const isHighest = count >= 2 && idx === 0;
        const isLowest = count >= 2 && idx === count - 1;
        const isOddMiddle = count >= 3 && (count % 2 === 1) && idx === Math.floor(count / 2);
        const isUpper = !isOddMiddle && (count === 2 ? idx === 0 : idx < Math.floor(count / 2));
        const isLower = !isOddMiddle && (count === 2 ? idx === 1 : idx >= Math.ceil(count / 2));

        let ratioToTop = 0;
        let ratioToBottom = 0;
        if (isOddMiddle) {
            ratioToTop = diff > 0 ? Math.max(0, Math.min(1, (entry.score - bottomScore) / diff)) : 0.5;
            ratioToBottom = 1 - ratioToTop;
        }

        tierMap.set(entry.player, {
            rank: idx + 1,
            totalAlive: count,
            score: entry.score,
            isHighest,
            isUpper,
            isMiddle: isOddMiddle,
            isLower,
            isLowest,
            ratioToTop,
            ratioToBottom
        });
    });

    return tierMap;
}

/**
 * 결정된 등급(normal/special) 풀 내에서 현재 상태·순위·특수칸 조건에 따라
 * 확정 획득 판정 대상 카드와 각각의 퍼센트 확률(%)을 산출한다.
 */
export function getConditionalCardCandidates(targetType, player, pool, ctx = null) {
    if (!player || !Array.isArray(pool) || pool.length === 0) return [];
    const poolById = new Map(pool.map(c => [c.id, c]));
    const allPlayers = ctx?.allPlayers || [player];
    const tiles = ctx?.tiles || [];
    const candidates = [];

    const addIfInPool = (cardId, prob) => {
        const card = poolById.get(cardId);
        if (card && prob > 0) candidates.push({ card, prob });
    };

    if (targetType === 'normal') {
        const rankMap = computePlayerRankTiers(allPlayers, tiles);
        const r = rankMap.get(player);
        if (!r || r.totalAlive < 2) return candidates;

        if (r.isLowest) addIfInPool(CARD_IDS.PRAISE_FOR_YOU, 10);
        if (r.isHighest) {
            addIfInPool(19, 10);
            addIfInPool(20, 10);
            addIfInPool(21, 10);
        }

        const upperProb = r.isUpper ? 5 : (r.isMiddle ? 5 * r.ratioToTop : 0);
        if (upperProb > 0) addIfInPool(22, upperProb);

        const lowerProb = r.isLower ? 5 : (r.isMiddle ? 5 * r.ratioToBottom : 0);
        if (lowerProb > 0) addIfInPool(23, lowerProb);

        const bottomBoostProb = r.isLowest ? 10 : (r.isLower ? 5 : (r.isMiddle ? 5 * r.ratioToBottom : 0));
        if (bottomBoostProb > 0) {
            addIfInPool(24, bottomBoostProb);
            addIfInPool(25, bottomBoostProb);
            addIfInPool(26, bottomBoostProb);
            addIfInPool(27, bottomBoostProb);
        }
        return candidates;
    }

    if (targetType === 'special') {
        const drawnTreasures = getDrawnTreasures();
        const treasuresAvail = drawnTreasures.size < 6 && !RequiemState.isSootState && !RequiemState.hasSootEverTriggered;
        if (player.hasVisitedAltar && treasuresAvail) {
            addIfInPool(CARD_IDS.SPEC_ODYSSEY, 10);
        }

        const anyEnemyHasTreasure = allPlayers.some(p => p && p !== player && !p.isBankrupt && p.treasureCards?.length > 0);
        if (anyEnemyHasTreasure) {
            addIfInPool(CARD_IDS.SPEC_WOLF_STEAL, 10);
        }

        if (poolById.has(CARD_IDS.SPEC_FORGOTTEN_MEM)) {
            const alivePlayers = allPlayers.filter(p => p && !p.isBankrupt);
            const visitCounts = alivePlayers.map(p => Number(p.tracker?.mountainVisits) || 0);
            const distinctDesc = [...new Set(visitCounts)].sort((a, b) => b - a);
            const myVisits = Number(player.tracker?.mountainVisits) || 0;
            const visitTierIdx = Math.max(0, distinctDesc.indexOf(myVisits));
            addIfInPool(CARD_IDS.SPEC_FORGOTTEN_MEM, MOUNTAIN_VISIT_PROBS[Math.min(visitTierIdx, MOUNTAIN_VISIT_PROBS.length - 1)]);
        }
    }

    return candidates;
}

function resolveConditionalDraw(candidates, world) {
    if (!candidates || candidates.length === 0) return null;

    const hits = [];
    for (const entry of candidates) {
        if (Math.random() * 100 < entry.prob) {
            hits.push(entry);
        }
    }
    if (hits.length === 0) return null;

    let selected = hits[0].card;
    if (hits.length > 1) {
        const totalProb = hits.reduce((sum, h) => sum + h.prob, 0);
        let roll = Math.random() * totalProb;
        for (const h of hits) {
            roll -= h.prob;
            if (roll <= 0) {
                selected = h.card;
                break;
            }
        }
    }

    return selected;
}

export const OdysseyManager = {
    // 4단계 카드 드로우: 1) 그을음 빛무리(75%)·태초의 엘리프(50%) 최상위 선판정 -> 2) 등급 결정 -> 3) 등급 내 조건부 확정 판정 -> 4) 등급 전체 균등 드로우
    drawDynamicCard(player, fullDeck, currentTurn, excludeIds = new Set(), batchExtraTreasures = 0, ctx = null) {
        const drawnTreasures = getDrawnTreasures();
        const availableTreasures = fullDeck.filter(c => c.id >= 500 && !drawnTreasures.has(c.id) && !excludeIds.has(c.id));
        const effectiveTreasureCount = drawnTreasures.size + Math.max(0, Number(batchExtraTreasures) || 0);
        const world = getActiveWorld();
        const resolvedCtx = ctx || { player, allPlayers: [player], tiles: [] };

        // [1단계 최상위 선판정 A] 그을음 상태에서 윤회 미보유자는 [113/114] 그룹을 설정 확률(기본 50%)로 선판정 (적중 시 2종 중 균등 랜덤)
        const isSootNonBossHaloEligible = Boolean(RequiemState.isSootState && player && !player.isReincarnated);
        const haloPrecheckProb = Math.max(0, Math.min(1, Number(world?.haloCardPrecheckProb ?? GAME_CONSTANTS.HALO_CARD_PRECHECK_PROB ?? 0.50)));
        let haloCandidates = [];
        if (isSootNonBossHaloEligible) {
            const specialPoolAll = fullDeck.filter(c => c.id >= 100 && c.id < 500 && !excludeIds.has(c.id));
            haloCandidates = specialPoolAll.filter(c => c.id === CARD_IDS.SPEC_JUDGMENT || c.id === CARD_IDS.SPEC_CULT_WISH);
            if (haloCandidates.length > 0) {
                if (world?.metrics) {
                    world.metrics.sootHaloCardDrawAttempts = (world.metrics.sootHaloCardDrawAttempts || 0) + 1;
                    const fallbackRate = (1 - haloPrecheckProb) * 0.05 * (haloCandidates.length / Math.max(1, specialPoolAll.length));
                    world.metrics.sootHaloCardExpectedDraws = (world.metrics.sootHaloCardExpectedDraws || 0) + haloPrecheckProb + fallbackRate;
                }
                if (Math.random() < haloPrecheckProb) {
                    if (world?.metrics) {
                        world.metrics.sootHaloCardActualDraws = (world.metrics.sootHaloCardActualDraws || 0) + 1;
                    }
                    return haloCandidates[Math.floor(Math.random() * haloCandidates.length)];
                }
            }
        }

        // [1단계 최상위 선판정 B] 태초의 엘리프(#206) - 기억 회복 상태일 때 50% 최상위 선판정
        const originCard = fullDeck.find(c => c.id === CARD_IDS.SPEC_ORIGIN_ELIF && !excludeIds.has(c.id));
        if (player && player.hasRecoveredMemory && originCard) {
            if (world?.metrics) {
                world.metrics.originElifEligibleRolls = (world.metrics.originElifEligibleRolls || 0) + 1;
            }
            if (Math.random() < 0.50) {
                if (world?.metrics) {
                    world.metrics.originElifCoinFlipWins = (world.metrics.originElifCoinFlipWins || 0) + 1;
                }
                return originCard;
            }
            // 선판정 50% 실패 시 이번 드로우에서는 206 제외하여 정확한 50% 기대 확률 유지
            excludeIds.add(CARD_IDS.SPEC_ORIGIN_ELIF);
        }

        // [2단계] 카드 등급 결정 (보물 잠금 시 일반 95% / 특수 5%, 해금 시 PROB_TABLE 적용)
        let targetType = "normal";
        const forceNoTreasure =
            RequiemState.hasSootEverTriggered ||
            RequiemState.isSootState ||
            !player.hasVisitedAltar ||
            effectiveTreasureCount >= 6 ||
            availableTreasures.length === 0;

        if (forceNoTreasure) {
            targetType = Math.random() * 100 < 95 ? "normal" : "special";
        } else {
            const tCount = Math.min(effectiveTreasureCount, 5);
            const probs = PROB_TABLE[tCount];
            if (world?.metrics) {
                world.metrics.postAltarEligibleDraws++;
                world.metrics.stepTreasureExpectationSum += (probs[2] / 100);
            }
            const rand = Math.random() * 100;
            if (rand < probs[0]) targetType = "normal";
            else if (rand < probs[0] + probs[1]) targetType = "special";
            else targetType = "treasure";

            if (targetType === "treasure" && availableTreasures.length === 0) {
                targetType = "normal";
            }
        }

        const picked = this._getRandomCardByType(player, fullDeck, targetType, excludeIds, resolvedCtx);
        if (
            isSootNonBossHaloEligible &&
            haloCandidates.length > 0 &&
            world?.metrics &&
            picked &&
            (picked.id === CARD_IDS.SPEC_JUDGMENT || picked.id === CARD_IDS.SPEC_CULT_WISH)
        ) {
            world.metrics.sootHaloCardActualDraws = (world.metrics.sootHaloCardActualDraws || 0) + 1;
        }
        return picked;
    },

    // 제단 2회차+ 포탈로 차원 열쇠 카드 칸 이동 시 미등장 보물 카드 확정 획득
    drawGuaranteedAltarTreasure(player, fullDeck) {
        if (!player || !Array.isArray(fullDeck)) return null;
        if (RequiemState.hasSootEverTriggered || RequiemState.isSootState) return null;
        const drawnTreasures = getDrawnTreasures();
        const availableTreasures = fullDeck.filter(c => c.id >= 500 && !drawnTreasures.has(c.id));
        if (availableTreasures.length === 0) return null;

        return availableTreasures[Math.floor(Math.random() * availableTreasures.length)];
    },

    // 마녀 도서관 능력 등 여러 장을 순차 동적 확률 + 보물 상한 반영으로 중복 없이 뽑아 반환
    drawMultipleCards(player, fullDeck, currentTurn, count = 3, ctx = null) {
        const picked = [];
        const excludeIds = new Set();
        let batchExtraTreasures = 0;
        for (let i = 0; i < count; i++) {
            const card = this.drawDynamicCard(player, fullDeck, currentTurn, excludeIds, batchExtraTreasures, ctx);
            if (card) {
                picked.push(card);
                excludeIds.add(card.id);
                if (card.id >= 500) batchExtraTreasures++;
            }
        }
        return picked;
    },

    // [3~4단계] 등급 풀 확정 → 등급 내 조건부 확정 판정 → 실패 시 등급 전체 균등 드로우
    _getRandomCardByType(player, deck, typeKeyword, excludeIds = new Set(), ctx = null) {
        const drawnTreasures = getDrawnTreasures();
        const world = getActiveWorld();
        let effectiveType = typeKeyword;
        let pool = [];

        if (effectiveType === "normal") {
            pool = deck.filter(c => c.id < 100 && !excludeIds.has(c.id));
        } else if (effectiveType === "special") {
            pool = deck.filter(c => c.id >= 100 && c.id < 500 && !excludeIds.has(c.id));
        } else if (effectiveType === "treasure") {
            pool = deck.filter(c => c.id >= 500 && !drawnTreasures.has(c.id) && !excludeIds.has(c.id));
        }

        // 특수/보물 풀이 비어 있으면 일반 카드 등급으로 대체
        if (pool.length === 0) {
            effectiveType = "normal";
            pool = deck.filter(c => c.id < 100 && !excludeIds.has(c.id));
        }
        if (pool.length === 0) {
            pool = deck.filter(c => c.id < 500 && !excludeIds.has(c.id));
        }
        if (pool.length === 0) {
            pool = deck.filter(c => c.id < 100);
        }
        if (pool.length === 0) return null;

        if (effectiveType === "normal") {
            // [일반 카드] 대출 보유자 한정: 50% 확률로 골디의 부동산명함 / 피라의 대부업명함 2종 중 1장 우선 등장
            // 대출 미보유 시: 발동형 골디의 부동산명함(#28)은 풀에서 제외하고 보유형 피라의 대부업명함(#38)만 노출
            const hasDebt = player && (
                (typeof player.getTotalLoanDebt === 'function' && player.getTotalLoanDebt() > 0) ||
                ((player.loanPrincipal || 0) + (player.loanInterestPrincipal || 0) + (player.loanInterest || 0)) > 0
            );
            if (!hasDebt) {
                const filteredPool = pool.filter(c => c.id !== CARD_IDS.GOLDIE_REALTY);
                if (filteredPool.length > 0) pool = filteredPool;
            } else {
                const loanCardPool = pool.filter(
                    c => c.id === CARD_IDS.GOLDIE_REALTY || c.id === CARD_IDS.PIRA_LOAN
                );
                if (loanCardPool.length > 0 && Math.random() < 0.50) {
                    return loanCardPool[Math.floor(Math.random() * loanCardPool.length)];
                }
            }
        }

        if (effectiveType === "special") {
            // [퍼리비이치 별도 선판정 섹션]
            // - 정령호수 소유 중(미개장): 75% -> #201 지급, 실패 시 #201 포함 특수 풀 정상 드로우
            // - 퍼리비이치 상태: 50% -> 관련 카드(202~204 중 적격) 1장 랜덤 지급, 실패 시 해당 카드 포함 특수 풀 정상 드로우
            const tiles = ctx?.tiles || [];
            const isLakeOwner = Boolean(tiles[BOARD_TILES.LAKE]?.owner === player);
            const isFurry = Boolean(WorldGimmickManager.isFurryBeach);

            if (isLakeOwner && !isFurry) {
                const openCard = pool.find(c => c.id === CARD_IDS.SPEC_FURRY_OPEN);
                if (openCard && Math.random() < 0.75) {
                    return openCard;
                }
            } else if (isFurry) {
                const furryCards = pool.filter(c =>
                    c.id === CARD_IDS.SPEC_KOMI_JUICE ||
                    c.id === CARD_IDS.SPEC_DIANA_PUNCH ||
                    c.id === CARD_IDS.SPEC_KIM_WORKER
                );
                if (furryCards.length > 0 && Math.random() < 0.50) {
                    return furryCards[Math.floor(Math.random() * furryCards.length)];
                }
            }
        }

        if (effectiveType === "normal" || effectiveType === "special") {
            const candidates = getConditionalCardCandidates(effectiveType, player, pool, ctx);
            const pickedConditional = resolveConditionalDraw(candidates, world);
            if (pickedConditional) return pickedConditional;
        }

        return pool[Math.floor(Math.random() * pool.length)];
    },

    // 플레이어가 보물을 얻었을 때 처리하는 로직
    acquireTreasure(ctx, card) {
        const { player, turnManager } = ctx;
        getDrawnTreasures().add(card.id);
        player.treasureCards.push({
            ...card,
            remainingUses: typeof card.maxUses === 'number' ? card.maxUses : 0
        });

        if (player.tracker) player.tracker.treasureAcquiredCount++;
        if (player.firstTreasureTurn === -1 && turnManager) {
            player.firstTreasureTurn = turnManager.globalTurn;
        }

        const cText = getCardUIText();
        RuntimePopup.showToast(`[${player.name}] [${card.name}] ${cText.TREASURE_OBTAIN}`, 3800);

        checkAndTriggerClimax(ctx);
    }
};
