import { TimeSlotConfig } from '../System/Index/Marble/MarbleBoardIndex.js';
import { GAME_CONSTANTS, MULTIPLIERS } from '../System/Index/Marble/MarblePriceIndex.js';
import { getActiveWorld } from './MarbleRuntime.js';

export const TimeSlotSystem = {
    get currentPhase() { return getActiveWorld().timeSlot.currentPhase; },
    set currentPhase(v) { getActiveWorld().timeSlot.currentPhase = v; },

    get remainingTurns() { return getActiveWorld().timeSlot.remainingTurns; },
    set remainingTurns(v) { getActiveWorld().timeSlot.remainingTurns = v; },

    get hasDayFinished() { return getActiveWorld().timeSlot.hasDayFinished; },
    set hasDayFinished(v) { getActiveWorld().timeSlot.hasDayFinished = v; },

    get hasNightFinished() { return getActiveWorld().timeSlot.hasNightFinished; },
    set hasNightFinished(v) { getActiveWorld().timeSlot.hasNightFinished = v; },

    // 새 게임 시작 시 시간대 카운터 상태 초기화
    reset() {
        const ts = getActiveWorld().timeSlot;
        ts.currentPhase = 'none';
        ts.remainingTurns = 0;
        ts.hasDayFinished = false;
        ts.hasNightFinished = false;
    },

    // 게임 시작 시 기획서 룰에 맞춰 모든 타일의 시간대(낮/밤/면제)를 단 1회 배정 (게임 종료까지 불변)
    initTiles(tiles) {
        tiles.forEach(tile => {
            if (
                TimeSlotConfig.IMMUNE.includes(tile.id) ||
                tile.type !== 'normal'
            ) {
                tile.timeType = 'none';
            } else if (TimeSlotConfig.FIXED_DAY.includes(tile.id)) {
                tile.timeType = 'day';
            } else if (TimeSlotConfig.FIXED_NIGHT.includes(tile.id)) {
                tile.timeType = 'night';
            } else {
                // 고정이 아닌 일반 토지는 게임 시작 시 50% 확률로 낮/밤 랜덤 정립
                tile.timeType = Math.random() < 0.5 ? 'day' : 'night';
            }
            // 초기 부여된 시간대 보존 (매각/인수 후 재구매 시에도 변하지 않음)
            tile.baseTimeType = tile.timeType;
        });
    },

    // 글로벌 턴 갱신 시 호출되어 시간대 전환 및 잔여 턴 카운팅 수행
    advanceGlobalTurn(globalTurn) {
        const prevPhase = this.currentPhase;

        // 20번째 글로벌 턴에서는 모든 월드 기믹 강제 종료 -> 통상 상태
        if (globalTurn >= GAME_CONSTANTS.WORLD_GIMMICK_END_TURN) {
            this.currentPhase = 'none';
            this.remainingTurns = 0;
            return {
                changed: prevPhase !== 'none',
                prevPhase,
                newPhase: this.currentPhase,
                remainingTurns: this.remainingTurns
            };
        }

        // 1 ~ 9번째 턴: 통상 상태
        if (globalTurn < GAME_CONSTANTS.TIME_DAY_START_TURN) {
            this.currentPhase = 'none';
            this.remainingTurns = 0;
            return {
                changed: false,
                prevPhase,
                newPhase: this.currentPhase,
                remainingTurns: this.remainingTurns
            };
        }

        // 10번째 턴 도달 시: 낮 시간대(5턴) 개시
        if (this.currentPhase === 'none' && !this.hasDayFinished && globalTurn >= GAME_CONSTANTS.TIME_DAY_START_TURN) {
            this.currentPhase = 'day';
            this.remainingTurns = GAME_CONSTANTS.TIME_SLOT_DURATION; // 10, 11, 12, 13, 14턴 (총 5턴)
        } 
        // 낮 진행 중 글로벌 턴 경과
        else if (this.currentPhase === 'day') {
            this.remainingTurns--;
            if (this.remainingTurns <= 0) {
                this.hasDayFinished = true;
                this.currentPhase = 'night';
                this.remainingTurns = GAME_CONSTANTS.TIME_SLOT_DURATION; // 15, 16, 17, 18, 19턴 (총 5턴)
            }
        } 
        // 밤 진행 중 글로벌 턴 경과
        else if (this.currentPhase === 'night') {
            this.remainingTurns--;
            if (this.remainingTurns <= 0) {
                this.hasNightFinished = true;
                this.currentPhase = 'none';
                this.remainingTurns = 0;
            }
        }

        return {
            changed: prevPhase !== this.currentPhase,
            prevPhase,
            newPhase: this.currentPhase,
            remainingTurns: this.remainingTurns
        };
    },

    // 현재 시간대 반환
    getCurrentTime() {
        return this.currentPhase;
    },

    // 현재 시간대의 남은 턴 수 반환
    getRemainingTurns() {
        return this.remainingTurns;
    },

    // [시간가속] 카드 효과: 진행 중인 시간대의 남은 턴 수를 최대 2턴 단축 (2턴 이하 시 전부 단축 -> 다음 글로벌 턴에 전환)
    accelerateTime(reduceTurns = 2) {
        if (this.currentPhase !== 'day' && this.currentPhase !== 'night') return false;
        this.remainingTurns = Math.max(0, this.remainingTurns - reduceTurns);
        return true;
    },

    // 특정 타일이 현재 활성화된 시간대와 일치하는지 판정
    isTileTimeMatched(tile, activeTime = this.currentPhase) {
        if (!tile || activeTime === 'none' || tile.timeType === 'none') return false;
        return tile.timeType === activeTime;
    },

    // 시간대 일치 시 추가 통행료 배율(+0.2) 반환
    getTimeMultiplier(tile, activeTime = this.currentPhase) {
        return this.isTileTimeMatched(tile, activeTime) ? MULTIPLIERS.TIME_MATCH : 0;
    }
};
