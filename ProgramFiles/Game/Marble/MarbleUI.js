import { SettingsManager } from '../../System/System.js';
import { LangState } from '../../System/LanguageManager.js';
import { MarbleLang } from '../../System/Index/Marble/MarbleUIIndex.js';
import { GimmickLang } from '../../System/Index/Marble/MarbleGimmickIndex.js';
import { BOARD_TILES } from '../../System/Index/Marble/MarbleBoardIndex.js';
import { GAME_CONSTANTS, getModeConfig } from '../../System/Index/Marble/MarblePriceIndex.js';
import { CardUILang, formatCardDisplayTitle, getCardGradeTheme } from '../../System/Index/Marble/MarbleCardUIIndex.js';
import { SettlementLang } from '../../System/Index/Marble/MarbleSettlementIndex.js';
import { escapeHtml } from '../../Lobby/LobbyUI.js';
import { ErrorTracker } from '../../System/ErrorTracker.js';
import { getCachedMarbleImage, isMarbleImageError, MARBLE_BUILDING_ASSETS } from './MarbleAssetLoader.js';
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

export function renderGameLogRowsHtml(logs = []) {
    const safeLogs = Array.isArray(logs) ? logs : [];
    if (safeLogs.length === 0) {
        return `<div class="hud-log-row" style="color:#724929;">게임이 시작되었습니다.</div>`;
    }
    return safeLogs.map((entry) => {
        if (typeof entry === 'string') {
            return `<div class="hud-log-row">${escapeHtml(entry)}</div>`;
        }
        const turnNum = entry?.turn ?? 1;
        const msgText = entry?.text ?? entry?.message ?? '';
        return `<div class="hud-log-row"><b style="color:#B84214;">[${escapeHtml(String(turnNum))}T]</b> ${escapeHtml(String(msgText))}</div>`;
    }).join('');
}

export function createPlayerUI(player, worldState = null, logOptions = null) {
    const text = pickLangDict(MarbleLang, LangState.current);
    const badgesHtml = buildPlayerBadgesHtml(player, false, worldState);
    const disconnectTag = player.isConnected === false
        ? `<span style="font-size: 13px; background: #C0392B; color: #fff; padding: 2px 7px; border-radius: 6px; margin-left: 8px; vertical-align: middle; font-weight: 800;">OFFLINE</span>`
        : '';
    const minimiSrc = player.minimiPath || './Resource/Texture/Minimi/Minimi_Erpin.webp';
    const isLogExpanded = Boolean(logOptions?.isExpanded);
    const logs = Array.isArray(logOptions?.logs) ? logOptions.logs : [];
    const logRowsHtml = renderGameLogRowsHtml(logs);
    const logWidgetHtml = isLogExpanded
        ? `
            <div class="hud-log-panel">
                <div class="hud-log-header">
                    <span>📜 게임로그</span>
                    <button type="button" id="btn-hud-log-collapse" class="hud-log-collapse-btn">축소 ▼</button>
                </div>
                <div id="hud-log-feed" class="hud-log-body td-scroll">${logRowsHtml}</div>
            </div>
        `
        : `
            <button type="button" id="btn-hud-log-open" class="td-btn td-btn-wood" style="padding: 9px 18px; font-size: 16px; border-width: 2.5px;">📜 게임로그</button>
        `;

    return `
        <div class="hud-my-wrap" style="position: absolute; bottom: 34px; left: 34px; display: flex; align-items: flex-end; gap: 14px; z-index: 8;">
            <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 10px;">
                ${logWidgetHtml}
                <div style="width: 460px; min-height: 158px; padding: 16px 20px; display: flex; align-items: center; gap: 16px; background: linear-gradient(180deg, #FFF9EB 0%, #F5E1B6 100%); border: 5px solid #4E2812; border-radius: 24px; box-shadow: 0 14px 32px rgba(45, 22, 8, 0.34); box-sizing: border-box; color: #3D2010;">
                    <div style="width: 8px; align-self: stretch; border-radius: 999px; flex-shrink: 0; background: ${player.color};"></div>
                    <div style="width: 108px; height: 108px; border-radius: 18px; background: radial-gradient(circle at 50% 40%, #FFFDF5 0%, #EED49B 100%); border: 4px solid ${player.color}; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; padding: 4px; box-sizing: border-box;">
                        <img src="${escapeHtml(minimiSrc)}" alt="${escapeHtml(player.name)}" style="width: 100%; height: 100%; object-fit: contain;" />
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 28px; font-weight: 900; color: #3D2010; line-height: 1.1;">${escapeHtml(player.name)}${disconnectTag}</div>
                        ${badgesHtml}
                        <div style="margin-top: 6px; font-size: 18px; font-weight: 800; color: #5B3318;">💰 ${player.money.toLocaleString()} ${escapeHtml(text.CURRENCY || '엘드르 달러')}</div>
                        <div style="font-size: 17px; font-weight: 800; color: #724929;">🗺️ 보유 영토 ${player.territoryCount}${text.EA}</div>
                    </div>
                </div>
            </div>
            <button id="btn-territories" type="button" class="td-btn td-btn-blue" style="font-family: inherit; padding: 20px 32px; font-size: 26px; font-weight: 900; cursor: pointer; border-radius: 14px; border: 3px solid #C7D0FF; background: linear-gradient(135deg, #5E72E4, #4959C9); color: white; box-shadow: 0 6px 14px rgba(43, 56, 145, 0.3); white-space: nowrap; flex-shrink: 0;">${text.BTN_TERRITORIES || '🗺️ 보유영토'}</button>
        </div>
    `;
}

export function createNpcUIList(npcs, worldState = null) {
    const text = pickLangDict(MarbleLang, LangState.current);
    let html = `<div class="hud-npc-stack" style="position: absolute; top: 28px; left: 34px; display: flex; flex-direction: column; gap: 11px; z-index: 8;">`;
    npcs.forEach(npc => {
        const badgesHtml = buildPlayerBadgesHtml(npc, true, worldState);
        const offlineBadge = (!npc.isAi && npc.isConnected === false)
            ? `<span style="font-size: 10px; background: #C0392B; color: #fff; padding: 2px 5px; border-radius: 6px; margin-left: 6px; font-weight: 800;">OFFLINE</span>`
            : '';
        const minimiSrc = npc.minimiPath || './Resource/Texture/Minimi/Minimi_Sylla.webp';
        const terrCount = Number(npc.territoryCount) || 0;
        html += `
            <div style="width: 344px; min-height: 100px; padding: 10px 13px; display: flex; align-items: center; gap: 12px; background: linear-gradient(180deg, #FFF9EB 0%, #F7E7C4 100%); border: 4px solid #5D3117; border-radius: 18px; box-shadow: 0 10px 22px rgba(45, 22, 8, 0.28); box-sizing: border-box; color: #3D2010;">
                <div style="width: 8px; align-self: stretch; border-radius: 999px; flex-shrink: 0; background: ${npc.color};"></div>
                <div style="width: 64px; height: 64px; border-radius: 14px; background: radial-gradient(circle at 50% 40%, #FFFDF5 0%, #EFD8A7 100%); border: 3px solid ${npc.color}; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; padding: 3px; box-sizing: border-box;">
                    <img src="${escapeHtml(minimiSrc)}" alt="${escapeHtml(npc.name)}" style="width: 100%; height: 100%; object-fit: contain;" />
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 20px; font-weight: 900; color: #3D2010; line-height: 1.1;">${escapeHtml(npc.name)}</span>${offlineBadge}
                    </div>
                    ${badgesHtml}
                    <div style="margin-top: 4px; display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 800; color: #5B3318;">
                        <span>💰 ${npc.money.toLocaleString()}</span>
                        <span style="color: #724929;">🗺️ 영토 ${terrCount}${text.EA}</span>
                    </div>
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

    let gimLabel = `🌿 평상시`;
    let gimBg = '#EDE4D2';
    let gimColor = '#6E4C2E';
    let gimBorder = '#C9965B';
    if (activeGimmick === 'halo') {
        gimLabel = `✨ 빛무리 (${remainTurns}${gText.TIME_REMAIN_UNIT})`;
        gimBg = '#D6F9FA'; gimColor = '#0A6770'; gimBorder = '#00B8B8';
    } else if (activeGimmick === 'soot') {
        gimLabel = `🔥 그을음 (${remainTurns}${gText.TIME_REMAIN_UNIT})`;
        gimBg = '#FFDCD6'; gimColor = '#9E1F14'; gimBorder = '#E74C3C';
    } else if (activeGimmick === 'day') {
        gimLabel = `☀️ 낮 시간 (${remainTurns}${gText.TIME_REMAIN_UNIT})`;
        gimBg = '#FFF0C2'; gimColor = '#B35300'; gimBorder = '#F39C12';
    } else if (activeGimmick === 'night') {
        gimLabel = `🌙 밤 시간 (${remainTurns}${gText.TIME_REMAIN_UNIT})`;
        gimBg = '#EFE3FF'; gimColor = '#5E2B7A'; gimBorder = '#9B59B6';
    }

    const maxThink = Math.max(1, getPlayerThinkTime(player));
    const thinkTime = remainSec !== null && remainSec !== undefined ? Math.max(0, Number(remainSec) || 0) : maxThink;
    const isUrgent = thinkTime <= 5;
    const C = 175.93;
    const ratio = Math.max(0, Math.min(1, thinkTime / maxThink));
    const dashOffset = (C * (1 - ratio)).toFixed(2);
    const strokeCol = isUrgent ? '#D93829' : '#4E8F26';
    const numCol = isUrgent ? '#C0392B' : '#3D2010';
    const remainCol = isUrgent ? '#C0392B' : '#8F481B';

    const waitingHtml = waitingPlayer
        ? `<div id="turn-waiting-indicator" style="font-size: 14px; color: #C04810; margin-top: 3px; font-weight: 800;">⏳ ${escapeHtml(waitingPlayer.name)} 선택 대기 중...</div>`
        : '';

    return `
        <div id="turn-indicator" class="hud-turn-card" style="position: absolute; top: 28px; right: 34px; min-width: 392px; padding: 15px 22px; display: flex; align-items: center; gap: 16px; background: linear-gradient(180deg, #FFF9EB 0%, #F6E4BE 100%); border: 5px solid #4E2812; border-radius: 24px; box-shadow: 0 14px 32px rgba(45, 22, 8, 0.32); box-sizing: border-box; color: #3D2010; z-index: 8;">
            <div id="hud-stopwatch" class="hud-stopwatch ${isUrgent ? 'is-urgent' : ''}">
                <div class="hud-stopwatch-crown"></div>
                <div class="hud-stopwatch-dial">
                    <svg class="hud-stopwatch-svg" viewBox="0 0 68 68">
                        <circle cx="34" cy="34" r="28" fill="none" stroke="rgba(168,111,53,0.22)" stroke-width="6"></circle>
                        <circle id="stopwatch-progress-ring" cx="34" cy="34" r="28" fill="none" stroke="${strokeCol}" stroke-width="6" stroke-linecap="round" stroke-dasharray="175.93" stroke-dashoffset="${dashOffset}" data-max-sec="${maxThink}"></circle>
                    </svg>
                    <div class="hud-stopwatch-readout">
                        <span id="stopwatch-sec" style="font-size: 25px; font-weight: 900; color: ${numCol};">${thinkTime}</span>
                        <span style="font-size: 10px; font-weight: 800; color: #724929; margin-top: 1px;">${text.SEC}</span>
                    </div>
                </div>
            </div>
            <div style="flex: 1; text-align: center;">
                <div style="font-size: 16px; font-weight: 800; color: #724929;">${currentTurn} / ${maxTurn} Turn</div>
                <div style="display: inline-block; font-size: 14px; font-weight: 900; padding: 3px 13px; border-radius: 999px; margin: 5px 0 6px 0; background: ${gimBg}; color: ${gimColor}; border: 1.5px solid ${gimBorder};">${gimLabel}</div>
                <div style="font-size: 24px; font-weight: 900; color: #3D2010; line-height: 1.2;">${text.CURRENT_TURN} <span id="turn-text" style="color: ${player.color}; font-weight: 900;">${escapeHtml(player.name)}</span></div>
                <div id="turn-timer" style="font-size: 16px; font-weight: 900; color: ${remainCol}; margin-top: 3px;">⏱ ${text.REMAIN_TIME} ${thinkTime}${text.SEC}</div>
                ${waitingHtml}
            </div>
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

export function createDiceButton(player, canRoll = true, hasUsableCards = false, exitPending = false) {
    const text = pickLangDict(MarbleLang, LangState.current);
    const cText = pickLangDict(CardUILang, LangState.current);

    const rollBtnCursor = canRoll ? 'pointer' : 'not-allowed';
    const exitLabel = exitPending ? '🚪 정말 나가기?' : '🚪 나가기';

    return `
        <div class="hud-action-dock" style="position: absolute; bottom: 34px; right: 34px; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; z-index: 8;">
            <div style="display: flex; align-items: flex-end; gap: 14px;">
                <button id="btn-exit-match" type="button" class="td-btn td-btn-red" style="font-family: inherit; padding: 10px 16px; font-size: 15px; font-weight: 900; border-width: 2px; border-radius: 14px; cursor: pointer;">${exitLabel}</button>
                <button id="btn-inventory" type="button" class="td-btn td-btn-purple" style="font-family: inherit; padding: 22px 32px; font-size: 27px; font-weight: 900; border-width: 3px; border-radius: 14px; cursor: pointer;">${cText.BTN_INVENTORY}</button>
                <div style="display: flex; flex-direction: column; align-items: stretch;">
                    <div style="height: 54px; display: flex; flex-direction: column; justify-content: flex-end; margin-bottom: 6px; pointer-events: none;">
                        <div id="dice-gauge-idle" style="display: ${canRoll ? 'flex' : 'none'}; justify-content: center; align-items: center;">
                            <span style="background: rgba(61, 32, 16, 0.92); color: #FFE68B; border: 2px solid #F7C744; border-radius: 999px; padding: 4px 12px; font-size: 13px; font-weight: 800; white-space: nowrap;">⚡ ${text.DICE_GAUGE_HOLD_HINT || '버튼을 길게 눌러 게이지 조절'}</span>
                        </div>
                        <div id="dice-gauge-wrap" style="display: none; background: #4E2812; border: 2px solid #F7C744; border-radius: 12px; padding: 7px 12px; box-shadow: 0 8px 18px rgba(45,22,8,0.4);">
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 800; color: #FFF8EE; margin-bottom: 4px;">
                                <span>⚡ ${text.DICE_GAUGE_POWER_LABEL || '게이지'}</span>
                                <span id="dice-gauge-pct" style="color: #F7C744;">0%</span>
                            </div>
                            <div style="position: relative; width: 100%; height: 12px; background: #2A160B; border-radius: 999px; overflow: hidden; border: 1px solid rgba(255,228,172,0.35);">
                                <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.65); transform: translateX(-50%); z-index: 2;"></div>
                                <div id="dice-gauge-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #5E72E4, #F7C744, #E25B45);"></div>
                            </div>
                        </div>
                    </div>
                    <button id="btn-roll" type="button" class="td-btn td-btn-orange" style="font-family: inherit; padding: 22px 52px; font-size: 32px; font-weight: 900; cursor: ${rollBtnCursor}; border-radius: 14px; border-width: 3px; user-select: none; -webkit-user-select: none; touch-action: none;" ${!canRoll ? 'disabled' : ''}>${text.ROLL_DICE}</button>
                </div>
            </div>
        </div>
    `;
}

export function createDiceOverlay() {
    const text = pickLangDict(MarbleLang, LangState.current);
    return `
        <div id="dice-overlay" class="dice-3d-center-overlay" style="display: none;">
            <div class="dice-3d-hud-wrap">
                <div id="dice-title" class="dice-3d-title-pill">${text.ROLLING}</div>
                <div id="dice-3d-arena" class="dice-3d-arena">
                    <div id="dice-slot-1" class="dice-3d-slot">
                        <div class="dice-3d-shadow"></div>
                        <div id="dice-cube-1" class="dice-3d-cube"></div>
                    </div>
                    <div id="dice-slot-2" class="dice-3d-slot">
                        <div class="dice-3d-shadow"></div>
                        <div id="dice-cube-2" class="dice-3d-cube"></div>
                    </div>
                    <div id="dice-slot-3" class="dice-3d-slot" style="display: none;">
                        <div class="dice-3d-shadow"></div>
                        <div id="dice-cube-3" class="dice-3d-cube"></div>
                    </div>
                </div>
                <div>
                    <div id="dice-sum-badge" class="dice-sum-badge">🎲 ${text.ROLLING}</div>
                </div>
            </div>
        </div>
    `;
}

export function createTurnOrderOverlay() {
    return `
        <div id="turn-order-overlay" style="display: none; position: absolute; inset: 0; background: rgba(34, 16, 6, 0.64); backdrop-filter: blur(4px); z-index: 950; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
            <div class="td-wood-shell" style="width: 100%; max-width: 920px; padding: 12px; box-sizing: border-box;">
                <div class="td-parchment" style="padding: 26px 30px; text-align: center; box-sizing: border-box;">
                    <h2 id="turn-order-title" style="margin: 0 0 6px 0; font-size: 28px; font-weight: 900; color: #4E2812;"></h2>
                    <p id="turn-order-desc" style="margin: 0 0 8px 0; font-size: 15px; color: #724929; line-height: 1.5;"></p>
                    <div id="turn-order-phase-hint" style="margin: 0 0 12px 0; font-size: 15px; font-weight: 900; color: #7C3F0E;"></div>
                    <div id="turn-order-tie-banner" style="display: none; margin: 0 auto 12px auto; padding: 8px 14px; border-radius: 12px; background: #FFE3DD; border: 2px solid #D95318; color: #9E2710; font-size: 14px; font-weight: 900;"></div>
                    <div id="turn-order-countdown" style="display: none; margin-bottom: 12px; font-size: 16px; font-weight: 900; color: #B84214;"></div>

                    <div id="turn-order-grid" style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 14px 0 18px 0;"></div>

                    <div id="turn-order-action-area" style="min-height: 54px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;">
                        <div id="turn-order-my-status" style="min-height: 20px; font-size: 15px; font-weight: 800; color: #7C3F0E;"></div>
                        <button id="turn-order-roll-btn" type="button" class="td-btn td-btn-orange" style="display: none; align-items: center; justify-content: center; padding: 13px 34px; font-size: 18px;"></button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function createPopupOverlay() {
    const text = pickLangDict(MarbleLang, LangState.current);
    return `
        <div id="toast-popup" style="display: none; position: absolute; top: 94px; left: 50%; transform: translateX(-50%); flex-direction: column; align-items: center; gap: 8px; width: max-content; max-width: 1866px; z-index: 120; pointer-events: none;"></div>
        <div id="event-popup" class="td-popup-box td-scroll" style="display: none; font-family: inherit; z-index: 40; width: fit-content; min-width: 820px; max-width: 94vw; max-height: 92vh; overflow-y: auto; box-sizing: border-box;">
            <div class="td-popup-inner" style="text-align: center; position: relative; padding: 30px 36px;">
                <div id="event-bg-banner" class="td-banner-img" style="display: none;"></div>
                <h2 id="event-title" style="margin: 0 16px 12px 16px; font-size: 34px; color: #4E2812;"></h2>
                <p id="event-desc" style="font-size: 21px; margin: 0 0 18px 0; line-height: 1.55; color: #5B3318; white-space: pre-line;"></p>
                <div id="event-timer" class="td-timer-pill" style="display: none;"></div>
                <div id="buy-buttons" style="display: none; gap: 12px; justify-content: center; flex-wrap: wrap;"></div>
                <div id="crisis-buttons" style="display: none; gap: 16px; justify-content: center;">
                    <button id="crisis-sell-btn" class="td-btn td-btn-orange" style="font-family: inherit; padding: 14px 32px; font-size: 21px; flex: 1;">🏠 ${text.BTN_CRISIS_SELL}</button>
                    <button id="crisis-loan-btn" class="td-btn td-btn-red" style="font-family: inherit; padding: 14px 32px; font-size: 21px; flex: 1;">🏦 ${text.BTN_CRISIS_LOAN}</button>
                </div>
                <div id="close-buttons" style="display: none;">
                    <button id="close-btn" class="td-btn td-btn-blue" style="font-family: inherit; padding: 14px 48px; font-size: 22px;">${text.CLOSE}</button>
                </div>
            </div>
        </div>
        <div id="sell-popup" class="td-popup-box" style="display: none; font-family: inherit; z-index: 48; width: 700px; max-width: 94vw;">
            <div class="td-popup-inner" style="text-align: center;">
                <h2 id="sell-main-title" style="margin: 0 0 8px 0; font-size: 32px; color: #B84214;"></h2>
                <div style="display: flex; justify-content: center; gap: 24px; margin-bottom: 16px; font-size: 18px; font-weight: 800;">
                    <span id="sell-req-text" style="color: #C0392B; margin: 0;"></span>
                    <span id="sell-sum-text" style="color: #2E7D32; margin: 0;"></span>
                </div>
                <div id="sell-grid" class="td-scroll td-list-scroll" style="display: flex; flex-direction: column; gap: 9px; max-height: 320px; overflow-y: auto; margin-bottom: 18px; text-align: left;"></div>
                <div style="display: flex; gap: 14px;">
                    <button id="sell-confirm-btn" class="td-btn td-btn-green" style="font-family: inherit; padding: 14px; font-size: 21px; flex: 1;" disabled></button>
                    <button id="sell-cancel-btn" class="td-btn td-btn-red" style="font-family: inherit; padding: 14px; font-size: 21px; flex: 1;"></button>
                </div>
            </div>
        </div>
        <div id="portal-popup" class="td-popup-box" style="display: none; font-family: inherit; z-index: 48; width: 840px; max-width: 94vw;">
            <div class="td-popup-inner" style="text-align: center;">
                <h2 id="portal-title" style="margin: 0 0 8px 0; font-size: 34px; color: #5E2B7A;">${text.PORTAL_TITLE}</h2>
                <p id="portal-desc" style="font-size: 18px; margin-bottom: 12px; color: #6B4223;">${text.PORTAL_DESC}</p>
                <div id="portal-timer" class="td-timer-pill">${text.REMAIN_TIME} ${GAME_CONSTANTS.THINK_TIME}${text.SEC}</div>
                <div id="portal-grid" class="td-scroll" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; max-height: 420px; overflow-y: auto; padding-right: 10px;"></div>
                <div style="margin-top: 16px;">
                    <button id="portal-cancel-btn" class="td-btn td-btn-wood" style="font-family: inherit; padding: 13px; font-size: 20px; width: 100%;">${text.PORTAL_CANCEL}</button>
                </div>
            </div>
        </div>
        <div id="target-popup" class="td-popup-box" style="display: none; font-family: inherit; z-index: 48; width: 780px; max-width: 94vw;">
            <div class="td-popup-inner" style="text-align: center;">
                <h2 id="target-title" style="margin: 0 0 8px 0; font-size: 30px; color: #2D539E;"></h2>
                <p id="target-desc" style="font-size: 17px; color: #6B4223; margin-bottom: 12px;"></p>
                <div id="target-timer" class="td-timer-pill">${text.REMAIN_TIME} ${GAME_CONSTANTS.THINK_TIME}${text.SEC}</div>
                <div id="target-grid" class="td-scroll" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-height: 420px; overflow-y: auto; padding: 4px 6px; margin-bottom: 16px;"></div>
                <button id="target-cancel-btn" class="td-btn td-btn-wood" style="font-family: inherit; padding: 13px; font-size: 20px; width: 100%;"></button>
            </div>
        </div>
        <div id="void-game-popup" class="td-popup-box" style="display: none; font-family: inherit; z-index: 48; width: 580px; max-width: 92vw;">
            <div class="td-popup-inner" style="text-align: center; background: linear-gradient(180deg, #F8F1FF 0%, #EBD9FA 100%); border-color: #9B59B6;">
                <h2 id="void-game-title" style="margin: 0 0 8px 0; font-size: 34px; color: #5E2B7A;"></h2>
                <p id="void-game-subtitle" style="margin: 0 0 18px 0; font-size: 18px; color: #6B3C8E; font-weight: 700;"></p>
                <div id="void-game-target-box" style="margin: 0 auto 18px auto; padding: 16px 30px; border-radius: 16px; background: #4E2812; border: 3px solid #F7C744; display: inline-flex; align-items: center; justify-content: center; gap: 14px; box-shadow: 0 8px 20px rgba(48, 22, 74, 0.28);">
                    <span id="void-game-number" style="font-size: 50px; font-weight: 900; color: #FFF9EB; line-height: 1;"></span>
                    <span id="void-game-dir" style="font-size: 34px; font-weight: 900; line-height: 1;"></span>
                </div>
                <p id="void-game-desc" style="margin: 0 0 14px 0; font-size: 18px; color: #3D2010; line-height: 1.5;"></p>
                <div id="void-timer" class="td-timer-pill">${text.REMAIN_TIME} ${GAME_CONSTANTS.THINK_TIME}${text.SEC}</div>
                <div>
                    <button id="void-game-roll-btn" type="button" class="td-btn td-btn-orange" style="font-family: inherit; padding: 14px 44px; font-size: 22px;"></button>
                </div>
            </div>
        </div>
        <div id="hand-popup" class="td-popup-box" style="display: none; font-family: inherit; z-index: 45; width: 760px; max-width: 94vw;">
            <div class="td-popup-inner">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <h2 id="hand-title" style="margin: 0; font-size: 28px; color: #5E2B7A;"></h2>
                    <button id="hand-close-btn" type="button" class="td-close-x">✕</button>
                </div>
                <p id="hand-desc" style="margin: 0 0 14px 0; font-size: 15px; color: #724929;"></p>
                <div id="hand-list" class="td-scroll td-list-scroll" style="display: flex; flex-direction: column; gap: 12px; max-height: 460px; overflow-y: auto;"></div>
            </div>
        </div>
        <div id="hand-detail-popup" class="td-popup-box" style="display: none; font-family: inherit; z-index: 56; width: fit-content; min-width: 680px; max-width: 94vw;">
            <div class="td-popup-inner" style="position: relative;">
                <button id="hand-detail-close-btn" type="button" class="td-close-x" style="position: absolute; top: 14px; right: 14px;">✕</button>
                <div id="hand-detail-badge" style="display: inline-block; padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 900; margin-bottom: 10px; color: #FFFFFF;"></div>
                <h3 id="hand-detail-title" style="margin: 0 36px 10px 0; font-size: 25px; color: #4E2812;"></h3>
                <p id="hand-detail-desc" style="margin: 0 0 14px 0; font-size: 17px; line-height: 1.55; color: #4E2812; background: rgba(255,255,255,0.65); border: 2px solid #D8AF7A; border-radius: 12px; padding: 12px 14px; white-space: pre-line;"></p>
                <div id="hand-detail-status" style="margin: 0 0 14px 0; font-size: 14px; font-weight: 800; min-height: 20px;"></div>
                <div id="hand-detail-actions" style="display: none; justify-content: flex-end; gap: 10px;">
                    <button id="hand-detail-use-btn" type="button" class="td-btn td-btn-green" style="font-family: inherit; width: 100%; padding: 12px; font-size: 19px;">사용하기</button>
                </div>
            </div>
        </div>
        <div id="territory-popup" class="td-popup-box" style="display: none; font-family: inherit; z-index: 45; width: 820px; max-width: 94vw;">
            <div class="td-popup-inner">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
                    <h2 id="territory-title" style="margin: 0; font-size: 28px; color: #4E2812;"></h2>
                    <button id="territory-close-btn" type="button" class="td-close-x">✕</button>
                </div>
                <div id="territory-list" class="td-scroll td-list-scroll" style="display: flex; flex-direction: column; gap: 10px; max-height: 460px; overflow-y: auto; overflow-x: hidden;"></div>
            </div>
        </div>
        <div id="territory-detail-popup" class="td-popup-box td-scroll" style="display: none; font-family: inherit; z-index: 55; width: fit-content; min-width: 800px; max-width: 94vw; max-height: 92vh; overflow-y: auto;">
            <div class="td-popup-inner" style="padding: 0; overflow: hidden; position: relative;">
                <button id="territory-detail-close-btn" type="button" class="td-close-x" style="position: absolute; top: 14px; right: 14px; z-index: 3;">✕</button>
                <div id="territory-detail-bg-banner" style="display: none; width: 100%; height: auto; aspect-ratio: 1376 / 768; background-size: 100% 100%; background-position: center; background-repeat: no-repeat; border-bottom: 4px solid #8F542B;"></div>
                <div style="padding: 22px 26px 24px 26px;">
                    <h3 id="territory-detail-title" style="margin: 0 44px 6px 0; font-size: 28px; color: #4E2812;"></h3>
                    <p id="territory-detail-desc" style="margin: 0 0 10px 0; font-size: 16px; color: #6B4223; line-height: 1.5; white-space: pre-line;"></p>
                    <div id="territory-detail-meta" style="margin: 0 0 14px 0; font-size: 15px; color: #5D361A;"></div>
                    <div id="territory-detail-stats" style="display: flex; flex-direction: column; gap: 8px; background: rgba(255, 255, 255, 0.65); border: 2px solid #D8AF7A; border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; font-size: 16px;"></div>
                    <div id="territory-detail-upgrades" style="display: flex; flex-direction: column; gap: 6px; font-size: 15px;"></div>
                    <div id="territory-detail-portal-confirm" style="display: none; margin-top: 16px; padding-top: 14px; border-top: 2px dashed #C9965B;">
                        <p id="territory-detail-portal-question" style="margin: 0 0 12px 0; font-size: 19px; font-weight: 900; color: #7C3F0E; text-align: center;"></p>
                        <div style="display: flex; gap: 12px;">
                            <button id="territory-detail-portal-yes" type="button" class="td-btn td-btn-green" style="font-family: inherit; flex: 1; padding: 12px; font-size: 19px;">예 (이동)</button>
                            <button id="territory-detail-portal-no" type="button" class="td-btn td-btn-wood" style="font-family: inherit; flex: 1; padding: 12px; font-size: 19px;">아니요</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div id="portal-hint-banner" style="display: none; font-family: inherit; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: linear-gradient(180deg, #744496 0%, #52296E 100%); border: 4px solid #35164A; border-radius: 18px; padding: 14px 26px; box-shadow: 0 18px 40px rgba(32, 14, 5, 0.62); z-index: 50; color: #FFF8EE; align-items: center; gap: 18px; white-space: nowrap;">
            <div>
                <div id="portal-hint-title" style="font-size: 20px; font-weight: 900; color: #FFE68B;"></div>
                <div id="portal-hint-sub" style="font-size: 14px; color: #EEDAF8; margin-top: 2px;"></div>
            </div>
            <div id="portal-hint-timer" style="font-size: 18px; font-weight: 900; color: #F7C744;"></div>
            <button id="portal-hint-cancel-btn" type="button" class="td-btn td-btn-wood" style="font-family: inherit; padding: 8px 16px; font-size: 15px;"></button>
        </div>
        <div id="board-peek-container" style="display: none; position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%); z-index: 95;">
            <button id="btn-board-peek" type="button" class="td-btn td-btn-wood" style="font-family: inherit; padding: 12px 28px; font-size: 19px; border: 3px solid #F7C744; box-shadow: 0 10px 26px rgba(38, 16, 6, 0.52);"></button>
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

        const stageEl = document.getElementById('marble-board-stage') || container.parentElement;
        const boardCanvas = document.getElementById('game-canvas');
        let maxToastW = 1866;
        if (boardCanvas && stageEl) {
            const cRect = boardCanvas.getBoundingClientRect();
            const sRect = stageEl.getBoundingClientRect();
            if (sRect.width > 0 && cRect.width > 0) {
                const scale = sRect.width / 1920;
                maxToastW = Math.min(1866, Math.round(cRect.width / Math.max(0.05, scale)));
            }
        }
        container.style.maxWidth = `${maxToastW}px`;

        const item = document.createElement('div');
        item.className = 'toast-item';
        item.innerText = msg;
        item.style.cssText = `background: rgba(68, 35, 16, 0.96); color: #FFF7DF; border: 2.5px solid #F7C744; padding: 12px 26px; border-radius: 16px; font-size: 21px; font-weight: 900; box-shadow: 0 12px 26px rgba(32,14,5,0.45); text-align: center; pointer-events: none; white-space: nowrap; max-width: ${maxToastW}px; box-sizing: border-box;`;
        // 최신 토스트가 맨 위(처음 생성 위치)에 뜨고 기존 토스트가 아래로 밀려내려가도록 상단에 삽입
        if (container.firstChild) container.insertBefore(item, container.firstChild);
        else container.appendChild(item);

        // 동시에 너무 많은 토스트가 화면을 가리지 않도록 하단(가장 오래된 항목)을 정리해 최대 4개까지만 유지
        while (container.children && container.children.length > 4) {
            const oldest = container.lastElementChild || container.lastChild;
            if (oldest && oldest.parentNode) oldest.parentNode.removeChild(oldest);
            else if (oldest && oldest.remove) oldest.remove();
            else break;
        }

        container.style.display = 'flex';
        if (item.scrollWidth > maxToastW - 4) {
            item.style.whiteSpace = 'normal';
            item.style.wordBreak = 'keep-all';
            item.style.lineHeight = '1.32';
        }
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
            popupEl.style.width = 'fit-content';
            popupEl.style.maxWidth = '94vw';
            popupEl.style.minWidth = visible ? '880px' : '820px';
        });
    },
    showChoicePopup(title, desc, buttonsConfig, bgPath = null, uiOpts = null) {
        this.closeAll();
        this.setEventBanner(bgPath);
        document.getElementById('event-popup').style.display = 'block';
        document.getElementById('event-title').innerText = title;
        document.getElementById('event-title').style.color = uiOpts?.titleColor || '#4E2812';
        document.getElementById('event-desc').innerText = desc;
        document.getElementById('crisis-buttons').style.display = 'none';
        document.getElementById('close-buttons').style.display = 'none';
        document.getElementById('event-timer').style.display = 'inline-block';
        const btnContainer = document.getElementById('buy-buttons');
        btnContainer.style.display = 'flex';
        btnContainer.style.width = '';
        btnContainer.innerHTML = '';

        const makeChoiceBtn = (cfg, compact = false) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'td-btn';
            btn.innerText = cfg.text;
            const isDisabled = Boolean(cfg.disabled);
            btn.disabled = isDisabled;
            const pad = compact ? '11px 6px' : '12px 16px';
            const fSize = compact ? '15px' : '17px';
            btn.style.cssText = `font-family: inherit; padding: ${pad}; background: ${cfg.color || '#6E3D1E'}; color: #fff; border: 2px solid #FFE4AC; border-radius: 14px; font-size: ${fSize}; font-weight: 900; cursor: ${isDisabled ? 'not-allowed' : 'pointer'}; opacity: ${isDisabled ? '0.45' : '1'}; white-space: ${compact ? 'nowrap' : 'pre-line'}; line-height: 1.35; box-shadow: 0 6px 14px rgba(45, 22, 8, 0.25);`;
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
                if (!hasLeftRight && rowItems.length >= 2) {
                    const useCompact = rowItems.length >= 6;
                    rowDiv.style.cssText = `display: grid; grid-template-columns: repeat(${rowItems.length}, minmax(0, 1fr)); gap: 8px; width: 100%; align-items: stretch;`;
                    rowItems.forEach(cfg => {
                        rowDiv.appendChild(makeChoiceBtn(cfg, useCompact));
                    });
                } else {
                    rowDiv.style.cssText = `display: flex; width: 100%; gap: 8px; flex-wrap: wrap; justify-content: ${hasLeftRight ? 'space-between' : 'center'}; align-items: stretch;`;
                    rowItems.forEach(cfg => {
                        const btn = makeChoiceBtn(cfg, false);
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
                }
                btnContainer.appendChild(rowDiv);
            });
        } else if (buttonsConfig.length === 6) {
            btnContainer.style.display = 'grid';
            btnContainer.style.gridTemplateColumns = 'repeat(6, minmax(0, 1fr))';
            btnContainer.style.gap = '8px';
            btnContainer.style.width = '100%';
            buttonsConfig.forEach(cfg => {
                btnContainer.appendChild(makeChoiceBtn(cfg, true));
            });
        } else {
            btnContainer.style.flexDirection = 'row';
            btnContainer.style.flexWrap = 'wrap';
            btnContainer.style.gap = '12px';
            btnContainer.style.width = '100%';
            buttonsConfig.forEach(cfg => {
                const btn = makeChoiceBtn(cfg, false);
                if (buttonsConfig.length >= 2 && buttonsConfig.length <= 4) {
                    btn.style.flex = '1 1 0';
                } else if (buttonsConfig.length > 4) {
                    btn.style.flex = '1 1 132px';
                    btn.style.whiteSpace = 'nowrap';
                }
                btnContainer.appendChild(btn);
            });
        }
    },
    showNormalPopup(title, desc, showCloseBtn, onEndCallback, bgPath = null, hideUpperTimer = true, uiOpts = null) {
        this.closeAll();
        this.setEventBanner(bgPath);
        const text = pickLangDict(MarbleLang, LangState.current);
        document.getElementById('event-popup').style.display = 'block';
        document.getElementById('event-title').innerText = title;
        document.getElementById('event-title').style.color = uiOpts?.titleColor || '#4E2812';
        document.getElementById('event-desc').innerText = desc;
        document.getElementById('buy-buttons').style.display = 'none';
        document.getElementById('crisis-buttons').style.display = 'none';
        document.getElementById('event-timer').style.display = (showCloseBtn && !hideUpperTimer) ? 'inline-block' : 'none';
        const closeBtn = document.getElementById('close-btn');
        if (showCloseBtn) {
            document.getElementById('close-buttons').style.display = 'block';
            if (closeBtn) {
                const baseLabel = uiOpts?.confirmText || text.CLOSE;
                closeBtn.dataset.baseLabel = baseLabel;
                closeBtn.innerText = baseLabel;
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
            popupEl.style.width = 'fit-content';
            popupEl.style.minWidth = '880px';
            popupEl.style.maxWidth = '94vw';
        }
        const text = pickLangDict(MarbleLang, LangState.current);
        const gText = pickLangDict(GimmickLang, LangState.current);
        const timeBadge = tile.timeType === 'day' ? ` [${gText.TILE_TIME_DAY}]` : (tile.timeType === 'night' ? ` [${gText.TILE_TIME_NIGHT}]` : '');
        document.getElementById('event-popup').style.display = 'block';
        document.getElementById('event-title').innerText = `${getTileName(tile)}${timeBadge} ${text.BUY_TITLE}`;
        document.getElementById('event-title').style.color = '#4E2812';
        document.getElementById('event-desc').innerText = text.BUY_DESC;
        document.getElementById('crisis-buttons').style.display = 'none';
        document.getElementById('close-buttons').style.display = 'none';
        document.getElementById('event-timer').style.display = 'inline-block';
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
        if (tile.level === 3) {
            const canAfford = playerMoney >= costs[4];
            const cls = canAfford ? 'td-btn-orange' : 'td-btn-wood';
            rowBtnsHTML += `<button type="button" class="action-btn td-btn ${cls}" data-level="4" data-afford="${canAfford}" style="flex: 1 1 auto; white-space: nowrap; padding: 14px 10px; font-size: 16px; opacity: ${canAfford ? '1' : '0.5'};">${text.BLD_4} (${formatMoney(costs[4])})</button>`;
        } else if (tile.level === 2) {
            const canAfford = playerMoney >= costs[3];
            const cls = canAfford ? 'td-btn-green' : 'td-btn-wood';
            rowBtnsHTML += `<button type="button" class="action-btn td-btn ${cls}" data-level="3" data-afford="${canAfford}" style="flex: 1 1 auto; white-space: nowrap; padding: 14px 10px; font-size: 16px; opacity: ${canAfford ? '1' : '0.5'};">${text.BLD_3} (${formatMoney(costs[3])})</button>`;
        } else {
            const maxInitLvl = Math.min(3, firstVisitMax);
            const textLv = [text.BLD_0, text.BLD_1, text.BLD_2, text.BLD_3];
            const classes = ['td-btn-wood', 'td-btn-red', 'td-btn-blue', 'td-btn-green'];
            for (let l = 0; l <= maxInitLvl; l++) {
                if (tile.level < l) {
                    const canAfford = playerMoney >= costs[l];
                    const cls = canAfford ? classes[l] : 'td-btn-wood';
                    rowBtnsHTML += `<button type="button" class="action-btn td-btn ${cls}" data-level="${l}" data-afford="${canAfford}" style="flex: 1 1 auto; white-space: nowrap; padding: 14px 10px; font-size: 16px; opacity: ${canAfford ? '1' : '0.5'};">${textLv[l]} (${formatMoney(costs[l])})</button>`;
                }
            }
        }
        const btnsHTML = `
            <div style="display: flex; flex-wrap: nowrap; gap: 10px; width: 100%; justify-content: center;">
                ${rowBtnsHTML}
            </div>
            <button type="button" id="cancel-btn" class="td-btn td-btn-wood" style="padding: 13px; font-size: 18px; width: 100%;">${text.BUY_CANCEL}</button>
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
        document.getElementById('event-title').innerText = `🚨 ${text.CRISIS_TITLE}`;
        document.getElementById('event-title').style.color = '#B84214';
        const desc = canSellCover
            ? `${text.CRISIS_DESC_SELL_OR_LOAN}<br>(${text.CRISIS_REQ_LABEL} ${formatMoney(toll)})`
            : `${text.CRISIS_DESC_LOAN_ONLY}<br>(${text.CRISIS_REQ_LABEL} ${formatMoney(toll)})`;
        document.getElementById('event-desc').innerHTML = desc;
        document.getElementById('buy-buttons').style.display = 'none';
        document.getElementById('close-buttons').style.display = 'none';
        document.getElementById('event-timer').style.display = 'inline-block';
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
        document.getElementById('sell-main-title').innerText = `💸 ${text.SELL_TITLE}`;
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
            confirmBtn.disabled = selectedTotal < requiredAmount;
        };
        ownedTiles.forEach(t => {
            const sellVal = getSellValueFunc(t);
            const row = document.createElement('label');
            row.className = 'list-card-row';
            row.style.cursor = 'pointer';
            row.innerHTML = `<span style="font-size: 17px; font-weight: 800;"><input type="checkbox" value="${t.id}" style="width: 18px; height: 18px; accent-color: #D95318; vertical-align: middle; margin-right: 8px;"> ${escapeHtml(getTileName(t))}</span><span style="font-size: 17px; font-weight: 900; color: #2E7D32;">+${formatMoney(sellVal)}</span>`;
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
            btn.type = 'button';
            btn.className = 'td-btn';
            btn.innerHTML = `<b style="color:#FFF8EE; font-size: 18px;">${escapeHtml(formatCardDisplayTitle(card))}</b><br><span style="font-size:13px; opacity: 0.92; font-weight: 700;">${escapeHtml(card.desc)}</span>`;
            btn.style.cssText = `font-family: inherit; padding: 14px 12px; background: ${theme.buttonBg || '#4959C9'}; color: white; border: 2px solid #FFE4AC; border-radius: 14px; cursor: pointer; text-align: left;`;
            btn.onclick = () => onUseCallback(card);
            grid.appendChild(btn);
        });
        cancelBtn.onclick = onCancelCallback;
    },
    showTargetPopup(title, desc, targets, onSelectCallback, onCancelCallback) {
        this.closeAll();
        const mText = pickLangDict(MarbleLang, LangState.current);
        document.getElementById('target-popup').style.display = 'block';
        document.getElementById('target-title').innerText = `🎯 ${title}`;
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
            btn.type = 'button';
            btn.className = 'td-btn';
            btn.innerText = t.name;
            const isDisabled = Boolean(t.disabled);
            const bg = isDisabled ? '#8B5733' : (t.color || '#6E3D1E');
            const cursor = isDisabled ? 'not-allowed' : 'pointer';
            const opacity = isDisabled ? '0.45' : '1.0';
            btn.disabled = isDisabled;
            btn.style.cssText = `font-family: inherit; padding: 14px 10px; font-size: 16px; font-weight: 900; background: ${bg}; color: white; border: 2px solid #FFE4AC; border-radius: 14px; cursor: ${cursor}; opacity: ${opacity}; white-space: pre-line;`;
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
            btn.type = 'button';
            btn.className = `td-btn ${t.type === 'normal' ? 'td-btn-wood' : 'td-btn-purple'}`;
            btn.innerText = getTileName(t);
            btn.style.cssText = 'font-family: inherit; padding: 10px; font-size: 16px;';
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

        if (titleEl) titleEl.innerText = `🌀 ${cText.SHAYDI_GAME_TITLE || '셰이디의 장난'}`;
        if (subEl) subEl.innerText = cText.SHAYDI_GAME_SUBTITLE || '심심한데 나랑 게임하나 하고갈래?';
        if (numEl) numEl.innerText = `${targetNum}`;
        if (dirEl) {
            dirEl.innerText = isUp ? `${cText.SHAYDI_GAME_UP || '업'} ▲` : `${cText.SHAYDI_GAME_DOWN || '다운'} ▼`;
            dirEl.style.color = isUp ? '#77E275' : '#FF8585';
        }
        if (descEl) {
            descEl.innerText = isUp
                ? (cText.SHAYDI_GAME_DESC_UP || '주사위를 굴려서 제시된 숫자보다 큰 숫자를 띄우면 즉시 탈출!')
                : (cText.SHAYDI_GAME_DESC_DOWN || '주사위를 굴려서 제시된 숫자보다 작은 숫자를 띄우면 즉시 탈출!');
        }
        if (rollBtn) {
            rollBtn.innerText = `🎲 ${cText.SHAYDI_GAME_ROLL_BTN || '주사위 굴리기'}`;
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

function resolveTileTextPalette(timeType, isOverridden, currentTime) {
    if (timeType === 'day') {
        return isOverridden
            ? { text: '#8F6038', halo: 'rgba(255, 250, 240, 0.94)' }
            : { text: '#E04F00', halo: 'rgba(255, 252, 232, 0.97)' };
    }
    if (timeType === 'night') {
        return isOverridden
            ? { text: '#726199', halo: 'rgba(252, 248, 255, 0.94)' }
            : { text: currentTime === 'night' ? '#7A12EB' : '#841CF0', halo: 'rgba(255, 255, 255, 0.98)' };
    }
    return { text: '#3D2010', halo: 'rgba(255, 252, 244, 0.95)' };
}

export function renderBoardState(ctx, boardImg, tiles, allPlayers, worldState = null, standeeCtx = null, standeePad = 160, animState = null) {
    ctx.clearRect(0, 0, 1080, 1080);
    if (boardImg && boardImg.complete && boardImg.naturalWidth > 0) {
        ctx.drawImage(boardImg, 0, 0, 1080, 1080);
    } else {
        ctx.fillStyle = '#F7E7C4';
        ctx.fillRect(0, 0, 1080, 1080);
        ctx.strokeStyle = '#C8B89A';
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, 1072, 1072);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const currentFont = SettingsManager.getCanvasFont();
    const { isOverridden, currentTime } = resolveGimmickStatus(worldState);
    const playerById = new Map(allPlayers.map(p => [p.id, p]));
    const gridN = getModeConfig(resolveRenderWorld(worldState).gameMode || 'ember').gridUnits || 13;
    const U = 1080 / gridN;
    const nameFontSize = Math.max(15, Math.round(U * 0.225));
    const maxTextWidth = U * 1.16;
    const textBandOffset = U * 0.08;
    const standees = [];
    const {
        moveAnimState = null,
        impactRingState = null,
        landingRippleState = null,
        lapFxState = null
    } = (animState && typeof animState === 'object') ? animState : {};

    tiles.forEach(tile => {
        if (tile.isDisabled || tile.type === 'disabled') return;

        // 코너 4칸(0,10,20,30)과 차원 열쇠 칸(card)은 보드판 텍스트 미표시 (영토명을 낮/밤 시간대 색상으로 출력)
        const shouldDrawText = (tile.id % 10 !== 0) && (tile.type !== 'card');
        if (shouldDrawText) {
            const pal = resolveTileTextPalette(tile.timeType, isOverridden, currentTime);
            let textX = tile.x;
            let textY = tile.y;
            if (tile.side === 0) textY += textBandOffset;
            else if (tile.side === 1) textX -= textBandOffset;
            else if (tile.side === 2) textY -= textBandOffset;
            else if (tile.side === 3) textX += textBandOffset;

            ctx.save();
            ctx.translate(textX, textY);
            if (tile.side === 0 || tile.side === 2) {
                ctx.rotate(-Math.PI / 2);
            }
            ctx.font = `900 ${nameFontSize}px ${currentFont}`;
            ctx.lineJoin = 'round';
            ctx.lineWidth = 4;
            ctx.strokeStyle = pal.halo;
            ctx.strokeText(getTileName(tile, worldState), 0, 0, maxTextWidth);
            ctx.fillStyle = pal.text;
            ctx.fillText(getTileName(tile, worldState), 0, 0, maxTextWidth);
            ctx.restore();
        }

        const ownerObj = (tile.owner && typeof tile.owner === 'object')
            ? tile.owner
            : (tile.ownerId !== undefined && tile.ownerId !== null ? playerById.get(tile.ownerId) : null);

        if (ownerObj) {
            let dx = 0, dy = 0;
            const offsetDist = (tile.side === 0 || tile.side === 3) ? U * 0.88 : U * 0.72;
            if (tile.side === 0) dy = -offsetDist;
            else if (tile.side === 1) dx = offsetDist;
            else if (tile.side === 2) dy = offsetDist;
            else if (tile.side === 3) dx = -offsetDist;
            let bLvl = Math.max(0, Math.min(4, Number(tile.level) || 0));
            if (tile.type === 'special_buy' || tile.type === 'bread') bLvl = 4;
            standees.push({
                kind: 'building',
                px: tile.x + dx,
                py: tile.y + dy,
                level: bLvl,
                owner: ownerObj
            });
        }
    });

    const getOffset = (totalCount, index) => {
        const d = Math.round(U * 0.19);
        if (totalCount === 1) return { x: 0, y: 0 };
        if (totalCount === 2) return index === 0 ? { x: 0, y: -d } : { x: 0, y: d };
        if (totalCount === 3) {
            if (index === 0) return { x: -d, y: d };
            if (index === 1) return { x: d, y: d };
            return { x: 0, y: -d };
        }
        if (totalCount >= 4) {
            if (index === 0) return { x: -d, y: -d };
            if (index === 1) return { x: d, y: -d };
            if (index === 2) return { x: -d, y: d };
            return { x: d, y: d };
        }
        return { x: 0, y: 0 };
    };

    const tileOccupants = new Map();
    const movingStandaloneStandees = [];
    allPlayers.forEach(p => {
        if (!p || p.isBankrupt) return;
        if (moveAnimState && moveAnimState.playerId === p.id) {
            if (typeof moveAnimState.baseTileId === 'number') {
                const baseTile = tiles.find(t => t && t.id === moveAnimState.baseTileId && !t.isDisabled) || tiles[0];
                if (baseTile) {
                    if (!tileOccupants.has(baseTile.id)) tileOccupants.set(baseTile.id, []);
                    tileOccupants.get(baseTile.id).push({ player: p, tile: baseTile, baseOnly: true });
                }
                movingStandaloneStandees.push({
                    kind: 'player',
                    px: moveAnimState.px,
                    py: moveAnimState.py,
                    hopY: moveAnimState.hopY || 0,
                    sinkRatio: moveAnimState.sinkRatio || 0,
                    clipAtHole: Boolean(moveAnimState.clipAtHole),
                    tiltRad: moveAnimState.tiltRad || 0,
                    scaleX: moveAnimState.scaleX ?? 1,
                    scaleY: moveAnimState.scaleY ?? 1,
                    alpha: moveAnimState.alpha ?? 1,
                    minimiOnly: true,
                    player: p
                });
            } else {
                movingStandaloneStandees.push({
                    kind: 'player',
                    px: moveAnimState.px,
                    py: moveAnimState.py,
                    hopY: moveAnimState.hopY || 0,
                    sinkRatio: moveAnimState.sinkRatio || 0,
                    clipAtHole: Boolean(moveAnimState.clipAtHole),
                    tiltRad: moveAnimState.tiltRad || 0,
                    scaleX: moveAnimState.scaleX ?? 1,
                    scaleY: moveAnimState.scaleY ?? 1,
                    alpha: moveAnimState.alpha ?? 1,
                    player: p
                });
            }
            return;
        }
        const targetTile = tiles.find(t => t && t.id === p.pos && !t.isDisabled) || tiles[p.pos];
        if (!targetTile) return;
        if (!tileOccupants.has(targetTile.id)) tileOccupants.set(targetTile.id, []);
        tileOccupants.get(targetTile.id).push({ player: p, tile: targetTile, baseOnly: false });
    });

    tileOccupants.forEach((occupants) => {
        if (occupants.length === 0) return;
        occupants.forEach(({ player, tile, baseOnly }, idx) => {
            const offset = getOffset(occupants.length, idx);
            standees.push({
                kind: 'player',
                px: tile.x + offset.x,
                py: tile.y + offset.y,
                hopY: 0,
                baseOnly: Boolean(baseOnly),
                player
            });
        });
    });

    // 정적 건물+스탠디 깊이 정렬 후, 이동/비행 중인 미니미는 항상 최상위에 그려 건물/타일 가림 방지
    standees.sort((a, b) => (a.px + a.py) - (b.px + b.py));
    const orderedStandees = [...standees, ...movingStandaloneStandees];

    const targetCtx = standeeCtx || ctx;
    if (standeeCtx && standeeCtx.canvas) {
        standeeCtx.clearRect(0, 0, standeeCtx.canvas.width, standeeCtx.canvas.height);
        standeeCtx.save();
        standeeCtx.translate(standeePad, standeePad);
    }

    // 바닥 연출 레이어 1: 셰이디 블랙홀 소용돌이(칸 1개 크기)
    if (moveAnimState && moveAnimState.blackhole) {
        const bh = moveAnimState.blackhole;
        const bhR = Math.max(18, U * 0.48) * Math.max(0.05, bh.open || 0);
        targetCtx.save();
        targetCtx.translate(bh.px, bh.py);
        const grad = targetCtx.createRadialGradient(0, 0, bhR * 0.14, 0, 0, bhR);
        grad.addColorStop(0, 'rgba(6, 2, 14, 0.98)');
        grad.addColorStop(0.55, 'rgba(64, 18, 112, 0.92)');
        grad.addColorStop(0.84, 'rgba(155, 89, 255, 0.58)');
        grad.addColorStop(1, 'rgba(155, 89, 255, 0)');
        targetCtx.fillStyle = grad;
        targetCtx.beginPath();
        targetCtx.arc(0, 0, bhR, 0, Math.PI * 2);
        targetCtx.fill();

        targetCtx.rotate(bh.spin || 0);
        targetCtx.strokeStyle = 'rgba(218, 178, 255, 0.72)';
        targetCtx.lineWidth = 2.5;
        for (let arm = 0; arm < 3; arm++) {
            targetCtx.beginPath();
            const baseA = (arm * Math.PI * 2) / 3;
            targetCtx.arc(0, 0, bhR * 0.62, baseA, baseA + Math.PI * 0.45);
            targetCtx.stroke();
        }
        targetCtx.restore();
    }

    // 바닥 연출 레이어 2: 종착 슬로우 황금 발광, 제단 충격파, 일반/카드 착지 파문
    if (moveAnimState && typeof moveAnimState.slowGlowTileId === 'number') {
        const gTile = tiles.find(t => t && t.id === moveAnimState.slowGlowTileId);
        if (gTile) {
            targetCtx.save();
            const grad = targetCtx.createRadialGradient(gTile.x, gTile.y, 6, gTile.x, gTile.y, U * 0.95);
            grad.addColorStop(0, 'rgba(255, 232, 120, 0.68)');
            grad.addColorStop(1, 'rgba(255, 200, 60, 0)');
            targetCtx.fillStyle = grad;
            targetCtx.beginPath();
            targetCtx.arc(gTile.x, gTile.y, U * 0.95, 0, Math.PI * 2);
            targetCtx.fill();
            targetCtx.restore();
        }
    }
    if (impactRingState) {
        const pr = Math.max(0, Math.min(1, impactRingState.progress || 0));
        const rad = 18 + pr * U * 1.15;
        const alpha = Math.max(0, 1 - pr);
        targetCtx.save();
        targetCtx.strokeStyle = `rgba(255, 110, 48, ${alpha.toFixed(2)})`;
        targetCtx.lineWidth = Math.max(2, 9 * (1 - pr));
        targetCtx.beginPath();
        targetCtx.arc(impactRingState.px, impactRingState.py, rad, 0, Math.PI * 2);
        targetCtx.stroke();
        targetCtx.restore();
    }
    if (landingRippleState) {
        const pr = Math.max(0, Math.min(1, landingRippleState.progress || 0));
        const maxR = U * 0.50;
        const rad = 8 + pr * maxR;
        const alpha = Math.max(0, 1 - pr);
        targetCtx.save();
        targetCtx.strokeStyle = `rgba(255, 244, 184, ${(alpha * 0.95).toFixed(2)})`;
        targetCtx.lineWidth = Math.max(1.5, 5.5 * (1 - pr));
        targetCtx.beginPath();
        targetCtx.arc(landingRippleState.px, landingRippleState.py, rad, 0, Math.PI * 2);
        targetCtx.stroke();
        if (pr > 0.12) {
            const pr2 = (pr - 0.12) / 0.88;
            const rad2 = 6 + pr2 * (maxR * 0.78);
            const a2 = Math.max(0, 1 - pr2) * 0.72;
            targetCtx.strokeStyle = `rgba(120, 232, 255, ${a2.toFixed(2)})`;
            targetCtx.lineWidth = Math.max(1, 3.2 * (1 - pr2));
            targetCtx.beginPath();
            targetCtx.arc(landingRippleState.px, landingRippleState.py, rad2, 0, Math.PI * 2);
            targetCtx.stroke();
        }
        targetCtx.restore();
    }

    const ringR = Math.max(9, Math.round(U * 0.125));
    orderedStandees.forEach((item) => {
        if (item.kind === 'building') {
            const bCfg = MARBLE_BUILDING_ASSETS[item.level] || MARBLE_BUILDING_ASSETS[0];
            const bImg = getCachedMarbleImage(bCfg.path);
            if (bImg && bImg.complete && bImg.naturalWidth > 0) {
                const drawW = Math.round(U * bCfg.widthScale);
                const aspect = bImg.naturalHeight / bImg.naturalWidth;
                const drawH = Math.round(drawW * aspect * 2.05);
                const anchorY = bCfg.anchorY || 0.68;
                targetCtx.save();
                targetCtx.translate(item.px, item.py);
                targetCtx.rotate(-Math.PI / 4);
                targetCtx.shadowColor = 'rgba(38, 18, 6, 0.38)';
                targetCtx.shadowBlur = 6;
                targetCtx.shadowOffsetX = 0;
                targetCtx.shadowOffsetY = 3;
                targetCtx.drawImage(bImg, -drawW * bCfg.pegX, -drawH * anchorY, drawW, drawH);
                targetCtx.restore();
            } else {
                const r = Math.max(10, Math.round(U * 0.14));
                targetCtx.save();
                targetCtx.fillStyle = item.owner?.color || '#8F542B';
                targetCtx.strokeStyle = '#FFF9EB';
                targetCtx.lineWidth = 2;
                targetCtx.beginPath();
                targetCtx.arc(item.px, item.py, r, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.stroke();
                targetCtx.restore();
            }
            return;
        }

        const p = item.player;
        const hopY = item.hopY || 0;
        const baseScale = Math.max(0.62, 1 - Math.max(0, hopY) / 240);
        const alpha = item.alpha !== undefined ? item.alpha : 1;

        // 1. 미니미 바닥 팀색 원형 받침 UI (분리 이동 중이면 minimiOnly에선 그림자만, baseOnly에선 발판만 렌더)
        if (!moveAnimState?.blackhole || (!item.clipAtHole && (item.sinkRatio || 0) <= 0.01 && alpha > 0.25)) {
            if (!item.minimiOnly) {
                targetCtx.save();
                targetCtx.fillStyle = `rgba(42, 22, 10, ${(0.30 * baseScale).toFixed(2)})`;
                targetCtx.beginPath();
                targetCtx.arc(item.px + 2, item.py + 2, (ringR + 1) * baseScale, 0, Math.PI * 2);
                targetCtx.fill();

                targetCtx.fillStyle = p.color;
                targetCtx.beginPath();
                targetCtx.arc(item.px, item.py, ringR * baseScale, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.lineWidth = 2.5;
                targetCtx.strokeStyle = '#FFF9EB';
                targetCtx.stroke();
                targetCtx.restore();
            } else if (hopY < 450) {
                const shAlpha = Math.max(0.08, 0.34 * (1 - hopY / 450));
                targetCtx.save();
                targetCtx.fillStyle = `rgba(42, 22, 10, ${shAlpha.toFixed(2)})`;
                targetCtx.beginPath();
                targetCtx.arc(item.px, item.py, ringR * baseScale, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.restore();
            }
        }

        // 2. 미니미 스탠디 (세로 원근 보정 2.15x + 쭈그라듦/까딱/페이드 + 홉 아크 + 블랙홀 수직 클리핑)
        if (!item.baseOnly && alpha > 0.01) {
            const minimiSrc = p.minimiPath || './Resource/Texture/Minimi/Minimi_Erpin.webp';
            const pegX = Number.isFinite(p.minimiPegX) ? p.minimiPegX : 0.406;
            const mImg = getCachedMarbleImage(minimiSrc);
            if (mImg && mImg.complete && mImg.naturalWidth > 0) {
                const drawW = Math.round(U * 0.56);
                const aspect = mImg.naturalHeight / mImg.naturalWidth;
                const drawH = Math.round(drawW * aspect * 2.15);
                targetCtx.save();
                targetCtx.translate(item.px, item.py);
                targetCtx.rotate(-Math.PI / 4);
                if (item.clipAtHole) {
                    targetCtx.beginPath();
                    targetCtx.rect(-drawW * 1.6, -drawH * 3.0, drawW * 3.2, drawH * 3.0 + 4);
                    targetCtx.clip();
                }
                const sinkPx = (item.sinkRatio || 0) * drawH;
                targetCtx.translate(0, -hopY + sinkPx);
                if (item.tiltRad) targetCtx.rotate(item.tiltRad);
                if (item.scaleX !== undefined || item.scaleY !== undefined) {
                    targetCtx.scale(item.scaleX ?? 1, item.scaleY ?? 1);
                }
                targetCtx.globalAlpha = alpha;
                targetCtx.shadowColor = 'rgba(38, 18, 6, 0.44)';
                targetCtx.shadowBlur = 7;
                targetCtx.shadowOffsetX = 0;
                targetCtx.shadowOffsetY = Math.round(4 + Math.min(18, Math.max(0, hopY) * 0.12));
                targetCtx.drawImage(mImg, -drawW * pegX, -drawH + 2, drawW, drawH);
                targetCtx.restore();
            }
        }
    });

    // 3. 순회 빵빠레 폭죽 (텍스트는 #stage-2d-fx-layer 에서 비왜곡 렌더)
    if (lapFxState) {
        const tSec = (lapFxState.elapsed || 0) / 1000;
        const norm = Math.min(1, (lapFxState.elapsed || 0) / (lapFxState.durationMs || 1550));
        const fade = norm > 0.65 ? Math.max(0, 1 - (norm - 0.65) / 0.35) : 1;
        targetCtx.save();
        targetCtx.translate(lapFxState.cx, lapFxState.cy);
        targetCtx.rotate(-Math.PI / 4);
        (lapFxState.particles || []).forEach((pt) => {
            const px = pt.vx * tSec;
            const py = pt.vy * tSec + 280 * tSec * tSec;
            targetCtx.save();
            targetCtx.translate(px, py);
            targetCtx.rotate((pt.rot || 0) + (pt.rotV || 0) * tSec);
            targetCtx.globalAlpha = fade;
            targetCtx.fillStyle = pt.color;
            targetCtx.fillRect(-pt.size * 0.5, -pt.size * 0.28, pt.size, pt.size * 0.56);
            targetCtx.restore();
        });
        targetCtx.restore();
    }

    if (standeeCtx && standeeCtx.canvas) {
        standeeCtx.restore();
    }
}

export function showSettlementPopup(results, onReturnCallback, customBtnLabel = null) {
    const sText = pickLangDict(SettlementLang, LangState.current);
    const uiLayer = document.getElementById('ui-layer') || document.getElementById('app') || document.body;
    const prev = document.getElementById('settlement-popup');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.id = 'settlement-popup';
    overlay.style.cssText = 'position: absolute; inset: 0; background: rgba(34, 16, 6, 0.64); backdrop-filter: blur(4px); z-index: 95; display: flex; justify-content: center; align-items: center; color: #3D2010; font-family: inherit; padding: 24px; box-sizing: border-box;';

    const shell = document.createElement('div');
    shell.className = 'td-wood-shell';
    shell.style.cssText = 'width: min(1480px, 95%); height: min(900px, 92%); padding: 14px; display: flex; box-sizing: border-box;';

    const panel = document.createElement('div');
    panel.className = 'td-parchment';
    panel.style.cssText = 'width: 100%; height: 100%; padding: 24px 30px; box-sizing: border-box; display: flex; flex-direction: column;';

    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 3px solid #D4A46A; padding-bottom: 14px; margin-bottom: 16px;">
            <div>
                <h1 style="margin:0; font-size:38px; color:#4E2812;">🏆 ${sText.TITLE}</h1>
                <p style="margin:5px 0 0 0; font-size:17px; color:#724929;">${sText.SUBTITLE}</p>
            </div>
            <div style="font-size:15px; color:#724929; font-weight:700;">${sText.TAB_DETAIL_HINT}</div>
        </div>
        <div id="settlement-tabs" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin-bottom:16px;"></div>
        <div id="settlement-detail" class="td-scroll" style="flex:1; overflow-y:auto; padding-right:6px; display:grid; grid-template-columns: 1fr; gap:12px; align-content:start;"></div>
        <div id="settlement-summary" style="margin-top:14px; padding-top:14px; border-top:3px solid #D4A46A; display:flex; justify-content:space-between; align-items:center;">
            <div id="settlement-summary-metrics" style="display:flex; gap:30px; font-size:21px; font-weight:800;"></div>
            <button id="settlement-return-btn" type="button" class="td-btn td-btn-green" style="font-family:inherit; padding:14px 34px; font-size:22px;">${escapeHtml(customBtnLabel || sText.BTN_MAINMENU)}</button>
        </div>
    `;

    shell.appendChild(panel);
    overlay.appendChild(shell);
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
            const statusBg = res.isBankruptFinal ? '#C0392B' : '#4E8F26';
            const minimiSrc = res.player?.minimiPath || './Resource/Texture/Minimi/Minimi_Erpin.webp';

            const slot = document.createElement('div');
            slot.className = `settle-tab-slot ${isActiveTab ? 'is-active' : ''}`;
            slot.innerHTML = `
                <div class="settle-peek-wrap">
                    <img class="settle-peek-img" src="${escapeHtml(minimiSrc)}" alt="${escapeHtml(res.player?.name || '')}" />
                </div>
                <button type="button" class="settle-tab-btn" style="background:${isActiveTab ? '#4E2812' : 'linear-gradient(180deg, #FFF9EB 0%, #F7E7C4 100%)'}; border:3px solid ${isActiveTab ? '#F7C744' : (res.player?.color || '#C9965B')}; color:${isActiveTab ? '#FFF9EB' : '#3D2010'};">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <span style="font-size:18px; font-weight:900; color:${isActiveTab ? '#F7C744' : '#B35300'};">${idx + 1}${sText.RANK_SUFFIX}</span>
                        <span style="font-size:12px; font-weight:800; background:${statusBg}; color:#fff; padding:2px 8px; border-radius:999px;">${statusText}</span>
                    </div>
                    <div style="font-size:21px; font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(res.player?.name || '')}</div>
                    <div style="font-size:16px; font-weight:800; opacity:0.9; margin-top:2px;">${formatMoney(res.netWorth)}</div>
                </button>
            `;
            const btn = slot.querySelector('.settle-tab-btn');
            if (btn) {
                btn.onclick = () => {
                    selectedIndex = idx;
                    renderSelected();
                };
            }
            tabsEl.appendChild(slot);
        });

        const cur = results[selectedIndex];
        if (!cur) return;
        detailEl.innerHTML = (cur.categories || []).map(cat => `
            <div style="background:rgba(255,255,255,0.72); border:2px solid #D4A46A; border-radius:14px; padding:14px 18px;">
                <h3 style="margin:0 0 10px 0; font-size:19px; color:#4E2812; border-bottom:1.5px solid #D8AF7A; padding-bottom:6px;">${escapeHtml(cat.title)}</h3>
                <div style="display:flex; flex-direction:column; gap:7px; font-size:16px;">
                    ${(cat.items || []).map(item => {
                        const color = item.isNegative ? '#C0392B' : (item.isActive ? '#2E7D32' : '#724929');
                        return `<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; font-weight:800; color:${color};">
                            <span style="text-align:left;">${escapeHtml(item.label)}</span>
                            <span style="white-space:nowrap; text-align:right;">${escapeHtml(item.formula)}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `).join('');

        metricsEl.innerHTML = `
            <div>${sText.SUMMARY_TOTAL_ASSET}: <b style="color:#2E7D32;">${formatMoney(cur.totalAsset)}</b></div>
            <div>${sText.SUMMARY_TOTAL_DEBT}: <b style="color:#C0392B;">-${formatMoney(cur.totalLoan)}</b></div>
            <div>${sText.SUMMARY_FINAL_WORTH}: <b style="color:#B35300;">${formatMoney(cur.netWorth)}</b></div>
        `;
    };

    renderSelected();
    panel.querySelector('#settlement-return-btn').onclick = () => {
        overlay.remove();
        if (onReturnCallback) onReturnCallback();
    };
}
