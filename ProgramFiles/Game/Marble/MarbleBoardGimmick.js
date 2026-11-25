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
import {
    drawDimensionCard,
    drawDimensionCards,
    executeCardEffect,
    removeCardFromInventory,
    formatCardDisplayTitle,
    getCardGradeTheme
} from './MarbleCard.js';
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
import { GAME_CONSTANTS, BUILDING_COSTS, MULTIPLIERS, getModeConfig } from '../../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES, CARD_TILE_IDS } from '../../System/Index/Marble/MarbleBoardIndex.js';
import { CARD_IDS } from '../../System/Index/Marble/MarbleCardIndex.js';

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
        const activeWorld = getActiveWorld();
        const worldMetrics = activeWorld?.metrics;
        const modeCfg = getModeConfig(activeWorld?.gameMode);

        player.altarVisitCount = (player.altarVisitCount || 0) + 1;
        if (worldMetrics) worldMetrics.altarVisitTotal = (worldMetrics.altarVisitTotal || 0) + 1;

        // 스피드/기본 모드: 매 방문마다 즉시 랜덤한 차원 열쇠 칸으로 이동 (순회 통과 시 순회 보상 지급, 확정 보물 없음)
        if (modeCfg.altarWarpToRandomCardTile) {
            if (!player.hasVisitedAltar) {
                player.hasVisitedAltar = true;
                if (worldMetrics) worldMetrics.altarFirstVisits++;
            }
            if (worldMetrics) worldMetrics.altarPortalUses++;
            const targetId = CARD_TILE_IDS[Math.floor(Math.random() * CARD_TILE_IDS.length)];
            const fromPos = player.pos;
            const passedStart = (targetId < player.pos || targetId === BOARD_TILES.START) && targetId !== player.pos;
            const lapBonus = passedStart ? applyLapPassBonus(player, { showBlockedToast: true }) : 0;
            player.pos = targetId;
            player._altarGuaranteedTreasure = false;
            ctx.emitMoveEvent?.(player, fromPos, targetId, 'card', { passedStart, lapBonus });
            RuntimePopup.showToast(`[${player.name}] ${gText.ALTAR_PORTAL_MOVE_TOAST}`, 3200);
            ctx.updateRender();
            refreshUI();
            scheduleGameTask(() => ctx.handleTileArrival(player), 1200);
            return;
        }

        const isSecondOrMoreVisit = player.altarVisitCount >= 2;

        // 1. 최초 방문 시 보물 확률 개방(특식) 또는 확정 포탈 예열(불씨)
        if (!player.hasVisitedAltar) {
            player.hasVisitedAltar = true;
            if (worldMetrics) worldMetrics.altarFirstVisits++;
            RuntimePopup.showToast(
                `[${player.name}] ${modeCfg.startWithTreasureUnlocked ? (gText.ALTAR_VISIT_PREUNLOCKED || gText.ALTAR_VISIT) : gText.ALTAR_VISIT}`,
                3400
            );
        }

        // 2회차 이상 방문 시 차원 열쇠 카드 칸 중 한 곳으로 이동하며 시계방향 알현실 통과 시 순회 보상 지급 (도착 시 보물 카드 확정 획득)
        const executeAltarTeleportMove = (targetId) => {
            if (worldMetrics) worldMetrics.altarPortalUses++;
            const fromPos = player.pos;
            const passedStart = (targetId < player.pos || targetId === BOARD_TILES.START) && targetId !== player.pos;
            const lapBonus = passedStart ? applyLapPassBonus(player, { showBlockedToast: true }) : 0;
            player.pos = targetId;
            player._altarGuaranteedTreasure = true;
            ctx.emitMoveEvent?.(player, fromPos, targetId, 'card', { passedStart, lapBonus });
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
            const pickedCardTileId = CARD_TILE_IDS[Math.floor(Math.random() * CARD_TILE_IDS.length)];
            if (player.isAi()) {
                executeAltarTeleportMove(pickedCardTileId);
                return;
            }
            const confirmWarp = () => {
                turnTimer.stop();
                RuntimePopup.closeAll();
                executeAltarTeleportMove(pickedCardTileId);
            };
            turnTimer.start(thinkTime, confirmWarp);
            RuntimePopup.showNormalPopup(
                gText.ALTAR_PORTAL_TITLE,
                gText.ALTAR_PORTAL_DESC,
                true,
                confirmWarp,
                { tileId: BOARD_TILES.ALTAR }
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
        ctx.turnTimer.start(GAME_CONSTANTS.ALERT_THINK_TIME || 5);
        RuntimePopup.showNormalPopup(text.VOLCANICA_TITLE, text.VOLCANICA_DESC, true, ctx.proceedEndTurn, {
            confirmText: text.VOLCANICA_CONFIRM_BTN || '발뻗고 쉬기'
        });
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

        ctx.turnTimer.start(getPlayerThinkTime(p, GAME_CONSTANTS.BUY_THINK_TIME));
        RuntimePopup.showChoicePopup(text.MOUNTAIN_TITLE, text.MOUNTAIN_DESC, [
            { text: text.MOUNTAIN_YES_BTN || text.BTN_YES, color: '#2ecc71', action: () => {
                if (p.money >= GAME_CONSTANTS.MOUNTAIN_FEE) {
                    acquireMountainBuffWithMetrics(ctx, p);
                    RuntimePopup.showToast(
                        `[${p.name}] ${text.MOUNTAIN_TITLE}`,
                        3200,
                        null,
                        {
                            actorId: p.id,
                            selfMessage: text.MOUNTAIN_YES_TOAST || '현자의 가르침으로 통행료가 1.2배 증가합니다!',
                            otherMessage: `🏔️ ${p.name}님이 정령산 정상의 제자가 되었습니다! (통행료 1.2배)`,
                            logMessage: `🏔️ ${p.name}님이 정령산 정상의 제자가 되었습니다.`
                        }
                    );
                    ctx.refreshUI();
                } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, p.id);
                ctx.proceedEndTurn();
            }},
            { text: text.MOUNTAIN_NO_BTN || text.BTN_NO, color: '#e74c3c', action: () => {
                RuntimePopup.showToast(text.MOUNTAIN_NO_TOAST || '당신은 한번 더 고민해보기로 했습니다.', 2600, p.id);
                ctx.proceedEndTurn();
            }}
        ]);
    },

    // 30: 빵주 (불씨/기본 1~3턴: 빵주 정비소 / 스피드 1~2턴: 50만 조기 개방 가능 / 3턴(스피드)·4턴(기본/불씨)~: 빵주)
    [BOARD_TILES.BBANGJU]: (ctx) => {
        const gText = getGimmickText();
        const text = getMarbleText();
        const cText = getCardUIText();
        const thinkTime = getPlayerThinkTime(ctx.player);
        const buyThinkTime = getPlayerThinkTime(ctx.player, GAME_CONSTANTS.BUY_THINK_TIME);
        const modeCfg = getModeConfig(getActiveWorld()?.gameMode);
        const directPurchase = modeCfg.bbangjuDirectPurchase || GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE;

        // 스피드 모드: 3턴부터 자동 개방되나, 1~2턴에 도착 시 50만 지불로 즉시 전체 개방 및 이용 가능
        if (!modeCfg.enableBbangjuChief && WorldGimmickManager.bbangjuState === 'locked' && ctx.turnManager.globalTurn < (modeCfg.bbangjuOpenTurn || 3)) {
            const earlyOpenFee = modeCfg.bbangjuEarlyOpenFee || 500000;
            const executeEarlyOpenJump = (targetId) => {
                ctx.player.money -= earlyOpenFee;
                WorldGimmickManager.bbangjuState = 'finished';
                addBbangjuVisit();
                ctx.player.tracker.bbangjuUsageCount++;
                const fromPos = ctx.player.pos;
                const passedStart = targetId < ctx.player.pos || targetId === BOARD_TILES.START;
                const lapBonus = passedStart ? applyLapPassBonus(ctx.player, { showBlockedToast: true }) : 0;
                ctx.player.pos = targetId;
                ctx.emitMoveEvent?.(ctx.player, fromPos, targetId, 'bbangju', { passedStart, lapBonus });
                RuntimePopup.showToast(
                    `${ctx.player.name}${gText.BBANGJU_SPEED_EARLY_OPEN_TOAST}`,
                    3400,
                    null,
                    {
                        actorId: ctx.player.id,
                        selfMessage: gText.BBANGJU_SPEED_EARLY_OPEN_SELF_TOAST || '🚀 지원해줘서 고마워~ 마음껏 사용해~',
                        otherMessage: `${ctx.player.name}${gText.BBANGJU_SPEED_EARLY_OPEN_TOAST}`,
                        logMessage: `🚀 ${ctx.player.name}${gText.BBANGJU_SPEED_EARLY_OPEN_TOAST}`
                    }
                );
                ctx.updateRender();
                ctx.refreshUI();
                const ring = (ctx.tiles || []).filter(t => t && !t.isDisabled).sort((a, b) => a.id - b.id);
                const sIdx = Math.max(0, ring.findIndex(t => t.id === fromPos));
                const eIdx = ring.findIndex(t => t.id === targetId);
                const distSteps = (ring.length > 1 && eIdx >= 0) ? ((eIdx - sIdx + ring.length) % ring.length || 1) : 1;
                const jumpDelay = Math.max(1150, Math.round(780 + Math.pow(Math.min(1, distSteps / Math.max(1, ring.length - 1)), 0.78) * 1650) + 330);
                scheduleGameTask(() => ctx.handleTileArrival(ctx.player), jumpDelay);
            };

            if (ctx.player.isAi()) {
                const targetId = AIManager.decidePortalDestination(ctx, false, earlyOpenFee);
                if (targetId !== -1 && targetId !== BOARD_TILES.BBANGJU && ctx.player.money >= earlyOpenFee) {
                    executeEarlyOpenJump(targetId);
                } else {
                    scheduleGameTask(ctx.proceedEndTurn, 1000);
                }
                return;
            }

            if (ctx.player.money < earlyOpenFee) {
                ctx.turnTimer.start(GAME_CONSTANTS.ALERT_THINK_TIME || 5);
                RuntimePopup.showNormalPopup(getTileName(ctx.tile), gText.BBANGJU_SPEED_LOCKED_NO_MONEY, true, ctx.proceedEndTurn);
                return;
            }

            ctx.turnTimer.start(buyThinkTime);
            RuntimePopup.showChoicePopup(gText.BBANGJU_SPEED_EARLY_OPEN_TITLE, gText.BBANGJU_SPEED_EARLY_OPEN_DESC, [
                {
                    text: gText.BBANGJU_SPEED_EARLY_OPEN_BTN,
                    color: '#2ecc71',
                    action: () => {
                        ctx.turnTimer.stop();
                        RuntimePopup.closeAll();
                        ctx.turnTimer.start(getPlayerThinkTime(ctx.player, GAME_CONSTANTS.PORTAL_THINK_TIME || 20));
                        RuntimePopup.showPortalPopup(ctx.tiles, (targetId) => {
                            if (ctx.player.money >= earlyOpenFee) {
                                ctx.turnTimer.stop();
                                RuntimePopup.closeAll();
                                executeEarlyOpenJump(targetId);
                            } else {
                                RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                                RuntimePopup.closeAll();
                                ctx.proceedEndTurn();
                            }
                        }, ctx.proceedEndTurn, earlyOpenFee, false);
                    }
                },
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
            return;
        }

        if (!modeCfg.enableBbangjuChief && WorldGimmickManager.bbangjuState === 'locked') {
            WorldGimmickManager.bbangjuState = 'finished';
        }

        // 1~3턴: 빵주 정비소 기간 (기본/불씨 모드)
        if (modeCfg.enableBbangjuChief && ctx.turnManager.globalTurn < 4) {
            if (WorldGimmickManager.bbangjuState === 'recruiting' && ctx.player.isAi()) {
                const isSupporter = ctx.player.bbangjuPaidTotal > 0;
                const reqTakeoverCost = isSupporter
                    ? (directPurchase - ctx.player.bbangjuPaidTotal)
                    : directPurchase;
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
                    ? (directPurchase - ctx.player.bbangjuPaidTotal)
                    : directPurchase;
                const fullDesc = directPurchase === 1000000
                    ? (gText.BBANGJU_TAKE_DESC_FULL_BASIC || gText.BBANGJU_TAKE_DESC_FULL.replace('200만', '100만').replace('2,000,000', '1,000,000').replace('200万', '100万'))
                    : gText.BBANGJU_TAKE_DESC_FULL;
                const descText = `${isSupporter ? gText.BBANGJU_TAKE_DESC_DISCOUNT : fullDesc}\n\n${gText.BBANGJU_TAKE_COST_LABEL} ${formatMoney(reqTakeoverCost)}`;

                ctx.turnTimer.start(buyThinkTime);
                RuntimePopup.showChoicePopup(gText.BBANGJU_TAKE_TITLE, descText, [
                    { text: `가로채기 (${formatMoney(reqTakeoverCost)})`, color: '#e67e22', action: () => {
                        if (ctx.player.money >= reqTakeoverCost) {
                            ctx.turnTimer.stop();
                            ctx.player.money -= reqTakeoverCost;
                            WorldGimmickManager.bbangjuState = 'occupied';
                            ctx.player.isBbangjuChief = true;
                            WorldGimmickManager.bbangjuChiefs = [ctx.player];
                            ctx.allPlayers.forEach(p => { p.bbangjuSupportTurns = 0; });
                            RuntimePopup.closeAll();
                            RuntimePopup.showToast(
                                `${ctx.player.name} ${gText.BBANGJU_ANNOUNCE}`,
                                3400,
                                null,
                                {
                                    actorId: ctx.player.id,
                                    selfMessage: gText.BBANGJU_TAKE_YES_TOAST || '🔧 바로 그 자세라고~ 이제부터 너가 정비반장이야~',
                                    otherMessage: `${ctx.player.name} ${gText.BBANGJU_ANNOUNCE}`,
                                    logMessage: `🔧 ${ctx.player.name} ${gText.BBANGJU_ANNOUNCE}`
                                }
                            );
                            ctx.updateRender(); ctx.refreshUI();
                            scheduleGameTask(ctx.proceedEndTurn, 2000);
                        } else {
                            RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                            RuntimePopup.closeAll(); ctx.proceedEndTurn();
                        }
                    }},
                    { text: gText.BBANGJU_REQ_NO_BTN || gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
                ]);
            } else if (ctx.player.isAi()) {
                RuntimePopup.showToast(`[${ctx.player.name}] ${getTileName(ctx.tile)} - ${gText.BBANGJU_CLOSED}`, 3000);
                scheduleGameTask(ctx.proceedEndTurn, 1800);
            } else {
                ctx.turnTimer.start(GAME_CONSTANTS.ALERT_THINK_TIME || 5);
                RuntimePopup.showNormalPopup(gText.BBANGJU_CLOSED_TITLE || getTileName(ctx.tile), gText.BBANGJU_CLOSED, true, ctx.proceedEndTurn);
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

            // [33: 빵주 연구원] 보유 시 기본 이용료(10만) 면제, 단 정비반장 추가 요금(20만)은 지불 (기획서 33p)
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
                const fromPos = ctx.player.pos;
                const passedStart = targetId < ctx.player.pos || targetId === BOARD_TILES.START;
                const lapBonus = passedStart ? applyLapPassBonus(ctx.player, { showBlockedToast: true }) : 0;
                ctx.player.pos = targetId;
                ctx.emitMoveEvent?.(ctx.player, fromPos, targetId, 'bbangju', { passedStart, lapBonus });
                ctx.updateRender();
                ctx.refreshUI();
                const ring = (ctx.tiles || []).filter(t => t && !t.isDisabled).sort((a, b) => a.id - b.id);
                const sIdx = Math.max(0, ring.findIndex(t => t.id === fromPos));
                const eIdx = ring.findIndex(t => t.id === targetId);
                const distSteps = (ring.length > 1 && eIdx >= 0) ? ((eIdx - sIdx + ring.length) % ring.length || 1) : 1;
                const jumpDelay = Math.max(1150, Math.round(780 + Math.pow(Math.min(1, distSteps / Math.max(1, ring.length - 1)), 0.78) * 1650) + 330);
                scheduleGameTask(() => ctx.handleTileArrival(ctx.player), jumpDelay);
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
                ctx.turnTimer.start(getPlayerThinkTime(ctx.player, GAME_CONSTANTS.PORTAL_THINK_TIME || 20));
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
        const thinkTime = getPlayerThinkTime(ctx.player, GAME_CONSTANTS.BUY_THINK_TIME);
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
            RuntimePopup.showChoicePopup(gText.THEATER_BUY_TITLE || tileName, gText.THEATER_BUY_DESC || `${formatMoney(GAME_CONSTANTS.THEATER_BUY)}${gText.ASK_BUY}`, [
                { text: `극장 매입하기 (${formatMoney(GAME_CONSTANTS.THEATER_BUY)})`, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.THEATER_BUY)) {
                        RuntimePopup.showToast(
                            `🎭 ${ctx.player.name}님이 ${tileName}을 매입했습니다!`,
                            3000,
                            null,
                            {
                                actorId: ctx.player.id,
                                selfMessage: gText.THEATER_TAKE_SELF_TOAST || '이번 사장님은 좋은 사장님일까...?',
                                otherMessage: `🎭 ${ctx.player.name}님이 ${tileName}을 매입했습니다!`,
                                logMessage: `🎭 ${ctx.player.name}님이 ${tileName}을 매입하였습니다!`
                            }
                        );
                        ctx.updateRender(); ctx.refreshUI();
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                    ctx.proceedEndTurn();
                }},
                { text: '매입 안함', color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player && !ctx.player.isAi()) {
            if (ctx.player.money < GAME_CONSTANTS.THEATER_TAKE) {
                RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2600, ctx.player.id);
                ctx.refreshUI();
                scheduleGameTask(ctx.proceedEndTurn, 1200);
                return;
            }
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(gText.THEATER_TAKE_TITLE || tileName, gText.THEATER_TAKE_DESC || `${formatMoney(GAME_CONSTANTS.THEATER_TAKE)}${gText.ASK_TAKE}`, [
                { text: text.THEATER_TAKEOVER || `${gText.BTN_TAKE} (${formatMoney(GAME_CONSTANTS.THEATER_TAKE)})`, color: '#9b59b6', action: () => {
                    const prevOwner = ctx.tile.owner;
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.THEATER_TAKE)) {
                        prevOwner.money += GAME_CONSTANTS.THEATER_TAKE;
                        RuntimePopup.showToast(
                            `🎭 ${ctx.player.name}님이 ${tileName}을 인수했습니다!`,
                            3000,
                            null,
                            {
                                actorId: ctx.player.id,
                                selfMessage: gText.THEATER_TAKE_SELF_TOAST || '이번 사장님은 좋은 사장님일까...?',
                                otherMessage: `🎭 ${ctx.player.name}님이 ${tileName}을 인수했습니다!`,
                                logMessage: `🎭 ${ctx.player.name}님이 ${tileName}을 인수하였습니다!`
                            }
                        );
                        ctx.updateRender(); ctx.refreshUI();
                    }
                    ctx.proceedEndTurn();
                }},
                { text: '인수 안함', color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else ctx.proceedEndTurn();
    },

    // 15: 모나티엄 25
    [BOARD_TILES.MONATIUM_25]: (ctx) => {
        const gText = getGimmickText();
        const text = getMarbleText();
        const tileName = getTileName(ctx.tile);
        const thinkTime = getPlayerThinkTime(ctx.player, GAME_CONSTANTS.BUY_THINK_TIME);
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
            RuntimePopup.showChoicePopup(gText.MONATIUM_BUY_TITLE || tileName, gText.MONATIUM_BUY_DESC || `${formatMoney(GAME_CONSTANTS.MONATIUM_BUY)}${gText.ASK_BUY}`, [
                { text: `매입 (${formatMoney(GAME_CONSTANTS.MONATIUM_BUY)})`, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.MONATIUM_BUY)) {
                        RuntimePopup.showToast(
                            `🏙️ ${ctx.player.name}님이 모나티엄 25를 매입했습니다!`,
                            3000,
                            null,
                            {
                                actorId: ctx.player.id,
                                selfMessage: '🏙️ 모나티엄 25를 매입하였습니다!',
                                otherMessage: `🏙️ ${ctx.player.name}님이 모나티엄 25를 매입했습니다!`,
                                logMessage: `🏙️ ${ctx.player.name}님이 모나티엄 25를 매입하였습니다!`
                            }
                        );
                        ctx.updateRender(); ctx.refreshUI();
                    } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                    ctx.proceedEndTurn();
                }},
                { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
            ]);
        } else if (ctx.tile.owner === ctx.player && ctx.tile.level < 2 && !ctx.player.isAi()) {
            const expCost = ctx.tile.level === 0 ? GAME_CONSTANTS.MONATIUM_EXPAND_1 : GAME_CONSTANTS.MONATIUM_EXPAND_2;
            const expDesc = ctx.tile.level === 0
                ? (gText.MONATIUM_EXPAND_1_DESC || `${formatMoney(expCost)}${gText.ASK_EXPAND}`)
                : (gText.MONATIUM_EXPAND_2_DESC || `${formatMoney(expCost)}${gText.ASK_EXPAND}`);
            if (ctx.player.money < expCost) {
                ctx.proceedEndTurn();
                return;
            }
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(gText.MONATIUM_EXPAND_TITLE || `${tileName} 확장`, expDesc, [
                { text: `${text.MONATIUM_EXPAND || '확장'} (${formatMoney(expCost)})`, color: '#3498db', action: () => {
                    if (ctx.player.money >= expCost) {
                        ctx.player.money -= expCost;
                        ctx.tile.level++;
                        RuntimePopup.showToast(
                            `🏙️ ${ctx.player.name}님이 모나티엄 25를 ${ctx.tile.level}단계 확장했습니다!`,
                            3000,
                            null,
                            {
                                actorId: ctx.player.id,
                                selfMessage: `🏙️ 모나티엄 25를 ${ctx.tile.level}단계로 확장했습니다!`,
                                otherMessage: `🏙️ ${ctx.player.name}님이 모나티엄 25를 ${ctx.tile.level}단계로 확장했습니다!`,
                                logMessage: `🏙️ ${ctx.player.name}님이 모나티엄 25를 ${ctx.tile.level}단계로 확장하였습니다!`
                            }
                        );
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
            ctx.turnTimer.start(getPlayerThinkTime(ctx.player, GAME_CONSTANTS.BUY_THINK_TIME));
            RuntimePopup.showChoicePopup(gText.LAKE_BUY_TITLE || tileName, gText.LAKE_BUY_DESC || `${formatMoney(GAME_CONSTANTS.LAKE_BUY)}${gText.ASK_BUY}`, [
                { text: `매입 (${formatMoney(GAME_CONSTANTS.LAKE_BUY)})`, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.LAKE_BUY)) {
                        recordLakeFirstOwnedTurn(ctx);
                        RuntimePopup.showToast(
                            `🌊 ${ctx.player.name}님이 정령 호수를 매입했습니다!`,
                            3000,
                            null,
                            {
                                actorId: ctx.player.id,
                                selfMessage: '🌊 정령 호수를 매입하였습니다!',
                                otherMessage: `🌊 ${ctx.player.name}님이 정령 호수를 매입했습니다!`,
                                logMessage: `🌊 ${ctx.player.name}님이 정령 호수를 매입하였습니다!`
                            }
                        );
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
                    const fromPos = aiDecision.target.pos;
                    aiDecision.target.pos = BOARD_TILES.LAKE;
                    aiDecision.target.restTurns = 1;
                    recordNormalLakeRest(ctx.player);
                    ctx.emitMoveEvent?.(aiDecision.target, fromPos, BOARD_TILES.LAKE, 'card');
                    ctx.updateRender(); ctx.refreshUI();
                    scheduleGameTask(ctx.proceedEndTurn, 1250);
                    return;
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
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2000, ctx.player.id);
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
                            const fromPos = targetPlayer.pos;
                            targetPlayer.pos = BOARD_TILES.LAKE;
                            targetPlayer.restTurns = 1;
                            recordNormalLakeRest(ctx.player);
                            ctx.emitMoveEvent?.(targetPlayer, fromPos, BOARD_TILES.LAKE, 'card');
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
                if (triggerEndTurn) ctx.turnTimer.start(GAME_CONSTANTS.ALERT_THINK_TIME || 5);
                RuntimePopup.showNormalPopup(cText.SHAYDI_TITLE, customMsg || cText.SHAYDI_DESC, true, ctx.proceedEndTurn, {
                    confirmText: cText.SHAYDI_CONFIRM_BTN || '제발 지옥같은 여기서 날 꺼내줘'
                });
            } else {
                RuntimePopup.showToast(`${targetPlayer.name} ${cText.SHAYDI_PULLED}`, 3200);
                ctx.refreshUI();
                if (triggerEndTurn) {
                    // AI는 10초 확인 팝업 대기 없이 짧은 토스트 표시 후 턴을 종료한다.
                    scheduleGameTask(ctx.proceedEndTurn, 2200);
                }
            }
        };

        const handleNormalVoidOutcome = () => {
            if (hasRim) {
                if (wmVoid) wmVoid.voidRimEvadedCount = (wmVoid.voidRimEvadedCount || 0) + 1;
                RuntimePopup.showToast(
                    `${ctx.player.name}님의 [림의 기역]효과로 셰이디의 장난을 무시합니다!`,
                    3200,
                    null,
                    {
                        actorId: ctx.player.id,
                        selfMessage: '[림의 기역] 으윽, 그 낫은...! 빨리 내 차원에서 사라져!',
                        otherMessage: `${ctx.player.name}님의 [림의 기역]효과로 셰이디의 장난을 무시합니다!`,
                        logMessage: `${ctx.player.name}님의 [림의 기역]효과로 셰이디의 장난을 무시합니다!`
                    }
                );
                scheduleGameTask(ctx.proceedEndTurn, 2000);
            } else if (ctx.player.isAi()) {
                applyRest(ctx.player, false, true);
            } else {
                ctx.turnTimer.start(thinkTime);
                applyRest(ctx.player, true, false);
            }
        };

        if (hasBigEvent) {
            const targets = ctx.allPlayers.filter(p => p !== ctx.player && !p.isBankrupt);
            const executePull = (target) => {
                const fromPos = target.pos;
                target.pos = BOARD_TILES.VOID;
                ctx.emitMoveEvent?.(target, fromPos, BOARD_TILES.VOID, 'blackhole');
                ctx.updateRender(); ctx.refreshUI();
                applyRest(target, false, false);

                if (hasRim) {
                    if (wmVoid) wmVoid.voidRimEvadedCount = (wmVoid.voidRimEvadedCount || 0) + 1;
                    scheduleGameTask(() => {
                        RuntimePopup.showToast(
                            `${ctx.player.name}님의 [림의 기역]효과로 셰이디의 장난을 무시합니다!`,
                            3200,
                            null,
                            {
                                actorId: ctx.player.id,
                                selfMessage: '[림의 기역] 으윽, 그 낫은...! 빨리 내 차원에서 사라져!',
                                otherMessage: `${ctx.player.name}님의 [림의 기역]효과로 셰이디의 장난을 무시합니다!`,
                                logMessage: `${ctx.player.name}님의 [림의 기역]효과로 셰이디의 장난을 무시합니다!`
                            }
                        );
                        scheduleGameTask(ctx.proceedEndTurn, 2000);
                    }, 2050);
                } else if (ctx.player.isAi()) {
                    scheduleGameTask(() => applyRest(ctx.player, false, true), 2050);
                } else {
                    scheduleGameTask(() => {
                        ctx.turnTimer.start(thinkTime);
                        applyRest(ctx.player, true, false);
                    }, 2050);
                }
            };

            const openTargetSelector = () => {
                ctx.turnTimer.start(thinkTime, () => {
                    RuntimePopup.closeAll();
                    executePull(targets[0]);
                });
                const btnConfigs = targets.map(t => ({
                    text: t.name,
                    color: t.color,
                    action: () => { ctx.turnTimer.stop(); RuntimePopup.closeAll(); executePull(t); }
                }));
                RuntimePopup.showChoicePopup(cText.SHAYDI_TARGET_TITLE, cText.SHAYDI_TARGET_DESC, btnConfigs);
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
                    handleNormalVoidOutcome();
                });
                RuntimePopup.showChoicePopup(
                    cText.SHAYDI_USE_EVENT_TITLE || '셰이디의 빅 이벤트',
                    cText.SHAYDI_USE_EVENT_DESC || '보유 중인 [셰이디의 빅 이벤트]를 사용하여 상대 플레이어를 셰이디의 차원으로 끌어들이시겠습니까?',
                    [
                        {
                            text: cText.BTN_USE || '사용하기',
                            color: '#2ecc71',
                            action: () => {
                                ctx.turnTimer.stop();
                                RuntimePopup.closeAll();
                                openTargetSelector();
                            }
                        },
                        {
                            text: '보류 (미사용)',
                            color: '#7f8c8d',
                            action: () => {
                                ctx.turnTimer.stop();
                                RuntimePopup.closeAll();
                                handleNormalVoidOutcome();
                            }
                        }
                    ]
                );
            }
        } else {
            handleNormalVoidOutcome();
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
            ctx.turnTimer.start(getPlayerThinkTime(ctx.player, GAME_CONSTANTS.BUY_THINK_TIME));
            RuntimePopup.showChoicePopup(gText.LIBRARY_BUY_TITLE || tileName, gText.LIBRARY_BUY_DESC || `${formatMoney(GAME_CONSTANTS.LIBRARY_BUY)}${gText.ASK_BUY}`, [
                { text: `매입 (${formatMoney(GAME_CONSTANTS.LIBRARY_BUY)})`, color: '#2ecc71', action: () => {
                    if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.LIBRARY_BUY)) {
                        RuntimePopup.showToast(
                            `📖 ${ctx.player.name}님이 마녀 도서관을 매입했습니다!`,
                            3000,
                            null,
                            {
                                actorId: ctx.player.id,
                                selfMessage: '📖 마녀 도서관을 매입하였습니다!',
                                otherMessage: `📖 ${ctx.player.name}님이 마녀 도서관을 매입했습니다!`,
                                logMessage: `📖 ${ctx.player.name}님이 마녀 도서관을 매입하였습니다!`
                            }
                        );
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

            // [41: 셰럼의 일일조교] 보유 시 통행료 지불 없이 도서관 능력 획득 선택 가능
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
        const thinkTime = getPlayerThinkTime(ctx.player, GAME_CONSTANTS.BUY_THINK_TIME);

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
            const isDayaMinimi = String(ctx.player?.minimiPath || '').includes('Minimi_Daya');
            ctx.turnTimer.start(thinkTime);
            RuntimePopup.showChoicePopup(
                isDayaMinimi ? (gText.DAYA_SELF_BUY_TITLE || gText.DAYA_BUY_TITLE) : (gText.DAYA_BUY_TITLE || tileName),
                isDayaMinimi ? (gText.DAYA_SELF_BUY_DESC || gText.DAYA_BUY_DESC) : (gText.DAYA_BUY_DESC || `${formatMoney(GAME_CONSTANTS.DAYA_BUY)}${gText.ASK_BUY}`),
                [
                    { text: `매입 (${formatMoney(GAME_CONSTANTS.DAYA_BUY)})`, color: '#2ecc71', action: () => {
                        if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.DAYA_BUY)) {
                            ctx.player.recordDayaHoldTurn(ctx.turnManager ? ctx.turnManager.globalTurn : null);
                            RuntimePopup.showToast(
                                `💎 ${ctx.player.name}님이 다야의 궁전을 매입했습니다!`,
                                3000,
                                null,
                                {
                                    actorId: ctx.player.id,
                                    selfMessage: isDayaMinimi ? (gText.DAYA_SELF_BUY_TOAST || '💎 다야의 궁전을 매입하였습니다!') : '💎 다야의 궁전을 매입하였습니다!',
                                    otherMessage: `💎 ${ctx.player.name}님이 다야의 궁전을 매입했습니다!`,
                                    logMessage: `💎 ${ctx.player.name}님이 다야의 궁전을 매입하였습니다!`
                                }
                            );
                            ctx.updateRender(); ctx.refreshUI();
                        } else RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2800, ctx.player.id);
                        ctx.proceedEndTurn();
                    }},
                    { text: gText.BTN_REJECT, color: '#e74c3c', action: ctx.proceedEndTurn }
                ]
            );
        } else if (ctx.tile.owner && ctx.tile.owner !== ctx.player) {
            ctx.handleTollPayment(ctx.player, ctx.tile, () => {
                if (ctx.player.isBankrupt) {
                    ctx.proceedEndTurn();
                    return;
                }
                if (ctx.player.money < GAME_CONSTANTS.DAYA_TAKE) {
                    if (!ctx.player.isAi()) {
                        RuntimePopup.showToast(text.NOT_ENOUGH_MONEY, 2600, ctx.player.id);
                        ctx.refreshUI();
                        scheduleGameTask(ctx.proceedEndTurn, 1200);
                    } else {
                        ctx.proceedEndTurn();
                    }
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
                const isDayaMinimi = String(ctx.player?.minimiPath || '').includes('Minimi_Daya');
                if (ctx.setWaitingAction) ctx.setWaitingAction(true);
                ctx.turnTimer.start(thinkTime);
                RuntimePopup.showChoicePopup(
                    isDayaMinimi ? (gText.DAYA_SELF_TAKE_TITLE || gText.DAYA_TAKE_TITLE) : gText.DAYA_TAKE_TITLE,
                    isDayaMinimi ? (gText.DAYA_SELF_TAKE_DESC || gText.DAYA_TAKE_DESC) : gText.DAYA_TAKE_DESC,
                    [
                        { text: `대여할래요 (${formatMoney(GAME_CONSTANTS.DAYA_TAKE)})`, color: '#e67e22', action: () => {
                            const prevOwner = ctx.tile.owner;
                            if (ctx.player.buyProperty(ctx.tile, 0, GAME_CONSTANTS.DAYA_TAKE)) {
                                prevOwner.money += GAME_CONSTANTS.DAYA_TAKE;
                                ctx.player.recordDayaHoldTurn(ctx.turnManager ? ctx.turnManager.globalTurn : null);
                                ctx.updateRender(); ctx.refreshUI();
                                RuntimePopup.showToast(
                                    `[${ctx.player.name}] ${gText.DAYA_TAKE_DONE}`,
                                    3400,
                                    null,
                                    {
                                        actorId: ctx.player.id,
                                        selfMessage: isDayaMinimi ? (gText.DAYA_SELF_TAKE_TOAST || gText.DAYA_TAKE_SELF_TOAST) : (gText.DAYA_TAKE_SELF_TOAST || '"되도록이면 깨끗하게 사용해주거라."'),
                                        otherMessage: `💎 ${ctx.player.name}님이 다야의 궁전을 대여했습니다!`,
                                        logMessage: `💎 ${ctx.player.name}님이 다야의 궁전을 대여하였습니다!`
                                    }
                                );
                            }
                            ctx.proceedEndTurn();
                        }},
                        { text: '거절할게요', color: '#e74c3c', action: ctx.proceedEndTurn }
                    ]
                );
                ctx.refreshUI();
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
        ctx.refreshUI(); RuntimePopup.showToast(`${text.TOAST_MOON} (+${formatMoney(bonus)})`, 3400, ctx.player.id); scheduleGameTask(ctx.proceedEndTurn, 2000);
    },

    // [차원 열쇠 카드 로직]
    handleCardTile: (ctx) => {
        const cText = getCardUIText();
        const gText = getGimmickText();
        const alertThinkTime = getPlayerThinkTime(ctx.player, GAME_CONSTANTS.ALERT_THINK_TIME || 5);
        const libraryThinkTime = getPlayerThinkTime(ctx.player);

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

            const isLibraryOwner = ctx.tiles[BOARD_TILES.LIBRARY].owner === ctx.player;
            const useLibraryAbility = isLibraryOwner || Boolean(ctx.player.hasLibraryBuff);

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
                    let altarHandled = false;
                    const finishAltarDraw = () => {
                        if (altarHandled) return;
                        altarHandled = true;
                        ctx.turnTimer.stop();
                        RuntimePopup.closeAll();
                        executeCardEffect(ctx, altarTreasure, onDrawDone, altarOpt);
                    };
                    ctx.turnTimer.start(useLibraryAbility ? libraryThinkTime : alertThinkTime, finishAltarDraw);
                    RuntimePopup.showNormalPopup(
                        gText.ALTAR_PORTAL_TITLE,
                        `${formatCardDisplayTitle(altarTreasure)}\n\n${altarTreasure.desc}`,
                        true,
                        finishAltarDraw,
                        {
                            confirmText: cText.BTN_CONFIRM,
                            titleColor: '#f1c40f'
                        }
                    );
                    return;
                }
                RuntimePopup.showToast(gText.ALTAR_PORTAL_TREASURE_EMPTY_TOAST, 2400, ctx.player.id);
            }

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
                ctx.turnTimer.start(libraryThinkTime, () => {
                    RuntimePopup.closeAll();
                    executeCardEffect(ctx, cards[0], onDrawDone);
                });
                const btnConfigs = cards.map((c, idx) => ({
                    row: idx + 1,
                    text: `${c.id >= 500 ? `${gText.LIBRARY_TREASURE_TAG} ` : ''}${formatCardDisplayTitle(c)}\n${c.desc}`,
                    color: getCardGradeTheme(c).buttonBg,
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

            let cardHandled = false;
            const finishCardDraw = () => {
                if (cardHandled) return;
                cardHandled = true;
                ctx.turnTimer.stop();
                RuntimePopup.closeAll();
                executeCardEffect(ctx, card, onDrawDone);
            };
            ctx.turnTimer.start(alertThinkTime, finishCardDraw);
            RuntimePopup.showNormalPopup(
                isDoubleDraw ? cText.CARD_DRAWN_DOUBLE : cText.CARD_DRAWN,
                `${formatCardDisplayTitle(card)}\n\n${card.desc}`,
                true,
                finishCardDraw,
                {
                    confirmText: cText.BTN_CONFIRM,
                    titleColor: '#f1c40f'
                }
            );
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
