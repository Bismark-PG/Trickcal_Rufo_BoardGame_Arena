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
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { getPlayerThinkTime } from './MarbleCardTreasure.js';
import { AIManager } from './MarbleAI.js';

const MAKASHA_SUPPORT_AMOUNT = 1000000; // 마카샤 생존 지원금 100만 엘드르 달러

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
        if (tradedCards.length > 0) {
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
            allPlayers.forEach(p => {
                if (!p.isBankrupt) {
                    p.money += MAKASHA_SUPPORT_AMOUNT;
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

            // 윤회를 얻은 플레이어를 제외한 모든 생존 플레이어가 마카샤로부터 100만 달러를 지급받음
            allPlayers.forEach(p => {
                if (p !== bossPlayer && !p.isBankrupt) {
                    p.money += MAKASHA_SUPPORT_AMOUNT;
                }
            });

            // 윤회 획득자는 망가진 제단으로 이동
            bossPlayer.pos = BOARD_TILES.ALTAR;
            popupDesc = `${gText.REQ_BRANCH_2_DESC}\n[${bossPlayer.name}]${gText.REQ_REINCARNATION}\n\n${gText.REQ_MAKASHA_SUPPORT}\n${gText.REQ_MAKASHA_EXCEPT_BOSS}\n\n${gText.REQ_SOOT_START}`;
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
            RuntimePopup.showToast(`${popupTitle} - ${gText.REQ_SOOT_START}`, 3200);
            scheduleGameTask(doneClimax, 2200);
        } else {
            if (ctx.turnTimer) ctx.turnTimer.start(getPlayerThinkTime(player), doneClimax);
            RuntimePopup.showNormalPopup(popupTitle, popupDesc, true, doneClimax);
        }
        return true;
    }
    return false;
}

// ==========================================
// 2. 차원 열쇠 카드(심판의 시간 / 교주의 염원)에 의한 [빛무리] 강제 전환 (기획서 24p, 25p, 34p)
// ==========================================
export function triggerHaloByCard(allPlayers, cardUser, stateType) {
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

    // 차원 열쇠 카드에 의해 강제 빛무리가 되었을 경우: [윤회] -> [죄업]으로 변화
    allPlayers.forEach(p => {
        if (p && p.isReincarnated) {
            p.isReincarnated = false;
            p.hasKarmaState = true;
        }
    });
    state.reincarnatedPlayer = null;

    RuntimePopup.showToast(gText.HALO_START_CARD, 3000);
}

// ==========================================
// 3. 플레이어 턴 시작 시 그을음/빛무리 잔여 턴 카운팅 및 상태 전환 (기획서 24~27p)
// ==========================================
export function advanceRequiemOnTurnStart(currentPlayer, globalTurn, allPlayers) {
    const gText = getGimmickText();
    const state = rq();

    // 20번째 턴 강제 종료 규칙 (단, 19번째 턴에 발동된 경우 발동 시점으로부터 1턴 보장 후 20번째 턴 진행 중 종료)
    if (globalTurn >= GAME_CONSTANTS.WORLD_GIMMICK_END_TURN) {
        const needsGuaranteedTurn19 = (state.gimmickTriggeredGlobalTurn === 19) && (state.isSootState || state.isHaloState);
        if (!needsGuaranteedTurn19 || currentPlayer.playerIndex === state.gimmickAnchorPlayerIndex) {
            if (state.isSootState || state.isHaloState) {
                clearAllRequiemStates(allPlayers);
                RuntimePopup.showToast(gText.TURN20_GIMMICK_CLEAR, 3000);
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
                        p.hasRegretState = true; // 자연 해제 시 [윤회] -> [후회]
                    }
                });
                state.reincarnatedPlayer = null;
                RuntimePopup.showToast(gText.HALO_START_NATURAL, 3500);
            }
        } else if (state.isHaloState) {
            state.haloRemainingTurns--;
            // 빛무리 2턴 경과 후 종료 -> 통상 또는 현재 글로벌 턴의 시간대(낮/밤)로 복귀
            if (state.haloRemainingTurns <= 0) {
                clearAllRequiemStates(allPlayers);
                RuntimePopup.showToast(gText.HALO_END_TOAST, 2500);
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

    const cost = Math.floor(player.money * 0.25);

    const executeDestroy = () => {
        player.money -= cost;
        const pool = [...enemyOwnedNormal];
        const destroyedNames = [];

        for (let i = 0; i < 2 && pool.length > 0; i++) {
            const randIdx = Math.floor(Math.random() * pool.length);
            const [targetTile] = pool.splice(randIdx, 1);
            const tName = getTileName(targetTile);

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
        }

        if (updateRender) updateRender();
        if (refreshUI) refreshUI();
        RuntimePopup.showToast(`${gText.REINCARNATION_DESTROY_DONE} ${destroyedNames.join(', ')}`, 3000);
        scheduleGameTask(onComplete, 1200);
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

export function getPositiveEffectMultiplier(player) {
    const state = rq();
    if (state.isHaloState && player && !player.hasRegretState && !player.hasKarmaState) {
        return 2.0;
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
