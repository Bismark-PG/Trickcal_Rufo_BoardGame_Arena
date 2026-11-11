export const LangState = {
    current: 'ko', // 기본 언어
    set(lang) {
        this.current = lang;
        // 언어 변경 시 이벤트를 발생시켜 UI들이 스스로 새로고침 하도록 유도 (브라우저 환경 전용)
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new Event('languageChanged'));
        }
    }
};