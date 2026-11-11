import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import {
    RuntimePopup,
    getTileName,
    formatMoney,
    scheduleGameTask,
    getMarbleText,
    getCardUIText,
    getGimmickText
} from './MarbleRuntime.js';
import { applySpecialTileTollModifiers } from './MarbleLogic.js';
import { drawDimensionCard, drawDimensionCards, executeCardEffect, removeCardFromInventory } from './MarbleCard.js';
import { getPlayerThinkTime } from './MarbleCardTreasure.js';
import { getStartPassBonus } from './MarbleCardNormal.js';
import { AIManager } from './MarbleAI.js';
import { getAltarTradedCards } from './MarbleOdyssey.js';
import { addBbangjuVisit } from './MarbleEconomy.js';
import { RequiemState, canPlayerUseBbangju, getPositiveEffectMultiplier } from './MarbleRequiem.js';
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';

export const BoardGimmickHandlers = {
    // ||=================그을음 관련=================||
    // 11: 망가진 제단
    [BOARD_TILES.ALTAR]: (ctx) => {
        const { player, proceedEndTurn, turnTimer, refreshUI } = ctx;
        const gText = getGimmickText();
        const thinkTime = getPlayerThinkTime(player);

        // 1. 최초 방문 시 보물 확률 개방 트리거
        if (!player.hasVisitedAltar) {
            player.hasVisitedAltar = true;
            RuntimePopup.showToast(gText.ALTAR_VISIT, 3000);
        }

        // 2. 보유한 보물 카드가 있다면 개당 100만 골드 교환 제안
        if (player.treasureCards.length > 0) {
            const sellCount = player.treasureCards.length;
            const reward = sellCount * GAME_CONSTANTS.ALTAR_REWARD;

            if (player.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                if (AIManager.decideAltarTrade(player, ctx.allPlayers, globalTurn)) {
                    player.money += reward;
                    getAltarTradedCards().push(...player.treasureCards);
                    player.treasureCards = [];
                    RuntimePopup.showToast(`${gText.ALTAR_AI_TRADE} (+${formatMoney(reward)})`, 2500);
                }
                refreshUI(); scheduleGameTask(proceedEndTurn, 1500);
            } else {
                turnTimer.start(thinkTime);
                RuntimePopup.showChoicePopup(gText.ALTAR_TITLE, gText.ALTAR_TRADE_Q, [
                    { text: gText.ALTAR_BTN_ALL, color: '#f1c40f', action: () => {
                        player.money += reward;
                        getAltarTradedCards().push(...player.treasureCards);
                        player.treasureCards = [];
                        RuntimePopup.closeAll();
                        RuntimePopup.showToast(`${gText.ALTAR_TRADE_DONE} (+${formatMoney(reward)})`, 2500);
                        refreshUI(); proceedEndTurn();
                    }},
                    { text: gText.ALTAR_BTN_REJECT, color: '#e74c3c', action: proceedEndTurn }
                ]);
            }
        } else {
            scheduleGameTask(proceedEndTurn, 1500);
        }
    },

    // ||=================특수칸=================||
    // 10: 볼케니카
    [BOARD_TILES.VOLCANICA]: (ctx) => {
        const text = getMarbleText();
        ctx.player.islandTurns = 2;
        ctx.turnTimer.start(getPlayerThinkTime(ctx.player));
        RuntimePopup.showNormalPopup(text.VOLCANICA_TITLE, text.VOLCANICA_DESC, true, ctx.proceedEndTurn);
    },

    // 20: 정령산 정상
    [BOARD_TILES.MOUNTAIN]: (ctx) => {
        const text = getMarbleText();
        const cText = getCardUIText();
        const p = ctx.player;

        // [205: 잊혀진 기억] 보유자가 정령산 정상 방문 시 '되찾은 기억'으로 변화 (기획서 16p, 35p)
        const forgetArr = p.buffs['hold_forget'] || p.buffs['todo_hold_forget'];
        if (forgetArr && forgetArr.length > 0 && !p.hasRecoveredMemory) {
            p.hasRecoveredMemory = true;
            forgetArr.forEach(card => { card.name = "되찾은 기억"; });
            RuntimePopup.showToast(cText.FORGOTTEN_TO_RECOVERED, 3000);
        }

        // 잊혀진 기억 보유자는 정령산 정상의 효과를 받지 않음
        if (forgetArr && forgetArr.length > 0 && !p.hasOriginElif) {
            scheduleGameTask(ctx.proceedEndTurn, 1500);
            return;
        }

        // 다른 플레이어가 [206: 태초의 엘리프]로 정령산 효과를 고정 소유 중이거나, 이미 본인이 보유 중이면 종료
        const originHolder = ctx.allPlayers.find(op => op.hasOriginElif && !op.isBankrupt);
        if (originHolder || p.hasMountainBuff) {
            scheduleGameTask(ctx.proceedEndTurn, 1000);
            return;
        }

        if (p.isAi()) {
            const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
            if (AIManager.decideMountainBuy(p, ctx.allPlayers, ctx.tiles, globalTurn) && p.money >= GAME_CONSTANTS.MOUNTAIN_FEE) {
                ctx.allPlayers.forEach(op => op.hasMountainBuff = false);
                p.hasMountainBuff = true;
                p.money -= GAME_CONSTANTS.MOUNTAIN_FEE;
                p.recordMountainBuffTurn(ctx.turnManager ? ctx.turnManager.globalTurn : null);
                ctx.refreshUI();
            }
            scheduleGameTask(ctx.proceedEndTurn, 1000);
            return;
        }

        ctx.turnTimer.start(getPlayerThinkTime(p));
        RuntimePopup.showChoicePopup(text.MOUNTAIN_TITLE, text.MOUNTAIN_DESC, [
            { text: text.BTN_YES, color: '#3498db', action: () => {
                if (p.money >= GAME_CONSTANTS.MOUNTAIN_FEE) {
                    ctx.allPlayers.forEach(op => op.hasMountainBuff = false);
                    p.hasMountainBuff = true;
                    p.money -= GAME_CONSTANTS.MOUNTAIN_FEE;
                    p.recordMountainBuffTurn(ctx.turnManager ? ctx.turnManager.globalTurn : null);
                    ctx.refreshUI();
                } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                ctx.proceedEndTurn();
            }},
            { text: text.BTN_NO, color: '#e74c3c', action: ctx.proceedEndTurn }
        ]);
    },

    // 30: 빵주 (1~3턴: 빵주 정비소 / 4턴~: 빵주)
    [BOARD_TILES.BBANGJU]: (ctx) => {
        const gText = getGimmickText();
        const text = getMarbleText();
        const cText = getCardUIText();
        const thinkTime = getPlayerThinkTime(ctx.player);

        // 1~3턴: 빵주 정비소 기간
        if (ctx.turnManager.globalTurn < 4) {
            if (WorldGimmickManager.bbangjuState === 'recruiting' && ctx.player.isAi()) {
                const isSupporter = ctx.player.bbangjuPaidTotal > 0;
                const reqTakeoverCost = isSupporter
                    ? (GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE - ctx.player.bbangjuPaidTotal)
                    : GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE;
                if (AIManager.decideBbangjuTakeover(ctx.player, reqTakeoverCost)) {
                    ctx.player.money -= reqTakeoverCost;
                    WorldGimmickManager.bbangjuState = 'occupied';
                    ctx.player.isBbangjuChief = true;
                    WorldGimmickManager.bbangjuChiefs = [ctx.player];
                    ctx.allPlayers.forEach(p => { p.bbangjuSupportTurns = 0; });
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BBANGJU_TAKEOVER}`, 3000);
                    ctx.updateRender(); ctx.refreshUI();
                    scheduleGameTask(ctx.proceedEndTurn, 1500);
                    return;
                }
                scheduleGameTask(ctx.proceedEndTurn, 1000);
                return;
            }
            if (WorldGimmickManager.bbangjuState === 'recruiting' && !ctx.player.isAi()) {
                const isSupporter = ctx.player.bbangjuPaidTotal > 0;
                const reqTakeoverCost = isSupporter
                    ? (GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE - ctx.player.bbangjuPaidTotal)
                    : GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE;
                const descText = `${isSupporter ? gText.BBANGJU_TAKE_DESC_DISCOUNT : gText.BBANGJU_TAKE_DESC_FULL}\n\n${gText.BBANGJU_TAKE_COST_LABEL} ${formatMoney(reqTakeoverCost)}`;

                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showChoicePopup(gText.BBANGJU_TAKE_TITLE, descText, [
                    { text: `${gText.BTN_ACCEPT} (${formatMoney(reqTakeoverCost)})`, color: '#2ecc71', action: () => {
                        if (ctx.player.money >= reqTakeoverCost) {
                            ctx.turnTimer.stop();
                            ctx.player.money -= reqTakeoverCost;
                            WorldGimmickManager.bbangjuState = 'occupied';
                            ctx.player.isBbangjuChief = true;
                            WorldGimmickManager.bbangjuChiefs = [ctx.player];
                            ctx.allPlayers.forEach(p => { p.bbangjuSupportTurns = 0; });
                            RuntimePopup.closeAll();
                            RuntimePopup.showToast(`${ctx.player.name} ${gText.BBANGJU_ANNOUNCE}`, 3000);
                            ctx.updateRender(); ctx.refreshUI();
                            scheduleGameTask(ctx.proceedEndTurn, 2000);
                        } else {
                            RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                            RuntimePopup.closeAll(); ctx.proceedEndTurn();
                        }
                    }},
                    { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
                ]);
            } else {
                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showNormalPopup(getTileName(ctx.tile), gText.BBANGJU_CLOSED, true, ctx.proceedEndTurn);
            }
        } else {
            // 4턴 이후: 그을음 기간이거나 [후회]/[죄업] 상태일 때 빵주 이용 불가 (기획서 24~27p)
            if (!canPlayerUseBbangju(ctx.player)) {
                RuntimePopup.showToast(RequiemState.isSootState ? gText.BBANGJU_BLOCKED_SOOT : gText.BBANGJU_BLOCKED_STATE, 2500);
                scheduleGameTask(ctx.proceedEndTurn, 1800);
                return;
            }

            // 4턴 이후: 빵주 가동
            let targetChiefs = WorldGimmickManager.bbangjuChiefs;
            const isFree = ctx.player.isBbangjuChief;
            if (targetChiefs.length === 4) targetChiefs = [];

            // [31: 빵주 연구원] 보유 시 기본 이용료(10만) 면제, 단 정비반장 추가 요금(20만)은 지불 (기획서 33p)
            const hasResearcherBuff = (ctx.player.buffs['hold_bbangju'] && ctx.player.buffs['hold_bbangju'].length > 0) ||
                                      (ctx.player.buffs['todo_hold_bbangju'] && ctx.player.buffs['todo_hold_bbangju'].length > 0);
            const baseFee = (isFree || hasResearcherBuff) ? 0 : GAME_CONSTANTS.BBANGJU_BASE_FEE;
            const chiefFee = (!isFree && targetChiefs.length > 0) ? GAME_CONSTANTS.BBANGJU_CHIEF_FEE : 0;
            const reqMoney = baseFee + chiefFee;

            if (ctx.player.isAi()) {
                const targetId = AIManager.decidePortalDestination(ctx);
                if (targetId !== -1 && targetId !== BOARD_TILES.BBANGJU && ctx.player.money >= reqMoney) {
                    ctx.player.money -= reqMoney;
                    if (!isFree && targetChiefs.length > 0) targetChiefs.forEach(c => c.money += GAME_CONSTANTS.BBANGJU_DIVIDE[targetChiefs.length]);
                    addBbangjuVisit();
                    ctx.player.tracker.bbangjuUsageCount++;
                    if (targetId < ctx.player.pos || targetId === BOARD_TILES.START) {
                        const startBonus = getStartPassBonus(ctx.player);
                        if (startBonus > 0) {
                            ctx.player.money += startBonus;
                            RuntimePopup.showToast(text.TOAST_START, 2000);
                        }
                    }
                    ctx.player.pos = targetId; ctx.updateRender(); ctx.refreshUI();
                    scheduleGameTask(() => ctx.handleTileArrival(ctx.player), 1000);
                } else scheduleGameTask(ctx.proceedEndTurn, 1000);
            } else {
                if (hasResearcherBuff && !isFree) {
                    RuntimePopup.showToast(cText.BBANGJU_IMMUNE_APPLIED, 2000);
                }
                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showPortalPopup(ctx.tiles, (targetId) => {
                    if (ctx.player.money >= reqMoney) {
                        ctx.turnTimer.stop();
                        ctx.player.money -= reqMoney;
                        if (!isFree && targetChiefs.length > 0) targetChiefs.forEach(c => c.money += GAME_CONSTANTS.BBANGJU_DIVIDE[targetChiefs.length]);
                        addBbangjuVisit();
                        ctx.player.tracker.bbangjuUsageCount++;
                        RuntimePopup.closeAll();
                        if (targetId < ctx.player.pos || targetId === BOARD_TILES.START) {
                            const startBonus = getStartPassBonus(ctx.player);
                            if (startBonus > 0) {
                                ctx.player.money += startBonus;
                                RuntimePopup.showToast(text.TOAST_START, 2000);
                            }
                        }
                        ctx.player.pos = targetId; ctx.updateRender(); ctx.refreshUI();
                        scheduleGameTask(() => ctx.handleTileArrival(ctx.player), 800);
                    } else {
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                        RuntimePopup.closeAll(); ctx.proceedEndTurn();
                    }
                }, ctx.proceedEndTurn, reqMoney, reqMoney === 0);
            }
        }
    },

    // ||=================구매 가능 특수 칸=================||
    // 5: 엘리아스 극장
    [BOARD_TILES.THEATER]: (ctx) => {
        const gText = getGimmickText();
        const text = getMarbleText();
        const tileName = getTileName(ctx.tile);
        const thinkTime = getPlayerThinkTime(ctx.player);
        const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;

        if (!ctx.tile.owner && ctx.player.isAi()) {
            const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles);
            if (action === 'buy' && ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.THEATER_BUY)) {
                RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 2000);
                ctx.updateRender(); ctx.refreshUI();
            }
            scheduleGameTask(ctx.proceedEndTurn, 1200);
            return;
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player && ctx.player.isAi()) {
            const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles);
            if (action === 'takeover' && ctx.player.money >= GAME_CONSTANTS.THEATER_TAKE) {
                const prevOwner = ctx.tile.owner;
                if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.THEATER_TAKE)) {
                    prevOwner.money += GAME_CONSTANTS.THEATER_TAKE;
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_TAKE_SPECIAL} ${tileName}`, 2000);
                    ctx.updateRender(); ctx.refreshUI();
                }
            }
            scheduleGameTask(ctx.proceedEndTurn, 1200);
            return;
        }

        if (!ctx.tile.owner && !ctx.player.isAi()) {
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(tileName, `${formatMoney(GAME_CONSTANTS.THEATER_BUY)}${gText.ASK_BUY}`, [
                { text: gText.BTN_ACCEPT, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.THEATER_BUY)) {
                        ctx.updateRender(); ctx.refreshUI();
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player && !ctx.player.isAi()) {
            if (ctx.player.money < GAME_CONSTANTS.THEATER_TAKE) {
                ctx.proceedEndTurn();
                return;
            }
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(tileName, `${formatMoney(GAME_CONSTANTS.THEATER_TAKE)}${gText.ASK_TAKE}`, [
                { text: `${gText.BTN_TAKE} (${formatMoney(GAME_CONSTANTS.THEATER_TAKE)})`, color: '#9b59b6', action: () => {
                    const prevOwner = ctx.tile.owner;
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.THEATER_TAKE)) {
                        prevOwner.money += GAME_CONSTANTS.THEATER_TAKE;
                        ctx.updateRender(); ctx.refreshUI();
                    }
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else ctx.proceedEndTurn();
    },

    // 15: 모나티엄 25
    [BOARD_TILES.MONATIUM_25]: (ctx) => {
        const gText = getGimmickText();
        const text = getMarbleText();
        const tileName = getTileName(ctx.tile);
        const thinkTime = getPlayerThinkTime(ctx.player);
        const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
        ctx.player.tracker.monatium25Visits++;

        if (ctx.player.isAi()) {
            if (!ctx.tile.owner) {
                const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles);
                if (action === 'buy' && ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.MONATIUM_BUY)) {
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 2000);
                    ctx.updateRender(); ctx.refreshUI();
                }
                scheduleGameTask(ctx.proceedEndTurn, 1200);
                return;
            } else if (ctx.tile.owner === ctx.player && ctx.tile.level < 2) {
                const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles);
                const expCost = ctx.tile.level === 0 ? GAME_CONSTANTS.MONATIUM_EXPAND_1 : GAME_CONSTANTS.MONATIUM_EXPAND_2;
                if (action === 'expand' && ctx.player.money >= expCost) {
                    ctx.player.money -= expCost;
                    ctx.tile.level++;
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_EXPAND_MONATIUM}`, 2000);
                    ctx.updateRender(); ctx.refreshUI();
                }
                scheduleGameTask(ctx.proceedEndTurn, 1200);
                return;
            } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player) {
                ctx.handleTollPayment(ctx.player, ctx.tile);
                return;
            }
            scheduleGameTask(ctx.proceedEndTurn, 1000);
            return;
        }

        if (!ctx.tile.owner && !ctx.player.isAi()) {
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(tileName, `${formatMoney(GAME_CONSTANTS.MONATIUM_BUY)}${gText.ASK_BUY}`, [
                { text: gText.BTN_ACCEPT, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.MONATIUM_BUY)) {
                        ctx.updateRender(); ctx.refreshUI();
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner === ctx.player && ctx.tile.level < 2 && !ctx.player.isAi()) {
            const expCost = ctx.tile.level === 0 ? GAME_CONSTANTS.MONATIUM_EXPAND_1 : GAME_CONSTANTS.MONATIUM_EXPAND_2;
            if (ctx.player.money < expCost) {
                ctx.proceedEndTurn();
                return;
            }
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(`${tileName} 확장`, `${formatMoney(expCost)}${gText.ASK_EXPAND}`, [
                { text: `${gText.BTN_EXPAND} (${formatMoney(expCost)})`, color: '#f39c12', action: () => {
                    if (ctx.player.money >= expCost) {
                        ctx.player.money -= expCost;
                        ctx.tile.level++;
                        ctx.updateRender(); ctx.refreshUI();
                    }
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player) {
            ctx.handleTollPayment(ctx.player, ctx.tile);
        } else ctx.proceedEndTurn();
    },

    // 25: 정령호수 / 퍼리비이치
    [BOARD_TILES.LAKE]: (ctx) => {
        const gText = getGimmickText();
        const text = getMarbleText();
        const tileName = getTileName(ctx.tile);
        const thinkTime = getPlayerThinkTime(ctx.player);

        // 퍼리비이치 상태일 때의 로직
        if (WorldGimmickManager.isFurryBeach) {
            ctx.player.tracker.furryBeachVisits++;
            if (ctx.tile.owner === ctx.player) {
                RuntimePopup.showToast(gText.FURRY_MY_REST, 2000);
                scheduleGameTask(ctx.proceedEndTurn, 1500);
            } else {
                // 타인 도착 시: 소유자 제외 전원 1턴 강제 휴식 (더블 탈출 가능)
                ctx.allPlayers.forEach(other => {
                    const hasWorkerBuff = (other.buffs['hold_worker'] && other.buffs['hold_worker'].length > 0) ||
                                          (other.buffs['todo_hold_worker'] && other.buffs['todo_hold_worker'].length > 0);
                    if (other !== ctx.tile.owner && !hasWorkerBuff && !other.isBankrupt) {
                        other.islandTurns = 1;
                        other.tracker.lakeRestCount++;
                    }
                });

                RuntimePopup.showToast(gText.FURRY_REST_OTHERS, 3000);

                // 입장료 50만 * 코미주스 배율 지불 (VVVIP카드 보유 시 0.8배 적용)
                const rawFee = Math.round(GAME_CONSTANTS.FURRY_BEACH_FEE * WorldGimmickManager.furryBeachFeeMultiplier);
                const fee = applySpecialTileTollModifiers(rawFee, ctx.tile, ctx.player);
                const actualPaid = ctx.player.payMoney(fee, ctx.tile.owner);

                if (actualPaid < fee) RuntimePopup.showToast(gText.FURRY_PAID_ALL, 2500);
                else RuntimePopup.showToast(`${gText.FURRY_PAID} (${formatMoney(fee)})`, 2500);

                ctx.refreshUI(); scheduleGameTask(ctx.proceedEndTurn, 3000);
            }
            return;
        }

        if (!ctx.tile.owner && ctx.player.isAi()) {
            const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
            const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles);
            if (action === 'buy' && ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.LAKE_BUY)) {
                RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 2000);
                ctx.updateRender(); ctx.refreshUI();
            }
            scheduleGameTask(ctx.proceedEndTurn, 1200);
            return;
        }

        if (!ctx.tile.owner && !ctx.player.isAi()) {
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(tileName, `${formatMoney(GAME_CONSTANTS.LAKE_BUY)}${gText.ASK_BUY}`, [
                { text: gText.BTN_ACCEPT, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.LAKE_BUY)) {
                        ctx.updateRender(); ctx.refreshUI();
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player) {
            const rollFee = applySpecialTileTollModifiers(GAME_CONSTANTS.LAKE_ROLL_FEE, ctx.tile, ctx.player);
            const summonFee = applySpecialTileTollModifiers(GAME_CONSTANTS.LAKE_SUMMON_FEE, ctx.tile, ctx.player);

            if (ctx.player.isAi()) {
                const aiDecision = AIManager.decideLakeAction(ctx);
                if (aiDecision.action === 'rest') {
                    ctx.player.restTurns = 1;
                    ctx.player.tracker.lakeRestCount++;
                } else if (aiDecision.action === 'roll') {
                    ctx.player.money -= rollFee;
                    ctx.tile.owner.money += rollFee;
                    ctx.refreshUI();
                    if (ctx.setWaitingAction) ctx.setWaitingAction(false);
                    ctx.executeRoll(); return;
                } else if (aiDecision.action === 'summon' && aiDecision.target) {
                    ctx.player.money -= summonFee;
                    ctx.tile.owner.money += summonFee;
                    aiDecision.target.pos = BOARD_TILES.LAKE;
                    aiDecision.target.restTurns = 1;
                    ctx.player.tracker.lakeRestCount++;
                    ctx.updateRender(); ctx.refreshUI();
                }
                scheduleGameTask(ctx.proceedEndTurn, 1000);
                return;
            }

            ctx.turnTimer.start(thinkTime, () => {
                RuntimePopup.closeAll();
                ctx.player.restTurns = 1;
                ctx.player.tracker.lakeRestCount++;
                ctx.proceedEndTurn();
            });
            RuntimePopup.showChoicePopup(text.LAKE_TITLE, text.LAKE_DESC, [
                { text: text.LAKE_BTN_REST, color: '#3498db', action: () => {
                    ctx.turnTimer.stop();
                    ctx.player.restTurns = 1;
                    ctx.player.tracker.lakeRestCount++;
                    ctx.proceedEndTurn();
                }},
                { text: text.LAKE_BTN_ROLL, color: '#e67e22', action: () => {
                    if (ctx.player.money >= rollFee) {
                        ctx.turnTimer.stop();
                        RuntimePopup.closeAll();
                        ctx.player.money -= rollFee;
                        ctx.tile.owner.money += rollFee;
                        ctx.refreshUI();
                        if (ctx.setWaitingAction) ctx.setWaitingAction(false);
                        ctx.executeRoll();
                    } else {
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                    }
                }},
                { text: text.LAKE_BTN_SUMMON, color: '#9b59b6', action: () => {
                    if (ctx.player.money >= summonFee) {
                        const targets = ctx.allPlayers.filter(p => p !== ctx.player && !p.isBankrupt);
                        if (targets.length === 0) {
                            ctx.proceedEndTurn();
                            return;
                        }
                        const executeSummon = (targetPlayer) => {
                            ctx.turnTimer.stop();
                            RuntimePopup.closeAll();
                            ctx.player.money -= summonFee;
                            ctx.tile.owner.money += summonFee;
                            targetPlayer.pos = BOARD_TILES.LAKE;
                            targetPlayer.restTurns = 1;
                            ctx.player.tracker.lakeRestCount++;
                            ctx.updateRender(); ctx.refreshUI();
                            RuntimePopup.showToast(`${targetPlayer.name}${gText.LAKE_SUMMON_DONE}`, 2500);
                            scheduleGameTask(ctx.proceedEndTurn, 1500);
                        };
                        ctx.turnTimer.start(thinkTime, () => executeSummon(ctx.tile.owner));
                        const targetBtns = targets.map(t => ({
                            text: t.name,
                            color: t.color,
                            action: () => executeSummon(t)
                        }));
                        RuntimePopup.showChoicePopup(gText.LAKE_SUMMON_TITLE, gText.LAKE_SUMMON_DESC, targetBtns);
                    } else {
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                    }
                }}
            ]);
        } else ctx.proceedEndTurn();
    },

    // 28: 셰이디의 차원
    [BOARD_TILES.VOID]: (ctx) => {
        const cText = getCardUIText();
        const thinkTime = getPlayerThinkTime(ctx.player);

        const hasRim = (ctx.player.buffs['hold_shaydi'] && ctx.player.buffs['hold_shaydi'].length > 0) ||
                       (ctx.player.buffs['todo_hold_shaydi'] && ctx.player.buffs['todo_hold_shaydi'].length > 0);
        const hasBigEvent = (ctx.player.buffs['hold_event'] && ctx.player.buffs['hold_event'].length > 0) ||
                            (ctx.player.buffs['todo_hold_event'] && ctx.player.buffs['todo_hold_event'].length > 0);

        const applyRest = (targetPlayer, showPopup, customMsg = null) => {
            targetPlayer.restTurns = 1;
            if (showPopup) RuntimePopup.showNormalPopup(cText.SHAYDI_TITLE, customMsg || cText.SHAYDI_DESC, true, ctx.proceedEndTurn);
            else RuntimePopup.showToast(`${targetPlayer.name} ${cText.SHAYDI_PULLED}`, 3000);
        };

        if (hasBigEvent) {
            const targets = ctx.allPlayers.filter(p => p !== ctx.player && !p.isBankrupt);
            const executePull = (target) => {
                target.pos = BOARD_TILES.VOID;
                ctx.updateRender(); ctx.refreshUI();
                applyRest(target, false);

                if (hasRim) {
                    scheduleGameTask(() => { RuntimePopup.showToast(cText.SHAYDI_EVADE, 2500); scheduleGameTask(ctx.proceedEndTurn, 2000); }, 1000);
                } else {
                    scheduleGameTask(() => applyRest(ctx.player, true), 1000);
                }
            };

            if (ctx.player.isAi() || targets.length === 0) {
                if (targets.length > 0) {
                    const picked = AIManager.decideShaydiTarget(ctx.player, targets, ctx.allPlayers, ctx.tiles) || targets[0];
                    executePull(picked);
                } else {
                    ctx.proceedEndTurn();
                }
            } else {
                ctx.turnTimer.start(thinkTime, () => executePull(targets[0]));
                const btnConfigs = targets.map(t => ({ text: t.name, color: t.color, action: () => { ctx.turnTimer.stop(); RuntimePopup.closeAll(); executePull(t); } }));
                RuntimePopup.showChoicePopup(cText.SHAYDI_TARGET_TITLE, cText.SHAYDI_TARGET_DESC, btnConfigs);
            }
        } else if (hasRim) {
            RuntimePopup.showToast(cText.SHAYDI_EVADE, 2500); scheduleGameTask(ctx.proceedEndTurn, 2000);
        } else {
            ctx.turnTimer.start(thinkTime); applyRest(ctx.player, true);
        }
    },

    // 32: 마녀 도서관
    [BOARD_TILES.LIBRARY]: (ctx) => {
        const gText = getGimmickText();
        const text = getMarbleText();
        const cText = getCardUIText();
        const tileName = getTileName(ctx.tile);
        const thinkTime = getPlayerThinkTime(ctx.player);

        if (!ctx.tile.owner && ctx.player.isAi()) {
            const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
            const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles);
            if (action === 'buy' && ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.LIBRARY_BUY)) {
                RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 2000);
                ctx.updateRender(); ctx.refreshUI();
            }
            scheduleGameTask(ctx.proceedEndTurn, 1200);
            return;
        }

        if (!ctx.tile.owner && !ctx.player.isAi()) {
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(tileName, `${formatMoney(GAME_CONSTANTS.LIBRARY_BUY)}${gText.ASK_BUY}`, [
                { text: gText.BTN_ACCEPT, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.LIBRARY_BUY)) {
                        ctx.updateRender(); ctx.refreshUI();
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player) {
            if (ctx.player.hasLibraryBuff) {
                RuntimePopup.showToast(gText.LIBRARY_ALREADY_HAS, 2500);
                scheduleGameTask(ctx.proceedEndTurn, 1500);
                return;
            }

            if (ctx.player.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles, 'ability');
                if (action === 'use_assist') {
                    removeCardFromInventory(ctx.player, CARD_IDS.LIBRARY_ASSIST);
                    ctx.player.hasLibraryBuff = true;
                    RuntimePopup.showToast(`${ctx.player.name} - ${cText.USE_LIBRARY_DONE}`, 2000);
                    ctx.refreshUI();
                    scheduleGameTask(ctx.proceedEndTurn, 1500);
                } else if (action === 'buy_ability') {
                    const libraryToll = applySpecialTileTollModifiers(GAME_CONSTANTS.TOLL_LIBRARY, ctx.tile, ctx.player);
                    if (ctx.player.money >= libraryToll) {
                        ctx.player.money -= libraryToll;
                        ctx.tile.owner.money += libraryToll;
                        ctx.player.hasLibraryBuff = true;
                        RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_LIBRARY_ABILITY}`, 2000);
                        ctx.refreshUI();
                        scheduleGameTask(ctx.proceedEndTurn, 1500);
                        return;
                    }
                    ctx.proceedEndTurn();
                } else {
                    ctx.proceedEndTurn();
                }
                return;
            }

            // [38: 셰럼의 일일조교] 보유 시 통행료 지불 없이 도서관 능력 획득 선택 가능
            const hasAssistCard = ctx.player.inventory.some(c => c.id === CARD_IDS.LIBRARY_ASSIST);
            if (hasAssistCard) {
                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showChoicePopup(cText.USE_LIBRARY_TITLE, cText.USE_LIBRARY_DESC, [
                    { text: text.BTN_USE, color: '#2ecc71', action: () => {
                        ctx.turnTimer.stop();
                        RuntimePopup.closeAll();
                        removeCardFromInventory(ctx.player, CARD_IDS.LIBRARY_ASSIST);
                        ctx.player.hasLibraryBuff = true;
                        ctx.refreshUI();
                        RuntimePopup.showToast(cText.USE_LIBRARY_DONE, 2500);
                        scheduleGameTask(ctx.proceedEndTurn, 1500);
                    }},
                    { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
                ]);
                return;
            }

            const libraryToll = applySpecialTileTollModifiers(GAME_CONSTANTS.TOLL_LIBRARY, ctx.tile, ctx.player);
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(gText.LIBRARY_ABILITY_TITLE, gText.LIBRARY_ABILITY_DESC, [
                { text: `${gText.BTN_ACCEPT} (${formatMoney(libraryToll)})`, color: '#3498db', action: () => {
                    if (ctx.player.money >= libraryToll) {
                        ctx.turnTimer.stop();
                        RuntimePopup.closeAll();
                        ctx.player.money -= libraryToll;
                        ctx.tile.owner.money += libraryToll;
                        ctx.player.hasLibraryBuff = true;
                        ctx.refreshUI();
                        RuntimePopup.showToast(gText.LIBRARY_ABILITY_BOUGHT, 2500);
                        scheduleGameTask(ctx.proceedEndTurn, 1500);
                    } else {
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                        ctx.proceedEndTurn();
                    }
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else ctx.proceedEndTurn();
    },

    // 36: 다야의 궁전
    [BOARD_TILES.DAYA]: (ctx) => {
        const gText = getGimmickText();
        const text = getMarbleText();
        const tileName = getTileName(ctx.tile);
        const thinkTime = getPlayerThinkTime(ctx.player);

        if (!ctx.tile.owner && ctx.player.isAi()) {
            const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
            const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles);
            if (action === 'buy' && ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.DAYA_BUY)) {
                ctx.player.recordDayaHoldTurn(globalTurn);
                RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 2000);
                ctx.updateRender(); ctx.refreshUI();
            }
            scheduleGameTask(ctx.proceedEndTurn, 1200);
            return;
        }

        if (!ctx.tile.owner && !ctx.player.isAi()) {
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(tileName, `${formatMoney(GAME_CONSTANTS.DAYA_BUY)}${gText.ASK_BUY}`, [
                { text: gText.BTN_ACCEPT, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.DAYA_BUY)) {
                        ctx.player.recordDayaHoldTurn(ctx.turnManager ? ctx.turnManager.globalTurn : null);
                        ctx.updateRender(); ctx.refreshUI();
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000);
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player) {
            ctx.handleTollPayment(ctx.player, ctx.tile, () => {
                if (ctx.player.isBankrupt || ctx.player.money < GAME_CONSTANTS.DAYA_TAKE) {
                    ctx.proceedEndTurn();
                    return;
                }
                if (ctx.player.isAi()) {
                    const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                    const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles, 'takeover');
                    if (action === 'takeover') {
                        const prevOwner = ctx.tile.owner;
                        if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.DAYA_TAKE)) {
                            prevOwner.money += GAME_CONSTANTS.DAYA_TAKE;
                            ctx.player.recordDayaHoldTurn(globalTurn);
                            ctx.updateRender(); ctx.refreshUI();
                            RuntimePopup.showToast(`${ctx.player.name}${gText.AI_TAKE_SPECIAL} ${tileName}`, 2000);
                        }
                    }
                    scheduleGameTask(ctx.proceedEndTurn, 1200);
                    return;
                }
                if (ctx.setWaitingAction) ctx.setWaitingAction(true);
                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showChoicePopup(gText.DAYA_TAKE_TITLE, gText.DAYA_TAKE_DESC, [
                    { text: `${gText.BTN_TAKE} (${formatMoney(GAME_CONSTANTS.DAYA_TAKE)})`, color: '#9b59b6', action: () => {
                        const prevOwner = ctx.tile.owner;
                        if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.DAYA_TAKE)) {
                            prevOwner.money += GAME_CONSTANTS.DAYA_TAKE;
                            ctx.player.recordDayaHoldTurn(ctx.turnManager ? ctx.turnManager.globalTurn : null);
                            ctx.updateRender(); ctx.refreshUI();
                            RuntimePopup.showToast(gText.DAYA_TAKE_DONE, 2000);
                        }
                        ctx.proceedEndTurn();
                    }},
                    { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
                ]);
            });
        } else ctx.proceedEndTurn();
    },

    // 38: 달바라기 언덕
    [BOARD_TILES.MOON]: (ctx) => {
        const text = getMarbleText();
        ctx.player.tracker.moonHillVisits++;
        // [108: 달바라기 한 송이] 보유 시 지원금 2배 (50만 -> 100만), 빛무리 진행 시 긍정 효과 2배 적용
        const hasMoonDouble = (ctx.player.buffs['hold_moon_double'] && ctx.player.buffs['hold_moon_double'].length > 0) ||
                              (ctx.player.buffs['todo_hold_moon_double'] && ctx.player.buffs['todo_hold_moon_double'].length > 0);
        const baseBonus = hasMoonDouble ? GAME_CONSTANTS.MOON_BONUS * 2 : GAME_CONSTANTS.MOON_BONUS;
        const bonus = Math.round(baseBonus * getPositiveEffectMultiplier(ctx.player));
        ctx.player.money += bonus;
        ctx.refreshUI(); RuntimePopup.showToast(`${text.TOAST_MOON} (+${formatMoney(bonus)})`, 2500); scheduleGameTask(ctx.proceedEndTurn, 2000);
    },

    // [차원 열쇠 카드 로직]
    handleCardTile: (ctx) => {
        const cText = getCardUIText();
        const gText = getGimmickText();
        const thinkTime = getPlayerThinkTime(ctx.player);

        // 카드 칸 도착 횟수 집계 (밑장빼기 2장 뽑기나 도서관 3장 선택과 무관하게 도착 1회당 +1)
        ctx.player.tracker.cardsDrawn++;

        // [101: 밑장빼기] 발동 대기 상태라면 이번 카드 칸에서 2장 연속 뽑기
        const isDoubleDraw = ctx.player.nextCardDoubleDraw === true;
        if (isDoubleDraw) {
            ctx.player.nextCardDoubleDraw = false;
        }

        const processSingleDraw = (onDrawDone) => {
            const isLibraryOwner = ctx.tiles[BOARD_TILES.LIBRARY].owner === ctx.player;
            const useLibraryAbility = isLibraryOwner || ctx.player.hasLibraryBuff;

            if (useLibraryAbility && ctx.player.isAi()) {
                if (!isLibraryOwner) ctx.player.hasLibraryBuff = false;
                const cards = drawDimensionCards(ctx, 3);
                const chosen = AIManager.decideLibraryCardChoice(ctx.player, cards, ctx) || cards[0];
                executeCardEffect(ctx, chosen, onDrawDone);
                return;
            }

            if (useLibraryAbility && !ctx.player.isAi()) {
                if (!isLibraryOwner) ctx.player.hasLibraryBuff = false;
                const cards = drawDimensionCards(ctx, 3);
                ctx.turnTimer.start(thinkTime, () => {
                    RuntimePopup.closeAll();
                    executeCardEffect(ctx, cards[0], onDrawDone);
                });
                const btnConfigs = cards.map(c => ({
                    text: `[${c.name}]\n${c.desc}`,
                    color: '#8e44ad',
                    action: () => {
                        ctx.turnTimer.stop();
                        RuntimePopup.closeAll();
                        executeCardEffect(ctx, c, onDrawDone);
                    }
                }));
                RuntimePopup.showChoicePopup(gText.LIBRARY_CHOOSE_CARD_TITLE, gText.LIBRARY_CHOOSE_CARD_DESC, btnConfigs);
                return;
            }

            const card = drawDimensionCard(ctx);
            if (ctx.player.isAi()) {
                executeCardEffect(ctx, card, onDrawDone);
                return;
            }

            ctx.turnTimer.start(thinkTime, () => {
                RuntimePopup.closeAll();
                executeCardEffect(ctx, card, onDrawDone);
            });
            RuntimePopup.showChoicePopup(isDoubleDraw ? cText.CARD_DRAWN_DOUBLE : cText.CARD_DRAWN, `[${card.name}]\n\n${card.desc}`, [
                { text: cText.BTN_CONFIRM, color: '#3498db', action: () => {
                    ctx.turnTimer.stop();
                    RuntimePopup.closeAll();
                    executeCardEffect(ctx, card, onDrawDone);
                }}
            ]);
        };

        if (isDoubleDraw) {
            processSingleDraw(() => {
                processSingleDraw(ctx.proceedEndTurn);
            });
        } else {
            processSingleDraw(ctx.proceedEndTurn);
        }
    }
};
