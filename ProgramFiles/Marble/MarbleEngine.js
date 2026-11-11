// ProgramFiles/Marble/MarbleEngine.js
// 서버-권위적(Server-Authoritative) 및 오프라인 로컬 폴백 겸용 순수 엘리아스 마블 게임 엔진

import { generateTiles, TurnManager, calculateToll, calculatePurchaseCost, getTileSellValue } from './MarbleLogic.js';
import { Player } from './MarblePlayer.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import { BoardGimmickHandlers } from './MarbleBoardGimmick.js';
import { handleTollPaymentProcess } from './MarbleEconomy.js';
import { processFinalSettlement, serializeSettlementResults } from './MarbleSettlement.js';
import { AIManager } from './MarbleAI.js';
import { removeCardFromInventory, useActiveCard, openPlayerCardSelector, getUsableCards } from './MarbleCard.js';
import { getPlayerThinkTime, getPlayerDiceCount, isBowVillageForced } from './MarbleCardTreasure.js';
import { getStartPassBonus } from './MarbleCardNormal.js';
import { RequiemState, handleReincarnationTurnSkill, getPositiveEffectMultiplier } from './MarbleRequiem.js';
import {
    createMarbleWorldState,
    runWithMarbleScope,
    formatMoney,
    getMarbleText,
    getCardUIText,
    getGimmickText
} from './MarbleRuntime.js';
import { LangState } from '../System/LanguageManager.js';
import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';

const DEFAULT_PLAYER_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6'];

class ScopedTimer {
    constructor(runSynced, onTick, defaultOnTimeout) {
        this.runSynced = runSynced;
        this.onTick = onTick;
        this.defaultOnTimeout = defaultOnTimeout;
        this.currentOnTimeout = defaultOnTimeout;
        this.timeLeft = 0;
        this.intervalId = null;
        this.destroyed = false;
    }

    start(seconds, customTimeout = null) {
        this.stop();
        if (this.destroyed) return;
        this.currentOnTimeout = customTimeout || this.defaultOnTimeout;
        this.timeLeft = Math.max(1, Number(seconds) || GAME_CONSTANTS.THINK_TIME);
        this.onTick(this.timeLeft);
        this.intervalId = setInterval(() => {
            if (this.destroyed) {
                this.stop();
                return;
            }
            this.timeLeft--;
            this.onTick(Math.max(0, this.timeLeft));
            if (this.timeLeft <= 0) {
                const cb = this.currentOnTimeout;
                this.stop();
                if (cb) {
                    this.runSynced(() => cb());
                }
            }
        }, 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    destroy() {
        this.destroyed = true;
        this.stop();
    }
}

export class MarbleGameEngine {
    constructor({ room = null, customOptions = null, callbacks = {}, lang = LangState.current } = {}) {
        this.roomId = room?.id || 'local_marble';
        this.lang = lang || 'ko';
        this.callbacks = callbacks || {};

        const opts = customOptions || room?.customOptions || {};
        this.maxTurn = Math.max(1, Number(opts.maxTurn) || GAME_CONSTANTS.MAX_TURN);
        this.initialMoney = Math.max(100000, Number(opts.initialMoney) || GAME_CONSTANTS.INITIAL_MONEY);

        this.world = createMarbleWorldState();
        this.world.maxTurn = this.maxTurn;

        this.scheduledTimers = new Set();
        this.destroyed = false;
        this.started = false;
        this.isGameOver = false;
        this.settlementResults = null;

        this.isRolling = false;
        this.isWaitingAction = false;
        this.isPreRollPhase = false;

        this._promptSeq = 0;
        this.pendingPrompt = null;

        this.diceState = {
            visible: false,
            title: '',
            d1: 1,
            d2: 1,
            d3: 6,
            diceCount: 2,
            useRufo: false,
            phase: 'HIDE'
        };

        this.port = this._createRuntimePort();

        this.tiles = [];
        this.allPlayers = [];
        this.turnManager = null;

        this.turnTimer = new ScopedTimer(
            (fn) => this.runSynced(fn),
            (timeLeft) => {
                if (this.callbacks.onTimerTick && !this.destroyed) {
                    const active = this.turnManager?.getCurrentPlayer();
                    this.callbacks.onTimerTick({
                        timeLeft,
                        activePlayerId: active ? active.id : null,
                        promptId: this.pendingPrompt ? this.pendingPrompt.promptId : null
                    });
                }
            },
            () => {
                if (this.isGameOver || this.destroyed) return;
                if (this.pendingPrompt && typeof this.pendingPrompt.onCancel === 'function') {
                    const cancelFn = this.pendingPrompt.onCancel;
                    this.pendingPrompt = null;
                    cancelFn();
                    this.emitState();
                    return;
                }
                if (this.isWaitingAction) {
                    this.proceedEndTurn();
                } else {
                    this.executeRoll();
                }
            }
        );

        this.runSynced(() => {
            WorldGimmickManager.reset();
            this.world.maxTurn = this.maxTurn;
            this.tiles = generateTiles();
            this.allPlayers = this._createPlayersFromRoom(room);
            this.turnManager = new TurnManager(this.allPlayers);
        });
    }

    runSynced(fn) {
        if (this.destroyed) return undefined;
        return runWithMarbleScope(this.world, this.port, fn);
    }

    schedule(fn, delay) {
        if (this.destroyed) return null;
        const id = setTimeout(() => {
            this.scheduledTimers.delete(id);
            if (!this.destroyed) {
                this.runSynced(fn);
            }
        }, delay);
        this.scheduledTimers.add(id);
        return id;
    }

    clearScheduled(id) {
        if (!id) return;
        clearTimeout(id);
        this.scheduledTimers.delete(id);
    }

    _createRuntimePort() {
        return {
            showToast: (message, duration = 2000) => {
                if (this.destroyed || !this.callbacks.onEvent) return;
                this.callbacks.onEvent({ type: 'TOAST', message, duration });
            },
            closeAll: () => {
                if (this.pendingPrompt) {
                    this.pendingPrompt = null;
                }
            },
            showChoicePopup: (title, desc, buttonsConfig) => {
                this._setPendingPrompt({
                    kind: 'CHOICE',
                    title,
                    desc,
                    buttons: buttonsConfig.map((cfg, idx) => ({
                        index: idx,
                        text: cfg.text,
                        color: cfg.color || '#3498db'
                    }))
                }, {
                    onRespond: (data) => {
                        const idx = Number(data?.buttonIndex);
                        const btn = buttonsConfig[idx];
                        if (btn && typeof btn.action === 'function') {
                            btn.action();
                        }
                    },
                    onCancel: null
                });
            },
            showNormalPopup: (title, desc, showCloseBtn, onEndCallback) => {
                this._setPendingPrompt({
                    kind: 'NORMAL',
                    title,
                    desc,
                    showCloseBtn: Boolean(showCloseBtn)
                }, {
                    onRespond: () => {
                        this.pendingPrompt = null;
                        if (typeof onEndCallback === 'function') onEndCallback();
                    },
                    onCancel: () => {
                        this.pendingPrompt = null;
                        if (typeof onEndCallback === 'function') onEndCallback();
                    }
                });
            },
            showBuyPopup: (tile, costs, playerMoney, onBuyCallback, onCancelCallback) => {
                const mText = getMarbleText(this.lang);
                this._setPendingPrompt({
                    kind: 'BUY',
                    tileId: tile.id,
                    tileLevel: tile.level,
                    tileType: tile.type,
                    timeType: tile.timeType || 'none',
                    costs,
                    playerMoney
                }, {
                    onRespond: (data) => {
                        const lvl = Number(data?.level);
                        if (!Number.isInteger(lvl) || lvl < 0 || lvl > 4) return;
                        if (costs[lvl] === undefined || playerMoney < costs[lvl]) {
                            this.port.showToast(mText.NOT_ENOUGH_MONEY, 2000);
                            return;
                        }
                        if (typeof onBuyCallback === 'function') onBuyCallback(lvl);
                    },
                    onCancel: () => {
                        if (typeof onCancelCallback === 'function') onCancelCallback();
                    }
                });
            },
            showCrisisPopup: (toll, canSellCover, onSell, onLoan) => {
                this._setPendingPrompt({
                    kind: 'CRISIS',
                    toll,
                    canSellCover: Boolean(canSellCover)
                }, {
                    onRespond: (data) => {
                        if (data?.choice === 'sell' && canSellCover && typeof onSell === 'function') {
                            onSell();
                        } else if (data?.choice === 'loan' && typeof onLoan === 'function') {
                            onLoan();
                        }
                    },
                    onCancel: null
                });
            },
            showSellPopup: (ownedTiles, requiredAmount, getSellValueFunc, onConfirm, onCancel) => {
                const mText = getMarbleText(this.lang);
                const tileMap = new Map();
                const items = ownedTiles.map(t => {
                    tileMap.set(t.id, t);
                    return {
                        id: t.id,
                        sellValue: getSellValueFunc(t)
                    };
                });
                this._setPendingPrompt({
                    kind: 'SELL',
                    requiredAmount,
                    tiles: items
                }, {
                    onRespond: (data) => {
                        const rawIds = Array.isArray(data?.tileIds) ? data.tileIds : [];
                        const uniqueIds = [...new Set(rawIds.map(Number))];
                        const selected = [];
                        let sum = 0;
                        uniqueIds.forEach(id => {
                            const t = tileMap.get(id);
                            if (t) {
                                selected.push(t);
                                sum += getSellValueFunc(t);
                            }
                        });
                        if (sum < requiredAmount || selected.length === 0) {
                            this.port.showToast(mText.NOT_ENOUGH_MONEY, 2000);
                            return;
                        }
                        if (typeof onConfirm === 'function') onConfirm(selected);
                    },
                    onCancel: () => {
                        if (typeof onCancel === 'function') onCancel();
                    }
                });
            },
            showInventoryPopup: (inventory, onUseCallback, onCancelCallback) => {
                this._setPendingPrompt({
                    kind: 'INVENTORY',
                    cards: inventory.map((c, idx) => ({
                        index: idx,
                        id: c.id,
                        name: c.name,
                        desc: c.desc
                    }))
                }, {
                    onRespond: (data) => {
                        const idx = Number(data?.cardIndex);
                        let card = Number.isInteger(idx) ? inventory[idx] : null;
                        if (!card && data?.cardId !== undefined) {
                            card = inventory.find(c => c.id === Number(data.cardId));
                        }
                        if (card && typeof onUseCallback === 'function') {
                            onUseCallback(card);
                        }
                    },
                    onCancel: () => {
                        if (typeof onCancelCallback === 'function') onCancelCallback();
                    }
                });
            },
            showTargetPopup: (title, desc, targets, onSelectCallback, onCancelCallback) => {
                const targetList = targets.map(t => ({
                    id: t.id,
                    name: t.name,
                    color: t.color || null,
                    disabled: Boolean(t.disabled)
                }));
                this._setPendingPrompt({
                    kind: 'TARGET',
                    title,
                    desc,
                    targets: targetList,
                    canCancel: typeof onCancelCallback === 'function'
                }, {
                    onRespond: (data) => {
                        const matched = targetList.find(t => String(t.id) === String(data?.targetId));
                        if (!matched || matched.disabled) return;
                        if (typeof onSelectCallback === 'function') onSelectCallback(matched.id);
                    },
                    onCancel: typeof onCancelCallback === 'function' ? () => onCancelCallback() : null
                });
            },
            showPortalPopup: (tiles, onSelectCallback, onCancelCallback, reqFee = 0, isFree = false) => {
                const validTileIds = tiles.filter(t => t.id !== BOARD_TILES.BBANGJU).map(t => t.id);
                this._setPendingPrompt({
                    kind: 'PORTAL',
                    reqFee,
                    isFree: Boolean(isFree),
                    validTileIds
                }, {
                    onRespond: (data) => {
                        const tid = Number(data?.tileId);
                        if (!validTileIds.includes(tid)) return;
                        if (typeof onSelectCallback === 'function') onSelectCallback(tid);
                    },
                    onCancel: () => {
                        if (typeof onCancelCallback === 'function') onCancelCallback();
                    }
                });
            },
            schedule: (fn, delay) => this.schedule(fn, delay),
            clearScheduled: (id) => this.clearScheduled(id)
        };
    }

    _setPendingPrompt(publicPayload, handlers) {
        const active = this.turnManager?.getCurrentPlayer();
        this.pendingPrompt = {
            promptId: ++this._promptSeq,
            revision: 1,
            targetPlayerId: active ? active.id : null,
            ...publicPayload,
            onRespond: handlers.onRespond,
            onCancel: handlers.onCancel
        };
    }

    _createPlayersFromRoom(room) {
        const text = getMarbleText(this.lang);
        const aiPool = ['aggressive', 'defensive', 'marathon'];
        for (let i = aiPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [aiPool[i], aiPool[j]] = [aiPool[j], aiPool[i]];
        }

        if (room && Array.isArray(room.slots)) {
            const activeSlots = room.slots.filter(s => s.type !== 'empty');
            if (activeSlots.length > 0) {
                const usedFixedAi = new Set(
                    activeSlots
                        .filter(s => s.type === 'ai' && s.aiType && s.aiType !== 'random')
                        .map(s => s.aiType)
                );
                const remainingAiPool = aiPool.filter(t => !usedFixedAi.has(t));

                return activeSlots.map((slot, idx) => {
                    let resolvedAiType = null;
                    if (slot.type === 'ai') {
                        resolvedAiType = (slot.aiType && slot.aiType !== 'random')
                            ? slot.aiType
                            : (remainingAiPool.shift() || aiPool[idx % aiPool.length]);
                    }
                    const p = new Player(
                        slot.id || `p_${idx + 1}`,
                        slot.name || `${text.NPC} ${idx + 1}`,
                        slot.color || DEFAULT_PLAYER_COLORS[idx % DEFAULT_PLAYER_COLORS.length],
                        this.initialMoney,
                        idx + 1,
                        resolvedAiType
                    );
                    p.isConnected = slot.type === 'human' ? slot.isConnected !== false : true;
                    return p;
                });
            }
        }

        return [
            new Player('p1', text.PLAYER_ME, '#e74c3c', this.initialMoney, 1, null),
            new Player('npc1', `${text.NPC} 1`, '#3498db', this.initialMoney, 2, aiPool[0]),
            new Player('npc2', `${text.NPC} 2`, '#f1c40f', this.initialMoney, 3, aiPool[1]),
            new Player('npc3', `${text.NPC} 3`, '#9b59b6', this.initialMoney, 4, aiPool[2])
        ];
    }

    emitState() {
        if (this.destroyed) return;
        if (this.callbacks.onStateChange) {
            this.callbacks.onStateChange(this);
        }
    }

    start() {
        if (this.started || this.destroyed) return;
        this.started = true;
        this.runSynced(() => this.startTurn());
    }

    destroy() {
        this.destroyed = true;
        this.turnTimer.destroy();
        for (const id of this.scheduledTimers) {
            clearTimeout(id);
        }
        this.scheduledTimers.clear();
        this.pendingPrompt = null;
    }

    markPlayerConnected(playerId, connected) {
        const player = this.allPlayers.find(p => p.id === playerId);
        if (!player || player.isAi()) return;
        player.isConnected = Boolean(connected);
        this.emitState();
    }

    convertPlayerToAi(playerId) {
        const player = this.allPlayers.find(p => p.id === playerId);
        if (!player || player.isAi() || this.isGameOver || this.destroyed) return false;

        const aiPool = ['aggressive', 'defensive', 'marathon'];
        player.aiType = aiPool[player.playerIndex % aiPool.length];
        player.isConnected = true;

        this.runSynced(() => {
            this.port.showToast(`${player.name} 퇴장 — AI가 이어서 플레이합니다.`, 2500);
            const active = this.turnManager.getCurrentPlayer();
            if (active && active.id === playerId) {
                if (this.pendingPrompt && this.pendingPrompt.targetPlayerId === playerId) {
                    const cancelFn = this.pendingPrompt.onCancel;
                    this.pendingPrompt = null;
                    if (cancelFn) {
                        cancelFn();
                    } else {
                        this.proceedEndTurn();
                    }
                } else if (this.isPreRollPhase && !this.isRolling && !this.isWaitingAction) {
                    this.schedule(() => this._runAiPreRoll(player), 600);
                }
            }
            this.emitState();
        });
        return true;
    }

    handleAction(playerId, action) {
        if (this.destroyed || this.isGameOver || !action || !action.type) {
            return { ok: false, error: 'GAME_INACTIVE' };
        }
        const activePlayer = this.turnManager.getCurrentPlayer();
        if (!activePlayer || activePlayer.id !== playerId || activePlayer.isAi()) {
            return { ok: false, error: 'NOT_YOUR_TURN' };
        }

        return this.runSynced(() => {
            if (action.type === 'ROLL_DICE') {
                if (!this.isPreRollPhase || this.isRolling || this.isWaitingAction || this.pendingPrompt) {
                    return { ok: false, error: 'CANNOT_ROLL_NOW' };
                }
                this.executeRoll();
                return { ok: true };
            }

            if (action.type === 'OPEN_INVENTORY') {
                if (!this.isPreRollPhase || this.isRolling || this.isWaitingAction || this.pendingPrompt) {
                    return { ok: false, error: 'CANNOT_USE_CARD_NOW' };
                }
                this.isWaitingAction = true;
                openPlayerCardSelector(
                    this._buildActionContext(activePlayer),
                    (didMoveImmediately) => {
                        if (!didMoveImmediately) {
                            this.startPreRollPhase(activePlayer);
                        } else {
                            this.emitState();
                        }
                    },
                    () => {
                        this.startPreRollPhase(activePlayer);
                    }
                );
                this.emitState();
                return { ok: true };
            }

            if (action.type === 'PROMPT_RESPOND' || action.type === 'PROMPT_CANCEL') {
                const activePrompt = this.pendingPrompt;
                if (!activePrompt) return { ok: false, error: 'NO_ACTIVE_PROMPT' };
                if (activePrompt.targetPlayerId !== playerId) return { ok: false, error: 'NOT_PROMPT_OWNER' };
                if (Number(action.promptId) !== activePrompt.promptId) return { ok: false, error: 'STALE_PROMPT' };

                const fn = action.type === 'PROMPT_CANCEL' ? activePrompt.onCancel : activePrompt.onRespond;
                if (typeof fn !== 'function') return { ok: false, error: 'ACTION_NOT_SUPPORTED' };

                fn(action);

                // 콜백이 closeAll()이나 새 팝업 전환 없이 종료된 경우(예: 잔액 부족 토스트) 현재 팝업을 유지하되 리비전을 증가
                if (this.pendingPrompt === activePrompt) {
                    this.pendingPrompt.revision += 1;
                }
                this.emitState();
                return { ok: true };
            }

            return { ok: false, error: 'UNKNOWN_ACTION' };
        });
    }

    _buildActionContext(player, extra = {}) {
        return {
            player,
            tiles: this.tiles,
            allPlayers: this.allPlayers,
            turnManager: this.turnManager,
            turnTimer: this.turnTimer,
            updateRender: () => this.emitState(),
            refreshUI: () => this.emitState(),
            calculateToll,
            calculatePurchaseCost,
            getTileSellValue,
            proceedEndTurn: () => this.proceedEndTurn(),
            handleTileArrival: (p) => this.handleTileArrival(p),
            handleTollPayment: (p, t, cb) => this.handleTollPayment(p, t, cb),
            executeRoll: () => this.executeRoll(),
            setWaitingAction: (val) => { this.isWaitingAction = val; },
            ...extra
        };
    }

    finishGame() {
        if (this.isGameOver) return;
        this.isGameOver = true;
        this.pendingPrompt = null;
        this.diceState.visible = false;
        this.diceState.phase = 'HIDE';
        this.turnTimer.stop();
        const ranked = processFinalSettlement(this.allPlayers, this.tiles);
        this.settlementResults = serializeSettlementResults(ranked);
        this.emitState();
        if (this.callbacks.onEvent) {
            this.callbacks.onEvent({ type: 'GAME_OVER', results: this.settlementResults });
        }
    }

    startTurn() {
        if (this.destroyed || this.isGameOver) return;
        if (this.turnManager.globalTurn > this.maxTurn) {
            this.finishGame();
            return;
        }

        const aliveCount = this.allPlayers.filter(p => !p.isBankrupt).length;
        if (aliveCount === 0) {
            this.finishGame();
            return;
        }

        const player = this.turnManager.getCurrentPlayer();
        if (!player || player.isBankrupt) {
            this.proceedEndTurn();
            return;
        }

        // 플레이어 자신의 턴 시작 시 그을음/빛무리 턴 카운트 차감 및 자연 전환 처리
        WorldGimmickManager.advancePlayerTurn(player, this.turnManager.globalTurn, this.allPlayers);

        const cText = getCardUIText(this.lang);
        const mText = getMarbleText(this.lang);
        this.isRolling = false;
        this.isWaitingAction = false;
        this.isPreRollPhase = false;
        this.diceState.visible = false;
        this.diceState.phase = 'HIDE';
        this.port.closeAll();
        this.emitState();

        if (player.money <= 0 && !player.isBankrupt) {
            const emergencyLoanAmount = Math.round((GAME_CONSTANTS.START_BONUS * this.turnManager.globalTurn) / 10);

            if (player.isAi()) {
                const decision = AIManager.decideTurnStartCrisis(player, this.tiles, emergencyLoanAmount, this.turnManager.globalTurn);
                if (decision.action === 'sell' && decision.tiles && decision.tiles.length > 0) {
                    player.sellProperties(decision.tiles, getTileSellValue);
                    this.port.showToast(`${player.name}${getGimmickText(this.lang).AI_CRISIS_SELL}`, 2500);
                    this.emitState();
                    this.schedule(() => this.processBbangju(player), 1000);
                } else if (decision.action === 'loan' && player.loanCount < GAME_CONSTANTS.LOAN_MAX_COUNT) {
                    player.loanCount++;
                    player.loanPrincipal += emergencyLoanAmount;
                    player.money += emergencyLoanAmount;
                    this.port.showToast(`${player.name} ${mText.LOAN_EXECUTE}`, 2000);
                    this.emitState();
                    this.schedule(() => this.processBbangju(player), 1000);
                } else {
                    if (player.goBankrupt(this.tiles)) {
                        this.port.showToast(`${player.name} ${mText.BANKRUPT}`, 3000);
                    }
                    this.emitState();
                    this.schedule(() => this.proceedEndTurn(), 2500);
                }
                return;
            }

            const triggerTurnStartBankrupt = () => {
                this.turnTimer.stop();
                this.port.closeAll();
                if (player.goBankrupt(this.tiles)) {
                    this.port.showToast(`${player.name} ${mText.BANKRUPT}`, 3000);
                    this.emitState();
                    this.schedule(() => this.proceedEndTurn(), 2500);
                } else {
                    this.emitState();
                    this.schedule(() => this.processBbangju(player), 1500);
                }
            };

            const openTurnStartCrisisPopup = () => {
                this.isWaitingAction = true;
                this.turnTimer.start(getPlayerThinkTime(player), triggerTurnStartBankrupt);

                const sellableTiles = this.tiles.filter(t => t.owner === player && t.type === 'normal');
                const canLoan = player.loanCount < GAME_CONSTANTS.LOAN_MAX_COUNT;
                const choiceBtns = [];

                if (sellableTiles.length > 0) {
                    choiceBtns.push({
                        text: cText.CRISIS_TURN_SELL_BTN,
                        color: '#e67e22',
                        action: () => {
                            this.port.showSellPopup(
                                sellableTiles,
                                1,
                                getTileSellValue,
                                (selectedTiles) => {
                                    this.turnTimer.stop();
                                    player.sellProperties(selectedTiles, getTileSellValue);
                                    this.port.closeAll();
                                    this.emitState();
                                    this.schedule(() => this.processBbangju(player), 1000);
                                },
                                () => {
                                    openTurnStartCrisisPopup();
                                }
                            );
                        }
                    });
                }

                if (canLoan) {
                    choiceBtns.push({
                        text: `${cText.CRISIS_TURN_LOAN_BTN} (+${formatMoney(emergencyLoanAmount)})`,
                        color: '#2ecc71',
                        action: () => {
                            this.turnTimer.stop();
                            this.port.closeAll();
                            player.loanCount++;
                            player.loanPrincipal += emergencyLoanAmount;
                            player.money += emergencyLoanAmount;
                            this.port.showToast(`${formatMoney(emergencyLoanAmount)} ${cText.CRISIS_LOAN_DONE}`, 2500);
                            this.emitState();
                            this.schedule(() => this.processBbangju(player), 1000);
                        }
                    });
                }

                choiceBtns.push({
                    text: cText.CRISIS_TURN_GIVEUP_BTN,
                    color: '#e74c3c',
                    action: triggerTurnStartBankrupt
                });

                this.port.showChoicePopup(cText.CRISIS_TURN_TITLE, cText.CRISIS_TURN_DESC, choiceBtns);
                this.emitState();
            };

            openTurnStartCrisisPopup();
            return;
        }

        this.processBbangju(player);
    }

    processBbangju(player) {
        if (this.turnManager.globalTurn === 1 && player.bbangjuSupportTurns === 0 && player.bbangjuPaidTotal === 0 && WorldGimmickManager.bbangjuState === 'recruiting') {
            if (player.isAi()) {
                if (AIManager.decideBbangjuSupport(player)) {
                    player.bbangjuSupportTurns = 3;
                } else {
                    player.bbangjuPaidTotal = -1;
                }
                this.processBbangjuInstallment(player);
            } else {
                this.isWaitingAction = true;
                const gText = getGimmickText(this.lang);
                this.turnTimer.start(getPlayerThinkTime(player), () => {
                    this.port.closeAll();
                    this.isWaitingAction = false;
                    player.bbangjuPaidTotal = -1;
                    this.processBbangjuInstallment(player);
                });
                this.port.showChoicePopup(gText.BBANGJU_REQ_TITLE, gText.BBANGJU_REQ_DESC, [
                    {
                        text: gText.BTN_ACCEPT,
                        color: '#3498db',
                        action: () => {
                            this.turnTimer.stop();
                            this.port.closeAll();
                            this.isWaitingAction = false;
                            player.bbangjuSupportTurns = 3;
                            this.processBbangjuInstallment(player);
                        }
                    },
                    {
                        text: gText.BTN_REJECT,
                        color: '#e74c3c',
                        action: () => {
                            this.turnTimer.stop();
                            this.port.closeAll();
                            this.isWaitingAction = false;
                            player.bbangjuPaidTotal = -1;
                            this.processBbangjuInstallment(player);
                        }
                    }
                ]);
                this.emitState();
                return;
            }
        } else {
            this.processBbangjuInstallment(player);
        }
    }

    processBbangjuInstallment(player) {
        const gText = getGimmickText(this.lang);
        if (player.bbangjuSupportTurns > 0 && WorldGimmickManager.bbangjuState === 'recruiting') {
            if (player.money >= GAME_CONSTANTS.BBANGJU_SUPPORT_INSTALLMENT) {
                player.money -= GAME_CONSTANTS.BBANGJU_SUPPORT_INSTALLMENT;
                player.bbangjuPaidTotal += GAME_CONSTANTS.BBANGJU_SUPPORT_INSTALLMENT;
                player.bbangjuSupportTurns--;
                this.port.showToast(gText.BBANGJU_PAY_SUPPORT, 2000);
            } else {
                player.bbangjuSupportTurns = 0;
                this.port.showToast(gText.BBANGJU_CANCEL, 2000);
            }
            this.emitState();
            this.schedule(() => this.continueTurnPhase(player), 1000);
        } else {
            this.continueTurnPhase(player);
        }
    }

    continueTurnPhase(player) {
        const mText = getMarbleText(this.lang);
        const cText = getCardUIText(this.lang);
        const gText = getGimmickText(this.lang);

        if (this.turnManager.globalTurn === 4 && WorldGimmickManager.bbangjuState === 'recruiting' && player.playerIndex === 1) {
            WorldGimmickManager.resolveBbangju(this.allPlayers);
            this.emitState();
        }
        player.processTurnInterest(this.turnManager.globalTurn);
        if (this.tiles[BOARD_TILES.DAYA].owner === player) {
            player.recordDayaHoldTurn(this.turnManager.globalTurn);
        }
        this.emitState();

        if (this.tiles[BOARD_TILES.THEATER].owner === player) {
            const profit = Math.round(GAME_CONSTANTS.THEATER_TURN_PROFIT * getPositiveEffectMultiplier(player));
            player.money += profit;
            player.tracker.theaterProfitCount++;
            this.port.showToast(`${gText.THEATER_PROFIT_TOAST} (+${formatMoney(profit)})`, 2000);
            this.emitState();
        }

        if (player.islandTurns > 0 && player.inventory.some(c => c.id === CARD_IDS.NER_ESCAPE) && !player.isAi()) {
            this.isWaitingAction = true;
            this.turnTimer.start(getPlayerThinkTime(player), () => {
                this.port.closeAll();
                this.isWaitingAction = false;
                this.executeRoll();
            });
            this.port.showChoicePopup(cText.USE_ESCAPE_TITLE, cText.USE_ESCAPE_DESC, [
                {
                    text: mText.BTN_USE,
                    color: '#2ecc71',
                    action: () => {
                        this.turnTimer.stop();
                        removeCardFromInventory(player, CARD_IDS.NER_ESCAPE);
                        player.islandTurns = 0;
                        this.port.closeAll();
                        this.isWaitingAction = false;
                        this.executeRoll();
                    }
                },
                {
                    text: mText.BTN_HOLD,
                    color: '#7f8c8d',
                    action: () => {
                        this.turnTimer.stop();
                        this.port.closeAll();
                        this.isWaitingAction = false;
                        this.executeRoll();
                    }
                }
            ]);
            this.emitState();
            return;
        }

        if (player.restTurns > 0) {
            player.restTurns--;
            this.port.showToast(mText.TOAST_RESTING, 2000);
            player.bowExtraRollAvailable = false;
            player.timeAccelExtraRollAvailable = false;
            this.emitState();
            this.schedule(() => this.proceedEndTurn(), player.isAi() ? 1500 : 2000);
            return;
        }

        if (RequiemState.isSootState && player.isReincarnated) {
            this.isWaitingAction = true;
            handleReincarnationTurnSkill(
                this._buildActionContext(player),
                () => {
                    this.isWaitingAction = false;
                    this.startPreRollPhase(player);
                }
            );
            this.emitState();
            return;
        }

        this.startPreRollPhase(player);
    }

    startPreRollPhase(player) {
        this.isRolling = false;
        this.isWaitingAction = false;
        this.isPreRollPhase = !player.isAi();
        this.emitState();
        this.turnTimer.start(getPlayerThinkTime(player), () => {
            this.executeRoll();
        });

        if (player.isAi()) {
            this._runAiPreRoll(player);
        }
    }

    _runAiPreRoll(player) {
        if (this.destroyed || this.isGameOver || this.turnManager.getCurrentPlayer() !== player) return;
        const cardToUse = AIManager.decideUseCard({
            player,
            tiles: this.tiles,
            allPlayers: this.allPlayers,
            turnManager: this.turnManager
        });
        if (cardToUse) {
            this.port.showToast(`${player.name} 카드 사용! [${cardToUse.name}]`, 2500);
            useActiveCard(
                this._buildActionContext(player),
                cardToUse,
                (didMoveImmediately) => {
                    if (!didMoveImmediately) {
                        this.schedule(() => this.executeRoll(), 2000);
                    }
                },
                () => this.schedule(() => this.executeRoll(), 1500)
            );
        } else {
            this.schedule(() => this.executeRoll(), 1500);
        }
    }

    proceedEndTurn() {
        if (this.destroyed || this.isGameOver) return;
        this.turnTimer.stop();
        this.port.closeAll();
        this.isWaitingAction = false;
        this.isPreRollPhase = false;
        this.diceState.visible = false;
        this.diceState.phase = 'HIDE';

        const currentPlayer = this.turnManager.getCurrentPlayer();
        if (
            currentPlayer &&
            !currentPlayer.isBankrupt &&
            (currentPlayer.bowExtraRollAvailable || currentPlayer.timeAccelExtraRollAvailable) &&
            currentPlayer.islandTurns === 0 &&
            currentPlayer.restTurns === 0
        ) {
            const cText = getCardUIText(this.lang);
            if (currentPlayer.bowExtraRollAvailable) {
                currentPlayer.bowExtraRollAvailable = false;
                this.port.showToast(cText.TREASURE_BOW_EXTRA_ROLL, 2500);
            } else {
                currentPlayer.timeAccelExtraRollAvailable = false;
                this.port.showToast(cText.SPEC_TIME_ACCEL_EXTRA_ROLL, 2500);
            }
            this.emitState();
            this.schedule(() => this.startPreRollPhase(currentPlayer), 1000);
            return;
        }

        const aliveCount = this.allPlayers.filter(p => !p.isBankrupt).length;
        if (aliveCount === 0) {
            this.finishGame();
            return;
        }

        this.turnManager.nextTurn();
        this.startTurn();
    }

    executeRoll() {
        if (this.destroyed || this.isGameOver || this.isRolling || this.isWaitingAction) return;
        this.isRolling = true;
        this.isPreRollPhase = false;
        this.turnTimer.stop();

        const player = this.turnManager.getCurrentPlayer();
        const mText = getMarbleText(this.lang);
        const cText = getCardUIText(this.lang);
        const gText = getGimmickText(this.lang);

        const useRufo = player.hasRufoDiceBuff;
        const useErpin = player.hasErpinDiceBuff;
        const baseDiceCount = getPlayerDiceCount(player);

        let d1 = Math.floor(Math.random() * 6) + 1;
        let d2 = baseDiceCount >= 2 ? (Math.floor(Math.random() * 6) + 1) : 0;
        const d3 = useRufo ? 6 : 0;
        const erpinTriggered = Boolean(useErpin && (d1 === 1 || d2 === 1));

        this.diceState = {
            visible: true,
            title: `${player.name} ${mText.ROLLING}`,
            d1,
            d2,
            d3,
            diceCount: baseDiceCount,
            useRufo,
            phase: 'SPINNING'
        };
        this.emitState();
        if (this.callbacks.onEvent) {
            this.callbacks.onEvent({ type: 'DICE_ROLL', ...this.diceState, playerId: player.id });
        }

        this.schedule(() => {
            const finishRollProcess = (finalSum) => {
                this.diceState = {
                    visible: true,
                    title: `${mText.RESULT} ${finalSum}`,
                    d1,
                    d2,
                    d3,
                    diceCount: baseDiceCount,
                    useRufo,
                    phase: 'LANDED'
                };

                if (useRufo) {
                    player.hasRufoDiceBuff = false;
                    this.port.showToast(cText.RUFO_DICE_USE, 2500);
                }
                if (useErpin) {
                    player.hasErpinDiceBuff = false;
                }

                if (player.islandTurns > 0) {
                    if (baseDiceCount >= 2 && d1 === d2) {
                        player.islandTurns = 0;
                        this.port.showToast(mText.TOAST_ESCAPE_SUCCESS, 2500);
                    } else {
                        player.islandTurns--;
                        this.port.showToast(mText.TOAST_ESCAPE_FAIL, 2500);
                        this.emitState();
                        this.schedule(() => {
                            this.diceState.visible = false;
                            this.diceState.phase = 'HIDE';
                            this.proceedEndTurn();
                        }, 1500);
                        return;
                    }
                }

                if (player.move(finalSum)) {
                    const startBonus = getStartPassBonus(player);
                    if (startBonus > 0) {
                        player.money += startBonus;
                        this.port.showToast(`${mText.TOAST_START} (+${formatMoney(startBonus)})`, 2000);
                    } else {
                        this.port.showToast(RequiemState.isSootState ? gText.LAP_BONUS_BLOCKED_SOOT : gText.LAP_BONUS_BLOCKED_STATE, 2000);
                    }
                }
                this.emitState();

                this.schedule(() => {
                    this.diceState.visible = false;
                    this.diceState.phase = 'HIDE';
                    this.handleTileArrival(player);
                }, 1000);
            };

            if (erpinTriggered) {
                if (player.isAi()) {
                    const chosenDie = AIManager.decideErpinDieValue(
                        player, d1, d2, d3, baseDiceCount, this.tiles, this.allPlayers, this.turnManager.globalTurn
                    );
                    if (d1 === 1) d1 = chosenDie;
                    else if (d2 === 1) d2 = chosenDie;
                    finishRollProcess(d1 + d2 + d3);
                } else {
                    this.diceState = {
                        visible: true,
                        title: `${player.name} ${mText.ROLLING}`,
                        d1,
                        d2,
                        d3,
                        diceCount: baseDiceCount,
                        useRufo,
                        phase: 'LANDED'
                    };
                    this.turnTimer.start(getPlayerThinkTime(player), () => {
                        this.port.closeAll();
                        finishRollProcess(d1 + d2 + d3);
                    });

                    const btnConfigs = [1, 2, 3, 4, 5, 6].map(v => ({
                        text: `${v}`,
                        color: '#9b59b6',
                        action: () => {
                            this.turnTimer.stop();
                            this.port.closeAll();
                            if (d1 === 1) d1 = v;
                            else if (d2 === 1) d2 = v;
                            finishRollProcess(d1 + d2 + d3);
                        }
                    }));
                    this.port.showChoicePopup(gText.ERPIN_DICE_TITLE, gText.ERPIN_DICE_DESC, btnConfigs);
                    this.emitState();
                }
            } else {
                finishRollProcess(d1 + d2 + d3);
            }
        }, 800);
    }

    handleTileArrival(player) {
        if (this.destroyed || this.isGameOver) return;
        this.isRolling = false;
        this.isWaitingAction = true;

        const tile = this.tiles[player.pos];
        const mText = getMarbleText(this.lang);
        const cText = getCardUIText(this.lang);
        const gText = getGimmickText(this.lang);

        const minBuyCost = calculatePurchaseCost(tile, 0, player);
        if (!tile.owner && tile.basePrice > 0 && player.money < minBuyCost) {
            this.port.showToast(mText.TOAST_NO_MONEY_BUY, 2500);
            this.emitState();
            this.schedule(() => this.proceedEndTurn(), 2000);
            return;
        }

        const ctx = this._buildActionContext(player, { tile });
        if (BoardGimmickHandlers[tile.id]) {
            BoardGimmickHandlers[tile.id](ctx);
            this.emitState();
            return;
        }
        if (tile.type === 'card') {
            BoardGimmickHandlers.handleCardTile(ctx);
            this.emitState();
            return;
        }

        if (tile.type === 'normal' || tile.type === 'special_buy') {
            if (tile.owner && tile.owner !== player) {
                this.handleTollPayment(player, tile);
                return;
            }
            if (!tile.owner || tile.owner === player) {
                if (tile.owner === player && tile.level >= 4) {
                    this.proceedEndTurn();
                    return;
                }

                const calcCosts = [0, 1, 2, 3, 4].map(lvl => calculatePurchaseCost(tile, lvl, player));
                const forceVillage = !tile.owner && tile.type === 'normal' && isBowVillageForced(player);
                if (forceVillage && player.money < calcCosts[2]) {
                    this.port.showToast(cText.TREASURE_BOW_VILLAGE_FAIL, 2500);
                    this.emitState();
                    this.schedule(() => this.proceedEndTurn(), 2000);
                    return;
                }

                const ctxArgs = { player, tile, tiles: this.tiles, calcCosts, turnManager: this.turnManager };
                const maxAllowedLvl = tile.level < 2 ? 2 : (tile.level === 2 ? 3 : 4);

                if (player.isAi()) {
                    let targetLevel = AIManager.decidePurchase(ctxArgs);
                    if (targetLevel > maxAllowedLvl) targetLevel = maxAllowedLvl;
                    if (forceVillage && targetLevel >= 0 && targetLevel < 2) targetLevel = 2;
                    if (targetLevel !== -1) {
                        const rawCost = calcCosts[targetLevel];
                        const useSist = AIManager.shouldUseSistDiscount(player, tile, targetLevel, rawCost);
                        const finalCost = useSist ? Math.round(rawCost * 0.5) : rawCost;
                        if (player.money >= finalCost) {
                            if (useSist) {
                                removeCardFromInventory(player, CARD_IDS.SIST_DEAL);
                                this.port.showToast(`${player.name}${gText.AI_USE_SIST_DEAL}`, 2500);
                            }
                            player.buyProperty(tile, targetLevel, finalCost);
                            this.emitState();
                        }
                    }
                    this.schedule(() => this.proceedEndTurn(), 1000);
                    return;
                }

                this.turnTimer.start(getPlayerThinkTime(player), () => this.proceedEndTurn());
                this.port.showBuyPopup(
                    tile,
                    calcCosts,
                    player.money,
                    (selectedLvl) => {
                        let lvl = (forceVillage && selectedLvl < 2) ? 2 : selectedLvl;
                        if (lvl > maxAllowedLvl) lvl = maxAllowedLvl;
                        const targetCost = calcCosts[lvl];

                        if (tile.type === 'normal' && player.hasSistDiscountBuff) {
                            player.hasSistDiscountBuff = false;
                            player.buyProperty(tile, lvl, Math.round(targetCost * 0.5));
                            this.port.closeAll();
                            this.proceedEndTurn();
                            return;
                        }

                        if (tile.type === 'normal' && player.inventory.some(c => c.id === CARD_IDS.SIST_DEAL)) {
                            this.port.showChoicePopup(cText.USE_DISCOUNT_TITLE, cText.USE_DISCOUNT_DESC, [
                                {
                                    text: mText.BTN_USE,
                                    color: '#3498db',
                                    action: () => {
                                        removeCardFromInventory(player, CARD_IDS.SIST_DEAL);
                                        player.buyProperty(tile, lvl, Math.round(targetCost * 0.5));
                                        this.port.closeAll();
                                        this.proceedEndTurn();
                                    }
                                },
                                {
                                    text: mText.BTN_HOLD,
                                    color: '#7f8c8d',
                                    action: () => {
                                        player.buyProperty(tile, lvl, targetCost);
                                        this.port.closeAll();
                                        this.proceedEndTurn();
                                    }
                                }
                            ]);
                        } else {
                            player.buyProperty(tile, lvl, targetCost);
                            this.port.closeAll();
                            this.proceedEndTurn();
                        }
                    },
                    () => this.proceedEndTurn()
                );
                this.emitState();
                return;
            }
        }

        this.proceedEndTurn();
    }

    handleTollPayment(player, tile, onAfterPaid = null) {
        const mText = getMarbleText(this.lang);
        const cText = getCardUIText(this.lang);
        const finishPayment = onAfterPaid || (() => this.proceedEndTurn());

        const immuneList = [
            ...(player.buffs['hold_immune'] || []),
            ...(player.buffs['todo_hold_immune'] || [])
        ];
        if (immuneList.length > 0) {
            const immuneCard = immuneList.find(c => c.targetId === tile.id);
            if (immuneCard) {
                this.port.closeAll();
                this.port.showToast(`[${immuneCard.name}] ${cText.IMMUNE_APPLIED}`, 3000);
                this.emitState();
                this.schedule(finishPayment, 2000);
                return;
            }
        }

        if (player.hasVipShield) {
            player.hasVipShield = false;
            this.port.showToast(mText.CARD_USE_FREE, 2500);
            this.emitState();
            this.schedule(finishPayment, 2000);
            return;
        }
        if (player.inventory.some(c => c.id === CARD_IDS.VIP_CARD)) {
            removeCardFromInventory(player, CARD_IDS.VIP_CARD);
            this.port.showToast(mText.CARD_USE_FREE, 2500);
            this.emitState();
            this.schedule(finishPayment, 2000);
            return;
        }

        const ctx = this._buildActionContext(player, {
            tile,
            onAfterPaid: finishPayment,
            isWaitingAction: this.isWaitingAction
        });
        handleTollPaymentProcess(ctx);
        this.emitState();
    }

    getSnapshotForPlayer(viewerId = null) {
        const activePlayer = this.turnManager ? this.turnManager.getCurrentPlayer() : null;
        const activeId = activePlayer ? activePlayer.id : null;
        const canAct = Boolean(
            !this.isGameOver &&
            viewerId &&
            activeId === viewerId &&
            activePlayer &&
            !activePlayer.isAi() &&
            this.isPreRollPhase &&
            !this.isRolling &&
            !this.isWaitingAction &&
            !this.pendingPrompt
        );

        let hasUsableCards = false;
        if (canAct) {
            this.runSynced(() => {
                hasUsableCards = getUsableCards({
                    player: activePlayer,
                    tiles: this.tiles,
                    allPlayers: this.allPlayers,
                    turnManager: this.turnManager
                }).length > 0;
            });
        }

        let publicPrompt = null;
        let waitingFor = null;
        if (this.pendingPrompt) {
            if (this.pendingPrompt.targetPlayerId === viewerId) {
                const { onRespond, onCancel, ...rest } = this.pendingPrompt;
                publicPrompt = rest;
            } else {
                waitingFor = {
                    playerId: this.pendingPrompt.targetPlayerId,
                    kind: this.pendingPrompt.kind
                };
            }
        }

        const isSoot = Boolean(this.world.requiem?.isSootState);

        return {
            roomId: this.roomId,
            phase: this.isGameOver
                ? 'GAME_OVER'
                : (this.isRolling ? 'ROLLING' : (this.isWaitingAction ? 'WAITING_ACTION' : 'PRE_ROLL')),
            activePlayerId: activeId,
            canAct,
            hasUsableCards,
            timerLeft: this.turnTimer.timeLeft,
            world: {
                currentTurn: this.world.currentTurn,
                maxTurn: this.world.maxTurn,
                currentTime: this.world.currentTime,
                timeSlot: { ...this.world.timeSlot },
                bbangjuState: this.world.bbangjuState,
                bbangjuChiefs: this.world.bbangjuChiefs.map(c => c.id),
                globalBbangjuVisits: this.world.globalBbangjuVisits,
                isFurryBeach: this.world.isFurryBeach,
                furryBeachFeeMultiplier: this.world.furryBeachFeeMultiplier,
                requiem: {
                    hasSootEverTriggered: this.world.requiem.hasSootEverTriggered,
                    isSootState: this.world.requiem.isSootState,
                    isHaloState: this.world.requiem.isHaloState,
                    sootRemainingTurns: this.world.requiem.sootRemainingTurns,
                    haloRemainingTurns: this.world.requiem.haloRemainingTurns,
                    haloTriggeredByCard: this.world.requiem.haloTriggeredByCard,
                    reincarnatedPlayerId: this.world.requiem.reincarnatedPlayer
                        ? this.world.requiem.reincarnatedPlayer.id
                        : null
                }
            },
            players: this.allPlayers.map(p => ({
                id: p.id,
                name: p.name,
                color: p.color,
                money: p.money,
                pos: p.pos,
                territoryCount: p.territoryCount,
                islandTurns: p.islandTurns,
                restTurns: p.restTurns,
                isBankrupt: p.isBankrupt,
                playerIndex: p.playerIndex,
                isAi: p.isAi(),
                aiType: p.aiType,
                isConnected: p.isConnected !== false,
                isBbangjuChief: Boolean(p.isBbangjuChief),
                isReincarnated: Boolean(p.isReincarnated),
                hasKarmaState: Boolean(p.hasKarmaState),
                hasRegretState: Boolean(p.hasRegretState),
                hasWishState: Boolean(p.hasWishState),
                hasDreamState: Boolean(p.hasDreamState),
                hasMountainBuff: Boolean(p.hasMountainBuff),
                hasRufoDiceBuff: Boolean(p.hasRufoDiceBuff),
                hasErpinDiceBuff: Boolean(p.hasErpinDiceBuff),
                hasSistDiscountBuff: Boolean(p.hasSistDiscountBuff),
                hasVipShield: Boolean(p.hasVipShield),
                bowExtraRollAvailable: Boolean(p.bowExtraRollAvailable),
                timeAccelExtraRollAvailable: Boolean(p.timeAccelExtraRollAvailable),
                hasOriginElif: Boolean(p.hasOriginElif),
                loanCount: p.loanCount,
                loanPrincipal: p.loanPrincipal,
                loanInterest: p.loanInterest,
                displayTreasureCount: (isSoot && p.isReincarnated) ? 6 : p.treasureCards.length,
                inventoryCount: p.inventory.length,
                inventory: viewerId === p.id ? p.inventory.map(c => ({ id: c.id, name: c.name, desc: c.desc })) : undefined
            })),
            tiles: this.tiles.map(t => ({
                id: t.id,
                type: t.type,
                name: t.name,
                side: t.side,
                x: t.x,
                y: t.y,
                ownerId: t.owner ? t.owner.id : null,
                level: t.level,
                basePrice: t.basePrice,
                isSpecialToll: Boolean(t.isSpecialToll),
                timeType: t.timeType || 'none'
            })),
            diceState: { ...this.diceState },
            pendingPrompt: publicPrompt,
            waitingFor,
            settlementResults: this.isGameOver ? this.settlementResults : null
        };
    }
}
