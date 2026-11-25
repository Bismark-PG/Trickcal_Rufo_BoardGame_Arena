// ProgramFiles/Scenes/GameMarble.js
// 100% 순수 렌더링 및 입력 송신 전용 엘리아스 마블 클라이언트 씬
// 게임 규칙·턴·확률·AI 연산은 서버(MarbleServerSession) 또는 오프라인 로컬 엔진(MarbleEngine)이 전담

import { changeScene } from '../Main.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import { escapeHtml } from '../Lobby/LobbyUI.js';
import {
    createPlayerUI,
    renderGameLogRowsHtml,
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
} from '../Game/Marble/MarbleUI.js';
import { pickLangDict, formatMoney, getTileName } from '../Game/Marble/MarbleRuntime.js';
import { calculatePurchaseCost, getTileSellValue, findTileAtCanvasPoint } from '../Game/Marble/MarbleLogic.js';
import { LangState } from '../System/LanguageManager.js';
import { MarbleLang } from '../System/Index/Marble/MarbleUIIndex.js';
import { CardUILang, formatCardDisplayTitle, getCardGradeTheme } from '../System/Index/Marble/MarbleCardUIIndex.js';
import { GimmickLang } from '../System/Index/Marble/MarbleGimmickIndex.js';
import { BOARD_TILES, resolveTileBgPath, getTileIntroDesc, isBbangjuCompleted } from '../System/Index/Marble/MarbleBoardIndex.js';
import { GAME_CONSTANTS, BUILDING_COSTS, MULTIPLIERS, getModeConfig, resolveLapBaseBonus } from '../System/Index/Marble/MarblePriceIndex.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { getGameMeta } from '../System/GameRegistry.js';
import { ErrorTracker } from '../System/ErrorTracker.js';
import { getCachedMarbleImage, preloadMarbleAssets } from '../Game/Marble/MarbleAssetLoader.js';

const DICE_NORMAL_PATH = './Resource/Texture/Marble/Dice/Dice_N_';
const DICE_ERPIN_PATH = './Resource/Texture/Marble/Dice/Dice_E_';

const DICE_FACE_ROTATIONS = {
    1: { rx: 0, ry: 0 },
    2: { rx: 90, ry: 0 },
    3: { rx: 0, ry: -90 },
    4: { rx: 0, ry: 90 },
    5: { rx: -90, ry: 0 },
    6: { rx: 180, ry: 0 }
};

function getLeftDicePath(diceState) {
    return diceState?.useErpin ? DICE_ERPIN_PATH : DICE_NORMAL_PATH;
}

function build3DCubeFaces(cubeEl, texPrefix) {
    if (!cubeEl) return;
    if (cubeEl.dataset.texPrefix === texPrefix && cubeEl.children.length === 6) return;
    cubeEl.dataset.texPrefix = texPrefix;
    let html = '';
    for (let f = 1; f <= 6; f++) {
        html += `<div class="dice-3d-face face-${f}"><img src="${texPrefix}${f}.webp" alt="Dice ${f}"></div>`;
    }
    cubeEl.innerHTML = html;
}

const MARBLE_STAGE_THEMES = {
    ember: {
        stageBg: 'radial-gradient(circle at 50% 44%, rgba(255, 224, 178, 0.36) 0%, transparent 56%), radial-gradient(circle at 50% 46%, #F2C98A 0%, #C67A44 64%, #82391D 100%)',
        border: '#FFE6BD',
        outline: '#6E2D15'
    },
    basic: {
        stageBg: 'radial-gradient(circle at 50% 44%, rgba(255, 245, 214, 0.42) 0%, transparent 56%), radial-gradient(circle at 50% 46%, #F4D89D 0%, #D9A762 64%, #AC7235 100%)',
        border: '#FFF5DF',
        outline: '#5D3117'
    },
    speed: {
        stageBg: 'radial-gradient(circle at 50% 44%, rgba(235, 255, 244, 0.46) 0%, transparent 56%), radial-gradient(circle at 50% 46%, #DCF3E6 0%, #8DC6AC 64%, #48806B 100%)',
        border: '#EEFFF5',
        outline: '#2B5C48'
    },
    feast: {
        stageBg: 'radial-gradient(circle at 50% 44%, rgba(255, 224, 178, 0.36) 0%, transparent 56%), radial-gradient(circle at 50% 46%, #F2C98A 0%, #C67A44 64%, #82391D 100%)',
        border: '#FFE6BD',
        outline: '#6E2D15'
    }
};

export function initMarble(container, sceneParams = null) {
    container.innerHTML = `
        <style id="marble-ingame-theme-style">
            #marble-stage-root {
                width: 100%;
                height: 100%;
                position: relative;
                display: flex;
                justify-content: center;
                align-items: center;
                perspective: 1200px;
                overflow: hidden;
                background: radial-gradient(circle at 50% 44%, rgba(255, 224, 178, 0.36) 0%, transparent 56%), radial-gradient(circle at 50% 46%, #F2C98A 0%, #C67A44 64%, #82391D 100%);
                transition: background 0.28s ease;
                color: #3D2010;
            }
            .marble-stage-vignette {
                position: absolute;
                inset: 0;
                border: 12px solid rgba(78, 40, 18, 0.42);
                box-shadow: inset 0 0 90px rgba(74, 34, 12, 0.34);
                pointer-events: none;
                z-index: 1;
            }
            .board-tilt-lift {
                transform: translateY(25px);
                z-index: 2;
                will-change: transform;
            }
            .board-3d-plane {
                position: relative;
                width: 1320px;
                height: 1320px;
                flex-shrink: 0;
                transform: rotateX(60deg) rotateZ(45deg);
            }
            #game-canvas {
                width: 100%;
                height: 100%;
                display: block;
                box-sizing: border-box;
                border: 14px solid #FFE6BD;
                border-radius: 26px;
                outline: 6px solid #6E2D15;
                background-color: transparent;
                box-shadow: 30px 30px 55px rgba(52, 24, 9, 0.38);
                transition: border-color 0.28s ease, outline-color 0.28s ease;
                cursor: pointer;
            }
            #standee-canvas {
                position: absolute;
                left: calc(14px - 460px * (1292 / 1080));
                top: calc(14px - 460px * (1292 / 1080));
                width: calc(1292px * 2000 / 1080);
                height: calc(1292px * 2000 / 1080);
                pointer-events: none;
                z-index: 5;
            }
            #stage-2d-fx-layer {
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 4;
                overflow: hidden;
            }
            .lap-2d-banner {
                position: absolute;
                transform: translate(-50%, -100%);
                white-space: nowrap;
                font-size: 26px;
                font-weight: 900;
                color: #FFF9DC;
                text-shadow:
                    -2px -2px 0 #4E2812,
                     2px -2px 0 #4E2812,
                    -2px  2px 0 #4E2812,
                     2px  2px 0 #4E2812,
                     0    4px 10px rgba(45, 16, 4, 0.72);
                background: linear-gradient(135deg, rgba(247, 199, 68, 0.94), rgba(217, 83, 24, 0.94));
                border: 3px solid #FFF7DF;
                border-radius: 999px;
                padding: 6px 18px;
                box-shadow: 0 10px 24px rgba(45, 16, 4, 0.45);
                animation: lapBannerFloat 1.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            }
            @keyframes lapBannerFloat {
                0% {
                    opacity: 0;
                    transform: translate(-50%, -55%) scale(0.72);
                }
                18% {
                    opacity: 1;
                    transform: translate(-50%, -105%) scale(1.12);
                }
                34% {
                    transform: translate(-50%, -112%) scale(1.0);
                }
                78% {
                    opacity: 1;
                    transform: translate(-50%, -128%) scale(1.0);
                }
                100% {
                    opacity: 0;
                    transform: translate(-50%, -152%) scale(0.94);
                }
            }
            #ui-players, #turn-ui-container, #dice-btn-container {
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 30;
            }
            .hud-npc-stack, .hud-my-wrap, .hud-turn-card, .hud-action-dock {
                pointer-events: auto;
            }
            .td-wood-shell {
                background: linear-gradient(180deg, #8F542B 0%, #6E3D1E 100%);
                border: 4px solid #4E2812;
                border-radius: 24px;
                box-shadow: 0 18px 42px rgba(46, 22, 8, 0.45);
                color: #FFF8EE;
            }
            .td-parchment {
                background: linear-gradient(180deg, #FFF9EB 0%, #F7E7C4 100%);
                border: 3px solid #C9965B;
                border-radius: 20px;
                color: #3D2010;
                box-shadow: inset 0 2px 8px rgba(105, 57, 29, 0.12), 0 8px 20px rgba(45, 22, 9, 0.2);
            }
            .td-btn {
                font-family: inherit;
                font-weight: 900;
                color: #FFFFFF;
                border-radius: 14px;
                cursor: pointer;
                transition: transform 0.15s ease, filter 0.15s ease;
                border: 2px solid #FFE4AC;
            }
            .td-btn:hover:not(:disabled) {
                transform: scale(1.045);
                filter: brightness(1.06);
            }
            .td-btn:disabled {
                opacity: 0.48;
                cursor: not-allowed;
            }
            .td-btn-green {
                background: linear-gradient(135deg, #77C242, #4E8F26);
                border-color: #DFF5BE;
                box-shadow: 0 6px 14px rgba(45, 95, 16, 0.28);
            }
            .td-btn-orange {
                background: linear-gradient(135deg, #F38221, #D95318);
                border-color: #FFE4AC;
                box-shadow: 0 6px 14px rgba(145, 52, 12, 0.32);
            }
            .td-btn-blue {
                background: linear-gradient(135deg, #5E72E4, #4959C9);
                border-color: #C7D0FF;
                box-shadow: 0 6px 14px rgba(43, 56, 145, 0.3);
            }
            .td-btn-purple {
                background: linear-gradient(135deg, #9B59B6, #733A91);
                border-color: #E8C7FF;
                box-shadow: 0 6px 14px rgba(84, 34, 114, 0.32);
            }
            .td-btn-red {
                background: linear-gradient(135deg, #E25B45, #B83724);
                border-color: #FFD1C9;
                box-shadow: 0 6px 14px rgba(120, 28, 16, 0.32);
            }
            .td-btn-wood {
                background: linear-gradient(135deg, #8B5733, #66381A);
                border-color: #D9AD79;
                box-shadow: 0 6px 14px rgba(56, 26, 9, 0.28);
            }
            .td-close-x {
                font-family: inherit;
                width: 38px;
                height: 38px;
                font-size: 20px;
                font-weight: 900;
                background: #6E3D1E;
                color: #FFF7DF;
                border: 2px solid #C9965B;
                border-radius: 11px;
                cursor: pointer;
                line-height: 1;
                transition: transform 0.14s ease, background 0.14s ease;
            }
            .td-close-x:hover {
                transform: scale(1.06);
                background: #8F542B;
            }
            .hud-log-panel {
                width: 460px;
                background: linear-gradient(180deg, rgba(255, 249, 235, 0.97) 0%, rgba(244, 226, 186, 0.97) 100%);
                border: 4px solid #5D3117;
                border-radius: 18px;
                box-shadow: 0 12px 26px rgba(45, 22, 8, 0.32);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .hud-log-header {
                padding: 6px 12px;
                background: linear-gradient(180deg, #7A4423 0%, #592E14 100%);
                color: #FFE68B;
                font-size: 13px;
                font-weight: 900;
                border-bottom: 2px solid #4E2812;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .hud-log-collapse-btn {
                font-family: inherit;
                font-size: 11px;
                font-weight: 900;
                padding: 2px 9px;
                border-radius: 999px;
                background: #4E2812;
                color: #FFF7DF;
                border: 1.5px solid #F7C744;
                cursor: pointer;
                transition: transform 0.14s ease, background 0.14s ease;
            }
            .hud-log-collapse-btn:hover {
                transform: scale(1.05);
                background: #8F542B;
            }
            .hud-log-body {
                height: 82px;
                min-height: 78px;
                padding: 7px 12px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 4px;
                font-size: 13px;
                line-height: 1.45;
                color: #4E2812;
            }
            .hud-log-row {
                border-bottom: 1px dashed rgba(168, 111, 53, 0.35);
                padding-bottom: 2px;
                font-weight: 700;
            }
            .hud-log-row:last-child {
                border-bottom: none;
                padding-bottom: 0;
            }
            .hud-stopwatch {
                position: relative;
                width: 82px;
                height: 82px;
                flex-shrink: 0;
                margin-top: 8px;
            }
            .hud-stopwatch-crown {
                position: absolute;
                top: -11px;
                left: 50%;
                transform: translateX(-50%);
                width: 24px;
                height: 11px;
                background: linear-gradient(180deg, #FFE68B 0%, #D99B1E 100%);
                border: 2.5px solid #4E2812;
                border-radius: 6px 6px 2px 2px;
                z-index: 2;
                box-sizing: border-box;
            }
            .hud-stopwatch-crown::before {
                content: '';
                position: absolute;
                top: -7px;
                left: 50%;
                transform: translateX(-50%);
                width: 10px;
                height: 6px;
                background: #F7C744;
                border: 2px solid #4E2812;
                border-radius: 999px;
                box-sizing: border-box;
            }
            .hud-stopwatch-dial {
                width: 82px;
                height: 82px;
                border-radius: 50%;
                background: radial-gradient(circle at 50% 42%, #FFFDF8 0%, #F3DFB5 100%);
                border: 4.5px solid #6E3D1E;
                outline: 2.5px solid #F7C744;
                box-shadow: inset 0 2px 8px rgba(78, 40, 18, 0.2), 0 6px 14px rgba(45, 22, 8, 0.28);
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                box-sizing: border-box;
            }
            .hud-stopwatch.is-urgent .hud-stopwatch-dial {
                background: radial-gradient(circle at 50% 42%, #FFF5F2 0%, #FFD6CD 100%);
                border-color: #9E2710;
                outline-color: #FF7675;
            }
            .hud-stopwatch-svg {
                position: absolute;
                inset: 2px;
                width: calc(100% - 4px);
                height: calc(100% - 4px);
                transform: rotate(-90deg);
            }
            .hud-stopwatch-readout {
                position: relative;
                z-index: 2;
                display: flex;
                flex-direction: column;
                align-items: center;
                line-height: 1;
            }
            .td-popup-box {
                display: none;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 40;
                background: linear-gradient(180deg, #8F542B 0%, #6E3D1E 100%);
                border: 5px solid #4E2812;
                border-radius: 26px;
                padding: 12px;
                box-shadow: 0 24px 60px rgba(32, 14, 5, 0.65);
                color: #3D2010;
                box-sizing: border-box;
            }
            .td-popup-inner {
                background: linear-gradient(180deg, #FFF9EB 0%, #F7E7C4 100%);
                border: 3px solid #C9965B;
                border-radius: 18px;
                padding: 26px 30px;
                box-shadow: inset 0 2px 10px rgba(105, 57, 29, 0.12);
                box-sizing: border-box;
            }
            .td-banner-img {
                width: 100%;
                height: auto;
                aspect-ratio: 1376 / 768;
                border-radius: 14px;
                margin-bottom: 16px;
                background-size: 100% 100%;
                background-position: center;
                background-repeat: no-repeat;
                border: 3px solid #8F542B;
                box-shadow: 0 8px 20px rgba(61, 32, 16, 0.26);
                box-sizing: border-box;
            }
            .td-timer-pill {
                display: inline-block;
                padding: 5px 16px;
                border-radius: 999px;
                background: #FFE5DD;
                border: 1.5px solid #D95318;
                color: #A93215;
                font-size: 18px;
                font-weight: 900;
                margin-bottom: 14px;
            }
            .td-scroll::-webkit-scrollbar {
                width: 7px;
            }
            .td-scroll::-webkit-scrollbar-thumb {
                background: rgba(143, 84, 43, 0.55);
                border-radius: 999px;
            }
            .td-list-scroll {
                padding: 10px 22px 10px 14px;
                overflow-x: hidden !important;
                box-sizing: border-box;
            }
            .list-card-row {
                font-family: inherit;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 15px;
                background: rgba(255, 255, 255, 0.72);
                border: 2px solid #CFA067;
                border-radius: 14px;
                color: #3D2010;
                cursor: pointer;
                text-align: left;
                position: relative;
                z-index: 1;
                box-sizing: border-box;
                transform-origin: center center;
                transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease;
            }
            .list-card-row:hover {
                z-index: 3;
                transform: scale(1.018);
                border-color: #D95318;
                background: #FFFDF7;
                box-shadow: 0 6px 16px rgba(217, 83, 24, 0.24);
            }
            #dice-overlay.dice-3d-center-overlay {
                display: none;
                position: absolute;
                top: 49%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 15;
                pointer-events: none;
                text-align: center;
            }
            .dice-3d-hud-wrap {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                pointer-events: none;
            }
            .dice-3d-title-pill {
                display: inline-block;
                padding: 8px 24px;
                border-radius: 999px;
                background: linear-gradient(180deg, rgba(143, 84, 43, 0.96) 0%, rgba(78, 40, 18, 0.96) 100%);
                border: 3px solid #F7C744;
                outline: 2px solid #3D2010;
                color: #FFF9EB;
                font-size: 26px;
                font-weight: 900;
                box-shadow: 0 12px 28px rgba(32, 14, 5, 0.55);
                text-shadow: 0 2px 6px rgba(24, 10, 4, 0.7);
                white-space: nowrap;
            }
            .dice-3d-arena {
                position: relative;
                width: 500px;
                height: 250px;
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 54px;
                perspective: 1100px;
                pointer-events: none;
            }
            .dice-3d-arena::before {
                content: '';
                position: absolute;
                width: 390px;
                height: 150px;
                border-radius: 50%;
                background: radial-gradient(ellipse at center, rgba(45, 22, 8, 0.42) 0%, rgba(45, 22, 8, 0.14) 55%, transparent 76%);
                pointer-events: none;
                transform: translateY(28px);
            }
            .dice-3d-slot {
                position: relative;
                width: 96px;
                height: 96px;
                transform-style: preserve-3d;
                will-change: transform;
            }
            .dice-3d-shadow {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 84px;
                height: 44px;
                margin-left: -42px;
                margin-top: 22px;
                border-radius: 50%;
                background: radial-gradient(ellipse at center, rgba(28, 12, 4, 0.62) 0%, rgba(28, 12, 4, 0.20) 58%, transparent 78%);
                will-change: transform, opacity;
                pointer-events: none;
            }
            .dice-3d-cube {
                position: relative;
                width: 88px;
                height: 88px;
                margin: 4px;
                transform-style: preserve-3d;
                will-change: transform;
            }
            .dice-3d-face {
                position: absolute;
                width: 88px;
                height: 88px;
                border-radius: 16px;
                background: #FFF9EB;
                border: 2.5px solid #6E3D1E;
                box-shadow: inset 0 0 8px rgba(78, 40, 18, 0.25);
                backface-visibility: hidden;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .dice-3d-face img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .dice-3d-face.face-1 { transform: rotateY(0deg) translateZ(44px); }
            .dice-3d-face.face-6 { transform: rotateY(180deg) translateZ(44px); }
            .dice-3d-face.face-2 { transform: rotateX(-90deg) translateZ(44px); }
            .dice-3d-face.face-5 { transform: rotateX(90deg) translateZ(44px); }
            .dice-3d-face.face-3 { transform: rotateY(90deg) translateZ(44px); }
            .dice-3d-face.face-4 { transform: rotateY(-90deg) translateZ(44px); }
            .dice-sum-badge {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 26px;
                border-radius: 999px;
                background: linear-gradient(180deg, #4E2812 0%, #361A0A 100%);
                border: 3px solid #F7C744;
                outline: 2px solid #2A1205;
                color: #FFE68B;
                font-size: 22px;
                font-weight: 900;
                box-shadow: 0 10px 24px rgba(32, 14, 5, 0.55);
                transition: transform 0.2s ease;
            }
            .dice-sum-badge.is-pop {
                transform: scale(1.08);
            }
            .to-minimi-stage {
                position: relative;
                width: 112px;
                height: 124px;
                display: flex;
                align-items: flex-end;
                justify-content: center;
                margin: 2px auto 4px auto;
            }
            .to-minimi-img {
                width: 96px;
                height: 112px;
                object-fit: contain;
                filter: drop-shadow(0 6px 10px rgba(45, 22, 8, 0.28));
            }
            .to-rank-stamp {
                position: absolute;
                top: -8px;
                right: -10px;
                width: 56px;
                height: 56px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 900;
                font-size: 20px;
                letter-spacing: -0.5px;
                line-height: 1;
                z-index: 4;
                transform: rotate(-10deg);
                animation: rankStampSlam 0.38s cubic-bezier(0.22, 1.4, 0.36, 1) forwards;
                pointer-events: none;
            }
            .to-rank-stamp.rank-1 {
                background: radial-gradient(circle at 32% 28%, #FFF9C2 0%, #F7C744 50%, #D9820B 100%);
                border: 3.5px solid #4E2812;
                box-shadow: 0 6px 14px rgba(45, 16, 6, 0.45), inset 0 0 0 2.5px #FFFDF0;
                color: #3D1B05;
                text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
            }
            .to-rank-stamp.rank-normal {
                background: radial-gradient(circle at 32% 28%, #FFCA8A 0%, #D97724 52%, #7C3F14 100%);
                border: 3.5px solid #4E2812;
                box-shadow: 0 6px 14px rgba(45, 16, 6, 0.45), inset 0 0 0 2.5px #FFE6BD;
                color: #FFFDF7;
                text-shadow: 0 1px 3px rgba(42, 12, 4, 0.72);
            }
            .to-rank-stamp.is-settled {
                animation: none !important;
                opacity: 1;
                transform: rotate(-10deg);
            }
            @keyframes rankStampSlam {
                0% { opacity: 0; transform: scale(2.45) rotate(-28deg); }
                65% { opacity: 1; transform: scale(0.90) rotate(-10deg); }
                85% { transform: scale(1.06) rotate(-14deg); }
                100% { opacity: 1; transform: scale(1) rotate(-12deg); }
            }
            .settle-tab-slot {
                position: relative;
                padding-top: 54px;
                display: flex;
                flex-direction: column;
            }
            .settle-peek-wrap {
                position: absolute;
                top: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 112px;
                height: 58px;
                overflow: hidden;
                pointer-events: none;
                z-index: 1;
                transition: transform 0.18s ease;
            }
            .settle-tab-slot:hover .settle-peek-wrap,
            .settle-tab-slot.is-active .settle-peek-wrap {
                transform: translateX(-50%) translateY(-4px);
            }
            .settle-peek-img {
                width: 104px;
                height: 116px;
                object-fit: contain;
                object-position: top center;
                display: block;
                margin: 0 auto;
                filter: drop-shadow(0 4px 8px rgba(45, 22, 8, 0.30));
            }
            .settle-tab-btn {
                position: relative;
                z-index: 2;
                width: 100%;
                font-family: inherit;
                text-align: left;
                padding: 12px 16px;
                border-radius: 14px;
                cursor: pointer;
                box-shadow: 0 8px 18px rgba(45, 22, 8, 0.22);
                transition: transform 0.14s ease, filter 0.14s ease;
            }
            .settle-tab-btn:hover {
                transform: scale(1.018);
                filter: brightness(1.04);
            }
        </style>
        <div id="marble-stage-root">
            <div class="marble-stage-vignette"></div>
            <div class="board-tilt-lift">
                <div class="board-3d-plane">
                    <canvas id="game-canvas" width="1080" height="1080"></canvas>
                    <canvas id="standee-canvas" width="2000" height="2000"></canvas>
                    <div id="board-3d-probe" style="position:absolute; width:2px; height:2px; pointer-events:none; opacity:0;"></div>
                </div>
            </div>
            <div id="stage-2d-fx-layer"></div>
            <div id="ui-players"></div>
            <div id="turn-ui-container"></div>
            <div id="dice-btn-container"></div>
            ${createDiceOverlay()}
            ${createTurnOrderOverlay()}
            ${createPopupOverlay()}
            <div id="afk-warning-overlay" style="display: none; position: absolute; inset: 0; background: rgba(34, 16, 6, 0.62); backdrop-filter: blur(4px); z-index: 9500; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.35s ease; padding: 24px; box-sizing: border-box;">
                <div class="td-wood-shell" style="width: 780px; max-width: 92vw; padding: 12px; box-sizing: border-box;">
                    <div class="td-parchment" style="padding: 34px 42px; text-align: center; box-sizing: border-box;">
                        <h2 id="afk-warn-title" style="margin: 0 0 14px 0; font-size: 32px; color: #B84214;"></h2>
                        <p id="afk-warn-desc" style="margin: 0 0 24px 0; font-size: 20px; line-height: 1.7; color: #3D2010; white-space: pre-line; word-break: keep-all;"></p>
                        <button id="btn-afk-return" type="button" class="td-btn td-btn-green" style="font-family: inherit; padding: 14px 48px; font-size: 22px;"></button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const stageRoot = container.querySelector('#marble-stage-root');
    const boardTiltEl = container.querySelector('.board-tilt-lift');
    const boardPlaneEl = container.querySelector('.board-3d-plane');
    const board3dProbeEl = container.querySelector('#board-3d-probe');
    const stage2dFxLayer = container.querySelector('#stage-2d-fx-layer');
    const BOARD_CSS_SCALE = 1292 / 1080;
    const canvas = container.querySelector('#game-canvas');
    const ctx = canvas.getContext('2d');
    const standeeCanvas = container.querySelector('#standee-canvas');
    const standeeCtx = standeeCanvas ? standeeCanvas.getContext('2d') : null;
    const STANDEE_PAD = 460;
    const initialBoardMode = sceneParams?.room?.customOptions?.gameMode || 'ember';
    let loadedBoardSrc = getModeConfig(initialBoardMode).boardTexture || './Resource/Texture/Marble/Board_Mode_Ember.webp';
    const boardImg = new Image();
    ErrorTracker.trackImage(boardImg, { critical: true, label: 'MarbleBoard' });
    const getActiveBoardImage = () => getCachedMarbleImage(loadedBoardSrc) || boardImg;
    if (!getCachedMarbleImage(loadedBoardSrc)) {
        boardImg.src = loadedBoardSrc;
    }
    preloadMarbleAssets();

    let isCleanedUp = false;
    let latestSnapshot = null;
    let activePromptKey = null;

    let moveAnimState = null;
    let moveAnimRafId = null;
    let camResetRafId = null;
    let boardShakeOffset = { x: 0, y: 0 };
    let lapFxState = null;
    let lapFxRafId = null;
    let impactRingState = null;
    let landingRippleState = null;
    let curCamState = { zoom: 1, panX: 540, panY: 540 };
    const prevPlayerPosMap = new Map();
    const moveAnimQueue = [];
    const queuedPostAnimEvents = [];
    const isMoveAnimating = () => Boolean(moveAnimRafId || camResetRafId || moveAnimQueue.length > 0);
    const getAnimRenderState = () => (moveAnimState || impactRingState || landingRippleState || lapFxState)
        ? { moveAnimState, impactRingState, landingRippleState, lapFxState }
        : null;

    const getVisualPlayers = (players = []) => {
        if (moveAnimQueue.length === 0) return players;
        const queuedStartById = new Map();
        moveAnimQueue.forEach(item => {
            if (item && item.playerId && !queuedStartById.has(item.playerId) && typeof item.fromPos === 'number') {
                queuedStartById.set(item.playerId, item.fromPos);
            }
        });
        if (queuedStartById.size === 0) return players;
        return players.map(p => (p && queuedStartById.has(p.id)) ? { ...p, pos: queuedStartById.get(p.id) } : p);
    };

    const redrawBoardCanvas = () => {
        if (isCleanedUp || !latestSnapshot) return;
        const activeBoardImg = getActiveBoardImage();
        if (activeBoardImg && activeBoardImg.complete && activeBoardImg.naturalWidth > 0) {
            renderBoardState(
                ctx,
                activeBoardImg,
                latestViewTiles,
                getVisualPlayers(latestSnapshot.players || []),
                latestSnapshot.world,
                standeeCtx,
                STANDEE_PAD,
                getAnimRenderState()
            );
        }
    };

    const applyBoardCamera = (zoom = 1, canvasFocusX = 540, canvasFocusY = 540) => {
        curCamState = { zoom, panX: canvasFocusX, panY: canvasFocusY };
        if (!boardPlaneEl || !boardTiltEl) return;
        const frac = Math.max(0, Math.min(1, (zoom - 1) / 1.0));
        const liftY = 25 * (1 - frac) + boardShakeOffset.y;
        const panCssX = -(canvasFocusX - 540) * BOARD_CSS_SCALE * frac;
        const panCssY = -(canvasFocusY - 540) * BOARD_CSS_SCALE * frac;
        boardTiltEl.style.transform = `translate(${boardShakeOffset.x.toFixed(1)}px, ${liftY.toFixed(1)}px)`;
        boardPlaneEl.style.transform = `scale(${zoom.toFixed(4)}) rotateX(60deg) rotateZ(45deg) translate3d(${panCssX.toFixed(1)}px, ${panCssY.toFixed(1)}px, 0px)`;
        syncDiceOverlayPosition();
    };

    const resetBoardCameraSmooth = (durationMs = 440, onDone = null) => {
        if (camResetRafId) {
            cancelAnimationFrame(camResetRafId);
            camResetRafId = null;
        }
        const fromZoom = curCamState.zoom;
        const fromX = curCamState.panX;
        const fromY = curCamState.panY;
        if (Math.abs(fromZoom - 1) < 0.01) {
            applyBoardCamera(1, 540, 540);
            if (typeof onDone === 'function') onDone();
            return;
        }
        const startTs = performance.now();
        const tickCam = (now) => {
            if (isCleanedUp) return;
            const p = Math.min(1, (now - startTs) / durationMs);
            const ease = 1 - Math.pow(1 - p, 3);
            const z = fromZoom + (1 - fromZoom) * ease;
            const x = fromX + (540 - fromX) * ease;
            const y = fromY + (540 - fromY) * ease;
            applyBoardCamera(z, x, y);
            if (p < 1) {
                camResetRafId = requestAnimationFrame(tickCam);
            } else {
                camResetRafId = null;
                applyBoardCamera(1, 540, 540);
                if (typeof onDone === 'function') onDone();
            }
        };
        camResetRafId = requestAnimationFrame(tickCam);
    };

    const boardToStage2D = (bx, by) => {
        if (board3dProbeEl && stageRoot) {
            const sRect = stageRoot.getBoundingClientRect();
            const scaleX = (sRect.width > 0 && stageRoot.clientWidth > 0) ? (sRect.width / stageRoot.clientWidth) : 1;
            const scaleY = (sRect.height > 0 && stageRoot.clientHeight > 0) ? (sRect.height / stageRoot.clientHeight) : 1;
            const pxInPlane = 14 + (bx / 1080) * 1292;
            const pyInPlane = 14 + (by / 1080) * 1292;
            board3dProbeEl.style.left = `${(pxInPlane - 1).toFixed(2)}px`;
            board3dProbeEl.style.top = `${(pyInPlane - 1).toFixed(2)}px`;
            const pRect = board3dProbeEl.getBoundingClientRect();
            if (pRect.width > 0 || pRect.left !== 0) {
                return {
                    x: (pRect.left + pRect.width * 0.5 - sRect.left) / Math.max(0.05, scaleX),
                    y: (pRect.top + pRect.height * 0.5 - sRect.top) / Math.max(0.05, scaleY)
                };
            }
        }
        return { x: 960, y: 952 };
    };

    const spawnLapConfetti = (cx, cy, lapBonus = null) => {
        if (lapFxRafId) {
            cancelAnimationFrame(lapFxRafId);
            lapFxRafId = null;
        }
        if (stage2dFxLayer) {
            const pt = boardToStage2D(cx, cy);
            const banner = document.createElement('div');
            banner.className = 'lap-2d-banner';
            banner.style.left = `${pt.x.toFixed(1)}px`;
            banner.style.top = `${Math.max(120, pt.y - 44).toFixed(1)}px`;
            const bonusText = Number(lapBonus) > 0
                ? `+${Number(lapBonus).toLocaleString()}`
                : '+750,000';
            banner.textContent = `🎉 순회 완료! ${bonusText}`;
            stage2dFxLayer.appendChild(banner);
            setTimeout(() => { if (banner.parentNode) banner.remove(); }, 1650);
        }
        const colors = ['#F7C744', '#E25B45', '#4E8F26', '#5E72E4', '#FF7EB3', '#FFF9EB', '#00B8B8'];
        const particles = Array.from({ length: 44 }, (_, i) => {
            const angle = (-Math.PI * 0.95) + (i / 43) * Math.PI * 1.9 + (Math.random() - 0.5) * 0.25;
            const speed = 130 + Math.random() * 240;
            return {
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 90,
                size: 7 + Math.random() * 7,
                rot: Math.random() * Math.PI * 2,
                rotV: (Math.random() - 0.5) * 14,
                color: colors[i % colors.length]
            };
        });
        const durationMs = 1150;
        const startTs = performance.now();
        lapFxState = { cx, cy, startTs, durationMs, elapsed: 0, particles };

        const stepFx = (now) => {
            if (isCleanedUp || !lapFxState) return;
            const elapsed = now - startTs;
            lapFxState.elapsed = elapsed;
            if (elapsed >= durationMs) {
                lapFxState = null;
                lapFxRafId = null;
                redrawBoardCanvas();
                return;
            }
            if (!moveAnimRafId) redrawBoardCanvas();
            lapFxRafId = requestAnimationFrame(stepFx);
        };
        lapFxRafId = requestAnimationFrame(stepFx);
    };

    const cancelMoveAnim = () => {
        if (moveAnimRafId) {
            cancelAnimationFrame(moveAnimRafId);
            moveAnimRafId = null;
        }
        if (camResetRafId) {
            cancelAnimationFrame(camResetRafId);
            camResetRafId = null;
        }
        if (lapFxRafId) {
            cancelAnimationFrame(lapFxRafId);
            lapFxRafId = null;
        }
        moveAnimQueue.length = 0;
        queuedPostAnimEvents.length = 0;
        moveAnimState = null;
        impactRingState = null;
        landingRippleState = null;
        lapFxState = null;
        boardShakeOffset = { x: 0, y: 0 };
        applyBoardCamera(1, 540, 540);
        if (stage2dFxLayer) stage2dFxLayer.innerHTML = '';
    };

    const getActiveRingTiles = (tiles = latestViewTiles) => (tiles || [])
        .filter(t => t && !t.isDisabled && t.type !== 'disabled')
        .sort((a, b) => a.id - b.id);

    const resolveIsFollowCamPlayer = (player) => {
        if (!player || player.isAi) return false;
        const myId = RoomManager.isOnline()
            ? RoomManager.localPlayer?.id
            : (latestMainHudPlayer?.id || RoomManager.localPlayer?.id);
        return Boolean(myId && player.id === myId);
    };

    const animatePlayerStepMove = (player, fromPos, toPos, fixedSteps = null, onArrive = null, opts = {}) => {
        const ringTiles = getActiveRingTiles();
        if (!player || ringTiles.length === 0) {
            if (typeof onArrive === 'function') onArrive();
            return;
        }

        let startIdx = ringTiles.findIndex(t => t.id === fromPos);
        if (startIdx < 0) startIdx = 0;
        const startTile = ringTiles[startIdx];

        const path = [];
        if (typeof fixedSteps === 'number' && fixedSteps !== 0) {
            const dir = fixedSteps > 0 ? 1 : -1;
            const count = Math.abs(fixedSteps);
            for (let s = 1; s <= count; s++) {
                const idx = (startIdx + dir * s + ringTiles.length * 10) % ringTiles.length;
                path.push(ringTiles[idx]);
            }
        } else if (typeof toPos === 'number') {
            const endIdx = ringTiles.findIndex(t => t.id === toPos);
            if (endIdx >= 0 && endIdx !== startIdx) {
                const dist = (endIdx - startIdx + ringTiles.length) % ringTiles.length || ringTiles.length;
                for (let s = 1; s <= dist; s++) {
                    path.push(ringTiles[(startIdx + s) % ringTiles.length]);
                }
            }
        }
        if (path.length === 0) {
            if (typeof onArrive === 'function') onArrive();
            return;
        }

        const steps = path.length;
        const maxSteps = Math.max(1, ringTiles.length - 1);
        const baseTotalMs = steps <= 12
            ? Math.min(2400, Math.max(850, steps * 190))
            : Math.round(2280 + ((steps - 12) / Math.max(1, maxSteps - 12)) * (3000 - 2280));
        const baseStepMs = baseTotalMs / steps;
        const hopAmp = baseStepMs >= 130 ? 28 : 18;
        const useFollowCam = opts.useFollowCam !== false && resolveIsFollowCamPlayer(player);
        const lapBonus = opts.lapBonus ?? null;

        const segments = [];
        let cursorMs = 0;
        path.forEach((toTile, idx) => {
            const fromTile = idx === 0 ? startTile : path[idx - 1];
            const hitsStart = toTile.id === 0;
            const isFinal = idx === path.length - 1;
            const moveDur = hitsStart
                ? Math.max(320, baseStepMs * 2.0)
                : (isFinal ? Math.max(260, baseStepMs * 1.45) : baseStepMs);
            const holdDur = (hitsStart || isFinal) ? 280 : 0;
            segments.push({
                fromTile,
                toTile,
                startMs: cursorMs,
                moveEndMs: cursorMs + moveDur,
                endMs: cursorMs + moveDur + holdDur,
                hitsStart,
                isFinal,
                holdDur
            });
            cursorMs += moveDur + holdDur;
        });
        const totalMs = cursorMs;
        const zoomInMs = 300;
        const startTs = performance.now();
        let lapBurstFired = false;

        const frame = (now) => {
            if (isCleanedUp) return;
            const elapsed = Math.max(0, Math.min(totalMs, now - startTs));
            if (elapsed >= totalMs) {
                moveAnimRafId = null;
                moveAnimState = null;
                landingRippleState = null;
                redrawBoardCanvas();
                if (useFollowCam) {
                    resetBoardCameraSmooth(420, () => {
                        if (typeof onArrive === 'function') onArrive();
                    });
                } else {
                    applyBoardCamera(1, 540, 540);
                    if (typeof onArrive === 'function') onArrive();
                }
                return;
            }

            let seg = segments[segments.length - 1];
            for (let i = 0; i < segments.length; i++) {
                if (elapsed < segments[i].endMs) { seg = segments[i]; break; }
            }

            let curX = seg.toTile.x;
            let curY = seg.toTile.y;
            let hopY = 0;
            let scaleX = 1;
            let scaleY = 1;
            let isSlowAccent = false;
            landingRippleState = null;

            if (elapsed < seg.moveEndMs) {
                const rawU = Math.max(0, Math.min(1, (elapsed - seg.startMs) / Math.max(1, seg.moveEndMs - seg.startMs)));
                if (seg.hitsStart || seg.isFinal) {
                    if (rawU < 0.15) {
                        const cU = rawU / 0.15;
                        const sq = Math.sin(cU * Math.PI * 0.5);
                        curX = seg.fromTile.x;
                        curY = seg.fromTile.y;
                        scaleX = 1 + 0.16 * sq;
                        scaleY = 1 - 0.18 * sq;
                    } else {
                        const flyU = (rawU - 0.15) / 0.85;
                        const shapedU = seg.hitsStart
                            ? (flyU < 0.45 ? flyU * 1.45 : 0.6525 + Math.pow((flyU - 0.45) / 0.55, 1.9) * 0.3475)
                            : (flyU < 0.5 ? 2 * flyU * flyU : 1 - Math.pow(-2 * flyU + 2, 2) / 2);
                        curX = seg.fromTile.x + (seg.toTile.x - seg.fromTile.x) * shapedU;
                        curY = seg.fromTile.y + (seg.toTile.y - seg.fromTile.y) * shapedU;
                        const airSin = Math.sin(flyU * Math.PI);
                        hopY = airSin * (hopAmp * 1.65);
                        scaleX = 1 - 0.08 * airSin;
                        scaleY = 1 + 0.10 * airSin;
                    }
                    isSlowAccent = seg.hitsStart;
                } else {
                    const shapedU = rawU < 0.5 ? 2 * rawU * rawU : 1 - Math.pow(-2 * rawU + 2, 2) / 2;
                    curX = seg.fromTile.x + (seg.toTile.x - seg.fromTile.x) * shapedU;
                    curY = seg.fromTile.y + (seg.toTile.y - seg.fromTile.y) * shapedU;
                    hopY = Math.sin(rawU * Math.PI) * hopAmp;
                }
            } else if (seg.hitsStart || seg.isFinal) {
                const holdElapsed = Math.max(0, elapsed - seg.moveEndMs);
                const holdU = Math.min(1, holdElapsed / Math.max(1, seg.holdDur));
                const sqU = Math.min(1, holdElapsed / 150);
                const sq = Math.sin(sqU * Math.PI) * (1 - sqU * 0.45);
                scaleX = 1 + 0.16 * sq;
                scaleY = 1 - 0.16 * sq;
                landingRippleState = {
                    px: seg.toTile.x,
                    py: seg.toTile.y,
                    progress: Math.min(1, holdU / 0.96)
                };
                if (seg.hitsStart) {
                    isSlowAccent = true;
                    if (!lapBurstFired) {
                        lapBurstFired = true;
                        if (useFollowCam) {
                            const camRamp = Math.min(1, elapsed / zoomInMs);
                            const camEase = 1 - Math.pow(1 - camRamp, 3);
                            applyBoardCamera(1 + 1.0 * camEase, curX, curY);
                        }
                        if (lapBonus === null || Number(lapBonus) > 0) {
                            spawnLapConfetti(seg.toTile.x, seg.toTile.y, lapBonus);
                        }
                    }
                }
            }

            moveAnimState = {
                playerId: player.id,
                px: curX,
                py: curY,
                hopY,
                tiltRad: 0,
                scaleX,
                scaleY,
                alpha: 1,
                baseTileId: null,
                slowGlowTileId: isSlowAccent ? seg.toTile.id : null
            };

            if (useFollowCam) {
                const camRamp = Math.min(1, elapsed / zoomInMs);
                const camEase = 1 - Math.pow(1 - camRamp, 3);
                applyBoardCamera(1 + 1.0 * camEase, curX, curY);
            }

            redrawBoardCanvas();
            moveAnimRafId = requestAnimationFrame(frame);
        };
        moveAnimRafId = requestAnimationFrame(frame);
    };

    const animateReincarnatedAltarMove = (player, fromPos, toPos = BOARD_TILES.ALTAR, onComplete = null) => {
        const ringTiles = getActiveRingTiles();
        const startTile = ringTiles.find(t => t.id === fromPos) || ringTiles[0];
        const destTile = ringTiles.find(t => t.id === toPos) || ringTiles.find(t => t.id === BOARD_TILES.ALTAR) || ringTiles[0];
        if (!player || !startTile || !destTile) {
            if (typeof onComplete === 'function') onComplete();
            return;
        }

        const totalMs = 2050;
        const tCrouch = 280;
        const tAscend = 820;
        const tSlam = 1260;
        const startTs = performance.now();

        const frame = (now) => {
            if (isCleanedUp) return;
            const elapsed = Math.max(0, Math.min(totalMs, now - startTs));
            if (elapsed >= totalMs) {
                moveAnimRafId = null;
                moveAnimState = null;
                impactRingState = null;
                boardShakeOffset = { x: 0, y: 0 };
                applyBoardCamera(1, 540, 540);
                redrawBoardCanvas();
                if (typeof onComplete === 'function') onComplete();
                return;
            }

            let px = startTile.x;
            let py = startTile.y;
            let hopY = 0;
            let scaleX = 1;
            let scaleY = 1;
            let tiltRad = 0;
            let alpha = 1;
            let baseTileId = startTile.id;

            if (elapsed < tCrouch) {
                const u = elapsed / tCrouch;
                const sq = Math.sin(u * Math.PI * 0.5);
                scaleX = 1 + 0.26 * sq;
                scaleY = 1 - 0.32 * sq;
            } else if (elapsed < tAscend) {
                const u = (elapsed - tCrouch) / (tAscend - tCrouch);
                hopY = Math.pow(u, 1.9) * 840;
                scaleX = 0.82;
                scaleY = 1.22;
                alpha = hopY > 640 ? Math.max(0, 1 - (hopY - 640) / 200) : 1;
            } else if (elapsed < tSlam) {
                const u = (elapsed - tAscend) / (tSlam - tAscend);
                px = destTile.x;
                py = destTile.y;
                hopY = (1 - Math.pow(u, 2.5)) * 840;
                scaleX = 0.84;
                scaleY = 1.20;
                alpha = hopY > 640 ? Math.max(0, 1 - (hopY - 640) / 200) : 1;
                baseTileId = startTile.id;
            } else {
                const u = (elapsed - tSlam) / (totalMs - tSlam);
                px = destTile.x;
                py = destTile.y;
                baseTileId = destTile.id;
                if (u < 0.22) {
                    const sU = 1 - (u / 0.22);
                    scaleX = 1 + 0.28 * sU;
                    scaleY = 1 - 0.28 * sU;
                    boardShakeOffset = {
                        x: Math.sin(u * Math.PI * 10) * 5 * sU,
                        y: Math.cos(u * Math.PI * 8) * 4 * sU
                    };
                } else {
                    boardShakeOffset = { x: 0, y: 0 };
                    const reb = Math.max(0, 1 - (u - 0.22) / 0.3);
                    scaleX = 1 - 0.06 * reb;
                    scaleY = 1 + 0.06 * reb;
                }
                tiltRad = Math.sin(u * Math.PI * 5.0) * Math.exp(-u * 3.6) * 0.38;
                impactRingState = {
                    px: destTile.x,
                    py: destTile.y,
                    progress: Math.min(1, u / 0.65)
                };
                applyBoardCamera(1, 540, 540);
            }

            moveAnimState = {
                playerId: player.id,
                px,
                py,
                hopY,
                tiltRad,
                scaleX,
                scaleY,
                alpha,
                baseTileId,
                slowGlowTileId: elapsed >= tSlam ? destTile.id : null
            };
            redrawBoardCanvas();
            moveAnimRafId = requestAnimationFrame(frame);
        };
        moveAnimRafId = requestAnimationFrame(frame);
    };

    const animateCardAscendMove = (player, fromPos, toPos, onArrive = null) => {
        const ringTiles = getActiveRingTiles();
        const startTile = ringTiles.find(t => t.id === fromPos) || ringTiles[0];
        const destTile = ringTiles.find(t => t.id === toPos) || startTile;
        if (!player || !startTile || !destTile || startTile.id === destTile.id) {
            if (typeof onArrive === 'function') onArrive();
            return;
        }

        const totalMs = 1150;
        const tAscend = 540;
        const startTs = performance.now();

        const frame = (now) => {
            if (isCleanedUp) return;
            const elapsed = Math.max(0, Math.min(totalMs, now - startTs));
            if (elapsed >= totalMs) {
                moveAnimRafId = null;
                moveAnimState = null;
                redrawBoardCanvas();
                if (typeof onArrive === 'function') onArrive();
                return;
            }

            let px = startTile.x;
            let py = startTile.y;
            let hopY = 0;
            let alpha = 1;
            let baseTileId = startTile.id;

            if (elapsed < tAscend) {
                const u = elapsed / tAscend;
                hopY = Math.pow(u, 2.2) * 760;
                alpha = hopY > 560 ? Math.max(0, 1 - (hopY - 560) / 200) : 1;
                baseTileId = startTile.id;
            } else {
                const u = (elapsed - tAscend) / (totalMs - tAscend);
                px = destTile.x;
                py = destTile.y;
                hopY = Math.pow(1 - u, 2.4) * 760;
                alpha = hopY > 560 ? Math.max(0, 1 - (hopY - 560) / 200) : 1;
                baseTileId = destTile.id;
            }

            moveAnimState = {
                playerId: player.id,
                px,
                py,
                hopY,
                tiltRad: 0,
                scaleX: 1,
                scaleY: 1,
                alpha,
                baseTileId,
                slowGlowTileId: null
            };
            redrawBoardCanvas();
            moveAnimRafId = requestAnimationFrame(frame);
        };
        moveAnimRafId = requestAnimationFrame(frame);
    };

    const animateBbangjuArcMove = (player, fromPos, toPos, onArrive = null) => {
        const ringTiles = getActiveRingTiles();
        if (!player || ringTiles.length === 0) {
            if (typeof onArrive === 'function') onArrive();
            return;
        }
        let startIdx = ringTiles.findIndex(t => t.id === fromPos);
        if (startIdx < 0) startIdx = 0;
        const endIdx = ringTiles.findIndex(t => t.id === toPos);
        if (endIdx < 0 || endIdx === startIdx) {
            if (typeof onArrive === 'function') onArrive();
            return;
        }

        const distSteps = (endIdx - startIdx + ringTiles.length) % ringTiles.length || 1;
        const waypoints = [];
        for (let s = 0; s <= distSteps; s++) {
            waypoints.push(ringTiles[(startIdx + s) % ringTiles.length]);
        }
        const destTile = waypoints[waypoints.length - 1];

        const ratio = Math.min(1, distSteps / Math.max(1, ringTiles.length - 1));
        const tTravel = Math.round(780 + Math.pow(ratio, 0.78) * 1650);
        const tRebound = 230;
        const totalMs = tTravel + tRebound;
        const arcPeak = Math.round(28 + ratio * 38);
        const startTs = performance.now();

        const frame = (now) => {
            if (isCleanedUp) return;
            const elapsed = Math.max(0, Math.min(totalMs, now - startTs));
            if (elapsed >= totalMs) {
                moveAnimRafId = null;
                moveAnimState = null;
                redrawBoardCanvas();
                if (typeof onArrive === 'function') onArrive();
                return;
            }

            let px = destTile.x;
            let py = destTile.y;
            let hopY = 0;
            let tiltRad = 0;
            let scaleX = 1;
            let scaleY = 1;
            let showGlow = false;

            if (elapsed < tTravel && waypoints.length >= 2) {
                const rawU = Math.max(0, Math.min(1, elapsed / Math.max(1, tTravel)));
                const travelU = rawU * rawU * rawU * (rawU * (rawU * 6 - 15) + 10);
                const speedNorm = Math.pow(Math.sin(Math.PI * rawU), 1.4);
                const fIdx = Math.max(0, travelU * (waypoints.length - 1));
                const lo = Math.max(0, Math.min(waypoints.length - 2, Math.floor(fIdx)));
                const frac = Math.max(0, Math.min(1, fIdx - lo));
                const pA = waypoints[lo] || destTile;
                const pB = waypoints[lo + 1] || destTile;

                px = pA.x + (pB.x - pA.x) * frac;
                py = pA.y + (pB.y - pA.y) * frac;
                hopY = speedNorm * arcPeak;
                const tiltAmp = speedNorm * 0.22;
                const isLeftTiltSide = (pA.side === 1 || pA.side === 2);
                tiltRad = isLeftTiltSide ? -tiltAmp : tiltAmp;
                showGlow = rawU > 0.85;
            } else {
                const rU = (elapsed - tTravel) / tRebound;
                const approachTile = waypoints[Math.max(0, waypoints.length - 2)] || destTile;
                const approachDir = (approachTile.side === 1 || approachTile.side === 2) ? -1 : 1;
                tiltRad = -approachDir * 0.095 * Math.sin(rU * Math.PI) * (1 - rU * 0.35);
                const sq = Math.sin(rU * Math.PI) * (1 - rU * 0.5);
                scaleX = 1 + 0.08 * sq;
                scaleY = 1 - 0.08 * sq;
                showGlow = true;
            }

            moveAnimState = {
                playerId: player.id,
                px,
                py,
                hopY,
                tiltRad,
                scaleX,
                scaleY,
                alpha: 1,
                baseTileId: destTile.id,
                slowGlowTileId: showGlow ? destTile.id : null
            };
            redrawBoardCanvas();
            moveAnimRafId = requestAnimationFrame(frame);
        };
        moveAnimRafId = requestAnimationFrame(frame);
    };

    const animateShaydiBlackholeMove = (player, fromPos, toPos = BOARD_TILES.VOID, onArrive = null) => {
        const ringTiles = getActiveRingTiles();
        const startTile = ringTiles.find(t => t.id === fromPos) || ringTiles[0];
        const destTile = ringTiles.find(t => t.id === toPos) || ringTiles.find(t => t.id === BOARD_TILES.VOID) || ringTiles[0];
        if (!player || !startTile || !destTile) {
            if (typeof onArrive === 'function') onArrive();
            return;
        }

        const tOpen = 280;
        const tHopUp = 140;
        const tPlunge = 450;
        const tVoid = 220;
        const tRise = 160;
        const tSpitHang = 360;
        const tDrop = 220;
        const tSettle = 140;
        const pHopUpEnd = tOpen + tHopUp;
        const pPlungeEnd = pHopUpEnd + tPlunge;
        const pVoidEnd = pPlungeEnd + tVoid;
        const pRiseEnd = pVoidEnd + tRise;
        const pSpitHangEnd = pRiseEnd + tSpitHang;
        const pDropEnd = pSpitHangEnd + tDrop;
        const totalMs = pDropEnd + tSettle;
        const hopApexY = 38;
        const crossFrac = 0.25;
        const peakHopY = 76;
        const startTs = performance.now();

        const frame = (now) => {
            if (isCleanedUp) return;
            const elapsed = Math.max(0, Math.min(totalMs, now - startTs));
            if (elapsed >= totalMs) {
                moveAnimRafId = null;
                moveAnimState = null;
                redrawBoardCanvas();
                if (typeof onArrive === 'function') onArrive();
                return;
            }

            let px = startTile.x;
            let py = startTile.y;
            let hopY = 0;
            let sinkRatio = 0;
            let clipAtHole = false;
            let scaleX = 1;
            let scaleY = 1;
            let alpha = 1;
            let blackhole = null;

            if (elapsed < tOpen) {
                const u = elapsed / tOpen;
                blackhole = { px: startTile.x, py: startTile.y, open: 1 - Math.pow(1 - u, 3), spin: elapsed * 0.008 };
            } else if (elapsed < pHopUpEnd) {
                const u = (elapsed - tOpen) / tHopUp;
                blackhole = { px: startTile.x, py: startTile.y, open: 1, spin: elapsed * 0.012 };
                hopY = hopApexY * (1 - Math.pow(1 - u, 2));
            } else if (elapsed < pPlungeEnd) {
                const u = (elapsed - pHopUpEnd) / tPlunge;
                const totalNorm = Math.pow(u, 2.25);
                blackhole = { px: startTile.x, py: startTile.y, open: 1, spin: elapsed * 0.016 };
                if (totalNorm <= crossFrac) {
                    hopY = hopApexY * (1 - totalNorm / crossFrac);
                } else {
                    const subU = (totalNorm - crossFrac) / (1 - crossFrac);
                    clipAtHole = true;
                    sinkRatio = subU * 1.06;
                    alpha = subU > 0.88 ? Math.max(0, 1 - (subU - 0.88) / 0.12) : 1;
                }
            } else if (elapsed < pVoidEnd) {
                const u = (elapsed - pPlungeEnd) / tVoid;
                px = destTile.x;
                py = destTile.y;
                alpha = 0;
                clipAtHole = true;
                sinkRatio = 1.06;
                blackhole = {
                    px: u < 0.5 ? startTile.x : destTile.x,
                    py: u < 0.5 ? startTile.y : destTile.y,
                    open: u < 0.5 ? (1 - u * 2) : ((u - 0.5) * 2),
                    spin: elapsed * 0.016
                };
            } else if (elapsed < pRiseEnd) {
                const u = (elapsed - pVoidEnd) / tRise;
                px = destTile.x;
                py = destTile.y;
                blackhole = { px: destTile.x, py: destTile.y, open: 1, spin: elapsed * 0.015 };
                clipAtHole = true;
                sinkRatio = 1.04 * Math.pow(1 - u, 1.7);
                alpha = Math.min(1, u * 7);
            } else if (elapsed < pSpitHangEnd) {
                const u = (elapsed - pRiseEnd) / tSpitHang;
                px = destTile.x;
                py = destTile.y;
                blackhole = { px: destTile.x, py: destTile.y, open: 1 - u * 0.45, spin: elapsed * 0.012 };
                if (u < 0.72) {
                    const upU = u / 0.72;
                    hopY = peakHopY * (1 - Math.pow(1 - upU, 3.0));
                } else {
                    const hangU = (u - 0.72) / 0.28;
                    hopY = peakHopY + Math.sin(hangU * Math.PI) * 2.5;
                }
            } else if (elapsed < pDropEnd) {
                const u = (elapsed - pSpitHangEnd) / tDrop;
                px = destTile.x;
                py = destTile.y;
                blackhole = { px: destTile.x, py: destTile.y, open: Math.max(0.18, 0.55 * (1 - u * 0.65)), spin: elapsed * 0.011 };
                hopY = peakHopY * (1 - Math.pow(u, 2.35));
            } else {
                const u = (elapsed - pDropEnd) / tSettle;
                px = destTile.x;
                py = destTile.y;
                blackhole = { px: destTile.x, py: destTile.y, open: Math.max(0, 0.18 * (1 - u)), spin: elapsed * 0.01 };
                const sq = Math.sin(u * Math.PI) * (1 - u * 0.5);
                scaleX = 1 + 0.16 * sq;
                scaleY = 1 - 0.16 * sq;
            }

            moveAnimState = {
                playerId: player.id,
                px,
                py,
                hopY,
                sinkRatio,
                clipAtHole,
                tiltRad: 0,
                scaleX,
                scaleY,
                alpha,
                baseTileId: elapsed < pPlungeEnd ? startTile.id : (elapsed < pVoidEnd ? startTile.id : destTile.id),
                blackhole
            };
            redrawBoardCanvas();
            moveAnimRafId = requestAnimationFrame(frame);
        };
        moveAnimRafId = requestAnimationFrame(frame);
    };

    const flushPostAnimState = () => {
        if (isCleanedUp || isMoveAnimating()) return;
        while (queuedPostAnimEvents.length > 0) {
            const evt = queuedPostAnimEvents.shift();
            if (evt?.kind === 'SOOT_CLIMAX_ANNOUNCE') {
                showSootClimaxAnnounce(evt.payload);
            } else if (evt?.kind === 'GAME_OVER') {
                handleSettlement(evt.payload?.results);
                return;
            }
        }
        if (latestSnapshot) {
            redrawBoardCanvas();
            syncPrompt(latestSnapshot.pendingPrompt, latestViewTiles, latestSnapshot);
            syncBoardPeekUi(latestSnapshot);
            if (latestSnapshot.phase === 'GAME_OVER' && latestSnapshot.settlementResults) {
                handleSettlement(latestSnapshot.settlementResults);
            }
        }
    };

    const drainNextMoveAnim = () => {
        if (isCleanedUp || moveAnimRafId || camResetRafId) return;
        if (moveAnimQueue.length === 0) {
            flushPostAnimState();
            return;
        }
        const job = moveAnimQueue.shift();
        const player = (latestSnapshot?.players || []).find(p => p && p.id === job.playerId) || { id: job.playerId, pos: job.toPos };
        const onDone = () => {
            if (isCleanedUp) return;
            drainNextMoveAnim();
        };

        PopupManager.closeAll();
        closeTerritoryPopups();
        closeHandPopups();

        if (job.moveKind === 'altar') {
            animateReincarnatedAltarMove(player, job.fromPos, job.toPos ?? BOARD_TILES.ALTAR, onDone);
        } else if (job.moveKind === 'bbangju') {
            animateBbangjuArcMove(player, job.fromPos, job.toPos, onDone);
        } else if (job.moveKind === 'card') {
            animateCardAscendMove(player, job.fromPos, job.toPos, onDone);
        } else if (job.moveKind === 'blackhole') {
            animateShaydiBlackholeMove(player, job.fromPos, job.toPos ?? BOARD_TILES.VOID, onDone);
        } else {
            animatePlayerStepMove(player, job.fromPos, job.toPos, job.steps, onDone, {
                lapBonus: job.lapBonus
            });
        }
    };

    const enqueueMoveAnim = (job) => {
        if (isCleanedUp || !job || !job.playerId) return;
        if (typeof job.fromPos !== 'number' || typeof job.toPos !== 'number' || job.fromPos === job.toPos) return;
        if (typeof requestAnimationFrame !== 'function') {
            return;
        }
        moveAnimQueue.push(job);
        if (!moveAnimRafId && !camResetRafId) {
            drainNextMoveAnim();
        }
    };

    let diceAnimInterval = null;
    let dice3DRafId = null;
    let diceThrowStartTs = 0;
    let diceRollAnimSeq = -1;
    let isDiceSpinning = false;
    let turnOrderSpinInterval = null;
    let turnOrderSpinTimeout = null;
    let isTurnOrderSpinning = false;
    const stampedTurnOrderIds = new Set();
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
    let isLogExpanded = false;
    const gameLogs = [];

    const pushGameLog = (msg, turnOverride = null) => {
        const cleanMsg = String(msg || '').replace(/\s+/g, ' ').trim();
        if (!cleanMsg) return;
        const turnNum = turnOverride ?? latestSnapshot?.world?.currentTurn ?? 1;
        const prev = gameLogs[0];
        if (prev && prev.turn === turnNum && prev.text === cleanMsg) return;
        gameLogs.unshift({ turn: turnNum, text: cleanMsg });
        if (gameLogs.length > 24) gameLogs.length = 24;
        const feedEl = document.getElementById('hud-log-feed');
        if (feedEl) {
            feedEl.innerHTML = renderGameLogRowsHtml(gameLogs);
        }
    };

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
        'portal-hint-banner',
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
                statusEl.style.color = '#2D539E';
            }
            if (actionsEl) actionsEl.style.display = 'none';
        } else {
            const isMyUsableWindow = Boolean(canActNow && !snapshot?.pendingPrompt && !isDiceSpinning);
            const canClickUse = isMyUsableWindow && Boolean(card.canUseNow);
            if (actionsEl) actionsEl.style.display = isMyUsableWindow ? 'flex' : 'none';
            if (statusEl) {
                if (canClickUse) {
                    statusEl.innerText = '';
                } else if (!isMyUsableWindow) {
                    statusEl.innerText = cText.INV_NOT_MY_TURN || '자신의 턴에서 주사위를 굴리기 전에 사용할 수 있습니다.';
                    statusEl.style.color = '#B84214';
                } else {
                    statusEl.innerText = cText.CANT_USE_NOW || '현재 사용할 수 없습니다.';
                    statusEl.style.color = '#B83724';
                }
            }
            if (useBtn) {
                useBtn.innerText = cText.BTN_USE || '사용하기';
                useBtn.disabled = !canClickUse;
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
        if (titleEl) titleEl.innerText = cText.INV_TITLE || '🎒 보유카드 인벤토리';
        if (descEl) descEl.innerText = cText.INV_DESC || '';

        const sortBySeq = (arr) => (arr || []).slice().sort((a, b) => (a.acquiredSeq ?? a.index ?? 0) - (b.acquiredSeq ?? b.index ?? 0));
        const sections = [
            { key: 'use', title: cText.INV_SEC_USE || '사용형 카드', color: '#733A91', items: sortBySeq(mainHudPlayer.inventory) },
            { key: 'hold', title: cText.INV_SEC_HOLD || '보유형 카드', color: '#2D539E', items: sortBySeq(mainHudPlayer.holdCards) }
        ];
        if (modeCfg.enableTreasureAndRequiem) {
            sections.push({ key: 'treasure', title: cText.INV_SEC_TREASURE || '보물 카드', color: '#B35300', items: sortBySeq(mainHudPlayer.treasureCards) });
        }

        const nonEmptySections = sections.filter(sec => sec.items.length > 0);
        if (listEl) {
            listEl.innerHTML = '';
            if (nonEmptySections.length === 0) {
                const emptyBox = document.createElement('div');
                emptyBox.style.cssText = 'padding: 36px 16px; text-align: center; font-size: 20px; font-weight: 800; color: #7C5133; background: rgba(255,255,255,0.68); border: 2px dashed #CFA067; border-radius: 14px;';
                emptyBox.innerText = cText.INV_EMPTY || '손패에 아무것도 없어요!';
                listEl.appendChild(emptyBox);
            } else {
                const isMyWindow = Boolean(canActNow && !snapshot?.pendingPrompt && !isDiceSpinning);
                nonEmptySections.forEach((sec) => {
                    const secWrap = document.createElement('div');
                    secWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
                    const header = document.createElement('div');
                    header.style.cssText = `font-size: 16px; font-weight: 900; color: ${sec.color}; border-bottom: 1.5px solid #D9B079; padding-bottom: 4px;`;
                    header.innerText = `${sec.title} (${sec.items.length})`;
                    secWrap.appendChild(header);

                    sec.items.forEach((card) => {
                        const rowBtn = document.createElement('button');
                        rowBtn.type = 'button';
                        rowBtn.className = 'list-card-row';
                        const usableTag = card.subType === 'hold'
                            ? `<span style="font-size: 13px; padding: 3px 9px; border-radius: 999px; background: #E3EEFF; color: #2D539E; font-weight: 900;">보유중</span>`
                            : (isMyWindow && card.canUseNow
                                ? `<span style="font-size: 13px; padding: 3px 9px; border-radius: 999px; background: #D7F5C7; color: #2E7D32; font-weight: 900;">사용 가능</span>`
                                : (card.subType === 'treasure' && card.maxUses > 0
                                    ? `<span style="font-size: 13px; padding: 3px 9px; border-radius: 999px; background: #FFF0C2; color: #B35300; font-weight: 900;">${card.remainingUses}/${card.maxUses}</span>`
                                    : `<span style="font-size: 13px; padding: 3px 9px; border-radius: 999px; background: #FFE2D1; color: #A93215; font-weight: 900;">상세보기</span>`));
                        rowBtn.innerHTML = `<span style="font-size: 18px; font-weight: 900; color: #3D2010;">${escapeHtml(formatCardDisplayTitle(card))}</span>${usableTag}`;
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
                descEl.innerText = getTileIntroDesc(tile, LangState.current, snapshot?.world);
            }
        }

        const worldState = snapshot?.world || {};
        const gameMode = worldState.gameMode || initialBoardMode;
        const modeCfg = getModeConfig(gameMode);
        const isBuyable = tile.type === 'normal' || tile.type === 'special_buy';
        const ownerPlayer = tile.owner || (tile.ownerId ? (snapshot?.players || []).find(p => p.id === tile.ownerId) : null);
        const timeBadge = tile.timeType === 'day'
            ? `<span style="background:#FFF0C2; color:#B35300; border:1px solid #F39C12; padding:2px 8px; border-radius:999px; font-weight:900; margin-right:6px;">☀️ ${escapeHtml(gText.TILE_TIME_DAY || '낮')}</span>`
            : (tile.timeType === 'night'
                ? `<span style="background:#EFE3FF; color:#5E2B7A; border:1px solid #9B59B6; padding:2px 8px; border-radius:999px; font-weight:900; margin-right:6px;">🌙 ${escapeHtml(gText.TILE_TIME_NIGHT || '밤')}</span>`
                : '');

        const formatTollMultSuffix = (baseToll, curToll) => {
            if (!(baseToll > 0)) return '';
            const ratio = curToll / baseToll;
            const multStr = Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(2).replace(/\.?0+$/, '');
            return ` (기본 × ${multStr}배)`;
        };

        const NO_STATS_TILE_IDS = new Set([2, 7, 10, 12, 17, 22, 28, 35, 38]);
        const SPECIAL_PURCHASE_META = {
            [BOARD_TILES.THEATER]: {
                buy: GAME_CONSTANTS.THEATER_BUY,
                take: GAME_CONSTANTS.THEATER_TAKE,
                profit: GAME_CONSTANTS.THEATER_TURN_PROFIT
            },
            [BOARD_TILES.MONATIUM_25]: {
                buy: GAME_CONSTANTS.MONATIUM_BUY,
                tolls: [
                    GAME_CONSTANTS.TOLL_MONATIUM_0,
                    GAME_CONSTANTS.TOLL_MONATIUM_1,
                    GAME_CONSTANTS.TOLL_MONATIUM_2
                ],
                expand1: GAME_CONSTANTS.MONATIUM_EXPAND_1,
                expand2: GAME_CONSTANTS.MONATIUM_EXPAND_2,
                labels: ['1단계 (기본 점포)', '2단계 (1차 확장)', '최종 단계 (2차 확장)']
            },
            [BOARD_TILES.LAKE]: {
                buy: GAME_CONSTANTS.LAKE_BUY,
                toll: GAME_CONSTANTS.TOLL_LAKE,
                furryFee: Math.round(GAME_CONSTANTS.FURRY_BEACH_FEE * (worldState.furryBeachFeeMultiplier || 1)),
                summonFee: GAME_CONSTANTS.LAKE_SUMMON_FEE
            },
            [BOARD_TILES.LIBRARY]: {
                buy: GAME_CONSTANTS.LIBRARY_BUY,
                toll: GAME_CONSTANTS.TOLL_LIBRARY,
                label: '이용료'
            },
            [BOARD_TILES.DAYA]: {
                buy: GAME_CONSTANTS.DAYA_BUY,
                toll: GAME_CONSTANTS.TOLL_DAYA,
                take: GAME_CONSTANTS.DAYA_TAKE,
                label: '통행료'
            }
        };

        const setElVisible = (el, displayVal, html = undefined) => {
            if (!el) return;
            el.style.display = displayVal;
            if (html !== undefined) el.innerHTML = html;
        };

        if (canShowOwned) {
            setElVisible(
                metaEl,
                'block',
                `${timeBadge}현재 건설 단계: <b>${escapeHtml(getTileLevelText(tile, mText))}</b> · 매입가: <b>${escapeHtml(formatMoney(getTileBuyPrice(tile)))}</b>`
            );
            const oneXToll = getTileBaseOneX(tile);
            const appliedToll = Number.isFinite(tile.currentToll) ? tile.currentToll : oneXToll;
            const canSell = !isSpecialTerritoryTile(tile) && tile.level >= 0;
            const sellStr = canSell ? formatMoney(getTileSellValue(tile)) : '매각 불가';
            const multSuffix = formatTollMultSuffix(oneXToll, appliedToll);
            setElVisible(statsEl, 'flex', `
                <div style="display:flex; justify-content:space-between;"><span>기본 통행료</span><strong style="color:#B35300;">${escapeHtml(formatMoney(oneXToll))}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>현재 통행료${escapeHtml(multSuffix)}</span><strong style="color:#C2410C;">${escapeHtml(formatMoney(appliedToll))}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>매각 가격 (80%)</span><strong style="color:#2E7D32;">${escapeHtml(sellStr)}</strong></div>
            `);
            if (upgEl) {
                upgEl.style.display = 'flex';
                const rows = getTileUpgradeRows(tile, mText);
                if (rows.length === 0) {
                    upgEl.innerHTML = `<div style="padding: 10px 12px; background: rgba(255,255,255,0.68); border: 1.5px solid #CFA067; border-radius: 10px; color: #7C5133; font-weight: 800; text-align: center;">${isSpecialTerritoryTile(tile) && tile.id !== BOARD_TILES.MONATIUM_25 ? '추가 증축 없음' : '최고 단계 건설 완료'}</div>`;
                } else {
                    const headerHtml = `<div style="font-size: 14px; font-weight: 900; color: #6E3D1E; margin-bottom: 2px;">다음 단계별 증축 비용</div>`;
                    const rowsHtml = rows.map(r => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding: 7px 10px; background: rgba(255,255,255,0.72); border: 1.5px solid #CFA067; border-radius: 8px; color: #3D2010;">
                            <span style="font-weight: 800;">${escapeHtml(r.label)}</span>
                            <span><b style="color:#B35300;">${escapeHtml(formatMoney(r.stepCost))}</b> <span style="color:#7C5133;">(이전단계 합계 ${escapeHtml(formatMoney(r.cumCost))})</span></span>
                        </div>
                    `).join('');
                    upgEl.innerHTML = headerHtml + rowsHtml;
                }
            }
        } else if (tile.id === BOARD_TILES.START) {
            const viewerOrderIdx = Math.max(0, (Number(mainHudPlayer?.playerIndex) || 1) - 1);
            const curLap = Math.max(1, (Number(mainHudPlayer?.lapPassCount) || 0) + 1);
            const baseBonus = resolveLapBaseBonus(viewerOrderIdx, false, 0, gameMode);
            const curBonus = resolveLapBaseBonus(viewerOrderIdx, curLap > 1, curLap - 1, gameMode);
            const nextBonus = resolveLapBaseBonus(viewerOrderIdx, true, curLap, gameMode);
            setElVisible(
                metaEl,
                'block',
                `<span style="background:#FFF0C2; color:#B35300; border:1px solid #F39C12; padding:2px 10px; border-radius:999px; font-weight:900;">🎉 현재 순회 : ${curLap}바퀴째</span>`
            );
            setElVisible(statsEl, 'flex', `
                <div style="display:flex; justify-content:space-between;"><span>기본 순회 보상 (1바퀴 기준)</span><strong style="color:#724929;">${escapeHtml(formatMoney(baseBonus))}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>현재 순회 보상 (${curLap}바퀴째)</span><strong style="color:#B35300;">${escapeHtml(formatMoney(curBonus))}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>다음 순회 보상 (${curLap + 1}바퀴째)</span><strong style="color:#D95318;">${escapeHtml(formatMoney(nextBonus))}</strong></div>
            `);
            setElVisible(upgEl, 'none', '');
        } else if (tile.id === BOARD_TILES.MOUNTAIN) {
            const disciple = (snapshot?.players || []).find(p => p && !p.isBankrupt && p.hasMountainBuff);
            setElVisible(
                metaEl,
                'block',
                disciple
                    ? `현재 제자 : <b style="color:${escapeHtml(disciple.color || '#2E7D32')};">${escapeHtml(disciple.name)}</b>`
                    : `현재 제자 : <b style="color:#724929;">제자가 없어요!</b>`
            );
            setElVisible(statsEl, 'flex', `
                <div style="display:flex; justify-content:space-between;"><span>매 턴 수업료</span><strong style="color:#B35300;">${escapeHtml(formatMoney(GAME_CONSTANTS.MOUNTAIN_FEE))}</strong></div>
            `);
            setElVisible(upgEl, 'none', '');
        } else if (tile.id === BOARD_TILES.BBANGJU) {
            const completed = isBbangjuCompleted(worldState);
            if (!completed) {
                if (modeCfg.enableBbangjuChief) {
                    const supportFee = modeCfg.bbangjuSupportInstallment || GAME_CONSTANTS.BBANGJU_SUPPORT_INSTALLMENT;
                    const takeoverFee = modeCfg.bbangjuDirectPurchase || GAME_CONSTANTS.BBANGJU_DIRECT_PURCHASE;
                    setElVisible(metaEl, 'block', `상태 : <b style="color:#B35300;">제작중 (4턴 전 / 빵주 정비소)</b>`);
                    setElVisible(statsEl, 'flex', `
                        <div style="display:flex; justify-content:space-between;"><span>제작 지원금 (회당)</span><strong style="color:#B35300;">${escapeHtml(formatMoney(supportFee))}</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>정비반장 즉시 취임</span><strong style="color:#D95318;">${escapeHtml(formatMoney(takeoverFee))}</strong></div>
                    `);
                } else {
                    const earlyFee = modeCfg.bbangjuEarlyOpenFee || 500000;
                    const openTurn = modeCfg.bbangjuOpenTurn || 3;
                    setElVisible(metaEl, 'block', `상태 : <b style="color:#B35300;">제작중 (${openTurn}턴 자동 개방)</b>`);
                    setElVisible(statsEl, 'flex', `
                        <div style="display:flex; justify-content:space-between;"><span>조기 개방 비용 (1~2턴)</span><strong style="color:#B35300;">${escapeHtml(formatMoney(earlyFee))}</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>이용료 (개방 후)</span><strong style="color:#D95318;">${escapeHtml(formatMoney(GAME_CONSTANTS.BBANGJU_BASE_FEE))}</strong></div>
                    `);
                }
            } else {
                const isSelfChief = Boolean(mainHudPlayer?.isBbangjuChief);
                const hasOtherChief = (snapshot?.players || []).some(p => p && !p.isBankrupt && p.isBbangjuChief && p.id !== mainHudPlayer?.id);
                setElVisible(metaEl, 'none', '');
                setElVisible(statsEl, 'flex', `
                    <div style="display:flex; justify-content:space-between;"><span>이용료</span><strong style="color:#B35300;">${isSelfChief ? '0 엘드르 달러 (정비반장 면제)' : escapeHtml(formatMoney(GAME_CONSTANTS.BBANGJU_BASE_FEE))}</strong></div>
                    ${(!isSelfChief && hasOtherChief) ? `<div style="display:flex; justify-content:space-between;"><span>빵주 정비반장 상납금</span><strong style="color:#D95318;">${escapeHtml(formatMoney(GAME_CONSTANTS.BBANGJU_CHIEF_FEE))}</strong></div>` : ''}
                `);
            }
            setElVisible(upgEl, 'none', '');
        } else if (tile.id === BOARD_TILES.ALTAR) {
            const awakened = Boolean(mainHudPlayer?.hasVisitedAltar || (mainHudPlayer?.altarVisitCount || 0) >= 1);
            if (modeCfg.altarWarpToRandomCardTile) {
                setElVisible(metaEl, 'block', `제단 상태 : <b style="color:#2D539E;">차원 열쇠 포탈 활성화</b>`);
                setElVisible(statsEl, 'flex', `
                    <div style="display:flex; justify-content:space-between;"><span>도착 효과</span><strong style="color:#2D539E;">랜덤 차원 열쇠 칸 즉시 이동</strong></div>
                `);
            } else {
                setElVisible(
                    metaEl,
                    'block',
                    awakened
                        ? `제단 상태 : <b style="color:#8E44AD;">방문함 (미지의 힘이 깨어난 상태)</b>`
                        : `제단 상태 : <b style="color:#724929;">방문 안 함 (일반 상태)</b>`
                );
                setElVisible(statsEl, 'flex', awakened
                    ? `
                        <div style="display:flex; justify-content:space-between;"><span>차원 열쇠 보물 해금</span><strong style="color:#8E44AD;">활성화 완료</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>보물 카드 교환 보상</span><strong style="color:#B35300;">${escapeHtml(formatMoney(GAME_CONSTANTS.ALTAR_REWARD))}</strong></div>
                    `
                    : `
                        <div style="display:flex; justify-content:space-between;"><span>차원 열쇠 보물 해금</span><strong style="color:#724929;">미해금 (방문 시 개방)</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>보물 카드 교환 보상</span><strong style="color:#B35300;">${escapeHtml(formatMoney(GAME_CONSTANTS.ALTAR_REWARD))}</strong></div>
                    `
                );
            }
            setElVisible(upgEl, 'none', '');
        } else if (NO_STATS_TILE_IDS.has(tile.id)) {
            setElVisible(metaEl, 'none', '');
            setElVisible(statsEl, 'none', '');
            setElVisible(upgEl, 'none', '');
        } else if (SPECIAL_PURCHASE_META[tile.id]) {
            const sp = SPECIAL_PURCHASE_META[tile.id];
            const ownerBadge = ownerPlayer
                ? `<b style="color:${escapeHtml(ownerPlayer.color || '#3D2010')};">${escapeHtml(ownerPlayer.name)}</b>`
                : `<b style="color:#7C5133;">${escapeHtml(mText.OWNER_NONE || '주인이 없어요!')}</b>`;

            if (tile.id === BOARD_TILES.MONATIUM_25) {
                const isOwned = Boolean(ownerPlayer && tile.level >= 0);
                const stageIdx = isOwned ? Math.min(2, Math.max(0, Number(tile.level) || 0)) : -1;
                const stageLabel = stageIdx >= 0 ? sp.labels[stageIdx] : '미소유';
                const curToll = stageIdx >= 0 ? sp.tolls[stageIdx] : 0;
                const nextLabel = stageIdx < 0
                    ? '매입 시 기본 통행료'
                    : (stageIdx === 0 ? '2단계 확장 비용' : (stageIdx === 1 ? '최종 단계 확장 비용' : null));
                const nextVal = stageIdx < 0
                    ? sp.tolls[0]
                    : (stageIdx === 0 ? sp.expand1 : (stageIdx === 1 ? sp.expand2 : 0));
                setElVisible(metaEl, 'block', `소유주 : ${ownerBadge} · 확장 단계: <b>${escapeHtml(stageLabel)}</b> · 매입가: <b>${escapeHtml(formatMoney(sp.buy))}</b>`);
                setElVisible(statsEl, 'flex', `
                    <div style="display:flex; justify-content:space-between;"><span>현재 통행료</span><strong style="color:#D95318;">${escapeHtml(formatMoney(curToll))}</strong></div>
                    ${nextLabel ? `<div style="display:flex; justify-content:space-between;"><span>${escapeHtml(nextLabel)}</span><strong style="color:#B35300;">${escapeHtml(formatMoney(nextVal))}</strong></div>` : ''}
                `);
            } else if (tile.id === BOARD_TILES.LAKE) {
                const isFurry = Boolean(worldState.isFurryBeach);
                const furryTag = isFurry
                    ? `<span style="background:#DFF7F5; color:#0A6770; border:1px solid #00A8B5; padding:2px 8px; border-radius:999px; font-weight:900; margin-right:6px;">🏖️ 퍼리비이치</span>`
                    : '';
                setElVisible(metaEl, 'block', `${furryTag}소유주 : ${ownerBadge} · 매입가: <b>${escapeHtml(formatMoney(sp.buy))}</b>`);
                setElVisible(statsEl, 'flex', isFurry
                    ? `
                        <div style="display:flex; justify-content:space-between;"><span>🏖️ 퍼리비이치 이용료</span><strong style="color:#0A6770;">${escapeHtml(formatMoney(sp.furryFee))}</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>정령 호수 통행료</span><strong style="color:#D95318;">${escapeHtml(formatMoney(sp.toll))}</strong></div>
                    `
                    : `
                        <div style="display:flex; justify-content:space-between;"><span>이용료 (통행료)</span><strong style="color:#D95318;">${escapeHtml(formatMoney(sp.toll))}</strong></div>
                        <div style="display:flex; justify-content:space-between;"><span>호출 비용</span><strong style="color:#B35300;">${escapeHtml(formatMoney(sp.summonFee))}</strong></div>
                    `
                );
            } else if (tile.id === BOARD_TILES.THEATER) {
                setElVisible(metaEl, 'block', `소유주 : ${ownerBadge} · 매입가: <b>${escapeHtml(formatMoney(sp.buy))}</b>`);
                setElVisible(statsEl, 'flex', `
                    <div style="display:flex; justify-content:space-between;"><span>턴 시작 수익</span><strong style="color:#2E7D32;">${escapeHtml(formatMoney(sp.profit))}</strong></div>
                    <div style="display:flex; justify-content:space-between;"><span>인수 비용</span><strong style="color:#B35300;">${escapeHtml(formatMoney(sp.take))}</strong></div>
                `);
            } else {
                setElVisible(metaEl, 'block', `소유주 : ${ownerBadge} · 매입가: <b>${escapeHtml(formatMoney(sp.buy))}</b>`);
                setElVisible(statsEl, 'flex', `
                    <div style="display:flex; justify-content:space-between;"><span>${escapeHtml(sp.label)}</span><strong style="color:#D95318;">${escapeHtml(formatMoney(sp.toll))}</strong></div>
                    ${sp.take ? `<div style="display:flex; justify-content:space-between;"><span>인수 비용</span><strong style="color:#B35300;">${escapeHtml(formatMoney(sp.take))}</strong></div>` : ''}
                `);
            }
            setElVisible(upgEl, 'none', '');
        } else {
            const ownerBadge = ownerPlayer
                ? `<span style="color: ${ownerPlayer.color || '#3D2010'}; font-weight: 900;">${escapeHtml(ownerPlayer.name)}</span>`
                : `<span style="color: #7C5133; font-weight: 800;">${escapeHtml(mText.OWNER_NONE || '주인이 없어요!')}</span>`;
            const levelLabel = tile.level >= 0 ? getTileLevelText(tile, mText) : (mText.BLD_EMPTY || '텅텅 비어있어요!');
            setElVisible(
                metaEl,
                'block',
                `${timeBadge}소유주 : ${ownerBadge} · 현재 건설 단계: <b>${escapeHtml(levelLabel)}</b> · 매입가: <b>${escapeHtml(formatMoney(getTileBuyPrice(tile)))}</b>`
            );
            const oneXToll = (isBuyable && tile.level >= 0) ? getTileBaseOneX(tile) : 0;
            const currentToll = (isBuyable && tile.level >= 0)
                ? (Number.isFinite(tile.viewerToll) ? tile.viewerToll : (Number.isFinite(tile.currentToll) ? tile.currentToll : oneXToll))
                : 0;
            const multSuffix = formatTollMultSuffix(oneXToll, currentToll);
            setElVisible(statsEl, 'flex', `
                <div style="display:flex; justify-content:space-between;"><span>기본 통행료</span><strong style="color:#B35300;">${escapeHtml(formatMoney(oneXToll))}</strong></div>
                <div style="display:flex; justify-content:space-between;"><span>현재 통행료${escapeHtml(multSuffix)}</span><strong style="color:#C2410C;">${escapeHtml(formatMoney(currentToll))}</strong></div>
            `);
            setElVisible(upgEl, 'none', '');
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
                emptyBox.style.cssText = 'padding: 36px 16px; text-align: center; font-size: 20px; font-weight: 800; color: #7C5133; background: rgba(255,255,255,0.68); border: 2px dashed #CFA067; border-radius: 14px;';
                emptyBox.innerText = mText.TERRITORY_EMPTY || '점령한 영토가 없어요!';
                listEl.appendChild(emptyBox);
            } else {
                ownedTiles.forEach((tile) => {
                    const rowBtn = document.createElement('button');
                    rowBtn.type = 'button';
                    rowBtn.className = 'list-card-row';
                    const timeBadge = tile.timeType === 'day'
                        ? `<span style="font-size: 12px; padding: 2px 8px; border-radius: 6px; background: #FFF0C2; color: #B35300; font-weight: 900;">${gText.TILE_TIME_DAY || '낮'}</span>`
                        : (tile.timeType === 'night'
                            ? `<span style="font-size: 12px; padding: 2px 8px; border-radius: 6px; background: #EFE3FF; color: #5E2B7A; font-weight: 900;">${gText.TILE_TIME_NIGHT || '밤'}</span>`
                            : '');
                    const levelStr = getTileLevelText(tile, mText);
                    rowBtn.innerHTML = `
                        <div style="display:flex; align-items:center; gap:8px;">
                            ${timeBadge}
                            <span style="font-size: 18px; font-weight: 900; color: #3D2010;">${escapeHtml(getTileName(tile, snapshot?.world))}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:12px; font-size: 15px; color: #7C5133; font-weight: 700;">
                            <span style="padding: 3px 10px; border-radius: 999px; background: #E3EEFF; color: #2D539E; font-weight: 900;">${escapeHtml(levelStr)}</span>
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
        if (dice3DRafId) {
            cancelAnimationFrame(dice3DRafId);
            dice3DRafId = null;
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
                d1El.src = `${DICE_NORMAL_PATH}${r1}.webp`;
                d1El.style.opacity = '1';
                d1El.style.transform = `rotate(${(Math.random() * 18 - 9).toFixed(1)}deg) scale(1.06)`;
            }
            if (d2El) {
                d2El.src = `${DICE_NORMAL_PATH}${r2}.webp`;
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
            el.innerText = id === 'turn-timer' ? `⏱ ${timeStr}` : timeStr;
        });

        const swEl = document.getElementById('hud-stopwatch');
        const swRing = document.getElementById('stopwatch-progress-ring');
        const swSec = document.getElementById('stopwatch-sec');
        if (swEl && swRing && swSec) {
            const isUrgent = safeSec <= 5;
            swEl.classList.toggle('is-urgent', isUrgent);
            const maxSec = 15;
            const ringCircumference = 175.93;
            const dashOffset = (ringCircumference * (1 - Math.min(1, safeSec / maxSec))).toFixed(2);
            swRing.style.strokeDashoffset = dashOffset;
            swRing.setAttribute('stroke', isUrgent ? '#D93829' : '#4E8F26');
            swSec.textContent = String(safeSec);
            swSec.style.color = isUrgent ? '#D93829' : '#3D2010';
        }

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
            stampedTurnOrderIds.clear();
            overlay.style.display = 'none';
            return;
        }

        const currentText = pickLangDict(MarbleLang, LangState.current);
        overlay.style.display = 'flex';

        const titleEl = document.getElementById('turn-order-title');
        const descEl = document.getElementById('turn-order-desc');
        const phaseHintEl = document.getElementById('turn-order-phase-hint');
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
                    ? `${state.tieNotice} (${rerollSec}${currentText.SEC || '초'} 후 자동으로 재굴림)`
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
            descEl.innerText = currentText.TURN_ORDER_DESC || '';
        }
        if (phaseHintEl) {
            phaseHintEl.style.display = 'block';
            phaseHintEl.style.color = isResultStage ? '#2E7D32' : '#7C3F0E';
            phaseHintEl.innerText = isResultStage
                ? (currentText.TURN_ORDER_RESULT_HINT || '순번 결정 완료! 자신의 말과 출발순번을 확인해주세요!')
                : (currentText.TURN_ORDER_PRE_ROLL_HINT || '주사위가 굴려지기 전입니다.');
        }
        if (countdownEl) {
            if (isResultStage) {
                countdownEl.style.display = 'block';
                countdownEl.style.color = '#2E7D32';
                const sec = Math.max(0, Number(state.resultSecondsLeft) || 0);
                countdownEl.innerText = `${currentText.TURN_ORDER_AUTO_START_PREFIX || '자동 시작까지'} ${sec}${currentText.SEC || '초'}`;
            } else if (state.stage === 'ROLLING' && rollSec > 0) {
                countdownEl.style.display = 'block';
                countdownEl.style.color = '#B35300';
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
                const hasRank = isResultStage || (p.rank !== null && p.rank !== undefined);
                const card = document.createElement('div');
                const borderColor = (hasRank && p.rank === 1)
                    ? '#F7C744'
                    : (isMe ? '#D95318' : (p.rolled ? '#4E8F26' : '#CFA067'));
                const cardBg = (hasRank && p.rank === 1)
                    ? 'linear-gradient(180deg, #FFF5C8 0%, #FFE291 100%)'
                    : 'rgba(255, 255, 255, 0.78)';
                card.style.cssText = `background: ${cardBg}; border: 3px solid ${borderColor}; border-radius: 18px; padding: 14px 10px; display: flex; flex-direction: column; align-items: center; gap: 6px; box-shadow: 0 6px 14px rgba(61, 32, 16, 0.14); transition: border-color 0.2s;`;

                // 1) 위쪽: 플레이어 이름 + 미니미 스테이지 (+ 등수 확정 시 참잘했어요 도장)
                const nameEl = document.createElement('div');
                nameEl.style.cssText = `font-size: 16px; font-weight: 900; color: ${p.color || '#3D2010'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;`;
                nameEl.innerText = p.name || '';
                card.appendChild(nameEl);

                const minimiStage = document.createElement('div');
                minimiStage.className = 'to-minimi-stage';
                const minimiImg = document.createElement('img');
                minimiImg.className = 'to-minimi-img';
                minimiImg.src = p.minimiPath || './Resource/Texture/Minimi/Minimi_Erpin.webp';
                minimiImg.alt = p.name || 'Minimi';
                ErrorTracker.trackImage(minimiImg, { critical: false, label: 'TurnOrderMinimi' });
                minimiStage.appendChild(minimiImg);

                if (hasRank) {
                    const alreadyStamped = stampedTurnOrderIds.has(p.id);
                    stampedTurnOrderIds.add(p.id);
                    const stampEl = document.createElement('div');
                    stampEl.className = `to-rank-stamp ${p.rank === 1 ? 'rank-1' : 'rank-normal'}${alreadyStamped ? ' is-settled' : ''}`;
                    stampEl.innerHTML = `<span>${p.rank}${currentText.TURN_ORDER_RANK_SUFFIX || '등'}</span>`;
                    minimiStage.appendChild(stampEl);
                } else {
                    stampedTurnOrderIds.delete(p.id);
                }
                card.appendChild(minimiStage);

                // 2) 이름/미니미 밑: 주사위 합 / 상태
                const sumEl = document.createElement('div');
                sumEl.style.cssText = 'font-size: 13px; font-weight: 900; color: #6E3D1E; min-height: 18px;';
                if (isCardSpinning) {
                    sumEl.style.color = '#D95318';
                    sumEl.innerText = currentText.ROLLING || '주사위 굴리는 중...';
                } else if (p.rolled || isResultStage) {
                    sumEl.innerText = `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} ${p.sum ?? 0}`;
                } else if (p.tied && p.sum > 0) {
                    sumEl.style.color = '#B83724';
                    sumEl.innerText = `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} ${p.sum}`;
                } else {
                    sumEl.style.color = '#9C7152';
                    sumEl.innerText = `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} -`;
                }
                card.appendChild(sumEl);

                // 3) 가운데: 주사위 2개 그림
                const diceRow = document.createElement('div');
                diceRow.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 6px; margin: 2px 0;';
                const face1 = showRolledFace ? Math.min(6, Math.max(1, Number(p.d1) || 1)) : 1;
                const face2 = showRolledFace ? Math.min(6, Math.max(1, Number(p.d2) || 1)) : 1;
                const diceOpacity = (showRolledFace || isCardSpinning) ? '1' : '0.52';

                const d1Img = document.createElement('img');
                if (isMe) d1Img.id = 'turn-order-my-d1';
                ErrorTracker.trackImage(d1Img, { critical: false, label: 'TurnOrderDice1' });
                d1Img.src = `${DICE_NORMAL_PATH}${face1}.webp`;
                d1Img.style.cssText = `width: 44px; height: 44px; object-fit: contain; opacity: ${diceOpacity}; transition: transform 0.08s, opacity 0.18s;`;

                const d2Img = document.createElement('img');
                if (isMe) d2Img.id = 'turn-order-my-d2';
                ErrorTracker.trackImage(d2Img, { critical: false, label: 'TurnOrderDice2' });
                d2Img.src = `${DICE_NORMAL_PATH}${face2}.webp`;
                d2Img.style.cssText = `width: 44px; height: 44px; object-fit: contain; opacity: ${diceOpacity}; transition: transform 0.08s, opacity 0.18s;`;

                diceRow.appendChild(d1Img);
                diceRow.appendChild(d2Img);
                card.appendChild(diceRow);

                // 4) 아래: 최종 등수 또는 진행 상태 배지
                const badgeEl = document.createElement('div');
                if (hasRank) {
                    const isFirst = p.rank === 1;
                    badgeEl.style.cssText = `margin-top: 2px; padding: 4px 14px; border-radius: 999px; font-size: 13px; font-weight: 900; background: ${isFirst ? '#F38221' : '#7C5133'}; color: #ffffff;`;
                    badgeEl.innerText = `${p.rank || '-'}${currentText.TURN_ORDER_RANK_SUFFIX || '등'}${isFirst ? ' (선공)' : ''}`;
                } else if (isCardSpinning) {
                    badgeEl.style.cssText = 'margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 900; background: #FFF0C2; color: #B35300;';
                    badgeEl.innerText = '🎲 ...';
                } else if (p.tied && !p.rolled) {
                    badgeEl.style.cssText = 'margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 900; background: #FFE2D1; color: #B83724;';
                    badgeEl.innerText = currentText.TURN_ORDER_REROLL_TAG || '(동률 재굴림)';
                } else if (p.rolled) {
                    badgeEl.style.cssText = 'margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 900; background: #D7F5C7; color: #2E7D32;';
                    badgeEl.innerText = currentText.TURN_ORDER_ROLLED_TAG || '완료';
                } else {
                    badgeEl.style.cssText = 'margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 800; background: #EBD4AD; color: #7C5133;';
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

    const syncDiceOverlayPosition = () => {
        const overlay = document.getElementById('dice-overlay');
        if (!overlay || overlay.style.display === 'none') return;
        const pt = boardToStage2D(540, 540);
        const z = curCamState?.zoom || 1;
        overlay.style.left = `${pt.x.toFixed(1)}px`;
        overlay.style.top = `${pt.y.toFixed(1)}px`;
        overlay.style.transform = `translate(-50%, -50%) scale(${z.toFixed(3)})`;
    };

    const syncDiceOverlay = (diceState) => {
        const overlay = document.getElementById('dice-overlay');
        if (!overlay) return;

        const slot1 = document.getElementById('dice-slot-1');
        const slot2 = document.getElementById('dice-slot-2');
        const slot3 = document.getElementById('dice-slot-3');
        const cube1 = document.getElementById('dice-cube-1');
        const cube2 = document.getElementById('dice-cube-2');
        const cube3 = document.getElementById('dice-cube-3');
        const sumBadgeEl = document.getElementById('dice-sum-badge');
        const currentText = pickLangDict(MarbleLang, LangState.current);

        if (!diceState || !diceState.visible || diceState.phase === 'HIDE') {
            stopDiceAnimation();
            diceRollAnimSeq = -1;
            if (sumBadgeEl) {
                sumBadgeEl.style.display = 'none';
                sumBadgeEl.classList.remove('is-pop');
            }
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';
        syncDiceOverlayPosition();
        const titleEl = document.getElementById('dice-title');
        if (titleEl) titleEl.innerText = diceState.title || '';

        const hasSecond = diceState.diceCount >= 2;
        const hasRufo = Boolean(diceState.useRufo);
        if (slot2) slot2.style.display = hasSecond ? 'block' : 'none';
        if (slot3) slot3.style.display = hasRufo ? 'block' : 'none';

        build3DCubeFaces(cube1, getLeftDicePath(diceState));
        if (hasSecond) build3DCubeFaces(cube2, DICE_NORMAL_PATH);
        if (hasRufo) build3DCubeFaces(cube3, DICE_NORMAL_PATH);

        const d1Val = Math.min(6, Math.max(1, Number(diceState.d1) || 1));
        const d2Val = Math.min(6, Math.max(1, Number(diceState.d2) || 1));
        const targetVals = [d1Val, ...(hasSecond ? [d2Val] : []), ...(hasRufo ? [6] : [])];
        const activeSlots = [
            { slot: slot1, cube: cube1, shadow: slot1?.querySelector('.dice-3d-shadow'), startX: 165, startY: 185, spinX: 3, spinY: 2, tiltZ: 5 },
            ...(hasSecond ? [{ slot: slot2, cube: cube2, shadow: slot2?.querySelector('.dice-3d-shadow'), startX: 215, startY: 220, spinX: -3, spinY: 3, tiltZ: -7 }] : []),
            ...(hasRufo ? [{ slot: slot3, cube: cube3, shadow: slot3?.querySelector('.dice-3d-shadow'), startX: 265, startY: 195, spinX: 2, spinY: -3, tiltZ: 4 }] : [])
        ];

        const rollSeqKey = Number.isFinite(Number(diceState.rollSeq))
            ? Number(diceState.rollSeq)
            : `${d1Val}:${d2Val}:${hasSecond ? 1 : 0}:${hasRufo ? 1 : 0}`;

        // 한 번의 주사위 굴림(rollSeq)에 대해 우측 하단 -> 보드판 중앙으로 단 1회만 3D 투척 후 확정 눈금에 착지
        if (diceRollAnimSeq !== rollSeqKey) {
            stopDiceAnimation();
            diceRollAnimSeq = rollSeqKey;
            isDiceSpinning = true;
            diceThrowStartTs = performance.now();
            const throwDuration = 740;

            const throwFrame = (now) => {
                if (isCleanedUp) return;
                const p = Math.min(1, (now - diceThrowStartTs) / throwDuration);
                const easeOut = 1 - Math.pow(1 - p, 3);
                const rotEase = 1 - Math.pow(1 - p, 2.35);

                let height = 0;
                if (p < 0.56) {
                    const t = p / 0.56;
                    height = Math.sin(t * Math.PI) * 148 + (1 - t) * 58;
                } else if (p < 0.82) {
                    const t = (p - 0.56) / 0.26;
                    height = Math.sin(t * Math.PI) * 50;
                } else {
                    const t = (p - 0.82) / 0.18;
                    height = Math.sin(t * Math.PI) * 14;
                }

                activeSlots.forEach((sp, idx) => {
                    if (!sp.slot || !sp.cube) return;
                    const val = targetVals[idx] || 1;
                    const targetRot = DICE_FACE_ROTATIONS[val] || DICE_FACE_ROTATIONS[1];
                    const startRx = targetRot.rx + sp.spinX * 360;
                    const startRy = targetRot.ry + sp.spinY * 360;
                    const startRz = sp.tiltZ + (sp.spinX > 0 ? 360 : -360);

                    const curRx = startRx + (targetRot.rx - startRx) * rotEase;
                    const curRy = startRy + (targetRot.ry - startRy) * rotEase;
                    const curRz = startRz + (sp.tiltZ - startRz) * rotEase;

                    const tx = (1 - easeOut) * sp.startX;
                    const ty = (1 - easeOut) * sp.startY;
                    const sc = 1 + (height / 360);

                    sp.slot.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0px)`;
                    sp.cube.style.transform = `translateY(${(-height).toFixed(1)}px) scale(${sc.toFixed(3)}) rotateX(${curRx.toFixed(1)}deg) rotateY(${curRy.toFixed(1)}deg) rotateZ(${curRz.toFixed(1)}deg)`;
                    if (sp.shadow) {
                        const shScale = Math.max(0.42, 1 - height / 230);
                        const shOp = Math.max(0.22, 0.72 - height / 270);
                        sp.shadow.style.transform = `scale(${shScale.toFixed(2)})`;
                        sp.shadow.style.opacity = shOp.toFixed(2);
                    }
                });

                if (p < 1) {
                    dice3DRafId = requestAnimationFrame(throwFrame);
                } else {
                    dice3DRafId = null;
                    isDiceSpinning = false;
                }
            };
            dice3DRafId = requestAnimationFrame(throwFrame);
        } else if (diceState.phase !== 'SPINNING' && !dice3DRafId) {
            // 에르핀 주사위 눈금 변경 등으로 LANDED 눈금이 갱신된 경우 재투척 없이 최종 눈금 면만 즉시 반영
            activeSlots.forEach((sp, idx) => {
                if (!sp.slot || !sp.cube) return;
                const val = targetVals[idx] || 1;
                const rot = DICE_FACE_ROTATIONS[val] || DICE_FACE_ROTATIONS[1];
                sp.slot.style.transform = 'translate3d(0px, 0px, 0px)';
                sp.cube.style.transform = `translateY(0px) scale(1) rotateX(${rot.rx}deg) rotateY(${rot.ry}deg) rotateZ(${sp.tiltZ}deg)`;
                if (sp.shadow) {
                    sp.shadow.style.transform = 'scale(1)';
                    sp.shadow.style.opacity = '0.72';
                }
            });
        }

        if (sumBadgeEl) {
            if (diceState.phase === 'SPINNING') {
                sumBadgeEl.style.display = 'inline-flex';
                sumBadgeEl.classList.remove('is-pop');
                sumBadgeEl.innerText = `🎲 ${currentText.ROLLING || '주사위가 돌아가는중...'}`;
            } else {
                const rufoAdd = hasRufo ? 6 : 0;
                const total = d1Val + (hasSecond ? d2Val : 0) + rufoAdd;
                sumBadgeEl.style.display = 'inline-flex';
                sumBadgeEl.innerText = `🎲 ${total}${currentText.MOVE || '칸 이동!'}`;
                sumBadgeEl.classList.remove('is-pop');
                void sumBadgeEl.offsetWidth;
                sumBadgeEl.classList.add('is-pop');
            }
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
        const prevPromptKey = activePromptKey;
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

        try {
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
                        promptBgPath,
                        prompt.titleColor ? { titleColor: prompt.titleColor } : null
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
        } catch (err) {
            activePromptKey = prevPromptKey;
            throw err;
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

        const modeKey = snapshot.world?.gameMode || initialBoardMode;
        const stageTheme = MARBLE_STAGE_THEMES[modeKey] || MARBLE_STAGE_THEMES.ember;
        if (stageRoot) stageRoot.style.background = stageTheme.stageBg;
        if (canvas) {
            canvas.style.borderColor = stageTheme.border;
            canvas.style.outlineColor = stageTheme.outline;
        }

        const playerById = new Map((snapshot.players || []).map(p => [p.id, p]));
        const viewTiles = (snapshot.tiles || []).map(t => ({
            ...t,
            owner: t.ownerId ? (playerById.get(t.ownerId) || null) : null
        }));

        const targetBoardSrc = getModeConfig(modeKey).boardTexture;
        if (targetBoardSrc && loadedBoardSrc !== targetBoardSrc) {
            loadedBoardSrc = targetBoardSrc;
            if (!getCachedMarbleImage(targetBoardSrc)) {
                boardImg.src = targetBoardSrc;
            }
        }
        const activeBoardImg = getActiveBoardImage();
        if (activeBoardImg && activeBoardImg.complete && activeBoardImg.naturalWidth > 0) {
            renderBoardState(
                ctx,
                activeBoardImg,
                viewTiles,
                getVisualPlayers(snapshot.players || []),
                snapshot.world,
                standeeCtx,
                STANDEE_PAD,
                getAnimRenderState()
            );
        }

        if (prevPlayerPosMap.size === 0) {
            (snapshot.players || []).forEach(p => {
                if (p && typeof p.pos === 'number') prevPlayerPosMap.set(p.id, p.pos);
            });
        } else {
            (snapshot.players || []).forEach(p => {
                if (!p || typeof p.pos !== 'number') return;
                const prevPos = prevPlayerPosMap.get(p.id);
                prevPlayerPosMap.set(p.id, p.pos);
                const alreadyTracked = (moveAnimState && moveAnimState.playerId === p.id)
                    || moveAnimQueue.some(q => q.playerId === p.id);
                if (!alreadyTracked && typeof prevPos === 'number' && prevPos !== p.pos && snapshot.phase !== 'TURN_ORDER') {
                    enqueueMoveAnim({
                        playerId: p.id,
                        fromPos: prevPos,
                        toPos: p.pos,
                        moveKind: 'card'
                    });
                }
            });
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
                createPlayerUI(mainHudPlayer, snapshot.world, { isExpanded: isLogExpanded, logs: gameLogs }) +
                createNpcUIList(others, snapshot.world);

            const logOpenBtn = document.getElementById('btn-hud-log-open');
            if (logOpenBtn) {
                logOpenBtn.onclick = () => {
                    isLogExpanded = true;
                    renderSnapshot(latestSnapshot);
                };
            }
            const logCollapseBtn = document.getElementById('btn-hud-log-collapse');
            if (logCollapseBtn) {
                logCollapseBtn.onclick = () => {
                    isLogExpanded = false;
                    renderSnapshot(latestSnapshot);
                };
            }
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
            const myTurnMsg = mTextTurn.TOAST_MY_TURN || '🎲 내 턴입니다! 주사위를 굴려주세요!';
            pushGameLog(myTurnMsg, snapshot.world?.currentTurn || 1);
            PopupManager.showToast(myTurnMsg, 2600);
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
                Boolean(snapshot.hasUsableCards),
                exitConfirmPending
            );
        }

        const exitBtnDyn = document.getElementById('btn-exit-match');
        if (exitBtnDyn && !exitBtnDyn.dataset.exitBound) {
            exitBtnDyn.dataset.exitBound = '1';
            exitBtnDyn.onclick = async () => {
                if (!exitConfirmPending) {
                    exitConfirmPending = true;
                    exitBtnDyn.innerText = '🚪 정말 나가기?';
                    if (exitConfirmTimer) clearTimeout(exitConfirmTimer);
                    exitConfirmTimer = setTimeout(() => {
                        exitConfirmPending = false;
                        const curExit = document.getElementById('btn-exit-match');
                        if (!isCleanedUp && curExit) curExit.innerText = '🚪 나가기';
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
        if (!isMoveAnimating()) {
            syncPrompt(snapshot.pendingPrompt, viewTiles, snapshot);
        }
        syncAfkWarningOverlay(snapshot);
        renderHandPopup(snapshot, mainHudPlayer, canActNow);
        renderTerritoryPopup(snapshot, viewTiles, mainHudPlayer);
        syncBoardPeekUi(snapshot);
        updateTimerDom(snapshot.timerLeft);
        ErrorTracker.markTransitionComplete('marble');

        if (snapshot.phase === 'GAME_OVER' && snapshot.settlementResults && !isMoveAnimating()) {
            handleSettlement(snapshot.settlementResults);
        }
    };

    boardImg.onload = () => {
        if (!isCleanedUp && latestSnapshot) {
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

    const showSootClimaxAnnounce = (payload) => {
        if (!payload?.title) return;
        if (!payload.excludePlayerId || payload.excludePlayerId !== latestMainHudPlayer?.id) {
            pushGameLog(payload.title);
            const announceBg = (payload.tileId !== undefined && payload.tileId !== null)
                ? resolveTileBgPath(
                    latestViewTiles?.[payload.tileId] || { id: payload.tileId },
                    latestSnapshot?.world,
                    latestMainHudPlayer,
                    { isArrival: true }
                )
                : null;
            PopupManager.showNormalPopup(
                payload.title,
                payload.desc || '',
                true,
                () => {
                    if (payload.noticeId) {
                        const cBtn = document.getElementById('close-btn');
                        if (cBtn) {
                            cBtn.disabled = true;
                            cBtn.innerText = '확인 완료 (대기중)';
                        }
                        RoomManager.sendGameAction({
                            type: 'CONFIRM_NOTICE',
                            noticeId: payload.noticeId
                        });
                    } else {
                        PopupManager.closeAll();
                    }
                },
                announceBg,
                true,
                {
                    confirmText: payload.confirmText || '확인',
                    ...(payload.titleColor ? { titleColor: payload.titleColor } : {})
                }
            );
        }
    };

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
            if (payload?.type === 'PLAYER_MOVE') {
                prevPlayerPosMap.set(payload.playerId, payload.toPos);
                enqueueMoveAnim({
                    playerId: payload.playerId,
                    fromPos: payload.fromPos,
                    toPos: payload.toPos,
                    moveKind: payload.moveKind || 'step',
                    steps: payload.steps ?? null,
                    passedStart: Boolean(payload.passedStart),
                    lapBonus: payload.lapBonus ?? null
                });
            } else if (payload?.type === 'TOAST' && payload.message) {
                pushGameLog(payload.logMessage || payload.message);
                PopupManager.showToast(payload.message, payload.duration || 3200);
            } else if (payload?.type === 'SOOT_CLIMAX_ANNOUNCE' && payload.title) {
                if (isMoveAnimating()) {
                    queuedPostAnimEvents.push({ kind: 'SOOT_CLIMAX_ANNOUNCE', payload });
                } else {
                    showSootClimaxAnnounce(payload);
                }
            } else if (payload?.type === 'SOOT_CLIMAX_CLEAR') {
                PopupManager.closeAll();
            } else if (payload?.type === 'GAME_OVER' && payload.results) {
                if (isMoveAnimating()) {
                    queuedPostAnimEvents.push({ kind: 'GAME_OVER', payload });
                } else {
                    handleSettlement(payload.results);
                }
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
        cancelMoveAnim();
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
