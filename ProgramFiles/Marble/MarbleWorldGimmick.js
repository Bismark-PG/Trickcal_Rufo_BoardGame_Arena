import { TimeSlotSystem } from './MarbleTimeSlot.js';
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import {
    RuntimePopup,
    getActiveWorld,
    getGimmickText
} from './MarbleRuntime.js';
import { resetBbangjuVisits } from './MarbleEconomy.js';
import { resetOdysseyState } from './MarbleOdyssey.js';
import { resetCardDeck } from './MarbleCard.js';
import {
    RequiemState,
    resetRequiemState,
    triggerHaloByCard,
    advanceRequiemOnTurnStart
} from './MarbleRequiem.js';

export const WorldGimmickManager = {
    get currentTurn() { return getActiveWorld().currentTurn; },
    set currentTurn(v) { getActiveWorld().currentTurn = v; },

    get currentTime() { return getActiveWorld().currentTime; },
    set currentTime(v) { getActiveWorld().currentTime = v; },

    get bbangjuState() { return getActiveWorld().bbangjuState; },
    set bbangjuState(v) { getActiveWorld().bbangjuState = v; },

    get bbangjuChiefs() { return getActiveWorld().bbangjuChiefs; },
    set bbangjuChiefs(v) { getActiveWorld().bbangjuChiefs = v; },

    get isFurryBeach() { return getActiveWorld().isFurryBeach; },
    set isFurryBeach(v) { getActiveWorld().isFurryBeach = v; },

    get furryManualOpenUsed() { return Boolean(getActiveWorld().furryManualOpenUsed); },
    set furryManualOpenUsed(v) { getActiveWorld().furryManualOpenUsed = Boolean(v); },

    get furryBeachFeeMultiplier() { return getActiveWorld().furryBeachFeeMultiplier; },
    set furryBeachFeeMultiplier(v) { getActiveWorld().furryBeachFeeMultiplier = v; },

    reset() {
        const w = getActiveWorld();
        w.currentTurn = 1;
        w.currentTime = 'none';
        w.bbangjuState = 'recruiting';
        w.bbangjuChiefs = [];
        w.isFurryBeach = false;
        w.furryManualOpenUsed = false;
        w.furryBeachFeeMultiplier = 1.0;
        resetBbangjuVisits();
        resetOdysseyState();
        resetCardDeck();
        resetRequiemState();
        TimeSlotSystem.reset();
    },

    // 기획서 우선도: 통상 <<< 시간대 [낮 / 밤] <<< 그을음 <<< 빛무리 <<< 정산
    getActiveGimmickType() {
        if (RequiemState.isHaloState) return 'halo';
        if (RequiemState.isSootState) return 'soot';
        if (this.currentTime === 'day' || this.currentTime === 'night') return this.currentTime;
        return 'none';
    },

    updateTurn(globalTurn) {
        this.currentTurn = globalTurn;
        const result = TimeSlotSystem.advanceGlobalTurn(globalTurn);
        this.currentTime = result.newPhase;

        // 그을음 또는 빛무리가 활성화되어 있을 때는 우선도에 의해 시간대 알림이 덮어씌워짐
        if (result.changed && !RequiemState.isSootState && !RequiemState.isHaloState) {
            const gText = getGimmickText();
            if (result.newPhase === 'day') {
                RuntimePopup.showToast(gText.TIME_START_DAY, 3800);
            } else if (result.newPhase === 'night') {
                RuntimePopup.showToast(gText.TIME_START_NIGHT, 3800);
            } else if (result.newPhase === 'none' && result.prevPhase !== 'none') {
                RuntimePopup.showToast(gText.TIME_END_NORMAL, 3200);
            }
        }
    },

    // 플레이어의 자신의 턴 시작 시 그을음/빛무리 턴 카운트 차감 및 자연 전환 처리
    advancePlayerTurn(player, globalTurn, allPlayers, tiles = null) {
        return advanceRequiemOnTurnStart(player, globalTurn, allPlayers, tiles);
    },

    // 특수 카드(심판의 시간 / 교주의 염원) 발동 시 즉시 빛무리 전환
    triggerHaloByCard(allPlayers, cardUser, stateType, ctx = null) {
        triggerHaloByCard(allPlayers, cardUser, stateType, ctx);
    },

    getRemainingTimeTurns() {
        if (RequiemState.isHaloState) return RequiemState.haloRemainingTurns;
        if (RequiemState.isSootState) return RequiemState.sootRemainingTurns;
        return TimeSlotSystem.getRemainingTurns();
    },

    accelerateTime(reduceTurns = 2) {
        return TimeSlotSystem.accelerateTime(reduceTurns);
    },

    // 4턴 시작 시 정비반장 정산
    resolveBbangju(players) {
        if (this.bbangjuState !== 'recruiting') return;
        this.bbangjuState = 'finished';
        const gText = getGimmickText();

        const supporters = players.filter(p => p.bbangjuPaidTotal >= (GAME_CONSTANTS.BBANGJU_SUPPORT_INSTALLMENT * 3));

        // 4명 전부면 무효, 1~3명이면 정비반장 임명, 0명이면 공석
        if (supporters.length > 0 && supporters.length < 4) {
            supporters.forEach(p => p.isBbangjuChief = true);
            this.bbangjuChiefs = supporters;
            RuntimePopup.showToast(`${supporters.length}${gText.BBANGJU_RESOLVE_CHIEFS}`, 3800);
        } else if (supporters.length === 4) {
            this.bbangjuChiefs = []; // 전원 완납 시 무효(공석) + 참여자 각자 위로금 75만 환급
            const refund = GAME_CONSTANTS.BBANGJU_ALL_VACANT_REFUND || 750000;
            supporters.forEach(p => {
                if (!p.isBankrupt) {
                    p.money += refund;
                    if (p.tracker) {
                        p.tracker.bbangjuVacantRefundTotal = (p.tracker.bbangjuVacantRefundTotal || 0) + refund;
                    }
                }
            });
            RuntimePopup.showToast(gText.BBANGJU_RESOLVE_ALL_INVALID, 4200);
        } else {
            this.bbangjuChiefs = []; // 납부자 없음 (공석)
            RuntimePopup.showToast(gText.BBANGJU_RESOLVE_NONE, 3800);
        }
    },

    getGimmickMultiplier(tile) {
        // 그을음 및 빛무리 진행 중에는 우선도에 의해 시간대(낮/밤) 배율이 적용되지 않고 덮어씌워짐
        if (RequiemState.isSootState || RequiemState.isHaloState) {
            return 0;
        }
        return TimeSlotSystem.getTimeMultiplier(tile, this.currentTime);
    }
};

export function syncFurryBeachFeeMultiplier(allPlayers = []) {
    const hasKomi = WorldGimmickManager.isFurryBeach && (allPlayers || []).some(p =>
        p && !p.isBankrupt && p.buffs && (
            (Array.isArray(p.buffs['hold_komi']) && p.buffs['hold_komi'].length > 0) ||
            (Array.isArray(p.buffs['todo_hold_komi']) && p.buffs['todo_hold_komi'].length > 0)
        )
    );
    WorldGimmickManager.furryBeachFeeMultiplier = hasKomi ? 1.5 : 1.0;
    return WorldGimmickManager.furryBeachFeeMultiplier;
}
