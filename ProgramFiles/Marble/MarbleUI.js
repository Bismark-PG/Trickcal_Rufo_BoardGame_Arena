import { SettingsManager } from '../System/System.js';
import { LangState } from '../System/LanguageManager.js';
import { MarbleLang } from '../System/Index/Marble/MarbleUIIndex.js';
import { GimmickLang } from '../System/Index/Marble/MarbleGimmickIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { GAME_CONSTANTS, getModeConfig } from '../System/Index/Marble/MarblePriceIndex.js';
import { CardUILang, formatCardDisplayTitle, getCardGradeTheme } from '../System/Index/Marble/MarbleCardUIIndex.js';
import { SettlementLang } from '../System/Index/Marble/MarbleSettlementIndex.js';
import { escapeHtml } from '../Lobby/LobbyUI.js';
import { ErrorTracker } from '../System/ErrorTracker.js';
import { getCachedMarbleImage, isMarbleImageError } from './MarbleAssetLoader.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import { getPlayerThinkTime } from './MarbleCardTreasure.js';
import { RequiemState } from './MarbleRequiem.js';
import {
    pickLangDict,
    formatMoney as runtimeFormatMoney,
    getTileName as runtimeGetTileName
} from './MarbleRuntime.js';

let activeRenderWorld = null;

export function setActiveRenderWorld(worldState) {
    activeRenderWorld = worldState || null;
}

function resolveRenderWorld(worldState = null) {
    if (worldState) return worldState;
    if (activeRenderWorld) return activeRenderWorld;
    return {
        gameMode: 'ember',
        currentTurn: WorldGimmickManager.currentTurn,
        maxTurn: GAME_CONSTANTS.MAX_TURN,
        currentTime: WorldGimmickManager.currentTime,
        timeSlot: {
            currentPhase: WorldGimmickManager.getActiveGimmickType() === 'day' || WorldGimmickManager.getActiveGimmickType() === 'night'
                ? WorldGimmickManager.getActiveGimmickType()
                : 'none',
            remainingTurns: WorldGimmickManager.getRemainingTimeTurns()
        },
        requiem: {
            isSootState: RequiemState.isSootState,
            isHaloState: RequiemState.isHaloState,
            sootRemainingTurns: RequiemState.sootRemainingTurns,
            haloRemainingTurns: RequiemState.haloRemainingTurns
        }
    };
}

function resolveGimmickStatus(worldState = null) {
    if (!worldState && !activeRenderWorld) {
        return {
            activeGimmick: WorldGimmickManager.getActiveGimmickType(),
            remainTurns: WorldGimmickManager.getRemainingTimeTurns(),
            isOverridden: RequiemState.isSootState || RequiemState.isHaloState,
            currentTime: WorldGimmickManager.currentTime
        };
    }
    const world = resolveRenderWorld(worldState);
    const req = world.requiem || {};
    const slot = world.timeSlot || {};
    if (req.isHaloState) {
        return {
            activeGimmick: 'halo',
            remainTurns: req.haloRemainingTurns || 0,
            isOverridden: true,
            currentTime: world.currentTime || 'none'
        };
    }
    if (req.isSootState) {
        return {
            activeGimmick: 'soot',
            remainTurns: req.sootRemainingTurns || 0,
            isOverridden: true,
            currentTime: world.currentTime || 'none'
        };
    }
    if (slot.currentPhase === 'day' || slot.currentPhase === 'night') {
        return {
            activeGimmick: slot.currentPhase,
            remainTurns: slot.remainingTurns || 0,
            isOverridden: false,
            currentTime: world.currentTime || slot.currentPhase
        };
    }
    return {
        activeGimmick: 'none',
        remainTurns: 0,
        isOverridden: false,
        currentTime: world.currentTime || 'none'
    };
}

export function getTileName(tile, worldState = null) {
    return runtimeGetTileName(tile, resolveRenderWorld(worldState), LangState.current);
}

export function formatMoney(amount) {
    return runtimeFormatMoney(amount, LangState.current);
}

function buildPlayerBadgesHtml(player, isCompact = false, worldState = null) {
    const text = pickLangDict(MarbleLang, LangState.current);
    const gText = pickLangDict(GimmickLang, LangState.current);
    const world = resolveRenderWorld(worldState);
    const isSoot = Boolean(world.requiem?.isSootState);
    const fontSize = isCompact ? '13px' : '15px';
    const pad = isCompact ? '2px 6px' : '3px 8px';
    const badges = [];

    if (player.isBbangjuChief) {
        badges.push(`<span style="font-size:${fontSize}; background:#f39c12; color:#fff; padding:${pad}; border-radius:5px;">${isCompact ? text.BADGE_CHIEF_SHORT : text.BADGE_CHIEF}</span>`);
    }
    if (player.hasMountainBuff) {
        badges.push(`<span style="font-size:${fontSize}; background:#16a085; color:#fff; padding:${pad}; border-radius:5px;">${isCompact ? (text.BADGE_MOUNTAIN_DISCIPLE_SHORT || '🏔️ 제자') : (text.BADGE_MOUNTAIN_DISCIPLE || '🏔️ 제자')}</span>`);
    }
    if (player.isReincarnated) {
        badges.push(`<span style="font-size:${fontSize}; background:#c0392b; color:#fff; padding:${pad}; border-radius:5px;">${gText.BADGE_REINCARNATION}</span>`);
    }
    if (player.hasKarmaState) {
        badges.push(`<span style="font-size:${fontSize}; background:#8e44ad; color:#fff; padding:${pad}; border-radius:5px;">${gText.BADGE_KARMA}</span>`);
    }
    if (player.hasRegretState) {
        badges.push(`<span style="font-size:${fontSize}; background:#2980b9; color:#fff; padding:${pad}; border-radius:5px;">${gText.BADGE_REGRET}</span>`);
    }
    if (player.hasWishState) {
        badges.push(`<span style="font-size:${fontSize}; background:#f1c40f; color:#000; font-weight:bold; padding:${pad}; border-radius:5px;">${gText.BADGE_WISH}</span>`);
    }
    if (player.hasDreamState) {
        badges.push(`<span style="font-size:${fontSize}; background:#1abc9c; color:#fff; padding:${pad}; border-radius:5px;">${gText.BADGE_DREAM}</span>`);
    }
    const displayTreasureCount = (isSoot && player.isReincarnated)
        ? 6
        : (typeof player.displayTreasureCount === 'number'
            ? player.displayTreasureCount
            : (player.treasureCards ? player.treasureCards.length : 0));
    if (displayTreasureCount > 0) {
        badges.push(`<span style="font-size:${fontSize}; background:#d35400; color:#fff; padding:${pad}; border-radius:5px;">💎 ${displayTreasureCount}</span>`);
    }

    if (badges.length === 0) return '';
    return `<div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">${badges.join('')}</div>`;
}

export function createPlayerUI(player, worldState = null) {
    const text = pickLangDict(MarbleLang, LangState.current);
    const badgesHtml = buildPlayerBadgesHtml(player, false, worldState);
    const disconnectTag = player.isConnected === false
        ? `<span style="font-size: 14px; background: #e74c3c; color: #fff; padding: 2px 7px; border-radius: 5px; margin-left: 8px; vertical-align: middle;">OFFLINE</span>`
        : '';
    return `
        <div style="position: absolute; bottom: 40px; left: 40px; display: flex; align-items: flex-end; gap: 20px;">
            <div style="width: 440px; min-height: 160px; background-color: rgba(0,0,0,0.8); border: 4px solid ${player.color}; border-radius: 15px; display: flex; align-items: center; padding: 20px; box-sizing: border-box; box-shadow: 5px 5px 15px rgba(0,0,0,0.3); color: #fff;">
                <div style="width: 120px; height: 120px; background-color: #fff; margin-right: 20px; border-radius: 10px; display:flex; justify-content:center; align-items:center; color:#000; flex-shrink:0;">${text.PORTRAIT}</div>
                <div style="flex: 1; min-width: 0;">
                    <h2 style="margin: 0; font-size: 32px; color: ${player.color}; line-height: 1.1;">${escapeHtml(player.name)}${disconnectTag}</h2>
                    ${badgesHtml}
                    <p style="margin: 6px 0 2px 0; font-size: 20px;">${text.MONEY} ${player.money.toLocaleString()}</p>
                    <p style="margin: 2px 0; font-size: 20px;">${text.TERRITORY} ${player.territoryCount}${text.EA}</p>
                </div>
            </div>
            <button id="btn-territories" type="button" style="font-family: inherit; padding: 25px 38px; font-size: 30px; font-weight: bold; cursor: pointer; border-radius: 15px; border: none; background-color: #2980b9; color: white; box-shadow: 0 10px 20px rgba(0,0,0,0.4); white-space: nowrap; flex-shrink: 0;">${text.BTN_TERRITORIES || '보유영토'}</button>
        </div>
    `;
}

export function createNpcUIList(npcs, worldState = null) {
    const text = pickLangDict(MarbleLang, LangState.current);
    let html = `<div style="position: absolute; top: 40px; left: 40px; display: flex; flex-direction: column; gap: 20px;">`;
    npcs.forEach(npc => {
        const badgesHtml = buildPlayerBadgesHtml(npc, true, worldState);
        const offlineBadge = (!npc.isAi && npc.isConnected === false)
            ? `<span style="font-size: 12px; background: #e74c3c; color: #fff; padding: 1px 6px; border-radius: 4px; margin-left: 6px;">OFFLINE</span>`
            : '';
        html += `
            <div style="width: 350px; min-height: 120px; background-color: rgba(0,0,0,0.7); border: 3px solid ${npc.color}; border-radius: 10px; display: flex; align-items: center; padding: 15px; box-sizing: border-box; color: #fff;">
                 <div style="width: 80px; height: 80px; background-color: #fff; margin-right: 15px; border-radius: 8px; display:flex; justify-content:center; align-items:center; color:#000; flex-shrink:0;">${text.PORTRAIT}</div>
                 <div>
                    <h3 style="margin: 0; font-size: 26px; color: ${npc.color}; line-height: 1.1;">${escapeHtml(npc.name)}${offlineBadge}</h3>
                    ${badgesHtml}
                    <p style="margin: 4px 0 0 0; font-size: 18px;">${text.MONEY} ${npc.money.toLocaleString()}</p>
                 </div>
            </div>
        `;
    });
    return html + `</div>`;
}

export function createTurnIndicator(player, currentTurn, worldState = null, remainSec = null, waitingPlayer = null) {
    const text = pickLangDict(MarbleLang, LangState.current);
    const gText = pickLangDict(GimmickLang, LangState.current);
    const world = resolveRenderWorld(worldState);
    const { activeGimmick, remainTurns } = resolveGimmickStatus(worldState);
    const maxTurn = world.maxTurn || GAME_CONSTANTS.MAX_TURN;

    let timeStatusHtml = `<div style="font-size: 18px; margin-bottom: 8px; color: #95a5a6; font-weight: bold;">${gText.TIME_LABEL_NORMAL}</div>`;
    if (activeGimmick === 'halo') {
        timeStatusHtml = `<div style="font-size: 18px; margin-bottom: 8px; color: #00d2d3; font-weight: bold;">${gText.WORLD_LABEL_HALO} (${remainTurns}${gText.TIME_REMAIN_UNIT})</div>`;
    } else if (activeGimmick === 'soot') {
        timeStatusHtml = `<div style="font-size: 18px; margin-bottom: 8px; color: #e74c3c; font-weight: bold;">${gText.WORLD_LABEL_SOOT} (${remainTurns}${gText.TIME_REMAIN_UNIT})</div>`;
    } else if (activeGimmick === 'day') {
        timeStatusHtml = `<div style="font-size: 18px; margin-bottom: 8px; color: #f1c40f; font-weight: bold;">${gText.TIME_LABEL_DAY} (${remainTurns}${gText.TIME_REMAIN_UNIT})</div>`;
    } else if (activeGimmick === 'night') {
        timeStatusHtml = `<div style="font-size: 18px; margin-bottom: 8px; color: #9b59b6; font-weight: bold;">${gText.TIME_LABEL_NIGHT} (${remainTurns}${gText.TIME_REMAIN_UNIT})</div>`;
    }

    const thinkTime = remainSec !== null && remainSec !== undefined ? remainSec : getPlayerThinkTime(player);
    const waitingHtml = waitingPlayer
        ? `<div id="turn-waiting-indicator" style="font-size: 20px; color: #f1c40f; margin-bottom: 8px; font-weight: bold;">⏳ ${escapeHtml(waitingPlayer.name)} 선택 대기 중...</div>`
        : '';

    return `
        <div id="turn-indicator" style="position: absolute; top: 40px; right: 40px; background-color: rgba(0,0,0,0.9); border: 4px solid ${player.color}; border-radius: 15px; padding: 20px 40px; text-align: center; box-shadow: 5px 5px 15px rgba(0,0,0,0.5); color: #fff;">
            <div style="font-size: 20px; margin-bottom: 5px; color: #bdc3c7; font-weight: bold;">${currentTurn} / ${maxTurn} Turn</div>
            ${timeStatusHtml}
            <div style="font-size: 32px; margin-bottom: 10px;">${text.CURRENT_TURN} <span id="turn-text" style="color: ${player.color}; font-weight: bold;">${escapeHtml(player.name)}</span></div>
            ${waitingHtml}
            <div id="turn-timer" style="font-size: 28px; color: #e74c3c; font-weight: bold;">${text.REMAIN_TIME} ${thinkTime}${text.SEC}</div>
        </div>
    `;
}

export function computeDiceGaugePower(elapsedMs, cycleMs = GAME_CONSTANTS.DICE_GAUGE_CYCLE_MS || 1200) {
    const rawCycle = Number(cycleMs);
    const safeCycle = Number.isFinite(rawCycle) ? Math.max(200, rawCycle) : (GAME_CONSTANTS.DICE_GAUGE_CYCLE_MS || 1200);
    const rawElapsed = Number(elapsedMs);
    const safeElapsed = Number.isFinite(rawElapsed) ? Math.max(0, rawElapsed) : 0;
    const phase = (safeElapsed % safeCycle) / safeCycle;
    const wave = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
    return Math.max(0, Math.min(100, Math.round(wave * 100)));
}

export function createDiceButton(player, canRoll = true, hasUsableCards = false) {
    const text = pickLangDict(MarbleLang, LangState.current);
    const cText = pickLangDict(CardUILang, LangState.current);

    const invBtnBg = '#9b59b6';
    const invBtnCursor = 'pointer';

    const rollBtnBg = canRoll ? '#f39c12' : '#7f8c8d';
    const rollBtnCursor = canRoll ? 'pointer' : 'not-allowed';

    return `
        <div style="position: absolute; bottom: 40px; right: 40px; display: flex; flex-direction: column; align-items: flex-end;">
            <div style="display: flex; align-items: flex-end; gap: 20px;">
                <button id="btn-inventory" type="button" style="font-family: inherit; padding: 25px 40px; font-size: 30px; font-weight: bold; cursor: ${invBtnCursor}; border-radius: 15px; border: none; background-color: ${invBtnBg}; color: white; box-shadow: 0 10px 20px rgba(0,0,0,0.4);">${cText.BTN_INVENTORY}</button>
                <div style="display: flex; flex-direction: column; align-items: stretch;">
                    <div style="height: 54px; display: flex; flex-direction: column; justify-content: flex-end; margin-bottom: 8px; pointer-events: none;">
                        <div id="dice-gauge-idle" style="display: ${canRoll ? 'flex' : 'none'}; justify-content: center; align-items: center;">
                            <span style="background: rgba(15, 23, 42, 0.82); color: #f8fafc; border: 1px solid rgba(241, 196, 15, 0.45); border-radius: 999px; padding: 4px 12px; font-size: 13px; font-weight: bold; white-space: nowrap;">⚡ ${text.DICE_GAUGE_HOLD_HINT || '길게 눌러 강약 조절'}</span>
                        </div>
                        <div id="dice-gauge-wrap" style="display: none; background: rgba(15, 23, 42, 0.94); border: 2px solid #f1c40f; border-radius: 12px; padding: 7px 12px; box-shadow: 0 8px 18px rgba(0,0,0,0.45);">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: bold; color: #f8fafc; margin-bottom: 4px;">
                                <span>⚡ ${text.DICE_GAUGE_POWER_LABEL || '게이지'}</span>
                                <span id="dice-gauge-pct" style="color: #f1c40f;">0%</span>
                            </div>
                            <div style="position: relative; width: 100%; height: 12px; background: #1e293b; border-radius: 999px; overflow: hidden; border: 1px solid rgba(255,255,255,0.22);">
                                <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.6); transform: translateX(-50%); z-index: 2;"></div>
                                <div id="dice-gauge-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #3498db, #f1c40f, #e74c3c);"></div>
                            </div>
                        </div>
                    </div>
                    <button id="btn-roll" type="button" style="font-family: inherit; padding: 25px 60px; font-size: 36px; font-weight: bold; cursor: ${rollBtnCursor}; border-radius: 15px; border: none; background-color: ${rollBtnBg}; color: white; box-shadow: 0 10px 20px rgba(0,0,0,0.4); user-select: none; -webkit-user-select: none; touch-action: none;" ${!canRoll ? 'disabled' : ''}>${text.ROLL_DICE}</button>
                </div>
            </div>
        </div>
    `;
}

export function createDiceOverlay() {
    const text = pickLangDict(MarbleLang, LangState.current);
    return `
        <div id="dice-overlay" style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: rgba(44, 62, 80, 0.95); border: 5px solid #fff; padding: 50px 100px; border-radius: 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.7); z-index: 10;">
            <h2 id="dice-title" style="margin: 0 0 30px 0; font-size: 48px; color: #f1c40f;">${text.ROLLING}</h2>
            <div style="display: flex; gap: 40px; justify-content: center; align-items: center;">
                <img id="dice-img-1" src="./Resource/Texture/Marble/Dice/Dice_N_1.png" style="width: 120px; height: 120px; object-fit: contain;" />
                <img id="dice-img-2" src="./Resource/Texture/Marble/Dice/Dice_N_1.png" style="width: 120px; height: 120px; object-fit: contain;" />
                <img id="dice-img-3" src="./Resource/Texture/Marble/Dice/Dice_N_6.png" style="display: none; width: 120px; height: 120px; object-fit: contain;" />
            </div>
        </div>
    `;
}

export function createTurnOrderOverlay() {
    return `
        <div id="turn-order-overlay" style="display: none; position: absolute; inset: 0; background: rgba(10, 14, 24, 0.84); backdrop-filter: blur(4px); z-index: 950; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
            <div style="width: 100%; max-width: 820px; background: linear-gradient(160deg, #1b2236 0%, #121726 100%); border: 2px solid rgba(241, 196, 15, 0.75); border-radius: 20px; padding: 28px 30px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.68); color: #f4f6fb; text-align: center; box-sizing: border-box;">
                <h2 id="turn-order-title" style="margin: 0 0 8px 0; font-size: 26px; font-weight: 800; color: #f1c40f;"></h2>
                <p id="turn-order-desc" style="margin: 0 0 14px 0; font-size: 14px; color: #cfd8e3; line-height: 1.5;"></p>
                <div id="turn-order-tie-banner" style="display: none; margin: 0 auto 14px auto; padding: 8px 14px; border-radius: 10px; background: rgba(231, 76, 60, 0.2); border: 1px solid rgba(231, 76, 60, 0.7); color: #ffd2cc; font-size: 13px; font-weight: 700;"></div>
                <div id="turn-order-countdown" style="display: none; margin-bottom: 14px; font-size: 16px; font-weight: 800; color: #7bed9f;"></div>

                <div id="turn-order-grid" style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 14px 0 18px 0;"></div>

                <div id="turn-order-action-area" style="min-height: 54px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;">
                    <div id="turn-order-my-status" style="min-height: 20px; font-size: 14px; font-weight: 700; color: #f1c40f;"></div>
                    <button id="turn-order-roll-btn" type="button" style="display: none; align-items: center; justify-content: center; padding: 13px 34px; font-size: 17px; font-weight: 800; color: #1a1f2e; background: linear-gradient(135deg, #f7d348, #e6a817); border: none; border-radius: 12px; cursor: pointer; box-shadow: 0 6px 18px rgba(241, 196, 15, 0.35);"></button>
                </div>
            </div>
        </div>
    `;
}

export function createPopupOverlay() {
    const text = pickLangDict(MarbleLang, LangState.current);
    return `
        <div id="toast-popup" style="display: none; position: absolute; top: 10%; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; gap: 10px; max-width: 72%; z-index: 100; pointer-events: none;"></div>
        <div id="event-popup" style="display: none; font-family: inherit; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: rgba(44, 62, 80, 0.96); border: 5px solid #fff; padding: 36px 40px; border-radius: 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.7); z-index: 20; min-width: 440px; max-width: 90vw; box-sizing: border-box; color: #fff;">
            <div id="event-bg-banner" style="display: none; width: 100%; height: 245px; border-radius: 14px; margin-bottom: 18px; background-size: cover; background-position: center; border: 2px solid rgba(255,255,255,0.25); box-shadow: 0 10px 24px rgba(0,0,0,0.35);"></div>
            <h2 id="event-title" style="margin: 0 0 18px 0; font-size: 38px; color: #f1c40f;"></h2>
            <p id="event-desc" style="font-size: 24px; margin-bottom: 30px; line-height: 1.4;"></p>
            <div id="event-timer" style="font-size: 24px; color: #e74c3c; margin-bottom: 20px; display: none;"></div>
            <div id="buy-buttons" style="display: none; gap: 15px; justify-content: center; flex-wrap: wrap;"></div>
            <div id="crisis-buttons" style="display: none; gap: 20px; justify-content: center;">
                <button id="crisis-sell-btn" style="font-family: inherit; padding: 15px 30px; font-size: 24px; background: #e67e22; color: #fff; border: none; border-radius: 10px; cursor: pointer;">${text.BTN_CRISIS_SELL}</button>
                <button id="crisis-loan-btn" style="font-family: inherit; padding: 15px 30px; font-size: 24px; background: #e74c3c; color: #fff; border: none; border-radius: 10px; cursor: pointer;">${text.BTN_CRISIS_LOAN}</button>
            </div>
            <div id="close-buttons" style="display: none;">
                <button id="close-btn" style="font-family: inherit; padding: 15px 40px; font-size: 24px; background: #3498db; color: #fff; border: none; border-radius: 10px; cursor: pointer;">${text.CLOSE}</button>
            </div>
        </div>
        <div id="sell-popup" style="display: none; font-family: inherit; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: rgba(44, 62, 80, 0.95); border: 5px solid #e67e22; padding: 30px; border-radius: 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.7); z-index: 30; width: 600px; color: #fff;">
            <h2 id="sell-main-title" style="margin: 0 0 10px 0; font-size: 36px; color: #e67e22;"></h2>
            <p id="sell-req-text" style="font-size: 20px; color: #e74c3c;"></p>
            <p id="sell-sum-text" style="font-size: 20px; color: #2ecc71; margin-bottom: 20px;"></p>
            <div id="sell-grid" style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto; padding-right: 10px; margin-bottom: 20px; text-align: left;"></div>
            <div style="display: flex; gap: 15px;">
                <button id="sell-confirm-btn" style="font-family: inherit; padding: 15px; font-size: 24px; background: #7f8c8d; color: white; flex: 1; border: none; border-radius: 10px; cursor: pointer;" disabled></button>
                <button id="sell-cancel-btn" style="font-family: inherit; padding: 15px; font-size: 24px; background: #c0392b; color: white; flex: 1; border: none; border-radius: 10px; cursor: pointer;"></button>
            </div>
        </div>
        <div id="portal-popup" style="display: none; font-family: inherit; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: rgba(44, 62, 80, 0.95); border: 5px solid #9b59b6; padding: 30px; border-radius: 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.7); z-index: 30; width: 800px;">
            <h2 id="portal-title" style="margin: 0 0 10px 0; font-size: 40px; color: #9b59b6;">${text.PORTAL_TITLE}</h2>
            <p id="portal-desc" style="font-size: 20px; margin-bottom: 15px; color: #ecf0f1;">${text.PORTAL_DESC}</p>
            <div id="portal-timer" style="font-size: 24px; color: #e74c3c; margin-bottom: 20px;">${text.REMAIN_TIME} ${GAME_CONSTANTS.THINK_TIME}${text.SEC}</div>
            <div id="portal-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; max-height: 400px; overflow-y: auto; padding-right: 10px;"></div>
            <div style="margin-top: 20px;">
                <button id="portal-cancel-btn" style="font-family: inherit; padding: 15px; font-size: 24px; background: #7f8c8d; color: white; width: 100%; border: none; border-radius: 10px; cursor: pointer;">${text.PORTAL_CANCEL}</button>
            </div>
        </div>
        <div id="target-popup" style="display: none; font-family: inherit; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: rgba(44, 62, 80, 0.95); border: 5px solid #3498db; padding: 30px; border-radius: 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.7); z-index: 40; width: 700px; color: #fff;">
            <h2 id="target-title" style="margin: 0 0 10px 0; font-size: 36px; color: #3498db;"></h2>
            <p id="target-desc" style="font-size: 20px; color: #ecf0f1; margin-bottom: 15px;"></p>
            <div id="target-timer" style="font-size: 24px; color: #e74c3c; margin-bottom: 20px;">${text.REMAIN_TIME} ${GAME_CONSTANTS.THINK_TIME}${text.SEC}</div>
            <div id="target-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-height: 400px; overflow-y: auto; padding-right: 10px; margin-bottom: 20px;"></div>
            <button id="target-cancel-btn" style="font-family: inherit; padding: 15px; font-size: 24px; background: #e74c3c; color: white; width: 100%; border: none; border-radius: 10px; cursor: pointer;"></button>
        </div>
        <div id="void-game-popup" style="display: none; font-family: inherit; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: linear-gradient(160deg, #1e1836 0%, #121024 100%); border: 5px solid #9b59b6; padding: 38px 44px; border-radius: 22px; text-align: center; box-shadow: 0 22px 54px rgba(0,0,0,0.78); z-index: 35; min-width: 480px; max-width: 90vw; color: #fff;">
            <h2 id="void-game-title" style="margin: 0 0 10px 0; font-size: 38px; color: #f1c40f;"></h2>
            <p id="void-game-subtitle" style="margin: 0 0 22px 0; font-size: 20px; color: #d8c8f5;"></p>
            <div id="void-game-target-box" style="margin: 0 auto 20px auto; padding: 18px 28px; border-radius: 14px; background: rgba(155, 89, 182, 0.2); border: 2px solid rgba(155, 89, 182, 0.75); display: inline-flex; align-items: center; justify-content: center; gap: 14px;">
                <span id="void-game-number" style="font-size: 52px; font-weight: 900; color: #fff; line-height: 1;"></span>
                <span id="void-game-dir" style="font-size: 36px; font-weight: 800; line-height: 1;"></span>
            </div>
            <p id="void-game-desc" style="margin: 0 0 18px 0; font-size: 20px; color: #ecf0f1; line-height: 1.5;"></p>
            <div id="void-timer" style="font-size: 22px; color: #e74c3c; margin-bottom: 22px;">${text.REMAIN_TIME} ${GAME_CONSTANTS.THINK_TIME}${text.SEC}</div>
            <button id="void-game-roll-btn" type="button" style="font-family: inherit; padding: 15px 46px; font-size: 24px; font-weight: 800; background: linear-gradient(135deg, #f39c12, #e67e22); color: #fff; border: none; border-radius: 12px; cursor: pointer; box-shadow: 0 8px 22px rgba(243, 156, 18, 0.35);"></button>
        </div>
        <div id="hand-popup" style="display: none; font-family: inherit; position: absolute; top: 47%; left: 50%; transform: translate(-50%, -50%); background: rgba(24, 34, 48, 0.96); border: 4px solid #9b59b6; padding: 26px 28px; border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.75); z-index: 45; width: 680px; max-width: 92vw; color: #fff;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <h2 id="hand-title" style="margin: 0; font-size: 30px; color: #e0b3ff;"></h2>
                <button id="hand-close-btn" type="button" style="font-family: inherit; width: 38px; height: 38px; font-size: 22px; font-weight: bold; background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.28); border-radius: 10px; cursor: pointer; line-height: 1;">✕</button>
            </div>
            <p id="hand-desc" style="margin: 0 0 16px 0; font-size: 16px; color: #cbd5e1;"></p>
            <div id="hand-list" style="display: flex; flex-direction: column; gap: 14px; max-height: 430px; overflow-y: auto; padding-right: 6px;"></div>
        </div>
        <div id="hand-detail-popup" style="display: none; font-family: inherit; position: absolute; top: 47%; left: 50%; transform: translate(-50%, -50%); background: rgba(20, 26, 40, 0.98); border: 4px solid #f1c40f; padding: 26px 28px; border-radius: 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.85); z-index: 55; width: 450px; max-width: 90vw; color: #fff;">
            <button id="hand-detail-close-btn" type="button" style="position: absolute; top: 14px; right: 14px; font-family: inherit; width: 34px; height: 34px; font-size: 20px; font-weight: bold; background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; cursor: pointer; line-height: 1;">✕</button>
            <div id="hand-detail-badge" style="display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: bold; margin-bottom: 10px;"></div>
            <h3 id="hand-detail-title" style="margin: 0 36px 12px 0; font-size: 26px; color: #f1c40f;"></h3>
            <p id="hand-detail-desc" style="margin: 0 0 16px 0; font-size: 17px; line-height: 1.55; color: #ecf0f1; white-space: pre-line;"></p>
            <div id="hand-detail-status" style="margin: 0 0 16px 0; font-size: 14px; color: #f39c12; min-height: 20px;"></div>
            <div id="hand-detail-actions" style="display: none; justify-content: flex-end; gap: 10px;">
                <button id="hand-detail-use-btn" type="button" style="font-family: inherit; width: 100%; padding: 12px 20px; font-size: 20px; font-weight: bold; background: #2ecc71; color: #fff; border: none; border-radius: 10px; cursor: pointer;">사용하기</button>
            </div>
        </div>
        <div id="territory-popup" style="display: none; font-family: inherit; position: absolute; top: 47%; left: 50%; transform: translate(-50%, -50%); background: rgba(22, 36, 52, 0.96); border: 4px solid #3498db; padding: 26px 28px; border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.75); z-index: 45; width: 700px; max-width: 92vw; color: #fff;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
                <h2 id="territory-title" style="margin: 0; font-size: 30px; color: #74b9ff;"></h2>
                <button id="territory-close-btn" type="button" style="font-family: inherit; width: 38px; height: 38px; font-size: 22px; font-weight: bold; background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.28); border-radius: 10px; cursor: pointer; line-height: 1;">✕</button>
            </div>
            <div id="territory-list" style="display: flex; flex-direction: column; gap: 10px; max-height: 440px; overflow-y: auto; padding-right: 6px;"></div>
        </div>
        <div id="territory-detail-popup" style="display: none; font-family: inherit; position: absolute; top: 48%; left: 50%; transform: translate(-50%, -50%); background: rgba(18, 28, 42, 0.98); border: 4px solid #3498db; padding: 0; border-radius: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.85); z-index: 55; width: 720px; max-width: 92vw; overflow: hidden; box-sizing: border-box; color: #fff;">
            <button id="territory-detail-close-btn" type="button" style="position: absolute; top: 14px; right: 14px; z-index: 2; font-family: inherit; width: 38px; height: 38px; font-size: 22px; font-weight: bold; background: rgba(15, 23, 42, 0.78); color: #fff; border: 1px solid rgba(255,255,255,0.35); border-radius: 10px; cursor: pointer; line-height: 1;">✕</button>
            <div id="territory-detail-bg-banner" style="display: none; width: 100%; height: 270px; background-size: cover; background-position: center; border-bottom: 2px solid rgba(255,255,255,0.18);"></div>
            <div style="padding: 22px 28px 26px 28px;">
                <h3 id="territory-detail-title" style="margin: 0 42px 8px 0; font-size: 28px; color: #74b9ff;"></h3>
                <p id="territory-detail-desc" style="margin: 0 0 12px 0; font-size: 16px; color: #e2e8f0; line-height: 1.45;"></p>
                <div id="territory-detail-meta" style="margin: 0 0 14px 0; font-size: 15px; color: #cbd5e1;"></div>
                <div id="territory-detail-stats" style="display: flex; flex-direction: column; gap: 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 12px 16px; margin-bottom: 14px; font-size: 16px;"></div>
                <div id="territory-detail-upgrades" style="display: flex; flex-direction: column; gap: 6px; font-size: 15px;"></div>
                <div id="territory-detail-portal-confirm" style="display: none; margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.18);">
                    <p id="territory-detail-portal-question" style="margin: 0 0 12px 0; font-size: 20px; font-weight: bold; color: #f1c40f; text-align: center;"></p>
                    <div style="display: flex; gap: 12px;">
                        <button id="territory-detail-portal-yes" type="button" style="font-family: inherit; flex: 1; padding: 13px 18px; font-size: 20px; font-weight: bold; background: #2ecc71; color: #fff; border: none; border-radius: 10px; cursor: pointer;">예</button>
                        <button id="territory-detail-portal-no" type="button" style="font-family: inherit; flex: 1; padding: 13px 18px; font-size: 20px; font-weight: bold; background: #7f8c8d; color: #fff; border: none; border-radius: 10px; cursor: pointer;">아니요</button>
                    </div>
                </div>
            </div>
        </div>
        <div id="portal-hint-banner" style="display: none; font-family: inherit; position: absolute; top: 150px; left: 50%; transform: translateX(-50%); background: rgba(16, 24, 38, 0.94); border: 3px solid #9b59b6; border-radius: 16px; padding: 14px 24px; box-shadow: 0 14px 32px rgba(0,0,0,0.6); z-index: 50; color: #fff; align-items: center; gap: 18px; white-space: nowrap;">
            <div>
                <div id="portal-hint-title" style="font-size: 20px; font-weight: bold; color: #d2b4de;"></div>
                <div id="portal-hint-sub" style="font-size: 14px; color: #cbd5e1; margin-top: 2px;"></div>
            </div>
            <div id="portal-hint-timer" style="font-size: 18px; font-weight: bold; color: #f39c12;"></div>
            <button id="portal-hint-cancel-btn" type="button" style="font-family: inherit; padding: 9px 16px; font-size: 15px; font-weight: bold; background: #7f8c8d; color: #fff; border: none; border-radius: 8px; cursor: pointer;"></button>
        </div>
        <div id="board-peek-container" style="display: none; position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%); z-index: 90;">
            <button id="btn-board-peek" type="button" style="font-family: inherit; padding: 12px 26px; font-size: 19px; font-weight: bold; background: rgba(20, 30, 46, 0.94); color: #f8fafc; border: 3px solid #f1c40f; border-radius: 12px; cursor: pointer; box-shadow: 0 10px 24px rgba(0,0,0,0.55);"></button>
        </div>
    `;
}

const _trackedBgCache = new Map();

/**
 * 타일 세부 배경(BG) 배너 로드 실패 시 1회 재시도(ErrorTracker) 및 안전 숨김 폴백 처리.
 */
export function applyTrackedBannerBg(bannerEl, bgPath, onStateChange = null) {
    if (!bannerEl) return;
    if (!bgPath) {
        bannerEl.dataset.pendingBg = '';
        bannerEl.style.backgroundImage = '';
        bannerEl.style.display = 'none';
        if (onStateChange) onStateChange(false);
        return;
    }

    let cached = _trackedBgCache.get(bgPath);
    if (!cached) {
        if (getCachedMarbleImage(bgPath)) {
            cached = 'ok';
            _trackedBgCache.set(bgPath, 'ok');
        } else if (isMarbleImageError(bgPath)) {
            cached = 'error';
            _trackedBgCache.set(bgPath, 'error');
        }
    }
    if (cached === 'error') {
        bannerEl.dataset.pendingBg = '';
        bannerEl.style.backgroundImage = '';
        bannerEl.style.display = 'none';
        if (onStateChange) onStateChange(false);
        return;
    }

    bannerEl.dataset.pendingBg = bgPath;
    bannerEl.style.backgroundImage = `url("${bgPath}")`;
    bannerEl.style.display = 'block';
    if (onStateChange) onStateChange(true);

    if (cached === 'ok' || typeof Image !== 'function') return;

    const probe = new Image();
    ErrorTracker.trackImage(probe, {
        critical: false,
        label: 'MarbleTileBG',
        onFallback: () => {
            _trackedBgCache.set(bgPath, 'error');
            if (bannerEl.dataset.pendingBg === bgPath) {
                bannerEl.style.backgroundImage = '';
                bannerEl.style.display = 'none';
                if (onStateChange) onStateChange(false);
            }
        }
    });
    probe.onload = () => {
        if (probe.naturalWidth > 0) {
            _trackedBgCache.set(bgPath, 'ok');
        }
    };
    probe.src = bgPath;
}

export const PopupManager = {
    _toastTimers: new Set(),
    showToast(msg, duration = 3200) {
        const container = document.getElementById('toast-popup');
        if (!container) return;

        const item = document.createElement('div');
        item.className = 'toast-item';
        item.innerText = msg;
        item.style.cssText = 'background-color: rgba(0, 0, 0, 0.88); color: #f1c40f; border: 2px solid rgba(241, 196, 15, 0.45); padding: 14px 32px; border-radius: 14px; font-size: 28px; font-weight: bold; box-shadow: 0 10px 20px rgba(0,0,0,0.5); text-align: center; pointer-events: none;';
        container.appendChild(item);

        // 동시에 너무 많은 토스트가 화면을 가리지 않도록 최대 4개까지만 유지
        while (container.children && container.children.length > 4) {
            const oldest = container.children[0];
            if (oldest.parentNode) oldest.parentNode.removeChild(oldest);
            else if (oldest.remove) oldest.remove();
            else break;
        }

        container.style.display = 'flex';
        const timerId = setTimeout(() => {
            this._toastTimers.delete(timerId);
            if (item.parentNode) item.parentNode.removeChild(item);
            else if (item.remove) item.remove();
            const current = document.getElementById('toast-popup');
            if (current && (!current.children || current.children.length === 0)) {
                current.style.display = 'none';
            }
        }, duration);
        this._toastTimers.add(timerId);
    },
    clearToasts() {
        this._toastTimers.forEach(id => clearTimeout(id));
        this._toastTimers.clear();
        const container = document.getElementById('toast-popup');
        if (container) {
            container.innerHTML = '';
            container.style.display = 'none';
        }
    },
    setEventBanner(bgPath = null) {
        const popupEl = document.getElementById('event-popup');
        const bannerEl = document.getElementById('event-bg-banner');
        if (!popupEl || !bannerEl) return;
        applyTrackedBannerBg(bannerEl, bgPath, (visible) => {
            if (visible) {
                popupEl.style.minWidth = '';
                popupEl.style.width = '820px';
                popupEl.style.padding = '24px 30px 28px 30px';
            } else {
                popupEl.style.minWidth = '';
                popupEl.style.width = '';
                popupEl.style.padding = '36px 40px';
            }
        });
    },
    showChoicePopup(title, desc, buttonsConfig, bgPath = null) {
        this.closeAll();
        this.setEventBanner(bgPath);
        document.getElementById('event-popup').style.display = 'block';
        document.getElementById('event-title').innerText = title;
        document.getElementById('event-title').style.color = '#f1c40f';
        document.getElementById('event-desc').innerText = desc;
        document.getElementById('crisis-buttons').style.display = 'none';
        document.getElementById('close-buttons').style.display = 'none';
        document.getElementById('event-timer').style.display = 'block';
        const btnContainer = document.getElementById('buy-buttons');
        btnContainer.style.display = 'flex';
        btnContainer.style.width = '';
        btnContainer.innerHTML = '';

        const makeChoiceBtn = (cfg) => {
            const btn = document.createElement('button');
            btn.innerText = cfg.text;
            const isDisabled = Boolean(cfg.disabled);
            btn.disabled = isDisabled;
            btn.style.cssText = `font-family: inherit; padding: 12px 14px; background: ${cfg.color}; color: #fff; border: none; border-radius: 8px; font-size: 16px; cursor: ${isDisabled ? 'not-allowed' : 'pointer'}; opacity: ${isDisabled ? '0.45' : '1'};`;
            if (!isDisabled && typeof cfg.action === 'function') {
                btn.onclick = cfg.action;
            }
            return btn;
        };

        const hasRowLayout = Array.isArray(buttonsConfig) && buttonsConfig.some(cfg => cfg && cfg.row !== undefined);
        if (hasRowLayout) {
            btnContainer.style.flexDirection = 'column';
            btnContainer.style.gap = '10px';
            btnContainer.style.width = '100%';
            const rows = [...new Set(buttonsConfig.map(c => c.row ?? 1))].sort((a, b) => a - b);
            rows.forEach(rowId => {
                const rowItems = buttonsConfig.filter(c => (c.row ?? 1) === rowId);
                const rowDiv = document.createElement('div');
                const hasLeftRight = rowItems.some(c => c.align === 'left' || c.align === 'right');
                rowDiv.style.cssText = `display: flex; width: 100%; gap: 8px; flex-wrap: wrap; justify-content: ${hasLeftRight ? 'space-between' : 'center'}; align-items: stretch;`;
                rowItems.forEach(cfg => {
                    const btn = makeChoiceBtn(cfg);
                    if (cfg.align === 'right') btn.style.marginLeft = 'auto';
                    if (rowItems.length === 1 && !cfg.align) {
                        btn.style.flex = '1';
                        btn.style.width = '100%';
                        btn.style.textAlign = 'left';
                        btn.style.whiteSpace = 'pre-line';
                        btn.style.lineHeight = '1.45';
                    }
                    rowDiv.appendChild(btn);
                });
                btnContainer.appendChild(rowDiv);
            });
        } else {
            btnContainer.style.flexDirection = 'row';
            btnContainer.style.flexWrap = 'wrap';
            btnContainer.style.gap = '10px';
            buttonsConfig.forEach(cfg => {
                btnContainer.appendChild(makeChoiceBtn(cfg));
            });
        }
    },
    showNormalPopup(title, desc, showCloseBtn, onEndCallback, bgPath = null, hideUpperTimer = true, uiOpts = null) {
        this.closeAll();
        this.setEventBanner(bgPath);
        const text = pickLangDict(MarbleLang, LangState.current);
        document.getElementById('event-popup').style.display = 'block';
        document.getElementById('event-title').innerText = title;
        document.getElementById('event-title').style.color = uiOpts?.titleColor || '#fff';
        document.getElementById('event-desc').innerText = desc;
        document.getElementById('buy-buttons').style.display = 'none';
        document.getElementById('crisis-buttons').style.display = 'none';
        document.getElementById('event-timer').style.display = (showCloseBtn && !hideUpperTimer) ? 'block' : 'none';
        const closeBtn = document.getElementById('close-btn');
        if (showCloseBtn) {
            document.getElementById('close-buttons').style.display = 'block';
            if (closeBtn) {
                const baseLabel = uiOpts?.confirmText || text.CLOSE;
                closeBtn.dataset.baseLabel = baseLabel;
                closeBtn.innerText = baseLabel;
                closeBtn.style.background = uiOpts?.buttonColor || '#3498db';
                closeBtn.style.border = uiOpts?.borderColor ? `2px solid ${uiOpts.borderColor}` : 'none';
                closeBtn.disabled = false;
                closeBtn.onclick = onEndCallback;
            }
        } else {
            document.getElementById('close-buttons').style.display = 'none';
        }
    },
    showBuyPopup(tile, costs, playerMoney, onBuyCallback, onCancelCallback, maxAllowedLvl = null, bgPath = null) {
        this.closeAll();
        this.setEventBanner(bgPath);
        const popupEl = document.getElementById('event-popup');
        if (popupEl) {
            popupEl.style.minWidth = '820px';
            popupEl.style.width = 'auto';
            popupEl.style.maxWidth = '92vw';
        }
        const text = pickLangDict(MarbleLang, LangState.current);
        const gText = pickLangDict(GimmickLang, LangState.current);
        const timeBadge = tile.timeType === 'day' ? ` [${gText.TILE_TIME_DAY}]` : (tile.timeType === 'night' ? ` [${gText.TILE_TIME_NIGHT}]` : '');
        document.getElementById('event-popup').style.display = 'block';
        document.getElementById('event-title').innerText = `${getTileName(tile)}${timeBadge} ${text.BUY_TITLE}`;
        document.getElementById('event-title').style.color = '#3498db';
        document.getElementById('event-desc').innerText = text.BUY_DESC;
        document.getElementById('crisis-buttons').style.display = 'none';
        document.getElementById('close-buttons').style.display = 'none';
        document.getElementById('event-timer').style.display = 'block';
        const buyBtns = document.getElementById('buy-buttons');
        buyBtns.style.display = 'flex';
        buyBtns.style.flexDirection = 'column';
        buyBtns.style.flexWrap = 'nowrap';
        buyBtns.style.gap = '12px';
        buyBtns.style.width = '100%';
        const firstVisitMax = Number.isInteger(maxAllowedLvl)
            ? maxAllowedLvl
            : (getModeConfig(resolveRenderWorld()?.gameMode).firstVisitMaxLevel || 2);
        let rowBtnsHTML = '';
        const actionBtnStyle = (bg) => `font-family: inherit; flex: 1 1 auto; white-space: nowrap; padding: 14px 10px; font-size: 16px; font-weight: bold; background: ${bg}; color: #fff; border: none; border-radius: 8px; cursor: pointer;`;
        if (tile.level === 3) {
            const canAfford = playerMoney >= costs[4];
            const bg = canAfford ? '#f1c40f' : '#7f8c8d';
            rowBtnsHTML += `<button class="action-btn" data-level="4" data-afford="${canAfford}" style="${actionBtnStyle(bg)}">${text.BLD_4} (${formatMoney(costs[4])})</button>`;
        } else if (tile.level === 2) {
            const canAfford = playerMoney >= costs[3];
            const bg = canAfford ? '#2ecc71' : '#7f8c8d';
            rowBtnsHTML += `<button class="action-btn" data-level="3" data-afford="${canAfford}" style="${actionBtnStyle(bg)}">${text.BLD_3} (${formatMoney(costs[3])})</button>`;
        } else {
            const maxInitLvl = Math.min(3, firstVisitMax);
            const textLv = [text.BLD_0, text.BLD_1, text.BLD_2, text.BLD_3];
            const colors = ['#95a5a6', '#e74c3c', '#3498db', '#2ecc71'];
            for (let l = 0; l <= maxInitLvl; l++) {
                if (tile.level < l) {
                    const canAfford = playerMoney >= costs[l];
                    const bg = canAfford ? colors[l] : '#7f8c8d';
                    rowBtnsHTML += `<button class="action-btn" data-level="${l}" data-afford="${canAfford}" style="${actionBtnStyle(bg)}">${textLv[l]} (${formatMoney(costs[l])})</button>`;
                }
            }
        }
        const btnsHTML = `
            <div style="display: flex; flex-wrap: nowrap; gap: 10px; width: 100%; justify-content: center;">
                ${rowBtnsHTML}
            </div>
            <button id="cancel-btn" style="font-family: inherit; padding: 14px; font-size: 18px; font-weight: bold; background: #7f8c8d; color: #fff; border: none; border-radius: 8px; width: 100%; cursor: pointer;">${text.BUY_CANCEL}</button>
        `;
        buyBtns.innerHTML = btnsHTML;
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.onclick = (e) => {
                const canAfford = e.currentTarget.dataset.afford === 'true';
                if (!canAfford) { PopupManager.showToast(text.NOT_ENOUGH_MONEY, 2000); return; }
                onBuyCallback(parseInt(e.currentTarget.dataset.level, 10));
            };
        });
        document.getElementById('cancel-btn').onclick = onCancelCallback;
    },
    showCrisisPopup(toll, canSellCover, onSell, onLoan) {
        this.closeAll();
        this.setEventBanner(null);
        const text = pickLangDict(MarbleLang, LangState.current);
        document.getElementById('event-popup').style.display = 'block';
        document.getElementById('event-title').innerText = text.CRISIS_TITLE;
        document.getElementById('event-title').style.color = '#e74c3c';
        const desc = canSellCover
            ? `${text.CRISIS_DESC_SELL_OR_LOAN}<br>(${text.CRISIS_REQ_LABEL} ${formatMoney(toll)})`
            : `${text.CRISIS_DESC_LOAN_ONLY}<br>(${text.CRISIS_REQ_LABEL} ${formatMoney(toll)})`;
        document.getElementById('event-desc').innerHTML = desc;
        document.getElementById('buy-buttons').style.display = 'none';
        document.getElementById('close-buttons').style.display = 'none';
        document.getElementById('event-timer').style.display = 'block';
        const crisisBtns = document.getElementById('crisis-buttons');
        crisisBtns.style.display = 'flex';
        const sellBtn = document.getElementById('crisis-sell-btn');
        const loanBtn = document.getElementById('crisis-loan-btn');
        if (!canSellCover) sellBtn.style.display = 'none';
        else { sellBtn.style.display = 'block'; sellBtn.onclick = onSell; }
        loanBtn.onclick = onLoan;
    },
    showSellPopup(ownedTiles, requiredAmount, getSellValueFunc, onConfirm, onCancel) {
        this.closeAll();
        const text = pickLangDict(MarbleLang, LangState.current);
        document.getElementById('sell-popup').style.display = 'block';
        document.getElementById('sell-main-title').innerText = text.SELL_TITLE;
        document.getElementById('sell-req-text').innerText = `${text.SELL_TARGET} ${formatMoney(requiredAmount)}`;
        document.getElementById('sell-cancel-btn').innerText = text.SELL_BACK;
        const grid = document.getElementById('sell-grid');
        grid.innerHTML = '';
        let selectedTotal = 0;
        const selectedTiles = new Set();
        const sumText = document.getElementById('sell-sum-text');
        const confirmBtn = document.getElementById('sell-confirm-btn');
        confirmBtn.innerText = text.SELL_CONFIRM;
        const updateTotal = () => {
            sumText.innerText = `${text.SELL_SELECTED} ${formatMoney(selectedTotal)}`;
            if (selectedTotal >= requiredAmount) { confirmBtn.style.background = '#2ecc71'; confirmBtn.disabled = false; }
            else { confirmBtn.style.background = '#7f8c8d'; confirmBtn.disabled = true; }
        };
        ownedTiles.forEach(t => {
            const sellVal = getSellValueFunc(t);
            const row = document.createElement('label');
            row.style.cssText = 'display: flex; justify-content: space-between; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 8px; cursor: pointer;';
            row.innerHTML = `<span><input type="checkbox" value="${t.id}"> ${escapeHtml(getTileName(t))}</span><span style="color: #f1c40f;">+${formatMoney(sellVal)}</span>`;
            row.querySelector('input').onchange = (e) => {
                if (e.target.checked) { selectedTotal += sellVal; selectedTiles.add(t); }
                else { selectedTotal -= sellVal; selectedTiles.delete(t); }
                updateTotal();
            };
            grid.appendChild(row);
        });
        updateTotal();
        confirmBtn.onclick = () => onConfirm(Array.from(selectedTiles));
        document.getElementById('sell-cancel-btn').onclick = () => { document.getElementById('sell-popup').style.display = 'none'; onCancel(); };
    },
    showInventoryPopup(inventory, onUseCallback, onCancelCallback) {
        this.closeAll();
        const cText = pickLangDict(CardUILang, LangState.current);
        const mText = pickLangDict(MarbleLang, LangState.current);
        document.getElementById('target-popup').style.display = 'block';
        document.getElementById('target-title').innerText = cText.INV_TITLE;
        document.getElementById('target-desc').innerText = cText.INV_DESC;
        const cancelBtn = document.getElementById('target-cancel-btn');
        cancelBtn.style.display = 'block';
        cancelBtn.innerText = mText.TARGET_CANCEL;
        const grid = document.getElementById('target-grid');
        grid.innerHTML = '';
        inventory.forEach(card => {
            const theme = getCardGradeTheme(card);
            const btn = document.createElement('button');
            btn.innerHTML = `<b style="color:${theme.accent}; font-size: 20px;">${escapeHtml(formatCardDisplayTitle(card))}</b><br><span style="font-size:14px;">${escapeHtml(card.desc)}</span>`;
            btn.style.cssText = `font-family: inherit; padding: 15px 10px; background: ${theme.cardBg}; color: white; border: 2px solid ${theme.border}; border-radius: 8px; cursor: pointer; text-align: left;`;
            btn.onclick = () => onUseCallback(card);
            grid.appendChild(btn);
        });
        cancelBtn.onclick = onCancelCallback;
    },
    showTargetPopup(title, desc, targets, onSelectCallback, onCancelCallback) {
        this.closeAll();
        const mText = pickLangDict(MarbleLang, LangState.current);
        document.getElementById('target-popup').style.display = 'block';
        document.getElementById('target-title').innerText = title;
        document.getElementById('target-desc').innerText = desc;
        const cancelBtn = document.getElementById('target-cancel-btn');
        if (onCancelCallback) {
            cancelBtn.style.display = 'block';
            cancelBtn.innerText = mText.TARGET_CANCEL;
            cancelBtn.onclick = onCancelCallback;
        } else {
            cancelBtn.style.display = 'none';
            cancelBtn.onclick = null;
        }
        const grid = document.getElementById('target-grid');
        grid.innerHTML = '';
        targets.forEach(t => {
            const btn = document.createElement('button');
            btn.innerText = t.name;
            const isDisabled = Boolean(t.disabled);
            const bg = isDisabled ? '#7f8c8d' : (t.color || '#2c3e50');
            const cursor = isDisabled ? 'not-allowed' : 'pointer';
            const opacity = isDisabled ? '0.45' : '1.0';
            btn.disabled = isDisabled;
            btn.style.cssText = `font-family: inherit; padding: 15px; font-size: 18px; background: ${bg}; color: white; border: 2px solid #fff; border-radius: 8px; cursor: ${cursor}; opacity: ${opacity};`;
            if (!isDisabled) {
                btn.onclick = () => onSelectCallback(t.id);
            }
            grid.appendChild(btn);
        });
    },
    showPortalPopup(tiles, onSelectCallback, onCancelCallback, reqFee = 0, isFree = false) {
        this.closeAll();
        const text = pickLangDict(MarbleLang, LangState.current);
        document.getElementById('portal-popup').style.display = 'block';
        const feeStr = isFree ? text.PORTAL_FREE : formatMoney(reqFee);
        document.getElementById('portal-desc').innerText = `${text.PORTAL_FEE_LABEL} ${feeStr} / ${text.PORTAL_DESC}`;
        const grid = document.getElementById('portal-grid');
        grid.innerHTML = '';
        tiles.filter(t => t.id !== BOARD_TILES.BBANGJU && !t.isDisabled && t.type !== 'disabled').forEach(t => {
            const btn = document.createElement('button');
            btn.innerText = getTileName(t);
            btn.style.cssText = `font-family: inherit; padding: 10px; font-size: 16px; background: ${t.type === 'normal' ? '#2c3e50' : '#8e44ad'}; color: white; border: 2px solid #fff; border-radius: 8px; cursor: pointer;`;
            btn.onclick = () => onSelectCallback(t.id);
            grid.appendChild(btn);
        });
        document.getElementById('portal-cancel-btn').onclick = onCancelCallback;
    },
    showVoidGamePopup(challenge, onRollCallback) {
        this.closeAll();
        const cText = pickLangDict(CardUILang, LangState.current);
        const popup = document.getElementById('void-game-popup');
        if (!popup) return;
        const targetNum = Number(challenge?.target) || 7;
        const isUp = challenge?.direction !== 'down';

        popup.style.display = 'block';
        const titleEl = document.getElementById('void-game-title');
        const subEl = document.getElementById('void-game-subtitle');
        const numEl = document.getElementById('void-game-number');
        const dirEl = document.getElementById('void-game-dir');
        const descEl = document.getElementById('void-game-desc');
        const rollBtn = document.getElementById('void-game-roll-btn');

        if (titleEl) titleEl.innerText = cText.SHAYDI_GAME_TITLE || '셰이디의 장난';
        if (subEl) subEl.innerText = cText.SHAYDI_GAME_SUBTITLE || '심심한데 나랑 게임하나 하고갈래?';
        if (numEl) numEl.innerText = `${targetNum}`;
        if (dirEl) {
            dirEl.innerText = isUp ? (cText.SHAYDI_GAME_UP || '업') : (cText.SHAYDI_GAME_DOWN || '다운');
            dirEl.style.color = isUp ? '#2ecc71' : '#ff7675';
        }
        if (descEl) {
            descEl.innerText = isUp
                ? (cText.SHAYDI_GAME_DESC_UP || '주사위를 굴려서 제시된 숫자보다 큰 숫자를 띄우면 즉시 탈출!')
                : (cText.SHAYDI_GAME_DESC_DOWN || '주사위를 굴려서 제시된 숫자보다 작은 숫자를 띄우면 즉시 탈출!');
        }
        if (rollBtn) {
            rollBtn.innerText = cText.SHAYDI_GAME_ROLL_BTN || '주사위 굴리기';
            rollBtn.disabled = false;
            rollBtn.onclick = () => {
                rollBtn.disabled = true;
                if (typeof onRollCallback === 'function') onRollCallback();
            };
        }
    },
    showPortalBoardPrompt(onCancelCallback, reqFee = 0, isFree = false) {
        this.closeAll();
        const text = pickLangDict(MarbleLang, LangState.current);
        const banner = document.getElementById('portal-hint-banner');
        const titleEl = document.getElementById('portal-hint-title');
        const subEl = document.getElementById('portal-hint-sub');
        const cancelBtn = document.getElementById('portal-hint-cancel-btn');
        if (!banner) return;
        const feeStr = isFree ? text.PORTAL_FREE : formatMoney(reqFee);
        if (titleEl) titleEl.innerText = `🚀 ${text.PORTAL_BOARD_GUIDE || '이동할 칸을 보드판에서 직접 선택해주세요.'}`;
        if (subEl) subEl.innerText = `${text.PORTAL_TITLE} (${text.PORTAL_FEE_LABEL} ${feeStr})`;
        if (cancelBtn) {
            cancelBtn.innerText = text.PORTAL_CANCEL || '포기하기';
            cancelBtn.onclick = onCancelCallback;
        }
        banner.style.display = 'flex';
    },
    closeAll() {
        this.setEventBanner(null);
        ['event-popup', 'portal-popup', 'portal-hint-banner', 'sell-popup', 'target-popup', 'void-game-popup'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }
};

export function renderBoardState(ctx, boardImg, tiles, allPlayers, worldState = null) {
    ctx.clearRect(0, 0, 1080, 1080);
    if (boardImg && boardImg.complete && boardImg.naturalWidth > 0) {
        ctx.drawImage(boardImg, 0, 0, 1080, 1080);
    } else {
        ctx.fillStyle = '#f5efe0';
        ctx.fillRect(0, 0, 1080, 1080);
        ctx.strokeStyle = '#c8b89a';
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, 1072, 1072);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const currentFont = SettingsManager.getCanvasFont();
    const { isOverridden, currentTime } = resolveGimmickStatus(worldState);
    const gText = pickLangDict(GimmickLang, LangState.current);
    const playerById = new Map(allPlayers.map(p => [p.id, p]));
    const gridN = getModeConfig(resolveRenderWorld(worldState).gameMode || 'ember').gridUnits || 13;
    const U = 1080 / gridN;
    const nameFontSize = Math.max(16, Math.round(U * 0.25));
    const timeFontSize = Math.max(12, Math.round(U * 0.16));
    const maxTextWidth = U * 1.45;
    const bandAvoidOffset = U * 0.2;

    tiles.forEach(tile => {
        if (tile.isDisabled || tile.type === 'disabled') return;

        // 코너 4칸(0,10,20,30)과 차원 열쇠 칸(card)은 보드판 텍스트 미표시
        const shouldDrawText = (tile.id % 10 !== 0) && (tile.type !== 'card');
        if (shouldDrawText) {
            let textX = tile.x;
            let textY = tile.y;
            if (tile.side === 0) textY += bandAvoidOffset;
            else if (tile.side === 1) textX -= bandAvoidOffset;
            else if (tile.side === 2) textY -= bandAvoidOffset;
            else if (tile.side === 3) textX += bandAvoidOffset;

            const hasTimeTag = tile.timeType === 'day' || tile.timeType === 'night';
            const nameOffsetY = hasTimeTag ? -Math.round(U * 0.11) : 0;
            const timeOffsetY = Math.round(U * 0.17);

            ctx.save();
            ctx.translate(textX, textY);
            if (tile.side === 0 || tile.side === 2) {
                ctx.rotate(-Math.PI / 2);
            }

            ctx.font = `bold ${nameFontSize}px ${currentFont}`;
            ctx.fillStyle = '#2c3e50';
            ctx.fillText(getTileName(tile, worldState), 0, nameOffsetY, maxTextWidth);

            // 시간대 속성(낮/밤) 표시 (그을음/빛무리 진행 중에는 우선도에 의해 비활성 흐림 표시)
            if (hasTimeTag) {
                const isMatched = !isOverridden && currentTime === tile.timeType;
                ctx.font = `bold ${timeFontSize}px ${currentFont}`;
                if (isOverridden) {
                    ctx.fillStyle = '#7f8c8d';
                } else {
                    ctx.fillStyle = tile.timeType === 'day'
                        ? (isMatched ? '#e67e22' : '#d35400')
                        : (isMatched ? '#8e44ad' : '#2980b9');
                }
                ctx.fillText(tile.timeType === 'day' ? gText.TILE_TIME_DAY : gText.TILE_TIME_NIGHT, 0, timeOffsetY, maxTextWidth);
            }
            ctx.restore();
        }

        const ownerObj = (tile.owner && typeof tile.owner === 'object')
            ? tile.owner
            : (tile.ownerId !== undefined && tile.ownerId !== null ? playerById.get(tile.ownerId) : null);

        if (ownerObj) {
            ctx.fillStyle = ownerObj.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            let dx = 0, dy = 0; const offsetDist = U * 0.8;
            if (tile.side === 0) dy = -offsetDist;
            else if (tile.side === 1) dx = offsetDist;
            else if (tile.side === 2) dy = offsetDist;
            else if (tile.side === 3) dx = -offsetDist;
            const tx = tile.x + dx; const ty = tile.y + dy;

            ctx.beginPath();
            let shapeLevel = tile.level;
            if (tile.type === 'special_buy' || tile.type === 'bread') shapeLevel = 4;
            const r = Math.max(12, Math.round(U * 0.17));
            if (shapeLevel === 0) ctx.arc(tx, ty, r, 0, Math.PI * 2);
            else if (shapeLevel === 1) { ctx.moveTo(tx, ty - r); ctx.lineTo(tx + r, ty + r); ctx.lineTo(tx - r, ty + r); }
            else if (shapeLevel === 2) ctx.rect(tx - r, ty - r, r * 2, r * 2);
            else if (shapeLevel === 3) { for (let i = 0; i < 5; i++) ctx.lineTo(tx + r * Math.cos(i * 2 * Math.PI / 5 - Math.PI / 2), ty + r * Math.sin(i * 2 * Math.PI / 5 - Math.PI / 2)); }
            else if (shapeLevel === 4) { for (let i = 0; i < 6; i++) ctx.lineTo(tx + r * Math.cos(i * 2 * Math.PI / 6 - Math.PI / 2), ty + r * Math.sin(i * 2 * Math.PI / 6 - Math.PI / 2)); }
            ctx.closePath(); ctx.fill(); ctx.stroke();
        }
    });

    const getOffset = (totalCount, index) => {
        const d = 18;
        if (totalCount === 1) return { x: 0, y: 0 };
        if (totalCount === 2) return index === 0 ? { x: 0, y: -d } : { x: 0, y: d };
        if (totalCount === 3) { if (index === 0) return { x: -d, y: d }; if (index === 1) return { x: d, y: d }; return { x: 0, y: -d }; }
        if (totalCount >= 4) { if (index === 0) return { x: -d, y: -d }; if (index === 1) return { x: d, y: -d }; if (index === 2) return { x: -d, y: d }; return { x: d, y: d }; }
        return { x: 0, y: 0 };
    };

    const tileOccupants = Array.from({ length: 40 }, () => []);
    allPlayers.forEach(p => {
        if (tiles[p.pos]) tileOccupants[p.pos].push(p);
    });
    tileOccupants.forEach((occupants, pos) => {
        if (occupants.length === 0) return;
        const targetTile = tiles[pos];
        occupants.forEach((player, idx) => {
            const offset = getOffset(occupants.length, idx);
            ctx.fillStyle = player.color; ctx.beginPath();
            ctx.arc(targetTile.x + offset.x, targetTile.y + offset.y, 16, 0, Math.PI * 2);
            ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        });
    });
}

export function showSettlementPopup(results, onReturnCallback, customBtnLabel = null) {
    const sText = pickLangDict(SettlementLang, LangState.current);
    const uiLayer = document.getElementById('ui-layer') || document.getElementById('app') || document.body;
    const prev = document.getElementById('settlement-popup');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.id = 'settlement-popup';
    overlay.style.cssText = 'position: absolute; inset: 0; background: rgba(10, 14, 22, 0.92); z-index: 95; display: flex; justify-content: center; align-items: center; color: #fff; font-family: inherit; padding: 20px; box-sizing: border-box;';

    const panel = document.createElement('div');
    panel.style.cssText = 'width: min(1480px, 95%); height: min(900px, 92%); background: #1a2332; border: 4px solid #f1c40f; border-radius: 20px; padding: 26px 32px; box-sizing: border-box; display: flex; flex-direction: column; box-shadow: 0 24px 60px rgba(0,0,0,0.8);';

    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #2e3e57; padding-bottom: 16px; margin-bottom: 18px;">
            <div>
                <h1 style="margin:0; font-size:40px; color:#f1c40f;">${sText.TITLE}</h1>
                <p style="margin:6px 0 0 0; font-size:18px; color:#bdc3c7;">${sText.SUBTITLE}</p>
            </div>
            <div style="font-size:16px; color:#95a5a6;">${sText.TAB_DETAIL_HINT}</div>
        </div>
        <div id="settlement-tabs" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin-bottom:18px;"></div>
        <div id="settlement-detail" style="flex:1; overflow-y:auto; padding-right:8px; display:grid; grid-template-columns: 1fr; gap:14px; align-content:start;"></div>
        <div id="settlement-summary" style="margin-top:16px; padding-top:14px; border-top:2px solid #2e3e57; display:flex; justify-content:space-between; align-items:center;">
            <div id="settlement-summary-metrics" style="display:flex; gap:32px; font-size:22px;"></div>
            <button id="settlement-return-btn" style="font-family:inherit; padding:16px 36px; font-size:24px; font-weight:bold; background:#2ecc71; color:#fff; border:none; border-radius:12px; cursor:pointer;">${escapeHtml(customBtnLabel || sText.BTN_MAINMENU)}</button>
        </div>
    `;

    overlay.appendChild(panel);
    uiLayer.appendChild(overlay);

    const tabsEl = panel.querySelector('#settlement-tabs');
    const detailEl = panel.querySelector('#settlement-detail');
    const metricsEl = panel.querySelector('#settlement-summary-metrics');
    let selectedIndex = 0;

    const renderSelected = () => {
        tabsEl.innerHTML = '';
        results.forEach((res, idx) => {
            const isActiveTab = idx === selectedIndex;
            const statusText = res.isBankruptFinal ? sText.BANKRUPT_BADGE : sText.SURVIVED_BADGE;
            const statusBg = res.isBankruptFinal ? '#c0392b' : '#27ae60';
            const btn = document.createElement('button');
            btn.style.cssText = `font-family:inherit; text-align:left; padding:12px 16px; border-radius:12px; cursor:pointer; background:${isActiveTab ? '#28364a' : '#141c28'}; border:3px solid ${isActiveTab ? res.player.color : '#2e3e57'}; color:#fff;`;
            btn.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="font-size:20px; font-weight:bold; color:#f1c40f;">${idx + 1}${sText.RANK_SUFFIX}</span>
                    <span style="font-size:13px; background:${statusBg}; color:#fff; padding:2px 8px; border-radius:6px;">${statusText}</span>
                </div>
                <div style="font-size:22px; font-weight:bold; color:${res.player.color}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(res.player.name)}</div>
                <div style="font-size:18px; color:#ecf0f1; margin-top:4px;">${formatMoney(res.netWorth)}</div>
            `;
            btn.onclick = () => {
                selectedIndex = idx;
                renderSelected();
            };
            tabsEl.appendChild(btn);
        });

        const cur = results[selectedIndex];
        if (!cur) return;
        detailEl.innerHTML = (cur.categories || []).map(cat => `
            <div style="background:#141c28; border:1px solid #2e3e57; border-radius:12px; padding:14px 18px;">
                <h3 style="margin:0 0 10px 0; font-size:20px; color:#f39c12; border-bottom:1px solid #2e3e57; padding-bottom:6px;">${escapeHtml(cat.title)}</h3>
                <div style="display:flex; flex-direction:column; gap:8px; font-size:16px;">
                    ${(cat.items || []).map(item => {
                        const color = item.isNegative ? '#e74c3c' : (item.isActive ? '#2ecc71' : '#7f8c8d');
                        return `<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; color:${color};">
                            <span style="text-align:left;">${escapeHtml(item.label)}</span>
                            <span style="font-weight:bold; white-space:nowrap; text-align:right;">${escapeHtml(item.formula)}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `).join('');

        metricsEl.innerHTML = `
            <div>${sText.SUMMARY_TOTAL_ASSET}: <b style="color:#2ecc71;">${formatMoney(cur.totalAsset)}</b></div>
            <div>${sText.SUMMARY_TOTAL_DEBT}: <b style="color:#e74c3c;">-${formatMoney(cur.totalLoan)}</b></div>
            <div>${sText.SUMMARY_FINAL_WORTH}: <b style="color:#f1c40f;">${formatMoney(cur.netWorth)}</b></div>
        `;
    };

    renderSelected();
    panel.querySelector('#settlement-return-btn').onclick = () => {
        overlay.remove();
        if (onReturnCallback) onReturnCallback();
    };
}
