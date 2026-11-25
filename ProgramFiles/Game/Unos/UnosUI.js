// ProgramFiles/Game/Unos/UnosUI.js
// 우노스(UNOS) 1920x1080 3분할 인게임 UI 렌더러 및 인터랙션 컨트롤러
// - 좌측: 6x6 색상 체스판, 기물/쿨타임/체크 표시, 2단계 이동 프리뷰 + 안전도 삼각형(none/yellow/red) + [이동 종료], 조건부 [좌/우 캐슬링] + 위협 확인 팝업
// - 우측: 우노 테이블(덱/중앙 더미/현재 활성 성격 강조 배지), 상대 프로필(뒷면 손패 장수/버스트 상태), 액션 로그
// - 하단: 슬레이 더 스파이어 스타일 부채꼴 손패, 호버 확대, 클릭 및 상향 드래그 제출, 3번째 액션 비활성화 안내("더 이상 이 카드를 낼 수 없습니다!")

import { escapeHtml } from '../../Lobby/LobbyUI.js';
import { LangState } from '../../System/LanguageManager.js';
import {
    UNOS_PERSONALITY_KEYS,
    UNOS_COLOR_PALETTE,
    UNOS_CARD_KINDS,
    UNOS_TURN_TIMER_CONFIG,
    UNOS_COMMON_TEXTURES,
    UNOS_CARD_OVERLAY_SPEC,
    getUnosPersonalityTextures,
    resolveUnosCardVisualSpec,
    getUnosDict,
    formatUnosCardTitle
} from '../../System/Index/Unos/UnosCardIndex.js';
import { UNOS_BOARD_SIZE } from '../../System/Index/Unos/UnosBoardPresetIndex.js';
import { UNOS_SAFETY_LEVELS } from './UnosChess.js';

const PIECE_ICONS = Object.freeze({
    K: '♔',
    Q: '♕',
    R: '♖',
    B: '♗',
    N: '♘',
    P: '♙'
});

const COL_LABELS = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f']);

function injectUnosStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('unos-ingame-styles')) return;

    const style = document.createElement('style');
    style.id = 'unos-ingame-styles';
    style.textContent = `
        .unos-root {
            width: 1920px;
            height: 1080px;
            position: relative;
            overflow: hidden;
            background: radial-gradient(circle at 50% 35%, #232a3e 0%, #121622 100%);
            color: #ecf0f1;
            font-family: inherit;
            user-select: none;
            box-sizing: border-box;
        }
        .unos-main-grid {
            display: grid;
            grid-template-columns: 980px 940px;
            width: 1920px;
            height: 770px;
            padding: 20px 28px 0 28px;
            box-sizing: border-box;
            gap: 24px;
        }
        .unos-chess-panel {
            background: rgba(18, 24, 38, 0.88);
            border: 3px solid rgba(255, 255, 255, 0.16);
            border-radius: 22px;
            padding: 18px 24px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
            position: relative;
        }
        .unos-table-panel {
            width: 880px;
            background: rgba(18, 24, 38, 0.88);
            border: 3px solid rgba(255, 255, 255, 0.16);
            border-radius: 22px;
            padding: 18px 24px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
            position: relative;
        }
        .unos-board-frame {
            display: grid;
            grid-template-columns: repeat(6, 94px);
            grid-template-rows: repeat(6, 94px);
            gap: 5px;
            padding: 12px;
            background: #0d111a;
            border: 4px solid #3c486b;
            border-radius: 18px;
            box-shadow: inset 0 0 24px rgba(0,0,0,0.7), 0 10px 28px rgba(0,0,0,0.5);
        }
        .unos-cell {
            width: 94px;
            height: 94px;
            border-radius: 11px;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
            box-sizing: border-box;
        }
        .unos-cell:hover {
            filter: brightness(1.08);
        }
        .unos-cell.selected-from {
            outline: 4px solid #ffffff;
            box-shadow: 0 0 18px rgba(255, 255, 255, 0.9);
            z-index: 2;
        }
        .unos-cell.legal-target {
            outline: 3px dashed rgba(255, 255, 255, 0.92);
            box-shadow: inset 0 0 18px rgba(255, 255, 255, 0.45);
        }
        .unos-cell.preview-to {
            outline: 4px solid #00e5ff;
            box-shadow: 0 0 22px rgba(0, 229, 255, 0.95);
            z-index: 3;
        }
        .unos-cell.king-in-check {
            animation: unosCheckPulse 1s infinite alternate;
        }
        @keyframes unosCheckPulse {
            from { box-shadow: inset 0 0 12px #ff1744, 0 0 12px #ff1744; }
            to { box-shadow: inset 0 0 28px #ff5252, 0 0 24px #ff1744; }
        }
        .unos-piece-token {
            width: 74px;
            height: 74px;
            border-radius: 50%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
            box-shadow: 0 6px 14px rgba(0, 0, 0, 0.55);
            transition: transform 0.14s ease;
        }
        .unos-piece-token.mine {
            background: radial-gradient(circle at 30% 25%, #ffffff 0%, #dfe6e9 75%, #b2bec3 100%);
            border: 4px solid #2980b9;
            color: #132238;
        }
        .unos-piece-token.opponent {
            background: radial-gradient(circle at 30% 25%, #3d3d5c 0%, #1e1e2f 80%, #11111a 100%);
            border: 4px solid #e74c3c;
            color: #f5f6fa;
        }
        .unos-piece-token.ghost-origin {
            opacity: 0.35;
            border-style: dashed;
        }
        .unos-safety-badge {
            position: absolute;
            top: -10px;
            right: -10px;
            width: 34px;
            height: 34px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 900;
            font-size: 19px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.65);
            z-index: 6;
            pointer-events: none;
        }
        .unos-safety-badge.red {
            background: #e74c3c;
            border: 2px solid #ffffff;
            color: #ffffff;
        }
        .unos-safety-badge.yellow {
            background: #f1c40f;
            border: 2px solid #1e272e;
            color: #1e272e;
        }
        .unos-hand-zone {
            width: 1920px;
            height: 290px;
            position: absolute;
            bottom: 0;
            left: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            padding-bottom: 18px;
            pointer-events: none;
        }
        .unos-fan-container {
            position: relative;
            width: 1360px;
            height: 230px;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            pointer-events: auto;
        }
        .unos-card-item {
            width: 146px;
            height: 208px;
            border-radius: 16px;
            padding: 12px 10px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
            margin: 0 -18px;
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
            transition: transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.1), box-shadow 0.18s ease, filter 0.15s ease;
            transform: var(--fan-transform, none);
            transform-origin: 50% 120%;
            cursor: grab;
            user-select: none;
            touch-action: none;
        }
        .unos-card-item:hover {
            transform: translateY(-54px) scale(1.22) rotate(0deg) !important;
            z-index: 80 !important;
            box-shadow: 0 20px 42px rgba(0, 0, 0, 0.8), 0 0 18px rgba(255, 255, 255, 0.45);
        }
        .unos-card-item.disabled-card {
            filter: grayscale(0.45) brightness(0.68);
            cursor: not-allowed;
        }
        .unos-card-item.chain-blocked {
            filter: grayscale(0.6) brightness(0.6);
            cursor: not-allowed;
            border-color: #ff5252 !important;
        }
        .unos-card-surface {
            position: relative;
            overflow: hidden;
            padding: 0 !important;
        }
        .unos-card-bg-img {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: fill;
            display: block;
            pointer-events: none;
        }
        .unos-card-center-slot {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: ${UNOS_CARD_OVERLAY_SPEC.WIDTH_PERCENT}%;
            aspect-ratio: ${UNOS_CARD_OVERLAY_SPEC.ASPECT_RATIO};
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            z-index: 2;
        }
        .unos-card-number-sprite {
            width: 100%;
            height: 100%;
            background-repeat: no-repeat;
            filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
        }
        .unos-card-medallion-img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
        }
        .unos-card-temp-slot {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            text-align: center;
        }
        .unos-personality-emblem {
            object-fit: contain;
            display: block;
            flex-shrink: 0;
            filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.45));
        }
    `;
    document.head.appendChild(style);
}

export class UnosUIController {
    constructor({ container, onSendAction, onExitMatch, onReturnToRoom }) {
        this.container = container;
        this.onSendAction = onSendAction;
        this.onExitMatch = onExitMatch;
        this.onReturnToRoom = onReturnToRoom;

        this.latestSnapshot = null;
        this.selectedFrom = null; // { r, c }
        this.previewMove = null; // { from: {r, c}, to: {r, c}, safety, ... }
        this.pendingResonanceRequest = null; // { mode: 'PLAY_CARD' | 'RESOLVE_DRAWN_CARD', cardId }
        this.pendingUnsafeCastleSide = null; // 'left' | 'right'
        this.toastTimer = null;
        this.exitConfirmPending = false;
        this.exitConfirmTimer = null;

        this._dragState = null;
        this._boundPointerMove = (e) => this._onWindowPointerMove(e);
        this._boundPointerUp = (e) => this._onWindowPointerUp(e);

        injectUnosStyles();
        this._buildBaseLayout();
        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', this._boundPointerMove);
            window.addEventListener('pointerup', this._boundPointerUp);
        }
    }

    _buildBaseLayout() {
        this.container.innerHTML = `
            <div class="unos-root" id="unos-root">
                <div class="unos-main-grid">
                    <div class="unos-chess-panel" id="unos-chess-zone"></div>
                    <div class="unos-table-panel" id="unos-table-zone"></div>
                </div>
                <div class="unos-hand-zone" id="unos-hand-zone"></div>
                <div id="unos-modal-layer" style="position: absolute; inset: 0; pointer-events: none; z-index: 200;"></div>
                <div id="unos-toast-banner" style="display: none; position: absolute; top: 24px; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.95); border: 2px solid #f1c40f; color: #fff; padding: 12px 28px; border-radius: 999px; font-size: 20px; font-weight: bold; box-shadow: 0 12px 28px rgba(0,0,0,0.6); z-index: 350; pointer-events: none;"></div>
            </div>
        `;
    }

    showToast(message, durationMs = 2800) {
        const el = this.container.querySelector('#unos-toast-banner');
        if (!el || !message) return;
        if (this.toastTimer) clearTimeout(this.toastTimer);
        el.textContent = String(message);
        el.style.display = 'block';
        this.toastTimer = setTimeout(() => {
            this.toastTimer = null;
            if (el) el.style.display = 'none';
        }, durationMs);
    }

    renderSnapshot(snapshot) {
        if (!snapshot) return;
        const prevTurn = this.latestSnapshot?.turnNumber;
        const prevPhase = this.latestSnapshot?.phase;
        this.latestSnapshot = snapshot;

        // 턴 또는 페이즈가 바뀌면 체스 선택/프리뷰 상태 초기화
        if (prevTurn !== snapshot.turnNumber || prevPhase !== snapshot.phase) {
            this.selectedFrom = null;
            this.previewMove = null;
            this.pendingUnsafeCastleSide = null;
            if (snapshot.phase !== 'CARD_PHASE' && snapshot.phase !== 'DRAWN_CARD_PROMPT') {
                this.pendingResonanceRequest = null;
            }
        }

        this._renderChessZone(snapshot);
        this._renderTableZone(snapshot);
        this._renderHandZone(snapshot);
        this._renderModals(snapshot);
    }

    _getMyAndOpponentPlayer(snapshot) {
        const players = Array.isArray(snapshot.players) ? snapshot.players : [];
        const myPlayer = players.find(p => p.id === snapshot.viewerId) || players[0] || null;
        const opponent = players.find(p => p.id !== myPlayer?.id) || players[1] || null;
        return { myPlayer, opponent };
    }

    _renderChessZone(snapshot) {
        const zone = this.container.querySelector('#unos-chess-zone');
        if (!zone) return;

        const lang = LangState.current || 'ko';
        const dict = getUnosDict(lang);
        const { myPlayer } = this._getMyAndOpponentPlayer(snapshot);
        const isMyTurn = Boolean(myPlayer && snapshot.currentPlayerId === myPlayer.id);
        const isChessPhase = snapshot.phase === 'CHESS_PHASE';

        // 현재 선택된 기물의 이동 가능 칸 맵
        const legalMoveMap = new Map();
        if (isMyTurn && isChessPhase && this.selectedFrom) {
            const key = `${this.selectedFrom.r},${this.selectedFrom.c}`;
            const list = snapshot.legalMovesByPiece?.[key] || [];
            for (const mv of list) {
                legalMoveMap.set(`${mv.r},${mv.c}`, mv);
            }
        }

        // 시점 정렬: 내 진영(myPlayer.side)이 항상 화면 하단에 오도록 행 순서 결정
        const flipRows = myPlayer?.side === 'top';
        const rowOrder = flipRows ? [5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5];
        const colOrder = [0, 1, 2, 3, 4, 5];

        let cellsHtml = '';
        for (const r of rowOrder) {
            for (const c of colOrder) {
                const tileColorKey = snapshot.boardColors?.[r]?.[c] || 'madness';
                const palette = UNOS_COLOR_PALETTE[tileColorKey] || UNOS_COLOR_PALETTE.madness;
                const isSelectedFrom = Boolean(this.selectedFrom && this.selectedFrom.r === r && this.selectedFrom.c === c);
                const legalTarget = legalMoveMap.get(`${r},${c}`) || null;
                const isPreviewTo = Boolean(this.previewMove && this.previewMove.to.r === r && this.previewMove.to.c === c);
                const isPreviewFrom = Boolean(this.previewMove && this.previewMove.from.r === r && this.previewMove.from.c === c);

                let occupant = snapshot.chessBoard?.[r]?.[c] || null;
                let previewSafety = null;
                let isGhostOrigin = false;

                if (isPreviewTo && this.previewMove) {
                    const src = this.previewMove.from;
                    occupant = snapshot.chessBoard?.[src.r]?.[src.c] || occupant;
                    previewSafety = this.previewMove.safety;
                } else if (isPreviewFrom && this.previewMove) {
                    isGhostOrigin = true;
                }

                const isKingCheckSquare = Boolean(
                    occupant
                    && occupant.type === 'K'
                    && snapshot.checkStatus?.[occupant.side]
                    && !isGhostOrigin
                );

                const coordLabel = `${COL_LABELS[c]}${6 - r}`;
                const colorLabel = dict.COLORS[tileColorKey] || tileColorKey;

                let pieceHtml = '';
                if (occupant) {
                    const isMine = occupant.side === (myPlayer?.side || 'bottom');
                    const isPromotedPawn = occupant.type === 'P' && Boolean(occupant.isPromoted);
                    const pieceIcon = PIECE_ICONS[occupant.type] || occupant.type;
                    const pieceName = isPromotedPawn
                        ? (dict.PIECES.P_PLUS || '강화폰')
                        : (dict.PIECES[occupant.type] || occupant.type);
                    const hasCooldown = occupant.type === 'Q' && (occupant.cooldownTurns || 0) > 0;

                    let safetyBadgeHtml = '';
                    if (isPreviewTo && previewSafety === UNOS_SAFETY_LEVELS.RED) {
                        safetyBadgeHtml = `<div class="unos-safety-badge red" title="${escapeHtml(dict.SAFETY_RED_DESC)}">🔺!</div>`;
                    } else if (isPreviewTo && previewSafety === UNOS_SAFETY_LEVELS.YELLOW) {
                        safetyBadgeHtml = `<div class="unos-safety-badge yellow" title="${escapeHtml(dict.SAFETY_YELLOW_DESC)}">⚠!</div>`;
                    }

                    const promotedBadgeHtml = isPromotedPawn
                        ? `<div style="position: absolute; top: -9px; left: -9px; background: linear-gradient(135deg, #f1c40f, #e67e22); color: #1e272e; font-size: 11px; font-weight: 900; padding: 2px 6px; border-radius: 999px; border: 2px solid #ffffff; box-shadow: 0 3px 8px rgba(0,0,0,0.6); z-index: 5;">★P+</div>`
                        : '';

                    const cooldownBadgeHtml = hasCooldown
                        ? `<div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); background: #8e44ad; color: #fff; font-size: 11px; font-weight: bold; padding: 2px 6px; border-radius: 999px; border: 1px solid #fff; white-space: nowrap;">⏳${escapeHtml(dict.QUEEN_COOLDOWN_BADGE)}</div>`
                        : '';

                    const promotedBorderStyle = isPromotedPawn
                        ? 'border-color: #f1c40f; box-shadow: 0 0 14px rgba(241, 196, 15, 0.85), 0 6px 14px rgba(0, 0, 0, 0.55);'
                        : '';

                    pieceHtml = `
                        <div class="unos-piece-token ${isMine ? 'mine' : 'opponent'} ${isGhostOrigin ? 'ghost-origin' : ''}" style="${promotedBorderStyle}">
                            <span style="font-size: 32px; line-height: 1;">${pieceIcon}</span>
                            <span style="font-size: 12px; font-weight: 800; margin-top: 1px;">${escapeHtml(pieceName)}</span>
                            ${promotedBadgeHtml}
                            ${safetyBadgeHtml}
                            ${cooldownBadgeHtml}
                        </div>
                    `;
                } else if (legalTarget) {
                    pieceHtml = `<div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(255, 255, 255, 0.82); box-shadow: 0 0 10px rgba(0,0,0,0.4);"></div>`;
                }

                const classes = [
                    'unos-cell',
                    isSelectedFrom ? 'selected-from' : '',
                    legalTarget ? 'legal-target' : '',
                    isPreviewTo ? 'preview-to' : '',
                    isKingCheckSquare ? 'king-in-check' : ''
                ].filter(Boolean).join(' ');

                cellsHtml += `
                    <div class="${classes}" data-r="${r}" data-c="${c}"
                         style="background: ${palette.bgTile}; border: 2px solid ${palette.border};">
                        <span style="position: absolute; top: 4px; left: 6px; font-size: 11px; font-weight: bold; color: ${palette.text}; opacity: 0.85;">${escapeHtml(coordLabel)}</span>
                        <span style="position: absolute; bottom: 3px; right: 5px; font-size: 11px; font-weight: bold; color: ${palette.text}; opacity: 0.9;">${palette.icon}${escapeHtml(colorLabel)}</span>
                        ${pieceHtml}
                    </div>
                `;
            }
        }

        // 체크 경고 배지
        const anyCheck = snapshot.checkStatus?.bottom || snapshot.checkStatus?.top;
        const checkBannerHtml = anyCheck
            ? `<span style="background: #e74c3c; color: #fff; font-weight: 900; font-size: 16px; padding: 5px 14px; border-radius: 999px; border: 2px solid #fff; margin-left: 10px;">${escapeHtml(dict.CHECK_BADGE)}</span>`
            : '';

        // 프리뷰 안전도 상세 안내
        let previewNoticeHtml = `<span style="color: #95a5a6; font-size: 15px;">${isMyTurn && isChessPhase ? '이동할 내 기물을 클릭한 뒤 목표 칸을 선택하고 [이동 종료]를 누르세요.' : '카드 제출 후 활성 성격에 맞춰 기물을 이동합니다.'}</span>`;
        if (this.previewMove) {
            if (this.previewMove.safety === UNOS_SAFETY_LEVELS.RED) {
                previewNoticeHtml = `<span style="color: #ff6b6b; font-weight: bold; font-size: 16px;">🔺! ${escapeHtml(dict.SAFETY_RED_DESC)}</span>`;
            } else if (this.previewMove.safety === UNOS_SAFETY_LEVELS.YELLOW) {
                previewNoticeHtml = `<span style="color: #f1c40f; font-weight: bold; font-size: 16px;">⚠! ${escapeHtml(dict.SAFETY_YELLOW_DESC)}</span>`;
            } else {
                previewNoticeHtml = `<span style="color: #2ecc71; font-weight: bold; font-size: 16px;">✔ 안전한 이동 칸입니다. [${escapeHtml(dict.BTN_END_MOVE)}] 버튼으로 확정하세요.</span>`;
            }
        }

        // 조건부 좌/우 캐슬링 버튼 및 [이동 종료] 확정 버튼
        const leftCastle = snapshot.availableCastlings?.left;
        const rightCastle = snapshot.availableCastlings?.right;
        const canConfirmMove = Boolean(isMyTurn && isChessPhase && this.previewMove);

        const leftCastleBtnHtml = (isMyTurn && isChessPhase && leftCastle?.available)
            ? `<button type="button" id="btn-unos-castle-left" style="font-family: inherit; padding: 11px 18px; font-size: 17px; font-weight: bold; background: ${leftCastle.isKingDestThreatened ? '#d35400' : '#8e44ad'}; color: #fff; border: 2px solid #f39c12; border-radius: 12px; cursor: pointer;">
                ${escapeHtml(dict.BTN_CASTLE_LEFT)}${leftCastle.isKingDestThreatened ? ' 🔺!' : ''}
               </button>`
            : '';

        const rightCastleBtnHtml = (isMyTurn && isChessPhase && rightCastle?.available)
            ? `<button type="button" id="btn-unos-castle-right" style="font-family: inherit; padding: 11px 18px; font-size: 17px; font-weight: bold; background: ${rightCastle.isKingDestThreatened ? '#d35400' : '#8e44ad'}; color: #fff; border: 2px solid #f39c12; border-radius: 12px; cursor: pointer;">
                ${escapeHtml(dict.BTN_CASTLE_RIGHT)}${rightCastle.isKingDestThreatened ? ' 🔺!' : ''}
               </button>`
            : '';

        zone.innerHTML = `
            <div style="width: 100%; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center;">
                    <span style="font-size: 23px; font-weight: 900; color: #f1c40f;">♟️ 6×6 성격 체스 보드</span>
                    ${checkBannerHtml}
                </div>
                <span style="font-size: 14px; color: #bdc3c7;">프리셋: ${escapeHtml(snapshot.boardPresetId || 'P0')} (4색 각 9칸 비인접)</span>
            </div>

            <div class="unos-board-frame" id="unos-board-grid">
                ${cellsHtml}
            </div>

            <div style="width: 100%; display: flex; align-items: center; justify-content: space-between; min-height: 52px; gap: 12px;">
                <div style="flex: 1;">${previewNoticeHtml}</div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${leftCastleBtnHtml}
                    ${rightCastleBtnHtml}
                    <button type="button" id="btn-unos-commit-move" ${canConfirmMove ? '' : 'disabled'}
                        style="font-family: inherit; padding: 12px 26px; font-size: 19px; font-weight: 900; background: ${canConfirmMove ? '#27ae60' : '#34495e'}; color: #fff; border: 2px solid ${canConfirmMove ? '#a3e4d7' : 'rgba(255,255,255,0.2)'}; border-radius: 12px; cursor: ${canConfirmMove ? 'pointer' : 'not-allowed'}; opacity: ${canConfirmMove ? '1' : '0.55'};">
                        ✅ ${escapeHtml(dict.BTN_END_MOVE)}
                    </button>
                </div>
            </div>
        `;

        // 보드 셀 클릭 핸들러 바인딩
        const cells = zone.querySelectorAll('.unos-cell');
        cells.forEach(cellEl => {
            cellEl.addEventListener('click', () => {
                const r = Number(cellEl.getAttribute('data-r'));
                const c = Number(cellEl.getAttribute('data-c'));
                this._handleBoardCellClick(r, c);
            });
        });

        // [이동 종료] 확정 버튼
        const commitBtn = zone.querySelector('#btn-unos-commit-move');
        if (commitBtn) {
            commitBtn.addEventListener('click', () => {
                if (!this.previewMove) return;
                const movePayload = {
                    type: 'COMMIT_MOVE',
                    from: { ...this.previewMove.from },
                    to: { ...this.previewMove.to }
                };
                this.selectedFrom = null;
                this.previewMove = null;
                this.onSendAction(movePayload);
            });
        }

        // [좌/우 캐슬링] 버튼 및 위협 확인 팝업 연동
        const bindCastleBtn = (btnId, sideKey, castleInfo) => {
            const btn = zone.querySelector(btnId);
            if (!btn || !castleInfo?.available) return;
            btn.addEventListener('click', () => {
                if (castleInfo.isKingDestThreatened) {
                    this.pendingUnsafeCastleSide = sideKey;
                    this._renderModals(this.latestSnapshot);
                } else {
                    this.onSendAction({
                        type: 'COMMIT_CASTLING',
                        side: sideKey,
                        forceUnsafe: false
                    });
                }
            });
        };
        bindCastleBtn('#btn-unos-castle-left', 'left', leftCastle);
        bindCastleBtn('#btn-unos-castle-right', 'right', rightCastle);
    }

    _handleBoardCellClick(r, c) {
        const snapshot = this.latestSnapshot;
        if (!snapshot || snapshot.phase !== 'CHESS_PHASE') return;
        const { myPlayer } = this._getMyAndOpponentPlayer(snapshot);
        if (!myPlayer || snapshot.currentPlayerId !== myPlayer.id) return;

        // 현재 선택된 기물의 이동 가능 도착 칸을 클릭한 경우 -> 프리뷰 이동 설정
        if (this.selectedFrom) {
            const key = `${this.selectedFrom.r},${this.selectedFrom.c}`;
            const legalList = snapshot.legalMovesByPiece?.[key] || [];
            const targetMove = legalList.find(m => m.r === r && m.c === c);
            if (targetMove) {
                this.previewMove = {
                    from: { ...this.selectedFrom },
                    to: { r, c },
                    safety: targetMove.safety,
                    isCapture: targetMove.isCapture,
                    isPromotion: targetMove.isPromotion
                };
                this._renderChessZone(snapshot);
                return;
            }
        }

        // 내 기물을 클릭한 경우 -> 해당 기물 선택(프리뷰 초기화)
        const clickedPiece = snapshot.chessBoard?.[r]?.[c];
        if (clickedPiece && clickedPiece.side === myPlayer.side) {
            if (clickedPiece.type === 'Q' && (clickedPiece.cooldownTurns || 0) > 0) {
                this.showToast('퀸이 현재 쿨타임 중입니다! (2턴당 1회 이동 제한)');
                return;
            }
            this.selectedFrom = { r, c };
            this.previewMove = null;
            this._renderChessZone(snapshot);
            return;
        }

        // 빈 칸이나 이동 불가 칸 클릭 시 선택 해제
        this.selectedFrom = null;
        this.previewMove = null;
        this._renderChessZone(snapshot);
    }

    _renderTableZone(snapshot) {
        const zone = this.container.querySelector('#unos-table-zone');
        if (!zone) return;

        const lang = LangState.current || 'ko';
        const dict = getUnosDict(lang);
        const { myPlayer, opponent } = this._getMyAndOpponentPlayer(snapshot);
        const isMyTurn = Boolean(myPlayer && snapshot.currentPlayerId === myPlayer.id);

        // 현재 활성 성격 배지 및 이번 턴 이동 가능 색상 배지
        const matchColorKey = snapshot.matchColor || 'madness';
        const matchPalette = UNOS_COLOR_PALETTE[matchColorKey] || UNOS_COLOR_PALETTE.madness;
        const matchColorName = dict.COLORS[matchColorKey] || matchColorKey;
        const matchTex = getUnosPersonalityTextures(matchColorKey);
        const matchEmblemHtml = matchTex?.logo
            ? `<img src="${escapeHtml(matchTex.logo)}" alt="${escapeHtml(matchColorName)}" class="unos-personality-emblem" style="width: 34px; height: 34px;">`
            : `<span>${matchPalette.icon}</span>`;

        let turnMoveBadgesHtml = '';
        if (snapshot.colorFreeMove) {
            const resTex = getUnosPersonalityTextures('resonance');
            const resBadgeHtml = resTex?.badge
                ? `<img src="${escapeHtml(resTex.badge)}" alt="" class="unos-personality-emblem" style="width: 20px; height: 20px;">`
                : `<span>🌈</span>`;
            turnMoveBadgesHtml = `<span style="display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(90deg, #e74c3c, #f1c40f, #2ecc71, #3498db); color: #fff; font-weight: 900; padding: 6px 14px; border-radius: 999px; font-size: 15px; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${resBadgeHtml}${escapeHtml(dict.COLOR_FREE_MOVE_LABEL)}</span>`;
        } else {
            const activeList = Array.isArray(snapshot.turnActiveColors) && snapshot.turnActiveColors.length > 0
                ? snapshot.turnActiveColors
                : [matchColorKey];
            turnMoveBadgesHtml = activeList.map(cKey => {
                const pal = UNOS_COLOR_PALETTE[cKey] || UNOS_COLOR_PALETTE.madness;
                const cName = dict.COLORS[cKey] || cKey;
                const cTex = getUnosPersonalityTextures(cKey);
                const cBadgeHtml = cTex?.badge
                    ? `<img src="${escapeHtml(cTex.badge)}" alt="" class="unos-personality-emblem" style="width: 20px; height: 20px;">`
                    : `<span>${pal.icon}</span>`;
                return `<span style="display: inline-flex; align-items: center; gap: 6px; background: ${pal.hex}; color: ${pal.text}; font-weight: 900; padding: 5px 14px; border-radius: 999px; font-size: 15px; border: 2px solid ${pal.border};">${cBadgeHtml}${escapeHtml(cName)}</span>`;
            }).join(' ');
        }

        // 중앙 버림 더미 최상단 카드 시각 표현
        const centerCardHtml = this._buildCardVisualHtml(snapshot.centerCard, { isCenterPile: true, lang });

        // 상대 손패 뒷면 카드 팬 표현 (상대 hand 배열 원본 없이 handCount만 사용 · 신규 Card_Back.webp 반영)
        const oppHandCount = Number(opponent?.handCount || 0);
        const visibleBackCards = Math.min(10, oppHandCount);
        let oppBacksHtml = '';
        for (let i = 0; i < visibleBackCards; i++) {
            oppBacksHtml += `<img src="${escapeHtml(UNOS_COMMON_TEXTURES.CARD_BACK)}" alt="카드 뒷면" style="width: 34px; height: 50px; border-radius: 7px; object-fit: cover; border: 2px solid #f1c40f; margin-left: ${i === 0 ? '0' : '-14px'}; box-shadow: 0 3px 8px rgba(0,0,0,0.5);">`;
        }

        const oppBurstBadge = opponent?.burst?.active
            ? `<span style="background: #e67e22; color: #fff; font-weight: 900; font-size: 14px; padding: 4px 10px; border-radius: 999px; border: 2px solid #fff;">${escapeHtml(dict.BURST_BADGE)} (${opponent.burst.turnsLeft}T / Δ${opponent.burst.pendingRedrawDelta >= 0 ? `+${opponent.burst.pendingRedrawDelta}` : opponent.burst.pendingRedrawDelta})</span>`
            : '';

        const myBurstBadge = myPlayer?.burst?.active
            ? `<span style="background: #e67e22; color: #fff; font-weight: 900; font-size: 14px; padding: 4px 10px; border-radius: 999px; border: 2px solid #fff;">${escapeHtml(dict.BURST_BADGE)} (${myPlayer.burst.turnsLeft}T / Δ${myPlayer.burst.pendingRedrawDelta >= 0 ? `+${myPlayer.burst.pendingRedrawDelta}` : myPlayer.burst.pendingRedrawDelta})</span>`
            : '';

        const canDrawCard = Boolean(
            isMyTurn
            && snapshot.phase === 'CARD_PHASE'
            && (snapshot.actionChainStep || 0) === 0
            && !myPlayer?.hasPlayableCard
        );

        const phaseLabel = dict.PHASES[snapshot.phase] || snapshot.phase;
        const curPlayerObj = (snapshot.players || []).find(p => p.id === snapshot.currentPlayerId) || null;
        const showTurnTimer = Boolean(
            snapshot.phase !== 'TURN_ORDER'
            && snapshot.phase !== 'GAME_OVER'
            && curPlayerObj?.type !== 'ai'
            && (Number(snapshot.turnTimeLimitSec) || 0) > 0
        );
        const timerLeftVal = Math.max(0, Number(snapshot.timerLeft ?? snapshot.turnTimeLimitSec ?? 0));
        const isWarnTime = timerLeftVal <= UNOS_TURN_TIMER_CONFIG.WARN_THRESHOLD_SECONDS;
        const timerBadgeHtml = showTurnTimer
            ? `<span id="unos-turn-timer-badge" style="padding: 4px 12px; border-radius: 999px; font-size: 15px; font-weight: 900; background: ${isWarnTime ? '#e74c3c' : 'rgba(241, 196, 15, 0.2)'}; color: ${isWarnTime ? '#ffffff' : '#f1c40f'}; border: 2px solid ${isWarnTime ? '#ffffff' : '#f1c40f'};">⏱ ${timerLeftVal}s</span>`
            : `<span id="unos-turn-timer-badge" style="display: none;"></span>`;

        const logsHtml = (snapshot.actionLogs || []).slice(-7).map(item =>
            `<div style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 14px; color: #dfe6e9;">
                <span style="color: #f1c40f; font-weight: bold;">[T${item.turn}]</span> ${escapeHtml(item.text)}
            </div>`
        ).join('');

        zone.innerHTML = `
            <!-- 상단 헤더: 상대방 프로필 & 기권/나가기 버튼 -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.32); padding: 12px 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.12);">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 14px; height: 42px; border-radius: 6px; background: ${escapeHtml(opponent?.color || '#e74c3c')};"></div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 20px; font-weight: 900;">${escapeHtml(opponent?.name || '상대방')}</span>
                            <span style="font-size: 12px; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.14);">${opponent?.type === 'ai' ? 'AI' : 'PLAYER'}</span>
                            ${oppBurstBadge}
                        </div>
                        <div style="font-size: 14px; color: #bdc3c7; margin-top: 3px;">
                            손패: <strong style="color: #f1c40f;">${oppHandCount}${escapeHtml(dict.HAND_COUNT_UNIT)}</strong>
                            ${opponent?.skipNextCardPhase ? ' · <span style="color: #ff7675; font-weight: bold;">🚫 다음 카드 스킵</span>' : ''}
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="display: flex; align-items: center;">${oppBacksHtml}</div>
                    <button type="button" id="btn-unos-surrender" style="font-family: inherit; padding: 8px 14px; font-size: 14px; font-weight: bold; background: rgba(127, 140, 141, 0.35); color: #ecf0f1; border: 1px solid rgba(255,255,255,0.3); border-radius: 10px; cursor: pointer;">🏳️ ${escapeHtml(dict.BTN_SURRENDER)}</button>
                    <button type="button" id="btn-unos-exit" style="font-family: inherit; padding: 8px 16px; font-size: 14px; font-weight: bold; background: rgba(192, 57, 43, 0.85); color: #fff; border: 1px solid rgba(255,255,255,0.4); border-radius: 10px; cursor: pointer;">🚪 ${escapeHtml(this.exitConfirmPending ? dict.BTN_EXIT_CONFIRM : dict.BTN_EXIT)}</button>
                </div>
            </div>

            <!-- 중앙: 덱 & 중앙 버림 더미 & 현재 활성 성격 배지 -->
            <div style="display: flex; align-items: center; justify-content: space-around; background: rgba(10, 15, 28, 0.65); border: 2px solid rgba(255,255,255,0.12); border-radius: 18px; padding: 20px 18px; my: 10px;">
                <!-- 드로우 덱 -->
                <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                    <div id="btn-unos-deck-draw" style="position: relative; width: 132px; height: 188px; border-radius: 16px; overflow: hidden; border: 3px solid ${canDrawCard ? '#00e5ff' : '#f1c40f'}; box-shadow: ${canDrawCard ? '0 0 24px rgba(0,229,255,0.8)' : '0 8px 20px rgba(0,0,0,0.6)'}; cursor: ${canDrawCard ? 'pointer' : 'default'};">
                        <img src="${escapeHtml(UNOS_COMMON_TEXTURES.CARD_BACK)}" alt="우노스 카드 뒷면" style="width: 100%; height: 100%; object-fit: cover; display: block;">
                    </div>
                    <span style="font-size: 13px; color: #f8fafc; font-weight: 800;">${escapeHtml(dict.DECK_REMAINING)} : <strong style="color: #f1c40f;">${snapshot.deckCount}${escapeHtml(dict.HAND_COUNT_UNIT || '장')}</strong></span>
                    <button type="button" id="btn-unos-draw-action" ${canDrawCard ? '' : 'disabled'}
                        style="font-family: inherit; padding: 8px 16px; font-size: 14px; font-weight: bold; background: ${canDrawCard ? '#00acc1' : '#34495e'}; color: #fff; border: none; border-radius: 10px; cursor: ${canDrawCard ? 'pointer' : 'not-allowed'}; opacity: ${canDrawCard ? '1' : '0.45'};">
                        🃏 ${escapeHtml(dict.BTN_DRAW_CARD)}
                    </button>
                </div>

                <!-- 중앙 최상단 카드 -->
                <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
                    ${centerCardHtml}
                    <span style="font-size: 14px; color: #bdc3c7;">${escapeHtml(dict.DISCARD_PILE)} (${snapshot.discardCount})</span>
                </div>

                <!-- 현재 활성 성격(색상) 강조 배지 -->
                <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 240px; background: rgba(255,255,255,0.05); padding: 16px; border-radius: 16px; border: 2px solid ${matchPalette.border};">
                    <span style="font-size: 14px; color: #bdc3c7; font-weight: bold;">${escapeHtml(dict.ACTIVE_COLOR_LABEL)}</span>
                    <div style="display: inline-flex; align-items: center; gap: 10px; padding: 12px 24px; border-radius: 14px; background: ${matchPalette.hex}; color: ${matchPalette.text}; font-size: 24px; font-weight: 900; border: 3px solid #fff; box-shadow: 0 0 20px ${matchPalette.hex};">
                        ${matchEmblemHtml}
                        <span>${escapeHtml(matchColorName)}</span>
                    </div>
                    <span style="font-size: 13px; color: #bdc3c7; margin-top: 4px;">${escapeHtml(dict.TURN_MOVE_COLOR_LABEL)}</span>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;">
                        ${turnMoveBadgesHtml}
                    </div>
                </div>
            </div>

            <!-- 턴/페이즈 상태 안내 배너 -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: ${isMyTurn ? 'rgba(39, 174, 96, 0.22)' : 'rgba(52, 73, 94, 0.35)'}; border: 2px solid ${isMyTurn ? '#2ecc71' : 'rgba(255,255,255,0.15)'}; padding: 12px 18px; border-radius: 14px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 19px; font-weight: 900; color: ${isMyTurn ? '#2ecc71' : '#f1c40f'};">
                        ${isMyTurn ? '🟢 내 턴' : `⏳ ${escapeHtml(opponent?.name || '상대')}의 턴`} — ${escapeHtml(phaseLabel)}
                    </span>
                    ${myBurstBadge}
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${timerBadgeHtml}
                    <span style="font-size: 15px; font-weight: bold; color: #ecf0f1;">Turn ${snapshot.turnNumber}</span>
                </div>
            </div>

            <!-- 하단 액션 로그 -->
            <div style="background: rgba(0,0,0,0.38); border-radius: 14px; padding: 10px 14px; height: 155px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1);">
                ${logsHtml}
            </div>
        `;

        // 드로우 버튼 바인딩
        const triggerDraw = () => {
            if (!canDrawCard) return;
            this.onSendAction({ type: 'DRAW_CARD' });
        };
        zone.querySelector('#btn-unos-deck-draw')?.addEventListener('click', triggerDraw);
        zone.querySelector('#btn-unos-draw-action')?.addEventListener('click', triggerDraw);

        // 기권 버튼
        zone.querySelector('#btn-unos-surrender')?.addEventListener('click', () => {
            if (snapshot.phase === 'GAME_OVER') return;
            this.onSendAction({ type: 'SURRENDER' });
        });

        // 나가기 버튼 (2단계 클릭 확인)
        const exitBtn = zone.querySelector('#btn-unos-exit');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                if (!this.exitConfirmPending) {
                    this.exitConfirmPending = true;
                    exitBtn.textContent = `🚪 ${dict.BTN_EXIT_CONFIRM}`;
                    if (this.exitConfirmTimer) clearTimeout(this.exitConfirmTimer);
                    this.exitConfirmTimer = setTimeout(() => {
                        this.exitConfirmPending = false;
                        if (exitBtn) exitBtn.textContent = `🚪 ${dict.BTN_EXIT}`;
                    }, 3000);
                    return;
                }
                if (this.exitConfirmTimer) clearTimeout(this.exitConfirmTimer);
                if (typeof this.onExitMatch === 'function') {
                    this.onExitMatch();
                }
            });
        }
    }

    _buildCardVisualHtml(card, { isCenterPile = false, lang = 'ko', fanTransform = '', index = 0 } = {}) {
        const dict = getUnosDict(lang);
        if (!card) {
            return `<div style="width: 132px; height: 188px; border-radius: 16px; border: 2px dashed rgba(255,255,255,0.3);"></div>`;
        }

        const pal = UNOS_COLOR_PALETTE[card.paletteKey || card.color] || UNOS_COLOR_PALETTE.madness;
        const bgStyle = pal.gradient || pal.hex;
        const title = formatUnosCardTitle(card, lang);
        const desc = dict.CARD_DESC[card.kind] || '';
        const visualSpec = resolveUnosCardVisualSpec(card);
        const hasBgTexture = Boolean(visualSpec.cardBgPath);

        const bgLayerHtml = hasBgTexture
            ? `<img class="unos-card-bg-img" src="${escapeHtml(visualSpec.cardBgPath)}" alt="${escapeHtml(title)}">`
            : '';

        let centerOverlayHtml = '';
        if (visualSpec.overlayType === 'number' && visualSpec.numberSprite) {
            const ns = visualSpec.numberSprite;
            centerOverlayHtml = `
                <div class="unos-card-center-slot" aria-hidden="true">
                    <div class="unos-card-number-sprite"
                         style="background-image: url('${escapeHtml(ns.spritePath)}'); background-size: ${escapeHtml(ns.backgroundSize)}; background-position: ${escapeHtml(ns.backgroundPosition)};">
                    </div>
                </div>
            `;
        } else if (visualSpec.overlayType === 'medallion' && visualSpec.overlayImagePath) {
            centerOverlayHtml = `
                <div class="unos-card-center-slot" aria-hidden="true">
                    <img class="unos-card-medallion-img" src="${escapeHtml(visualSpec.overlayImagePath)}" alt="${escapeHtml(title)}">
                </div>
            `;
        } else if (visualSpec.overlayType === 'temp_symbol') {
            const kindLabel = dict.KINDS[card.kind] || '';
            centerOverlayHtml = `
                <div class="unos-card-center-slot" aria-hidden="true">
                    <div class="unos-card-temp-slot">
                        <span style="font-size: ${isCenterPile ? '38px' : '40px'}; font-weight: 900; color: #ffffff; text-shadow: 0 3px 10px rgba(0,0,0,0.85), 0 0 6px rgba(0,0,0,0.65); line-height: 1.05;">
                            ${escapeHtml(visualSpec.tempSymbol || card.symbol || String(card.value ?? ''))}
                        </span>
                        <span style="font-size: 11px; font-weight: 900; color: #ffffff; background: rgba(15,23,42,0.72); border: 1px solid rgba(255,255,255,0.45); padding: 2px 8px; border-radius: 999px; letter-spacing: 0.4px;">
                            ${escapeHtml(kindLabel)}
                        </span>
                    </div>
                </div>
            `;
        }

        if (isCenterPile) {
            const centerStyle = hasBgTexture
                ? `width: 136px; height: 192px; border-radius: 16px; background: transparent; box-shadow: 0 10px 26px rgba(0,0,0,0.65); box-sizing: border-box;`
                : `width: 136px; height: 192px; border-radius: 16px; background: ${bgStyle}; color: ${pal.text}; border: 4px solid #ffffff; box-shadow: 0 10px 26px rgba(0,0,0,0.65); box-sizing: border-box;`;
            return `
                <div class="unos-card-surface" style="${centerStyle}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
                    ${bgLayerHtml}
                    ${centerOverlayHtml}
                </div>
            `;
        }

        const isChainBlocked = card.disabledReason === 'ACTION_CHAIN_LIMIT';
        const isPlayable = Boolean(card.playable);
        const stateClass = isChainBlocked ? 'chain-blocked' : (!isPlayable ? 'disabled-card' : '');

        const chainBlockedOverlayHtml = isChainBlocked
            ? `<div style="position: absolute; inset: 0; background: rgba(18, 22, 34, 0.84); border-radius: 14px; display: flex; align-items: center; justify-content: center; padding: 10px; text-align: center; z-index: 5;">
                <span style="color: #ff5252; font-size: 13px; font-weight: 900; line-height: 1.35;">🚫 ${escapeHtml(dict.ACTION_CHAIN_LIMIT_MSG)}</span>
               </div>`
            : '';

        const handCardStyle = hasBgTexture
            ? `background: transparent; border: none; box-shadow: ${isPlayable ? '0 10px 24px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.88)' : '0 10px 24px rgba(0,0,0,0.55)'}; --fan-transform: ${fanTransform}; z-index: ${10 + index};`
            : `background: ${bgStyle}; color: ${pal.text}; border: 3px solid ${isPlayable ? '#ffffff' : 'rgba(255,255,255,0.35)'}; --fan-transform: ${fanTransform}; z-index: ${10 + index};`;

        return `
            <div class="unos-card-item unos-card-surface ${stateClass}"
                 data-card-id="${escapeHtml(card.id)}"
                 data-card-kind="${escapeHtml(card.kind)}"
                 data-playable="${isPlayable ? '1' : '0'}"
                 data-disabled-reason="${escapeHtml(card.disabledReason || '')}"
                 style="${handCardStyle}"
                 title="${escapeHtml(card.disabledMessage || `${title} — ${desc}`)}"
                 aria-label="${escapeHtml(title)}">
                ${bgLayerHtml}
                ${centerOverlayHtml}
                ${chainBlockedOverlayHtml}
            </div>
        `;
    }

    _renderHandZone(snapshot) {
        const zone = this.container.querySelector('#unos-hand-zone');
        if (!zone) return;

        const lang = LangState.current || 'ko';
        const dict = getUnosDict(lang);
        const { myPlayer } = this._getMyAndOpponentPlayer(snapshot);
        const hand = Array.isArray(myPlayer?.hand) ? myPlayer.hand : [];
        const isPromotionMode = snapshot.phase === 'PROMOTION_PROMPT' && snapshot.currentPlayerId === myPlayer?.id;

        const n = hand.length;
        const mid = (n - 1) / 2;
        const maxAngleStep = n > 9 ? 3.2 : 4.8;

        const cardsHtml = hand.map((card, idx) => {
            const offset = idx - mid;
            const angle = offset * maxAngleStep;
            const arcY = Math.abs(offset) * Math.abs(offset) * 2.2;
            const fanTransform = `translateY(${arcY.toFixed(1)}px) rotate(${angle.toFixed(1)}deg)`;
            const effectiveCard = isPromotionMode
                ? { ...card, playable: true, disabledReason: null, disabledMessage: null }
                : card;
            return this._buildCardVisualHtml(effectiveCard, { isCenterPile: false, lang, fanTransform, index: idx });
        }).join('');

        let guideText = `내 손패 (${hand.length}${dict.HAND_COUNT_UNIT}) — 카드를 클릭하거나 위로 드래그하여 제출`;
        if (isPromotionMode) {
            guideText = `👑 ${dict.PROMOTION_ALERT_MSG} (버릴 손패 카드를 클릭하세요)`;
        } else if (myPlayer?.burst?.active) {
            guideText = `🔥 버스트(UNO!) 상태 활성화 중! (잔여 ${myPlayer.burst.turnsLeft}턴간 카드 제출 없이 체스 자유 이동)`;
        } else if ((snapshot.actionChainStep || 0) > 0) {
            guideText = `⚡ 콤보 추가 제출 단계! 색상/숫자 조건 없이 카드를 1장 더 내세요.`;
        }

        zone.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.88); border: 1px solid rgba(255,255,255,0.2); padding: 6px 22px; border-radius: 999px; font-size: 15px; font-weight: bold; color: #f1c40f; margin-bottom: 8px; pointer-events: auto;">
                ${escapeHtml(guideText)}
            </div>
            <div class="unos-fan-container" id="unos-fan-cards">
                ${cardsHtml}
            </div>
        `;

        const cardEls = zone.querySelectorAll('.unos-card-item');
        cardEls.forEach(cardEl => {
            cardEl.addEventListener('pointerdown', (e) => this._onCardPointerDown(e, cardEl));
        });
    }

    _onCardPointerDown(e, cardEl) {
        if (e.button !== undefined && e.button !== 0) return;
        const cardId = cardEl.getAttribute('data-card-id');
        const cardKind = cardEl.getAttribute('data-card-kind');
        const playable = cardEl.getAttribute('data-playable') === '1';
        const disabledReason = cardEl.getAttribute('data-disabled-reason') || '';

        this._dragState = {
            cardEl,
            cardId,
            cardKind,
            playable,
            disabledReason,
            startX: e.clientX,
            startY: e.clientY,
            moved: false
        };
    }

    _onWindowPointerMove(e) {
        if (!this._dragState) return;
        const dx = e.clientX - this._dragState.startX;
        const dy = e.clientY - this._dragState.startY;
        if (Math.hypot(dx, dy) > 8) {
            this._dragState.moved = true;
        }
        if (this._dragState.moved && this._dragState.playable && this._dragState.cardEl) {
            this._dragState.cardEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.15) rotate(0deg)`;
            this._dragState.cardEl.style.zIndex = '120';
        }
    }

    _onWindowPointerUp(e) {
        if (!this._dragState) return;
        const st = this._dragState;
        this._dragState = null;

        const dy = e.clientY - st.startY;
        const isClick = !st.moved;
        const isUpwardDrop = st.moved && dy < -55;

        if (st.cardEl) {
            st.cardEl.style.transform = '';
            st.cardEl.style.zIndex = '';
        }

        if (!isClick && !isUpwardDrop) return;
        this._attemptSubmitHandCard(st);
    }

    _attemptSubmitHandCard({ cardId, cardKind, playable, disabledReason }) {
        const snapshot = this.latestSnapshot;
        if (!snapshot) return;
        const lang = LangState.current || 'ko';
        const dict = getUnosDict(lang);
        const { myPlayer } = this._getMyAndOpponentPlayer(snapshot);

        // 프로모션 소각 선택 모드
        if (snapshot.phase === 'PROMOTION_PROMPT' && snapshot.currentPlayerId === myPlayer?.id) {
            this.onSendAction({
                type: 'RESOLVE_PROMOTION',
                cardId
            });
            return;
        }

        if (!playable) {
            if (disabledReason === 'ACTION_CHAIN_LIMIT') {
                this.showToast(dict.ACTION_CHAIN_LIMIT_MSG);
            } else if (disabledReason === 'NOT_YOUR_TURN') {
                this.showToast(dict.NOT_YOUR_TURN_MSG);
            } else if (disabledReason === 'WRONG_PHASE') {
                this.showToast(dict.CHESS_PHASE_CARD_LOCKED_MSG);
            } else {
                this.showToast(dict.CARD_NOT_MATCHED_MSG);
            }
            return;
        }

        if (cardKind === UNOS_CARD_KINDS.RESONANCE) {
            this.pendingResonanceRequest = {
                mode: 'PLAY_CARD',
                cardId
            };
            this._renderModals(snapshot);
            return;
        }

        this.onSendAction({
            type: 'PLAY_CARD',
            cardId
        });
    }

    _renderModals(snapshot) {
        const layer = this.container.querySelector('#unos-modal-layer');
        if (!layer || !snapshot) return;

        const lang = LangState.current || 'ko';
        const dict = getUnosDict(lang);
        const { myPlayer } = this._getMyAndOpponentPlayer(snapshot);
        const isMyTurn = Boolean(myPlayer && snapshot.currentPlayerId === myPlayer.id);

        // 0. 선/후공 숫자 카드(0~9) 추첨 모달 (TURN_ORDER)
        if (snapshot.phase === 'TURN_ORDER' && snapshot.turnOrderState?.visible) {
            const toState = snapshot.turnOrderState;
            const entries = Array.isArray(toState.players) ? toState.players : [];
            const myEntry = entries.find(e => e.id === myPlayer?.id) || entries[0] || null;
            const canClickDraw = Boolean(
                myEntry
                && !myEntry.drawn
                && toState.stage === 'DRAWING'
            );

            const entriesHtml = entries.map(entry => {
                const isMe = entry.id === myPlayer?.id;
                let rankBadgeHtml = '';
                if (toState.stage === 'RESULT') {
                    if (entry.rank === 1) {
                        rankBadgeHtml = `<span style="background: #f1c40f; color: #1e272e; font-weight: 900; font-size: 14px; padding: 4px 12px; border-radius: 999px;">${escapeHtml(dict.TURN_ORDER_FIRST_BADGE)}</span>`;
                    } else if (entry.rank === 2) {
                        rankBadgeHtml = `<span style="background: #95a5a6; color: #1e272e; font-weight: 900; font-size: 14px; padding: 4px 12px; border-radius: 999px;">${escapeHtml(dict.TURN_ORDER_SECOND_BADGE)}</span>`;
                    }
                } else if (toState.stage === 'TIE_REDRAW' && entry.tied) {
                    rankBadgeHtml = `<span style="background: #e67e22; color: #fff; font-weight: 900; font-size: 13px; padding: 3px 10px; border-radius: 999px;">⚡ TIE (${entry.number})</span>`;
                }

                const cardSlotHtml = (entry.drawn && entry.drawnCard)
                    ? this._buildCardVisualHtml(entry.drawnCard, { isCenterPile: true, lang })
                    : `<div style="position: relative; width: 136px; height: 192px; border-radius: 16px; overflow: hidden; border: 3px dashed ${isMe && canClickDraw ? '#00e5ff' : '#f1c40f'}; box-shadow: 0 8px 22px rgba(0,0,0,0.6);">
                        <img src="${escapeHtml(UNOS_COMMON_TEXTURES.CARD_BACK)}" alt="추첨 대기 카드 뒷면" style="width: 100%; height: 100%; object-fit: cover; display: block;">
                        <div style="position: absolute; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; flex-direction: column; align-items: center; justify-content: center;">
                            <span style="font-size: 46px; font-weight: 900; color: #f1c40f; text-shadow: 0 3px 10px rgba(0,0,0,0.85);">?</span>
                            <span style="font-size: 11px; color: #f8fafc; margin-top: 6px; background: rgba(15, 23, 42, 0.88); padding: 3px 10px; border-radius: 999px; border: 1px solid #f1c40f;">${escapeHtml(dict.TURN_ORDER_WAITING_DRAW)}</span>
                        </div>
                       </div>`;

                return `
                    <div style="width: 250px; background: rgba(15, 23, 42, 0.78); border: 2px solid ${entry.rank === 1 ? '#f1c40f' : (isMe ? '#00e5ff' : 'rgba(255,255,255,0.18)')}; border-radius: 18px; padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="width: 12px; height: 12px; border-radius: 50%; background: ${escapeHtml(entry.color || '#3498db')};"></span>
                            <span style="font-size: 19px; font-weight: 900; color: #fff;">${escapeHtml(entry.name || '')}</span>
                            <span style="font-size: 11px; padding: 2px 7px; border-radius: 999px; background: rgba(255,255,255,0.15);">${entry.isAi ? 'AI' : (isMe ? 'ME' : 'PLAYER')}</span>
                        </div>
                        <div style="min-height: 26px; display: flex; align-items: center;">${rankBadgeHtml}</div>
                        ${cardSlotHtml}
                        <div style="font-size: 16px; font-weight: 900; color: ${entry.drawn ? '#f1c40f' : '#95a5a6'};">
                            ${entry.drawn ? `숫자: ${entry.number}` : escapeHtml(dict.TURN_ORDER_WAITING_DRAW)}
                        </div>
                    </div>
                `;
            }).join('');

            let bottomStatusHtml = '';
            if (toState.stage === 'TIE_REDRAW' && toState.tieNotice) {
                bottomStatusHtml = `
                    <div style="background: rgba(230, 126, 34, 0.25); border: 2px solid #f39c12; color: #f1c40f; padding: 12px 24px; border-radius: 14px; font-size: 18px; font-weight: 900;">
                        ${escapeHtml(toState.tieNotice)}
                    </div>
                `;
            } else if (toState.stage === 'RESULT') {
                const firstEntry = entries.find(e => e.rank === 1) || entries[0];
                const secondEntry = entries.find(e => e.rank === 2) || entries[1];
                bottomStatusHtml = `
                    <div style="background: rgba(39, 174, 96, 0.25); border: 2px solid #2ecc71; color: #2ecc71; padding: 12px 24px; border-radius: 14px; font-size: 18px; font-weight: 900;">
                        🎉 ${escapeHtml(firstEntry?.name || '')} 선공(1st) vs ${escapeHtml(secondEntry?.name || '')} 후공(2nd) 확정!
                    </div>
                `;
            } else if (canClickDraw) {
                bottomStatusHtml = `
                    <button type="button" id="btn-unos-turn-order-draw"
                        style="font-family: inherit; padding: 14px 38px; font-size: 21px; font-weight: 900; background: linear-gradient(135deg, #27ae60, #16a085); color: #fff; border: 3px solid #a3e4d7; border-radius: 14px; cursor: pointer; box-shadow: 0 8px 24px rgba(39, 174, 96, 0.55);">
                        🎴 ${escapeHtml(dict.TURN_ORDER_BTN_DRAW)} (${toState.secondsLeft})
                    </button>
                `;
            } else {
                bottomStatusHtml = `
                    <div style="color: #00e5ff; font-size: 17px; font-weight: bold;">
                        ⏳ ${escapeHtml(dict.TURN_ORDER_WAITING_OPP)} (${toState.secondsLeft}s)
                    </div>
                `;
            }

            layer.style.pointerEvents = 'auto';
            layer.innerHTML = `
                <div style="width: 100%; height: 100%; background: rgba(0, 0, 0, 0.74); display: flex; align-items: center; justify-content: center;">
                    <div style="width: 720px; background: #1a2238; border: 4px solid #f1c40f; border-radius: 26px; padding: 32px 38px; text-align: center; box-shadow: 0 26px 64px rgba(0,0,0,0.85); display: flex; flex-direction: column; align-items: center; gap: 18px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                            <span style="background: rgba(241, 196, 15, 0.2); border: 1px solid #f1c40f; color: #f1c40f; font-size: 14px; font-weight: 900; padding: 4px 14px; border-radius: 999px;">Round ${toState.round || 1}</span>
                            <h2 style="margin: 0; font-size: 28px; color: #f1c40f;">${escapeHtml(dict.TURN_ORDER_TITLE)}</h2>
                            <span style="font-size: 14px; color: #bdc3c7;">0 ~ 9</span>
                        </div>
                        <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #dfe6e9; white-space: pre-line;">
                            ${escapeHtml(dict.TURN_ORDER_SUBTITLE)}
                        </p>
                        <div style="display: flex; align-items: center; justify-content: center; gap: 28px; margin: 6px 0;">
                            ${entriesHtml}
                        </div>
                        <div style="min-height: 56px; display: flex; align-items: center; justify-content: center;">
                            ${bottomStatusHtml}
                        </div>
                    </div>
                </div>
            `;

            layer.querySelector('#btn-unos-turn-order-draw')?.addEventListener('click', () => {
                this.onSendAction({ type: 'TURN_ORDER_DRAW' });
            });
            return;
        }

        // 1. 경기 종료 모달
        if (snapshot.phase === 'GAME_OVER' && snapshot.gameOverResult) {
            const res = snapshot.gameOverResult;
            const isWinner = res.winnerId === myPlayer?.id;
            const reasonText = res.reason === 'SURRENDER' ? '상대방 기권 승리' : '상대 킹 포획 (CHECKMATE!)';

            layer.style.pointerEvents = 'auto';
            layer.innerHTML = `
                <div style="width: 100%; height: 100%; background: rgba(0,0,0,0.72); display: flex; align-items: center; justify-content: center;">
                    <div style="width: 580px; background: #1a2238; border: 4px solid #f1c40f; border-radius: 24px; padding: 36px 40px; text-align: center; box-shadow: 0 24px 60px rgba(0,0,0,0.8);">
                        <h2 style="margin: 0 0 12px 0; font-size: 38px; color: ${isWinner ? '#f1c40f' : '#e74c3c'};">
                            ${escapeHtml(dict.CHECKMATE_TITLE)}
                        </h2>
                        <p style="font-size: 24px; font-weight: bold; margin: 0 0 10px 0;">
                            🏆 승자: ${escapeHtml(res.winnerName || '')}
                        </p>
                        <p style="font-size: 17px; color: #bdc3c7; margin: 0 0 28px 0;">
                            ${escapeHtml(reasonText)} · 총 ${res.totalTurns}턴 진행
                        </p>
                        <div style="display: flex; justify-content: center; gap: 16px;">
                            <button type="button" id="btn-unos-over-room" style="font-family: inherit; padding: 14px 28px; font-size: 19px; font-weight: bold; background: #27ae60; color: #fff; border: none; border-radius: 12px; cursor: pointer;">
                                ${escapeHtml(dict.BTN_RETURN_ROOM)}
                            </button>
                            <button type="button" id="btn-unos-over-exit" style="font-family: inherit; padding: 14px 28px; font-size: 19px; font-weight: bold; background: #c0392b; color: #fff; border: none; border-radius: 12px; cursor: pointer;">
                                ${escapeHtml(dict.BTN_EXIT)}
                            </button>
                        </div>
                    </div>
                </div>
            `;
            layer.querySelector('#btn-unos-over-room')?.addEventListener('click', () => {
                if (typeof this.onReturnToRoom === 'function') this.onReturnToRoom();
            });
            layer.querySelector('#btn-unos-over-exit')?.addEventListener('click', () => {
                if (typeof this.onExitMatch === 'function') this.onExitMatch();
            });
            return;
        }

        // 2. 공명(Resonance) 4대 성격 색상 선택 모달
        if (this.pendingResonanceRequest) {
            const colorBtnsHtml = UNOS_PERSONALITY_KEYS.map(cKey => {
                const pal = UNOS_COLOR_PALETTE[cKey];
                const cName = dict.COLORS[cKey];
                const cTex = getUnosPersonalityTextures(cKey);
                const cBadgeHtml = cTex?.badge
                    ? `<img src="${escapeHtml(cTex.badge)}" alt="" class="unos-personality-emblem" style="width: 28px; height: 28px;">`
                    : `<span>${pal.icon}</span>`;
                return `
                    <button type="button" class="btn-unos-pick-color" data-color="${escapeHtml(cKey)}"
                        style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit; padding: 18px 24px; font-size: 20px; font-weight: 900; background: ${pal.hex}; color: ${pal.text}; border: 3px solid #fff; border-radius: 14px; cursor: pointer; min-width: 130px;">
                        ${cBadgeHtml}<span>${escapeHtml(cName)}</span>
                    </button>
                `;
            }).join('');

            layer.style.pointerEvents = 'auto';
            layer.innerHTML = `
                <div style="width: 100%; height: 100%; background: rgba(0,0,0,0.65); display: flex; align-items: center; justify-content: center;">
                    <div style="width: 640px; background: #1a2238; border: 4px solid #f1c40f; border-radius: 24px; padding: 32px; text-align: center;">
                        <h3 style="margin: 0 0 22px 0; font-size: 26px; color: #f1c40f;">${escapeHtml(dict.RESONANCE_PICK_TITLE)}</h3>
                        <div style="display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; margin-bottom: 22px;">
                            ${colorBtnsHtml}
                        </div>
                        <button type="button" id="btn-unos-cancel-resonance" style="font-family: inherit; padding: 10px 26px; font-size: 16px; font-weight: bold; background: #7f8c8d; color: #fff; border: none; border-radius: 10px; cursor: pointer;">
                            ${escapeHtml(dict.BTN_CANCEL)}
                        </button>
                    </div>
                </div>
            `;

            layer.querySelectorAll('.btn-unos-pick-color').forEach(btn => {
                btn.addEventListener('click', () => {
                    const chosenColor = btn.getAttribute('data-color');
                    const req = this.pendingResonanceRequest;
                    this.pendingResonanceRequest = null;
                    this._renderModals(this.latestSnapshot);
                    if (req?.mode === 'RESOLVE_DRAWN_CARD') {
                        this.onSendAction({
                            type: 'RESOLVE_DRAWN_CARD',
                            decision: 'play',
                            chosenColor
                        });
                    } else if (req?.cardId) {
                        this.onSendAction({
                            type: 'PLAY_CARD',
                            cardId: req.cardId,
                            chosenColor
                        });
                    }
                });
            });
            layer.querySelector('#btn-unos-cancel-resonance')?.addEventListener('click', () => {
                this.pendingResonanceRequest = null;
                this._renderModals(this.latestSnapshot);
            });
            return;
        }

        // 3. 자살 캐슬링 위험 경고 확인 모달 ("킹이 갈 자리가 공격받고 있습니다! 그래도 캐슬링을 진행하시겠습니까?")
        if (this.pendingUnsafeCastleSide) {
            const sideToForce = this.pendingUnsafeCastleSide;
            layer.style.pointerEvents = 'auto';
            layer.innerHTML = `
                <div style="width: 100%; height: 100%; background: rgba(0,0,0,0.68); display: flex; align-items: center; justify-content: center;">
                    <div style="width: 580px; background: #1a2238; border: 4px solid #e74c3c; border-radius: 24px; padding: 32px 36px; text-align: center;">
                        <h3 style="margin: 0 0 16px 0; font-size: 26px; color: #ff6b6b;">${escapeHtml(dict.CASTLING_WARN_TITLE)}</h3>
                        <p style="font-size: 20px; line-height: 1.55; margin: 0 0 28px 0; color: #ecf0f1;">
                            ${escapeHtml(dict.CASTLING_UNSAFE_CONFIRM_MSG)}
                        </p>
                        <div style="display: flex; justify-content: center; gap: 18px;">
                            <button type="button" id="btn-castle-warn-cancel" style="font-family: inherit; padding: 12px 32px; font-size: 19px; font-weight: bold; background: #7f8c8d; color: #fff; border: none; border-radius: 12px; cursor: pointer;">
                                ${escapeHtml(dict.BTN_CANCEL)}
                            </button>
                            <button type="button" id="btn-castle-warn-force" style="font-family: inherit; padding: 12px 32px; font-size: 19px; font-weight: bold; background: #e74c3c; color: #fff; border: 2px solid #fff; border-radius: 12px; cursor: pointer;">
                                🔺 ${escapeHtml(dict.BTN_FORCE_CASTLE)}
                            </button>
                        </div>
                    </div>
                </div>
            `;
            layer.querySelector('#btn-castle-warn-cancel')?.addEventListener('click', () => {
                this.pendingUnsafeCastleSide = null;
                this._renderModals(this.latestSnapshot);
            });
            layer.querySelector('#btn-castle-warn-force')?.addEventListener('click', () => {
                this.pendingUnsafeCastleSide = null;
                this._renderModals(this.latestSnapshot);
                this.onSendAction({
                    type: 'COMMIT_CASTLING',
                    side: sideToForce,
                    forceUnsafe: true
                });
            });
            return;
        }

        // 4. 드로우한 카드 [즉시 제출] / [손패 보관] 선택 모달
        if (isMyTurn && snapshot.phase === 'DRAWN_CARD_PROMPT' && snapshot.pendingDrawnCard) {
            const drawnCard = snapshot.pendingDrawnCard;
            const cardVisual = this._buildCardVisualHtml(drawnCard, { isCenterPile: true, lang });

            layer.style.pointerEvents = 'auto';
            layer.innerHTML = `
                <div style="width: 100%; height: 100%; background: rgba(0,0,0,0.65); display: flex; align-items: center; justify-content: center;">
                    <div style="width: 540px; background: #1a2238; border: 4px solid #00e5ff; border-radius: 24px; padding: 30px; text-align: center; display: flex; flex-direction: column; align-items: center;">
                        <h3 style="margin: 0 0 18px 0; font-size: 24px; color: #00e5ff;">${escapeHtml(dict.DRAWN_PROMPT_TITLE)}</h3>
                        <div style="margin-bottom: 22px;">${cardVisual}</div>
                        <div style="display: flex; gap: 16px;">
                            <button type="button" id="btn-drawn-play" style="font-family: inherit; padding: 12px 28px; font-size: 19px; font-weight: bold; background: #27ae60; color: #fff; border: none; border-radius: 12px; cursor: pointer;">
                                ⚡ ${escapeHtml(dict.BTN_PLAY_DRAWN)}
                            </button>
                            <button type="button" id="btn-drawn-keep" style="font-family: inherit; padding: 12px 28px; font-size: 19px; font-weight: bold; background: #34495e; color: #fff; border: none; border-radius: 12px; cursor: pointer;">
                                📥 ${escapeHtml(dict.BTN_KEEP_DRAWN)}
                            </button>
                        </div>
                    </div>
                </div>
            `;
            layer.querySelector('#btn-drawn-play')?.addEventListener('click', () => {
                if (drawnCard.kind === UNOS_CARD_KINDS.RESONANCE) {
                    this.pendingResonanceRequest = {
                        mode: 'RESOLVE_DRAWN_CARD',
                        cardId: drawnCard.id
                    };
                    this._renderModals(this.latestSnapshot);
                } else {
                    this.onSendAction({
                        type: 'RESOLVE_DRAWN_CARD',
                        decision: 'play'
                    });
                }
            });
            layer.querySelector('#btn-drawn-keep')?.addEventListener('click', () => {
                this.onSendAction({
                    type: 'RESOLVE_DRAWN_CARD',
                    decision: 'keep'
                });
            });
            return;
        }

        layer.style.pointerEvents = 'none';
        layer.innerHTML = '';
    }

    updateTimerDom(timeLeft) {
        const badge = this.container.querySelector('#unos-turn-timer-badge');
        if (!badge) return;
        const sec = Math.max(0, Math.round(Number(timeLeft) || 0));
        const snapshot = this.latestSnapshot;
        const curPlayer = (snapshot?.players || []).find(p => p.id === snapshot?.currentPlayerId) || null;
        if (!snapshot || snapshot.phase === 'TURN_ORDER' || snapshot.phase === 'GAME_OVER' || curPlayer?.type === 'ai') {
            badge.style.display = 'none';
            return;
        }
        const isWarn = sec <= UNOS_TURN_TIMER_CONFIG.WARN_THRESHOLD_SECONDS;
        badge.style.display = 'inline-block';
        badge.textContent = `⏱ ${sec}s`;
        badge.style.background = isWarn ? '#e74c3c' : 'rgba(241, 196, 15, 0.2)';
        badge.style.color = isWarn ? '#ffffff' : '#f1c40f';
        badge.style.border = isWarn ? '2px solid #ffffff' : '2px solid #f1c40f';
    }

    destroy() {
        if (this.toastTimer) clearTimeout(this.toastTimer);
        if (this.exitConfirmTimer) clearTimeout(this.exitConfirmTimer);
        if (typeof window !== 'undefined') {
            window.removeEventListener('pointermove', this._boundPointerMove);
            window.removeEventListener('pointerup', this._boundPointerUp);
        }
    }
}
