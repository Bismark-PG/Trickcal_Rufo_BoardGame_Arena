// ProgramFiles/Marble/MarbleCard.js
// 카드(덱) 매니저: 덱/사용된 카드 추적, 확률/등장조건 필터링, 등급별(일반/특수/보물) 실행자 라우팅
import {
    RuntimePopup,
    getActiveWorld,
    getCardDeck,
    getCardUIText
} from './MarbleRuntime.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import { OdysseyManager, getDrawnTreasures } from './MarbleOdyssey.js';
import { RequiemState } from './MarbleRequiem.js';

import { executeNormalCard, useNormalActiveCard } from './MarbleCardNormal.js';
import { executeSpecialCard, useSpecialActiveCard } from './MarbleCardSpecial.js';
import { executeTreasureCard, useTreasureActiveCard, getPlayerThinkTime } from './MarbleCardTreasure.js';

export function getCardGrade(cardOrId) {
    const id = typeof cardOrId === 'object' ? Number(cardOrId?.id) : Number(cardOrId);
    if (id >= 500) return 'treasure';
    if (id >= 100) return 'special';
    return 'normal';
}

export function getUsedCardIds() {
    return getActiveWorld().usedCardIds;
}

export function resetCardDeck() {
    const world = getActiveWorld();
    world.usedCardIds.clear();
    if (world.currentShoeDrawnIds) world.currentShoeDrawnIds.clear();
}

// 현재 플레이어들이 보유/인벤토리/활성 버프에 가지고 있는 카드 ID 집합 반환 (이미 세상에 나온 보물 포함)
export function getCurrentlyHeldCardIds(allPlayers = []) {
    const heldIds = new Set();
    getDrawnTreasures().forEach(id => heldIds.add(id));
    allPlayers.forEach(p => {
        if (!p) return;
        if (p.inventory) p.inventory.forEach(c => heldIds.add(c.id));
        if (p.treasureCards) p.treasureCards.forEach(c => heldIds.add(c.id));
        if (p.buffs) {
            Object.values(p.buffs).forEach(arr => {
                if (Array.isArray(arr)) arr.forEach(c => { if (c && c.id) heldIds.add(c.id); });
            });
        }
        if (p.hasErpinDiceBuff) heldIds.add(CARD_IDS.SPEC_ERPIN_DICE);
        if (p.nextCardDoubleDraw) heldIds.add(CARD_IDS.SPEC_DOUBLE_DRAW);
        if (p.hasRecoveredMemory) heldIds.add(CARD_IDS.SPEC_FORGOTTEN_MEM);
        if (p.hasOriginElif) heldIds.add(CARD_IDS.SPEC_ORIGIN_ELIF);
        if (p.hasLibraryBuff) heldIds.add(CARD_IDS.LIBRARY_ASSIST);
        if (p.hasSistDiscountBuff) heldIds.add(CARD_IDS.SIST_DEAL);
        if (p.hasRufoDiceBuff) heldIds.add(CARD_IDS.RUFO_DICE);
        if (p.hasVipShield) heldIds.add(CARD_IDS.VIP_CARD);
        if (p.hasPiraCard) heldIds.add(CARD_IDS.PIRA_LOAN);
        if (p.timeAccelBuffPhase && p.timeAccelBuffPhase !== 'none') heldIds.add(CARD_IDS.SPEC_TIME_ACCEL);
    });
    return heldIds;
}

// [102: 뒤집어버리기] 또는 일반덱 고갈 시 사용된 차원 이동 카드를 다시 덱에 추가하고 섞음 (보유 중인 카드 및 보물 카드 영구 제외)
export function reshuffleUsedCards(allPlayers = []) {
    const world = getActiveWorld();
    const heldIds = getCurrentlyHeldCardIds(allPlayers);
    const usedIds = getUsedCardIds();
    // 이미 등장했거나(500+) 그을음 이후 영구 봉인된 보물 카드는 리셔플 시 절대 덱으로 복귀시키지 않음
    const lockedTreasureIds = new Set();
    usedIds.forEach(id => {
        if (id >= 500) lockedTreasureIds.add(id);
    });
    if (RequiemState.hasSootEverTriggered || RequiemState.isSootState) {
        getCardDeck().forEach(c => {
            if (c && c.id >= 500) lockedTreasureIds.add(c.id);
        });
    }
    usedIds.clear();
    heldIds.forEach(id => usedIds.add(id));
    lockedTreasureIds.forEach(id => usedIds.add(id));
    if (world.currentShoeDrawnIds) {
        world.currentShoeDrawnIds.clear();
        usedIds.forEach(id => world.currentShoeDrawnIds.add(id));
    }
    if (world.metrics) {
        world.metrics.deckReshuffleCount = (world.metrics.deckReshuffleCount || 0) + 1;
    }
}

// 기획서 카드별 등장 조건 판별
export function isCardEligible(card, ctx) {
    const { player, tiles, allPlayers } = ctx;
    if (!card) return false;
    const drawnTreasures = getDrawnTreasures();

    // 0. 보물 카드(501~506): 이미 등장했거나 그을음 발동 이후에는 절대 재등장 불가
    if (card.id >= 500 && (RequiemState.hasSootEverTriggered || RequiemState.isSootState || drawnTreasures.has(card.id))) {
        return false;
    }

    // 1. 빵주 연구원(32): 빵주 정비반장 상태의 플레이어에게는 등장하지 않음
    if (card.id === CARD_IDS.BBANGJU_RESEARCHER && player.isBbangjuChief) {
        return false;
    }

    // 2. 시간가속(110): 이미 시간대가 모두 끝난 20턴에는 등장하지 않음
    if (card.id === CARD_IDS.SPEC_TIME_ACCEL && ctx.turnManager && ctx.turnManager.globalTurn >= 20) {
        return false;
    }

    // 3. 오디세이아(111): 망가진 제단 방문 이력이 없거나, 남은 보물 카드가 없거나, 이미 그을음이 발동되었으면 미등장
    if (card.id === CARD_IDS.SPEC_ODYSSEY) {
        if (!player.hasVisitedAltar || RequiemState.hasSootEverTriggered || RequiemState.isSootState || drawnTreasures.size >= 6) return false;
    }

    // 4. 애증의 늑대(112): 보물 카드를 뺏어올 상대가 없다면 등장하지 않음
    if (card.id === CARD_IDS.SPEC_WOLF_STEAL) {
        const hasTarget = allPlayers && allPlayers.some(op => op !== player && !op.isBankrupt && op.treasureCards.length > 0);
        if (!hasTarget) return false;
    }

    // 5. 심판의 시간(113) & 교주의 염원(114): 그을음 진행 중일 때만 등장하며, 윤회 보유자에게는 미등장
    if (card.id === CARD_IDS.SPEC_JUDGMENT || card.id === CARD_IDS.SPEC_CULT_WISH) {
        if (!RequiemState.isSootState || player.isReincarnated) return false;
    }

    // 6. 퍼리비이치 개장(201): 정령 호수를 소유한 플레이어에게만(아직 퍼리비이치가 아닐 때) 등장
    if (card.id === CARD_IDS.SPEC_FURRY_OPEN) {
        if (!tiles || tiles[BOARD_TILES.LAKE].owner !== player || WorldGimmickManager.isFurryBeach) return false;
    }

    // 7. 코미주스 한잔해(203): 정령 호수가 퍼리비이치 상태일 때 소유 여부와 무관하게 등장 (보유형)
    if (card.id === CARD_IDS.SPEC_KOMI_JUICE) {
        if (!WorldGimmickManager.isFurryBeach) return false;
    }

    // 8. 디아나의 꿀밤(202) & 김씨노동기(204): 정령 호수가 퍼리비이치일 때, 정령 호수를 소유하지 않은 플레이어에게만 등장
    if (card.id === CARD_IDS.SPEC_DIANA_PUNCH || card.id === CARD_IDS.SPEC_KIM_WORKER) {
        if (!WorldGimmickManager.isFurryBeach || (tiles && tiles[BOARD_TILES.LAKE].owner === player)) return false;
    }

    // 9. 태초의 엘리프(206): '잊혀진 기억(205)'이 '되찾은 기억'으로 변화했고 소유하고 있는 플레이어에게만 등장
    if (card.id === CARD_IDS.SPEC_ORIGIN_ELIF) {
        if (!player.hasRecoveredMemory) return false;
    }

    // 10. 골디의 부동산명함(28): 대출 보유자에게만 등장 (미보유자는 선택풀 제외, 피라의 명함만 노출)
    if (card.id === CARD_IDS.GOLDIE_REALTY) {
        const hasDebt = typeof player.getTotalLoanDebt === 'function'
            ? player.getTotalLoanDebt() > 0
            : ((player.loanPrincipal || 0) + (player.loanInterestPrincipal || 0) + (player.loanInterest || 0)) > 0;
        if (!hasDebt) return false;
    }

    return true;
}

// 조건에 맞는 덱 필터링 후 1장 뽑기
export function drawDimensionCard(ctx, extraExcludeIds = new Set(), batchExtraTreasures = 0) {
    const fullDeck = getCardDeck();
    const usedIds = getUsedCardIds();
    const heldIds = getCurrentlyHeldCardIds(ctx.allPlayers || [ctx.player]);

    // 이미 뽑혔거나 보유 중인 카드 + 등장 조건 미충족 카드 제외
    const combinedExcludes = new Set([...usedIds, ...heldIds, ...extraExcludeIds]);
    fullDeck.forEach(c => {
        if (!isCardEligible(c, ctx)) {
            combinedExcludes.add(c.id);
        }
    });

    // 만약 일반 카드조차 모두 소진되었다면 자동 리셔플(뒤집어버리기와 동일하게 보유·보물 카드 제외)
    const remainingNormals = fullDeck.filter(c => c.id < 100 && !combinedExcludes.has(c.id));
    if (remainingNormals.length === 0) {
        reshuffleUsedCards(ctx.allPlayers || [ctx.player]);
        combinedExcludes.clear();
        getUsedCardIds().forEach(id => combinedExcludes.add(id));
        heldIds.forEach(id => combinedExcludes.add(id));
        extraExcludeIds.forEach(id => combinedExcludes.add(id));
        fullDeck.forEach(c => {
            if (!isCardEligible(c, ctx)) combinedExcludes.add(c.id);
        });
    }

    const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
    return OdysseyManager.drawDynamicCard(ctx.player, fullDeck, globalTurn, combinedExcludes, batchExtraTreasures, ctx);
}

// 여러 장 순차 동적 확률(남은 보물 상한 반영) + 중복 없이 뽑기 (마녀 도서관 능력 등)
export function drawDimensionCards(ctx, count = 3) {
    const picked = [];
    const excludeIds = new Set();
    const world = getActiveWorld();
    let batchExtraTreasures = 0;
    for (let i = 0; i < count; i++) {
        const card = drawDimensionCard(ctx, excludeIds, batchExtraTreasures);
        if (card) {
            if (excludeIds.has(card.id) && world?.metrics) {
                world.metrics.cardDuplicateAnomalies = (world.metrics.cardDuplicateAnomalies || 0) + 1;
            }
            picked.push(card);
            excludeIds.add(card.id);
            if (card.id >= 500) {
                batchExtraTreasures++;
            }
        }
    }
    return picked;
}

export function removeCardFromInventory(player, cardId) {
    const idx = player.inventory.findIndex(c => c.id === cardId);
    if (idx > -1) player.inventory.splice(idx, 1);
}

function recordDrawnCardStats(player, card, options = {}) {
    if (!card) return;
    const world = getActiveWorld();
    const grade = getCardGrade(card.id);

    if (player?.tracker?.gradeDraws) {
        player.tracker.gradeDraws[grade] = (player.tracker.gradeDraws[grade] || 0) + 1;
    }

    if (!world?.metrics) return;
    if (grade === 'treasure') {
        if (options.treasureSource === 'altar_portal') {
            world.metrics.drawnViaAltarPortalCount = (world.metrics.drawnViaAltarPortalCount || 0) + 1;
        } else {
            world.metrics.drawnViaProbTableCount = (world.metrics.drawnViaProbTableCount || 0) + 1;
        }
    }
    if (!world.metrics.gradeDrawCounts) {
        world.metrics.gradeDrawCounts = { normal: 0, special: 0, treasure: 0 };
    }
    world.metrics.gradeDrawCounts[grade] = (world.metrics.gradeDrawCounts[grade] || 0) + 1;

    if (!world.metrics.cardDrawHistogram) {
        world.metrics.cardDrawHistogram = {};
    }
    const key = String(card.id);
    if (!world.metrics.cardDrawHistogram[key]) {
        world.metrics.cardDrawHistogram[key] = {
            id: card.id,
            name: card.name,
            grade,
            count: 0
        };
    }
    world.metrics.cardDrawHistogram[key].count++;
}

// ==========================================
// 1. 카드 뽑기 시 등급별 실행자 호출 (발동/보유/보관/보물)
// ==========================================
export function executeCardEffect(ctx, card, onComplete = null, options = {}) {
    if (!card) {
        if (onComplete) onComplete();
        else if (ctx.proceedEndTurn) ctx.proceedEndTurn();
        return;
    }

    const world = getActiveWorld();
    if (world?.currentShoeDrawnIds) {
        if (world.currentShoeDrawnIds.has(card.id) && world.metrics) {
            world.metrics.cardDuplicateAnomalies = (world.metrics.cardDuplicateAnomalies || 0) + 1;
        }
        world.currentShoeDrawnIds.add(card.id);
    }

    getUsedCardIds().add(card.id);
    recordDrawnCardStats(ctx.player, card, options);

    // ctx에 뒤집어버리기 콜백 주입
    ctx.reshuffleUsedCards = () => reshuffleUsedCards(ctx.allPlayers);

    // 보물 카드 (500번대)
    if (card.id >= 500) {
        executeTreasureCard(ctx, card, onComplete);
        return;
    }

    // 특수 카드 (100번대, 200번대)
    if (card.id >= 100) {
        executeSpecialCard(ctx, card, onComplete);
        return;
    }

    // 일반 카드 (1 ~ 48)
    executeNormalCard(ctx, card, onComplete);
}

// ==========================================
// 2. 인벤토리/보물 액티브 카드 사용 가능 여부 판별 및 실행자 호출
// ==========================================
export function canUseActiveCard(card, ctx) {
    if (!card || !ctx || !ctx.player) return false;
    const p = ctx.player;
    const tiles = ctx.tiles || [];
    const allPlayers = ctx.allPlayers || [];

    switch (card.id) {
        case CARD_IDS.VIP_CARD:
            return !p.hasVipShield;
        case CARD_IDS.NER_ESCAPE:
            return p.islandTurns > 0;
        case CARD_IDS.LIBRARY_ASSIST:
            return !p.hasLibraryBuff;
        case CARD_IDS.BUILD_CONTRACT:
            return tiles.some(t => t.owner === p && t.type === 'normal' && t.level < 2);
        case CARD_IDS.UPGRADE_CONTRACT:
            return tiles.some(t => t.owner === p && t.type === 'normal' && (t.level === 1 || t.level === 2));
        case CARD_IDS.LANDMARK_CONTRACT:
            return tiles.some(t => t.owner === p && t.type === 'normal' && t.level === 3);
        case CARD_IDS.SIST_DEAL:
            return !p.hasSistDiscountBuff;
        case CARD_IDS.GOLDIE_PROPOSAL:
            return tiles.some(t => t.owner === p && t.type === 'normal');
        case CARD_IDS.MAYO_DEAL:
            return allPlayers.some(enemy =>
                enemy !== p && !enemy.isBankrupt &&
                tiles.some(t => t.owner === enemy && t.type === 'normal' && t.level < 4)
            );
        case CARD_IDS.MARI_SWITCH:
            return allPlayers.some(enemy =>
                enemy !== p && !enemy.isBankrupt &&
                tiles.some(t => t.owner === enemy && t.type === 'normal' && t.level >= 1)
            );
        case CARD_IDS.REVERSE_TIME:
            return tiles.some(t => t.owner === p && (t.timeType === 'day' || t.timeType === 'night'));
        case CARD_IDS.RUFO_DICE:
            return !p.hasRufoDiceBuff;
        case CARD_IDS.SPEC_TIME_ACCEL: {
            const activeType = WorldGimmickManager.getActiveGimmickType();
            return activeType === 'day' || activeType === 'night';
        }
        case CARD_IDS.TREASURE_SHROUD:
            return card.remainingUses > 0 && p.islandTurns === 0 && p.restTurns === 0;
        case CARD_IDS.TREASURE_ROPE:
            return card.remainingUses > 0 && allPlayers.some(enemy =>
                enemy !== p && !enemy.isBankrupt &&
                tiles.some(t => t.owner === enemy && t.type === 'normal')
            );
        case CARD_IDS.TREASURE_STAFF:
            return card.remainingUses > 0 && tiles.some(t => t.type === 'normal' && t.owner !== p);
        default:
            return true;
    }
}

export function getUsableCards(ctx) {
    if (!ctx || !ctx.player) return [];
    const p = ctx.player;
    const cText = getCardUIText();

    const usableInv = (p.inventory || []).filter(c => canUseActiveCard(c, ctx));
    const usableTreasures = (p.treasureCards || [])
        .filter(tc => tc.remainingUses > 0 && canUseActiveCard(tc, ctx))
        .map(tc => ({
            ...tc,
            name: `${tc.name} (${cText.TREASURE_USES_LEFT} ${tc.remainingUses})`
        }));

    return [...usableInv, ...usableTreasures];
}

export function useActiveCard(ctx, card, onComplete = null, onCancel = null) {
    if (!card) return;
    const p = ctx.player;

    const finalizeUse = () => {
        if (p.tracker) p.tracker.activeCardsUsed++;
        removeCardFromInventory(p, card.id);
        if (ctx.updateRender) ctx.updateRender();
        if (ctx.refreshUI) ctx.refreshUI();
        if (onComplete) onComplete(false);
    };

    const handleCancel = () => {
        RuntimePopup.closeAll();
        if (onCancel) onCancel();
    };

    // 보물 액티브 카드 (504 수의, 505 밧줄, 506 지팡이)
    if (card.id >= 500) {
        const realCard = p.treasureCards ? (p.treasureCards.find(tc => tc.id === card.id) || card) : card;
        useTreasureActiveCard(ctx, realCard, onComplete, handleCancel);
        return;
    }

    // 특수 사용형 카드 (110 시간가속)
    if (card.id >= 100) {
        useSpecialActiveCard(ctx, card, finalizeUse, handleCancel);
        return;
    }

    // 일반 사용형 카드 (36 ~ 48)
    useNormalActiveCard(ctx, card, finalizeUse, handleCancel);
}

// ==========================================
// 3. 언제든 호출 가능한 통합 카드 선택 및 발동 함수
// ==========================================
export function openPlayerCardSelector(ctx, onCardUsed = null, onCancel = null) {
    const p = ctx.player;
    const cText = getCardUIText();
    const usableCards = getUsableCards(ctx);

    if (usableCards.length === 0) {
        RuntimePopup.showToast(cText.INV_EMPTY, 2800, p.id);
        if (onCancel) onCancel();
        return;
    }

    const cancelAction = () => {
        RuntimePopup.closeAll();
        if (onCancel) onCancel();
    };

    if (ctx.turnTimer) {
        ctx.turnTimer.start(getPlayerThinkTime(p), cancelAction);
    }

    RuntimePopup.showInventoryPopup(
        usableCards,
        (selectedCard) => {
            // 보물 카드인 경우 원본 인스턴스 참조 전달
            const targetCard = selectedCard.id >= 500
                ? p.treasureCards.find(tc => tc.id === selectedCard.id)
                : selectedCard;
            useActiveCard(ctx, targetCard, onCardUsed, onCancel);
        },
        cancelAction
    );
}
