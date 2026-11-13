// ProgramFiles/Marble/MarbleLogManager.js
// 엘리아스 마블 게임 전용 경기 메트릭 추출, 마르코프 보물 기댓값 연산,
// 1사이클 상세 로그 및 최근 100사이클 평균 밸런스 로그 생성 어댑터

import { GAME_CONSTANTS, BUILDING_COSTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES, SPECIAL_TERRITORY_IDS } from '../System/Index/Marble/MarbleBoardIndex.js';
import { CardIndex } from '../System/Index/Marble/MarbleCardIndex.js';
import { processFinalSettlement, getSpecialTerritoryVillageToll } from './MarbleSettlement.js';

const ALL_CARDS_CATALOG = (CardIndex.ko || []).map(c => ({
    id: c.id,
    name: c.name,
    grade: c.id >= 500 ? 'treasure' : (c.id >= 100 ? 'special' : 'normal')
}));

export const MARBLE_LOG_FILES = {
    CYCLE_DETAIL: '마블_100사이클_상세로그.md',
    AVERAGE_100: '마블_100사이클_평균로그.md',
    RAW_DATA: '마블_로그데이터.json'
};

export const MARBLE_LOG_10_FILES = {
    CYCLE_DETAIL: '마블_10사이클_상세로그.md',
    AVERAGE_100: '마블_10사이클_평균로그.md',
    RAW_DATA: '마블_10사이클_로그데이터.json'
};

export const MARBLE_MAX_HISTORY = 100;
export const MARBLE_10_MAX_HISTORY = 10;

// MarbleOdyssey PROB_TABLE (0~5개 보유 시 다음 드로우 보물 등장 확률)
const TREASURE_PROB_TABLE = [0.05, 0.10, 0.20, 0.40, 0.80, 1.00];

export function fmt4(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0.0000';
    return num.toFixed(4);
}

export function clampPct(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.min(100, Math.max(0, num));
}

export function fmtMoney(value) {
    return `${Math.round(Number(value) || 0).toLocaleString()}엘드르`;
}

/**
 * 동점자를 동일 평균 순위(1..N)로 변환한다. (내림차순 기준)
 */
export function computeTieAwareRanks(items, valueGetter) {
    if (!Array.isArray(items) || items.length === 0) return new Map();
    const indexed = items.map((item, idx) => ({
        item,
        idx,
        val: Number(valueGetter(item)) || 0
    }));
    indexed.sort((a, b) => b.val - a.val || a.idx - b.idx);

    const ranks = new Map();
    let i = 0;
    while (i < indexed.length) {
        let j = i + 1;
        while (j < indexed.length && Math.abs(indexed[j].val - indexed[i].val) < 1e-9) {
            j++;
        }
        const avgRank = ((i + 1) + j) / 2;
        for (let k = i; k < j; k++) {
            ranks.set(indexed[k].item, avgRank);
        }
        i = j;
    }
    return ranks;
}

/**
 * 두 순위 매핑 사이의 정규화된 Spearman Footrule 괴리 지수 [0.0000, 100.0000]%
 */
export function computeRankDiscrepancyPct(keys, rankMapA, rankMapB) {
    const n = keys.length;
    if (n <= 1) return { overallPct: 0, perKey: new Map() };
    const maxFootrule = Math.floor((n * n) / 2);
    const maxSingleShift = Math.max(1, n - 1);

    let sumAbsDiff = 0;
    const perKey = new Map();
    for (const k of keys) {
        const ra = rankMapA.get(k) ?? n;
        const rb = rankMapB.get(k) ?? n;
        const diff = Math.abs(ra - rb);
        sumAbsDiff += diff;
        perKey.set(k, {
            beforeRank: ra,
            afterRank: rb,
            diff,
            pct: clampPct((diff / maxSingleShift) * 100)
        });
    }

    const overallPct = maxFootrule > 0 ? clampPct((sumAbsDiff / maxFootrule) * 100) : 0;
    return { overallPct, perKey };
}

/**
 * 비음수 값 분포의 정규화 지니 기반 불균형 지수 [0.0000, 100.0000]%
 * - 0.0000%: 전원 완전 균등
 * - 100.0000%: 1인 완전 독점
 */
export function computeNormalizedAssetGapPct(values) {
    const n = Array.isArray(values) ? values.length : 0;
    if (n <= 1) return 0;

    const clamped = values.map(v => Math.max(0, Number(v) || 0));
    const total = clamped.reduce((s, v) => s + v, 0);
    if (total <= 0) return 0;

    let absDiffSum = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            absDiffSum += Math.abs(clamped[i] - clamped[j]);
        }
    }

    const gini = absDiffSum / (2 * n * total);
    const maxGini = (n - 1) / n;
    return maxGini > 0 ? clampPct((gini / maxGini) * 100) : 0;
}

/**
 * 제단 해금 이후 누적 랜덤 드로우 횟수(D)에 대해
 * 7-상태 흡수 마르코프 연쇄(PROB_TABLE: 5, 10, 20, 40, 80, 100%)의 정확한 기대 보물 획득 수를 계산한다.
 */
export function computeTreasureMarkovExpectation(drawCount) {
    const d = Math.max(0, Math.floor(Number(drawCount) || 0));
    let dist = [1, 0, 0, 0, 0, 0, 0];

    for (let step = 0; step < d; step++) {
        const next = [0, 0, 0, 0, 0, 0, 0];
        for (let k = 0; k < 6; k++) {
            if (dist[k] <= 0) continue;
            const p = TREASURE_PROB_TABLE[k];
            next[k] += dist[k] * (1 - p);
            next[k + 1] += dist[k] * p;
        }
        next[6] += dist[6];
        dist = next;
    }

    let expectedCount = 0;
    for (let k = 1; k <= 6; k++) {
        expectedCount += k * dist[k];
    }

    const baselineFullDraws = TREASURE_PROB_TABLE.reduce((acc, p) => acc + (1 / p), 0); // 39.75회
    const baselineRatePct = (6 / baselineFullDraws) * 100; // 15.0943%
    const expectedPerDrawRatePct = d > 0 ? clampPct((expectedCount / d) * 100) : 0;

    return {
        drawCount: d,
        expectedCount,
        expectedPerDrawRatePct,
        probAll6Pct: clampPct(dist[6] * 100),
        stateDistribution: dist,
        baselineFullDraws,
        baselineRatePct
    };
}

/**
 * 실시간(정산 전) 자산 추정: 현금 + 보유 일반/특수 영토 매입·건설 원금 - 대출 원금/이자
 */
export function estimatePreSettlementPlayerAsset(player, tiles) {
    if (!player || player.isBankrupt) return 0;
    let propertyValue = 0;
    for (const t of tiles || []) {
        if (t.owner === player) {
            propertyValue += t.basePrice || 0;
            if (t.level >= 1 && t.side !== undefined && BUILDING_COSTS[t.side]) {
                propertyValue += BUILDING_COSTS[t.side][t.level - 1] || 0;
            }
        }
    }
    const debt = (player.loanPrincipal || 0) + (player.loanInterest || 0);
    return (player.money || 0) + propertyValue - debt;
}

/**
 * 플레이어가 보유한 특수 영토(요충지)의 정산 전 투자·기대 수금 가치 산출
 */
function calculatePreSettlementSpecialTerritoryMetrics(player, tiles, aliveCount) {
    let ownedCount = 0;
    let investedValue = 0;
    let theoreticalCollect = 0;
    const ownedTileIds = [];

    const aliveOpponents = Math.max(0, aliveCount - (player.isBankrupt ? 0 : 1));
    for (const tileId of SPECIAL_TERRITORY_IDS) {
        const tile = tiles?.[tileId];
        if (tile && tile.owner === player) {
            ownedCount++;
            ownedTileIds.push(tileId);
            const villageBuildCost = (tile.side !== undefined && BUILDING_COSTS[tile.side])
                ? (BUILDING_COSTS[tile.side][1] || 0)
                : 0;
            investedValue += (tile.basePrice || 0) + villageBuildCost;
            theoreticalCollect += getSpecialTerritoryVillageToll(tile) * aliveOpponents;
        }
    }

    return {
        ownedCount,
        ownedTileIds,
        investedValue,
        theoreticalCollect
    };
}

/**
 * 행동 지표 및 정산 데이터를 토대로 플레이어의 승리(플레이) 전략군 분류
 */
export function classifyPlayerStrategy(pStats) {
    if (pStats.isBankruptFinal) {
        return {
            code: 'CRISIS_BANKRUPT',
            label: '고위험/위기 파산형'
        };
    }

    const scores = {
        LAND_EMPIRE: (pStats.landBuyCount || 0) * 2.4 +
            (pStats.landmarkCount || 0) * 4.5 +
            ((pStats.landAssetNet || 0) / 1000000) * 0.9,
        TREASURE_REQUIEM: (pStats.treasureAcquiredCount || 0) * 4.5 +
            (pStats.altarFirstVisits || 0) * 2.5 +
            (pStats.treasureStolenCount || 0) * 3.0 +
            (pStats.isReincarnated ? 6.0 : 0) +
            ((pStats.treasureSettleBonus || 0) / 1000000) * 1.2,
        SPECIAL_CARD_CTRL: (pStats.specialTerritoryOwnedCount || 0) * 3.8 +
            (pStats.specialBuyCount || 0) * 2.8 +
            (pStats.activeCardsUsed || 0) * 2.2 +
            (pStats.cardsDrawn || 0) * 1.1,
        RUSH_CYCLE_CASH: (pStats.lapBonusCount || 0) * 2.6 +
            (pStats.bbangjuUsageCount || 0) * 2.5 +
            (pStats.moonHillVisits || 0) * 2.0 +
            Math.max(0, (pStats.avgMoveSpaces || 0) - 7.0) * 2.0 +
            (pStats.baseCash / 1000000) * 0.6
    };

    const labelMap = {
        LAND_EMPIRE: '영토 집중 확장형 (랜드마크·통행료 압박)',
        TREASURE_REQUIEM: '보물·윤회 기믹 추구형 (제단·윤회 중심)',
        SPECIAL_CARD_CTRL: '특수칸·카드 운영형 (요충지·특수기능 선점)',
        RUSH_CYCLE_CASH: '속도 순회·현금 회전형 (순회·빵주·기동성)'
    };

    let bestCode = 'LAND_EMPIRE';
    let bestScore = -Infinity;
    for (const [code, score] of Object.entries(scores)) {
        if (score > bestScore) {
            bestScore = score;
            bestCode = code;
        }
    }

    return {
        code: bestCode,
        label: labelMap[bestCode]
    };
}

function getCategoryNetSum(categories, idx) {
    const cat = Array.isArray(categories) ? categories[idx] : null;
    if (!cat || !Array.isArray(cat.items)) return 0;
    return cat.items.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);
}

/**
 * 종료 시점 MarbleGameEngine으로부터 1사이클(1판) 정형 로그 데이터를 추출한다.
 */
export function buildMatchLogDataFromEngine(engine, rankedSettlement = null) {
    if (!engine) return null;
    const ranked = rankedSettlement || processFinalSettlement(engine.allPlayers, engine.tiles);
    const allPlayers = engine.allPlayers || [];
    const aliveCount = allPlayers.filter(p => !p.isBankrupt).length;

    const preCashRankMap = computeTieAwareRanks(allPlayers, p => (p.isBankrupt ? -1e12 : (p.money || 0)));
    const preAssetRankMap = computeTieAwareRanks(allPlayers, p => estimatePreSettlementPlayerAsset(p, engine.tiles));

    const settleByPlayer = new Map();
    ranked.forEach((res, idx) => settleByPlayer.set(res.player, { res, idx }));

    const postTotalAssetRankMap = computeTieAwareRanks(allPlayers, p => {
        const entry = settleByPlayer.get(p);
        return entry ? (entry.res.isBankruptFinal ? -1e12 : entry.res.totalAsset) : -1e12;
    });
    const postNetWorthRankMap = computeTieAwareRanks(allPlayers, p => {
        const entry = settleByPlayer.get(p);
        return entry ? (entry.res.isBankruptFinal ? -1e12 : entry.res.netWorth) : -1e12;
    });

    const cashVsTotalAssetDisc = computeRankDiscrepancyPct(allPlayers, preCashRankMap, postTotalAssetRankMap);
    const cashVsNetWorthDisc = computeRankDiscrepancyPct(allPlayers, preCashRankMap, postNetWorthRankMap);
    const dayaTileOwner = engine.tiles?.[BOARD_TILES.DAYA]?.owner || null;
    const buildingLevelTotals = [0, 0, 0, 0, 0];

    const playerSnapshots = allPlayers.map((p) => {
        const settleEntry = settleByPlayer.get(p);
        const res = settleEntry ? settleEntry.res : {
            baseCash: p.isBankrupt ? 0 : p.money,
            totalAsset: p.isBankrupt ? 0 : p.money,
            totalLoan: (p.loanPrincipal || 0) + (p.loanInterest || 0),
            netWorth: p.isBankrupt ? -1 : p.money,
            specialTerritoryCollectTotal: 0,
            specialTerritoryPaidTotal: 0,
            kimWorkerPaidTotal: 0,
            lakeReward: 0,
            isBankruptFinal: Boolean(p.isBankrupt),
            categories: []
        };

        const tr = p.tracker || {};
        const preSpecial = calculatePreSettlementSpecialTerritoryMetrics(p, engine.tiles, aliveCount);
        const actualSpecCollect = res.specialTerritoryCollectTotal || 0;
        const actualSpecPaid = res.specialTerritoryPaidTotal || 0;
        const specNominalRef = preSpecial.theoreticalCollect;
        let specialDiscrepancyPct = 0;
        if (specNominalRef > 0) {
            specialDiscrepancyPct = clampPct((Math.abs(specNominalRef - actualSpecCollect) / specNominalRef) * 100);
        } else if (preSpecial.investedValue > 0 && actualSpecCollect === 0) {
            specialDiscrepancyPct = 100;
        }

        const ownedNormals = (engine.tiles || []).filter(t => t.owner === p && t.type === 'normal');
        const buildingLevels = [0, 0, 0, 0, 0];
        ownedNormals.forEach(t => {
            const lvl = Math.min(4, Math.max(0, Number(t.level) || 0));
            buildingLevels[lvl]++;
            buildingLevelTotals[lvl]++;
        });
        const landmarkCount = buildingLevels[4];
        const specialBuyCount = (engine.tiles || []).filter(t => t.owner === p && t.type === 'special_buy').length;
        const totalRolls = tr.totalRolls || 0;
        const totalMovedSpaces = tr.totalMovedSpaces || 0;
        const avgMoveSpaces = totalRolls > 0 ? totalMovedSpaces / totalRolls : 0;
        const rawLoanPrincipal = (Number(p.loanPrincipal) || 0) + (Number(p.loanInterestPrincipal) || 0);
        const rawLoanInterest = Math.round(Number(p.loanInterest) || 0);
        const loanEvents = Array.isArray(tr.loanEvents) ? tr.loanEvents.map(e => ({ ...e })) : [];

        const discEntry = cashVsTotalAssetDisc.perKey.get(p) || { beforeRank: 4, afterRank: 4, diff: 0, pct: 0 };
        const discNetEntry = cashVsNetWorthDisc.perKey.get(p) || { beforeRank: 4, afterRank: 4, diff: 0, pct: 0 };

        const partialStats = {
            id: p.id,
            name: p.name,
            slotIndex: p.playerIndex || 1,
            isAi: p.isAi(),
            aiType: p.aiType || 'human',
            settlementRank: (settleEntry ? settleEntry.idx + 1 : allPlayers.length),
            tieAwareNetWorthRank: postNetWorthRankMap.get(p) ?? allPlayers.length,
            tieAwareTotalAssetRank: discEntry.afterRank,
            tieAwareCashRank: discEntry.beforeRank,
            tieAwarePreAssetRank: preAssetRankMap.get(p) ?? allPlayers.length,
            cashVsTotalAssetRankDiff: discEntry.diff,
            cashVsTotalAssetDiscrepancyPct: discEntry.pct,
            cashVsNetWorthRankDiff: discNetEntry.diff,
            cashVsNetWorthDiscrepancyPct: discNetEntry.pct,
            preEstimatedAsset: estimatePreSettlementPlayerAsset(p, engine.tiles),
            baseCash: res.baseCash,
            totalAsset: res.totalAsset,
            totalLoan: res.totalLoan,
            loanPrincipal: rawLoanPrincipal,
            loanInterest: rawLoanInterest,
            totalLoanRaw: rawLoanPrincipal + rawLoanInterest,
            netWorth: res.netWorth,
            isBankruptFinal: Boolean(res.isBankruptFinal),
            landAssetNet: getCategoryNetSum(res.categories, 1),
            treasureSettleBonus: getCategoryNetSum(res.categories, 4),
            landBuyCount: ownedNormals.length,
            buildingLevels,
            landmarkCount,
            specialBuyCount,
            isBbangjuChief: Boolean(p.isBbangjuChief),
            hasDayaPalace: dayaTileOwner === p,
            unusedInventoryCards: Array.isArray(p.inventory) ? p.inventory.length : 0,
            specialTerritoryOwnedCount: preSpecial.ownedCount,
            specialTerritoryOwnedIds: preSpecial.ownedTileIds,
            specialTerritoryInvestedValue: preSpecial.investedValue,
            specialTerritoryTheoreticalCollect: specNominalRef,
            specialTerritoryActualCollect: actualSpecCollect,
            specialTerritoryActualPaid: actualSpecPaid,
            specialTerritoryNetProfit: actualSpecCollect - preSpecial.investedValue,
            specialTerritoryDiscrepancyPct: specialDiscrepancyPct,
            totalRolls,
            totalMovedSpaces,
            avgMoveSpaces,
            doublesRolled: tr.doublesRolled || 0,
            cardsDrawn: tr.cardsDrawn || 0,
            cardDrawsTotal: tr.cardDrawsTotal || 0,
            gradeDraws: {
                normal: tr.gradeDraws?.normal || 0,
                special: tr.gradeDraws?.special || 0,
                treasure: tr.gradeDraws?.treasure || 0
            },
            activeCardsUsed: tr.activeCardsUsed || 0,
            treasureAcquiredCount: tr.treasureAcquiredCount || 0,
            treasureStolenCount: tr.treasureStolenCount || 0,
            altarFirstVisits: p.hasVisitedAltar ? 1 : 0,
            bbangjuChiefAllowanceTotal: Number(tr.bbangjuChiefAllowanceTotal) || 0,
            altarTradeCount: Number(tr.altarTradeCount) || 0,
            altarTradeCards: Number(tr.altarTradeCards) || 0,
            altarTradeReward: Number(tr.altarTradeReward) || 0,
            voidVisitCount: Number(tr.voidVisitCount) || 0,
            voidTrappedCount: Number(tr.voidTrappedCount) || 0,
            voidDamageTotal: Number(tr.voidDamageTotal) || 0,
            lapPassCount: tr.lapPassCount || 0,
            lapBonusCount: tr.lapBonusCount || 0,
            lapBlockedCount: tr.lapBlockedCount || 0,
            bbangjuUsageCount: tr.bbangjuUsageCount || 0,
            moonHillVisits: tr.moonHillVisits || 0,
            monatium25Visits: tr.monatium25Visits || 0,
            furryBeachVisits: tr.furryBeachVisits || 0,
            specialTileVisits: tr.specialTileVisits || 0,
            tollsPaidCount: tr.tollsPaidCount || 0,
            tollsPaidTotal: tr.tollsPaidTotal || 0,
            minSingleTollPaid: tr.minSingleTollPaid ?? null,
            maxSingleTollPaid: tr.maxSingleTollPaid || 0,
            turnStartCrisisCount: tr.turnStartCrisisCount || 0,
            loanCount: p.loanCount || 0,
            tollLoanCount: tr.tollLoanCount || 0,
            emergencyLoanCount: tr.emergencyLoanCount || 0,
            borrowedPrincipalTotal: tr.borrowedPrincipalTotal || 0,
            minLoanAmount: tr.minLoanAmount ?? null,
            maxLoanAmount: tr.maxLoanAmount || 0,
            loanEvents,
            loanRepayCount: tr.loanRepayCount || 0,
            loanRepaidTotal: tr.loanRepaidTotal || 0,
            loanPrincipalRepaidTotal: tr.loanPrincipalRepaidTotal || 0,
            loanInterestRepaidTotal: tr.loanInterestRepaidTotal || 0,
            loanInterestConvertedCount: tr.loanInterestConvertedCount || 0,
            loanInterestConvertedTotal: tr.loanInterestConvertedTotal || 0,
            loanFullClearedCount: tr.loanFullClearedCount || 0,
            rankChangeCount: tr.rankChangeCount || 0,
            kimWorkerPaidTotal: res.kimWorkerPaidTotal || 0,
            lakeReward: res.lakeReward || 0,
            isReincarnated: Boolean(p.isReincarnated),
            hasRegretState: Boolean(p.hasRegretState),
            hasKarmaState: Boolean(p.hasKarmaState)
        };
        partialStats.strategy = classifyPlayerStrategy(partialStats);
        return partialStats;
    });

    // 정산 순위 기준 재정렬
    playerSnapshots.sort((a, b) => a.settlementRank - b.settlementRank);

    const totalRollsMatch = playerSnapshots.reduce((s, p) => s + p.totalRolls, 0);
    const totalMovedMatch = playerSnapshots.reduce((s, p) => s + p.totalMovedSpaces, 0);
    const matchAvgMoveSpaces = totalRollsMatch > 0 ? totalMovedMatch / totalRollsMatch : 0;

    const wm = engine.world?.metrics || {};
    const postAltarDraws = wm.postAltarEligibleDraws || 0;
    const markov = computeTreasureMarkovExpectation(postAltarDraws);
    const actualProbTreasures = wm.drawnViaProbTableCount || 0;
    const actualOdysseyTreasures = wm.drawnViaOdysseyCount || 0;
    const actualAltarTreasures = wm.drawnViaAltarPortalCount || 0;
    const nonStolenPlayerTreasures = playerSnapshots.reduce(
        (s, p) => s + Math.max(0, (p.treasureAcquiredCount || 0) - (p.treasureStolenCount || 0)),
        0
    );
    const totalTreasuresObtained = Math.max(
        actualProbTreasures + actualOdysseyTreasures + actualAltarTreasures,
        nonStolenPlayerTreasures
    );

    const allLoanAmounts = playerSnapshots
        .flatMap(p => (p.loanEvents || []).map(e => Number(e.amount) || 0))
        .filter(a => a > 0);
    const loanSummary = {
        totalLoanCount: playerSnapshots.reduce((s, p) => s + (p.loanCount || 0), 0),
        tollLoanCount: playerSnapshots.reduce((s, p) => s + (p.tollLoanCount || 0), 0),
        emergencyLoanCount: playerSnapshots.reduce((s, p) => s + (p.emergencyLoanCount || 0), 0),
        borrowerCount: playerSnapshots.filter(p => (p.loanCount || 0) > 0).length,
        minSingleLoan: allLoanAmounts.length > 0 ? Math.min(...allLoanAmounts) : null,
        maxSingleLoan: allLoanAmounts.length > 0 ? Math.max(...allLoanAmounts) : 0,
        avgSingleLoan: allLoanAmounts.length > 0 ? allLoanAmounts.reduce((s, v) => s + v, 0) / allLoanAmounts.length : 0,
        totalBorrowedPrincipal: playerSnapshots.reduce((s, p) => s + (p.borrowedPrincipalTotal || 0), 0),
        totalSettlementPrincipal: playerSnapshots.reduce((s, p) => s + (p.loanPrincipal || 0), 0),
        totalSettlementInterest: playerSnapshots.reduce((s, p) => s + (p.loanInterest || 0), 0),
        totalDebtRaw: playerSnapshots.reduce((s, p) => s + (p.totalLoanRaw || 0), 0),
        totalDebtSettled: playerSnapshots.reduce((s, p) => s + (p.totalLoan || 0), 0),
        totalRepayCount: playerSnapshots.reduce((s, p) => s + (p.loanRepayCount || 0), 0),
        totalRepaidAmount: playerSnapshots.reduce((s, p) => s + (p.loanRepaidTotal || 0), 0),
        totalInterestConvertedCount: playerSnapshots.reduce((s, p) => s + (p.loanInterestConvertedCount || 0), 0),
        totalInterestConvertedAmount: playerSnapshots.reduce((s, p) => s + (p.loanInterestConvertedTotal || 0), 0),
        totalFullClearedCount: playerSnapshots.reduce((s, p) => s + (p.loanFullClearedCount || 0), 0),
        maxPlayerLoanCount: Math.max(0, ...playerSnapshots.map(p => p.loanCount || 0)),
        maxPlayerBorrowedPrincipal: Math.max(0, ...playerSnapshots.map(p => p.borrowedPrincipalTotal || 0)),
        maxPlayerLoanInterest: Math.max(0, ...playerSnapshots.map(p => p.loanInterest || 0))
    };

    const rawGrades = wm.gradeDrawCounts || {};
    const gradeCounts = {
        normal: Number(rawGrades.normal) || 0,
        special: Number(rawGrades.special) || 0,
        treasure: Number(rawGrades.treasure) || 0
    };
    const cardStats = {
        gradeCounts,
        totalDraws: gradeCounts.normal + gradeCounts.special + gradeCounts.treasure,
        cardHistogram: wm.cardDrawHistogram ? { ...wm.cardDrawHistogram } : {},
        treasureAcquireHistogram: wm.treasureAcquireHistogram ? { ...wm.treasureAcquireHistogram } : {},
        duplicateAnomalies: Number(wm.cardDuplicateAnomalies) || 0,
        deckReshuffleCount: Number(wm.deckReshuffleCount) || 0,
        unusedInventoryTotal: playerSnapshots.reduce((s, p) => s + (p.unusedInventoryCards || 0), 0),
        stolenTreasuresCount: playerSnapshots.reduce((s, p) => s + (p.treasureStolenCount || 0), 0)
    };

    const dayaHolder = playerSnapshots.find(p => p.hasDayaPalace) || null;
    const bbangjuChiefs = playerSnapshots.filter(p => p.isBbangjuChief);
    const rawGimmickTurns = wm.gimmickTurnCounts || {};
    const balanceExtras = {
        buildingLevelTotals,
        gimmickTurnCounts: {
            none: Number(rawGimmickTurns.none) || 0,
            day: Number(rawGimmickTurns.day) || 0,
            night: Number(rawGimmickTurns.night) || 0,
            soot: Number(rawGimmickTurns.soot) || 0,
            halo: Number(rawGimmickTurns.halo) || 0
        },
        totalGrossAsset: playerSnapshots.reduce((s, p) => s + (p.isBankruptFinal ? 0 : Math.max(0, p.totalAsset || 0)), 0),
        dayaOwnerName: dayaHolder ? dayaHolder.name : null,
        dayaOwnerRank: dayaHolder ? dayaHolder.settlementRank : null,
        bbangjuChiefCount: bbangjuChiefs.length,
        bbangjuChiefWinner: bbangjuChiefs.some(p => p.settlementRank === 1 && !p.isBankruptFinal)
    };

    const specHolders = playerSnapshots.filter(p => p.specialTerritoryOwnedCount > 0);
    const totalSpecTheo = playerSnapshots.reduce((s, p) => s + p.specialTerritoryTheoreticalCollect, 0);
    const totalSpecActual = playerSnapshots.reduce((s, p) => s + p.specialTerritoryActualCollect, 0);
    const totalSpecInvested = playerSnapshots.reduce((s, p) => s + p.specialTerritoryInvestedValue, 0);
    let matchSpecDiscrepancyPct = 0;
    if (totalSpecTheo > 0) {
        matchSpecDiscrepancyPct = clampPct((Math.abs(totalSpecTheo - totalSpecActual) / totalSpecTheo) * 100);
    } else if (totalSpecInvested > 0 && totalSpecActual === 0) {
        matchSpecDiscrepancyPct = 100;
    }

    const totalRankChangeEvents = Array.isArray(engine.rankChanges) ? engine.rankChanges.length : 0;
    const rankCheckpointCount = Array.isArray(engine.rankCheckpoints) ? engine.rankCheckpoints.length : 0;
    const preCashGapPct = computeNormalizedAssetGapPct(playerSnapshots.map(p => (p.isBankruptFinal ? 0 : p.baseCash)));
    const postTotalAssetGapPct = computeNormalizedAssetGapPct(playerSnapshots.map(p => (p.isBankruptFinal ? 0 : p.totalAsset)));
    const postNetWorthGapPct = computeNormalizedAssetGapPct(playerSnapshots.map(p => (p.isBankruptFinal ? 0 : p.netWorth)));

    const finalTurn = Math.min(engine.maxTurn || GAME_CONSTANTS.MAX_TURN, engine.turnManager?.globalTurn || 1);
    const winner = playerSnapshots[0] || null;
    const rankDiffList = playerSnapshots.map(p => p.cashVsTotalAssetDiscrepancyPct);
    const avgPlayerRankDiscPct = rankDiffList.length > 0
        ? rankDiffList.reduce((s, v) => s + v, 0) / rankDiffList.length
        : 0;

    const lakeOwner = engine.tiles?.[BOARD_TILES.LAKE]?.owner || null;
    const lakeOwnerAlive = Boolean(lakeOwner && !lakeOwner.isBankrupt);
    const furryCounts = {
        201: Number(wm.furryCardUseCounts?.[201]) || 0,
        202: Number(wm.furryCardUseCounts?.[202]) || 0,
        203: Number(wm.furryCardUseCounts?.[203]) || 0,
        204: Number(wm.furryCardUseCounts?.[204]) || 0
    };
    const furryOpenCount = Number(wm.furryOpenCount) || 0;
    const furryDianaRevertCount = Number(wm.furryDianaRevertCount) || 0;
    const furryEntryTollTotal = Number(wm.furryEntryTollTotal) || 0;
    const furryBaselineRestCount = Number(wm.furryBaselineRestCount) || 0;
    const furryKimWorkerPaidTotal = playerSnapshots.reduce((s, p) => s + (p.kimWorkerPaidTotal || 0), 0);
    const lakeOwnerReward = playerSnapshots.reduce((s, p) => s + (p.lakeReward || 0), 0);
    const lakeBaselineIfNormal = lakeOwnerAlive ? (furryBaselineRestCount * GAME_CONSTANTS.SETTLE_SPECIAL_TILE_UNIT) : 0;
    const furrySettleUplift = lakeOwnerReward - lakeBaselineIfNormal;
    const furryManualOpenCount = Number(wm.furryManualOpenCount) || 0;
    const furryManualOpenCost = furryManualOpenCount * (GAME_CONSTANTS.FURRY_MANUAL_OPEN_FEE || 500000);
    const furryActualGain = furryOpenCount > 0 ? (furryEntryTollTotal + furrySettleUplift - furryKimWorkerPaidTotal - furryManualOpenCost) : 0;
    const furryAnalytics = {
        cardCounts: furryCounts,
        totalCardUses: furryCounts[201] + furryCounts[202] + furryCounts[203] + furryCounts[204],
        lakeOwned: Boolean(lakeOwner),
        lakeFirstOwnedTurn: wm.furryLakeOwnedFirstTurn ?? null,
        openCount: furryOpenCount,
        endedAsFurry: furryOpenCount > furryDianaRevertCount,
        komiJuiceCount: Number(wm.furryKomiJuiceCount) || 0,
        dianaRevertCount: furryDianaRevertCount,
        kimWorkerCount: Number(wm.furryKimWorkerCount) || 0,
        entryTollTotal: furryEntryTollTotal,
        extraRestCount: Number(wm.furryExtraRestCount) || 0,
        baselineRestCount: furryBaselineRestCount,
        kimWorkerPaidTotal: furryKimWorkerPaidTotal,
        lakeOwnerReward,
        settleUplift: furrySettleUplift,
        manualOpenCount: furryManualOpenCount,
        manualOpenCost: furryManualOpenCost,
        actualGain: furryActualGain,
        expectedGain: (Number(wm.furryExpectedGainSum) || 0) - furryManualOpenCost
    };

    const tSpecCounts = {
        111: Number(wm.treasureSpecialCardUseCounts?.[111]) || 0,
        112: Number(wm.treasureSpecialCardUseCounts?.[112]) || 0,
        113: Number(wm.treasureSpecialCardUseCounts?.[113]) || 0,
        114: Number(wm.treasureSpecialCardUseCounts?.[114]) || 0
    };
    const tSpecTotalUses = tSpecCounts[111] + tSpecCounts[112] + tSpecCounts[113] + tSpecCounts[114];
    const treasureActiveUses = Number(wm.treasureActiveUseCount) || 0;
    const treasureCardAnalytics = {
        specialCounts: tSpecCounts,
        specialTotalUses: tSpecTotalUses,
        activeUses: treasureActiveUses,
        haloCardTriggers: tSpecCounts[113] + tSpecCounts[114],
        totalTreasureRelatedUses: tSpecTotalUses + treasureActiveUses
    };

    const mountainInvestmentTotal = Number(wm.mountainInvestmentTotal) || 0;
    const mountainTollExtraTotal = Number(wm.mountainTollExtraTotal) || 0;
    const mountainAnalytics = {
        buyCount: Number(wm.mountainBuyCount) || 0,
        investmentTotal: mountainInvestmentTotal,
        tollExtraTotal: mountainTollExtraTotal,
        actualNetGain: mountainTollExtraTotal - mountainInvestmentTotal,
        expectedNetGain: Number(wm.mountainExpectedGainSum) || 0
    };

    const memoryOriginAnalytics = {
        forgottenAcquired: Number(wm.forgottenAcquiredCount) || 0,
        forgottenRecovered: Number(wm.forgottenRecoveredCount) || 0,
        forgottenExpectedProbSum: Number(wm.forgottenExpectedProbSum) || 0,
        originElifEligibleRolls: Number(wm.originElifEligibleRolls) || 0,
        originElifCoinFlipWins: Number(wm.originElifCoinFlipWins) || 0,
        originElifDrawnCount: Number(wm.originElifDrawnCount) || 0
    };

    const sootMakashaTotal = Number(wm.sootMakashaTotal) || 0;
    const sootDiscountSavedTotal = Number(wm.sootDiscountSavedTotal) || 0;
    const sootExtraTollTotal = Number(wm.sootExtraTollTotal) || 0;
    const sootLapBlockedLossTotal = Number(wm.sootLapBlockedLossTotal) || 0;
    const sootSkillCostTotal = Number(wm.sootSkillCostTotal) || 0;
    const sootDestroyValueTotal = Number(wm.sootDestroyValueTotal) || 0;
    const sootBossTollTotal = Number(wm.sootBossTollTotal) || 0;
    const sootExpectedBossToll = Number(wm.sootExpectedBossToll) || 0;
    const sootExpectedDestroyLoss = Number(wm.sootExpectedDestroyLoss) || 0;
    const sootActualCashNet = sootMakashaTotal + sootDiscountSavedTotal - sootLapBlockedLossTotal - sootSkillCostTotal;
    const sootPlayerPnl = {};
    let sootBossCash = 0, sootBossTotal = 0;
    let sootOpposedCash = 0, sootOpposedTotal = 0;
    for (const [pid, entry] of Object.entries(wm.sootPlayerPnl || {})) {
        const cash = Number(entry?.cash) || 0;
        const destroyAsset = Number(entry?.destroyAsset) || 0;
        const totalNet = cash + destroyAsset;
        const role = entry?.role || (wm.sootBranch === 2 ? (wm.reincarnatedPlayerName === entry?.name ? 'reincarnated' : 'opposed') : 'branch1');
        sootPlayerPnl[pid] = { name: entry?.name || pid, role, cash, destroyAsset, totalNet };
        if (wm.sootBranch === 2) {
            if (role === 'reincarnated') {
                sootBossCash += cash;
                sootBossTotal += totalNet;
            } else {
                sootOpposedCash += cash;
                sootOpposedTotal += totalNet;
            }
        }
    }
    const sootPnlAnalytics = {
        triggered: (Number(wm.sootTriggerCount) || 0) > 0,
        branch: wm.sootBranch || null,
        makashaTotal: sootMakashaTotal,
        discountSavedTotal: sootDiscountSavedTotal,
        extraTollTotal: sootExtraTollTotal,
        lapBlockedLossTotal: sootLapBlockedLossTotal,
        skillCostTotal: sootSkillCostTotal,
        destroyValueTotal: sootDestroyValueTotal,
        actualCashNet: sootActualCashNet,
        actualTotalNet: sootActualCashNet - sootDestroyValueTotal,
        expectedNet: Number(wm.sootExpectedNetSum) || 0,
        expectedBranch1: Number(wm.sootExpectedBranch1Sum) || 0,
        bossActualCash: sootBossCash,
        bossActualTotal: sootBossTotal,
        bossActualToll: sootBossTollTotal,
        expectedBoss: Number(wm.sootExpectedBossNet) || 0,
        expectedBossToll: sootExpectedBossToll,
        destroyActualValue: sootDestroyValueTotal,
        expectedDestroyLoss: sootExpectedDestroyLoss,
        opposedActualCash: sootOpposedCash,
        opposedActualTotal: sootOpposedTotal,
        expectedOpposed: Number(wm.sootExpectedOpposedNet) || 0,
        haloCardDrawAttempts: Number(wm.sootHaloCardDrawAttempts) || 0,
        haloCardExpectedDraws: Number(wm.sootHaloCardExpectedDraws) || 0,
        haloCardActualDraws: Number(wm.sootHaloCardActualDraws) || 0,
        haloCardTriggered: (Number(wm.haloCardCount) || 0) > 0,
        playerPnl: sootPlayerPnl
    };

    const haloPlayerPnl = {};
    let haloActualDebuffedNet = 0;
    let haloActualOpposedNet = 0;
    for (const [pid, entry] of Object.entries(wm.haloPlayerPnl || {})) {
        const tollGain = Number(entry?.tollGain) || 0;
        const tollPayerDiff = Number(entry?.tollPayerDiff) || 0;
        const positiveGain = Number(entry?.positiveGain) || 0;
        const lapBlockedLoss = Number(entry?.lapBlockedLoss) || 0;
        const net = tollGain + positiveGain - tollPayerDiff - lapBlockedLoss;
        const role = entry?.role || 'beneficiary_normal';
        haloPlayerPnl[pid] = {
            name: entry?.name || pid,
            role,
            tollGain,
            tollPayerDiff,
            positiveGain,
            lapBlockedLoss,
            net
        };
        if (role === 'karma' || role === 'regret') haloActualDebuffedNet += net;
        else haloActualOpposedNet += net;
    }
    const haloPnlAnalytics = {
        triggered: ((Number(wm.haloNaturalCount) || 0) + (Number(wm.haloCardCount) || 0)) > 0,
        branchMode: wm.haloBranchMode || null,
        debuffType: wm.haloDebuffType || null,
        debuffedPlayerName: wm.haloDebuffedPlayerName || null,
        cardPrecheckProb: Number(wm.haloCardPrecheckProbUsed) || 0.50,
        positiveMult: Number(wm.haloPositiveMultUsed) || 2.0,
        tollGainTotal: Number(wm.haloTollGainTotal) || 0,
        positiveGainTotal: Number(wm.haloPositiveGainTotal) || 0,
        lapBlockedLossTotal: Number(wm.haloLapBlockedLossTotal) || 0,
        payerTollDiffTotal: Number(wm.haloPayerTollDiffTotal) || 0,
        actualDebuffedNet: haloActualDebuffedNet,
        actualOpposedNet: haloActualOpposedNet,
        actualTotalNet: haloActualDebuffedNet + haloActualOpposedNet,
        expectedDebuffed: Number(wm.haloExpectedDebuffedNet) || 0,
        expectedOpposed: Number(wm.haloExpectedOpposedNet) || 0,
        expectedTotal: Number(wm.haloExpectedTotalNet) || 0,
        playerPnl: haloPlayerPnl
    };

    const dayTollExtra = Number(wm.dayNightTollExtraTotal?.day) || 0;
    const nightTollExtra = Number(wm.dayNightTollExtraTotal?.night) || 0;
    const dayNightPlayerPnl = {};
    for (const [pid, entry] of Object.entries(wm.dayNightPlayerPnl || {})) {
        const gain = Number(entry?.gain) || 0;
        const loss = Number(entry?.loss) || 0;
        dayNightPlayerPnl[pid] = { name: entry?.name || pid, gain, loss, net: gain - loss };
    }
    const dayNightPnlAnalytics = {
        dayActiveTurns: Number(wm.dayNightActiveTurns?.day) || 0,
        nightActiveTurns: Number(wm.dayNightActiveTurns?.night) || 0,
        dayTollExtra,
        nightTollExtra,
        totalTollExtra: dayTollExtra + nightTollExtra,
        expectedToll: Number(wm.dayNightExpectedTollSum) || 0,
        playerPnl: dayNightPlayerPnl
    };

    const altarVisits = Number(wm.altarVisitTotal) || 0;
    const altarCardArrivals = Number(wm.altarCardArrivals) || 0;
    const altarRollVisits = Math.max(0, altarVisits - altarCardArrivals);
    const altarExpectedRollVisits = Number(wm.altarExpectedVisits) || 0;
    const altarExpectedTotalVisits = altarExpectedRollVisits + altarCardArrivals;
    const altarTraders = playerSnapshots
        .filter(ps => (ps.altarTradeCards || 0) > 0 || (ps.altarTradeCount || 0) > 0)
        .sort((a, b) =>
            ((b.altarTradeCards || 0) - (a.altarTradeCards || 0)) ||
            ((b.altarTradeReward || 0) - (a.altarTradeReward || 0)) ||
            ((a.settlementRank || 9) - (b.settlementRank || 9))
        );
    const topTrader = altarTraders[0] || null;
    const topTraderSootEntry = topTrader ? sootPnlAnalytics.playerPnl?.[topTrader.id] : null;
    const topTraderSootTotal = Number(topTraderSootEntry?.totalNet) || 0;
    const topTraderSootCash = Number(topTraderSootEntry?.cash) || 0;
    const topTraderTradeReward = topTrader ? (Number(topTrader.altarTradeReward) || 0) : 0;
    const topTraderTradeCards = topTrader ? (Number(topTrader.altarTradeCards) || 0) : 0;
    const topTraderIsReincarnated = Boolean(
        topTrader && (wm.reincarnatedPlayerId === topTrader.id || wm.reincarnatedPlayerName === topTrader.name)
    );
    let topTraderExpectedSoot = 0;
    if (topTrader && sootPnlAnalytics.triggered) {
        if (sootPnlAnalytics.branch === 2) {
            topTraderExpectedSoot = topTraderIsReincarnated
                ? (Number(sootPnlAnalytics.expectedBoss) || 0)
                : ((Number(sootPnlAnalytics.expectedOpposed) || 0) / Math.max(1, playerSnapshots.length - 1));
        } else {
            topTraderExpectedSoot = (Number(sootPnlAnalytics.expectedBranch1 ?? sootPnlAnalytics.expectedNet) || 0) / Math.max(1, playerSnapshots.length);
        }
    }
    const altarAnalytics = {
        visits: altarVisits,
        cardArrivals: altarCardArrivals,
        rollVisits: altarRollVisits,
        expectedRollVisits: altarExpectedRollVisits,
        expectedTotalVisits: altarExpectedTotalVisits,
        firstVisits: Number(wm.altarFirstVisits) || 0,
        portalUses: Number(wm.altarPortalUses) || 0,
        tradeCount: Number(wm.altarTradeCount) || 0,
        tradeCardsTotal: Number(wm.altarTradeCardsTotal) || 0,
        hasTopTrader: Boolean(topTrader),
        topTraderName: topTrader ? topTrader.name : null,
        topTraderTradeCount: topTrader ? (Number(topTrader.altarTradeCount) || 0) : 0,
        topTraderTradeCards,
        topTraderTradeReward,
        topTraderSootCash,
        topTraderSootTotal,
        topTraderCombinedActual: topTraderTradeReward + topTraderSootTotal,
        topTraderCombinedExpected: (topTraderTradeCards * (GAME_CONSTANTS.ALTAR_REWARD || 1000000)) + topTraderExpectedSoot,
        topTraderIsReincarnated,
        reincarnatedBossActualTotal: Number(sootPnlAnalytics.bossActualTotal) || 0,
        reincarnatedBossExpected: Number(sootPnlAnalytics.expectedBoss) || 0
    };

    const voidVisits = Number(wm.voidVisitTotal) || 0;
    const voidCardArrivals = Number(wm.voidCardArrivals) || 0;
    const voidRollVisits = Math.max(0, voidVisits - voidCardArrivals);
    const voidExpectedRollVisits = Number(wm.voidExpectedVisits) || 0;
    const voidExpectedTotalVisits = voidExpectedRollVisits + (Number(wm.voidExpectedCardVisits ?? voidCardArrivals) || 0);
    const voidTrappedCount = Number(wm.voidTrappedCount) || 0;
    const voidChallengeCount = Number(wm.voidChallengeCount) || 0;
    const voidEscapeSuccessCount = Number(wm.voidEscapeSuccessCount) || 0;
    const voidEscapeFailCount = Number(wm.voidEscapeFailCount) || 0;
    const voidEscapeFailProb = 79 / 144;
    const voidBaseTurnLoss = (7 / 40) * (GAME_CONSTANTS.START_BONUS || 750000);
    const voidTrappedP = playerSnapshots.filter(p => (p.voidTrappedCount || 0) > 0);
    const voidUntrappedP = playerSnapshots.filter(p => (p.voidTrappedCount || 0) === 0);
    const voidAnalytics = {
        visits: voidVisits,
        cardArrivals: voidCardArrivals,
        rollVisits: voidRollVisits,
        expectedRollVisits: voidExpectedRollVisits,
        expectedTotalVisits: voidExpectedTotalVisits,
        trappedCount: voidTrappedCount,
        pulledCount: Number(wm.voidPulledCount) || 0,
        rimEvadedCount: Number(wm.voidRimEvadedCount) || 0,
        challengeCount: voidChallengeCount,
        escapeSuccessCount: voidEscapeSuccessCount,
        escapeFailCount: voidEscapeFailCount,
        damageTotal: Number(wm.voidDamageTotal) || 0,
        lapLossTotal: Number(wm.voidLapLossTotal) || 0,
        upkeepLossTotal: Number(wm.voidUpkeepLossTotal) || 0,
        expectedArrivalDamage: voidExpectedTotalVisits * voidBaseTurnLoss * voidEscapeFailProb,
        expectedTrappedDamage: voidTrappedCount * voidBaseTurnLoss * voidEscapeFailProb,
        trappedPlayers: voidTrappedP.length,
        trappedWins: voidTrappedP.filter(p => p.settlementRank === 1 && !p.isBankruptFinal).length,
        untrappedPlayers: voidUntrappedP.length,
        untrappedWins: voidUntrappedP.filter(p => p.settlementRank === 1 && !p.isBankruptFinal).length
    };

    return {
        gameId: 'marble',
        timestamp: new Date().toISOString(),
        roomId: engine.roomId || 'local_marble',
        startBonusSetting: GAME_CONSTANTS.START_BONUS,
        maxTurn: engine.maxTurn || GAME_CONSTANTS.MAX_TURN,
        finalTurn,
        totalPlayerTurns: engine.totalPlayerTurns || 0,
        endedEarlyByBankruptcy: aliveCount <= 1,
        bankruptCount: playerSnapshots.filter(p => p.isBankruptFinal).length,
        winnerName: winner ? winner.name : '-',
        winnerStrategy: winner ? winner.strategy : { code: 'NONE', label: '-' },
        metrics: {
            cashVsTotalAssetDiscrepancyPct: cashVsTotalAssetDisc.overallPct,
            avgPlayerCashVsTotalAssetDiscrepancyPct: avgPlayerRankDiscPct,
            cashVsNetWorthDiscrepancyPct: cashVsNetWorthDisc.overallPct,
            specialTerritoryTheoreticalTotal: totalSpecTheo,
            specialTerritoryActualTotal: totalSpecActual,
            specialTerritoryInvestedTotal: totalSpecInvested,
            specialTerritoryHolderCount: specHolders.length,
            specialTerritoryDiscrepancyPct: matchSpecDiscrepancyPct,
            totalRollsMatch,
            totalMovedMatch,
            avgMoveSpaces: matchAvgMoveSpaces,
            postAltarEligibleDraws: postAltarDraws,
            stepTreasureExpectationSum: wm.stepTreasureExpectationSum || 0,
            treasureProbObtainedCount: actualProbTreasures,
            treasureOdysseyObtainedCount: actualOdysseyTreasures,
            treasureAltarObtainedCount: actualAltarTreasures,
            treasureTotalObtainedCount: totalTreasuresObtained,
            treasureMarkovExpectedCount: markov.expectedCount,
            treasureMarkovExpectedRatePct: markov.expectedPerDrawRatePct,
            treasureMarkovAll6Pct: markov.probAll6Pct,
            treasureBaselineFullDraws: markov.baselineFullDraws,
            treasureBaselineRatePct: markov.baselineRatePct,
            preCashGapPct,
            postTotalAssetGapPct,
            postNetWorthGapPct,
            totalRankChanges: totalRankChangeEvents,
            rankCheckpointCount,
            rankChangeRatePct: rankCheckpointCount > 1
                ? clampPct((totalRankChangeEvents / Math.max(1, (rankCheckpointCount - 1) * playerSnapshots.length)) * 100)
                : 0,
            altarFirstVisits: wm.altarFirstVisits || 0,
            altarPortalUses: wm.altarPortalUses || 0,
            altarTradeCount: wm.altarTradeCount || 0,
            altarTradeCardsTotal: wm.altarTradeCardsTotal || 0,
            sootTriggerCount: wm.sootTriggerCount || 0,
            sootBranch: wm.sootBranch || null,
            reincarnatedPlayerName: wm.reincarnatedPlayerName || null,
            haloNaturalCount: wm.haloNaturalCount || 0,
            haloCardCount: wm.haloCardCount || 0,
            loanSummary,
            cardStats,
            balanceExtras,
            furryAnalytics,
            treasureCardAnalytics,
            mountainAnalytics,
            memoryOriginAnalytics,
            sootPnlAnalytics,
            haloPnlAnalytics,
            dayNightPnlAnalytics,
            altarAnalytics,
            voidAnalytics
        },
        players: playerSnapshots
    };
}

/**
 * 사이클 압축(밀집 구간 가지치기 + 최소/최대 극단값 보호)용 특징 벡터 추출
 * - 개별 플레이어 극값과 매치 단위 지표를 모두 포함하여 어느 기준에서도 최솟값/최댓값이 유실되지 않도록 한다.
 */
function extractCycleFeatureVector(cycle) {
    const m = cycle?.metrics || {};
    const ps = Array.isArray(cycle?.players) ? cycle.players : [];
    const nets = ps.map(p => Number(p.netWorth) || 0);
    const tots = ps.map(p => Number(p.totalAsset) || 0);
    const rankDiscs = ps.map(p => Number(p.cashVsTotalAssetDiscrepancyPct) || 0);
    const moves = ps.filter(p => (p.totalRolls || 0) > 0).map(p => Number(p.avgMoveSpaces) || 0);
    const rankChanges = ps.map(p => Number(p.rankChangeCount) || 0);
    const ls = m.loanSummary || {};
    const cs = m.cardStats || {};
    const gc = cs.gradeCounts || {};

    const safeMin = (arr) => (arr.length > 0 ? Math.min(...arr) : 0);
    const safeMax = (arr) => (arr.length > 0 ? Math.max(...arr) : 0);
    const safeMean = (arr) => (arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

    return [
        safeMean(nets),                               // 0. 매치 평균 순자산
        safeMin(nets),                                // 1. 매치 내 최소 순자산 (기준① 최소 보호)
        safeMax(nets),                                // 2. 매치 내 최대 순자산 (기준① 최대 보호)
        safeMean(tots),                               // 3. 매치 평균 총자산
        Number(m.postNetWorthGapPct) || 0,            // 4. 자산 격차
        Number(m.preCashGapPct) || 0,                 // 5. 현금 격차
        Number(m.cashVsTotalAssetDiscrepancyPct) || 0,// 6. 현금vs총자산 순위 괴리감
        safeMax(rankDiscs),                           // 7. 개인 최대 순위 괴리감
        Number(m.specialTerritoryDiscrepancyPct) || 0,// 8. 특수영토 가치 차이율
        Number(cycle?.finalTurn) || 0,                // 9. 최종 턴 수
        Number(m.avgMoveSpaces) || 0,                 // 10. 매치 평균 1회 이동 칸수
        safeMin(moves),                               // 11. 개인 최소 이동 칸수
        safeMax(moves),                               // 12. 개인 최대 이동 칸수
        Number(m.treasureTotalObtainedCount) || 0,    // 13. 획득 보물 수
        Number(m.totalRankChanges) || 0,              // 14. 매치 총 순위 변동 횟수
        safeMax(rankChanges),                         // 15. 개인 최대 순위 변동 횟수
        Number(ls.totalLoanCount) || 0,               // 16. 매치 총 대출 횟수
        Number(ls.maxSingleLoan) || 0,                // 17. 단일 최대 대출금
        Number(ls.totalDebtRaw) || 0,                 // 18. 매치 총 누적 대출 원리금
        Number(ls.totalSettlementInterest) || 0,      // 19. 매치 총 대출 누적 이자
        Number(cs.totalDraws) || 0,                   // 20. 매치 카드 총 드로우 수
        Number(gc.treasure) || 0,                     // 21. 매치 보물 직접 드로우 수
        Number(m.furryAnalytics?.actualGain) || 0,    // 22. 퍼리비이치 실수익
        Number(m.mountainAnalytics?.actualNetGain) || 0, // 23. 정령산 순수익
        Number(m.sootPnlAnalytics?.actualTotalNet) || 0, // 24. 그을음 실질 순손익
        Number(m.dayNightPnlAnalytics?.totalTollExtra) || 0, // 25. 낮/밤 추가 통행료
        Number(m.altarAnalytics?.visits) || 0,            // 26. 망가진 제단 도착 횟수
        Number(m.voidAnalytics?.visits) || 0,             // 27. 셰이디의 차원 도착 횟수
        Number(m.voidAnalytics?.damageTotal) || 0         // 28. 셰이디의 차원 피해액
    ];
}

/**
 * 100판을 초과하는 표본에 대해:
 * 1) 각 지표 축의 최솟값/최댓값 및 양의 최소 대출·부채 극값을 보유한 사이클을 자동 보호하고,
 * 2) 나머지 내부 후보 중 정규화 특징 공간에서 최근접 이웃 거리가 가장 작은(근사값이 가장 밀집된)
 *    사이클을 1건씩 제거해 정확히 maxCycles(100)판만 유지한다.
 */
export function compactCyclesDensityPreserve(cycles, maxCycles = MARBLE_MAX_HISTORY) {
    const list = Array.isArray(cycles) ? [...cycles] : [];
    const cap = Math.max(1, Number(maxCycles) || MARBLE_MAX_HISTORY);
    if (list.length <= cap) return list;

    let vectors = list.map(extractCycleFeatureVector);

    const protectPositiveMinIndex = (protectedSet, getter) => {
        let bestIdx = -1;
        let bestVal = Infinity;
        for (let i = 0; i < list.length; i++) {
            const v = getter(list[i]);
            if (typeof v === 'number' && v > 0 && v <= bestVal) {
                bestVal = v;
                bestIdx = i;
            }
        }
        if (bestIdx !== -1) protectedSet.add(bestIdx);
    };

    while (list.length > cap) {
        const n = list.length;
        const dims = vectors[0].length;
        const protectedIdx = new Set();

        const mins = new Array(dims).fill(Infinity);
        const maxs = new Array(dims).fill(-Infinity);

        // <= / >= 비교로 동일하거나 더 극단적인 최신 판이 갱신 시 극값 보호권을 승계받도록 처리
        for (let a = 0; a < dims; a++) {
            let minIdx = 0;
            let maxIdx = 0;
            let minVal = Infinity;
            let maxVal = -Infinity;
            for (let i = 0; i < n; i++) {
                const v = vectors[i][a];
                if (v <= minVal) { minVal = v; minIdx = i; }
                if (v >= maxVal) { maxVal = v; maxIdx = i; }
            }
            mins[a] = minVal;
            maxs[a] = maxVal;
            protectedIdx.add(minIdx);
            protectedIdx.add(maxIdx);
        }

        // 대출 미실행 판(0)과 별개로 실제 실행된 최소 대출금/최소 부채 보유 판도 보호
        protectPositiveMinIndex(protectedIdx, c => c?.metrics?.loanSummary?.minSingleLoan);
        protectPositiveMinIndex(protectedIdx, c => c?.metrics?.loanSummary?.totalDebtRaw);

        // 모든 표본이 보호 대상인 극한 예외 시 가장 오래된 인덱스만 해제 허용
        const norm = vectors.map(vec => vec.map((v, a) => {
            const span = maxs[a] - mins[a];
            return span > 1e-9 ? (v - mins[a]) / span : 0;
        }));

        let bestEvictIdx = -1;
        let smallestNeighborScore = Infinity;

        for (let i = 0; i < n; i++) {
            if (protectedIdx.has(i) && protectedIdx.size < n) continue;

            // i의 k=3 최근접 이웃 거리 합 (작을수록 근사값이 가장 많은 밀집 구간)
            let d1 = Infinity;
            let d2 = Infinity;
            let d3 = Infinity;
            let d3Sq = Infinity;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                let sq = 0;
                for (let a = 0; a < dims; a++) {
                    const diff = norm[i][a] - norm[j][a];
                    sq += diff * diff;
                    if (sq >= d3Sq) break;
                }
                if (sq >= d3Sq) continue;
                const dist = Math.sqrt(sq);
                if (dist < d1) {
                    d3 = d2; d2 = d1; d1 = dist;
                    d3Sq = Number.isFinite(d3) ? d3 * d3 : Infinity;
                } else if (dist < d2) {
                    d3 = d2; d2 = dist;
                    d3Sq = Number.isFinite(d3) ? d3 * d3 : Infinity;
                } else if (dist < d3) {
                    d3 = dist;
                    d3Sq = d3 * d3;
                }
            }
            const score = (Number.isFinite(d1) ? d1 : 0) +
                0.5 * (Number.isFinite(d2) ? d2 : d1) +
                0.25 * (Number.isFinite(d3) ? d3 : d2);

            if (score < smallestNeighborScore - 1e-12) {
                smallestNeighborScore = score;
                bestEvictIdx = i;
            }
        }

        if (bestEvictIdx === -1) bestEvictIdx = 0;
        list.splice(bestEvictIdx, 1);
        vectors.splice(bestEvictIdx, 1);
    }

    return list;
}

/**
 * 10사이클 등 소표본 배치 추출 시 극단값 쏠림을 방지하기 위한 분위수 대표 추출기:
 * 전체 모수를 주요 경제·변동성·기믹 지표 복합 스코어로 정렬한 뒤 균등 분위수 중앙값(decile midpoints)을 추출한다.
 */
export function compactCyclesQuantilePreserve(cycles, maxCycles = MARBLE_10_MAX_HISTORY) {
    const list = Array.isArray(cycles) ? [...cycles] : [];
    const cap = Math.max(1, Number(maxCycles) || MARBLE_10_MAX_HISTORY);
    if (list.length <= cap) return list;

    // 핵심 지표 6축: 평균 순자산, 자산 격차, 총 대출, 총 통행료, 그을음 손익절댓값, 최종 턴
    const keyAxes = list.map((c, idx) => {
        const m = c?.metrics || {};
        const ps = Array.isArray(c?.players) ? c.players : [];
        const meanNet = ps.length > 0 ? ps.reduce((s, p) => s + (Number(p.netWorth) || 0), 0) / ps.length : 0;
        const tollSum = ps.reduce((s, p) => s + (Number(p.tollsPaidTotal) || 0), 0);
        const ls = m.loanSummary || {};
        return {
            idx,
            vec: [
                meanNet,
                Number(m.postNetWorthGapPct) || 0,
                Number(ls.totalBorrowedPrincipal) || 0,
                tollSum,
                Number(m.sootPnlAnalytics?.actualTotalNet) || 0,
                Number(m.totalRankChanges) || 0
            ]
        };
    });

    const dims = keyAxes[0].vec.length;
    const mins = new Array(dims).fill(Infinity);
    const maxs = new Array(dims).fill(-Infinity);
    for (const item of keyAxes) {
        for (let a = 0; a < dims; a++) {
            if (item.vec[a] < mins[a]) mins[a] = item.vec[a];
            if (item.vec[a] > maxs[a]) maxs[a] = item.vec[a];
        }
    }

    const scored = keyAxes.map(item => {
        let composite = 0;
        for (let a = 0; a < dims; a++) {
            const span = maxs[a] - mins[a];
            composite += span > 1e-9 ? (item.vec[a] - mins[a]) / span : 0.5;
        }
        return { idx: item.idx, score: composite / dims };
    }).sort((a, b) => (a.score - b.score) || (a.idx - b.idx));

    const pickedIndices = [];
    const used = new Set();
    for (let k = 0; k < cap; k++) {
        let pos = Math.min(scored.length - 1, Math.floor(((k + 0.5) * scored.length) / cap));
        while (used.has(pos) && pos + 1 < scored.length) pos++;
        while (used.has(pos) && pos - 1 >= 0) pos--;
        used.add(pos);
        pickedIndices.push(scored[pos].idx);
    }

    pickedIndices.sort((a, b) => a - b);
    return pickedIndices.map(i => list[i]);
}

const AI_TYPE_LABELS = {
    aggressive: '공격형 (aggressive)',
    defensive: '방어형 (defensive)',
    marathon: '마라톤형 (marathon)',
    human: '인간 플레이어'
};

function computeErrorMetrics(actual, expected) {
    const a = Number(actual) || 0;
    const e = Number(expected) || 0;
    const diff = a - e;
    if (Math.abs(e) > 1e-9) {
        return {
            diff,
            absErrorPct: (Math.abs(diff) / Math.abs(e)) * 100,
            signedErrorPct: (diff / Math.abs(e)) * 100
        };
    }
    return {
        diff,
        absErrorPct: Math.abs(a) > 1e-9 ? 100 : 0,
        signedErrorPct: 0
    };
}

function buildCardCatalogRarityAudit(cardMaps, totalDraws, perMatchUnusedCatalogCounts, matchCount) {
    const drawCountMap = new Map();
    for (const grade of ['normal', 'special', 'treasure']) {
        for (const [id, entry] of cardMaps[grade].entries()) {
            drawCountMap.set(Number(id), Number(entry.count) || 0);
        }
    }

    const catalogEntries = ALL_CARDS_CATALOG.map(c => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        count: drawCountMap.get(c.id) || 0
    }));

    const catalogSize = catalogEntries.length || 1;
    const overallCardAvg = totalDraws / catalogSize;
    const rareThreshold = Math.max(1, Math.floor(overallCardAvg * 0.25));
    const sortedAsc = [...catalogEntries].sort((a, b) => a.count - b.count || a.id - b.id);
    const sortedDesc = [...catalogEntries].sort((a, b) => b.count - a.count || a.id - b.id);
    const nonZeroAsc = sortedAsc.filter(c => c.count > 0);

    const unusedCards = sortedAsc.filter(c => c.count === 0);
    const rareCards = sortedAsc.filter(c => c.count > 0 && c.count <= rareThreshold);
    const leastDrawnCard = sortedAsc[0] || null;
    const leastDrawnNonZeroCard = nonZeroAsc[0] || null;
    const mostDrawnCard = sortedDesc[0] || null;
    const bottom5Cards = sortedAsc.slice(0, 5);
    const bottomNonZero5Cards = nonZeroAsc.slice(0, 5);
    const bottom5Avg = summarizeSeries(bottom5Cards.map(c => c.count)).mean;
    const bottomNonZero5Avg = summarizeSeries(bottomNonZero5Cards.map(c => c.count)).mean;
    const topBottomMidAvg = mostDrawnCard && leastDrawnCard ? (mostDrawnCard.count + leastDrawnCard.count) / 2 : 0;
    const topBottomNonZeroMidAvg = mostDrawnCard && leastDrawnNonZeroCard ? (mostDrawnCard.count + leastDrawnNonZeroCard.count) / 2 : 0;

    // 등급 분류별(일반/특수/보물) 이론 균등 기댓값 vs 실제 뽑힌 횟수 괴리감 분석
    const gradeMetaList = [
        { key: 'normal', label: '일반 카드' },
        { key: 'special', label: '특수 카드' },
        { key: 'treasure', label: '보물 카드' }
    ];
    const gradeExpectationAudits = gradeMetaList.map(gm => {
        const cardsInGrade = catalogEntries
            .filter(c => c.grade === gm.key)
            .sort((a, b) => a.id - b.id);
        const cardCount = cardsInGrade.length || 1;
        const gradeTotalDraws = cardsInGrade.reduce((s, c) => s + c.count, 0);
        const expectedPerCard = gradeTotalDraws / cardCount;
        const expectedSharePct = 100 / cardCount;

        const analyzedCards = cardsInGrade.map(c => {
            const diff = c.count - expectedPerCard;
            const err = computeErrorMetrics(c.count, expectedPerCard);
            const actualSharePct = gradeTotalDraws > 0 ? clampPct((c.count / gradeTotalDraws) * 100) : 0;
            return {
                id: c.id,
                name: c.name,
                grade: c.grade,
                actual: c.count,
                expected: expectedPerCard,
                diff,
                actualSharePct,
                expectedSharePct,
                absError: err.absError,
                absErrorPct: err.absErrorPct,
                signedErrorPct: err.signedErrorPct
            };
        });

        const byDiffDesc = [...analyzedCards].sort((a, b) => b.diff - a.diff || a.id - b.id);
        const byDiffAsc = [...analyzedCards].sort((a, b) => a.diff - b.diff || a.id - b.id);
        const sqErrSum = analyzedCards.reduce((s, c) => s + (c.diff * c.diff), 0);

        return {
            grade: gm.key,
            label: gm.label,
            cardCount: cardsInGrade.length,
            gradeTotalDraws,
            expectedPerCard,
            expectedSharePct,
            meanAbsErrorPct: summarizeSeries(analyzedCards.map(c => c.absErrorPct)).mean,
            rmse: cardsInGrade.length > 0 ? Math.sqrt(sqErrSum / cardsInGrade.length) : 0,
            maxOverCard: byDiffDesc[0] || null,
            maxUnderCard: byDiffAsc[0] || null,
            cards: analyzedCards
        };
    });

    return {
        catalogSize,
        matchCount,
        totalDraws,
        overallCardAvg,
        rareThreshold,
        drawnCatalogCount: nonZeroAsc.length,
        unusedCount: unusedCards.length,
        unusedByGrade: {
            normal: unusedCards.filter(c => c.grade === 'normal').length,
            special: unusedCards.filter(c => c.grade === 'special').length,
            treasure: unusedCards.filter(c => c.grade === 'treasure').length
        },
        unusedCards,
        rareCount: rareCards.length,
        rareCards: rareCards.slice(0, 15),
        leastDrawnCard,
        leastDrawnNonZeroCard,
        mostDrawnCard,
        bottom5Cards,
        bottomNonZero5Cards,
        bottom5Avg,
        bottomNonZero5Avg,
        topBottomMidAvg,
        topBottomNonZeroMidAvg,
        matchUnusedCatalog: summarizeSeries(perMatchUnusedCatalogCounts),
        errLeastVsOverall: computeErrorMetrics(leastDrawnCard ? leastDrawnCard.count : 0, overallCardAvg),
        errLeastVsTopBottom: computeErrorMetrics(leastDrawnCard ? leastDrawnCard.count : 0, topBottomMidAvg),
        errBottom5VsOverall: computeErrorMetrics(bottom5Avg, overallCardAvg),
        errBottom5VsTopBottom: computeErrorMetrics(bottom5Avg, topBottomMidAvg),
        errNonZeroLeastVsOverall: computeErrorMetrics(leastDrawnNonZeroCard ? leastDrawnNonZeroCard.count : 0, overallCardAvg),
        gradeExpectationAudits
    };
}

function aggregateGimmickBatchAnalytics(cycles) {
    const count = Array.isArray(cycles) ? cycles.length : 0;
    const pct = (part, whole) => (whole > 0 ? clampPct((part / whole) * 100) : 0);

    const furryCardSeries = { 201: [], 202: [], 203: [], 204: [], total: [] };
    const furryOpenSeries = [];
    const furryActualAll = [];
    const furryActualConv = [];
    const furryExpAll = [];
    const furryExpConv = [];
    let furryLakeOwnedMatches = 0;
    let furryConvertedMatches = 0;
    let furryEndedOpenMatches = 0;
    let furryEntryTollSum = 0;
    let furrySettleUpliftSum = 0;
    let furryKimPaidSum = 0;
    let furryManualOpenSum = 0;
    let furryManualOpenCostSum = 0;
    let furryExtraRestSum = 0;
    let furryBaselineRestSum = 0;

    const treasCardSeries = { 111: [], 112: [], 113: [], 114: [], specialTotal: [], activeUses: [], total: [] };

    const mtnBuySeries = [];
    const mtnInvAll = [];
    const mtnInvAct = [];
    const mtnTollAll = [];
    const mtnTollAct = [];
    const mtnNetAll = [];
    const mtnNetAct = [];
    const mtnExpAll = [];
    const mtnExpAct = [];

    const forgAcqSeries = [];
    const forgRecSeries = [];
    const forgPerMatchRateSeries = [];
    let forgExpProbSum = 0;

    const origDrawnSeries = [];
    const origPerMatchRollRateSeries = [];
    let origEligibleRollsSum = 0;
    let origCoinWinsSum = 0;

    const sootCashAll = [];
    const sootCashTrig = [];
    const sootTotalAll = [];
    const sootTotalTrig = [];
    const sootExpAll = [];
    const sootExpTrig = [];
    const sootMakashaTrig = [];
    const sootDiscountTrig = [];
    const sootExtraTollTrig = [];
    const sootLapBlockedTrig = [];
    const sootSkillCostTrig = [];
    const sootDestroyValTrig = [];
    const sootPlayerCashTrig = [];
    const sootPlayerTotalTrig = [];
    const sootB1Cash = [], sootB1Total = [], sootB1Exp = [];
    const sootB2BossCash = [], sootB2BossTotal = [], sootB2BossExp = [];
    const sootB2BossTollAct = [], sootB2BossTollExp = [];
    const sootB2DestroyAct = [], sootB2DestroyExp = [];
    const sootB2OppCash = [], sootB2OppTotal = [], sootB2OppExp = [];
    let sootHaloConvAttemptsSum = 0;
    let sootHaloConvExpSum = 0;
    let sootHaloConvActSum = 0;
    let sootHaloCardMatches = 0;

    const haloAll = [], haloTrig = [], haloExpAll = [], haloExpTrig = [];
    const haloDebAct = [], haloDebExp = [], haloOppAct = [], haloOppExp = [];
    const haloKarmaAct = [], haloKarmaExp = [], haloKarmaOppAct = [], haloKarmaOppExp = [];
    const haloRegretAct = [], haloRegretExp = [], haloRegretOppAct = [], haloRegretOppExp = [];
    const haloNatUniAct = [], haloNatUniExp = [];
    const haloPlayerNetTrig = [];
    let haloCardMatches = 0, haloNaturalMatches = 0;
    let haloTollGainSum = 0, haloPosGainSum = 0, haloLapLossSum = 0, haloPayerDiffSum = 0;

    const dnTotalAll = [];
    const dnTotalAct = [];
    const dnDayAct = [];
    const dnNightAct = [];
    const dnExpAll = [];
    const dnExpAct = [];
    const dnPlayerGainAct = [];
    const dnPlayerLossAct = [];
    const dnPlayerNetAct = [];
    let dnDayTurnsSum = 0;
    let dnNightTurnsSum = 0;

    const altarVisitAll = [], altarRollVisitAll = [], altarExpRollAll = [], altarExpTotAll = [];
    const altarTradeCntAll = [], altarTradeCardsAll = [];
    const altarTopCombAct = [], altarTopCombExp = [], altarTopRewardAct = [], altarTopSootAct = [];
    const altarTopVsBossTop = [], altarTopVsBossRef = [];
    let altarTopReincarnatedCount = 0;
    let altarManualTradeMatches = 0;

    const voidVisitAll = [], voidRollVisitAll = [], voidCardArrAll = [], voidExpRollAll = [], voidExpTotAll = [];
    const voidTrappedAll = [], voidPulledAll = [], voidRimEvadedAll = [];
    const voidChallengeAll = [], voidEscSuccAll = [], voidEscFailAll = [];
    const voidDmgAll = [], voidDmgAct = [], voidLapLossAll = [], voidUpkeepLossAll = [], voidExpArrivalDmgAll = [];
    let voidTrappedPlayers = 0, voidTrappedWins = 0, voidUntrappedPlayers = 0, voidUntrappedWins = 0;

    for (const c of (cycles || [])) {
        const m = c.metrics || {};
        const fa = m.furryAnalytics || {};
        const fc = fa.cardCounts || {};
        furryCardSeries[201].push(Number(fc[201]) || 0);
        furryCardSeries[202].push(Number(fc[202]) || 0);
        furryCardSeries[203].push(Number(fc[203]) || 0);
        furryCardSeries[204].push(Number(fc[204]) || 0);
        furryCardSeries.total.push(Number(fa.totalCardUses) || 0);
        const fOpen = Number(fa.openCount) || 0;
        const fAct = Number(fa.actualGain) || 0;
        const fExp = Number(fa.expectedGain) || 0;
        furryOpenSeries.push(fOpen);
        furryActualAll.push(fAct);
        furryExpAll.push(fExp);
        if (fa.lakeOwned) furryLakeOwnedMatches++;
        if (fOpen > 0) {
            furryConvertedMatches++;
            furryActualConv.push(fAct);
            furryExpConv.push(fExp);
        }
        if (fa.endedAsFurry) furryEndedOpenMatches++;
        furryEntryTollSum += Number(fa.entryTollTotal) || 0;
        furrySettleUpliftSum += Number(fa.settleUplift) || 0;
        furryKimPaidSum += Number(fa.kimWorkerPaidTotal) || 0;
        furryManualOpenSum += Number(fa.manualOpenCount) || 0;
        furryManualOpenCostSum += Number(fa.manualOpenCost) || 0;
        furryExtraRestSum += Number(fa.extraRestCount) || 0;
        furryBaselineRestSum += Number(fa.baselineRestCount) || 0;

        const ta = m.treasureCardAnalytics || {};
        const tsc = ta.specialCounts || {};
        treasCardSeries[111].push(Number(tsc[111]) || 0);
        treasCardSeries[112].push(Number(tsc[112]) || 0);
        treasCardSeries[113].push(Number(tsc[113]) || 0);
        treasCardSeries[114].push(Number(tsc[114]) || 0);
        treasCardSeries.specialTotal.push(Number(ta.specialTotalUses) || 0);
        treasCardSeries.activeUses.push(Number(ta.activeUses) || 0);
        treasCardSeries.total.push(Number(ta.totalTreasureRelatedUses) || 0);

        const ma = m.mountainAnalytics || {};
        const mBuy = Number(ma.buyCount) || 0;
        const mInv = Number(ma.investmentTotal) || 0;
        const mToll = Number(ma.tollExtraTotal) || 0;
        const mNet = Number(ma.actualNetGain) || 0;
        const mExp = Number(ma.expectedNetGain) || 0;
        mtnBuySeries.push(mBuy);
        mtnInvAll.push(mInv);
        mtnTollAll.push(mToll);
        mtnNetAll.push(mNet);
        mtnExpAll.push(mExp);
        if (mBuy > 0) {
            mtnInvAct.push(mInv);
            mtnTollAct.push(mToll);
            mtnNetAct.push(mNet);
            mtnExpAct.push(mExp);
        }

        const mo = m.memoryOriginAnalytics || {};
        const fAcq = Number(mo.forgottenAcquired) || 0;
        const fRec = Number(mo.forgottenRecovered) || 0;
        forgAcqSeries.push(fAcq);
        forgRecSeries.push(fRec);
        forgExpProbSum += Number(mo.forgottenExpectedProbSum) || 0;
        if (fAcq > 0) {
            forgPerMatchRateSeries.push((fRec / fAcq) * 100);
        }

        const oElig = Number(mo.originElifEligibleRolls) || 0;
        const oWins = Number(mo.originElifCoinFlipWins) || 0;
        const oDrawn = Number(mo.originElifDrawnCount) || 0;
        origDrawnSeries.push(oDrawn);
        origEligibleRollsSum += oElig;
        origCoinWinsSum += oWins;
        if (oElig > 0) {
            origPerMatchRollRateSeries.push((oWins / oElig) * 100);
        }

        const sa = m.sootPnlAnalytics || {};
        const sCash = Number(sa.actualCashNet) || 0;
        const sTot = Number(sa.actualTotalNet) || 0;
        const sExp = Number(sa.expectedNet) || 0;
        sootCashAll.push(sCash);
        sootTotalAll.push(sTot);
        sootExpAll.push(sExp);
        if (sa.triggered) {
            sootCashTrig.push(sCash);
            sootTotalTrig.push(sTot);
            sootExpTrig.push(sExp);
            sootMakashaTrig.push(Number(sa.makashaTotal) || 0);
            sootDiscountTrig.push(Number(sa.discountSavedTotal) || 0);
            sootExtraTollTrig.push(Number(sa.extraTollTotal) || 0);
            sootLapBlockedTrig.push(Number(sa.lapBlockedLossTotal) || 0);
            sootSkillCostTrig.push(Number(sa.skillCostTotal) || 0);
            sootDestroyValTrig.push(Number(sa.destroyValueTotal) || 0);
            sootHaloConvAttemptsSum += Number(sa.haloCardDrawAttempts) || 0;
            sootHaloConvExpSum += Number(sa.haloCardExpectedDraws) || 0;
            sootHaloConvActSum += Number(sa.haloCardActualDraws) || 0;
            if (sa.haloCardTriggered) sootHaloCardMatches++;
            if (sa.branch === 1) {
                sootB1Cash.push(sCash);
                sootB1Total.push(sTot);
                sootB1Exp.push(Number(sa.expectedBranch1 ?? sExp) || 0);
            } else if (sa.branch === 2) {
                sootB2BossCash.push(Number(sa.bossActualCash) || 0);
                sootB2BossTotal.push(Number(sa.bossActualTotal) || 0);
                sootB2BossExp.push(Number(sa.expectedBoss) || 0);
                sootB2BossTollAct.push(Number(sa.bossActualToll) || 0);
                sootB2BossTollExp.push(Number(sa.expectedBossToll) || 0);
                sootB2DestroyAct.push(Number(sa.destroyActualValue) || 0);
                sootB2DestroyExp.push(Number(sa.expectedDestroyLoss) || 0);
                sootB2OppCash.push(Number(sa.opposedActualCash) || 0);
                sootB2OppTotal.push(Number(sa.opposedActualTotal) || 0);
                sootB2OppExp.push(Number(sa.expectedOpposed) || 0);
            }
            for (const pe of Object.values(sa.playerPnl || {})) {
                sootPlayerCashTrig.push(Number(pe?.cash) || 0);
                sootPlayerTotalTrig.push(Number(pe?.totalNet) || 0);
            }
        }

        const ha = m.haloPnlAnalytics || {};
        const hTot = Number(ha.actualTotalNet) || 0;
        const hExp = Number(ha.expectedTotal) || 0;
        haloAll.push(hTot);
        haloExpAll.push(hExp);
        if (ha.triggered) {
            haloTrig.push(hTot);
            haloExpTrig.push(hExp);
            if (ha.branchMode === 'card') haloCardMatches++;
            else haloNaturalMatches++;
            haloTollGainSum += Number(ha.tollGainTotal) || 0;
            haloPosGainSum += Number(ha.positiveGainTotal) || 0;
            haloLapLossSum += Number(ha.lapBlockedLossTotal) || 0;
            haloPayerDiffSum += Number(ha.payerTollDiffTotal) || 0;
            const hDebAct = Number(ha.actualDebuffedNet) || 0;
            const hDebExp = Number(ha.expectedDebuffed) || 0;
            const hOppAct = Number(ha.actualOpposedNet) || 0;
            const hOppExp = Number(ha.expectedOpposed) || 0;
            if (ha.debuffType === 'karma' || ha.debuffType === 'regret') {
                haloDebAct.push(hDebAct);
                haloDebExp.push(hDebExp);
                haloOppAct.push(hOppAct);
                haloOppExp.push(hOppExp);
                if (ha.debuffType === 'karma') {
                    haloKarmaAct.push(hDebAct); haloKarmaExp.push(hDebExp);
                    haloKarmaOppAct.push(hOppAct); haloKarmaOppExp.push(hOppExp);
                } else {
                    haloRegretAct.push(hDebAct); haloRegretExp.push(hDebExp);
                    haloRegretOppAct.push(hOppAct); haloRegretOppExp.push(hOppExp);
                }
            } else {
                haloNatUniAct.push(hOppAct);
                haloNatUniExp.push(Number(ha.expectedOpposed ?? hExp) || 0);
            }
            for (const pe of Object.values(ha.playerPnl || {})) {
                haloPlayerNetTrig.push(Number(pe?.net) || 0);
            }
        }

        const da = m.dayNightPnlAnalytics || {};
        const dTurns = Number(da.dayActiveTurns) || 0;
        const nTurns = Number(da.nightActiveTurns) || 0;
        const dToll = Number(da.dayTollExtra) || 0;
        const nToll = Number(da.nightTollExtra) || 0;
        const dnTot = Number(da.totalTollExtra) || 0;
        const dnExp = Number(da.expectedToll) || 0;
        dnDayTurnsSum += dTurns;
        dnNightTurnsSum += nTurns;
        dnTotalAll.push(dnTot);
        dnExpAll.push(dnExp);
        if ((dTurns + nTurns) > 0) {
            dnTotalAct.push(dnTot);
            dnDayAct.push(dToll);
            dnNightAct.push(nToll);
            dnExpAct.push(dnExp);
            for (const pe of Object.values(da.playerPnl || {})) {
                dnPlayerGainAct.push(Number(pe?.gain) || 0);
                dnPlayerLossAct.push(Number(pe?.loss) || 0);
                dnPlayerNetAct.push(Number(pe?.net) || 0);
            }
        }

        const aa = m.altarAnalytics || {};
        altarVisitAll.push(Number(aa.visits) || 0);
        altarRollVisitAll.push(Number(aa.rollVisits) || 0);
        altarExpRollAll.push(Number(aa.expectedRollVisits) || 0);
        altarExpTotAll.push(Number(aa.expectedTotalVisits) || 0);
        altarTradeCntAll.push(Number(aa.tradeCount) || 0);
        altarTradeCardsAll.push(Number(aa.tradeCardsTotal) || 0);
        if (aa.hasTopTrader) {
            altarManualTradeMatches++;
            altarTopCombAct.push(Number(aa.topTraderCombinedActual) || 0);
            altarTopCombExp.push(Number(aa.topTraderCombinedExpected) || 0);
            altarTopRewardAct.push(Number(aa.topTraderTradeReward) || 0);
            altarTopSootAct.push(Number(aa.topTraderSootTotal) || 0);
            if (aa.topTraderIsReincarnated) altarTopReincarnatedCount++;
            if (sa.triggered && sa.branch === 2) {
                altarTopVsBossTop.push(Number(aa.topTraderCombinedActual) || 0);
                altarTopVsBossRef.push(Number(aa.reincarnatedBossActualTotal) || 0);
            }
        }

        const va = m.voidAnalytics || {};
        const vTrapped = Number(va.trappedCount) || 0;
        const vDmg = Number(va.damageTotal) || 0;
        voidVisitAll.push(Number(va.visits) || 0);
        voidRollVisitAll.push(Number(va.rollVisits) || 0);
        voidCardArrAll.push(Number(va.cardArrivals) || 0);
        voidExpRollAll.push(Number(va.expectedRollVisits) || 0);
        voidExpTotAll.push(Number(va.expectedTotalVisits) || 0);
        voidTrappedAll.push(vTrapped);
        voidPulledAll.push(Number(va.pulledCount) || 0);
        voidRimEvadedAll.push(Number(va.rimEvadedCount) || 0);
        voidChallengeAll.push(Number(va.challengeCount) || 0);
        voidEscSuccAll.push(Number(va.escapeSuccessCount) || 0);
        voidEscFailAll.push(Number(va.escapeFailCount) || 0);
        voidDmgAll.push(vDmg);
        voidLapLossAll.push(Number(va.lapLossTotal) || 0);
        voidUpkeepLossAll.push(Number(va.upkeepLossTotal) || 0);
        voidExpArrivalDmgAll.push(Number(va.expectedArrivalDamage) || 0);
        if (vTrapped > 0) voidDmgAct.push(vDmg);
        voidTrappedPlayers += Number(va.trappedPlayers) || 0;
        voidTrappedWins += Number(va.trappedWins) || 0;
        voidUntrappedPlayers += Number(va.untrappedPlayers) || 0;
        voidUntrappedWins += Number(va.untrappedWins) || 0;
    }

    const furryActMean = summarizeSeries(furryActualAll);
    const furryExpMean = summarizeSeries(furryExpAll);
    const furryConvActMean = summarizeSeries(furryActualConv);
    const furryConvExpMean = summarizeSeries(furryExpConv);

    const mtnNetAllSum = summarizeSeries(mtnNetAll);
    const mtnExpAllSum = summarizeSeries(mtnExpAll);
    const mtnNetActSum = summarizeSeries(mtnNetAct);
    const mtnExpActSum = summarizeSeries(mtnExpAct);

    const forgAcqSum = summarizeSeries(forgAcqSeries);
    const forgRecSum = summarizeSeries(forgRecSeries);
    const totalForgAcq = forgAcqSeries.reduce((s, v) => s + v, 0);
    const totalForgRec = forgRecSeries.reduce((s, v) => s + v, 0);
    const overallForgRatePct = pct(totalForgRec, totalForgAcq);
    const expectedForgRatePct = pct(forgExpProbSum, totalForgAcq);

    const origDrawnSum = summarizeSeries(origDrawnSeries);
    const totalOrigDrawn = origDrawnSeries.reduce((s, v) => s + v, 0);
    const overallOrigCondPct = pct(origCoinWinsSum, origEligibleRollsSum);
    const overallOrigMatchPct = pct(totalOrigDrawn, count);

    const sootCashAllSum = summarizeSeries(sootCashAll);
    const sootTotAllSum = summarizeSeries(sootTotalAll);
    const sootExpAllSum = summarizeSeries(sootExpAll);
    const sootCashTrigSum = summarizeSeries(sootCashTrig);
    const sootTotTrigSum = summarizeSeries(sootTotalTrig);
    const sootExpTrigSum = summarizeSeries(sootExpTrig);
    const sootB1CashSum = summarizeSeries(sootB1Cash);
    const sootB1TotSum = summarizeSeries(sootB1Total);
    const sootB1ExpSum = summarizeSeries(sootB1Exp);
    const sootB2BossCashSum = summarizeSeries(sootB2BossCash);
    const sootB2BossTotSum = summarizeSeries(sootB2BossTotal);
    const sootB2BossExpSum = summarizeSeries(sootB2BossExp);
    const sootB2OppCashSum = summarizeSeries(sootB2OppCash);
    const sootB2OppTotSum = summarizeSeries(sootB2OppTotal);
    const sootB2OppExpSum = summarizeSeries(sootB2OppExp);
    const sootB2BossTollActSum = summarizeSeries(sootB2BossTollAct);
    const sootB2BossTollExpSum = summarizeSeries(sootB2BossTollExp);
    const sootB2DestroyActSum = summarizeSeries(sootB2DestroyAct);
    const sootB2DestroyExpSum = summarizeSeries(sootB2DestroyExp);
    const sootHaloConvActRatePct = pct(sootHaloConvActSum, sootHaloConvAttemptsSum);
    const sootHaloConvExpRatePct = pct(sootHaloConvExpSum, sootHaloConvAttemptsSum);

    const haloAllSum = summarizeSeries(haloAll);
    const haloExpAllSum = summarizeSeries(haloExpAll);
    const haloTrigSum = summarizeSeries(haloTrig);
    const haloExpTrigSum = summarizeSeries(haloExpTrig);
    const haloDebActSum = summarizeSeries(haloDebAct);
    const haloDebExpSum = summarizeSeries(haloDebExp);
    const haloOppActSum = summarizeSeries(haloOppAct);
    const haloOppExpSum = summarizeSeries(haloOppExp);
    const haloKarmaActSum = summarizeSeries(haloKarmaAct);
    const haloKarmaExpSum = summarizeSeries(haloKarmaExp);
    const haloKarmaOppActSum = summarizeSeries(haloKarmaOppAct);
    const haloKarmaOppExpSum = summarizeSeries(haloKarmaOppExp);
    const haloRegretActSum = summarizeSeries(haloRegretAct);
    const haloRegretExpSum = summarizeSeries(haloRegretExp);
    const haloRegretOppActSum = summarizeSeries(haloRegretOppAct);
    const haloRegretOppExpSum = summarizeSeries(haloRegretOppExp);
    const haloNatUniActSum = summarizeSeries(haloNatUniAct);
    const haloNatUniExpSum = summarizeSeries(haloNatUniExp);

    const dnTotAllSum = summarizeSeries(dnTotalAll);
    const dnExpAllSum = summarizeSeries(dnExpAll);
    const dnTotActSum = summarizeSeries(dnTotalAct);
    const dnExpActSum = summarizeSeries(dnExpAct);

    return {
        furry: {
            card201: summarizeSeries(furryCardSeries[201]),
            card202: summarizeSeries(furryCardSeries[202]),
            card203: summarizeSeries(furryCardSeries[203]),
            card204: summarizeSeries(furryCardSeries[204]),
            cardsTotal: summarizeSeries(furryCardSeries.total),
            opensPerMatch: summarizeSeries(furryOpenSeries),
            lakeOwnedMatches: furryLakeOwnedMatches,
            lakeOwnedRatePct: pct(furryLakeOwnedMatches, count),
            convertedMatches: furryConvertedMatches,
            conversionRateAllPct: pct(furryConvertedMatches, count),
            conversionRateOwnedPct: pct(furryConvertedMatches, furryLakeOwnedMatches),
            endedOpenMatches: furryEndedOpenMatches,
            endedOpenRatePct: pct(furryEndedOpenMatches, count),
            entryTollAvg: count > 0 ? furryEntryTollSum / count : 0,
            settleUpliftAvg: count > 0 ? furrySettleUpliftSum / count : 0,
            kimPaidAvg: count > 0 ? furryKimPaidSum / count : 0,
            manualOpenAvg: count > 0 ? furryManualOpenSum / count : 0,
            manualOpenCostAvg: count > 0 ? furryManualOpenCostSum / count : 0,
            extraRestAvg: count > 0 ? furryExtraRestSum / count : 0,
            baselineRestAvg: count > 0 ? furryBaselineRestSum / count : 0,
            actualAll: furryActMean,
            expectedAll: furryExpMean,
            actualConverted: furryConvActMean,
            expectedConverted: furryConvExpMean,
            errorAll: computeErrorMetrics(furryActMean.mean, furryExpMean.mean),
            errorConverted: computeErrorMetrics(furryConvActMean.mean, furryConvExpMean.mean)
        },
        treasureCards: {
            card111: summarizeSeries(treasCardSeries[111]),
            card112: summarizeSeries(treasCardSeries[112]),
            card113: summarizeSeries(treasCardSeries[113]),
            card114: summarizeSeries(treasCardSeries[114]),
            specialTotal: summarizeSeries(treasCardSeries.specialTotal),
            activeUses: summarizeSeries(treasCardSeries.activeUses),
            total: summarizeSeries(treasCardSeries.total)
        },
        mountain: {
            buysPerMatch: summarizeSeries(mtnBuySeries),
            buyMatches: mtnNetAct.length,
            buyMatchRatePct: pct(mtnNetAct.length, count),
            investmentAll: summarizeSeries(mtnInvAll),
            investmentActive: summarizeSeries(mtnInvAct),
            tollExtraAll: summarizeSeries(mtnTollAll),
            tollExtraActive: summarizeSeries(mtnTollAct),
            actualNetAll: mtnNetAllSum,
            expectedNetAll: mtnExpAllSum,
            actualNetActive: mtnNetActSum,
            expectedNetActive: mtnExpActSum,
            errorAll: computeErrorMetrics(mtnNetAllSum.mean, mtnExpAllSum.mean),
            errorActive: computeErrorMetrics(mtnNetActSum.mean, mtnExpActSum.mean)
        },
        memoryOrigin: {
            acquiredPerMatch: forgAcqSum,
            recoveredPerMatch: forgRecSum,
            totalAcquired: totalForgAcq,
            totalRecovered: totalForgRec,
            perMatchRate: summarizeSeries(forgPerMatchRateSeries),
            overallRatePct: overallForgRatePct,
            expectedRatePct: expectedForgRatePct,
            recoveryError: computeErrorMetrics(overallForgRatePct, expectedForgRatePct),
            originDrawnPerMatch: origDrawnSum,
            totalOriginDrawn: totalOrigDrawn,
            overallOriginMatchPct: overallOrigMatchPct,
            eligibleRollsSum: origEligibleRollsSum,
            coinFlipWinsSum: origCoinWinsSum,
            perMatchCondRate: summarizeSeries(origPerMatchRollRateSeries),
            overallCondRatePct: overallOrigCondPct,
            expectedCondRatePct: 50,
            condRateError: computeErrorMetrics(overallOrigCondPct, 50),
            expectedCoinWins: origEligibleRollsSum * 0.5,
            coinWinsError: computeErrorMetrics(origCoinWinsSum, origEligibleRollsSum * 0.5)
        },
        soot: {
            triggeredMatches: sootCashTrig.length,
            triggerRatePct: pct(sootCashTrig.length, count),
            cashAll: sootCashAllSum,
            totalAll: sootTotAllSum,
            expectedAll: sootExpAllSum,
            cashTrig: sootCashTrigSum,
            totalTrig: sootTotTrigSum,
            expectedTrig: sootExpTrigSum,
            makashaTrig: summarizeSeries(sootMakashaTrig),
            discountTrig: summarizeSeries(sootDiscountTrig),
            extraTollTrig: summarizeSeries(sootExtraTollTrig),
            lapBlockedTrig: summarizeSeries(sootLapBlockedTrig),
            skillCostTrig: summarizeSeries(sootSkillCostTrig),
            destroyValTrig: summarizeSeries(sootDestroyValTrig),
            playerCashTrig: summarizeSeries(sootPlayerCashTrig),
            playerTotalTrig: summarizeSeries(sootPlayerTotalTrig),
            errorCashAll: computeErrorMetrics(sootCashAllSum.mean, sootExpAllSum.mean),
            errorTotalAll: computeErrorMetrics(sootTotAllSum.mean, sootExpAllSum.mean),
            errorCashTrig: computeErrorMetrics(sootCashTrigSum.mean, sootExpTrigSum.mean),
            errorTotalTrig: computeErrorMetrics(sootTotTrigSum.mean, sootExpTrigSum.mean),
            branch1: {
                matches: sootB1Total.length,
                cash: sootB1CashSum,
                total: sootB1TotSum,
                expected: sootB1ExpSum,
                errorCash: computeErrorMetrics(sootB1CashSum.mean, sootB1ExpSum.mean),
                errorTotal: computeErrorMetrics(sootB1TotSum.mean, sootB1ExpSum.mean)
            },
            branch2: {
                matches: sootB2BossTotal.length,
                bossCash: sootB2BossCashSum,
                bossTotal: sootB2BossTotSum,
                bossExpected: sootB2BossExpSum,
                errorBossCash: computeErrorMetrics(sootB2BossCashSum.mean, sootB2BossExpSum.mean),
                errorBossTotal: computeErrorMetrics(sootB2BossTotSum.mean, sootB2BossExpSum.mean),
                bossTollActual: sootB2BossTollActSum,
                bossTollExpected: sootB2BossTollExpSum,
                errorBossToll: computeErrorMetrics(sootB2BossTollActSum.mean, sootB2BossTollExpSum.mean),
                destroyActual: sootB2DestroyActSum,
                destroyExpected: sootB2DestroyExpSum,
                errorDestroy: computeErrorMetrics(sootB2DestroyActSum.mean, sootB2DestroyExpSum.mean),
                oppCash: sootB2OppCashSum,
                oppTotal: sootB2OppTotSum,
                oppExpected: sootB2OppExpSum,
                errorOppCash: computeErrorMetrics(sootB2OppCashSum.mean, sootB2OppExpSum.mean),
                errorOppTotal: computeErrorMetrics(sootB2OppTotSum.mean, sootB2OppExpSum.mean)
            },
            haloConversion: {
                attempts: sootHaloConvAttemptsSum,
                expectedDraws: sootHaloConvExpSum,
                actualDraws: sootHaloConvActSum,
                expectedRatePct: sootHaloConvExpRatePct,
                actualRatePct: sootHaloConvActRatePct,
                errorRate: computeErrorMetrics(sootHaloConvActRatePct, sootHaloConvExpRatePct),
                convertedMatches: sootHaloCardMatches,
                convertedMatchRatePct: pct(sootHaloCardMatches, sootCashTrig.length)
            }
        },
        halo: {
            triggeredMatches: haloTrig.length,
            triggerRatePct: pct(haloTrig.length, count),
            cardMatches: haloCardMatches,
            naturalMatches: haloNaturalMatches,
            all: haloAllSum,
            expectedAll: haloExpAllSum,
            errorAll: computeErrorMetrics(haloAllSum.mean, haloExpAllSum.mean),
            trig: haloTrigSum,
            expectedTrig: haloExpTrigSum,
            errorTrig: computeErrorMetrics(haloTrigSum.mean, haloExpTrigSum.mean),
            debuffedMatches: haloDebAct.length,
            debuffed: haloDebActSum,
            debuffedExpected: haloDebExpSum,
            errorDebuffed: computeErrorMetrics(haloDebActSum.mean, haloDebExpSum.mean),
            opp: haloOppActSum,
            oppExpected: haloOppExpSum,
            errorOpp: computeErrorMetrics(haloOppActSum.mean, haloOppExpSum.mean),
            karmaMatches: haloKarmaAct.length,
            karma: haloKarmaActSum,
            karmaExpected: haloKarmaExpSum,
            errorKarma: computeErrorMetrics(haloKarmaActSum.mean, haloKarmaExpSum.mean),
            karmaOpp: haloKarmaOppActSum,
            karmaOppExpected: haloKarmaOppExpSum,
            errorKarmaOpp: computeErrorMetrics(haloKarmaOppActSum.mean, haloKarmaOppExpSum.mean),
            regretMatches: haloRegretAct.length,
            regret: haloRegretActSum,
            regretExpected: haloRegretExpSum,
            errorRegret: computeErrorMetrics(haloRegretActSum.mean, haloRegretExpSum.mean),
            regretOpp: haloRegretOppActSum,
            regretOppExpected: haloRegretOppExpSum,
            errorRegretOpp: computeErrorMetrics(haloRegretOppActSum.mean, haloRegretOppExpSum.mean),
            naturalUniformMatches: haloNatUniAct.length,
            naturalUniform: haloNatUniActSum,
            naturalUniformExpected: haloNatUniExpSum,
            errorNaturalUniform: computeErrorMetrics(haloNatUniActSum.mean, haloNatUniExpSum.mean),
            playerNetTrig: summarizeSeries(haloPlayerNetTrig),
            tollGainAvg: haloTrig.length > 0 ? haloTollGainSum / haloTrig.length : 0,
            posGainAvg: haloTrig.length > 0 ? haloPosGainSum / haloTrig.length : 0,
            lapBlockedAvg: haloTrig.length > 0 ? haloLapLossSum / haloTrig.length : 0,
            payerTollDiffAvg: haloTrig.length > 0 ? haloPayerDiffSum / haloTrig.length : 0
        },
        dayNight: {
            activeMatches: dnTotalAct.length,
            dayTurnsTotal: dnDayTurnsSum,
            nightTurnsTotal: dnNightTurnsSum,
            totalAll: dnTotAllSum,
            expectedAll: dnExpAllSum,
            totalActive: dnTotActSum,
            dayActive: summarizeSeries(dnDayAct),
            nightActive: summarizeSeries(dnNightAct),
            expectedActive: dnExpActSum,
            playerGainActive: summarizeSeries(dnPlayerGainAct),
            playerLossActive: summarizeSeries(dnPlayerLossAct),
            playerNetActive: summarizeSeries(dnPlayerNetAct),
            errorAll: computeErrorMetrics(dnTotAllSum.mean, dnExpAllSum.mean),
            errorActive: computeErrorMetrics(dnTotActSum.mean, dnExpActSum.mean)
        },
        altar: (() => {
            const visits = summarizeSeries(altarVisitAll);
            const rollVisits = summarizeSeries(altarRollVisitAll);
            const expRollVisits = summarizeSeries(altarExpRollAll);
            const expTotVisits = summarizeSeries(altarExpTotAll);
            const topCombAct = summarizeSeries(altarTopCombAct);
            const topCombExp = summarizeSeries(altarTopCombExp);
            const topVsBossTop = summarizeSeries(altarTopVsBossTop);
            const topVsBossRef = summarizeSeries(altarTopVsBossRef);
            return {
                visits,
                rollVisits,
                expectedRollVisits: expRollVisits,
                expectedTotalVisits: expTotVisits,
                errorRollVisits: computeErrorMetrics(rollVisits.mean, expRollVisits.mean),
                errorTotalVisits: computeErrorMetrics(visits.mean, expTotVisits.mean),
                tradeCount: summarizeSeries(altarTradeCntAll),
                tradeCards: summarizeSeries(altarTradeCardsAll),
                traderMatches: altarManualTradeMatches,
                traderMatchRatePct: pct(altarManualTradeMatches, count),
                topTraderReincarnatedCount: altarTopReincarnatedCount,
                topTraderCombinedActual: topCombAct,
                topTraderCombinedExpected: topCombExp,
                errorTopTraderCombined: computeErrorMetrics(topCombAct.mean, topCombExp.mean),
                topTraderRewardActual: summarizeSeries(altarTopRewardAct),
                topTraderSootActual: summarizeSeries(altarTopSootAct),
                bossCompareMatches: altarTopVsBossTop.length,
                topTraderInB2Actual: topVsBossTop,
                reincarnatedBossActual: topVsBossRef
            };
        })(),
        voidGimmick: (() => {
            const visits = summarizeSeries(voidVisitAll);
            const rollVisits = summarizeSeries(voidRollVisitAll);
            const expRollVisits = summarizeSeries(voidExpRollAll);
            const expTotVisits = summarizeSeries(voidExpTotAll);
            const dmgAll = summarizeSeries(voidDmgAll);
            const expArrDmgAll = summarizeSeries(voidExpArrivalDmgAll);
            const challengeCount = summarizeSeries(voidChallengeAll);
            const escapeSuccessCount = summarizeSeries(voidEscSuccAll);
            const escapeFailCount = summarizeSeries(voidEscFailAll);
            const totalChallenges = voidChallengeAll.reduce((a, b) => a + b, 0);
            const totalEscSucc = voidEscSuccAll.reduce((a, b) => a + b, 0);
            return {
                visits,
                rollVisits,
                cardArrivals: summarizeSeries(voidCardArrAll),
                expectedRollVisits: expRollVisits,
                expectedTotalVisits: expTotVisits,
                errorRollVisits: computeErrorMetrics(rollVisits.mean, expRollVisits.mean),
                errorTotalVisits: computeErrorMetrics(visits.mean, expTotVisits.mean),
                trappedCount: summarizeSeries(voidTrappedAll),
                pulledCount: summarizeSeries(voidPulledAll),
                rimEvadedCount: summarizeSeries(voidRimEvadedAll),
                challengeCount,
                escapeSuccessCount,
                escapeFailCount,
                escapeRatePct: pct(totalEscSucc, totalChallenges),
                expectedEscapeRatePct: (65 / 144) * 100,
                damageAll: dmgAll,
                damageActive: summarizeSeries(voidDmgAct),
                activeMatches: voidDmgAct.length,
                activeMatchRatePct: pct(voidDmgAct.length, count),
                lapLossAll: summarizeSeries(voidLapLossAll),
                upkeepLossAll: summarizeSeries(voidUpkeepLossAll),
                expectedArrivalDamageAll: expArrDmgAll,
                errorDamageAll: computeErrorMetrics(dmgAll.mean, expArrDmgAll.mean),
                trappedPlayers: voidTrappedPlayers,
                trappedWins: voidTrappedWins,
                trappedWinRatePct: pct(voidTrappedWins, voidTrappedPlayers),
                untrappedPlayers: voidUntrappedPlayers,
                untrappedWins: voidUntrappedWins,
                untrappedWinRatePct: pct(voidUntrappedWins, voidUntrappedPlayers)
            };
        })()
    };
}

/**
 * 다수의 사이클 배열에 대해 대출 상세·카드 등급별 통계·추가 밸런싱 진단 지표를 통합 산출하는 공용 헬퍼
 */
export function aggregateDetailedBatchMetrics(cycles) {
    const count = Array.isArray(cycles) ? cycles.length : 0;
    const perMatchUnusedCatalogCounts = [];
    const perMatchLapCounts = [];
    const perPlayerLapCounts = [];
    const singleLoanAmounts = [];
    const borrowerBorrowedPrincipals = [];
    const allPlayerRawDebts = [];
    const holderRawDebts = [];
    const holderPrincipals = [];
    const holderInterests = [];
    const matchLoansPerMatch = [];
    const matchBorrowedAll = [];
    const matchBorrowedActive = [];
    const matchTollTotals = [];
    const matchTollCounts = [];

    let totalLoans = 0;
    let tollLoans = 0;
    let emergencyLoans = 0;
    let totalBorrowedPrincipal = 0;
    let totalDebtRaw = 0;
    let totalDebtSettled = 0;
    let totalInterest = 0;
    let totalRepayCount = 0;
    let totalRepaidAmount = 0;
    let totalInterestConvertedCount = 0;
    let totalInterestConvertedAmount = 0;
    let totalFullClearedCount = 0;
    let matchesWithLoan = 0;
    let totalPlayers = 0;
    let borrowerPlayers = 0;
    let debtHolderPlayers = 0;
    const loanCountWinStats = new Map();
    let mostLoanPlayers = 0;
    let mostLoanWins = 0;
    let leastLoanPlayers = 0;
    let leastLoanWins = 0;

    let totalTollsAmount = 0;
    let totalTollsCount = 0;
    let minSingleToll = null;
    let maxSingleToll = 0;
    let minMatchTollRec = null;
    let maxMatchTollRec = null;

    let minSingleLoanRec = null;
    let maxSingleLoanRec = null;
    let maxLoanCountRec = { value: 0, playerName: '-', roomId: '-' };
    let maxBorrowedRec = { value: 0, playerName: '-', roomId: '-' };
    let maxInterestRec = { value: 0, playerName: '-', roomId: '-' };
    let maxDebtRec = { value: 0, playerName: '-', roomId: '-' };

    const gradeCounts = { normal: 0, special: 0, treasure: 0 };
    const cardMaps = { normal: new Map(), special: new Map(), treasure: new Map() };
    const treasureAcquireMap = new Map();
    let altarPortalTreasures = 0;
    let probTableTreasures = 0;
    let odysseyTreasures = 0;
    let stolenTreasures = 0;
    let duplicateAnomalies = 0;
    let deckReshuffles = 0;
    let unusedInventoryTotal = 0;
    let totalCardsDrawnAll = 0;
    let activeCardsUsedAll = 0;

    const seatStats = new Map();
    const aiStats = new Map();
    const buildingLevelTotals = [0, 0, 0, 0, 0];
    let landmarkHolders = 0;
    let landmarkHolderWins = 0;
    let dayaHolders = 0;
    let dayaWins = 0;
    let bbangjuChiefs = 0;
    let bbangjuWins = 0;
    let totalGrossAsset = 0;
    const gimmickTurns = { none: 0, day: 0, night: 0, soot: 0, halo: 0, total: 0 };

    const addHistogramEntry = (targetMap, rawEntry) => {
        if (!rawEntry || rawEntry.id === undefined) return;
        const id = Number(rawEntry.id);
        if (!targetMap.has(id)) {
            targetMap.set(id, {
                id,
                name: rawEntry.name || String(id),
                grade: rawEntry.grade || (id >= 500 ? 'treasure' : (id >= 100 ? 'special' : 'normal')),
                count: 0
            });
        }
        targetMap.get(id).count += Number(rawEntry.count) || 0;
    };

    for (const c of (cycles || [])) {
        const m = c.metrics || {};
        const ls = m.loanSummary || {};
        const cs = m.cardStats || {};
        const be = m.balanceExtras || {};
        const ps = Array.isArray(c.players) ? c.players : [];

        const matchLoanCnt = ps.reduce((s, p) => s + (p.loanCount || 0), 0);
        const matchBorrowedAmt = ps.reduce((s, p) => s + (Number(p.borrowedPrincipalTotal) || 0), 0);
        matchLoansPerMatch.push(matchLoanCnt);
        matchBorrowedAll.push(matchBorrowedAmt);
        if (matchLoanCnt > 0) {
            matchesWithLoan++;
            matchBorrowedActive.push(matchBorrowedAmt);
            if (ps.length >= 2) {
                const sortedLoan = [...ps].sort((a, b) =>
                    ((Number(b.loanCount) || 0) - (Number(a.loanCount) || 0)) ||
                    ((Number(b.borrowedPrincipalTotal) || 0) - (Number(a.borrowedPrincipalTotal) || 0))
                );
                const topLc = Number(sortedLoan[0].loanCount) || 0;
                const topBor = Number(sortedLoan[0].borrowedPrincipalTotal) || 0;
                const botLast = sortedLoan[sortedLoan.length - 1];
                const botLc = Number(botLast.loanCount) || 0;
                const botBor = Number(botLast.borrowedPrincipalTotal) || 0;
                if (topLc !== botLc || topBor !== botBor) {
                    for (const lp of ps) {
                        const lLc = Number(lp.loanCount) || 0;
                        const lBor = Number(lp.borrowedPrincipalTotal) || 0;
                        const lWin = lp.settlementRank === 1 && !lp.isBankruptFinal;
                        if (lLc === topLc && lBor === topBor) {
                            mostLoanPlayers++;
                            if (lWin) mostLoanWins++;
                        }
                        if (lLc === botLc && lBor === botBor) {
                            leastLoanPlayers++;
                            if (lWin) leastLoanWins++;
                        }
                    }
                }
            }
        }

        const matchTollSum = ps.reduce((s, p) => s + (Number(p.tollsPaidTotal) || 0), 0);
        const matchTollCnt = ps.reduce((s, p) => s + (Number(p.tollsPaidCount) || 0), 0);
        matchTollTotals.push(matchTollSum);
        matchTollCounts.push(matchTollCnt);
        totalTollsAmount += matchTollSum;
        totalTollsCount += matchTollCnt;
        if (!minMatchTollRec || matchTollSum < minMatchTollRec.amount) {
            minMatchTollRec = { amount: matchTollSum, roomId: c.roomId };
        }
        if (!maxMatchTollRec || matchTollSum > maxMatchTollRec.amount) {
            maxMatchTollRec = { amount: matchTollSum, roomId: c.roomId };
        }

        altarPortalTreasures += Number(m.treasureAltarObtainedCount) || 0;
        probTableTreasures += Number(m.treasureProbObtainedCount) || 0;
        odysseyTreasures += Number(m.treasureOdysseyObtainedCount) || 0;
        duplicateAnomalies += Number(cs.duplicateAnomalies) || 0;
        deckReshuffles += Number(cs.deckReshuffleCount) || 0;
        unusedInventoryTotal += Number(cs.unusedInventoryTotal) || 0;
        totalGrossAsset += Number(be.totalGrossAsset) || ps.reduce((s, p) => s + (p.isBankruptFinal ? 0 : Math.max(0, p.totalAsset || 0)), 0);

        const gt = be.gimmickTurnCounts || {};
        for (const key of ['none', 'day', 'night', 'soot', 'halo']) {
            const val = Number(gt[key]) || 0;
            gimmickTurns[key] += val;
            gimmickTurns.total += val;
        }

        const bl = Array.isArray(be.buildingLevelTotals) ? be.buildingLevelTotals : null;
        if (bl) {
            for (let lvl = 0; lvl < 5; lvl++) buildingLevelTotals[lvl] += Number(bl[lvl]) || 0;
        }

        const hist = cs.cardHistogram || {};
        perMatchUnusedCatalogCounts.push(Math.max(0, ALL_CARDS_CATALOG.length - Object.keys(hist).length));
        for (const entry of Object.values(hist)) {
            const grade = entry.grade || (entry.id >= 500 ? 'treasure' : (entry.id >= 100 ? 'special' : 'normal'));
            if (cardMaps[grade]) addHistogramEntry(cardMaps[grade], entry);
        }
        for (const entry of Object.values(cs.treasureAcquireHistogram || {})) {
            addHistogramEntry(treasureAcquireMap, entry);
        }

        const gc = cs.gradeCounts || {};
        gradeCounts.normal += Number(gc.normal) || 0;
        gradeCounts.special += Number(gc.special) || 0;
        gradeCounts.treasure += Number(gc.treasure) || 0;

        perMatchLapCounts.push(ps.reduce((s, p) => s + (Number(p.lapPassCount) || 0), 0));
        for (const p of ps) {
            totalPlayers++;
            perPlayerLapCounts.push(Number(p.lapPassCount) || 0);
            const lc = Number(p.loanCount) || 0;
            const tollLc = Number(p.tollLoanCount) || 0;
            const emLc = Number(p.emergencyLoanCount) || 0;
            const borrowed = Number(p.borrowedPrincipalTotal) || 0;
            const rawPrin = Number(p.loanPrincipal) || 0;
            const rawInt = Number(p.loanInterest) || 0;
            const rawDebt = Number(p.totalLoanRaw ?? (rawPrin + rawInt)) || 0;
            const settledDebt = Number(p.totalLoan) || 0;
            const isWinner = p.settlementRank === 1 && !p.isBankruptFinal;

            const pMinToll = p.minSingleTollPaid;
            if (pMinToll !== null && pMinToll !== undefined && pMinToll > 0) {
                if (minSingleToll === null || pMinToll < minSingleToll) minSingleToll = pMinToll;
            }
            const pMaxToll = Number(p.maxSingleTollPaid) || 0;
            if (pMaxToll > maxSingleToll) maxSingleToll = pMaxToll;

            if (!loanCountWinStats.has(lc)) {
                loanCountWinStats.set(lc, { loanCount: lc, appearances: 0, wins: 0 });
            }
            const lcStat = loanCountWinStats.get(lc);
            lcStat.appearances++;
            if (isWinner) lcStat.wins++;

            totalLoans += lc;
            tollLoans += tollLc;
            emergencyLoans += emLc;
            totalBorrowedPrincipal += borrowed;
            totalDebtRaw += rawDebt;
            totalDebtSettled += settledDebt;
            totalInterest += rawInt;
            totalRepayCount += Number(p.loanRepayCount) || 0;
            totalRepaidAmount += Number(p.loanRepaidTotal) || 0;
            totalInterestConvertedCount += Number(p.loanInterestConvertedCount) || 0;
            totalInterestConvertedAmount += Number(p.loanInterestConvertedTotal) || 0;
            totalFullClearedCount += Number(p.loanFullClearedCount) || 0;
            allPlayerRawDebts.push(rawDebt);

            if (lc > 0) {
                borrowerPlayers++;
                if (borrowed > 0) borrowerBorrowedPrincipals.push(borrowed);
            }
            if (rawDebt > 0) {
                debtHolderPlayers++;
                holderRawDebts.push(rawDebt);
                holderPrincipals.push(rawPrin);
                holderInterests.push(rawInt);
            }

            if (lc > maxLoanCountRec.value) maxLoanCountRec = { value: lc, playerName: p.name, roomId: c.roomId };
            if (borrowed > maxBorrowedRec.value) maxBorrowedRec = { value: borrowed, playerName: p.name, roomId: c.roomId };
            if (rawInt > maxInterestRec.value) maxInterestRec = { value: rawInt, playerName: p.name, roomId: c.roomId };
            if (rawDebt > maxDebtRec.value) maxDebtRec = { value: rawDebt, playerName: p.name, roomId: c.roomId };

            for (const ev of (p.loanEvents || [])) {
                const amt = Number(ev.amount) || 0;
                if (amt <= 0) continue;
                singleLoanAmounts.push(amt);
                if (!minSingleLoanRec || amt < minSingleLoanRec.amount) {
                    minSingleLoanRec = { amount: amt, playerName: p.name, roomId: c.roomId, turn: ev.turn || 1, source: ev.source || 'toll' };
                }
                if (!maxSingleLoanRec || amt > maxSingleLoanRec.amount) {
                    maxSingleLoanRec = { amount: amt, playerName: p.name, roomId: c.roomId, turn: ev.turn || 1, source: ev.source || 'toll' };
                }
            }

            totalCardsDrawnAll += Number(p.cardsDrawn) || 0;
            activeCardsUsedAll += Number(p.activeCardsUsed) || 0;
            stolenTreasures += Number(p.treasureStolenCount) || 0;

            const slot = Number(p.slotIndex) || 1;
            if (!seatStats.has(slot)) {
                seatStats.set(slot, { slotIndex: slot, appearances: 0, wins: 0, rankSum: 0, netWorthSum: 0, bankrupts: 0 });
            }
            const ss = seatStats.get(slot);
            ss.appearances++;
            if (isWinner) ss.wins++;
            ss.rankSum += Number(p.settlementRank) || 4;
            ss.netWorthSum += Number(p.netWorth) || 0;
            if (p.isBankruptFinal) ss.bankrupts++;

            const aiKey = p.aiType || (p.isAi ? 'aggressive' : 'human');
            if (!aiStats.has(aiKey)) {
                aiStats.set(aiKey, {
                    aiType: aiKey,
                    label: AI_TYPE_LABELS[aiKey] || aiKey,
                    appearances: 0,
                    wins: 0,
                    rankSum: 0,
                    netWorthSum: 0,
                    bankrupts: 0,
                    territorySum: 0
                });
            }
            const as = aiStats.get(aiKey);
            as.appearances++;
            if (isWinner) as.wins++;
            as.rankSum += Number(p.settlementRank) || 4;
            as.netWorthSum += Number(p.netWorth) || 0;
            if (p.isBankruptFinal) as.bankrupts++;
            as.territorySum += Number(p.landBuyCount) || 0;

            if ((p.landmarkCount || 0) > 0) {
                landmarkHolders++;
                if (isWinner) landmarkHolderWins++;
            }
            if (p.hasDayaPalace) {
                dayaHolders++;
                if (isWinner) dayaWins++;
            }
            if (p.isBbangjuChief) {
                bbangjuChiefs++;
                if (isWinner) bbangjuWins++;
            }
        }

        if (singleLoanAmounts.length === 0 && (ls.maxSingleLoan || 0) > 0) {
            singleLoanAmounts.push(ls.maxSingleLoan);
        }
    }

    const sortHistogram = (m) => [...m.values()].sort((a, b) => b.count - a.count || a.id - b.id);
    const totalDrawsByGrade = gradeCounts.normal + gradeCounts.special + gradeCounts.treasure;
    const pct = (part, whole) => (whole > 0 ? clampPct((part / whole) * 100) : 0);

    const singleLoanSum = summarizeSeries(singleLoanAmounts);
    const allDebtSum = summarizeSeries(allPlayerRawDebts);
    const holderDebtSum = summarizeSeries(holderRawDebts);
    const holderPrinSum = summarizeSeries(holderPrincipals);
    const holderIntSum = summarizeSeries(holderInterests);
    const borrowedSum = summarizeSeries(borrowerBorrowedPrincipals);
    const matchLoanSum = summarizeSeries(matchLoansPerMatch);
    const matchBorrowedAllSum = summarizeSeries(matchBorrowedAll);
    const matchBorrowedActiveSum = summarizeSeries(matchBorrowedActive);
    const matchTollSumStats = summarizeSeries(matchTollTotals);
    const matchTollCountStats = summarizeSeries(matchTollCounts);
    const loanCountWinList = [...loanCountWinStats.values()]
        .sort((a, b) => a.loanCount - b.loanCount)
        .map(x => ({ ...x, winRatePct: pct(x.wins, x.appearances) }));

    const seats = [...seatStats.values()].sort((a, b) => a.slotIndex - b.slotIndex).map(s => ({
        ...s,
        winRatePct: pct(s.wins, s.appearances),
        avgRank: s.appearances > 0 ? s.rankSum / s.appearances : 0,
        avgNetWorth: s.appearances > 0 ? s.netWorthSum / s.appearances : 0,
        bankruptRatePct: pct(s.bankrupts, s.appearances)
    }));

    const archetypes = [...aiStats.values()].map(a => ({
        ...a,
        winRatePct: pct(a.wins, a.appearances),
        avgRank: a.appearances > 0 ? a.rankSum / a.appearances : 0,
        avgNetWorth: a.appearances > 0 ? a.netWorthSum / a.appearances : 0,
        bankruptRatePct: pct(a.bankrupts, a.appearances),
        avgTerritories: a.appearances > 0 ? a.territorySum / a.appearances : 0
    })).sort((a, b) => b.winRatePct - a.winRatePct || b.wins - a.wins);

    return {
        count,
        totalPlayers,
        loan: {
            totalLoans,
            totalPlayers,
            tollLoans,
            emergencyLoans,
            tollSharePct: pct(tollLoans, totalLoans),
            emergencySharePct: pct(emergencyLoans, totalLoans),
            loansPerMatchAvg: count > 0 ? totalLoans / count : 0,
            loansPerPlayerAvg: totalPlayers > 0 ? totalLoans / totalPlayers : 0,
            matchLoanMin: matchLoanSum.min,
            matchLoanMax: matchLoanSum.max,
            matchBorrowedMinAll: matchBorrowedAllSum.min,
            matchBorrowedMaxAll: matchBorrowedAllSum.max,
            matchBorrowedMinActive: matchBorrowedActiveSum.count > 0 ? matchBorrowedActiveSum.min : 0,
            matchBorrowedMaxActive: matchBorrowedActiveSum.count > 0 ? matchBorrowedActiveSum.max : 0,
            matchBorrowedAvgActive: matchBorrowedActiveSum.mean,
            matchesWithLoan,
            matchLoanRatePct: pct(matchesWithLoan, count),
            borrowerPlayers,
            borrowerRatePct: pct(borrowerPlayers, totalPlayers),
            singleLoanCount: singleLoanAmounts.length,
            minSingleLoan: singleLoanAmounts.length > 0 ? singleLoanSum.min : 0,
            maxSingleLoan: singleLoanAmounts.length > 0 ? singleLoanSum.max : 0,
            avgSingleLoan: singleLoanAmounts.length > 0 ? singleLoanSum.mean : 0,
            minSingleLoanRec,
            maxSingleLoanRec,
            minBorrowedPerBorrower: borrowedSum.count > 0 ? borrowedSum.min : 0,
            maxBorrowedPerBorrower: borrowedSum.count > 0 ? borrowedSum.max : 0,
            avgBorrowedPerBorrower: borrowedSum.mean,
            avgBorrowedPerMatch: count > 0 ? totalBorrowedPrincipal / count : 0,
            debtHolderPlayers,
            debtHolderRatePct: pct(debtHolderPlayers, totalPlayers),
            avgDebtAllPlayers: allDebtSum.mean,
            minDebtAllPlayers: allDebtSum.min,
            maxDebtAllPlayers: allDebtSum.max,
            avgDebtHolders: holderDebtSum.mean,
            minDebtHolders: holderDebtSum.count > 0 ? holderDebtSum.min : 0,
            maxDebtHolders: holderDebtSum.count > 0 ? holderDebtSum.max : 0,
            avgPrincipalHolders: holderPrinSum.mean,
            minPrincipalHolders: holderPrinSum.count > 0 ? holderPrinSum.min : 0,
            maxPrincipalHolders: holderPrinSum.count > 0 ? holderPrinSum.max : 0,
            avgInterestAllPlayers: totalPlayers > 0 ? totalInterest / totalPlayers : 0,
            avgInterestHolders: holderIntSum.mean,
            minInterestHolders: holderIntSum.count > 0 ? holderIntSum.min : 0,
            maxInterestHolders: holderIntSum.count > 0 ? holderIntSum.max : 0,
            avgSettledDebtPerMatch: count > 0 ? totalDebtSettled / count : 0,
            maxLoanCountRec,
            maxBorrowedRec,
            maxInterestRec,
            maxDebtRec,
            mostLoanPlayers,
            mostLoanWins,
            mostLoanWinRatePct: pct(mostLoanWins, mostLoanPlayers),
            leastLoanPlayers,
            leastLoanWins,
            leastLoanWinRatePct: pct(leastLoanWins, leastLoanPlayers),
            byLoanCount: loanCountWinList,
            totalRepayCount,
            repayPerMatchAvg: count > 0 ? totalRepayCount / count : 0,
            totalRepaidAmount,
            repaidPerMatchAvg: count > 0 ? totalRepaidAmount / count : 0,
            totalInterestConvertedCount,
            totalInterestConvertedAmount,
            totalFullClearedCount
        },
        tolls: {
            totalTollsAmount,
            totalTollsCount,
            matchTollMin: matchTollSumStats.min,
            matchTollMax: matchTollSumStats.max,
            matchTollAvg: matchTollSumStats.mean,
            matchTollCountMin: matchTollCountStats.min,
            matchTollCountMax: matchTollCountStats.max,
            matchTollCountAvg: matchTollCountStats.mean,
            minSingleToll: minSingleToll ?? 0,
            maxSingleToll,
            avgSingleToll: totalTollsCount > 0 ? totalTollsAmount / totalTollsCount : 0,
            minMatchTollRec,
            maxMatchTollRec
        },
        cards: {
            totalDraws: totalDrawsByGrade,
            drawsPerMatchAvg: count > 0 ? totalDrawsByGrade / count : 0,
            gradeCounts,
            gradeRatesPct: {
                normal: pct(gradeCounts.normal, totalDrawsByGrade),
                special: pct(gradeCounts.special, totalDrawsByGrade),
                treasure: pct(gradeCounts.treasure, totalDrawsByGrade)
            },
            treasureSources: {
                altarPortal: altarPortalTreasures,
                probTable: probTableTreasures,
                odyssey: odysseyTreasures,
                stolen: stolenTreasures
            },
            topNormal: sortHistogram(cardMaps.normal).slice(0, 10),
            topSpecial: sortHistogram(cardMaps.special).slice(0, 10),
            topTreasure: sortHistogram(cardMaps.treasure),
            treasureAcquiredRanking: sortHistogram(treasureAcquireMap),
            allNormalCount: cardMaps.normal.size,
            allSpecialCount: cardMaps.special.size,
            duplicateAnomalies,
            deckReshuffles,
            unusedInventoryTotal,
            totalCardsDrawnAll,
            activeCardsUsedAll,
            unusedCardRatePct: pct(unusedInventoryTotal, Math.max(1, totalDrawsByGrade))
        },
        extras: {
            seats,
            archetypes,
            buildingLevelTotals,
            buildingLevelAvgsPerMatch: buildingLevelTotals.map(v => (count > 0 ? v / count : 0)),
            landmarkHolders,
            landmarkHolderWins,
            landmarkWinRatePct: pct(landmarkHolderWins, landmarkHolders),
            dayaHolders,
            dayaWins,
            dayaWinRatePct: pct(dayaWins, dayaHolders),
            bbangjuChiefs,
            bbangjuWins,
            bbangjuWinRatePct: pct(bbangjuWins, bbangjuChiefs),
            totalGrossAsset,
            totalRawDebt: totalDebtRaw,
            debtToGrossAssetPct: pct(totalDebtRaw, totalGrossAsset),
            gimmickTurns,
            gimmickTurnSharesPct: {
                none: pct(gimmickTurns.none, gimmickTurns.total),
                day: pct(gimmickTurns.day, gimmickTurns.total),
                night: pct(gimmickTurns.night, gimmickTurns.total),
                soot: pct(gimmickTurns.soot, gimmickTurns.total),
                halo: pct(gimmickTurns.halo, gimmickTurns.total)
            },
            lapStats: {
                perMatch: summarizeSeries(perMatchLapCounts),
                perPlayer: summarizeSeries(perPlayerLapCounts)
            }
        },
        gimmickAnalytics: aggregateGimmickBatchAnalytics(cycles),
        cardRarity: buildCardCatalogRarityAudit(cardMaps, totalDrawsByGrade, perMatchUnusedCatalogCounts, count)
    };
}

/**
 * 전체 시뮬레이션 풀(예: 500판)의 무가중 모수 요약 통계 산출 (대표 100사이클과 비교 참고용)
 */
export function computePopulationSummary(allCycles, policy = 'density_preserve', retainedCount = MARBLE_MAX_HISTORY) {
    const count = Array.isArray(allCycles) ? allCycles.length : 0;
    if (count === 0) return null;

    const avgTurn = allCycles.reduce((s, c) => s + (c.finalTurn || 0), 0) / count;
    const earlyEndCount = allCycles.filter(c => c.endedEarlyByBankruptcy).length;
    const avgMove = allCycles.reduce((s, c) => s + (c.metrics?.avgMoveSpaces || 0), 0) / count;
    const avgGap = allCycles.reduce((s, c) => s + (c.metrics?.postNetWorthGapPct || 0), 0) / count;
    const avgRankDisc = allCycles.reduce((s, c) => s + (c.metrics?.cashVsTotalAssetDiscrepancyPct || 0), 0) / count;
    const avgSpecDisc = allCycles.reduce((s, c) => s + (c.metrics?.specialTerritoryDiscrepancyPct || 0), 0) / count;
    const avgTreasure = allCycles.reduce((s, c) => s + (c.metrics?.treasureTotalObtainedCount || 0), 0) / count;
    const avgMarkovExp = allCycles.reduce((s, c) => s + (c.metrics?.treasureMarkovExpectedCount || 0), 0) / count;
    const avgRankChanges = allCycles.reduce((s, c) => s + (c.metrics?.totalRankChanges || 0), 0) / count;

    const allNets = allCycles.flatMap(c => (c.players || []).map(p => p.netWorth || 0));
    const netSummary = summarizeSeries(allNets);
    const sootCount = allCycles.filter(c => (c.metrics?.sootTriggerCount || 0) > 0).length;
    const reincarnatedCount = allCycles.filter(c => Boolean(c.metrics?.reincarnatedPlayerName)).length;
    const detailed = aggregateDetailedBatchMetrics(allCycles);

    const stratCounts = new Map();
    for (const c of allCycles) {
        for (const p of (c.players || [])) {
            const code = p.strategy?.code || 'UNKNOWN';
            const label = p.strategy?.label || code;
            if (!stratCounts.has(code)) stratCounts.set(code, { code, label, appearances: 0, wins: 0 });
            const st = stratCounts.get(code);
            st.appearances++;
            if (p.settlementRank === 1 && !p.isBankruptFinal) st.wins++;
        }
    }
    const strategies = [...stratCounts.values()].sort((a, b) => {
        const wa = a.appearances > 0 ? a.wins / a.appearances : 0;
        const wb = b.appearances > 0 ? b.wins / b.appearances : 0;
        return wb - wa || b.wins - a.wins;
    });

    return {
        policy,
        totalSimulated: count,
        retainedCount: Math.min(count, retainedCount),
        avgFinalTurn: avgTurn,
        earlyEndPct: clampPct((earlyEndCount / count) * 100),
        avgMoveSpaces: avgMove,
        avgNetWorth: netSummary.mean,
        minNetWorth: netSummary.min,
        maxNetWorth: netSummary.max,
        avgPostNetWorthGapPct: avgGap,
        avgCashVsTotalRankDiscPct: avgRankDisc,
        avgSpecTerritoryDiscPct: avgSpecDisc,
        avgTreasureObtained: avgTreasure,
        avgTreasureMarkovExpected: avgMarkovExp,
        avgTotalRankChanges: avgRankChanges,
        sootTriggerRatePct: clampPct((sootCount / count) * 100),
        reincarnatedMatches: reincarnatedCount,
        strategies,
        loan: detailed.loan,
        tolls: detailed.tolls,
        cards: detailed.cards,
        extras: detailed.extras,
        gimmickAnalytics: detailed.gimmickAnalytics,
        cardRarity: detailed.cardRarity
    };
}

function summarizeSeries(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return { count: 0, mean: 0, min: 0, max: 0 };
    }
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const raw of values) {
        const v = Number(raw) || 0;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
    }
    return {
        count: values.length,
        mean: sum / values.length,
        min,
        max
    };
}

/**
 * [비교 기준 ① 개별 최소/최대값 vs 100사이클 평균] 및 [비교 기준 ② 1사이클 평균의 최소/최대값 vs 100사이클 평균] 마크다운 문자열 생성
 */
function formatDualComparisonLine(label, unit, individualStats, perCycleAvgStats, grandMean, isPct = false, sampleCycles = MARBLE_MAX_HISTORY) {
    const u = unit;
    const fmt = isPct ? (v) => `${fmt4(v)}%` : (v) => `${fmt4(v)}${u}`;
    const diffIndMin = individualStats.min - grandMean;
    const diffIndMax = individualStats.max - grandMean;
    const diffCycMin = perCycleAvgStats.min - grandMean;
    const diffCycMax = perCycleAvgStats.max - grandMean;

    const sign = (d) => `${d >= 0 ? '+' : ''}${fmt4(d)}${isPct ? '%' : u}`;

    return [
        `[${label}]`,
        `  - ${sampleCycles}사이클 평균: \`${fmt(grandMean)}\``,
        `  - [기준① 1사이클 개별 최소/최대 vs ${sampleCycles}사이클 평균] 최소 \`${fmt(individualStats.min)}\` (${sign(diffIndMin)}) | 최대 \`${fmt(individualStats.max)}\` (${sign(diffIndMax)})`,
        `  - [기준② 1사이클 평균 최소/최대 vs ${sampleCycles}사이클 평균] 최소평균 \`${fmt(perCycleAvgStats.min)}\` (${sign(diffCycMin)}) | 최대평균 \`${fmt(perCycleAvgStats.max)}\` (${sign(diffCycMax)})`
    ].join('\n');
}

function formatSingleCycleSection(cycle, displayIndex) {
    const m = cycle.metrics || {};
    const lines = [];
    lines.push(`## [사이클 #${displayIndex}] \`${cycle.roomId}\``);
    lines.push(
        `> **기록시각**: ${cycle.timestamp} · **순회보상**: ${fmtMoney(cycle.startBonusSetting || GAME_CONSTANTS.START_BONUS)} · **최종 턴**: ${cycle.finalTurn}/${cycle.maxTurn}턴 · **승자**: **${cycle.winnerName}**`
    );
    lines.push('');

    lines.push(`### 1. 각 플레이어의 정산 후 총 자산 및 순위`);
    lines.push(`| 순위 | 플레이어 | 구분 | 정산전 현금 | 정산후 총자산 | 대출부채 | 최종 순자산 |`);
    lines.push(`| :---: | :--- | :---: | ---: | ---: | ---: | ---: |`);
    for (const p of cycle.players) {
        const aiTag = p.isAi ? `AI(${p.aiType})` : '인간';
        const status = p.isBankruptFinal ? '파산' : '생존';
        lines.push(
            `| **${p.settlementRank}위** | ${p.name} | ${aiTag}/${status} | ${fmtMoney(p.baseCash)} | ${fmtMoney(p.totalAsset)} | ${fmtMoney(p.totalLoan)} | **${fmtMoney(p.netWorth)}** |`
        );
    }
    lines.push('');

    lines.push(`### 2. 정산 이전 현금 순위 vs 정산 이후 총 자산 순위 괴리감 척도 (0.0000% ~ 100.0000%)`);
    lines.push(
        `- **매치 전체 순위 괴리감**: 총자산 기준 \`${fmt4(m.cashVsTotalAssetDiscrepancyPct)}%\` · 순자산(부채차감) 기준 \`${fmt4(m.cashVsNetWorthDiscrepancyPct)}%\``
    );
    lines.push('');
    lines.push(`| 플레이어 | 정산전 현금순위 | 정산후 총자산순위 | 순위 변동 | 괴리 지수 |`);
    lines.push(`| :--- | :---: | :---: | :---: | :---: |`);
    for (const p of cycle.players) {
        lines.push(
            `| ${p.name} | ${fmt4(p.tieAwareCashRank)}위 | ${fmt4(p.tieAwareTotalAssetRank)}위 | ${fmt4(p.cashVsTotalAssetRankDiff)}칸 | \`${fmt4(p.cashVsTotalAssetDiscrepancyPct)}%\` |`
        );
    }
    lines.push('');

    lines.push(`### 3. 정산 이전 특수 영토(요충지) 가치 척도 vs 실제 정산 가치 차이`);
    lines.push(
        `- **매치 합계**: 투자원금 ${fmtMoney(m.specialTerritoryInvestedTotal)} · 정산전 명목 기대수금 ${fmtMoney(m.specialTerritoryTheoreticalTotal)} · 실제 정산 수금 ${fmtMoney(m.specialTerritoryActualTotal)} · **차이율 \`${fmt4(m.specialTerritoryDiscrepancyPct)}%\`**`
    );
    const holders = cycle.players.filter(p => p.specialTerritoryOwnedCount > 0 || p.specialTerritoryActualPaid > 0);
    if (holders.length === 0) {
        lines.push(`- 특수 영토 소유·정산 가감 내역 없음`);
    } else {
        lines.push('');
        lines.push(`| 플레이어 | 보유 수 | 투자원금 | 명목 기대수금 | 실제 정산수금 | 지불 | 순이익 | 차이율 |`);
        lines.push(`| :--- | :---: | ---: | ---: | ---: | ---: | ---: | :---: |`);
        for (const p of holders) {
            lines.push(
                `| ${p.name} | ${p.specialTerritoryOwnedCount}곳 | ${fmtMoney(p.specialTerritoryInvestedValue)} | ${fmtMoney(p.specialTerritoryTheoreticalCollect)} | ${fmtMoney(p.specialTerritoryActualCollect)} | ${fmtMoney(p.specialTerritoryActualPaid)} | ${fmtMoney(p.specialTerritoryNetProfit)} | \`${fmt4(p.specialTerritoryDiscrepancyPct)}%\` |`
            );
        }
    }
    lines.push('');

    lines.push(`### 4. 현재 판 최종 턴 수`);
    lines.push(
        `- **${cycle.finalTurn} / ${cycle.maxTurn}턴** (총 개인 턴 진행: ${cycle.totalPlayerTurns}턴 · 파산자: ${cycle.bankruptCount}명 · 조기종료: ${cycle.endedEarlyByBankruptcy ? '예' : '아니오'})`
    );
    lines.push('');

    lines.push(`### 5. 현재 판 평균 1회 이동 칸수`);
    lines.push(
        `- **전체 평균**: \`${fmt4(m.avgMoveSpaces)}칸/회\` (총 ${m.totalRollsMatch}회 굴림, 누적 ${m.totalMovedMatch}칸 이동)`
    );
    lines.push(
        `- **개인별**: ` + cycle.players.map(p => `${p.name} \`${fmt4(p.avgMoveSpaces)}칸\`(${p.totalRolls}회)`).join(' / ')
    );
    lines.push('');

    lines.push(`### 6. 획득한 보물 카드 수와 제단 개방 후 확률 테이블 기반 마르코프 기댓값`);
    lines.push(
        `- **실제 획득**: 총 **${m.treasureTotalObtainedCount}개** (제단포탈 확정 ${m.treasureAltarObtainedCount || 0}개 + 확률테이블 ${m.treasureProbObtainedCount}개 + 오디세이아 등 ${m.treasureOdysseyObtainedCount}개)`
    );
    lines.push(
        `- **제단 해금 후 판정**: ${m.postAltarEligibleDraws}회 · 마르코프 기댓값 \`${fmt4(m.treasureMarkovExpectedCount)}개\` (드로우당 \`${fmt4(m.treasureMarkovExpectedRatePct)}%\`, 6개 완성 \`${fmt4(m.treasureMarkovAll6Pct)}%\`, 단계합산 \`${fmt4(m.stepTreasureExpectationSum)}개\`)`
    );
    lines.push(
        `- **이론 6보물 완성 기준선**: 평균 \`${fmt4(m.treasureBaselineFullDraws)}회\` (단일평균확률 \`${fmt4(m.treasureBaselineRatePct)}%\`)`
    );
    lines.push('');

    lines.push(`### 7. 게임 전반 플레이어 간 평균 자산 격차 (0.0000% ~ 100.0000%)`);
    lines.push(
        `- **정산후 순자산 격차**: \`${fmt4(m.postNetWorthGapPct)}%\` · **총자산 격차**: \`${fmt4(m.postTotalAssetGapPct)}%\` · **정산전 현금 격차**: \`${fmt4(m.preCashGapPct)}%\``
    );
    lines.push('');

    lines.push(`### 8. 정산 이전 자산 순위가 매 턴 변동한 횟수`);
    lines.push(
        `- **총 순위 변동**: **${m.totalRankChanges}회** (체크포인트 ${m.rankCheckpointCount}회 중 변동률 \`${fmt4(m.rankChangeRatePct)}%\`)`
    );
    lines.push(
        `- **개인별 변동**: ` + cycle.players.map(p => `${p.name} ${p.rankChangeCount}회`).join(' / ')
    );
    lines.push('');

    lines.push(`### 9. 플레이어별 채택 전략군 판단 및 승자 요인`);
    lines.push(`- **최종 승자**: **${cycle.winnerName}** → \`${cycle.winnerStrategy?.label || '-'}\``);
    lines.push('');
    lines.push(`| 플레이어 (순위) | 채택 전략군 | 일반영토 | 조각상 | 특수영토 | 보물 | 카드사용 | 순회 |`);
    lines.push(`| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |`);
    for (const p of cycle.players) {
        lines.push(
            `| ${p.name} (${p.settlementRank}위) | ${p.strategy?.label || '-'} | ${p.landBuyCount} | ${p.landmarkCount} | ${p.specialTerritoryOwnedCount} | ${p.treasureAcquiredCount} | ${p.activeCardsUsed} | ${p.lapBonusCount} |`
        );
    }
    lines.push('');
    lines.push(
        `- **부가 기믹 요약**: 제단첫방문 ${m.altarFirstVisits}명 · 제단포탈 ${m.altarPortalUses}회 · 제단교환 ${m.altarTradeCount}회(${m.altarTradeCardsTotal}장) · 그을음 ${m.sootTriggerCount}회(분기:${m.sootBranch ?? '미발동'}, 윤회:${m.reincarnatedPlayerName || '없음'}) · 빛무리 자연/카드 ${m.haloNaturalCount}/${m.haloCardCount}회`
    );
    lines.push('');

    const ls = m.loanSummary || {};
    lines.push(`### 10. 대출 실행 빈도·금액 범위·정산 부채 내역`);
    if ((ls.totalLoanCount || 0) === 0) {
        lines.push(`- 이번 판에서는 대출 실행 내역이 없습니다. (총 대출 0회 · 정산 부채 0엘드르)`);
    } else {
        const minLoanTxt = ls.minSingleLoan !== null && ls.minSingleLoan !== undefined ? fmtMoney(ls.minSingleLoan) : '0엘드르';
        lines.push(
            `- **대출 실행 요약**: 총 **${ls.totalLoanCount}회** (이용자 ${ls.borrowerCount}명 · 통행료위기 ${ls.tollLoanCount}회 / 턴시작긴급 ${ls.emergencyLoanCount}회) · 단일 실행 최소 \`${minLoanTxt}\` ~ 최대 \`${fmtMoney(ls.maxSingleLoan)}\` (누적 원금합 ${fmtMoney(ls.totalSettlementPrincipal)}, 누적이자 ${fmtMoney(ls.totalSettlementInterest)}, 총원리금 ${fmtMoney(ls.totalDebtRaw)})`
        );
        lines.push('');
        lines.push(`| 플레이어 | 대출횟수 | 통행료/긴급 | 실행 원금합 | 최소 실행액 | 최대 실행액 | 정산원금 | 누적이자 | 원리금합계 |`);
        lines.push(`| :--- | :---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
        for (const p of cycle.players) {
            const pMin = p.minLoanAmount !== null && p.minLoanAmount !== undefined ? fmtMoney(p.minLoanAmount) : '-';
            const pMax = (p.maxLoanAmount || 0) > 0 ? fmtMoney(p.maxLoanAmount) : '-';
            lines.push(
                `| ${p.name} | ${p.loanCount}회 | ${p.tollLoanCount || 0}/${p.emergencyLoanCount || 0} | ${fmtMoney(p.borrowedPrincipalTotal || 0)} | ${pMin} | ${pMax} | ${fmtMoney(p.loanPrincipal || 0)} | ${fmtMoney(p.loanInterest || 0)} | ${fmtMoney(p.totalLoanRaw || 0)} |`
            );
        }
    }
    lines.push('');

    const cs = m.cardStats || {};
    const gc = cs.gradeCounts || {};
    const totalDraws = cs.totalDraws || ((gc.normal || 0) + (gc.special || 0) + (gc.treasure || 0));
    const drawPct = (v) => (totalDraws > 0 ? `${fmt4(clampPct((v / totalDraws) * 100))}%` : '0.0000%');
    lines.push(`### 11. 카드 드로우 등급별 비중 및 덱 순환`);
    lines.push(
        `- **등급별 드로우**: 총 **${totalDraws}회** → 일반 **${gc.normal || 0}회**(\`${drawPct(gc.normal || 0)}\`) · 특수 **${gc.special || 0}회**(\`${drawPct(gc.special || 0)}\`) · 보물 **${gc.treasure || 0}회**(\`${drawPct(gc.treasure || 0)}\`) · 리셔플 ${cs.deckReshuffleCount || 0}회 · 중복이상 ${cs.duplicateAnomalies || 0}건`
    );
    const drawnItems = Object.values(cs.cardHistogram || {}).sort((a, b) => b.count - a.count || a.id - b.id);
    if (drawnItems.length > 0) {
        const gradeBadge = { normal: '일반', special: '특수', treasure: '보물' };
        lines.push(`- **드로우 카드 내역**: ` + drawnItems.map(c => `[${gradeBadge[c.grade] || c.grade}] ${c.name}(${c.count}회)`).join(', '));
    }
    lines.push('');

    const be = m.balanceExtras || {};
    const bl = Array.isArray(be.buildingLevelTotals) ? be.buildingLevelTotals : [0, 0, 0, 0, 0];
    const gt = be.gimmickTurnCounts || {};
    lines.push(`### 12. 추가 진단 지표 (좌석·건물·월드기믹)`);
    lines.push(
        `- **건물 분포(생존)**: 토지 ${bl[0]} · 오두막 ${bl[1]} · 마을 ${bl[2]} · 왕국 ${bl[3]} · 엘리프조각상 ${bl[4]} | **다야 소유**: ${be.dayaOwnerName ? `${be.dayaOwnerName}(${be.dayaOwnerRank}위)` : '공석'} | **정비반장**: ${be.bbangjuChiefCount || 0}명(우승여부:${be.bbangjuChiefWinner ? '예' : '아니오'}) | **미사용인벤**: ${cs.unusedInventoryTotal || 0}장`
    );
    lines.push(
        `- **월드 기믹 턴(개인턴)**: 통상 ${gt.none || 0} · 낮 ${gt.day || 0} · 밤 ${gt.night || 0} · 그을음 ${gt.soot || 0} · 빛무리 ${gt.halo || 0}`
    );
    lines.push('');

    const fa = m.furryAnalytics || {};
    const tc = m.treasureCardAnalytics || {};
    const ma = m.mountainAnalytics || {};
    const mo = m.memoryOriginAnalytics || {};
    const sa = m.sootPnlAnalytics || {};
    const ha = m.haloPnlAnalytics || {};
    const da = m.dayNightPnlAnalytics || {};
    const aa = m.altarAnalytics || {};
    const va = m.voidAnalytics || {};
    const unusedCatalogThisGame = Math.max(0, ALL_CARDS_CATALOG.length - Object.keys(cs.cardHistogram || {}).length);
    const fc = fa.cardCounts || {};
    const tsc = tc.specialCounts || {};
    lines.push(`### 13. 퍼리·보물연계·정령산·기억/엘리프·그을음·빛무리·낮밤·제단/차원 상세`);
    lines.push(
        `- **퍼리비이치**: 개장 ${fa.openCount || 0}회(유지:${fa.endedAsFurry ? '예' : '아니오'}, 직접개장:${fa.manualOpenCount || 0}회) · 카드발동 [201:${fc[201] || 0}, 202:${fc[202] || 0}, 203:${fc[203] || 0}, 204:${fc[204] || 0}] (총 ${fa.totalCardUses || 0}회) · 실수익 ${fmtMoney(fa.actualGain || 0)} vs 기대 ${fmtMoney(fa.expectedGain || 0)} (입장료 ${fmtMoney(fa.entryTollTotal || 0)}, 정산차액 ${fmtMoney(fa.settleUplift || 0)}, 노동기차감 ${fmtMoney(fa.kimWorkerPaidTotal || 0)}, 직접개장비 ${fmtMoney(fa.manualOpenCost || 0)})`
    );
    lines.push(
        `- **보물 연계 카드**: 특수 [111:${tsc[111] || 0}, 112:${tsc[112] || 0}, 113:${tsc[113] || 0}, 114:${tsc[114] || 0}] + 보물액티브(504~506) ${tc.activeUses || 0}회 = 총 **${tc.totalTreasureRelatedUses || 0}회**`
    );
    lines.push(
        `- **정령산(타일) · 기억/엘리프**: 정령산 구매 ${ma.buyCount || 0}회(투자 ${fmtMoney(ma.investmentTotal || 0)} · 추가통행료 ${fmtMoney(ma.tollExtraTotal || 0)} · 순수익 ${fmtMoney(ma.actualNetGain || 0)} vs 기대 ${fmtMoney(ma.expectedNetGain || 0)}) | [205] 획득/회복 ${mo.forgottenAcquired || 0}/${mo.forgottenRecovered || 0} · [206] 코인플립 적중/기회 ${mo.originElifCoinFlipWins || 0}/${mo.originElifEligibleRolls || 0} (실제등장 ${mo.originElifDrawnCount || 0}회)`
    );
    const sootDetailTag = sa.triggered
        ? (sa.branch === 2
            ? `분기2(윤회 실질${fmtMoney(sa.bossActualTotal || 0)} vs 기대${fmtMoney(sa.expectedBoss || 0)} / 비윤회3인 실질${fmtMoney(sa.opposedActualTotal || 0)} vs 기대${fmtMoney(sa.expectedOpposed || 0)}) · 113/114(${sa.haloCardActualDraws || 0}/${(sa.haloCardExpectedDraws || 0).toFixed(2)})`
            : `분기1(실질${fmtMoney(sa.actualTotalNet || 0)} vs 기대${fmtMoney(sa.expectedBranch1 ?? sa.expectedNet ?? 0)}) · 113/114(${sa.haloCardActualDraws || 0}/${(sa.haloCardExpectedDraws || 0).toFixed(2)})`)
        : '미발동';
    const haloDetailTag = ha.triggered
        ? `${ha.branchMode === 'card' ? '카드전환' : '자연전환'}${ha.debuffType ? `(${ha.debuffType === 'karma' ? '죄업' : '후회'}:${ha.debuffedPlayerName || '-'} ${fmtMoney(ha.actualDebuffedNet || 0)} vs 기대${fmtMoney(ha.expectedDebuffed || 0)} / 상대3인 ${fmtMoney(ha.actualOpposedNet || 0)} vs 기대${fmtMoney(ha.expectedOpposed || 0)})` : `(균등 ${fmtMoney(ha.actualTotalNet || 0)} vs 기대${fmtMoney(ha.expectedTotal || 0)})`}`
        : '미발동';
    lines.push(
        `- **그을음 · 빛무리 · 낮밤 · 제단/차원 · 미등장**: 그을음[${sootDetailTag}] | 빛무리[${haloDetailTag}] | 낮밤합 ${fmtMoney(da.totalTollExtra || 0)} (낮 ${fmtMoney(da.dayTollExtra || 0)} / 밤 ${fmtMoney(da.nightTollExtra || 0)} vs 기대 ${fmtMoney(da.expectedToll || 0)}) | 제단도착 ${aa.visits || 0}회(기대 ${(aa.expectedTotalVisits || 0).toFixed(2)}, 교환 ${aa.tradeCount || 0}회/${aa.tradeCardsTotal || 0}장${aa.hasTopTrader ? `, 최다[${aa.topTraderName}]: ${fmtMoney(aa.topTraderCombinedActual || 0)}` : ''}) | 차원도착 ${va.visits || 0}회(기대 ${(va.expectedTotalVisits || 0).toFixed(2)}, 갇힘 ${va.trappedCount || 0}회, 피해 ${fmtMoney(va.damageTotal || 0)}) | 미등장도감 ${unusedCatalogThisGame}/${ALL_CARDS_CATALOG.length}종`
    );
    lines.push('');
    lines.push('---');

    return lines.join('\n');
}

export function renderCycleDetailLogText(cycles, maxCap = MARBLE_MAX_HISTORY) {
    if (!Array.isArray(cycles) || cycles.length === 0) {
        return [
            `# 엘리아스 마블 - 사이클 상세 로그 (최근 최대 ${maxCap}판)`,
            '',
            '> 아직 기록된 완료 게임 사이클이 없습니다. 게임을 1판 이상 완료하거나 오프라인 시뮬레이션을 실행하면 최신 로그가 이곳에 기록됩니다.',
            ''
        ].join('\n');
    }

    const newestFirst = [...cycles].reverse();
    const header = [
        `# 엘리아스 마블 - 사이클 상세 로그 (보관 판수: ${cycles.length} / ${maxCap}판, 최신순)`,
        '',
        '> 각 판 종료 시점의 13대 분석 항목(정산·대출·카드등급분포·퍼리/정령산/기억/그을음/낮밤/도감희소성 포함) 및 부가 기믹 통계를 최신순으로 기록합니다.',
        '',
        '---',
        ''
    ].join('\n');

    return header + newestFirst.map((c, idx) => formatSingleCycleSection(c, cycles.length - idx)).join('\n\n') + '\n';
}

function formatRecordTag(rec, unit = '회') {
    if (!rec || !rec.value) return '기록 없음';
    const valStr = unit === '원' ? fmtMoney(rec.value) : `${rec.value}${unit}`;
    return `**${valStr}** (${rec.playerName}, \`${rec.roomId}\`)`;
}

function formatSingleLoanRecTag(rec) {
    if (!rec) return '기록 없음';
    const srcLabel = rec.source === 'turn_crisis' ? '턴시작긴급' : '통행료위기';
    return `**${fmtMoney(rec.amount)}** (${rec.playerName}, ${rec.turn}턴·${srcLabel}, \`${rec.roomId}\`)`;
}

function formatSummaryLoanSectionLines(dLoan, popLoan = null, totalSimulated = 0, dTolls = null, popTolls = null, sampleCycles = MARBLE_MAX_HISTORY) {
    const src = popLoan || dLoan;
    const tSrc = popTolls || dTolls;
    const scopeLabel = popLoan ? `전체 ${totalSimulated}판 모수 기준 (괄호 안은 대표 ${sampleCycles}사이클)` : `보관 ${totalSimulated}사이클 기준`;
    const fmtPair = (popVal, sampVal, money = true) => {
        const a = money ? fmtMoney(popVal) : popVal;
        if (!popLoan) return `\`${a}\``;
        const b = money ? fmtMoney(sampVal) : sampVal;
        return `\`${a}\` *(${sampleCycles}사이클: \`${b}\`)*`;
    };

    const lines = [];
    lines.push('## 10. 대출 실행·통행료 거래 통계 및 대출 최다/최소 승률 분석');
    lines.push(`> 집계 기준: **${scopeLabel}**\n`);

    lines.push(`### 10-1. 대출 실행 빈도·금액 범위·정산 보유 부채 및 승률 비교`);
    lines.push(`- **대출 실행 빈도**`);
    lines.push(`  - 전체 대출 횟수: 총 **${src.totalLoans}회**`);
    lines.push(`  - 판당 평균 대출 횟수: \`${fmt4(src.loansPerMatchAvg)}회\` (1인당 평균 \`${fmt4(src.loansPerPlayerAvg)}회\`)`);
    lines.push(`  - 판당 발생 횟수 범위: 최소 ${src.matchLoanMin}회 ~ 최대 ${src.matchLoanMax}회`);

    lines.push(`- **대출 이용률 및 사유 비중**`);
    lines.push(`  - 매치 기준 1회+ 발생률: \`${fmt4(src.matchLoanRatePct)}%\` (${src.matchesWithLoan}판 / ${totalSimulated}판)`);
    lines.push(`  - 플레이어 기준 이용률: \`${fmt4(src.borrowerRatePct)}%\` (${src.borrowerPlayers}/${src.totalPlayers}명)`);
    lines.push(`  - 통행료 부족 위기 대출: \`${fmt4(src.tollSharePct)}%\` (${src.tollLoans}회)`);
    lines.push(`  - 턴 시작 소지금 부족 긴급 대출: \`${fmt4(src.emergencySharePct)}%\` (${src.emergencyLoans}회)`);

    if (src.singleLoanCount > 0) {
        lines.push(`- **판당·1회·개인별 대출 금액 범위**`);
        lines.push(`  - 판당 평균 대출 원금 (전체 매치): ${fmtPair(src.avgBorrowedPerMatch, dLoan.avgBorrowedPerMatch)}`);
        lines.push(`  - 판당 대출 원금 범위 (전체 매치): 최소 \`${fmtMoney(src.matchBorrowedMinAll)}\` ~ 최대 \`${fmtMoney(src.matchBorrowedMaxAll)}\``);
        lines.push(`  - 판당 대출 원금 (대출 발생 매치 한정): 평균 \`${fmtMoney(src.matchBorrowedAvgActive)}\` (최소 \`${fmtMoney(src.matchBorrowedMinActive)}\` ~ 최대 \`${fmtMoney(src.matchBorrowedMaxActive)}\`)`);
        lines.push(`  - 1회 단일 최솟값: ${formatSingleLoanRecTag(src.minSingleLoanRec)}`);
        lines.push(`  - 1회 단일 최댓값: ${formatSingleLoanRecTag(src.maxSingleLoanRec)}`);
        lines.push(`  - 1회 평균 실행액: ${fmtPair(src.avgSingleLoan, dLoan.avgSingleLoan)}`);
        lines.push(`  - 대출자 1인 누적 원금 범위: 최소 ${fmtPair(src.minBorrowedPerBorrower, dLoan.minBorrowedPerBorrower)} ~ 최대 ${fmtPair(src.maxBorrowedPerBorrower, dLoan.maxBorrowedPerBorrower)} (평균 ${fmtPair(src.avgBorrowedPerBorrower, dLoan.avgBorrowedPerBorrower)})`);
    } else {
        lines.push(`- **판당·1회·개인별 대출 금액 범위**: 실행된 대출 기록 없음`);
    }

    lines.push(`[대출 최다 플레이어 vs 최소 플레이어 승률 비교 (횟수 우선·동률 시 대출금)]`);
    lines.push(`  - 매치 내 최다 대출 플레이어 승률: \`${fmt4(src.mostLoanWinRatePct)}%\` (${src.mostLoanWins}승 / ${src.mostLoanPlayers}표본)`);
    lines.push(`  - 매치 내 최소 대출 플레이어 승률: \`${fmt4(src.leastLoanWinRatePct)}%\` (${src.leastLoanWins}승 / ${src.leastLoanPlayers}표본)`);
    if (Array.isArray(src.byLoanCount) && src.byLoanCount.length > 0) {
        for (const lcItem of src.byLoanCount) {
            lines.push(`  - 누적 대출 ${lcItem.loanCount}회 플레이어 전체 승률: \`${fmt4(lcItem.winRatePct)}%\` (${lcItem.wins}승 / ${lcItem.appearances}명)`);
        }
    }

    lines.push(`- **정산 시점 대출금 보유 현황**`);
    lines.push(`  - 부채 보유자 비율: \`${fmt4(src.debtHolderRatePct)}%\` (${src.debtHolderPlayers}명 보유)`);
    lines.push(`  - 전체 플레이어 1인 평균 총부채(원금+이자): ${fmtPair(src.avgDebtAllPlayers, dLoan.avgDebtAllPlayers)} (개별 최소 \`${fmtMoney(src.minDebtAllPlayers)}\` ~ 최대 \`${fmtMoney(src.maxDebtAllPlayers)}\`)`);
    lines.push(`  - 부채 보유자 한정 평균 원리금: ${fmtPair(src.avgDebtHolders, dLoan.avgDebtHolders)} (원금 ${fmtPair(src.avgPrincipalHolders, dLoan.avgPrincipalHolders)} + 누적이자 ${fmtPair(src.avgInterestHolders, dLoan.avgInterestHolders)})`);

    lines.push(`- **중도 상환 이용 실적 (턴 시작 10/25/50/75/100%)**`);
    lines.push(`  - 누적 상환 실행: 총 **${src.totalRepayCount || 0}회** (판당 평균 \`${fmt4(src.repayPerMatchAvg || 0)}회\`)`);
    lines.push(`  - 누적 상환 총액: ${fmtPair(src.totalRepaidAmount || 0, dLoan.totalRepaidAmount || 0)} (판당 평균 ${fmtPair(src.repaidPerMatchAvg || 0, dLoan.repaidPerMatchAvg || 0)})`);
    lines.push(`  - 원금 전액 완납 (잔여부채 0): ${src.totalFullClearedCount || 0}건 | 원금 완납 후 잔여이자→원금 전환: ${src.totalInterestConvertedCount || 0}건 (전환액 ${fmtMoney(src.totalInterestConvertedAmount || 0)})`);

    lines.push(`- **역대 최다·최고 대출 기록**`);
    lines.push(`  - 개인 최다 대출 횟수: ${formatRecordTag(src.maxLoanCountRec, '회')}`);
    lines.push(`  - 개인 누적 최대 대출 원금: ${formatRecordTag(src.maxBorrowedRec, '원')}`);
    lines.push(`  - 개인 누적 최대 대출 이자: ${formatRecordTag(src.maxInterestRec, '원')}`);
    lines.push(`  - 개인 정산 시점 최대 원리금 부채: ${formatRecordTag(src.maxDebtRec, '원')}`);

    if (tSrc) {
        lines.push('');
        lines.push(`### 10-2. 통행료 거래액 통계 (판당 최저/최대/평균 및 단일 건 범위)`);
        lines.push(`- **판당 통행료 거래 규모**`);
        lines.push(`  - 판당 총 통행료 평균: ${fmtPair(tSrc.matchTollAvg, dTolls?.matchTollAvg ?? tSrc.matchTollAvg)}`);
        lines.push(`  - 판당 총 통행료 최저: \`${fmtMoney(tSrc.matchTollMin)}\`${tSrc.minMatchTollRec ? ` (\`${tSrc.minMatchTollRec.roomId}\`)` : ''}`);
        lines.push(`  - 판당 총 통행료 최대: \`${fmtMoney(tSrc.matchTollMax)}\`${tSrc.maxMatchTollRec ? ` (\`${tSrc.maxMatchTollRec.roomId}\`)` : ''}`);
        lines.push(`  - 판당 통행료 발생 건수: 평균 \`${fmt4(tSrc.matchTollCountAvg)}회\` (최소 ${tSrc.matchTollCountMin}회 ~ 최대 ${tSrc.matchTollCountMax}회)`);
        lines.push(`- **단일 건 통행료 범위**`);
        lines.push(`  - 건당 평균 통행료: ${fmtPair(tSrc.avgSingleToll, dTolls?.avgSingleToll ?? tSrc.avgSingleToll)} (총 ${tSrc.totalTollsCount}건)`);
        lines.push(`  - 단일 건 최소 통행료: \`${fmtMoney(tSrc.minSingleToll)}\``);
        lines.push(`  - 단일 건 최대 통행료: \`${fmtMoney(tSrc.maxSingleToll)}\``);
    }

    lines.push('');
    return lines;
}

function formatSummaryCardSectionLines(dCards, popCards = null, totalSimulated = 0, sampleCycles = MARBLE_MAX_HISTORY) {
    const src = popCards || dCards;
    const pct = (part, whole) => (whole > 0 ? clampPct((part / whole) * 100) : 0);
    const lines = [];
    lines.push('## 11. 카드 드로우 등급별 확률·비율 및 등급별 최다 뽑힌 카드');
    lines.push(
        `- **총 드로우 집계${popCards ? ` (전체 ${totalSimulated}판 모수)` : ''}**: 총 **${src.totalDraws}회** (판당 평균 \`${fmt4(src.drawsPerMatchAvg)}회\`) · ${sampleCycles}사이클 표본 ${dCards.totalDraws}회(판당 \`${fmt4(dCards.drawsPerMatchAvg)}회\`)`
    );
    lines.push(`- **덱 비정상 중복 드로우 감사**: \`${src.duplicateAnomalies}건\` (총 리셔플 ${src.deckReshuffles}회 · 보물 강탈 ${src.treasureSources.stolen}회)`);
    lines.push('');
    lines.push(`| 카드 등급 | 드로우 횟수 | 전체 대비 비율 | 대표 ${sampleCycles}사이클 횟수 (비율) | 비고 |`);
    lines.push(`| :--- | :---: | :---: | :---: | :--- |`);
    const gradeMeta = [
        { key: 'normal', name: '일반 카드 (1~50)', note: `등장 종류 ${src.allNormalCount}종` },
        { key: 'special', name: '특수 카드 (101~206)', note: `등장 종류 ${src.allSpecialCount}종` },
        {
            key: 'treasure',
            name: '보물 카드 (501~506)',
            note: `제단확정 ${src.treasureSources.altarPortal} / 확률표 ${src.treasureSources.probTable} (+[111]오디세이아 ${src.treasureSources.odyssey}건 별도)`
        }
    ];
    for (const gm of gradeMeta) {
        lines.push(
            `| ${gm.name} | ${src.gradeCounts[gm.key]}회 | \`${fmt4(src.gradeRatesPct[gm.key])}%\` | ${dCards.gradeCounts[gm.key]}회 (\`${fmt4(dCards.gradeRatesPct[gm.key])}%\`) | ${gm.note} |`
        );
    }

    const renderTopTable = (title, list, gradeTotal) => {
        lines.push('');
        lines.push(`- **${title}**`);
        if (!list || list.length === 0) {
            lines.push(`  - 드로우된 카드 없음`);
            return;
        }
        lines.push(`| 순위 | 카드 ID | 카드 명칭 | 드로우 횟수 | 등급 내 비중 | 전체 드로우 대비 |`);
        lines.push(`| :---: | :---: | :--- | :---: | :---: | :---: |`);
        list.forEach((item, idx) => {
            lines.push(
                `| ${idx + 1}위 | #${item.id} | ${item.name} | ${item.count}회 | \`${fmt4(pct(item.count, gradeTotal))}%\` | \`${fmt4(pct(item.count, src.totalDraws))}%\` |`
            );
        });
    };

    renderTopTable('일반 카드 최다 뽑힘 TOP 10', src.topNormal, src.gradeCounts.normal);
    renderTopTable('특수 카드 최다 뽑힘 TOP 10', src.topSpecial, src.gradeCounts.special);

    lines.push('');
    lines.push(`- **보물 카드 등급 전체 순위 (직접 드로우 vs 오디세이아 포함 총 획득)**`);
    const directMap = new Map(src.topTreasure.map(t => [t.id, t.count]));
    if (!src.treasureAcquiredRanking || src.treasureAcquiredRanking.length === 0) {
        lines.push(`  - 획득된 보물 카드 없음`);
    } else {
        lines.push(`| 순위 | 카드 ID | 보물 명칭 | 총 획득(오디세이아 포함) | 직접 드로우 | 총 획득 내 비중 |`);
        lines.push(`| :---: | :---: | :--- | :---: | :---: | :---: |`);
        const totalAcq = src.treasureAcquiredRanking.reduce((s, t) => s + t.count, 0);
        src.treasureAcquiredRanking.forEach((item, idx) => {
            const directCnt = directMap.get(item.id) || 0;
            lines.push(
                `| ${idx + 1}위 | #${item.id} | ${item.name} | ${item.count}회 | ${directCnt}회 | \`${fmt4(pct(item.count, totalAcq))}%\` |`
            );
        });
    }
    lines.push('');
    return lines;
}

function formatSummaryDiagnosticSectionLines(dExtras, dCards, popExtras = null, popCards = null, totalSimulated = 0) {
    const ex = popExtras || dExtras;
    const cs = popCards || dCards;
    const matchCount = ex.seats?.[0]?.appearances || dExtras.seats?.[0]?.appearances || 1;
    const lines = [];
    lines.push(`## 12. 추가 밸런싱·기획 진단 지표${popExtras ? ` (전체 ${totalSimulated}판 기준)` : ''}`);
    lines.push('');
    lines.push(`### 12-1. 시작 좌석 순서(선공/후공 1~4번 자리)별 성적`);
    lines.push(`| 좌석 | 표본 수 | 승률 | 평균 순위 | 평균 최종 순자산 | 파산률 |`);
    lines.push(`| :---: | :---: | :---: | :---: | ---: | :---: |`);
    for (const s of ex.seats) {
        lines.push(`| ${s.slotIndex}번 자리 | ${s.appearances} | \`${fmt4(s.winRatePct)}%\` | \`${fmt4(s.avgRank)}위\` | ${fmtMoney(s.avgNetWorth)} | \`${fmt4(s.bankruptRatePct)}%\` |`);
    }

    lines.push('');
    lines.push(`### 12-2. AI 성향별 밸런스 성적`);
    lines.push(`| AI 성향 | 표본 수 | 승률 | 평균 순위 | 평균 최종 순자산 | 파산률 | 평균 영토수 |`);
    lines.push(`| :--- | :---: | :---: | :---: | ---: | :---: | :---: |`);
    for (const a of ex.archetypes) {
        lines.push(
            `| ${a.label} | ${a.appearances} | \`${fmt4(a.winRatePct)}%\` | \`${fmt4(a.avgRank)}위\` | ${fmtMoney(a.avgNetWorth)} | \`${fmt4(a.bankruptRatePct)}%\` | \`${fmt4(a.avgTerritories)}개\` |`
        );
    }

    lines.push('');
    lines.push(`### 12-3. 건물 건설 분포·핵심 기믹 승률·월드 기믹 점유율`);
    const lvlNames = ['Lv0(빈땅)', 'Lv1(오두막)', 'Lv2(마을)', 'Lv3(왕국)', 'Lv4(엘리프조각상)'];
    lines.push(`- **판 종료 시 생존 건물 단계 평균**`);
    lvlNames.forEach((n, i) => {
        lines.push(`  - ${n}: \`${fmt4(ex.buildingLevelAvgsPerMatch[i])}개\``);
    });

    lines.push(`- **핵심 요충지 및 지위 보유자 승률**`);
    lines.push(`  - 엘리프 조각상(1개+) 보유자: \`${fmt4(ex.landmarkWinRatePct)}%\` (${ex.landmarkHolderWins}/${ex.landmarkHolders}승)`);
    lines.push(`  - 다야의 궁전 소유자: \`${fmt4(ex.dayaWinRatePct)}%\` (${ex.dayaWins}/${ex.dayaHolders}승)`);
    lines.push(`  - 빵주 정비반장 보유자: \`${fmt4(ex.bbangjuWinRatePct)}%\` (${ex.bbangjuWins}/${ex.bbangjuChiefs}승)`);

    lines.push(`- **자산 대비 부채 및 미사용 카드 현황**`);
    lines.push(`  - 생존 총자산 대비 누적 부채 비율: \`${fmt4(ex.debtToGrossAssetPct)}%\``);
    lines.push(`  - 판당 미사용 인벤토리 카드: \`${fmt4(cs.unusedInventoryTotal / Math.max(1, matchCount))}장\` (총 드로우 대비 \`${fmt4(cs.unusedCardRatePct)}%\` 잔존)`);

    if (ex.lapStats) {
        lines.push(`- **보드 순회 횟수 분포**`);
        lines.push(`  - 판당 순회 횟수 (4인 합계): ${fmtSeriesSpan(ex.lapStats.perMatch)}`);
        lines.push(`  - 개인별(1인당) 순회 횟수: ${fmtSeriesSpan(ex.lapStats.perPlayer)}`);
    }

    const gt = ex.gimmickTurnSharesPct;
    lines.push(`- **개인 턴 기준 월드 기믹 체감 비중**`);
    lines.push(`  - 통상(맑음): \`${fmt4(gt.none)}%\``);
    lines.push(`  - 낮 기믹: \`${fmt4(gt.day)}%\``);
    lines.push(`  - 밤 기믹: \`${fmt4(gt.night)}%\``);
    lines.push(`  - 그을음 기믹: \`${fmt4(gt.soot)}%\``);
    lines.push(`  - 빛무리 기믹: \`${fmt4(gt.halo)}%\``);
    lines.push('');
    return lines;
}

function fmtSeriesSpan(s, unit = '회') {
    if (!s || s.count === 0) return `평균 \`0.0000${unit}\` (표본 없음)`;
    return `평균 \`${fmt4(s.mean)}${unit}\` (최소 \`${fmt4(s.min)}${unit}\` ~ 최대 \`${fmt4(s.max)}${unit}\`)`;
}

function fmtMoneySeriesSpan(s) {
    if (!s || s.count === 0) return `평균 \`0엘드르\` (표본 없음)`;
    return `평균 \`${fmtMoney(s.mean)}\` (최소 \`${fmtMoney(s.min)}\` ~ 최대 \`${fmtMoney(s.max)}\`)`;
}

function fmtErrSummary(err) {
    if (!err) return `\`0.0000%\``;
    const signStr = `${err.signedErrorPct >= 0 ? '+' : ''}${fmt4(err.signedErrorPct)}%`;
    return `오차율 \`${fmt4(err.absErrorPct)}%\` (기대 대비 편차 \`${signStr}\`)`;
}

function formatSummaryFurryAndTreasureCardsLines(ga100, gaPop = null, totalSimulated = 0, sampleCycles = MARBLE_MAX_HISTORY) {
    const src = gaPop || ga100;
    const f = src.furry;
    const tc = src.treasureCards;
    const f100 = ga100.furry;
    const tc100 = ga100.treasureCards;
    const scope = gaPop ? `전체 ${totalSimulated}판 모수 기준 (괄호 안은 대표 ${sampleCycles}사이클)` : `보관 ${totalSimulated}사이클 기준`;
    const lines = [];

    lines.push('## 13. 퍼리비이치·보물 연계 카드 발동 빈도 및 퍼리비이치 수익/기대 오차');
    lines.push(`> 집계 기준: **${scope}**\n`);
    lines.push(`### 13-1. 퍼리비이치 전용 특수 카드(201~204) 판당 발동 빈도`);
    lines.push(`- **전체 합산 (201~204)**: ${fmtSeriesSpan(f.cardsTotal)}${gaPop ? ` *(${sampleCycles}사이클: \`${fmt4(f100.cardsTotal.mean)}회\`)*` : ''}`);
    lines.push(`| 카드 ID | 카드 명칭 | 판당 평균 | 최소 ~ 최대 | 대표 ${sampleCycles}사이클 평균 |`);
    lines.push(`| :---: | :--- | :---: | :---: | :---: |`);
    const furryMeta = [
        { k: 'card201', id: 201, name: '퍼리비이치 개장' },
        { k: 'card202', id: 202, name: '디아나의 꿀밤' },
        { k: 'card203', id: 203, name: '코미주스 한잔해' },
        { k: 'card204', id: 204, name: '김씨노동기' }
    ];
    for (const fm of furryMeta) {
        const s = f[fm.k];
        const s100 = f100[fm.k];
        lines.push(`| #${fm.id} | ${fm.name} | \`${fmt4(s.mean)}회\` | \`${fmt4(s.min)} ~ ${fmt4(s.max)}회\` | \`${fmt4(s100.mean)}회\` |`);
    }

    lines.push('');
    lines.push(`### 13-2. 보물 관련 카드(111~114·빛무리 전환·보물 액티브 504~506) 판당 발동 빈도`);
    lines.push(`- **보물 연계 카드 발동 현황**`);
    lines.push(`  - 보물 연계 총 발동 (111~114 + 504~506): ${fmtSeriesSpan(tc.total)}${gaPop ? ` *(${sampleCycles}사이클: \`${fmt4(tc100.total.mean)}회\`)*` : ''}`);
    lines.push(`  - 특수 카드 발동(111~114): ${fmtSeriesSpan(tc.specialTotal)}`);
    lines.push(`  - 보물 액티브 발동(504~506): ${fmtSeriesSpan(tc.activeUses)}`);
    lines.push(`| 카드 / 구분 | 명칭 | 판당 평균 | 최소 ~ 최대 | 대표 ${sampleCycles}사이클 평균 |`);
    lines.push(`| :---: | :--- | :---: | :---: | :---: |`);
    const tMeta = [
        { k: 'card111', id: '#111', name: '오디세이아 (보물 확정)' },
        { k: 'card112', id: '#112', name: '애증의 늑대 (보물 강탈)' },
        { k: 'card113', id: '#113', name: '심판의 시간 (빛무리 전환)' },
        { k: 'card114', id: '#114', name: '교주의 염원 (빛무리 전환)' },
        { k: 'activeUses', id: '#504~506', name: '보물 액티브 발동 합계' }
    ];
    for (const tm of tMeta) {
        const s = tc[tm.k];
        const s100 = tc100[tm.k];
        lines.push(`| ${tm.id} | ${tm.name} | \`${fmt4(s.mean)}회\` | \`${fmt4(s.min)} ~ ${fmt4(s.max)}회\` | \`${fmt4(s100.mean)}회\` |`);
    }

    lines.push('');
    lines.push(`### 13-3. 퍼리비이치 변환 확률 및 실제 수익 vs 기대 수익 오차율`);
    lines.push(`- **퍼리비이치 변환 확률**`);
    lines.push(`  - 전체 매치 대비 변환율: \`${fmt4(f.conversionRateAllPct)}%\` (${f.convertedMatches}판 / ${f.opensPerMatch.count}판)`);
    lines.push(`  - 정령호수 매입 매치(${f.lakeOwnedMatches}판) 중 변환율: \`${fmt4(f.conversionRateOwnedPct)}%\``);
    lines.push(`  - 정산 시점 퍼리비이치 유지율: \`${fmt4(f.endedOpenRatePct)}%\` (${f.endedOpenMatches}판)`);
    lines.push(`  - 판당 개장 횟수: ${fmtSeriesSpan(f.opensPerMatch)}`);

    lines.push(`[전체 매치 기준 퍼리비이치 수익 vs 기대 비교]`);
    lines.push(`  - 실제 순수익: ${fmtMoneySeriesSpan(f.actualAll)}`);
    lines.push(`  - 기대 수익: ${fmtMoneySeriesSpan(f.expectedAll)}`);
    lines.push(`  - 오차율: ${fmtErrSummary(f.errorAll)}`);

    if (f.convertedMatches > 0) {
        lines.push(`[개장 발생 매치(${f.convertedMatches}판) 기준 수익 vs 기대 비교]`);
        lines.push(`  - 실제 순수익: ${fmtMoneySeriesSpan(f.actualConverted)}`);
        lines.push(`  - 기대 수익: ${fmtMoneySeriesSpan(f.expectedConverted)}`);
        lines.push(`  - 오차율: ${fmtErrSummary(f.errorConverted)}`);
    }

    lines.push(`- **퍼리비이치 세부 수익 항목 (전체 평균)**`);
    lines.push(`  - 입장료 평균: ${fmtMoney(f.entryTollAvg)}`);
    lines.push(`  - 직접 개장(50만) 평균: \`${fmt4(f.manualOpenAvg || 0)}회\` (비용 ${fmtMoney(f.manualOpenCostAvg || 0)})`);
    lines.push(`  - 정산 차액 이득 평균: ${fmtMoney(f.settleUpliftAvg)}`);
    lines.push(`  - 김씨 노동기 차감 평균: ${fmtMoney(f.kimPaidAvg)}`);
    lines.push(`  - 추가 휴식 횟수: ${fmt4(f.extraRestAvg)}회`);
    lines.push(`  - 일반 휴식 횟수: ${fmt4(f.baselineRestAvg)}회`);

    if (gaPop) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 변환율: \`${fmt4(f100.conversionRateAllPct)}%\``);
        lines.push(`  - 전체 실제 순수익: ${fmtMoney(f100.actualAll.mean)} vs 기대: ${fmtMoney(f100.expectedAll.mean)} (${fmtErrSummary(f100.errorAll)})`);
    }
    lines.push('');
    return lines;
}

function formatSummaryMountainAndMemoryLines(ga100, gaPop = null, totalSimulated = 0, sampleCycles = MARBLE_MAX_HISTORY) {
    const src = gaPop || ga100;
    const m = src.mountain;
    const mo = src.memoryOrigin;
    const m100 = ga100.mountain;
    const mo100 = ga100.memoryOrigin;
    const scope = gaPop ? `전체 ${totalSimulated}판 모수 기준 (괄호 안은 대표 ${sampleCycles}사이클)` : `보관 ${totalSimulated}사이클 기준`;
    const lines = [];

    lines.push('## 14. 정령산(타일) 투자·수익·오차율 및 잊혀진 기억(205)·태초의 엘리프(206) 분석');
    lines.push(`> 집계 기준: **${scope}**\n`);

    lines.push(`### 14-1. 정령산(타일 #20) 투자 금액 · 추가 통행료 이득 · 기대 수익 비교`);
    lines.push(`- **정령산 발동 빈도**`);
    lines.push(`  - 매치 1회+ 구매율: \`${fmt4(m.buyMatchRatePct)}%\` (${m.buyMatches}판)`);
    lines.push(`  - 판당 구매 횟수: ${fmtSeriesSpan(m.buysPerMatch)}`);

    lines.push(`[전체 매치 기준 정령산 투자/수익 vs 기대 비교]`);
    lines.push(`  - 투자 금액: ${fmtMoneySeriesSpan(m.investmentAll)}`);
    lines.push(`  - 추가 통행료 이득: ${fmtMoneySeriesSpan(m.tollExtraAll)}`);
    lines.push(`  - 실질 순수익(이득 - 투자): ${fmtMoneySeriesSpan(m.actualNetAll)}`);
    lines.push(`  - 기대 순수익: ${fmtMoneySeriesSpan(m.expectedNetAll)}`);
    lines.push(`  - 순수익 오차율: ${fmtErrSummary(m.errorAll)}`);

    if (m.buyMatches > 0) {
        lines.push(`[구매 발생 매치(${m.buyMatches}판) 기준 투자/수익 vs 기대 비교]`);
        lines.push(`  - 투자 금액: ${fmtMoneySeriesSpan(m.investmentActive)}`);
        lines.push(`  - 추가 통행료 이득: ${fmtMoneySeriesSpan(m.tollExtraActive)}`);
        lines.push(`  - 순수익: ${fmtMoneySeriesSpan(m.actualNetActive)}`);
        lines.push(`  - 기대 순수익: ${fmtMoneySeriesSpan(m.expectedNetActive)}`);
        lines.push(`  - 순수익 오차율: ${fmtErrSummary(m.errorActive)}`);
    }
    if (gaPop) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 전체 투자: ${fmtMoney(m100.investmentAll.mean)}`);
        lines.push(`  - 추가 이득: ${fmtMoney(m100.tollExtraAll.mean)}`);
        lines.push(`  - 순수익: ${fmtMoney(m100.actualNetAll.mean)} vs 기대: ${fmtMoney(m100.expectedNetAll.mean)} (${fmtErrSummary(m100.errorAll)})`);
    }

    lines.push('');
    lines.push(`### 14-2. [205] 잊혀진 기억 → [되찾은 기억] 변환율 및 기대 변환 확률 오차`);
    lines.push(`- **획득 및 회복 빈도**`);
    lines.push(`  - 판당 획득 횟수: ${fmtSeriesSpan(mo.acquiredPerMatch)} (총 ${mo.totalAcquired}건)`);
    lines.push(`  - 판당 회복 횟수: ${fmtSeriesSpan(mo.recoveredPerMatch)} (총 ${mo.totalRecovered}건)`);

    lines.push(`[잊혀진 기억 변환율 vs 마르코프 기대 확률 비교]`);
    lines.push(`  - 실측 전체 변환율: \`${fmt4(mo.overallRatePct)}%\` (${mo.totalRecovered}/${mo.totalAcquired}건)`);
    lines.push(`  - 매치별 변환율: ${fmtSeriesSpan(mo.perMatchRate, '%')}`);
    lines.push(`  - 마르코프 이론 기대 확률: \`${fmt4(mo.expectedRatePct)}%\``);
    lines.push(`  - 변환율 오차율: ${fmtErrSummary(mo.recoveryError)}`);

    if (gaPop) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 변환율: \`${fmt4(mo100.overallRatePct)}%\` (${mo100.totalRecovered}/${mo100.totalAcquired}) vs 기대 \`${fmt4(mo100.expectedRatePct)}%\` (${fmtErrSummary(mo100.recoveryError)})`);
    }

    lines.push('');
    lines.push(`### 14-3. [206] 태초의 엘리프 등장 빈도 및 1단계 최상위 선판정(50%) 기대 확률 오차`);
    lines.push(`- **[206] 태초의 엘리프 등장 빈도**`);
    lines.push(`  - 전체 매치 등장 횟수: 총 **${mo.totalOriginDrawn}회** (매치당 평균 \`${fmt4(mo.overallOriginMatchPct)}%\`)`);
    lines.push(`  - 판당 획득 횟수: ${fmtSeriesSpan(mo.originDrawnPerMatch)}`);

    lines.push(`[기억 회복자 1단계 최상위 선판정(50%) vs 실제 획득 비교]`);
    lines.push(`  - 선판정 적격 판정 횟수: \`${mo.eligibleRollsSum}회\``);
    lines.push(`  - 선판정 당첨(50% 독립 성공) 횟수: \`${mo.coinFlipWinsSum}회\``);
    lines.push(`  - 실측 적중률: \`${fmt4(mo.overallCondRatePct)}%\` (매치별 ${fmtSeriesSpan(mo.perMatchCondRate, '%')})`);
    lines.push(`  - 기획 기대 확률: \`50.0000%\``);
    lines.push(`  - 적중률 오차율: ${fmtErrSummary(mo.condRateError)}`);

    if (gaPop) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 전체 등장: ${mo100.totalOriginDrawn}회 (\`${fmt4(mo100.overallOriginMatchPct)}%\`)`);
        lines.push(`  - 조건부 적중률: \`${fmt4(mo100.overallCondRatePct)}%\` (${mo100.coinFlipWinsSum}/${mo100.eligibleRollsSum}, ${fmtErrSummary(mo100.condRateError)})`);
    }
    lines.push('');
    return lines;
}

function formatSummarySootAndDayNightLines(ga100, gaPop = null, totalSimulated = 0, sampleCycles = MARBLE_MAX_HISTORY) {
    const src = gaPop || ga100;
    const s = src.soot;
    const h = src.halo;
    const dn = src.dayNight;
    const s100 = ga100.soot;
    const h100 = ga100.halo;
    const dn100 = ga100.dayNight;
    const scope = gaPop ? `전체 ${totalSimulated}판 모수 기준 (괄호 안은 대표 ${sampleCycles}사이클)` : `보관 ${totalSimulated}사이클 기준`;
    const lines = [];

    lines.push('## 15. 그을음 · 빛무리 손익 및 월드 기믹(낮/밤) 통행료 편차 분석');
    lines.push(`> 집계 기준: **${scope}**\n`);

    lines.push(`### 15-1. 그을음 기믹 분기별(공석 vs 윤회/비윤회) 손익 · 기대값 오차 및 빛무리 카드 전환률`);
    lines.push(`- **그을음 발동률 및 분기**`);
    lines.push(`  - 그을음 발동률: \`${fmt4(s.triggerRatePct)}%\` (${s.triggeredMatches}판)`);
    lines.push(`  - 분기 1 (윤회 공석): ${s.branch1.matches}판`);
    lines.push(`  - 분기 2 (윤회 탄생): ${s.branch2.matches}판`);

    lines.push(`[전체 매치 기준 그을음 손익 vs 기대 비교]`);
    lines.push(`  - 현금 순손익: 실제 ${fmtMoneySeriesSpan(s.cashAll)} vs 기대 ${fmtMoneySeriesSpan(s.expectedAll)} (${fmtErrSummary(s.errorCashAll)})`);
    lines.push(`  - 실질 손익(파괴가치 반영): 실제 ${fmtMoneySeriesSpan(s.totalAll)} vs 기대 ${fmtMoneySeriesSpan(s.expectedAll)} (${fmtErrSummary(s.errorTotalAll)})`);

    if (s.triggeredMatches > 0) {
        lines.push(`[발동 매치(${s.triggeredMatches}판) 합산 손익 vs 기대 비교]`);
        lines.push(`  - 현금 순손익: 실제 ${fmtMoneySeriesSpan(s.cashTrig)} vs 기대 ${fmtMoneySeriesSpan(s.expectedTrig)} (${fmtErrSummary(s.errorCashTrig)})`);
        lines.push(`  - 실질 손익(파괴가치 반영): 실제 ${fmtMoneySeriesSpan(s.totalTrig)} vs 기대 ${fmtMoneySeriesSpan(s.expectedTrig)} (${fmtErrSummary(s.errorTotalTrig)})`);

        if (s.branch1.matches > 0) {
            lines.push(`[분기 1: 윤회 공석 매치(${s.branch1.matches}판) 손익 비교]`);
            lines.push(`  - 실질 손익: 실제 ${fmtMoneySeriesSpan(s.branch1.total)} vs 단일 기대치 ${fmtMoneySeriesSpan(s.branch1.expected)} (${fmtErrSummary(s.branch1.errorTotal)})`);
        }
        if (s.branch2.matches > 0) {
            const b2 = s.branch2;
            lines.push(`[분기 2: 윤회 발동자(보스) 세부 손익 및 견제 기대값 vs 실측 괴리감 (${b2.matches}판)]`);
            lines.push(`  - 실질 총순익: 실제 ${fmtMoneySeriesSpan(b2.bossTotal)} vs 기대 ${fmtMoneySeriesSpan(b2.bossExpected)} (${fmtErrSummary(b2.errorBossTotal)})`);
            lines.push(`  - 현금 순손익: 실제 ${fmtMoneySeriesSpan(b2.bossCash)}`);
            lines.push(`  - 윤회 통행료 수입 (그을음 추가수취): 실제 ${fmtMoneySeriesSpan(b2.bossTollActual)} vs 기대 ${fmtMoneySeriesSpan(b2.bossTollExpected)} (${fmtErrSummary(b2.errorBossToll)})`);
            lines.push(`  - 윤회 영토 파괴 견제 가치 (상대 자산손실): 실제 ${fmtMoneySeriesSpan(b2.destroyActual)} vs 기대 ${fmtMoneySeriesSpan(b2.destroyExpected)} (${fmtErrSummary(b2.errorDestroy)})`);

            lines.push(`[분기 2: 비윤회 3인 연합 세부 손익 비교 (${b2.matches}판)]`);
            lines.push(`  - 3인 합산 실질 손익: 실제 ${fmtMoneySeriesSpan(b2.oppTotal)} vs 기대 ${fmtMoneySeriesSpan(b2.oppExpected)} (${fmtErrSummary(b2.errorOppTotal)})`);
            lines.push(`  - 3인 합산 현금 손익: 실제 ${fmtMoneySeriesSpan(b2.oppCash)}`);
        }

        const hc = s.haloConversion;
        lines.push(`[그을음 중 빛무리 전환 카드([113/114]) 기대 vs 실제 비교]`);
        lines.push(`  - 드로우 시도 기회: ${hc.attempts}회`);
        lines.push(`  - 기대 획득 횟수(비율): ${hc.expectedDraws.toFixed(2)}회 (\`${fmt4(hc.expectedRatePct)}%\`)`);
        lines.push(`  - 실제 획득 횟수(비율): ${hc.actualDraws}회 (\`${fmt4(hc.actualRatePct)}%\`)`);
        lines.push(`  - 전환율 오차율: ${fmtErrSummary(hc.errorRate)}`);
        lines.push(`  - 매치 기준 전환 성공률: \`${fmt4(hc.convertedMatchRatePct)}%\` (${hc.convertedMatches}/${s.triggeredMatches}판)`);

        lines.push(`- **그을음 발동판 세부 거래 항목 평균**`);
        lines.push(`  - 마카샤 지원금: \`${fmtMoney(s.makashaTrig.mean)}\``);
        lines.push(`  - 영토 매입 할인 절감액: \`${fmtMoney(s.discountTrig.mean)}\``);
        lines.push(`  - 순회 차단 손실액: \`${fmtMoney(s.lapBlockedTrig.mean)}\``);
        lines.push(`  - 윤회 ${Math.round((GAME_CONSTANTS.REINCARNATION_SKILL_COST_RATE || 0.10) * 100)}% 소모액: \`${fmtMoney(s.skillCostTrig.mean)}\``);
        lines.push(`  - 윤회 영토 파괴 손실 가치: \`${fmtMoney(s.destroyValTrig.mean)}\``);
        lines.push(`  - 그을음 추가 통행료 총 거래액: \`${fmtMoney(s.extraTollTrig.mean)}\``);

        lines.push(`- **발동 매치 내 플레이어 개인별 손익 분포**`);
        lines.push(`  - 개인 현금 손익: ${fmtMoneySeriesSpan(s.playerCashTrig)}`);
        lines.push(`  - 개인 실질 손익(파괴 포함): ${fmtMoneySeriesSpan(s.playerTotalTrig)}`);
    }

    if (gaPop && s100.triggeredMatches > 0) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 발동 매치: ${s100.triggeredMatches}판`);
        lines.push(`  - 현금 ${fmtMoney(s100.cashTrig.mean)} / 실질 ${fmtMoney(s100.totalTrig.mean)} vs 기대 ${fmtMoney(s100.expectedTrig.mean)} (${fmtErrSummary(s100.errorTotalTrig)})`);
    }

    lines.push('');
    lines.push(`### 15-2. 빛무리 기믹 손익 및 [죄업/후회] vs 상대 3인 편차 분석`);
    lines.push(`- **빛무리 발동 빈도 및 형태**`);
    lines.push(`  - 빛무리 발동률: \`${fmt4(h.triggerRatePct)}%\` (${h.triggeredMatches}판)`);
    lines.push(`  - 카드 강제 전환: ${h.cardMatches}판 / 자연 전환: ${h.naturalMatches}판`);
    lines.push(`  - 세부 분기: 죄업 ${h.karmaMatches}판 / 후회 ${h.regretMatches}판 / 균등자연 ${h.naturalUniformMatches}판`);

    lines.push(`[전체 매치 기준 빛무리 순손익 vs 기대 비교]`);
    lines.push(`  - 실제: ${fmtMoneySeriesSpan(h.all)} vs 기대: ${fmtMoneySeriesSpan(h.expectedAll)} (${fmtErrSummary(h.errorAll)})`);

    if (h.triggeredMatches > 0) {
        lines.push(`[발동 매치(${h.triggeredMatches}판) 전체 합계 비교]`);
        lines.push(`  - 실제: ${fmtMoneySeriesSpan(h.trig)} vs 기대: ${fmtMoneySeriesSpan(h.expectedTrig)} (${fmtErrSummary(h.errorTrig)})`);

        if (h.debuffedMatches > 0) {
            lines.push(`[죄업/후회 보유자 합산 (${h.debuffedMatches}판) 비교]`);
            lines.push(`  - 실제: ${fmtMoneySeriesSpan(h.debuffed)} vs 기대: ${fmtMoneySeriesSpan(h.debuffedExpected)} (${fmtErrSummary(h.errorDebuffed)})`);
            lines.push(`[상대 3인(수혜자) 합산 (${h.debuffedMatches}판) 비교]`);
            lines.push(`  - 실제: ${fmtMoneySeriesSpan(h.opp)} vs 기대: ${fmtMoneySeriesSpan(h.oppExpected)} (${fmtErrSummary(h.errorOpp)})`);

            if (h.karmaMatches > 0) {
                lines.push(`[죄업 세부 비교 (${h.karmaMatches}판)]`);
                lines.push(`  - 죄업 보유자: 실제 ${fmtMoney(h.karma.mean)} vs 기대 ${fmtMoney(h.karmaExpected.mean)} (${fmtErrSummary(h.errorKarma)})`);
                lines.push(`  - 상대 3인 합계: 실제 ${fmtMoney(h.karmaOpp.mean)} vs 기대 ${fmtMoney(h.karmaOppExpected.mean)} (${fmtErrSummary(h.errorKarmaOpp)})`);
            }
            if (h.regretMatches > 0) {
                lines.push(`[후회 세부 비교 (${h.regretMatches}판)]`);
                lines.push(`  - 후회 보유자: 실제 ${fmtMoney(h.regret.mean)} vs 기대 ${fmtMoney(h.regretExpected.mean)} (${fmtErrSummary(h.errorRegret)})`);
                lines.push(`  - 상대 3인 합계: 실제 ${fmtMoney(h.regretOpp.mean)} vs 기대 ${fmtMoney(h.regretOppExpected.mean)} (${fmtErrSummary(h.errorRegretOpp)})`);
            }
        }
        if (h.naturalUniformMatches > 0) {
            lines.push(`[윤회 공석 자연 빛무리 (${h.naturalUniformMatches}판 — 균일 수혜) 비교]`);
            lines.push(`  - 실제: ${fmtMoneySeriesSpan(h.naturalUniform)} vs 기대: ${fmtMoneySeriesSpan(h.naturalUniformExpected)} (${fmtErrSummary(h.errorNaturalUniform)})`);
        }

        lines.push(`- **빛무리 발동판 세부 거래 항목 평균**`);
        lines.push(`  - 통행료 수취 증분: \`${fmtMoney(h.tollGainAvg)}\``);
        lines.push(`  - 긍정 효과 배율 증분: \`${fmtMoney(h.posGainAvg)}\``);
        lines.push(`  - 순회 차단 손실액: \`${fmtMoney(h.lapBlockedAvg)}\``);
        lines.push(`  - 지불 통행료 증감: \`${fmtMoney(h.payerTollDiffAvg)}\``);
        lines.push(`  - 개인 순손익 분포: ${fmtMoneySeriesSpan(h.playerNetTrig)}`);
    }

    if (gaPop && h100.triggeredMatches > 0) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 발동 매치: ${h100.triggeredMatches}판`);
        lines.push(`  - 실제 ${fmtMoney(h100.trig.mean)} vs 기대 ${fmtMoney(h100.expectedTrig.mean)} (${fmtErrSummary(h100.errorTrig)})`);
    }

    lines.push('');
    lines.push(`### 15-3. 월드 기믹(낮/밤)에 의한 통행료 손익 및 기대 수익 오차율`);
    lines.push(`- **낮/밤 활성 매치 및 턴**`);
    lines.push(`  - 활성 매치 수: ${dn.activeMatches}판`);
    lines.push(`  - 낮 활성 턴: ${dn.dayTurnsTotal}턴`);
    lines.push(`  - 밤 활성 턴: ${dn.nightTurnsTotal}턴`);

    lines.push(`[전체 매치 기준 낮/밤 추가 통행료 vs 기대 비교]`);
    lines.push(`  - 실제: ${fmtMoneySeriesSpan(dn.totalAll)} vs 기대: ${fmtMoneySeriesSpan(dn.expectedAll)} (${fmtErrSummary(dn.errorAll)})`);

    if (dn.activeMatches > 0) {
        lines.push(`[활성 매치(${dn.activeMatches}판) 기준 추가 통행료 vs 기대 비교]`);
        lines.push(`  - 전체 실제: ${fmtMoneySeriesSpan(dn.totalActive)} (낮 ${fmtMoneySeriesSpan(dn.dayActive)} / 밤 ${fmtMoneySeriesSpan(dn.nightActive)})`);
        lines.push(`  - 기대 통행료: ${fmtMoneySeriesSpan(dn.expectedActive)}`);
        lines.push(`  - 오차율: ${fmtErrSummary(dn.errorActive)}`);

        lines.push(`- **활성 매치 플레이어별 손익 분포**`);
        lines.push(`  - 추가 수취액: ${fmtMoneySeriesSpan(dn.playerGainActive)}`);
        lines.push(`  - 추가 지불액: ${fmtMoneySeriesSpan(dn.playerLossActive)}`);
        lines.push(`  - 개인 순이익: ${fmtMoneySeriesSpan(dn.playerNetActive)}`);
    }

    if (gaPop) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 전체 실제: ${fmtMoney(dn100.totalAll.mean)} vs 기대: ${fmtMoney(dn100.expectedAll.mean)} (${fmtErrSummary(dn100.errorAll)})`);
    }
    lines.push('');
    return lines;
}

function formatSummaryCardRarityLines(cr100, crPop = null, totalSimulated = 0, sampleCycles = MARBLE_MAX_HISTORY) {
    const src = crPop || cr100;
    const scopeLabel = crPop ? `전체 ${totalSimulated}판 모수 기준 (대표 ${sampleCycles}사이클 병기)` : `보관 ${totalSimulated}사이클 기준`;
    const lines = [];
    const fmtCardTag = (c) => (c ? `[#${c.id}] ${c.name}(${c.count}회)` : '없음');

    lines.push(`## 16. 전체 카드 도감(${src.catalogSize}종) 미등장·최소 드로우 희소성 및 평균 오차율`);
    lines.push(`> 집계 기준: **${scopeLabel}**\n`);

    lines.push(`- **도감 미등장 카드 현황**`);
    lines.push(`  - 판당 평균 미등장: \`${fmt4(src.matchUnusedCatalog.mean)}종\` / 전체 \`${src.catalogSize}종\` (최소 \`${fmt4(src.matchUnusedCatalog.min)}종\` ~ 최대 \`${fmt4(src.matchUnusedCatalog.max)}종\`)${crPop ? ` *(${sampleCycles}사이클: 평균 \`${fmt4(cr100.matchUnusedCatalog.mean)}종\`)*` : ''}`);
    lines.push(`  - 집계 구간 누적 0회(전혀 안 뽑힌) 카드 수: ${crPop ? `${totalSimulated}판 전체 **${crPop.unusedCount}종** (일반 ${crPop.unusedByGrade.normal} / 특수 ${crPop.unusedByGrade.special} / 보물 ${crPop.unusedByGrade.treasure}) · ` : ''}**대표 ${sampleCycles}사이클 ${cr100.unusedCount}종** (일반 ${cr100.unusedByGrade.normal} / 특수 ${cr100.unusedByGrade.special} / 보물 ${cr100.unusedByGrade.treasure})`);

    if (cr100.unusedCards.length > 0) {
        lines.push(`  - ${sampleCycles}사이클 0회 카드 목록: ${cr100.unusedCards.map(c => `[#${c.id}]${c.name}`).join(', ')}`);
    }
    if (crPop && crPop.unusedCards.length > 0) {
        lines.push(`  - ${totalSimulated}판 전체 0회 카드 목록: ${crPop.unusedCards.map(c => `[#${c.id}]${c.name}`).join(', ')}`);
    }

    const renderComparisonBlock = (title, cr) => {
        const out = [];
        out.push(`[${title}]`);
        out.push(`  - 총 드로우: ${cr.totalDraws}회 (전체 ${cr.catalogSize}종 도감 평균: \`${fmt4(cr.overallCardAvg)}회\`)`);
        out.push(`  - 희소 기준(\`≤${cr.rareThreshold}회\`): 총 ${cr.rareCount}종 해당`);
        out.push(`  - 최다 뽑힘: ${fmtCardTag(cr.mostDrawnCard)}`);
        out.push(`  - 최소 뽑힘 (0회 포함): ${fmtCardTag(cr.leastDrawnCard)}`);
        out.push(`  - 최소 뽑힘 (1회 이상): ${fmtCardTag(cr.leastDrawnNonZeroCard)}`);
        out.push(`  - 최다+최소 중간평균: \`${fmt4(cr.topBottomMidAvg)}회\``);
        out.push(`  - 하위 5종 평균 (0회 포함): \`${fmt4(cr.bottom5Avg)}회\``);
        out.push(`  - 하위 5종 평균 (1회 이상): \`${fmt4(cr.bottomNonZero5Avg)}회\``);
        out.push(`  - 최소 뽑힘 카드 vs 전체 평균 오차: ${fmtErrSummary(cr.errLeastVsOverall)}`);
        out.push(`  - 최소 뽑힘 카드 vs 중간 평균 오차: ${fmtErrSummary(cr.errLeastVsTopBottom)}`);
        out.push(`  - 하위 5종 평균 vs 전체 평균 오차: ${fmtErrSummary(cr.errBottom5VsOverall)}`);
        out.push(`  - 하위 5종 평균 vs 중간 평균 오차: ${fmtErrSummary(cr.errBottom5VsTopBottom)}`);
        if (cr.bottom5Cards.length > 0) {
            out.push(`  - 하위 5종 카드 목록: ${cr.bottom5Cards.map(fmtCardTag).join(', ')}`);
        }
        return out;
    };

    lines.push('');
    if (crPop) {
        lines.push(...renderComparisonBlock(`전체 ${totalSimulated}판 모수 기준 희소성 비교`, crPop));
        lines.push('');
    }
    lines.push(...renderComparisonBlock(`대표 ${cr100.matchCount}사이클 기준 희소성 비교`, cr100));

    const renderGradeAuditSection = (title, cr) => {
        if (!cr || !Array.isArray(cr.gradeExpectationAudits) || cr.gradeExpectationAudits.length === 0) return [];
        const out = [];
        out.push('');
        out.push(`### 16-1. 카드 총 갯수(등급분류)별 이론 기댓값 vs 실제 뽑힌 횟수 괴리감 분석 (${title})`);
        out.push(`| 등급 분류 | 카드 종류 수 | 등급 총 드로우 | 1종당 기대 횟수 | 이론 균등 비중 | 평균 절대 괴리율 | RMSE | 최다 초과 카드 (실제-기대) | 최다 미달 카드 (실제-기대) |`);
        out.push(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :--- |`);
        for (const ga of cr.gradeExpectationAudits) {
            const overStr = ga.maxOverCard ? `[#${ga.maxOverCard.id}] ${ga.maxOverCard.name} (${ga.maxOverCard.diff >= 0 ? '+' : ''}${fmt4(ga.maxOverCard.diff)}회)` : '없음';
            const underStr = ga.maxUnderCard ? `[#${ga.maxUnderCard.id}] ${ga.maxUnderCard.name} (${ga.maxUnderCard.diff >= 0 ? '+' : ''}${fmt4(ga.maxUnderCard.diff)}회)` : '없음';
            out.push(
                `| ${ga.label} | ${ga.cardCount}종 | ${ga.gradeTotalDraws}회 | \`${fmt4(ga.expectedPerCard)}회\` | \`${fmt4(ga.expectedSharePct)}%\` | \`${fmt4(ga.meanAbsErrorPct)}%\` | \`${fmt4(ga.rmse)}회\` | ${overStr} | ${underStr} |`
            );
        }
        for (const ga of cr.gradeExpectationAudits) {
            out.push('');
            out.push(`- **${ga.label} 전체 ${ga.cardCount}종 기대 횟수(\`${fmt4(ga.expectedPerCard)}회\`, 비중 \`${fmt4(ga.expectedSharePct)}%\`) 대비 실제 드로우 편차**`);
            out.push(`| 카드 ID | 카드 명칭 | 실제 드로우 | 기대 드로우 | 기대 대비 증감 | 실제 비중 | 괴리율(부호) |`);
            out.push(`| :---: | :--- | :---: | :---: | :---: | :---: | :---: |`);
            for (const c of ga.cards) {
                const diffSign = `${c.diff >= 0 ? '+' : ''}${fmt4(c.diff)}회`;
                const errSign = `${c.signedErrorPct >= 0 ? '+' : ''}${fmt4(c.signedErrorPct)}%`;
                out.push(
                    `| #${c.id} | ${c.name} | ${c.actual}회 | \`${fmt4(c.expected)}회\` | \`${diffSign}\` | \`${fmt4(c.actualSharePct)}%\` | \`${errSign}\` |`
                );
            }
        }
        return out;
    };

    lines.push(...renderGradeAuditSection(
        crPop ? `전체 ${totalSimulated}판 모수` : `보관 ${cr100.matchCount}사이클`,
        src
    ));
    lines.push('');
    return lines;
}

function formatSummaryAltarAndVoidLines(ga100, gaPop = null, totalSimulated = 0, sampleCycles = MARBLE_MAX_HISTORY) {
    const src = gaPop || ga100;
    const al = src?.altar;
    const vg = src?.voidGimmick;
    if (!al || !vg) return [];
    const al100 = ga100?.altar;
    const vg100 = ga100?.voidGimmick;
    const scope = gaPop ? `전체 ${totalSimulated}판 모수 기준 (괄호 안은 대표 ${sampleCycles}사이클)` : `보관 ${totalSimulated}사이클 기준`;
    const lines = [];

    lines.push('## 17. 망가진 제단(도착·교환·최다교환자 손익) 및 셰이디의 차원(도착·피해량) 분석');
    lines.push(`> 집계 기준: **${scope}**\n`);

    lines.push('### 17-1. 망가진 제단 도착 · 보물 교환 · 최다 교환자(교환수익 + 그을음손익) vs 윤회 보스 비교');
    lines.push(`- **제단 도착 빈도 및 기대치 괴리**`);
    lines.push(`  - 판당 전체 도착 횟수: ${fmtSeriesSpan(al.visits)} (주사위 ${fmtSeriesSpan(al.rollVisits)})`);
    lines.push(`  - 주사위 기대 도착 횟수: ${fmtSeriesSpan(al.expectedRollVisits)} (${fmtErrSummary(al.errorRollVisits)})`);
    lines.push(`  - 전체 기대 도착(카드포함): ${fmtSeriesSpan(al.expectedTotalVisits)} (${fmtErrSummary(al.errorTotalVisits)})`);
    lines.push(`- **제단 보물 교환 현황**`);
    lines.push(`  - 판당 교환 횟수: ${fmtSeriesSpan(al.tradeCount)}`);
    lines.push(`  - 판당 교환 카드 수: ${fmtSeriesSpan(al.tradeCards)}`);
    lines.push(`  - 1인+ 교환 발생 매치 비율: \`${fmt4(al.traderMatchRatePct)}%\` (${al.traderMatches}판)`);
    if (al.traderMatches > 0) {
        lines.push(`[최다 보물 교환자 합산 순손익 (제단 교환수익 + 그을음 손익) vs 기대 비교 (${al.traderMatches}판)]`);
        lines.push(`  - 최다 교환자 교환 보상 평균: ${fmtMoneySeriesSpan(al.topTraderRewardActual)}`);
        lines.push(`  - 최다 교환자 그을음 실질 손익 평균: ${fmtMoneySeriesSpan(al.topTraderSootActual)}`);
        lines.push(`  - 합산 실질 순손익: 실제 ${fmtMoneySeriesSpan(al.topTraderCombinedActual)} vs 기대 ${fmtMoneySeriesSpan(al.topTraderCombinedExpected)} (${fmtErrSummary(al.errorTopTraderCombined)})`);
        lines.push(`  - 최다 교환자가 윤회 발동자인 매치: ${al.topTraderReincarnatedCount}/${al.traderMatches}판 (\`${fmt4(clampPct((al.topTraderReincarnatedCount / al.traderMatches) * 100))}%\`)`);
        if (al.bossCompareMatches > 0) {
            lines.push(`[분기 2(윤회 탄생) 교집합 ${al.bossCompareMatches}판: 최다 교환자 vs 윤회 보스 실질 손익 비교]`);
            lines.push(`  - 최다 교환자 합산 손익: ${fmtMoneySeriesSpan(al.topTraderInB2Actual)}`);
            lines.push(`  - 윤회 발동자(보스) 실질 총순익: ${fmtMoneySeriesSpan(al.reincarnatedBossActual)}`);
        }
    }
    if (gaPop && al100) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 제단 도착: \`${fmt4(al100.visits.mean)}회\` (주사위 \`${fmt4(al100.rollVisits.mean)}회\` vs 기대 \`${fmt4(al100.expectedRollVisits.mean)}회\`, ${fmtErrSummary(al100.errorRollVisits)})`);
        lines.push(`  - 교환 횟수/카드: \`${fmt4(al100.tradeCount.mean)}회\` / \`${fmt4(al100.tradeCards.mean)}장\``);
        if (al100.traderMatches > 0) {
            lines.push(`  - 최다 교환자 합산: ${fmtMoney(al100.topTraderCombinedActual.mean)} vs 기대 ${fmtMoney(al100.topTraderCombinedExpected.mean)} (${fmtErrSummary(al100.errorTopTraderCombined)})`);
        }
    }

    lines.push('');
    lines.push('### 17-2. 셰이디의 차원([28]) 도착 · 갇힘 빈도 및 기대 피해량 분석');
    lines.push(`- **셰이디의 차원 도착 및 갇힘 현황**`);
    lines.push(`  - 판당 직접 도착 횟수: ${fmtSeriesSpan(vg.visits)} (주사위 ${fmtSeriesSpan(vg.rollVisits)} · 카드/이동 ${fmtSeriesSpan(vg.cardArrivals)})`);
    lines.push(`  - 주사위 기대 도착 횟수: ${fmtSeriesSpan(vg.expectedRollVisits)} (${fmtErrSummary(vg.errorRollVisits)})`);
    lines.push(`  - 전체 기대 도착(카드포함): ${fmtSeriesSpan(vg.expectedTotalVisits)} (${fmtErrSummary(vg.errorTotalVisits)})`);
    lines.push(`  - 총 갇힘 인원(끌려옴 포함): ${fmtSeriesSpan(vg.trappedCount)} (동반 끌려옴 ${fmtSeriesSpan(vg.pulledCount)} · 림 카드 회피 ${fmtSeriesSpan(vg.rimEvadedCount)})`);
    lines.push(`  - 셰이디의 장난(탈출 미니게임): 시도 ${fmtSeriesSpan(vg.challengeCount)} · 성공 ${fmtSeriesSpan(vg.escapeSuccessCount)} · 실패 ${fmtSeriesSpan(vg.escapeFailCount)} (탈출률 \`${fmt4(vg.escapeRatePct || 0)}%\` vs 이론 \`${fmt4(vg.expectedEscapeRatePct || 45.1389)}%\`)`);
    lines.push(`- **차원 갇힘 피해량 및 승률 영향**`);
    lines.push(`  - 전체 매치 기준 차원 피해 총액: ${fmtMoneySeriesSpan(vg.damageAll)} (순회기회손실 ${fmtMoneySeriesSpan(vg.lapLossAll)} · 유지/이자손실 ${fmtMoneySeriesSpan(vg.upkeepLossAll)})`);
    lines.push(`  - 도착 기대 기반 기준 손실액 vs 실측 피해량: 기대 ${fmtMoneySeriesSpan(vg.expectedArrivalDamageAll)} vs 실제 ${fmtMoneySeriesSpan(vg.damageAll)} (${fmtErrSummary(vg.errorDamageAll)})`);
    if (vg.activeMatches > 0) {
        lines.push(`  - 갇힘 발생 매치(${vg.activeMatches}판, \`${fmt4(vg.activeMatchRatePct)}%\`) 기준 피해량: ${fmtMoneySeriesSpan(vg.damageActive)}`);
    }
    lines.push(`  - 차원 갇힘 경험자 승률: \`${fmt4(vg.trappedWinRatePct)}%\` (${vg.trappedWins}/${vg.trappedPlayers}승) vs 미경험자 승률: \`${fmt4(vg.untrappedWinRatePct)}%\` (${vg.untrappedWins}/${vg.untrappedPlayers}승)`);
    if (gaPop && vg100) {
        lines.push(`[${sampleCycles}사이클 표본 참고 비교]`);
        lines.push(`  - 차원 도착: \`${fmt4(vg100.visits.mean)}회\` (주사위 \`${fmt4(vg100.rollVisits.mean)}회\` vs 기대 \`${fmt4(vg100.expectedRollVisits.mean)}회\`, ${fmtErrSummary(vg100.errorRollVisits)})`);
        lines.push(`  - 차원 피해량: ${fmtMoney(vg100.damageAll.mean)} (기대 ${fmtMoney(vg100.expectedArrivalDamageAll.mean)}, ${fmtErrSummary(vg100.errorDamageAll)})`);
    }
    lines.push('');
    return lines;
}

export function renderAverage100LogText(cycles, meta = null, targetCycles = MARBLE_MAX_HISTORY) {
    const count = Array.isArray(cycles) ? cycles.length : 0;
    const sampleCycles = Math.max(1, Number(targetCycles) || MARBLE_MAX_HISTORY);
    if (count === 0) {
        return [
            `# 엘리아스 마블 - 최근 ${sampleCycles}사이클 평균 밸런스 로그 (보관: 0 / ${sampleCycles}판)`,
            '',
            '> 아직 기록된 사이클 데이터가 없습니다.',
            ''
        ].join('\n');
    }

    const lines = [];
    lines.push(`# 엘리아스 마블 - 최근 ${sampleCycles}사이클 평균 밸런스 로그 (보관 표본: ${count}판)`);
    lines.push('');
    lines.push(`> **표기 기준**: 모든 비율·괴리감·격차 척도는 \`0.0000% ~ 100.0000%\` 소수점 4자리로 산출하며, \`[기준① 1사이클 개별 최소/최대 vs ${sampleCycles}사이클 평균]\`과 \`[기준② 1사이클 평균 최소/최대 vs ${sampleCycles}사이클 평균]\`을 병기합니다.`);
    lines.push('');

    const pop = meta?.populationSummary;
    if (pop && pop.totalSimulated > count) {
        lines.push(`## 0. 전체 ${pop.totalSimulated}판 시뮬레이션 모수 요약 vs 대표 ${count}사이클 선별 기준`);
        const policyNote = pop.policy === 'quantile_preserve'
            ? `총 **${pop.totalSimulated}판**을 연속 구동한 뒤 6대 핵심 경제·변동성 지표 복합 분위수(Decile Midpoints) 기준으로 대표 **${count}사이클**을 균등 추출해 전형적인 10판 체감을 왜곡 없이 반영했습니다.`
            : `총 **${pop.totalSimulated}판**을 연속 구동하여 각 지표의 최솟값·최댓값 갱신 판을 자동 보호하고, \`${count}판\` 초과분은 정규화 특징 공간에서 근사값이 가장 밀집된 구간부터 1판씩 정리해 극단 경계와 분포 다양성을 동시에 보존한 **${count}사이클**을 추출했습니다.`;
        lines.push(`> ${policyNote}`);
        lines.push('');
        lines.push(`| 항목 | 전체 ${pop.totalSimulated}판 모수 평균 | 비고 |`);
        lines.push(`| :--- | :---: | :--- |`);
        lines.push(`| 평균 최종 턴 수 / 조기종료율 | \`${fmt4(pop.avgFinalTurn)}턴\` / \`${fmt4(pop.earlyEndPct)}%\` | 20턴 풀매치 vs 파산 조기종료 |`);
        lines.push(`| 플레이어 개별 순자산 평균 (최소~최대) | \`${fmt4(pop.avgNetWorth)}엘드르\` | \`${fmtMoney(pop.minNetWorth)}\` ~ \`${fmtMoney(pop.maxNetWorth)}\` |`);
        lines.push(`| 순자산 불균형(격차) / 순위 괴리감 | \`${fmt4(pop.avgPostNetWorthGapPct)}%\` / \`${fmt4(pop.avgCashVsTotalRankDiscPct)}%\` | 0.0000% ~ 100.0000% |`);
        lines.push(`| 특수영토 가치 차이율 | \`${fmt4(pop.avgSpecTerritoryDiscPct)}%\` | 정산전 기대수금 vs 실제수금 |`);
        lines.push(`| 평균 1회 이동 칸수 / 보물 획득(기댓값) | \`${fmt4(pop.avgMoveSpaces)}칸\` / \`${fmt4(pop.avgTreasureObtained)}개\` | 마르코프 기댓값 \`${fmt4(pop.avgTreasureMarkovExpected)}개\` |`);
        lines.push(`| 판당 순위 변동 / 그을음 발동률 | \`${fmt4(pop.avgTotalRankChanges)}회\` / \`${fmt4(pop.sootTriggerRatePct)}%\` | 윤회 발생 매치: ${pop.reincarnatedMatches}판 |`);
        if (pop.loan) {
            const popMinLoan = pop.loan.singleLoanCount > 0 ? fmtMoney(pop.loan.minSingleLoan) : '없음';
            const popMaxLoan = pop.loan.singleLoanCount > 0 ? fmtMoney(pop.loan.maxSingleLoan) : '없음';
            lines.push(`| 대출 빈도 / 단일 대출금 범위 | 판당 \`${fmt4(pop.loan.loansPerMatchAvg)}회\` (이용매치 \`${fmt4(pop.loan.matchLoanRatePct)}%\`) | 최소 \`${popMinLoan}\` ~ 최대 \`${popMaxLoan}\` (최다 ${pop.loan.maxLoanCountRec.value}회/${pop.loan.maxBorrowedRec.value > 0 ? fmtMoney(pop.loan.maxBorrowedRec.value) : '0엘드르'}) |`);
        }
        if (pop.cards) {
            const pc = pop.cards;
            lines.push(`| 카드 드로우 등급 비율 (일반/특수/보물) | \`${fmt4(pc.gradeRatesPct.normal)}%\` / \`${fmt4(pc.gradeRatesPct.special)}%\` / \`${fmt4(pc.gradeRatesPct.treasure)}%\` | 총 ${pc.totalDraws}회 · 중복이상 ${pc.duplicateAnomalies}건 |`);
        }
        if (Array.isArray(pop.strategies) && pop.strategies.length > 0) {
            lines.push('');
            lines.push(`- **전체 ${pop.totalSimulated}판 기준 전략군 승률 순위**: ` +
                pop.strategies.map(s => `${s.label} \`${fmt4(s.appearances > 0 ? (s.wins / s.appearances) * 100 : 0)}%\`(${s.wins}승/${s.appearances})`).join(' | '));
        }
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    // 1. 총 자산, 불균형, 최소/최대
    const allPlayerNetWorths = [];
    const allPlayerTotalAssets = [];
    const cycleAvgNetWorths = [];
    const cycleAvgTotalAssets = [];
    const cycleAssetGaps = [];
    const cycleCashGaps = [];

    // 2. 현금 vs 총자산 순위 괴리감
    const indRankDiscrepancies = [];
    const cycleAvgRankDiscrepancies = [];
    const cycleMatchRankDiscrepancies = [];

    // 3. 특수영토 가치 괴리감
    const indSpecDiscrepancies = [];
    const cycleAvgSpecDiscrepancies = [];
    const cycleMatchSpecDiscrepancies = [];

    // 4. 턴수
    const cycleTurns = [];
    let earlyEndCount = 0;

    // 5. 평균 이동 칸수
    const indAvgMoves = [];
    const cycleAvgMoves = [];

    // 6. 보물 획득 및 마르코프 기댓값
    const indTreasureAcquired = [];
    const cycleAvgTreasurePerPlayer = [];
    const cycleTotalTreasure = [];
    const cycleMarkovExpected = [];
    const cycleMarkovRatePct = [];
    const cyclePostAltarDraws = [];

    // 7. 턴당 순위 변동 횟수 및 변동률
    const indRankChanges = [];
    const cycleAvgRankChangesPerPlayer = [];
    const cycleTotalRankChanges = [];
    const cycleRankChangeRatePct = [];

    // 8. 전략군 & 9. 추가 밸런스 지표
    const strategyStats = new Map();
    const extra = {
        sootTriggered: 0,
        sootBranch1: 0,
        sootBranch2: 0,
        reincarnatedCount: 0,
        haloNatural: 0,
        haloCard: 0,
        altarFirstVisits: 0,
        altarPortalUses: 0,
        altarTradeCount: 0,
        bankruptPlayers: 0,
        totalPlayers: 0,
        loans: 0,
        lapPass: 0,
        lapBonus: 0,
        lapBlocked: 0,
        tollsCount: 0,
        tollsTotal: 0,
        maxSingleTollSum: 0,
        crisisCount: 0,
        activeCardsUsed: 0,
        cardsDrawn: 0
    };

    for (const c of cycles) {
        const m = c.metrics || {};
        const ps = c.players || [];

        const pNets = ps.map(p => p.netWorth);
        const pTotals = ps.map(p => p.totalAsset);
        allPlayerNetWorths.push(...pNets);
        allPlayerTotalAssets.push(...pTotals);
        cycleAvgNetWorths.push(summarizeSeries(pNets).mean);
        cycleAvgTotalAssets.push(summarizeSeries(pTotals).mean);
        cycleAssetGaps.push(m.postNetWorthGapPct || 0);
        cycleCashGaps.push(m.preCashGapPct || 0);

        const pRankDiscs = ps.map(p => p.cashVsTotalAssetDiscrepancyPct || 0);
        indRankDiscrepancies.push(...pRankDiscs);
        cycleAvgRankDiscrepancies.push(summarizeSeries(pRankDiscs).mean);
        cycleMatchRankDiscrepancies.push(m.cashVsTotalAssetDiscrepancyPct || 0);

        const specHolders = ps.filter(p => p.specialTerritoryOwnedCount > 0 || p.specialTerritoryInvestedValue > 0);
        const cSpecDiscs = specHolders.map(p => p.specialTerritoryDiscrepancyPct || 0);
        if (cSpecDiscs.length > 0) {
            indSpecDiscrepancies.push(...cSpecDiscs);
            cycleAvgSpecDiscrepancies.push(summarizeSeries(cSpecDiscs).mean);
        }
        cycleMatchSpecDiscrepancies.push(m.specialTerritoryDiscrepancyPct || 0);

        cycleTurns.push(c.finalTurn || 0);
        if (c.endedEarlyByBankruptcy) earlyEndCount++;

        const cMoveAvgs = ps.filter(p => p.totalRolls > 0).map(p => p.avgMoveSpaces || 0);
        indAvgMoves.push(...cMoveAvgs);
        cycleAvgMoves.push(m.avgMoveSpaces || 0);

        const pTreasures = ps.map(p => p.treasureAcquiredCount || 0);
        indTreasureAcquired.push(...pTreasures);
        cycleAvgTreasurePerPlayer.push(summarizeSeries(pTreasures).mean);
        cycleTotalTreasure.push(m.treasureTotalObtainedCount || 0);
        cycleMarkovExpected.push(m.treasureMarkovExpectedCount || 0);
        cycleMarkovRatePct.push(m.treasureMarkovExpectedRatePct || 0);
        cyclePostAltarDraws.push(m.postAltarEligibleDraws || 0);

        const pRanks = ps.map(p => p.rankChangeCount || 0);
        indRankChanges.push(...pRanks);
        cycleAvgRankChangesPerPlayer.push(summarizeSeries(pRanks).mean);
        cycleTotalRankChanges.push(m.totalRankChanges || 0);
        cycleRankChangeRatePct.push(m.rankChangeRatePct || 0);

        if ((m.sootTriggerCount || 0) > 0) extra.sootTriggered++;
        if (m.sootBranch === 1) extra.sootBranch1++;
        if (m.sootBranch === 2) extra.sootBranch2++;
        if (m.reincarnatedPlayerName) extra.reincarnatedCount++;
        extra.haloNatural += m.haloNaturalCount || 0;
        extra.haloCard += m.haloCardCount || 0;
        extra.altarFirstVisits += m.altarFirstVisits || 0;
        extra.altarPortalUses += m.altarPortalUses || 0;
        extra.altarTradeCount += m.altarTradeCount || 0;

        for (const p of ps) {
            extra.totalPlayers++;
            if (p.isBankruptFinal) extra.bankruptPlayers++;
            extra.loans += p.loanCount || 0;
            extra.lapPass += p.lapPassCount || 0;
            extra.lapBonus += p.lapBonusCount || 0;
            extra.lapBlocked += p.lapBlockedCount || 0;
            extra.tollsCount += p.tollsPaidCount || 0;
            extra.tollsTotal += p.tollsPaidTotal || 0;
            extra.maxSingleTollSum += p.maxSingleTollPaid || 0;
            extra.crisisCount += p.turnStartCrisisCount || 0;
            extra.activeCardsUsed += p.activeCardsUsed || 0;
            extra.cardsDrawn += p.cardsDrawn || 0;

            const sCode = p.strategy?.code || 'UNKNOWN';
            const sLabel = p.strategy?.label || sCode;
            if (!strategyStats.has(sCode)) {
                strategyStats.set(sCode, { code: sCode, label: sLabel, appearances: 0, wins: 0, rankSum: 0 });
            }
            const st = strategyStats.get(sCode);
            st.appearances++;
            if (p.settlementRank === 1 && !p.isBankruptFinal) st.wins++;
            st.rankSum += p.settlementRank;
        }
    }

    const netInd = summarizeSeries(allPlayerNetWorths);
    const netCyc = summarizeSeries(cycleAvgNetWorths);
    const totInd = summarizeSeries(allPlayerTotalAssets);
    const totCyc = summarizeSeries(cycleAvgTotalAssets);
    const gapSum = summarizeSeries(cycleAssetGaps);
    const cashGapSum = summarizeSeries(cycleCashGaps);

    lines.push('## 1. 플레이어들의 평균 총 자산, 현금/자산 불균형 정도, 자산의 최솟값과 최댓값');
    lines.push(`- **플레이어 자산 지표**`);
    lines.push(`  - 개별 순자산 평균: \`${fmt4(netInd.mean)}엘드르\` (최솟값: \`${fmtMoney(netInd.min)}\`, 최댓값: \`${fmtMoney(netInd.max)}\`)`);
    lines.push(`  - 평균 자산 불균형 정도 (정산 후 순자산 격차): \`${fmt4(gapSum.mean)}%\` (최소 \`${fmt4(gapSum.min)}%\` ~ 최대 \`${fmt4(gapSum.max)}%\`)`);
    lines.push(`  - 평균 현금 불균형 정도 (정산 전 현금 격차): \`${fmt4(cashGapSum.mean)}%\` (최소 \`${fmt4(cashGapSum.min)}%\` ~ 최대 \`${fmt4(cashGapSum.max)}%\`)\n`);
    lines.push(formatDualComparisonLine('플레이어 순자산 비교', '엘드르', netInd, netCyc, netInd.mean, false, sampleCycles));
    lines.push('');
    lines.push(formatDualComparisonLine('플레이어 총자산(부채차감전) 비교', '엘드르', totInd, totCyc, totInd.mean, false, sampleCycles));
    lines.push('');

    const rankInd = summarizeSeries(indRankDiscrepancies);
    const rankCyc = summarizeSeries(cycleAvgRankDiscrepancies);
    const rankMatch = summarizeSeries(cycleMatchRankDiscrepancies);
    lines.push('## 2. 정산 이전 현금 순위 vs 정산 이후 총 자산 순위 괴리감 척도 평균 및 비교');
    lines.push(`- **매치 순위 괴리 지표**`);
    lines.push(`  - 매치 전체 순위 괴리감 평균: \`${fmt4(rankMatch.mean)}%\` (판 최소 \`${fmt4(rankMatch.min)}%\` ~ 최대 \`${fmt4(rankMatch.max)}%\`)\n`);
    lines.push(formatDualComparisonLine('개인별 순위 괴리 척도 비교', '%', rankInd, rankCyc, rankInd.mean, true, sampleCycles));
    lines.push('');

    const specInd = summarizeSeries(indSpecDiscrepancies);
    const specCyc = summarizeSeries(cycleAvgSpecDiscrepancies);
    const specMatch = summarizeSeries(cycleMatchSpecDiscrepancies);
    lines.push('## 3. 정산 이전 특수 영토 가치 척도 vs 실제 정산 가치 차이 평균 및 비교');
    lines.push(`- **특수영토 가치 차이 지표**`);
    lines.push(`  - 매치 합산 특수영토 가치 괴리율 평균: \`${fmt4(specMatch.mean)}%\` (판 최소 \`${fmt4(specMatch.min)}%\` ~ 최대 \`${fmt4(specMatch.max)}%\`)\n`);
    if (specInd.count > 0) {
        lines.push(formatDualComparisonLine('소유자별 특수영토 가치 차이율 비교', '%', specInd, specCyc, specInd.mean, true, sampleCycles));
    } else {
        lines.push(`- 아직 특수 영토 소유 표본이 없습니다.`);
    }
    lines.push('');

    const turnSum = summarizeSeries(cycleTurns);
    lines.push('## 4. 전체 사이클에서의 평균 턴 수');
    lines.push(`- **게임 진행 턴 수 및 종료 형태**`);
    lines.push(`  - 평균 최종 턴 수: \`${fmt4(turnSum.mean)}턴\` (개별 최소 ${turnSum.min}턴 ~ 최대 ${turnSum.max}턴)`);
    lines.push(`  - 평균 대비 편차 범위: 최소 \`${fmt4(turnSum.min - turnSum.mean)}턴\` / 최대 \`+${fmt4(turnSum.max - turnSum.mean)}턴\``);
    lines.push(`  - 조기 종료율(생존 1인 이하): \`${fmt4(clampPct((earlyEndCount / count) * 100))}%\` (${earlyEndCount}/${count}판)\n`);

    const moveInd = summarizeSeries(indAvgMoves);
    const moveCyc = summarizeSeries(cycleAvgMoves);
    lines.push(`## 5. ${sampleCycles}사이클 기준 평균 1회 이동 칸수의 평균 및 비교`);
    lines.push(formatDualComparisonLine('평균 1회 이동 칸수 비교', '칸', moveInd, moveCyc, moveCyc.mean, false, sampleCycles));
    lines.push('');

    const trInd = summarizeSeries(indTreasureAcquired);
    const trCyc = summarizeSeries(cycleAvgTreasurePerPlayer);
    const trMatch = summarizeSeries(cycleTotalTreasure);
    const mkExp = summarizeSeries(cycleMarkovExpected);
    const mkRate = summarizeSeries(cycleMarkovRatePct);
    const drawsSum = summarizeSeries(cyclePostAltarDraws);
    lines.push('## 6. 플레이어별 보물 카드 획득 수 및 제단 개방 후 확률 테이블 기반 기댓값 평균');
    lines.push(`- **보물 카드 획득 및 마르코프 기댓값**`);
    lines.push(`  - 판당 보물 획득 총수 평균: \`${fmt4(trMatch.mean)}개\``);
    lines.push(`  - 마르코프 이론 기댓값 평균: \`${fmt4(mkExp.mean)}개\` (편차: \`${fmt4(trMatch.mean - mkExp.mean)}개\`)`);
    lines.push(`  - 판당 제단 해금 후 평균 판정횟수: \`${fmt4(drawsSum.mean)}회\``);
    lines.push(`  - 평균 드로우당 기댓률: \`${fmt4(mkRate.mean)}%\`\n`);
    lines.push(formatDualComparisonLine('플레이어 1인당 보물 획득 수 비교', '개', trInd, trCyc, trInd.mean, false, sampleCycles));
    lines.push('');

    const rcInd = summarizeSeries(indRankChanges);
    const rcCyc = summarizeSeries(cycleAvgRankChangesPerPlayer);
    const rcMatch = summarizeSeries(cycleTotalRankChanges);
    const rcRate = summarizeSeries(cycleRankChangeRatePct);
    lines.push('## 7. 정산 이전 자산 순위가 매 턴 변동한 횟수의 평균 및 변동 비율');
    lines.push(`- **순위 변동 지표**`);
    lines.push(`  - 판당 총 순위 변동 횟수 평균: \`${fmt4(rcMatch.mean)}회\` (판 최소 ${rcMatch.min}회 ~ 최대 ${rcMatch.max}회)`);
    lines.push(`  - 평균 체크포인트 변동률: \`${fmt4(rcRate.mean)}%\`\n`);
    lines.push(formatDualComparisonLine('플레이어별 순위 변동 횟수 비교', '회', rcInd, rcCyc, rcInd.mean, false, sampleCycles));
    lines.push('');

    const sortedStrategies = [...strategyStats.values()].sort((a, b) => {
        const wrA = a.appearances > 0 ? a.wins / a.appearances : 0;
        const wrB = b.appearances > 0 ? b.wins / b.appearances : 0;
        return wrB - wrA || b.wins - a.wins;
    });
    const topStrat = sortedStrategies[0];
    lines.push('## 8. 가장 많은 승률을 보인 전략군');
    if (topStrat) {
        const topWr = topStrat.appearances > 0 ? clampPct((topStrat.wins / topStrat.appearances) * 100) : 0;
        lines.push(`- **최고 승률 전략군**: **${topStrat.label}** — 승률 \`${fmt4(topWr)}%\` (${topStrat.wins}승 / ${topStrat.appearances}회)`);
    }
    lines.push('');
    lines.push('| 전략군 | 승률 | 채택률 | 평균 순위 | 전적 |');
    lines.push('| :--- | :---: | :---: | :---: | :---: |');
    for (const s of sortedStrategies) {
        const pickShare = extra.totalPlayers > 0 ? clampPct((s.appearances / extra.totalPlayers) * 100) : 0;
        const winRate = s.appearances > 0 ? clampPct((s.wins / s.appearances) * 100) : 0;
        const avgRank = s.appearances > 0 ? s.rankSum / s.appearances : 0;
        lines.push(
            `| ${s.label} | \`${fmt4(winRate)}%\` | \`${fmt4(pickShare)}%\` | \`${fmt4(avgRank)}위\` | ${s.wins}승/${s.appearances}표본 |`
        );
    }

    lines.push('\n## 9. 추가 밸런스 & 기믹 진단 지표 (리밸런싱 참고용)');
    const sootRate = clampPct((extra.sootTriggered / count) * 100);
    const bankruptRate = extra.totalPlayers > 0 ? clampPct((extra.bankruptPlayers / extra.totalPlayers) * 100) : 0;
    const avgTollPaid = extra.tollsCount > 0 ? extra.tollsTotal / extra.tollsCount : 0;
    const avgMaxSingleToll = extra.totalPlayers > 0 ? extra.maxSingleTollSum / extra.totalPlayers : 0;
    const activeUseRatio = extra.cardsDrawn > 0 ? clampPct((extra.activeCardsUsed / extra.cardsDrawn) * 100) : 0;
    const lapBlockRate = extra.lapPass > 0 ? clampPct((extra.lapBlocked / extra.lapPass) * 100) : 0;

    lines.push(`- **월드 기믹 발동 빈도**`);
    lines.push(`  - 그을음 발동률: \`${fmt4(sootRate)}%\` (${extra.sootTriggered}/${count}판)`);
    lines.push(`  - 분기 1 (윤회 공석): ${extra.sootBranch1}회`);
    lines.push(`  - 분기 2 (윤회 탄생): ${extra.sootBranch2}회`);
    lines.push(`  - 빛무리 자연 전환: ${extra.haloNatural}회`);
    lines.push(`  - 빛무리 카드 강제 전환: ${extra.haloCard}회`);

    lines.push(`- **제단 및 포탈 기믹**`);
    lines.push(`  - 판당 첫 방문 인원: \`${fmt4(extra.altarFirstVisits / count)}명\``);
    lines.push(`  - 판당 2회차 포탈 이용: \`${fmt4(extra.altarPortalUses / count)}회\``);
    lines.push(`  - 판당 보물 카드 교환: \`${fmt4(extra.altarTradeCount / count)}회\``);

    lines.push(`- **경제 압박 및 대출**`);
    lines.push(`  - 플레이어 파산률: \`${fmt4(bankruptRate)}%\``);
    lines.push(`  - 턴 시작 자금 위기 빈도: 판당 \`${fmt4(extra.crisisCount / count)}회\``);
    lines.push(`  - 판당 평균 대출 실행: \`${fmt4(extra.loans / count)}회\``);

    const detailed100 = aggregateDetailedBatchMetrics(cycles);
    const hasPop = pop && pop.totalSimulated > count;
    const lapStatsSrc = (hasPop && pop.extras?.lapStats) ? pop.extras.lapStats : detailed100.extras?.lapStats;
    lines.push(`- **통행료 및 순회 보상**`);
    lines.push(`  - 건당 평균 통행료: ${fmtMoney(avgTollPaid)}`);
    lines.push(`  - 1인당 최대 단일 통행료 평균: ${fmtMoney(avgMaxSingleToll)}`);
    if (lapStatsSrc) {
        lines.push(`  - 판당 순회 횟수 (4인 합계): ${fmtSeriesSpan(lapStatsSrc.perMatch)}${hasPop ? ` *(${sampleCycles}사이클: \`${fmt4(detailed100.extras.lapStats.perMatch.mean)}회\`, \`${fmt4(detailed100.extras.lapStats.perMatch.min)}~${fmt4(detailed100.extras.lapStats.perMatch.max)}\`)*` : ''}`);
        lines.push(`  - 개인별 순회 횟수 (1인당): ${fmtSeriesSpan(lapStatsSrc.perPlayer)}${hasPop ? ` *(${sampleCycles}사이클: \`${fmt4(detailed100.extras.lapStats.perPlayer.mean)}회\`, \`${fmt4(detailed100.extras.lapStats.perPlayer.min)}~${fmt4(detailed100.extras.lapStats.perPlayer.max)}\`)*` : ''}`);
    }
    lines.push(`  - 순회 보상 차단률(그을음 등): \`${fmt4(lapBlockRate)}%\` (지급 ${extra.lapBonus}회 / 통과 ${extra.lapPass}회)`);

    lines.push(`- **카드 운용 현황**`);
    lines.push(`  - 판당 카드칸 도착: \`${fmt4(extra.cardsDrawn / count)}회\``);
    lines.push(`  - 판당 액티브 카드 사용: \`${fmt4(extra.activeCardsUsed / count)}회\` (도착 대비 \`${fmt4(activeUseRatio)}%\`)`);
    lines.push('');

    const popLoan = hasPop ? pop.loan : null;
    const popTolls = hasPop ? pop.tolls : null;
    const popCards = hasPop ? pop.cards : null;
    const popExtras = hasPop ? pop.extras : null;
    const popGimmick = hasPop ? pop.gimmickAnalytics : null;
    const popRarity = hasPop ? pop.cardRarity : null;
    const totalSim = pop?.totalSimulated || count;

    lines.push(...formatSummaryLoanSectionLines(detailed100.loan, popLoan, totalSim, detailed100.tolls, popTolls, sampleCycles));
    lines.push(...formatSummaryCardSectionLines(detailed100.cards, popCards, totalSim, sampleCycles));
    lines.push(...formatSummaryDiagnosticSectionLines(detailed100.extras, detailed100.cards, popExtras, popCards, totalSim));
    lines.push(...formatSummaryFurryAndTreasureCardsLines(detailed100.gimmickAnalytics, popGimmick, totalSim, sampleCycles));
    lines.push(...formatSummaryMountainAndMemoryLines(detailed100.gimmickAnalytics, popGimmick, totalSim, sampleCycles));
    lines.push(...formatSummarySootAndDayNightLines(detailed100.gimmickAnalytics, popGimmick, totalSim, sampleCycles));
    lines.push(...formatSummaryCardRarityLines(detailed100.cardRarity, popRarity, totalSim, sampleCycles));
    lines.push(...formatSummaryAltarAndVoidLines(detailed100.gimmickAnalytics, popGimmick, totalSim, sampleCycles));

    return lines.join('\n') + '\n';
}

export function createMarbleLogAdapter(maxCycles = MARBLE_MAX_HISTORY, fileNames = MARBLE_LOG_FILES, compactFn = compactCyclesDensityPreserve) {
    return {
        gameId: 'marble',
        maxCycles,
        fileNames,
        normalizeMatchData(rawData) {
            if (!rawData) return null;
            if (rawData.players && rawData.metrics && rawData.finalTurn !== undefined) {
                return rawData;
            }
            return null;
        },
        compactCycles: compactFn,
        computePopulationSummary,
        renderCycleDetailText: (cycles) => renderCycleDetailLogText(cycles, maxCycles),
        renderAverageSummaryText: (cycles, meta = null) => renderAverage100LogText(cycles, meta, maxCycles)
    };
}

export const MarbleLogAdapter = createMarbleLogAdapter(MARBLE_MAX_HISTORY, MARBLE_LOG_FILES, compactCyclesDensityPreserve);
export const MarbleLog10Adapter = createMarbleLogAdapter(MARBLE_10_MAX_HISTORY, MARBLE_LOG_10_FILES, compactCyclesQuantilePreserve);
