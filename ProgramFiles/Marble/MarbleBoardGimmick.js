import { WorldGimmickManager, syncFurryBeachFeeMultiplier } from './MarbleWorldGimmick.js';
import {
    RuntimePopup,
    getTileName,
    formatMoney,
    scheduleGameTask,
    getActiveWorld,
    getMarbleText,
    getCardUIText,
    getGimmickText,
    getCardDeck
} from './MarbleRuntime.js';
import { applySpecialTileTollModifiers } from './MarbleLogic.js';
import { drawDimensionCard, drawDimensionCards, executeCardEffect, removeCardFromInventory } from './MarbleCard.js';
import { openFurryBeachState } from './MarbleCardSpecial.js';
import { getPlayerThinkTime } from './MarbleCardTreasure.js';
import { applyLapPassBonus } from './MarbleCardNormal.js';
import { AIManager } from './MarbleAI.js';
import { OdysseyManager, getAltarTradedCards } from './MarbleOdyssey.js';
import { addBbangjuVisit, handleTollPaymentProcess } from './MarbleEconomy.js';
import {
    RequiemState,
    canPlayerUseBbangju,
    getPositiveEffectMultiplier,
    recordHaloPositiveGain
} from './MarbleRequiem.js';
import { GAME_CONSTANTS, BUILDING_COSTS, MULTIPLIERS } from '../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES, CARD_TILE_IDS } from '../System/Index/Marble/MarbleBoardIndex.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';

function acquireMountainBuffWithMetrics(ctx, p) {
    const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
    ctx.allPlayers.forEach(op => { op.hasMountainBuff = false; });
    p.hasMountainBuff = true;
    p.money -= GAME_CONSTANTS.MOUNTAIN_FEE;
    p.recordMountainBuffTurn(globalTurn);

    const wm = getActiveWorld()?.metrics;
    if (wm) {
        wm.mountainBuyCount = (wm.mountainBuyCount || 0) + 1;
        wm.mountainInvestmentTotal = (wm.mountainInvestmentTotal || 0) + GAME_CONSTANTS.MOUNTAIN_FEE;
        wm.mountainExpectedGainSum -= GAME_CONSTANTS.MOUNTAIN_FEE;
    }
}

function recordNormalLakeRest(targetPlayer) {
    if (targetPlayer?.tracker) targetPlayer.tracker.lakeRestCount++;
    const wm = getActiveWorld()?.metrics;
    if (wm) wm.furryBaselineRestCount = (wm.furryBaselineRestCount || 0) + 1;
}

function recordLakeFirstOwnedTurn(ctx) {
    const wm = getActiveWorld()?.metrics;
    if (wm && wm.furryLakeOwnedFirstTurn === null) {
        wm.furryLakeOwnedFirstTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
    }
}

export const BoardGimmickHandlers = {
    // ||=================그을음 관련=================||
    // 11: 망가진 제단
    [BOARD_TILES.ALTAR]: (ctx) => {
        const { player, proceedEndTurn, turnTimer, refreshUI } = ctx;
        const gText = getGimmickText();
        const thinkTime = getPlayerThinkTime(player);
        const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
        const worldMetrics = getActiveWorld()?.metrics;

        player.altarVisitCount = (player.altarVisitCount || 0) + 1;
        if (worldMetrics) worldMetrics.altarVisitTotal = (worldMetrics.altarVisitTotal || 0) + 1;
        const isSecondOrMoreVisit = player.altarVisitCount >= 2;

        // 1. 최초 방문 시 보물 확률 개방 트리거
        if (!player.hasVisitedAltar) {
            player.hasVisitedAltar = true;
            if (worldMetrics) worldMetrics.altarFirstVisits++;
            RuntimePopup.showToast(`[${player.name}] ${gText.ALTAR_VISIT}`, 3400);
        }

        // 2회차 이상 방문 시 차원 열쇠 카드 칸 중 한 곳으로 이동하며 시계방향 알현실 통과 시 순회 보상 지급 (도착 시 보물 카드 확정 획득)
        const executeAltarTeleportMove = (targetId) => {
            if (worldMetrics) worldMetrics.altarPortalUses++;
            if ((targetId < player.pos || targetId === BOARD_TILES.START) && targetId !== player.pos) {
                applyLapPassBonus(player, { showBlockedToast: true });
            }
            player.pos = targetId;
            player._altarGuaranteedTreasure = true;
            RuntimePopup.showToast(`[${player.name}] ${gText.ALTAR_PORTAL_MOVE_TOAST}`, 3200);
            ctx.updateRender();
            refreshUI();
            scheduleGameTask(() => ctx.handleTileArrival(player), 1200);
        };

        const proceedAfterTrade = () => {
            if (!isSecondOrMoreVisit) {
                proceedEndTurn();
                return;
            }
            if (player.isAi()) {
                const pickedCardTileId = AIManager.decideAltarCardPortal(player, ctx.tiles, ctx.allPlayers, globalTurn);
                executeAltarTeleportMove(pickedCardTileId);
                return;
            }
            const cardTargets = CARD_TILE_IDS.map((tid) => {
                const tile = ctx.tiles[tid];
                const passesStart = (tid < player.pos || tid === BOARD_TILES.START) && tid !== player.pos;
                const rowTag = `${(tile ? tile.side : 0) + 1}열`;
                const suffix = passesStart ? gText.ALTAR_PORTAL_LAP_TAG : rowTag;
                return {
                    id: tid,
                    name: `${tid}번 · ${getTileName(tile)} (${suffix})`,
                    color: passesStart ? '#27ae60' : '#8e44ad'
                };
            });
            turnTimer.start(thinkTime, () => {
                RuntimePopup.closeAll();
                executeAltarTeleportMove(CARD_TILE_IDS[0]);
            });
            RuntimePopup.showTargetPopup(
                gText.ALTAR_PORTAL_TITLE,
                gText.ALTAR_PORTAL_DESC,
                cardTargets,
                (selectedId) => {
                    turnTimer.stop();
                    RuntimePopup.closeAll();
                    executeAltarTeleportMove(Number(selectedId));
                },
                null
            );
        };

        // 2. 보유한 보물 카드가 있다면 개당 100만 골드 교환 제안을 먼저 띄운 뒤 후속 처리
        if (player.treasureCards.length > 0) {
            const sellCount = player.treasureCards.length;
            const reward = sellCount * GAME_CONSTANTS.ALTAR_REWARD;

            if (player.isAi()) {
                if (AIManager.decideAltarTrade(player, ctx.allPlayers, globalTurn)) {
                    player.money += reward;
                    if (worldMetrics) {
                        worldMetrics.altarTradeCount++;
                        worldMetrics.altarTradeCardsTotal += sellCount;
                    }
                    if (player.tracker) {
                        player.tracker.altarTradeCount = (player.tracker.altarTradeCount || 0) + 1;
                        player.tracker.altarTradeCards = (player.tracker.altarTradeCards || 0) + sellCount;
                        player.tracker.altarTradeReward = (player.tracker.altarTradeReward || 0) + reward;
                    }
                    getAltarTradedCards().push(...player.treasureCards);
                    player.treasureCards = [];
                    player.bowExtraRollAvailable = false;
                    RuntimePopup.showToast(`[${player.name}] ${gText.ALTAR_AI_TRADE} (+${formatMoney(reward)})`, 3400);
                }
                refreshUI();
                scheduleGameTask(proceedAfterTrade, 1200);
            } else {
                turnTimer.start(thinkTime, () => {
                    RuntimePopup.closeAll();
                    proceedAfterTrade();
                });
                RuntimePopup.showChoicePopup(gText.ALTAR_TITLE, gText.ALTAR_TRADE_Q, [
                    { text: gText.ALTAR_BTN_ALL, color: '#f1c40f', action: () => {
                        turnTimer.stop();
                        player.money += reward;
                        if (worldMetrics) {
                            worldMetrics.altarTradeCount++;
                            worldMetrics.altarTradeCardsTotal += sellCount;
                        }
                        if (player.tracker) {
                            player.tracker.altarTradeCount = (player.tracker.altarTradeCount || 0) + 1;
                            player.tracker.altarTradeCards = (player.tracker.altarTradeCards || 0) + sellCount;
                            player.tracker.altarTradeReward = (player.tracker.altarTradeReward || 0) + reward;
                        }
                        getAltarTradedCards().push(...player.treasureCards);
                        player.treasureCards = [];
                        player.bowExtraRollAvailable = false;
                        RuntimePopup.closeAll();
                        RuntimePopup.showToast(`[${player.name}] ${gText.ALTAR_TRADE_DONE} (+${formatMoney(reward)})`, 3400);
                        refreshUI();
                        proceedAfterTrade();
                    }},
                    { text: gText.ALTAR_BTN_REJECT, color: '#e74c3c', action: () => {
                        turnTimer.stop();
                        RuntimePopup.closeAll();
                        proceedAfterTrade();
                    }}
                ]);
            }
        } else {
            scheduleGameTask(proceedAfterTrade, isSecondOrMoreVisit ? 1000 : 1500);
        }
    },

    // ||=================특수칸=================||
    // 10: 볼케니카
    [BOARD_TILES.VOLCANICA]: (ctx) => {
        const text = getMarbleText();
        ctx.player.islandTurns = 2;
        if (ctx.player.isAi()) {
            RuntimePopup.showToast(`[${ctx.player.name}] ${text.VOLCANICA_TITLE} - ${text.VOLCANICA_DESC}`, 3200);
            ctx.refreshUI();
            scheduleGameTask(ctx.proceedEndTurn, 2000);
            return;
        }
        ctx.turnTimer.start(Math.max(12, getPlayerThinkTime(ctx.player)));
        RuntimePopup.showNormalPopup(text.VOLCANICA_TITLE, text.VOLCANICA_DESC, true, ctx.proceedEndTurn);
    },

    // 20: 정령산 정상
    [BOARD_TILES.MOUNTAIN]: (ctx) => {
        const text = getMarbleText();
        const cText = getCardUIText();
        const p = ctx.player;
        if (p.tracker) p.tracker.mountainVisits = (p.tracker.mountainVisits || 0) + 1;

        // [205: 잊혀진 기억] 보유자가 정령산 정상 방문 시 '되찾은 기억'으로 변화 (기획서 16p, 35p)
        const forgetArr = p.buffs['hold_forget'] || p.buffs['todo_hold_forget'];
        if (forgetArr && forgetArr.length > 0 && !p.hasRecoveredMemory) {
            p.hasRecoveredMemory = true;
            forgetArr.forEach(card => { card.name = "되찾은 기억"; });
            const wmForget = getActiveWorld()?.metrics;
            if (wmForget) wmForget.forgottenRecoveredCount = (wmForget.forgottenRecoveredCount || 0) + 1;
            RuntimePopup.showToast(cText.FORGOTTEN_TO_RECOVERED, 3400, p.id);
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
                acquireMountainBuffWithMetrics(ctx, p);
                RuntimePopup.showToast(`[${p.name}] ${text.MOUNTAIN_TITLE}`, 3200);
                ctx.refreshUI();
            }
            scheduleGameTask(ctx.proceedEndTurn, 1200);
            return;
        }

        ctx.turnTimer.start(getPlayerThinkTime(p));
        RuntimePopup.showChoicePopup(text.MOUNTAIN_TITLE, text.MOUNTAIN_DESC, [
            { text: text.BTN_YES, color: '#3498db', action: () => {
                if (p.money >= GAME_CONSTANTS.MOUNTAIN_FEE) {
                    acquireMountainBuffWithMetrics(ctx, p);
                    RuntimePopup.showToast(`[${p.name}] ${text.MOUNTAIN_TITLE}`, 3200);
                    ctx.refreshUI();
                } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, p.id);
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
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BBANGJU_TAKEOVER}`, 3400);
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
                            RuntimePopup.showToast(`${ctx.player.name} ${gText.BBANGJU_ANNOUNCE}`, 3400);
                            ctx.updateRender(); ctx.refreshUI();
                            scheduleGameTask(ctx.proceedEndTurn, 2000);
                        } else {
                            RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                            RuntimePopup.closeAll(); ctx.proceedEndTurn();
                        }
                    }},
                    { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
                ]);
            } else if (ctx.player.isAi()) {
                RuntimePopup.showToast(`[${ctx.player.name}] ${getTileName(ctx.tile)} - ${gText.BBANGJU_CLOSED}`, 3000);
                scheduleGameTask(ctx.proceedEndTurn, 1800);
            } else {
                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showNormalPopup(getTileName(ctx.tile), gText.BBANGJU_CLOSED, true, ctx.proceedEndTurn);
            }
        } else {
            // 4턴 이후: 그을음 기간이거나 [후회]/[죄업] 상태일 때 빵주 이용 불가 (기획서 24~27p)
            if (!canPlayerUseBbangju(ctx.player)) {
                RuntimePopup.showToast(
                    `[${ctx.player.name}] ${RequiemState.isSootState ? gText.BBANGJU_BLOCKED_SOOT : gText.BBANGJU_BLOCKED_STATE}`,
                    3200
                );
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

            const executePortalJump = (targetId) => {
                ctx.player.money -= reqMoney;
                if (!isFree && targetChiefs.length > 0) {
                    targetChiefs.forEach(c => c.money += GAME_CONSTANTS.BBANGJU_DIVIDE[targetChiefs.length]);
                }
                addBbangjuVisit();
                ctx.player.tracker.bbangjuUsageCount++;
                if (targetId < ctx.player.pos || targetId === BOARD_TILES.START) {
                    applyLapPassBonus(ctx.player, { showBlockedToast: true });
                }
                ctx.player.pos = targetId;
                ctx.updateRender();
                ctx.refreshUI();
                scheduleGameTask(() => ctx.handleTileArrival(ctx.player), 1100);
            };

            if (ctx.player.isAi()) {
                const targetId = AIManager.decidePortalDestination(ctx);
                if (targetId !== -1 && targetId !== BOARD_TILES.BBANGJU && ctx.player.money >= reqMoney) {
                    executePortalJump(targetId);
                } else scheduleGameTask(ctx.proceedEndTurn, 1000);
            } else {
                if (hasResearcherBuff && !isFree) {
                    RuntimePopup.showToast(cText.BBANGJU_IMMUNE_APPLIED, 3000, ctx.player.id);
                }
                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showPortalPopup(ctx.tiles, (targetId) => {
                    if (ctx.player.money >= reqMoney) {
                        ctx.turnTimer.stop();
                        RuntimePopup.closeAll();
                        executePortalJump(targetId);
                    } else {
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
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
                RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 3200);
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
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_TAKE_SPECIAL} ${tileName}`, 3200);
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
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
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
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 3200);
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
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_EXPAND_MONATIUM}`, 3200);
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
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
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
                RuntimePopup.showToast(`[${ctx.player.name}] ${gText.FURRY_MY_REST}`, 3200);
                scheduleGameTask(ctx.proceedEndTurn, 1500);
            } else {
                // 타인 도착 시: 소유자 제외 전원 1턴 강제 휴식 (더블 탈출 가능)
                ctx.allPlayers.forEach(other => {
                    const hasWorkerBuff = (other.buffs['hold_worker'] && other.buffs['hold_worker'].length > 0) ||
                                          (other.buffs['todo_hold_worker'] && other.buffs['todo_hold_worker'].length > 0);
                    if (other !== ctx.tile.owner && !hasWorkerBuff && !other.isBankrupt) {
                        other.islandTurns = 1;
                        other.tracker.lakeRestCount++;
                        const wm = getActiveWorld()?.metrics;
                        if (wm) wm.furryExtraRestCount = (wm.furryExtraRestCount || 0) + 1;
                    }
                });

                RuntimePopup.showToast(gText.FURRY_REST_OTHERS, 3600);

                // 입장료 50만 * 코미주스 배율 지불 (VVVIP카드 0.8배 적용 + 일반 통행료와 동일한 매각/대출/파산 절차)
                const feeMult = syncFurryBeachFeeMultiplier(ctx.allPlayers);
                const rawFee = Math.round(GAME_CONSTANTS.FURRY_BEACH_FEE * feeMult);
                const fee = applySpecialTileTollModifiers(rawFee, ctx.tile, ctx.player);
                handleTollPaymentProcess({
                    ...ctx,
                    customToll: fee,
                    tollToastLabel: gText.FURRY_PAID,
                    onPaymentSettled: (settledFee) => {
                        const wmFee = getActiveWorld()?.metrics;
                        if (wmFee) wmFee.furryEntryTollTotal = (wmFee.furryEntryTollTotal || 0) + settledFee;
                    }
                });
            }
            return;
        }

        if (!ctx.tile.owner && ctx.player.isAi()) {
            const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
            const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles);
            if (action === 'buy' && ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.LAKE_BUY)) {
                recordLakeFirstOwnedTurn(ctx);
                RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 3200);
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
                        recordLakeFirstOwnedTurn(ctx);
                        ctx.updateRender(); ctx.refreshUI();
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
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
                    recordNormalLakeRest(ctx.player);
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
                    recordNormalLakeRest(ctx.player);
                    ctx.updateRender(); ctx.refreshUI();
                }
                scheduleGameTask(ctx.proceedEndTurn, 1000);
                return;
            }

            ctx.turnTimer.start(thinkTime, () => {
                RuntimePopup.closeAll();
                ctx.player.restTurns = 1;
                recordNormalLakeRest(ctx.player);
                ctx.proceedEndTurn();
            });
            RuntimePopup.showChoicePopup(text.LAKE_TITLE, text.LAKE_DESC, [
                { text: text.LAKE_BTN_REST, color: '#3498db', action: () => {
                    ctx.turnTimer.stop();
                    ctx.player.restTurns = 1;
                    recordNormalLakeRest(ctx.player);
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
                            recordNormalLakeRest(ctx.player);
                            ctx.updateRender(); ctx.refreshUI();
                            RuntimePopup.showToast(`[${ctx.player.name}] ${targetPlayer.name}${gText.LAKE_SUMMON_DONE}`, 3200);
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
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                    }
                }}
            ]);
        } else if (ctx.tile.owner === ctx.player && !WorldGimmickManager.furryManualOpenUsed) {
            const openFee = GAME_CONSTANTS.FURRY_MANUAL_OPEN_FEE;
            const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
            const triggerManualOpen = () => {
                ctx.player.money -= openFee;
                WorldGimmickManager.furryManualOpenUsed = true;
                openFurryBeachState(ctx, ctx.player, 'manual');
                ctx.updateRender(); ctx.refreshUI();
            };
            if (ctx.player.isAi()) {
                if (ctx.player.money >= openFee && AIManager.decideLakeManualFurryOpen(ctx.player, ctx.allPlayers, globalTurn)) {
                    triggerManualOpen();
                    RuntimePopup.showToast(`${ctx.player.name}${gText.AI_FURRY_MANUAL_OPEN}`, 3200);
                    scheduleGameTask(ctx.proceedEndTurn, 1200);
                } else {
                    ctx.proceedEndTurn();
                }
            } else if (ctx.player.money >= openFee) {
                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showChoicePopup(gText.FURRY_MANUAL_OPEN_TITLE, gText.FURRY_MANUAL_OPEN_DESC, [
                    { text: gText.FURRY_MANUAL_OPEN_BTN, color: '#e67e22', action: () => {
                        if (ctx.player.money >= openFee) {
                            ctx.turnTimer.stop();
                            triggerManualOpen();
                            RuntimePopup.closeAll();
                            RuntimePopup.showToast(`[${ctx.player.name}] ${gText.FURRY_OPEN}`, 3400);
                            scheduleGameTask(ctx.proceedEndTurn, 1600);
                        } else {
                            RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                            RuntimePopup.closeAll();
                            ctx.proceedEndTurn();
                        }
                    }},
                    { text: gText.FURRY_MANUAL_SKIP_BTN, color: '#7f8c8d', action: ctx.proceedEndTurn }
                ]);
            } else {
                ctx.proceedEndTurn();
            }
        } else ctx.proceedEndTurn();
    },

    // 28: 셰이디의 차원
    [BOARD_TILES.VOID]: (ctx) => {
        const cText = getCardUIText();
        const thinkTime = getPlayerThinkTime(ctx.player);
        const wmVoid = getActiveWorld()?.metrics;
        if (wmVoid) wmVoid.voidVisitTotal = (wmVoid.voidVisitTotal || 0) + 1;
        if (ctx.player.tracker) ctx.player.tracker.voidVisitCount = (ctx.player.tracker.voidVisitCount || 0) + 1;

        const hasRim = (ctx.player.buffs['hold_shaydi'] && ctx.player.buffs['hold_shaydi'].length > 0) ||
                       (ctx.player.buffs['todo_hold_shaydi'] && ctx.player.buffs['todo_hold_shaydi'].length > 0);
        const hasBigEvent = (ctx.player.buffs['hold_event'] && ctx.player.buffs['hold_event'].length > 0) ||
                            (ctx.player.buffs['todo_hold_event'] && ctx.player.buffs['todo_hold_event'].length > 0);

        const applyRest = (targetPlayer, showPopup, triggerEndTurn = false, customMsg = null) => {
            targetPlayer.restTurns = 1;
            targetPlayer._trappedByVoid = true;
            if (targetPlayer.tracker) targetPlayer.tracker.voidTrappedCount = (targetPlayer.tracker.voidTrappedCount || 0) + 1;
            if (wmVoid) {
                wmVoid.voidTrappedCount = (wmVoid.voidTrappedCount || 0) + 1;
                if (targetPlayer !== ctx.player) wmVoid.voidPulledCount = (wmVoid.voidPulledCount || 0) + 1;
            }
            if (showPopup && !targetPlayer.isAi()) {
                RuntimePopup.showNormalPopup(cText.SHAYDI_TITLE, customMsg || cText.SHAYDI_DESC, true, ctx.proceedEndTurn);
            } else {
                RuntimePopup.showToast(`${targetPlayer.name} ${cText.SHAYDI_PULLED}`, 3200);
                ctx.refreshUI();
                if (triggerEndTurn) {
                    // AI는 10초 확인 팝업 대기 없이 짧은 토스트 표시 후 턴을 종료한다.
                    scheduleGameTask(ctx.proceedEndTurn, 2200);
                }
            }
        };

        if (hasBigEvent) {
            const targets = ctx.allPlayers.filter(p => p !== ctx.player && !p.isBankrupt);
            const executePull = (target) => {
                target.pos = BOARD_TILES.VOID;
                ctx.updateRender(); ctx.refreshUI();
                applyRest(target, false, false);

                if (hasRim) {
                    if (wmVoid) wmVoid.voidRimEvadedCount = (wmVoid.voidRimEvadedCount || 0) + 1;
                    scheduleGameTask(() => {
                        RuntimePopup.showToast(`[${ctx.player.name}] ${cText.SHAYDI_EVADE}`, 3200);
                        scheduleGameTask(ctx.proceedEndTurn, 2000);
                    }, 1000);
                } else if (ctx.player.isAi()) {
                    scheduleGameTask(() => applyRest(ctx.player, false, true), 1000);
                } else {
                    scheduleGameTask(() => {
                        ctx.turnTimer.start(thinkTime);
                        applyRest(ctx.player, true, false);
                    }, 1000);
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
                ctx.turnTimer.start(thinkTime, () => {
                    RuntimePopup.closeAll();
                    executePull(targets[0]);
                });
                const btnConfigs = targets.map(t => ({ text: t.name, color: t.color, action: () => { ctx.turnTimer.stop(); RuntimePopup.closeAll(); executePull(t); } }));
                RuntimePopup.showChoicePopup(cText.SHAYDI_TARGET_TITLE, cText.SHAYDI_TARGET_DESC, btnConfigs);
            }
        } else if (hasRim) {
            if (wmVoid) wmVoid.voidRimEvadedCount = (wmVoid.voidRimEvadedCount || 0) + 1;
            RuntimePopup.showToast(`[${ctx.player.name}] ${cText.SHAYDI_EVADE}`, 3200);
            scheduleGameTask(ctx.proceedEndTurn, 2000);
        } else if (ctx.player.isAi()) {
            applyRest(ctx.player, false, true);
        } else {
            ctx.turnTimer.start(thinkTime); applyRest(ctx.player, true, false);
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
                RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 3200);
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
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player) {
            if (ctx.player.hasLibraryBuff) {
                RuntimePopup.showToast(gText.LIBRARY_ALREADY_HAS, 3000, ctx.player.id);
                scheduleGameTask(ctx.proceedEndTurn, 1500);
                return;
            }

            if (ctx.player.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                const action = AIManager.decideSpecialTilePurchase(ctx.player, ctx.tile, globalTurn, ctx.tiles, 'ability');
                if (action === 'use_assist') {
                    removeCardFromInventory(ctx.player, CARD_IDS.LIBRARY_ASSIST);
                    ctx.player.hasLibraryBuff = true;
                    RuntimePopup.showToast(`[${ctx.player.name}] ${cText.USE_LIBRARY_DONE}`, 3200);
                    ctx.refreshUI();
                    scheduleGameTask(ctx.proceedEndTurn, 1500);
                } else if (action === 'buy_ability') {
                    const libraryToll = applySpecialTileTollModifiers(GAME_CONSTANTS.TOLL_LIBRARY, ctx.tile, ctx.player);
                    if (ctx.player.money >= libraryToll) {
                        ctx.player.money -= libraryToll;
                        ctx.tile.owner.money += libraryToll;
                        ctx.player.hasLibraryBuff = true;
                        RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_LIBRARY_ABILITY}`, 3200);
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
                        RuntimePopup.showToast(`[${ctx.player.name}] ${cText.USE_LIBRARY_DONE}`, 3200);
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
                        RuntimePopup.showToast(`[${ctx.player.name}] ${gText.LIBRARY_ABILITY_BOUGHT}`, 3200);
                        scheduleGameTask(ctx.proceedEndTurn, 1500);
                    } else {
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
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
                RuntimePopup.showToast(`${ctx.player.name}${gText.AI_BUY_SPECIAL} ${tileName}`, 3200);
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
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
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
                            RuntimePopup.showToast(`${ctx.player.name}${gText.AI_TAKE_SPECIAL} ${tileName}`, 3400);
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
                            RuntimePopup.showToast(`[${ctx.player.name}] ${gText.DAYA_TAKE_DONE}`, 3400);
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
        if (RequiemState.isHaloState && bonus > baseBonus) {
            recordHaloPositiveGain(ctx.player, bonus - baseBonus);
        }
        ctx.player.money += bonus;
        ctx.refreshUI(); RuntimePopup.showToast(`[${ctx.player.name}] ${text.TOAST_MOON} (+${formatMoney(bonus)})`, 3400); scheduleGameTask(ctx.proceedEndTurn, 2000);
    },

    // [차원 열쇠 카드 로직]
    handleCardTile: (ctx) => {
        const cText = getCardUIText();
        const gText = getGimmickText();
        const thinkTime = getPlayerThinkTime(ctx.player);

        // 제단 2회차+ 포탈로 이동한 도착인지 즉시 소비 (미소멸 방지)
        const isAltarGuaranteed = ctx.player._altarGuaranteedTreasure === true;
        ctx.player._altarGuaranteedTreasure = false;

        // 카드 칸 도착 횟수 집계 (밑장빼기 2장 뽑기나 도서관 3장 선택과 무관하게 도착 1회당 +1)
        ctx.player.tracker.cardsDrawn++;

        // [101: 밑장빼기] 발동 대기 상태라면 이번 카드 칸에서 2장 연속 뽑기
        const isDoubleDraw = ctx.player.nextCardDoubleDraw === true;
        if (isDoubleDraw) {
            ctx.player.nextCardDoubleDraw = false;
        }

        const processSingleDraw = (onDrawDone, allowAltarGuarantee = false) => {
            if (ctx.player.tracker) ctx.player.tracker.cardDrawsTotal++;

            // 제단에 의해 카드 칸으로 이동한 경우 미등장 보물 카드 확정 지급
            if (allowAltarGuarantee) {
                const altarTreasure = OdysseyManager.drawGuaranteedAltarTreasure(ctx.player, getCardDeck());
                if (altarTreasure) {
                    const altarOpt = { treasureSource: 'altar_portal' };
                    if (ctx.player.isAi()) {
                        RuntimePopup.showToast(`[${ctx.player.name}] ${gText.ALTAR_PORTAL_TREASURE_TOAST} [${altarTreasure.name}]`, 2800);
                        executeCardEffect(ctx, altarTreasure, onDrawDone, altarOpt);
                        return;
                    }
                    ctx.turnTimer.start(thinkTime, () => {
                        RuntimePopup.closeAll();
                        executeCardEffect(ctx, altarTreasure, onDrawDone, altarOpt);
                    });
                    RuntimePopup.showChoicePopup(gText.ALTAR_PORTAL_TITLE, `[${altarTreasure.name}]\n\n${altarTreasure.desc}`, [
                        { text: cText.BTN_CONFIRM, color: '#f1c40f', action: () => {
                            ctx.turnTimer.stop();
                            RuntimePopup.closeAll();
                            executeCardEffect(ctx, altarTreasure, onDrawDone, altarOpt);
                        }}
                    ]);
                    return;
                }
                RuntimePopup.showToast(gText.ALTAR_PORTAL_TREASURE_EMPTY_TOAST, 2400, ctx.player.id);
            }

            const isLibraryOwner = ctx.tiles[BOARD_TILES.LIBRARY].owner === ctx.player;
            const useLibraryAbility = isLibraryOwner || ctx.player.hasLibraryBuff;

            if (useLibraryAbility && ctx.player.isAi()) {
                if (!isLibraryOwner) ctx.player.hasLibraryBuff = false;
                const cards = drawDimensionCards(ctx, 3);
                const chosen = AIManager.decideLibraryCardChoice(ctx.player, cards, ctx) || cards[0];
                RuntimePopup.showToast(`${ctx.player.name}님이 차원 열쇠 카드를 뽑았습니다.`, 2400);
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
                    text: `${c.id >= 500 ? `${gText.LIBRARY_TREASURE_TAG} ` : ''}[${c.name}]\n${c.desc}`,
                    color: c.id >= 500 ? '#f39c12' : '#8e44ad',
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
                RuntimePopup.showToast(`${ctx.player.name}님이 차원 열쇠 카드를 뽑았습니다.`, 2400);
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
                processSingleDraw(ctx.proceedEndTurn, false);
            }, isAltarGuaranteed);
        } else {
            processSingleDraw(ctx.proceedEndTurn, isAltarGuaranteed);
        }
    }
};
