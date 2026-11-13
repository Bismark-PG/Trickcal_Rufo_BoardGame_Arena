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
    createTurnOrderOverlay,
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
                <canvas id="game-canvas" width="1080" height="1080" style="width: 1320px; height: 1320px; flex-shrink: 0; border: 10px solid #fff; background-color: transparent; box-shadow: 30px 30px 50px rgba(0,0,0,0.2); transform: rotateX(60deg) rotateZ(-45deg);"></canvas>
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
    let isAfkWarnVisible = false;

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

    const updateTimerDom = (timeLeft) => {
        if (isCleanedUp) return;
        const currentText = pickLangDict(MarbleLang, LangState.current);
        const safeSec = Math.max(0, Number(timeLeft) || 0);
        const timeStr = `${currentText.REMAIN_TIME} ${safeSec}${currentText.SEC}`;
        ['turn-timer', 'event-timer', 'portal-timer', 'target-timer', 'void-timer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = timeStr;
        });
        const closeBtn = document.getElementById('close-btn');
        if (closeBtn && closeBtn.parentElement && closeBtn.parentElement.style.display !== 'none') {
            closeBtn.innerText = `${currentText.CLOSE} (${safeSec})`;
        }
    };

    const syncTurnOrderOverlay = (snapshot) => {
        const overlay = document.getElementById('turn-order-overlay');
        if (!overlay) return;
        const state = snapshot?.turnOrderState;
        if (!state || !state.visible || snapshot?.phase !== 'TURN_ORDER') {
            overlay.style.display = 'none';
            return;
        }

        const currentText = pickLangDict(MarbleLang, LangState.current);
        overlay.style.display = 'flex';

        const titleEl = document.getElementById('turn-order-title');
        const descEl = document.getElementById('turn-order-desc');
        const tieBannerEl = document.getElementById('turn-order-tie-banner');
        const rollViewEl = document.getElementById('turn-order-roll-view');
        const resultViewEl = document.getElementById('turn-order-result-view');

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

        const players = Array.isArray(state.players) ? state.players : [];

        if (state.stage === 'RESULT') {
            if (titleEl) titleEl.innerText = currentText.TURN_ORDER_RESULT_TITLE || '최종 순번 결정 완료!';
            if (descEl) descEl.innerText = currentText.TURN_ORDER_RESULT_DESC || '';
            if (rollViewEl) rollViewEl.style.display = 'none';
            if (resultViewEl) resultViewEl.style.display = 'block';

            const countdownEl = document.getElementById('turn-order-countdown');
            if (countdownEl) {
                const sec = Math.max(0, Number(state.resultSecondsLeft) || 0);
                countdownEl.innerText = `${currentText.TURN_ORDER_AUTO_START_PREFIX || '자동 시작까지'} ${sec}${currentText.SEC || '초'}`;
            }

            const grid = document.getElementById('turn-order-result-grid');
            if (grid) {
                const cards = players.map(p => {
                    const card = document.createElement('div');
                    const isMe = p.id === snapshot.myPlayerId;
                    card.style.cssText = `background: ${isMe ? 'rgba(241, 196, 15, 0.14)' : 'rgba(255, 255, 255, 0.06)'}; border: 2px solid ${p.rank === 1 ? '#f1c40f' : (isMe ? '#ffd86b' : 'rgba(255,255,255,0.16)')}; border-radius: 12px; padding: 12px 8px; display: flex; flex-direction: column; align-items: center; gap: 8px;`;

                    // 1) 위쪽: 플레이어 이름
                    const nameEl = document.createElement('div');
                    nameEl.style.cssText = `font-size: 14px; font-weight: 800; color: ${p.color || '#ffffff'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;`;
                    nameEl.innerText = p.name || '';
                    card.appendChild(nameEl);

                    // 2) 이름 밑: 주사위의 합
                    const sumEl = document.createElement('div');
                    sumEl.style.cssText = 'font-size: 13px; font-weight: 700; color: #e8eef7;';
                    sumEl.innerText = `${currentText.TURN_ORDER_SUM_LABEL || '주사위 합:'} ${p.sum ?? 0}`;
                    card.appendChild(sumEl);

                    // 3) 주사위 두 개 그림
                    const diceRow = document.createElement('div');
                    diceRow.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 6px;';
                    const d1Img = document.createElement('img');
                    d1Img.src = `${DICE_NORMAL_PATH}${Math.min(6, Math.max(1, Number(p.d1) || 1))}.png`;
                    d1Img.style.cssText = 'width: 46px; height: 46px; object-fit: contain;';
                    const d2Img = document.createElement('img');
                    d2Img.src = `${DICE_NORMAL_PATH}${Math.min(6, Math.max(1, Number(p.d2) || 1))}.png`;
                    d2Img.style.cssText = 'width: 46px; height: 46px; object-fit: contain;';
                    diceRow.appendChild(d1Img);
                    diceRow.appendChild(d2Img);
                    card.appendChild(diceRow);

                    // 4) 주사위 아래: 등수
                    const rankEl = document.createElement('div');
                    rankEl.style.cssText = `margin-top: 2px; padding: 4px 12px; border-radius: 999px; font-size: 14px; font-weight: 900; background: ${p.rank === 1 ? '#f1c40f' : 'rgba(255,255,255,0.12)'}; color: ${p.rank === 1 ? '#1a1f2e' : '#ffffff'};`;
                    rankEl.innerText = `${p.rank || '-'}${currentText.TURN_ORDER_RANK_SUFFIX || '등'}`;
                    card.appendChild(rankEl);

                    return card;
                });
                grid.replaceChildren(...cards);
            }
            return;
        }

        if (titleEl) titleEl.innerText = currentText.TURN_ORDER_TITLE || '플레이 순번 결정';
        if (descEl) descEl.innerText = currentText.TURN_ORDER_DESC || '';
        if (rollViewEl) rollViewEl.style.display = 'block';
        if (resultViewEl) resultViewEl.style.display = 'none';

        const myEntry = players.find(p => p.id === snapshot.myPlayerId) || players[0];
        const myD1 = document.getElementById('turn-order-my-d1');
        const myD2 = document.getElementById('turn-order-my-d2');
        const myStatusEl = document.getElementById('turn-order-my-status');
        const rollBtn = document.getElementById('turn-order-roll-btn');

        if (myEntry) {
            if (myD1) myD1.src = `${DICE_NORMAL_PATH}${Math.min(6, Math.max(1, Number(myEntry.d1) || 1))}.png`;
            if (myD2) myD2.src = `${DICE_NORMAL_PATH}${Math.min(6, Math.max(1, Number(myEntry.d2) || 1))}.png`;

            const canClick = !myEntry.isAi && !myEntry.rolled && state.stage === 'ROLLING';
            if (rollBtn) {
                rollBtn.innerText = currentText.TURN_ORDER_ROLL_BTN || '주사위 굴리기';
                rollBtn.style.display = canClick ? 'inline-flex' : 'none';
                rollBtn.disabled = false;
                rollBtn.onclick = async () => {
                    if (isCleanedUp) return;
                    rollBtn.disabled = true;
                    const res = await RoomManager.sendGameAction({ type: 'TURN_ORDER_ROLL' });
                    if (res && res.ok === false && !isCleanedUp) {
                        rollBtn.disabled = false;
                    }
                };
            }
            if (myStatusEl) {
                if (myEntry.tied && !myEntry.rolled) {
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
        }

        const waitList = document.getElementById('turn-order-wait-list');
        if (waitList) {
            const pills = players.map(p => {
                const pill = document.createElement('div');
                pill.style.cssText = 'background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; padding: 8px 6px; font-size: 12px;';
                const nm = document.createElement('div');
                nm.style.cssText = `font-weight: 800; color: ${p.color || '#ffffff'}; margin-bottom: 4px;`;
                nm.innerText = p.name || '';
                const st = document.createElement('div');
                if (p.tied && !p.rolled) {
                    st.style.color = '#ff7675';
                    st.innerText = p.sum > 0
                        ? `${p.sum} ${currentText.TURN_ORDER_REROLL_TAG || '(동률 재굴림)'}`
                        : (currentText.TURN_ORDER_REROLL_TAG || '(동률 재굴림)');
                } else if (p.rolled) {
                    st.style.color = '#7bed9f';
                    st.innerText = `${p.sum} (${currentText.TURN_ORDER_ROLLED_TAG || '완료'})`;
                } else {
                    st.style.color = '#95a5a6';
                    st.innerText = currentText.TURN_ORDER_WAITING_TAG || '대기중';
                }
                pill.appendChild(nm);
                pill.appendChild(st);
                return pill;
            });
            waitList.replaceChildren(...pills);
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
                        row: btn.row,
                        align: btn.align,
                        disabled: btn.disabled,
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
        syncTurnOrderOverlay(snapshot);
        syncPrompt(snapshot.pendingPrompt, viewTiles, snapshot);
        syncAfkWarningOverlay(snapshot);
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
        stopDiceAnimation();
        PopupManager.clearToasts?.();
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
