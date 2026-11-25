// ProgramFiles/System/Index/Marble/MarbleCardToastIndex.js
// 엘리아스 마블 전 77종 카드(일반 51 / 특수 20 / 보물 6)의 본인·상대·로그 토스트 생성 인덱스

import { CardIndex } from './MarbleCardIndex.js';

const ALL_CARDS_BY_ID = new Map((CardIndex?.ko || []).map(c => [c.id, c]));

export function formatCardActivationLog(playerName, cardOrName, cardId = null) {
    const cObj = (typeof cardOrName === 'object' && cardOrName)
        ? cardOrName
        : ALL_CARDS_BY_ID.get(Number(cardId));
    const resolvedId = Number(cObj?.id ?? cardId ?? 0);
    const cardName = (typeof cardOrName === 'object' && cardOrName)
        ? (cardOrName.name || '')
        : String(cardOrName || cObj?.name || '');
    const nameOnly = cardName.replace(/\s*\(남은\s*횟수[^)]*\)\s*$/, '').trim();
    if (resolvedId >= 500 || cObj?.grade === 'treasure') {
        return `${playerName}가 보물카드[${nameOnly}]의 능력을 발동`;
    }
    return `${playerName}가 카드[${nameOnly}]발동`;
}

/**
 * 카드 ID별 본인(selfMessage) · 상대(otherMessage) · 로그(logMessage) 토스트를 생성한다.
 */
export function buildCardActivationToast(opts = {}) {
    const cardObj = (opts.card && typeof opts.card === 'object')
        ? opts.card
        : ALL_CARDS_BY_ID.get(Number(opts.cardId));
    const id = Number(opts.cardId ?? cardObj?.id ?? 0);
    const rawName = opts.cardName || cardObj?.name || '';
    const cardName = rawName.replace(/\s*\(남은\s*횟수[^)]*\)\s*$/, '').trim();
    const actor = opts.actorName || '루포';
    const targetPlayer = opts.targetPlayerName || '에르핀';
    const targetTile = opts.targetTileName || '에슈르의 빵집';
    const amount = opts.amountStr || '500,000 엘드르 달러';
    const step = Number.isFinite(Number(opts.step)) ? Number(opts.step) : 3;
    const roll = Number.isFinite(Number(opts.rollValue)) ? Number(opts.rollValue) : 4;
    const phaseLabel = opts.phaseLabel || '낮';
    const turns = Number.isFinite(Number(opts.turns)) ? Number(opts.turns) : 2;
    const reducedAmt = opts.reducedStr || '825,000 엘드르 달러';

    const logMessage = formatCardActivationLog(actor, cardObj || cardName, id);

    // 개별 카드 정밀 매핑 (사용자 지정 문구 포함)
    const table = {
        // [일반 이동형 1~17]
        1: { self: `📍 [${cardName}] '알현실'로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '알현실'로 이동합니다!` },
        2: { self: `📍 [${cardName}] '볼케니카'로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '볼케니카'로 이동합니다!` },
        3: { self: `📍 [${cardName}] '정령산 정상'으로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '정령산 정상'으로 이동합니다!` },
        4: { self: `📍 [${cardName}] '빵주'로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '빵주'로 이동합니다!` },
        5: { self: `📍 [${cardName}] '엘리아스 극장'으로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '엘리아스 극장'으로 이동합니다!` },
        6: { self: `📍 [${cardName}] '모나티엄 25'로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '모나티엄 25'로 이동합니다!` },
        7: { self: `📍 [${cardName}] '정령 호수'로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '정령 호수'로 이동합니다!` },
        8: { self: `📍 [${cardName}] '셰이디의 차원'으로 끌려갑니다!`, other: `[${cardName}]효과로 ${actor}님이 '셰이디의 차원'으로 이동합니다!` },
        9: { self: `📍 [${cardName}] '마녀 도서관'으로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '마녀 도서관'으로 이동합니다!` },
        10: { self: `📍 [${cardName}] '달바라기 정원'으로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 '달바라기 정원'으로 이동합니다!` },
        11: { self: `🎁 [${cardName}] ${amount}를 받고 '에슈르의 빵집'으로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 ${amount}를 받고 '에슈르의 빵집'으로 이동합니다!` },
        12: { self: `🎁 [${cardName}] ${amount}를 받고 '모나티엄 시청'으로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 ${amount}를 받고 '모나티엄 시청'으로 이동합니다!` },
        13: { self: `🎁 [${cardName}] ${amount}를 받고 '림의 집'으로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 ${amount}를 받고 '림의 집'으로 이동합니다!` },
        14: { self: `🎁 [${cardName}] ${amount}를 받고 'UFC직영점'으로 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 ${amount}를 받고 'UFC직영점'으로 이동합니다!` },
        15: { self: `🧭 [${cardName}] 앞으로 ${step}칸 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 ${step}칸만큼 이동합니다!` },
        16: { self: `🧭 [${cardName}] 앞으로 ${step}칸 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 앞으로 ${step}칸 이동합니다!` },
        17: { self: `🧭 [${cardName}] 뒤로 ${step}칸 이동합니다!`, other: `[${cardName}]효과로 ${actor}님이 뒤로 ${step}칸 이동합니다!` },

        // [일반 경제·즉시 18~28]
        18: { self: `💰 모든 플레이어로부터 총 ${amount}를 수금했습니다!`, other: `[${cardName}]효과로 ${actor}님이 모든 플레이어로부터 엘드르 달러를 수금했습니다!` },
        19: { self: `🏛️ [${cardName}] 토지세 ${amount}를 납부했습니다!`, other: `[${cardName}]효과로 ${actor}님이 토지세를 납부했습니다!` },
        20: { self: `🧹 [${cardName}] 청소 비용 ${amount}를 지불했습니다!`, other: `[${cardName}]효과로 ${actor}님이 건물 청소 비용을 지불했습니다!` },
        21: { self: `🏛️ [${cardName}] 건축세 ${amount}를 납부했습니다!`, other: `[${cardName}]효과로 ${actor}님이 건축세를 납부했습니다!` },
        22: { self: `[왕국폭동] 2턴간 보유한 영토의 통행료가 0.5배로 하락합니다!`, other: `[왕국폭동]효과로 ${actor}님의 영토의 통행료가 0.5배만큼 하락합니다!` },
        23: { self: `[축제개최] 2턴간 보유한 영토의 통행료가 1.5배로 상승합니다!`, other: `[축제개최]효과로 ${actor}님의 영토의 통행료가 1.5배만큼 상승합니다!` },
        24: { self: `🎲(${roll}) 주사위 결과로 복권 당첨! (+${amount})`, other: `[${cardName}]효과로 ${actor}님이 복권에 당첨되었습니다!` },
        25: { self: `🎲(${roll}) 주사위 결과로 고급복권 당첨! (+${amount})`, other: `[${cardName}]효과로 ${actor}님이 고급복권에 당첨되었습니다!` },
        26: { self: `🏅 [${cardName}] 지원금 ${amount}를 지급받았습니다!`, other: `[${cardName}]효과로 ${actor}님이 지원금을 지급받았습니다!` },
        27: { self: `🪙 [${cardName}] 지원금 ${amount}를 지급받았습니다!`, other: `[${cardName}]효과로 ${actor}님이 지원금을 지급받았습니다!` },
        28: { self: `[교단의 비상금] 모든 대출이 전액 청산되고 비상금을 지급받았습니다!`, other: `${actor}님이 교단의 비상금을 털어갔습니다!` },

        // [일반 보유형 29~38]
        29: { self: `[${cardName}] 모나티엄 25 도착 시 통행료가 1회 면제됩니다!`, other: `[${cardName}]효과로 ${actor}님이 모나티엄 25 통행료 면제 효과를 획득했습니다!` },
        30: { self: `[${cardName}] 에슈르의 빵집 도착 시 통행료가 1회 면제됩니다!`, other: `[${cardName}]효과로 ${actor}님이 에슈르의 빵집 통행료 면제 효과를 획득했습니다!` },
        31: { self: `[${cardName}] 림의 집 도착 시 통행료가 1회 면제됩니다!`, other: `[${cardName}]효과로 ${actor}님이 림의 집 통행료 면제 효과를 획득했습니다!` },
        32: { self: `[${cardName}] UFC직영점 도착 시 통행료가 1회 면제됩니다!`, other: `[${cardName}]효과로 ${actor}님이 UFC직영점 통행료 면제 효과를 획득했습니다!` },
        33: { self: `카드 효과로 빵주 기본 이용료가 면제되었습니다!`, other: `[${cardName}]효과로 ${actor}님이 빵주 기본 이용료 면제를 적용받았습니다!` },
        34: { self: `[${cardName}] 다야의 궁전 통행료가 면제됩니다! (인수·서열싸움 보유 시 파괴)`, other: `[${cardName}]효과로 ${actor}님이 다야의 궁전 통행료 면제 효과를 얻었습니다!` },
        35: { self: `[림의 기역] 으윽, 그 낫은...! 빨리 내 차원에서 사라져!`, other: `${actor}님의 [림의 기역]효과로 셰이디의 장난을 무시합니다!` },
        36: { self: `🌀 [${cardName}] 효과가 발동되어 ${targetPlayer}님을 차원으로 끌어들입니다!`, other: `[${cardName}]효과로 ${actor}님이 ${targetPlayer}님을 셰이디의 차원으로 끌어들입니다!` },
        37: { self: `[이면세계] 보유한 모든 영토의 시간대(낮/밤)가 역전되었습니다!`, other: `[이면세계]효과로 ${actor}님의 영토의 시간대가 반전되었습니다!` },
        38: { self: `[피라의 대부업명함] 앞으로 대출 원금이 0.5배로 감소하고, 고정 이자율 20% 및 정산 미상환 이율 2배가 적용됩니다!`, other: `[${cardName}]효과로 ${actor}님에게 대출 조건 변경 효과가 적용되었습니다!` },

        // [일반 사용형 39~51]
        39: { self: `🎫 VIP카드로 통행료가 면제되었습니다!`, other: `[${cardName}]효과로 ${actor}님이 통행료를 1회 면제받았습니다!` },
        40: { self: `[네르의 소환장] 볼케니카에서 즉시 탈출했습니다!`, other: `${actor}님이 볼케니카에서 탈출했습니다!` },
        41: { self: `[셰럼의 일일조교] 무료로 도서관 능력을 획득했습니다!`, other: `[${cardName}]효과로 ${actor}님이 마녀 도서관 능력을 무료로 획득했습니다!` },
        42: { self: `🎯 ${targetTile}에 효과 발동! 마을(2단계) 무료 건설 완료!`, other: `[${cardName}]효과로 ${actor}님이 ${targetTile}에 마을까지 무료 건설했습니다!` },
        43: { self: `🎯 ${targetTile}에 효과 발동! 무료 1단계 증축 완료!`, other: `[${cardName}]효과로 ${actor}님이 ${targetTile}의 건물을 1단계 무료 증축했습니다!` },
        44: { self: `🎯 ${targetTile}에 효과 발동! 엘리프 조각상 무료 건설 완료!`, other: `[${cardName}]효과로 ${actor}님이 ${targetTile}에 엘리프 조각상을 건설했습니다!` },
        45: { self: `[시스트의 거래] 카드가 인벤토리에 보관되어 매입/건설비 50% 할인이 적용됩니다!`, other: `[${cardName}]효과로 ${actor}님이 매입/건설비 50% 할인을 적용받았습니다!` },
        46: { self: `🎯 ${targetTile}을 1.5배 가격(${amount})으로 매각했습니다!`, other: `[${cardName}]효과로 ${actor}님이 ${targetTile}을 1.5배 가격으로 매각했습니다!` },
        47: { self: `🎯 ${targetTile}에 효과 발동! 상대 영토 인수 완료!`, other: `[${cardName}]효과로 ${actor}님이 ${targetTile} 영토를 인수했습니다!` },
        48: { self: `🎯 ${targetPlayer}에게 효과 발동! (${targetTile} 건물 철거 -2단계 완료!)`, other: `[${cardName}]효과로 ${actor}님이 ${targetPlayer}님의 건물(${targetTile})을 철거했습니다!` },
        49: { self: `🎯 ${targetTile}에 효과 발동! 영토의 시간대(낮/밤)가 역전되었습니다!`, other: `[${cardName}]효과로 ${actor}님이 ${targetTile}의 시간대를 역전시켰습니다!` },
        50: { self: `루포의 주사위를 사용했습니다! 주사위의 값이 6만큼 고정으로 증가합니다!`, other: `[${cardName}]효과로 ${actor}님이 루포의 주사위를 발동했습니다!` },
        51: { self: `골디 덕분에 대출금이 50%로 줄었습니다! (감면 대출금 : ${reducedAmt})`, other: `[${cardName}]효과로 ${actor}님의 남은 대출금이 절반으로 감소했습니다!` },

        // [특수 101~114, 201~206]
        101: { self: `밑장빼기 발동! 차원 열쇠 카드 2장 연속 획득!`, other: `${actor}님이 밑장을 빼서 차원 열쇠 카드를 2장 가져갔습니다!` },
        102: { self: `[뒤집어버리기] 사용된 모든 차원 이동 카드를 덱에 되돌리고 섞었습니다!`, other: `[${cardName}]효과로 ${actor}님이 사용된 차원 이동 카드를 덱에 되돌리고 섞었습니다!` },
        103: { self: `[서열싸움] 다야의 궁전을 차지했습니다!`, other: `[서열싸움]효과로 ${actor}님이 다야의 궁전을 차지했습니다!` },
        104: { self: `주사위 하나가 에르핀의 주사위로 변했습니다!`, other: `${actor}님의 주사위가 에르핀의 주사위로 변했습니다!` },
        105: { self: `🚀 [${cardName}] ${targetTile} 칸으로 난입 이동했습니다!`, other: `[${cardName}]효과로 ${actor}님이 ${targetTile} 칸으로 즉시 이동했습니다!` },
        106: { self: `[두번째 기회] 발동! 파산을 면하고 ${amount}를 지급받았습니다!`, other: `${actor}님이 [두번째 기회] 효과로 파산을 면하고 ${amount}를 지급받았습니다!` },
        107: { self: `[VVVIP카드] 카드 효과가 영구 적용되었습니다!`, other: `[${cardName}]효과로 ${actor}님에게 통행료 20% 할인이 영구 적용되었습니다!` },
        108: { self: `[달바라기 한 송이] 달바라기 정원 도착 보상이 2배로 증가합니다!`, other: `[${cardName}]효과로 ${actor}님의 달바라기 정원 보상이 2배로 적용됩니다!` },
        109: { self: `[암거래상의 증표] 알현실 순회 보상이 1.5배로 증가합니다!`, other: `[${cardName}]효과로 ${actor}님의 알현실 순회 보상이 1.5배로 증가했습니다!` },
        110: { self: `[시간가속] 남은 시간대가 최대 2턴 단축되었으며, 남은 현재 시간대 동안 주사위를 2번 굴립니다!`, other: `[시간가속]효과로 ${phaseLabel}시간대가 ${turns}턴만큼 가속되었습니다!` },
        111: { self: `💎 [${cardName}] 보물 카드를 확정적으로 1장 획득합니다!`, other: `[${cardName}]효과로 ${actor}님이 보물 카드를 확정 획득합니다!` },
        112: { self: `🎯 ${targetPlayer}에게 효과 발동! 보물 카드를 빼앗아왔습니다!`, other: `[${cardName}]효과로 ${actor}님이 ${targetPlayer}님의 보물 카드를 빼앗았습니다!` },
        113: { self: `[심판의 시간] 그을음이 빛무리로 정화되며 [몽환살이]를 획득했습니다! (주사위 추가 굴림)`, other: `[${cardName}]효과로 ${actor}님이 그을음을 정화하고 [몽환살이]를 획득했습니다!` },
        114: { self: `[교주의 염원] 그을음이 빛무리로 정화되며 [염원살이]를 획득했습니다! (주사위 추가 굴림)`, other: `[${cardName}]효과로 ${actor}님이 그을음을 정화하고 [염원살이]를 획득했습니다!` },
        201: { self: `정령 호수에 [퍼리비이치]가 개장되었습니다!`, other: `[${cardName}]효과로 ${actor}님이 정령 호수에 [퍼리비이치]를 개장했습니다!` },
        202: { self: `디아나의 꿀밤! 퍼리비이치가 다시 정령 호수로 돌아갑니다.`, other: `[${cardName}]효과로 ${actor}님이 퍼리비이치를 정령 호수로 되돌렸습니다!` },
        203: { self: `코미주스 한잔해 적용! 퍼리비이치 개장 시 입장료가 1.5배로 상승합니다.`, other: `[${cardName}]효과로 ${actor}님에게 퍼리비이치 입장료 1.5배 효과가 적용되었습니다!` },
        204: { self: `[김씨노동기] 퍼리비이치의 강제 휴식 효과를 받지 않습니다!`, other: `[${cardName}]효과로 ${actor}님이 퍼리비이치 강제 휴식 면제를 획득했습니다!` },
        205: { self: `[잊혀진 기억] 정령산 정상의 효과를 받지 않습니다.`, other: `[${cardName}]효과로 ${actor}님이 정령산 정상 효과 면제를 획득했습니다!` },
        206: { self: `[태초의 엘리프] 정령산 정상의 가르침을 대가 없이 영구 고정 소유합니다!`, other: `[${cardName}]효과로 ${actor}님이 정령산 정상의 축복을 영구 소유합니다!` },

        // [보물 501~506]
        501: { self: `[???의 왕관]의 효과로 150,000 엘드르 달러를 얻었습니다.`, other: `[???의 왕관]효과로 ${actor}님이 턴 보상 150,000 엘드르 달러를 획득했습니다!` },
        502: { self: `[???의 활]의 효과로 주사위를 한 번 더 굴릴 수 있습니다.`, other: `[???의 활]효과로 ${actor}님이 주사위를 한 번 더 굴립니다!` },
        503: { self: `[???가 담긴 검] 영토 매입비·건설비 0.8배 효과가 적용됩니다!`, other: `[???가 담긴 검]효과로 ${actor}님이 영토 매입·건설비 0.8배 효과를 발동했습니다!` },
        504: { self: `🧣 [???의 수의]의 권능으로 앞으로 ${step}칸 이동합니다.`, other: `[???의 수의]효과로 ${actor}님이 앞으로 ${step}칸 이동했습니다!` },
        505: { self: `🎯 ${targetTile}에 효과 발동! [???의 밧줄] 상대 영토를 강제 매각시켰습니다! (+${amount})`, other: `[???의 밧줄]효과로 ${actor}님이 ${targetPlayer}님의 ${targetTile} 영토를 강제 매각시켰습니다!` },
        506: { self: `🎯 ${targetTile}에 효과 발동! [???의 지팡이] 영토를 대가 없이 빼앗아왔습니다!`, other: `[???의 지팡이]효과로 ${actor}님이 ${targetTile} 영토를 빼앗았습니다!` }
    };

    const row = table[id] || {
        self: `[${cardName}] 효과가 발동되었습니다!`,
        other: `[${cardName}]효과로 ${actor}님이 효과를 발동했습니다!`
    };
    return {
        selfMessage: opts.selfOverride || row.self,
        otherMessage: opts.otherOverride || row.other,
        logMessage
    };
}
