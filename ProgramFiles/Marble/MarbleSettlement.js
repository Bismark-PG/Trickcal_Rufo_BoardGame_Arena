import { GAME_CONSTANTS, MULTIPLIERS, BUILDING_COSTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES, SPECIAL_TERRITORY_IDS, BoardNames } from '../System/Index/Marble/MarbleBoardIndex.js';
import { LangState } from '../System/LanguageManager.js';
import { formatMoney, getSettlementText } from './MarbleRuntime.js';
import { getGlobalBbangjuVisits } from './MarbleEconomy.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';

// 플레이어가 특정 칸의 통행료 면제 카드(27~30, 32)를 보유 중인지 판별
function hasSpecialTerritoryImmunity(player, tileId) {
    if (!player || !player.buffs) return false;
    const immuneCards = [
        ...(player.buffs['hold_immune'] || []),
        ...(player.buffs['todo_hold_immune'] || [])
    ];
    return immuneCards.some(c => c && c.targetId === tileId);
}

// 특수 영토(요충지)의 정산 1인당 수금액 산출 헬퍼:
// 정산 시에는 특수 영토 배율(+0.2)을 적용하지 않고 매입가의 왕국 배율(1.2배)을 산정한 뒤, 3명으로 나눈 금액(12만 / 20만 / 24만 / 28만)을 각 대상에게서 수금
export function getSpecialTerritoryVillageToll(tile) {
    const totalKingdomToll = Math.round(tile.basePrice * MULTIPLIERS.BUILDING[3]); // 매입가 * 1.2 (36만, 60만, 72만, 84만)
    return Math.round(totalKingdomToll / 3); // 1인당 수금액 (12만, 20만, 24만, 28만)
}

// ==========================================
// 최종 20턴 종료 정산 계산 시스템
// ==========================================
export function processFinalSettlement(allPlayers, tiles) {
    const sText = getSettlementText();

    // 전체 통계 집계 (모나티엄25 총 방문 횟수, 정령 호수 총 휴식 횟수, 카드 칸 총 도착 횟수, 정비반장 인원수)
    const totalMonatiumVisits = allPlayers.reduce((sum, pl) => sum + (pl.tracker.monatium25Visits || 0), 0);
    const totalLakeRests = allPlayers.reduce((sum, pl) => sum + (pl.tracker.lakeRestCount || 0), 0);
    const totalCardTileVisits = allPlayers.reduce((sum, pl) => sum + (pl.tracker.cardsDrawn || 0), 0);
    const totalBbangjuChiefs = Math.max(1, allPlayers.filter(pl => pl.isBbangjuChief).length);

    // 플레이어별 정산 컨텍스트 초기화 (선두 플레이어부터 순서대로)
    const results = allPlayers.map(p => ({
        player: p,
        baseCash: p.isBankrupt ? 0 : p.money,
        totalAsset: p.isBankrupt ? 0 : p.money,
        totalLoan: p.isBankrupt ? 0 : (p.getTotalLoanDebt ? p.getTotalLoanDebt() : Math.round((p.loanPrincipal || 0) + (p.loanInterestPrincipal || 0) + (p.loanInterest || 0))),
        specialTerritoryCollectTotal: 0,
        specialTerritoryPaidTotal: 0,
        specialTerritoryPaidCount: 0,
        stateStealPaidTotal: 0,
        stateStealPaidCount: 0,
        kimWorkerCollectCount: 0,
        kimWorkerCollectTotal: 0,
        kimWorkerPaidTotal: 0,
        lakeReward: 0,
        moonFlowerCollectCount: 0,
        moonFlowerCollectTotal: 0,
        lapLeaderReward: 0,
        isLapLeaderWinner: false,
        netWorth: 0,
        isBankruptFinal: p.isBankrupt,
        categories: []
    }));

    // 1단계: 특수 영토(요충지) 수금에 의한 플레이어 간 가감 선계산
    // 선두 플레이어부터 순서대로 소유한 특수 영토의 마을 통행료를 다른 생존 플레이어에게서 수금 (통행료 면제 카드 보유자는 수금 무효)
    const specialTerritoryCollectMap = new Map(); // key: `${playerIndex}_${tileId}` -> { count, unitToll, total }
    results.forEach(res => {
        const p = res.player;
        if (p.isBankrupt) return;

        SPECIAL_TERRITORY_IDS.forEach(tileId => {
            const tile = tiles[tileId];
            const unitToll = getSpecialTerritoryVillageToll(tile);
            if (tile.owner === p) {
                const targets = results.filter(otherRes =>
                    otherRes.player !== p &&
                    !otherRes.player.isBankrupt &&
                    !hasSpecialTerritoryImmunity(otherRes.player, tileId)
                );
                const collectCount = targets.length;
                const collectTotal = unitToll * collectCount;

                res.totalAsset += collectTotal;
                res.specialTerritoryCollectTotal += collectTotal;
                targets.forEach(targetRes => {
                    targetRes.totalAsset -= unitToll;
                    targetRes.specialTerritoryPaidTotal += unitToll;
                    targetRes.specialTerritoryPaidCount++;
                });

                specialTerritoryCollectMap.set(`${p.id}_${tileId}`, {
                    owned: true,
                    count: collectCount,
                    unitToll,
                    total: collectTotal
                });
            } else {
                specialTerritoryCollectMap.set(`${p.id}_${tileId}`, {
                    owned: false,
                    count: 0,
                    unitToll,
                    total: 0
                });
            }
        });
    });

    // 1-2단계: 보유 카드(김씨노동기 / 달바라기 한 송이)에 의한 플레이어 간 수금 가감 선계산
    const stealUnit = GAME_CONSTANTS.SETTLE_STEAL_UNIT; // 25만
    const survivingResults = results.filter(r => !r.player.isBankrupt);

    results.forEach(res => {
        const p = res.player;
        if (p.isBankrupt) return;

        // [204: 김씨노동기] 정령 호수가 퍼리비이치 상태일 때, 자신의 퍼리비이치 도착 횟수 * 25만 달러를 퍼리비이치 주인에게서 수금
        const hasKimWorker = (p.buffs['hold_worker'] && p.buffs['hold_worker'].length > 0) ||
                             (p.buffs['todo_hold_worker'] && p.buffs['todo_hold_worker'].length > 0);
        if (hasKimWorker && WorldGimmickManager.isFurryBeach) {
            const lakeOwner = tiles[BOARD_TILES.LAKE].owner;
            const lakeOwnerRes = lakeOwner ? results.find(r => r.player === lakeOwner && !r.player.isBankrupt) : null;
            const fbVisits = p.tracker.furryBeachVisits || 0;
            if (lakeOwnerRes && lakeOwnerRes.player !== p && fbVisits > 0) {
                const collectAmt = fbVisits * stealUnit;
                res.kimWorkerCollectCount = fbVisits;
                res.kimWorkerCollectTotal = collectAmt;
                res.totalAsset += collectAmt;

                lakeOwnerRes.totalAsset -= collectAmt;
                lakeOwnerRes.stateStealPaidTotal += collectAmt;
                lakeOwnerRes.stateStealPaidCount += fbVisits;
                lakeOwnerRes.kimWorkerPaidTotal += collectAmt;
            }
        }

        // [108: 달바라기 한 송이] 본인을 제외한 타 플레이어 중 달바라기 언덕 최다 방문자로부터 (최다 방문 횟수 * 25만) 수금
        // 최다 방문자가 여러 명(동률)일 경우 보유자는 1명분 금액만 수령하고, 동률 방문자들은 해당 금액을 1/n로 나누어 차감
        const hasMoonFlower = (p.buffs['hold_moon_double'] && p.buffs['hold_moon_double'].length > 0) ||
                              (p.buffs['todo_hold_moon_double'] && p.buffs['todo_hold_moon_double'].length > 0);
        if (hasMoonFlower) {
            const otherSurviving = survivingResults.filter(r => r.player !== p);
            const maxOtherMoonVisits = otherSurviving.reduce((max, r) => Math.max(max, r.player.tracker.moonHillVisits || 0), 0);
            if (maxOtherMoonVisits > 0) {
                const topVisitors = otherSurviving.filter(r => (r.player.tracker.moonHillVisits || 0) === maxOtherMoonVisits);
                const collectAmt = maxOtherMoonVisits * stealUnit;
                res.moonFlowerCollectCount = maxOtherMoonVisits;
                res.moonFlowerCollectTotal = collectAmt;
                res.totalAsset += collectAmt;

                const eachLoss = Math.round(collectAmt / topVisitors.length);
                topVisitors.forEach(visitorRes => {
                    visitorRes.totalAsset -= eachLoss;
                    visitorRes.stateStealPaidTotal += eachLoss;
                    visitorRes.stateStealPaidCount += maxOtherMoonVisits;
                });
            }
        }
    });

    // 1-3단계: 최다 순회자 보너스 (생존자 중 순회 횟수 최다, 동률 시 보드 순회점 0번 칸에 시계방향으로 가장 근접한 pos 최대자, 동일 pos 동률 시 균등 분배)
    const maxSurvivingLaps = survivingResults.reduce((mx, r) => Math.max(mx, r.player.tracker?.lapPassCount || 0), 0);
    if (maxSurvivingLaps > 0) {
        const lapCandidates = survivingResults.filter(r => (r.player.tracker?.lapPassCount || 0) === maxSurvivingLaps);
        const maxClosestPos = lapCandidates.reduce((mx, r) => Math.max(mx, Number(r.player.pos) || 0), -1);
        const lapWinners = lapCandidates.filter(r => (Number(r.player.pos) || 0) === maxClosestPos);
        const totalLapBonus = maxSurvivingLaps * (GAME_CONSTANTS.SETTLE_LAP_LEADER_UNIT || 150000);
        const eachLapBonus = lapWinners.length > 0 ? Math.round(totalLapBonus / lapWinners.length) : 0;
        lapWinners.forEach(wRes => {
            wRes.isLapLeaderWinner = true;
            wRes.lapLeaderReward = eachLapBonus;
            wRes.totalAsset += eachLapBonus;
        });
    }

    // 2단계: 선두 플레이어부터 순서대로 전체 정산 항목 구축 및 합산
    results.forEach(res => {
        const p = res.player;

        // (1) 기본 보유 현금
        const baseCategory = {
            title: sText.CAT_BASE,
            items: [
                {
                    label: sText.ITEM_CASH,
                    formula: `${formatMoney(res.baseCash)} * ${p.isBankrupt ? 0 : 1} = ${formatMoney(res.baseCash)}`,
                    amount: res.baseCash,
                    isActive: !p.isBankrupt && res.baseCash > 0
                }
            ]
        };

        // (2) 일반 영토 및 건물 정산 (건설 단계 0~4별)
        const levelLabels = [
            sText.ITEM_LAND_LV0,
            sText.ITEM_LAND_LV1,
            sText.ITEM_LAND_LV2,
            sText.ITEM_LAND_LV3,
            sText.ITEM_LAND_LV4
        ];
        const landItems = [];
        for (let lv = 0; lv <= 4; lv++) {
            const matchingTiles = p.isBankrupt
                ? []
                : tiles.filter(t => t.owner === p && t.type === 'normal' && t.level === lv);
            const count = matchingTiles.length;
            const settleMult = MULTIPLIERS.SETTLEMENT[lv] + lv; // 기본 정산 배율 + 건설 단계(0~4) 합산 (0.5 / 2.0 / 3.5 / 4.75 / 6.0)
            const lvSum = matchingTiles.reduce((sum, t) => sum + Math.round(t.basePrice * settleMult), 0);
            res.totalAsset += lvSum;

            landItems.push({
                label: levelLabels[lv],
                formula: `* ${count}${sText.UNIT_COUNT} = ${count > 0 ? '+' : ''}${formatMoney(lvSum)}`,
                amount: lvSum,
                isActive: count > 0
            });
        }
        const landCategory = {
            title: sText.CAT_LAND,
            items: landItems
        };

        // (3) 특수 영토(요충지) 수금 정산
        const specTerrItems = SPECIAL_TERRITORY_IDS.map(tileId => {
            const tileName = BoardNames[tileId][LangState.current] || BoardNames[tileId].ko;
            const info = specialTerritoryCollectMap.get(`${p.id}_${tileId}`) || {
                owned: false,
                count: 0,
                unitToll: getSpecialTerritoryVillageToll(tiles[tileId]),
                total: 0
            };
            const isActive = info.owned && info.count > 0;
            return {
                label: `[${tileName}] ${sText.ITEM_SPEC_TERR_COLLECT}`,
                formula: `${formatMoney(info.unitToll)} * ${isActive ? info.count : 0} = ${isActive ? '+' : ''}${formatMoney(info.total)}`,
                amount: info.total,
                isActive
            };
        });

        // 타 플레이어의 특수 영토에 의해 수금당한 차감 내역
        const paidActive = res.specialTerritoryPaidCount > 0;
        specTerrItems.push({
            label: sText.ITEM_SPEC_TERR_PAID,
            formula: `* ${paidActive ? res.specialTerritoryPaidCount : 0} = ${paidActive ? '-' : ''}${formatMoney(res.specialTerritoryPaidTotal)}`,
            amount: -res.specialTerritoryPaidTotal,
            isActive: paidActive,
            isNegative: paidActive
        });

        const specTerrCategory = {
            title: sText.CAT_SPECIAL_TERRITORY,
            items: specTerrItems
        };

        // (4) 특수 칸 소유 정산 (극장, 모나티엄 25, 정령 호수 / 퍼리비이치, 마녀 도서관)
        const unitReward = GAME_CONSTANTS.SETTLE_SPECIAL_TILE_UNIT; // 10만
        const isFurry = WorldGimmickManager.isFurryBeach;
        const lakeUnitReward = isFurry ? GAME_CONSTANTS.SETTLE_FURRY_BEACH_UNIT : unitReward; // 퍼리비이치 시 15만, 기본 10만

        // 4-1. 엘리아스 극장
        const ownsTheater = !p.isBankrupt && tiles[BOARD_TILES.THEATER].owner === p;
        const theaterCount = ownsTheater ? (p.tracker.theaterProfitCount || 0) : 0;
        const theaterReward = theaterCount * unitReward;
        res.totalAsset += theaterReward;

        // 4-2. 모나티엄 25
        const ownsMonatium = !p.isBankrupt && tiles[BOARD_TILES.MONATIUM_25].owner === p;
        const monatiumCount = ownsMonatium ? totalMonatiumVisits : 0;
        const monatiumReward = monatiumCount * unitReward;
        res.totalAsset += monatiumReward;

        // 4-3. 정령 호수 / 퍼리비이치
        const ownsLake = !p.isBankrupt && tiles[BOARD_TILES.LAKE].owner === p;
        const lakeCount = ownsLake ? totalLakeRests : 0;
        const lakeReward = lakeCount * lakeUnitReward;
        res.lakeReward = lakeReward;
        res.totalAsset += lakeReward;

        // 4-4. 마녀 도서관 (모든 플레이어의 총 카드 칸 도착 횟수 * 10만)
        const ownsLibrary = !p.isBankrupt && tiles[BOARD_TILES.LIBRARY].owner === p;
        const libraryCount = ownsLibrary ? totalCardTileVisits : 0;
        const libraryReward = libraryCount * unitReward;
        res.totalAsset += libraryReward;

        // 4-5. 다야의 궁전 (정산 시점 보유자에 한해 본인이 보유했었던 총 턴 수 * 10만)
        const ownsDaya = !p.isBankrupt && tiles[BOARD_TILES.DAYA].owner === p;
        const dayaCount = ownsDaya ? (p.tracker.dayaHoldTurns || 0) : 0;
        const dayaReward = dayaCount * unitReward;
        res.totalAsset += dayaReward;

        const specialTileCategory = {
            title: sText.CAT_SPECIAL_TILE,
            items: [
                {
                    label: sText.ITEM_THEATER,
                    formula: `${formatMoney(unitReward)} * ${theaterCount} = ${theaterReward > 0 ? '+' : ''}${formatMoney(theaterReward)}`,
                    amount: theaterReward,
                    isActive: ownsTheater && theaterCount > 0
                },
                {
                    label: sText.ITEM_MONATIUM25,
                    formula: `${formatMoney(unitReward)} * ${monatiumCount} = ${monatiumReward > 0 ? '+' : ''}${formatMoney(monatiumReward)}`,
                    amount: monatiumReward,
                    isActive: ownsMonatium && monatiumCount > 0
                },
                {
                    label: isFurry ? sText.ITEM_FURRY_BEACH : sText.ITEM_LAKE,
                    formula: `${formatMoney(lakeUnitReward)} * ${lakeCount} = ${lakeReward > 0 ? '+' : ''}${formatMoney(lakeReward)}`,
                    amount: lakeReward,
                    isActive: ownsLake && lakeCount > 0
                },
                {
                    label: sText.ITEM_LIBRARY,
                    formula: `${formatMoney(unitReward)} * ${libraryCount} = ${libraryReward > 0 ? '+' : ''}${formatMoney(libraryReward)}`,
                    amount: libraryReward,
                    isActive: ownsLibrary && libraryCount > 0
                },
                {
                    label: sText.ITEM_DAYA,
                    formula: `${formatMoney(unitReward)} * ${dayaCount} = ${dayaReward > 0 ? '+' : ''}${formatMoney(dayaReward)}`,
                    amount: dayaReward,
                    isActive: ownsDaya && dayaCount > 0
                }
            ]
        };

        // (5) 보유 및 상태 정산 (빵주 정비반장, 김씨노동기, 달바라기 한 송이, 태초의 엘리프)
        const bbangjuBase = GAME_CONSTANTS.SETTLE_BBANGJU_BASE; // 150만
        const bbangjuUnit = GAME_CONSTANTS.SETTLE_BBANGJU_UNIT; // 20만
        const isChief = !p.isBankrupt && p.isBbangjuChief;
        const bbangjuCount = isChief ? getGlobalBbangjuVisits() : 0;
        const bbangjuReward = isChief ? Math.round((bbangjuBase + bbangjuCount * bbangjuUnit) / totalBbangjuChiefs) : 0;
        res.totalAsset += bbangjuReward;

        // 태초의 엘리프 (정령산 정상 효과 유지 턴 수 * 10만)
        const hasOriginElif = !p.isBankrupt && (p.hasOriginElif || (p.buffs['hold_origin'] && p.buffs['hold_origin'].length > 0));
        const originTurns = hasOriginElif ? (p.tracker.mountainBuffTurns || 0) : 0;
        const originReward = originTurns * unitReward;
        res.totalAsset += originReward;

        const kimActive = res.kimWorkerCollectCount > 0;
        const moonActive = res.moonFlowerCollectCount > 0;
        const statePaidActive = res.stateStealPaidTotal > 0;

        const bbangjuFormulaStr = !isChief
            ? `${formatMoney(bbangjuUnit)} * 0 = ${formatMoney(0)}`
            : (totalBbangjuChiefs > 1
                ? `(${formatMoney(bbangjuBase)} + ${formatMoney(bbangjuUnit)} * ${bbangjuCount}) / ${totalBbangjuChiefs}${sText.UNIT_PERSONS} = +${formatMoney(bbangjuReward)}`
                : `${formatMoney(bbangjuBase)} + (${formatMoney(bbangjuUnit)} * ${bbangjuCount}) = +${formatMoney(bbangjuReward)}`);

        const stateCategory = {
            title: sText.CAT_STATE,
            items: [
                {
                    label: sText.ITEM_BBANGJU_CHIEF,
                    formula: bbangjuFormulaStr,
                    amount: bbangjuReward,
                    isActive: isChief
                },
                {
                    label: sText.ITEM_KIM_WORKER,
                    formula: `${formatMoney(stealUnit)} * ${kimActive ? res.kimWorkerCollectCount : 0} = ${kimActive ? '+' : ''}${formatMoney(res.kimWorkerCollectTotal)}`,
                    amount: res.kimWorkerCollectTotal,
                    isActive: kimActive
                },
                {
                    label: sText.ITEM_MOON_FLOWER,
                    formula: `${formatMoney(stealUnit)} * ${moonActive ? res.moonFlowerCollectCount : 0} = ${moonActive ? '+' : ''}${formatMoney(res.moonFlowerCollectTotal)}`,
                    amount: res.moonFlowerCollectTotal,
                    isActive: moonActive
                },
                {
                    label: sText.ITEM_ORIGIN_ELIF,
                    formula: `${formatMoney(unitReward)} * ${originTurns} = ${originReward > 0 ? '+' : ''}${formatMoney(originReward)}`,
                    amount: originReward,
                    isActive: hasOriginElif && originTurns > 0
                },
                {
                    label: sText.ITEM_LAP_LEADER,
                    formula: `${formatMoney(GAME_CONSTANTS.SETTLE_LAP_LEADER_UNIT || 150000)} * ${res.isLapLeaderWinner ? (p.tracker?.lapPassCount || 0) : 0} = ${res.lapLeaderReward > 0 ? '+' : ''}${formatMoney(res.lapLeaderReward)}`,
                    amount: res.lapLeaderReward,
                    isActive: res.isLapLeaderWinner && res.lapLeaderReward > 0
                },
                {
                    label: sText.ITEM_STATE_STEAL_PAID,
                    formula: `* ${statePaidActive ? res.stateStealPaidCount : 0} = ${statePaidActive ? '-' : ''}${formatMoney(res.stateStealPaidTotal)}`,
                    amount: -res.stateStealPaidTotal,
                    isActive: statePaidActive,
                    isNegative: statePaidActive
                }
            ]
        };

        // (6) 대출 원금 및 이자 청산
        const loanPrincipal = p.isBankrupt ? 0 : (p.getTotalPrincipalBalance ? p.getTotalPrincipalBalance() : ((p.loanPrincipal || 0) + (p.loanInterestPrincipal || 0)));
        const loanInterest = p.isBankrupt ? 0 : Math.round(p.loanInterest || 0);
        const hasLoan = !p.isBankrupt && p.loanCount > 0;

        const loanCategory = {
            title: sText.CAT_LOAN,
            items: [
                {
                    label: sText.ITEM_LOAN_PRINCIPAL,
                    formula: `* ${hasLoan ? p.loanCount : 0} = ${loanPrincipal > 0 ? '-' : ''}${formatMoney(loanPrincipal)}`,
                    amount: -loanPrincipal,
                    isActive: loanPrincipal > 0,
                    isNegative: loanPrincipal > 0
                },
                {
                    label: sText.ITEM_LOAN_INTEREST,
                    formula: `* ${hasLoan ? 1 : 0} = ${loanInterest > 0 ? '-' : ''}${formatMoney(loanInterest)}`,
                    amount: -loanInterest,
                    isActive: loanInterest > 0,
                    isNegative: loanInterest > 0
                }
            ]
        };

        res.categories = [
            baseCategory,
            landCategory,
            specTerrCategory,
            specialTileCategory,
            stateCategory,
            loanCategory
        ];

        // (7) 최종 청산 및 파산 판정 (상납된 금액이 자산보다 크면 파산)
        res.netWorth = res.totalAsset - res.totalLoan;
        if (p.isBankrupt || res.netWorth < 0) {
            res.isBankruptFinal = true;
        }
    });

    // 순위 정렬 (파산자는 뒤로, 생존자는 최종 순자산 내림차순)
    const rankedResults = [...results].sort((a, b) => {
        if (a.isBankruptFinal && !b.isBankruptFinal) return 1;
        if (!a.isBankruptFinal && b.isBankruptFinal) return -1;
        return b.netWorth - a.netWorth;
    });

    return rankedResults;
}

export function serializeSettlementResults(rankedResults) {
    return (rankedResults || []).map(res => ({
        player: {
            id: res.player.id,
            name: res.player.name,
            color: res.player.color
        },
        baseCash: res.baseCash,
        totalAsset: res.totalAsset,
        totalLoan: res.totalLoan,
        specialTerritoryCollectTotal: res.specialTerritoryCollectTotal || 0,
        specialTerritoryPaidTotal: res.specialTerritoryPaidTotal || 0,
        netWorth: res.netWorth,
        isBankruptFinal: Boolean(res.isBankruptFinal),
        categories: res.categories
    }));
}
