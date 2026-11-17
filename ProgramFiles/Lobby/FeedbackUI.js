// ProgramFiles/Lobby/FeedbackUI.js
// 아레나 전 게임 공통 독립 버그 제보(category='bug') & 유저 건의(category='suggestion') 모달 UI

import { getAllRegisteredGames } from '../System/GameRegistry.js';
import { LangState } from '../System/LanguageManager.js';
import { MenuLang } from '../System/Index/MainMenuIndex.js';
import { LobbyLang } from '../System/Index/LobbyIndex.js';
import { NetworkClient } from '../System/NetworkClient.js';
import { ErrorTracker } from '../System/ErrorTracker.js';

function escapeHtmlSafe(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showFeedbackToast(container, msg, accentColor = '#f39c12', duration = 3000) {
    if (!container || typeof document === 'undefined') return;
    const existing = container.querySelector('#lobby-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'lobby-toast';
    toast.style.cssText = `
        position: absolute; bottom: 45px; left: 50%; transform: translateX(-50%);
        background: rgba(15, 25, 35, 0.94); color: #fff; padding: 16px 34px;
        border-radius: 14px; font-size: 22px; font-weight: bold; z-index: 9999;
        border: 3px solid ${accentColor}; box-shadow: 0 10px 28px rgba(0,0,0,0.45);
        pointer-events: none; text-align: center;
    `;
    toast.innerText = msg;
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, duration);
}

/**
 * 버그 제보 또는 유저 건의 모달을 연다. (통합 창이 아닌 category별 독립 UX 제공)
 * @param {HTMLElement} container
 * @param {{ category: 'bug' | 'suggestion', defaultGameId?: string }} options
 */
function openFeedbackModal(container, { category, defaultGameId = 'arena' } = {}) {
    if (!container || typeof document === 'undefined') return;
    const isBug = category === 'bug';

    const existing = container.querySelector('#modal-arena-feedback');
    if (existing) existing.remove();

    const lang = LangState.current;
    const text = LobbyLang[lang] || LobbyLang.ko;
    const menuText = MenuLang[lang] || MenuLang.ko;
    const games = getAllRegisteredGames();

    const accentColor = isBug ? '#e67e22' : '#2ecc71';
    const modalTitle = isBug
        ? (text.BUG_MODAL_TITLE || '🐛 버그 제보')
        : (text.SUGGEST_MODAL_TITLE || '💡 유저 건의');
    const modalDesc = isBug
        ? (text.BUG_MODAL_DESC || '발견한 버그나 오류 상황을 알려주세요. 운영진 채널(#버그제보)로 즉시 전달됩니다.')
        : (text.SUGGEST_MODAL_DESC || '아레나 발전을 위한 아이디어나 개선 의견을 자유롭게 보내주세요.');
    const titlePlaceholder = isBug
        ? (text.FB_TITLE_PLACEHOLDER_BUG || '예: 주사위 버튼이 가끔 두 번 눌려요')
        : (text.FB_TITLE_PLACEHOLDER_SUGGESTION || '예: 우노스 관전 기능 있으면 좋겠어요!');
    const contentLabel = isBug
        ? (text.FB_CONTENT_LABEL_BUG || '상세 증상 (5~1,000자)')
        : (text.FB_CONTENT_LABEL_SUGGESTION || '건의 내용 (5~1,000자)');
    const contentPlaceholder = isBug
        ? (text.FB_CONTENT_PLACEHOLDER_BUG || '발생한 모드/턴/상황을 구체적으로 적어주시면 해결에 큰 도움이 됩니다.')
        : (text.FB_CONTENT_PLACEHOLDER_SUGGESTION || '새로운 게임, 규칙 개선, UI 편의성 아이디어를 자유롭게 적어주세요.');

    const selectedGameId = (defaultGameId && games.some(g => g.id === defaultGameId))
        ? defaultGameId
        : 'arena';

    const gameOptionsHtml = [
        `<option value="arena" ${selectedGameId === 'arena' ? 'selected' : ''}>${escapeHtmlSafe(text.FB_GAME_ARENA || '아레나 전체 (공통)')}</option>`,
        ...games.map(g => {
            const label = menuText[g.nameKey] || g.id;
            return `<option value="${escapeHtmlSafe(g.id)}" ${selectedGameId === g.id ? 'selected' : ''}>${escapeHtmlSafe(label)}</option>`;
        })
    ].join('');

    const breadcrumbBoxHtml = isBug ? `
        <label style="display: flex; align-items: center; gap: 10px; font-size: 16px; color: #f9e79f; cursor: pointer; background: rgba(0,0,0,0.22); padding: 11px 14px; border-radius: 10px;">
            <input id="fb-attach-breadcrumbs" type="checkbox" checked style="width: 18px; height: 18px; cursor: pointer;">
            <span>${escapeHtmlSafe(text.BUG_ATTACH_BREADCRUMBS || '최근 동작 기록(블랙박스 15줄) 함께 첨부하기')}</span>
        </label>
    ` : '';

    const modal = document.createElement('div');
    modal.id = 'modal-arena-feedback';
    modal.dataset.category = category;
    modal.style.cssText = 'position: absolute; inset: 0; background: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 11200; padding: 20px;';
    modal.innerHTML = `
        <div style="width: 620px; max-width: 92vw; background: #165b7a; border: 4px solid ${accentColor}; border-radius: 24px; padding: 34px 38px; color: #fff; box-shadow: 0 22px 52px rgba(0,0,0,0.5); font-family: inherit;">
            <h2 style="margin: 0 0 8px 0; font-size: 30px; color: ${accentColor};">${escapeHtmlSafe(modalTitle)}</h2>
            <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.5; color: #d6eaf8;">${escapeHtmlSafe(modalDesc)}</p>

            <div style="display: flex; flex-direction: column; gap: 14px;">
                <div>
                    <label for="fb-target-game" style="display: block; margin-bottom: 6px; font-size: 16px; font-weight: bold; color: #dceefb;">${escapeHtmlSafe(text.FB_TARGET_GAME_LABEL || '대상 게임')}</label>
                    <select id="fb-target-game" style="font-family: inherit; width: 100%; padding: 11px 14px; font-size: 17px; border-radius: 10px; border: 2px solid #2e86c1; background: #fff; color: #1b2631;">
                        ${gameOptionsHtml}
                    </select>
                </div>

                <div>
                    <label for="fb-title-input" style="display: block; margin-bottom: 6px; font-size: 16px; font-weight: bold; color: #dceefb;">${escapeHtmlSafe(text.FB_TITLE_LABEL || '제목 (2~80자)')}</label>
                    <input id="fb-title-input" type="text" maxlength="80" placeholder="${escapeHtmlSafe(titlePlaceholder)}"
                        style="font-family: inherit; width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 17px; border-radius: 10px; border: 2px solid #2e86c1; background: #fff; color: #1b2631;" />
                </div>

                <div>
                    <label for="fb-content-input" style="display: block; margin-bottom: 6px; font-size: 16px; font-weight: bold; color: #dceefb;">${escapeHtmlSafe(contentLabel)}</label>
                    <textarea id="fb-content-input" maxlength="1000" rows="5" placeholder="${escapeHtmlSafe(contentPlaceholder)}"
                        style="font-family: inherit; width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 16px; line-height: 1.5; border-radius: 10px; border: 2px solid #2e86c1; background: #fff; color: #1b2631; resize: vertical;"></textarea>
                </div>

                ${breadcrumbBoxHtml}
            </div>

            <div id="fb-status-msg" style="min-height: 22px; margin-top: 14px; font-size: 15px; font-weight: bold; color: #ff7675; text-align: center;"></div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px;">
                <button id="btn-fb-cancel" type="button" style="font-family: inherit; padding: 12px 24px; font-size: 18px; font-weight: bold; background: #7f8c8d; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtmlSafe(text.BTN_CANCEL || '취소')}</button>
                <button id="btn-fb-submit" type="button" style="font-family: inherit; padding: 12px 28px; font-size: 18px; font-weight: bold; background: ${accentColor}; color: #fff; border: none; border-radius: 12px; cursor: pointer;">${escapeHtmlSafe(text.FB_SUBMIT_BTN || '전송하기')}</button>
            </div>
        </div>
    `;

    container.appendChild(modal);

    const gameSelect = modal.querySelector('#fb-target-game');
    const titleInput = modal.querySelector('#fb-title-input');
    const contentInput = modal.querySelector('#fb-content-input');
    const attachCheckbox = modal.querySelector('#fb-attach-breadcrumbs');
    const statusEl = modal.querySelector('#fb-status-msg');
    const cancelBtn = modal.querySelector('#btn-fb-cancel');
    const submitBtn = modal.querySelector('#btn-fb-submit');

    let isSubmitting = false;

    const onEsc = (e) => {
        if (!modal.isConnected) {
            document.removeEventListener('keydown', onEsc);
            return;
        }
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    const closeModal = () => {
        document.removeEventListener('keydown', onEsc);
        if (modal.parentNode) modal.remove();
    };
    document.addEventListener('keydown', onEsc);

    if (titleInput && typeof titleInput.focus === 'function') {
        titleInput.focus();
    }

    const submit = async () => {
        if (isSubmitting) return;
        const title = (titleInput?.value || '').trim();
        const content = (contentInput?.value || '').trim();
        const gameId = gameSelect?.value || selectedGameId || 'arena';

        if (title.length < 2 || title.length > 80) {
            if (statusEl) statusEl.innerText = text.FB_ERR_TITLE_LEN || '제목은 2자 이상 80자 이하로 입력해 주세요.';
            titleInput?.focus?.();
            return;
        }
        if (content.length < 5 || content.length > 1000) {
            if (statusEl) statusEl.innerText = text.FB_ERR_CONTENT_LEN || '내용은 5자 이상 1,000자 이하로 입력해 주세요.';
            contentInput?.focus?.();
            return;
        }

        isSubmitting = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.65';
        }
        if (statusEl) {
            statusEl.style.color = '#f9e79f';
            statusEl.innerText = text.FB_SENDING || '전송하는 중...';
        }

        const attachBreadcrumbs = isBug && Boolean(attachCheckbox?.checked);
        const breadcrumbs = attachBreadcrumbs ? ErrorTracker.getBreadcrumbs().slice(-15) : [];
        const payload = {
            category,
            gameId,
            title,
            content,
            attachBreadcrumbs,
            breadcrumbs
        };

        ErrorTracker.addBreadcrumb('UI_ACTION', `Submit ${category} feedback (${gameId})`);

        try {
            const res = await NetworkClient.submitFeedback(payload);
            if (res && res.ok) {
                closeModal();
                const okMsg = isBug
                    ? (text.BUG_SENT_OK || '✅ 버그 제보가 접수되었습니다!')
                    : (text.SUGGEST_SENT_OK || '✅ 소중한 건의가 전달되었습니다!');
                showFeedbackToast(container, okMsg, accentColor, 3200);
                return;
            }

            if (statusEl) {
                statusEl.style.color = '#ff7675';
                if (res?.error === 'FEEDBACK_RATE_LIMITED') {
                    const sec = Math.max(1, Math.ceil((Number(res.retryAfterMs) || 60000) / 1000));
                    statusEl.style.color = '#f39c12';
                    statusEl.innerText = (text.FB_ERR_RATE_LIMITED || '⏳ 잠시 후 다시 시도해 주세요. ({sec}초 후 재전송 가능)')
                        .replace('{sec}', String(sec));
                } else if (res?.error === 'INVALID_FEEDBACK_TITLE') {
                    statusEl.innerText = text.FB_ERR_TITLE_LEN || '제목은 2자 이상 80자 이하로 입력해 주세요.';
                } else if (res?.error === 'INVALID_FEEDBACK_CONTENT') {
                    statusEl.innerText = text.FB_ERR_CONTENT_LEN || '내용은 5자 이상 1,000자 이하로 입력해 주세요.';
                } else {
                    statusEl.innerText = text.FB_ERR_OFFLINE || '⚠️ 서버에 연결되어 있지 않아 전송하지 못했습니다.';
                }
            }
        } finally {
            isSubmitting = false;
            if (submitBtn && modal.parentNode) {
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
            }
        }
    };

    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (submitBtn) submitBtn.onclick = submit;
}

/**
 * 오류 제보 전용 모달 열기 (블랙박스 15줄 첨부 옵션 포함)
 */
export function openBugReportModal(container, options = {}) {
    return openFeedbackModal(container, { ...options, category: 'bug' });
}

/**
 * 유저 건의 전용 모달 열기 (순수 아이디어/건의 입력 전용, 블랙박스 미첨부)
 */
export function openSuggestionModal(container, options = {}) {
    return openFeedbackModal(container, { ...options, category: 'suggestion' });
}
