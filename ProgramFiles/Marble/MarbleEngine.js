// ProgramFiles/Marble/MarbleEngine.js
// 서버-권위적(Server-Authoritative) 및 오프라인 로컬 폴백 겸용 순수 엘리아스 마블 게임 엔진

import { generateTiles, TurnManager, calculateToll, calculateTollBreakdown, calculatePurchaseCost, getTileSellValue } from './MarbleLogic.js';
import { Player } from './MarblePlayer.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import { BoardGimmickHandlers } from './MarbleBoardGimmick.js';
import { handleTollPaymentProcess, executePlayerLoanBorrow } from './MarbleEconomy.js';
import { processFinalSettlement, serializeSettlementResults } from './MarbleSettlement.js';
import { AIManager } from './MarbleAI.js';
import { removeCardFromInventory, useActiveCard, openPlayerCardSelector, getUsableCards } from './MarbleCard.js';
import { getPlayerThinkTime, getPlayerDiceCount, isBowVillageForced } from './MarbleCardTreasure.js';
import { getStartPassBonus, applyLapPassBonus } from './MarbleCardNormal.js';
import {
    RequiemState,
    handleReincarnationTurnSkill,
    getPositiveEffectMultiplier,
    ensureSootPnlEntry,
    recordHaloPositiveGain
} from './MarbleRequiem.js';
import {
    buildMatchLogDataFromEngine,
    estimatePreSettlementPlayerAsset,
    computeTieAwareRanks
} from './MarbleLogManager.js';
import {
    createMarbleWorldState,
    runWithMarbleScope,
    formatMoney,
    getMarbleText,
    getCardUIText,
    getGimmickText
} from './MarbleRuntime.js';
import { LangState } from '../System/LanguageManager.js';
import { pickRandomBotName } from '../System/GameRegistry.js';
import { GAME_CONSTANTS, BUILDING_COSTS, MULTIPLIERS } from '../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';

const DEFAULT_PLAYER_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6'];

/**
 * 이번 주사위 굴림이 더블인지 판정한다.
 * - 일반 2주사위: d1 === d2
 * - 루포의 주사위(3개 중 3번째 눈 6 고정): 3개 중 2개 이상 같으면 더블(d1 === d2 || d1 === 6 || d2 === 6)
 */
function isDiceRollDouble(d1, d2, d3, diceCount, useRufo) {
    if (useRufo) {
        return d1 === d2 || d1 === 6 || d2 === 6;
    }
    if (diceCount >= 2) {
        return d1 === d2;
    }
    return false;
}

class ScopedTimer {
    constructor(runSynced, onTick, defaultOnTimeout, onBeforeTimeout = null) {
        this.runSynced = runSynced;
        this.onTick = onTick;
        this.defaultOnTimeout = defaultOnTimeout;
        this.onBeforeTimeout = onBeforeTimeout;
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
                this.runSynced(() => {
                    let afterCb = null;
                    if (typeof this.onBeforeTimeout === 'function') {
                        afterCb = this.onBeforeTimeout();
                    }
                    if (cb) {
                        cb();
                    }
                    if (typeof afterCb === 'function') {
                        afterCb();
                    }
                });
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
        this.skipTurnOrderRoll = Boolean(opts.skipTurnOrderRoll);
        this.forceInteractiveTurnOrder = Boolean(opts.forceInteractiveTurnOrder);
        this.turnOrderState = null;
        this._turnOrderBrackets = null;
        this.turnOrderResult = null;
        this.maxTurn = Math.max(1, Number(opts.maxTurn) || GAME_CONSTANTS.MAX_TURN);
        const parsedInitMoney = Number(opts.initialMoney);
        this.hasCustomUniformMoney = Boolean(opts.uniformInitialMoney)
            || (Number.isFinite(parsedInitMoney) && parsedInitMoney > 0 && parsedInitMoney !== GAME_CONSTANTS.INITIAL_MONEY);
        this.initialMoney = Math.max(100000, parsedInitMoney || GAME_CONSTANTS.INITIAL_MONEY);

        this.world = createMarbleWorldState();
        this.world.maxTurn = this.maxTurn;
        if (Number.isFinite(Number(opts.haloCardPrecheckProb))) {
            this.world.haloCardPrecheckProb = Math.max(0, Math.min(1, Number(opts.haloCardPrecheckProb)));
            this.world.metrics.haloCardPrecheckProbUsed = this.world.haloCardPrecheckProb;
        }
        if (Number.isFinite(Number(opts.haloPositiveMult))) {
            this.world.haloPositiveMult = Math.max(1, Number(opts.haloPositiveMult));
            this.world.metrics.haloPositiveMultUsed = this.world.haloPositiveMult;
        }

        this.scheduledTimers = new Set();
        this.destroyed = false;
        this.started = false;
        this.isGameOver = false;
        this.settlementResults = null;

        this.totalPlayerTurns = 0;
        this.rankCheckpoints = [];
        this.rankChanges = [];
        this._lastPreSettleRanks = null;
        this.lastMatchLogInput = null;

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
            useErpin: false,
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
            },
            () => this._handleHumanTimeout()
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
            showToast: (message, duration = 3200, targetPlayerId = null) => {
                if (this.destroyed || !this.callbacks.onEvent) return;
                this.callbacks.onEvent({
                    type: 'TOAST',
                    message,
                    duration,
                    targetPlayerId: targetPlayerId ?? null
                });
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
                        color: cfg.color || '#3498db',
                        row: cfg.row,
                        align: cfg.align,
                        disabled: Boolean(cfg.disabled)
                    }))
                }, {
                    onRespond: (data) => {
                        const idx = Number(data?.buttonIndex);
                        const btn = buttonsConfig[idx];
                        if (btn && !btn.disabled && typeof btn.action === 'function') {
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
            showVoidGamePopup: (challenge, onRollCallback) => {
                this._setPendingPrompt({
                    kind: 'VOID_GAME',
                    target: Number(challenge?.target) || 7,
                    direction: challenge?.direction === 'down' ? 'down' : 'up'
                }, {
                    onRespond: () => {
                        if (typeof onRollCallback === 'function') onRollCallback();
                    },
                    onCancel: () => {
                        if (typeof onRollCallback === 'function') onRollCallback();
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

        const getOrderInitialMoney = (idx) => {
            if (this.hasCustomUniformMoney) return this.initialMoney;
            return GAME_CONSTANTS.INITIAL_MONEY_BY_ORDER?.[idx] ?? this.initialMoney;
        };

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
                            : (remainingAiPool.shift() || aiPool[Math.floor(Math.random() * aiPool.length)]);
                    }
                    const p = new Player(
                        slot.id || `p_${idx + 1}`,
                        slot.name || `${text.NPC} ${idx + 1}`,
                        slot.color || DEFAULT_PLAYER_COLORS[idx % DEFAULT_PLAYER_COLORS.length],
                        getOrderInitialMoney(idx),
                        idx + 1,
                        resolvedAiType
                    );
                    p.isConnected = slot.type === 'human' ? slot.isConnected !== false : true;
                    return p;
                });
            }
        }

        const usedNames = [text.PLAYER_ME];
        const pickBot = () => {
            const name = pickRandomBotName(usedNames);
            usedNames.push(name);
            return name;
        };

        return [
            new Player('p1', text.PLAYER_ME, '#e74c3c', getOrderInitialMoney(0), 1, null),
            new Player('npc1', pickBot(), '#3498db', getOrderInitialMoney(1), 2, aiPool[0]),
            new Player('npc2', pickBot(), '#f1c40f', getOrderInitialMoney(2), 3, aiPool[1]),
            new Player('npc3', pickBot(), '#9b59b6', getOrderInitialMoney(3), 4, aiPool[2])
        ];
    }

    emitState() {
        if (this.destroyed) return;
        if (this.callbacks.onStateChange) {
            this.callbacks.onStateChange(this);
        }
    }

    _partitionTurnOrderBrackets(brackets, entryById) {
        const nextBrackets = [];
        for (const group of brackets) {
            if (!Array.isArray(group) || group.length <= 1) {
                if (group && group.length === 1) nextBrackets.push([...group]);
                continue;
            }
            const bySum = new Map();
            for (const pid of group) {
                const sum = Number(entryById.get(pid)?.sum) || 0;
                if (!bySum.has(sum)) bySum.set(sum, []);
                bySum.get(sum).push(pid);
            }
            const sums = [...bySum.keys()].sort((a, b) => b - a);
            for (const s of sums) {
                nextBrackets.push(bySum.get(s));
            }
        }
        return nextBrackets;
    }

    _applyFinalTurnOrder(orderedIds) {
        if (!Array.isArray(orderedIds) || orderedIds.length !== this.allPlayers.length) return;
        const byId = new Map(this.allPlayers.map(p => [p.id, p]));
        const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
        if (reordered.length !== this.allPlayers.length) return;

        this.allPlayers = reordered;
        this.allPlayers.forEach((p, idx) => {
            p.playerIndex = idx + 1;
            if (!this.hasCustomUniformMoney) {
                p.money = GAME_CONSTANTS.INITIAL_MONEY_BY_ORDER?.[idx] ?? this.initialMoney;
            }
        });
        this.turnManager = new TurnManager(this.allPlayers);
    }

    _resolveAiTurnOrderSync() {
        const entries = this.allPlayers.map((p, idx) => ({
            id: p.id,
            name: p.name,
            slotIndex: idx,
            d1: 1,
            d2: 1,
            sum: 2,
            rank: null,
            tied: true
        }));
        const byId = new Map(entries.map(e => [e.id, e]));
        let brackets = [entries.map(e => e.id)];
        let round = 0;

        while (brackets.some(g => g.length > 1) && round < 20) {
            round++;
            for (const group of brackets) {
                if (group.length <= 1) continue;
                for (const pid of group) {
                    const entry = byId.get(pid);
                    entry.d1 = Math.floor(Math.random() * 6) + 1;
                    entry.d2 = Math.floor(Math.random() * 6) + 1;
                    entry.sum = entry.d1 + entry.d2;
                }
            }
            brackets = this._partitionTurnOrderBrackets(brackets, byId);
        }

        const orderedIds = [];
        for (const group of brackets) {
            const orderedGroup = group.length > 1
                ? [...group].sort((a, b) => (byId.get(a).slotIndex || 0) - (byId.get(b).slotIndex || 0))
                : group;
            for (const pid of orderedGroup) {
                const entry = byId.get(pid);
                entry.rank = orderedIds.length + 1;
                entry.tied = false;
                orderedIds.push(pid);
            }
        }
        this.turnOrderResult = orderedIds.map(id => ({ ...byId.get(id) }));
        this._applyFinalTurnOrder(orderedIds);
    }

    _startInteractiveTurnOrder() {
        const entries = this.allPlayers.map((p, idx) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            isAi: p.isAi(),
            slotIndex: idx,
            d1: 1,
            d2: 1,
            sum: 0,
            rolled: false,
            rank: null,
            tied: false
        }));
        this._turnOrderBrackets = [this.allPlayers.map(p => p.id)];
        this.turnOrderState = {
            visible: true,
            stage: 'ROLLING',
            round: 1,
            rerollSecondsLeft: 0,
            resultSecondsLeft: 0,
            tieNotice: '',
            players: entries
        };
        this.emitState();

        for (const entry of entries) {
            if (entry.isAi) {
                this.schedule(() => this._rollTurnOrderPlayer(entry.id), 450 + entry.slotIndex * 300);
            }
        }
    }

    _rollTurnOrderPlayer(playerId) {
        if (this.destroyed || !this.turnOrderState || !this.turnOrderState.visible) return false;
        if (this.turnOrderState.stage !== 'ROLLING' && this.turnOrderState.stage !== 'TIE_REROLL') return false;
        const entry = this.turnOrderState.players.find(e => e.id === playerId);
        if (!entry || entry.rolled) return false;

        entry.d1 = Math.floor(Math.random() * 6) + 1;
        entry.d2 = Math.floor(Math.random() * 6) + 1;
        entry.sum = entry.d1 + entry.d2;
        entry.rolled = true;
        this._evaluateTurnOrderRound();
        return true;
    }

    _evaluateTurnOrderRound() {
        if (!this.turnOrderState) return;
        const pending = this.turnOrderState.players.some(e => !e.rolled);
        if (pending) {
            this.emitState();
            return;
        }

        const entryById = new Map(this.turnOrderState.players.map(e => [e.id, e]));
        this._turnOrderBrackets = this._partitionTurnOrderBrackets(this._turnOrderBrackets, entryById);

        let cursor = 0;
        const tiedGroups = [];
        for (const group of this._turnOrderBrackets) {
            if (group.length === 1) {
                const entry = entryById.get(group[0]);
                entry.rank = cursor + 1;
                entry.tied = false;
                cursor += 1;
            } else {
                const startRank = cursor + 1;
                const endRank = cursor + group.length;
                tiedGroups.push(`${startRank}~${endRank}`);
                for (const pid of group) {
                    const entry = entryById.get(pid);
                    entry.rank = null;
                    entry.tied = true;
                }
                cursor += group.length;
            }
        }

        if (tiedGroups.length > 0 && this.turnOrderState.round < 20) {
            const mText = getMarbleText(this.lang);
            this.turnOrderState.stage = 'TIE_REROLL';
            this.turnOrderState.round += 1;
            this.turnOrderState.rerollSecondsLeft = 2;
            this.turnOrderState.tieNotice = `${mText.TURN_ORDER_TIE_NOTICE} (${tiedGroups.join(', ')}${mText.TURN_ORDER_RANK_SUFFIX})`;
            const roundToRun = this.turnOrderState.round;
            for (const entry of this.turnOrderState.players) {
                if (entry.tied) entry.rolled = false;
            }
            this.emitState();
            this.schedule(() => {
                if (this.destroyed || !this.turnOrderState || this.turnOrderState.round !== roundToRun) return;
                if (this.turnOrderState.stage !== 'TIE_REROLL') return;
                this.turnOrderState.rerollSecondsLeft = 1;
                this.emitState();
            }, 1000);
            this.schedule(() => {
                if (this.destroyed || !this.turnOrderState || this.turnOrderState.round !== roundToRun) return;
                if (this.turnOrderState.stage !== 'TIE_REROLL') return;
                this.turnOrderState.rerollSecondsLeft = 0;
                const targets = this.turnOrderState.players.filter(e => e.tied && !e.rolled).map(e => e.id);
                for (const tid of targets) {
                    this._rollTurnOrderPlayer(tid);
                }
            }, 2000);
            return;
        }

        // 모든 동률 해소 또는 안전 상한 도달 시 최종 1~4등 확정 및 5초 결과 팝업 노출
        const finalOrder = [];
        for (const group of this._turnOrderBrackets) {
            const resolved = group.length > 1
                ? [...group].sort((a, b) => (entryById.get(a).slotIndex || 0) - (entryById.get(b).slotIndex || 0))
                : group;
            for (const pid of resolved) {
                const entry = entryById.get(pid);
                entry.rank = finalOrder.length + 1;
                entry.tied = false;
                finalOrder.push(entry);
            }
        }
        this.turnOrderState.players = finalOrder;
        this.turnOrderState.stage = 'RESULT';
        this.turnOrderState.tieNotice = '';
        this.turnOrderState.resultSecondsLeft = 5;
        this.emitState();

        for (let s = 1; s <= 4; s++) {
            this.schedule(() => {
                if (this.destroyed || !this.turnOrderState || this.turnOrderState.stage !== 'RESULT') return;
                this.turnOrderState.resultSecondsLeft = 5 - s;
                this.emitState();
            }, s * 1000);
        }

        this.schedule(() => {
            if (this.destroyed || !this.turnOrderState) return;
            const orderedIds = this.turnOrderState.players
                .slice()
                .sort((a, b) => a.rank - b.rank)
                .map(e => e.id);
            this.turnOrderResult = this.turnOrderState.players.map(e => ({ ...e }));
            this.turnOrderState = null;
            this._turnOrderBrackets = null;
            this._applyFinalTurnOrder(orderedIds);
            this.runSynced(() => this.startTurn());
        }, 5000);
    }

    start() {
        if (this.started || this.destroyed) return;
        this.started = true;
        if (this.skipTurnOrderRoll) {
            this.runSynced(() => this.startTurn());
            return;
        }
        if (this.allPlayers.length > 1 && this.allPlayers.every(p => p.isAi()) && !this.forceInteractiveTurnOrder) {
            this._resolveAiTurnOrderSync();
            this.runSynced(() => this.startTurn());
            return;
        }
        if (this.allPlayers.length > 1) {
            this._startInteractiveTurnOrder();
            return;
        }
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

    _handleHumanTimeout() {
        if (this.isGameOver || this.destroyed) return null;
        const promptOwner = this.pendingPrompt?.targetPlayerId
            ? this.allPlayers.find(p => p.id === this.pendingPrompt.targetPlayerId)
            : null;
        const target = promptOwner || this.turnManager?.getCurrentPlayer();
        if (!target || target.isAi() || target.isBankrupt || target.isKickedForAfk) return null;
        if (target._respondedThisTurn || target._timedOutThisTurn) return null;

        target._timedOutThisTurn = true;
        target.consecutiveTimeouts = (target.consecutiveTimeouts || 0) + 1;

        if (target.consecutiveTimeouts < 3) {
            return null;
        }

        const pickedAi = AIManager.chooseReplacementAiArchetype(target, this.tiles);
        if ((target.afkWarningCount || 0) === 0) {
            // 1차 잠수 판정: 임시 AI 전환 및 복귀 경고 오버레이 노출
            target.afkWarningCount = 1;
            target.isAfkAuto = true;
            target.aiType = pickedAi;
            this.port.showToast(`${target.name} 자리비움 판정 — AI가 임시로 대신 진행합니다.`, 2500);
            return () => {
                if (this.destroyed || this.isGameOver) return;
                if (this.pendingPrompt && this.pendingPrompt.targetPlayerId === target.id) {
                    this.pendingPrompt = null;
                }
                this.emitState();
            };
        }

        // 경고 후 재잠수: 의도적 방해로 간주하여 로비 퇴장 및 영구 AI 대체
        target.isAfkAuto = false;
        target.aiType = pickedAi;
        target.isKickedForAfk = true;
        target.isConnected = false;
        return () => {
            if (this.destroyed || this.isGameOver) return;
            if (this.pendingPrompt && this.pendingPrompt.targetPlayerId === target.id) {
                this.pendingPrompt = null;
            }
            this.port.showToast(`${target.name}님 반복 잠수로 퇴장 — AI가 이어서 플레이합니다.`, 3000);
            this.emitState();
            if (typeof this.callbacks.onPlayerAfkKick === 'function') {
                this.callbacks.onPlayerAfkKick({ playerId: target.id, aiType: pickedAi });
            }
        };
    }

    convertPlayerToAi(playerId) {
        const player = this.allPlayers.find(p => p.id === playerId);
        if (!player || player.isAi() || this.isGameOver || this.destroyed) return false;

        player.aiType = AIManager.chooseReplacementAiArchetype(player, this.tiles);
        player.isAfkAuto = false;
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
        if (action.type === 'TURN_ORDER_ROLL') {
            if (!this.turnOrderState || !this.turnOrderState.visible) {
                return { ok: false, error: 'NO_TURN_ORDER' };
            }
            const targetPlayer = this.allPlayers.find(p => p.id === playerId);
            if (!targetPlayer || targetPlayer.isAi()) {
                return { ok: false, error: 'INVALID_PLAYER' };
            }
            const ok = this._rollTurnOrderPlayer(playerId);
            return ok ? { ok: true } : { ok: false, error: 'ALREADY_ROLLED_OR_FINISHED' };
        }

        if (action.type === 'AFK_RETURN') {
            const target = this.allPlayers.find(p => p.id === playerId);
            if (!target || target.isBankrupt || target.isKickedForAfk || !target.isAfkAuto) {
                return { ok: false, error: 'NOT_IN_AFK_AUTO' };
            }
            return this.runSynced(() => {
                target.isAfkAuto = false;
                target.aiType = null;
                target.consecutiveTimeouts = 0;
                target._timedOutThisTurn = false;
                target._respondedThisTurn = true;
                if (target._aiRollTimerId) {
                    this.clearScheduled(target._aiRollTimerId);
                    target._aiRollTimerId = null;
                }
                this.port.showToast(`${target.name}님이 게임에 복귀했습니다.`, 2000);
                const current = this.turnManager.getCurrentPlayer();
                if (current === target && !this.isRolling && !this.isWaitingAction && !this.pendingPrompt) {
                    this.startPreRollPhase(target);
                    return { ok: true };
                }
                this.emitState();
                return { ok: true };
            });
        }

        const activePlayer = this.turnManager.getCurrentPlayer();
        if (!activePlayer || activePlayer.id !== playerId || activePlayer.isAi()) {
            return { ok: false, error: 'NOT_YOUR_TURN' };
        }

        const markHumanResponded = () => {
            activePlayer._respondedThisTurn = true;
            activePlayer.consecutiveTimeouts = 0;
            activePlayer._timedOutThisTurn = false;
        };

        return this.runSynced(() => {
            if (action.type === 'ROLL_DICE') {
                if (!this.isPreRollPhase || this.isRolling || this.isWaitingAction || this.pendingPrompt) {
                    return { ok: false, error: 'CANNOT_ROLL_NOW' };
                }
                markHumanResponded();
                this.executeRoll();
                return { ok: true };
            }

            if (action.type === 'OPEN_INVENTORY') {
                if (!this.isPreRollPhase || this.isRolling || this.isWaitingAction || this.pendingPrompt) {
                    return { ok: false, error: 'CANNOT_USE_CARD_NOW' };
                }
                markHumanResponded();
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

                markHumanResponded();
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

    _recordRankCheckpoint(phase = 'TURN') {
        const players = this.allPlayers || [];
        if (players.length === 0) return;

        const rankMap = computeTieAwareRanks(players, p => estimatePreSettlementPlayerAsset(p, this.tiles));
        const ranksSnapshot = players.map(p => ({
            playerId: p.id,
            name: p.name,
            rank: rankMap.get(p) ?? players.length,
            estimatedAsset: estimatePreSettlementPlayerAsset(p, this.tiles)
        }));

        if (this._lastPreSettleRanks) {
            const globalTurn = this.turnManager?.globalTurn || 1;
            players.forEach((p, idx) => {
                const prevRank = this._lastPreSettleRanks.get(p.id);
                const nextRank = ranksSnapshot[idx].rank;
                if (typeof prevRank === 'number' && Math.abs(prevRank - nextRank) >= 0.25) {
                    if (p.tracker) p.tracker.rankChangeCount = (p.tracker.rankChangeCount || 0) + 1;
                    this.rankChanges.push({
                        phase,
                        turn: globalTurn,
                        playerId: p.id,
                        fromRank: prevRank,
                        toRank: nextRank
                    });
                }
            });
        }

        const nextMap = new Map();
        ranksSnapshot.forEach(r => nextMap.set(r.playerId, r.rank));
        this._lastPreSettleRanks = nextMap;
        this.rankCheckpoints.push({
            phase,
            turn: this.turnManager?.globalTurn || 1,
            ranks: ranksSnapshot
        });
    }

    finishGame() {
        if (this.isGameOver) return;
        this.isGameOver = true;
        this.pendingPrompt = null;
        this.diceState.visible = false;
        this.diceState.phase = 'HIDE';
        this.turnTimer.stop();
        this._recordRankCheckpoint('FINAL');
        const ranked = processFinalSettlement(this.allPlayers, this.tiles);
        this.settlementResults = serializeSettlementResults(ranked);
        this.lastMatchLogInput = buildMatchLogDataFromEngine(this, ranked);
        this.emitState();
        if (this.callbacks.onEvent) {
            this.callbacks.onEvent({
                type: 'GAME_OVER',
                results: this.settlementResults,
                matchLogData: this.lastMatchLogInput
            });
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

        // 매 턴 시작 시 해당 플레이어의 턴 단위 응답/타임아웃·제단포탈·주사위/더블 상태 초기화
        player._respondedThisTurn = false;
        player._timedOutThisTurn = false;
        player._altarGuaranteedTreasure = false;
        player.hasRufoDiceBuff = false;
        player._turnBaseRollsTaken = 0;
        player._turnDoubleBonusUsed = false;
        player._turnPendingDoubleBonus = false;
        player._nextRollIsDoubleBonus = false;
        player._rufoToastShownThisTurn = false;
        this.totalPlayerTurns++;

        // 플레이어 자신의 턴 시작 시 그을음/빛무리 턴 카운트 차감 및 자연 전환 처리
        WorldGimmickManager.advancePlayerTurn(player, this.turnManager.globalTurn, this.allPlayers, this.tiles);
        const activeGimmickType = WorldGimmickManager.getActiveGimmickType() || 'none';
        if (this.world?.metrics?.gimmickTurnCounts) {
            this.world.metrics.gimmickTurnCounts[activeGimmickType] =
                (this.world.metrics.gimmickTurnCounts[activeGimmickType] || 0) + 1;
        }
        if ((activeGimmickType === 'day' || activeGimmickType === 'night') && this.world?.metrics) {
            const wm = this.world.metrics;
            wm.dayNightActiveTurns[activeGimmickType] = (wm.dayNightActiveTurns[activeGimmickType] || 0) + 1;
            let expectedTurnExtra = 0;
            this.tiles.forEach(tile => {
                if (tile.type === 'normal' && tile.owner && !tile.owner.isBankrupt && tile.owner !== player && tile.timeType === activeGimmickType) {
                    const baseCost = tile.level === 0 ? tile.basePrice : BUILDING_COSTS[tile.side][tile.level - 1];
                    expectedTurnExtra += baseCost * MULTIPLIERS.TIME_MATCH * (1 / 40);
                }
            });
            wm.dayNightExpectedTollSum += expectedTurnExtra;
        }
        this._recordRankCheckpoint('TURN_START');

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
            if (player.tracker) player.tracker.turnStartCrisisCount = (player.tracker.turnStartCrisisCount || 0) + 1;
            const emergencyLoanAmount = Math.round((GAME_CONSTANTS.START_BONUS * this.turnManager.globalTurn) / 10);

            if (player.isAi()) {
                const decision = AIManager.decideTurnStartCrisis(player, this.tiles, emergencyLoanAmount, this.turnManager.globalTurn);
                if (decision.action === 'sell' && decision.tiles && decision.tiles.length > 0) {
                    player.sellProperties(decision.tiles, getTileSellValue);
                    this.port.showToast(`${player.name}${getGimmickText(this.lang).AI_CRISIS_SELL}`, 3200);
                    this.emitState();
                    this.schedule(() => this.processBbangju(player), 1000);
                } else if (decision.action === 'loan' && player.loanCount < GAME_CONSTANTS.LOAN_MAX_COUNT) {
                    executePlayerLoanBorrow(player, emergencyLoanAmount, 'turn_crisis', this.turnManager.globalTurn);
                    this.port.showToast(`${player.name} ${mText.LOAN_EXECUTE}`, 3000);
                    this.emitState();
                    this.schedule(() => this.processBbangju(player), 1000);
                } else {
                    if (player.goBankrupt(this.tiles)) {
                        this.port.showToast(`${player.name} ${mText.BANKRUPT}`, 3600);
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
                    this.port.showToast(`${player.name} ${mText.BANKRUPT}`, 3600);
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
                            executePlayerLoanBorrow(player, emergencyLoanAmount, 'turn_crisis', this.turnManager.globalTurn);
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
        const loanInterestBefore = player.loanInterest || 0;
        player.processTurnInterest(this.turnManager.globalTurn);
        player._lastTurnInterestAccrued = Math.max(0, (player.loanInterest || 0) - loanInterestBefore);
        if (this.tiles[BOARD_TILES.DAYA].owner === player) {
            player.recordDayaHoldTurn(this.turnManager.globalTurn);
        }
        this.emitState();

        if (this.tiles[BOARD_TILES.THEATER].owner === player) {
            const profit = Math.round(GAME_CONSTANTS.THEATER_TURN_PROFIT * getPositiveEffectMultiplier(player));
            player.money += profit;
            if (RequiemState.isHaloState && profit > GAME_CONSTANTS.THEATER_TURN_PROFIT) {
                recordHaloPositiveGain(player, profit - GAME_CONSTANTS.THEATER_TURN_PROFIT);
            }
            player.tracker.theaterProfitCount++;
            this.port.showToast(`${gText.THEATER_PROFIT_TOAST} (+${formatMoney(profit)})`, 2000);
            this.emitState();
        }

        if (player.isBbangjuChief) {
            const chiefCount = Math.max(1, this.allPlayers.filter(p => !p.isBankrupt && p.isBbangjuChief).length);
            const baseAllowance = GAME_CONSTANTS.BBANGJU_TURN_INCOME?.[chiefCount]
                ?? Math.round((GAME_CONSTANTS.BBANGJU_TURN_INCOME?.[1] || 150000) / chiefCount);
            const allowance = Math.round(baseAllowance * getPositiveEffectMultiplier(player));
            player.money += allowance;
            if (RequiemState.isHaloState && allowance > baseAllowance) {
                recordHaloPositiveGain(player, allowance - baseAllowance);
            }
            if (player.tracker) {
                player.tracker.bbangjuChiefAllowanceTotal = (player.tracker.bbangjuChiefAllowanceTotal || 0) + allowance;
            }
            this.port.showToast(`[${player.name}] ${gText.BBANGJU_CHIEF_ALLOWANCE_TOAST || '정비반장 직무 수당 지급'} (+${formatMoney(allowance)})`, 2000);
            this.emitState();
        }

        this.handleTurnLoanRepay(player, () => this.continueTurnAfterLoanRepay(player));
    }

    handleTurnLoanRepay(player, onComplete) {
        if (!player || player.isBankrupt || typeof player.getTotalLoanDebt !== 'function') {
            onComplete();
            return;
        }

        const totalDebt = player.getTotalLoanDebt();
        if (totalDebt <= 0) {
            onComplete();
            return;
        }

        const mText = getMarbleText(this.lang);
        const allOptions = player.getLoanRepayOptions();
        const affordableOptions = allOptions.filter(opt => opt.affordable && opt.amount > 0);
        if (affordableOptions.length === 0) {
            onComplete();
            return;
        }

        const applyRepay = (pctOrMode) => {
            const res = player.repayLoanByPercent(pctOrMode);
            if (res.ok) {
                if (res.fullCleared) {
                    this.port.showToast(`[${player.name}] ${mText.LOAN_REPAY_FULL_TOAST} (${formatMoney(res.paid)})`, 2800);
                } else if (res.convertedInterest > 0) {
                    this.port.showToast(
                        `[${player.name}] ${mText.LOAN_REPAY_TOAST} ${formatMoney(res.paid)} ${mText.LOAN_REPAY_CONVERT_TOAST}`,
                        3200
                    );
                } else {
                    const labelPct = pctOrMode === 'all' ? '100%' : `원금 ${pctOrMode}%`;
                    this.port.showToast(`[${player.name}] ${mText.LOAN_REPAY_TOAST} ${formatMoney(res.paid)} (${labelPct})`, 2600);
                }
                this.emitState();
            }
            return res.ok;
        };

        if (player.isAi()) {
            const chosenPct = AIManager.decideTurnLoanRepay(player, this.tiles, this.turnManager.globalTurn);
            if ((chosenPct === 'all' || chosenPct > 0) && applyRepay(chosenPct)) {
                this.schedule(onComplete, 500);
            } else {
                onComplete();
            }
            return;
        }

        this.isWaitingAction = true;
        this.turnTimer.start(getPlayerThinkTime(player), () => {
            this.port.closeAll();
            this.isWaitingAction = false;
            onComplete();
        });

        const ratePct = Number((((player.getLoanInterestRate ? player.getLoanInterestRate() : GAME_CONSTANTS.LOAN_INTEREST_RATE) || 0) * 100).toFixed(1));
        const principalLine = player.loanPrincipal > 0
            ? `대출 원금: ${formatMoney(player.loanPrincipal)}`
            : `전환 원금(잔여 이자): ${formatMoney(player.loanInterestPrincipal || 0)}`;
        const desc = [
            mText.LOAN_REPAY_DESC,
            '',
            `${principalLine} | 누적 이자: ${formatMoney(Math.round(player.loanInterest || 0))} (이자율 ${ratePct}%)`,
            `총 상환 잔액: ${formatMoney(totalDebt)} | 보유 소지금: ${formatMoney(player.money)}`
        ].join('\n');

        const btnConfigs = allOptions.map(opt => {
            const isAll = opt.mode === 'all' || opt.pct === 'all';
            return {
                row: isAll ? 2 : 1,
                align: isAll ? 'left' : undefined,
                text: isAll
                    ? `${mText.LOAN_REPAY_ALL_BTN}\n(${formatMoney(opt.amount)})`
                    : `원금 ${opt.pct}%\n(${formatMoney(opt.amount)})`,
                color: isAll ? '#16a085' : (opt.pct >= 100 ? '#27ae60' : (opt.pct >= 50 ? '#2980b9' : '#3498db')),
                disabled: !opt.affordable,
                action: () => {
                    this.turnTimer.stop();
                    this.port.closeAll();
                    this.isWaitingAction = false;
                    applyRepay(opt.pct);
                    this.schedule(onComplete, 700);
                }
            };
        });
        btnConfigs.push({
            row: 2,
            align: 'right',
            text: mText.LOAN_REPAY_SKIP_BTN,
            color: '#7f8c8d',
            action: () => {
                this.turnTimer.stop();
                this.port.closeAll();
                this.isWaitingAction = false;
                onComplete();
            }
        });

        this.port.showChoicePopup(mText.LOAN_REPAY_TITLE, desc, btnConfigs);
        this.emitState();
    }

    continueTurnAfterLoanRepay(player) {
        const mText = getMarbleText(this.lang);
        const cText = getCardUIText(this.lang);

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
            if (player._trappedByVoid) {
                this._startVoidEscapeChallenge(player);
                return;
            }
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
        if (this.destroyed || this.isGameOver || this.turnManager.getCurrentPlayer() !== player || !player.isAi()) return;
        const scheduleSafeRoll = (delay) => {
            player._aiRollTimerId = this.schedule(() => {
                player._aiRollTimerId = null;
                if (this.destroyed || this.isGameOver || this.turnManager.getCurrentPlayer() !== player || !player.isAi() || this.isRolling || this.isWaitingAction) {
                    return;
                }
                this.executeRoll();
            }, delay);
        };
        const cardToUse = AIManager.decideUseCard({
            player,
            tiles: this.tiles,
            allPlayers: this.allPlayers,
            turnManager: this.turnManager
        });
        if (cardToUse) {
            const secretAiCards = new Set([
                CARD_IDS.VIP_CARD,
                CARD_IDS.SIST_DEAL,
                CARD_IDS.RUFO_DICE,
                CARD_IDS.SPEC_ERPIN_DICE
            ].filter(Boolean));
            const toastTarget = secretAiCards.has(cardToUse.id) ? player.id : null;
            this.port.showToast(`${player.name} 카드 사용! [${cardToUse.name}]`, 3200, toastTarget);
            useActiveCard(
                this._buildActionContext(player),
                cardToUse,
                (didMoveImmediately) => {
                    if (!didMoveImmediately) {
                        scheduleSafeRoll(2000);
                    }
                },
                () => scheduleSafeRoll(1500)
            );
        } else {
            scheduleSafeRoll(1500);
        }
    }

    _startVoidEscapeChallenge(player) {
        if (this.destroyed || this.isGameOver || !player) return;
        const challenge = {
            target: Math.floor(Math.random() * 10) + 2,
            direction: Math.random() < 0.5 ? 'up' : 'down'
        };
        player._pendingVoidChallenge = challenge;
        this.isWaitingAction = true;

        if (player.isAi()) {
            this.emitState();
            this.schedule(() => {
                if (this.destroyed || this.isGameOver || this.turnManager.getCurrentPlayer() !== player || this.isRolling) {
                    return;
                }
                this._executeVoidChallengeRoll(player, challenge);
            }, 1200);
            return;
        }

        let resolved = false;
        const triggerRoll = () => {
            if (resolved || this.destroyed || this.isGameOver) return;
            resolved = true;
            this.turnTimer.stop();
            this.pendingPrompt = null;
            this.port.closeAll();
            this._executeVoidChallengeRoll(player, challenge);
        };

        this.port.showVoidGamePopup(challenge, triggerRoll);
        this.emitState();
        this.turnTimer.start(getPlayerThinkTime(player), triggerRoll);
    }

    _executeVoidChallengeRoll(player, challenge) {
        if (this.destroyed || this.isGameOver || !player || this.isRolling) return;
        this.isWaitingAction = false;
        this.isPreRollPhase = false;
        this.isRolling = true;
        this.turnTimer.stop();

        const mText = getMarbleText(this.lang);
        const cText = getCardUIText(this.lang);
        const baseDiceCount = getPlayerDiceCount(player, { ignoreRufo: true });
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = baseDiceCount >= 2 ? (Math.floor(Math.random() * 6) + 1) : 0;
        const finalSum = d1 + d2;
        const targetNum = Number(challenge?.target) || 7;
        const isUp = challenge?.direction !== 'down';
        const dirLabel = isUp ? (cText.SHAYDI_GAME_UP || '업') : (cText.SHAYDI_GAME_DOWN || '다운');
        const escaped = isUp ? (finalSum > targetNum) : (finalSum < targetNum);

        this.diceState = {
            visible: true,
            title: `${cText.SHAYDI_GAME_TITLE || '셰이디의 장난'} (${targetNum} ${dirLabel})`,
            d1,
            d2,
            d3: 0,
            diceCount: baseDiceCount,
            useRufo: false,
            useErpin: false,
            phase: 'SPINNING'
        };
        this.emitState();
        if (this.callbacks.onEvent) {
            this.callbacks.onEvent({ type: 'DICE_ROLL', ...this.diceState, playerId: player.id });
        }

        this.schedule(() => {
            if (this.destroyed || this.isGameOver) return;
            this.diceState = {
                visible: true,
                title: `${mText.RESULT} ${finalSum} (${targetNum} ${dirLabel})`,
                d1,
                d2,
                d3: 0,
                diceCount: baseDiceCount,
                useRufo: false,
                useErpin: false,
                phase: 'LANDED'
            };

            if (player.tracker) {
                player.tracker.totalRolls = (player.tracker.totalRolls || 0) + 1;
                if (baseDiceCount >= 2 && d1 === d2) {
                    player.tracker.doublesRolled = (player.tracker.doublesRolled || 0) + 1;
                }
            }

            const wm = this.world?.metrics;
            if (wm) {
                wm.voidChallengeCount = (wm.voidChallengeCount || 0) + 1;
            }

            player.restTurns = Math.max(0, (Number(player.restTurns) || 1) - 1);
            if (player.restTurns <= 0) {
                player._trappedByVoid = false;
            }
            player._pendingVoidChallenge = null;

            if (escaped) {
                if (wm) wm.voidEscapeSuccessCount = (wm.voidEscapeSuccessCount || 0) + 1;
                if (player.tracker) player.tracker.voidEscapeSuccessCount = (player.tracker.voidEscapeSuccessCount || 0) + 1;

                this.port.showToast(`[${player.name}] ${cText.SHAYDI_ESCAPE_SUCCESS || '셰이디의 장난 돌파! 차원에서 즉시 탈출해 이동합니다!'}`, 3200);
                player._rollingMoveInProgress = true;
                if (player.tracker) {
                    player.tracker.totalMovedSpaces = (player.tracker.totalMovedSpaces || 0) + finalSum;
                }
                if (player.move(finalSum)) {
                    applyLapPassBonus(player, {
                        label: mText.TOAST_START,
                        showBlockedToast: true
                    });
                }
                this.emitState();

                this.schedule(() => {
                    if (this.destroyed || this.isGameOver) return;
                    this.diceState.visible = false;
                    this.diceState.phase = 'HIDE';
                    this.handleTileArrival(player);
                }, 1300);
                return;
            }

            if (wm) {
                wm.voidEscapeFailCount = (wm.voidEscapeFailCount || 0) + 1;
                const lapLoss = Math.round((7 / 40) * getStartPassBonus(player));
                const interestLoss = Math.max(0, Number(player._lastTurnInterestAccrued) || 0);
                const turnSkipLoss = lapLoss + interestLoss;
                wm.voidLapLossTotal = (wm.voidLapLossTotal || 0) + lapLoss;
                wm.voidUpkeepLossTotal = (wm.voidUpkeepLossTotal || 0) + interestLoss;
                wm.voidDamageTotal = (wm.voidDamageTotal || 0) + turnSkipLoss;
                if (player.tracker) {
                    player.tracker.voidEscapeFailCount = (player.tracker.voidEscapeFailCount || 0) + 1;
                    player.tracker.voidDamageTotal = (player.tracker.voidDamageTotal || 0) + turnSkipLoss;
                }
            } else if (player.tracker) {
                player.tracker.voidEscapeFailCount = (player.tracker.voidEscapeFailCount || 0) + 1;
            }

            player.bowExtraRollAvailable = false;
            player.timeAccelExtraRollAvailable = false;
            this.port.showToast(`[${player.name}] ${cText.SHAYDI_ESCAPE_FAIL || '탈출 실패! 이번 턴은 휴식합니다.'}`, 2800);
            this.emitState();

            this.schedule(() => {
                if (this.destroyed || this.isGameOver) return;
                this.isRolling = false;
                this.diceState.visible = false;
                this.diceState.phase = 'HIDE';
                this.proceedEndTurn();
            }, 1500);
        }, 800);
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
        const canContinueExtraRoll = Boolean(
            currentPlayer &&
            !currentPlayer.isBankrupt &&
            currentPlayer.islandTurns === 0 &&
            currentPlayer.restTurns === 0
        );
        if (canContinueExtraRoll) {
            const cText = getCardUIText(this.lang);
            if (currentPlayer._turnPendingDoubleBonus) {
                currentPlayer._turnPendingDoubleBonus = false;
                currentPlayer._nextRollIsDoubleBonus = true;
                if (currentPlayer.tracker) {
                    currentPlayer.tracker.doubleBonusRolls = (currentPlayer.tracker.doubleBonusRolls || 0) + 1;
                }
                this.port.showToast(`[${currentPlayer.name}] ${cText.DOUBLE_BONUS_ROLL}`, 3200);
                this.emitState();
                this.schedule(() => this.startPreRollPhase(currentPlayer), 1000);
                return;
            }

            const maxBaseRolls = Math.max(
                1,
                currentPlayer.bowExtraRollAvailable ? 2 : 1,
                currentPlayer.timeAccelExtraRollAvailable ? 2 : 1
            );
            if ((currentPlayer._turnBaseRollsTaken || 0) < maxBaseRolls) {
                currentPlayer._nextRollIsDoubleBonus = false;
                if (currentPlayer.bowExtraRollAvailable) {
                    currentPlayer.bowExtraRollAvailable = false;
                    this.port.showToast(`[${currentPlayer.name}] ${cText.TREASURE_BOW_EXTRA_ROLL}`, 3200);
                } else {
                    currentPlayer.timeAccelExtraRollAvailable = false;
                    this.port.showToast(`[${currentPlayer.name}] ${cText.SPEC_TIME_ACCEL_EXTRA_ROLL}`, 3200);
                }
                this.emitState();
                this.schedule(() => this.startPreRollPhase(currentPlayer), 1000);
                return;
            }
        }

        // 턴 완전 종료 시 그 턴 한정 주사위·추가 굴림 상태 정리
        if (currentPlayer) {
            currentPlayer.hasRufoDiceBuff = false;
            currentPlayer.bowExtraRollAvailable = false;
            currentPlayer.timeAccelExtraRollAvailable = false;
            currentPlayer._turnBaseRollsTaken = 0;
            currentPlayer._turnDoubleBonusUsed = false;
            currentPlayer._turnPendingDoubleBonus = false;
            currentPlayer._nextRollIsDoubleBonus = false;
            currentPlayer._rufoToastShownThisTurn = false;
        }

        const aliveCount = this.allPlayers.filter(p => !p.isBankrupt).length;
        if (aliveCount === 0) {
            this.finishGame();
            return;
        }

        this._recordRankCheckpoint('TURN_END');
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

        // 현재 주사위 분포 기반 동적 기댓값 누적 (제단/차원 도착, 정령산 추가 통행료, [205] 마르코프 회복 확률)
        const wm = this.world?.metrics;
        if (wm && player.restTurns <= 0) {
            const d3Offset = useRufo ? 6 : 0;
            const outcomes = [];
            if (baseDiceCount >= 2) {
                const weights = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
                for (let i = 0; i < weights.length; i++) {
                    outcomes.push({ steps: 2 + i + d3Offset, prob: weights[i] / 36 });
                }
            } else {
                for (let s = 1; s <= 6; s++) {
                    outcomes.push({ steps: s + d3Offset, prob: 1 / 6 });
                }
            }

            let pMountain = 0;
            for (const { steps, prob } of outcomes) {
                const destId = (player.pos + steps) % 40;
                if (destId === BOARD_TILES.ALTAR) wm.altarExpectedVisits = (wm.altarExpectedVisits || 0) + prob;
                if (destId === BOARD_TILES.VOID) wm.voidExpectedVisits = (wm.voidExpectedVisits || 0) + prob;
                if (destId === BOARD_TILES.MOUNTAIN) pMountain += prob;

                const destTile = this.tiles[destId];
                if (destTile && destTile.owner && destTile.owner !== player && destTile.owner.hasMountainBuff) {
                    const bd = calculateTollBreakdown(destTile, player, this.world);
                    if (bd.mountainExtra > 0) {
                        wm.mountainExpectedGainSum = (wm.mountainExpectedGainSum || 0) + (prob * bd.mountainExtra);
                    }
                }
            }

            const forgetArr = player.buffs?.['hold_forget'] || player.buffs?.['todo_hold_forget'];
            if (forgetArr && forgetArr.length > 0 && !player.hasRecoveredMemory && pMountain > 0) {
                const surv = player._forgetSurvProb ?? 1.0;
                wm.forgottenExpectedProbSum = (wm.forgottenExpectedProbSum || 0) + (surv * pMountain);
                player._forgetSurvProb = surv * (1 - pMountain);
            }
        }
        player._rollingMoveInProgress = true;

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
            useErpin: Boolean(useErpin),
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
                    useErpin: Boolean(useErpin),
                    phase: 'LANDED'
                };

                const isDoubleRoll = isDiceRollDouble(d1, d2, d3, baseDiceCount, useRufo);
                const isDoubleBonusRoll = Boolean(player._nextRollIsDoubleBonus);
                player._nextRollIsDoubleBonus = false;
                if (!isDoubleBonusRoll) {
                    player._turnBaseRollsTaken = (player._turnBaseRollsTaken || 0) + 1;
                }

                if (player.tracker) {
                    player.tracker.totalRolls = (player.tracker.totalRolls || 0) + 1;
                    if (isDoubleRoll) {
                        player.tracker.doublesRolled = (player.tracker.doublesRolled || 0) + 1;
                    }
                }

                if (useRufo && !player._rufoToastShownThisTurn) {
                    player._rufoToastShownThisTurn = true;
                    this.port.showToast(`[${player.name}] ${cText.RUFO_DICE_USE}`, 3200);
                }
                if (useErpin) {
                    player.hasErpinDiceBuff = false;
                }

                let escapedVolcanica = false;
                if (player.islandTurns > 0) {
                    if (isDoubleRoll) {
                        player.islandTurns = 0;
                        escapedVolcanica = true;
                        this.port.showToast(`[${player.name}] ${mText.TOAST_ESCAPE_SUCCESS}`, 3200);
                    } else {
                        player.islandTurns--;
                        player.bowExtraRollAvailable = false;
                        player.timeAccelExtraRollAvailable = false;
                        player._turnPendingDoubleBonus = false;
                        this.port.showToast(`[${player.name}] ${mText.TOAST_ESCAPE_FAIL}`, 3200);
                        this.emitState();
                        this.schedule(() => {
                            this.diceState.visible = false;
                            this.diceState.phase = 'HIDE';
                            this.proceedEndTurn();
                        }, 1500);
                        return;
                    }
                }

                // 일반 턴 굴림(볼케니카 탈출 제외)에서 더블이 나왔고 이번 턴 더블 보너스를 아직 미사용했다면 1회 추가 굴림 부여
                if (isDoubleRoll && !escapedVolcanica && !player._turnDoubleBonusUsed) {
                    player._turnDoubleBonusUsed = true;
                    player._turnPendingDoubleBonus = true;
                } else {
                    player._turnPendingDoubleBonus = false;
                }

                if (player.tracker) {
                    player.tracker.totalMovedSpaces = (player.tracker.totalMovedSpaces || 0) + finalSum;
                }
                if (player.move(finalSum)) {
                    applyLapPassBonus(player, {
                        label: mText.TOAST_START,
                        showBlockedToast: true
                    });
                }
                this.emitState();

                this.schedule(() => {
                    this.diceState.visible = false;
                    this.diceState.phase = 'HIDE';
                    this.handleTileArrival(player);
                }, 1300);
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
                        useErpin: Boolean(useErpin),
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
        const viaRoll = Boolean(player._rollingMoveInProgress);
        player._rollingMoveInProgress = false;
        if (!viaRoll && tile) {
            const wm = this.world?.metrics;
            if (wm) {
                if (tile.id === BOARD_TILES.VOID) {
                    wm.voidCardArrivals = (wm.voidCardArrivals || 0) + 1;
                    wm.voidExpectedCardVisits = (wm.voidExpectedCardVisits || 0) + 1;
                } else if (tile.id === BOARD_TILES.ALTAR) {
                    wm.altarCardArrivals = (wm.altarCardArrivals || 0) + 1;
                } else if (tile.id === BOARD_TILES.MOUNTAIN && !player.hasRecoveredMemory) {
                    const forgetArr = player.buffs?.['hold_forget'] || player.buffs?.['todo_hold_forget'];
                    if (forgetArr && forgetArr.length > 0) {
                        const surv = player._forgetSurvProb ?? 1.0;
                        wm.forgottenExpectedProbSum = (wm.forgottenExpectedProbSum || 0) + surv;
                        player._forgetSurvProb = 0;
                    }
                }
            }
        }
        if (player.tracker && tile.type !== 'normal' && tile.type !== 'card') {
            player.tracker.specialTileVisits = (player.tracker.specialTileVisits || 0) + 1;
        }
        const mText = getMarbleText(this.lang);
        const cText = getCardUIText(this.lang);
        const gText = getGimmickText(this.lang);

        const minBuyCost = calculatePurchaseCost(tile, 0, player);
        if (!tile.owner && tile.basePrice > 0 && player.money < minBuyCost) {
            this.port.showToast(mText.TOAST_NO_MONEY_BUY, 2800, player.id);
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
                    this.port.showToast(cText.TREASURE_BOW_VILLAGE_FAIL, 3000, player.id);
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
                                this.port.showToast(`${player.name}${gText.AI_USE_SIST_DEAL}`, 3200);
                            }
                            this._buyTerritoryWithMetrics(player, tile, targetLevel, finalCost, useSist);
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
                            this._buyTerritoryWithMetrics(player, tile, lvl, Math.round(targetCost * 0.5), true);
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
                                        this._buyTerritoryWithMetrics(player, tile, lvl, Math.round(targetCost * 0.5), true);
                                        this.port.closeAll();
                                        this.proceedEndTurn();
                                    }
                                },
                                {
                                    text: mText.BTN_HOLD,
                                    color: '#7f8c8d',
                                    action: () => {
                                        this._buyTerritoryWithMetrics(player, tile, lvl, targetCost, false);
                                        this.port.closeAll();
                                        this.proceedEndTurn();
                                    }
                                }
                            ]);
                        } else {
                            this._buyTerritoryWithMetrics(player, tile, lvl, targetCost, false);
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

    _buyTerritoryWithMetrics(player, tile, level, finalCost, usedSist = false) {
        const bought = player.buyProperty(tile, level, finalCost);
        if (!bought) return false;
        const wm = this.world?.metrics;
        if (wm && RequiemState.isSootState && !player.isReincarnated) {
            const noSootRawCost = calculatePurchaseCost(tile, level, player, { ignoreSoot: true });
            const noSootFinal = usedSist ? Math.round(noSootRawCost * 0.5) : noSootRawCost;
            const saved = Math.max(0, noSootFinal - finalCost);
            if (saved > 0) {
                wm.sootDiscountSavedTotal = (wm.sootDiscountSavedTotal || 0) + saved;
                const entry = ensureSootPnlEntry(wm, player);
                if (entry) entry.cash += saved;
            }
        }
        return true;
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
        const viewerPlayer = viewerId ? this.allPlayers.find(p => p.id === viewerId) : null;

        return {
            roomId: this.roomId,
            phase: this.isGameOver
                ? 'GAME_OVER'
                : (this.turnOrderState?.visible
                    ? 'TURN_ORDER'
                    : (this.isRolling ? 'ROLLING' : (this.isWaitingAction ? 'WAITING_ACTION' : 'PRE_ROLL'))),
            activePlayerId: activeId,
            canAct,
            hasUsableCards,
            afkAutoAlert: Boolean(viewerPlayer && viewerPlayer.isAfkAuto && !viewerPlayer.isKickedForAfk),
            afkWarningCount: viewerPlayer ? (viewerPlayer.afkWarningCount || 0) : 0,
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
                isAfkAuto: Boolean(p.isAfkAuto),
                isConnected: p.isConnected !== false,
                isBbangjuChief: Boolean(p.isBbangjuChief),
                isReincarnated: Boolean(p.isReincarnated),
                hasKarmaState: Boolean(p.hasKarmaState),
                hasRegretState: Boolean(p.hasRegretState),
                hasWishState: Boolean(p.hasWishState),
                hasDreamState: Boolean(p.hasDreamState),
                hasMountainBuff: Boolean(p.hasMountainBuff),
                hasRufoDiceBuff: (viewerId === p.id || this.isGameOver) ? Boolean(p.hasRufoDiceBuff) : false,
                hasErpinDiceBuff: (viewerId === p.id || this.isGameOver) ? Boolean(p.hasErpinDiceBuff) : false,
                hasSistDiscountBuff: (viewerId === p.id || this.isGameOver) ? Boolean(p.hasSistDiscountBuff) : false,
                hasVipShield: (viewerId === p.id || this.isGameOver) ? Boolean(p.hasVipShield) : false,
                bowExtraRollAvailable: Boolean(p.bowExtraRollAvailable),
                timeAccelExtraRollAvailable: Boolean(p.timeAccelExtraRollAvailable),
                hasOriginElif: Boolean(p.hasOriginElif),
                hasPiraCard: p.hasPiraLoanBuff ? p.hasPiraLoanBuff() : Boolean(p.hasPiraCard),
                loanCount: p.loanCount,
                loanPrincipal: p.getTotalPrincipalBalance ? p.getTotalPrincipalBalance() : ((p.loanPrincipal || 0) + (p.loanInterestPrincipal || 0)),
                loanInterest: Math.round(p.loanInterest || 0),
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
            turnOrderState: this.turnOrderState
                ? {
                    ...this.turnOrderState,
                    players: this.turnOrderState.players.map(e => ({ ...e }))
                }
                : null,
            pendingPrompt: publicPrompt,
            waitingFor,
            settlementResults: this.isGameOver ? this.settlementResults : null
        };
    }
}
