import { GAME_CONSTANTS } from '../System/Index/Marble/MarblePriceIndex.js';
import { BOARD_TILES } from '../System/Index/Marble/MarbleBoardIndex.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';
import { RuntimePopup, getCardUIText } from './MarbleRuntime.js';
import { processTreasureTurnStart } from './MarbleCardTreasure.js';
import { WorldGimmickManager } from './MarbleWorldGimmick.js';

export class Player {
    constructor(id, name, color, initialMoney, index, aiType = null) {
        this.id = id; this.name = name; this.color = color; this.money = initialMoney;
        this.playerIndex = index; this.territoryCount = 0; this.pos = 0; 

        // 빵주 시스템
        this.isBbangjuChief = false;      // 정비반장 여부
        this.bbangjuSupportTurns = 0;     // 납부해야 할 턴 수
        this.bbangjuPaidTotal = 0;        // 누적 납부액 (거절 시 -1 저장)
        
        this.islandTurns = 0; this.restTurns = 0; this.hasMountainBuff = false;
        
        // 대출 및 자산 상태
        this.isBankrupt = false; 
        this.loanCount = 0;      
        this.loanPrincipal = 0; 
        this.loanInterest = 0;  
        
        this.aiType = aiType; this.marathonSkipNext = false;
        this.inventory = []; this.buffs = {};

        // 망가진 제단 및 보물/특수 카드 시스템
        this.hasVisitedAltar = false;      // 11번(제단) 방문 여부 (이후부터 보물 등장)
        this.treasureCards = [];           // 현재 보유 중인 보물 카드 배열
        this.firstTreasureTurn = -1;       // 보물의 저주에 가장 먼저 노출된 턴 기록용
        this.hasRufoDiceBuff = false;      // 루포 주사위
        this.hasErpinDiceBuff = false;     // 에르핀 주사위
        this.hasLibraryBuff = false;       // 마녀 도서관 카드 3장 중 1장 선택 능력 (1회권)
        this.hasVipShield = false;         // VIP카드 통행료 1회 면제 활성화 플래그
        this.hasSistDiscountBuff = false;  // 시스트의 거래 0.5배 할인 활성화 플래그
        this.nextCardDoubleDraw = false;   // 밑장빼기(101) 다음 카드 2장 뽑기 플래그
        this.hasRecoveredMemory = false;   // 잊혀진 기억(205) -> 되찾은 기억 변화 여부
        this.hasOriginElif = false;        // 태초의 엘리프(206) 정령산 효과 영구 고정 여부
        this.bowExtraRollAvailable = false;// ???의 활(502) 이번 턴 주사위 추가 굴림 가능 여부
        this.timeAccelBuffPhase = 'none';  // 시간가속(110) 주사위 2회 굴림 버프가 유지되는 시간대 ('day' | 'night' | 'none')
        this.timeAccelExtraRollAvailable = false; // 시간가속(110) 이번 턴 주사위 추가 굴림 가능 여부
        this.isReincarnated = false;       // 그을음: 윤회 상태
        this.hasKarmaState = false;        // 빛무리: 죄업 상태 (카드 강제 종료 시)
        this.hasRegretState = false;       // 빛무리: 후회 상태 (자연 종료 시)
        this.hasDreamState = false;        // 몽환살이(113) 상태
        this.hasWishState = false;         // 염원살이(114) 상태
        this.lastMountainTurnCounted = -1; // 정령산 정상 효과 턴 중복 카운트 방지용
        this.lastDayaTurnCounted = -1;     // 다야의 궁전 보유 턴 중복 카운트 방지용

        // 정산 기믹용 통계 추적기
        this.tracker = {
            theaterProfitCount: 0,
            monatium25Visits: 0,
            lakeRestCount: 0,
            furryBeachVisits: 0,
            cardsDrawn: 0,
            moonHillVisits: 0,
            mountainBuffTurns: 0,
            dayaHoldTurns: 0,
            bbangjuUsageCount: 0
        };
    }

    recordMountainBuffTurn(globalTurn = null) {
        if (typeof globalTurn === 'number' && globalTurn > 0) {
            if (this.lastMountainTurnCounted !== globalTurn) {
                this.lastMountainTurnCounted = globalTurn;
                this.tracker.mountainBuffTurns++;
            }
        } else {
            this.tracker.mountainBuffTurns++;
        }
    }

    recordDayaHoldTurn(globalTurn = null) {
        if (typeof globalTurn === 'number' && globalTurn > 0) {
            if (this.lastDayaTurnCounted !== globalTurn) {
                this.lastDayaTurnCounted = globalTurn;
                this.tracker.dayaHoldTurns++;
            }
        } else {
            this.tracker.dayaHoldTurns++;
        }
    }

    isAi() { return this.aiType !== null; }
    move(spaces) {
        const oldPos = this.pos; this.pos = (this.pos + spaces) % 40;
        return (oldPos + spaces) >= 40; 
    }
    buyProperty(tile, targetLevel, cost) {
        if (this.money >= cost) {
            this.money -= cost;
            const isNewOwnership = tile.owner !== this;
            if (isNewOwnership) {
                if (tile.owner && tile.type === 'normal') tile.owner.territoryCount--;
                tile.owner = this;
                if (tile.type === 'normal') this.territoryCount++;

                // 이면세계(35) 보유 중 신규 영토 획득 시 해당 영토 시간대 역전
                if (this.buffs['hold_reverse'] && this.buffs['hold_reverse'].length > 0) {
                    if (tile.timeType === 'day') tile.timeType = 'night';
                    else if (tile.timeType === 'night') tile.timeType = 'day';
                }

                // 다야의 궁전 소유자가 되면 '서열 2위의 특권(32)' 즉시 파괴 (기획서 33p)
                if (tile.id === BOARD_TILES.DAYA && this.buffs['hold_immune']) {
                    const idx = this.buffs['hold_immune'].findIndex(c => c.id === CARD_IDS.RANK_2_PRIVILEGE);
                    if (idx > -1) {
                        this.buffs['hold_immune'].splice(idx, 1);
                        RuntimePopup.showToast(getCardUIText().CARD_DESTROYED_RANK2, 2500);
                    }
                }
            }
            tile.level = targetLevel; return true;
        }
        return false;
    }
    payMoney(amount, recipient = null) {
        let actualPaid = 0;
        if (this.money >= amount) {
            this.money -= amount; actualPaid = amount;
        } else {
            actualPaid = this.money; this.money = 0;
        }
        if (recipient && actualPaid > 0) recipient.money += actualPaid;
        return actualPaid;
    }
    processTurnInterest(globalTurn = null) {
        // 1. 대출 이자(5%) 부과
        if (this.loanPrincipal > 0) this.loanInterest += (this.loanPrincipal * GAME_CONSTANTS.LOAN_INTEREST_RATE);

        // 2. 보물 카드 매 턴 시작 효과 (왕관 +15만, 지팡이 -15만 부작용, 활 2회 굴림 초기화)
        processTreasureTurnStart(this);

        // 3. 정령산 정상 수업료 및 태초의 엘리프 / 잊혀진 기억 처리
        if (this.hasOriginElif) {
            this.hasMountainBuff = true;
            this.recordMountainBuffTurn(globalTurn);
        } else if (this.buffs['hold_forget'] && this.buffs['hold_forget'].length > 0) {
            this.hasMountainBuff = false;
        } else if (this.hasMountainBuff) {
            if (this.money >= GAME_CONSTANTS.MOUNTAIN_FEE) {
                this.money -= GAME_CONSTANTS.MOUNTAIN_FEE;
                this.recordMountainBuffTurn(globalTurn);
            } else {
                this.hasMountainBuff = false;
            }
        }

        // 4. 폭동(22) / 축제개최(23) 통행료 증감 버프 잔여 턴 차감
        const tollBuffKey = this.buffs['buff_toll'] ? 'buff_toll' : (this.buffs['todo_buff_toll'] ? 'todo_buff_toll' : null);
        if (tollBuffKey && Array.isArray(this.buffs[tollBuffKey])) {
            this.buffs[tollBuffKey].forEach(b => {
                if (typeof b.remainingTurns === 'number') b.remainingTurns--;
            });
            this.buffs[tollBuffKey] = this.buffs[tollBuffKey].filter(b => typeof b.remainingTurns !== 'number' || b.remainingTurns > 0);
        }

        // 5. [110: 시간가속] 현재 시간대가 유지되는 동안 매 턴 주사위 2번 굴림(추가 1회 굴림) 활성화
        if (this.timeAccelBuffPhase !== 'none') {
            const activeGimmick = WorldGimmickManager.getActiveGimmickType();
            if (activeGimmick === this.timeAccelBuffPhase) {
                this.timeAccelExtraRollAvailable = true;
            } else {
                this.timeAccelBuffPhase = 'none';
                this.timeAccelExtraRollAvailable = false;
            }
        }
    }
    sellProperties(tilesToSell, getSellValueFunc) {
        let earned = 0;
        tilesToSell.forEach(tile => {
            earned += getSellValueFunc(tile); tile.owner = null; tile.level = -1; this.territoryCount--;
        });
        this.money += earned; return earned;
    }
    goBankrupt(allTiles) {
        // [106: 두번째 기회] 보유 시 파산 대신 지원금 지급 후 카드 즉시 파괴 (기획서 34p)
        // 단, 영토를 보유한 상태의 파산일 경우 150만 달러만 지급, 보유 영토가 없을 경우 300만 달러 지급
        const secondChanceArr = this.buffs['hold_second_chance'] || this.buffs['todo_hold_second_chance'];
        if (secondChanceArr && secondChanceArr.length > 0) {
            secondChanceArr.shift();
            const hasOwnedTerritory = allTiles
                ? allTiles.some(t => t.owner === this && t.type === 'normal')
                : this.territoryCount > 0;
            const reviveAmount = hasOwnedTerritory ? 1500000 : 3000000;
            this.money += reviveAmount;
            this.isBankrupt = false;
            const cText = getCardUIText();
            RuntimePopup.showToast(hasOwnedTerritory ? cText.SECOND_CHANCE_HALF_USED : cText.SECOND_CHANCE_USED, 3000);
            return false;
        }

        this.isBankrupt = true; this.money = 0;
        allTiles.filter(t => t.owner === this).forEach(tile => { tile.owner = null; tile.level = -1; });
        this.territoryCount = 0;
        return true;
    }
    decidePurchase(tile, calcCosts) {
        if (this.aiType === 'aggressive') {
            const targetLevel = tile.level < 2 ? 2 : (tile.level === 2 ? 3 : 4);
            return (this.money >= calcCosts[targetLevel]) ? targetLevel : -1;
        } else if (this.aiType === 'defensive') {
            if (tile.level >= 1) return -1;
            return (this.money >= calcCosts[1]) ? 1 : -1;
        } else if (this.aiType === 'marathon') {
            if (this.marathonSkipNext) { this.marathonSkipNext = false; return -1; }
            if (tile.level >= 2) return -1;
            if (this.money >= calcCosts[2]) { this.marathonSkipNext = true; return 2; }
            return -1;
        }
        return -1;
    }
    decidePortalDestination(tiles) {
        if (this.money < GAME_CONSTANTS.PORTAL_FEE) return -1;
        if (this.aiType === 'aggressive') {
            for (let i = 39; i >= 0; i--) { if (tiles[i].type === 'normal' && !tiles[i].owner && this.money >= GAME_CONSTANTS.PORTAL_FEE + 1200000) return i; }
            return -1; 
        } else if (this.aiType === 'defensive') {
            let bestDest = -1; let maxDist = -1;
            for (let i = 0; i < 40; i++) {
                if (tiles[i].owner === this && (i < this.pos || i === 0)) {
                    let dist = (i - this.pos + 40) % 40;
                    if (dist > maxDist) { maxDist = dist; bestDest = i; }
                }
            }
            return bestDest !== -1 ? bestDest : 0; 
        } else if (this.aiType === 'marathon') return 10; 
        return -1;
    }
}
