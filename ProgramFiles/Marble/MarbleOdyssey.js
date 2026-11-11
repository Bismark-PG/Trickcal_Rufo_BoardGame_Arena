import {
    RuntimePopup,
    getActiveWorld,
    getCardUIText
} from './MarbleRuntime.js';
import { RequiemState, checkAndTriggerClimax } from './MarbleRequiem.js';
import { CARD_IDS } from '../System/Index/Marble/MarbleCardIndex.js';

// 보물 카드 확률 테이블 [일반%, 특수%, 보물%] - 인덱스 = 가진 보물 개수 (기획서 38p)
const PROB_TABLE = [
    [90.25, 4.75, 5.0],  // 0장 소유 시 (보물 5%)
    [85.50, 4.50, 10.0], // 1장 소유 시 (보물 10%)
    [76.00, 4.00, 20.0], // 2장 소유 시 (보물 20%)
    [57.00, 3.00, 40.0], // 3장 소유 시 (보물 40%)
    [19.00, 1.00, 80.0], // 4장 소유 시 (보물 80%)
    [0.0,   0.0,  100.0] // 5장 소유 시 (5장 보유시 다음 카드는 무조건 보물카드)
];

export function getDrawnTreasures() {
    return getActiveWorld().globalDrawnTreasures;
}

export function getAltarTradedCards() {
    return getActiveWorld().altarTradedCards;
}

export function resetOdysseyState() {
    const world = getActiveWorld();
    world.globalDrawnTreasures.clear();
    world.altarTradedCards.length = 0;
}

export const OdysseyManager = {
    // 카드를 뽑을 때, 상황에 맞는 덱과 확률을 적용해 1장 반환
    drawDynamicCard(player, fullDeck, currentTurn, excludeIds = new Set()) {
        // 그을음이 한 번이라도 발동된 후이거나, 아직 제단을 밟은 적이 없으면 일반(95%)/특수(5%) 고정 룰 (기획서 38p)
        if (RequiemState.hasSootEverTriggered || RequiemState.isSootState || !player.hasVisitedAltar) {
            const rand = Math.random() * 100;
            return this._getRandomCardByType(player, fullDeck, rand < 95 ? "normal" : "special", excludeIds);
        }

        // 제단을 밟았다면 글로벌 누적 보물 등장 횟수(최대 5)에 비례한 확률 적용 (제단 교환 시에도 감소하지 않음)
        const drawnTreasures = getDrawnTreasures();
        const tCount = Math.min(drawnTreasures.size, 5);
        const probs = PROB_TABLE[tCount];
        const rand = Math.random() * 100;

        let targetType = "";
        if (rand < probs[0]) targetType = "normal";
        else if (rand < probs[0] + probs[1]) targetType = "special";
        else targetType = "treasure";

        // 만약 보물을 줘야하는데 이미 6장이 다 나왔다면 일반 카드로 대체
        if (targetType === "treasure") {
            const availableTreasures = fullDeck.filter(c => c.id > 500 && !drawnTreasures.has(c.id) && !excludeIds.has(c.id));
            if (availableTreasures.length === 0) targetType = "normal";
        }

        return this._getRandomCardByType(player, fullDeck, targetType, excludeIds);
    },

    // 마녀 도서관 능력 등 여러 장을 중복 없이 뽑아야 할 때 반환
    drawMultipleCards(player, fullDeck, currentTurn, count = 3) {
        const picked = [];
        const excludeIds = new Set();
        for (let i = 0; i < count; i++) {
            const card = this.drawDynamicCard(player, fullDeck, currentTurn, excludeIds);
            if (card) {
                picked.push(card);
                excludeIds.add(card.id);
            }
        }
        return picked;
    },

    // 내부 헬퍼: 덱에서 분류해 뽑아주기
    _getRandomCardByType(player, deck, typeKeyword, excludeIds = new Set()) {
        const drawnTreasures = getDrawnTreasures();
        let pool = [];
        if (typeKeyword === "normal") {
            pool = deck.filter(c => c.id < 100 && !excludeIds.has(c.id));
        } else if (typeKeyword === "special") {
            pool = deck.filter(c => c.id >= 100 && c.id < 500 && !excludeIds.has(c.id));

            // 기획서 38p: 그을음 상태일 때 윤회 미보유자가 특수 카드를 뽑게 된 경우 50% 확률로 '심판의 시간' 또는 '교주의 염원' 등장
            if (RequiemState.isSootState && player && !player.isReincarnated) {
                const sootSpecialCards = pool.filter(c => c.id === CARD_IDS.SPEC_JUDGMENT || c.id === CARD_IDS.SPEC_CULT_WISH);
                if (sootSpecialCards.length > 0 && Math.random() < 0.5) {
                    return sootSpecialCards[Math.floor(Math.random() * sootSpecialCards.length)];
                }
            }
        } else if (typeKeyword === "treasure") {
            pool = deck.filter(c => c.id >= 500 && !drawnTreasures.has(c.id) && !excludeIds.has(c.id));
        }

        // 특수 카드나 보물 카드를 더 이상 뽑을 수 없다면 일반 카드만 등장 (기획서 38p)
        if (pool.length === 0) {
            pool = deck.filter(c => c.id < 100 && !excludeIds.has(c.id));
        }
        if (pool.length === 0) {
            pool = deck.filter(c => c.id < 100);
        }
        return pool[Math.floor(Math.random() * pool.length)];
    },

    // 플레이어가 보물을 얻었을 때 처리하는 로직
    acquireTreasure(ctx, card) {
        const { player, turnManager } = ctx;
        getDrawnTreasures().add(card.id);
        player.treasureCards.push({
            ...card,
            remainingUses: typeof card.maxUses === 'number' ? card.maxUses : 0
        });

        if (player.firstTreasureTurn === -1 && turnManager) {
            player.firstTreasureTurn = turnManager.globalTurn;
        }

        const cText = getCardUIText();
        RuntimePopup.showToast(`[${card.name}] ${cText.TREASURE_OBTAIN}`, 3000);

        checkAndTriggerClimax(ctx);
    }
};
