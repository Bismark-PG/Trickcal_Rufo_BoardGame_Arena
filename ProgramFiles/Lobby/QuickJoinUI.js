import { changeScene } from '../Main.js';
import { LangState } from '../System/LanguageManager.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { inferGameIdFromCode } from '../System/GameRegistry.js';
import { RoomManager } from './RoomManager.js';
import { escapeHtml, showLobbyToast, ensureGameTabAccess } from './LobbyUI.js';

/**
 * 메인 아레나 화면에서 룸 코드를 입력해 해당하는 게임의 대기방으로 바로 이동하는 빠른 참가 모달.
 */
export function openQuickJoinModal(container) {
    if (!container) return;

    const mountTarget = container.querySelector('.arena-stage') || container;
    const existing = container.querySelector('#modal-quick-join');
    if (existing) existing.remove();

    const text = LobbyLang[LangState.current] || LobbyLang.ko;

    const modal = document.createElement('div');
    modal.id = 'modal-quick-join';
    modal.className = 'arena-modal-backdrop open';
    modal.style.zIndex = '1500';
    modal.innerHTML = `
        <div class="arena-modal-box" style="width: 540px;">
            <h2 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 900; text-align: center; color: #4E2812;">⚡ ${escapeHtml(text.QUICK_JOIN_TITLE)}</h2>
            <p style="margin: 0 0 22px 0; font-size: 16px; font-weight: bold; color: #724929; line-height: 1.5; text-align: center;">${escapeHtml(text.QUICK_JOIN_DESC)}</p>

            <div style="display: flex; flex-direction: column; gap: 14px;">
                <div>
                    <label for="input-quick-code" style="display: block; margin-bottom: 6px; font-size: 16px; font-weight: 800; color: #4E2812;">${escapeHtml(text.JOIN_CODE_LABEL)}</label>
                    <input id="input-quick-code" class="modal-input" type="text" maxlength="16" autocomplete="off" placeholder="${escapeHtml(text.JOIN_CODE_PLACEHOLDER)}"
                        style="font-family: monospace; text-align: center; letter-spacing: 3px; font-size: 24px; text-transform: uppercase;" />
                </div>

                <div>
                    <label for="input-quick-password" style="display: block; margin-bottom: 6px; font-size: 15px; font-weight: bold; color: #724929;">${escapeHtml(text.JOIN_PASSWORD_OPTIONAL)}</label>
                    <input id="input-quick-password" class="modal-input" type="password" maxlength="20" autocomplete="off"
                        style="padding: 11px 14px; font-size: 17px;" />
                </div>
            </div>

            <div style="display: flex; gap: 14px; margin-top: 24px;">
                <button id="btn-quick-cancel" type="button" class="btn-wood" style="flex: 1; padding: 14px; font-size: 20px;">${escapeHtml(text.BTN_CANCEL)}</button>
                <button id="btn-quick-submit" type="button" class="btn-orange" style="flex: 1.4; padding: 14px; font-size: 20px;">${escapeHtml(text.QUICK_JOIN_SUBMIT)}</button>
            </div>
        </div>
    `;

    mountTarget.appendChild(modal);

    const codeInput = modal.querySelector('#input-quick-code');
    const pwInput = modal.querySelector('#input-quick-password');
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

            const password = pwInput?.value || '';
            const res = await RoomManager.joinRoomByCode(normalizedCode, null, password);
            if (res && res.ok) {
                const targetGameId = res.room?.gameId || inferGameIdFromCode(normalizedCode);
                if (targetGameId && RoomManager.isOnline()) {
                    const tabRes = await ensureGameTabAccess(container, targetGameId);
                    if (!tabRes.allowed) {
                        closeModal();
                        return;
                    }
                }
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

    [codeInput, pwInput].forEach(el => {
        if (!el) return;
        el.onkeydown = (e) => {
            if (e.key === 'Enter') submitQuickJoin();
        };
    });

    // 참가 취소 버튼을 눌렀을 때만 닫히도록 배경 클릭·드래그 종료를 허용하지 않는다.
    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (submitBtn) submitBtn.onclick = submitQuickJoin;
}
