// ProgramFiles/Unos/UnosChess.js
// 우노스(UNOS) 6x6 체스 기물 초기 배치(거울 대칭 A안), 색상 연동 이동 계산, 퀸 2턴 쿨타임,
// 폰 프로모션(즉시 소멸 + 카드 소각 트리거), 6x6 전용 캐슬링 조건/위협 판정, 안전도 삼각형(none/yellow/red) 판정

import { UNOS_BOARD_SIZE } from '../System/Index/Unos/UnosBoardPresetIndex.js';

// 1~6번 칸 (c = 0..5) 거울 대칭 초기 배치: 룩(1) - 나이트(2) - 퀸(3) - 킹(4) - 비숍(5) - 룩(6)
export const UNOS_BACK_ROW_LAYOUT = Object.freeze(['R', 'N', 'Q', 'K', 'B', 'R']);

export const UNOS_SAFETY_LEVELS = Object.freeze({
    NONE: 'none',
    YELLOW: 'yellow',
    RED: 'red'
});

export function isInsideBoard(r, c) {
    return Number.isInteger(r) && Number.isInteger(c)
        && r >= 0 && r < UNOS_BOARD_SIZE
        && c >= 0 && c < UNOS_BOARD_SIZE;
}

export function getOpponentSide(side) {
    return side === 'bottom' ? 'top' : 'bottom';
}

export function getBackRowForSide(side) {
    return side === 'bottom' ? 5 : 0;
}

export function getPromotionRowForSide(side) {
    return side === 'bottom' ? 0 : 5;
}

/**
 * 6x6 초기 체스판 생성 (선공: bottom r=5,4 / 후공: top r=0,1 — 거울 대칭 A안)
 */
export function createInitialChessBoard(bottomPlayerId = 'player_0', topPlayerId = 'player_1') {
    const board = Array.from({ length: UNOS_BOARD_SIZE }, () => Array(UNOS_BOARD_SIZE).fill(null));

    // 상단(후공, top): 6열(r=0) 후열, 5열(r=1) 전열 폰
    for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
        const backType = UNOS_BACK_ROW_LAYOUT[c];
        board[0][c] = {
            id: `top_${backType}_${c + 1}`,
            type: backType,
            side: 'top',
            ownerId: topPlayerId,
            r: 0,
            c,
            initialCol: c,
            hasMoved: false,
            isPromoted: false,
            cooldownTurns: 0
        };
        board[1][c] = {
            id: `top_P_${c + 1}`,
            type: 'P',
            side: 'top',
            ownerId: topPlayerId,
            r: 1,
            c,
            initialCol: c,
            hasMoved: false,
            isPromoted: false,
            cooldownTurns: 0
        };
    }

    // 하단(선공, bottom): 2열(r=4) 전열 폰, 1열(r=5) 후열
    for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
        const backType = UNOS_BACK_ROW_LAYOUT[c];
        board[4][c] = {
            id: `bottom_P_${c + 1}`,
            type: 'P',
            side: 'bottom',
            ownerId: bottomPlayerId,
            r: 4,
            c,
            initialCol: c,
            hasMoved: false,
            isPromoted: false,
            cooldownTurns: 0
        };
        board[5][c] = {
            id: `bottom_${backType}_${c + 1}`,
            type: backType,
            side: 'bottom',
            ownerId: bottomPlayerId,
            r: 5,
            c,
            initialCol: c,
            hasMoved: false,
            isPromoted: false,
            cooldownTurns: 0
        };
    }

    return board;
}

export function cloneChessBoard(board) {
    return board.map(row =>
        row.map(cell => (cell ? { ...cell } : null))
    );
}

/**
 * 색상 제약을 제외한 순수 체스 행마/공격 범위 계산
 * @param {Array<Array<object|null>>} board
 * @param {number} r
 * @param {number} c
 * @param {{ ignoreQueenCooldown?: boolean, attacksOnly?: boolean }} options
 */
export function getRawPieceMoves(board, r, c, options = {}) {
    if (!isInsideBoard(r, c)) return [];
    const piece = board[r]?.[c];
    if (!piece) return [];

    const ignoreQueenCooldown = Boolean(options.ignoreQueenCooldown);
    const attacksOnly = Boolean(options.attacksOnly);

    // 퀸 쿨타임 중이면 일반 이동 불가 (위협 판정 시 ignoreQueenCooldown=true로 잠재 위협 탐색 가능)
    if (piece.type === 'Q' && !ignoreQueenCooldown && (piece.cooldownTurns || 0) > 0) {
        return [];
    }

    const moves = [];

    const addTargetIfAllowed = (tr, tc) => {
        if (!isInsideBoard(tr, tc)) return false;
        const occupant = board[tr][tc];
        if (!occupant) {
            moves.push({ r: tr, c: tc });
            return true; // 계속 직진 가능
        }
        if (occupant.side !== piece.side) {
            moves.push({ r: tr, c: tc });
        }
        return false; // 기물에 막힘
    };

    const slideDirections = (dirs) => {
        for (const [dr, dc] of dirs) {
            let nr = r + dr;
            let nc = c + dc;
            while (isInsideBoard(nr, nc)) {
                const cont = addTargetIfAllowed(nr, nc);
                if (!cont) break;
                nr += dr;
                nc += dc;
            }
        }
    };

    switch (piece.type) {
        case 'K': {
            const dirs = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1],           [0, 1],
                [1, -1],  [1, 0],  [1, 1]
            ];
            for (const [dr, dc] of dirs) {
                addTargetIfAllowed(r + dr, c + dc);
            }
            break;
        }
        case 'Q': {
            slideDirections([
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1],           [0, 1],
                [1, -1],  [1, 0],  [1, 1]
            ]);
            break;
        }
        case 'R': {
            slideDirections([
                [-1, 0], [1, 0], [0, -1], [0, 1]
            ]);
            break;
        }
        case 'B': {
            slideDirections([
                [-1, -1], [-1, 1], [1, -1], [1, 1]
            ]);
            break;
        }
        case 'N': {
            const jumps = [
                [-2, -1], [-2, 1],
                [-1, -2], [-1, 2],
                [1, -2],  [1, 2],
                [2, -1],  [2, 1]
            ];
            for (const [dr, dc] of jumps) {
                addTargetIfAllowed(r + dr, c + dc);
            }
            break;
        }
        case 'P': {
            // 강화 폰(isPromoted === true): 8방위 직선으로 최대 2칸(1~2칸) 이동 및 포획 가능 (기물 뛰어넘기 불가)
            if (piece.isPromoted) {
                const dirs = [
                    [-1, -1], [-1, 0], [-1, 1],
                    [0, -1],           [0, 1],
                    [1, -1],  [1, 0],  [1, 1]
                ];
                for (const [dr, dc] of dirs) {
                    for (let step = 1; step <= 2; step++) {
                        const nr = r + dr * step;
                        const nc = c + dc * step;
                        const cont = addTargetIfAllowed(nr, nc);
                        if (!cont) break; // 1칸째에 아군/적군 기물이 있으면 2칸째로 점프 불가
                    }
                }
                break;
            }

            const dir = piece.side === 'bottom' ? -1 : 1;
            const nr = r + dir;
            if (!isInsideBoard(nr, c)) break;

            if (attacksOnly) {
                // 기본 폰의 공격(위협) 범위는 대각선 앞 1칸
                for (const dc of [-1, 1]) {
                    const nc = c + dc;
                    if (isInsideBoard(nr, nc)) {
                        const occ = board[nr][nc];
                        if (!occ || occ.side !== piece.side) {
                            moves.push({ r: nr, c: nc });
                        }
                    }
                }
            } else {
                // 기본 폰 전진 1칸 (항상 1칸만 가능, 빈 칸일 때만)
                if (!board[nr][c]) {
                    moves.push({ r: nr, c });
                }
                // 기본 폰 대각선 앞 1칸 상대 기물 포획
                for (const dc of [-1, 1]) {
                    const nc = c + dc;
                    if (isInsideBoard(nr, nc)) {
                        const occ = board[nr][nc];
                        if (occ && occ.side !== piece.side) {
                            moves.push({ r: nr, c: nc });
                        }
                    }
                }
            }
            break;
        }
        default:
            break;
    }

    return moves;
}

/**
 * 특정 칸(targetR, targetC)에 defenderSide 기물이 놓여 있다고 가정할 때 상대 기물의 위협 수준을 판정
 * - 'red': 쿨타임이 아닌 상대 기물의 즉시 공격 범위
 * - 'yellow': 즉시 공격 기물은 없으나 현재 쿨타임 중인 상대 퀸의 공격 범위
 * - 'none': 위협 없음
 */
export function evaluateSquareThreat(board, targetR, targetC, defenderSide) {
    if (!isInsideBoard(targetR, targetC)) return UNOS_SAFETY_LEVELS.NONE;

    const attackerSide = getOpponentSide(defenderSide);
    const simBoard = cloneChessBoard(board);

    // 대상 칸에 아군 더미 기물이 서 있는 상태로 시뮬레이션 (폰 대각선 공격 및 직선 기물 차폐 정확도 보장)
    if (!simBoard[targetR][targetC] || simBoard[targetR][targetC].side !== defenderSide) {
        simBoard[targetR][targetC] = {
            id: '__target_probe__',
            type: 'P',
            side: defenderSide,
            ownerId: '__probe__',
            r: targetR,
            c: targetC,
            hasMoved: true,
            cooldownTurns: 0
        };
    }

    let hasImmediateThreat = false;
    let hasCooldownQueenThreat = false;

    for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
        for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
            if (r === targetR && c === targetC) continue;
            const opp = simBoard[r][c];
            if (!opp || opp.side !== attackerSide) continue;

            const isCooldownQueen = opp.type === 'Q' && (opp.cooldownTurns || 0) > 0;
            const attacks = getRawPieceMoves(simBoard, r, c, {
                ignoreQueenCooldown: true,
                attacksOnly: opp.type === 'P' && !opp.isPromoted
            });

            if (attacks.some(m => m.r === targetR && m.c === targetC)) {
                if (isCooldownQueen) {
                    hasCooldownQueenThreat = true;
                } else {
                    hasImmediateThreat = true;
                }
            }
        }
    }

    if (hasImmediateThreat) return UNOS_SAFETY_LEVELS.RED;
    if (hasCooldownQueenThreat) return UNOS_SAFETY_LEVELS.YELLOW;
    return UNOS_SAFETY_LEVELS.NONE;
}

/**
 * 기물을 from -> to로 이동했을 때 도착 칸의 안전도 삼각형 등급('none' | 'yellow' | 'red') 판정
 */
export function evaluateMoveSafety(board, from, to) {
    if (!from || !to || !isInsideBoard(from.r, from.c) || !isInsideBoard(to.r, to.c)) {
        return UNOS_SAFETY_LEVELS.NONE;
    }
    const piece = board[from.r]?.[from.c];
    if (!piece) return UNOS_SAFETY_LEVELS.NONE;

    const simBoard = cloneChessBoard(board);
    const movedPiece = { ...simBoard[from.r][from.c], r: to.r, c: to.c };
    simBoard[from.r][from.c] = null;
    simBoard[to.r][to.c] = movedPiece;

    return evaluateSquareThreat(simBoard, to.r, to.c, piece.side);
}

/**
 * 색상 규칙(출발지/도착지 활성 색상 매칭 및 K/Q/공명/버스트 예외)을 반영한 기물별 이동 가능 칸 계산
 */
export function getLegalPieceMoves(board, colorGrid, r, c, options = {}) {
    if (!isInsideBoard(r, c)) return [];
    const piece = board[r]?.[c];
    if (!piece) return [];

    const activeColors = Array.isArray(options.activeColors) ? options.activeColors : [];
    const colorFreeMove = Boolean(options.colorFreeMove);

    const rawMoves = getRawPieceMoves(board, r, c, { ignoreQueenCooldown: false, attacksOnly: false });
    if (rawMoves.length === 0) return [];

    // K, Q, 공명 턴, 버스트 상태는 색상 제약 무시 (단 Q의 2턴당 1회 쿨타임은 rawMoves에서 이미 필터링됨)
    const isExemptPiece = piece.type === 'K' || piece.type === 'Q';
    const activeSet = new Set(activeColors);
    const fromColor = colorGrid?.[r]?.[c] || null;
    const isStartColorMatched = colorFreeMove || isExemptPiece || (fromColor && activeSet.has(fromColor));

    const legalMoves = [];
    for (const m of rawMoves) {
        const toColor = colorGrid?.[m.r]?.[m.c] || null;
        if (!isStartColorMatched && !(toColor && activeSet.has(toColor))) {
            continue;
        }
        const occupant = board[m.r][m.c];
        const safety = evaluateMoveSafety(board, { r, c }, { r: m.r, c: m.c });
        const promoRow = getPromotionRowForSide(piece.side);
        legalMoves.push({
            r: m.r,
            c: m.c,
            fromColor,
            toColor,
            safety,
            isCapture: Boolean(occupant && occupant.side !== piece.side),
            capturedPieceType: occupant ? occupant.type : null,
            capturedPieceIsPromoted: Boolean(occupant && occupant.side !== piece.side && occupant.isPromoted),
            isKingCapture: Boolean(occupant && occupant.side !== piece.side && occupant.type === 'K'),
            // 이미 승급한 강화 폰(piece.isPromoted === true)은 끝열 재진입 시 프로모션 재발동 안 함
            isPromotion: piece.type === 'P' && !piece.isPromoted && m.r === promoRow
        });
    }

    return legalMoves;
}

/**
 * 해당 진영(side)의 모든 기물의 합법 이동 목록 조회
 */
export function getAllLegalMovesForSide(board, colorGrid, side, options = {}) {
    const allMoves = [];
    for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
        for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
            const p = board[r][c];
            if (!p || p.side !== side) continue;
            const moves = getLegalPieceMoves(board, colorGrid, r, c, options);
            for (const mv of moves) {
                allMoves.push({
                    pieceId: p.id,
                    pieceType: p.type,
                    isPromoted: Boolean(p.isPromoted),
                    pieceKey: (p.type === 'P' && p.isPromoted) ? 'P_PLUS' : p.type,
                    from: { r, c },
                    to: { r: mv.r, c: mv.c },
                    ...mv
                });
            }
        }
    }
    return allMoves;
}

/**
 * 6x6 전용 캐슬링(좌측 1번 룩 c=0 / 우측 6번 룩 c=5, 킹 4번 c=3) 가능 여부 및 킹 도착 칸 위협 판정
 * - 좌측(left): 룩(c:0 -> 3), 킹(c:3 -> 2) / 사이 칸 c=1,2 비어야 함
 * - 우측(right): 룩(c:5 -> 3), 킹(c:3 -> 4) / 사이 칸 c=4 비어야 함
 * - 킹 도착 칸이 공격 범위여도 available=true로 버튼을 노출하고 isKingDestThreatened=true로 확인 팝업 트리거
 */
export function getAvailableCastlings(board, colorGrid, side, options = {}) {
    const backRow = getBackRowForSide(side);
    const activeColors = Array.isArray(options.activeColors) ? options.activeColors : [];
    const colorFreeMove = Boolean(options.colorFreeMove);
    const activeSet = new Set(activeColors);

    const defaultSideResult = (castleSide) => ({
        side: castleSide,
        available: false,
        reason: 'CONDITIONS_NOT_MET',
        kingFrom: { r: backRow, c: 3 },
        kingTo: { r: backRow, c: castleSide === 'left' ? 2 : 4 },
        rookFrom: { r: backRow, c: castleSide === 'left' ? 0 : 5 },
        rookTo: { r: backRow, c: 3 },
        isKingDestThreatened: false,
        safety: UNOS_SAFETY_LEVELS.NONE
    });

    const result = {
        left: defaultSideResult('left'),
        right: defaultSideResult('right')
    };

    const king = board[backRow]?.[3];
    if (!king || king.type !== 'K' || king.side !== side || king.hasMoved) {
        return result;
    }

    const kingTileColor = colorGrid?.[backRow]?.[3] || null;

    const evaluateCastleSide = (castleSide) => {
        const rookCol = castleSide === 'left' ? 0 : 5;
        const kingDestCol = castleSide === 'left' ? 2 : 4;
        const betweenCols = castleSide === 'left' ? [1, 2] : [4];

        const info = defaultSideResult(castleSide);
        const rook = board[backRow]?.[rookCol];
        if (!rook || rook.type !== 'R' || rook.side !== side || rook.hasMoved) {
            info.reason = 'ROOK_MOVED_OR_MISSING';
            return info;
        }

        for (const bc of betweenCols) {
            if (board[backRow][bc] !== null) {
                info.reason = 'PATH_BLOCKED';
                return info;
            }
        }

        const rookTileColor = colorGrid?.[backRow]?.[rookCol] || null;
        const colorMatched = colorFreeMove
            || (kingTileColor && activeSet.has(kingTileColor))
            || (rookTileColor && activeSet.has(rookTileColor));

        if (!colorMatched) {
            info.reason = 'COLOR_MISMATCH';
            return info;
        }

        // 캐슬링 실행 후 보드 상태에서 킹 도착 칸(3번 c=2 또는 5번 c=4) 위협 판정
        const simBoard = cloneChessBoard(board);
        const simKing = { ...simBoard[backRow][3], r: backRow, c: kingDestCol, hasMoved: true };
        const simRook = { ...simBoard[backRow][rookCol], r: backRow, c: 3, hasMoved: true };
        simBoard[backRow][3] = null;
        simBoard[backRow][rookCol] = null;
        simBoard[backRow][3] = simRook;
        simBoard[backRow][kingDestCol] = simKing;

        const safety = evaluateSquareThreat(simBoard, backRow, kingDestCol, side);
        info.available = true;
        info.reason = null;
        info.safety = safety;
        info.isKingDestThreatened = safety === UNOS_SAFETY_LEVELS.RED;
        return info;
    };

    result.left = evaluateCastleSide('left');
    result.right = evaluateCastleSide('right');
    return result;
}

/**
 * 현재 보드에서 해당 진영(side)의 킹이 체크(즉시 공격 위협) 상태인지 확인
 */
export function isKingInCheck(board, side) {
    for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
        for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
            const p = board[r][c];
            if (p && p.side === side && p.type === 'K') {
                return evaluateSquareThreat(board, r, c, side) === UNOS_SAFETY_LEVELS.RED;
            }
        }
    }
    return false;
}

/**
 * 일반 기물 이동 확정 실행
 * - 기본 폰(!piece.isPromoted)이 상대 끝열에 최초 도달 시 삭제하지 않고 강화 폰(piece.isPromoted = true)으로 승급
 * - 이미 승급한 강화 폰이 다시 끝열에 진입해도 프로모션은 재발동되지 않음
 */
export function executeChessMove(board, from, to) {
    const piece = board[from.r]?.[from.c];
    if (!piece) {
        return { ok: false, error: 'NO_PIECE_AT_SOURCE' };
    }

    const target = board[to.r]?.[to.c] || null;
    const isKingCaptured = Boolean(target && target.side !== piece.side && target.type === 'K');
    const promoRow = getPromotionRowForSide(piece.side);
    const wasPromotedBeforeMove = Boolean(piece.isPromoted);
    const isPromotion = piece.type === 'P' && !wasPromotedBeforeMove && to.r === promoRow;

    board[from.r][from.c] = null;
    piece.r = to.r;
    piece.c = to.c;
    piece.hasMoved = true;

    if (piece.type === 'Q') {
        piece.cooldownTurns = 1;
    }

    if (isPromotion && !isKingCaptured) {
        // 프로모션 개편 규약: 끝열에 도달한 기본 폰은 삭제하지 않고 강화 폰(isPromoted = true)으로 승급하여 보드에 유지
        piece.isPromoted = true;
    }
    board[to.r][to.c] = piece;

    return {
        ok: true,
        movedPiece: piece,
        wasPromotedBeforeMove,
        capturedPiece: target,
        isKingCaptured,
        isPromotion: isPromotion && !isKingCaptured
    };
}

/**
 * 캐슬링 확정 실행
 */
export function executeCastlingMove(board, side, castleSide) {
    const backRow = getBackRowForSide(side);
    const rookCol = castleSide === 'left' ? 0 : 5;
    const kingDestCol = castleSide === 'left' ? 2 : 4;

    const king = board[backRow]?.[3];
    const rook = board[backRow]?.[rookCol];
    if (!king || king.type !== 'K' || !rook || rook.type !== 'R') {
        return { ok: false, error: 'INVALID_CASTLING_PIECES' };
    }

    board[backRow][3] = null;
    board[backRow][rookCol] = null;

    rook.r = backRow;
    rook.c = 3;
    rook.hasMoved = true;

    king.r = backRow;
    king.c = kingDestCol;
    king.hasMoved = true;

    board[backRow][3] = rook;
    board[backRow][kingDestCol] = king;

    return {
        ok: true,
        king,
        rook,
        kingTo: { r: backRow, c: kingDestCol },
        rookTo: { r: backRow, c: 3 }
    };
}
