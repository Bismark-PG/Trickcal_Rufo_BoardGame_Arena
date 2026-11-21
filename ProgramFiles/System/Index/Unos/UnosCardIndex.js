// ProgramFiles/System/Index/Unos/UnosCardIndex.js
// 우노스(UNOS) 56장 카드 정의, 4대 성격·특수 색상 팔레트 및 다국어(ko/en/ja) 인덱스

export const UNOS_PERSONALITY_KEYS = ['madness', 'calm', 'pure', 'lively'];

export const UNOS_COLOR_PALETTE = {
    madness: {
        key: 'madness',
        hex: '#e74c3c',
        bgLight: '#fdecea',
        bgTile: '#d9483b',
        bgTileAlt: '#c43c30',
        border: '#ff8a80',
        text: '#ffffff',
        accent: '#ff5252',
        icon: '🔥'
    },
    calm: {
        key: 'calm',
        hex: '#3498db',
        bgLight: '#eaf4fc',
        bgTile: '#2d83c4',
        bgTileAlt: '#2472ad',
        border: '#82b1ff',
        text: '#ffffff',
        accent: '#40c4ff',
        icon: '💧'
    },
    pure: {
        key: 'pure',
        hex: '#2ecc71',
        bgLight: '#eafaf1',
        bgTile: '#27ae60',
        bgTileAlt: '#219a52',
        border: '#b9f6ca',
        text: '#ffffff',
        accent: '#69f0ae',
        icon: '🌿'
    },
    lively: {
        key: 'lively',
        hex: '#f1c40f',
        bgLight: '#fef9e7',
        bgTile: '#d9ad0b',
        bgTileAlt: '#c29908',
        border: '#ffe57f',
        text: '#2c2200',
        accent: '#ffd740',
        icon: '⚡'
    },
    reverse: {
        key: 'reverse',
        hex: '#bdc3c7',
        bgLight: '#f4f6f6',
        bgTile: '#95a5a6',
        bgTileAlt: '#7f8c8d',
        border: '#ecf0f1',
        text: '#2c3e50',
        accent: '#dfe6e9',
        icon: '🔄'
    },
    resonance: {
        key: 'resonance',
        hex: '#ff7eb3',
        gradient: 'linear-gradient(135deg, #e74c3c 0%, #f1c40f 33%, #2ecc71 66%, #3498db 100%)',
        bgLight: '#fff0f7',
        bgTile: '#8e44ad',
        bgTileAlt: '#732d91',
        border: '#ffffff',
        text: '#ffffff',
        accent: '#ffd740',
        icon: '🌈'
    },
    depression: {
        key: 'depression',
        hex: '#9b59b6',
        bgLight: '#f5eef8',
        bgTile: '#8e44ad',
        bgTileAlt: '#6c3483',
        border: '#e1bee7',
        text: '#ffffff',
        accent: '#ce93d8',
        icon: '🌑'
    }
};

export const UNOS_CARD_KINDS = {
    NUMBER: 'number',
    SKIP: 'skip',
    ACTION: 'action',
    REVERSE: 'reverse',
    RESONANCE: 'resonance',
    DEPRESSION: 'depression'
};

export const UNOS_CARD_CATEGORIES = {
    NUMBER: 'number',
    ACTION: 'action',
    SPECIAL: 'special'
};

/**
 * 56장 표준 우노스 덱 템플릿 생성
 * - 숫자(0~9): 4색 × 10장 = 40장
 * - 스킵(skip): 4색 × 1장 = 4장
 * - 액션(action): 4색 × 1장 = 4장
 * - 리버스(reverse): 무속성 × 2장 = 2장
 * - 공명(resonance): 무지개 × 4장 = 4장
 * - 우울(depression): 보라 × 2장 = 2장
 */
function buildUnosDeckTemplates() {
    const templates = [];
    let seq = 1;

    // 1. 숫자 카드 40장 (4색 × 0~9)
    for (const color of UNOS_PERSONALITY_KEYS) {
        for (let num = 0; num <= 9; num++) {
            templates.push({
                seq: seq++,
                templateId: `${color}_${num}`,
                category: UNOS_CARD_CATEGORIES.NUMBER,
                kind: UNOS_CARD_KINDS.NUMBER,
                color,
                paletteKey: color,
                value: num,
                symbol: String(num),
                isWild: false,
                isInitialCenterAllowed: true
            });
        }
    }

    // 2. 스킵 카드 4장 (4색 × 1장)
    for (const color of UNOS_PERSONALITY_KEYS) {
        templates.push({
            seq: seq++,
            templateId: `${color}_skip`,
            category: UNOS_CARD_CATEGORIES.ACTION,
            kind: UNOS_CARD_KINDS.SKIP,
            color,
            paletteKey: color,
            value: 'skip',
            symbol: '🚫',
            isWild: false,
            isInitialCenterAllowed: true
        });
    }

    // 3. 액션 카드 4장 (4색 × 1장)
    for (const color of UNOS_PERSONALITY_KEYS) {
        templates.push({
            seq: seq++,
            templateId: `${color}_action`,
            category: UNOS_CARD_CATEGORIES.ACTION,
            kind: UNOS_CARD_KINDS.ACTION,
            color,
            paletteKey: color,
            value: 'action',
            symbol: '⚡+1',
            isWild: false,
            isInitialCenterAllowed: true
        });
    }

    // 4. 리버스 카드 2장 (무속성 라이트그레이)
    for (let i = 1; i <= 2; i++) {
        templates.push({
            seq: seq++,
            templateId: `reverse_${i}`,
            category: UNOS_CARD_CATEGORIES.ACTION,
            kind: UNOS_CARD_KINDS.REVERSE,
            color: null,
            paletteKey: 'reverse',
            value: 'reverse',
            symbol: '🔄',
            isWild: true,
            isInitialCenterAllowed: false
        });
    }

    // 5. 공명 카드 4장 (특수 무지개색)
    for (let i = 1; i <= 4; i++) {
        templates.push({
            seq: seq++,
            templateId: `resonance_${i}`,
            category: UNOS_CARD_CATEGORIES.SPECIAL,
            kind: UNOS_CARD_KINDS.RESONANCE,
            color: null,
            paletteKey: 'resonance',
            value: 'resonance',
            symbol: '🌈',
            isWild: true,
            isInitialCenterAllowed: false
        });
    }

    // 6. 우울 카드 2장 (특수 보라색)
    for (let i = 1; i <= 2; i++) {
        templates.push({
            seq: seq++,
            templateId: `depression_${i}`,
            category: UNOS_CARD_CATEGORIES.SPECIAL,
            kind: UNOS_CARD_KINDS.DEPRESSION,
            color: null,
            paletteKey: 'depression',
            value: 'depression',
            symbol: '+2',
            isWild: true,
            isInitialCenterAllowed: false
        });
    }

    return Object.freeze(templates.map(t => Object.freeze(t)));
}

export const UNOS_DECK_TEMPLATES = buildUnosDeckTemplates();
export const UNOS_TOTAL_CARD_COUNT = 56;

export const UNOS_TURN_ORDER_CONFIG = Object.freeze({
    AUTO_DRAW_SECONDS: 5,
    AI_DRAW_DELAY_MS: 450,
    TIE_REDRAW_DELAY_MS: 1300,
    RESULT_HOLD_DELAY_MS: 1600
});

export const UNOS_TURN_TIMER_CONFIG = Object.freeze({
    TURN_LIMIT_SECONDS: 30,
    WARN_THRESHOLD_SECONDS: 5
});

export const UnosLang = {
    ko: {
        GAME_TITLE: '우노스 (UNOS)',
        COLORS: {
            madness: '광기',
            calm: '냉정',
            pure: '순수',
            lively: '활발',
            reverse: '무속성',
            resonance: '무지개',
            depression: '우울'
        },
        KINDS: {
            number: '숫자',
            skip: '스킵',
            action: '액션',
            reverse: '리버스',
            resonance: '공명',
            depression: '우울'
        },
        CARD_DESC: {
            number: '일치하는 색상 또는 숫자로 제출하여 활성 성격을 변경합니다.',
            skip: '상대의 다음 카드 제출 페이즈를 건너뜁니다. (체스 이동은 정상 진행)',
            action: '제출 후 색상/숫자 제약 없이 손패에서 카드 1장을 추가 제출합니다. (최대 1회 연쇄)',
            reverse: '체스판 색상 타일을 랜덤 재배치하고 활성 성격을 랜덤 1색으로 변경합니다.',
            resonance: '원하는 성격 1색을 지정하고 이번 턴 색상 제약 없이 기물을 이동합니다.',
            depression: '직전 활성 색상을 유지하며 상대에게 카드 2장을 강제 드로우시킵니다.'
        },
        PIECES: {
            K: '킹',
            Q: '퀸',
            R: '룩',
            B: '비숍',
            N: '나이트',
            P: '폰',
            P_PLUS: '강화폰'
        },
        PHASES: {
            TURN_ORDER: '선/후공 숫자 카드 추첨',
            CARD_PHASE: '카드 제출 페이즈',
            DRAWN_CARD_PROMPT: '드로우 카드 처리',
            CHESS_PHASE: '체스 기물 이동 페이즈',
            PROMOTION_PROMPT: '폰 프로모션 (강화폰 승급 · 카드 소각)',
            GAME_OVER: '경기 종료'
        },
        TURN_ORDER_TITLE: '🎴 선/후공 숫자 카드 뽑기 (0 ~ 9)',
        TURN_ORDER_SUBTITLE: '숫자 카드(0~9)를 1장씩 뽑아 더 높은 숫자가 나온 플레이어가 선공(하단 진영)이 됩니다.\n(추첨에 사용한 카드는 확인 후 다시 덱에 넣고 56장 전체를 셔플합니다)',
        TURN_ORDER_BTN_DRAW: '숫자 카드 뽑기',
        TURN_ORDER_WAITING_DRAW: '뽑기 대기 중...',
        TURN_ORDER_WAITING_OPP: '상대방이 숫자 카드를 뽑는 중입니다...',
        TURN_ORDER_FIRST_BADGE: '🥇 선공 (1st)',
        TURN_ORDER_SECOND_BADGE: '🥈 후공 (2nd)',
        ACTION_CHAIN_LIMIT_MSG: '더 이상 이 카드를 낼 수 없습니다!',
        CARD_NOT_MATCHED_MSG: '현재 활성 색상이나 숫자/기호가 일치하지 않습니다.',
        NOT_YOUR_TURN_MSG: '상대방의 턴입니다.',
        CHESS_PHASE_CARD_LOCKED_MSG: '체스 이동 페이즈입니다. 기물을 이동해 주세요.',
        PROMOTION_ALERT_MSG: '프로모션 발동! 폰이 강화되고 원하는 카드를 한 장 버릴 수 있습니다.',
        CASTLING_UNSAFE_CONFIRM_MSG: '킹이 갈 자리가 공격받고 있습니다! 그래도 캐슬링을 진행하시겠습니까?',
        BTN_END_MOVE: '이동 종료',
        BTN_CASTLE_LEFT: '🏰 좌측 캐슬링',
        BTN_CASTLE_RIGHT: '🏰 우측 캐슬링',
        BTN_PLAY_DRAWN: '즉시 제출',
        BTN_KEEP_DRAWN: '손패 보관',
        BTN_CANCEL: '취소',
        BTN_FORCE_CASTLE: '강행',
        BTN_DRAW_CARD: '카드 1장 드로우',
        BTN_SURRENDER: '기권',
        BTN_EXIT: '나가기',
        BTN_EXIT_CONFIRM: '정말 나가기?',
        BTN_RETURN_ROOM: '대기실로 돌아가기',
        RESONANCE_PICK_TITLE: '🌈 공명 — 활성화할 성격을 선택하세요',
        DRAWN_PROMPT_TITLE: '드로우한 카드를 바로 제출하시겠습니까?',
        PROMOTION_PROMPT_TITLE: '👑 프로모션 발동! 소각할 카드를 1장 선택하세요',
        CASTLING_WARN_TITLE: '⚠️ 캐슬링 위험 경고',
        SAFETY_RED_DESC: '즉시 피격 위험! 상대 기물의 공격 범위입니다.',
        SAFETY_YELLOW_DESC: '잠재 위협: 상대 퀸 공격 범위이나 현재 쿨타임 중입니다.',
        QUEEN_COOLDOWN_BADGE: '쿨타임',
        BURST_BADGE: '🔥 BURST (UNO!)',
        CHECK_BADGE: '⚠️ CHECK!',
        CHECKMATE_TITLE: '🏆 CHECKMATE!',
        ACTIVE_COLOR_LABEL: '현재 활성 성격',
        TURN_MOVE_COLOR_LABEL: '이번 턴 이동 가능 성격',
        COLOR_FREE_MOVE_LABEL: '모든 성격 자유 이동 (제약 없음)',
        DECK_REMAINING: '남은 덱',
        DISCARD_PILE: '중앙 더미',
        HAND_COUNT_UNIT: '장',
        TURN_TIMEOUT_MSG: '⏰ 제한시간 30초 초과! 현재 턴이 자동 진행됩니다.'
    },
    en: {
        GAME_TITLE: 'UNOS',
        COLORS: {
            madness: 'Madness',
            calm: 'Calm',
            pure: 'Pure',
            lively: 'Lively',
            reverse: 'Neutral',
            resonance: 'Rainbow',
            depression: 'Depression'
        },
        KINDS: {
            number: 'Number',
            skip: 'Skip',
            action: 'Action',
            reverse: 'Reverse',
            resonance: 'Resonance',
            depression: 'Depression'
        },
        CARD_DESC: {
            number: 'Match color or number to set the active personality color.',
            skip: 'Skips opponent’s next card phase. (Chess move still proceeds)',
            action: 'Play 1 additional card freely without color/number restriction. (Max 1 chain)',
            reverse: 'Randomly remaps board tiles and sets a random active personality color.',
            resonance: 'Choose 1 personality color and move chess pieces without color limits this turn.',
            depression: 'Keeps current active color and forces opponent to draw +2 cards.'
        },
        PIECES: {
            K: 'King',
            Q: 'Queen',
            R: 'Rook',
            B: 'Bishop',
            N: 'Knight',
            P: 'Pawn',
            P_PLUS: 'Pawn+'
        },
        PHASES: {
            TURN_ORDER: 'Turn Order Draw',
            CARD_PHASE: 'Card Phase',
            DRAWN_CARD_PROMPT: 'Drawn Card Choice',
            CHESS_PHASE: 'Chess Move Phase',
            PROMOTION_PROMPT: 'Promotion (Pawn+ & Burn 1 Card)',
            GAME_OVER: 'Game Over'
        },
        TURN_ORDER_TITLE: '🎴 Turn Order Number Card Draw (0 ~ 9)',
        TURN_ORDER_SUBTITLE: 'Each player draws 1 number card (0~9). The higher number takes the 1st turn (Bottom side).\n(Drawn cards are returned to the 56-card deck and reshuffled before dealing hands)',
        TURN_ORDER_BTN_DRAW: 'Draw Number Card',
        TURN_ORDER_WAITING_DRAW: 'Waiting to draw...',
        TURN_ORDER_WAITING_OPP: 'Waiting for opponent to draw a number card...',
        TURN_ORDER_FIRST_BADGE: '🥇 1st Turn',
        TURN_ORDER_SECOND_BADGE: '🥈 2nd Turn',
        ACTION_CHAIN_LIMIT_MSG: '더 이상 이 카드를 낼 수 없습니다!',
        CARD_NOT_MATCHED_MSG: 'Does not match active color or number/symbol.',
        NOT_YOUR_TURN_MSG: 'Waiting for opponent’s turn.',
        CHESS_PHASE_CARD_LOCKED_MSG: 'Chess move phase active. Move a piece.',
        PROMOTION_ALERT_MSG: '프로모션 발동! 폰이 강화되고 원하는 카드를 한 장 버릴 수 있습니다.',
        CASTLING_UNSAFE_CONFIRM_MSG: '킹이 갈 자리가 공격받고 있습니다! 그래도 캐슬링을 진행하시겠습니까?',
        BTN_END_MOVE: '이동 종료',
        BTN_CASTLE_LEFT: '🏰 좌측 캐슬링',
        BTN_CASTLE_RIGHT: '🏰 우측 캐슬링',
        BTN_PLAY_DRAWN: '즉시 제출',
        BTN_KEEP_DRAWN: '손패 보관',
        BTN_CANCEL: '취소',
        BTN_FORCE_CASTLE: '강행',
        BTN_DRAW_CARD: 'Draw 1 Card',
        BTN_SURRENDER: 'Surrender',
        BTN_EXIT: 'Exit',
        BTN_EXIT_CONFIRM: 'Confirm Exit?',
        BTN_RETURN_ROOM: 'Return to Room',
        RESONANCE_PICK_TITLE: '🌈 Resonance — Select Active Personality Color',
        DRAWN_PROMPT_TITLE: 'Play the drawn card immediately?',
        PROMOTION_PROMPT_TITLE: '👑 Promotion! Select 1 card from your hand to discard',
        CASTLING_WARN_TITLE: '⚠️ Unsafe Castling Warning',
        SAFETY_RED_DESC: 'Immediate Danger! Square is under opponent attack.',
        SAFETY_YELLOW_DESC: 'Potential Threat: In opponent Queen range, but Queen is on cooldown.',
        QUEEN_COOLDOWN_BADGE: 'Cooldown',
        BURST_BADGE: '🔥 BURST (UNO!)',
        CHECK_BADGE: '⚠️ CHECK!',
        CHECKMATE_TITLE: '🏆 CHECKMATE!',
        ACTIVE_COLOR_LABEL: 'Active Color',
        TURN_MOVE_COLOR_LABEL: 'Turn Move Colors',
        COLOR_FREE_MOVE_LABEL: 'Free Move (No Color Limit)',
        DECK_REMAINING: 'Deck',
        DISCARD_PILE: 'Center Pile',
        HAND_COUNT_UNIT: 'cards',
        TURN_TIMEOUT_MSG: '⏰ 30s turn time limit expired! Auto-completing turn.'
    },
    ja: {
        GAME_TITLE: 'ウノス (UNOS)',
        COLORS: {
            madness: '狂気',
            calm: '冷静',
            pure: '純粋',
            lively: '活発',
            reverse: '無属性',
            resonance: '虹色',
            depression: '憂鬱'
        },
        KINDS: {
            number: '数字',
            skip: 'スキップ',
            action: 'アクション',
            reverse: 'リバース',
            resonance: '共鳴',
            depression: '憂鬱'
        },
        CARD_DESC: {
            number: '同じ色または数字を出して活性性格を変更します。',
            skip: '相手の次のカード提出フェーズをスキップします。',
            action: '色・数字制限なしで手札からもう1枚追加提出します。(最大1回連鎖)',
            reverse: '盤面の色タイルを再配置し、活性性格をランダムな1色に変更します。',
            resonance: '任意の性格1色を選び、このターンは色制限なしで駒を移動できます。',
            depression: '直前の活性色を維持したまま相手にカードを2枚引かせます。'
        },
        PIECES: {
            K: 'キング',
            Q: 'クイーン',
            R: 'ルーク',
            B: 'ビショップ',
            N: 'ナイト',
            P: 'ポーン',
            P_PLUS: '強化ポーン'
        },
        PHASES: {
            TURN_ORDER: '先攻・後攻カード抽選',
            CARD_PHASE: 'カード提出フェーズ',
            DRAWN_CARD_PROMPT: 'ドローカード選択',
            CHESS_PHASE: 'チェス移動フェーズ',
            PROMOTION_PROMPT: 'プロモーション (強化ポーン・カード破棄)',
            GAME_OVER: '試合終了'
        },
        TURN_ORDER_TITLE: '🎴 先攻・後攻 数字カード抽選 (0 ~ 9)',
        TURN_ORDER_SUBTITLE: '数字カード(0~9)を1枚ずつ引き、大きい数字が出たプレイヤーが先攻(下側陣営)になります。\n(引いたカードは確認後に山札へ戻し、56枚全体をシャッフルして手札を配ります)',
        TURN_ORDER_BTN_DRAW: '数字カードを引く',
        TURN_ORDER_WAITING_DRAW: '抽選待機中...',
        TURN_ORDER_WAITING_OPP: '相手が数字カードを引いています...',
        TURN_ORDER_FIRST_BADGE: '🥇 先攻 (1st)',
        TURN_ORDER_SECOND_BADGE: '🥈 後攻 (2nd)',
        ACTION_CHAIN_LIMIT_MSG: '더 이상 이 카드를 낼 수 없습니다!',
        CARD_NOT_MATCHED_MSG: '現在の活性色または数字・記号と一致しません。',
        NOT_YOUR_TURN_MSG: '相手のターンです。',
        CHESS_PHASE_CARD_LOCKED_MSG: 'チェス移動フェーズです。駒を移動してください。',
        PROMOTION_ALERT_MSG: '프로모션 발동! 폰이 강화되고 원하는 카드를 한 장 버릴 수 있습니다.',
        CASTLING_UNSAFE_CONFIRM_MSG: '킹이 갈 자리가 공격받고 있습니다! 그래도 캐슬링을 진행하시겠습니까?',
        BTN_END_MOVE: '이동 종료',
        BTN_CASTLE_LEFT: '🏰 좌측 캐슬링',
        BTN_CASTLE_RIGHT: '🏰 우측 캐슬링',
        BTN_PLAY_DRAWN: '즉시 제출',
        BTN_KEEP_DRAWN: '손패 보관',
        BTN_CANCEL: '취소',
        BTN_FORCE_CASTLE: '강행',
        BTN_DRAW_CARD: '1枚ドロー',
        BTN_SURRENDER: '降参',
        BTN_EXIT: '退出',
        BTN_EXIT_CONFIRM: '本当に退出？',
        BTN_RETURN_ROOM: '待機室へ戻る',
        RESONANCE_PICK_TITLE: '🌈 共鳴 — 活性化する性格を選択してください',
        DRAWN_PROMPT_TITLE: '引いたカードをすぐに出しますか？',
        PROMOTION_PROMPT_TITLE: '👑 プロモーション発動！捨てるカードを1枚選んでください',
        CASTLING_WARN_TITLE: '⚠️ キャスリング危険警告',
        SAFETY_RED_DESC: '即時被撃危険！相手駒の攻撃範囲内です。',
        SAFETY_YELLOW_DESC: '潜在脅威：相手クイーンの範囲内ですが現在クールタイム中です。',
        QUEEN_COOLDOWN_BADGE: 'クールタイム',
        BURST_BADGE: '🔥 BURST (UNO!)',
        CHECK_BADGE: '⚠️ CHECK!',
        CHECKMATE_TITLE: '🏆 CHECKMATE!',
        ACTIVE_COLOR_LABEL: '現在の活性性格',
        TURN_MOVE_COLOR_LABEL: '移動可能な性格',
        COLOR_FREE_MOVE_LABEL: '全色自由移動 (制限なし)',
        DECK_REMAINING: '山札',
        DISCARD_PILE: '中央の山',
        HAND_COUNT_UNIT: '枚',
        TURN_TIMEOUT_MSG: '⏰ 制限時間30秒を超過しました！ターンを自動進行します。'
    }
};

export function getUnosDict(lang = 'ko') {
    return UnosLang[lang] || UnosLang.ko;
}

export function getUnosColorName(colorKey, lang = 'ko') {
    const dict = getUnosDict(lang);
    return dict.COLORS[colorKey] || colorKey || '';
}

export function formatUnosCardTitle(card, lang = 'ko') {
    if (!card) return '';
    const dict = getUnosDict(lang);
    if (card.kind === UNOS_CARD_KINDS.REVERSE) return dict.KINDS.reverse;
    if (card.kind === UNOS_CARD_KINDS.RESONANCE) return dict.KINDS.resonance;
    if (card.kind === UNOS_CARD_KINDS.DEPRESSION) return dict.KINDS.depression;

    const colorName = dict.COLORS[card.color] || card.color || '';
    if (card.kind === UNOS_CARD_KINDS.NUMBER) {
        return `${colorName} ${card.value}`;
    }
    if (card.kind === UNOS_CARD_KINDS.SKIP) {
        return `${colorName} ${dict.KINDS.skip}`;
    }
    if (card.kind === UNOS_CARD_KINDS.ACTION) {
        return `${colorName} ${dict.KINDS.action}`;
    }
    return `${colorName} ${card.value ?? ''}`.trim();
}
