// ProgramFiles/Unos/UnosEngine.js
// 우노스(UNOS) 서버·로컬 공용 순수 상태머신
// - 선/후공 숫자 카드(0~9) 추첨(TURN_ORDER: 5초 자동뽑기·동점 재추첨·덱 복귀 후 56장 원형 보존 셔플)
// - 56장 카드 페이즈(액션 1회 연쇄, 액션+리버스 색상 동기화, 스킵, 공명, 우울)
// - 6x6 체스 페이즈(색상 연동 이동, K/Q 예외, 퀸 2턴 쿨타임, 프로모션 강화 폰 승급+카드 소각, 캐슬링+위협 확인)
// - 버스트(UNO! 3턴 지속 + 우울(+2)/프로모션(-1) 재드로우 가감)
// - 초장기전 안전 상한(MAX_MATCH_TURNS = 160 / 킹 단독 12턴 판정) 및 10만 사이클 7대 통계 메트릭 집계
// - getSnapshotForPlayer 비공개 손패 마스킹

import {
    UNOS_PERSONALITY_KEYS,
    UNOS_CARD_KINDS,
    UNOS_TOTAL_CARD_COUNT,
    UNOS_TURN_ORDER_CONFIG,
    UNOS_TURN_TIMER_CONFIG,
    getUnosDict,
    formatUnosCardTitle
} from '../System/Index/Unos/UnosCardIndex.js';
import { normalizeUnosAiDifficulty } from '../System/GameRegistry.js';
import {
    UNOS_BOARD_SIZE,
    pickRandomUnosBoardPreset,
    validateUnosBoardGrid
} from '../System/Index/Unos/UnosBoardPresetIndex.js';
import {
    createInitialChessBoard,
    cloneChessBoard,
    getLegalPieceMoves,
    getAllLegalMovesForSide,
    getAvailableCastlings,
    isKingInCheck,
    executeChessMove,
    executeCastlingMove
} from './UnosChess.js';
import {
    createTurnOrderNumberPool,
    setupInitialUnosDeckAndHands,
    drawFromUnosDeck,
    evaluateUnosCardPlayability,
    annotateUnosHand
} from './UnosCard.js';
import { decideUnosAiAction } from './UnosAI.js';

const MAX_ACTION_LOGS = 24;
export const UNOS_MAX_MATCH_TURNS = 160;
export const UNOS_KING_ONLY_MAX_TURNS = 12;

const MATERIAL_WEIGHTS = Object.freeze({
    K: 0,
    Q: 900,
    R: 500,
    P_PLUS: 380,
    B: 320,
    N: 300,
    P: 100
});

function createInitialMatchMetrics() {
    return {
        turnOrderRounds: 1,
        turnOrderTieCount: 0,
        firstPlayerSlot: 0,
        totalBurstTriggers: 0,
        firstBurstTurn: null,
        burstRedrawCounts: [],
        depressionHitsDuringBurst: 0,
        promotionsDuringBurst: 0,
        cardsPlayedByKind: {
            number: 0,
            skip: 0,
            action: 0,
            reverse: 0,
            resonance: 0,
            depression: 0
        },
        actionCombo2Count: 0,
        actionCombo3Count: 0,
        turnBranches: {
            branch1_playAndMove: 0,
            branch2_playAndNoMovePenalty: 0,
            branch3_drawPlayAndMove: 0,
            branch4_drawKeepOrNoMove: 0,
            burstSkipCardTurn: 0,
            skipHitCardTurn: 0
        },
        deckReshuffleCount: 0,
        pieceMoves: {
            K: 0,
            Q: 0,
            R: 0,
            B: 0,
            N: 0,
            P: 0,
            P_PLUS: 0
        },
        pieceCaptures: {
            K: 0,
            Q: 0,
            R: 0,
            B: 0,
            N: 0,
            P: 0,
            P_PLUS: 0
        },
        kingFinisherPiece: null,
        isBurstCheckmate: false,
        queenCooldownActiveTurns: 0,
        promotionCount: 0,
        promotedPawnCardBurns: 0,
        promotedPawnBurstDeltaSubtracts: 0,
        castlingCount: {
            left: 0,
            right: 0,
            safe: 0,
            unsafeForced: 0
        },
        moveSafetyCounts: {
            none: 0,
            yellow: 0,
            red: 0
        },
        invariantViolations: {
            cardTotalMismatch: 0,
            boardPresetInvalid: 0,
            actionTripleChain: 0,
            queenCooldownViolation: 0,
            promotedPawnJumpOrColorViolation: 0,
            promotedPawnRePromotion: 0,
            nanOrInfiniteLoop: 0
        }
    };
}

export class UnosEngine {
    constructor({ room = null, customOptions = null, callbacks = {} } = {}) {
        this.room = room || {
            id: 'local_unos_room',
            code: 'UNOSLOCAL',
            gameId: 'unos',
            slots: []
        };
        this.customOptions = customOptions || room?.customOptions || {};
        this.callbacks = {
            onStateChange: callbacks.onStateChange || null,
            onEvent: callbacks.onEvent || null,
            onTimerTick: callbacks.onTimerTick || null,
            onPlayerAfkKick: callbacks.onPlayerAfkKick || null
        };

        this.rng = typeof this.customOptions.rng === 'function' ? this.customOptions.rng : Math.random;
        this.aiDelayMs = Number.isFinite(this.customOptions.aiDelayMs) ? Number(this.customOptions.aiDelayMs) : 420;
        this.maxTurns = Number(this.customOptions.maxTurns) > 0
            ? Number(this.customOptions.maxTurns)
            : UNOS_MAX_MATCH_TURNS;
        this.turnTimeLimitSec = this.customOptions.disableTurnTimer === true
            ? 0
            : (Number.isFinite(this.customOptions.turnTimerSec)
                ? Math.max(0, Number(this.customOptions.turnTimerSec))
                : UNOS_TURN_TIMER_CONFIG.TURN_LIMIT_SECONDS);
        this.noQueenCooldownInBurst = Boolean(this.customOptions.noQueenCooldownInBurst);

        this.isDestroyed = false;
        this.isStarted = false;
        this._aiTimer = null;
        this._turnTimerInterval = null;
        this.turnTimerLeft = 0;
        this._turnOrderTimers = new Set();
        this._turnOrderPool = [];
        this._kingOnlyTurns = 0;

        this.players = [];
        this.boardPreset = null;
        this.boardColors = [];
        this.chessBoard = [];
        this.deck = [];
        this.discardPile = [];
        this.centerCard = null;
        this.matchColor = UNOS_PERSONALITY_KEYS[0];
        this.turnOrderState = null;
        this.matchMetrics = createInitialMatchMetrics();

        this.turnState = {
            turnNumber: 1,
            currentPlayerIndex: 0,
            phase: 'TURN_ORDER', // 'TURN_ORDER' | 'CARD_PHASE' | 'DRAWN_CARD_PROMPT' | 'CHESS_PHASE' | 'PROMOTION_PROMPT' | 'GAME_OVER'
            actionChainStep: 0, // 0: 기본, 1: 1번째 액션 후, 2: 2번째 액션 후(3번째 액션 금지)
            playedCardsThisTurn: [],
            playedPersonalityColors: [],
            turnActiveColors: [],
            colorFreeMove: false,
            drewCardThisTurn: false,
            playedDrawnCardThisTurn: false,
            pendingDrawnCard: null,
            skippedCardPhase: false,
            enteredFromBurst: false
        };

        this.gameOverResult = null;
        this.lastMatchLogInput = null;
        this.actionLogs = [];

        // RoomManager 호환 어댑터
        this.turnManager = {
            getCurrentPlayer: () => this.getCurrentPlayer()
        };

        this._initPlayersFromRoom();
    }

    _initPlayersFromRoom() {
        const rawSlots = Array.isArray(this.room?.slots)
            ? this.room.slots.filter(s => s && s.type !== 'empty')
            : [];

        const slot0 = rawSlots[0] || {
            slotIndex: 0,
            type: 'human',
            id: 'unos_player_1',
            name: '교주 1',
            color: '#e74c3c',
            isConnected: true
        };
        const slot1 = rawSlots[1] || {
            slotIndex: 1,
            type: 'ai',
            id: 'unos_ai_2',
            name: '루포',
            color: '#3498db',
            isConnected: true,
            aiDifficulty: 'mild'
        };

        const ordered = [slot0, slot1];
        this.players = ordered.map((s, idx) => {
            const pType = s.type === 'ai' ? 'ai' : 'human';
            return {
                id: s.id || `unos_player_${idx + 1}`,
                name: s.name || `Player ${idx + 1}`,
                slotIndex: idx,
                type: pType,
                color: s.color || (idx === 0 ? '#e74c3c' : '#3498db'),
                isConnected: s.isConnected !== false,
                isMockHuman: Boolean(s.isMockHuman),
                aiDifficulty: normalizeUnosAiDifficulty(s.aiDifficulty || s.aiType, 'normal'),
                side: idx === 0 ? 'bottom' : 'top',
                hand: [],
                burst: {
                    active: false,
                    turnsLeft: 0,
                    pendingRedrawDelta: 0
                },
                skipNextCardPhase: false,
                lastChessMove: null,
                stats: {
                    cardsPlayed: 0,
                    cardsPlayedByKind: {
                        number: 0,
                        skip: 0,
                        action: 0,
                        reverse: 0,
                        resonance: 0,
                        depression: 0
                    },
                    piecesCaptured: 0,
                    burstTriggers: 0,
                    promotions: 0,
                    promotedPawnMoves: 0,
                    promotedPawnCaptures: 0
                },
                isAi() {
                    return this.type === 'ai';
                }
            };
        });
    }

    start() {
        if (this.isDestroyed) return;
        this.isStarted = true;
        this._clearTurnOrderTimers();
        this._kingOnlyTurns = 0;
        this.matchMetrics = createInitialMatchMetrics();

        // 1. 6x6 색상 보드 프리셋 O(1) 선택 및 무결성 확인
        this.boardPreset = pickRandomUnosBoardPreset({ rng: this.rng });
        this.boardColors = this.boardPreset.grid.map(row => [...row]);
        if (!validateUnosBoardGrid(this.boardColors).valid) {
            this.matchMetrics.invariantViolations.boardPresetInvalid += 1;
        }

        // 기본 배경 체스판 임시 배치 (선/후공 확정 시 진영에 맞춰 정식 재배치)
        this.chessBoard = createInitialChessBoard(
            this.players[0].id,
            this.players[1].id
        );
        this.turnState.turnNumber = 1;
        this.gameOverResult = null;
        this.actionLogs = [];

        // 고정 선공 옵션(단위 테스트용) 또는 skipTurnOrder 지정 시 즉시 본 게임 세팅
        if (this.customOptions.fixedFirstPlayerIndex === 0
            || this.customOptions.fixedFirstPlayerIndex === 1
            || this.customOptions.skipTurnOrder === true) {
            const fixedIdx = (this.customOptions.fixedFirstPlayerIndex === 0 || this.customOptions.fixedFirstPlayerIndex === 1)
                ? this.customOptions.fixedFirstPlayerIndex
                : (this.rng() < 0.5 ? 0 : 1);
            this.matchMetrics.turnOrderRounds = 1;
            this.matchMetrics.turnOrderTieCount = 0;
            this._finalizeMatchSetup(fixedIdx);
            return;
        }

        // 양측 모두 AI이고 forceInteractiveTurnOrder가 아니면 숫자 카드 추첨을 동기 처리
        const allAi = this.players.every(p => p.type === 'ai');
        if (allAi && !this.customOptions.forceInteractiveTurnOrder) {
            this._resolveAiTurnOrderSync();
            return;
        }

        // 인간 플레이어 포함 시 인터랙티브 선/후공 숫자 카드(0~9) 뽑기(5초 자동뽑기·동점 재추첨) 진입
        this._startInteractiveTurnOrder();
    }

    _scheduleTurnOrderTimer(fn, delayMs) {
        if (this.isDestroyed) return null;
        const timerId = setTimeout(() => {
            this._turnOrderTimers.delete(timerId);
            if (!this.isDestroyed) {
                fn();
            }
        }, delayMs);
        this._turnOrderTimers.add(timerId);
        return timerId;
    }

    _clearTurnOrderTimers() {
        for (const id of this._turnOrderTimers) {
            clearTimeout(id);
        }
        this._turnOrderTimers.clear();
    }

    _resolveAiTurnOrderSync() {
        let round = 0;
        let card0 = null;
        let card1 = null;

        while (round < 25) {
            round += 1;
            const pool = createTurnOrderNumberPool(this.rng);
            card0 = pool.shift();
            card1 = pool.shift();
            if (card0.value !== card1.value) {
                break;
            }
            this._addLog(`선/후공 숫자 카드 동점 (${formatUnosCardTitle(card0, 'ko')} vs ${formatUnosCardTitle(card1, 'ko')}) → 재추첨`);
        }

        this.matchMetrics.turnOrderRounds = round;
        this.matchMetrics.turnOrderTieCount = Math.max(0, round - 1);

        const firstIdx = (card0 && card1 && card0.value >= card1.value) ? 0 : 1;
        const secondIdx = 1 - firstIdx;

        this.turnOrderState = {
            visible: false,
            stage: 'DONE',
            round,
            secondsLeft: 0,
            tieNotice: '',
            firstPlayerId: this.players[firstIdx].id,
            secondPlayerId: this.players[secondIdx].id,
            players: this.players.map((p, idx) => {
                const c = idx === 0 ? card0 : card1;
                return {
                    id: p.id,
                    name: p.name,
                    color: p.color,
                    isAi: p.type === 'ai',
                    slotIndex: idx,
                    drawnCard: c ? { ...c } : null,
                    number: c ? c.value : 0,
                    drawn: true,
                    rank: idx === firstIdx ? 1 : 2,
                    tied: false
                };
            })
        };

        const firstCard = firstIdx === 0 ? card0 : card1;
        const secondCard = secondIdx === 0 ? card0 : card1;
        this._addLog(
            `🎴 선/후공 카드 추첨 완료: 1st ${this.players[firstIdx].name}[${formatUnosCardTitle(firstCard, 'ko')}] vs 2nd ${this.players[secondIdx].name}[${formatUnosCardTitle(secondCard, 'ko')}] (카드 덱 복귀 후 56장 셔플)`
        );
        this._finalizeMatchSetup(firstIdx);
    }

    _startInteractiveTurnOrder() {
        this.turnState.phase = 'TURN_ORDER';
        this.turnOrderState = {
            visible: true,
            stage: 'DRAWING',
            round: 1,
            secondsLeft: Math.max(1, Number(this.customOptions.turnOrderDrawSec ?? UNOS_TURN_ORDER_CONFIG.AUTO_DRAW_SECONDS) || 5),
            tieNotice: '',
            firstPlayerId: null,
            secondPlayerId: null,
            players: this.players.map((p, idx) => ({
                id: p.id,
                name: p.name,
                color: p.color,
                isAi: p.type === 'ai',
                isMockHuman: Boolean(p.isMockHuman),
                slotIndex: idx,
                drawnCard: null,
                number: null,
                drawn: false,
                rank: null,
                tied: false
            }))
        };
        this._startTurnOrderRound(1);
    }

    _startTurnOrderRound(roundNum) {
        if (this.isDestroyed || !this.turnOrderState) return;
        this._clearTurnOrderTimers();

        const autoDrawSec = Math.max(
            1,
            Number(this.customOptions.turnOrderDrawSec ?? UNOS_TURN_ORDER_CONFIG.AUTO_DRAW_SECONDS) || 5
        );

        this._turnOrderPool = createTurnOrderNumberPool(this.rng);
        this.turnState.phase = 'TURN_ORDER';
        this.turnOrderState.visible = true;
        this.turnOrderState.stage = 'DRAWING';
        this.turnOrderState.round = roundNum;
        this.turnOrderState.secondsLeft = autoDrawSec;
        this.turnOrderState.tieNotice = '';
        this.turnOrderState.firstPlayerId = null;
        this.turnOrderState.secondPlayerId = null;
        this.matchMetrics.turnOrderRounds = roundNum;

        for (const entry of this.turnOrderState.players) {
            entry.drawnCard = null;
            entry.number = null;
            entry.drawn = false;
            entry.rank = null;
            entry.tied = false;
        }

        this._emitState();

        const aiDrawDelay = Number.isFinite(this.customOptions.turnOrderAiDelayMs)
            ? Number(this.customOptions.turnOrderAiDelayMs)
            : (this.aiDelayMs > 0 ? UNOS_TURN_ORDER_CONFIG.AI_DRAW_DELAY_MS : 0);

        for (const entry of this.turnOrderState.players) {
            if (entry.isAi || entry.isMockHuman) {
                if (aiDrawDelay > 0) {
                    this._scheduleTurnOrderTimer(() => {
                        if (this.turnOrderState?.round === roundNum && this.turnOrderState?.stage === 'DRAWING') {
                            this._drawTurnOrderCardForPlayer(entry.id);
                        }
                    }, aiDrawDelay + entry.slotIndex * 200);
                }
            }
        }

        if (this.customOptions.disableTurnOrderAutoTimer !== true) {
            for (let s = 1; s < autoDrawSec; s++) {
                this._scheduleTurnOrderTimer(() => {
                    if (!this.turnOrderState || this.turnOrderState.round !== roundNum || this.turnOrderState.stage !== 'DRAWING') return;
                    this.turnOrderState.secondsLeft = Math.max(0, autoDrawSec - s);
                    this._emitState();
                }, s * 1000);
            }

            this._scheduleTurnOrderTimer(() => {
                if (!this.turnOrderState || this.turnOrderState.round !== roundNum || this.turnOrderState.stage !== 'DRAWING') return;
                this.turnOrderState.secondsLeft = 0;
                const pendingIds = this.turnOrderState.players.filter(e => !e.drawn).map(e => e.id);
                for (const pid of pendingIds) {
                    this._drawTurnOrderCardForPlayer(pid);
                }
            }, autoDrawSec * 1000);
        }
    }

    _drawTurnOrderCardForPlayer(playerId, forcedNumber = undefined) {
        if (this.isDestroyed || this.turnState.phase !== 'TURN_ORDER' || !this.turnOrderState?.visible) {
            return { ok: false, error: 'NOT_IN_TURN_ORDER' };
        }
        if (this.turnOrderState.stage !== 'DRAWING') {
            return { ok: false, error: 'TURN_ORDER_ROUND_NOT_DRAWING' };
        }

        const entry = this.turnOrderState.players.find(e => e.id === playerId);
        if (!entry) {
            return { ok: false, error: 'PLAYER_NOT_FOUND' };
        }
        if (entry.drawn) {
            return { ok: false, error: 'ALREADY_DRAWN_TURN_ORDER' };
        }

        if (!Array.isArray(this._turnOrderPool) || this._turnOrderPool.length === 0) {
            this._turnOrderPool = createTurnOrderNumberPool(this.rng);
        }

        let pickedCard = null;
        if (Number.isInteger(forcedNumber) && forcedNumber >= 0 && forcedNumber <= 9) {
            const forcedIdx = this._turnOrderPool.findIndex(c => c.value === forcedNumber);
            if (forcedIdx !== -1) {
                [pickedCard] = this._turnOrderPool.splice(forcedIdx, 1);
            }
        }
        if (!pickedCard) {
            pickedCard = this._turnOrderPool.shift();
        }

        entry.drawnCard = { ...pickedCard };
        entry.number = Number(pickedCard.value);
        entry.drawn = true;

        this._addLog(`🎴 ${entry.name}: 선/후공 추첨 카드 [${formatUnosCardTitle(pickedCard, 'ko')}] 뽑음`);

        const stillPending = this.turnOrderState.players.some(e => !e.drawn);
        if (stillPending) {
            this._emitState();
            return { ok: true, drawnCard: entry.drawnCard, allDrawn: false };
        }

        this._evaluateTurnOrderRound();
        return { ok: true, drawnCard: entry.drawnCard, allDrawn: true };
    }

    _evaluateTurnOrderRound() {
        if (this.isDestroyed || !this.turnOrderState) return;
        if (this.turnOrderState.players.some(e => !e.drawn)) return;

        this._clearTurnOrderTimers();

        const [e0, e1] = this.turnOrderState.players;
        const currentRound = this.turnOrderState.round;

        if (e0.number === e1.number) {
            this.matchMetrics.turnOrderTieCount += 1;
            this.turnOrderState.stage = 'TIE_REDRAW';
            this.turnOrderState.secondsLeft = 0;
            e0.tied = true;
            e1.tied = true;
            this.turnOrderState.tieNotice = `⚡ 동점! (${e0.number} vs ${e1.number}) 숫자 카드를 다시 뽑습니다...`;
            this._addLog(`⚡ 선/후공 추첨 동점 (${formatUnosCardTitle(e0.drawnCard, 'ko')} vs ${formatUnosCardTitle(e1.drawnCard, 'ko')})! 재추첨을 진행합니다.`);
            this._emitState();

            const tieDelayMs = Number.isFinite(this.customOptions.turnOrderTieDelayMs)
                ? Number(this.customOptions.turnOrderTieDelayMs)
                : UNOS_TURN_ORDER_CONFIG.TIE_REDRAW_DELAY_MS;

            if (tieDelayMs <= 0) {
                this._startTurnOrderRound(currentRound + 1);
            } else {
                this._scheduleTurnOrderTimer(() => {
                    if (this.turnOrderState?.round === currentRound && this.turnOrderState?.stage === 'TIE_REDRAW') {
                        this._startTurnOrderRound(currentRound + 1);
                    }
                }, tieDelayMs);
            }
            return;
        }

        const firstEntry = e0.number > e1.number ? e0 : e1;
        const secondEntry = e0.number > e1.number ? e1 : e0;

        firstEntry.rank = 1;
        secondEntry.rank = 2;
        firstEntry.tied = false;
        secondEntry.tied = false;

        this.turnOrderState.stage = 'RESULT';
        this.turnOrderState.secondsLeft = 0;
        this.turnOrderState.tieNotice = '';
        this.turnOrderState.firstPlayerId = firstEntry.id;
        this.turnOrderState.secondPlayerId = secondEntry.id;

        this._addLog(
            `🎉 선/후공 확정! 선공(1st): ${firstEntry.name}[${formatUnosCardTitle(firstEntry.drawnCard, 'ko')}] / 후공(2nd): ${secondEntry.name}[${formatUnosCardTitle(secondEntry.drawnCard, 'ko')}] (추첨 카드는 덱 복귀 후 56장 셔플)`
        );
        this._emitState();

        const resultHoldMs = Number.isFinite(this.customOptions.turnOrderResultDelayMs)
            ? Number(this.customOptions.turnOrderResultDelayMs)
            : UNOS_TURN_ORDER_CONFIG.RESULT_HOLD_DELAY_MS;

        if (resultHoldMs <= 0) {
            this._finalizeMatchSetup(firstEntry.slotIndex);
        } else {
            this._scheduleTurnOrderTimer(() => {
                if (this.turnOrderState?.stage === 'RESULT') {
                    this._finalizeMatchSetup(firstEntry.slotIndex);
                }
            }, resultHoldMs);
        }
    }

    _finalizeMatchSetup(firstIdx) {
        if (this.isDestroyed) return;
        this._clearTurnOrderTimers();

        if (this.turnOrderState) {
            this.turnOrderState.visible = false;
            this.turnOrderState.stage = 'DONE';
        }

        const secondIdx = 1 - firstIdx;
        this.matchMetrics.firstPlayerSlot = firstIdx;

        // 선공이 하단(bottom: 1~2열, r=5,4), 후공이 상단(top: 6~5열, r=0,1)
        this.players[firstIdx].side = 'bottom';
        this.players[secondIdx].side = 'top';

        // 56장 원형 보존 덱 전체 셔플 + 선공 4 -> 후공 4 -> 선공 3 -> 후공 3 분배 + 중앙 비특수 카드 공개
        const cardSetup = setupInitialUnosDeckAndHands(null, this.rng);
        this.deck = cardSetup.deck;
        this.discardPile = cardSetup.discardPile;
        this.centerCard = cardSetup.centerCard;
        this.matchColor = cardSetup.initialMatchColor;

        this.players[firstIdx].hand = cardSetup.firstHand;
        this.players[secondIdx].hand = cardSetup.secondHand;

        this._verifyCardTotalInvariant();

        // 6x6 거울 대칭 초기 기물 배치
        this.chessBoard = createInitialChessBoard(
            this.players[firstIdx].id,
            this.players[secondIdx].id
        );

        this.turnState.turnNumber = 1;
        this.turnState.currentPlayerIndex = firstIdx;

        this._addLog(`게임 시작! 선공: ${this.players[firstIdx].name} (중앙 카드: ${formatUnosCardTitle(this.centerCard, 'ko')})`);
        this._startTurn();
    }

    _verifyCardTotalInvariant() {
        const total = (this.deck?.length || 0)
            + (this.discardPile?.length || 0)
            + (this.players[0]?.hand?.length || 0)
            + (this.players[1]?.hand?.length || 0);
        if (total !== UNOS_TOTAL_CARD_COUNT) {
            this.matchMetrics.invariantViolations.cardTotalMismatch += 1;
        }
    }

    _drawCardsWithMetrics(count) {
        const res = drawFromUnosDeck(this.deck, this.discardPile, count, this.rng);
        if (res.reshuffledCount > 0) {
            this.matchMetrics.deckReshuffleCount += 1;
        }
        return res;
    }

    getCurrentPlayer() {
        return this.players[this.turnState.currentPlayerIndex] || null;
    }

    getOpponentPlayer(playerId = null) {
        if (playerId) {
            return this.players.find(p => p.id !== playerId) || null;
        }
        const oppIdx = 1 - this.turnState.currentPlayerIndex;
        return this.players[oppIdx] || null;
    }

    _addLog(text) {
        if (!text) return;
        this.actionLogs.push({
            turn: this.turnState.turnNumber,
            text,
            ts: Date.now()
        });
        while (this.actionLogs.length > MAX_ACTION_LOGS) {
            this.actionLogs.shift();
        }
    }

    _emitState() {
        if (this.isDestroyed) return;
        if (typeof this.callbacks.onStateChange === 'function') {
            this.callbacks.onStateChange(this);
        }
    }

    _emitEvent(event) {
        if (this.isDestroyed) return;
        if (typeof this.callbacks.onEvent === 'function') {
            this.callbacks.onEvent(event);
        }
    }

    _startTurnTimer() {
        this._stopTurnTimer();
        if (this.isDestroyed || this.turnState.phase === 'GAME_OVER' || this.turnState.phase === 'TURN_ORDER') return;
        const player = this.getCurrentPlayer();
        if (!player || player.type === 'ai' || this.turnTimeLimitSec <= 0) {
            this.turnTimerLeft = 0;
            return;
        }

        this.turnTimerLeft = this.turnTimeLimitSec;
        if (typeof this.callbacks.onTimerTick === 'function') {
            this.callbacks.onTimerTick({
                timeLeft: this.turnTimerLeft,
                activePlayerId: player.id,
                phase: this.turnState.phase
            });
        }

        const expectedTurnNumber = this.turnState.turnNumber;
        this._turnTimerInterval = setInterval(() => {
            if (this.isDestroyed || this.turnState.phase === 'GAME_OVER' || this.turnState.turnNumber !== expectedTurnNumber) {
                this._stopTurnTimer();
                return;
            }
            const cur = this.getCurrentPlayer();
            if (!cur || cur.id !== player.id || cur.type === 'ai') {
                this._stopTurnTimer();
                return;
            }
            this.turnTimerLeft = Math.max(0, this.turnTimerLeft - 1);
            if (typeof this.callbacks.onTimerTick === 'function') {
                this.callbacks.onTimerTick({
                    timeLeft: this.turnTimerLeft,
                    activePlayerId: cur.id,
                    phase: this.turnState.phase
                });
            }
            if (this.turnTimerLeft <= 0) {
                this._stopTurnTimer();
                this._handleTurnTimeout(expectedTurnNumber, cur.id);
            }
        }, 1000);
    }

    _stopTurnTimer() {
        if (this._turnTimerInterval) {
            clearInterval(this._turnTimerInterval);
            this._turnTimerInterval = null;
        }
    }

    _handleTurnTimeout(expectedTurnNumber, playerId) {
        if (this.isDestroyed || this.turnState.phase === 'GAME_OVER') return;
        if (this.turnState.turnNumber !== expectedTurnNumber) return;
        const cur = this.getCurrentPlayer();
        if (!cur || cur.id !== playerId) return;

        this._addLog(`⏰ ${cur.name}: 제한시간 ${this.turnTimeLimitSec}초 초과! 자동 진행됩니다.`);
        this._emitEvent({
            type: 'TOAST',
            message: getUnosDict('ko').TURN_TIMEOUT_MSG
        });

        let guard = 0;
        while (!this.isDestroyed
            && this.turnState.phase !== 'GAME_OVER'
            && this.turnState.turnNumber === expectedTurnNumber
            && this.getCurrentPlayer()?.id === playerId
            && guard < 10) {
            guard += 1;
            const autoAction = decideUnosAiAction(this);
            if (!autoAction) break;
            const res = this.handleAction(playerId, autoAction);
            if (!res?.ok) break;
        }
    }

    _startTurn() {
        if (this.isDestroyed || this.turnState.phase === 'GAME_OVER') return;
        const player = this.getCurrentPlayer();
        if (!player) return;

        // 퀸 쿨타임 확인 (실험 옵션: 버스트 중 퀸 쿨타임 면제 시 기존 쿨타임도 즉시 해제)
        for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
            for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
                const p = this.chessBoard[r]?.[c];
                if (!p || p.side !== player.side || p.type !== 'Q') continue;
                if (this.noQueenCooldownInBurst && player.burst.active) {
                    p.cooldownTurns = 0;
                } else if ((p.cooldownTurns || 0) > 0) {
                    this.matchMetrics.queenCooldownActiveTurns += 1;
                }
            }
        }

        this.turnState.actionChainStep = 0;
        this.turnState.playedCardsThisTurn = [];
        this.turnState.playedPersonalityColors = [];
        this.turnState.turnActiveColors = [this.matchColor];
        this.turnState.colorFreeMove = Boolean(player.burst.active);
        this.turnState.drewCardThisTurn = false;
        this.turnState.playedDrawnCardThisTurn = false;
        this.turnState.pendingDrawnCard = null;
        this.turnState.skippedCardPhase = false;
        this.turnState.enteredFromBurst = Boolean(player.burst.active);
        this.turnState.phase = 'CARD_PHASE';

        this._startTurnTimer();

        // 1) 버스트(UNO!) 상태인 경우: 카드 제출/드로우 페이즈를 건너뛰고 즉시 체스 자유 이동
        if (player.burst.active) {
            player.skipNextCardPhase = false;
            this.turnState.colorFreeMove = true;
            this._addLog(`${player.name}의 버스트 턴! (잔여 ${player.burst.turnsLeft}턴, 색상 제약 무시)`);
            this._enterChessPhase();
            return;
        }

        // 2) 상대 스킵 카드로 카드 페이즈가 스킵된 경우: 중앙 스킵 카드의 활성 색상으로 즉시 체스 페이즈 진입
        if (player.skipNextCardPhase) {
            player.skipNextCardPhase = false;
            this.turnState.skippedCardPhase = true;
            this.turnState.turnActiveColors = [this.matchColor];
            this._addLog(`${player.name}의 카드 제출 페이즈가 스킵되었습니다! (활성 색상: ${getUnosDict('ko').COLORS[this.matchColor]})`);
            this._enterChessPhase({ fromSkip: true });
            return;
        }

        // 3) 일반 카드 제출 페이즈 시작
        this.turnState.phase = 'CARD_PHASE';
        this._emitState();
        this._scheduleAiIfNeeded();
    }

    _recordTurnBranchOutcome(movedOnChessBoard) {
        const tb = this.matchMetrics.turnBranches;
        if (this.turnState.enteredFromBurst && this.turnState.playedCardsThisTurn.length === 0) {
            tb.burstSkipCardTurn += 1;
            return;
        }
        if (this.turnState.skippedCardPhase) {
            tb.skipHitCardTurn += 1;
            return;
        }

        if (!this.turnState.drewCardThisTurn && this.turnState.playedCardsThisTurn.length > 0) {
            if (movedOnChessBoard) {
                tb.branch1_playAndMove += 1;
            } else {
                tb.branch2_playAndNoMovePenalty += 1;
            }
            return;
        }

        if (this.turnState.drewCardThisTurn) {
            if (this.turnState.playedDrawnCardThisTurn && movedOnChessBoard) {
                tb.branch3_drawPlayAndMove += 1;
            } else {
                tb.branch4_drawKeepOrNoMove += 1;
            }
        }
    }

    _enterChessPhase() {
        if (this.isDestroyed || this.turnState.phase === 'GAME_OVER') return;
        const player = this.getCurrentPlayer();
        if (!player) return;

        if (!this.turnState.turnActiveColors || this.turnState.turnActiveColors.length === 0) {
            this.turnState.turnActiveColors = [this.matchColor];
        }
        if (player.burst.active) {
            this.turnState.colorFreeMove = true;
        }

        this.turnState.phase = 'CHESS_PHASE';
        this.turnState.pendingDrawnCard = null;

        const moveOpts = {
            activeColors: this.turnState.turnActiveColors,
            colorFreeMove: this.turnState.colorFreeMove
        };
        const legalMoves = getAllLegalMovesForSide(this.chessBoard, this.boardColors, player.side, moveOpts);
        const castlings = getAvailableCastlings(this.chessBoard, this.boardColors, player.side, moveOpts);
        const hasAnyMove = legalMoves.length > 0 || castlings.left.available || castlings.right.available;

        // 이동 가능한 기물이 하나도 없는 경우 (4-2 분기 2, 4 및 스킵 턴 예외)
        if (!hasAnyMove) {
            this._recordTurnBranchOutcome(false);
            if (!this.turnState.drewCardThisTurn && !player.burst.active) {
                const { drawn } = this._drawCardsWithMetrics(1);
                if (drawn.length > 0) {
                    player.hand.push(...drawn);
                }
                this.turnState.drewCardThisTurn = true;
                this._addLog(`${player.name}: 이동 가능한 기물이 없어 페널티 카드 1장을 드로우하고 턴을 종료합니다.`);
                this._emitEvent({
                    type: 'TOAST',
                    message: '이동 가능한 기물이 없어 페널티 카드 1장을 드로우하고 턴을 종료합니다.'
                });
            } else {
                this._addLog(`${player.name}: 이동 가능한 기물이 없어 턴을 종료합니다.`);
                this._emitEvent({
                    type: 'TOAST',
                    message: '이동 가능한 기물이 없어 턴을 종료합니다.'
                });
            }
            this._endTurn({ movedPieceId: null });
            return;
        }

        this._emitState();
        this._scheduleAiIfNeeded();
    }

    _triggerBurst(player) {
        if (!player || player.burst.active) return;
        player.burst = {
            active: true,
            turnsLeft: 3,
            pendingRedrawDelta: 0
        };
        player.stats.burstTriggers += 1;
        this.matchMetrics.totalBurstTriggers += 1;
        if (this.matchMetrics.firstBurstTurn === null) {
            this.matchMetrics.firstBurstTurn = this.turnState.turnNumber;
        }
        this.turnState.colorFreeMove = true;
        this._addLog(`🔥 ${player.name} 버스트(UNO!) 발동! 3턴간 색상 제약 없이 체스 기물을 이동합니다.`);
        this._emitEvent({
            type: 'TOAST',
            message: `🔥 ${player.name} 버스트(UNO!) 발동! (3턴간 색상 자유 이동)`
        });
    }

    _computeBoardMaterialScore(side) {
        let score = 0;
        let nonKingPieces = 0;
        for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
            for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
                const p = this.chessBoard[r]?.[c];
                if (!p || p.side !== side) continue;
                if (p.type !== 'K') nonKingPieces += 1;
                const key = (p.type === 'P' && p.isPromoted) ? 'P_PLUS' : p.type;
                score += MATERIAL_WEIGHTS[key] || 0;
            }
        }
        return { score, nonKingPieces };
    }

    _resolveTurnLimitDecision(reason = 'TURN_LIMIT') {
        const [p0, p1] = this.players;
        const m0 = this._computeBoardMaterialScore(p0.side);
        const m1 = this._computeBoardMaterialScore(p1.side);

        let winner = p0;
        if (m0.score !== m1.score) {
            winner = m0.score > m1.score ? p0 : p1;
        } else if (p0.hand.length !== p1.hand.length) {
            winner = p0.hand.length < p1.hand.length ? p0 : p1;
        } else if (p0.stats.burstTriggers !== p1.stats.burstTriggers) {
            winner = p0.stats.burstTriggers > p1.stats.burstTriggers ? p0 : p1;
        } else if (p0.stats.piecesCaptured !== p1.stats.piecesCaptured) {
            winner = p0.stats.piecesCaptured > p1.stats.piecesCaptured ? p0 : p1;
        } else {
            // 완전 동률 시 후공(top) 어드밴티지 부여
            winner = p0.side === 'top' ? p0 : p1;
        }
        const loser = this.players.find(p => p.id !== winner.id) || p1;
        this._finishGame({
            winnerId: winner.id,
            loserId: loser.id,
            reason
        });
    }

    _endTurn({ movedPieceId = null, burstTriggeredInPromotion = false } = {}) {
        if (this.isDestroyed || this.turnState.phase === 'GAME_OVER') return;
        this._stopTurnTimer();
        const player = this.getCurrentPlayer();
        if (!player) return;

        // 1. 퀸 2턴당 1회 쿨타임 갱신 (실험 옵션 noQueenCooldownInBurst 시 버스트 중 쿨타임 미부여)
        const bypassQueenCooldown = this.noQueenCooldownInBurst && player.burst.active;
        for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
            for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
                const p = this.chessBoard[r][c];
                if (!p || p.side !== player.side) continue;
                if (p.id === movedPieceId && p.type === 'Q') {
                    p.cooldownTurns = bypassQueenCooldown ? 0 : 1;
                } else if ((p.cooldownTurns || 0) > 0) {
                    p.cooldownTurns = bypassQueenCooldown ? 0 : Math.max(0, p.cooldownTurns - 1);
                }
            }
        }

        // 2. 버스트 잔여 턴 차감 및 3번째 버스트 턴 종료 시 재드로우(7 + pendingRedrawDelta)
        if (player.burst.active) {
            if (!burstTriggeredInPromotion) {
                player.burst.turnsLeft = Math.max(0, player.burst.turnsLeft - 1);
            }
            if (player.burst.turnsLeft <= 0) {
                const targetRedraw = Math.max(1, 7 + (player.burst.pendingRedrawDelta || 0));
                const { drawn } = this._drawCardsWithMetrics(targetRedraw);
                player.hand.push(...drawn);
                this.matchMetrics.burstRedrawCounts.push(drawn.length);
                player.burst = {
                    active: false,
                    turnsLeft: 0,
                    pendingRedrawDelta: 0
                };
                this._addLog(`${player.name}의 버스트 종료! 카드 ${drawn.length}장을 재드로우하여 일반 상태로 복귀합니다.`);
                this._emitEvent({
                    type: 'TOAST',
                    message: `${player.name} 버스트 종료 (${drawn.length}장 재드로우)`
                });
            }
        }

        // 3. 킹 vs 킹 단독 잔류 교착 및 최대 턴(160턴) 안전 상한 검사
        const m0 = this._computeBoardMaterialScore(this.players[0].side);
        const m1 = this._computeBoardMaterialScore(this.players[1].side);
        if (m0.nonKingPieces === 0 && m1.nonKingPieces === 0) {
            this._kingOnlyTurns += 1;
        } else {
            this._kingOnlyTurns = 0;
        }

        if (this._kingOnlyTurns >= UNOS_KING_ONLY_MAX_TURNS) {
            this._resolveTurnLimitDecision('MATERIAL_DECISION');
            return;
        }
        if (this.turnState.turnNumber >= this.maxTurns) {
            this._resolveTurnLimitDecision('TURN_LIMIT');
            return;
        }

        // 4. 다음 플레이어 턴으로 전환
        this.turnState.currentPlayerIndex = 1 - this.turnState.currentPlayerIndex;
        this.turnState.turnNumber += 1;
        this._startTurn();
    }

    _finishGame({ winnerId, loserId, reason = 'CHECKMATE' }) {
        if (this.turnState.phase === 'GAME_OVER') return;
        this._clearAiTimer();
        this._stopTurnTimer();
        this._clearTurnOrderTimers();

        this.turnState.phase = 'GAME_OVER';
        const winner = this.players.find(p => p.id === winnerId) || this.players[0];
        const loser = this.players.find(p => p.id === loserId) || this.players.find(p => p.id !== winner.id);

        const results = [
            {
                rank: 1,
                id: winner.id,
                name: winner.name,
                isAi: winner.type === 'ai',
                side: winner.side,
                reason
            },
            {
                rank: 2,
                id: loser?.id || 'loser',
                name: loser?.name || 'Opponent',
                isAi: loser?.type === 'ai',
                side: loser?.side || 'top',
                reason
            }
        ];

        this.gameOverResult = {
            winnerId: winner.id,
            winnerName: winner.name,
            loserId: loser?.id || null,
            loserName: loser?.name || null,
            reason,
            totalTurns: this.turnState.turnNumber,
            results
        };

        const m0 = this._computeBoardMaterialScore(this.players[0].side);
        const m1 = this._computeBoardMaterialScore(this.players[1].side);

        this.lastMatchLogInput = {
            gameId: 'unos',
            mode: 'standard',
            totalTurns: this.turnState.turnNumber,
            winnerId: winner.id,
            winnerName: winner.name,
            winnerSide: winner.side,
            winnerSlot: winner.slotIndex,
            loserId: loser?.id || null,
            loserName: loser?.name || null,
            reason,
            metrics: {
                ...this.matchMetrics,
                cardsPlayedByKind: { ...this.matchMetrics.cardsPlayedByKind },
                winnerCardsPlayedByKind: { ...(winner.stats?.cardsPlayedByKind || {}) },
                turnBranches: { ...this.matchMetrics.turnBranches },
                pieceMoves: { ...this.matchMetrics.pieceMoves },
                pieceCaptures: { ...this.matchMetrics.pieceCaptures },
                castlingCount: { ...this.matchMetrics.castlingCount },
                moveSafetyCounts: { ...this.matchMetrics.moveSafetyCounts },
                invariantViolations: { ...this.matchMetrics.invariantViolations },
                burstRedrawCounts: [...this.matchMetrics.burstRedrawCounts]
            },
            players: this.players.map((p, idx) => ({
                id: p.id,
                name: p.name,
                slotIndex: p.slotIndex,
                type: p.type,
                side: p.side,
                isWinner: p.id === winner.id,
                remainingHandCount: p.hand.length,
                remainingMaterialScore: idx === 0 ? m0.score : m1.score,
                stats: {
                    ...p.stats,
                    cardsPlayedByKind: { ...p.stats.cardsPlayedByKind }
                }
            }))
        };

        const reasonLabel = reason === 'SURRENDER'
            ? '상대 기권'
            : (reason === 'TURN_LIMIT' || reason === 'MATERIAL_DECISION' ? '턴 상한 기물 우세 판정' : '킹 포획 (CHECKMATE)');
        this._addLog(`🏆 경기 종료! ${winner.name} 승리 (${reasonLabel})`);

        this._emitState();
        this._emitEvent({
            type: 'GAME_OVER',
            results: this.gameOverResult,
            matchLogData: this.lastMatchLogInput
        });
    }

    _applyPlayedCard(player, card, action = {}) {
        const opponent = this.getOpponentPlayer(player.id);
        this.discardPile.push(card);
        this.centerCard = card;
        this.turnState.playedCardsThisTurn.push(card);
        player.stats.cardsPlayed += 1;

        if (card.kind in this.matchMetrics.cardsPlayedByKind) {
            this.matchMetrics.cardsPlayedByKind[card.kind] += 1;
        }
        if (card.kind in player.stats.cardsPlayedByKind) {
            player.stats.cardsPlayedByKind[card.kind] += 1;
        }

        if (card.kind === UNOS_CARD_KINDS.ACTION && this.turnState.actionChainStep >= 2) {
            this.matchMetrics.invariantViolations.actionTripleChain += 1;
        }

        let requiresMoreCards = false;

        if (card.kind === UNOS_CARD_KINDS.NUMBER) {
            if (!this.turnState.playedPersonalityColors.includes(card.color)) {
                this.turnState.playedPersonalityColors.push(card.color);
            }
            this.matchColor = card.color;
            this.turnState.turnActiveColors = [...this.turnState.playedPersonalityColors];
            this._addLog(`${player.name}: [${formatUnosCardTitle(card, 'ko')}] 제출`);
        } else if (card.kind === UNOS_CARD_KINDS.SKIP) {
            if (!this.turnState.playedPersonalityColors.includes(card.color)) {
                this.turnState.playedPersonalityColors.push(card.color);
            }
            this.matchColor = card.color;
            this.turnState.turnActiveColors = [...this.turnState.playedPersonalityColors];
            if (opponent && !opponent.burst.active) {
                opponent.skipNextCardPhase = true;
            }
            this._addLog(`${player.name}: [${formatUnosCardTitle(card, 'ko')}] 제출 (상대 다음 카드 페이즈 스킵)`);
        } else if (card.kind === UNOS_CARD_KINDS.ACTION) {
            if (!this.turnState.playedPersonalityColors.includes(card.color)) {
                this.turnState.playedPersonalityColors.push(card.color);
            }
            this.matchColor = card.color;
            this.turnState.turnActiveColors = [...this.turnState.playedPersonalityColors];

            // 마지막 1장 예외: 손패 마지막 1장이 액션 카드면 추가 제출 없이 효과 무시하고 즉시 버스트 진입
            if (player.hand.length === 0) {
                requiresMoreCards = false;
                this._addLog(`${player.name}: 마지막 손패 [${formatUnosCardTitle(card, 'ko')}] 제출!`);
            } else {
                this.turnState.actionChainStep += 1;
                if (this.turnState.actionChainStep === 1) {
                    this.matchMetrics.actionCombo2Count += 1;
                } else if (this.turnState.actionChainStep === 2) {
                    this.matchMetrics.actionCombo3Count += 1;
                }
                const nextAnnotated = annotateUnosHand(player.hand, {
                    isMyTurn: true,
                    phase: 'CARD_PHASE',
                    matchColor: this.matchColor,
                    topCard: this.centerCard,
                    actionChainStep: this.turnState.actionChainStep
                });
                const hasFollowup = nextAnnotated.some(c => c.playable);
                requiresMoreCards = hasFollowup;
                this._addLog(`${player.name}: [${formatUnosCardTitle(card, 'ko')}] 제출! (조건 없이 카드 1장 추가 제출)`);
            }
        } else if (card.kind === UNOS_CARD_KINDS.REVERSE) {
            this.boardPreset = pickRandomUnosBoardPreset({
                excludeSignature: this.boardPreset?.signature || null,
                excludePresetIndex: this.boardPreset?.presetIndex ?? null,
                rng: this.rng
            });
            this.boardColors = this.boardPreset.grid.map(row => [...row]);
            if (!validateUnosBoardGrid(this.boardColors).valid) {
                this.matchMetrics.invariantViolations.boardPresetInvalid += 1;
            }

            const forcedColor = action._testForcedReverseColor || this.customOptions?.forcedReverseColor;
            const randomColor = (forcedColor && UNOS_PERSONALITY_KEYS.includes(forcedColor))
                ? forcedColor
                : UNOS_PERSONALITY_KEYS[Math.floor(this.rng() * UNOS_PERSONALITY_KEYS.length)];

            // 액션 + 리버스 조합 규약: 현재 턴 체스 이동 및 다음 상대 매칭 모두 리버스가 뽑은 랜덤 색상을 따름
            this.matchColor = randomColor;
            this.turnState.playedPersonalityColors = [randomColor];
            this.turnState.turnActiveColors = [randomColor];

            const colorLabel = getUnosDict('ko').COLORS[randomColor];
            this._addLog(`${player.name}: [리버스] 제출! (체스판 재배치 & 활성 성격 → ${colorLabel})`);
        } else if (card.kind === UNOS_CARD_KINDS.RESONANCE) {
            const chosenColor = UNOS_PERSONALITY_KEYS.includes(action.chosenColor)
                ? action.chosenColor
                : UNOS_PERSONALITY_KEYS[0];

            this.matchColor = chosenColor;
            if (!this.turnState.playedPersonalityColors.includes(chosenColor)) {
                this.turnState.playedPersonalityColors.push(chosenColor);
            }
            this.turnState.turnActiveColors = [...this.turnState.playedPersonalityColors];
            this.turnState.colorFreeMove = true;

            const colorLabel = getUnosDict('ko').COLORS[chosenColor];
            this._addLog(`${player.name}: [공명] 제출! (활성 성격 → ${colorLabel}, 이번 턴 색상 제약 없이 이동)`);
        } else if (card.kind === UNOS_CARD_KINDS.DEPRESSION) {
            if (this.turnState.playedPersonalityColors.length === 0) {
                this.turnState.turnActiveColors = [this.matchColor];
            } else {
                this.turnState.turnActiveColors = [...this.turnState.playedPersonalityColors];
            }

            if (opponent) {
                if (opponent.burst.active) {
                    opponent.burst.pendingRedrawDelta += 2;
                    this.matchMetrics.depressionHitsDuringBurst += 1;
                    this._addLog(`${player.name}: [우울] 제출! (${opponent.name} 버스트 종료 시 재드로우 +2장 가산)`);
                } else {
                    const { drawn } = this._drawCardsWithMetrics(2);
                    opponent.hand.push(...drawn);
                    this._addLog(`${player.name}: [우울] 제출! (${opponent.name} 카드 +${drawn.length}장 강제 드로우)`);
                }
            }
        }

        this._verifyCardTotalInvariant();

        // 손패가 0장이 되면 즉시 버스트(UNO!) 발동 및 체스 이동 페이즈로 직행
        if (player.hand.length === 0 && !player.burst.active) {
            this._triggerBurst(player);
            requiresMoreCards = false;
        }

        if (requiresMoreCards) {
            this.turnState.phase = 'CARD_PHASE';
            this._emitState();
            this._scheduleAiIfNeeded();
        } else {
            this._enterChessPhase();
        }
    }

    handleAction(playerId, action) {
        if (this.isDestroyed) {
            return { ok: false, error: 'ENGINE_DESTROYED' };
        }
        if (!action || typeof action.type !== 'string') {
            return { ok: false, error: 'INVALID_ACTION' };
        }
        if (this.turnState.phase === 'GAME_OVER') {
            return { ok: false, error: 'GAME_ALREADY_OVER' };
        }

        if (action.type === 'SURRENDER') {
            const surrendering = this.players.find(p => p.id === playerId);
            if (!surrendering) {
                return { ok: false, error: 'PLAYER_NOT_FOUND' };
            }
            const winner = this.players.find(p => p.id !== surrendering.id) || this.players[0];
            this._finishGame({
                winnerId: winner.id,
                loserId: surrendering.id,
                reason: 'SURRENDER'
            });
            return { ok: true };
        }

        // 0. TURN_ORDER_DRAW
        if (action.type === 'TURN_ORDER_DRAW' || action.type === 'TURN_ORDER_ROLL') {
            if (this.turnState.phase !== 'TURN_ORDER' || !this.turnOrderState?.visible) {
                return { ok: false, error: 'NOT_IN_TURN_ORDER' };
            }
            const targetPid = action.playerId || playerId;
            return this._drawTurnOrderCardForPlayer(targetPid, action._testForcedNumber);
        }

        const currentPlayer = this.getCurrentPlayer();
        if (!currentPlayer || currentPlayer.id !== playerId) {
            return { ok: false, error: 'NOT_YOUR_TURN' };
        }

        const phase = this.turnState.phase;

        // 1. PLAY_CARD
        if (action.type === 'PLAY_CARD') {
            if (phase !== 'CARD_PHASE') {
                return { ok: false, error: 'INVALID_PHASE_FOR_PLAY_CARD' };
            }
            const cardIdx = currentPlayer.hand.findIndex(c => c.id === action.cardId);
            if (cardIdx === -1) {
                return { ok: false, error: 'CARD_NOT_IN_HAND' };
            }
            const card = currentPlayer.hand[cardIdx];
            const check = evaluateUnosCardPlayability(card, {
                isMyTurn: true,
                phase: 'CARD_PHASE',
                matchColor: this.matchColor,
                topCard: this.centerCard,
                actionChainStep: this.turnState.actionChainStep
            });
            if (!check.playable) {
                return {
                    ok: false,
                    error: check.disabledReason || 'CARD_NOT_PLAYABLE',
                    message: check.disabledMessage || ''
                };
            }
            if (card.kind === UNOS_CARD_KINDS.RESONANCE) {
                if (!action.chosenColor || !UNOS_PERSONALITY_KEYS.includes(action.chosenColor)) {
                    return { ok: false, error: 'RESONANCE_COLOR_REQUIRED' };
                }
            }

            currentPlayer.hand.splice(cardIdx, 1);
            this._applyPlayedCard(currentPlayer, card, action);
            return { ok: true };
        }

        // 2. DRAW_CARD
        if (action.type === 'DRAW_CARD') {
            if (phase !== 'CARD_PHASE') {
                return { ok: false, error: 'INVALID_PHASE_FOR_DRAW_CARD' };
            }
            if (this.turnState.actionChainStep > 0) {
                return { ok: false, error: 'CANNOT_DRAW_DURING_ACTION_CHAIN' };
            }

            const annotated = annotateUnosHand(currentPlayer.hand, {
                isMyTurn: true,
                phase: 'CARD_PHASE',
                matchColor: this.matchColor,
                topCard: this.centerCard,
                actionChainStep: 0
            });
            if (!action.forceDraw && annotated.some(c => c.playable)) {
                return { ok: false, error: 'HAS_PLAYABLE_CARD' };
            }

            this.turnState.drewCardThisTurn = true;
            const { drawn } = this._drawCardsWithMetrics(1);
            if (drawn.length === 0) {
                this._verifyCardTotalInvariant();
                this.turnState.turnActiveColors = [this.matchColor];
                this._enterChessPhase();
                return { ok: true, drawnCard: null };
            }

            const drawnCard = drawn[0];
            currentPlayer.hand.push(drawnCard);
            this._verifyCardTotalInvariant();
            const playCheck = evaluateUnosCardPlayability(drawnCard, {
                isMyTurn: true,
                phase: 'CARD_PHASE',
                matchColor: this.matchColor,
                topCard: this.centerCard,
                actionChainStep: 0
            });

            if (playCheck.playable) {
                this.turnState.phase = 'DRAWN_CARD_PROMPT';
                this.turnState.pendingDrawnCard = drawnCard;
                this._addLog(`${currentPlayer.name}: 카드 1장 드로우 (제출 가능 카드 획득)`);
                this._emitState();
                this._scheduleAiIfNeeded();
            } else {
                this.turnState.turnActiveColors = [this.matchColor];
                this._addLog(`${currentPlayer.name}: 카드 1장 드로우 후 체스 이동 페이즈로 전환`);
                this._enterChessPhase();
            }
            return { ok: true, drawnCard };
        }

        // 3. RESOLVE_DRAWN_CARD
        if (action.type === 'RESOLVE_DRAWN_CARD') {
            if (phase !== 'DRAWN_CARD_PROMPT' || !this.turnState.pendingDrawnCard) {
                return { ok: false, error: 'NO_PENDING_DRAWN_CARD' };
            }
            const drawnCard = this.turnState.pendingDrawnCard;
            const decision = action.decision === 'play' ? 'play' : 'keep';

            if (decision === 'keep') {
                this.turnState.pendingDrawnCard = null;
                this.turnState.turnActiveColors = [this.matchColor];
                this._addLog(`${currentPlayer.name}: 드로우한 카드를 손패에 보관합니다.`);
                this._enterChessPhase();
                return { ok: true };
            }

            if (drawnCard.kind === UNOS_CARD_KINDS.RESONANCE) {
                if (!action.chosenColor || !UNOS_PERSONALITY_KEYS.includes(action.chosenColor)) {
                    return { ok: false, error: 'RESONANCE_COLOR_REQUIRED' };
                }
            }

            const idx = currentPlayer.hand.findIndex(c => c.id === drawnCard.id);
            if (idx !== -1) {
                currentPlayer.hand.splice(idx, 1);
            }
            this.turnState.pendingDrawnCard = null;
            this.turnState.playedDrawnCardThisTurn = true;
            this._applyPlayedCard(currentPlayer, drawnCard, action);
            return { ok: true };
        }

        // 4. COMMIT_MOVE
        if (action.type === 'COMMIT_MOVE') {
            if (phase !== 'CHESS_PHASE') {
                return { ok: false, error: 'INVALID_PHASE_FOR_MOVE' };
            }
            const from = action.from;
            const to = action.to;
            if (!from || !to) {
                return { ok: false, error: 'MISSING_MOVE_COORDS' };
            }
            const piece = this.chessBoard[from.r]?.[from.c];
            if (!piece || piece.side !== currentPlayer.side) {
                return { ok: false, error: 'NOT_YOUR_PIECE' };
            }

            const legalMoves = getLegalPieceMoves(this.chessBoard, this.boardColors, from.r, from.c, {
                activeColors: this.turnState.turnActiveColors,
                colorFreeMove: this.turnState.colorFreeMove || Boolean(currentPlayer.burst.active)
            });
            const matchedMove = legalMoves.find(m => m.r === to.r && m.c === to.c);
            if (!matchedMove) {
                return { ok: false, error: 'ILLEGAL_CHESS_MOVE' };
            }

            if (piece.type === 'Q' && (piece.cooldownTurns || 0) > 0) {
                this.matchMetrics.invariantViolations.queenCooldownViolation += 1;
            }

            const wasPromotedPawn = piece.type === 'P' && Boolean(piece.isPromoted);
            const movingPieceKey = wasPromotedPawn ? 'P_PLUS' : piece.type;

            const execRes = executeChessMove(this.chessBoard, from, to);
            if (!execRes.ok) {
                return execRes;
            }

            this._recordTurnBranchOutcome(true);
            currentPlayer.lastChessMove = {
                pieceId: piece.id,
                from: { r: from.r, c: from.c },
                to: { r: to.r, c: to.c }
            };

            // 기물 이동/포획/안전도 통계 기록
            if (movingPieceKey in this.matchMetrics.pieceMoves) {
                this.matchMetrics.pieceMoves[movingPieceKey] += 1;
            }
            if (wasPromotedPawn) {
                currentPlayer.stats.promotedPawnMoves += 1;
            }

            if (matchedMove.safety && matchedMove.safety in this.matchMetrics.moveSafetyCounts) {
                this.matchMetrics.moveSafetyCounts[matchedMove.safety] += 1;
            }

            if (execRes.capturedPiece) {
                currentPlayer.stats.piecesCaptured += 1;
                if (movingPieceKey in this.matchMetrics.pieceCaptures) {
                    this.matchMetrics.pieceCaptures[movingPieceKey] += 1;
                }
                if (wasPromotedPawn) {
                    currentPlayer.stats.promotedPawnCaptures += 1;
                }
            }

            const dict = getUnosDict('ko');
            const pieceLabel = wasPromotedPawn ? (dict.PIECES.P_PLUS || '강화폰') : (dict.PIECES[piece.type] || piece.type);
            const colNames = ['a', 'b', 'c', 'd', 'e', 'f'];
            const fromCoord = `${colNames[from.c]}${6 - from.r}`;
            const toCoord = `${colNames[to.c]}${6 - to.r}`;
            this._addLog(`${currentPlayer.name}: ${pieceLabel} (${fromCoord} → ${toCoord})`);

            // 상대 킹 포획 시 즉시 체크메이트 승리
            if (execRes.isKingCaptured) {
                this.matchMetrics.kingFinisherPiece = movingPieceKey;
                this.matchMetrics.isBurstCheckmate = Boolean(currentPlayer.burst.active);
                const opponent = this.getOpponentPlayer(currentPlayer.id);
                this._finishGame({
                    winnerId: currentPlayer.id,
                    loserId: opponent?.id || null,
                    reason: 'CHECKMATE'
                });
                return { ok: true, checkmate: true };
            }

            // 기본 폰 최초 끝열 도달 프로모션 (강화 폰 승급 + 카드 1장 소각)
            if (execRes.isPromotion) {
                if (wasPromotedPawn) {
                    this.matchMetrics.invariantViolations.promotedPawnRePromotion += 1;
                }
                currentPlayer.stats.promotions += 1;
                this.matchMetrics.promotionCount += 1;

                if (currentPlayer.burst.active || currentPlayer.hand.length === 0) {
                    if (currentPlayer.burst.active) {
                        currentPlayer.burst.pendingRedrawDelta -= 1;
                        this.matchMetrics.promotionsDuringBurst += 1;
                        this.matchMetrics.promotedPawnBurstDeltaSubtracts += 1;
                    }
                    this._addLog(`👑 ${currentPlayer.name} 프로모션 발동! (강화 폰[P+] 승급 & 버스트 재드로우 -1장 차감)`);
                    this._emitEvent({
                        type: 'TOAST',
                        message: '프로모션 발동! 폰이 강화되고 버스트 종료 시 재드로우 수량이 1장 감소합니다.'
                    });
                    this._endTurn({ movedPieceId: piece.id });
                    return { ok: true, promotion: true, promotedToPawnPlus: true };
                }

                this.turnState.phase = 'PROMOTION_PROMPT';
                this.turnState.lastMovedPieceId = piece.id;
                this._addLog(`👑 ${currentPlayer.name} 프로모션 발동! 폰이 강화(P+)되고 손패에서 버릴 카드 1장을 선택합니다.`);
                this._emitEvent({
                    type: 'TOAST',
                    message: getUnosDict('ko').PROMOTION_ALERT_MSG
                });
                this._emitState();
                this._scheduleAiIfNeeded();
                return { ok: true, promotion: true, promotedToPawnPlus: true, requiresCardBurn: true };
            }

            this._endTurn({ movedPieceId: piece.id });
            return { ok: true };
        }

        // 5. COMMIT_CASTLING
        if (action.type === 'COMMIT_CASTLING') {
            if (phase !== 'CHESS_PHASE') {
                return { ok: false, error: 'INVALID_PHASE_FOR_CASTLING' };
            }
            const castleSide = action.side === 'right' ? 'right' : (action.side === 'left' ? 'left' : null);
            if (!castleSide) {
                return { ok: false, error: 'INVALID_CASTLING_SIDE' };
            }

            const castlings = getAvailableCastlings(this.chessBoard, this.boardColors, currentPlayer.side, {
                activeColors: this.turnState.turnActiveColors,
                colorFreeMove: this.turnState.colorFreeMove || Boolean(currentPlayer.burst.active)
            });
            const info = castlings[castleSide];
            if (!info || !info.available) {
                return { ok: false, error: info?.reason || 'CASTLING_NOT_AVAILABLE' };
            }

            if (info.isKingDestThreatened && !action.forceUnsafe) {
                return {
                    ok: false,
                    error: 'CASTLING_UNSAFE_CONFIRM_REQUIRED',
                    requiresConfirm: true,
                    side: castleSide,
                    safety: info.safety,
                    message: getUnosDict('ko').CASTLING_UNSAFE_CONFIRM_MSG
                };
            }

            const execRes = executeCastlingMove(this.chessBoard, currentPlayer.side, castleSide);
            if (!execRes.ok) {
                return execRes;
            }

            this._recordTurnBranchOutcome(true);
            this.matchMetrics.castlingCount[castleSide] += 1;
            if (info.isKingDestThreatened) {
                this.matchMetrics.castlingCount.unsafeForced += 1;
            } else {
                this.matchMetrics.castlingCount.safe += 1;
            }
            this.matchMetrics.pieceMoves.K += 1;
            if (info.safety && info.safety in this.matchMetrics.moveSafetyCounts) {
                this.matchMetrics.moveSafetyCounts[info.safety] += 1;
            }

            const sideLabel = castleSide === 'left' ? '좌측 캐슬링' : '우측 캐슬링';
            this._addLog(`🏰 ${currentPlayer.name}: ${sideLabel} 실행`);
            this._endTurn({ movedPieceId: execRes.king?.id || null });
            return { ok: true, castled: castleSide };
        }

        // 6. RESOLVE_PROMOTION
        if (action.type === 'RESOLVE_PROMOTION') {
            if (phase !== 'PROMOTION_PROMPT') {
                return { ok: false, error: 'INVALID_PHASE_FOR_PROMOTION' };
            }
            const idx = currentPlayer.hand.findIndex(c => c.id === action.cardId);
            if (idx === -1) {
                return { ok: false, error: 'CARD_NOT_IN_HAND' };
            }
            const [burnedCard] = currentPlayer.hand.splice(idx, 1);

            if (this.discardPile.length > 0) {
                this.discardPile.unshift(burnedCard);
            } else {
                this.discardPile.push(burnedCard);
            }

            this.matchMetrics.promotedPawnCardBurns += 1;
            this._verifyCardTotalInvariant();
            this._addLog(`👑 ${currentPlayer.name}: 프로모션으로 [${formatUnosCardTitle(burnedCard, 'ko')}] 카드를 버렸습니다.`);

            let burstTriggeredInPromotion = false;
            if (currentPlayer.hand.length === 0 && !currentPlayer.burst.active) {
                this._triggerBurst(currentPlayer);
                burstTriggeredInPromotion = true;
            }

            const movedPieceId = this.turnState.lastMovedPieceId || null;
            this.turnState.lastMovedPieceId = null;
            this._endTurn({ movedPieceId, burstTriggeredInPromotion });
            return { ok: true, burnedCard };
        }

        return { ok: false, error: 'UNKNOWN_ACTION_TYPE' };
    }

    getSnapshotForPlayer(viewerPlayerId = null) {
        const currentPlayer = this.getCurrentPlayer();
        const viewer = this.players.find(p => p.id === viewerPlayerId) || null;
        const effectiveViewerId = viewer ? viewer.id : (currentPlayer?.id || this.players[0]?.id || null);

        const moveOpts = {
            activeColors: this.turnState.turnActiveColors,
            colorFreeMove: this.turnState.colorFreeMove || Boolean(currentPlayer?.burst?.active)
        };

        const legalMovesByPiece = {};
        let availableCastlings = {
            left: { available: false, isKingDestThreatened: false },
            right: { available: false, isKingDestThreatened: false }
        };

        if (currentPlayer && this.turnState.phase === 'CHESS_PHASE') {
            for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
                for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
                    const p = this.chessBoard[r]?.[c];
                    if (p && p.side === currentPlayer.side) {
                        legalMovesByPiece[`${r},${c}`] = getLegalPieceMoves(
                            this.chessBoard,
                            this.boardColors,
                            r,
                            c,
                            moveOpts
                        );
                    }
                }
            }
            availableCastlings = getAvailableCastlings(
                this.chessBoard,
                this.boardColors,
                currentPlayer.side,
                moveOpts
            );
        }

        const checkStatus = {
            bottom: isKingInCheck(this.chessBoard, 'bottom'),
            top: isKingInCheck(this.chessBoard, 'top')
        };

        const snapshotPlayers = this.players.map(p => {
            const isViewer = p.id === effectiveViewerId;
            const isPlayerTurn = currentPlayer?.id === p.id;
            const baseInfo = {
                id: p.id,
                name: p.name,
                slotIndex: p.slotIndex,
                type: p.type,
                color: p.color,
                isConnected: p.isConnected,
                side: p.side,
                handCount: p.hand.length,
                burst: { ...p.burst },
                skipNextCardPhase: p.skipNextCardPhase,
                inCheck: Boolean(checkStatus[p.side]),
                stats: { ...p.stats }
            };

            if (isViewer) {
                const annotatedHand = annotateUnosHand(p.hand, {
                    isMyTurn: isPlayerTurn,
                    phase: this.turnState.phase,
                    matchColor: this.matchColor,
                    topCard: this.centerCard,
                    actionChainStep: isPlayerTurn ? this.turnState.actionChainStep : 0
                });
                baseInfo.hand = annotatedHand;
                baseInfo.hasPlayableCard = annotatedHand.some(c => c.playable);
            }

            return baseInfo;
        });

        const isViewerTurn = Boolean(currentPlayer && currentPlayer.id === effectiveViewerId);

        return {
            gameId: 'unos',
            roomId: this.room?.id || 'local_unos_room',
            viewerId: effectiveViewerId,
            viewerSide: viewer?.side || 'bottom',
            turnNumber: this.turnState.turnNumber,
            timerLeft: this.turnTimerLeft,
            turnTimeLimitSec: this.turnTimeLimitSec,
            currentPlayerId: currentPlayer?.id || null,
            currentPlayerSide: currentPlayer?.side || 'bottom',
            phase: this.turnState.phase,
            actionChainStep: this.turnState.actionChainStep,
            matchColor: this.matchColor,
            turnActiveColors: [...(this.turnState.turnActiveColors || [this.matchColor])],
            colorFreeMove: Boolean(this.turnState.colorFreeMove || currentPlayer?.burst?.active),
            deckCount: this.deck.length,
            discardCount: this.discardPile.length,
            centerCard: this.centerCard ? { ...this.centerCard } : null,
            pendingDrawnCard: (isViewerTurn && this.turnState.pendingDrawnCard)
                ? { ...this.turnState.pendingDrawnCard }
                : null,
            boardPresetId: this.boardPreset?.variantId || 'P0_S0_C0',
            boardColors: this.boardColors.map(row => [...row]),
            chessBoard: cloneChessBoard(this.chessBoard),
            legalMovesByPiece: isViewerTurn ? legalMovesByPiece : {},
            availableCastlings: isViewerTurn ? availableCastlings : {
                left: { available: false, isKingDestThreatened: false },
                right: { available: false, isKingDestThreatened: false }
            },
            checkStatus,
            players: snapshotPlayers,
            turnOrderState: this.turnOrderState
                ? {
                    ...this.turnOrderState,
                    players: this.turnOrderState.players.map(e => ({
                        ...e,
                        drawnCard: e.drawnCard ? { ...e.drawnCard } : null
                    }))
                }
                : null,
            actionLogs: this.actionLogs.map(l => ({ ...l })),
            gameOverResult: this.gameOverResult ? { ...this.gameOverResult } : null
        };
    }

    _clearAiTimer() {
        if (this._aiTimer) {
            clearTimeout(this._aiTimer);
            this._aiTimer = null;
        }
    }

    _scheduleAiIfNeeded() {
        this._clearAiTimer();
        if (this.isDestroyed || this.turnState.phase === 'GAME_OVER') return;
        const currentPlayer = this.getCurrentPlayer();
        if (!currentPlayer || currentPlayer.type !== 'ai') return;

        if (this.aiDelayMs <= 0) {
            return;
        }

        this._aiTimer = setTimeout(() => {
            this._aiTimer = null;
            this.stepAi();
        }, this.aiDelayMs);
    }

    stepAi() {
        if (this.isDestroyed || this.turnState.phase === 'GAME_OVER') return false;
        const currentPlayer = this.getCurrentPlayer();
        if (!currentPlayer || currentPlayer.type !== 'ai') return false;

        const aiAction = decideUnosAiAction(this);
        if (!aiAction) return false;
        const res = this.handleAction(currentPlayer.id, aiAction);
        return Boolean(res?.ok);
    }

    markPlayerConnected(playerId, isConnected) {
        const p = this.players.find(pl => pl.id === playerId);
        if (p) {
            p.isConnected = Boolean(isConnected);
            this._emitState();
        }
    }

    convertPlayerToAi(playerId) {
        const p = this.players.find(pl => pl.id === playerId);
        if (p && p.type !== 'ai') {
            p.type = 'ai';
            p.isConnected = false;
            this._addLog(`${p.name}님이 이탈하여 AI가 대리 조작합니다.`);
            if (this.getCurrentPlayer()?.id === playerId) {
                this._stopTurnTimer();
            }
            if (this.turnState.phase === 'TURN_ORDER' && this.turnOrderState?.visible) {
                const entry = this.turnOrderState.players.find(e => e.id === playerId);
                if (entry) {
                    entry.isAi = true;
                    if (!entry.drawn && this.turnOrderState.stage === 'DRAWING') {
                        this._drawTurnOrderCardForPlayer(playerId);
                        return;
                    }
                }
            }
            this._emitState();
            this._scheduleAiIfNeeded();
        }
    }

    destroy() {
        this.isDestroyed = true;
        this._clearAiTimer();
        this._stopTurnTimer();
        this._clearTurnOrderTimers();
    }
}

export const UnosGameEngine = UnosEngine;
