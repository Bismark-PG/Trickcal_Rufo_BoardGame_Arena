// ProgramFiles/Game/Unos/UnosCard.js
// 우노스(UNOS) 56장 덱 생성/셔플, 초기 7+7장(4+4+3+3) 분배, 중앙 비특수 카드 보장,
// 묘지 재충전 드로우, 카드 제출 가능 판정 및 '콤보' 최대 1회 연쇄(3번째 콤보 비활성화) 로직

import {
    UNOS_DECK_TEMPLATES,
    UNOS_CARD_KINDS,
    UNOS_PERSONALITY_KEYS,
    getUnosDict
} from '../../System/Index/Unos/UnosCardIndex.js';

export function shuffleCards(cards, rng = Math.random) {
    const arr = [...cards];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * 56장 표준 우노스 덱 인스턴스 생성
 */
export function createUnosDeck(rng = Math.random) {
    const rawDeck = UNOS_DECK_TEMPLATES.map((tpl, idx) => ({
        id: `unos_card_${idx + 1}_${tpl.templateId}`,
        seq: tpl.seq,
        templateId: tpl.templateId,
        category: tpl.category,
        kind: tpl.kind,
        color: tpl.color,
        paletteKey: tpl.paletteKey,
        value: tpl.value,
        symbol: tpl.symbol,
        isWild: tpl.isWild,
        isInitialCenterAllowed: tpl.isInitialCenterAllowed
    }));
    return shuffleCards(rawDeck, rng);
}

/**
 * 선/후공 추첨 전용 숫자 카드(0~9, 4색 × 10장 = 40장) 풀 생성 및 셔플
 */
export function createTurnOrderNumberPool(rng = Math.random) {
    const numberTemplates = UNOS_DECK_TEMPLATES.filter(t => t.kind === UNOS_CARD_KINDS.NUMBER);
    const pool = numberTemplates.map((tpl, idx) => ({
        id: `turn_order_card_${idx + 1}_${tpl.templateId}`,
        seq: tpl.seq,
        templateId: tpl.templateId,
        category: tpl.category,
        kind: tpl.kind,
        color: tpl.color,
        paletteKey: tpl.paletteKey,
        value: tpl.value,
        symbol: tpl.symbol,
        isWild: false,
        isInitialCenterAllowed: true
    }));
    return shuffleCards(pool, rng);
}

/**
 * 중앙 초기 공개용으로 허용되는 카드인지 판정 (4대 성격 색상 카드만 허용; 리버스/공명/우울 제외)
 */
export function isAllowedInitialCenterCard(card) {
    if (!card) return false;
    if (card.kind === UNOS_CARD_KINDS.REVERSE
        || card.kind === UNOS_CARD_KINDS.RESONANCE
        || card.kind === UNOS_CARD_KINDS.DEPRESSION) {
        return false;
    }
    return Boolean(card.color && UNOS_PERSONALITY_KEYS.includes(card.color));
}

/**
 * 초기 세팅:
 * 1) 선공 4장 -> 후공 4장 -> 선공 3장 -> 후공 3장 (양측 7장) 분배
 * 2) 중앙 더미 1장 공개 (무속성/특수 카드가 나오면 4대 성격 카드가 나올 때까지 뽑은 뒤,
 *    그전에 뽑힌 특수 카드들은 모두 덱으로 되돌리고 1회 셔플)
 */
export function setupInitialUnosDeckAndHands(initialDeck = null, rng = Math.random) {
    let deck = Array.isArray(initialDeck) ? [...initialDeck] : createUnosDeck(rng);

    const firstHand = [];
    const secondHand = [];

    // 선공 4장
    for (let i = 0; i < 4 && deck.length > 0; i++) firstHand.push(deck.shift());
    // 후공 4장
    for (let i = 0; i < 4 && deck.length > 0; i++) secondHand.push(deck.shift());
    // 선공 3장
    for (let i = 0; i < 3 && deck.length > 0; i++) firstHand.push(deck.shift());
    // 후공 3장
    for (let i = 0; i < 3 && deck.length > 0; i++) secondHand.push(deck.shift());

    // 중앙 더미 첫 카드 뽑기 (비특수 보장)
    const setAsideSpecials = [];
    let centerCard = null;

    while (deck.length > 0) {
        const candidate = deck.shift();
        if (isAllowedInitialCenterCard(candidate)) {
            centerCard = candidate;
            break;
        }
        setAsideSpecials.push(candidate);
    }

    if (setAsideSpecials.length > 0) {
        deck.push(...setAsideSpecials);
        deck = shuffleCards(deck, rng);
    }

    const discardPile = centerCard ? [centerCard] : [];
    const initialMatchColor = centerCard?.color || UNOS_PERSONALITY_KEYS[0];

    return {
        deck,
        discardPile,
        centerCard,
        firstHand,
        secondHand,
        initialMatchColor
    };
}

/**
 * 덱에서 count장 드로우 (덱 고갈 시 중앙 최상단 1장을 제외한 묘지를 셔플해 보충)
 */
export function drawFromUnosDeck(deck, discardPile, count = 1, rng = Math.random) {
    const drawn = [];
    const targetCount = Math.max(0, Number(count) || 0);
    let reshuffledCount = 0;

    for (let i = 0; i < targetCount; i++) {
        if (deck.length === 0) {
            if (Array.isArray(discardPile) && discardPile.length > 1) {
                const topCard = discardPile[discardPile.length - 1];
                const graveyard = discardPile.splice(0, discardPile.length - 1);
                const recycled = shuffleCards(graveyard, rng);
                deck.push(...recycled);
                discardPile[0] = topCard;
                reshuffledCount += recycled.length;
            }
        }
        if (deck.length === 0) break;
        drawn.push(deck.shift());
    }

    return {
        drawn,
        reshuffledCount
    };
}

/**
 * 단일 카드의 제출 가능 여부 및 비활성 사유 판정
 * @param {object} card
 * @param {{
 *   isMyTurn?: boolean,
 *   phase?: string,
 *   matchColor?: string,
 *   topCard?: object | null,
 *   actionChainStep?: number,
 *   lang?: string
 * }} context
 */
export function evaluateUnosCardPlayability(card, context = {}) {
    const lang = context.lang || 'ko';
    const dict = getUnosDict(lang);

    if (!card) {
        return { playable: false, disabledReason: 'INVALID_CARD', disabledMessage: '' };
    }

    const isMyTurn = context.isMyTurn !== false;
    const phase = context.phase || 'CARD_PHASE';
    const actionChainStep = Number(context.actionChainStep || 0);

    if (!isMyTurn) {
        return {
            playable: false,
            disabledReason: 'NOT_YOUR_TURN',
            disabledMessage: dict.NOT_YOUR_TURN_MSG
        };
    }

    if (phase !== 'CARD_PHASE' && phase !== 'DRAWN_CARD_PROMPT') {
        return {
            playable: false,
            disabledReason: 'WRONG_PHASE',
            disabledMessage: dict.CHESS_PHASE_CARD_LOCKED_MSG
        };
    }

    // 콤보 카드 1회 연쇄 후 3번째 카드 제출 단계(actionChainStep >= 2):
    // 3번째 카드로 다시 '콤보'를 내는 것은 엄격히 금지
    if (actionChainStep >= 2) {
        if (card.kind === UNOS_CARD_KINDS.ACTION) {
            return {
                playable: false,
                disabledReason: 'ACTION_CHAIN_LIMIT',
                disabledMessage: dict.ACTION_CHAIN_LIMIT_MSG // "더 이상 이 카드를 낼 수 없습니다!"
            };
        }
        return {
            playable: true,
            disabledReason: null,
            disabledMessage: null
        };
    }

    // 1번째 '콤보' 제출 직후 2번째 카드 자유 제출 단계(actionChainStep === 1):
    // 색상/숫자 조건 없이 모든 카드(2번째 '콤보' 포함) 자유 제출 허용
    if (actionChainStep === 1) {
        return {
            playable: true,
            disabledReason: null,
            disabledMessage: null
        };
    }

    // 기본 제출 단계(actionChainStep === 0):
    // 1) 무속성/특수 카드(리버스, 공명, 우울)는 색상/숫자 제약 없이 언제든 제출 가능
    if (card.isWild
        || card.kind === UNOS_CARD_KINDS.REVERSE
        || card.kind === UNOS_CARD_KINDS.RESONANCE
        || card.kind === UNOS_CARD_KINDS.DEPRESSION) {
        return {
            playable: true,
            disabledReason: null,
            disabledMessage: null
        };
    }

    // 2) 현재 중앙 활성 색상(matchColor) 일치
    const matchColor = context.matchColor || null;
    if (matchColor && card.color === matchColor) {
        return {
            playable: true,
            disabledReason: null,
            disabledMessage: null
        };
    }

    // 3) 중앙 최상단 카드(topCard)와 숫자 또는 기호(스킵/액션) 일치
    const topCard = context.topCard || null;
    if (topCard) {
        if (card.kind === UNOS_CARD_KINDS.NUMBER
            && topCard.kind === UNOS_CARD_KINDS.NUMBER
            && card.value === topCard.value) {
            return {
                playable: true,
                disabledReason: null,
                disabledMessage: null
            };
        }
        if ((card.kind === UNOS_CARD_KINDS.SKIP || card.kind === UNOS_CARD_KINDS.ACTION)
            && topCard.kind === card.kind) {
            return {
                playable: true,
                disabledReason: null,
                disabledMessage: null
            };
        }
    }

    return {
        playable: false,
        disabledReason: 'COLOR_OR_SYMBOL_MISMATCH',
        disabledMessage: dict.CARD_NOT_MATCHED_MSG
    };
}

/**
 * 손패 배열 전체에 playable, disabledReason, disabledMessage 메타 부착
 */
export function annotateUnosHand(hand, context = {}) {
    if (!Array.isArray(hand)) return [];
    return hand.map(card => {
        const check = evaluateUnosCardPlayability(card, context);
        return {
            ...card,
            playable: check.playable,
            disabledReason: check.disabledReason,
            disabledMessage: check.disabledMessage
        };
    });
}
