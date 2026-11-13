import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import {
    RuntimePopup,
    formatMoney,
    scheduleGameTask,
    getActiveWorld,
    getMarbleText,
    getGimmickText
} from './MarbleRuntime.js';
import { calculateToll, calculateTollBreakdown, getTileSellValue } from './MarbleLogic.js';
import { getPlayerThinkTime } from './MarbleCardTreasure.js';
import {
    RequiemState,
    getRequiemTollReceiverMultiplier,
    ensureSootPnlEntry,
    ensureHaloPnlEntry
} from './MarbleRequiem.js';
import { AIManager } from './MarbleAI.js';

export function getGlobalBbangjuVisits() {
    return getActiveWorld().globalBbangjuVisits;
}

export function addBbangjuVisit() {
    getActiveWorld().globalBbangjuVisits++;
}

export function resetBbangjuVisits() {
    getActiveWorld().globalBbangjuVisits = 0;
}

function recordTollBreakdownMetrics(payer, owner, tile, targetToll, paidAmount, receivedAmount = paidAmount, payerMoneyBefore = paidAmount) {
    if (!tile || tile.type !== 'normal') return;
    const wm = getActiveWorld()?.metrics;
    if (!wm) return;

    const bd = calculateTollBreakdown(tile, payer);
    if (paidAmount > 0) {
        const denom = Math.max(bd.total, targetToll, 1);
        const scale = Math.min(1, paidAmount / denom);

        if (bd.mountainExtra > 0) {
            wm.mountainTollExtraTotal = (wm.mountainTollExtraTotal || 0) + Math.round(bd.mountainExtra * scale);
        }

        if (bd.dayNightExtra > 0 && (bd.dayNightPhase === 'day' || bd.dayNightPhase === 'night')) {
            const extraDN = Math.round(bd.dayNightExtra * scale);
            wm.dayNightTollExtraTotal[bd.dayNightPhase] = (wm.dayNightTollExtraTotal[bd.dayNightPhase] || 0) + extraDN;
            if (owner?.id) {
                if (!wm.dayNightPlayerPnl[owner.id]) wm.dayNightPlayerPnl[owner.id] = { name: owner.name, gain: 0, loss: 0 };
                wm.dayNightPlayerPnl[owner.id].gain += extraDN;
            }
            if (payer?.id) {
                if (!wm.dayNightPlayerPnl[payer.id]) wm.dayNightPlayerPnl[payer.id] = { name: payer.name, gain: 0, loss: 0 };
                wm.dayNightPlayerPnl[payer.id].loss += extraDN;
            }
        }

        if (bd.sootExtra > 0) {
            const extraSoot = Math.round(bd.sootExtra * scale);
            wm.sootExtraTollTotal = (wm.sootExtraTollTotal || 0) + extraSoot;
            const ownerEntry = ensureSootPnlEntry(wm, owner);
            if (ownerEntry) {
                ownerEntry.cash += extraSoot;
                ownerEntry.tollGain = (ownerEntry.tollGain || 0) + extraSoot;
            }
            const payerEntry = ensureSootPnlEntry(wm, payer);
            if (payerEntry) payerEntry.cash -= extraSoot;
            if (owner && owner.isReincarnated) {
                wm.sootBossTollTotal = (wm.sootBossTollTotal || 0) + extraSoot;
            }
        }
    }

    if (RequiemState.isHaloState && (paidAmount > 0 || bd.totalNoHalo > 0)) {
        const baselinePaid = Math.min(Math.max(0, payerMoneyBefore), Math.max(0, bd.totalNoHalo));
        const ownerGain = Math.round(receivedAmount - baselinePaid);
        const payerDiff = Math.round(paidAmount - baselinePaid);
        wm.haloTollGainTotal = (wm.haloTollGainTotal || 0) + ownerGain;
        wm.haloPayerTollDiffTotal = (wm.haloPayerTollDiffTotal || 0) + payerDiff;
        const ownerHalo = ensureHaloPnlEntry(wm, owner);
        if (ownerHalo) ownerHalo.tollGain += ownerGain;
        const payerHalo = ensureHaloPnlEntry(wm, payer);
        if (payerHalo) payerHalo.tollPayerDiff += payerDiff;
    }
}

// 통행료 수취인 최종 수령 금액 계산 (일반/특수 영토에만 빛무리 기본 1.5배, 염원살이/몽환살이 2.0배, 죄업 0.5배, 후회 1.0배 적용)
function creditOwnerToll(owner, paidAmount, tile = null) {
    if (!owner || paidAmount <= 0) return 0;
    const isBuildableTerritory = !tile || tile.type === 'normal';
    const recvMult = isBuildableTerritory ? getRequiemTollReceiverMultiplier(owner) : 1.0;
    const receivedAmount = Math.round(paidAmount * recvMult);
    owner.money += receivedAmount;
    return receivedAmount;
}

function recordTollPaidTracker(payer, paid) {
    if (!payer?.tracker || paid <= 0) return;
    payer.tracker.tollsPaidCount++;
    payer.tracker.tollsPaidTotal += paid;
    if (payer.tracker.minSingleTollPaid === null || payer.tracker.minSingleTollPaid === undefined || paid < payer.tracker.minSingleTollPaid) {
        payer.tracker.minSingleTollPaid = paid;
    }
    if (paid > (payer.tracker.maxSingleTollPaid || 0)) {
        payer.tracker.maxSingleTollPaid = paid;
    }
}

// 통행료 결제 및 지급·추적 공통 헬퍼
function settleTollTransfer(payer, owner, tile, targetToll, onPaymentSettled = null) {
    const payerMoneyBefore = Math.max(0, payer.money);
    const paid = Math.min(Math.max(0, targetToll), payerMoneyBefore);
    payer.money -= paid;
    const receivedAmount = creditOwnerToll(owner, paid, tile);
    recordTollBreakdownMetrics(payer, owner, tile, targetToll, paid, receivedAmount, payerMoneyBefore);
    recordTollPaidTracker(payer, paid);
    if (typeof onPaymentSettled === 'function' && paid > 0) onPaymentSettled(paid);
    return paid;
}

export function executePlayerLoanBorrow(player, amount, source = 'toll', globalTurn = 1) {
    const rawAmount = Math.max(0, Math.round(Number(amount) || 0));

    // 일반 대출(비피라)에서 대출1 원금을 다 갚아 전환 이자 원금만 남은 상태에서 대출2가 실행되면
    // 기존 잔여 이자가 아니라 대출2의 원금만을 기준으로 이자를 계산하도록 전환 이자를 이자 계정으로 복귀
    // (피라 보유 시 이미 0.5배 변환된 전환 원금이 대출2 완납 시 재차 0.5배 되지 않도록 전환 원금 계정 유지)
    const hasPiraBuff = Boolean(player.hasPiraLoanBuff && player.hasPiraLoanBuff());
    if (!hasPiraBuff && player.loanPrincipal <= 0 && player.loanInterestPrincipal > 0) {
        player.loanInterest += player.loanInterestPrincipal;
        player.loanInterestPrincipal = 0;
    }

    const debtMult = (player.hasPiraLoanBuff && player.hasPiraLoanBuff())
        ? (GAME_CONSTANTS.LOAN_PIRA_AMOUNT_MULT || 0.5)
        : 1;
    const loanAmount = Math.round(rawAmount * debtMult);

    player.loanCount++;
    player.loanPrincipal += loanAmount;
    player.money += rawAmount;
    if (player.tracker) {
        if (source === 'turn_crisis') {
            player.tracker.emergencyLoanCount = (player.tracker.emergencyLoanCount || 0) + 1;
        } else {
            player.tracker.tollLoanCount = (player.tracker.tollLoanCount || 0) + 1;
        }
        player.tracker.borrowedPrincipalTotal = (player.tracker.borrowedPrincipalTotal || 0) + loanAmount;
        if (player.tracker.minLoanAmount === null || player.tracker.minLoanAmount === undefined || loanAmount < player.tracker.minLoanAmount) {
            player.tracker.minLoanAmount = loanAmount;
        }
        if (loanAmount > (player.tracker.maxLoanAmount || 0)) {
            player.tracker.maxLoanAmount = loanAmount;
        }
        if (!Array.isArray(player.tracker.loanEvents)) {
            player.tracker.loanEvents = [];
        }
        player.tracker.loanEvents.push({
            turn: Number(globalTurn) || 1,
            source,
            amount: loanAmount,
            loanCountAfter: player.loanCount
        });
    }
    return loanAmount;
}

// ==========================================
// 1. 대출 및 통행료 결제 프로세스 모듈화
// ==========================================
export function handleTollPaymentProcess(ctx) {
    const { player, tile, tiles, updateRender, refreshUI, proceedEndTurn, onAfterPaid, onPaymentSettled } = ctx;
    const finishPayment = onAfterPaid || proceedEndTurn;
    const toll = Number.isFinite(Number(ctx.customToll))
        ? Math.max(0, Math.round(Number(ctx.customToll)))
        : calculateToll(tile, player);
    const text = getMarbleText();
    const gText = getGimmickText();

    // 1. 넉넉하면 즉시 지불
    if (player.money >= toll) {
        settleTollTransfer(player, tile.owner, tile, toll, onPaymentSettled);
        if (ctx.tollToastLabel) {
            RuntimePopup.showToast(`[${player.name}] ${ctx.tollToastLabel} (${formatMoney(toll)})`, 3200);
        } else {
            const ownerTag = tile.owner ? ` → ${tile.owner.name}` : '';
            RuntimePopup.showToast(`[${player.name}${ownerTag}] ${text.TOLL_TITLE} ${formatMoney(toll)}`, 3200);
        }
        updateRender(); refreshUI(); scheduleGameTask(finishPayment, 1100); return;
    }

    // 2. 자산 매각 시 감당 가능한지 계산 (특수 칸은 어떠한 경우에도 매각 불가 -> normal만 매각 가능)
    const ownedTiles = tiles.filter(t => t.owner === player && t.type === 'normal');
    const maxSellValue = ownedTiles.reduce((sum, t) => sum + getTileSellValue(t), 0);
    const reqAmount = toll - player.money;
    const canSellCover = maxSellValue >= reqAmount;

    // 대출 실행 로직 (최대 2회)
    const executeLoan = () => {
        if (ctx.turnTimer) ctx.turnTimer.stop();
        RuntimePopup.closeAll();
        // 룰 적용: 부족한 금액 + 순회보상(75만)
        const rawLoanAmount = reqAmount + GAME_CONSTANTS.LOAN_CRISIS_BONUS;
        const loanAmount = executePlayerLoanBorrow(player, rawLoanAmount, 'toll', ctx.turnManager ? ctx.turnManager.globalTurn : 1);

        settleTollTransfer(player, tile.owner, tile, toll, onPaymentSettled);
        RuntimePopup.showToast(`[${player.name}] ${formatMoney(loanAmount)} ${text.LOAN_EXECUTE} ${text.LOAN_DONE}`, 3500);
        updateRender(); refreshUI(); scheduleGameTask(finishPayment, 2000);
    };

    const executeBankrupt = () => {
        if (ctx.turnTimer) ctx.turnTimer.stop();
        RuntimePopup.closeAll();
        const isActuallyBankrupt = player.goBankrupt(tiles);
        if (isActuallyBankrupt) {
            // 파산 시 모든 자산을 소멸시킨 뒤, 부족분은 은행이 메꿔 소유주에게 청구 통행료 전액 지급
            const coveredToll = Math.max(0, toll);
            const receivedAmount = creditOwnerToll(tile.owner, coveredToll, tile);
            recordTollBreakdownMetrics(player, tile.owner, tile, coveredToll, coveredToll, receivedAmount, coveredToll);
            recordTollPaidTracker(player, coveredToll);
            if (typeof onPaymentSettled === 'function' && coveredToll > 0) {
                onPaymentSettled(coveredToll);
            }
            RuntimePopup.showToast(`[${player.name}] ${text.BANKRUPT}`, 3800);
            updateRender(); refreshUI(); scheduleGameTask(proceedEndTurn, 2500);
        } else {
            // [106: 두번째 기회] 발동으로 300만/150만 달러를 수령하여 회생한 경우
            const payerMoneyBefore = Math.max(0, player.money);
            const paid = player.payMoney(toll, null);
            const receivedAmount = creditOwnerToll(tile.owner, paid, tile);
            recordTollBreakdownMetrics(player, tile.owner, tile, toll, paid, receivedAmount, payerMoneyBefore);
            recordTollPaidTracker(player, paid);
            if (typeof onPaymentSettled === 'function' && paid > 0) {
                onPaymentSettled(paid);
            }
            updateRender(); refreshUI(); scheduleGameTask(finishPayment, 2000);
        }
    };

    // AI 처리
    if (player.isAi()) {
        const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
        const decision = AIManager.decideTollCrisis(player, tiles, reqAmount, globalTurn);
        if (decision.action === 'sell' && decision.tiles.length > 0) {
            player.sellProperties(decision.tiles, getTileSellValue);
            settleTollTransfer(player, tile.owner, tile, toll, onPaymentSettled);
            RuntimePopup.showToast(`${player.name}${gText.AI_CRISIS_SELL}`, 3400);
            updateRender(); refreshUI(); scheduleGameTask(finishPayment, 1600);
        } else if (decision.action === 'loan' && player.loanCount < GAME_CONSTANTS.LOAN_MAX_COUNT) {
            executeLoan();
        } else {
            executeBankrupt();
        }
        return;
    }

    if (ctx.setWaitingAction) ctx.setWaitingAction(true);
    ctx.isWaitingAction = true;

    const onTimeout = () => {
        if (player.loanCount < GAME_CONSTANTS.LOAN_MAX_COUNT) {
            executeLoan();
        } else {
            executeBankrupt();
        }
    };
    ctx.turnTimer.start(getPlayerThinkTime(player), onTimeout);

    // 대출 횟수 초과 시 (강제 매각 or 파산)
    if (player.loanCount >= GAME_CONSTANTS.LOAN_MAX_COUNT) {
        if (!canSellCover) executeBankrupt();
        else {
            RuntimePopup.showSellPopup(ownedTiles, reqAmount, getTileSellValue,
                (selectedTiles) => {
                    ctx.turnTimer.stop();
                    player.sellProperties(selectedTiles, getTileSellValue);
                    settleTollTransfer(player, tile.owner, tile, toll, onPaymentSettled);
                    RuntimePopup.closeAll(); RuntimePopup.showToast(`[${player.name}] ${text.TOAST_SELL_DONE}`, 3200);
                    updateRender(); refreshUI(); scheduleGameTask(finishPayment, 1100);
                },
                () => RuntimePopup.showToast(text.SELL_UNAVOIDABLE, 2800, player.id)
            );
        }
    } else {
        // 대출 가능 시 위기 팝업 (매각 vs 대출)
        RuntimePopup.showCrisisPopup(toll, canSellCover,
            () => {
                RuntimePopup.showSellPopup(ownedTiles, reqAmount, getTileSellValue,
                    (selectedTiles) => {
                        ctx.turnTimer.stop();
                        player.sellProperties(selectedTiles, getTileSellValue);
                        settleTollTransfer(player, tile.owner, tile, toll, onPaymentSettled);
                        RuntimePopup.closeAll(); updateRender(); refreshUI(); scheduleGameTask(finishPayment, 1100);
                    },
                    () => handleTollPaymentProcess(ctx)
                );
            },
            executeLoan
        );
    }
}
