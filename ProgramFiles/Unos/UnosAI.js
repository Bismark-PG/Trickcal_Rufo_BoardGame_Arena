// ProgramFiles/Unos/UnosAI.js
// 우노스(UNOS) 3단계 난이도(순한맛 mild / 보통맛 normal / 매운맛 spicy) 규칙·전술 기반 AI 봇
// - mild(순한맛): 56장 규칙은 유지하되, 상대(플레이어) 손패 색상에 맞춰 카드를 내주고 킹 포획/체크 회피를 확률적으로 눈감아줌
// - normal(보통맛): 1수 기본 전술 + 소폭 변칙(사람이 생각하면 이길 수 있는 균형)
// - spicy(매운맛): 보드 연계 최적 색상 탐색 + 2-Ply 상대 최선 반격 시뮬레이션(전력 AI)

import { UNOS_PERSONALITY_KEYS, UNOS_CARD_KINDS } from '../System/Index/Unos/UnosCardIndex.js';
import { UNOS_BOARD_SIZE } from '../System/Index/Unos/UnosBoardPresetIndex.js';
import { normalizeUnosAiDifficulty } from '../System/GameRegistry.js';
import {
    UNOS_SAFETY_LEVELS,
    cloneChessBoard,
    evaluateSquareThreat,
    getAllLegalMovesForSide,
    getAvailableCastlings,
    getOpponentSide
} from './UnosChess.js';
import { annotateUnosHand } from './UnosCard.js';

const PIECE_CAPTURE_VALUES = Object.freeze({
    K: 100000,
    Q: 950,
    R: 520,
    P_PLUS: 390,
    B: 340,
    N: 320,
    P: 140
});

function getPieceValue(type, isPromoted = false) {
    if (type === 'P' && isPromoted) return PIECE_CAPTURE_VALUES.P_PLUS;
    return PIECE_CAPTURE_VALUES[type] || 140;
}

function findKingPosition(board, targetSide) {
    for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
        for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
            const p = board?.[r]?.[c];
            if (p && p.side === targetSide && p.type === 'K') {
                return { r, c };
            }
        }
    }
    return null;
}

/**
 * AI 기물들이 현재 서 있는 보드 칸의 성격 색상 분포 집계 (전투 기물 가중치 부여)
 */
export function countFriendlyPieceColors(board, colorGrid, side) {
    const counts = {
        madness: 0,
        calm: 0,
        pure: 0,
        lively: 0
    };
    for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
        for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
            const p = board?.[r]?.[c];
            if (p && p.side === side) {
                const col = colorGrid?.[r]?.[c];
                if (col && col in counts) {
                    if (p.type === 'R' || p.type === 'B' || p.type === 'N' || (p.type === 'P' && p.isPromoted)) {
                        counts[col] += 3;
                    } else if (p.type === 'P') {
                        counts[col] += 2;
                    } else {
                        counts[col] += 1;
                    }
                }
            }
        }
    }
    return counts;
}

/**
 * 매운맛(spicy) 전용: 특정 색상을 활성화했을 때 이번 턴 체스에서 얻을 수 있는 최고 전술 잠재력 점수 계산
 */
function evaluateBoardColorPotential(board, colorGrid, side, colorKey) {
    const moves = getAllLegalMovesForSide(board, colorGrid, side, {
        activeColors: [colorKey],
        colorFreeMove: false
    });
    if (moves.length === 0) return -200;

    let maxGain = 0;
    for (const mv of moves) {
        let gain = 20;
        if (mv.isKingCapture || mv.capturedPieceType === 'K') {
            return 100000;
        }
        if (mv.isCapture && mv.capturedPieceType) {
            gain += getPieceValue(mv.capturedPieceType, mv.capturedPieceIsPromoted);
        }
        if (mv.isPromotion) {
            gain += 380;
        }
        if (mv.safety === UNOS_SAFETY_LEVELS.RED) {
            gain -= getPieceValue(mv.pieceType, mv.isPromoted) * 0.6;
        }
        if (gain > maxGain) maxGain = gain;
    }
    return maxGain;
}

/**
 * 난이도별 최적 성격 색상 1개 선택 (공명 카드 제출 시 사용)
 */
export function pickBestColorForAi(board, colorGrid, side, hand = [], difficulty = 'normal', opponentHand = []) {
    const diff = normalizeUnosAiDifficulty(difficulty, 'normal');

    // 순한맛: 상대(플레이어) 손패에 가장 많은 색상을 우선 골라주어 플레이어가 카드가 막히지 않게 배려
    if (diff === 'mild' && Array.isArray(opponentHand) && opponentHand.length > 0) {
        const oppCounts = { madness: 0, calm: 0, pure: 0, lively: 0 };
        for (const c of opponentHand) {
            if (c.color && c.color in oppCounts) oppCounts[c.color] += 1;
        }
        let bestForOpp = UNOS_PERSONALITY_KEYS[0];
        let maxOppCnt = -1;
        for (const k of UNOS_PERSONALITY_KEYS) {
            if (oppCounts[k] > maxOppCnt) {
                maxOppCnt = oppCounts[k];
                bestForOpp = k;
            }
        }
        if (maxOppCnt > 0) return bestForOpp;
    }

    // 매운맛: 실제로 그 색을 켰을 때 킹 포획/포획/프로모션이 열리는 색을 시뮬레이션해 선택
    if (diff === 'spicy') {
        let bestKey = UNOS_PERSONALITY_KEYS[0];
        let bestPotential = -Infinity;
        for (const key of UNOS_PERSONALITY_KEYS) {
            const pot = evaluateBoardColorPotential(board, colorGrid, side, key);
            if (pot > bestPotential) {
                bestPotential = pot;
                bestKey = key;
            }
        }
        return bestKey;
    }

    // 보통맛: 기물 분포 + 손패 기반 선택
    const pieceColorScores = countFriendlyPieceColors(board, colorGrid, side);
    for (const card of hand) {
        if (card.color && card.color in pieceColorScores) {
            pieceColorScores[card.color] += 1;
        }
    }
    let bestColor = UNOS_PERSONALITY_KEYS[0];
    let bestScore = -1;
    for (const key of UNOS_PERSONALITY_KEYS) {
        if (pieceColorScores[key] > bestScore) {
            bestScore = pieceColorScores[key];
            bestColor = key;
        }
    }
    return bestColor;
}

/**
 * 매운맛(spicy) 전용: 내가 from->to 이동 후 보드에서 상대의 최선 반격(1-Ply Lookahead) 위험 평가
 */
function evaluateOpponentCounterThreat(simBoard, mySide, enemySide) {
    const myKingPos = findKingPosition(simBoard, mySide);
    if (!myKingPos) return 0;

    // 1. 상대가 다음 턴에 내 킹을 잡을 수 있는지 즉시 확인 (킹/퀸/색상무관 위협 포함)
    if (evaluateSquareThreat(simBoard, myKingPos.r, myKingPos.c, mySide) === UNOS_SAFETY_LEVELS.RED) {
        // 상대에게 즉시 킹 포획 각을 내주면 치명적 감점 (단, 상대가 실제로 킹을 잡으려면 K/Q 또는 해당 칸/도착지 색상이 맞아야 하지만 안전상 최우선 회피)
        return 80000;
    }

    // 2. 내 비킹 기물 중 즉시 공짜로 잡힐 수 있는 최고가치 기물 손실 추정
    let maxHangingLoss = 0;
    for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
        for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
            const p = simBoard[r]?.[c];
            if (!p || p.side !== mySide || p.type === 'K') continue;
            const threat = evaluateSquareThreat(simBoard, r, c, mySide);
            if (threat === UNOS_SAFETY_LEVELS.RED) {
                const val = getPieceValue(p.type, p.isPromoted);
                // 상대 기물에 의해 역으로 보호받고 있는지 확인
                const defended = evaluateSquareThreat(simBoard, r, c, enemySide) === UNOS_SAFETY_LEVELS.RED;
                const netRisk = defended ? val * 0.45 : val * 0.92;
                if (netRisk > maxHangingLoss) maxHangingLoss = netRisk;
            }
        }
    }
    return maxHangingLoss;
}

/**
 * 현재 엔진 상태를 기반으로 AI 플레이어의 다음 표준 액션 결정 (난이도: mild / normal / spicy)
 * @param {object} engine UnosEngine 인스턴스
 * @returns {object | null} GAME_ACTION 페이로드
 */
export function decideUnosAiAction(engine) {
    if (!engine || engine.turnState?.phase === 'GAME_OVER') return null;

    const rng = typeof engine.rng === 'function' ? engine.rng : Math.random;

    if (engine.turnState?.phase === 'TURN_ORDER' && engine.turnOrderState?.visible) {
        const pendingAi = engine.turnOrderState.players.find(e => e.isAi && !e.drawn);
        if (pendingAi) {
            return { type: 'TURN_ORDER_DRAW', playerId: pendingAi.id };
        }
        return null;
    }

    const currentPlayer = engine.getCurrentPlayer();
    if (!currentPlayer) return null;

    const opponent = engine.getOpponentPlayer(currentPlayer.id);
    const difficulty = normalizeUnosAiDifficulty(currentPlayer.aiDifficulty, 'normal');

    const phase = engine.turnState.phase;
    const side = currentPlayer.side;
    const board = engine.chessBoard;
    const colorGrid = engine.boardColors;
    const bestColor = pickBestColorForAi(
        board,
        colorGrid,
        side,
        currentPlayer.hand,
        difficulty,
        opponent?.hand || []
    );

    // 1. 카드 제출 페이즈
    if (phase === 'CARD_PHASE') {
        const annotated = annotateUnosHand(currentPlayer.hand, {
            isMyTurn: true,
            phase: 'CARD_PHASE',
            matchColor: engine.matchColor,
            topCard: engine.centerCard,
            actionChainStep: engine.turnState.actionChainStep
        });

        const playableCards = annotated.filter(c => c.playable);
        if (playableCards.length === 0) {
            return { type: 'DRAW_CARD' };
        }

        const colorCounts = countFriendlyPieceColors(board, colorGrid, side);
        const oppHandColors = { madness: 0, calm: 0, pure: 0, lively: 0 };
        for (const oc of (opponent?.hand || [])) {
            if (oc.color && oc.color in oppHandColors) {
                oppHandColors[oc.color] += 1;
            }
        }
        const oppHandCount = opponent?.hand?.length ?? 7;

        let chosenCard = playableCards[0];
        let bestCardScore = -Infinity;

        for (const card of playableCards) {
            let score = 0;

            if (difficulty === 'mild') {
                // 순한맛: 플레이어가 가진 색상과 일치하는 숫자 카드를 우선 내주어 플레이어 편의를 돕고, 공격 카드는 회피
                if (card.kind === UNOS_CARD_KINDS.NUMBER) {
                    score = 70 + (oppHandColors[card.color] || 0) * 35;
                } else if (card.kind === UNOS_CARD_KINDS.REVERSE) {
                    score = 45;
                } else if (card.kind === UNOS_CARD_KINDS.RESONANCE) {
                    score = 35;
                } else if (card.kind === UNOS_CARD_KINDS.ACTION) {
                    score = 20;
                } else if (card.kind === UNOS_CARD_KINDS.SKIP) {
                    score = -25;
                } else if (card.kind === UNOS_CARD_KINDS.DEPRESSION) {
                    score = -50;
                }
            } else if (difficulty === 'spicy') {
                // 매운맛: 상대 손패 견제 + 보드 전술 잠재력이 높은 색상 우선
                const boardPot = card.color ? evaluateBoardColorPotential(board, colorGrid, side, card.color) : 0;
                const oppLowHandPressure = oppHandCount <= 3 ? 45 : 0;

                if (card.kind === UNOS_CARD_KINDS.ACTION) {
                    score = (currentPlayer.hand.length >= 2 ? 120 : 65) + Math.min(200, boardPot * 0.25);
                } else if (card.kind === UNOS_CARD_KINDS.DEPRESSION) {
                    score = 95 + oppLowHandPressure;
                } else if (card.kind === UNOS_CARD_KINDS.SKIP) {
                    score = 85 + oppLowHandPressure + Math.min(200, boardPot * 0.25);
                } else if (card.kind === UNOS_CARD_KINDS.RESONANCE) {
                    score = 75 + Math.min(250, evaluateBoardColorPotential(board, colorGrid, side, bestColor) * 0.3);
                } else if (card.kind === UNOS_CARD_KINDS.NUMBER) {
                    score = 50 + Math.min(220, boardPot * 0.28);
                } else if (card.kind === UNOS_CARD_KINDS.REVERSE) {
                    const currentPot = evaluateBoardColorPotential(board, colorGrid, side, engine.matchColor);
                    score = currentPot <= 20 ? 75 : 20;
                }
            } else {
                // 보통맛(normal)
                if (card.kind === UNOS_CARD_KINDS.ACTION) {
                    score = currentPlayer.hand.length >= 2 ? 95 : 60;
                } else if (card.kind === UNOS_CARD_KINDS.DEPRESSION) {
                    score = 84;
                } else if (card.kind === UNOS_CARD_KINDS.SKIP) {
                    score = 72 + (colorCounts[card.color] || 0) * 10;
                } else if (card.kind === UNOS_CARD_KINDS.NUMBER) {
                    score = 45 + (colorCounts[card.color] || 0) * 14;
                } else if (card.kind === UNOS_CARD_KINDS.RESONANCE) {
                    score = 54;
                } else if (card.kind === UNOS_CARD_KINDS.REVERSE) {
                    score = 35;
                }
            }

            if (score > bestCardScore) {
                bestCardScore = score;
                chosenCard = card;
            }
        }

        const action = {
            type: 'PLAY_CARD',
            cardId: chosenCard.id
        };
        if (chosenCard.kind === UNOS_CARD_KINDS.RESONANCE) {
            action.chosenColor = bestColor;
        }
        return action;
    }

    // 2. 드로우 카드 즉시 제출/보관 선택 페이즈
    if (phase === 'DRAWN_CARD_PROMPT') {
        const drawn = engine.turnState.pendingDrawnCard;
        // 순한맛은 60% 확률로 즉시 제출하지 않고 손패에 보관해 템포를 늦춤
        if (difficulty === 'mild' && rng() < 0.60) {
            return {
                type: 'RESOLVE_DRAWN_CARD',
                decision: 'keep'
            };
        }
        const action = {
            type: 'RESOLVE_DRAWN_CARD',
            decision: 'play'
        };
        if (drawn?.kind === UNOS_CARD_KINDS.RESONANCE) {
            action.chosenColor = bestColor;
        }
        return action;
    }

    // 3. 폰 프로모션 카드 소각 선택 페이즈
    if (phase === 'PROMOTION_PROMPT') {
        if (!currentPlayer.hand || currentPlayer.hand.length === 0) {
            return null;
        }
        const colorCounts = countFriendlyPieceColors(board, colorGrid, side);
        const sorted = [...currentPlayer.hand].sort((a, b) => {
            const weightA = a.kind === UNOS_CARD_KINDS.NUMBER ? (colorCounts[a.color] || 0) : 50;
            const weightB = b.kind === UNOS_CARD_KINDS.NUMBER ? (colorCounts[b.color] || 0) : 50;
            return difficulty === 'mild' ? (weightB - weightA) : (weightA - weightB);
        });
        return {
            type: 'RESOLVE_PROMOTION',
            cardId: sorted[0].id
        };
    }

    // 4. 체스 기물 이동 페이즈
    if (phase === 'CHESS_PHASE') {
        const moveOpts = {
            activeColors: engine.turnState.turnActiveColors,
            colorFreeMove: engine.turnState.colorFreeMove || Boolean(currentPlayer.burst?.active)
        };

        const legalMoves = getAllLegalMovesForSide(board, colorGrid, side, moveOpts);
        const castlings = getAvailableCastlings(board, colorGrid, side, moveOpts);

        // 즉시 상대 킹 포획 수 확인
        const kingCaptureMove = legalMoves.find(m => m.isKingCapture || m.capturedPieceType === 'K');
        if (kingCaptureMove) {
            // 순한맛: 65% 확률로 상대 킹 포획을 눈감고 지나감 (플레이어가 실수해도 기회 부여)
            if (difficulty !== 'mild' || rng() >= 0.65) {
                return {
                    type: 'COMMIT_MOVE',
                    from: kingCaptureMove.from,
                    to: kingCaptureMove.to
                };
            }
        }

        // 순한맛: 70% 확률로 합법 수 중 무작위 수 선택 (단, 킹 포획 수 제외)
        if (difficulty === 'mild' && legalMoves.length > 0 && rng() < 0.70) {
            const nonKingCap = legalMoves.filter(m => !m.isKingCapture && m.capturedPieceType !== 'K');
            const pool = nonKingCap.length > 0 ? nonKingCap : legalMoves;
            const picked = pool[Math.floor(rng() * pool.length)];
            return {
                type: 'COMMIT_MOVE',
                from: picked.from,
                to: picked.to
            };
        }

        const enemySide = getOpponentSide(side);
        const enemyKingPos = findKingPosition(board, enemySide);
        const lastMove = currentPlayer.lastChessMove || null;

        const scoredMoves = [];

        for (const mv of legalMoves) {
            let score = 0;
            const selfValue = getPieceValue(mv.pieceType, mv.isPromoted);

            // 포획 가치
            if (mv.isCapture && mv.capturedPieceType) {
                const capMult = difficulty === 'mild' ? 0.35 : (difficulty === 'spicy' ? 1.25 : 1.15);
                score += getPieceValue(mv.capturedPieceType, mv.capturedPieceIsPromoted) * capMult;
            }

            // 기본 폰 프로모션 가치
            if (mv.isPromotion) {
                score += difficulty === 'mild' ? 80 : (difficulty === 'spicy' ? 460 : 380);
            }

            // 현재 서 있는 칸 위협 확인
            const currentSquareSafety = evaluateSquareThreat(board, mv.from.r, mv.from.c, side);
            if (currentSquareSafety === UNOS_SAFETY_LEVELS.RED) {
                if (difficulty === 'mild') {
                    // 순한맛: 55% 확률로 체크/위협 회피를 놓침
                    if (rng() >= 0.55) {
                        score += mv.pieceType === 'K' ? 600 : selfValue * 0.25;
                    }
                } else {
                    score += mv.pieceType === 'K' ? 3500 : selfValue * 0.85;
                }
            }

            // 도착 칸 안전도 반영
            if (difficulty === 'mild') {
                if (mv.safety === UNOS_SAFETY_LEVELS.NONE) score += 20;
                else if (mv.safety === UNOS_SAFETY_LEVELS.RED) {
                    score -= mv.pieceType === 'K' ? 400 : 100;
                }
            } else {
                if (mv.safety === UNOS_SAFETY_LEVELS.NONE) {
                    score += 150;
                } else if (mv.safety === UNOS_SAFETY_LEVELS.YELLOW) {
                    score += 40;
                } else if (mv.safety === UNOS_SAFETY_LEVELS.RED) {
                    if (mv.pieceType === 'K') {
                        score -= 60000;
                    } else {
                        score -= selfValue * 1.05;
                    }
                }
            }

            // 킹 단순 이동 억제 vs 전투 기물 전개/압박
            if (mv.pieceType === 'K') {
                if (!mv.isCapture && currentSquareSafety !== UNOS_SAFETY_LEVELS.RED) {
                    score -= difficulty === 'spicy' ? 130 : 95;
                }
            } else {
                score += 28;
                const forwardProgress = side === 'bottom' ? (5 - mv.to.r) : mv.to.r;

                if (mv.pieceType === 'P' && !mv.isPromoted) {
                    score += forwardProgress * (difficulty === 'spicy' ? 20 : 16);
                } else {
                    score += forwardProgress * 6;
                }

                if (enemyKingPos) {
                    const distBefore = Math.abs(mv.from.r - enemyKingPos.r) + Math.abs(mv.from.c - enemyKingPos.c);
                    const distAfter = Math.abs(mv.to.r - enemyKingPos.r) + Math.abs(mv.to.c - enemyKingPos.c);
                    score += (distBefore - distAfter) * (difficulty === 'spicy' ? 30 : 22);
                }

                if (mv.to.c >= 1 && mv.to.c <= 4 && mv.to.r >= 1 && mv.to.r <= 4) {
                    score += 10;
                }
            }

            // 매운맛(spicy) & 보통맛(normal) 체크/2-Ply 시뮬레이션
            if (difficulty !== 'mild' && enemyKingPos) {
                const needSim = difficulty === 'spicy' || (mv.safety !== UNOS_SAFETY_LEVELS.RED);
                if (needSim) {
                    const simBoard = cloneChessBoard(board);
                    const movedPiece = {
                        ...simBoard[mv.from.r][mv.from.c],
                        r: mv.to.r,
                        c: mv.to.c,
                        isPromoted: Boolean(mv.isPromoted || mv.isPromotion)
                    };
                    simBoard[mv.from.r][mv.from.c] = null;
                    simBoard[mv.to.r][mv.to.c] = movedPiece;

                    if (mv.safety !== UNOS_SAFETY_LEVELS.RED
                        && evaluateSquareThreat(simBoard, enemyKingPos.r, enemyKingPos.c, enemySide) === UNOS_SAFETY_LEVELS.RED) {
                        score += difficulty === 'spicy' ? 320 : 210;
                    }

                    // 매운맛 전용 2-Ply 상대 최선 반격 평가
                    if (difficulty === 'spicy') {
                        const counterPenalty = evaluateOpponentCounterThreat(simBoard, side, enemySide);
                        score -= counterPenalty;
                    }
                }
            }

            // 직전 내 턴 단순 왕복(Oscillation) 감점
            if (lastMove
                && lastMove.pieceId === mv.pieceId
                && lastMove.from.r === mv.to.r
                && lastMove.from.c === mv.to.c
                && lastMove.to.r === mv.from.r
                && lastMove.to.c === mv.from.c) {
                score -= (mv.pieceType === 'K' ? 380 : 200);
            }

            scoredMoves.push({ mv, score });
        }

        scoredMoves.sort((a, b) => b.score - a.score);

        // 안전한 캐슬링 평가 (순한맛은 캐슬링 안 함)
        if (difficulty !== 'mild') {
            const topMoveScore = scoredMoves[0]?.score ?? -Infinity;
            for (const cSide of ['left', 'right']) {
                const cInfo = castlings[cSide];
                if (cInfo?.available && !cInfo.isKingDestThreatened) {
                    const castleScore = difficulty === 'spicy' ? 240 : 195;
                    if (castleScore > topMoveScore) {
                        return {
                            type: 'COMMIT_CASTLING',
                            side: cSide,
                            forceUnsafe: false
                        };
                    }
                }
            }
        }

        if (scoredMoves.length > 0) {
            // 보통맛(normal): 15% 확률로 상위 2~3순위 차선 수 선택 (사람에게 실수/틈 여지 제공)
            if (difficulty === 'normal' && scoredMoves.length >= 2 && rng() < 0.15) {
                const altLimit = Math.min(3, scoredMoves.length);
                const altIdx = 1 + Math.floor(rng() * (altLimit - 1));
                const altMove = scoredMoves[altIdx].mv;
                return {
                    type: 'COMMIT_MOVE',
                    from: altMove.from,
                    to: altMove.to
                };
            }

            const bestMove = scoredMoves[0].mv;
            return {
                type: 'COMMIT_MOVE',
                from: bestMove.from,
                to: bestMove.to
            };
        }
    }

    return null;
}
