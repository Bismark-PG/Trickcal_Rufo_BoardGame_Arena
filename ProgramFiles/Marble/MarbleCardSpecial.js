// ProgramFiles/Marble/MarbleCardSpecial.js
import {
    RuntimePopup,
    formatMoney,
    getTileName,
    scheduleGameTask,
    getCardUIText,
    getGimmickText
} from './MarbleRuntime.js';
import { CARD_IDS, treasureCards } from '../System/Index/Marble/MarbleCardIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import { checkAndDestroyRank2Privilege, getStartPassBonus } from './MarbleCardNormal.js';
import { acquireTreasureCard, stealTreasureCardFromPlayer, getAvailableTreasureCards } from './MarbleCardTreasure.js';
import { AIManager } from './MarbleAI.js';

// ==========================================
// 1. 특수 카드 (100번대 & 200번대) 발동/보유/저장 실행기
// ==========================================
export function executeSpecialCard(ctx, card, onComplete = null) {
    const p = ctx.player;
    const uiText = getCardUIText();
    const gText = getGimmickText();
    const finish = onComplete || ctx.proceedEndTurn;

    switch (card.actionType) {
        // [101] 밑장빼기: 다음번 뽑을 차원 이동 카드가 2장이 됨
        case "spec_double_draw": {
            p.nextCardDoubleDraw = true;
            RuntimePopup.showToast(uiText.SPEC_DOUBLE_DRAW_TOAST, 2500);
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [102] 뒤집어버리기: 사용된 모든 차원 이동 카드를 다시 덱에 넣고 섞음 (보유 중인 카드 제외)
        case "spec_shuffle": {
            if (ctx.reshuffleUsedCards) {
                ctx.reshuffleUsedCards();
            }
            RuntimePopup.showToast(uiText.SPEC_SHUFFLE_TOAST, 2500);
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [103] 서열싸움: 다야의 궁전을 보유자로부터 뺏어오거나 미보유 시 확정 보유
        case "spec_take_daya": {
            const dayaTile = ctx.tiles[BOARD_TILES.DAYA];
            if (dayaTile.owner !== p) {
                dayaTile.owner = p;
                dayaTile.level = 0;
            }
            if (p.recordDayaHoldTurn) {
                p.recordDayaHoldTurn(ctx.turnManager ? ctx.turnManager.globalTurn : null);
            }
            // 서열 2위의 특권(32) 보유 중이었다면 소유자가 되었으므로 파괴
            checkAndDestroyRank2Privilege(p, ctx.tiles);
            ctx.updateRender();
            ctx.refreshUI();
            RuntimePopup.showToast(uiText.SPEC_TAKE_DAYA_TOAST, 2500);
            scheduleGameTask(finish, 1800);
            break;
        }

        // [104] 에르핀의 주사위: 주사위 중 한 개가 에르핀 주사위로 변화
        case "spec_erpin_dice": {
            p.hasErpinDiceBuff = true;
            RuntimePopup.showToast(uiText.ERPIN_DICE_USE || gText.ERPIN_DICE_TITLE, 2500);
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [105] 빵주 난입: 현재 위치에서 아무런 조건 없이 원하는 칸으로 이동 (단, 차원 열쇠 카드 칸 제외)
        case "spec_bbangju_intrude": {
            const validTiles = ctx.tiles.filter(t => t.type !== 'card' && t.id !== p.pos);
            const moveToTarget = (targetId) => {
                if ((targetId < p.pos || targetId === BOARD_TILES.START) && targetId !== p.pos) {
                    const startBonus = getStartPassBonus(p);
                    if (startBonus > 0) {
                        p.money += startBonus;
                        RuntimePopup.showToast(`${uiText.MOVE_START_BONUS} (+${formatMoney(startBonus)})`, 2000);
                    }
                }
                p.pos = targetId;
                ctx.updateRender();
                ctx.refreshUI();
                scheduleGameTask(() => ctx.handleTileArrival(p), 1000);
            };

            if (p.isAi()) {
                const destId = AIManager.decidePortalDestination({ player: p, tiles: ctx.tiles, allPlayers: ctx.allPlayers, turnManager: ctx.turnManager }, true);
                const fallbackId = validTiles[Math.floor(Math.random() * validTiles.length)].id;
                const chosenId = (destId !== -1 && validTiles.some(t => t.id === destId)) ? destId : fallbackId;
                moveToTarget(chosenId);
            } else {
                ctx.turnTimer.start(GAME_CONSTANTS.THINK_TIME, () => {
                    RuntimePopup.closeAll();
                    moveToTarget(BOARD_TILES.START);
                });
                const targetItems = validTiles.map(t => ({
                    id: t.id,
                    name: getTileName(t),
                    color: t.type === 'normal' ? '#2c3e50' : '#8e44ad'
                }));
                RuntimePopup.showTargetPopup(uiText.SPEC_INTRUDE_TITLE, uiText.SPEC_INTRUDE_DESC, targetItems, (tileId) => {
                    ctx.turnTimer.stop();
                    RuntimePopup.closeAll();
                    moveToTarget(tileId);
                }, () => {
                    ctx.turnTimer.stop();
                    RuntimePopup.closeAll();
                    finish();
                });
            }
            break;
        }

        // [106 ~ 109] 특수 보유형 카드 (두번째 기회, VVVIP카드, 달바라기 한 송이, 암거래상의 증표)
        case "hold_second_chance":
        case "hold_vvvip":
        case "hold_moon_double":
        case "hold_start_buff": {
            if (!p.buffs[card.actionType]) p.buffs[card.actionType] = [];
            p.buffs[card.actionType].push(card);
            RuntimePopup.showToast(`[${card.name}] ${uiText.CARD_BUFF_APPLIED}`, 2000);
            ctx.refreshUI();
            scheduleGameTask(finish, 1500);
            break;
        }

        // [110] 시간가속: 시간대가 진행 중이면 즉시 남은 턴 2턴 단축 + 즉시 추가 1회 굴림 + 남은 현재 시간대 동안 주사위 2회 굴림, 아니면 인벤토리 보관 후 시간대 진행 시 사용
        case "spec_time_accel": {
            const activeType = WorldGimmickManager.getActiveGimmickType();
            if (activeType === 'day' || activeType === 'night') {
                WorldGimmickManager.accelerateTime(2);
                p.timeAccelBuffPhase = activeType;
                p.timeAccelExtraRollAvailable = true;
                ctx.refreshUI();
                RuntimePopup.showToast(uiText.SPEC_TIME_ACCEL_TOAST, 2500);
                scheduleGameTask(finish, 1800);
            } else {
                p.inventory.push(card);
                RuntimePopup.showToast(`[${card.name}] ${uiText.CARD_STORED}`, 2000);
                ctx.refreshUI();
                scheduleGameTask(finish, 1500);
            }
            break;
        }

        // [111] 오디세이아: 보물 카드를 확정적으로 1장 획득
        case "spec_get_treasure": {
            const avail = getAvailableTreasureCards(treasureCards);
            if (!p.hasVisitedAltar || avail.length === 0) {
                RuntimePopup.showToast(uiText.SPEC_ODYSSEY_FAIL, 2000);
                scheduleGameTask(finish, 1500);
                return;
            }
            const pickedTreasure = avail[Math.floor(Math.random() * avail.length)];
            acquireTreasureCard(ctx, pickedTreasure);
            scheduleGameTask(finish, 1800);
            break;
        }

        // [112] 애증의 늑대: 보물 카드를 소유한 플레이어에게서 보물 카드 1개 강탈
        case "spec_steal_treasure": {
            const holders = ctx.allPlayers.filter(other => other !== p && !other.isBankrupt && other.treasureCards.length > 0);
            if (holders.length === 0) {
                RuntimePopup.showToast(uiText.CANT_USE_NOW, 2000);
                scheduleGameTask(finish, 1500);
                return;
            }
            const executeSteal = (targetPlayer) => {
                const stolen = stealTreasureCardFromPlayer(ctx, p, targetPlayer);
                if (stolen) {
                    RuntimePopup.showToast(`${uiText.SPEC_WOLF_DONE} [${stolen.name}]`, 2500);
                }
                ctx.refreshUI();
                scheduleGameTask(finish, 1800);
            };

            if (p.isAi()) {
                const targetHolder = AIManager.decideWolfTarget(p, holders, ctx.allPlayers, ctx.tiles) || holders[0];
                executeSteal(targetHolder);
            } else if (holders.length === 1) {
                executeSteal(holders[0]);
            } else {
                ctx.turnTimer.start(GAME_CONSTANTS.THINK_TIME, () => {
                    RuntimePopup.closeAll();
                    executeSteal(holders[0]);
                });
                const targets = holders.map(h => ({
                    id: h.id,
                    name: `${h.name} (${h.treasureCards.length})`,
                    color: h.color
                }));
                RuntimePopup.showTargetPopup(uiText.SPEC_WOLF_TITLE, uiText.SPEC_WOLF_DESC, targets, (enemyId) => {
                    ctx.turnTimer.stop();
                    RuntimePopup.closeAll();
                    const targetEnemy = holders.find(h => h.id === enemyId) || holders[0];
                    executeSteal(targetEnemy);
                }, () => {
                    ctx.turnTimer.stop();
                    RuntimePopup.closeAll();
                    executeSteal(holders[0]);
                });
            }
            break;
        }

        // [113] 심판의 시간 / [114] 교주의 염원: 그을음 -> 빛무리 변화 + 몽환살이/염원살이 획득 + 주사위 추가 1회 굴림
        case "spec_judgment":
        case "spec_wish": {
            const isJudgment = card.id === CARD_IDS.SPEC_JUDGMENT;
            if (isJudgment) {
                p.hasDreamState = true;
            } else {
                p.hasWishState = true;
            }
            if (WorldGimmickManager.triggerHaloByCard) {
                WorldGimmickManager.triggerHaloByCard(ctx.allPlayers, p, isJudgment ? 'dream' : 'wish');
            }
            RuntimePopup.showToast(isJudgment ? uiText.SPEC_JUDGMENT_TOAST : uiText.SPEC_WISH_TOAST, 3000);
            ctx.updateRender();
            ctx.refreshUI();
            scheduleGameTask(() => {
                if (ctx.setWaitingAction) ctx.setWaitingAction(false);
                ctx.executeRoll();
            }, 1800);
            break;
        }

        // [201] 퍼리비이치 개장 (정령 호수 소유자 전용)
        case "spec_furry_open": {
            if (ctx.tiles[BOARD_TILES.LAKE].owner === p) {
                WorldGimmickManager.isFurryBeach = true;
                RuntimePopup.showToast(gText.FURRY_OPEN, 2500);
            } else {
                RuntimePopup.showToast(gText.CARD_INVALID_NOT_OWNER, 2000);
            }
            ctx.updateRender();
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [202] 코미주스 한잔해 (퍼리비이치 입장료 1.5배 상승)
        case "spec_komi_juice": {
            WorldGimmickManager.furryBeachFeeMultiplier = 1.5;
            RuntimePopup.showToast(gText.KOMI_JUICE, 2500);
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [203] 디아나의 꿀밤 (퍼리비이치 -> 정령 호수 복구, 비소유자 전용)
        case "spec_diana": {
            if (ctx.tiles[BOARD_TILES.LAKE].owner !== p) {
                WorldGimmickManager.isFurryBeach = false;
                WorldGimmickManager.furryBeachFeeMultiplier = 1.0;
                RuntimePopup.showToast(gText.DIANA_PUNCH, 2500);
            } else {
                RuntimePopup.showToast(gText.CARD_INVALID_OWNER, 2000);
            }
            ctx.updateRender();
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [204] 김씨노동기 (퍼리비이치 강제 휴식 면제 보유)
        case "hold_worker": {
            if (!p.buffs['hold_worker']) p.buffs['hold_worker'] = [];
            p.buffs['hold_worker'].push(card);
            RuntimePopup.showToast(`[${card.name}] ${uiText.CARD_BUFF_APPLIED}`, 2000);
            ctx.refreshUI();
            scheduleGameTask(finish, 1500);
            break;
        }

        // [205] 잊혀진 기억 (정령산 정상 효과를 받지 않음, 정령산 정상 방문 시 '되찾은 기억'으로 변화)
        case "hold_forget": {
            if (!p.buffs['hold_forget']) p.buffs['hold_forget'] = [];
            p.buffs['hold_forget'].push(card);
            if (!p.hasOriginElif) {
                p.hasMountainBuff = false;
            }
            RuntimePopup.showToast(`[${card.name}] ${uiText.CARD_BUFF_APPLIED}`, 2000);
            ctx.refreshUI();
            scheduleGameTask(finish, 1500);
            break;
        }

        // [206] 태초의 엘리프 (정령산 정상 효과를 대가 지불 없이 영구 고정 소유)
        case "hold_origin": {
            if (!p.buffs['hold_origin']) p.buffs['hold_origin'] = [];
            p.buffs['hold_origin'].push(card);
            ctx.allPlayers.forEach(other => {
                if (other !== p) other.hasMountainBuff = false;
            });
            p.hasMountainBuff = true;
            p.hasOriginElif = true;
            if (p.recordMountainBuffTurn) {
                p.recordMountainBuffTurn(ctx.turnManager ? ctx.turnManager.globalTurn : null);
            }
            RuntimePopup.showToast(uiText.ORIGIN_ELIF_ACQUIRED, 2500);
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }
    }
}

// ==========================================
// 2. 특수 사용형 카드 실행기 (ID: 110 시간가속)
// ==========================================
export function useSpecialActiveCard(ctx, card, finalizeUse, onCancel = null) {
    const uiText = getCardUIText();
    const activeType = WorldGimmickManager.getActiveGimmickType();

    if (card.id === CARD_IDS.SPEC_TIME_ACCEL) {
        if (activeType !== 'day' && activeType !== 'night') {
            RuntimePopup.showToast(uiText.SPEC_TIME_ACCEL_FAIL, 2000);
            if (onCancel) onCancel();
            return;
        }
        WorldGimmickManager.accelerateTime(2);
        if (ctx.player) {
            ctx.player.timeAccelBuffPhase = activeType;
            ctx.player.timeAccelExtraRollAvailable = true;
        }
        RuntimePopup.closeAll();
        finalizeUse();
        RuntimePopup.showToast(uiText.SPEC_TIME_ACCEL_TOAST, 2500);
    }
}
