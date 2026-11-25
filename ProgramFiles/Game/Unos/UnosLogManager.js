// ProgramFiles/Game/Unos/UnosLogManager.js
// 우노스(UNOS) 전용 경기 메트릭 정규화, 10만 사이클 모수 집계(computeUnosPopulationSummary),
// 극값 보호 100사이클(density_preserve) 및 분위수 10사이클(quantile_preserve) 상세/평균 밸런스 로그 생성 어댑터

export const UNOS_LOG_FILES = Object.freeze({
    CYCLE_DETAIL: '우노스_100사이클_상세로그.md',
    AVERAGE_100: '우노스_100사이클_평균로그.md',
    RAW_DATA: '우노스_100사이클_로그데이터.json'
});

export const UNOS_LOG_10_FILES = Object.freeze({
    CYCLE_DETAIL: '우노스_10사이클_상세로그.md',
    AVERAGE_100: '우노스_10사이클_평균로그.md',
    RAW_DATA: '우노스_10사이클_로그데이터.json'
});

export const UNOS_MAX_HISTORY = 100;
export const UNOS_10_MAX_HISTORY = 10;

const CARD_KIND_KEYS = Object.freeze(['number', 'skip', 'action', 'reverse', 'resonance', 'depression']);
const CARD_KIND_LABELS = Object.freeze({
    number: '숫자 (0~9, 40장)',
    skip: '스킵 (4장)',
    action: '콤보 (4장)',
    reverse: '리버스 (2장)',
    resonance: '공명 (4장)',
    depression: '우울 (+2, 2장)'
});

const PIECE_KEYS = Object.freeze(['K', 'Q', 'R', 'B', 'N', 'P', 'P_PLUS']);
const PIECE_LABELS = Object.freeze({
    K: '킹 (K)',
    Q: '퀸 (Q)',
    R: '룩 (R)',
    B: '비숍 (B)',
    N: '나이트 (N)',
    P: '일반 폰 (P)',
    P_PLUS: '강화 폰 (P+)'
});

export function fmt4(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0.0000';
    return num.toFixed(4);
}

export function pct(part, total) {
    const p = Number(part) || 0;
    const t = Number(total) || 0;
    if (t <= 0) return 0;
    return Math.min(100, Math.max(0, (p / t) * 100));
}

export function normalizeUnosMatchData(rawData) {
    if (!rawData || typeof rawData !== 'object') return null;
    const totalTurns = Number(rawData.totalTurns ?? rawData.finalTurn ?? 0);
    if (!Number.isFinite(totalTurns) || totalTurns <= 0) return null;

    const m = rawData.metrics && typeof rawData.metrics === 'object' ? rawData.metrics : {};
    const players = Array.isArray(rawData.players) ? rawData.players : [];

    const cardsPlayedByKind = {};
    const winnerCardsPlayedByKind = {};
    for (const k of CARD_KIND_KEYS) {
        cardsPlayedByKind[k] = Number(m.cardsPlayedByKind?.[k]) || 0;
        winnerCardsPlayedByKind[k] = Number(m.winnerCardsPlayedByKind?.[k]) || 0;
    }

    const pieceMoves = {};
    const pieceCaptures = {};
    for (const pk of PIECE_KEYS) {
        pieceMoves[pk] = Number(m.pieceMoves?.[pk]) || 0;
        pieceCaptures[pk] = Number(m.pieceCaptures?.[pk]) || 0;
    }

    const tb = m.turnBranches || {};
    const turnBranches = {
        branch1_playAndMove: Number(tb.branch1_playAndMove) || 0,
        branch2_playAndNoMovePenalty: Number(tb.branch2_playAndNoMovePenalty) || 0,
        branch3_drawPlayAndMove: Number(tb.branch3_drawPlayAndMove) || 0,
        branch4_drawKeepOrNoMove: Number(tb.branch4_drawKeepOrNoMove) || 0,
        burstSkipCardTurn: Number(tb.burstSkipCardTurn) || 0,
        skipHitCardTurn: Number(tb.skipHitCardTurn) || 0
    };

    const castlingCount = {
        left: Number(m.castlingCount?.left) || 0,
        right: Number(m.castlingCount?.right) || 0,
        safe: Number(m.castlingCount?.safe) || 0,
        unsafeForced: Number(m.castlingCount?.unsafeForced) || 0
    };

    const moveSafetyCounts = {
        none: Number(m.moveSafetyCounts?.none) || 0,
        yellow: Number(m.moveSafetyCounts?.yellow) || 0,
        red: Number(m.moveSafetyCounts?.red) || 0
    };

    const inv = m.invariantViolations || {};
    const invariantViolations = {
        cardTotalMismatch: Number(inv.cardTotalMismatch) || 0,
        boardPresetInvalid: Number(inv.boardPresetInvalid) || 0,
        actionTripleChain: Number(inv.actionTripleChain) || 0,
        queenCooldownViolation: Number(inv.queenCooldownViolation) || 0,
        promotedPawnJumpOrColorViolation: Number(inv.promotedPawnJumpOrColorViolation) || 0,
        promotedPawnRePromotion: Number(inv.promotedPawnRePromotion) || 0,
        nanOrInfiniteLoop: Number(inv.nanOrInfiniteLoop) || 0
    };

    return {
        gameId: 'unos',
        mode: rawData.mode || 'standard',
        recordedAt: rawData.recordedAt || new Date().toISOString(),
        totalTurns,
        winnerId: rawData.winnerId || null,
        winnerName: rawData.winnerName || 'Winner',
        winnerSide: rawData.winnerSide === 'top' ? 'top' : 'bottom',
        winnerSlot: Number(rawData.winnerSlot) === 1 ? 1 : 0,
        loserId: rawData.loserId || null,
        loserName: rawData.loserName || 'Loser',
        reason: rawData.reason || 'CHECKMATE',
        metrics: {
            turnOrderRounds: Math.max(1, Number(m.turnOrderRounds) || 1),
            turnOrderTieCount: Math.max(0, Number(m.turnOrderTieCount) || 0),
            firstPlayerSlot: Number(m.firstPlayerSlot) === 1 ? 1 : 0,
            totalBurstTriggers: Math.max(0, Number(m.totalBurstTriggers) || 0),
            firstBurstTurn: Number.isFinite(Number(m.firstBurstTurn)) && m.firstBurstTurn !== null
                ? Number(m.firstBurstTurn)
                : null,
            burstRedrawCounts: Array.isArray(m.burstRedrawCounts)
                ? m.burstRedrawCounts.map(n => Number(n) || 0)
                : [],
            depressionHitsDuringBurst: Math.max(0, Number(m.depressionHitsDuringBurst) || 0),
            promotionsDuringBurst: Math.max(0, Number(m.promotionsDuringBurst) || 0),
            cardsPlayedByKind,
            winnerCardsPlayedByKind,
            actionCombo2Count: Math.max(0, Number(m.actionCombo2Count) || 0),
            actionCombo3Count: Math.max(0, Number(m.actionCombo3Count) || 0),
            turnBranches,
            deckReshuffleCount: Math.max(0, Number(m.deckReshuffleCount) || 0),
            pieceMoves,
            pieceCaptures,
            kingFinisherPiece: m.kingFinisherPiece || null,
            isBurstCheckmate: Boolean(m.isBurstCheckmate),
            queenCooldownActiveTurns: Math.max(0, Number(m.queenCooldownActiveTurns) || 0),
            promotionCount: Math.max(0, Number(m.promotionCount) || 0),
            promotedPawnCardBurns: Math.max(0, Number(m.promotedPawnCardBurns) || 0),
            promotedPawnBurstDeltaSubtracts: Math.max(0, Number(m.promotedPawnBurstDeltaSubtracts) || 0),
            castlingCount,
            moveSafetyCounts,
            invariantViolations
        },
        players: players.map((p, idx) => ({
            id: p.id || `p_${idx + 1}`,
            name: p.name || `Player ${idx + 1}`,
            slotIndex: Number.isInteger(p.slotIndex) ? p.slotIndex : idx,
            type: p.type || 'ai',
            side: p.side === 'top' ? 'top' : 'bottom',
            isWinner: Boolean(p.isWinner),
            remainingHandCount: Number(p.remainingHandCount) || 0,
            remainingMaterialScore: Number(p.remainingMaterialScore) || 0,
            stats: {
                cardsPlayed: Number(p.stats?.cardsPlayed) || 0,
                piecesCaptured: Number(p.stats?.piecesCaptured) || 0,
                burstTriggers: Number(p.stats?.burstTriggers) || 0,
                promotions: Number(p.stats?.promotions) || 0,
                promotedPawnMoves: Number(p.stats?.promotedPawnMoves) || 0,
                promotedPawnCaptures: Number(p.stats?.promotedPawnCaptures) || 0
            }
        }))
    };
}

/**
 * 극값(최단/최장 턴, 최대 버스트, 최대 프로모션) 보호 + 밀집 구간 균등 추출 (100사이클용)
 */
export function compactUnosCyclesDensityPreserve(cycles, maxCycles = UNOS_MAX_HISTORY) {
    const list = Array.isArray(cycles) ? cycles : [];
    if (list.length <= maxCycles) return [...list];

    const indexed = list.map((c, idx) => ({ c, idx }));
    const protectedIndices = new Set();

    // 최단/최장 턴, 최다 프로모션, 최다 버스트 경기 보호
    const byTurns = [...indexed].sort((a, b) => a.c.totalTurns - b.c.totalTurns);
    if (byTurns[0]) protectedIndices.add(byTurns[0].idx);
    if (byTurns[byTurns.length - 1]) protectedIndices.add(byTurns[byTurns.length - 1].idx);

    const byPromos = [...indexed].sort((a, b) => (b.c.metrics?.promotionCount || 0) - (a.c.metrics?.promotionCount || 0));
    if (byPromos[0]) protectedIndices.add(byPromos[0].idx);

    const byBursts = [...indexed].sort((a, b) => (b.c.metrics?.totalBurstTriggers || 0) - (a.c.metrics?.totalBurstTriggers || 0));
    if (byBursts[0]) protectedIndices.add(byBursts[0].idx);

    const remainingNeeded = Math.max(0, maxCycles - protectedIndices.size);
    const pool = byTurns.filter(item => !protectedIndices.has(item.idx));

    const selected = new Set(protectedIndices);
    if (remainingNeeded > 0 && pool.length > 0) {
        for (let i = 0; i < remainingNeeded && i < pool.length; i++) {
            const pos = Math.min(pool.length - 1, Math.floor(((i + 0.5) / remainingNeeded) * pool.length));
            selected.add(pool[pos].idx);
        }
    }

    // 부족분이 있으면 뒤에서부터 보충
    for (let i = list.length - 1; i >= 0 && selected.size < maxCycles; i--) {
        selected.add(i);
    }

    return [...selected].sort((a, b) => a - b).slice(0, maxCycles).map(i => list[i]);
}

/**
 * 분위수 보존 10사이클 추출 (10사이클용)
 */
export function compactUnosCyclesQuantilePreserve(cycles, maxCycles = UNOS_10_MAX_HISTORY) {
    const list = Array.isArray(cycles) ? cycles : [];
    if (list.length <= maxCycles) return [...list];

    const sorted = list
        .map((c, idx) => ({
            c,
            idx,
            score: c.totalTurns * 10 + (c.metrics?.totalBurstTriggers || 0) * 15 + (c.metrics?.promotionCount || 0) * 20
        }))
        .sort((a, b) => a.score - b.score);

    const pickedIndices = [];
    for (let k = 0; k < maxCycles; k++) {
        const q = maxCycles === 1 ? 0.5 : k / (maxCycles - 1);
        const pos = Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)));
        pickedIndices.push(sorted[pos].idx);
    }

    return pickedIndices.sort((a, b) => a - b).map(i => list[i]);
}

/**
 * 전체 모수(예: 100,000판) 또는 표본 배열에 대한 7대 핵심 통계 섹션 집계
 */
export function computeUnosPopulationSummary(cycles, retentionPolicy = 'density_preserve', sampleSize = UNOS_MAX_HISTORY) {
    const list = (Array.isArray(cycles) ? cycles : []).map(normalizeUnosMatchData).filter(Boolean);
    const count = list.length;

    const emptySummary = {
        totalSimulated: 0,
        retentionPolicy,
        sampleSize
    };
    if (count === 0) return emptySummary;

    // 섹션 1: 경기 템포 & 종료 유형
    let turnsSum = 0;
    let minTurns = Infinity;
    let maxTurns = -Infinity;
    const turnBuckets = {
        t1_20: 0,
        t21_40: 0,
        t41_60: 0,
        t61_90: 0,
        t91_plus: 0
    };
    const endReasons = {
        normalCheckmate: 0,
        burstCheckmate: 0,
        totalCheckmate: 0,
        turnLimitOrMaterial: 0,
        surrender: 0
    };

    // 섹션 2: 선/후공 & 좌석 밸런스
    let turnOrderRoundsSum = 0;
    let turnOrderTieMatches = 0;
    let totalTurnOrderDraws = 0;
    let totalTurnOrderTies = 0;
    let bottomWins = 0;
    let topWins = 0;
    let slot0FirstCount = 0;
    let slot1FirstCount = 0;
    let slot0Wins = 0;
    let slot1Wins = 0;

    // 섹션 3: 버스트(UNO!) 영향력 & 재드로우 경제
    let totalBurstTriggers = 0;
    let matchesWithBurst = 0;
    let firstBurstTurnSum = 0;
    let firstBurstTurnCount = 0;
    let burstUsersTotal = 0;
    let burstUsersWins = 0;
    let nonBurstUsersTotal = 0;
    let nonBurstUsersWins = 0;
    let burstRedrawSum = 0;
    let burstRedrawEventsCount = 0;
    let depressionHitsDuringBurstSum = 0;
    let promotionsDuringBurstSum = 0;

    // 섹션 4: 카드 56종 제출 · 콤보 연쇄 · 턴 진행 4대 분기 · 묘지 재셔플
    const cardsPlayedSum = {
        number: 0,
        skip: 0,
        action: 0,
        reverse: 0,
        resonance: 0,
        depression: 0
    };
    const winnerCardsPlayedSum = {
        number: 0,
        skip: 0,
        action: 0,
        reverse: 0,
        resonance: 0,
        depression: 0
    };
    let totalCardsPlayedAll = 0;
    let actionCombo2Sum = 0;
    let actionCombo3Sum = 0;
    const turnBranchesSum = {
        branch1_playAndMove: 0,
        branch2_playAndNoMovePenalty: 0,
        branch3_drawPlayAndMove: 0,
        branch4_drawKeepOrNoMove: 0,
        burstSkipCardTurn: 0,
        skipHitCardTurn: 0
    };
    let deckReshuffleSum = 0;

    // 섹션 5: 체스 기물 · 프로모션(강화 폰 P+) · 캐슬링
    const pieceMovesSum = { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0, P_PLUS: 0 };
    const pieceCapturesSum = { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0, P_PLUS: 0 };
    const kingFinisherCounts = { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0, P_PLUS: 0 };
    let queenCooldownActiveTurnsSum = 0;
    let promotionCountSum = 0;
    let matchesWithPromotion = 0;
    let promotedPawnCardBurnsSum = 0;
    let promotedPawnBurstDeltaSubtractsSum = 0;
    const castlingSum = { left: 0, right: 0, safe: 0, unsafeForced: 0 };

    // 섹션 6: 안전도 삼각형(none / yellow / red)
    const moveSafetySum = { none: 0, yellow: 0, red: 0 };

    // 섹션 7: 시뮬레이션 무결성 불변식
    const invariantSum = {
        cardTotalMismatch: 0,
        boardPresetInvalid: 0,
        actionTripleChain: 0,
        queenCooldownViolation: 0,
        promotedPawnJumpOrColorViolation: 0,
        promotedPawnRePromotion: 0,
        nanOrInfiniteLoop: 0
    };

    for (const c of list) {
        const m = c.metrics;
        const t = c.totalTurns;
        if (!Number.isFinite(t)) {
            invariantSum.nanOrInfiniteLoop += 1;
            continue;
        }

        // 1. 템포 & 종료 유형
        turnsSum += t;
        if (t < minTurns) minTurns = t;
        if (t > maxTurns) maxTurns = t;

        if (t <= 20) turnBuckets.t1_20 += 1;
        else if (t <= 40) turnBuckets.t21_40 += 1;
        else if (t <= 60) turnBuckets.t41_60 += 1;
        else if (t <= 90) turnBuckets.t61_90 += 1;
        else turnBuckets.t91_plus += 1;

        if (c.reason === 'CHECKMATE') {
            endReasons.totalCheckmate += 1;
            if (m.isBurstCheckmate) {
                endReasons.burstCheckmate += 1;
            } else {
                endReasons.normalCheckmate += 1;
            }
        } else if (c.reason === 'SURRENDER') {
            endReasons.surrender += 1;
        } else {
            endReasons.turnLimitOrMaterial += 1;
        }

        // 2. 선/후공 & 좌석
        turnOrderRoundsSum += m.turnOrderRounds;
        totalTurnOrderDraws += m.turnOrderRounds;
        totalTurnOrderTies += m.turnOrderTieCount;
        if (m.turnOrderTieCount > 0) turnOrderTieMatches += 1;

        if (c.winnerSide === 'bottom') bottomWins += 1;
        else topWins += 1;

        if (m.firstPlayerSlot === 0) slot0FirstCount += 1;
        else slot1FirstCount += 1;

        if (c.winnerSlot === 0) slot0Wins += 1;
        else slot1Wins += 1;

        // 3. 버스트
        totalBurstTriggers += m.totalBurstTriggers;
        if (m.totalBurstTriggers > 0) matchesWithBurst += 1;
        if (m.firstBurstTurn !== null && Number.isFinite(m.firstBurstTurn)) {
            firstBurstTurnSum += m.firstBurstTurn;
            firstBurstTurnCount += 1;
        }
        for (const rd of m.burstRedrawCounts) {
            burstRedrawSum += rd;
            burstRedrawEventsCount += 1;
        }
        depressionHitsDuringBurstSum += m.depressionHitsDuringBurst;
        promotionsDuringBurstSum += m.promotionsDuringBurst;

        for (const pl of c.players) {
            const pBursts = Number(pl.stats?.burstTriggers) || 0;
            if (pBursts > 0) {
                burstUsersTotal += 1;
                if (pl.isWinner) burstUsersWins += 1;
            } else {
                nonBurstUsersTotal += 1;
                if (pl.isWinner) nonBurstUsersWins += 1;
            }
        }

        // 4. 카드 & 4대 분기
        for (const k of CARD_KIND_KEYS) {
            const cnt = Number(m.cardsPlayedByKind?.[k]) || 0;
            const wCnt = Number(m.winnerCardsPlayedByKind?.[k]) || 0;
            cardsPlayedSum[k] += cnt;
            winnerCardsPlayedSum[k] += wCnt;
            totalCardsPlayedAll += cnt;
        }
        actionCombo2Sum += m.actionCombo2Count;
        actionCombo3Sum += m.actionCombo3Count;

        turnBranchesSum.branch1_playAndMove += m.turnBranches.branch1_playAndMove;
        turnBranchesSum.branch2_playAndNoMovePenalty += m.turnBranches.branch2_playAndNoMovePenalty;
        turnBranchesSum.branch3_drawPlayAndMove += m.turnBranches.branch3_drawPlayAndMove;
        turnBranchesSum.branch4_drawKeepOrNoMove += m.turnBranches.branch4_drawKeepOrNoMove;
        turnBranchesSum.burstSkipCardTurn += m.turnBranches.burstSkipCardTurn;
        turnBranchesSum.skipHitCardTurn += m.turnBranches.skipHitCardTurn;
        deckReshuffleSum += m.deckReshuffleCount;

        // 5. 체스 기물 · 강화 폰 · 캐슬링
        for (const pk of PIECE_KEYS) {
            pieceMovesSum[pk] += Number(m.pieceMoves?.[pk]) || 0;
            pieceCapturesSum[pk] += Number(m.pieceCaptures?.[pk]) || 0;
        }
        if (m.kingFinisherPiece && m.kingFinisherPiece in kingFinisherCounts) {
            kingFinisherCounts[m.kingFinisherPiece] += 1;
        }
        queenCooldownActiveTurnsSum += m.queenCooldownActiveTurns;
        promotionCountSum += m.promotionCount;
        if (m.promotionCount > 0) matchesWithPromotion += 1;
        promotedPawnCardBurnsSum += m.promotedPawnCardBurns;
        promotedPawnBurstDeltaSubtractsSum += m.promotedPawnBurstDeltaSubtracts;

        castlingSum.left += m.castlingCount.left;
        castlingSum.right += m.castlingCount.right;
        castlingSum.safe += m.castlingCount.safe;
        castlingSum.unsafeForced += m.castlingCount.unsafeForced;

        // 6. 안전도 삼각형
        moveSafetySum.none += m.moveSafetyCounts.none;
        moveSafetySum.yellow += m.moveSafetyCounts.yellow;
        moveSafetySum.red += m.moveSafetyCounts.red;

        // 7. 무결성 불변식
        invariantSum.cardTotalMismatch += m.invariantViolations.cardTotalMismatch;
        invariantSum.boardPresetInvalid += m.invariantViolations.boardPresetInvalid;
        invariantSum.actionTripleChain += m.invariantViolations.actionTripleChain;
        invariantSum.queenCooldownViolation += m.invariantViolations.queenCooldownViolation;
        invariantSum.promotedPawnJumpOrColorViolation += m.invariantViolations.promotedPawnJumpOrColorViolation;
        invariantSum.promotedPawnRePromotion += m.invariantViolations.promotedPawnRePromotion;
        invariantSum.nanOrInfiniteLoop += m.invariantViolations.nanOrInfiniteLoop;
    }

    const totalFourBranches = turnBranchesSum.branch1_playAndMove
        + turnBranchesSum.branch2_playAndNoMovePenalty
        + turnBranchesSum.branch3_drawPlayAndMove
        + turnBranchesSum.branch4_drawKeepOrNoMove;

    const totalChessMoves = moveSafetySum.none + moveSafetySum.yellow + moveSafetySum.red;

    // 40장 숫자 카드(0~9 각 4장)에서 비복원 2장 추첨 시 같은 숫자가 나올 이론 확률: 3 / 39 = 1 / 13 ≈ 7.6923% (복원 기준 10.0000%)
    const observedTieRatePerRoundPct = pct(totalTurnOrderTies, totalTurnOrderDraws);
    const observedTieMatchRatePct = pct(turnOrderTieMatches, count);

    return {
        totalSimulated: count,
        retentionPolicy,
        sampleSize,
        tempo: {
            avgTurns: turnsSum / count,
            minTurns: Number.isFinite(minTurns) ? minTurns : 0,
            maxTurns: Number.isFinite(maxTurns) ? maxTurns : 0,
            turnBuckets,
            endReasons,
            normalCheckmateRatePct: pct(endReasons.normalCheckmate, count),
            burstCheckmateRatePct: pct(endReasons.burstCheckmate, count),
            totalCheckmateRatePct: pct(endReasons.totalCheckmate, count),
            turnLimitRatePct: pct(endReasons.turnLimitOrMaterial, count),
            surrenderRatePct: pct(endReasons.surrender, count)
        },
        turnOrderAndSides: {
            avgTurnOrderRounds: turnOrderRoundsSum / count,
            tieMatchCount: turnOrderTieMatches,
            tieMatchRatePct: observedTieMatchRatePct,
            tieRatePerRoundPct: observedTieRatePerRoundPct,
            theoreticalNonReplacementTiePct: (3 / 39) * 100, // 7.6923%
            theoreticalTenPct: 10.0,
            bottomWins,
            topWins,
            bottomWinRatePct: pct(bottomWins, count),
            topWinRatePct: pct(topWins, count),
            sideWinGapPct: Math.abs(pct(bottomWins, count) - pct(topWins, count)),
            slot0FirstRatePct: pct(slot0FirstCount, count),
            slot1FirstRatePct: pct(slot1FirstCount, count),
            slot0WinRatePct: pct(slot0Wins, count),
            slot1WinRatePct: pct(slot1Wins, count)
        },
        burst: {
            totalBurstTriggers,
            avgBurstsPerMatch: totalBurstTriggers / count,
            matchesWithBurst,
            matchBurstRatePct: pct(matchesWithBurst, count),
            avgFirstBurstTurn: firstBurstTurnCount > 0 ? firstBurstTurnSum / firstBurstTurnCount : 0,
            burstUserWinRatePct: pct(burstUsersWins, burstUsersTotal),
            nonBurstUserWinRatePct: pct(nonBurstUsersWins, nonBurstUsersTotal),
            burstCheckmateShareOfCheckmatesPct: pct(endReasons.burstCheckmate, endReasons.totalCheckmate),
            avgRedrawCount: burstRedrawEventsCount > 0 ? burstRedrawSum / burstRedrawEventsCount : 7,
            burstRedrawEventsCount,
            avgDepressionHitsDuringBurst: depressionHitsDuringBurstSum / count,
            avgPromotionsDuringBurst: promotionsDuringBurstSum / count
        },
        cardsAndBranches: {
            totalCardsPlayedAll,
            avgCardsPlayedPerMatch: totalCardsPlayedAll / count,
            cardsPlayedSum,
            winnerCardsPlayedSum,
            avgActionCombo2PerMatch: actionCombo2Sum / count,
            avgActionCombo3PerMatch: actionCombo3Sum / count,
            turnBranchesSum,
            totalFourBranches,
            branch1RatePct: pct(turnBranchesSum.branch1_playAndMove, totalFourBranches),
            branch2RatePct: pct(turnBranchesSum.branch2_playAndNoMovePenalty, totalFourBranches),
            branch3RatePct: pct(turnBranchesSum.branch3_drawPlayAndMove, totalFourBranches),
            branch4RatePct: pct(turnBranchesSum.branch4_drawKeepOrNoMove, totalFourBranches),
            avgDeckReshufflesPerMatch: deckReshuffleSum / count
        },
        chessAndPromotion: {
            pieceMovesSum,
            pieceCapturesSum,
            kingFinisherCounts,
            avgQueenCooldownTurnsPerMatch: queenCooldownActiveTurnsSum / count,
            promotionCountSum,
            avgPromotionsPerMatch: promotionCountSum / count,
            matchesWithPromotion,
            promotionMatchRatePct: pct(matchesWithPromotion, count),
            promotedPawnCardBurnsSum,
            promotedPawnBurstDeltaSubtractsSum,
            avgPromotedPawnMovesPerMatch: pieceMovesSum.P_PLUS / count,
            avgPromotedPawnCapturesPerMatch: pieceCapturesSum.P_PLUS / count,
            promotedPawnKingFinishRatePct: pct(kingFinisherCounts.P_PLUS, endReasons.totalCheckmate),
            castlingSum,
            avgCastlingsPerMatch: (castlingSum.left + castlingSum.right) / count
        },
        safetyTriangle: {
            totalChessMoves,
            moveSafetySum,
            noneRatePct: pct(moveSafetySum.none, totalChessMoves),
            yellowRatePct: pct(moveSafetySum.yellow, totalChessMoves),
            redRatePct: pct(moveSafetySum.red, totalChessMoves)
        },
        invariants: invariantSum
    };
}

/**
 * 사이클별 상세 로그 마크다운 렌더링
 */
export function renderUnosCycleDetailText(cycles, maxCycles = UNOS_MAX_HISTORY) {
    const list = (Array.isArray(cycles) ? cycles : []).map(normalizeUnosMatchData).filter(Boolean);
    const lines = [
        `# ♟️ 우노스 (\`UNOS\`) — 최근 ${maxCycles}사이클 경기별 상세 로그`,
        '',
        `> 업데이트 시각: \`${new Date().toISOString()}\` · 수록 경기 수: **${list.length} / ${maxCycles}판**`,
        '',
        '| # | 종료 턴 | 승자 (진영/좌석) | 종료 사유 | 피니셔 기물 | 추첨 라운드 | 버스트 횟수 | 프로모션(P+) | P+ 이동/포획 | 안전도(N/Y/R) |',
        '| :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |'
    ];

    list.forEach((c, idx) => {
        const m = c.metrics;
        const finisher = m.kingFinisherPiece ? (PIECE_LABELS[m.kingFinisherPiece] || m.kingFinisherPiece) : '-';
        const reasonStr = m.isBurstCheckmate ? 'BURST_CHECKMATE' : c.reason;
        const pPlusMoveCap = `${m.pieceMoves.P_PLUS || 0}/${m.pieceCaptures.P_PLUS || 0}`;
        const safetyStr = `${m.moveSafetyCounts.none}/${m.moveSafetyCounts.yellow}/${m.moveSafetyCounts.red}`;
        lines.push(
            `| ${idx + 1} | \`${c.totalTurns}T\` | **${c.winnerName}** (\`${c.winnerSide}\`/S${c.winnerSlot}) | \`${reasonStr}\` | ${finisher} | ${m.turnOrderRounds}R | ${m.totalBurstTriggers}회 | ${m.promotionCount}회 | \`${pPlusMoveCap}\` | \`${safetyStr}\` |`
        );
    });

    lines.push('');
    return lines.join('\n');
}

/**
 * 7대 핵심 통계 섹션을 포함한 우노스 평균 밸런스 로그 마크다운 렌더링
 */
export function renderUnosAverageSummaryText(cycles, meta = null, sampleCycles = UNOS_MAX_HISTORY) {
    const list = (Array.isArray(cycles) ? cycles : []).map(normalizeUnosMatchData).filter(Boolean);
    const sampleSummary = computeUnosPopulationSummary(list, 'sample', sampleCycles);
    const pop = meta?.populationSummary && meta.populationSummary.totalSimulated > 0
        ? meta.populationSummary
        : sampleSummary;

    const totalSim = pop.totalSimulated || list.length;
    const t = pop.tempo || sampleSummary.tempo;
    const s = pop.turnOrderAndSides || sampleSummary.turnOrderAndSides;
    const b = pop.burst || sampleSummary.burst;
    const cb = pop.cardsAndBranches || sampleSummary.cardsAndBranches;
    const cp = pop.chessAndPromotion || sampleSummary.chessAndPromotion;
    const st = pop.safetyTriangle || sampleSummary.safetyTriangle;
    const inv = pop.invariants || sampleSummary.invariants;

    const lines = [
        `# 📊 우노스 (\`UNOS\`) — ${sampleCycles}사이클 평균 밸런스 & 10만 판 모수 통계 리포트`,
        '',
        `> 업데이트 시각: \`${new Date().toISOString()}\` · **전체 모수: \`${totalSim.toLocaleString()}판\`** · 보관 대표 표본: **\`${list.length} / ${sampleCycles}사이클\`**`,
        '',
        '---',
        '',
        '## 1. 경기 템포 & 종료 유형 분포',
        '',
        `- **평균 종료 턴 수**: \`${fmt4(t.avgTurns)}턴\` (최소 \`${t.minTurns}턴\` ~ 최대 \`${t.maxTurns}턴\`)`,
        `- **턴 구간별 분포**:`,
        `  - \`1 ~ 20턴\`: \`${fmt4(pct(t.turnBuckets.t1_20, totalSim))}%\` (${t.turnBuckets.t1_20}판)`,
        `  - \`21 ~ 40턴\`: \`${fmt4(pct(t.turnBuckets.t21_40, totalSim))}%\` (${t.turnBuckets.t21_40}판)`,
        `  - \`41 ~ 60턴\`: \`${fmt4(pct(t.turnBuckets.t41_60, totalSim))}%\` (${t.turnBuckets.t41_60}판)`,
        `  - \`61 ~ 90턴\`: \`${fmt4(pct(t.turnBuckets.t61_90, totalSim))}%\` (${t.turnBuckets.t61_90}판)`,
        `  - \`91턴 이상\`: \`${fmt4(pct(t.turnBuckets.t91_plus, totalSim))}%\` (${t.turnBuckets.t91_plus}판)`,
        '',
        `- **종료 사유 비율**:`,
        `  - **전체 킹 포획 (\`CHECKMATE\`)**: \`${fmt4(t.totalCheckmateRatePct)}%\` (${t.endReasons.totalCheckmate}판)`,
        `    - 일반 킹 포획 (비버스트): \`${fmt4(t.normalCheckmateRatePct)}%\` (${t.endReasons.normalCheckmate}판)`,
        `    - 버스트(\`UNO!\`) 중 킹 포획: \`${fmt4(t.burstCheckmateRatePct)}%\` (${t.endReasons.burstCheckmate}판)`,
        `  - **턴 상한 / 기물 우세 판정 (\`TURN_LIMIT / MATERIAL_DECISION\`)**: \`${fmt4(t.turnLimitRatePct)}%\` (${t.endReasons.turnLimitOrMaterial}판)`,
        `  - **기권 (\`SURRENDER\`)**: \`${fmt4(t.surrenderRatePct)}%\` (${t.endReasons.surrender}판)`,
        '',
        '## 2. 선/후공(`bottom` vs `top`) 및 좌석(`Slot 0` vs `Slot 1`) 밸런스',
        '',
        `- **선/후공 숫자 카드(\`0~9\`) 추첨 통계**:`,
        `  - 판당 평균 추첨 라운드: \`${fmt4(s.avgTurnOrderRounds)}회\``,
        `  - 동점 재추첨 발생 경기 비율: \`${fmt4(s.tieMatchRatePct)}%\` (${s.tieMatchCount}/${totalSim}판)`,
        `  - 라운드당 동점 발생률: 실측 \`${fmt4(s.tieRatePerRoundPct)}%\` vs 비복원 40장 이론치 \`${fmt4(s.theoreticalNonReplacementTiePct)}%\` (복원 기준 \`10.0000%\`)`,
        '',
        `- **선공(\`bottom\`, 하단) vs 후공(\`top\`, 상단) 승률**:`,
        `  - **선공(\`bottom\`) 승률**: \`${fmt4(s.bottomWinRatePct)}%\` (${s.bottomWins}승)`,
        `  - **후공(\`top\`) 승률**: \`${fmt4(s.topWinRatePct)}%\` (${s.topWins}승)`,
        `  - **선/후공 승률 격차(\`Δ\`)**: \`${fmt4(s.sideWinGapPct)}%p\``,
        '',
        `- **좌석(\`Slot 0\` vs \`Slot 1\`) 밸런스**:`,
        `  - \`Slot 0\` 선공 획득률: \`${fmt4(s.slot0FirstRatePct)}%\` · 최종 승률: \`${fmt4(s.slot0WinRatePct)}%\``,
        `  - \`Slot 1\` 선공 획득률: \`${fmt4(s.slot1FirstRatePct)}%\` · 최종 승률: \`${fmt4(s.slot1WinRatePct)}%\``,
        '',
        '## 3. 버스트(`UNO!`) 영향력 & 재드로우 경제',
        '',
        `- **판당 평균 버스트 발동 횟수**: \`${fmt4(b.avgBurstsPerMatch)}회\` (버스트 발생 경기 비율: \`${fmt4(b.matchBurstRatePct)}%\`)`,
        `- **첫 버스트 평균 발동 턴**: \`${fmt4(b.avgFirstBurstTurn)}턴\``,
        `- **버스트 발동 여부에 따른 승률**:`,
        `  - 버스트 1회 이상 발동 플레이어 승률: \`${fmt4(b.burstUserWinRatePct)}%\``,
        `  - 버스트 미발동 플레이어 승률: \`${fmt4(b.nonBurstUserWinRatePct)}%\``,
        `  - 전체 체크메이트 중 버스트 상태 피니시 비중: \`${fmt4(b.burstCheckmateShareOfCheckmatesPct)}%\``,
        '',
        `- **버스트 종료 재드로우 경제 (\`기본 7 + 우울(+2) - 프로모션(-1)\`)**:`,
        `  - 버스트 종료 시 평균 재드로우 장수: \`${fmt4(b.avgRedrawCount)}장\` (총 ${b.burstRedrawEventsCount}회 종료)`,
        `  - 판당 버스트 중 \`우울(+2)\` 피격 가산 횟수: \`${fmt4(b.avgDepressionHitsDuringBurst)}회\``,
        `  - 판당 버스트 중 \`프로모션(-1)\` 차감 횟수: \`${fmt4(b.avgPromotionsDuringBurst)}회\``,
        '',
        '## 4. 카드 56종 제출 · `콤보` 연쇄 · 턴 진행 4대 분기 통계',
        '',
        `- **판당 평균 카드 제출 수**: \`${fmt4(cb.avgCardsPlayedPerMatch)}장\` · **판당 평균 묘지 재셔플**: \`${fmt4(cb.avgDeckReshufflesPerMatch)}회\``,
        `- **\`콤보\` 카드 연쇄 빈도**:`,
        `  - 2장 연쇄 콤보 (\`콤보 → 일반/특수\`): 판당 \`${fmt4(cb.avgActionCombo2PerMatch)}회\``,
        `  - 3장 최대 연쇄 콤보 (\`콤보 → 콤보 → 비콤보\`): 판당 \`${fmt4(cb.avgActionCombo3PerMatch)}회\``,
        '',
        '| 카드 종류 | 판당 평균 제출 | 전체 제출 비중 | 승자 제출 비중 | 누적 제출 수 |',
        '| :--- | :---: | :---: | :---: | :---: |'
    ];

    for (const k of CARD_KIND_KEYS) {
        const totalCnt = cb.cardsPlayedSum[k] || 0;
        const winCnt = cb.winnerCardsPlayedSum[k] || 0;
        const perMatch = totalCnt / totalSim;
        const sharePct = pct(totalCnt, cb.totalCardsPlayedAll);
        const winSharePct = pct(winCnt, totalCnt);
        lines.push(
            `| **${CARD_KIND_LABELS[k]}** | \`${fmt4(perMatch)}회\` | \`${fmt4(sharePct)}%\` | \`${fmt4(winSharePct)}%\` | ${totalCnt.toLocaleString()}회 |`
        );
    }

    lines.push(
        '',
        '- **턴 진행 4대 분기 비율 (일반 카드 페이즈 기준)**:',
        `  - **분기 1 (낼 카드 제출 + 체스 이동)**: \`${fmt4(cb.branch1RatePct)}%\` (${cb.turnBranchesSum.branch1_playAndMove.toLocaleString()}턴)`,
        `  - **분기 2 (낼 카드 제출 + 이동 불가 페널티 드로우)**: \`${fmt4(cb.branch2RatePct)}%\` (${cb.turnBranchesSum.branch2_playAndNoMovePenalty.toLocaleString()}턴)`,
        `  - **분기 3 (카드 없음 드로우 → 즉시 제출 + 체스 이동)**: \`${fmt4(cb.branch3RatePct)}%\` (${cb.turnBranchesSum.branch3_drawPlayAndMove.toLocaleString()}턴)`,
        `  - **분기 4 (카드 없음 드로우 → 손패 보관 또는 이동 불가)**: \`${fmt4(cb.branch4RatePct)}%\` (${cb.turnBranchesSum.branch4_drawKeepOrNoMove.toLocaleString()}턴)`,
        `  - *(참고)* 버스트 카드 생략 체스 턴: \`${cb.turnBranchesSum.burstSkipCardTurn.toLocaleString()}턴\` · 스킵 피격 체스 턴: \`${cb.turnBranchesSum.skipHitCardTurn.toLocaleString()}턴\``,
        '',
        '## 5. 체스 기물 · 프로모션(강화 폰 `P+`) · 캐슬링 통계',
        '',
        `- **폰 프로모션 (강화 폰 \`isPromoted: true\` 승급 + 카드 1장 소각)**:`,
        `  - 판당 프로모션 발생 횟수: \`${fmt4(cp.avgPromotionsPerMatch)}회\` (발생 경기 비율: \`${fmt4(cp.promotionMatchRatePct)}%\`)`,
        `  - 프로모션 카드 즉시 소각: 총 \`${cp.promotedPawnCardBurnsSum.toLocaleString()}회\` · 버스트 중 재드로우 \`-1\` 차감: 총 \`${cp.promotedPawnBurstDeltaSubtractsSum.toLocaleString()}회\``,
        `  - **승급 후 강화 폰(\`P+\`) 활약도**: 판당 이동 \`${fmt4(cp.avgPromotedPawnMovesPerMatch)}회\` · 판당 포획 \`${fmt4(cp.avgPromotedPawnCapturesPerMatch)}회\` · **전체 체크메이트 중 강화 폰(\`P+\`) 킹 피니시 비율: \`${fmt4(cp.promotedPawnKingFinishRatePct)}%\`**`,
        `- **퀸(\`Q\`) 2턴 쿨타임 및 캐슬링**:`,
        `  - 판당 퀸 쿨타임 대기 턴 수: \`${fmt4(cp.avgQueenCooldownTurnsPerMatch)}턴\``,
        `  - 판당 캐슬링 발동 횟수: \`${fmt4(cp.avgCastlingsPerMatch)}회\` (좌측 \`${cp.castlingSum.left}회\` / 우측 \`${cp.castlingSum.right}회\` · 안전 \`${cp.castlingSum.safe}회\` / 위협 감수 \`${cp.castlingSum.unsafeForced}회\`)`,
        '',
        '| 기물 구분 | 판당 평균 이동 | 판당 평균 포획 | 상대 킹 피니셔 비율 | 누적 킹 포획 수 |',
        '| :--- | :---: | :---: | :---: | :---: |'
    );

    for (const pk of PIECE_KEYS) {
        const mvAvg = (cp.pieceMovesSum[pk] || 0) / totalSim;
        const capAvg = (cp.pieceCapturesSum[pk] || 0) / totalSim;
        const finCnt = cp.kingFinisherCounts[pk] || 0;
        const finPct = pct(finCnt, t.endReasons.totalCheckmate);
        lines.push(
            `| **${PIECE_LABELS[pk]}** | \`${fmt4(mvAvg)}회\` | \`${fmt4(capAvg)}회\` | \`${fmt4(finPct)}%\` | ${finCnt.toLocaleString()}회 |`
        );
    }

    lines.push(
        '',
        '## 6. 안전도 삼각형 (`none / yellow / red`) 분포',
        '',
        `- **전체 체스 이동 수**: \`${st.totalChessMoves.toLocaleString()}회\` (판당 \`${fmt4(st.totalChessMoves / totalSim)}회\`)`,
        `- **🟢 위협 없음 (\`none\`)**: \`${fmt4(st.noneRatePct)}%\` (${st.moveSafetySum.none.toLocaleString()}회)`,
        `- **🟡 잠재 위협 (\`yellow\` — 쿨타임 중인 상대 퀸 공격 범위)**: \`${fmt4(st.yellowRatePct)}%\` (${st.moveSafetySum.yellow.toLocaleString()}회)`,
        `- **🔴 즉시 위협 / 자살수 (\`red\` — 상대 활성 기물 즉시 공격 범위)**: \`${fmt4(st.redRatePct)}%\` (${st.moveSafetySum.red.toLocaleString()}회)`,
        '',
        '## 7. 시뮬레이션 무결성 (QA 불변식 검증)',
        '',
        `- **카드 총량(\`56장\`) 보존 위반**: \`${inv.cardTotalMismatch}건\``,
        `- **보드 프리셋 \`4색 9칸·상하좌우 비인접\` 위반**: \`${inv.boardPresetInvalid}건\``,
        `- **\`콤보\` 3연속 제출 위반**: \`${inv.actionTripleChain}건\``,
        `- **퀸(\`Q\`) 쿨타임 중 이동 위반**: \`${inv.queenCooldownViolation}건\``,
        `- **강화 폰(\`P+\`) 기물 점프 / 색상 규칙 위반**: \`${inv.promotedPawnJumpOrColorViolation}건\``,
        `- **강화 폰(\`P+\`) 프로모션 재발동 위반**: \`${inv.promotedPawnRePromotion}건\``,
        `- **\`NaN\` / 무한루프 발생**: \`${inv.nanOrInfiniteLoop}건\``,
        ''
    );

    return lines.join('\n');
}

export function createUnosLogAdapter(maxCycles = UNOS_MAX_HISTORY, fileNames = UNOS_LOG_FILES, compactFn = compactUnosCyclesDensityPreserve) {
    return {
        gameId: 'unos',
        maxCycles,
        fileNames,
        normalizeMatchData: normalizeUnosMatchData,
        compactCycles: compactFn,
        computePopulationSummary: computeUnosPopulationSummary,
        renderCycleDetailText: (cycles) => renderUnosCycleDetailText(cycles, maxCycles),
        renderAverageSummaryText: (cycles, meta = null) => renderUnosAverageSummaryText(cycles, meta, maxCycles)
    };
}

export const UnosLogAdapter = createUnosLogAdapter(UNOS_MAX_HISTORY, UNOS_LOG_FILES, compactUnosCyclesDensityPreserve);
export const UnosLog10Adapter = createUnosLogAdapter(UNOS_10_MAX_HISTORY, UNOS_LOG_10_FILES, compactUnosCyclesQuantilePreserve);
