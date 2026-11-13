import { getDrawnTreasures, getAltarTradedCards } from './MarbleOdyssey.js';
import {
    RuntimePopup,
    formatMoney,
    getTileName,
    scheduleGameTask,
    getActiveWorld,
    getGimmickText
} from './MarbleRuntime.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { GAME_CONSTANTS, BUILDING_COSTS, MULTIPLIERS } from '../System/Index/Marble/MarblePriceIndex.js';
import { getPlayerThinkTime } from './MarbleCardTreasure.js';
import { AIManager } from './MarbleAI.js';

const MAKASHA_SUPPORT_AMOUNT = 1000000; // 마카샤 생존 지원금 100만 엘드르 달러

export function ensureSootPnlEntry(wm, player, forcedRole = null) {
    if (!wm || !player?.id) return null;
    if (!wm.sootPlayerPnl) wm.sootPlayerPnl = {};
    const derivedRole = forcedRole || (!rq().reincarnatedPlayer ? 'branch1' : (player.isReincarnated ? 'reincarnated' : 'opposed'));
    if (!wm.sootPlayerPnl[player.id]) {
        wm.sootPlayerPnl[player.id] = { name: player.name, role: derivedRole, cash: 0, destroyAsset: 0 };
    } else if (forcedRole) {
        wm.sootPlayerPnl[player.id].role = forcedRole;
    }
    return wm.sootPlayerPnl[player.id];
}

export function ensureHaloPnlEntry(wm, player) {
    if (!wm || !player?.id) return null;
    if (!wm.haloPlayerPnl) wm.haloPlayerPnl = {};
    let role = 'beneficiary_normal';
    if (player.hasKarmaState) role = 'karma';
    else if (player.hasRegretState) role = 'regret';
    else if (!wm.haloDebuffType) role = 'natural_uniform';
    else if (rq().haloTriggeredByCard && (player.hasDreamState || player.hasWishState)) role = 'beneficiary_special';

    if (!wm.haloPlayerPnl[player.id]) {
        wm.haloPlayerPnl[player.id] = {
            name: player.name,
            role,
            tollGain: 0,
            tollPayerDiff: 0,
            positiveGain: 0,
            lapBlockedLoss: 0
        };
    } else {
        wm.haloPlayerPnl[player.id].role = role;
    }
    return wm.haloPlayerPnl[player.id];
}

export function recordHaloPositiveGain(player, extraAmount) {
    const extra = Math.round(Number(extraAmount) || 0);
    if (!player || extra <= 0 || !rq().isHaloState) return;
    const wm = getActiveWorld()?.metrics;
    if (!wm) return;
    wm.haloPositiveGainTotal = (wm.haloPositiveGainTotal || 0) + extra;
    const entry = ensureHaloPnlEntry(wm, player);
    if (entry) entry.positiveGain += extra;
}

export function recordHaloLapBlocked(player, missedAmount) {
    const missed = Math.round(Number(missedAmount) || 0);
    if (!player || missed <= 0 || !rq().isHaloState) return;
    const wm = getActiveWorld()?.metrics;
    if (!wm) return;
    wm.haloLapBlockedLossTotal = (wm.haloLapBlockedLossTotal || 0) + missed;
    const entry = ensureHaloPnlEntry(wm, player);
    if (entry) entry.lapBlockedLoss += missed;
}

function getTileBaseTollCost(tile) {
    if (!tile || tile.type !== 'normal' || tile.level < 0) return 0;
    return tile.level === 0 ? (tile.basePrice || 0) : (BUILDING_COSTS[tile.side]?.[tile.level - 1] || tile.basePrice || 0);
}

function getTileSingleStepDropValue(tile) {
    if (!tile || tile.type !== 'normal' || tile.level < 0) return 0;
    const oldLv = tile.level;
    const newLv = oldLv === 4 ? 2 : (oldLv >= 1 ? oldLv - 1 : -1);
    const oldMult = MULTIPLIERS.SETTLEMENT[oldLv] + oldLv;
    const newMult = newLv >= 0 ? (MULTIPLIERS.SETTLEMENT[newLv] + newLv) : 0;
    return Math.max(0, Math.round((tile.basePrice || 0) * (oldMult - newMult)));
}

function initSootAnalyticsExpectations(wm, allPlayers, tiles, currentGlobalTurn, hasPriorAltarTrade, bossPlayer) {
    if (!wm) return;
    const survivingAll = (allPlayers || []).filter(p => p && !p.isBankrupt);
    const remSootTurns = Math.min(3, Math.max(1, GAME_CONSTANTS.WORLD_GIMMICK_END_TURN - currentGlobalTurn));

    if (hasPriorAltarTrade) {
        const n = survivingAll.length;
        const expMakasha = n * MAKASHA_SUPPORT_AMOUNT;
        const expLapBlocked = n * remSootTurns * (6.7 / 40) * GAME_CONSTANTS.START_BONUS;
        const expDiscount = n * remSootTurns * 0.25 * 350000;
        const expBranch1 = Math.round(expMakasha + expDiscount - expLapBlocked);
        wm.sootExpectedBranch1Sum = (wm.sootExpectedBranch1Sum || 0) + expBranch1;
        wm.sootExpectedNetSum = (wm.sootExpectedNetSum || 0) + expBranch1;
        return;
    }

    const oppCount = Math.max(0, survivingAll.length - (bossPlayer && !bossPlayer.isBankrupt ? 1 : 0));
    const normalTiles = Array.isArray(tiles) ? tiles.filter(t => t && t.type === 'normal' && t.level >= 0 && t.owner) : [];
    const bossTiles = normalTiles.filter(t => t.owner === bossPlayer);
    const oppTiles = normalTiles.filter(t => t.owner && t.owner !== bossPlayer);

    const bossSootTollSum = bossTiles.reduce((sum, t) => sum + Math.round(getTileBaseTollCost(t) * 0.8), 0);
    const expBossExtraToll = oppCount * remSootTurns * (1 / 40) * bossSootTollSum;
    const avgEnemyDrop = oppTiles.length > 0
        ? oppTiles.reduce((sum, t) => sum + getTileSingleStepDropValue(t), 0) / oppTiles.length
        : 500000;
    const oppLv2Ratio = oppTiles.length > 0
        ? (oppTiles.filter(t => t.level >= 2).length / oppTiles.length)
        : 0;
    const skillProb = oppTiles.length > 0
        ? (oppLv2Ratio >= 0.75 ? 0.80 : (oppLv2Ratio >= 0.50 ? 0.55 : 0.20))
        : 0;
    const expectedSkillCasts = oppTiles.length > 0 ? Math.min(remSootTurns, 2) * skillProb : 0;
    const expSkillBurn = (oppTiles.length > 0 && bossPlayer)
        ? Math.floor(Math.max(0, bossPlayer.money) * GAME_CONSTANTS.REINCARNATION_SKILL_COST_RATE) * expectedSkillCasts
        : 0;
    const expDestroyLoss = expectedSkillCasts * 2 * avgEnemyDrop;

    const expOppMakasha = oppCount * MAKASHA_SUPPORT_AMOUNT;
    const expOppLapBlocked = oppCount * remSootTurns * (6.7 / 40) * GAME_CONSTANTS.START_BONUS;
    const expOppDiscount = oppCount * remSootTurns * 0.25 * 350000;

    const expBossCrown = remSootTurns * 150000;
    const expBossNet = Math.round(expBossExtraToll + expBossCrown - expSkillBurn);
    const expOppNet = Math.round(expOppMakasha + expOppDiscount - expOppLapBlocked - expBossExtraToll - expDestroyLoss);
    wm.sootExpectedBossNet = (wm.sootExpectedBossNet || 0) + expBossNet;
    wm.sootExpectedBossToll = (wm.sootExpectedBossToll || 0) + Math.round(expBossExtraToll);
    wm.sootExpectedDestroyLoss = (wm.sootExpectedDestroyLoss || 0) + Math.round(expDestroyLoss);
    wm.sootExpectedOpposedNet = (wm.sootExpectedOpposedNet || 0) + expOppNet;
    wm.sootExpectedNetSum = (wm.sootExpectedNetSum || 0) + expBossNet + expOppNet;
}

function initHaloAnalyticsExpectation(wm, allPlayers, tiles, currentGlobalTurn, isByCard) {
    if (!wm) return;
    const survivingAll = (allPlayers || []).filter(p => p && !p.isBankrupt);
    if (survivingAll.length === 0) return;

    const debuffedPlayer = survivingAll.find(p => p.hasKarmaState || p.hasRegretState) || null;
    const debuffType = debuffedPlayer ? (debuffedPlayer.hasKarmaState ? 'karma' : 'regret') : null;
    wm.haloBranchMode = isByCard ? 'card' : (debuffedPlayer ? 'natural_after_boss' : 'natural_no_boss');
    wm.haloDebuffType = debuffType;
    wm.haloDebuffedPlayerId = debuffedPlayer?.id || null;
    wm.haloDebuffedPlayerName = debuffedPlayer?.name || null;

    survivingAll.forEach(p => ensureHaloPnlEntry(wm, p));

    const remHaloTurns = Math.min(2, Math.max(1, GAME_CONSTANTS.WORLD_GIMMICK_END_TURN - currentGlobalTurn));
    const normalTiles = Array.isArray(tiles) ? tiles.filter(t => t && t.type === 'normal' && t.level >= 0 && t.owner && !t.owner.isBankrupt) : [];
    const posExtraFactor = Math.max(0, getHaloPositiveMultiplier() - 1.0);
    const posUpliftPerBeneficiaryTurn = posExtraFactor * ((6.7 / 40) * GAME_CONSTANTS.START_BONUS + 80000);
    const lapLossPerDebuffedTurn = (6.7 / 40) * GAME_CONSTANTS.START_BONUS;

    const getEstNormalToll = (t) => {
        const mult = MULTIPLIERS.BUILDING[t.level] + (t.isSpecialToll ? MULTIPLIERS.SPECIAL_TILE : 0);
        return Math.round(getTileBaseTollCost(t) * Math.max(0.5, mult));
    };

    const otherCount = Math.max(0, survivingAll.length - 1);
    let expDebuffedNet = 0;
    let expOpposedNet = 0;

    survivingAll.forEach(p => {
        const myTiles = normalTiles.filter(t => t.owner === p);
        if (p === debuffedPlayer) {
            let tollDiff = 0;
            if (p.hasKarmaState) {
                const karmaBaseSum = myTiles.reduce((s, t) => s + Math.round(getTileBaseTollCost(t) * 0.5), 0);
                tollDiff -= otherCount * remHaloTurns * (1 / 40) * karmaBaseSum;
            } else if (p.hasRegretState) {
                const enemyBaseSum = normalTiles.filter(t => t.owner !== p).reduce((s, t) => s + Math.round(getTileBaseTollCost(t) * 0.5), 0);
                tollDiff -= remHaloTurns * (1 / 40) * enemyBaseSum;
            }
            expDebuffedNet += Math.round(tollDiff - remHaloTurns * lapLossPerDebuffedTurn);
        } else {
            const isSpecial = isByCard && (p.hasDreamState || p.hasWishState);
            const recvBonusRate = isSpecial ? 1.0 : 0.5;
            const myTollSum = myTiles.reduce((s, t) => s + getEstNormalToll(t), 0);
            const expExtraRecv = otherCount * remHaloTurns * (1 / 40) * (recvBonusRate * myTollSum);
            let expRegretBonus = 0;
            if (debuffType === 'regret') {
                expRegretBonus = remHaloTurns * (1 / 40) * myTiles.reduce((s, t) => s + Math.round(getTileBaseTollCost(t) * 0.5 * (1 + recvBonusRate)), 0);
            }
            let expKarmaSave = 0;
            if (debuffType === 'karma' && debuffedPlayer) {
                const karmaTiles = normalTiles.filter(t => t.owner === debuffedPlayer);
                expKarmaSave = remHaloTurns * (1 / 40) * karmaTiles.reduce((s, t) => s + Math.round(getTileBaseTollCost(t) * 0.5), 0);
            }
            expOpposedNet += Math.round(expExtraRecv + expRegretBonus + expKarmaSave + remHaloTurns * posUpliftPerBeneficiaryTurn);
        }
    });

    wm.haloExpectedDebuffedNet = (wm.haloExpectedDebuffedNet || 0) + expDebuffedNet;
    wm.haloExpectedOpposedNet = (wm.haloExpectedOpposedNet || 0) + expOpposedNet;
    wm.haloExpectedTotalNet = (wm.haloExpectedTotalNet || 0) + expDebuffedNet + expOpposedNet;
}

function rq() {
    return getActiveWorld().requiem;
}

export const RequiemState = {
    get hasSootEverTriggered() { return rq().hasSootEverTriggered; },
    set hasSootEverTriggered(v) { rq().hasSootEverTriggered = v; },

    get isSootState() { return rq().isSootState; },
    set isSootState(v) { rq().isSootState = v; },

    get isHaloState() { return rq().isHaloState; },
    set isHaloState(v) { rq().isHaloState = v; },

    get sootRemainingTurns() { return rq().sootRemainingTurns; },
    set sootRemainingTurns(v) { rq().sootRemainingTurns = v; },

    get haloRemainingTurns() { return rq().haloRemainingTurns; },
    set haloRemainingTurns(v) { rq().haloRemainingTurns = v; },

    get haloTriggeredByCard() { return rq().haloTriggeredByCard; },
    set haloTriggeredByCard(v) { rq().haloTriggeredByCard = v; },

    get gimmickAnchorPlayerIndex() { return rq().gimmickAnchorPlayerIndex; },
    set gimmickAnchorPlayerIndex(v) { rq().gimmickAnchorPlayerIndex = v; },

    get gimmickTriggeredGlobalTurn() { return rq().gimmickTriggeredGlobalTurn; },
    set gimmickTriggeredGlobalTurn(v) { rq().gimmickTriggeredGlobalTurn = v; },

    get justTriggeredThisTurn() { return rq().justTriggeredThisTurn; },
    set justTriggeredThisTurn(v) { rq().justTriggeredThisTurn = v; },

    get reincarnatedPlayer() { return rq().reincarnatedPlayer; },
    set reincarnatedPlayer(v) { rq().reincarnatedPlayer = v; }
};

export function resetRequiemState() {
    const state = rq();
    state.hasSootEverTriggered = false;
    state.isSootState = false;
    state.isHaloState = false;
    state.sootRemainingTurns = 0;
    state.haloRemainingTurns = 0;
    state.haloTriggeredByCard = false;
    state.gimmickAnchorPlayerIndex = 1;
    state.gimmickTriggeredGlobalTurn = 0;
    state.justTriggeredThisTurn = false;
    state.reincarnatedPlayer = null;
}

// 모든 그을음/빛무리 및 파생 플레이어 상태 초기화
export function clearAllRequiemStates(allPlayers = []) {
    const state = rq();
    state.isSootState = false;
    state.isHaloState = false;
    state.sootRemainingTurns = 0;
    state.haloRemainingTurns = 0;
    state.haloTriggeredByCard = false;
    state.justTriggeredThisTurn = false;
    state.reincarnatedPlayer = null;

    allPlayers.forEach(p => {
        if (!p) return;
        p.isReincarnated = false;
        p.hasKarmaState = false;
        p.hasRegretState = false;
        p.hasWishState = false;
        p.hasDreamState = false;
        p.bowExtraRollAvailable = false;
    });
}

// ==========================================
// 1. 보물 카드 6장 수집 시 [그을음] 발동 및 2개 분기 처리 (기획서 24p, 37p)
// ==========================================
export function checkAndTriggerClimax(ctx) {
    const { player, allPlayers, updateRender, refreshUI, proceedEndTurn, turnManager } = ctx;
    const gText = getGimmickText();
    const currentGlobalTurn = turnManager ? turnManager.globalTurn : 1;
    const state = rq();
    const drawnTreasures = getDrawnTreasures();
    const tradedCards = getAltarTradedCards();

    // 기획서 26p: 그을음은 20번째 턴에서는 발동되지 않음
    if (currentGlobalTurn >= GAME_CONSTANTS.WORLD_GIMMICK_END_TURN) return false;

    // 세상에 나온 보물이 6장이고, 아직 그을음이 한 번도 안 터졌다면 발동
    if (drawnTreasures.size >= 6 && !state.hasSootEverTriggered) {
        if (ctx.turnTimer) ctx.turnTimer.stop();
        ctx.isWaitingAction = true;

        state.hasSootEverTriggered = true;
        state.isSootState = true;
        state.isHaloState = false;
        state.sootRemainingTurns = 3; // 그을음 최대 3턴 유지
        state.gimmickAnchorPlayerIndex = player.playerIndex;
        state.gimmickTriggeredGlobalTurn = currentGlobalTurn;
        state.justTriggeredThisTurn = true;

        let popupTitle = gText.REQ_CLIMAX_TITLE;
        let popupDesc = '';

        // ==========================================
        // 분기 1: 망가진 제단에 보물 카드가 1개라도 교환된 적이 있을 경우 (윤회 공석 분기)
        // ==========================================
        const hasPriorAltarTrade = tradedCards.length > 0;
        if (hasPriorAltarTrade) {
            state.reincarnatedPlayer = null;

            // 마지막(6번째) 보물 획득자는 망가진 제단으로 강제 이동
            player.pos = BOARD_TILES.ALTAR;

            // 망가진 제단이 모든 플레이어에게서 보물 카드를 강제 회수
            allPlayers.forEach(p => {
                if (p.treasureCards && p.treasureCards.length > 0) {
                    tradedCards.push(...p.treasureCards);
                    p.treasureCards = [];
                    p.bowExtraRollAvailable = false;
                }
            });

            // 모든 생존 플레이어가 마카샤로부터 100만 달러를 지급받음
            const wm1 = getActiveWorld()?.metrics;
            allPlayers.forEach(p => {
                if (!p.isBankrupt) {
                    p.money += MAKASHA_SUPPORT_AMOUNT;
                    if (wm1) {
                        wm1.sootMakashaTotal = (wm1.sootMakashaTotal || 0) + MAKASHA_SUPPORT_AMOUNT;
                        ensureSootPnlEntry(wm1, p, 'branch1').cash += MAKASHA_SUPPORT_AMOUNT;
                    }
                }
            });

            popupDesc = `${gText.REQ_BRANCH_1_DESC}\n\n${gText.REQ_MAKASHA_SUPPORT}\n\n${gText.REQ_SOOT_START}`;
        }
        // ==========================================
        // 분기 2: 망가진 제단에 보물이 교환된 적이 없는 경우 (윤회 존재 분기)
        // ==========================================
        else {
            // 가장 많은 보물 카드를 소유한 플레이어 탐색 (동점 시 제일 처음 보물 카드를 획득한 firstTreasureTurn 기준)
            let bossPlayer = allPlayers[0];
            allPlayers.forEach(p => {
                if (p.isBankrupt) return;
                if (p.treasureCards.length > bossPlayer.treasureCards.length) {
                    bossPlayer = p;
                } else if (p.treasureCards.length === bossPlayer.treasureCards.length) {
                    if (p.firstTreasureTurn !== -1 && (bossPlayer.firstTreasureTurn === -1 || p.firstTreasureTurn < bossPlayer.firstTreasureTurn)) {
                        bossPlayer = p;
                    }
                }
            });

            state.reincarnatedPlayer = bossPlayer;
            bossPlayer.isReincarnated = true; // [윤회] 상태 부여

            // 모든 플레이어의 보물 카드는 로직상 분기 1과 동일하게 소멸 (단, UI 연출용으로만 그을음 종료 시까지 6개 표시)
            allPlayers.forEach(p => {
                if (p.treasureCards && p.treasureCards.length > 0) {
                    tradedCards.push(...p.treasureCards);
                    p.treasureCards = [];
                    p.bowExtraRollAvailable = false;
                }
            });
            // 분기 2 [윤회] 보유자는 501·502·503 포지티브 패시브 효과를 그을음 동안 유지
            bossPlayer.bowExtraRollAvailable = true;

            // 윤회를 얻은 플레이어를 제외한 모든 생존 플레이어가 마카샤로부터 100만 달러를 지급받음
            const wm2 = getActiveWorld()?.metrics;
            allPlayers.forEach(p => {
                if (!p.isBankrupt && wm2) {
                    ensureSootPnlEntry(wm2, p, p === bossPlayer ? 'reincarnated' : 'opposed');
                }
                if (p !== bossPlayer && !p.isBankrupt) {
                    p.money += MAKASHA_SUPPORT_AMOUNT;
                    if (wm2) {
                        wm2.sootMakashaTotal = (wm2.sootMakashaTotal || 0) + MAKASHA_SUPPORT_AMOUNT;
                        ensureSootPnlEntry(wm2, p, 'opposed').cash += MAKASHA_SUPPORT_AMOUNT;
                    }
                }
            });

            // 윤회 획득자는 망가진 제단으로 이동
            bossPlayer.pos = BOARD_TILES.ALTAR;
            popupDesc = `${gText.REQ_BRANCH_2_DESC}\n[${bossPlayer.name}]${gText.REQ_REINCARNATION}\n\n${gText.REQ_MAKASHA_SUPPORT}\n${gText.REQ_MAKASHA_EXCEPT_BOSS}\n\n${gText.REQ_SOOT_START}`;
        }

        const worldMetrics = getActiveWorld()?.metrics;
        if (worldMetrics) {
            worldMetrics.sootTriggerCount++;
            worldMetrics.sootBranch = hasPriorAltarTrade ? 1 : 2;
            worldMetrics.reincarnatedPlayerName = state.reincarnatedPlayer?.name || null;
            initSootAnalyticsExpectations(worldMetrics, allPlayers, ctx.tiles, currentGlobalTurn, hasPriorAltarTrade, state.reincarnatedPlayer);
        }

        if (updateRender) updateRender();
        if (refreshUI) refreshUI();

        const doneClimax = () => {
            if (ctx.turnTimer) ctx.turnTimer.stop();
            RuntimePopup.closeAll();
            if (refreshUI) refreshUI();
            if (proceedEndTurn) proceedEndTurn();
        };

        if (player.isAi()) {
            RuntimePopup.showToast(`${popupTitle} - ${gText.REQ_SOOT_START}`, 4200);
            scheduleGameTask(doneClimax, 2800);
        } else {
            if (ctx.turnTimer) ctx.turnTimer.start(Math.max(15, getPlayerThinkTime(player)), doneClimax);
            RuntimePopup.showNormalPopup(popupTitle, popupDesc, true, doneClimax);
        }
        return true;
    }
    return false;
}

// ==========================================
// 2. 차원 열쇠 카드(심판의 시간 / 교주의 염원)에 의한 [빛무리] 강제 전환 (기획서 24p, 25p, 34p)
// ==========================================
export function triggerHaloByCard(allPlayers, cardUser, stateType, ctx = null) {
    const gText = getGimmickText();
    const state = rq();

    state.isSootState = false;
    state.isHaloState = true;
    state.sootRemainingTurns = 0;
    state.haloRemainingTurns = 2; // 빛무리 최대 2턴 유지
    state.haloTriggeredByCard = true;
    state.gimmickAnchorPlayerIndex = cardUser ? cardUser.playerIndex : 1;
    state.justTriggeredThisTurn = true;

    // 심판의 시간 -> 몽환살이 / 교주의 염원 -> 염원살이
    if (cardUser) {
        if (stateType === 'dream') cardUser.hasDreamState = true;
        else if (stateType === 'wish') cardUser.hasWishState = true;
    }

    // 차원 열쇠 카드에 의해 강제 빛무리가 되었을 경우: [윤회] -> [죄업]으로 변화 (보물 패시브 즉시 소멸)
    allPlayers.forEach(p => {
        if (p && p.isReincarnated) {
            p.isReincarnated = false;
            p.hasKarmaState = true;
            p.bowExtraRollAvailable = false;
        }
    });
    state.reincarnatedPlayer = null;

    const worldMetrics = getActiveWorld()?.metrics;
    if (worldMetrics) {
        worldMetrics.haloCardCount++;
        const currentTurn = ctx?.turnManager ? ctx.turnManager.globalTurn : (state.gimmickTriggeredGlobalTurn || 1);
        initHaloAnalyticsExpectation(worldMetrics, allPlayers, ctx?.tiles || [], currentTurn, true);
    }
    const actorPrefix = cardUser?.name ? `[${cardUser.name}] ` : '';
    RuntimePopup.showToast(`${actorPrefix}${gText.HALO_START_CARD}`, 3800);
}

// ==========================================
// 3. 플레이어 턴 시작 시 그을음/빛무리 잔여 턴 카운팅 및 상태 전환 (기획서 24~27p)
// ==========================================
export function advanceRequiemOnTurnStart(currentPlayer, globalTurn, allPlayers, tiles = null) {
    const gText = getGimmickText();
    const state = rq();

    // 20번째 턴 강제 종료 규칙 (단, 19번째 턴에 발동된 경우 발동 시점으로부터 1턴 보장 후 20번째 턴 진행 중 종료)
    if (globalTurn >= GAME_CONSTANTS.WORLD_GIMMICK_END_TURN) {
        const needsGuaranteedTurn19 = (state.gimmickTriggeredGlobalTurn === 19) && (state.isSootState || state.isHaloState);
        if (!needsGuaranteedTurn19 || currentPlayer.playerIndex === state.gimmickAnchorPlayerIndex) {
            if (state.isSootState || state.isHaloState) {
                clearAllRequiemStates(allPlayers);
                RuntimePopup.showToast(gText.TURN20_GIMMICK_CLEAR, 3800);
            }
            return;
        }
    }

    if (!state.isSootState && !state.isHaloState) return;

    // 발동 직후 첫 앵커 턴은 차감 스킵
    if (state.justTriggeredThisTurn) {
        state.justTriggeredThisTurn = false;
        return;
    }

    // 발동된 시점의 플레이어(anchor)에게 턴이 돌아올 때마다 1턴 경과 카운팅
    if (currentPlayer.playerIndex === state.gimmickAnchorPlayerIndex) {
        if (state.isSootState) {
            state.sootRemainingTurns--;
            // 3턴이 경과하여 그을음이 자연 해제 -> 4번째 턴부터 빛무리(2턴) 시작 및 [윤회] -> [후회] 전환
            if (state.sootRemainingTurns <= 0) {
                state.isSootState = false;
                state.isHaloState = true;
                state.haloRemainingTurns = 2;
                state.haloTriggeredByCard = false;

                allPlayers.forEach(p => {
                    if (p && p.isReincarnated) {
                        p.isReincarnated = false;
                        p.hasRegretState = true; // 자연 해제 시 [윤회] -> [후회] (보물 패시브 즉시 소멸)
                        p.bowExtraRollAvailable = false;
                    }
                });
                state.reincarnatedPlayer = null;
                const worldMetrics = getActiveWorld()?.metrics;
                if (worldMetrics) {
                    worldMetrics.haloNaturalCount++;
                    initHaloAnalyticsExpectation(worldMetrics, allPlayers, tiles || [], globalTurn, false);
                }
                RuntimePopup.showToast(gText.HALO_START_NATURAL, 4000);
            }
        } else if (state.isHaloState) {
            state.haloRemainingTurns--;
            // 빛무리 2턴 경과 후 종료 -> 통상 또는 현재 글로벌 턴의 시간대(낮/밤)로 복귀
            if (state.haloRemainingTurns <= 0) {
                clearAllRequiemStates(allPlayers);
                RuntimePopup.showToast(gText.HALO_END_TOAST, 3200);
            }
        }
    }
}

// ==========================================
// 4. [윤회] 상태 플레이어 매 턴 영토 파괴 권능 (기획서 25p)
// ==========================================
export function handleReincarnationTurnSkill(ctx, onComplete) {
    const { player, tiles, turnTimer, updateRender, refreshUI } = ctx;
    const gText = getGimmickText();
    const state = rq();

    if (!state.isSootState || !player.isReincarnated || player.money <= 0) {
        onComplete();
        return;
    }

    // 파괴 가능한 영토: 상대방 소유 일반 영토 우선, 부족하면 전체 소유된 일반 영토 포함
    const enemyOwnedNormal = tiles.filter(t => t.type === 'normal' && t.owner && t.owner !== player);
    if (enemyOwnedNormal.length === 0) {
        onComplete();
        return;
    }

    const cost = Math.floor(player.money * GAME_CONSTANTS.REINCARNATION_SKILL_COST_RATE);

    const executeDestroy = () => {
        player.money -= cost;
        const wmSkill = getActiveWorld()?.metrics;
        if (wmSkill) {
            wmSkill.sootSkillCostTotal = (wmSkill.sootSkillCostTotal || 0) + cost;
            const bossEntry = ensureSootPnlEntry(wmSkill, player);
            if (bossEntry) bossEntry.cash -= cost;
        }
        const pool = [...enemyOwnedNormal];
        const destroyedNames = [];

        for (let i = 0; i < 2 && pool.length > 0; i++) {
            const randIdx = Math.floor(Math.random() * pool.length);
            const [targetTile] = pool.splice(randIdx, 1);
            const tName = getTileName(targetTile);
            const oldOwner = targetTile.owner;
            const oldLv = targetTile.level;

            if (targetTile.level === 4) {
                // 엘리프 조각상이 있을 경우 건설 단계 2단계 하락 (4 -> 2)
                targetTile.level = 2;
                destroyedNames.push(`${tName}(2${gText.REINCARNATION_DESTROY_DOWN})`);
            } else if (targetTile.level >= 1) {
                // 건물이 있을 경우 건설 단계 1단계 하락
                targetTile.level -= 1;
                destroyedNames.push(`${tName}(1${gText.REINCARNATION_DESTROY_DOWN})`);
            } else {
                // 건물이 없다면 소유자는 해당 영토를 상실
                if (targetTile.owner) targetTile.owner.territoryCount--;
                targetTile.owner = null;
                targetTile.level = -1;
                destroyedNames.push(`${tName}(${gText.REINCARNATION_DESTROY_LOST})`);
            }

            if (wmSkill && oldOwner && oldLv >= 0) {
                const oldMult = MULTIPLIERS.SETTLEMENT[oldLv] + oldLv;
                const newMult = targetTile.level >= 0 ? (MULTIPLIERS.SETTLEMENT[targetTile.level] + targetTile.level) : 0;
                const lostVal = Math.max(0, Math.round(targetTile.basePrice * (oldMult - newMult)));
                wmSkill.sootDestroyValueTotal = (wmSkill.sootDestroyValueTotal || 0) + lostVal;
                const vEntry = ensureSootPnlEntry(wmSkill, oldOwner);
                if (vEntry) vEntry.destroyAsset -= lostVal;
            }
        }

        if (updateRender) updateRender();
        if (refreshUI) refreshUI();
        RuntimePopup.showToast(`[${player.name}] ${gText.REINCARNATION_DESTROY_DONE} ${destroyedNames.join(', ')}`, 3600);
        scheduleGameTask(onComplete, 1400);
    };

    if (player.isAi()) {
        if (AIManager.decideReincarnationSkill(player, tiles, ctx.allPlayers)) {
            executeDestroy();
        } else {
            onComplete();
        }
        return;
    }

    turnTimer.start(getPlayerThinkTime(player), () => {
        RuntimePopup.closeAll();
        onComplete();
    });

    RuntimePopup.showChoicePopup(
        gText.REINCARNATION_DESTROY_TITLE,
        `${gText.REINCARNATION_DESTROY_DESC}\n\n${gText.BBANGJU_TAKE_COST_LABEL} ${formatMoney(cost)}`,
        [
            {
                text: `${gText.BTN_ACCEPT} (${formatMoney(cost)})`,
                color: '#e74c3c',
                action: () => {
                    turnTimer.stop();
                    RuntimePopup.closeAll();
                    executeDestroy();
                }
            },
            {
                text: gText.BTN_REJECT,
                color: '#7f8c8d',
                action: () => {
                    turnTimer.stop();
                    RuntimePopup.closeAll();
                    onComplete();
                }
            }
        ]
    );
}

// ==========================================
// 5. 그을음 / 빛무리 / 상태별 수치 및 제약 계산 헬퍼 (기획서 24~25p)
// ==========================================

export function canPlayerUseBbangju(player) {
    const state = rq();
    if (state.isSootState) return !!(player && player.isReincarnated);
    if (state.isHaloState && player && (player.hasRegretState || player.hasKarmaState)) return false;
    return true;
}

export function canPlayerReceiveLapBonus(player) {
    const state = rq();
    if (state.isSootState) return !!(player && player.isReincarnated);
    if (state.isHaloState && player && (player.hasRegretState || player.hasKarmaState)) return false;
    return true;
}

export function getHaloPositiveMultiplier() {
    const raw = Number(getActiveWorld()?.haloPositiveMult ?? GAME_CONSTANTS.HALO_POSITIVE_MULT ?? 2.0);
    return Number.isFinite(raw) && raw >= 1 ? raw : 2.0;
}

export function getPositiveEffectMultiplier(player) {
    const state = rq();
    if (state.isHaloState && player && !player.hasRegretState && !player.hasKarmaState) {
        return getHaloPositiveMultiplier();
    }
    return 1.0;
}

export function getRequiemPurchaseMultiplier(player) {
    const state = rq();
    if (state.isSootState && (!player || !player.isReincarnated)) {
        return 0.5;
    }
    return 1.0;
}

export function getRequiemTollPayerDelta(tile, payer) {
    const state = rq();
    let delta = 0;

    if (state.isSootState) {
        if (tile && tile.owner && tile.owner.isReincarnated) {
            delta += 0.3;
        }
        if (!payer || !payer.isReincarnated) {
            delta += 0.5;
        }
    }

    if (state.isHaloState) {
        if (tile && tile.owner && tile.owner.hasKarmaState) {
            delta -= 0.5;
        }
        if (payer && payer.hasRegretState) {
            delta += 0.5;
        }
    }

    return delta;
}

export function getRequiemTollReceiverMultiplier(owner) {
    const state = rq();
    if (!state.isHaloState || !owner) return 1.0;
    if (owner.hasKarmaState || owner.hasRegretState) return 1.0;

    let recvDelta = 0.5;
    if (state.haloTriggeredByCard && (owner.hasWishState || owner.hasDreamState)) {
        recvDelta += 0.5;
    }
    return 1.0 + recvDelta;
}
