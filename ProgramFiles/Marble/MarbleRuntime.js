// ProgramFiles/Marble/MarbleRuntime.js
// 서버/클라이언트 공용 순수 런타임 계층:
// 1) 멀티 룸 동시 실행을 위한 게임별 격리 월드 상태(WorldState) 스코프 관리
// 2) DOM/PopupManager 직접 의존을 제거한 UI·타이머 포트(RuntimePort) 브리지
// 3) Node.js 서버 및 브라우저 공용 안전 다국어 조회/포맷 헬퍼

import { LangState } from '../System/LanguageManager.js';
import { BOARD_TILES, BoardNames, BbangjuWorkshopName } from '../System/Index/Marble/MarbleBoardIndex.js';
import { MarbleLang } from '../System/Index/Marble/MarbleUIIndex.js';
import { CardUILang } from '../System/Index/Marble/MarbleCardUIIndex.js';
import { GimmickLang } from '../System/Index/Marble/MarbleGimmickIndex.js';
import { SettlementLang } from '../System/Index/Marble/MarbleSettlementIndex.js';
import { CardIndex } from '../System/Index/Marble/MarbleCardIndex.js';

export function pickLangDict(langMap, lang = LangState.current) {
    if (!langMap) return {};
    const candidate = langMap[lang];
    if (candidate && (Array.isArray(candidate) ? candidate.length > 0 : Object.keys(candidate).length > 0)) {
        return candidate;
    }
    return langMap.ko || {};
}

export function getMarbleText(lang = LangState.current) {
    return pickLangDict(MarbleLang, lang);
}

export function getCardUIText(lang = LangState.current) {
    return pickLangDict(CardUILang, lang);
}

export function getGimmickText(lang = LangState.current) {
    return pickLangDict(GimmickLang, lang);
}

export function getSettlementText(lang = LangState.current) {
    return pickLangDict(SettlementLang, lang);
}

export function getCardDeck(lang = LangState.current) {
    return pickLangDict(CardIndex, lang);
}

export function createMarbleWorldState() {
    return {
        currentTurn: 1,
        maxTurn: 20,
        currentTime: 'none',
        timeSlot: {
            currentPhase: 'none',
            remainingTurns: 0,
            hasDayFinished: false,
            hasNightFinished: false
        },
        bbangjuState: 'recruiting',
        bbangjuChiefs: [],
        globalBbangjuVisits: 0,
        isFurryBeach: false,
        furryBeachFeeMultiplier: 1.0,
        requiem: {
            hasSootEverTriggered: false,
            isSootState: false,
            isHaloState: false,
            sootRemainingTurns: 0,
            haloRemainingTurns: 0,
            haloTriggeredByCard: false,
            gimmickAnchorPlayerIndex: 1,
            gimmickTriggeredGlobalTurn: 0,
            justTriggeredThisTurn: false,
            reincarnatedPlayer: null
        },
        usedCardIds: new Set(),
        globalDrawnTreasures: new Set(),
        altarTradedCards: []
    };
}

function createNoopPort() {
    return {
        showToast() {},
        closeAll() {},
        showChoicePopup() {},
        showNormalPopup() {},
        showBuyPopup() {},
        showCrisisPopup() {},
        showSellPopup() {},
        showInventoryPopup() {},
        showTargetPopup() {},
        showPortalPopup() {},
        schedule(fn, delay) {
            return setTimeout(fn, delay);
        },
        clearScheduled(id) {
            clearTimeout(id);
        }
    };
}

const defaultWorld = createMarbleWorldState();
const defaultPort = createNoopPort();
const scopeStack = [];

export function pushMarbleScope(world, port = defaultPort) {
    scopeStack.push({
        world: world || defaultWorld,
        port: port || defaultPort
    });
}

export function popMarbleScope() {
    if (scopeStack.length > 0) {
        scopeStack.pop();
    }
}

export function runWithMarbleScope(world, port, fn) {
    pushMarbleScope(world, port);
    try {
        return fn();
    } finally {
        popMarbleScope();
    }
}

export function getActiveWorld() {
    if (scopeStack.length > 0) {
        return scopeStack[scopeStack.length - 1].world;
    }
    return defaultWorld;
}

export function getRuntimePort() {
    if (scopeStack.length > 0) {
        return scopeStack[scopeStack.length - 1].port;
    }
    return defaultPort;
}

export function formatMoney(amount, lang = LangState.current) {
    const mText = getMarbleText(lang);
    return `${Number(amount || 0).toLocaleString()}${mText.CURRENCY}`;
}

export function getTileName(tile, worldState = null, lang = LangState.current) {
    const world = worldState || getActiveWorld();
    if (tile.id === BOARD_TILES.BBANGJU && (world?.currentTurn ?? 1) < 4) {
        return BbangjuWorkshopName[lang] || BbangjuWorkshopName.ko;
    }
    const names = BoardNames[tile.id];
    if (!names) return String(tile.id);
    return names[lang] || names.ko;
}

export function scheduleGameTask(fn, delay) {
    return getRuntimePort().schedule(fn, delay);
}

export const RuntimePopup = {
    showToast(msg, duration = 2000) {
        getRuntimePort().showToast(msg, duration);
    },
    closeAll() {
        getRuntimePort().closeAll();
    },
    showChoicePopup(title, desc, buttonsConfig) {
        getRuntimePort().showChoicePopup(title, desc, buttonsConfig);
    },
    showNormalPopup(title, desc, showCloseBtn, onEndCallback) {
        getRuntimePort().showNormalPopup(title, desc, showCloseBtn, onEndCallback);
    },
    showBuyPopup(tile, costs, playerMoney, onBuyCallback, onCancelCallback) {
        getRuntimePort().showBuyPopup(tile, costs, playerMoney, onBuyCallback, onCancelCallback);
    },
    showCrisisPopup(toll, canSellCover, onSell, onLoan) {
        getRuntimePort().showCrisisPopup(toll, canSellCover, onSell, onLoan);
    },
    showSellPopup(ownedTiles, requiredAmount, getSellValueFunc, onConfirm, onCancel) {
        getRuntimePort().showSellPopup(ownedTiles, requiredAmount, getSellValueFunc, onConfirm, onCancel);
    },
    showInventoryPopup(inventory, onUseCallback, onCancelCallback) {
        getRuntimePort().showInventoryPopup(inventory, onUseCallback, onCancelCallback);
    },
    showTargetPopup(title, desc, targets, onSelectCallback, onCancelCallback) {
        getRuntimePort().showTargetPopup(title, desc, targets, onSelectCallback, onCancelCallback);
    },
    showPortalPopup(tiles, onSelectCallback, onCancelCallback, reqFee = 0, isFree = false) {
        getRuntimePort().showPortalPopup(tiles, onSelectCallback, onCancelCallback, reqFee, isFree);
    }
};
