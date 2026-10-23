(function () {
  'use strict';

  const MODE_COPY = {
    listen: {
      title: '聆聽：先找到一段現場聲音',
      copy: '搜尋聲景、依類別與時間篩選，收藏你想再次回來聽的土地回音。',
      toast: '聆聽模式：已開啟聲景搜尋、類別篩選、時間軸與收藏。'
    },
    walk: {
      title: '走讀：把聲音串成一條路',
      copy: '選擇主題路線、地理圍籬或手繪範圍，讓地圖帶你完成一段田野任務。',
      toast: '走讀模式：已開啟主題路線、任務與手繪走讀。'
    },
    data: {
      title: '圖資：進入研究型地圖',
      copy: '打開底圖、歷史套疊、淹水潛勢、水文與災害圖資，適合課程研究與田野比對。',
      toast: '圖資模式：已開啟右側底圖、歷史、水文、淹水與災害圖層。'
    }
  };

  const IDLE_COPY = {
    toast: '已收合所有工具面板。'
  };

  const VALID_MODES = ['idle', 'listen', 'walk', 'data'];
  const BODY_MODE_CLASSES = VALID_MODES.map(function (mode) { return 'haidian-v4-mode-' + mode; });
  const previousState = window.haidianV4State || {};
  const UI_STATE = window.haidianV4State = {
    mode: VALID_MODES.indexOf(previousState.mode) >= 0 ? previousState.mode : 'idle',
    panels: Object.assign({ sidePanel: false, routePanel: false }, previousState.panels || {}),
    rightToolsOpen: !!previousState.rightToolsOpen,
    rightToolsUserHidden: previousState.rightToolsUserHidden !== false,
    lastOpenedMode: previousState.lastOpenedMode || null
  };

  let legacyTogglePanel = null;
  let resizeTimer = 0;

  function ready(fn) {
    if ((document.readyState === 'loading' || window.__ssDCL === false)) document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $all(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function byId(id) { return document.getElementById(id); }

  function isValidMode(mode) {
    return VALID_MODES.indexOf(mode) >= 0;
  }

  function normalizeMode(mode) {
    return isValidMode(mode) ? mode : 'idle';
  }

  function getSidePanel() { return byId('sidePanel'); }
  function getRoutePanel() { return byId('routePanel'); }
  function getRightTools() { return byId('rightToolsWrapper') || $('.right-tools-wrapper'); }

  function setExpanded(el, expanded) {
    if (!el) return;
    el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function isDrawerOpen(panel) {
    return !!panel && !panel.classList.contains('collapsed');
  }

  function setBodyMode(mode) {
    mode = normalizeMode(mode);
    document.body.classList.add('haidian-v4');
    BODY_MODE_CLASSES.forEach(function (cls) { document.body.classList.remove(cls); });
    document.body.classList.add('haidian-v4-mode-' + mode);
    document.body.dataset.haidianMode = mode;
    UI_STATE.mode = mode;
  }

  function setDrawer(panel, open) {
    if (!panel) return;
    const panelId = panel.id || '';
    const content = panel.querySelector('.drawer-content');
    const toggle = panel.querySelector('.toggle-btn');

    panel.classList.toggle('collapsed', !open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    panel.dataset.haidianPanelOpen = open ? 'true' : 'false';
    if (panelId) UI_STATE.panels[panelId] = !!open;

    if (toggle) {
      setExpanded(toggle, !!open);
      if (panelId) toggle.setAttribute('aria-controls', panelId);
      toggle.setAttribute('type', 'button');
    }

    panel.style.opacity = open ? '1' : '';
    panel.style.visibility = open ? 'visible' : '';
    panel.style.pointerEvents = open ? 'auto' : '';
    panel.style.transform = open ? 'translateX(0)' : '';
    if (content) content.style.pointerEvents = open ? 'auto' : '';
  }

  function getLayerToolButtons(wrapper) {
    if (!wrapper) return [];
    return $all('.tools-toggle-btn', wrapper).filter(function (btn) {
      const onclick = btn.getAttribute('onclick') || '';
      const title = btn.getAttribute('title') || '';
      return onclick.indexOf('toggleRightToolsPanel') >= 0 || title.indexOf('圖層') >= 0 || title.indexOf('圖資') >= 0;
    });
  }

  function applyRightToolsState(wrapper, open, userHidden) {
    if (!wrapper) return;
    const menu = $('.tools-menu-container', wrapper);
    const control = $('.custom-layer-control', wrapper);
    const visible = !!open && !userHidden;

    wrapper.classList.toggle('open', visible);
    wrapper.classList.toggle('haidian-v4-data-open', visible);
    wrapper.classList.toggle('haidian-v4-tools-user-hidden', !visible);
    wrapper.setAttribute('aria-hidden', 'false');
    wrapper.dataset.haidianToolsOpen = visible ? 'true' : 'false';
    UI_STATE.rightToolsOpen = visible;
    UI_STATE.rightToolsUserHidden = !visible;

    /* 外層不吃地圖事件，工具按鈕與選單才吃點擊。 */
    wrapper.style.pointerEvents = 'none';
    wrapper.style.opacity = '1';
    wrapper.style.visibility = 'visible';
    wrapper.style.zIndex = visible ? '4500' : '';

    $all('.tools-toggle-btn', wrapper).forEach(function (btn) {
      btn.style.pointerEvents = 'auto';
      btn.setAttribute('type', 'button');
    });

    getLayerToolButtons(wrapper).forEach(function (btn) {
      setExpanded(btn, visible);
      btn.setAttribute('aria-controls', 'rightToolsWrapper');
      btn.setAttribute('aria-label', visible ? '隱藏圖資圖層工具' : '開啟圖資圖層工具');
    });

    if (menu) {
      menu.setAttribute('aria-hidden', visible ? 'false' : 'true');
      menu.style.pointerEvents = visible ? 'auto' : 'none';
      menu.style.opacity = visible ? '1' : '0';
      menu.style.visibility = visible ? 'visible' : 'hidden';
      menu.style.transform = visible ? 'translateY(0) scale(1)' : 'translateY(-10px) scale(0.95)';
      menu.style.zIndex = visible ? '4501' : '';
    }
    if (control) {
      control.style.pointerEvents = visible ? 'auto' : 'none';
      control.style.position = 'relative';
      control.style.zIndex = visible ? '4502' : '';
    }
  }

  function openRightTools(open) {
    applyRightToolsState(getRightTools(), !!open, !open);
  }

  function anyToolPanelOpen() {
    return isDrawerOpen(getSidePanel()) || isDrawerOpen(getRoutePanel()) || !!UI_STATE.rightToolsOpen;
  }

  function updateModeControls(mode) {
    mode = normalizeMode(mode);
    $all('[data-haidian-v4-mode]').forEach(function (btn) {
      const btnMode = btn.getAttribute('data-haidian-v4-mode');
      const active = mode !== 'idle' && btnMode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (btn.closest && btn.closest('.haidian-v4-mode-switcher')) {
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      }
    });
  }

  function showToast(message) {
    if (!message) return;
    let toast = $('.haidian-mode-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'haidian-mode-toast';
      toast.style.cssText = 'position:fixed;left:50%;top:92px;transform:translateX(-50%);z-index:5000;background:rgba(15,49,47,.92);color:#fff;padding:12px 18px;border-radius:999px;box-shadow:0 16px 34px rgba(0,0,0,.24);font-size:14px;font-weight:850;letter-spacing:.03em;opacity:0;pointer-events:none;transition:opacity .22s ease, transform .22s ease;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-8px)';
    }, 1500);
  }

  function patchSplashReadability() {
    const card = $('#splashScreen .splash-card');
    if (!card) return;
    card.style.color = '#0f172a';
    $all('.splash-quote-text, .splash-slogan, .splash-card p', card).forEach(function (el) {
      el.style.setProperty('color', '#475569', 'important');
      el.style.setProperty('opacity', '1', 'important');
    });
    $all('.splash-quote-title, .featured-label, .splash-slogan span', card).forEach(function (el) {
      el.style.setProperty('color', '#047857', 'important');
      el.style.setProperty('opacity', '1', 'important');
    });
    $all('.featured-title, .splash-title', card).forEach(function (el) {
      el.style.setProperty('color', '#0f172a', 'important');
      el.style.setProperty('opacity', '1', 'important');
    });
  }

  function addPanelHead(panel, mode, eyebrow) {
    const content = panel && $('.drawer-content', panel);
    if (!content || content.querySelector('.haidian-v4-panel-head')) return;
    const head = document.createElement('div');
    head.className = 'haidian-v4-panel-head';
    head.innerHTML = '<div class="eyebrow">' + eyebrow + '</div><div class="title">' + MODE_COPY[mode].title + '</div><div class="copy">' + MODE_COPY[mode].copy + '</div>';
    const switcher = document.createElement('div');
    switcher.className = 'haidian-v4-mode-switcher';
    switcher.setAttribute('role', 'tablist');
    switcher.setAttribute('aria-label', '探索模式切換');
    switcher.innerHTML = '<button type="button" class="haidian-v4-mode-btn" data-haidian-v4-mode="listen">聆聽</button><button type="button" class="haidian-v4-mode-btn" data-haidian-v4-mode="walk">走讀</button><button type="button" class="haidian-v4-mode-btn" data-haidian-v4-mode="data">圖資</button>';
    content.insertBefore(switcher, content.firstChild);
    content.insertBefore(head, switcher);
  }

  function addDataNote() {
    const control = $('#rightToolsWrapper .custom-layer-control');
    if (!control || control.querySelector('.haidian-v4-data-note')) return;
    const note = document.createElement('div');
    note.className = 'haidian-v4-data-note';
    note.textContent = '在地探究｜比較底圖、歷史套疊、水文與災害圖資，觀察台江環境變化。';
    control.insertBefore(note, control.firstChild);
  }

  function addDock() {
    if ($('.haidian-v4-dock')) return;
    const dock = document.createElement('aside');
    dock.className = 'haidian-v4-dock';
    dock.setAttribute('aria-label', '探索主線');
    dock.innerHTML = '<div class="haidian-v4-dock-head"><div class="haidian-v4-dock-title"><strong>課程模組｜探索主線</strong><span>聲音 × SEL × 在地探究｜點一下打開對應工具面板</span></div><button type="button" class="haidian-v4-dock-toggle" aria-label="收合或展開課程模組">⌄</button></div><div class="haidian-v4-dock-body"><button type="button" class="haidian-v4-card" data-haidian-v4-mode="listen"><b>聆聽</b><small>找聲景、播放、收藏、回應。</small></button><button type="button" class="haidian-v4-card" data-haidian-v4-mode="walk"><b>走讀</b><small>路線、任務、空間探索。</small></button><button type="button" class="haidian-v4-card" data-haidian-v4-mode="data"><b>圖資</b><small>歷史、水文、災害圖層。</small></button></div>';
    document.body.appendChild(dock);
  }

  function ensureLocateButtonVisible() {
    const wrapper = $('.locate-me-wrapper');
    if (!wrapper) return;
    wrapper.style.zIndex = '3600';
    wrapper.style.opacity = '1';
    wrapper.style.visibility = 'visible';
    wrapper.style.pointerEvents = 'auto';
  }

  function repairRightToolClickability() {
    const wrapper = getRightTools();
    if (!wrapper || wrapper.dataset.haidianV4Clickable === 'true') return;
    wrapper.dataset.haidianV4Clickable = 'true';

    try {
      if (window.L && L.DomEvent) {
        L.DomEvent.disableClickPropagation(wrapper);
        L.DomEvent.disableScrollPropagation(wrapper);
      }
    } catch (_) {}

    wrapper.addEventListener('click', function (event) {
      const label = event.target.closest && event.target.closest('label');
      if (!label || !wrapper.contains(label)) return;
      if (event.target.matches && event.target.matches('input, select, button, a, textarea')) return;
      const input = label.querySelector('input');
      if (!input || input.disabled) return;
      event.preventDefault();
      input.click();
    }, false);
  }

  function renderStateFromMemory() {
    setBodyMode(UI_STATE.mode || 'idle');
    setDrawer(getSidePanel(), !!UI_STATE.panels.sidePanel);
    setDrawer(getRoutePanel(), !!UI_STATE.panels.routePanel);
    applyRightToolsState(getRightTools(), !!UI_STATE.rightToolsOpen, !!UI_STATE.rightToolsUserHidden);
    updateModeControls(UI_STATE.mode || 'idle');
    ensureLocateButtonVisible();
  }

  function switchMode(mode, options) {
    options = options || {};
    mode = normalizeMode(mode);
    setBodyMode(mode);

    const sidePanel = getSidePanel();
    const routePanel = getRoutePanel();

    if (mode === 'idle') {
      setDrawer(sidePanel, false);
      setDrawer(routePanel, false);
      applyRightToolsState(getRightTools(), false, true);
    } else if (mode === 'listen') {
      setDrawer(sidePanel, true);
      setDrawer(routePanel, false);
      applyRightToolsState(getRightTools(), false, true);
    } else if (mode === 'walk') {
      setDrawer(sidePanel, false);
      setDrawer(routePanel, true);
      applyRightToolsState(getRightTools(), false, true);
    } else if (mode === 'data') {
      setDrawer(sidePanel, false);
      setDrawer(routePanel, false);
      applyRightToolsState(getRightTools(), true, false);
      repairRightToolClickability();
    }

    updateModeControls(mode);
    ensureLocateButtonVisible();

    if (mode !== 'idle') UI_STATE.lastOpenedMode = mode;
    if (mode !== 'idle' && options.remember !== false) {
      try { localStorage.setItem('haidianPreferredMode', mode); } catch (_) {}
    }

    if (!options.silent) showToast(mode === 'idle' ? IDLE_COPY.toast : MODE_COPY[mode].toast);
    return false;
  }

  function recalculateModeFromVisiblePanels() {
    if (isDrawerOpen(getSidePanel())) {
      setBodyMode('listen');
    } else if (isDrawerOpen(getRoutePanel())) {
      setBodyMode('walk');
    } else if (UI_STATE.rightToolsOpen) {
      setBodyMode('data');
    } else {
      setBodyMode('idle');
    }
    updateModeControls(UI_STATE.mode);
    ensureLocateButtonVisible();
  }

  window.haidianSwitchMode = function (mode, silent, options) {
    options = Object.assign({}, options || {}, { silent: !!silent });
    return switchMode(mode, options);
  };

  window.haidianV4CloseAll = function (silent) {
    return switchMode('idle', { silent: silent !== false, remember: false });
  };

window.toggleRightToolsPanel = function (event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const wrapper = getRightTools();
    if (!wrapper) return false;

    const isOpen =
        UI_STATE.rightToolsOpen ||
        (
            wrapper.classList.contains('open') &&
            !wrapper.classList.contains('haidian-v4-tools-user-hidden')
        );

    if (isOpen) {
        /*
         * 收合前先把焦點移回原本的圖層開啟按鈕。
         * 外掛耳朵隨後會被隱藏，因此不能讓焦點停在耳朵上。
         */
        const layerTrigger = getLayerToolButtons(wrapper)[0];

        if (layerTrigger) {
            try {
                layerTrigger.focus({ preventScroll: true });
            } catch (_) {
                layerTrigger.focus();
            }
        }

        applyRightToolsState(wrapper, false, true);

        if (
            !isDrawerOpen(getSidePanel()) &&
            !isDrawerOpen(getRoutePanel())
        ) {
            switchMode('idle', {
                silent: true,
                remember: false
            });
        } else {
            recalculateModeFromVisiblePanels();
        }
    } else {
        switchMode('data', { silent: false });
    }

    return false;
};

  function installTogglePanelOverride() {
    if (window.togglePanel && window.togglePanel.__haidian96Stable === true) return;
    legacyTogglePanel = window.togglePanel;

    window.togglePanel = function (id, event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      if (!document.body.classList.contains('haidian-v4')) {
        if (typeof legacyTogglePanel === 'function') return legacyTogglePanel.call(this, id, event);
        return false;
      }

      const target = byId(id);
      if (!target) return false;
      const willOpen = target.classList.contains('collapsed');

      if (willOpen) {
        if (id === 'sidePanel') return switchMode('listen', { silent: false });
        if (id === 'routePanel') return switchMode('walk', { silent: false });
        setDrawer(target, true);
        recalculateModeFromVisiblePanels();
        return false;
      }

      setDrawer(target, false);
      if (!anyToolPanelOpen()) switchMode('idle', { silent: true, remember: false });
      else recalculateModeFromVisiblePanels();
      return false;
    };
    window.togglePanel.__haidian96Stable = true;
  }

  function isActiveDockModeClick(btn, mode) {
    if (!btn || !btn.closest || !btn.closest('.haidian-v4-dock')) return false;
    if (UI_STATE.mode !== mode) return false;
    if (mode === 'listen') return isDrawerOpen(getSidePanel());
    if (mode === 'walk') return isDrawerOpen(getRoutePanel());
    if (mode === 'data') return !!UI_STATE.rightToolsOpen;
    return false;
  }

  function bindModeClicks() {
    if (document.documentElement.dataset.haidianV4ModeBinder === 'true') return;
    document.documentElement.dataset.haidianV4ModeBinder = 'true';

    document.addEventListener('click', function (event) {
      const btn = event.target.closest && event.target.closest('[data-haidian-v4-mode]');
      if (!btn) return;
      const mode = btn.getAttribute('data-haidian-v4-mode');
      if (!MODE_COPY[mode]) return;
      event.preventDefault();
      event.stopPropagation();

      if (isActiveDockModeClick(btn, mode)) {
        switchMode('idle', { silent: false, remember: false });
      } else {
        switchMode(mode, { silent: false });
      }
    }, true);

    document.addEventListener('click', function (event) {
      const toggle = event.target.closest && event.target.closest('.haidian-v4-dock-toggle');
      if (!toggle) return;
      event.preventDefault();
      event.stopPropagation();
      const dock = $('.haidian-v4-dock');
      if (!dock) return;
      dock.classList.toggle('is-minimized');
      const minimized = dock.classList.contains('is-minimized');
      toggle.textContent = minimized ? '⌃' : '⌄';
      toggle.setAttribute('aria-label', minimized ? '展開探索主線' : '收合探索主線');
    }, true);
  }

  function snapshotState() {
    return {
      mode: UI_STATE.mode,
      panels: Object.assign({}, UI_STATE.panels),
      rightToolsOpen: UI_STATE.rightToolsOpen,
      rightToolsUserHidden: UI_STATE.rightToolsUserHidden,
      lastOpenedMode: UI_STATE.lastOpenedMode
    };
  }

  function restoreSnapshot(state) {
    if (!state) return switchMode('idle', { silent: true, remember: false });
    UI_STATE.mode = normalizeMode(state.mode);
    UI_STATE.panels = Object.assign({ sidePanel: false, routePanel: false }, state.panels || {});
    UI_STATE.rightToolsOpen = !!state.rightToolsOpen;
    UI_STATE.rightToolsUserHidden = !!state.rightToolsUserHidden;
    UI_STATE.lastOpenedMode = state.lastOpenedMode || null;
    renderStateFromMemory();
  }

  window.haidianV4GetState = function () {
    return snapshotState();
  };

  window.haidianV4SmokeTest = function () {
    const failures = [];
    const eventStub = { preventDefault: function () {}, stopPropagation: function () {} };
    const original = snapshotState();
    const side = getSidePanel();
    const route = getRoutePanel();
    const tools = getRightTools();

    function expect(condition, message) {
      if (!condition) failures.push(message);
    }

    try {
      switchMode('idle', { silent: true, remember: false });
      expect(document.body.dataset.haidianMode === 'idle', '預設 idle 模式沒有建立');
      expect(side && side.classList.contains('collapsed'), 'idle 時聆聽面板不應展開');
      expect(route && route.classList.contains('collapsed'), 'idle 時走讀面板不應展開');
      expect(tools && !tools.classList.contains('open'), 'idle 時圖資工具不應展開');

      switchMode('listen', { silent: true, remember: false });
      expect(side && !side.classList.contains('collapsed'), '聆聽模式沒有展開聆聽面板');
      expect(route && route.classList.contains('collapsed'), '聆聽模式沒有收合走讀面板');
      expect(tools && !tools.classList.contains('open'), '聆聽模式不應展開圖資工具');

      if (typeof window.togglePanel === 'function') window.togglePanel('routePanel', eventStub);
      expect(document.body.dataset.haidianMode === 'walk', '聆聽模式下點走讀小耳朵沒有切到走讀');
      expect(route && !route.classList.contains('collapsed'), '走讀小耳朵沒有展開走讀面板');

      if (typeof window.togglePanel === 'function') window.togglePanel('sidePanel', eventStub);
      expect(document.body.dataset.haidianMode === 'listen', '走讀模式下點聆聽小耳朵沒有切到聆聽');
      expect(side && !side.classList.contains('collapsed'), '聆聽小耳朵沒有展開聆聽面板');

      if (typeof window.togglePanel === 'function') window.togglePanel('sidePanel', eventStub);
      expect(document.body.dataset.haidianMode === 'idle', '再次點聆聽小耳朵沒有回到 idle');
      expect(side && side.classList.contains('collapsed'), '再次點聆聽小耳朵沒有收合聆聽面板');

      switchMode('data', { silent: true, remember: false });
      expect(tools && tools.classList.contains('open'), '圖資模式沒有展開右側圖資工具');
      window.toggleRightToolsPanel(eventStub);
      expect(document.body.dataset.haidianMode === 'idle', '圖資工具收合後沒有回到 idle');
      expect(tools && tools.classList.contains('haidian-v4-tools-user-hidden'), '圖資工具收合按鈕沒有隱藏選單');
      window.toggleRightToolsPanel(eventStub);
      expect(document.body.dataset.haidianMode === 'data', 'idle 時點圖資工具沒有切到圖資');
      expect(tools && tools.classList.contains('open') && !tools.classList.contains('haidian-v4-tools-user-hidden'), '圖資工具無法重新展開');
    } catch (err) {
      failures.push('測試執行錯誤：' + (err && err.message ? err.message : String(err)));
    } finally {
      restoreSnapshot(original);
    }

    return { ok: failures.length === 0, failures: failures, state: snapshotState() };
  };

  ready(function () {
    patchSplashReadability();
    addPanelHead(getSidePanel(), 'listen', 'Listen Mode');
    addPanelHead(getRoutePanel(), 'walk', 'Walk Mode');
    addDataNote();
    addDock();
    bindModeClicks();
    repairRightToolClickability();
    installTogglePanelOverride();
    ensureLocateButtonVisible();

    /* 9.6 需求：預設不自動打開聆聽 / 走讀 / 圖資任何一個面板。
       即使前一版 localStorage 有 haidianPreferredMode，也不再自動復原，避免任一選單 pop 出。 */
    switchMode('idle', { silent: true, remember: false });
    setTimeout(function () { switchMode('idle', { silent: true, remember: false }); }, 100);
    setTimeout(patchSplashReadability, 180);
  });

  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      renderStateFromMemory();
    }, 120);
  });
})();
