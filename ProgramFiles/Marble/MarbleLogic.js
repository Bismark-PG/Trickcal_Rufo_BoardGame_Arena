import { Player } from './MarblePlayer.js';
import { TimeSlotSystem } from './MarbleTimeSlot.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';
import { LangState } from '../System/LanguageManager.js';
import { BOARD_TILES, BoardNames, SPECIAL_TERRITORY_IDS, getBoardTileType } from '../System/Index/Marble/MarbleBoardIndex.js';
import { TILE_BASE_PRICES, BUILDING_COSTS, MULTIPLIERS, GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { getTreasurePurchaseMultiplier, getTreasureTollMultiplierDelta } from './MarbleCardTreasure.js';
import { getRequiemPurchaseMultiplier, getRequiemTollPayerDelta } from './MarbleRequiem.js';

const U = 1080 / 13; 

export function generateTiles() {
    const tiles = [];
    for (let side = 0; side < 4; side++) {
        for (let i = 0; i < 10; i++) {
            let cx = 0, cy = 0;
            if (i === 0) {
                if (side === 0) { cx = U; cy = 12 * U; } else if (side === 1) { cx = U; cy = U; } else if (side === 2) { cx = 12 * U; cy = U; } else if (side === 3) { cx = 12 * U; cy = 12 * U; }
            } else {
                if (side === 0) { cx = U; cy = 11 * U - (i - 0.5) * U; } else if (side === 1) { cx = 2 * U + (i - 0.5) * U; cy = U; } else if (side === 2) { cx = 12 * U; cy = 2 * U + (i - 0.5) * U; } else if (side === 3) { cx = 11 * U - (i - 0.5) * U; cy = 12 * U; }
            }
            const globalId = side * 10 + i;
            const tileType = getBoardTileType(globalId);
            const tileName = BoardNames[globalId][LangState.current] || BoardNames[globalId].ko;
            const isSpecialToll = SPECIAL_TERRITORY_IDS.includes(globalId);
            tiles.push({ id: globalId, type: tileType, name: tileName, side: side, x: cx, y: cy, owner: null, level: -1, basePrice: TILE_BASE_PRICES[globalId], isSpecialToll: isSpecialToll });
        }
    }
    TimeSlotSystem.initTiles(tiles); return tiles;
}

export function calculatePurchaseCost(tile, targetLevel, player = null, options = {}) {
    if (targetLevel < 0 || targetLevel > 4) return 0;
    let rawCost = 0;
    if (tile.level === -1) {
        rawCost = targetLevel === 0 ? tile.basePrice : tile.basePrice + BUILDING_COSTS[tile.side][targetLevel - 1];
    } else if (tile.level === 0 || targetLevel === 4) {
        rawCost = BUILDING_COSTS[tile.side][targetLevel - 1];
    } else {
        rawCost = BUILDING_COSTS[tile.side][targetLevel - 1] * 0.5;
    }

    // [503: ???가 담긴 검] 버프 적용 시 영토 매입비 및 건설비 0.8배 하락
    const treasureMult = player ? getTreasurePurchaseMultiplier(player) : 1.0;
    // [그을음] 상태 적용 시 매입/건설비 0.5배 감소 (윤회 보유자는 제외)
    const requiemMult = options.ignoreSoot ? 1.0 : getRequiemPurchaseMultiplier(player);
    return Math.round(rawCost * treasureMult * requiemMult);
}

export function calculateTollBreakdown(tile, payer) {
    const empty = {
        total: 0,
        totalNoHalo: 0,
        mountainExtra: 0,
        dayNightExtra: 0,
        dayNightPhase: null,
        sootExtra: 0,
        haloPayerDelta: 0
    };
    if (!tile || tile.level < 0) return empty;

    if (tile.id === BOARD_TILES.THEATER) return empty;
    if (tile.id === BOARD_TILES.MONATIUM_25) {
        let baseToll = GAME_CONSTANTS.TOLL_MONATIUM_0;
        if (tile.level === 1) baseToll = GAME_CONSTANTS.TOLL_MONATIUM_1;
        if (tile.level === 2) baseToll = GAME_CONSTANTS.TOLL_MONATIUM_2;
        return { ...empty, total: applySpecialTileTollModifiers(baseToll, tile, payer) };
    }
    if (tile.id === BOARD_TILES.LAKE) return { ...empty, total: applySpecialTileTollModifiers(GAME_CONSTANTS.TOLL_LAKE, tile, payer) };
    if (tile.id === BOARD_TILES.LIBRARY) return { ...empty, total: applySpecialTileTollModifiers(GAME_CONSTANTS.TOLL_LIBRARY, tile, payer) };
    if (tile.id === BOARD_TILES.DAYA) return { ...empty, total: applySpecialTileTollModifiers(GAME_CONSTANTS.TOLL_DAYA, tile, payer) };

    let baseCost = tile.level === 0 ? tile.basePrice : BUILDING_COSTS[tile.side][tile.level - 1];
    let finalMultiplier = 0;

    if (tile.level >= 0 && tile.level <= 4) finalMultiplier += MULTIPLIERS.BUILDING[tile.level];
    if (tile.isSpecialToll) finalMultiplier += MULTIPLIERS.SPECIAL_TILE;

    const mountainDelta = (tile.owner && tile.owner.hasMountainBuff) ? MULTIPLIERS.MOUNTAIN_BUFF : 0;
    finalMultiplier += mountainDelta;

    const timeDelta = WorldGimmickManager.getGimmickMultiplier(tile);
    const activeTimePhase = timeDelta > 0 ? WorldGimmickManager.currentTime : null;
    finalMultiplier += timeDelta;

    // 폭동(22) / 축제개최(23) 통행료 배율 증감
    if (tile.owner && tile.owner.buffs) {
        const tollBuffs = [
            ...(tile.owner.buffs['buff_toll'] || []),
            ...(tile.owner.buffs['todo_buff_toll'] || [])
        ];
        tollBuffs.forEach(b => {
            if (b.multiplier > 1) finalMultiplier += (b.multiplier - 1.0);
            else finalMultiplier -= (1.0 - b.multiplier);
        });
    }

    // VVVIP카드(107) 보유 시 지불 통행료 0.8배 감소 (-0.2)
    if (payer && payer.buffs && ((payer.buffs['hold_vvvip'] && payer.buffs['hold_vvvip'].length > 0) || (payer.buffs['todo_hold_vvvip'] && payer.buffs['todo_hold_vvvip'].length > 0))) {
        finalMultiplier -= 0.2;
    }

    // 보물 카드 부작용 증감 (밧줄(505): 소유자 통행료 -0.2 / 수의(504): 지불자 통행료 +0.2, 상쇄 보물 보유 시 미적용)
    finalMultiplier += getTreasureTollMultiplierDelta(tile, payer);

    // 그을음(+0.5) 및 윤회(+0.3), 빛무리 죄업(-0.5) / 후회(+0.5) 지불 통행료 배율 합산(가감)
    const requiemDelta = getRequiemTollPayerDelta(tile, payer);
    finalMultiplier += requiemDelta;

    if (finalMultiplier < 0) finalMultiplier = 0;
    const total = Math.round(baseCost * finalMultiplier);

    const mountainExtra = mountainDelta > 0
        ? Math.max(0, total - Math.round(baseCost * Math.max(0, finalMultiplier - mountainDelta)))
        : 0;
    const dayNightExtra = timeDelta > 0
        ? Math.max(0, total - Math.round(baseCost * Math.max(0, finalMultiplier - timeDelta)))
        : 0;
    const sootDelta = (WorldGimmickManager.getActiveGimmickType() === 'soot' && requiemDelta > 0) ? requiemDelta : 0;
    const sootExtra = sootDelta > 0
        ? Math.max(0, total - Math.round(baseCost * Math.max(0, finalMultiplier - sootDelta)))
        : 0;
    const haloPayerDelta = WorldGimmickManager.getActiveGimmickType() === 'halo' ? requiemDelta : 0;
    const totalNoHalo = haloPayerDelta !== 0
        ? Math.round(baseCost * Math.max(0, finalMultiplier - haloPayerDelta))
        : total;

    return {
        total,
        totalNoHalo,
        mountainExtra,
        dayNightExtra,
        dayNightPhase: activeTimePhase,
        sootExtra,
        haloPayerDelta
    };
}

export function calculateToll(tile, payer) {
    return calculateTollBreakdown(tile, payer).total;
}

export function applySpecialTileTollModifiers(baseToll, tile, payer) {
    let mult = 1.0;
    // 구매 가능 특수 칸은 VVVIP카드(107) 0.8배 감소만 적용되며, 그 외 일반/특수 영토 통행료 증감은 미적용
    if (payer && payer.buffs && ((payer.buffs['hold_vvvip'] && payer.buffs['hold_vvvip'].length > 0) || (payer.buffs['todo_hold_vvvip'] && payer.buffs['todo_hold_vvvip'].length > 0))) {
        mult -= 0.2;
    }
    if (mult < 0) mult = 0;
    return Math.round(baseToll * mult);
}

export function getTileSellValue(tile) {
    if (tile.level < 0) return 0;
    const totalInvested = tile.level === 0 ? tile.basePrice : tile.basePrice + BUILDING_COSTS[tile.side][tile.level - 1];
    return totalInvested * MULTIPLIERS.SELL_RETURN;
}

export class TurnManager {
    constructor(players) { this.players = players; this.turnIndex = 0; this.globalTurn = 1; }
    getCurrentPlayer() { return this.players[this.turnIndex]; }
    nextTurn() { 
        do {
            this.turnIndex = (this.turnIndex + 1) % this.players.length;
            if (this.turnIndex === 0) { this.globalTurn++; WorldGimmickManager.updateTurn(this.globalTurn); }
        } while (this.players[this.turnIndex].isBankrupt); 
    }
    rollDice() { return [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1]; }
}

export class TimerManager {
    constructor(onTick, defaultOnTimeout) {
        this.timeLeft = 0; this.intervalId = null; this.onTick = onTick; 
        this.defaultOnTimeout = defaultOnTimeout; this.currentOnTimeout = defaultOnTimeout; 
    }
    start(seconds, customTimeout = null) {
        this.stop(); this.currentOnTimeout = customTimeout || this.defaultOnTimeout; this.timeLeft = seconds; this.onTick(this.timeLeft);
        this.intervalId = setInterval(() => {
            this.timeLeft--; this.onTick(this.timeLeft);
            if (this.timeLeft <= 0) { this.stop(); this.currentOnTimeout(); }
        }, 1000);
    }
    stop() { if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; } }
}
