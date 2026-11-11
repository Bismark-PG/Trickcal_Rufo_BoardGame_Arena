import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import {
    RuntimePopup,
    formatMoney,
    scheduleGameTask,
    getActiveWorld,
    getMarbleText,
    getGimmickText
} from './MarbleRuntime.js';
import { calculateToll, getTileSellValue } from './MarbleLogic.js';
import { getPlayerThinkTime } from './MarbleCardTreasure.js';
import { getRequiemTollReceiverMultiplier } from './MarbleRequiem.js';
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

// 통행료 수취인 최종 수령 금액 계산 (일반/특수 영토에만 빛무리 기본 1.5배, 염원살이/몽환살이 2.0배, 죄업 0.5배, 후회 1.0배 적용)
function creditOwnerToll(owner, paidAmount, tile = null) {
    if (!owner || paidAmount <= 0) return;
    const isBuildableTerritory = !tile || tile.type === 'normal';
    const recvMult = isBuildableTerritory ? getRequiemTollReceiverMultiplier(owner) : 1.0;
    const receivedAmount = Math.round(paidAmount * recvMult);
    owner.money += receivedAmount;
}

// ==========================================
// 1. 대출 및 통행료 결제 프로세스 모듈화
// ==========================================
export function handleTollPaymentProcess(ctx) {
    const { player, tile, tiles, updateRender, refreshUI, proceedEndTurn, onAfterPaid } = ctx;
    const finishPayment = onAfterPaid || proceedEndTurn;
    const toll = calculateToll(tile, player);
    const text = getMarbleText();
    const gText = getGimmickText();

    // 1. 넉넉하면 즉시 지불
    if (player.money >= toll) {
        player.money -= toll;
        creditOwnerToll(tile.owner, toll, tile);
        RuntimePopup.showToast(`${text.TOLL_TITLE} ${formatMoney(toll)}`, 2000);
        updateRender(); refreshUI(); scheduleGameTask(finishPayment, 1000); return;
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
        // 룰 적용: 부족한 금액 + 50만
        const loanAmount = reqAmount + GAME_CONSTANTS.LOAN_CRISIS_BONUS;

        player.loanPrincipal += loanAmount;
        player.money += loanAmount;
        player.loanCount++; // 대출 횟수 증가

        player.money -= toll;
        creditOwnerToll(tile.owner, toll, tile);
        RuntimePopup.showToast(`${formatMoney(loanAmount)} ${text.LOAN_EXECUTE} ${text.LOAN_DONE}`, 2500);
        updateRender(); refreshUI(); scheduleGameTask(finishPayment, 2000);
    };

    const executeBankrupt = () => {
        if (ctx.turnTimer) ctx.turnTimer.stop();
        RuntimePopup.closeAll();
        const isActuallyBankrupt = player.goBankrupt(tiles);
        if (isActuallyBankrupt) {
            RuntimePopup.showToast(`${player.name} ${text.BANKRUPT}`, 3000);
            updateRender(); refreshUI(); scheduleGameTask(proceedEndTurn, 2500);
        } else {
            // [106: 두번째 기회] 발동으로 300만/150만 달러를 수령하여 회생한 경우
            const paid = player.payMoney(toll, null);
            creditOwnerToll(tile.owner, paid, tile);
            updateRender(); refreshUI(); scheduleGameTask(finishPayment, 2000);
        }
    };

    // AI 처리
    if (player.isAi()) {
        const globalTurn = ctx.turnManager ? ctx.turnManager.globalTurn : 1;
        const decision = AIManager.decideTollCrisis(player, tiles, reqAmount, globalTurn);
        if (decision.action === 'sell' && decision.tiles.length > 0) {
            player.sellProperties(decision.tiles, getTileSellValue);
            player.money -= toll;
            creditOwnerToll(tile.owner, toll, tile);
            RuntimePopup.showToast(`${player.name}${gText.AI_CRISIS_SELL}`, 2500);
            updateRender(); refreshUI(); scheduleGameTask(finishPayment, 1500);
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
                    player.money -= toll;
                    creditOwnerToll(tile.owner, toll, tile);
                    RuntimePopup.closeAll(); RuntimePopup.showToast(text.TOAST_SELL_DONE, 2500);
                    updateRender(); refreshUI(); scheduleGameTask(finishPayment, 1000);
                },
                () => RuntimePopup.showToast(text.SELL_UNAVOIDABLE, 2000)
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
                        player.money -= toll;
                        creditOwnerToll(tile.owner, toll, tile);
                        RuntimePopup.closeAll(); updateRender(); refreshUI(); scheduleGameTask(finishPayment, 1000);
                    },
                    () => handleTollPaymentProcess(ctx)
                );
            },
            executeLoan
        );
    }
}
