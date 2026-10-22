/*
 * 聲景介面改版層 (soundscape-ui)
 * 只讀取並包裝既有的全域函式，不改動資料、Firebase 或後台流程。
 * 移除 index.html 裡的兩行引用即可完全還原。
 */
(function () {
  'use strict';

  var LS_ROAM = 'ss-roam';
  var LS_DOCK = 'ss-dock-open';
  var LS_PLACE = 'ss-place-v1';
  var SHEET_QUERY = '(max-width: 600px)';
  // 與作品卡片 onerror 使用同一張預設封面
  var FALLBACK_COVER = 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?q=80&w=600&auto=format&fit=crop';

  var CATS = [
    { key: '自然絮語', cls: 'cat-nature', label: '自然絮語' },
    { key: '常民聲', cls: 'cat-culture', label: '常民聲' },
    { key: '活動與產業', cls: 'cat-industry', label: '活動與產業' },
    { key: '空間聲', cls: 'cat-space', label: '空間聲' },
    { key: '歲月回音', cls: 'cat-history', label: '歲月回音' }
  ];

  var ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.5v13a1 1 0 0 0 1.55.83l9.5-6.5a1 1 0 0 0 0-1.66l-9.5-6.5A1 1 0 0 0 5 5.5z"/><rect x="17" y="5" width="2.5" height="14" rx="1"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    roam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c2.5-4 5-4 7.5 0s5 4 7.5 0"/><path d="M3 17c2.5-4 5-4 7.5 0s5 4 7.5 0" opacity=".5"/><circle cx="20" cy="7" r="2"/></svg>',
    tune: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6"/><path d="M5.2 18.8a9.6 9.6 0 0 1 0-13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6" opacity=".55"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>'
  };

  var state = {
    uid: null,
    openPopupUid: null,
    played: new Set(),
    roam: readLS(LS_ROAM) === '1',
    heroPick: null,
    closingFromPopup: false,
    durations: {},
    tune: false,
    tuneTarget: null,
    volume: 1,
    places: readJSON(LS_PLACE) || {}
  };

  // ---------------------------------------------------------------- utils

  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function readJSON(k) { try { return JSON.parse(readLS(k) || 'null'); } catch (e) { return null; } }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function audio() { return window.globalAudio || null; }
  function items() { return Array.isArray(window.allMarkersData) ? window.allMarkersData : []; }
  function findItem(uid) { return items().find(function (i) { return i.uid === uid; }) || null; }
  function isPlayable(i) { return i && i.audioUrl && !i.isProcessing && !isNaN(parseFloat(i.lat)) && (+i.lat !== 0 || +i.lon !== 0); }
  function isSheetMode() { return window.matchMedia && window.matchMedia(SHEET_QUERY).matches; }

  function catOf(item) {
    var raw = String((item && item.category) || '');
    for (var k = 0; k < CATS.length; k++) if (raw.indexOf(CATS[k].key) > -1) return CATS[k];
    return { key: '', cls: 'cat-default', label: raw.split(/[(（]/)[0].trim() || '未分類' };
  }

  // 卡片標題在 createMarker 時已經 escape 過，這裡解回純文字再自行 escape。
  function plain(s) {
    var t = document.createElement('textarea');
    t.innerHTML = String(s == null ? '' : s);
    return t.value;
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '';
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function distance(a, b) {
    var dLat = (+a.lat - +b.lat), dLon = (+a.lon - +b.lon) * Math.cos(+a.lat * Math.PI / 180);
    return dLat * dLat + dLon * dLon;
  }

  function waitFor(test, cb, timeout) {
    var start = Date.now();
    (function tick() {
      var v;
      try { v = test(); } catch (e) { v = null; }
      if (v) return cb(v);
      if (Date.now() - start > (timeout || 20000)) return;
      setTimeout(tick, 150);
    })();
  }

  // ---------------------------------------------------------------- playback core

  function playUid(uid, opts) {
    opts = opts || {};
    var item = findItem(uid);
    if (!item || typeof window.startGlobalPlayback !== 'function') return;

    var map = window.map;
    var marker = window.globalMarkerMap && window.globalMarkerMap[uid];
    var cardOpen = !!state.openPopupUid;
    var wantCard = opts.openCard === true || (opts.openCard !== false && cardOpen);

    if (map && cardOpen) map.closePopup();

    // 先在使用者手勢內啟動音訊，避免行動裝置擋自動播放。
    window.startGlobalPlayback(uid, { skipFocus: true });

    if (wantCard && typeof window.focusMarkerOnMap === 'function') {
      window.focusMarkerOnMap(uid);
    } else if (marker && window.markerCluster) {
      window.markerCluster.zoomToShowLayer(marker, function () { markNowPlaying(); });
    } else if (map) {
      map.flyTo([+item.lat, +item.lon], Math.max(map.getZoom(), 17), { duration: 0.8 });
    }
  }

  function pool() {
    var shown = window.globalMarkerMap ? Object.keys(window.globalMarkerMap) : [];
    var list = items().filter(isPlayable);
    if (shown.length) {
      var set = new Set(shown);
      var visible = list.filter(function (i) { return set.has(i.uid); });
      if (visible.length) list = visible;
    }
    return list;
  }

  function nextNearby() {
    var cur = findItem(state.uid);
    var list = pool().filter(function (i) { return i.uid !== state.uid; });
    if (!list.length) return null;
    var fresh = list.filter(function (i) { return !state.played.has(i.uid); });
    if (!fresh.length) { state.played.clear(); fresh = list; }
    if (!cur) return fresh[Math.floor(Math.random() * fresh.length)];
    fresh.sort(function (a, b) { return distance(cur, a) - distance(cur, b); });
    return fresh[0];
  }

  function randomPick(exceptUid) {
    var list = pool().filter(function (i) { return i.uid !== exceptUid; });
    if (!list.length) list = pool();
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  // 關掉作品卡片時不再中斷聲音；真正的停止改由播放列或卡片內的 X。
  function wrapCloseGlobalPlayer() {
    var original = window.closeGlobalPlayer;
    if (typeof original !== 'function' || original.__ssWrapped) return;
    var wrapped = function () {
      if (state.closingFromPopup && !window.isRoutePlaying) {
        if (typeof window.restoreGlobalPlayerToBody_ === 'function') window.restoreGlobalPlayerToBody_(true);
        return;
      }
      original.apply(this, arguments);
      onStopped();
    };
    wrapped.__ssWrapped = true;
    wrapped.__ssOriginal = original;
    window.closeGlobalPlayer = wrapped;
  }

  // 播放控制只留在底部播放列：卡片不再嵌入第二個播放器。
  function disableEmbeddedPlayer() {
    if (window.mountGlobalPlayerIntoPopup_ && window.mountGlobalPlayerIntoPopup_.__ssWrapped) return;
    var noop = function () {
      if (typeof window.restoreGlobalPlayerToBody_ === 'function') window.restoreGlobalPlayerToBody_(true);
      document.body.classList.remove('player-embedded');
    };
    noop.__ssWrapped = true;
    window.mountGlobalPlayerIntoPopup_ = noop;
  }

  function stopAll() {
    var fn = window.closeGlobalPlayer && window.closeGlobalPlayer.__ssOriginal;
    if (fn) fn(); else if (audio()) audio().pause();
    onStopped();
  }

  function onStopped() {
    state.uid = null;
    document.body.classList.remove('ss-has-bar', 'ss-playing');
    markNowPlaying();
  }

  // ---------------------------------------------------------------- 1. hero

  function buildHero() {
    var splash = document.getElementById('splashScreen');
    if (!splash || splash.querySelector('.ss-hero-inner')) return;
    splash.classList.add('ss-hero');

    var inner = el('div', 'ss-hero-inner');
    inner.innerHTML =
      '<div class="ss-eyebrow">Haidian Soundscape · 台南 海佃</div>' +
      '<h1 class="ss-hero-title">海佃<em>溪遊記</em></h1>' +
      '<p class="ss-hero-sub">一張用耳朵閱讀的地圖</p>' +
      '<div class="ss-orb-wrap">' +
        '<span class="ss-orb-ring"></span><span class="ss-orb-ring"></span><span class="ss-orb-ring"></span>' +
        '<button type="button" class="ss-orb" id="ssOrb" aria-label="隨機聽一段聲音" disabled>' + ICON.play + '</button>' +
      '</div>' +
      '<div class="ss-orb-label">隨機聽一段</div>' +
      '<div class="ss-featured" id="ssFeatured" aria-live="polite"><span class="ss-featured-meta">正在載入聲音…</span></div>' +
      '<div class="ss-hero-actions">' +
        '<button type="button" class="ss-ghost-btn" id="ssReroll">' + ICON.shuffle + '換一段</button>' +
        '<button type="button" class="ss-ghost-btn" id="ssSkip">' + ICON.map + '直接看地圖</button>' +
      '</div>' +
      '<div class="ss-hero-foot" id="ssHeroFoot"><button type="button" id="ssAbout">關於這個計畫</button></div>';
    splash.appendChild(inner);

    document.getElementById('ssSkip').addEventListener('click', function () { window.enterMap && window.enterMap(); });
    document.getElementById('ssAbout').addEventListener('click', function () {
      window.enterMap && window.enterMap();
      setTimeout(function () { window.openModal && window.openModal('aboutModal'); }, 250);
    });
    document.getElementById('ssReroll').addEventListener('click', function () { pickHero(true); });
    document.getElementById('ssOrb').addEventListener('click', function () {
      var pick = state.heroPick;
      if (!pick) return;
      window.enterMap && window.enterMap();
      playUid(pick.uid, { openCard: true });
    });

    var syncSplash = function () {
      var open = splash.style.display !== 'none' && !splash.classList.contains('is-hidden');
      document.body.classList.toggle('ss-splash-open', open);
    };
    new MutationObserver(syncSplash).observe(splash, { attributes: true, attributeFilter: ['style', 'class'] });
    syncSplash();

    waitFor(function () { return items().length ? items() : null; }, function () {
      pickHero(false);
      var list = items().filter(isPlayable);
      var cats = new Set(list.map(function (i) { return catOf(i).cls; }));
      var foot = document.getElementById('ssHeroFoot');
      if (foot) {
        foot.insertBefore(el('span', '', '<b>' + list.length + '</b> 段聲音'), foot.firstChild);
        foot.insertBefore(el('span', '', '<b>' + cats.size + '</b> 種聲景'), foot.children[1]);
      }
    });
  }

  function pickHero(reroll) {
    var pick = randomPick(reroll && state.heroPick ? state.heroPick.uid : null);
    var box = document.getElementById('ssFeatured');
    var orb = document.getElementById('ssOrb');
    if (!pick || !box) return;
    state.heroPick = pick;
    var cat = catOf(pick);
    box.innerHTML =
      '<div class="ss-featured-title">' + esc(plain(pick.title)) + '</div>' +
      '<div class="ss-featured-meta"><span class="ss-dot ' + cat.cls + '"></span>' + esc(cat.label) + '・' + esc(plain(pick.author || '海佃特派員')) + '</div>';
    if (orb) orb.disabled = false;
  }

  // ---------------------------------------------------------------- 2. bar

  function buildBar() {
    if (document.getElementById('ssBar')) return;
    var bar = el('div');
    bar.id = 'ssBar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '正在播放');
    bar.innerHTML =
      '<div class="ss-bar-progress" id="ssProgress" title="拖曳或點擊跳轉"><i></i></div>' +
      '<div class="ss-bar-row">' +
        '<button type="button" class="ss-bar-cover" id="ssCover" aria-label="開啟作品卡片"><img alt=""><span class="ss-eq"><i></i><i></i><i></i></span></button>' +
        '<div class="ss-bar-text" id="ssText"><div class="ss-bar-title" id="ssTitle"></div><div class="ss-bar-meta"><span class="ss-dot" id="ssDot"></span><span id="ssMeta"></span><span class="ss-time" id="ssTime"></span></div></div>' +
        '<div class="ss-wave" id="ssWave" title="點擊跳轉"><img class="ss-wave-base" alt=""><img class="ss-wave-prog" alt=""></div>' +
        '<div class="ss-bar-btns">' +
          '<button type="button" class="ss-roam" id="ssRoam" title="播完自動接附近的下一段">' + ICON.roam + '<span>聲音漫遊</span></button>' +
          '<button type="button" class="ss-icon-btn ss-play-btn" id="ssPlay" aria-label="播放或暫停">' + ICON.pause + '</button>' +
          '<button type="button" class="ss-icon-btn" id="ssNext" aria-label="附近的下一段" title="附近的下一段">' + ICON.next + '</button>' +
          '<button type="button" class="ss-icon-btn ss-hide-sm" id="ssShuffle" aria-label="隨機一段" title="隨機一段">' + ICON.shuffle + '</button>' +
          '<button type="button" class="ss-icon-btn" id="ssClose" aria-label="停止播放" title="停止播放">' + ICON.close + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.disableScrollPropagation(bar);
    }

    document.getElementById('ssPlay').addEventListener('click', function () {
      var a = audio();
      if (!a) return;
      if (a.paused) a.play().catch(function () {}); else a.pause();
    });
    document.getElementById('ssNext').addEventListener('click', function () {
      var n = nextNearby();
      if (n) playUid(n.uid);
    });
    document.getElementById('ssShuffle').addEventListener('click', function () {
      var n = randomPick(state.uid);
      if (n) playUid(n.uid);
    });
    document.getElementById('ssClose').addEventListener('click', stopAll);
    var openCard = function () { if (state.uid && window.focusMarkerOnMap) window.focusMarkerOnMap(state.uid); };
    document.getElementById('ssCover').addEventListener('click', openCard);
    document.getElementById('ssText').addEventListener('click', openCard);

    var roam = document.getElementById('ssRoam');
    var syncRoam = function () {
      roam.classList.toggle('is-on', state.roam);
      roam.setAttribute('aria-pressed', state.roam ? 'true' : 'false');
    };
    roam.addEventListener('click', function () {
      state.roam = !state.roam;
      writeLS(LS_ROAM, state.roam ? '1' : '0');
      syncRoam();
      if (typeof window.showToast === 'function') window.showToast(state.roam ? '聲音漫遊：播完會自動接附近的下一段' : '已關閉聲音漫遊');
    });
    syncRoam();

    [document.getElementById('ssProgress'), document.getElementById('ssWave')].forEach(function (node) {
      node.addEventListener('click', function (e) {
        var a = audio();
        if (!a || !a.duration) return;
        var r = node.getBoundingClientRect();
        a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration;
      });
    });
  }

  function syncBarTrack() {
    var uid = window.currentAudioUid;
    if (!uid) return;
    var item = findItem(uid);
    if (!item) return;
    state.uid = uid;
    state.played.add(uid);
    var cat = catOf(item);
    var img = document.querySelector('#ssCover img');
    if (img) {
      img.classList.remove('is-broken');
      img.onerror = function () {
        if (img.src !== FALLBACK_COVER) img.src = FALLBACK_COVER; else img.classList.add('is-broken');
      };
      img.src = item.coverUrl || FALLBACK_COVER;
    }
    document.getElementById('ssTitle').textContent = plain(item.title);
    document.getElementById('ssMeta').textContent = cat.label + '・' + plain(item.author || '海佃特派員');
    document.getElementById('ssDot').className = 'ss-dot ' + cat.cls;
    var wave = document.getElementById('ssWave');
    var w = waveformUrls(item.audioUrl);
    wave.classList.toggle('has-wave', !!w);
    if (w) {
      wave.querySelector('.ss-wave-base').src = w.base;
      wave.querySelector('.ss-wave-prog').src = w.prog;
    }
    document.body.classList.add('ss-has-bar');
    syncBarVisibility();
    markNowPlaying();
  }

  // Cloudinary 可直接產生波形圖；其他來源只顯示細進度線。
  function waveformUrls(url) {
    if (!url || url.indexOf('res.cloudinary.com') < 0) return null;
    var make = function (c) {
      return url.replace('/upload/', '/upload/fl_waveform,co_rgb:' + c + ',b_transparent,w_900,h_90/').replace(/\.[^.\/]+$/, '.png');
    };
    return { base: make('5b6b6e'), prog: make('f3c26b') };
  }

  function syncBarState() {
    var a = audio();
    if (!a) return;
    var playing = !a.paused && !a.ended;
    document.body.classList.toggle('ss-playing', playing);
    var btn = document.getElementById('ssPlay');
    if (btn) btn.innerHTML = playing ? ICON.pause : ICON.play;
    syncCoverButtons();
  }

  function syncBarTime() {
    var a = audio();
    if (!a) return;
    var bar = document.querySelector('#ssProgress > i');
    var t = document.getElementById('ssTime');
    var pct = a.duration ? (a.currentTime / a.duration * 100) : 0;
    if (bar) bar.style.width = pct + '%';
    var prog = document.querySelector('#ssWave .ss-wave-prog');
    if (prog) prog.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
    if (t) t.textContent = a.duration ? fmt(a.currentTime) + ' / ' + fmt(a.duration) : '';
  }

  function syncBarVisibility() {
    document.body.classList.toggle('ss-card-open', !isSheetMode() && !!state.openPopupUid);
  }

  function bindAudio() {
    var a = audio();
    if (!a || a.__ssBound) return;
    a.__ssBound = true;
    a.addEventListener('play', function () { syncBarTrack(); syncBarState(); });
    a.addEventListener('pause', syncBarState);
    a.addEventListener('loadstart', function () { syncBarTrack(); syncBarTime(); });
    a.addEventListener('timeupdate', syncBarTime);
    a.addEventListener('loadedmetadata', function () {
      if (state.uid && a.duration) state.durations[state.uid] = a.duration;
      syncBarTime();
    });
    a.addEventListener('ended', function () {
      syncBarState();
      if (!state.roam || window.isRoutePlaying) return;
      var n = nextNearby();
      if (n) setTimeout(function () { playUid(n.uid); }, 900);
    });
  }

  // ---------------------------------------------------------------- 3. markers + chips

  function markNowPlaying() {
    document.querySelectorAll('.custom-sound-icon.ss-now').forEach(function (n) { n.classList.remove('ss-now'); });
    if (!state.uid || !window.globalMarkerMap) return;
    var m = window.globalMarkerMap[state.uid];
    var icon = m && m._icon;
    if (!icon) return;
    icon.classList.add('ss-now');
    var dot = icon.querySelector('.sound-dot-marker');
    if (dot && !dot.querySelector('.ss-ring')) dot.appendChild(el('span', 'ss-ring'));
  }

  function buildChips() {
    if (document.getElementById('ssChips')) return;
    var wrap = el('div');
    wrap.id = 'ssChips';
    wrap.setAttribute('role', 'toolbar');
    wrap.setAttribute('aria-label', '聲景分類篩選');
    var tune = el('button', 'ss-chip ss-chip-tune', ICON.tune + '調頻漫遊');
    tune.type = 'button';
    tune.id = 'ssTuneChip';
    tune.setAttribute('aria-pressed', 'false');
    tune.title = '拖動地圖，讓準星靠近聲音就自動播放';
    tune.addEventListener('click', function () { setTune(!state.tune); });
    wrap.appendChild(tune);
    wrap.appendChild(el('span', 'ss-chip-sep'));
    var defs = [{ key: 'all', cls: '', label: '全部' }].concat(CATS);
    defs.forEach(function (c) {
      var b = el('button', 'ss-chip', (c.cls ? '<span class="ss-dot ' + c.cls + '"></span>' : '') + esc(c.label) + '<span class="ss-count" data-count="' + c.key + '"></span>');
      b.type = 'button';
      b.dataset.cat = c.key;
      b.addEventListener('click', function () { setCategory(c.key); });
      wrap.appendChild(b);
    });
    document.body.appendChild(wrap);
    if (window.L && L.DomEvent) L.DomEvent.disableClickPropagation(wrap);
    syncChips();

    document.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'catFilter') syncChips();
    });
    waitFor(function () { return items().length ? 1 : null; }, function () {
      var list = items().filter(function (i) { return !i.isProcessing; });
      var counts = { all: list.length };
      list.forEach(function (i) { var k = catOf(i).key; if (k) counts[k] = (counts[k] || 0) + 1; });
      wrap.querySelectorAll('[data-count]').forEach(function (n) {
        var v = counts[n.getAttribute('data-count')];
        n.textContent = v ? String(v) : '';
      });
    });
  }

  function setCategory(key) {
    var radio = document.querySelector('input[name="catFilter"][value="' + key + '"]');
    if (!radio || typeof window.filterMarkers !== 'function') return;
    radio.checked = true;
    window.filterMarkers();
    syncChips();
    setTimeout(markNowPlaying, 50);
  }

  function syncChips() {
    var cur = document.querySelector('input[name="catFilter"]:checked');
    var v = cur ? cur.value : 'all';
    document.querySelectorAll('#ssChips .ss-chip').forEach(function (b) {
      var on = b.dataset.cat === v;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------- 調頻漫遊
  // 參考 Radio Garden：拖動地圖讓準星靠近一段聲音，就自動切換過去，聲音淡入淡出。

  var TUNE_RADIUS = 72;

  function buildTune() {
    if (document.getElementById('ssReticle')) return;
    var ret = el('div', '', '<span class="ss-ret-ring"></span><span class="ss-ret-dot"></span><div class="ss-ret-label" id="ssRetLabel"></div>');
    ret.id = 'ssReticle';
    ret.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ret);
  }

  function setTune(on) {
    state.tune = on;
    document.body.classList.toggle('ss-tuning', on);
    var chip = document.getElementById('ssTuneChip');
    if (chip) {
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (on) {
      buildTune();
      if (window.map) window.map.closePopup();
      if (typeof window.showToast === 'function') window.showToast('調頻漫遊：拖動地圖，讓準星靠近聲音');
      tuneScan(true);
    } else {
      state.tuneTarget = null;
    }
  }

  function tuneCandidate() {
    var map = window.map;
    if (!map || !window.globalMarkerMap) return null;
    var size = map.getSize();
    var center = L.point(size.x / 2, size.y / 2);
    var best = null;
    Object.keys(window.globalMarkerMap).forEach(function (uid) {
      var m = window.globalMarkerMap[uid];
      var item = findItem(uid);
      if (!m || !isPlayable(item)) return;
      var d = map.latLngToContainerPoint(m.getLatLng()).distanceTo(center);
      if (d <= TUNE_RADIUS && (!best || d < best.d)) best = { uid: uid, d: d, item: item };
    });
    return best;
  }

  function tuneScan(settled) {
    if (!state.tune) return;
    var c = tuneCandidate();
    var label = document.getElementById('ssRetLabel');
    var ret = document.getElementById('ssReticle');
    if (ret) ret.classList.toggle('is-locked', !!c);
    if (label) {
      label.innerHTML = c
        ? '<span class="ss-dot ' + catOf(c.item).cls + '"></span>' + esc(plain(c.item.title))
        : '拖動地圖，靠近一段聲音';
    }
    if (!settled) return;
    if (c && c.uid !== window.currentAudioUid) {
      crossfadeTo(c.uid);
    } else if (!c && audio() && !audio().paused) {
      fade(0, 350, function () { audio().pause(); });
    } else if (c && audio() && audio().paused) {
      audio().play().catch(function () {});
      fade(state.volume, 400);
    }
  }

  function fade(to, ms, done) {
    var a = audio();
    if (!a) return done && done();
    clearInterval(a.__ssFade);
    var from = a.volume, t0 = Date.now();
    a.__ssFade = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / ms);
      try { a.volume = from + (to - from) * k; } catch (e) {}
      if (k >= 1) { clearInterval(a.__ssFade); if (done) done(); }
    }, 30);
  }

  function crossfadeTo(uid) {
    var a = audio();
    var go = function () {
      window.startGlobalPlayback && window.startGlobalPlayback(uid, { skipFocus: true });
      try { a.volume = 0; } catch (e) {}
      fade(state.volume, 500);
    };
    if (a && !a.paused) fade(0, 300, go); else go();
  }

  // ---------------------------------------------------------------- 4. basemap

  function softenBasemap() {
    [window.taiwanLayer, window.osmLayer].forEach(function (layer) {
      if (!layer || layer.__ssSoft) return;
      layer.__ssSoft = true;
      var apply = function () {
        var c = layer.getContainer && layer.getContainer();
        if (c) c.classList.add('ss-base-soft');
      };
      layer.on('add', apply);
      apply();
    });
  }

  // ---------------------------------------------------------------- 5 & 7. layout

  function tidyLayout() {
    var labels = { sidePanel: '聆聽', routePanel: '走讀' };
    Object.keys(labels).forEach(function (id) {
      var btn = document.querySelector('#' + id + ' > .toggle-btn');
      if (btn) {
        btn.setAttribute('data-ss-label', labels[id].split('').join('\n'));
        btn.setAttribute('aria-label', '開啟' + labels[id] + '面板');
      }
    });

    waitFor(function () { return document.querySelector('.haidian-v4-dock'); }, function (dock) {
      if (readLS(LS_DOCK) !== '1' && !dock.classList.contains('is-minimized')) {
        dock.classList.add('is-minimized');
        var t = dock.querySelector('.haidian-v4-dock-toggle');
        if (t) {
          t.textContent = '⌃';
          t.setAttribute('aria-label', '展開探索主線');
        }
      }
      dock.addEventListener('click', function (e) {
        if (!e.target.closest('.haidian-v4-dock-toggle')) return;
        setTimeout(function () { writeLS(LS_DOCK, dock.classList.contains('is-minimized') ? '0' : '1'); }, 0);
      });
    });
  }

  // ---------------------------------------------------------------- 6. cards + sheet

  function uidFromCard(root) {
    var slot = root && root.querySelector('[id^="embedded-player-slot-"]');
    return slot ? slot.id.replace('embedded-player-slot-', '') : null;
  }

  function enhanceCard(root, uid) {
    var card = root.querySelector('.sound-card');
    if (!card || card.__ssDone) return;
    card.__ssDone = true;
    card.classList.add('ss-card');
    var item = findItem(uid);
    if (!item) return;
    var cat = catOf(item);

    // 封面變成主視覺：標題、分類與長度疊在照片上
    var cover = card.querySelector('.sound-cover');
    if (cover) {
      var wrap = el('div', 'ss-cover-wrap');
      wrap.dataset.uid = uid;
      cover.parentNode.insertBefore(wrap, cover);
      wrap.appendChild(cover);
      wrap.appendChild(el('span', 'ss-cover-shade'));
      wrap.appendChild(el('span', 'ss-cover-cat', '<span class="ss-dot ' + cat.cls + '"></span>' + esc(cat.label)));
      var title = card.querySelector('.sound-title');
      if (title) {
        var cap = el('div', 'ss-cover-caption');
        cap.appendChild(title);
        var by = el('div', 'ss-cover-by', esc(plain(item.author || '海佃特派員')));
        cap.appendChild(by);
        wrap.appendChild(cap);
      }
      if (isPlayable(item)) {
        wrap.classList.add('is-playable');
        wrap.setAttribute('role', 'button');
        wrap.setAttribute('tabindex', '0');
        var ctl = el('span', 'ss-cover-play');
        wrap.appendChild(ctl);
        var dur = el('span', 'ss-cover-duration');
        wrap.appendChild(dur);
        var act = function (e) {
          if (e) { e.preventDefault(); e.stopPropagation(); }
          var a = audio();
          var current = window.currentAudioUid === uid;
          // 正在播放這一首時，封面只顯示狀態；暫停、下一首都在底部播放列。
          if (current && a && !a.paused) return;
          if (current && a) { a.play().catch(function () {}); return; }
          window.startGlobalPlayback && window.startGlobalPlayback(uid, { skipFocus: true });
        };
        wrap.addEventListener('click', act);
        wrap.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') act(e); });
        loadDuration(item, dur);
      }
    }

    var gps = card.querySelector('.meta-gps');
    if (gps && item.lat) loadPlace(item, gps);
    syncCoverButtons();
  }

  function loadDuration(item, node) {
    if (state.durations[item.uid]) { node.textContent = fmt(state.durations[item.uid]); return; }
    var probe = new Audio();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', function () {
      if (isFinite(probe.duration)) {
        state.durations[item.uid] = probe.duration;
        node.textContent = fmt(probe.duration);
      }
      probe.removeAttribute('src');
      probe.load();
    }, { once: true });
    probe.src = item.audioUrl;
  }

  var placeQueue = Promise.resolve();
  function loadPlace(item, node) {
    var key = (+item.lat).toFixed(4) + ',' + (+item.lon).toFixed(4);
    var coords = (+item.lat).toFixed(4) + ', ' + (+item.lon).toFixed(4);
    var svg = node.querySelector('svg');
    node.textContent = '';
    if (svg) node.appendChild(svg);
    var nameNode = el('span', 'ss-place-name');
    var coordNode = el('button', 'ss-place-coords', esc(coords));
    coordNode.type = 'button';
    coordNode.title = '複製座標';
    coordNode.addEventListener('click', function (e) {
      e.stopPropagation();
      try {
        navigator.clipboard.writeText(coords).then(function () {
          if (typeof window.showToast === 'function') window.showToast('已複製座標 ' + coords);
          coordNode.classList.add('is-copied');
          setTimeout(function () { coordNode.classList.remove('is-copied'); }, 1200);
        });
      } catch (err) {}
    });
    node.appendChild(nameNode);
    node.appendChild(coordNode);
    node.classList.add('ss-place');
    var paint = function (name) {
      if (!name) return;
      nameNode.textContent = name;
      node.classList.add('has-name');
    };
    if (state.places[key]) return paint(state.places[key]);

    // Nominatim 規範每秒最多一次請求，依序排隊並快取在瀏覽器。
    placeQueue = placeQueue.then(function () {
      if (state.places[key]) return paint(state.places[key]);
      var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=zh-TW&lat=' + item.lat + '&lon=' + item.lon;
      return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var a = (j && j.address) || {};
        var spot = j && j.name ? j.name : (a.amenity || a.leisure || a.road || a.neighbourhood || '');
        var area = a.city_district || a.suburb || a.town || a.village || '';
        var name = [area, spot].filter(Boolean).join('・');
        if (!name) return;
        state.places[key] = name;
        writeLS(LS_PLACE, JSON.stringify(state.places));
        paint(name);
      }).catch(function () {}).then(function () {
        return new Promise(function (res) { setTimeout(res, 1100); });
      });
    });
  }

  function syncCoverButtons() {
    var a = audio();
    document.querySelectorAll('.ss-cover-wrap.is-playable').forEach(function (w) {
      var current = w.dataset.uid === window.currentAudioUid;
      var playing = current && a && !a.paused;
      w.classList.toggle('is-current', !!current);
      w.classList.toggle('is-playing', !!playing);
      var p = w.querySelector('.ss-cover-play');
      if (p) p.innerHTML = playing ? '<span class="ss-eq"><i></i><i></i><i></i></span><span>正在播放</span>' : ICON.play;
      w.setAttribute('aria-label', playing ? '正在播放，請用下方播放列控制' : '播放這段聲音');
    });
  }

  var sheet = null;
  function buildSheet() {
    if (sheet) return;
    sheet = el('div');
    sheet.id = 'ssSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', '聲景作品');
    sheet.innerHTML = '<div class="ss-sheet-grip" aria-hidden="true"></div><button type="button" class="ss-sheet-close" aria-label="關閉">' + ICON.close + '</button><div class="ss-sheet-body"></div>';
    document.body.appendChild(sheet);
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(sheet);
      L.DomEvent.disableScrollPropagation(sheet);
    }
    sheet.querySelector('.ss-sheet-close').addEventListener('click', function () { window.map && window.map.closePopup(); });

    var grip = sheet.querySelector('.ss-sheet-grip');
    var startY = null;
    grip.addEventListener('touchstart', function (e) { startY = e.touches[0].clientY; sheet.style.transition = 'none'; }, { passive: true });
    grip.addEventListener('touchmove', function (e) {
      if (startY == null) return;
      var dy = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    grip.addEventListener('touchend', function (e) {
      if (startY == null) return;
      var dy = e.changedTouches[0].clientY - startY;
      startY = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 80 && window.map) window.map.closePopup();
    });
  }

  function openSheet(popup) {
    buildSheet();
    var content = popup.getElement && popup.getElement().querySelector('.leaflet-popup-content');
    if (!content) return;
    var body = sheet.querySelector('.ss-sheet-body');
    body.innerHTML = '';
    while (content.firstChild) body.appendChild(content.firstChild);
    body.scrollTop = 0;
    sheet.__popup = popup;
    sheet.classList.add('is-open');
    document.body.classList.add('ss-sheet-open');

    // 讓地圖點落在面板上方可見範圍的中間
    var map = window.map;
    if (map && popup.getLatLng) {
      requestAnimationFrame(function () {
        var pt = map.latLngToContainerPoint(popup.getLatLng());
        var visible = window.innerHeight - sheet.offsetHeight;
        var targetY = Math.max(120, visible * 0.55);
        map.panBy([0, pt.y - targetY], { animate: true, duration: 0.4 });
      });
    }
  }

  function closeSheet(popup) {
    if (!sheet || (popup && sheet.__popup && sheet.__popup !== popup)) return;
    sheet.classList.remove('is-open');
    sheet.__popup = null;
    document.body.classList.remove('ss-sheet-open');
    var body = sheet.querySelector('.ss-sheet-body');
    // 等動畫結束再清空，避免面板收合時內容先消失
    setTimeout(function () { if (!sheet.__popup) body.innerHTML = ''; }, 450);
  }

  function bindMap() {
    var map = window.map;
    if (!map || map.__ssBound) return;
    map.__ssBound = true;

    map.on('popupopen', function (e) {
      var root = e.popup.getElement && e.popup.getElement();
      var uid = uidFromCard(root);
      state.openPopupUid = uid;
      if (uid) {
        enhanceCard(root, uid);
        if (isSheetMode()) {
          document.body.classList.add('ss-sheet-mode');
          openSheet(e.popup);
        }
      }
      syncBarVisibility();
    });

    map.on('popupclose', function (e) {
      // 標記為「卡片關閉」，讓包裝過的 closeGlobalPlayer 不要停掉聲音。
      state.closingFromPopup = true;
      setTimeout(function () { state.closingFromPopup = false; }, 0);
      state.openPopupUid = null;
      closeSheet(e.popup);
      syncBarVisibility();
    });

    map.on('move', function () { if (state.tune) tuneScan(false); });
    map.on('moveend', function () { if (state.tune) setTimeout(function () { tuneScan(true); }, 60); });
    map.on('dragstart', function () { document.body.classList.add('ss-dragging'); });
    map.on('dragend', function () { document.body.classList.remove('ss-dragging'); });

    var refresh = function () { setTimeout(markNowPlaying, 30); };
    map.on('zoomend moveend', refresh);
    if (window.markerCluster) window.markerCluster.on('animationend', refresh);

    // 手機面板模式下，隱形的 Leaflet 卡片不需要自動平移地圖。
    if (window.L && L.Popup && L.Popup.prototype._adjustPan && !L.Popup.prototype.__ssPan) {
      var adjust = L.Popup.prototype._adjustPan;
      L.Popup.prototype._adjustPan = function () {
        if (isSheetMode()) return;
        // 桌機版留出上方標題列與分類按鈕的空間，卡片不會被蓋住。
        var pad = this.options.autoPanPaddingTopLeft;
        if (pad && document.getElementById('ssChips')) {
          var top = L.point(pad).y;
          if (top < 150) this.options.autoPanPaddingTopLeft = [L.point(pad).x, 150];
        }
        return adjust.apply(this, arguments);
      };
      L.Popup.prototype.__ssPan = true;
    }
  }

  // ---------------------------------------------------------------- boot

  function boot() {
    buildHero();
    buildBar();
    buildChips();
    tidyLayout();
    waitFor(function () { return window.map && window.globalAudio; }, function () {
      wrapCloseGlobalPlayer();
      disableEmbeddedPlayer();
      bindAudio();
      bindMap();
      softenBasemap();
    });
    var cardBtn = document.querySelector('.close-player-btn');
    if (cardBtn) cardBtn.addEventListener('click', function () { onStopped(); });
    window.addEventListener('resize', syncBarVisibility);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
