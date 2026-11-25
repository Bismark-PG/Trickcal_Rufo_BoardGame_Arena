// ProgramFiles/Game/Marble/MarbleCardNormal.js
import {
    RuntimePopup,
    formatMoney,
    getTileName,
    scheduleGameTask,
    getActiveWorld,
    getCardUIText,
    getMarbleText,
    getGimmickText
} from './MarbleRuntime.js';
import { CARD_IDS } from '../../System/Index/Marble/MarbleCardIndex.js';
import { BOARD_TILES } from '../../System/Index/Marble/MarbleBoardIndex.js';
import { GAME_CONSTANTS, BUILDING_COSTS, resolveLapBaseBonus, stepActiveBoardPos } from '../../System/Index/Marble/MarblePriceIndex.js';
import {
    RequiemState,
    canPlayerReceiveLapBonus,
    getPositiveEffectMultiplier,
    ensureSootPnlEntry,
    recordHaloPositiveGain,
    recordHaloLapBlocked
} from './MarbleRequiem.js';
import { getPlayerThinkTime } from './MarbleCardTreasure.js';
import { AIManager } from './MarbleAI.js';
import { buildCardActivationToast } from '../../System/Index/Marble/MarbleCardToastIndex.js';

// 진행 순서 및 누적 순회 콤보 기반 기본 순회 보상 산출 ([109] 보유 시 1.5배)
export function getBaseStartBonusForPlayer(player) {
    if (!player) return GAME_CONSTANTS.START_BONUS;
    const idx = Math.max(0, (Number(player.playerIndex) || 1) - 1);
    const priorLaps = Number(player.tracker?.lapPassCount) || 0;
    const rawBase = resolveLapBaseBonus(idx, Boolean(player.hasFirstLapPassed), priorLaps, getActiveWorld()?.gameMode);
    const hasSmuggler = Boolean(player.buffs?.['hold_start_buff'] && player.buffs['hold_start_buff'].length > 0);
    return hasSmuggler ? Math.round(rawBase * 1.5) : rawBase;
}

// 순회 보상 산출 헬퍼 (그을음/후회/죄업 시 0원, 암거래상의 증표(109) 보유 시 1.5배, 빛무리 시 2배)
export function getStartPassBonus(player) {
    if (!canPlayerReceiveLapBonus(player)) return 0;
    const baseBonus = getBaseStartBonusForPlayer(player);
    return Math.round(baseBonus * getPositiveEffectMultiplier(player));
}

// 시작점(순회) 통과 보상 지급 및 통과 통계 기록 공통 헬퍼
export function applyLapPassBonus(player, options = {}) {
    if (!player) return 0;
    const {
        showBlockedToast = true,
        label = getCardUIText().MOVE_START_BONUS,
        duration = 3200,
        blockedDuration = 3000,
        targetPlayerId = null
    } = options;

    // 순회 보상/콤보 티어는 이번 통과 직전 누적 통과 횟수(priorLaps)와 첫 바퀴 여부로 산출한 뒤 카운트를 갱신한다.
    const missedBase = getBaseStartBonusForPlayer(player);
    const startBonus = getStartPassBonus(player);
    if (player.tracker) player.tracker.lapPassCount++;
    player.hasFirstLapPassed = true;

    if (startBonus > 0) {
        if (player.tracker) player.tracker.lapBonusCount++;
        player.money += startBonus;
        if (RequiemState.isHaloState && getPositiveEffectMultiplier(player) > 1) {
            const extra = startBonus - Math.round(startBonus / getPositiveEffectMultiplier(player));
            recordHaloPositiveGain(player, extra);
        }
        RuntimePopup.showToast(
            `[${player.name}]님이 순회 보너스 획득!`,
            duration,
            targetPlayerId,
            targetPlayerId ? null : {
                actorId: player.id,
                selfMessage: `시작 지점 통과! 순회 보너스 ${formatMoney(startBonus)} 획득!`,
                otherMessage: `[${player.name}]님이 순회 보너스 획득!`,
                logMessage: `[${player.name}] 시작 지점 통과! 순회 보너스 획득! (+${formatMoney(startBonus)})`
            }
        );
        return startBonus;
    }

    if (player.tracker) player.tracker.lapBlockedCount++;
    const missed = missedBase;
    if (RequiemState.isSootState) {
        const wm = getActiveWorld()?.metrics;
        if (wm) {
            wm.sootLapBlockedLossTotal = (wm.sootLapBlockedLossTotal || 0) + missed;
            const entry = ensureSootPnlEntry(wm, player);
            if (entry) entry.cash -= missed;
        }
    } else if (RequiemState.isHaloState) {
        recordHaloLapBlocked(player, missed);
    }
    if (showBlockedToast) {
        const gText = getGimmickText();
        const blockedMsg = RequiemState.isSootState ? gText.LAP_BONUS_BLOCKED_SOOT : gText.LAP_BONUS_BLOCKED_STATE;
        RuntimePopup.showToast(`[${player.name}] ${blockedMsg}`, blockedDuration, targetPlayerId);
    }
    return 0;
}

// 다야의 궁전 소유자가 되었을 때 '서열 2위의 특권(34)' 자동 파괴 체크
export function checkAndDestroyRank2Privilege(player, tiles) {
    if (tiles[BOARD_TILES.DAYA].owner !== player) return;
    if (player.buffs['hold_immune']) {
        const idx = player.buffs['hold_immune'].findIndex(c => c.id === CARD_IDS.RANK_2_PRIVILEGE);
        if (idx > -1) {
            player.buffs['hold_immune'].splice(idx, 1);
            const uiText = getCardUIText();
            RuntimePopup.showToast(uiText.CARD_DESTROYED_RANK2, 3200, player.id);
        }
    }
}

// 영토 순수 투자 원금(매입가 + 현재 건물 건설비 1.0배) 산출 헬퍼 (강제 매각 / 골디의 제안 기준가)
export function getTileFullInvestedValue(tile) {
    if (tile.level < 0) return 0;
    return tile.level === 0
        ? tile.basePrice
        : tile.basePrice + BUILDING_COSTS[tile.side][tile.level - 1];
}

// ==========================================
// 1. 일반 카드 뽑기 시 발동/보유/저장 실행기 (ID: 1 ~ 47)
// ==========================================
export function executeNormalCard(ctx, card, onComplete = null) {
    const p = ctx.player;
    const uiText = getCardUIText();
    const gText = getGimmickText();
    const finish = onComplete || ctx.proceedEndTurn;
    const posMult = getPositiveEffectMultiplier(p);

    switch (card.actionType) {
        // [1 ~ 14] 지정된 칸으로 이동 (특수 칸 이동 / 일반 칸 이동 + 지원금)
        case "move_fixed": {
            const actualBonus = card.bonusMoney > 0 ? Math.round(card.bonusMoney * posMult) : 0;
            if (actualBonus > 0) {
                p.money += actualBonus;
                if (RequiemState.isHaloState && actualBonus > card.bonusMoney) {
                    recordHaloPositiveGain(p, actualBonus - card.bonusMoney);
                }
            }
            const tp = buildCardActivationToast({
                card,
                actorName: p.name,
                amountStr: actualBonus > 0 ? formatMoney(actualBonus) : undefined
            });
            RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            const fromPos = p.pos;
            const passedStart = (card.targetId < p.pos || card.targetId === BOARD_TILES.START) && card.targetId !== p.pos;
            const lapBonus = passedStart ? applyLapPassBonus(p, { showBlockedToast: true }) : 0;
            p.pos = card.targetId;
            ctx.emitMoveEvent?.(p, fromPos, card.targetId, 'card', { passedStart, lapBonus });
            ctx.updateRender();
            ctx.refreshUI();
            scheduleGameTask(() => ctx.handleTileArrival(p), 1200);
            break;
        }

        // [15 ~ 17] 상대적 이동 (앨리스의 카드 점 / 실라와 함께 / 전략적 후퇴)
        case "move_choice":
        case "move_forward":
        case "move_backward": {
            const options = [];
            const max = card.maxSpaces || 6;
            if (card.actionType === "move_forward" || card.actionType === "move_choice") {
                for (let i = 1; i <= max; i++) options.push(i);
            }
            if (card.actionType === "move_backward" || card.actionType === "move_choice") {
                for (let i = 1; i <= max; i++) options.push(-i);
            }

            const applyRelativeMove = (spaces) => {
                const fromPos = p.pos;
                const { pos: nextPos, passedStart } = stepActiveBoardPos(p.pos, spaces, ctx.tiles);
                p.pos = nextPos;
                const tp = buildCardActivationToast({ card, actorName: p.name, step: Math.abs(spaces) });
                RuntimePopup.showToast(tp.otherMessage, 3000, null, { actorId: p.id, ...tp });
                const didPassStart = spaces > 0 && passedStart;
                const lapBonus = didPassStart ? applyLapPassBonus(p, { showBlockedToast: true }) : 0;
                ctx.emitMoveEvent?.(p, fromPos, nextPos, 'card', {
                    steps: spaces,
                    passedStart: didPassStart,
                    lapBonus
                });
                ctx.updateRender();
                ctx.refreshUI();
                scheduleGameTask(() => ctx.handleTileArrival(p), 1200);
            };

            if (p.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                applyRelativeMove(AIManager.decideRelativeMoveCard(p, options, ctx.tiles, ctx.allPlayers, globalTurn));
            } else {
                ctx.turnTimer.start(GAME_CONSTANTS.THINK_TIME, () => {
                    RuntimePopup.closeAll();
                    applyRelativeMove(options[0]);
                });
                const isChoiceCard = card.actionType === "move_choice";
                const btnConfigs = options.map(val => ({
                    row: isChoiceCard ? (val > 0 ? 1 : 2) : 1,
                    text: val > 0
                        ? `${uiText.MOVE_FORWARD_PREFIX}${val}${uiText.MOVE_SPACE_SUFFIX}`
                        : `${uiText.MOVE_BACKWARD_PREFIX}${Math.abs(val)}${uiText.MOVE_SPACE_SUFFIX}`,
                    color: val > 0 ? '#2ecc71' : '#e74c3c',
                    action: () => {
                        ctx.turnTimer.stop();
                        RuntimePopup.closeAll();
                        applyRelativeMove(val);
                    }
                }));
                RuntimePopup.showChoicePopup(uiText.MOVE_SELECT_TITLE, uiText.MOVE_SELECT_DESC, btnConfigs);
            }
            break;
        }

        // [18] 그대를 위한 찬사 (모든 생존 플레이어에게서 30만 수금, 15만 이하 소지 시 전액)
        case "instant_steal_all": {
            let totalStolen = 0;
            ctx.allPlayers.forEach(other => {
                if (other !== p && !other.isBankrupt && other.money > 0) {
                    const req = other.money <= (card.minFullTake || 150000) ? other.money : card.value;
                    totalStolen += other.payMoney(req, p);
                }
            });
            const tp = buildCardActivationToast({ card, actorName: p.name, amountStr: formatMoney(totalStolen) });
            RuntimePopup.showToast(tp.otherMessage, 3400, null, { actorId: p.id, ...tp });
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [19 ~ 21] 세금 및 청소 비용 (탈세점검 - 토지세 / 크레페의 청소 / 탈세점검 - 건축세)
        case "tax_land":
        case "tax_build": {
            let tax = 0;
            if (card.actionType === "tax_land") {
                tax = ctx.tiles.filter(t => t.owner === p && t.type === 'normal').length * card.value;
            } else {
                ctx.tiles.filter(t => t.owner === p && t.type === 'normal').forEach(t => {
                    if (t.level >= 1 && t.level <= 4) {
                        tax += card.valArr[t.level];
                    }
                });
            }
            if (tax > 0) {
                const actualPaid = p.payMoney(tax, null);
                const tp = buildCardActivationToast({ card, actorName: p.name, amountStr: formatMoney(tax) });
                if (actualPaid < tax) {
                    RuntimePopup.showToast(tp.otherMessage, 3200, null, {
                        actorId: p.id,
                        selfMessage: `[${p.name}] ${uiText.TAX_FAILED}`,
                        otherMessage: tp.otherMessage,
                        logMessage: tp.logMessage
                    });
                } else {
                    RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
                }
            }
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [22 ~ 23] 왕국폭동(0.5배) / 축제개최(1.5배) - 2턴간 보유한 영토 통행료 변동
        case "buff_toll": {
            if (!p.buffs['buff_toll']) p.buffs['buff_toll'] = [];
            p.buffs['buff_toll'].push({
                id: card.id,
                name: card.name,
                multiplier: card.multiplier,
                remainingTurns: card.turns || 2
            });
            const tp = buildCardActivationToast({ card, actorName: p.name });
            RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [24 ~ 25] 시스트의 복권(10만) / 골디의 고급복권(20만) - 주사위 1개 굴림 (빛무리 시 당첨금 2배)
        case "lottery": {
            const d1 = Math.floor(Math.random() * 6) + 1;
            const basePrize = d1 * card.multiplier;
            const prize = Math.round(basePrize * posMult);
            p.money += prize;
            if (RequiemState.isHaloState && prize > basePrize) {
                recordHaloPositiveGain(p, prize - basePrize);
            }
            const tp = buildCardActivationToast({ card, actorName: p.name, rollValue: d1, amountStr: formatMoney(prize) });
            RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [26 ~ 27] 명예시민 지원금 (보유 영토 5개 이상 시 150만, 미만 시 50만) / 노숙시민 지원금 (보유 영토 3개 이하 시 150만, 초과 시 50만)
        case "instant_receive": {
            const ownedTerritoryCount = ctx.tiles.filter(t => t.owner === p && t.type === 'normal').length;
            let baseReward = card.value;
            if (typeof card.minTerritory === 'number') {
                baseReward = ownedTerritoryCount >= card.minTerritory ? card.value : (card.fallbackValue || 500000);
            } else if (typeof card.maxTerritory === 'number') {
                baseReward = ownedTerritoryCount <= card.maxTerritory ? card.value : (card.fallbackValue || 500000);
            }
            const reward = Math.round(baseReward * posMult);
            p.money += reward;
            if (RequiemState.isHaloState && reward > baseReward) {
                recordHaloPositiveGain(p, reward - baseReward);
            }
            const tp = buildCardActivationToast({ card, actorName: p.name, amountStr: formatMoney(reward) });
            RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [28] 교단의 비상금 (보유 대출 전액 즉시 청산 + 1~3위 보유 현금 평균(10만 미만 버림, 최소 2위 보유 현금 보장) 지급)
        case "instant_cult_fund": {
            const { clearedTotal } = typeof p.clearAllLoans === 'function'
                ? p.clearAllLoans()
                : { clearedTotal: 0 };
            if (typeof p.clearAllLoans !== 'function') {
                p.loanRecords = [];
                p.loanPrincipal = 0;
                p.loanInterest = 0;
                p.loanInterestPrincipal = 0;
            }

            const livingCash = (ctx.allPlayers || [])
                .filter(pl => pl && !pl.isBankrupt)
                .map(pl => Math.max(0, Math.round(Number(pl.money) || 0)))
                .sort((a, b) => b - a);

            const top3 = livingCash.slice(0, 3);
            const avgTop3 = top3.length > 0 ? (top3.reduce((s, v) => s + v, 0) / top3.length) : 0;
            const truncatedAvg = Math.floor(avgTop3 / 100000) * 100000;
            const secondPlaceCash = livingCash.length >= 2 ? livingCash[1] : (livingCash[0] || 0);
            const fundGrant = Math.max(truncatedAvg, secondPlaceCash);

            if (fundGrant > 0) {
                p.money += fundGrant;
            }
            const tp = buildCardActivationToast({ card, actorName: p.name });
            RuntimePopup.showToast(
                tp.otherMessage,
                3800,
                null,
                {
                    actorId: p.id,
                    selfMessage: `${uiText.CULT_EMERGENCY_FUND_APPLIED} (청산 ${formatMoney(clearedTotal)} / 지원 +${formatMoney(fundGrant)})`,
                    otherMessage: tp.otherMessage,
                    logMessage: tp.logMessage
                }
            );
            ctx.refreshUI();
            scheduleGameTask(finish, 1800);
            break;
        }

        // [29 ~ 38] 보유형 카드 (통행료 면제, 빵주 연구원, 림의 기역, 셰이디의 빅 이벤트, 이면세계, 피라의 대부업명함)
        case "hold_immune":
        case "hold_bbangju":
        case "hold_shaydi":
        case "hold_event":
        case "hold_reverse":
        case "hold_pira_loan": {
            // 서열 2위의 특권(34): 이미 다야의 궁전 소유자라면 획득 즉시 파괴
            if (card.id === CARD_IDS.RANK_2_PRIVILEGE && ctx.tiles[BOARD_TILES.DAYA].owner === p) {
                RuntimePopup.showToast(uiText.CARD_DESTROYED_RANK2, 3200, p.id);
                scheduleGameTask(finish, 1600);
                return;
            }

            if (!p.buffs[card.actionType]) p.buffs[card.actionType] = [];
            const holdEntry = { ...card, _acquiredSeq: p.nextCardAcquireSeq ? p.nextCardAcquireSeq() : 0 };
            p.buffs[card.actionType].push(holdEntry);

            // 피라의 대부업명함(38): 앞으로 모든 대출 원금 0.5배 + 고정 이율 20% + 정산 미상환 이율 2배 (기존 활성 대출에도 즉시 적용)
            if (card.id === CARD_IDS.PIRA_LOAN) {
                p.hasPiraCard = true;
                const piraMult = GAME_CONSTANTS.LOAN_PIRA_AMOUNT_MULT || 0.5;
                const piraFixedRate = GAME_CONSTANTS.LOAN_PIRA_FIXED_INTEREST_RATE ?? 0.20;
                if (Array.isArray(p.loanRecords) && p.loanRecords.length > 0) {
                    p.loanRecords.forEach(rec => {
                        rec.principal = Math.round((Number(rec.principal) || 0) * piraMult);
                        rec.fixedInterest = Math.round(rec.principal * piraFixedRate);
                        rec.isPira = true;
                    });
                    if (typeof p._syncLoanAggregates === 'function') p._syncLoanAggregates();
                } else if (p.loanPrincipal > 0) {
                    p.loanPrincipal = Math.round(p.loanPrincipal * piraMult);
                    p.loanInterest = Math.round(p.loanPrincipal * piraFixedRate);
                }
                RuntimePopup.showToast(uiText.PIRA_LOAN_APPLIED, 3400, p.id);
            // 이면세계(37): 현재 소지한 모든 영토의 시간대(낮/밤) 즉시 역전
            } else if (card.id === CARD_IDS.OTHERWORLD) {
                ctx.tiles.filter(t => t.owner === p && (t.timeType === 'day' || t.timeType === 'night')).forEach(t => {
                    t.timeType = t.timeType === 'day' ? 'night' : 'day';
                });
                ctx.updateRender();
                const tp = buildCardActivationToast({ card, actorName: p.name });
                RuntimePopup.showToast(tp.otherMessage, 3400, null, { actorId: p.id, ...tp });
            } else {
                RuntimePopup.showToast(`[${card.name}] ${uiText.CARD_BUFF_APPLIED}`, 3200, p.id);
            }
            ctx.refreshUI();
            scheduleGameTask(finish, 1600);
            break;
        }

        // [39 ~ 51] 사용형 카드 (인벤토리 보관)
        default: {
            if (card.id === CARD_IDS.SIST_DEAL) {
                p.payMoney(GAME_CONSTANTS.SIST_DEAL_COST, null);
                RuntimePopup.showToast(`${uiText.SIST_DEAL_PAID} (-${formatMoney(GAME_CONSTANTS.SIST_DEAL_COST)})`, 3200, p.id);
            }
            const invEntry = { ...card, _acquiredSeq: p.nextCardAcquireSeq ? p.nextCardAcquireSeq() : 0 };
            p.inventory.push(invEntry);
            RuntimePopup.showToast(`[${card.name}] ${uiText.CARD_STORED}`, 3200, p.id);
            ctx.refreshUI();
            scheduleGameTask(finish, 1600);
            break;
        }
    }
}

// ==========================================
// 2. 일반 사용형 카드 실행기 (ID: 39 ~ 51)
// ==========================================
export function useNormalActiveCard(ctx, card, finalizeUse, onCancel = null) {
    const p = ctx.player;
    const cText = getCardUIText();
    const mText = getMarbleText();
    const cancelTarget = () => {
        if (onCancel) onCancel();
        else RuntimePopup.closeAll();
    };
    const resetTargetTimer = () => {
        if (ctx.turnTimer) {
            ctx.turnTimer.start(getPlayerThinkTime(p), cancelTarget);
        }
    };

    switch (card.id) {
        // [39] VIP카드 (통행료 1회 면제 버프 활성화)
        case CARD_IDS.VIP_CARD: {
            p.hasVipShield = true;
            RuntimePopup.closeAll();
            finalizeUse();
            RuntimePopup.showToast(`[${card.name}] ${cText.CARD_BUFF_APPLIED}`, 3200, p.id);
            break;
        }

        // [40] 네르의 소환장 (볼케니카 즉시 탈출)
        case CARD_IDS.NER_ESCAPE: {
            if (p.islandTurns <= 0) {
                RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            p.islandTurns = 0;
            RuntimePopup.closeAll();
            finalizeUse();
            const tp = buildCardActivationToast({ card, actorName: p.name });
            RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            break;
        }

        // [41] 셰럼의 일일조교 (마녀 도서관 능력 1회 무료 획득 또는 면제권 활성화)
        case CARD_IDS.LIBRARY_ASSIST: {
            if (p.hasLibraryBuff) {
                RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            p.hasLibraryBuff = true;
            RuntimePopup.closeAll();
            finalizeUse();
            const tp = buildCardActivationToast({ card, actorName: p.name });
            RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            break;
        }

        // [42] 건축계약서 (자신의 영토가 있을 경우, 마을 미만인 내 영토 1곳에 무료로 마을(2단계)까지 하이패스 건설, 마을 이상은 UI 비활성화)
        case CARD_IDS.BUILD_CONTRACT: {
            const myLands = ctx.tiles.filter(t => t.owner === p && t.type === 'normal');
            const buildableLands = myLands.filter(t => t.level < 2);
            if (buildableLands.length === 0) {
                if (!p.isAi()) RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                const picked = AIManager.selectBestUpgradeTile(p, ctx.tiles, t => t.level < 2, false, globalTurn) || buildableLands[0];
                picked.level = 2;
                finalizeUse();
                const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(picked) });
                RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
                return;
            }
            resetTargetTimer();
            const lvNames = [mText.BLD_0, mText.BLD_1, mText.BLD_2, mText.BLD_3, mText.BLD_4];
            const targetList = myLands.map(t => {
                const canBuild = t.level < 2;
                return {
                    id: t.id,
                    name: canBuild
                        ? `${getTileName(t)} (${lvNames[t.level]} → ${mText.BLD_2})`
                        : `${getTileName(t)} (${lvNames[t.level]})`,
                    color: '#2ecc71',
                    disabled: !canBuild
                };
            });
            RuntimePopup.showTargetPopup(cText.TARGET_TITLE, cText.TARGET_EMPTY_LAND, targetList, (tileId) => {
                const t = ctx.tiles[tileId];
                if (!t || t.owner !== p || t.level >= 2) return;
                t.level = 2; // 마을(2단계)까지 하이패스 무료 건설
                RuntimePopup.closeAll();
                finalizeUse();
                const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(t) });
                RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            }, cancelTarget);
            break;
        }

        // [43] 증축계약서 (자신의 영토가 있을 경우, 건물이 있는 내 영토(오두막·마을) 1곳의 건설 단계를 무료 +1, 건물 없음 및 왕국 이상은 UI 비활성화)
        case CARD_IDS.UPGRADE_CONTRACT: {
            const myLands = ctx.tiles.filter(t => t.owner === p && t.type === 'normal');
            const myUpgradable = myLands.filter(t => t.level === 1 || t.level === 2);
            if (myUpgradable.length === 0) {
                if (!p.isAi()) RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                const picked = AIManager.selectBestUpgradeTile(p, ctx.tiles, t => t.level === 1 || t.level === 2, true, globalTurn) || myUpgradable[0];
                picked.level++;
                finalizeUse();
                const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(picked) });
                RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
                return;
            }
            resetTargetTimer();
            const lvNames = [mText.BLD_0, mText.BLD_1, mText.BLD_2, mText.BLD_3, mText.BLD_4];
            const targetList = myLands.map(t => {
                const canUpgrade = t.level === 1 || t.level === 2;
                return {
                    id: t.id,
                    name: canUpgrade
                        ? `${getTileName(t)} (${lvNames[t.level]} → ${lvNames[t.level + 1]})`
                        : `${getTileName(t)} (${lvNames[t.level]})`,
                    color: '#3498db',
                    disabled: !canUpgrade
                };
            });
            RuntimePopup.showTargetPopup(cText.TARGET_TITLE, cText.TARGET_UPGRADE, targetList, (tileId) => {
                const t = ctx.tiles[tileId];
                if (!t || t.owner !== p || (t.level !== 1 && t.level !== 2)) return;
                t.level++;
                RuntimePopup.closeAll();
                finalizeUse();
                const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(t) });
                RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            }, cancelTarget);
            break;
        }

        // [44] 엘드르유산등록서 (왕국(3단계) 하나를 무료로 엘리프 조각상(4단계)으로 증축, 왕국이 아닌 영토는 UI 비활성화)
        case CARD_IDS.LANDMARK_CONTRACT: {
            const myLands = ctx.tiles.filter(t => t.owner === p && t.type === 'normal');
            const myKingdoms = myLands.filter(t => t.level === 3);
            if (myKingdoms.length === 0) {
                if (!p.isAi()) RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                const picked = AIManager.selectBestUpgradeTile(p, ctx.tiles, t => t.level === 3, true, globalTurn) || myKingdoms[0];
                picked.level = 4;
                finalizeUse();
                const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(picked) });
                RuntimePopup.showToast(tp.otherMessage, 3400, null, { actorId: p.id, ...tp });
                return;
            }
            resetTargetTimer();
            const lvNames = [mText.BLD_0, mText.BLD_1, mText.BLD_2, mText.BLD_3, mText.BLD_4];
            const targetList = myLands.map(t => {
                const canLandmark = t.level === 3;
                return {
                    id: t.id,
                    name: canLandmark
                        ? `${getTileName(t)} (${mText.BLD_3} → ${mText.BLD_4})`
                        : `${getTileName(t)} (${lvNames[t.level]})`,
                    color: '#f1c40f',
                    disabled: !canLandmark
                };
            });
            RuntimePopup.showTargetPopup(cText.TARGET_TITLE, cText.TARGET_LANDMARK, targetList, (tileId) => {
                const t = ctx.tiles[tileId];
                if (!t || t.owner !== p || t.level !== 3) return;
                t.level = 4;
                RuntimePopup.closeAll();
                finalizeUse();
                const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(t) });
                RuntimePopup.showToast(tp.otherMessage, 3400, null, { actorId: p.id, ...tp });
            }, cancelTarget);
            break;
        }

        // [45] 시스트의 거래 (다음 매입/건설/증축 비용 0.5배 할인 버프 활성화)
        case CARD_IDS.SIST_DEAL: {
            p.hasSistDiscountBuff = true;
            RuntimePopup.closeAll();
            finalizeUse();
            RuntimePopup.showToast(`[${card.name}] ${cText.CARD_BUFF_APPLIED}`, 3200, p.id);
            break;
        }

        // [46] 골디의 제안 (보유한 일반 영토 중 하나를 (매입가+건설비 합)의 1.5배 가격으로 매각)
        case CARD_IDS.GOLDIE_PROPOSAL: {
            const myNormalLands = ctx.tiles.filter(t => t.owner === p && t.type === 'normal');
            if (myNormalLands.length === 0) {
                if (!p.isAi()) RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const picked = AIManager.selectGoldieSellTile(p, ctx.tiles) || myNormalLands[0];
                const sellPrice = Math.round(getTileFullInvestedValue(picked) * 1.5);
                p.money += sellPrice;
                picked.owner = null;
                picked.level = -1;
                p.territoryCount--;
                finalizeUse();
                RuntimePopup.showToast(`🎯 ${getTileName(picked)} 매각 완료 (+${formatMoney(sellPrice)})`, 3400, p.id);
                return;
            }
            resetTargetTimer();
            const sellTargets = myNormalLands.map(t => {
                const sellPrice = Math.round(getTileFullInvestedValue(t) * 1.5);
                return { id: t.id, name: `${getTileName(t)} (+${formatMoney(sellPrice)})`, color: '#e67e22' };
            });
            RuntimePopup.showTargetPopup(cText.TARGET_TITLE, cText.TARGET_SELL_HIGH, sellTargets, (tileId) => {
                const t = ctx.tiles[tileId];
                const sellPrice = Math.round(getTileFullInvestedValue(t) * 1.5);
                p.money += sellPrice;
                t.owner = null;
                t.level = -1;
                p.territoryCount--;
                RuntimePopup.closeAll();
                finalizeUse();
                RuntimePopup.showToast(`🎯 ${getTileName(t)} 매각 완료 (+${formatMoney(sellPrice)})`, 3400, p.id);
            }, cancelTarget);
            break;
        }

        // [47] 마요의 암거래 (상대를 한 명 고른 후, 상대의 영토 중 하나를 토지 매입가 + 통행료의 1.5배에 인수 - 엘리프 조각상 제외)
        case CARD_IDS.MAYO_DEAL: {
            const validEnemies = ctx.allPlayers.filter(enemy =>
                enemy !== p && !enemy.isBankrupt &&
                ctx.tiles.some(t => t.owner === enemy && t.type === 'normal' && t.level < 4)
            );
            if (validEnemies.length === 0) {
                RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                const pick = AIManager.selectMayoTarget(p, ctx.tiles, ctx.allPlayers, globalTurn);
                if (pick && pick.tile) {
                    const targetTile = pick.tile;
                    const takeoverCost = targetTile.basePrice + Math.round(ctx.calculateToll(targetTile, p) * 1.5);
                    if (p.money >= takeoverCost) {
                        p.money -= takeoverCost;
                        targetTile.owner.money += takeoverCost;
                        targetTile.owner.territoryCount--;
                        targetTile.owner = p;
                        p.territoryCount++;
                        finalizeUse();
                        const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(targetTile) });
                        RuntimePopup.showToast(tp.otherMessage, 3400, null, { actorId: p.id, ...tp });
                        return;
                    }
                }
                cancelTarget();
                return;
            }
            resetTargetTimer();
            const enemyTargets = validEnemies.map(e => ({ id: e.id, name: e.name, color: e.color }));
            RuntimePopup.showTargetPopup(cText.TARGET_TITLE, cText.TARGET_TAKEOVER_ENEMY, enemyTargets, (enemyId) => {
                const targetEnemy = ctx.allPlayers.find(e => e.id === enemyId);
                const enemyLands = ctx.tiles.filter(t => t.owner === targetEnemy && t.type === 'normal' && t.level < 4);
                const tileTargets = enemyLands.map(t => {
                    const cost = t.basePrice + Math.round(ctx.calculateToll(t, p) * 1.5);
                    return { id: t.id, name: `${getTileName(t)} (${formatMoney(cost)})`, color: targetEnemy.color };
                });
                resetTargetTimer();
                RuntimePopup.showTargetPopup(cText.TARGET_TITLE, cText.TARGET_TAKEOVER, tileTargets, (tileId) => {
                    const targetTile = ctx.tiles[tileId];
                    const takeoverCost = targetTile.basePrice + Math.round(ctx.calculateToll(targetTile, p) * 1.5);
                    if (p.money >= takeoverCost) {
                        p.money -= takeoverCost;
                        targetTile.owner.money += takeoverCost;
                        targetTile.owner.territoryCount--;
                        targetTile.owner = p;
                        p.territoryCount++;
                        RuntimePopup.closeAll();
                        finalizeUse();
                        const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(targetTile) });
                        RuntimePopup.showToast(tp.otherMessage, 3400, null, { actorId: p.id, ...tp });
                    } else {
                        RuntimePopup.showToast(mText.NOT_ENOUGH_MONEY, 2800, p.id);
                    }
                }, cancelTarget);
            }, cancelTarget);
            break;
        }

        // [48] 마리의 스위치 (상대를 한 명 고른 후, 상대의 건물 하나를 랜덤 철거하여 건설 단계 2단계 하락 - 엘리프 조각상 포함, 2단계 이하는 토지만 소유)
        case CARD_IDS.MARI_SWITCH: {
            const enemiesWithBuildings = ctx.allPlayers.filter(enemy =>
                enemy !== p && !enemy.isBankrupt &&
                ctx.tiles.some(t => t.owner === enemy && t.type === 'normal' && t.level >= 1)
            );
            if (enemiesWithBuildings.length === 0) {
                RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const targetPlayer = AIManager.selectMariTargetPlayer(p, ctx.tiles, ctx.allPlayers);
                if (targetPlayer) {
                    const builtLands = ctx.tiles.filter(t => t.owner === targetPlayer && t.type === 'normal' && t.level >= 1);
                    if (builtLands.length > 0) {
                        const ripTile = builtLands[Math.floor(Math.random() * builtLands.length)];
                        ripTile.level = Math.max(0, ripTile.level - 2);
                        finalizeUse();
                        const tp = buildCardActivationToast({ card, actorName: p.name, targetPlayerName: targetPlayer.name, targetTileName: getTileName(ripTile) });
                        RuntimePopup.showToast(tp.otherMessage, 3400, null, { actorId: p.id, ...tp });
                        return;
                    }
                }
                cancelTarget();
                return;
            }
            resetTargetTimer();
            const enemyTargets = enemiesWithBuildings.map(e => ({ id: e.id, name: e.name, color: e.color }));
            RuntimePopup.showTargetPopup(cText.TARGET_TITLE, cText.TARGET_TERROR, enemyTargets, (enemyId) => {
                const targetPlayer = ctx.allPlayers.find(e => e.id === enemyId);
                const builtLands = ctx.tiles.filter(t => t.owner === targetPlayer && t.type === 'normal' && t.level >= 1);
                const ripTile = builtLands[Math.floor(Math.random() * builtLands.length)];
                ripTile.level = Math.max(0, ripTile.level - 2); // 건설 단계 2단계 하락 (2단계 이하는 토지(0)만 남음)
                RuntimePopup.closeAll();
                finalizeUse();
                const tp = buildCardActivationToast({ card, actorName: p.name, targetPlayerName: targetPlayer.name, targetTileName: getTileName(ripTile) });
                RuntimePopup.showToast(tp.otherMessage, 3400, null, { actorId: p.id, ...tp });
            }, cancelTarget);
            break;
        }

        // [49] 주야역전 (소지한 영토 중 하나를 골라 시간대를 역전시킴)
        case CARD_IDS.REVERSE_TIME: {
            const myTimeLands = ctx.tiles.filter(t => t.owner === p && (t.timeType === 'day' || t.timeType === 'night'));
            if (myTimeLands.length === 0) {
                RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            if (p.isAi()) {
                const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
                const t = AIManager.selectReverseTimeTile(p, ctx.tiles, globalTurn);
                if (t) {
                    t.timeType = t.timeType === 'day' ? 'night' : 'day';
                    finalizeUse();
                    const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(t) });
                    RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
                    return;
                }
                cancelTarget();
                return;
            }
            resetTargetTimer();
            const landTargets = myTimeLands.map(t => ({
                id: t.id,
                name: `${getTileName(t)} (${t.timeType === 'day' ? '☀️→🌙' : '🌙→☀️'})`,
                color: t.timeType === 'day' ? '#e67e22' : '#8e44ad'
            }));
            RuntimePopup.showTargetPopup(cText.TARGET_TITLE, cText.TARGET_REVERSE_ONE, landTargets, (tileId) => {
                const t = ctx.tiles[tileId];
                t.timeType = t.timeType === 'day' ? 'night' : 'day';
                RuntimePopup.closeAll();
                finalizeUse();
                const tp = buildCardActivationToast({ card, actorName: p.name, targetTileName: getTileName(t) });
                RuntimePopup.showToast(tp.otherMessage, 3200, null, { actorId: p.id, ...tp });
            }, cancelTarget);
            break;
        }

        // [50] 루포의 주사위 (1회에 한해 주사위 3개, 1개는 6 고정)
        case CARD_IDS.RUFO_DICE: {
            p.hasRufoDiceBuff = true;
            RuntimePopup.closeAll();
            finalizeUse();
            RuntimePopup.showToast(cText.RUFO_DICE_WAIT, 3200, p.id);
            break;
        }

        // [51] 골디의 부동산명함 (사용 시점 남은 대출금 원금+이자 0.5배 감소, 대신 보유 영토 중 최고 건설 단계 영토 1곳 -2단계)
        case CARD_IDS.GOLDIE_REALTY: {
            const totalDebt = p.getTotalLoanDebt
                ? p.getTotalLoanDebt()
                : ((Number(p.loanPrincipal) || 0) + (Number(p.loanInterest) || 0));
            if (totalDebt <= 0) {
                RuntimePopup.showToast(cText.CANT_USE_NOW, 2800, p.id);
                cancelTarget();
                return;
            }
            const { reducedTotal } = p.applyGoldieRealtyDebtReduction
                ? p.applyGoldieRealtyDebtReduction()
                : { reducedTotal: 0 };

            const ownedLands = ctx.tiles.filter(t => t.owner === p && t.type === 'normal');
            const maxLevel = ownedLands.reduce((mx, t) => Math.max(mx, t.level || 0), -1);
            let downgraded = false;
            if (maxLevel >= 2) {
                const topTiles = ownedLands.filter(t => t.level === maxLevel);
                const picked = topTiles[Math.floor(Math.random() * topTiles.length)];
                if (picked) {
                    picked.level = Math.max(0, picked.level - 2);
                    downgraded = true;
                }
            }
            RuntimePopup.closeAll();
            finalizeUse();
            if (downgraded) {
                RuntimePopup.showToast(`${cText.GOLDIE_REALTY_APPLIED} (감면 대출금: ${formatMoney(reducedTotal)})`, 3400, p.id);
            } else {
                RuntimePopup.showToast(`${cText.GOLDIE_REALTY_NO_DOWNGRADE} (감면 대출금: ${formatMoney(reducedTotal)})`, 3400, p.id);
            }
            break;
        }
    }
}
