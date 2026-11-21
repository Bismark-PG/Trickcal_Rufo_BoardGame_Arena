import { changeScene } from '../Main.js';
import { shouldBypassResourceGuard } from '../System/System.js';
import { LangState } from '../System/LanguageManager.js';
import {
    MenuLang,
    MAIN_MENU_CATALOG,
    pickNextRufoReaction
} from '../System/Index/MainMenuIndex.js';
import { getAllRegisteredGames } from '../System/GameRegistry.js';
import { RoomManager } from '../Lobby/RoomManager.js';
import { openQuickJoinModal } from '../Lobby/QuickJoinUI.js';
import {
    openInfoPopup,
    getSessionNickname,
    renderArenaSettingsModalHtml,
    bindArenaSettingsHandlers
} from '../Lobby/InfoPopupUI.js';
import { showLobbyToast, escapeHtml } from '../Lobby/LobbyUI.js';

function getMainStatusBadgeHtml(game) {
    if (game.statusType === 'active') {
        return `<span class="status-badge active">${escapeHtml(game.statusText)}</span>`;
    }
    if (game.statusType === 'dev') {
        return `<span class="status-badge dev">${escapeHtml(game.statusText)}</span>`;
    }
    return `<span class="status-badge soon">${escapeHtml(game.statusText)}</span>`;
}

export function initMenu(container) {
    let filterMode = 'all'; // 'all' | 'released' | 'dev'
    let selectedGameId = 'marble';
    let customRufoReaction = null;
    let lastRufoId = null;
    let elfEasterEggTriggered = false;

    const getActiveNick = () =>
        (RoomManager.localPlayer?.name || getSessionNickname() || '교주').trim() || '교주';

    const getFilteredCatalog = () => {
        if (filterMode === 'all') return MAIN_MENU_CATALOG;
        return MAIN_MENU_CATALOG.filter(g => g.releaseGroup === filterMode);
    };

    const getSelectedCatalogGame = () =>
        MAIN_MENU_CATALOG.find(g => g.id === selectedGameId) || MAIN_MENU_CATALOG[0];

    if (!RoomManager.isOnline()) {
        RoomManager.initNetwork();
    }

    const renderUI = () => {
        const lang = LangState.current || 'ko';
        const text = MenuLang[lang] || MenuLang.ko;
        const games = getAllRegisteredGames();
        const prevListScrollTop = container.querySelector('.final-dock-list')?.scrollTop || 0;

        const list = getFilteredCatalog();
        const selected = list.find(g => g.id === selectedGameId) || list[0] || getSelectedCatalogGame();
        const rufo = customRufoReaction || { img: selected.rufoChar, quote: selected.rufoQuote };
        const ctaClass = selected.statusType === 'dev' ? 'locked-style' : (selected.statusType === 'soon' ? 'soon-style' : '');
        const currentNick = getActiveNick();

        const dockListHtml = list.map(g => {
            const isSel = g.id === selected.id;
            const subText = g.subLabel || `${g.players} · ${g.playTime}`;
            const cardBgClass = g.bgFit === 'contain' ? 'dock-card-bg logo-bg' : 'dock-card-bg';
            return `
                <button type="button" class="final-dock-btn ${isSel ? 'selected' : ''}" data-select-game="${escapeHtml(g.id)}">
                    <img class="${cardBgClass}" src="${escapeHtml(g.bg)}" alt="">
                    <div class="dock-card-scrim"></div>
                    <div class="dock-card-text">
                        ${getMainStatusBadgeHtml(g)}
                        <span class="dock-card-title">${escapeHtml(g.icon)} ${escapeHtml(g.title)}</span>
                        <span class="dock-card-sub">${escapeHtml(subText)}</span>
                    </div>
                    <img class="dock-card-thumb" src="${escapeHtml(g.heroChar)}" alt="">
                </button>
            `;
        }).join('');

        const heroBgClass = selected.bgFit === 'contain' ? 'showcase-bg logo-bg' : 'showcase-bg';

        container.innerHTML = `
            <div class="arena-stage">
                <header class="arena-header">
                    <div class="header-left">
                        <div class="brand-pill">
                            <span class="brand-logo-icon">🦊</span>
                            <h1 class="brand-title">${escapeHtml(text.TITLE)}</h1>
                        </div>
                        <div class="nick-badge">
                            <span class="nick-tag">${escapeHtml(text.NICK_TAG || '닉네임')}</span>
                            <span id="menu-header-nickname">${escapeHtml(currentNick)}</span>
                        </div>
                    </div>
                    <div class="header-actions">
                        <button type="button" id="btn-quick-join" class="header-btn quick-join">${escapeHtml(text.QUICK_JOIN)}</button>
                        <button type="button" id="btn-settings" class="header-btn teal-btn">⚙️ ${escapeHtml(text.SETTINGS)}</button>
                        <button type="button" id="btn-info" class="header-btn teal-btn">ℹ️ ${escapeHtml(text.INFO)}</button>
                    </div>
                </header>

                <main class="stage-body">
                    <div class="final-hybrid-layout">
                        <aside class="shelf-mascot-col final-mascot-col" id="btn-rufo-interact" title="${escapeHtml(text.RUFO_CLICK_TIP || '루포를 클릭해 대화하기')}">
                            <div class="shelf-bubble">${escapeHtml(rufo.quote)}</div>
                            <div class="shelf-rufo-stage">
                                <div class="final-rufo-img-wrap">
                                    <img src="${escapeHtml(rufo.img)}" alt="루포">
                                </div>
                                <span class="shelf-click-tip">${escapeHtml(text.RUFO_CLICK_TIP || '💡 루포를 클릭해 대화하기')}</span>
                            </div>
                        </aside>

                        <section class="final-rack-col">
                            <div class="category-tabs">
                                <button type="button" class="cat-tab ${filterMode === 'all' ? 'active' : ''}" data-final-cat="all">${escapeHtml(text.CAT_ALL || '전체')}</button>
                                <button type="button" class="cat-tab ${filterMode === 'released' ? 'active' : ''}" data-final-cat="released">${escapeHtml(text.CAT_RELEASED || '릴리즈')}</button>
                                <button type="button" class="cat-tab ${filterMode === 'dev' ? 'active' : ''}" data-final-cat="dev">${escapeHtml(text.CAT_DEV || '개발중')}</button>
                            </div>

                            <div class="final-dock-list">
                                ${dockListHtml}
                            </div>

                            <div class="custom-scroll-hint">${escapeHtml(text.SCROLL_HINT || '↕ 위아래로 스크롤해 다른 게임도 둘러보세요!')}</div>
                        </section>

                        <section class="custom-showcase-col">
                            <div class="showcase-banner">
                                <img class="${heroBgClass}" src="${escapeHtml(selected.bg)}" alt="컨셉 배경">
                                <div class="showcase-scrim"></div>
                                <img class="showcase-hero-char" src="${escapeHtml(selected.heroChar)}" alt="${escapeHtml(selected.title)}">
                                <div class="showcase-banner-content">
                                    <div class="tag-row">
                                        ${getMainStatusBadgeHtml(selected)}
                                        ${selected.tags.map(t => `<span class="info-pill">${escapeHtml(t)}</span>`).join('')}
                                    </div>
                                    <div class="showcase-banner-title-area">
                                        <div class="subtitle-kicker">${escapeHtml(selected.kicker)}</div>
                                        <h2>${escapeHtml(selected.title)}</h2>
                                    </div>
                                </div>
                            </div>

                            <div class="showcase-details">
                                <div class="final-desc-wrap">
                                    <p class="details-desc">${escapeHtml(selected.description)}</p>
                                </div>
                                <div class="final-details-bottom">
                                    <div class="feature-chip-row">
                                        ${selected.features.map(f => `<span class="feature-chip">✓ ${escapeHtml(f)}</span>`).join('')}
                                    </div>
                                    <button type="button" class="cta-btn ${ctaClass}" id="btn-enter-game">${escapeHtml(selected.ctaLabel)}</button>
                                </div>
                            </div>
                        </section>
                    </div>
                </main>

                <!-- 모달: 준비중 / 외부 접근 제한 게임 안내 -->
                <div id="modal-menu-notice" class="arena-modal-backdrop">
                    <div class="arena-modal-box" style="width: 600px; text-align: center;">
                        <div style="font-size: 46px; margin-bottom: 12px;">🚧</div>
                        <p id="modal-menu-notice-text" style="margin: 0 0 26px; font-size: 24px; font-weight: 900; line-height: 1.5; color: #4E2812;">${escapeHtml(text.UNOS_EXTERNAL_BLOCK_MSG || '이 게임은 지금 생각중인것이다! 다음에 오는 것이다!')}</p>
                        <button id="btn-menu-notice-ok" type="button" class="btn-orange" style="padding: 13px 44px; font-size: 20px;">${escapeHtml(text.BTN_OK_RUFO || text.BTN_CONFIRM || '알았다는것이다')}</button>
                    </div>
                </div>

                ${renderArenaSettingsModalHtml({
                    popupId: 'popup-settings',
                    idPrefix: 'menu-settings',
                    bgmSliderId: 'bgm-slider',
                    sfxSliderId: 'sfx-slider',
                    fontGothicId: 'font-gothic',
                    fontGulimId: 'font-gulim',
                    langKoId: 'lang-ko',
                    langEnId: 'lang-en',
                    langJaId: 'lang-ja',
                    closeBtnId: 'close-settings',
                    lang,
                    menuText: text,
                    currentNickname: currentNick
                })}
            </div>
        `;

        const nextListEl = container.querySelector('.final-dock-list');
        if (nextListEl && prevListScrollTop > 0) {
            nextListEl.scrollTop = prevListScrollTop;
        }

        const quickJoinBtn = container.querySelector('#btn-quick-join');
        if (quickJoinBtn) {
            quickJoinBtn.onclick = () => openQuickJoinModal(container);
        }

        const infoBtn = container.querySelector('#btn-info');
        if (infoBtn) {
            infoBtn.onclick = () => openInfoPopup(container, { gameId: 'arena' });
        }

        const noticeModal = container.querySelector('#modal-menu-notice');
        const noticeTextEl = container.querySelector('#modal-menu-notice-text');
        const noticeOkBtn = container.querySelector('#btn-menu-notice-ok');
        const openNoticeModal = (msgText) => {
            if (!noticeModal) return;
            if (noticeTextEl) noticeTextEl.textContent = msgText;
            noticeModal.classList.add('open');
        };
        const closeNoticeModal = () => noticeModal?.classList.remove('open');
        if (noticeOkBtn) noticeOkBtn.onclick = closeNoticeModal;
        if (noticeModal) noticeModal.onclick = (e) => { if (e.target === noticeModal) closeNoticeModal(); };

        container.querySelectorAll('[data-select-game]').forEach(btn => {
            btn.onclick = () => {
                selectedGameId = btn.getAttribute('data-select-game');
                customRufoReaction = null;
                lastRufoId = null;
                renderUI();
            };
        });

        container.querySelectorAll('[data-final-cat]').forEach(btn => {
            btn.onclick = () => {
                filterMode = btn.getAttribute('data-final-cat');
                const visible = getFilteredCatalog();
                if (visible.length > 0 && !visible.some(g => g.id === selectedGameId)) {
                    selectedGameId = visible[0].id;
                    customRufoReaction = null;
                    lastRufoId = null;
                }
                renderUI();
            };
        });

        // 루포 클릭 시 전체 재렌더 없이 말풍선·이미지만 직접 교체해 우측 히어로 호버링 초기화 방지
        const rufoBtn = container.querySelector('#btn-rufo-interact');
        if (rufoBtn) {
            rufoBtn.onclick = () => {
                const picked = pickNextRufoReaction(getActiveNick(), lastRufoId, elfEasterEggTriggered);
                if (picked.requiresElfNick) elfEasterEggTriggered = true;
                lastRufoId = picked.id;
                customRufoReaction = picked;
                const bubbleEl = rufoBtn.querySelector('.shelf-bubble');
                const imgEl = rufoBtn.querySelector('.final-rufo-img-wrap img');
                if (bubbleEl) bubbleEl.textContent = picked.quote;
                if (imgEl) imgEl.src = picked.img;
            };
        }

        const enterGameBtn = container.querySelector('#btn-enter-game');
        if (enterGameBtn) {
            enterGameBtn.onclick = () => {
                const gameId = selected.id;
                const meta = games.find(g => g.id === gameId);
                if (!meta) {
                    openNoticeModal(text.UNOS_EXTERNAL_BLOCK_MSG || '이 게임은 지금 생각중인것이다! 다음에 오는 것이다!');
                    return;
                }
                if (gameId === 'unos' && !shouldBypassResourceGuard(typeof window !== 'undefined' ? window.location : null)) {
                    openNoticeModal(text.UNOS_EXTERNAL_BLOCK_MSG || '이 게임은 지금 생각중인것이다! 다음에 오는 것이다!');
                    return;
                }
                if (meta.lobbyEnabled || meta.status === 'active') {
                    changeScene(meta.sceneMain);
                } else {
                    showLobbyToast(container, text.UNOS_PREPARING_MSG);
                }
            };
        }

        bindArenaSettingsHandlers({
            container,
            popupId: 'popup-settings',
            openBtnId: 'btn-settings',
            idPrefix: 'menu-settings',
            bgmSliderId: 'bgm-slider',
            sfxSliderId: 'sfx-slider',
            fontGothicId: 'font-gothic',
            fontGulimId: 'font-gulim',
            langKoId: 'lang-ko',
            langEnId: 'lang-en',
            langJaId: 'lang-ja',
            closeBtnId: 'close-settings',
            onNicknameApplied: (newNick) => {
                const nickSpan = container.querySelector('#menu-header-nickname');
                if (nickSpan) nickSpan.textContent = newNick;
                elfEasterEggTriggered = false;
                lastRufoId = null;
                customRufoReaction = null;
            }
        });
    };

    const langHandler = () => renderUI();
    document.addEventListener('languageChanged', langHandler);
    container._cleanupScene = () => document.removeEventListener('languageChanged', langHandler);
    renderUI();
}
