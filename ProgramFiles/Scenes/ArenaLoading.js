// ProgramFiles/Scenes/ArenaLoading.js
// 루포의 보드게임 아레나 최초 진입 시 공용 · 대상 게임 리소스를 선로딩하는 씬

import { changeScene } from '../Main.js';
import { LangState } from '../System/LanguageManager.js';
import { MenuLang } from '../System/Index/MainMenuIndex.js';
import { escapeHtml } from '../Lobby/LobbyUI.js';
import { runArenaPreload } from '../System/AssetPreloader.js';
import { ErrorTracker } from '../System/ErrorTracker.js';

const BOOT_PRELOAD_TIMEOUT_MS = 25000;
const BOOT_SLOW_HINT_MS = 5000;

function resolveStageLabel(progress, text) {
    if (progress?.done) {
        return text.LOADING_COMPLETE || '리소스 로딩 완료!';
    }
    if (progress?.stepId && progress.stepId !== 'arena' && progress.nameKey) {
        const gameName = text[progress.nameKey] || progress.gameId || progress.stepId;
        return `${gameName} ${text.LOADING_STAGE_GAME_SUFFIX || '리소스 로딩중...'}`;
    }
    return text.LOADING_STAGE_ARENA || '아레나 기본 리소스 로딩중...';
}

function formatAssetName(assetPath, text) {
    if (!assetPath) return text.LOADING_PREPARING_ITEM || '리소스 확인 중';
    const parts = String(assetPath).split('/');
    return parts[parts.length - 1] || assetPath;
}

export function initArenaLoading(container, sceneParams = null) {
    let isCleanedUp = false;
    let redirectTimer = null;
    let slowHintTimer = null;
    let lastProgress = null;
    let showSlowActions = false;

    const enterMenuNow = (reason = 'complete') => {
        if (isCleanedUp) return;
        if (reason === 'skip') {
            ErrorTracker.addBreadcrumb('UI_ACTION', 'Arena preload skipped by user -> menu');
        }
        changeScene('menu', sceneParams);
    };

    const render = () => {
        const text = MenuLang[LangState.current] || MenuLang.ko;
        const pct = Math.max(0, Math.min(100, Number(lastProgress?.percent) || 0));
        const loaded = Number(lastProgress?.overallLoaded) || 0;
        const total = Number(lastProgress?.overallTotal) || 0;
        const stageStr = lastProgress ? resolveStageLabel(lastProgress, text) : (text.LOADING_STAGE_ARENA || '');
        const fileStr = lastProgress
            ? (lastProgress.done ? '' : formatAssetName(lastProgress.currentAsset, text))
            : (text.LOADING_PREPARING_ITEM || '');

        container.innerHTML = `
            <div style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 40px; box-sizing: border-box;">
                <div style="width: 780px; max-width: 90%; background: rgba(22, 91, 122, 0.94); border: 4px solid #f1c40f; border-radius: 28px; padding: 48px 54px; box-shadow: 0 22px 50px rgba(0, 0, 0, 0.45); display: flex; flex-direction: column; align-items: center; text-align: center; color: #fff;">
                    <img id="arena-loading-logo" src="./Resource/Texture/Main_Chara.png" alt="Logo" style="height: 120px; object-fit: contain; margin-bottom: 16px;">
                    <h1 style="margin: 0 0 10px 0; font-size: 40px; color: #f1c40f; letter-spacing: -0.5px;">${escapeHtml(text.TITLE)}</h1>
                    <p style="margin: 0 0 32px 0; font-size: 20px; color: #d6eaf8;">${escapeHtml(text.LOADING_SUBTITLE || '')}</p>

                    <div id="arena-loading-stage" style="font-size: 26px; font-weight: bold; color: #ffffff; margin-bottom: 18px; min-height: 36px;">
                        ${escapeHtml(stageStr)}
                    </div>

                    <div style="width: 100%; height: 30px; background: #0d3b52; border: 2px solid rgba(255,255,255,0.28); border-radius: 16px; overflow: hidden; box-shadow: inset 0 2px 6px rgba(0,0,0,0.4);">
                        <div id="arena-loading-fill" style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #27ae60, #f1c40f); transition: width 0.14s ease-out; border-radius: 14px;"></div>
                    </div>

                    <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 17px; color: #aed6f1;">
                        <span id="arena-loading-file" style="max-width: 68%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;">
                            ${escapeHtml(fileStr)}
                        </span>
                        <span id="arena-loading-count" style="font-weight: bold; color: #f1c40f;">${pct}% (${loaded} / ${total})</span>
                    </div>

                    <div id="arena-loading-slow-box" style="display: ${showSlowActions ? 'flex' : 'none'}; margin-top: 24px; flex-direction: column; align-items: center; gap: 10px;">
                        <span style="font-size: 15px; color: #f9e79f;">${escapeHtml(text.LOADING_SLOW_HINT || '네트워크가 다소 느립니다. 지금 바로 입장할 수도 있습니다.')}</span>
                        <button id="btn-loading-skip" type="button" style="font-family: inherit; padding: 10px 26px; font-size: 17px; font-weight: bold; background: #f39c12; color: #fff; border: none; border-radius: 10px; cursor: pointer;">${escapeHtml(text.LOADING_SKIP || '건너뛰고 바로 입장')}</button>
                    </div>
                </div>
            </div>
        `;

        const skipBtn = container.querySelector('#btn-loading-skip');
        if (skipBtn) {
            skipBtn.onclick = () => enterMenuNow('skip');
        }
    };

    const updateDom = (progress) => {
        if (isCleanedUp) return;
        lastProgress = progress;
        const text = MenuLang[LangState.current] || MenuLang.ko;
        const pct = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
        const loaded = Number(progress?.overallLoaded) || 0;
        const total = Number(progress?.overallTotal) || 0;

        const stageEl = container.querySelector('#arena-loading-stage');
        const fillEl = container.querySelector('#arena-loading-fill');
        const fileEl = container.querySelector('#arena-loading-file');
        const countEl = container.querySelector('#arena-loading-count');

        if (stageEl) stageEl.textContent = resolveStageLabel(progress, text);
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (fileEl) fileEl.textContent = progress?.done ? '' : formatAssetName(progress?.currentAsset, text);
        if (countEl) countEl.textContent = `${pct}% (${loaded} / ${total})`;
    };

    const langHandler = () => render();
    document.addEventListener('languageChanged', langHandler);

    container._cleanupScene = () => {
        isCleanedUp = true;
        document.removeEventListener('languageChanged', langHandler);
        if (redirectTimer) {
            clearTimeout(redirectTimer);
            redirectTimer = null;
        }
        if (slowHintTimer) {
            clearTimeout(slowHintTimer);
            slowHintTimer = null;
        }
    };

    render();

    slowHintTimer = setTimeout(() => {
        if (isCleanedUp || lastProgress?.done) return;
        showSlowActions = true;
        const slowBox = container.querySelector('#arena-loading-slow-box');
        if (slowBox) slowBox.style.display = 'flex';
    }, BOOT_SLOW_HINT_MS);

    runArenaPreload({
        overallTimeoutMs: BOOT_PRELOAD_TIMEOUT_MS,
        onProgress: (progress) => updateDom(progress)
    }).then((res) => {
        if (isCleanedUp) return;
        if (res?.timedOut || res?.error) {
            enterMenuNow('fallback');
            return;
        }
        redirectTimer = setTimeout(() => {
            enterMenuNow('complete');
        }, 180);
    }).catch(() => {
        enterMenuNow('error');
    });
}
