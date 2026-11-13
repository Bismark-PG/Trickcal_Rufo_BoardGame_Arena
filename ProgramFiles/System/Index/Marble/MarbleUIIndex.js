export const MarbleLang = {
    ko: {
        TILE_START: "시작", TILE_ISLAND: "무인도", TILE_FUND: "발전기금", TILE_PORTAL: "차원이동장치", TILE_CARD: "차원이동카드", TILE_NORMAL: "칸",
        ROLL_DICE: "주사위 굴리기 🎲", CURRENT_TURN: "현재 턴:", REMAIN_TIME: "남은 시간:", SEC: "초",
        PLAYER_ME: "플레이어 (나)", NPC: "NPC", MONEY: "소지금:", TERRITORY: "영토:", EA: "개", CURRENCY: "엘드르 달러",
        BADGE_CHIEF: "🔧 정비반장", BADGE_CHIEF_SHORT: "🔧 반장", RANK_SUFFIX: "위",
        ROLLING: "주사위 굴리는 중...", RESULT: "결과:", MOVE: "이동!",
        EVENT: "이벤트", CLOSE: "닫기", BUY_CANCEL: "구매 안함", PORTRAIT: "초상화",
        
        PORTAL_TITLE: "빵주 탑승", PORTAL_DESC: "이동할 곳을 선택하세요.", PORTAL_FEE_LABEL: "이용료:", PORTAL_FREE: "무료 (정비반장)", PORTAL_CANCEL: "포기하기",
        BUY_TITLE: "구매", BUY_DESC: "어떤 건물을 지으시겠습니까?",
        TOLL_TITLE: "통행료 지불", TOLL_DESC: "의 영토입니다.", NOT_ENOUGH_MONEY: "비용이 부족합니다!",
        
        // 토스트 UI 및 시스템 메시지
        TOAST_START: "시작 지점 통과! 순회 보상 획득!",
        TOAST_MOON: "달바라기 정원 도착! 50만 달러 획득!",
        TOAST_VOID: "아공간으로 빨려들어갑니다... (다음 턴 탈출 미니게임)",
        TOAST_ESCAPE_SUCCESS: "주사위 더블! 휴가지에서 탈출합니다!",
        TOAST_ESCAPE_FAIL: "탈출 실패! 푹 쉬다 가세요...",
        TOAST_NO_MONEY_BUY: "자금이 부족하여 토지를 매입할 수 없습니다.",
        TOAST_RESTING: "휴식 중입니다...",
        TOAST_SELL_DONE: "자산 매각 후 통행료 지불 완료",
        TOAST_CANT_AVOID_SELL: "매각을 피할 수 없습니다.",
        
        // 팝업 텍스트
        VOLCANICA_TITLE: "볼케니카로의 휴가", VOLCANICA_DESC: "2턴간 휴식합니다. 주사위 더블이 나오면 즉시 탈출합니다!",
        MOUNTAIN_TITLE: "정령산 정상", MOUNTAIN_DESC: "매 턴 15만 달러를 지불하고 정령의 기운(통행료 1.2배 버프)을 얻으시겠습니까?",
        LAKE_TITLE: "정령 호수", LAKE_DESC: "아름다운 호수입니다. 어떻게 행동하시겠습니까?",
        LAKE_BTN_REST: "1턴 강제 휴식 (무료)", LAKE_BTN_ROLL: "통행료 지불 후 다시 굴리기 (60만)", LAKE_BTN_SUMMON: "통행료 1.5배 지불 후 플레이어 호출 (90만)",
        MONATIUM_EXPAND: "확장하기", THEATER_TAKEOVER: "인수하기 (30만)",
        
        // 매각 및 대상 선택 UI
        SELL_TITLE: "자산 매각", SELL_TARGET: "목표 금액:", SELL_SELECTED: "선택된 금액:",
        SELL_CONFIRM: "매각 확정", SELL_BACK: "뒤로 가기",
        TARGET_TITLE: "대상 선택", TARGET_DESC: "카드 효과를 적용할 대상을 선택하세요.", TARGET_CANCEL: "취소",
        
        BTN_YES: "수락", BTN_NO: "거절", BTN_USE: "사용", BTN_HOLD: "보류",

        // 건물 명칭
        BLD_0: "영토만",
        BLD_1: "오두막",
        BLD_2: "마을",
        BLD_3: "왕국",
        BLD_4: "엘리프 조각상",

        // 대출 및 위기 UI 문자열
        CRISIS_TITLE: "자금 부족!",
        CRISIS_DESC_SELL_OR_LOAN: "통행료가 부족합니다.<br>영토를 매각하거나 대출을 받아야 합니다.",
        CRISIS_DESC_LOAN_ONLY: "매각 가능한 자산이 부족하여 대출만 가능합니다.",
        CRISIS_REQ_LABEL: "요구액:",
        BTN_CRISIS_SELL: "영토 매각",
        BTN_CRISIS_LOAN: "대출 받기",
        BTN_REPAY_LOAN: "대출 상환",
        LOAN_REPAY_TITLE: "대출 중도 상환",
        LOAN_REPAY_DESC: "이번 턴 주사위를 굴리기 전에 대출금을 상환할 수 있습니다.\n(원금 완납 후 남은 이자는 이자 없는 새 원금으로 전환되며, 피라의 대부업명함 보유 시 0.5배·5% 이자가 적용됩니다)",
        LOAN_REPAY_ALL_BTN: "모두 갚기 (원금+이자)",
        LOAN_REPAY_SKIP_BTN: "갚지 않음",
        LOAN_REPAY_TOAST: "대출 상환 완료:",
        LOAN_REPAY_CONVERT_TOAST: "(원금 완납 후 잔여 이자가 새 원금으로 전환됨)",
        LOAN_REPAY_FULL_TOAST: "대출 전액 상환 완료!",
        LOAN_EXECUTE: "긴급 대출 실행!",
        LOAN_DONE: "실행 후 지불 완료",
        ALREADY_LOAN: "이미 대출이 있어 불가능합니다.",
        BANKRUPT: "파산!",
        
        SELL_UNAVOIDABLE: "매각을 피할 수 없습니다.",

        // 정산 시스템 UI
        SETTLE_TITLE: "게임 종료! 최종 정산",
        SETTLE_ASSET: "총 정산액:",
        SETTLE_DEBT: "대출 청산:",
        SETTLE_FINAL: "최종 자산:",
        SETTLE_BANKRUPT: "(파산)",
        BTN_MAINMENU: "메인 메뉴로 돌아가기",

        // 잠수(자리비움) 자동 AI 전환 경고 오버레이
        AFK_WARN_TITLE: "자리비움 자동 진행 안내",
        AFK_WARN_DESC: "자리비움으로 인해 자동으로 플레이가 되고있습니다.\n한번 더 자리를 비울 시에는 의도적 방해로 간주되며, 원활한 게임의 진행을 위해 퇴장조치됩니다.\n게임으로 돌아가려면 확인을 눌러주세요.",
        AFK_WARN_BTN: "확인",

        // 시작 전 주사위 순번 결정 팝업
        TURN_ORDER_TITLE: "플레이 순번 결정",
        TURN_ORDER_DESC: "두 개의 주사위를 굴려 게임 시작 순번을 결정합니다. (주사위 합이 높을수록 1번에 배정)",
        TURN_ORDER_ROLL_BTN: "주사위 굴리기 🎲",
        TURN_ORDER_WAIT_OTHERS: "다른 플레이어가 주사위를 굴리기를 기다리는 중...",
        TURN_ORDER_TIE_NOTICE: "동률이 발생하여 동률 플레이어의 주사위를 자동으로 재굴림합니다!",
        TURN_ORDER_RESULT_TITLE: "최종 순번 결정 완료!",
        TURN_ORDER_RESULT_DESC: "잠시 후 새롭게 배정된 1번 플레이어부터 게임을 시작합니다.",
        TURN_ORDER_SUM_LABEL: "주사위 합:",
        TURN_ORDER_REROLL_TAG: "(동률 재굴림)",
        TURN_ORDER_RANK_SUFFIX: "등",
        TURN_ORDER_ROLLED_TAG: "완료",
        TURN_ORDER_WAITING_TAG: "대기중",
        TURN_ORDER_AUTO_START_PREFIX: "자동 시작까지"
    },
    
    en: { /* 생략 - 추후 로컬라이징 적용 */ },
    ja: { /* 생략 - 추후 로컬라이징 적용 */ }
};