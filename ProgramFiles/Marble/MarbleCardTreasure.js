// ProgramFiles/Marble/MarbleCardTreasure.js
import {
    RuntimePopup,
    formatMoney,
    getTileName,
    scheduleGameTask,
    getCardUIText
} from './MarbleRuntime.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { getDrawnTreasures } from './MarbleOdyssey.js';
import { checkAndTriggerClimax } from './MarbleRequiem.js';
import { getTileFullInvestedValue, getStartPassBonus } from './MarbleCardNormal.js';
import { AIManager } from './MarbleAI.js';

// ==========================================
// 보물 카드 다수 보유 시 부작용 상쇄 매핑 (기획서 36p)
// - 왕관(501) 보유 -> 지팡이(506) 부작용 제거
// - 활(502) 보유   -> 검(503) 부작용 제거
// - 검(503) 보유   -> 밧줄(505) 부작용 제거
// - 수의(504) 보유 -> 왕관(501) 부작용 제거
// - 밧줄(505) 보유 -> 수의(504) 부작용 제거
// - 지팡이(506) 보유 -> 활(502) 부작용 제거
// ==========================================
export const DEBUFF_CANCELED_BY_MAP = {
    [CARD_IDS.TREASURE_CROWN]: CARD_IDS.TREASURE_SHROUD, // 왕관(501)의 부작용은 수의(504) 보유 시 상쇄
    [CARD_IDS.TREASURE_BOW]: CARD_IDS.TREASURE_STAFF,    // 활(502)의 부작용은 지팡이(506) 보유 시 상쇄
    [CARD_IDS.TREASURE_SWORD]: CARD_IDS.TREASURE_BOW,    // 검(503)의 부작용은 활(502) 보유 시 상쇄
    [CARD_IDS.TREASURE_SHROUD]: CARD_IDS.TREASURE_ROPE,  // 수의(504)의 부작용은 밧줄(505) 보유 시 상쇄
    [CARD_IDS.TREASURE_ROPE]: CARD_IDS.TREASURE_SWORD,   // 밧줄(505)의 부작용은 검(503) 보유 시 상쇄
    [CARD_IDS.TREASURE_STAFF]: CARD_IDS.TREASURE_CROWN   // 지팡이(506)의 부작용은 왕관(501) 보유 시 상쇄
};

// 특정 보물 카드를 보유 중인지 확인
export function hasTreasure(player, cardId) {
    if (!player || !player.treasureCards) return false;
    return player.treasureCards.some(c => c.id === cardId);
}

// 특정 보물 카드의 부작용(디버프)이 현재 유효한지 확인 (상쇄 보물 보유 시 false)
export function isTreasureDebuffActive(player, cardId) {
    if (!hasTreasure(player, cardId)) return false;
    const cancelerId = DEBUFF_CANCELED_BY_MAP[cardId];
    if (cancelerId && hasTreasure(player, cancelerId)) return false;
    return true;
}

// 아직 세상에 등장하지 않은 보물 카드 목록 반환
export function getAvailableTreasureCards(allTreasureCards) {
    return allTreasureCards.filter(c => !getDrawnTreasures().has(c.id));
}

// ==========================================
// 1. 보물 카드 획득 및 강탈 처리
// ==========================================
export function acquireTreasureCard(ctx, card) {
    const { player, turnManager } = ctx;
    getDrawnTreasures().add(card.id);

    const treasureInstance = {
        ...card,
        remainingUses: typeof card.maxUses === 'number' ? card.maxUses : 0
    };
    player.treasureCards.push(treasureInstance);

    if (player.firstTreasureTurn === -1 && turnManager) {
        player.firstTreasureTurn = turnManager.globalTurn;
    }

    // 활(502) 획득 즉시 이번 턴 주사위 2회 굴림 플래그 반영
    if (card.id === CARD_IDS.TREASURE_BOW) {
        player.bowExtraRollAvailable = true;
    }

    const cText = getCardUIText();
    RuntimePopup.showToast(`[${card.name}] ${cText.TREASURE_OBTAIN}`, 3000);
    if (ctx.refreshUI) ctx.refreshUI();

    // 6장 모두 등장했는지 검사하여 그을음 발동
    checkAndTriggerClimax(ctx);
}

export function stealTreasureCardFromPlayer(ctx, thief, victim) {
    if (!victim || !victim.treasureCards || victim.treasureCards.length === 0) return null;
    const randIdx = Math.floor(Math.random() * victim.treasureCards.length);
    const [stolenCard] = victim.treasureCards.splice(randIdx, 1);
    thief.treasureCards.push(stolenCard);

    if (thief.firstTreasureTurn === -1 && ctx.turnManager) {
        thief.firstTreasureTurn = ctx.turnManager.globalTurn;
    }
    if (stolenCard.id === CARD_IDS.TREASURE_BOW) {
        thief.bowExtraRollAvailable = true;
    }
    return stolenCard;
}

export function executeTreasureCard(ctx, card, onComplete = null) {
    const finish = onComplete || ctx.proceedEndTurn;
    acquireTreasureCard(ctx, card);
    scheduleGameTask(finish, 1500);
}

// ==========================================
// 2. 보물 카드 지속 버프 / 디버프(부작용) 헬퍼 함수
// ==========================================

// [501: ???의 왕관] 부작용: 고민 시간 0.5배 감소 (수의(504) 보유 시 상쇄)
export function getPlayerThinkTime(player) {
    const baseTime = GAME_CONSTANTS.THINK_TIME;
    if (isTreasureDebuffActive(player, CARD_IDS.TREASURE_CROWN)) {
        return Math.max(1, Math.floor(baseTime * 0.5));
    }
    return baseTime;
}

// 턴 시작 시 보물 카드 효과 처리:
// - [501: ???의 왕관] 버프: 매 턴 15만 달러 획득
// - [506: ???의 지팡이] 부작용: 매 턴 15만 달러 지불 (왕관(501) 보유 시 상쇄)
// - [502: ???의 활] 버프: 매 턴 주사위 2번 굴림 가능 초기화
export function processTreasureTurnStart(player) {
    if (!player || player.isBankrupt) return;
    const cText = getCardUIText();

    if (hasTreasure(player, CARD_IDS.TREASURE_CROWN)) {
        player.money += 150000;
        RuntimePopup.showToast(cText.TREASURE_CROWN_TURN, 2000);
    }

    if (isTreasureDebuffActive(player, CARD_IDS.TREASURE_STAFF)) {
        player.payMoney(150000, null);
        RuntimePopup.showToast(cText.TREASURE_STAFF_TURN, 2000);
    }

    player.bowExtraRollAvailable = hasTreasure(player, CARD_IDS.TREASURE_BOW);
}

// [503: ???가 담긴 검] 부작용: 주사위가 2개에서 1개로 줄어듦 (활(502) 보유 시 상쇄)
export function getPlayerDiceCount(player) {
    if (isTreasureDebuffActive(player, CARD_IDS.TREASURE_SWORD)) {
        return 1;
    }
    return 2;
}

// [503: ???가 담긴 검] 버프: 영토 매입비와 건설비가 0.8배로 하락
export function getTreasurePurchaseMultiplier(player) {
    if (hasTreasure(player, CARD_IDS.TREASURE_SWORD)) {
        return 0.8;
    }
    return 1.0;
}

// [502: ???의 활] 부작용: 영토 구매 시 무조건 마을(2단계)까지 건설 강제 (지팡이(506) 보유 시 상쇄)
export function isBowVillageForced(player) {
    return isTreasureDebuffActive(player, CARD_IDS.TREASURE_BOW);
}

// 통행료 산출 시 보물 카드 부작용 증감치:
// - [505: ???의 밧줄] 부작용: 내 영토 통행료 0.8배 하락 (-0.2) (검(503) 보유 시 상쇄)
// - [504: ???의 수의] 부작용: 지불해야 하는 통행료 1.2배 증가 (+0.2) (밧줄(505) 보유 시 상쇄)
export function getTreasureTollMultiplierDelta(tile, payer) {
    let delta = 0;
    if (tile && tile.owner && isTreasureDebuffActive(tile.owner, CARD_IDS.TREASURE_ROPE)) {
        delta -= 0.2;
    }
    if (payer && isTreasureDebuffActive(payer, CARD_IDS.TREASURE_SHROUD)) {
        delta += 0.2;
    }
    return delta;
}

// ==========================================
// 3. 보물 카드 액티브 능력 실행기 (504 수의 / 505 밧줄 / 506 지팡이)
// ==========================================
export function useTreasureActiveCard(ctx, treasureCard, onComplete = null, onCancel = null) {
    const p = ctx.player;
    const cText = getCardUIText();
    const cancelTarget = () => {
        if (onCancel) onCancel();
        else RuntimePopup.closeAll();
    };
    const resetTargetTimer = () => {
        if (ctx.turnTimer) {
            ctx.turnTimer.start(getPlayerThinkTime(p), cancelTarget);
        }
    };

    if (!treasureCard || treasureCard.remainingUses <= 0) {
        RuntimePopup.showToast(cText.CANT_USE_NOW, 2000);
        cancelTarget();
        return;
    }

    switch (treasureCard.id) {
        // [504] ???의 수의: 플레이 동안 3회에 한해 1칸부터 6칸까지 원하는 수치만큼 이동
        case CARD_IDS.TREASURE_SHROUD: {
            if (p.isAi()) {
                if (ctx.turnTimer) ctx.turnTimer.stop();
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                const step = AIManager.decideRelativeMoveCard(p, [1, 2, 3, 4, 5, 6], ctx.tiles, ctx.allPlayers, globalTurn);
                treasureCard.remainingUses--;
                if (onComplete) onComplete(true);

                const oldPos = p.pos;
                p.pos = (p.pos + step) % 40;
                if (oldPos + step >= 40) {
                    const startBonus = getStartPassBonus(p);
                    p.money += startBonus;
                    RuntimePopup.showToast(`${cText.MOVE_START_BONUS} (+${formatMoney(startBonus)})`, 2000);
                }
                ctx.updateRender();
                ctx.refreshUI();
                scheduleGameTask(() => ctx.handleTileArrival(p), 1000);
                return;
            }
            resetTargetTimer();
            const btnConfigs = [1, 2, 3, 4, 5, 6].map(step => ({
                text: `${cText.MOVE_FORWARD_PREFIX}${step}${cText.MOVE_SPACE_SUFFIX}`,
                color: '#2ecc71',
                action: () => {
                    if (ctx.turnTimer) ctx.turnTimer.stop();
                    RuntimePopup.closeAll();
                    treasureCard.remainingUses--;
                    if (onComplete) onComplete(true); // 즉시 이동했으므로 주사위 굴리기 페이즈 재진입 대신 칸 도착 처리로 진행

                    const oldPos = p.pos;
                    p.pos = (p.pos + step) % 40;
                    if (oldPos + step >= 40) {
                        const startBonus = getStartPassBonus(p);
                        p.money += startBonus;
                        RuntimePopup.showToast(`${cText.MOVE_START_BONUS} (+${formatMoney(startBonus)})`, 2000);
                    }
                    ctx.updateRender();
                    ctx.refreshUI();
                    scheduleGameTask(() => ctx.handleTileArrival(p), 1000);
                }
            }));
            RuntimePopup.showChoicePopup(cText.TREASURE_SHROUD_TITLE, cText.TREASURE_SHROUD_DESC, btnConfigs);
            break;
        }

        // [505] ???의 밧줄: 플레이 동안 1회에 한해 상대를 골라 해당 상대의 원하는 영토(일반 칸)를 강제 매각 (1.0배 지급)
        case CARD_IDS.TREASURE_ROPE: {
            const validEnemies = ctx.allPlayers.filter(enemy =>
                enemy !== p && !enemy.isBankrupt &&
                ctx.tiles.some(t => t.owner === enemy && t.type === 'normal')
            );
            if (validEnemies.length === 0) {
                RuntimePopup.showToast(cText.CANT_USE_NOW, 2000);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const targetTile = AIManager.selectRopeTargetTile(p, ctx.tiles, ctx.allPlayers);
                if (targetTile && targetTile.owner) {
                    const targetEnemy = targetTile.owner;
                    const forcedSellAmount = getTileFullInvestedValue(targetTile);
                    targetEnemy.money += forcedSellAmount;
                    targetEnemy.territoryCount--;
                    targetTile.owner = null;
                    targetTile.level = -1;

                    treasureCard.remainingUses--;
                    ctx.updateRender();
                    ctx.refreshUI();
                    if (onComplete) onComplete(false);
                    RuntimePopup.showToast(`${cText.TREASURE_ROPE_DONE} ${getTileName(targetTile)}`, 2500);
                } else {
                    cancelTarget();
                }
                return;
            }
            resetTargetTimer();
            const enemyTargets = validEnemies.map(e => ({ id: e.id, name: e.name, color: e.color }));
            RuntimePopup.showTargetPopup(cText.TREASURE_ROPE_ENEMY_TITLE, cText.TREASURE_ROPE_ENEMY_DESC, enemyTargets, (enemyId) => {
                const targetEnemy = ctx.allPlayers.find(e => e.id === enemyId);
                const enemyTiles = ctx.tiles.filter(t => t.owner === targetEnemy && t.type === 'normal');
                const tileTargets = enemyTiles.map(t => {
                    const refund = getTileFullInvestedValue(t);
                    return { id: t.id, name: `${getTileName(t)} (${formatMoney(refund)})`, color: targetEnemy.color };
                });
                resetTargetTimer();
                RuntimePopup.showTargetPopup(cText.TREASURE_ROPE_ENEMY_TITLE, cText.TREASURE_ROPE_TILE_DESC, tileTargets, (tileId) => {
                    const targetTile = ctx.tiles[tileId];
                    const forcedSellAmount = getTileFullInvestedValue(targetTile); // 강제 매각: 매입가 + 건설비 1.0배 지급
                    targetEnemy.money += forcedSellAmount;
                    targetEnemy.territoryCount--;
                    targetTile.owner = null;
                    targetTile.level = -1;

                    treasureCard.remainingUses--;
                    RuntimePopup.closeAll();
                    ctx.updateRender();
                    ctx.refreshUI();
                    if (onComplete) onComplete(false);
                    RuntimePopup.showToast(`${cText.TREASURE_ROPE_DONE} ${getTileName(targetTile)}`, 2500);
                }, cancelTarget);
            }, cancelTarget);
            break;
        }

        // [506] ???의 지팡이: 플레이 동안 1회에 한해 특수 칸을 제외한 원하는 영토를 대가 없이 뺏어옴
        case CARD_IDS.TREASURE_STAFF: {
            const enemyNormalTiles = ctx.tiles.filter(t => t.type === 'normal' && t.owner && t.owner !== p);
            const selectableTiles = enemyNormalTiles.length > 0
                ? enemyNormalTiles
                : ctx.tiles.filter(t => t.type === 'normal' && t.owner !== p);

            if (selectableTiles.length === 0) {
                RuntimePopup.showToast(cText.CANT_USE_NOW, 2000);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const targetTile = AIManager.selectStaffTargetTile(p, ctx.tiles);
                if (targetTile) {
                    if (targetTile.owner) {
                        targetTile.owner.territoryCount--;
                    } else {
                        targetTile.level = 0;
                    }
                    targetTile.owner = p;
                    p.territoryCount++;

                    treasureCard.remainingUses--;
                    ctx.updateRender();
                    ctx.refreshUI();
                    if (onComplete) onComplete(false);
                    RuntimePopup.showToast(`${cText.TREASURE_STAFF_DONE} ${getTileName(targetTile)}`, 2500);
                } else {
                    cancelTarget();
                }
                return;
            }
            resetTargetTimer();
            const tileTargets = selectableTiles.map(t => ({
                id: t.id,
                name: t.owner ? `${getTileName(t)} (${t.owner.name})` : getTileName(t),
                color: t.owner ? t.owner.color : '#2c3e50'
            }));
            RuntimePopup.showTargetPopup(cText.TREASURE_STAFF_TILE_TITLE, cText.TREASURE_STAFF_TILE_DESC, tileTargets, (tileId) => {
                const targetTile = ctx.tiles[tileId];
                if (targetTile.owner) {
                    targetTile.owner.territoryCount--;
                } else {
                    targetTile.level = 0;
                }
                targetTile.owner = p;
                p.territoryCount++;

                treasureCard.remainingUses--;
                RuntimePopup.closeAll();
                ctx.updateRender();
                ctx.refreshUI();
                if (onComplete) onComplete(false);
                RuntimePopup.showToast(`${cText.TREASURE_STAFF_DONE} ${getTileName(targetTile)}`, 2500);
            }, cancelTarget);
            break;
        }
    }
}
