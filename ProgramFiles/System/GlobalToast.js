/**
 * GlobalToast.js — #app 바깥(document.body 직속) 영구 토스트 레이어 유틸리티
 *
 * changeScene() 호출 시 #app.innerHTML 이 초기화되더라도
 * 환영 메시지 및 증명서 알림 토스트가 끊기지 않고 자연 소멸되도록 유지합니다.
 */

let _hideTimer = null;

/**
 * #app 바깥 영구 토스트 레이어를 반환하거나 생성한다.
 * @returns {HTMLElement|null}
 */
export function ensureGlobalToastLayer() {
    if (typeof document === 'undefined' || !document.body) return null;
    let layer = document.getElementById('arena-global-toast-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'arena-global-toast-layer';
        layer.style.cssText = `
            position: fixed;
            bottom: 38px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 25000;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            max-width: 90vw;
        `;
        document.body.appendChild(layer);
    }
    return layer;
}

/**
 * #app 바깥 레이어에 영구 토스트를 출력한다. (씬 전환 중에도 유지됨)
 * @param {string} msg
 * @param {number} [duration=2800]
 * @param {string} [accentColor='#f1c40f']
 */
export function showGlobalArenaToast(msg, duration = 2800, accentColor = '#f1c40f') {
    const layer = ensureGlobalToastLayer();
    if (!layer || !msg) return;

    if (_hideTimer) {
        clearTimeout(_hideTimer);
        _hideTimer = null;
    }

    layer.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = 'arena-global-toast-item';
    toast.style.cssText = `
        background: rgba(68, 35, 16, 0.96);
        color: #FFF7DF;
        padding: 15px 32px;
        border-radius: 16px;
        font-size: clamp(16px, 1.4vw, 22px);
        font-weight: bold;
        border: 3px solid ${accentColor};
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.48);
        text-align: center;
        white-space: pre-wrap;
        word-break: keep-all;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.22s ease, transform 0.22s ease;
        font-family: inherit;
    `;
    toast.innerText = msg;
    layer.appendChild(toast);

    const reveal = () => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(reveal);
    } else {
        reveal();
    }

    const fadeDelay = Math.max(400, duration - 250);
    _hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        _hideTimer = setTimeout(() => {
            if (toast.parentNode) toast.remove();
            _hideTimer = null;
        }, 260);
    }, fadeDelay);
}
