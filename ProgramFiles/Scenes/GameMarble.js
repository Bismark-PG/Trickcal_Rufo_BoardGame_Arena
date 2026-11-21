// ProgramFiles/Scenes/GameMarble.js
// 100% 순수 렌더링 및 입력 송신 전용 엘리아스 마블 클라이언트 씬
// 게임 규칙·턴·확률·AI 연산은 서버(MarbleServerSession) 또는 오프라인 로컬 엔진(MarbleEngine)이 전담

import { changeScene } from '../Main.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import { escapeHtml } from '../Lobby/LobbyUI.js';
import {
    createPlayerUI,
    createNpcUIList,
    createTurnIndicator,
    createDiceButton,
    computeDiceGaugePower,
    createDiceOverlay,
    createTurnOrderOverlay,
    createPopupOverlay,
    renderBoardState,
    showSettlementPopup,
    PopupManager,
    setActiveRenderWorld,
    applyTrackedBannerBg
} from '../Marble/MarbleUI.js';
import { pickLangDict, formatMoney, getTileName } from '../Marble/MarbleRuntime.js';
import { calculatePurchaseCost, getTileSellValue, findTileAtCanvasPoint } from '../Marble/MarbleLogic.js';
import { LangState } from '../System/LanguageManager.js';
import { MarbleLang } from '../System/Index/Marble/MarbleUIIndex.js';
import { CardUILang, formatCardDisplayTitle, getCardGradeTheme } from '../System/Index/Marble/MarbleCardUIIndex.js';
import { GimmickLang } from '../System/Index/Marble/MarbleGimmickIndex.js';
import { BOARD_TILES, resolveTileBgPath, getTileIntroDesc } from '../System/Index/Marble/MarbleBoardIndex.js';
import { GAME_CONSTANTS, BUILDING_COSTS, MULTIPLIERS, getModeConfig } from '../System/Index/Marble/MarblePriceIndex.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { getGameMeta } from '../System/GameRegistry.js';
import { ErrorTracker } from '../System/ErrorTracker.js';
import { getCachedMarbleImage, preloadMarbleAssets } from '../Marble/MarbleAssetLoader.js';

const DICE_NORMAL_PATH = './Resource/Texture/Marble/Dice/Dice_N_';
const DICE_ERPIN_PATH = './Resource/Texture/Marble/Dice/Dice_E_';

function getLeftDicePath(diceState) {
    return diceState?.useErpin ? DICE_ERPIN_PATH : DICE_NORMAL_PATH;
}

function applyDiceFrames(diceImg1, diceImg2, diceImg3, diceState, d1Val, d2Val) {
    if (diceImg1) diceImg1.src = `${getLeftDicePath(diceState)}${d1Val}.png`;
    if (diceState?.diceCount >= 2 && diceImg2) diceImg2.src = `${DICE_NORMAL_PATH}${d2Val}.png`;
    if (diceState?.useRufo && diceImg3) diceImg3.src = `${DICE_NORMAL_PATH}6.png`;
}

export function initMarble(container, sceneParams = null) {
    container.innerHTML = `
        <div style="width: 100%; height: 100%; position: relative; display: flex; justify-content: center; align-items: center; perspective: 1200px;">
            <div style="transform: translateY(25px);">
                <canvas id="game-canvas" width="1080" height="1080" style="width: 1320px; height: 1320px; flex-shrink: 0; border: 10px solid #fff; background-color: transparent; box-shadow: 30px 30px 50px rgba(0,0,0,0.2); transform: rotateX(60deg) rotateZ(45deg);"></canvas>
            </div>
            <div id="ui-players"></div>
            <div id="turn-ui-container"></div>
            <div id="dice-btn-container"></div>
            <button id="btn-exit-match" style="position: absolute; bottom: 145px; right: 40px; font-family: inherit; padding: 10px 18px; font-size: 18px; font-weight: bold; background: rgba(192, 57, 43, 0.85); color: #fff; border: 2px solid rgba(255,255,255,0.4); border-radius: 10px; cursor: pointer; z-index: 5;">나가기</button>
            ${createDiceOverlay()}
            ${createTurnOrderOverlay()}
            ${createPopupOverlay()}
            <div id="afk-warning-overlay" style="display: none; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.52); z-index: 9500; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.35s ease;">
                <div style="width: 600px; max-width: 90vw; background: #165b7a; border: 4px solid #f39c12; border-radius: 24px; padding: 38px 42px; box-shadow: 0 22px 52px rgba(0,0,0,0.6); color: #fff; text-align: center;">
                    <h2 id="afk-warn-title" style="margin: 0 0 18px 0; font-size: 32px; color: #f1c40f;"></h2>
                    <p id="afk-warn-desc" style="margin: 0 0 28px 0; font-size: 20px; line-height: 1.65; color: #ecf0f1; white-space: pre-line;"></p>
                    <button id="btn-afk-return" type="button" style="font-family: inherit; padding: 14px 48px; font-size: 22px; font-weight: bold; background: #27ae60; color: #fff; border: none; border-radius: 12px; cursor: pointer;"></button>
                </div>
            </div>
        </div>
    `;

    const canvas = container.querySelector('#game-canvas');
    const ctx = canvas.getContext('2d');
    const initialBoardMode = sceneParams?.room?.customOptions?.gameMode || 'ember';
    let loadedBoardSrc = getModeConfig(initialBoardMode).boardTexture || './Resource/Texture/Marble/Board_Mode_Ember.png';
    const boardImg = new Image();
    ErrorTracker.trackImage(boardImg, { critical: true, label: 'MarbleBoard' });
    const getActiveBoardImage = () => getCachedMarbleImage(loadedBoardSrc) || boardImg;
    if (!getCachedMarbleImage(loadedBoardSrc)) {
        boardImg.src = loadedBoardSrc;
    }
    preloadMarbleAssets();

    ['dice-img-1', 'dice-img-2', 'dice-img-3'].forEach((id) => {
        const dImg = container.querySelector(`#${id}`);
        if (dImg) ErrorTracker.trackImage(dImg, { critical: false, label: `MarbleDice:${id}` });
    });

    let isCleanedUp = false;
    let latestSnapshot = null;
    let activePromptKey = null;
    let diceAnimInterval = null;
    let isDiceSpinning = false;
    let turnOrderSpinInterval = null;
    let turnOrderSpinTimeout = null;
    let isTurnOrderSpinning = false;
    let settlementShown = false;
    let exitConfirmPending = false;
    let exitConfirmTimer = null;
    let isAfkWarnVisible = false;
    let isHandOpen = false;
    let selectedHandCard = null;
    let isTerritoryOpen = false;
    let selectedTerritoryId = null;
    let selectedTerritorySource = null;
    let isPeekingBoard = false;
    const peekSavedDisplay = new Map();
    let latestMainHudPlayer = null;
    let latestViewTiles = [];
    let latestCanActNow = false;
    let announcedTurnKey = null;

    let isHoldingDice = false;
    let diceHoldActive = false;
    let diceHoldStartTs = 0;
    let diceGaugeValue = GAME_CONSTANTS.DICE_GAUGE_DEFAULT_POWER ?? 50;
    let diceHoldThresholdTimer = null;
    let diceGaugeRafId = null;
    let lastPointerRollAt = 0;

    const detachDiceHoldWindowListeners = () => {
        if (typeof window === 'undefined') return;
        window.removeEventListener('pointerup', onDiceWindowPointerUp);
        window.removeEventListener('pointercancel', onDiceWindowCancel);
        window.removeEventListener('blur', onDiceWindowCancel);
    };

    const updateDiceGaugeDom = (power, active) => {
        const idleEl = document.getElementById('dice-gauge-idle');
        const wrapEl = document.getElementById('dice-gauge-wrap');
        const fillEl = document.getElementById('dice-gauge-fill');
        const pctEl = document.getElementById('dice-gauge-pct');
        if (idleEl) idleEl.style.display = active ? 'none' : (latestCanActNow ? 'flex' : 'none');
        if (wrapEl) wrapEl.style.display = active ? 'block' : 'none';
        if (fillEl) fillEl.style.width = `${power}%`;
        if (pctEl) pctEl.textContent = `${power}%`;
    };

    const cancelDiceHold = () => {
        isHoldingDice = false;
        diceHoldActive = false;
        if (diceHoldThresholdTimer) {
            clearTimeout(diceHoldThresholdTimer);
            diceHoldThresholdTimer = null;
        }
        if (diceGaugeRafId) {
            cancelAnimationFrame(diceGaugeRafId);
            diceGaugeRafId = null;
        }
        detachDiceHoldWindowListeners();
        updateDiceGaugeDom(0, false);
    };

    const tickDiceGauge = () => {
        if (!isHoldingDice || !diceHoldActive || !latestCanActNow || isCleanedUp) {
            cancelDiceHold();
            return;
        }
        const elapsed = performance.now() - diceHoldStartTs;
        diceGaugeValue = computeDiceGaugePower(elapsed, GAME_CONSTANTS.DICE_GAUGE_CYCLE_MS || 1200);
        updateDiceGaugeDom(diceGaugeValue, true);
        diceGaugeRafId = requestAnimationFrame(tickDiceGauge);
    };

    const commitDiceRoll = async (power) => {
        lastPointerRollAt = Date.now();
        const defPower = GAME_CONSTANTS.DICE_GAUGE_DEFAULT_POWER ?? 50;
        const parsedPower = (power === null || power === undefined || (typeof power === 'string' && power.trim() === ''))
            ? NaN
            : Number(power);
        const finalPower = Number.isFinite(parsedPower)
            ? Math.max(0, Math.min(100, Math.round(parsedPower)))
            : defPower;
        cancelDiceHold();
        const rollBtn = document.getElementById('btn-roll');
        if (rollBtn) rollBtn.disabled = true;
        ErrorTracker.addBreadcrumb('GAME', `Marble roll dice (T${latestSnapshot?.world?.currentTurn || 1}, P${finalPower})`);
        closeHandPopups();
        closeTerritoryPopups();
        setBoardPeek(false);
        syncBoardPeekUi(latestSnapshot);
        const res = await RoomManager.sendGameAction({ type: 'ROLL_DICE', power: finalPower });
        if (!res?.ok && !isCleanedUp && latestSnapshot) {
            renderSnapshot(latestSnapshot);
        }
    };

    function onDiceWindowPointerUp() {
        if (!isHoldingDice) return;
        const powerToSend = diceHoldActive
            ? diceGaugeValue
            : (GAME_CONSTANTS.DICE_GAUGE_DEFAULT_POWER ?? 50);
        commitDiceRoll(powerToSend);
    }

    function onDiceWindowCancel() {
        if (!isHoldingDice) return;
        cancelDiceHold();
    }

    const PEEK_TARGET_IDS = [
        'event-popup',
        'portal-popup',
        'sell-popup',
        'target-popup',
        'void-game-popup',
        'hand-popup',
        'hand-detail-popup',
        'territory-popup',
        'territory-detail-popup'
    ];

    const getTileBuyPrice = (tile) => {
        if (!tile) return 0;
        if (tile.id === BOARD_TILES.THEATER) return GAME_CONSTANTS.THEATER_BUY;
        if (tile.id === BOARD_TILES.MONATIUM_25) return GAME_CONSTANTS.MONATIUM_BUY;
        if (tile.id === BOARD_TILES.LAKE) return GAME_CONSTANTS.LAKE_BUY;
        if (tile.id === BOARD_TILES.LIBRARY) return GAME_CONSTANTS.LIBRARY_BUY;
        if (tile.id === BOARD_TILES.DAYA) return GAME_CONSTANTS.DAYA_BUY;
        return Number(tile.basePrice || 0);
    };

    const isSpecialTerritoryTile = (tile) => (
        tile.id === BOARD_TILES.THEATER
        || tile.id === BOARD_TILES.MONATIUM_25
        || tile.id === BOARD_TILES.LAKE
        || tile.id === BOARD_TILES.LIBRARY
        || tile.id === BOARD_TILES.DAYA
    );

    const getTileBaseOneX = (tile) => {
        if (!tile || tile.level < 0) return 0;
        if (tile.id === BOARD_TILES.THEATER) return 0;
        if (tile.id === BOARD_TILES.MONATIUM_25) {
            if (tile.level === 1) return GAME_CONSTANTS.TOLL_MONATIUM_1;
            if (tile.level >= 2) return GAME_CONSTANTS.TOLL_MONATIUM_2;
            return GAME_CONSTANTS.TOLL_MONATIUM_0;
        }
        if (tile.id === BOARD_TILES.LAKE) return GAME_CONSTANTS.TOLL_LAKE;
        if (tile.id === BOARD_TILES.LIBRARY) return GAME_CONSTANTS.TOLL_LIBRARY;
        if (tile.id === BOARD_TILES.DAYA) return GAME_CONSTANTS.TOLL_DAYA;
        const baseCost = tile.level === 0 ? Number(tile.basePrice || 0) : (BUILDING_COSTS[tile.side]?.[tile.level - 1] || 0);
        const mult = MULTIPLIERS.BUILDING[tile.level] ?? 0;
        return Math.round(baseCost * mult);
    };

    const getTileLevelText = (tile, mText) => {
        if (!tile || tile.level < 0) return '';
        if (tile.id === BOARD_TILES.MONATIUM_25) {
            if (tile.level >= 2) return '2단계 확장';
            if (tile.level === 1) return '1단계 확장';
            return '기본';
        }
        if (isSpecialTerritoryTile(tile)) return '특수 영토';
        const labels = [mText.BLD_0, mText.BLD_1, mText.BLD_2, mText.BLD_3, mText.BLD_4];
        return labels[tile.level] || mText.BLD_0;
    };

    const getTileUpgradeRows = (tile, mText) => {
        if (!tile || tile.level < 0) return [];
        const rows = [];
        let cumCost = 0;
        if (tile.id === BOARD_TILES.MONATIUM_25) {
            if (tile.level < 1) {
                cumCost += GAME_CONSTANTS.MONATIUM_EXPAND_1;
                rows.push({ label: '1단계 확장', stepCost: GAME_CONSTANTS.MONATIUM_EXPAND_1, cumCost });
            }
            if (tile.level < 2) {
                cumCost += GAME_CONSTANTS.MONATIUM_EXPAND_2;
                rows.push({ label: '2단계 확장', stepCost: GAME_CONSTANTS.MONATIUM_EXPAND_2, cumCost });
            }
            return rows;
        }
        if (isSpecialTerritoryTile(tile)) return [];
        const labels = [mText.BLD_0, mText.BLD_1, mText.BLD_2, mText.BLD_3, mText.BLD_4];
        for (let cur = tile.level; cur < 4; cur++) {
            const nextLevel = cur + 1;
            const stepCost = calculatePurchaseCost({ ...tile, level: cur }, nextLevel, null, { ignoreSoot: true });
            cumCost += stepCost;
            rows.push({ label: labels[nextLevel] || `${nextLevel}단계`, stepCost, cumCost });
        }
        return rows;
    };

    const setBoardPeek = (nextPeek) => {
        if (nextPeek === isPeekingBoard) return;
        if (nextPeek) {
            peekSavedDisplay.clear();
            PEEK_TARGET_IDS.forEach((id) => {
                const el = document.getElementById(id);
                if (el && el.style.display && el.style.display !== 'none') {
                    peekSavedDisplay.set(id, el.style.display);
                    el.style.display = 'none';
                }
            });
            isPeekingBoard = true;
        } else {
            isPeekingBoard = false;
            peekSavedDisplay.forEach((disp, id) => {
                const el = document.getElementById(id);
                if (el) el.style.display = disp;
            });
            peekSavedDisplay.clear();
        }
    };

    const syncBoardPeekUi = (snapshot = latestSnapshot) => {
        const bar = document.getElementById('board-peek-container');
        const btn = document.getElementById('btn-board-peek');
        if (!bar || !btn) return;
        const isBlockingScene = !snapshot || snapshot.phase === 'GAME_OVER' || Boolean(snapshot.afkAutoAlert);
        const hasAnyOverlay = isHandOpen || isTerritoryOpen || selectedTerritoryId !== null || Boolean(snapshot?.pendingPrompt);
        if (isBlockingScene || !hasAnyOverlay) {
            if (isPeekingBoard) {
                isPeekingBoard = false;
                peekSavedDisplay.clear();
            }
            bar.style.display = 'none';
            return;
        }

        const mText = pickLangDict(MarbleLang, LangState.current);
        bar.style.display = 'block';
        if (isPeekingBoard) {
            if (isHandOpen) btn.innerText = mText.BTN_RESUME_HAND || '손패마저보기';
            else if (isTerritoryOpen) btn.innerText = mText.BTN_RESUME_TERRITORY || '보유영토 보기';
            else btn.innerText = mText.BTN_RESUME_UI || 'UI 다시보기';
        } else {
            btn.innerText = mText.BTN_BOARD_PEEK || '보드판 보기';
        }
    };

    const closeHandPopups = () => {
        isHandOpen = false;
        selectedHandCard = null;
        const p = document.getElementById('hand-popup');
        const d = document.getElementById('hand-detail-popup');
        if (p) p.style.display = 'none';
        if (d) d.style.display = 'none';
        peekSavedDisplay.delete('hand-popup');
        peekSavedDisplay.delete('hand-detail-popup');
    };

    const closeTerritoryPopups = () => {
        isTerritoryOpen = false;
        selectedTerritoryId = null;
        selectedTerritorySource = null;
        const p = document.getElementById('territory-popup');
        const d = document.getElementById('territory-detail-popup');
        if (p) p.style.display = 'none';
        if (d) d.style.display = 'none';
        peekSavedDisplay.delete('territory-popup');
        peekSavedDisplay.delete('territory-detail-popup');
    };

    const findMatchingHandCard = (mainHudPlayer, target) => {
        if (!mainHudPlayer || !target) return null;
        const listsBySub = {
            use: mainHudPlayer.inventory || [],
            hold: mainHudPlayer.holdCards || [],
            treasure: mainHudPlayer.treasureCards || []
        };
        const list = listsBySub[target.subType] || [];
        return list.find(c => c.id === target.id && c.index === target.index)
            || list.find(c => c.id === target.id)
            || null;
    };

    const renderHandDetailPopup = (snapshot, mainHudPlayer, canActNow) => {
        const detailEl = document.getElementById('hand-detail-popup');
        if (!detailEl) return;
        if (!isHandOpen || !selectedHandCard) {
            detailEl.style.display = 'none';
            peekSavedDisplay.delete('hand-detail-popup');
            return;
        }
        const card = findMatchingHandCard(mainHudPlayer, selectedHandCard);
        if (!card) {
            selectedHandCard = null;
            detailEl.style.display = 'none';
            peekSavedDisplay.delete('hand-detail-popup');
            return;
        }
        const cText = pickLangDict(CardUILang, LangState.current);
        const badgeEl = document.getElementById('hand-detail-badge');
        const titleEl = document.getElementById('hand-detail-title');
        const descEl = document.getElementById('hand-detail-desc');
        const statusEl = document.getElementById('hand-detail-status');
        const actionsEl = document.getElementById('hand-detail-actions');
        const useBtn = document.getElementById('hand-detail-use-btn');

        const theme = getCardGradeTheme(card);
        if (badgeEl) {
            badgeEl.innerText = `${theme.label} · ${cText[`INV_SEC_${card.subType === 'hold' ? 'HOLD' : (card.subType === 'treasure' ? 'TREASURE' : 'USE')}`] || (card.subType === 'treasure' ? '보물 카드' : (card.subType === 'hold' ? '보유형 카드' : '사용형 카드'))}`;
            badgeEl.style.background = theme.buttonBg;
            badgeEl.style.color = '#fff';
        }
        detailEl.style.borderColor = theme.accent;
        if (titleEl) {
            const usesSuffix = (card.subType === 'treasure' && card.maxUses > 0)
                ? ` (${cText.TREASURE_USES_LEFT || '남은 횟수:'} ${card.remainingUses}/${card.maxUses})`
                : '';
            titleEl.innerText = `${formatCardDisplayTitle(card)}${usesSuffix}`;
            titleEl.style.color = theme.accent;
        }
        if (descEl) descEl.innerText = card.desc || '';

        const isHold = card.subType === 'hold';
        if (isHold) {
            if (statusEl) {
                statusEl.innerText = cText.INV_HOLD_ACTIVE || '보유 효과 상시 적용 중';
                statusEl.style.color = '#74b9ff';
            }
            if (actionsEl) actionsEl.style.display = 'none';
        } else {
            const isMyUsableWindow = Boolean(canActNow && !snapshot?.pendingPrompt && !isDiceSpinning);
            const canClickUse = isMyUsableWindow && Boolean(card.canUseNow);
            if (actionsEl) actionsEl.style.display = 'flex';
            if (statusEl) {
                if (canClickUse) {
                    statusEl.innerText = '';
                } else if (!isMyUsableWindow) {
                    statusEl.innerText = cText.INV_NOT_MY_TURN || '내 턴에만 사용할 수 있습니다.';
                    statusEl.style.color = '#f39c12';
                } else {
                    statusEl.innerText = cText.CANT_USE_NOW || '현재 사용할 수 없습니다.';
                    statusEl.style.color = '#e74c3c';
                }
            }
            if (useBtn) {
                useBtn.innerText = cText.BTN_USE || '사용하기';
                useBtn.disabled = !canClickUse;
                useBtn.style.background = canClickUse ? '#2ecc71' : '#7f8c8d';
                useBtn.style.cursor = canClickUse ? 'pointer' : 'not-allowed';
                useBtn.onclick = canClickUse ? async () => {
                    useBtn.disabled = true;
                    closeHandPopups();
                    setBoardPeek(false);
                    syncBoardPeekUi(latestSnapshot);
                    const res = await RoomManager.sendGameAction({
                        type: 'USE_INVENTORY_CARD',
                        cardId: card.id,
                        cardIndex: card.index
                    });
                    if (!res?.ok && !isCleanedUp) {
                        renderSnapshot(latestSnapshot);
                    }
                } : null;
            }
        }

        if (isPeekingBoard) {
            detailEl.style.display = 'none';
            peekSavedDisplay.set('hand-detail-popup', 'block');
        } else {
            detailEl.style.display = 'block';
        }
    };

    const renderHandPopup = (snapshot, mainHudPlayer, canActNow) => {
        const popupEl = document.getElementById('hand-popup');
        if (!popupEl) return;
        if (!isHandOpen || !mainHudPlayer) {
            popupEl.style.display = 'none';
            const dEl = document.getElementById('hand-detail-popup');
            if (dEl) dEl.style.display = 'none';
            peekSavedDisplay.delete('hand-popup');
            peekSavedDisplay.delete('hand-detail-popup');
            return;
        }

        const cText = pickLangDict(CardUILang, LangState.current);
        const modeCfg = getModeConfig(snapshot?.world?.gameMode);
        const titleEl = document.getElementById('hand-title');
        const descEl = document.getElementById('hand-desc');
        const listEl = document.getElementById('hand-list');
        if (titleEl) titleEl.innerText = cText.INV_TITLE || '인벤토리 (손패)';
        if (descEl) descEl.innerText = cText.INV_DESC || '';

        const sortBySeq = (arr) => (arr || []).slice().sort((a, b) => (a.acquiredSeq ?? a.index ?? 0) - (b.acquiredSeq ?? b.index ?? 0));
        const sections = [
            { key: 'use', title: cText.INV_SEC_USE || '사용형 카드', color: '#c084fc', items: sortBySeq(mainHudPlayer.inventory) },
            { key: 'hold', title: cText.INV_SEC_HOLD || '보유형 카드', color: '#74b9ff', items: sortBySeq(mainHudPlayer.holdCards) }
        ];
        if (modeCfg.enableTreasureAndRequiem) {
            sections.push({ key: 'treasure', title: cText.INV_SEC_TREASURE || '보물 카드', color: '#f39c12', items: sortBySeq(mainHudPlayer.treasureCards) });
        }

        const nonEmptySections = sections.filter(sec => sec.items.length > 0);
        if (listEl) {
            listEl.innerHTML = '';
            if (nonEmptySections.length === 0) {
                const emptyBox = document.createElement('div');
                emptyBox.style.cssText = 'padding: 36px 16px; text-align: center; font-size: 20px; color: #cbd5e1; background: rgba(255,255,255,0.05); border-radius: 12px;';
                emptyBox.innerText = cText.INV_EMPTY || '손패에 아무것도 없어요!';
                listEl.appendChild(emptyBox);
            } else {
                const isMyWindow = Boolean(canActNow && !snapshot?.pendingPrompt && !isDiceSpinning);
                nonEmptySections.forEach((sec) => {
                    const secWrap = document.createElement('div');
                    secWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
                    const header = document.createElement('div');
                    header.style.cssText = `font-size: 16px; font-weight: bold; color: ${sec.color}; border-bottom: 1px solid rgba(255,255,255,0.14); padding-bottom: 4px;`;
                    header.innerText = `${sec.title} (${sec.items.length})`;
                    secWrap.appendChild(header);

                    sec.items.forEach((card) => {
                        const theme = getCardGradeTheme(card);
                        const rowBtn = document.createElement('button');
                        rowBtn.type = 'button';
                        const usableTag = card.subType === 'hold'
                            ? `<span style="font-size: 12px; padding: 3px 8px; border-radius: 6px; background: ${theme.badgeBg}; color: ${theme.badgeText};">보유중</span>`
                            : (isMyWindow && card.canUseNow
                                ? `<span style="font-size: 12px; padding: 3px 8px; border-radius: 6px; background: rgba(46, 204, 113, 0.28); color: #2ecc71;">사용 가능</span>`
                                : (card.subType === 'treasure' && card.maxUses > 0
                                    ? `<span style="font-size: 12px; padding: 3px 8px; border-radius: 6px; background: ${theme.badgeBg}; color: ${theme.badgeText};">${card.remainingUses}/${card.maxUses}</span>`
                                    : `<span style="font-size: 12px; padding: 3px 8px; border-radius: 6px; background: ${theme.badgeBg}; color: ${theme.badgeText};">상세보기</span>`));
                        rowBtn.style.cssText = `font-family: inherit; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: ${theme.cardBg}; border: 1.5px solid ${theme.border}; border-radius: 10px; color: #fff; cursor: pointer; text-align: left;`;
                        rowBtn.innerHTML = `<span style="font-size: 18px; font-weight: bold; color: ${theme.accent};">${escapeHtml(formatCardDisplayTitle(card))}</span>${usableTag}`;
                        rowBtn.onclick = () => {
                            selectedHandCard = { id: card.id, index: card.index, subType: card.subType };
                            renderHandDetailPopup(latestSnapshot, latestMainHudPlayer, latestCanActNow);
                            syncBoardPeekUi(latestSnapshot);
                        };
                        secWrap.appendChild(rowBtn);
                    });
                    listEl.appendChild(secWrap);
                });
            }
        }

        if (isPeekingBoard) {
            popupEl.style.display = 'none';
            peekSavedDisplay.set('hand-popup', 'block');
        } else {
            popupEl.style.display = 'block';
        }
        renderHandDetailPopup(snapshot, mainHudPlayer, canActNow);
    };

    const renderTerritoryDetailPopup = (snapshot, viewTiles, mainHudPlayer) => {
        const detailEl = document.getElementById('territory-detail-popup');
        if (!detailEl) return;
        const canShowOwned = isTerritoryOpen && selectedTerritorySource === 'owned' && mainHudPlayer;
        const canShowBoard = selectedTerritorySource === 'board' || selectedTerritorySource === 'portal_confirm';
        if (selectedTerritoryId === null || (!canShowOwned && !canShowBoard)) {
            detailEl.style.display = 'none';
            peekSavedDisplay.delete('territory-detail-popup');
            return;
        }
        const tile = (viewTiles || []).find(t => (
            t.id === selectedTerritoryId
            && !t.isDisabled
            && t.type !== 'disabled'
            && (!canShowOwned || t.ownerId === mainHudPlayer.id)
        ));
        if (!tile) {
            selectedTerritoryId = null;
            selectedTerritorySource = null;
            detailEl.style.display = 'none';
            peekSavedDisplay.delete('territory-detail-popup');
            return;
        }

        const mText = pickLangDict(MarbleLang, LangState.current);
        const gText = pickLangDict(GimmickLang, LangState.current);
        const bannerEl = document.getElementById('territory-detail-bg-banner');
        const titleEl = document.getElementById('territory-detail-title');
        const descEl = document.getElementById('territory-detail-desc');
        const metaEl = document.getElementById('territory-detail-meta');
        const statsEl = document.getElementById('territory-detail-stats');
        const upgEl = document.getElementById('territory-detail-upgrades');
        const portalConfirmEl = document.getElementById('territory-detail-portal-confirm');
        const portalQEl = document.getElementById('territory-detail-portal-question');
        const portalYesBtn = document.getElementById('territory-detail-portal-yes');
        const portalNoBtn = document.getElementById('territory-detail-portal-no');

        const tileName = getTileName(tile, snapshot?.world);
        const bgPath = resolveTileBgPath(tile, snapshot?.world, mainHudPlayer, { isArrival: false });
        applyTrackedBannerBg(bannerEl, bgPath);

        if (titleEl) titleEl.innerText = tileName;
        if (descEl) {
            if (canShowOwned) {
                descEl.style.display = 'none';
            } else {
                descEl.style.display = 'block';
                descEl.innerText = getTileIntroDesc(tileName);
            }
        }

        const isBuyable = tile.type === 'normal' || tile.type === 'special_buy';
        const ownerPlayer = tile.owner || (tile.ownerId ? (snapshot?.players || []).find(p => p.id === tile.ownerId) : null);

        if (metaEl) {
            const timeBadge = tile.timeType === 'day'
                ? `<span style="color: #f39c12; font-weight: bold;">[${gText.TILE_TIME_DAY || '낮'}]</span> `
                : (tile.timeType === 'night' ? `<span style="color: #9b59b6; font-weight: bold;">[${gText.TILE_TIME_NIGHT || '밤'}]</span> ` : '');
            if (canShowOwned) {
                metaEl.innerHTML = `${timeBadge}현재 단계: <b>${escapeHtml(getTileLevelText(tile, mText))}</b> · 매입가: ${escapeHtml(formatMoney(getTileBuyPrice(tile)))}`;
            } else if (isBuyable) {
                const ownerBadge = ownerPlayer
                    ? `<span style="color: ${ownerPlayer.color || '#fff'}; font-weight: bold;">${escapeHtml(ownerPlayer.name)}</span>`
                    : `<span style="color: #94a3b8;">미소유</span>`;
                const levelLabel = tile.level >= 0 ? getTileLevelText(tile, mText) : '미건설 (빈 땅)';
                metaEl.innerHTML = `${timeBadge}소유주: ${ownerBadge} · 건물: <b>${escapeHtml(levelLabel)}</b>`;
            } else {
                const kindLabel = tile.type === 'card' ? '차원 열쇠 카드 칸' : '특수 이벤트 칸';
                metaEl.innerHTML = `${timeBadge}<span style="color: #74b9ff; font-weight: bold;">${escapeHtml(kindLabel)}</span> · 보드 #${tile.id}`;
            }
        }

        if (statsEl) {
            if (canShowOwned) {
                const oneXToll = getTileBaseOneX(tile);
                const appliedToll = Number.isFinite(tile.currentToll) ? tile.currentToll : oneXToll;
                const canSell = !isSpecialTerritoryTile(tile) && tile.level >= 0;
                const sellStr = canSell ? formatMoney(getTileSellValue(tile)) : '매각 불가';
                statsEl.style.display = 'flex';
                statsEl.innerHTML = `
                    <div style="display:flex; justify-content:space-between;"><span>1배수 기본 통행료</span><strong style="color:#f1c40f;">${escapeHtml(formatMoney(oneXToll))}</strong></div>
                    <div style="display:flex; justify-content:space-between;"><span>현재 통행료 (적용 버프 반영)</span><strong style="color:#ff9f43;">${escapeHtml(formatMoney(appliedToll))}</strong></div>
                    <div style="display:flex; justify-content:space-between;"><span>매각 가격</span><strong style="color:#2ecc71;">${escapeHtml(sellStr)}</strong></div>
                `;
            } else if (isBuyable) {
                const oneXToll = tile.level >= 0 ? getTileBaseOneX(tile) : 0;
                const currentToll = tile.level >= 0
                    ? (Number.isFinite(tile.viewerToll) ? tile.viewerToll : (Number.isFinite(tile.currentToll) ? tile.currentToll : oneXToll))
                    : 0;
                const dayaRow = tile.id === BOARD_TILES.DAYA
                    ? `<div style="display:flex; justify-content:space-between;"><span>인수 비용</span><strong style="color:#e84393;">${escapeHtml(formatMoney(GAME_CONSTANTS.DAYA_TAKE))}</strong></div>`
                    : '';
                statsEl.style.display = 'flex';
                statsEl.innerHTML = `
                    <div style="display:flex; justify-content:space-between;"><span>1배수 기본 통행료</span><strong style="color:#f1c40f;">${escapeHtml(formatMoney(oneXToll))}</strong></div>
                    <div style="display:flex; justify-content:space-between;"><span>현재 통행료</span><strong style="color:#ff9f43;">${escapeHtml(formatMoney(currentToll))}</strong></div>
                    ${dayaRow}
                `;
            } else if (tile.id === BOARD_TILES.MOUNTAIN) {
                const disciple = (snapshot?.players || []).find(p => p.hasMountainBuff);
                const mountainText = disciple
                    ? `${disciple.name}님이 현자의 가르침을 받고 있습니다.`
                    : '현재 가르침을 받고 있는 플레이어가 없습니다.';
                statsEl.style.display = 'flex';
                statsEl.innerHTML = `<div style="display:flex; justify-content:space-between; gap:12px;"><span>정령산 제자</span><strong style="color:#1abc9c;">${escapeHtml(mountainText)}</strong></div>`;
            } else if (tile.id === BOARD_TILES.ALTAR) {
                const altarStatus = mainHudPlayer?.hasVisitedAltar ? '포탈 개방 완료 (다음 도착 시 특수 보물 이동)' : '미방문 (최초 도착 시 보물 확률 해금)';
                statsEl.style.display = 'flex';
                statsEl.innerHTML = `<div style="display:flex; justify-content:space-between;"><span>제단 상태</span><strong style="color:#f1c40f;">${escapeHtml(altarStatus)}</strong></div>`;
            } else {
                statsEl.style.display = 'none';
                statsEl.innerHTML = '';
            }
        }

        if (upgEl) {
            if (!canShowOwned) {
                upgEl.style.display = 'none';
                upgEl.innerHTML = '';
            } else {
                upgEl.style.display = 'flex';
                const rows = getTileUpgradeRows(tile, mText);
                if (rows.length === 0) {
                    upgEl.innerHTML = `<div style="padding: 10px 12px; background: rgba(255,255,255,0.05); border-radius: 10px; color: #94a3b8; text-align: center;">${isSpecialTerritoryTile(tile) && tile.id !== BOARD_TILES.MONATIUM_25 ? '추가 증축 없음' : '최고 단계 건설 완료'}</div>`;
                } else {
                    const headerHtml = `<div style="font-size: 14px; font-weight: bold; color: #74b9ff; margin-bottom: 2px;">다음 단계별 증축 비용</div>`;
                    const rowsHtml = rows.map(r => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding: 7px 10px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                            <span>${escapeHtml(r.label)}</span>
                            <span style="color:#e2e8f0;">단계 <b>${escapeHtml(formatMoney(r.stepCost))}</b> <span style="color:#94a3b8;">(누적 ${escapeHtml(formatMoney(r.cumCost))})</span></span>
                        </div>
                    `).join('');
                    upgEl.innerHTML = headerHtml + rowsHtml;
                }
            }
        }

        if (portalConfirmEl) {
            const activePrompt = snapshot?.pendingPrompt;
            if (selectedTerritorySource === 'portal_confirm' && activePrompt?.kind === 'PORTAL') {
                const feeStr = activePrompt.isFree ? mText.PORTAL_FREE : formatMoney(activePrompt.reqFee || 0);
                if (portalQEl) {
                    portalQEl.innerText = `${mText.PORTAL_CONFIRM_MOVE || '이 칸으로 이동하시겠습니까?'} (${mText.PORTAL_FEE_LABEL || '이용료:'} ${feeStr})`;
                }
                if (portalYesBtn) {
                    portalYesBtn.innerText = mText.PORTAL_CONFIRM_YES || '예';
                    portalYesBtn.onclick = async () => {
                        selectedTerritoryId = null;
                        selectedTerritorySource = null;
                        detailEl.style.display = 'none';
                        peekSavedDisplay.delete('territory-detail-popup');
                        await RoomManager.sendGameAction({
                            type: 'PROMPT_RESPOND',
                            promptId: activePrompt.promptId,
                            tileId: tile.id
                        });
                    };
                }
                if (portalNoBtn) {
                    portalNoBtn.innerText = mText.PORTAL_CONFIRM_NO || '아니요';
                    portalNoBtn.onclick = () => {
                        selectedTerritoryId = null;
                        selectedTerritorySource = null;
                        detailEl.style.display = 'none';
                        peekSavedDisplay.delete('territory-detail-popup');
                        syncBoardPeekUi(latestSnapshot);
                    };
                }
                portalConfirmEl.style.display = 'block';
            } else {
                portalConfirmEl.style.display = 'none';
            }
        }

        if (isPeekingBoard) {
            detailEl.style.display = 'none';
            peekSavedDisplay.set('territory-detail-popup', 'block');
        } else {
            detailEl.style.display = 'block';
        }
    };

    const renderTerritoryPopup = (snapshot, viewTiles, mainHudPlayer) => {
        const popupEl = document.getElementById('territory-popup');
        if (!popupEl) return;
        if (!isTerritoryOpen || !mainHudPlayer) {
            popupEl.style.display = 'none';
            peekSavedDisplay.delete('territory-popup');
            if ((selectedTerritorySource === 'board' || selectedTerritorySource === 'portal_confirm') && selectedTerritoryId !== null) {
                renderTerritoryDetailPopup(snapshot, viewTiles, mainHudPlayer);
            } else {
                const dEl = document.getElementById('territory-detail-popup');
                if (dEl) dEl.style.display = 'none';
                peekSavedDisplay.delete('territory-detail-popup');
            }
            return;
        }

        const mText = pickLangDict(MarbleLang, LangState.current);
        const gText = pickLangDict(GimmickLang, LangState.current);
        const titleEl = document.getElementById('territory-title');
        const listEl = document.getElementById('territory-list');
        if (titleEl) titleEl.innerText = mText.TERRITORY_TITLE || '보유 영토 목록';

        const ownedTiles = (viewTiles || []).filter(t => t.ownerId === mainHudPlayer.id);
        if (listEl) {
            listEl.innerHTML = '';
            if (ownedTiles.length === 0) {
                const emptyBox = document.createElement('div');
                emptyBox.style.cssText = 'padding: 36px 16px; text-align: center; font-size: 20px; color: #cbd5e1; background: rgba(255,255,255,0.05); border-radius: 12px;';
                emptyBox.innerText = mText.TERRITORY_EMPTY || '점령한 영토가 없어요!';
                listEl.appendChild(emptyBox);
            } else {
                ownedTiles.forEach((tile) => {
                    const rowBtn = document.createElement('button');
                    rowBtn.type = 'button';
                    const timeBadge = tile.timeType === 'day'
                        ? `<span style="font-size: 12px; padding: 2px 7px; border-radius: 5px; background: rgba(243,156,18,0.22); color: #f5b041;">${gText.TILE_TIME_DAY || '낮'}</span>`
                        : (tile.timeType === 'night'
                            ? `<span style="font-size: 12px; padding: 2px 7px; border-radius: 5px; background: rgba(142,68,173,0.28); color: #d2b4de;">${gText.TILE_TIME_NIGHT || '밤'}</span>`
                            : '');
                    const levelStr = getTileLevelText(tile, mText);
                    const buyStr = formatMoney(getTileBuyPrice(tile));
                    rowBtn.style.cssText = 'font-family: inherit; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; color: #fff; cursor: pointer; text-align: left;';
                    rowBtn.innerHTML = `
                        <div style="display:flex; align-items:center; gap:8px;">
                            ${timeBadge}
                            <span style="font-size: 18px; font-weight: bold;">${escapeHtml(getTileName(tile, snapshot?.world))}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:12px; font-size: 15px; color: #cbd5e1;">
                            <span>매입가 ${escapeHtml(buyStr)}</span>
                            <span style="padding: 3px 9px; border-radius: 6px; background: rgba(52,152,219,0.25); color: #74b9ff; font-weight: bold;">${escapeHtml(levelStr)}</span>
                        </div>
                    `;
                    rowBtn.onclick = () => {
                        selectedTerritoryId = tile.id;
                        selectedTerritorySource = 'owned';
                        renderTerritoryDetailPopup(latestSnapshot, latestViewTiles, latestMainHudPlayer);
                        syncBoardPeekUi(latestSnapshot);
                    };
                    listEl.appendChild(rowBtn);
                });
            }
        }

        if (isPeekingBoard) {
            popupEl.style.display = 'none';
            peekSavedDisplay.set('territory-popup', 'block');
        } else {
            popupEl.style.display = 'block';
        }
        renderTerritoryDetailPopup(snapshot, viewTiles, mainHudPlayer);
    };

    const syncAfkWarningOverlay = (snapshot) => {
        const overlay = container.querySelector('#afk-warning-overlay');
        if (!overlay) return;
        const shouldShow = Boolean(snapshot?.afkAutoAlert) && snapshot?.phase !== 'GAME_OVER';
        if (!shouldShow) {
            isAfkWarnVisible = false;
            overlay.style.opacity = '0';
            overlay.style.display = 'none';
            return;
        }

        const mText = pickLangDict(MarbleLang, LangState.current);
        const titleEl = container.querySelector('#afk-warn-title');
        const descEl = container.querySelector('#afk-warn-desc');
        const btnEl = container.querySelector('#btn-afk-return');
        if (titleEl) titleEl.innerText = mText.AFK_WARN_TITLE || '';
        if (descEl) descEl.innerText = mText.AFK_WARN_DESC || '';
        if (btnEl) {
            btnEl.innerText = mText.AFK_WARN_BTN || '확인';
            btnEl.disabled = false;
            btnEl.onclick = async () => {
                btnEl.disabled = true;
                const res = await RoomManager.sendGameAction({ type: 'AFK_RETURN' });
                if (!res?.ok && !isCleanedUp) {
                    btnEl.disabled = false;
                }
            };
        }

        if (!isAfkWarnVisible) {
            isAfkWarnVisible = true;
            overlay.style.display = 'flex';
            overlay.style.opacity = '0';
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => {
                    if (!isCleanedUp && isAfkWarnVisible) overlay.style.opacity = '1';
                });
            } else {
                overlay.style.opacity = '1';
            }
        }
    };

    const stopDiceAnimation = () => {
        if (diceAnimInterval) {
            clearInterval(diceAnimInterval);
            diceAnimInterval = null;
        }
        isDiceSpinning = false;
    };

    const stopTurnOrderSpin = () => {
        if (turnOrderSpinInterval) {
            clearInterval(turnOrderSpinInterval);
            turnOrderSpinInterval = null;
        }
        if (turnOrderSpinTimeout) {
            clearTimeout(turnOrderSpinTimeout);
            turnOrderSpinTimeout = null;
        }
        isTurnOrderSpinning = false;
    };

    const startTurnOrderSpin = () => {
        stopTurnOrderSpin();
        isTurnOrderSpinning = true;
        const spinTick = () => {
            const d1El = document.getElementById('turn-order-my-d1');
            const d2El = document.getElementById('turn-order-my-d2');
            const r1 = Math.floor(Math.random() * 6) + 1;
            const r2 = Math.floor(Math.random() * 6) + 1;
            if (d1El) {
                d1El.src = `${DICE_NORMAL_PATH}${r1}.png`;
                d1El.style.opacity = '1';
                d1El.style.transform = `rotate(${(Math.random() * 18 - 9).toFixed(1)}deg) scale(1.06)`;
            }
            if (d2El) {
                d2El.src = `${DICE_NORMAL_PATH}${r2}.png`;
                d2El.style.opacity = '1';
                d2El.style.transform = `rotate(${(Math.random() * 18 - 9).toFixed(1)}deg) scale(1.06)`;
            }
        };
        spinTick();
        turnOrderSpinInterval = setInterval(spinTick, 65);
        turnOrderSpinTimeout = setTimeout(() => {
            stopTurnOrderSpin();
            if (!isCleanedUp && latestSnapshot) {
                syncTurnOrderOverlay(latestSnapshot);
            }
        }, 600);
    };

    const updateTimerDom = (timeLeft) => {
        if (isCleanedUp) return;
        const currentText = pickLangDict(MarbleLang, LangState.current);
        const safeSec = Math.max(0, Number(timeLeft) || 0);
        const timeStr = `${currentText.REMAIN_TIME} ${safeSec}${currentText.SEC}`;
        const isNormalAlert = Boolean(latestSnapshot?.pendingPrompt?.kind === 'NORMAL' && latestSnapshot?.pendingPrompt?.showCloseBtn);
        ['turn-timer', 'event-timer', 'portal-timer', 'target-timer', 'void-timer', 'portal-hint-timer'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (id === 'event-timer' && isNormalAlert) {
                el.style.display = 'none';
                return;
            }
            el.innerText = timeStr;
        });
        const closeBtn = document.getElementById('close-btn');
        if (closeBtn && closeBtn.parentElement && closeBtn.parentElement.style.display !== 'none') {
            const baseLabel = closeBtn.dataset.baseLabel || currentText.CLOSE;
            closeBtn.innerText = `${baseLabel} (${safeSec})`;
        }
    };

    const syncTurnOrderOverlay = (snapshot) => {
        const overlay = document.getElementById('turn-order-overlay');
        if (!overlay) return;
        const state = snapshot?.turnOrderState;
        if (!state || !state.visible || snapshot?.phase !== 'TURN_ORDER') {
            stopTurnOrderSpin();
            overlay.style.display = 'none';
            return;
        }

        const currentText = pickLangDict(MarbleLang, LangState.current);
        overlay.style.display = 'flex';

        const titleEl = document.getElementById('turn-order-title');
        const descEl = document.getElementById('turn-order-desc');
        const tieBannerEl = document.getElementById('turn-order-tie-banner');
        const countdownEl = document.getElementById('turn-order-countdown');
        const gridEl = document.getElementById('turn-order-grid');
        const myStatusEl = document.getElementById('turn-order-my-status');
        const rollBtn = document.getElementById('turn-order-roll-btn');

        if (tieBannerEl) {
            if (state.tieNotice) {
                tieBannerEl.style.display = 'block';
                const rerollSec = Math.max(0, Number(state.rerollSecondsLeft) || 0);
                tieBannerEl.innerText = (state.stage === 'TIE_REROLL' && rerollSec > 0)
                    ? `${state.tieNotice} (${rerollSec}${currentText.SEC || '초'} 후 재굴림)`
                    : state.tieNotice;
            } else {
                tieBannerEl.style.display = 'none';
            }
        }

        const isResultStage = state.stage === 'RESULT';
        const rollSec = Math.max(0, Number(state.rollSecondsLeft) || 0);
        if (titleEl) {
            titleEl.innerText = isResultStage
                ? (currentText.TURN_ORDER_RESULT_TITLE || '최종 순번 결정 완료!')
                : (currentText.TURN_ORDER_TITLE || '플레이 순번 결정');
        }
        if (descEl) {
            descEl.innerText = isResultStage
                ? (currentText.TURN_ORDER_RESULT_DESC || '')
                : (currentText.TURN_ORDER_DESC || '');
        }
        if (countdownEl) {
            if (isResultStage) {
                countdownEl.style.display = 'block';
                countdownEl.style.color = '#7bed9f';
                const sec = Math.max(0, Number(state.resultSecondsLeft) || 0);
                countdownEl.innerText = `${currentText.TURN_ORDER_AUTO_START_PREFIX || '자동 시작까지'} ${sec}${currentText.SEC || '초'}`;
            } else if (state.stage === 'ROLLING' && rollSec > 0) {
                countdownEl.style.display = 'block';
                countdownEl.style.color = '#f39c12';
                countdownEl.innerText = `${currentText.TURN_ORDER_AUTO_ROLL_PREFIX || '자동 굴림까지'} ${rollSec}${currentText.SEC || '초'}`;
            } else {
                countdownEl.style.display = 'none';
            }
        }

        const players = Array.isArray(state.players) ? state.players : [];
        const myEntry = players.find(p => p.id === snapshot.myPlayerId) || players.find(p => !p.isAi) || players[0];

        if (gridEl) {
            const cards = players.map(p => {
                const isMe = Boolean(myEntry && p.id === myEntry.id);
                const isCardSpinning = isMe && isTurnOrderSpinning;
                const showRolledFace = !isCardSpinning && (p.rolled || isResultStage || (p.tied && p.sum > 0));
                const card = document.createElement('div');
                const borderColor = (isResultStage && p.rank === 1)
                    ? '#f1c40f'
                    : (isMe ? '#ffd86b' : (p.rolled ? 'rgba(123, 237, 159, 0.55)' : 'rgba(255,255,255,0.16)'));
                card.style.cssText = `background: ${isMe ? 'rgba(241, 196, 15, 0.14)' : 'rgba(255, 255, 255, 0.06)'}; border: 2px solid ${borderColor}; border-radius: 14px; padding: 14px 10px; display: flex; flex-direction: column; align-items: center; gap: 9px; transition: border-color 0.2s;`;

                // 1) 위쪽: 플레이어 이름
                const nameEl = document.createElement('div');
                nameEl.style.cssText = `font-size: 15px; font-weight: 800; color: ${p.color || '#ffffff'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;`;
                nameEl.innerText = p.name || '';
                card.appendChild(nameEl);

                // 2) 이름 밑: 주사위 합 / 상태
                const sumEl = document.createElement('div');
                sumEl.style.cssText = 'font-size: 13px; font-weight: 700; color: #e8eef7; min-height: 18px;';
                if (isCardSpinning) {
                    sumEl.style.color = '#f1c40f';
                    sumEl.innerText = currentText.ROLLING || '주사위 굴리는 중...';
                } else if (p.rolled || isResultStage) {
                    sumEl.innerText = `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} ${p.sum ?? 0}`;
                } else if (p.tied && p.sum > 0) {
                    sumEl.style.color = '#ff7675';
                    sumEl.innerText = `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} ${p.sum}`;
                } else {
                    sumEl.style.color = '#95a5a6';
                    sumEl.innerText = `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} -`;
                }
                card.appendChild(sumEl);

                // 3) 가운데: 주사위 2개 그림 (굴리기 전 1/1 상태, 굴린 후 실제 눈금)
                const diceRow = document.createElement('div');
                diceRow.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 8px; margin: 2px 0;';
                const face1 = showRolledFace ? Math.min(6, Math.max(1, Number(p.d1) || 1)) : 1;
                const face2 = showRolledFace ? Math.min(6, Math.max(1, Number(p.d2) || 1)) : 1;
                const diceOpacity = (showRolledFace || isCardSpinning) ? '1' : '0.52';

                const d1Img = document.createElement('img');
                if (isMe) d1Img.id = 'turn-order-my-d1';
                ErrorTracker.trackImage(d1Img, { critical: false, label: 'TurnOrderDice1' });
                d1Img.src = `${DICE_NORMAL_PATH}${face1}.png`;
                d1Img.style.cssText = `width: 50px; height: 50px; object-fit: contain; opacity: ${diceOpacity}; transition: transform 0.08s, opacity 0.18s;`;

                const d2Img = document.createElement('img');
                if (isMe) d2Img.id = 'turn-order-my-d2';
                ErrorTracker.trackImage(d2Img, { critical: false, label: 'TurnOrderDice2' });
                d2Img.src = `${DICE_NORMAL_PATH}${face2}.png`;
                d2Img.style.cssText = `width: 50px; height: 50px; object-fit: contain; opacity: ${diceOpacity}; transition: transform 0.08s, opacity 0.18s;`;

                diceRow.appendChild(d1Img);
                diceRow.appendChild(d2Img);
                card.appendChild(diceRow);

                // 4) 아래: 최종 등수 또는 진행 상태 배지
                const badgeEl = document.createElement('div');
                if (isResultStage || (p.rank !== null && p.rank !== undefined)) {
                    const isFirst = p.rank === 1;
                    badgeEl.style.cssText = `margin-top: 2px; padding: 4px 14px; border-radius: 999px; font-size: 13px; font-weight: 900; background: ${isFirst ? '#f1c40f' : 'rgba(255,255,255,0.12)'}; color: ${isFirst ? '#1a1f2e' : '#ffffff'};`;
                    badgeEl.innerText = `${p.rank || '-'}${currentText.TURN_ORDER_RANK_SUFFIX || '등'}`;
                } else if (isCardSpinning) {
                    badgeEl.style.cssText = 'margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 800; background: rgba(241, 196, 15, 0.22); color: #f1c40f;';
                    badgeEl.innerText = '🎲 ...';
                } else if (p.tied && !p.rolled) {
                    badgeEl.style.cssText = 'margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 800; background: rgba(231, 76, 60, 0.22); color: #ff7675;';
                    badgeEl.innerText = currentText.TURN_ORDER_REROLL_TAG || '(동률 재굴림)';
                } else if (p.rolled) {
                    badgeEl.style.cssText = 'margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 800; background: rgba(46, 204, 113, 0.2); color: #7bed9f;';
                    badgeEl.innerText = currentText.TURN_ORDER_ROLLED_TAG || '완료';
                } else {
                    badgeEl.style.cssText = 'margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: rgba(255,255,255,0.08); color: #95a5a6;';
                    badgeEl.innerText = currentText.TURN_ORDER_WAITING_TAG || '대기중';
                }
                card.appendChild(badgeEl);

                return card;
            });
            gridEl.replaceChildren(...cards);
        }

        if (myEntry && !isResultStage) {
            const canClick = !myEntry.isAi && !myEntry.rolled && state.stage === 'ROLLING' && !isTurnOrderSpinning;
            if (rollBtn) {
                const baseRollLabel = currentText.TURN_ORDER_ROLL_BTN || '주사위 굴리기';
                rollBtn.innerText = rollSec > 0 ? `${baseRollLabel} (${rollSec})` : baseRollLabel;
                rollBtn.style.display = canClick ? 'inline-flex' : 'none';
                rollBtn.disabled = false;
                rollBtn.onclick = async () => {
                    if (isCleanedUp) return;
                    rollBtn.disabled = true;
                    rollBtn.style.display = 'none';
                    ErrorTracker.addBreadcrumb('GAME', 'Marble turn-order roll');
                    startTurnOrderSpin();
                    const res = await RoomManager.sendGameAction({ type: 'TURN_ORDER_ROLL' });
                    if (res && res.ok === false && !isCleanedUp) {
                        stopTurnOrderSpin();
                        rollBtn.disabled = false;
                        rollBtn.style.display = 'inline-flex';
                    }
                };
            }
            if (myStatusEl) {
                if (isTurnOrderSpinning) {
                    myStatusEl.innerText = currentText.ROLLING || '주사위 굴리는 중...';
                } else if (myEntry.tied && !myEntry.rolled) {
                    const prevSumPrefix = (myEntry.sum > 0)
                        ? `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} ${myEntry.sum} — `
                        : '';
                    myStatusEl.innerText = `${prevSumPrefix}${currentText.TURN_ORDER_REROLL_TAG || '(동률 재굴림)'}`;
                } else if (myEntry.rolled) {
                    myStatusEl.innerText = `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} ${myEntry.sum} — ${currentText.TURN_ORDER_WAIT_OTHERS || '대기중'}`;
                } else {
                    myStatusEl.innerText = '';
                }
            }
        } else {
            if (rollBtn) rollBtn.style.display = 'none';
            if (myStatusEl) myStatusEl.innerText = '';
        }
    };

    const syncDiceOverlay = (diceState) => {
        const overlay = document.getElementById('dice-overlay');
        if (!overlay) return;

        if (!diceState || !diceState.visible || diceState.phase === 'HIDE') {
            stopDiceAnimation();
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';
        const titleEl = document.getElementById('dice-title');
        if (titleEl) titleEl.innerText = diceState.title || '';

        const diceImg1 = document.getElementById('dice-img-1');
        const diceImg2 = document.getElementById('dice-img-2');
        const diceImg3 = document.getElementById('dice-img-3');
        if (diceImg2) diceImg2.style.display = diceState.diceCount >= 2 ? 'inline-block' : 'none';
        if (diceImg3) diceImg3.style.display = diceState.useRufo ? 'inline-block' : 'none';

        if (diceState.phase === 'SPINNING') {
            if (!isDiceSpinning) {
                isDiceSpinning = true;
                const spinTick = () => {
                    if (isCleanedUp) {
                        stopDiceAnimation();
                        return;
                    }
                    const r1 = Math.floor(Math.random() * 6) + 1;
                    const r2 = Math.floor(Math.random() * 6) + 1;
                    applyDiceFrames(diceImg1, diceImg2, diceImg3, diceState, r1, r2);
                };
                // 첫 프레임에서도 에르핀/일반 주사위 텍스쳐가 즉시 반영되도록 1회 바로 갱신한다.
                spinTick();
                diceAnimInterval = setInterval(spinTick, 50);
            }
        } else {
            stopDiceAnimation();
            applyDiceFrames(diceImg1, diceImg2, diceImg3, diceState, diceState.d1 || 1, diceState.d2 || 1);
        }
    };

    const syncPrompt = (prompt, viewTiles, snapshot) => {
        if (!prompt) {
            if (activePromptKey !== null) {
                PopupManager.closeAll();
                if (selectedTerritorySource === 'portal_confirm') {
                    closeTerritoryPopups();
                }
                activePromptKey = null;
                ['event-popup', 'portal-popup', 'portal-hint-banner', 'sell-popup', 'target-popup', 'void-game-popup'].forEach(id => peekSavedDisplay.delete(id));
            }
            return;
        }

        const nextKey = `${prompt.promptId}:${prompt.revision || 1}`;
        if (nextKey === activePromptKey) {
            return;
        }
        activePromptKey = nextKey;
        closeHandPopups();
        closeTerritoryPopups();
        setBoardPeek(false);

        const respond = (payload) => RoomManager.sendGameAction({
            type: 'PROMPT_RESPOND',
            promptId: prompt.promptId,
            ...payload
        });
        const cancel = () => RoomManager.sendGameAction({
            type: 'PROMPT_CANCEL',
            promptId: prompt.promptId
        });

        const promptTile = (prompt.tileId !== undefined && prompt.tileId !== null)
            ? (viewTiles[prompt.tileId] || { id: prompt.tileId, type: prompt.tileType, timeType: prompt.timeType })
            : null;
        const promptPlayer = snapshot?.players?.find(p => p.id === snapshot.activePlayerId) || null;
        const promptBgPath = promptTile
            ? resolveTileBgPath(promptTile, snapshot?.world, promptPlayer, { isArrival: true })
            : null;

        switch (prompt.kind) {
            case 'CHOICE':
                PopupManager.showChoicePopup(
                    prompt.title,
                    prompt.desc,
                    (prompt.buttons || []).map(btn => ({
                        text: btn.text,
                        color: btn.color,
                        row: btn.row,
                        align: btn.align,
                        disabled: btn.disabled,
                        action: () => respond({ buttonIndex: btn.index })
                    })),
                    promptBgPath
                );
                break;

            case 'NORMAL':
                PopupManager.showNormalPopup(
                    prompt.title,
                    prompt.desc,
                    Boolean(prompt.showCloseBtn),
                    prompt.showCloseBtn ? () => respond({}) : null,
                    promptBgPath,
                    Boolean(prompt.showCloseBtn),
                    {
                        confirmText: prompt.confirmText,
                        titleColor: prompt.titleColor,
                        buttonColor: prompt.buttonColor,
                        borderColor: prompt.borderColor
                    }
                );
                break;

            case 'BUY': {
                const targetTile = viewTiles[prompt.tileId] || {
                    id: prompt.tileId,
                    level: prompt.tileLevel,
                    type: prompt.tileType,
                    timeType: prompt.timeType
                };
                PopupManager.showBuyPopup(
                    targetTile,
                    prompt.costs,
                    prompt.playerMoney,
                    (level) => respond({ level }),
                    () => cancel(),
                    prompt.maxAllowedLvl,
                    promptBgPath
                );
                break;
            }

            case 'CRISIS':
                PopupManager.showCrisisPopup(
                    prompt.toll,
                    Boolean(prompt.canSellCover),
                    () => respond({ choice: 'sell' }),
                    () => respond({ choice: 'loan' })
                );
                break;

            case 'SELL':
                PopupManager.showSellPopup(
                    prompt.tiles || [],
                    prompt.requiredAmount,
                    (t) => t.sellValue,
                    (selectedTiles) => respond({ tileIds: selectedTiles.map(t => t.id) }),
                    () => cancel()
                );
                break;

            case 'INVENTORY':
                PopupManager.showInventoryPopup(
                    prompt.cards || [],
                    (card) => respond({ cardIndex: card.index, cardId: card.id }),
                    () => cancel()
                );
                break;

            case 'TARGET':
                PopupManager.showTargetPopup(
                    prompt.title,
                    prompt.desc,
                    prompt.targets || [],
                    (targetId) => respond({ targetId }),
                    prompt.canCancel ? () => cancel() : null
                );
                break;

            case 'PORTAL': {
                PopupManager.showPortalBoardPrompt(
                    () => cancel(),
                    prompt.reqFee || 0,
                    Boolean(prompt.isFree)
                );
                break;
            }

            case 'VOID_GAME':
                PopupManager.showVoidGamePopup(
                    { target: prompt.target, direction: prompt.direction },
                    () => respond({})
                );
                break;
        }
        updateTimerDom(snapshot.timerLeft);
    };

    const handleSettlement = (results) => {
        if (isCleanedUp || settlementShown || !Array.isArray(results)) return;
        settlementShown = true;
        ErrorTracker.addBreadcrumb('GAME', 'Marble settlement shown');
        closeHandPopups();
        closeTerritoryPopups();
        setBoardPeek(false);
        PopupManager.closeAll();
        syncBoardPeekUi(latestSnapshot);
        activePromptKey = null;
        stopDiceAnimation();

        const lText = pickLangDict(LobbyLang, LangState.current);
        const hasRoom = Boolean(RoomManager.getCurrentRoom());
        const btnLabel = hasRoom ? (lText.BTN_RETURN_ROOM || '대기방으로 돌아가기') : null;

        showSettlementPopup(results, async () => {
            if (hasRoom) {
                const res = await RoomManager.returnToRoom();
                if (res?.ok && RoomManager.getCurrentRoom()) {
                    changeScene('room');
                    return;
                }
            }
            changeScene('menu');
        }, btnLabel);
    };

    const renderSnapshot = (snapshot) => {
        if (isCleanedUp || !snapshot) return;
        latestSnapshot = snapshot;

        setActiveRenderWorld(snapshot.world);

        const playerById = new Map((snapshot.players || []).map(p => [p.id, p]));
        const viewTiles = (snapshot.tiles || []).map(t => ({
            ...t,
            owner: t.ownerId ? (playerById.get(t.ownerId) || null) : null
        }));

        const targetBoardSrc = getModeConfig(snapshot.world?.gameMode || initialBoardMode).boardTexture;
        if (targetBoardSrc && loadedBoardSrc !== targetBoardSrc) {
            loadedBoardSrc = targetBoardSrc;
            if (!getCachedMarbleImage(targetBoardSrc)) {
                boardImg.src = targetBoardSrc;
            }
        }
        const activeBoardImg = getActiveBoardImage();
        if (activeBoardImg && activeBoardImg.complete && activeBoardImg.naturalWidth > 0) {
            renderBoardState(ctx, activeBoardImg, viewTiles, snapshot.players || [], snapshot.world);
        }

        const activePlayer = playerById.get(snapshot.activePlayerId) || snapshot.players?.[0];
        const viewerId = RoomManager.isOnline()
            ? RoomManager.localPlayer.id
            : (activePlayer && !activePlayer.isAi ? activePlayer.id : (snapshot.viewerId || RoomManager.localPlayer.id));

        const mainHudPlayer = playerById.get(viewerId)
            || snapshot.players?.find(p => !p.isAi)
            || snapshot.players?.[0];

        if (mainHudPlayer) {
            const others = (snapshot.players || []).filter(p => p.id !== mainHudPlayer.id);
            document.getElementById('ui-players').innerHTML =
                createPlayerUI(mainHudPlayer, snapshot.world) +
                createNpcUIList(others, snapshot.world);
        }

        const waitingTargetId = snapshot.waitingFor?.playerId || null;
        const waitingPlayer = (waitingTargetId && waitingTargetId !== viewerId)
            ? (playerById.get(waitingTargetId) || null)
            : null;
        if (activePlayer) {
            document.getElementById('turn-ui-container').innerHTML = createTurnIndicator(
                activePlayer,
                snapshot.world?.currentTurn || 1,
                snapshot.world,
                snapshot.timerLeft,
                waitingPlayer
            );
        }

        const canActNow = Boolean(snapshot.canAct && (!RoomManager.isOnline() || snapshot.activePlayerId === RoomManager.localPlayer.id));
        const isMyTurnStage = Boolean(
            snapshot.phase !== 'TURN_ORDER'
            && snapshot.phase !== 'GAME_OVER'
            && activePlayer
            && !activePlayer.isAi
            && (!RoomManager.isOnline() || activePlayer.id === RoomManager.localPlayer.id)
        );
        const turnKey = isMyTurnStage ? `${snapshot.world?.currentTurn || 1}:${activePlayer.id}` : null;
        const justStartedMyTurn = Boolean(isMyTurnStage && turnKey && turnKey !== announcedTurnKey);
        if (isMyTurnStage) {
            announcedTurnKey = turnKey;
        }
        latestMainHudPlayer = mainHudPlayer || null;
        latestViewTiles = viewTiles;
        latestCanActNow = canActNow;

        if (justStartedMyTurn) {
            closeHandPopups();
            closeTerritoryPopups();
            setBoardPeek(false);
            const mTextTurn = pickLangDict(MarbleLang, LangState.current);
            PopupManager.showToast(mTextTurn.TOAST_MY_TURN || '🎲 내 턴입니다! 주사위를 굴려주세요!', 2600);
        }

        const terrBtn = document.getElementById('btn-territories');
        if (terrBtn) {
            terrBtn.onclick = () => {
                if (isTerritoryOpen) {
                    closeTerritoryPopups();
                } else {
                    closeHandPopups();
                    selectedTerritoryId = null;
                    selectedTerritorySource = null;
                    setBoardPeek(false);
                    isTerritoryOpen = true;
                    renderTerritoryPopup(latestSnapshot, latestViewTiles, latestMainHudPlayer);
                }
                syncBoardPeekUi(latestSnapshot);
            };
        }

        if (!canActNow && isHoldingDice) {
            cancelDiceHold();
        }

        if (!(isHoldingDice && canActNow)) {
            document.getElementById('dice-btn-container').innerHTML = createDiceButton(
                mainHudPlayer,
                canActNow,
                Boolean(snapshot.hasUsableCards)
            );
        }

        const rollBtn = document.getElementById('btn-roll');
        if (rollBtn && canActNow && !rollBtn.dataset.gaugeBound) {
            rollBtn.dataset.gaugeBound = '1';
            rollBtn.onpointerdown = (e) => {
                if (!latestCanActNow || isHoldingDice || rollBtn.disabled) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                e.preventDefault();
                isHoldingDice = true;
                diceHoldActive = false;
                diceGaugeValue = GAME_CONSTANTS.DICE_GAUGE_DEFAULT_POWER ?? 50;
                if (typeof window !== 'undefined') {
                    window.addEventListener('pointerup', onDiceWindowPointerUp);
                    window.addEventListener('pointercancel', onDiceWindowCancel);
                    window.addEventListener('blur', onDiceWindowCancel);
                }
                const holdThresholdMs = GAME_CONSTANTS.DICE_GAUGE_HOLD_THRESHOLD_MS ?? 150;
                diceHoldThresholdTimer = setTimeout(() => {
                    diceHoldThresholdTimer = null;
                    if (!isHoldingDice || !latestCanActNow || isCleanedUp) return;
                    diceHoldActive = true;
                    diceHoldStartTs = performance.now();
                    diceGaugeValue = 0;
                    updateDiceGaugeDom(0, true);
                    diceGaugeRafId = requestAnimationFrame(tickDiceGauge);
                }, holdThresholdMs);
            };
            rollBtn.onclick = () => {
                if (!latestCanActNow || isHoldingDice || rollBtn.disabled) return;
                if (Date.now() - lastPointerRollAt <= 250) return;
                commitDiceRoll(GAME_CONSTANTS.DICE_GAUGE_DEFAULT_POWER ?? 50);
            };
        }

        const invBtn = document.getElementById('btn-inventory');
        if (invBtn) {
            invBtn.onclick = () => {
                if (isHandOpen) {
                    closeHandPopups();
                } else {
                    closeTerritoryPopups();
                    setBoardPeek(false);
                    isHandOpen = true;
                    renderHandPopup(latestSnapshot, latestMainHudPlayer, latestCanActNow);
                }
                syncBoardPeekUi(latestSnapshot);
            };
        }

        syncDiceOverlay(snapshot.diceState);
        syncTurnOrderOverlay(snapshot);
        syncPrompt(snapshot.pendingPrompt, viewTiles, snapshot);
        syncAfkWarningOverlay(snapshot);
        renderHandPopup(snapshot, mainHudPlayer, canActNow);
        renderTerritoryPopup(snapshot, viewTiles, mainHudPlayer);
        syncBoardPeekUi(snapshot);
        updateTimerDom(snapshot.timerLeft);
        ErrorTracker.markTransitionComplete('marble');

        if (snapshot.phase === 'GAME_OVER' && snapshot.settlementResults) {
            handleSettlement(snapshot.settlementResults);
        }
    };

    boardImg.onload = () => {
        if (latestSnapshot) {
            renderSnapshot(latestSnapshot);
        }
    };

    const handCloseBtn = container.querySelector('#hand-close-btn');
    if (handCloseBtn) {
        handCloseBtn.onclick = () => {
            closeHandPopups();
            syncBoardPeekUi(latestSnapshot);
        };
    }

    const handDetailCloseBtn = container.querySelector('#hand-detail-close-btn');
    if (handDetailCloseBtn) {
        handDetailCloseBtn.onclick = () => {
            selectedHandCard = null;
            const d = document.getElementById('hand-detail-popup');
            if (d) d.style.display = 'none';
            peekSavedDisplay.delete('hand-detail-popup');
            syncBoardPeekUi(latestSnapshot);
        };
    }

    const territoryCloseBtn = container.querySelector('#territory-close-btn');
    if (territoryCloseBtn) {
        territoryCloseBtn.onclick = () => {
            closeTerritoryPopups();
            syncBoardPeekUi(latestSnapshot);
        };
    }

    const territoryDetailCloseBtn = container.querySelector('#territory-detail-close-btn');
    if (territoryDetailCloseBtn) {
        territoryDetailCloseBtn.onclick = () => {
            selectedTerritoryId = null;
            selectedTerritorySource = null;
            const d = document.getElementById('territory-detail-popup');
            if (d) d.style.display = 'none';
            peekSavedDisplay.delete('territory-detail-popup');
            syncBoardPeekUi(latestSnapshot);
        };
    }

    const canvasPointFromEvent = (evt) => {
        if (!canvas || evt.target !== canvas) return null;
        if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return null;
        if (evt.offsetX < 0 || evt.offsetX > canvas.clientWidth || evt.offsetY < 0 || evt.offsetY > canvas.clientHeight) {
            return null;
        }
        return {
            x: (evt.offsetX / canvas.clientWidth) * canvas.width,
            y: (evt.offsetY / canvas.clientHeight) * canvas.height
        };
    };

    const isPortalPromptActive = () => Boolean(
        latestSnapshot
        && latestSnapshot.pendingPrompt
        && latestSnapshot.pendingPrompt.kind === 'PORTAL'
    );

    const isBoardInspectAllowed = () => (
        Boolean(latestSnapshot)
        && latestSnapshot.phase !== 'GAME_OVER'
        && latestSnapshot.phase !== 'TURN_ORDER'
        && !isPeekingBoard
        && !latestSnapshot.afkAutoAlert
        && (!latestSnapshot.pendingPrompt || isPortalPromptActive())
    );

    const onCanvasMouseMove = (evt) => {
        if (!isBoardInspectAllowed()) {
            canvas.style.cursor = 'default';
            return;
        }
        const pt = canvasPointFromEvent(evt);
        const hit = pt ? findTileAtCanvasPoint(pt.x, pt.y, latestViewTiles, latestSnapshot?.world?.gameMode) : null;
        if (!hit) {
            canvas.style.cursor = 'default';
            return;
        }
        if (isPortalPromptActive()) {
            const validIds = latestSnapshot.pendingPrompt.validTileIds || [];
            canvas.style.cursor = validIds.includes(hit.id) ? 'pointer' : 'not-allowed';
            return;
        }
        canvas.style.cursor = 'pointer';
    };

    const onCanvasClick = (evt) => {
        if (!isBoardInspectAllowed()) return;
        const pt = canvasPointFromEvent(evt);
        if (!pt) return;
        const hit = findTileAtCanvasPoint(pt.x, pt.y, latestViewTiles, latestSnapshot?.world?.gameMode);
        if (!hit) return;

        if (isPortalPromptActive()) {
            const validIds = latestSnapshot.pendingPrompt.validTileIds || [];
            if (!validIds.includes(hit.id)) {
                PopupManager.showToast('빵주 현재 칸으로는 이동할 수 없습니다.', 1800);
                return;
            }
            closeHandPopups();
            isTerritoryOpen = false;
            const terrPopup = document.getElementById('territory-popup');
            if (terrPopup) terrPopup.style.display = 'none';
            peekSavedDisplay.delete('territory-popup');
            setBoardPeek(false);

            selectedTerritoryId = hit.id;
            selectedTerritorySource = 'portal_confirm';
            renderTerritoryDetailPopup(latestSnapshot, latestViewTiles, latestMainHudPlayer);
            syncBoardPeekUi(latestSnapshot);
            return;
        }

        closeHandPopups();
        isTerritoryOpen = false;
        const terrPopup = document.getElementById('territory-popup');
        if (terrPopup) terrPopup.style.display = 'none';
        peekSavedDisplay.delete('territory-popup');
        setBoardPeek(false);

        selectedTerritoryId = hit.id;
        selectedTerritorySource = 'board';
        renderTerritoryDetailPopup(latestSnapshot, latestViewTiles, latestMainHudPlayer);
        syncBoardPeekUi(latestSnapshot);
    };

    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('click', onCanvasClick);

    const boardPeekBtn = container.querySelector('#btn-board-peek');
    if (boardPeekBtn) {
        boardPeekBtn.onclick = () => {
            setBoardPeek(!isPeekingBoard);
            syncBoardPeekUi(latestSnapshot);
        };
    }

    const exitBtn = container.querySelector('#btn-exit-match');
    if (exitBtn) {
        exitBtn.onclick = async () => {
            if (!exitConfirmPending) {
                exitConfirmPending = true;
                exitBtn.innerText = '정말 나가기?';
                exitConfirmTimer = setTimeout(() => {
                    exitConfirmPending = false;
                    if (!isCleanedUp && exitBtn) exitBtn.innerText = '나가기';
                }, 3000);
                return;
            }
            if (exitConfirmTimer) clearTimeout(exitConfirmTimer);
            const curRoom = RoomManager.getCurrentRoom();
            const meta = curRoom ? getGameMeta(curRoom.gameId) : null;
            await RoomManager.leaveCurrentRoom();
            changeScene(meta?.sceneMain || 'menu');
        };
    }

    const unsubscribeGame = RoomManager.subscribeGame((evtName, payload) => {
        if (isCleanedUp) return;
        if (evtName === 'STATE') {
            renderSnapshot(payload);
        } else if (evtName === 'TIMER') {
            if (latestSnapshot) {
                latestSnapshot.timerLeft = payload?.timeLeft ?? latestSnapshot.timerLeft;
            }
            updateTimerDom(payload?.timeLeft);
        } else if (evtName === 'EVENT') {
            if (payload?.type === 'TOAST' && payload.message) {
                PopupManager.showToast(payload.message, payload.duration || 3200);
            } else if (payload?.type === 'GAME_OVER' && payload.results) {
                handleSettlement(payload.results);
            }
        } else if (evtName === 'RETURNED_TO_ROOM') {
            changeScene('room');
        } else if (evtName === 'KICKED') {
            const meta = getGameMeta(payload?.gameId || 'marble');
            if (payload?.reason === 'AFK_KICKED') {
                changeScene(meta?.sceneMain || 'marble_main', { afkPenalty: true });
            } else {
                changeScene(meta?.sceneMain || 'menu');
            }
        }
    });

    const langHandler = () => {
        if (latestSnapshot) {
            activePromptKey = null;
            renderSnapshot(latestSnapshot);
        }
    };
    document.addEventListener('languageChanged', langHandler);

    container._cleanupScene = () => {
        isCleanedUp = true;
        if (exitConfirmTimer) clearTimeout(exitConfirmTimer);
        cancelDiceHold();
        stopDiceAnimation();
        stopTurnOrderSpin();
        PopupManager.clearToasts?.();
        unsubscribeGame();
        document.removeEventListener('languageChanged', langHandler);
        canvas.removeEventListener('mousemove', onCanvasMouseMove);
        canvas.removeEventListener('click', onCanvasClick);
        RoomManager.stopLocalGameSession();
        setActiveRenderWorld(null);
    };

    // 초기 스냅샷 적용 (서버 GAME_START/HELLO_ACK 수신분 또는 오프라인 로컬 엔진 즉시 시작)
    let initialSnapshot = sceneParams?.initialSnapshot || RoomManager.getActiveSnapshot();
    if (!initialSnapshot && !RoomManager.isOnline()) {
        initialSnapshot = RoomManager.startLocalGameSession(sceneParams?.room || RoomManager.getCurrentRoom());
    }
    if (initialSnapshot) {
        renderSnapshot(initialSnapshot);
    }
}
