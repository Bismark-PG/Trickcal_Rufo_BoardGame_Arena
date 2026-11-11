// ProgramFiles/Scenes/GameMarble.js
// 100% 순수 렌더링 및 입력 송신 전용 엘리아스 마블 클라이언트 씬
// 게임 규칙·턴·확률·AI 연산은 서버(MarbleServerSession) 또는 오프라인 로컬 엔진(MarbleEngine)이 전담

import { changeScene } from '../Main.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import {
    createPlayerUI,
    createNpcUIList,
    createTurnIndicator,
    createDiceButton,
    createDiceOverlay,
    createPopupOverlay,
    renderBoardState,
    showSettlementPopup,
    PopupManager,
    setActiveRenderWorld
} from '../Marble/MarbleUI.js';
import { pickLangDict } from '../Marble/MarbleRuntime.js';
import { LangState } from '../System/LanguageManager.js';
import { MarbleLang } from '../System/Index/Marble/MarbleUIIndex.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { getGameMeta } from '../System/GameRegistry.js';

const DICE_PATH = './Resource/Texture/Marble/Dice/Dice_N_';

export function initMarble(container, sceneParams = null) {
    container.innerHTML = `
        <div style="width: 100%; height: 100%; position: relative; display: flex; justify-content: center; align-items: center; perspective: 1200px;">
            <div style="transform: translateY(25px);">
                <canvas id="game-canvas" width="1080" height="1080" style="width: 1320px; height: 1320px; flex-shrink: 0; border: 10px solid #fff; background-color: transparent; box-shadow: 30px 30px 50px rgba(0,0,0,0.2); transform: rotateX(60deg) rotateZ(-45deg);"></canvas>
            </div>
            <div id="ui-players"></div>
            <div id="turn-ui-container"></div>
            <div id="dice-btn-container"></div>
            <button id="btn-exit-match" style="position: absolute; bottom: 145px; right: 40px; font-family: inherit; padding: 10px 18px; font-size: 18px; font-weight: bold; background: rgba(192, 57, 43, 0.85); color: #fff; border: 2px solid rgba(255,255,255,0.4); border-radius: 10px; cursor: pointer; z-index: 5;">나가기</button>
            ${createDiceOverlay()}
            ${createPopupOverlay()}
        </div>
    `;

    const canvas = container.querySelector('#game-canvas');
    const ctx = canvas.getContext('2d');
    const boardImg = new Image();
    boardImg.src = './Resource/Texture/Marble/Board.png';

    let isCleanedUp = false;
    let latestSnapshot = null;
    let activePromptKey = null;
    let diceAnimInterval = null;
    let isDiceSpinning = false;
    let settlementShown = false;
    let exitConfirmPending = false;
    let exitConfirmTimer = null;

    const stopDiceAnimation = () => {
        if (diceAnimInterval) {
            clearInterval(diceAnimInterval);
            diceAnimInterval = null;
        }
        isDiceSpinning = false;
    };

    const updateTimerDom = (timeLeft) => {
        if (isCleanedUp) return;
        const currentText = pickLangDict(MarbleLang, LangState.current);
        const safeSec = Math.max(0, Number(timeLeft) || 0);
        const timeStr = `${currentText.REMAIN_TIME} ${safeSec}${currentText.SEC}`;
        ['turn-timer', 'event-timer', 'portal-timer', 'target-timer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = timeStr;
        });
        const closeBtn = document.getElementById('close-btn');
        if (closeBtn && closeBtn.parentElement && closeBtn.parentElement.style.display !== 'none') {
            closeBtn.innerText = `${currentText.CLOSE} (${safeSec})`;
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
                diceAnimInterval = setInterval(() => {
                    if (isCleanedUp) {
                        stopDiceAnimation();
                        return;
                    }
                    if (diceImg1) diceImg1.src = `${DICE_PATH}${Math.floor(Math.random() * 6) + 1}.png`;
                    if (diceState.diceCount >= 2 && diceImg2) diceImg2.src = `${DICE_PATH}${Math.floor(Math.random() * 6) + 1}.png`;
                    if (diceState.useRufo && diceImg3) diceImg3.src = `${DICE_PATH}6.png`;
                }, 50);
            }
        } else {
            stopDiceAnimation();
            if (diceImg1) diceImg1.src = `${DICE_PATH}${diceState.d1 || 1}.png`;
            if (diceState.diceCount >= 2 && diceImg2) diceImg2.src = `${DICE_PATH}${diceState.d2 || 1}.png`;
            if (diceState.useRufo && diceImg3) diceImg3.src = `${DICE_PATH}6.png`;
        }
    };

    const syncPrompt = (prompt, viewTiles, snapshot) => {
        if (!prompt) {
            if (activePromptKey !== null) {
                PopupManager.closeAll();
                activePromptKey = null;
            }
            return;
        }

        const nextKey = `${prompt.promptId}:${prompt.revision || 1}`;
        if (nextKey === activePromptKey) {
            return;
        }
        activePromptKey = nextKey;

        const respond = (payload) => RoomManager.sendGameAction({
            type: 'PROMPT_RESPOND',
            promptId: prompt.promptId,
            ...payload
        });
        const cancel = () => RoomManager.sendGameAction({
            type: 'PROMPT_CANCEL',
            promptId: prompt.promptId
        });

        switch (prompt.kind) {
            case 'CHOICE':
                PopupManager.showChoicePopup(
                    prompt.title,
                    prompt.desc,
                    (prompt.buttons || []).map(btn => ({
                        text: btn.text,
                        color: btn.color,
                        action: () => respond({ buttonIndex: btn.index })
                    }))
                );
                break;

            case 'NORMAL':
                PopupManager.showNormalPopup(
                    prompt.title,
                    prompt.desc,
                    Boolean(prompt.showCloseBtn),
                    prompt.showCloseBtn ? () => respond({}) : null
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
                    () => cancel()
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
                const validSet = new Set(prompt.validTileIds || []);
                const portalTiles = viewTiles.filter(t => validSet.has(t.id));
                PopupManager.showPortalPopup(
                    portalTiles,
                    (tileId) => respond({ tileId }),
                    () => cancel(),
                    prompt.reqFee || 0,
                    Boolean(prompt.isFree)
                );
                break;
            }
        }
        updateTimerDom(snapshot.timerLeft);
    };

    const handleSettlement = (results) => {
        if (isCleanedUp || settlementShown || !Array.isArray(results)) return;
        settlementShown = true;
        PopupManager.closeAll();
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

        if (boardImg.complete) {
            renderBoardState(ctx, boardImg, viewTiles, snapshot.players || [], snapshot.world);
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

        if (activePlayer) {
            document.getElementById('turn-ui-container').innerHTML = createTurnIndicator(
                activePlayer,
                snapshot.world?.currentTurn || 1,
                snapshot.world,
                snapshot.timerLeft
            );
        }

        const canActNow = Boolean(snapshot.canAct && (!RoomManager.isOnline() || snapshot.activePlayerId === RoomManager.localPlayer.id));
        document.getElementById('dice-btn-container').innerHTML = createDiceButton(
            mainHudPlayer,
            canActNow,
            Boolean(snapshot.hasUsableCards)
        );

        const rollBtn = document.getElementById('btn-roll');
        if (rollBtn && canActNow) {
            rollBtn.onclick = async () => {
                rollBtn.disabled = true;
                const res = await RoomManager.sendGameAction({ type: 'ROLL_DICE' });
                if (!res?.ok && !isCleanedUp) {
                    renderSnapshot(latestSnapshot);
                }
            };
        }

        const invBtn = document.getElementById('btn-inventory');
        if (invBtn && canActNow && snapshot.hasUsableCards) {
            invBtn.onclick = async () => {
                invBtn.disabled = true;
                const res = await RoomManager.sendGameAction({ type: 'OPEN_INVENTORY' });
                if (!res?.ok && !isCleanedUp) {
                    renderSnapshot(latestSnapshot);
                }
            };
        }

        syncDiceOverlay(snapshot.diceState);
        syncPrompt(snapshot.pendingPrompt, viewTiles, snapshot);
        updateTimerDom(snapshot.timerLeft);

        if (snapshot.phase === 'GAME_OVER' && snapshot.settlementResults) {
            handleSettlement(snapshot.settlementResults);
        }
    };

    boardImg.onload = () => {
        if (latestSnapshot) {
            renderSnapshot(latestSnapshot);
        }
    };

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
                PopupManager.showToast(payload.message, payload.duration || 2000);
            } else if (payload?.type === 'GAME_OVER' && payload.results) {
                handleSettlement(payload.results);
            }
        } else if (evtName === 'RETURNED_TO_ROOM') {
            changeScene('room');
        } else if (evtName === 'KICKED') {
            changeScene('menu');
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
        stopDiceAnimation();
        unsubscribeGame();
        document.removeEventListener('languageChanged', langHandler);
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
