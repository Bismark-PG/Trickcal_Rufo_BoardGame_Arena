/**
 * ArenaOnboardingIndex.js — 아레나 온보딩 로딩, 주민 증명서(닉네임) 풀, 로딩 팁, 공용 정보 팝업 다국어 인덱스
 *
 * 지침: 모든 UI 문구·단어 풀·금지어·팁·검증 토스트는 본 인덱스에서 관리하며 로직 파일에 하드코딩하지 않습니다.
 */

export const ONBOARDING_LIMITS = {
    MAX_NICKNAME_LENGTH: 12,
    MAX_JAPANESE_NICKNAME_LENGTH: 12,
    INPUT_MAX_LENGTH: 12,
    JAPANESE_CHAR_REGEX: /[\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\u4E00-\u9FFF\u30FC]/,
    ALLOWED_CHAR_REGEX: /^[가-힣a-zA-Z0-9 \u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F\u4E00-\u9FFF\u30FC]+$/,
    FORBIDDEN_TERMS: ['bismark'],
    EASTER_EGG_NICK: '교주',
    MASTER_EXACT_TERMS: ['교주', 'master', '教主', 'きょうしゅ'],
    MASTER_REGEX: /(교주|master|教主|きょうしゅ)/i,
    TIG_EXACT_TERMS: ['티그', 'tig', 'ティグ'],
    BENI_EXACT_TERMS: ['베니', 'beni', 'ベニ', 'ベニー'],
    BEASTKIN_REGEX: /(수인|werebeasts?|獣人|じゅうじん|けもの)/i,
    ELF_REGEX: /(엘프|elves|elf|エルフ|えるふ)/i,
    TIP_ROTATE_MS: 5000,
    WELCOME_TOAST_MS: 2800,
    REMEMBERED_NICK_STORAGE_KEY: 'rufo_remembered_nickname',
    SESSION_NICK_STORAGE_KEY: 'rufo_nickname'
};

export const ARENA_PROJECT_INFO = {
    VERSION_LABEL: '알파 1.0'
};

export const ARENA_LEGAL_NOTICE_LINES = [
    '본 게임은 (주)에피드게임즈의 「트릭컬 리바이브」 IP를 기반으로 제작된 비공식 2차 창작 창작물입니다.',
    '원작의 지적재산권 대한 모든 저작권 및 권리는 원저작권자 (주)에피드게임즈 에게 귀속되며, 사용된 리소스의 무단 추출 및 재배포를 금합니다.',
    '본 게임은 상업적 목적 없이 비영리로 운영되며, 게임 및 제작자는 어떠한 수익 창출 / 광고 / 후원을 받지 않습니다.',
    '또한, 원저작권자의 권리 침해 우려, 중단 요청이 있을 경우 즉시 서비스를 종료하며, 운영자 사정에 따라 사전 공지 없이 주말농장에 갈 수도 있습니다.'
];

export function getNicknameMaxLength(_trimmedNick) {
    return ONBOARDING_LIMITS.MAX_NICKNAME_LENGTH;
}

/**
 * 엘리아스 주민 랜덤 닉네임 조합 풀 (한/영/일 모두 12자 이하 조합)
 * 조합 공식: [수식어] (+ separator) + [성격] (+ separator) + [종족]
 */
export const NICKNAME_POOLS = {
    ko: {
        separator: ' ',
        modifiers: [
            '배고픈', '배부른', '야근하는', '잠만자는', '멍때리는',
            '하찮은', '말랑한', '졸려죽는', '현타온', '해탈한',
            '쌩쌩한', '수상한', '길잃은', '봉인당한'
        ],
        personalities: ['광기의', '냉정한', '순수한', '활발한', '우울한'],
        races: ['요정', '수인', '엘프', '정령', '유령', '용족', '마녀', '미스틱']
    },
    en: {
        separator: ' ',
        modifiers: ['Shy', 'Big', 'Tiny', 'Lost', 'Busy', 'Lazy', 'Bold', 'Cute', 'Warm', 'Cool'],
        personalities: ['Mad', 'Calm', 'Pure', 'Wild', 'Blue'],
        races: ['Fae', 'Elf', 'Fox', 'Imp', 'Kin', 'Cat', 'Owl']
    },
    ja: {
        separator: '',
        modifiers: ['ねむい', 'はらぺこ', 'ぷにぷに', 'まいごの', 'げんきな', 'あやしい', 'のんびり', 'ざんぎょう'],
        personalities: ['狂気の', '冷静な', '純粋な', '活発な', '憂鬱な'],
        races: ['妖精', '獣人', 'エルフ', '精霊', '幽霊', '竜族', '魔女']
    }
};

/**
 * 아레나 및 엘리아스 마블 관련 로딩 팁 목록 (비복원 무작위 순환)
 */
export const LOADING_TIPS = {
    ko: [
        '정보를 통해 오류를 제보할 수 있는것이다.',
        '루포는 최고의 전략가인 것이다!',
        '요즘 대장이 재미가 없어진 것이다...',
        '그 엘프 말이냐? 그 녀석은 개못해서 재미없는 것이다!',
        '게임이 망한 게 내 탓은 아닌 것이다!',
        '속임수...? 그..그런거 안썼단 말이다...!',
        '교주! 놀러온 것이냐? ...모험회? 앗...',
        '레비라는 녀석이 나를 왠지모르게 측운하게 보는 것이다...',
        '폭스테일...? 내 꼬리를 만지고 싶은것이냐?',
        '고블린 무녀...? 요미라는 녀석을 말하는 것이냐?',
        '요즘 여우인척 연기하는 애들이 많아진 것이다,,,',
        '보드게임은 머리가 나빠도 즐길 수 있는 게임인 것이다!'
    ],
    en: [
        'Owning the Witch Library in Elias Marble extends the Dimension Key confirm timer to 10s!',
        'Resident names up to 12 characters can be shared with others without conflict.',
        'Click [Remember Name!] to easily restore your certificate next time with [Show Previous Certificate!].',
        'You can change your nickname or report bugs anytime via the top-right [Info] button!',
        'When the host starts the countdown in a room, [Settings] and [Info] are locked until match start.'
    ],
    ja: [
        'エリアスマーブルで魔女図書館を所持していると、次元鍵の確認時間が10秒に延びるのだ！',
        '証明書の名は12文字以下なら重複しても問題ないのだ！',
        '[名前を記憶する！]を押しておけば、次回も[前の証明書を見せる！]で簡単に呼び出せるのだ！',
        'ゲーム中でも右上の[情報]ボタンから名前の変更やバグ報告ができるのだ！',
        '待機部屋でカウントダウンが始まると[設定]と[情報]がロックされるのだ！'
    ]
};

export const OnboardingLang = {
    ko: {
        // 부팅 로딩 온보딩
        WELCOME_HEADING: '루포의 보드게임 아레나에 온 걸 환영하는 것이다!',
        CERTIFICATE_PROMPT: '너의 증명서를 보여주는 것이다!',
        CERT_CARD_TITLE: '🪪 엘리아스 주민 증명서',
        NICKNAME_LIMIT_PILL: '한/영/일/숫자 최대 12자',
        NICKNAME_PLACEHOLDER: '주민 이름 입력 (최대 12자)',
        BTN_RANDOM_NICK: '🎲 랜덤',
        BTN_REMEMBER_NICK: '📝 이름 기억하기!',
        BTN_RESTORE_PREV_NICK: '📜 이전 증명서 보여주기!',
        BTN_ENTER_ARENA: '🎮 아레나에 뛰어들기!',
        TIP_PREFIX: '💡 팁 : ',
        STAGE_DESC_ARENA: '아레나 기본 리소스 가져오는중...',
        STAGE_DESC_GAME_PREFIX: '',
        STAGE_DESC_GAME_SUFFIX: ' 리소스 가져오는중...',
        LOADING_SLOW_HINT: '네트워크가 지연되고 있다면 바로 이동할 수 있습니다.',
        BTN_SKIP_LOADING: '건너뛰고 아레나로 입장 →',
        LOADING_RUFO_CLICK_TOAST: '🦊 어서 오는것이다! 어서 너의 멋진 이름이 적힌 증명서를 보여주는것이다!',
        CERT_REQUIRED_TITLE: '🪪 먼저 증명서를 보여주는 것이다!',
        CERT_REQUIRED_HIGHLIGHT: '[📝 이름 기억하기!]',
        CERT_REQUIRED_DESC_SUFFIX: ' 버튼을 눌러주어야 들어보내줄 수 있는것이다!',
        CERT_REQUIRED_OK: '알았다는것이다',
        GAME_NAMES: {
            marble: '엘리아스 마블',
            unos: '우노스 (UNOS)'
        },

        // 환영 토스트 & 검증 메시지 / 다국어 이스터에그(한국어 출력 통일)
        WELCOME_TOAST: '루포의 보드게임 아레나에 온 걸 환영하는 것이다!',
        ERR_NICK_EMPTY: '증명서에 적을 이름을 입력해 주는 것이다!',
        ERR_NICK_TOO_LONG: '이름이 너무 길어서 부르기 힘든 것이다...',
        ERR_NICK_INVALID_CHARS: '이름은 한글, 영문, 일본어, 숫자, 공백만 사용할 수 있는 것이다!',
        ERR_NICK_FORBIDDEN: '그 이름은 내 친구의 이름인것이다! 넌 가짜인 것이다!',
        MSG_NICK_EASTER_EGG: '교주! 나랑 놀아주러 온것이냐? 크흠...빨리 준비나 하는것이다!',
        MSG_NICK_EASTER_EGG_MODIFIED: '교주...? 뭔가 이름이 이상해진 것이다...',
        MSG_NICK_EASTER_TIG: '대장! 어서오는것이다!',
        MSG_NICK_EASTER_BENI: '으앗! 베니! 손에 묻은 꿀은 닦고 오는것이다!',
        MSG_NICK_EASTER_BEASTKIN: '흐음? 사료스탕스의 새로운 맴버인것이냐? 환영한다!',
        MSG_NICK_SAVED: '반갑다 {nickname}! 너의 증명서는 잘 확인한 것이다!',
        ERR_COUNTDOWN_LOCKED: '게임 시작 카운트다운 중에는 정보 창을 열 수 없습니다.',

        // 공용 [정보] 팝업
        BTN_INFO: 'ℹ️ 정보',
        INFO_MODAL_TITLE: 'ℹ️ 프로젝트 정보',
        INFO_SECTION_PROJECT: '🎲 루포의 보드게임 아레나',
        INFO_PROJECT_NAME: '루포의 보드게임 아레나',
        INFO_PROJECT_VERSION_LABEL: '현재 버전',
        INFO_PROJECT_VERSION_VALUE: '알파 1.0',
        INFO_PROJECT_DESC: '현재 버전 : 알파 1.0\n「트릭컬 리바이브」의 비공식 팬메이드 2차 창작 게임프로젝트입니다.\n비정기적으로 업데이트되며, 사정에의해 중단될수도 있습니다.',
        INFO_PROJECT_DESC_LINES: [
            '현재 버전 : 알파 1.0',
            '「트릭컬 리바이브」의 비공식 팬메이드 2차 창작 게임프로젝트입니다.',
            '비정기적으로 업데이트되며, 사정에의해 중단될수도 있습니다.'
        ],
        INFO_BTN_HELP: '❓ 도움말',
        INFO_BTN_TERMS: '📜 이용약관',
        HELP_MODAL_TITLE: '❓ 도움말',
        HELP_MODAL_PLACEHOLDER_TITLE: '도움말을 준비 중인 것이다!',
        HELP_MODAL_PLACEHOLDER_DESC: '아레나 이용 방법과 종목별 상세 안내는 추후 업데이트될 예정입니다. 궁금한 점이나 제안은 [정보 → 건의하기]로 남겨 주세요!',
        TERMS_MODAL_TITLE: '📜 이용약관 및 저작권 안내',
        INFO_SECTION_CERT: '🪪 내 증명서 (닉네임 변경)',
        INFO_BTN_CHANGE_NICK: '변경',
        INFO_SECTION_FEEDBACK: '📢 버그 제보 및 건의하기',
        INFO_FEEDBACK_DESC: '게임 이용 중 발견한 버그나 새로운 아이디어를 개발자에게 전달할 수 있습니다.',
        INFO_BTN_BUG: '🐛 버그 제보',
        INFO_BTN_SUGGEST: '💡 건의하기',
        INFO_BTN_CLOSE: '닫기'
    },
    en: {
        WELCOME_HEADING: 'Welcome to Rufo\'s Board Game Arena!',
        CERTIFICATE_PROMPT: 'Show me your resident certificate!',
        CERT_CARD_TITLE: '🪪 Elias Resident Certificate',
        NICKNAME_LIMIT_PILL: 'Max 12 chars',
        NICKNAME_PLACEHOLDER: 'Enter nickname (max 12)',
        BTN_RANDOM_NICK: '🎲 Random',
        BTN_REMEMBER_NICK: '📝 Remember Name!',
        BTN_RESTORE_PREV_NICK: '📜 Show Previous!',
        BTN_ENTER_ARENA: '🎮 Jump into the Arena!',
        TIP_PREFIX: '💡 Tip : ',
        STAGE_DESC_ARENA: 'Fetching core Arena resources...',
        STAGE_DESC_GAME_PREFIX: 'Fetching ',
        STAGE_DESC_GAME_SUFFIX: ' resources...',
        LOADING_SLOW_HINT: 'Taking a while? You can enter the Arena right away.',
        BTN_SKIP_LOADING: 'Skip & Enter Arena →',
        LOADING_RUFO_CLICK_TOAST: '🦊 어서 오는것이다! 어서 너의 멋진 이름이 적힌 증명서를 보여주는것이다!',
        CERT_REQUIRED_TITLE: '🪪 먼저 증명서를 보여주는 것이다!',
        CERT_REQUIRED_HIGHLIGHT: '[📝 이름 기억하기!]',
        CERT_REQUIRED_DESC_SUFFIX: ' 버튼을 눌러주어야 들어보내줄 수 있는것이다!',
        CERT_REQUIRED_OK: '알았다는것이다',
        GAME_NAMES: {
            marble: 'Elias Marble',
            unos: 'UNOS'
        },

        WELCOME_TOAST: '루포의 보드게임 아레나에 온 걸 환영하는 것이다!',
        ERR_NICK_EMPTY: 'Please enter a name for your certificate!',
        ERR_NICK_TOO_LONG: 'That name is too long to call out...',
        ERR_NICK_INVALID_CHARS: 'Names may only contain Korean, English letters, Japanese characters, numbers, and spaces!',
        ERR_NICK_FORBIDDEN: '그 이름은 내 친구의 이름인것이다! 넌 가짜인 것이다!',
        MSG_NICK_EASTER_EGG: '교주! 나랑 놀아주러 온것이냐? 크흠...빨리 준비나 하는것이다!',
        MSG_NICK_EASTER_EGG_MODIFIED: '교주...? 뭔가 이름이 이상해진 것이다...',
        MSG_NICK_EASTER_TIG: '대장! 어서오는것이다!',
        MSG_NICK_EASTER_BENI: '으앗! 베니! 손에 묻은 꿀은 닦고 오는것이다!',
        MSG_NICK_EASTER_BEASTKIN: '흐음? 사료스탕스의 새로운 맴버인것이냐? 환영한다!',
        MSG_NICK_SAVED: '반갑다 {nickname}! 너의 증명서는 잘 확인한 것이다!',
        ERR_COUNTDOWN_LOCKED: 'Cannot open Info while the start countdown is active.',

        BTN_INFO: 'ℹ️ Info',
        INFO_MODAL_TITLE: 'ℹ️ Project Info',
        INFO_SECTION_PROJECT: '🎲 Rufo\'s Board Game Arena',
        INFO_PROJECT_NAME: 'Rufo\'s Board Game Arena',
        INFO_PROJECT_VERSION_LABEL: 'Version',
        INFO_PROJECT_VERSION_VALUE: 'Alpha 1.0',
        INFO_PROJECT_DESC: 'Current Version : Alpha 1.0\nAn unofficial fan-made derivative game project based on Trickcal: Revive.\nUpdated irregularly and may be discontinued depending on circumstances.',
        INFO_PROJECT_DESC_LINES: [
            'Current Version : Alpha 1.0',
            'An unofficial fan-made derivative game project based on Trickcal: Revive.',
            'Updated irregularly and may be discontinued depending on circumstances.'
        ],
        INFO_BTN_HELP: '❓ Help',
        INFO_BTN_TERMS: '📜 Terms',
        HELP_MODAL_TITLE: '❓ Help',
        HELP_MODAL_PLACEHOLDER_TITLE: 'Help guide is coming soon!',
        HELP_MODAL_PLACEHOLDER_DESC: 'Detailed Arena and game guides will be added in a future update. Feel free to send questions or ideas via [Info → Suggestion].',
        TERMS_MODAL_TITLE: '📜 Terms & Copyright Notice',
        INFO_SECTION_CERT: '🪪 My Certificate (Nickname)',
        INFO_BTN_CHANGE_NICK: 'Apply',
        INFO_SECTION_FEEDBACK: '📢 Bug Report & Suggestions',
        INFO_FEEDBACK_DESC: 'Send bug reports or suggestions directly to the developer.',
        INFO_BTN_BUG: '🐛 Bug Report',
        INFO_BTN_SUGGEST: '💡 Suggestion',
        INFO_BTN_CLOSE: 'Close'
    },
    ja: {
        WELCOME_HEADING: 'ルポのボードゲームアリーナへようこそなのだ！',
        CERTIFICATE_PROMPT: 'お前の証明書を見せるのだ！',
        CERT_CARD_TITLE: '🪪 エリアス住民証明書',
        NICKNAME_LIMIT_PILL: '最大12文字',
        NICKNAME_PLACEHOLDER: 'ニックネーム入力 (最大12文字)',
        BTN_RANDOM_NICK: '🎲 ランダム',
        BTN_REMEMBER_NICK: '📝 名前を記憶する！',
        BTN_RESTORE_PREV_NICK: '📜 前の証明書を見せる！',
        BTN_ENTER_ARENA: '🎮 アリーナに飛び込む！',
        TIP_PREFIX: '💡 ヒント : ',
        STAGE_DESC_ARENA: 'アリーナ基本リソースを取得中...',
        STAGE_DESC_GAME_PREFIX: '',
        STAGE_DESC_GAME_SUFFIX: ' リソースを取得中...',
        LOADING_SLOW_HINT: '読み込みが遅い場合はそのまま入場できます。',
        BTN_SKIP_LOADING: 'スキップして入場 →',
        LOADING_RUFO_CLICK_TOAST: '🦊 어서 오는것이다! 어서 너의 멋진 이름이 적힌 증명서를 보여주는것이다!',
        CERT_REQUIRED_TITLE: '🪪 먼저 증명서를 보여주는 것이다!',
        CERT_REQUIRED_HIGHLIGHT: '[📝 이름 기억하기!]',
        CERT_REQUIRED_DESC_SUFFIX: ' 버튼을 눌러주어야 들어보내줄 수 있는것이다!',
        CERT_REQUIRED_OK: '알았다는것이다',
        GAME_NAMES: {
            marble: 'エリアスマーブル',
            unos: 'ウノス (UNOS)'
        },

        WELCOME_TOAST: '루포의 보드게임 아레나에 온 걸 환영하는 것이다!',
        ERR_NICK_EMPTY: '証明書に書く名前を入力するのだ！',
        ERR_NICK_TOO_LONG: '名前が長すぎて呼びにくいのだ…',
        ERR_NICK_INVALID_CHARS: '名前には日本語・ハングル・英字・数字・空白のみ使用できるのだ！',
        ERR_NICK_FORBIDDEN: '그 이름은 내 친구의 이름인것이다! 넌 가짜인 것이다!',
        MSG_NICK_EASTER_EGG: '교주! 나랑 놀아주러 온것이냐? 크흠...빨리 준비나 하는것이다!',
        MSG_NICK_EASTER_EGG_MODIFIED: '교주...? 뭔가 이름이 이상해진 것이다...',
        MSG_NICK_EASTER_TIG: '대장! 어서오는것이다!',
        MSG_NICK_EASTER_BENI: '으앗! 베니! 손에 묻은 꿀은 닦고 오는것이다!',
        MSG_NICK_EASTER_BEASTKIN: '흐음? 사료스탕스의 새로운 맴버인것이냐? 환영한다!',
        MSG_NICK_SAVED: '반갑다 {nickname}! 너의 증명서는 잘 확인한 것이다!',
        ERR_COUNTDOWN_LOCKED: 'カウントダウン中は情報ウィンドウを開けません。',

        BTN_INFO: 'ℹ️ 情報',
        INFO_MODAL_TITLE: 'ℹ️ プロジェクト情報',
        INFO_SECTION_PROJECT: '🎲 ルポのボードゲームアリーナ',
        INFO_PROJECT_NAME: 'ルポのボードゲームアリーナ',
        INFO_PROJECT_VERSION_LABEL: 'バージョン',
        INFO_PROJECT_VERSION_VALUE: 'Alpha 1.0',
        INFO_PROJECT_DESC: '現在バージョン : Alpha 1.0\n『トリッカル・もちもちほっペ大作戦』の非公式ファンメイド二次創作ゲームプロジェクトです。\n不定期でアップデートされ、事情により中断される場合があります。',
        INFO_PROJECT_DESC_LINES: [
            '現在バージョン : Alpha 1.0',
            '『トリッカル・もちもちほっペ大作戦』の非公式ファンメイド二次創作ゲームプロジェクトです。',
            '不定期でアップデートされ、事情により中断される場合があります。'
        ],
        INFO_BTN_HELP: '❓ ヘルプ',
        INFO_BTN_TERMS: '📜 利用規約',
        HELP_MODAL_TITLE: '❓ ヘルプ',
        HELP_MODAL_PLACEHOLDER_TITLE: 'ヘルプページを準備中なのだ！',
        HELP_MODAL_PLACEHOLDER_DESC: 'アリーナの遊び方や各ゲームの詳しい案内は今後のアップデートで追加予定です。ご要望は[情報 → ご意見]からお送りください。',
        TERMS_MODAL_TITLE: '📜 利用規約・著作権のご案内',
        INFO_SECTION_CERT: '🪪 自分の証明書 (ニックネーム変更)',
        INFO_BTN_CHANGE_NICK: '変更',
        INFO_SECTION_FEEDBACK: '📢 バグ報告・ご意見',
        INFO_FEEDBACK_DESC: 'プレイ中に見つけたバグやアイデアを開発者に送ることができます。',
        INFO_BTN_BUG: '🐛 バグ報告',
        INFO_BTN_SUGGEST: '💡 ご意見',
        INFO_BTN_CLOSE: '閉じる'
    }
};
