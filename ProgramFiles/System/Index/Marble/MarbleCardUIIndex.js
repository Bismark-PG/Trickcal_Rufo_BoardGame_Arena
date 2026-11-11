export const CardUILang = {
    ko: {
        // 공통
        BTN_CONFIRM: "확인",
        CARD_DRAWN: "차원 열쇠 카드 획득!",
        CARD_DRAWN_DOUBLE: "밑장빼기 발동! 차원 열쇠 카드 2장 연속 획득!",
        CARD_STORED: "인벤토리에 보관되었습니다.",
        CARD_BUFF_APPLIED: "보유 효과가 적용되었습니다.",
        CARD_DESTROYED_RANK2: "[서열 2위의 특권] 다야의 궁전 보유자가 되어 카드가 파괴되었습니다!",
        SECOND_CHANCE_USED: "[두번째 기회] 발동! 파산을 면하고 300만 달러를 지급받았습니다!",
        SECOND_CHANCE_HALF_USED: "[두번째 기회] 발동! (영토 보유 파산) 파산을 면하고 150만 달러를 지급받았습니다!",

        // 이동 및 보너스
        MOVE_START_BONUS: "시작 지점 통과! 순회 보너스 획득!",
        MOVE_CARD_BONUS: "카드 효과로 보너스 획득!",

        // 수금 및 지불
        MONEY_RECEIVE: "엘드르 달러를 획득했습니다!",
        MONEY_STEAL_ALL: "모든 플레이어로부터 엘드르 달러를 수금했습니다!",
        TAX_PAID: "세금을 납부했습니다.",
        TAX_FAILED: "자금이 부족하여 전 재산을 징수당했습니다!",
        LOTTERY_WIN: "주사위 결과로 복권 당첨!",
        TOLL_BUFF_RIOT: "[왕국폭동] 2턴간 보유한 영토의 통행료가 0.5배로 하락합니다!",
        TOLL_BUFF_FESTIVAL: "[축제개최] 2턴간 보유한 영토의 통행료가 1.5배로 상승합니다!",
        OTHERWORLD_APPLIED: "[이면세계] 보유한 모든 영토의 시간대(낮/밤)가 역전되었습니다!",
        REVERSE_ONE_APPLIED: "영토의 시간대(낮/밤)가 역전되었습니다!",

        // 턴 시작 위기 및 파산
        CRISIS_TURN_TITLE: "자산 위기!",
        CRISIS_TURN_DESC: "현재 소지한 달러가 없습니다. 주사위를 굴리기 전, 자산을 매각하거나 긴급 대출(1회 순회 보상 × 현재 턴 / 10)을 받아 회생해야 합니다. (거부 시 파산)",
        CRISIS_TURN_SELL_BTN: "영토 매각",
        CRISIS_TURN_LOAN_BTN: "긴급 대출",
        CRISIS_TURN_GIVEUP_BTN: "포기 (파산)",
        CRISIS_LOAN_DONE: "긴급 대출 실행!",
        CRISIS_BANKRUPT: "파산!",
        CRISIS_NO_LOAN: "이미 대출 한도(2회)를 초과하여 불가능합니다.",

        // 이동 선택 UI
        MOVE_SELECT_TITLE: "이동 수치 선택",
        MOVE_SELECT_DESC: "원하는 이동 수치가 적힌 버튼을 클릭하세요.",
        MOVE_FORWARD_PREFIX: "앞으로 ",
        MOVE_BACKWARD_PREFIX: "뒤로 ",
        MOVE_SPACE_SUFFIX: "칸",
        IMMUNE_APPLIED: "카드 효과로 통행료가 면제되었습니다!",
        BBANGJU_IMMUNE_APPLIED: "[빵주 연구원] 기본 이용료(10만)가 면제되었습니다!",

        // 셰이디의 차원
        SHAYDI_TITLE: "셰이디의 차원",
        SHAYDI_DESC: "셰이디의 차원에 갇혔습니다! (1턴 강제 휴식)",
        SHAYDI_EVADE: "[림의 기역] 효과로 차원을 무사히 빠져나옵니다!",
        SHAYDI_TARGET_TITLE: "셰이디의 빅 이벤트 발동!",
        SHAYDI_TARGET_DESC: "셰이디의 차원으로 끌어들일 플레이어를 선택하세요.",
        SHAYDI_PULLED: "셰이디의 빅 이벤트에 의해 차원으로 끌려왔습니다! (1턴 강제 휴식)",

        // 인벤토리 & 사용 UI
        BTN_INVENTORY: "카드 사용",
        INV_TITLE: "보유 중인 사용형/보물 카드",
        INV_DESC: "사용할 카드를 선택하세요.",
        INV_EMPTY: "사용 가능한 카드가 없습니다.",
        BTN_USE: "사용하기",
        CANT_USE_NOW: "현재 이 카드를 사용할 수 있는 조건이나 대상이 없습니다.",

        // 특수 사용 팝업 및 결과
        USE_ESCAPE_TITLE: "네르의 소환장",
        USE_ESCAPE_DESC: "네르의 소환장을 사용하여 볼케니카에서 즉시 탈출하시겠습니까?",
        USE_ESCAPE_DONE: "[네르의 소환장] 볼케니카에서 즉시 탈출했습니다!",
        USE_DISCOUNT_TITLE: "시스트의 거래",
        USE_DISCOUNT_DESC: "카드를 사용하여 매입/건설 비용을 50% 할인 받으시겠습니까?",
        USE_LIBRARY_TITLE: "셰럼의 일일조교",
        USE_LIBRARY_DESC: "카드를 사용하여 도서관 통행료(50만)를 면제받고 능력을 획득하시겠습니까?",
        USE_LIBRARY_DONE: "[셰럼의 일일조교] 무료로 도서관 능력을 획득했습니다!",
        USE_VIP_TITLE: "VIP카드",
        USE_VIP_DESC: "VIP카드를 사용하여 통행료를 1회 면제하시겠습니까?",

        // 사용 성공 메시지 및 타겟 선택
        RUFO_DICE_USE: "루포의 주사위! +6 고정값 추가!",
        RUFO_DICE_WAIT: "루포의 주사위 발동 대기!",
        ERPIN_DICE_USE: "에르핀의 주사위가 준비되었습니다!",
        SIST_DEAL_PAID: "시스트의 거래 강제 비용을 지불했습니다.",
        TARGET_TITLE: "대상 선택",
        TARGET_EMPTY_LAND: "무료로 마을(2단계)까지 건설할 내 영토를 선택하세요. (마을 이상 건설 불가)",
        TARGET_UPGRADE: "무료로 1단계 증축할 내 영토를 선택하세요. (건물 없음 및 왕국 이상 증축 불가)",
        TARGET_LANDMARK: "엘리프 조각상으로 증축할 왕국(3단계) 영토를 선택하세요.",
        TARGET_SELL_HIGH: "1.5배 가격으로 매각할 내 영토를 선택하세요.",
        TARGET_TAKEOVER_ENEMY: "영토를 인수할 상대 플레이어를 선택하세요.",
        TARGET_TAKEOVER: "토지 매입가 + 통행료의 1.5배를 지불하고 인수할 상대 영토를 선택하세요.",
        TARGET_TERROR: "건물을 랜덤 철거(건설 단계 -2)할 상대 플레이어를 선택하세요.",
        TARGET_REVERSE_ONE: "시간대(낮/밤)를 역전시킬 내 영토를 선택하세요.",
        RES_BUILD: "마을(2단계) 무료 건설 완료!",
        RES_UPGRADE: "무료 증축 완료!",
        RES_LANDMARK: "엘리프 조각상 무료 건설 완료!",
        RES_SELL: "골디의 제안 매각 완료:",
        RES_TAKE: "인수 완료!",
        RES_DESTROY: "건물 철거(건설 단계 -2) 완료!",

        // 특수 카드 메시지
        SPEC_DOUBLE_DRAW_TOAST: "[밑장빼기] 다음번 차원 열쇠 카드 뽑기 시 2장을 뽑습니다!",
        SPEC_SHUFFLE_TOAST: "[뒤집어버리기] 사용된 모든 차원 이동 카드를 덱에 되돌리고 섞었습니다!",
        SPEC_TAKE_DAYA_TOAST: "[서열싸움] 다야의 궁전을 차지했습니다!",
        SPEC_INTRUDE_TITLE: "빵주 난입",
        SPEC_INTRUDE_DESC: "차원 열쇠 카드 칸을 제외한 원하는 칸으로 즉시 이동합니다.",
        SPEC_TIME_ACCEL_TOAST: "[시간가속] 남은 시간대가 최대 2턴 단축되었으며, 남은 현재 시간대 동안 주사위를 2번 굴립니다!",
        SPEC_TIME_ACCEL_EXTRA_ROLL: "[시간가속] 효과로 주사위를 한 번 더 굴릴 수 있습니다!",
        SPEC_TIME_ACCEL_FAIL: "현재 진행 중인 시간대(낮/밤)가 없어 사용할 수 없습니다.",
        SPEC_ODYSSEY_FAIL: "현재 보물 카드를 획득할 수 있는 조건이 아닙니다.",
        SPEC_WOLF_TITLE: "애증의 늑대",
        SPEC_WOLF_DESC: "보물 카드를 1장 빼앗아올 플레이어를 선택하세요.",
        SPEC_WOLF_DONE: "[애증의 늑대] 보물 카드를 빼앗아왔습니다:",
        SPEC_JUDGMENT_TOAST: "[심판의 시간] 그을음이 빛무리로 정화되며 [몽환살이]를 획득했습니다! (주사위 추가 굴림)",
        SPEC_WISH_TOAST: "[교주의 염원] 그을음이 빛무리로 정화되며 [염원살이]를 획득했습니다! (주사위 추가 굴림)",
        FORGOTTEN_TO_RECOVERED: "[잊혀진 기억]이 정령산 정상의 기운을 받아 [되찾은 기억]으로 변화했습니다!",
        ORIGIN_ELIF_ACQUIRED: "[태초의 엘리프] 정령산 정상의 가르침을 대가 없이 영구 고정 소유합니다!",

        // 보물 카드 메시지
        TREASURE_OBTAIN: "보물 카드를 획득했습니다!",
        TREASURE_CROWN_TURN: "[???의 왕관] 매 턴 보상 +15만 달러 획득!",
        TREASURE_STAFF_TURN: "[???의 지팡이] 부작용으로 유지비 15만 달러를 지불했습니다.",
        TREASURE_BOW_EXTRA_ROLL: "[???의 활] 효과로 주사위를 한 번 더 굴릴 수 있습니다!",
        TREASURE_BOW_VILLAGE_FAIL: "[???의 활] 부작용: 마을(2단계) 건설 비용이 부족하여 영토 구매를 포기합니다!",
        TREASURE_SHROUD_TITLE: "???의 수의 (지정 이동)",
        TREASURE_SHROUD_DESC: "이동할 칸 수(1~6칸)를 선택하세요.",
        TREASURE_ROPE_ENEMY_TITLE: "???의 밧줄 (강제 매각)",
        TREASURE_ROPE_ENEMY_DESC: "영토를 강제 매각시킬 상대 플레이어를 선택하세요.",
        TREASURE_ROPE_TILE_DESC: "강제 매각시킬 상대의 영토를 선택하세요.",
        TREASURE_ROPE_DONE: "[???의 밧줄] 상대 영토를 강제 매각시켰습니다:",
        TREASURE_STAFF_TILE_TITLE: "???의 지팡이 (영토 강탈)",
        TREASURE_STAFF_TILE_DESC: "대가 없이 빼앗아올 영토를 선택하세요. (특수 칸 제외)",
        TREASURE_STAFF_DONE: "[???의 지팡이] 영토를 대가 없이 빼앗아왔습니다:",
        TREASURE_DEBUFF_CANCELED: "상쇄됨",
        TREASURE_USES_LEFT: "남은 횟수:",

        // 대출 및 UI 문자열
        LOAN_EXECUTE: "대출 실행!",
        LOAN_DONE: "실행 완료",
        ALREADY_LOAN: "대출 횟수 초과로 불가능합니다.",
        BANKRUPT: "파산!",
        SELL_UNAVOIDABLE: "매각을 피할 수 없습니다.",

        // 정산 시스템 UI
        SETTLE_TITLE: "게임 종료! 최종 정산",
        SETTLE_ASSET: "총 정산액:",
        SETTLE_DEBT: "대출 청산:",
        SETTLE_FINAL: "최종 자산:",
        SETTLE_BANKRUPT: "(파산)",
        BTN_MAINMENU: "메인 메뉴로 돌아가기"
    },
    en: { /* 추후 로컬라이징 적용 */ },
    ja: { /* 추후 로컬라이징 적용 */ }
};
