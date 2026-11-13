import { changeScene } from '../Main.js';
import { LangState } from '../System/LanguageManager.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { RoomManager } from './RoomManager.js';
import { escapeHtml, showLobbyToast } from './LobbyUI.js';

/**
 * 메인 아레나 화면에서 룸 코드를 입력해 해당하는 게임의 대기방으로 바로 이동하는 빠른 참가 모달.
 */
export function openQuickJoinModal(container) {
    if (!container) return;

    const existing = container.querySelector('#modal-quick-join');
    if (existing) existing.remove();

    const text = LobbyLang[LangState.current] || LobbyLang.ko;
    const currentNick = RoomManager.localPlayer?.name || '';

    const modal = document.createElement('div');
    modal.id = 'modal-quick-join';
    modal.style.cssText = 'position: absolute; inset: 0; background: rgba(0, 0, 0, 0.62); display: flex; align-items: center; justify-content: center; z-index: 1500; padding: 20px;';
    modal.innerHTML = `
        <div style="background: #165b7a; border: 3px solid #f1c40f; border-radius: 24px; padding: 34px; width: 520px; max-width: 92vw; color: #fff; box-shadow: 0 18px 40px rgba(0,0,0,0.35); font-family: inherit;">
            <h2 style="margin: 0 0 10px 0; font-size: 28px; color: #f1c40f;">⚡ ${escapeHtml(text.QUICK_JOIN_TITLE)}</h2>
            <p style="margin: 0 0 22px 0; font-size: 16px; color: #d6eaf8; line-height: 1.5;">${escapeHtml(text.QUICK_JOIN_DESC)}</p>

            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div>
                    <label for="input-quick-code" style="display: block; margin-bottom: 6px; font-size: 16px; font-weight: bold; color: #f9e79f;">${escapeHtml(text.JOIN_CODE_LABEL)}</label>
                    <input id="input-quick-code" type="text" maxlength="16" autocomplete="off" placeholder="${escapeHtml(text.JOIN_CODE_PLACEHOLDER)}"
                        style="width: 100%; box-sizing: border-box; padding: 13px 16px; font-size: 22px; font-family: inherit; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; border: 2px solid #2e86c1; border-radius: 12px; background: #fff; color: #1b2631;" />
                    <div style="margin-top: 6px; font-size: 13px; color: #aed6f1;">${escapeHtml(text.JOIN_CODE_HINT)}</div>
                </div>

                <div>
                    <label for="input-quick-password" style="display: block; margin-bottom: 6px; font-size: 15px; color: #d6eaf8;">${escapeHtml(text.JOIN_PASSWORD_OPTIONAL)}</label>
                    <input id="input-quick-password" type="password" maxlength="20" autocomplete="off"
                        style="width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 17px; font-family: inherit; border: 2px solid #2e86c1; border-radius: 12px; background: #fff; color: #1b2631;" />
                </div>

                <div>
                    <label for="input-quick-nick" style="display: block; margin-bottom: 6px; font-size: 15px; color: #d6eaf8;">${escapeHtml(text.QUICK_JOIN_NICK_LABEL)}</label>
                    <input id="input-quick-nick" type="text" maxlength="16" value="${escapeHtml(currentNick)}"
                        style="width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 17px; font-family: inherit; border: 2px solid #2e86c1; border-radius: 12px; background: #fff; color: #1b2631;" />
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 26px;">
                <button id="btn-quick-cancel" type="button" style="font-family: inherit; padding: 12px 24px; font-size: 18px; background: #34495e; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.BTN_CANCEL)}</button>
                <button id="btn-quick-submit" type="button" style="font-family: inherit; padding: 12px 26px; font-size: 18px; font-weight: bold; background: #f39c12; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtml(text.QUICK_JOIN_SUBMIT)}</button>
            </div>
        </div>
    `;

    container.appendChild(modal);

    const codeInput = modal.querySelector('#input-quick-code');
    const pwInput = modal.querySelector('#input-quick-password');
    const nickInput = modal.querySelector('#input-quick-nick');
    const cancelBtn = modal.querySelector('#btn-quick-cancel');
    const submitBtn = modal.querySelector('#btn-quick-submit');

    let isSubmitting = false;

    const closeModal = () => {
        if (modal.parentNode) modal.remove();
    };

    const submitQuickJoin = async () => {
        if (isSubmitting) return;
        const normalizedCode = (codeInput?.value || '').replace(/\s+/g, '').toUpperCase();
        if (!normalizedCode) {
            showLobbyToast(container, text.ERR_EMPTY_CODE);
            if (codeInput?.focus) codeInput.focus();
            return;
        }

        isSubmitting = true;
        if (submitBtn) submitBtn.disabled = true;

        try {
            await RoomManager.initNetwork();

            const nextNick = (nickInput?.value || '').trim();
            if (nextNick && nextNick !== RoomManager.localPlayer?.name) {
                await RoomManager.setNickname(nextNick);
            }

            const password = pwInput?.value || '';
            // expectedGameId에 null을 넘겨 EMRB / UNOS 등 종목과 무관하게 코드로 자동 매칭한다.
            const res = await RoomManager.joinRoomByCode(normalizedCode, null, password);
            if (res && res.ok) {
                closeModal();
                changeScene('room');
                return;
            }
            const errKey = res?.errorCode || 'ERR_NOT_FOUND';
            showLobbyToast(container, text[errKey] || text.ERR_NOT_FOUND);
        } finally {
            isSubmitting = false;
            if (submitBtn) submitBtn.disabled = false;
        }
    };

    if (codeInput) {
        codeInput.oninput = () => {
            codeInput.value = codeInput.value.toUpperCase();
        };
        if (typeof codeInput.focus === 'function') codeInput.focus();
    }

    [codeInput, pwInput, nickInput].forEach(el => {
        if (!el) return;
        el.onkeydown = (e) => {
            if (e.key === 'Enter') submitQuickJoin();
        };
    });

    // 참가 취소 버튼을 눌렀을 때만 닫히도록 배경 클릭·드래그 종료를 허용하지 않는다.
    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (submitBtn) submitBtn.onclick = submitQuickJoin;
}
