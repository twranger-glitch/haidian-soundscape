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
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/></svg>'
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

    splash.appendChild(el('div', 'ss-hero-bg'));
    splash.appendChild(el('div', 'ss-hero-bg'));
    splash.appendChild(el('div', 'ss-hero-veil'));

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
    setHeroBg(pick.coverUrl || FALLBACK_COVER);
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
    markHeard(uid);
    if (state.history[state.history.length - 1] !== uid) state.history.push(uid);
    if (state.history.length > 60) state.history.shift();
    syncMediaSession(item);
    syncNowColor(item);
    setTimeout(syncNextHint, 0);
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
    if (document.body.classList.contains('ss-list-open')) renderList();
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
    syncHeard();
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
    if (document.body.classList.contains('ss-list-open')) renderList();
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
      watchCover(wrap);
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
    addRelated(card, item);
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
          if (document.body.classList.contains('ss-list-open')) setList(false);
          openSheet(e.popup);
        } else if (e.popup._updateLayout && e.popup._updatePosition) {
          // 卡片加了「附近還有」之後變高，重新定位一次。
          // 不能用 popup.update()，它會用原始 HTML 重畫內容而把這些調整洗掉。
          e.popup._updateLayout();
          e.popup._updatePosition();
          if (e.popup._adjustPan) e.popup._adjustPan();
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

  // ================================================================ 第三輪：探索與回饋

  var LS_HEARD = 'ss-heard-v1';
  state.heard = new Set(readJSON(LS_HEARD) || []);
  state.history = [];

  function hoverable() {
    return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  }

  function haversine(a, b) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (+b.lat - +a.lat) * toRad, dLon = (+b.lon - +a.lon) * toRad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(+a.lat * toRad) * Math.cos(+b.lat * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function fmtDist(m) {
    if (!isFinite(m)) return '';
    if (m < 50) return '就在旁邊';
    if (m < 1000) return Math.round(m / 10) * 10 + ' 公尺';
    return (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' 公里';
  }

  // ---- 已聽過的聲音：實心點是還沒聽過，空心點是聽過了 ----

  function markHeard(uid) {
    if (!uid || state.heard.has(uid)) return;
    state.heard.add(uid);
    writeLS(LS_HEARD, JSON.stringify(Array.from(state.heard)));
    syncHeard();
  }

  function heardStats() {
    var list = items().filter(isPlayable);
    var n = list.filter(function (i) { return state.heard.has(i.uid); }).length;
    return { total: list.length, heard: n };
  }

  function syncHeard() {
    if (window.globalMarkerMap) {
      Object.keys(window.globalMarkerMap).forEach(function (uid) {
        var m = window.globalMarkerMap[uid];
        if (m && m._icon) m._icon.classList.toggle('ss-heard', state.heard.has(uid));
      });
    }
    var s = heardStats();
    document.querySelectorAll('[data-ss-heard]').forEach(function (node) {
      node.textContent = s.heard ? '已聽 ' + s.heard + ' / ' + s.total : s.total + ' 段聲音';
    });
    var pct = s.total ? Math.round(100 * s.heard / s.total) : 0;
    document.querySelectorAll('[data-ss-heard-bar]').forEach(function (b) { b.style.width = pct + '%'; });
    document.querySelectorAll('[data-ss-heard-pct]').forEach(function (b) { b.textContent = s.heard ? pct + '%' : '還沒開始'; });
  }

  // ---- 滑鼠靠近聲音點就先告訴你是什麼 ----

  function bindTips() {
    if (!hoverable() || !window.globalMarkerMap || !window.L) return;
    Object.keys(window.globalMarkerMap).forEach(function (uid) {
      var m = window.globalMarkerMap[uid];
      if (!m || m.__ssTip || !m.bindTooltip) return;
      var item = findItem(uid);
      if (!item) return;
      m.__ssTip = true;
      var cat = catOf(item);
      var html = '<span class="ss-dot ' + cat.cls + '"></span><b>' + esc(plain(item.title)) + '</b><i>' + esc(cat.label) + '・' + esc(plain(item.author || '海佃特派員')) + '</i>';
      m.bindTooltip(html, { direction: 'top', offset: [0, -18], className: 'ss-tip', opacity: 1 });
      m.on('popupopen', function () { try { m.closeTooltip(); } catch (e) {} });
    });
  }

  // 篩選會重畫所有標記，重畫後補上提示與狀態。
  function wrapRenderMarkers() {
    var orig = window.renderMarkers;
    if (typeof orig !== 'function' || orig.__ssWrapped) return;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      afterRender();
      return r;
    };
    wrapped.__ssWrapped = true;
    window.renderMarkers = wrapped;
  }

  function afterRender() {
    bindTips();
    setTimeout(function () { markNowPlaying(); syncHeard(); }, 30);
  }

  // ---- 沒在播放時，底部常駐一顆「隨機聽一段」 ----

  function buildIdle() {
    if (document.getElementById('ssIdle')) return;
    var pill = el('button', 'ss-idle', ICON.play + '<span class="ss-idle-text">隨機聽一段</span><span class="ss-idle-sub" data-ss-heard></span>');
    pill.type = 'button';
    pill.id = 'ssIdle';
    pill.setAttribute('aria-label', '隨機聽一段聲音');
    pill.addEventListener('click', function () {
      var n = randomPick(null);
      if (n) playUid(n.uid, { openCard: true });
    });
    document.body.appendChild(pill);
    if (window.L && L.DomEvent) L.DomEvent.disableClickPropagation(pill);
  }

  // ---- 卡片底部：附近還有哪些聲音 ----

  function addRelated(card, item) {
    var info = card.querySelector('.sound-info');
    if (!info || info.querySelector('.ss-related')) return;
    var list = items()
      .filter(function (i) { return i.uid !== item.uid && isPlayable(i); })
      .map(function (i) { return { item: i, d: haversine(item, i) }; })
      .sort(function (a, b) { return a.d - b.d; })
      .slice(0, 3);
    if (!list.length) return;
    var box = el('div', 'ss-related', '<div class="ss-related-title">附近還有</div>');
    list.forEach(function (r) {
      var cat = catOf(r.item);
      var row = el('button', 'ss-related-row' + (state.heard.has(r.item.uid) ? ' is-heard' : ''));
      row.type = 'button';
      row.dataset.uid = r.item.uid;
      var img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = r.item.coverUrl || FALLBACK_COVER;
      img.onerror = function () { if (img.src !== FALLBACK_COVER) img.src = FALLBACK_COVER; };
      row.appendChild(img);
      row.appendChild(el('span', 'ss-related-text',
        '<b>' + esc(plain(r.item.title)) + '</b>' +
        '<i><span class="ss-dot ' + cat.cls + '"></span>' + esc(cat.label) + '・' + fmtDist(r.d) + '</i>'));
      row.appendChild(el('span', 'ss-related-play', ICON.play));
      row.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        playUid(r.item.uid, { openCard: true });
      });
      box.appendChild(row);
    });
    info.appendChild(box);
  }

  // ---- 封面載入前先鋪一層微光 ----

  function watchCover(wrap) {
    var img = wrap.querySelector('.sound-cover');
    if (!img) return;
    var done = function () { wrap.classList.add('is-loaded'); };
    if (img.complete && img.naturalWidth) done();
    else {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
  }

  // ---- 鎖定畫面與耳機按鍵 ----

  function syncMediaSession(item) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: plain(item.title),
        artist: plain(item.author || '海佃特派員'),
        album: '海佃溪遊記・' + catOf(item).label,
        artwork: item.coverUrl ? [{ src: item.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : []
      });
    } catch (e) {}
  }

  function bindMediaSession() {
    if (!('mediaSession' in navigator) || bindMediaSession.done) return;
    bindMediaSession.done = true;
    var set = function (k, fn) { try { navigator.mediaSession.setActionHandler(k, fn); } catch (e) {} };
    set('play', function () { var a = audio(); if (a) a.play().catch(function () {}); });
    set('pause', function () { var a = audio(); if (a) a.pause(); });
    set('nexttrack', playNext);
    set('previoustrack', playPrevious);
    set('seekbackward', function (d) { seekBy(-((d && d.seekOffset) || 10)); });
    set('seekforward', function (d) { seekBy((d && d.seekOffset) || 10); });
  }

  function playNext() { var n = nextNearby(); if (n) playUid(n.uid); }
  function playShuffle() { var n = randomPick(state.uid); if (n) playUid(n.uid); }
  function playPrevious() {
    if (state.history.length < 2) return;
    state.history.pop();
    var prev = state.history.pop();
    if (prev) playUid(prev);
  }
  function seekBy(sec) {
    var a = audio();
    if (!a || !a.duration) return;
    a.currentTime = Math.max(0, Math.min(a.duration, a.currentTime + sec));
  }

  // ---- 鍵盤：空白鍵播放暫停，N 下一段，P 上一段，S 隨機，左右鍵快轉 ----

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      var a = audio();
      switch (e.key) {
        case ' ':
          if (!state.uid || !a) return;
          e.preventDefault();
          if (a.paused) a.play().catch(function () {}); else a.pause();
          break;
        case 'ArrowRight': if (!state.uid) return; e.preventDefault(); seekBy(5); break;
        case 'ArrowLeft': if (!state.uid) return; e.preventDefault(); seekBy(-5); break;
        case 'n': case 'N': playNext(); break;
        case 'p': case 'P': playPrevious(); break;
        case 's': case 'S': playShuffle(); break;
        case 'Escape': if (state.openPopupUid && window.map) window.map.closePopup(); break;
      }
    });
    var hint = { ssPlay: '播放／暫停（空白鍵）', ssNext: '附近的下一段（N）', ssShuffle: '隨機一段（S）', ssClose: '停止播放' };
    if (hoverable()) Object.keys(hint).forEach(function (id) { var b = document.getElementById(id); if (b) b.title = hint[id]; });
  }

  // ---- 手機：在播放列文字上左右滑切歌 ----

  function bindBarSwipe() {
    var text = document.getElementById('ssText');
    if (!text) return;
    var sx = null, sy = null;
    text.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    text.addEventListener('touchend', function (e) {
      if (sx == null) return;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      sx = sy = null;
      if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
      if (dx < 0) playNext(); else playPrevious();
    });
  }

  // ---- 首頁：拿這段聲音的封面當背景，慢慢推近 ----

  function setHeroBg(url) {
    var layers = document.querySelectorAll('.ss-hero-bg');
    if (!layers.length) return;
    var cur = document.querySelector('.ss-hero-bg.is-on');
    var next = layers[0] === cur ? layers[1] : layers[0];
    var probe = new Image();
    probe.onload = function () {
      next.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      next.classList.add('is-on');
      if (cur) cur.classList.remove('is-on');
    };
    probe.onerror = function () { if (url !== FALLBACK_COVER) setHeroBg(FALLBACK_COVER); };
    probe.src = url;
  }

  // ---- 分享連結直接降落在那段聲音，不用先看首頁 ----

  function landOnSharedWork() {
    var work = null;
    try { work = new URLSearchParams(location.search).get('work'); } catch (e) {}
    if (!work) return;
    waitFor(function () { return typeof window.enterMap === 'function' && document.getElementById('splashScreen'); }, function () {
      window.enterMap();
    });
  }

  // ================================================================ 第四輪：沉浸與細節

  // ---- 首頁問候跟著時段走 ----

  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 11) return '早安';
    if (h < 14) return '午安';
    if (h < 18) return '午後好';
    return '晚安';
  }

  function heroGreeting() {
    var eyebrow = document.querySelector('.ss-eyebrow');
    if (eyebrow) eyebrow.innerHTML = '<span class="ss-greet">' + greeting() + '</span>・Haidian Soundscape・台南 海佃';
  }

  // ---- 播放列：分享、下一段預告、分類色 ----

  function buildBarExtras() {
    var btns = document.querySelector('.ss-bar-btns');
    if (!btns || document.getElementById('ssShare')) return;
    var share = el('button', 'ss-icon-btn ss-hide-sm', ICON.share);
    share.type = 'button';
    share.id = 'ssShare';
    share.setAttribute('aria-label', '分享這段聲音');
    share.title = '分享這段聲音';
    share.addEventListener('click', function (e) {
      if (state.uid && typeof window.shareWork === 'function') window.shareWork(e, state.uid);
    });
    btns.insertBefore(share, document.getElementById('ssClose'));
  }

  function syncNextHint() {
    var next = document.getElementById('ssNext');
    if (!next || !hoverable()) return;
    var n = nextNearby();
    next.title = n ? '下一段：' + plain(n.title) + '（N）' : '附近的下一段（N）';
  }

  var CAT_COLOR = { 'cat-nature': '#10b981', 'cat-culture': '#f59e0b', 'cat-industry': '#ea580c', 'cat-space': '#3b82f6', 'cat-history': '#8b5cf6', 'cat-default': '#64748b' };
  function syncNowColor(item) {
    var c = CAT_COLOR[catOf(item).cls] || CAT_COLOR['cat-default'];
    document.body.style.setProperty('--ss-now', c);
  }

  // ---- 手機面板：點地圖或往下拉封面就收起 ----

  function bindSheetGestures() {
    var map = window.map;
    if (!map || map.__ssSheetTap) return;
    map.__ssSheetTap = true;
    map.on('click', function () {
      if (isSheetMode() && state.openPopupUid && !state.tune) map.closePopup();
    });
    // Leaflet 在面板上擋掉了 touchstart 冒泡，所以直接掛在面板本身。
    buildSheet();
    sheet.addEventListener('touchstart', function (e) {
      var wrap = e.target.closest && e.target.closest('.ss-cover-wrap');
      if (!wrap) return;
      var y0 = e.touches[0].clientY, moved = 0;
      var onMove = function (ev) {
        moved = Math.max(0, ev.touches[0].clientY - y0);
        sheet.style.transition = 'none';
        sheet.style.transform = 'translateY(' + moved + 'px)';
      };
      var onEnd = function () {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (moved > 90 && window.map) window.map.closePopup();
      };
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    }, { passive: true });
  }

  // ================================================================ 第六輪：聲音清單
  // 不想在地圖上找點的人，可以直接翻清單：最新、離我最近、離地圖中心。

  var LS_SORT = 'ss-list-sort';
  var listEl = null;
  var listSort = readLS(LS_SORT) || 'latest';
  var userPos = null;

  function buildList() {
    if (listEl) return;
    listEl = el('div');
    listEl.id = 'ssList';
    listEl.setAttribute('role', 'dialog');
    listEl.setAttribute('aria-label', '聲音清單');
    listEl.innerHTML =
      '<div class="ss-list-head">' +
        '<div class="ss-list-title">聲音清單 <span class="ss-list-count" id="ssListCount"></span></div>' +
        '<div class="ss-list-sort" role="tablist">' +
          '<button type="button" data-sort="latest">最新</button>' +
          '<button type="button" data-sort="near">離我最近</button>' +
          '<button type="button" data-sort="center">離畫面中心</button>' +
        '</div>' +
        '<button type="button" class="ss-list-close" aria-label="關閉清單">' + ICON.close + '</button>' +
      '</div>' +
      '<div class="ss-list-body" id="ssListBody"></div>';
    document.body.appendChild(listEl);
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(listEl);
      L.DomEvent.disableScrollPropagation(listEl);
    }
    listEl.querySelector('.ss-list-close').addEventListener('click', function () { setList(false); });
    listEl.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        listSort = b.dataset.sort;
        writeLS(LS_SORT, listSort);
        if (listSort === 'near' && !userPos) locateForList();
        renderList();
      });
    });
    document.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'catFilter' && document.body.classList.contains('ss-list-open')) renderList();
    });
  }

  function locateForList() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      renderList();
    }, function () {
      if (typeof window.showToast === 'function') window.showToast('拿不到你的位置，改用畫面中心排序');
      listSort = 'center';
      renderList();
    }, { maximumAge: 60000, timeout: 8000 });
  }

  function listOrigin() {
    if (listSort === 'near' && userPos) return userPos;
    var map = window.map;
    if (!map) return null;
    var c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  function renderList() {
    if (!listEl) return;
    var cur = document.querySelector('input[name="catFilter"]:checked');
    var catKey = cur ? cur.value : 'all';
    var list = items().filter(function (i) { return isPlayable(i) && (catKey === 'all' || catOf(i).key === catKey); });
    var origin = listSort === 'latest' ? null : listOrigin();
    if (origin) {
      list = list.map(function (i) { return { item: i, d: haversine(origin, i) }; }).sort(function (a, b) { return a.d - b.d; });
    } else {
      list = list.map(function (i) { return { item: i, d: null }; }).sort(function (a, b) {
        return new Date(b.item.date || 0).getTime() - new Date(a.item.date || 0).getTime();
      });
    }
    listEl.querySelectorAll('[data-sort]').forEach(function (b) {
      var on = b.dataset.sort === listSort;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.getElementById('ssListCount').textContent = list.length;

    var body = document.getElementById('ssListBody');
    body.innerHTML = '';
    if (!list.length) {
      body.appendChild(el('div', 'ss-list-empty', '這個分類還沒有聲音'));
      return;
    }
    var frag = document.createDocumentFragment();
    list.forEach(function (r) {
      var it = r.item, cat = catOf(it);
      var row = el('button', 'ss-related-row ss-list-row' + (state.heard.has(it.uid) ? ' is-heard' : '') + (it.uid === state.uid ? ' is-now' : ''));
      row.type = 'button';
      row.dataset.uid = it.uid;
      var img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = it.coverUrl || FALLBACK_COVER;
      img.onerror = function () { if (img.src !== FALLBACK_COVER) img.src = FALLBACK_COVER; };
      row.appendChild(img);
      var sub = r.d != null ? fmtDist(r.d) : String(it.date || '').replace(' 00:00:00', '').split(' ')[0].replace(/-/g, '/');
      row.appendChild(el('span', 'ss-related-text',
        '<b>' + esc(plain(it.title)) + '</b>' +
        '<i><span class="ss-dot ' + cat.cls + '"></span>' + esc(cat.label) + '・' + esc(plain(it.author || '海佃特派員')) + (sub ? '・' + esc(sub) : '') + '</i>'));
      row.appendChild(el('span', 'ss-related-play', it.uid === state.uid ? '<span class="ss-eq"><i></i><i></i><i></i></span>' : ICON.play));
      row.addEventListener('click', function () {
        if (isSheetMode()) setList(false);
        playUid(it.uid, { openCard: true });
      });
      frag.appendChild(row);
    });
    body.appendChild(frag);
  }

  function setList(open) {
    buildList();
    document.body.classList.toggle('ss-list-open', open);
    var chip = document.getElementById('ssListChip');
    if (chip) {
      chip.classList.toggle('is-on', open);
      chip.setAttribute('aria-pressed', open ? 'true' : 'false');
    }
    if (open) {
      if (listSort === 'near' && !userPos) locateForList();
      renderList();
      if (isSheetMode() && window.map) window.map.closePopup();
    }
  }

  function buildListChip() {
    var wrap = document.getElementById('ssChips');
    if (!wrap || document.getElementById('ssListChip')) return;
    var chip = el('button', 'ss-chip ss-chip-list', ICON.list + '清單');
    chip.type = 'button';
    chip.id = 'ssListChip';
    chip.setAttribute('aria-pressed', 'false');
    chip.title = '翻看所有聲音';
    chip.addEventListener('click', function () { setList(!document.body.classList.contains('ss-list-open')); });
    var sep = wrap.querySelector('.ss-chip-sep');
    wrap.insertBefore(chip, sep);
  }

  // ---------------------------------------------------------------- 7. 聆聽／走讀面板
  // 兩個抽屜原本各自塞了模式標頭、模式切換器與分隔線；聆聽面板的類別單選又和地圖上的標籤重複。
  // 這裡把重複的拿掉，換成一個安靜的標題、一條聆聽進度，以及一排排「看得懂在做什麼」的列。

  var ROUTE_META = {
    nature: { title: '綠色生態走讀', desc: '自然絮語與空間聲，挑 5 站', color: '#10b981' },
    culture: { title: '聚落記憶尋寶', desc: '常民聲與歲月回音，挑 5 站', color: '#f59e0b' },
    geofence_yanshui: { title: '鹽水溪畔', desc: '溪岸兩側 200 公尺內的聲音', color: '#3498db' },
    geofence_jianan: { title: '嘉南大圳排水線', desc: '沿著鹽水溪排水線一路聽下去', color: '#3498db' },
    geofence_shanhai: { title: '山海圳綠道', desc: '從台江出發、直達玉山的綠道', color: '#e67e22' },
    geofence_taijiang: { title: '台江水日', desc: '順著水路溯源到烏山頭', color: '#27ae60' },
    draw: { title: '自己圈一塊', desc: '在地圖上畫個範圍，走讀裡面的聲音', color: '#8e44ad' },
    clear: { title: '結束這條路線', desc: '停止導覽，回到自由探索', color: '#e11d48' }
  };
  var ROUTE_GROUPS = { nature: '依主題', geofence_yanshui: '沿著水路', draw: '自己畫' };
  var ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
  var ICON_SEARCH = '<svg class="ss-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/></svg>';
  var ICON_TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/></svg>';
  var ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

  function hexRgba(hex, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return 'rgba(12,26,29,' + a + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  function closePanels() {
    if (typeof window.haidianV4CloseAll === 'function') window.haidianV4CloseAll(true);
    else if (typeof window.closeAllDrawers === 'function') window.closeAllDrawers();
  }

  function panelHead(content, eyebrow, title, copy) {
    var head = el('div', 'ss-ph',
      '<div class="ss-ph-text"><span class="ss-ph-eyebrow">' + eyebrow + '</span><h2 class="ss-ph-title">' + title + '</h2><p class="ss-ph-copy">' + copy + '</p></div>' +
      '<button type="button" class="ss-ph-close" aria-label="收起面板">' + ICON.close + '</button>');
    head.querySelector('.ss-ph-close').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      closePanels();
    });
    content.insertBefore(head, content.firstChild);
    return head;
  }

  function rowButton(cls, icon, title, desc, onClick) {
    var b = el('button', 'ss-row ' + (cls || ''),
      '<span class="ss-row-ico">' + icon + '</span><span class="ss-row-text"><b>' + title + '</b>' + (desc ? '<i>' + desc + '</i>' : '') + '</span><span class="ss-row-go">' + ICON_CHEV + '</span>');
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function tidySidePanel() {
    var panel = document.getElementById('sidePanel');
    var content = panel && panel.querySelector('.drawer-content');
    if (!content || content.__ssDone) return;
    content.__ssDone = true;
    panel.classList.add('ss-panel');

    // 標記每個區塊，讓 CSS 分得出誰是誰
    var secSearch, secTime, secFav, achBtn;
    Array.prototype.slice.call(content.children).forEach(function (node) {
      if (node.tagName === 'HR') { node.classList.add('ss-hr'); return; }
      if (node.querySelector && node.querySelector('#searchInput')) { secSearch = node; node.classList.add('ss-sec', 'ss-sec-search'); }
      else if (node.querySelector && node.querySelector('.filter-group')) node.classList.add('ss-sec', 'ss-sec-cat');
      else if (node.querySelector && node.querySelector('#timeSlider')) { secTime = node; node.classList.add('ss-sec', 'ss-sec-time'); }
      else if (node.querySelector && node.querySelector('#favFilterToggle')) { secFav = node; node.classList.add('ss-sec', 'ss-sec-fav'); }
      else if (node.classList && node.classList.contains('btn-more-layers')) achBtn = node;
    });

    panelHead(content, '聆聽', '找一段聲音來聽', '搜尋、挑時段，或翻開清單慢慢看；想換類別，用地圖上方的標籤。');

    // 聆聽進度
    var pg = el('div', 'ss-pg',
      '<div class="ss-pg-head"><span data-ss-heard>' + items().filter(isPlayable).length + ' 段聲音</span><span class="ss-pg-pct" data-ss-heard-pct></span></div>' +
      '<div class="ss-pg-bar"><i data-ss-heard-bar></i></div>' +
      '<div class="ss-pg-hint">聽過的聲音會在地圖上變成空心點，慢慢把它們都點亮。</div>');
    content.insertBefore(pg, content.children[1] || null);

    // 搜尋框：圖示在左、清除在右
    var input = document.getElementById('searchInput');
    if (secSearch && input) {
      var wrap = el('div', 'ss-search', ICON_SEARCH);
      input.placeholder = '搜尋標題或採集者';
      input.setAttribute('aria-label', '搜尋標題或採集者');
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      var clr = el('button', 'ss-search-clear', ICON.close);
      clr.type = 'button';
      clr.setAttribute('aria-label', '清除搜尋');
      clr.addEventListener('click', function () {
        input.value = '';
        wrap.classList.remove('has-text');
        if (typeof window.filterMarkers === 'function') window.filterMarkers();
        input.focus();
      });
      wrap.appendChild(clr);
      input.addEventListener('input', function () { wrap.classList.toggle('has-text', !!input.value); });

      // 翻看清單
      var listRow = rowButton('ss-row-list', ICON.list, '翻開全部聲音', '依最新、離我最近或離畫面中心排序', function () {
        closePanels();
        setList(true);
      });
      secSearch.appendChild(listRow);
    }

    // 時段：標籤列右側放目前時段，滑桿下放刻度
    if (secTime) {
      var label = secTime.querySelector('.panel-label');
      var disp = document.getElementById('timeDisplay');
      if (label) {
        label.lastChild.textContent = ' 時段';
        if (disp) label.appendChild(disp);
      }
      secTime.appendChild(el('div', 'ss-ticks', '<span>深夜</span><span>清晨</span><span>中午</span><span>傍晚</span><span>夜晚</span>'));
    }

    // 收藏：變成一個開關列
    if (secFav) {
      var fl = secFav.querySelector('label');
      var cb = document.getElementById('favFilterToggle');
      var fLabel = secFav.querySelector('.panel-label');
      if (fLabel) fLabel.lastChild.textContent = ' 我的';
      if (fl && cb) {
        Array.prototype.slice.call(fl.childNodes).forEach(function (n) { if (n !== cb) fl.removeChild(n); });
        fl.removeAttribute('style');
        fl.className = 'ss-row ss-row-fav';
        fl.insertBefore(el('span', 'ss-row-text', '<b>只看我的收藏</b><i>登入後，地圖只留下你收藏的聲音</i>'), cb);
        fl.insertBefore(el('span', 'ss-row-ico', ICON_HEART), fl.firstChild);
      }
      if (achBtn) {
        var onclick = achBtn.getAttribute('onclick');
        var ach = rowButton('ss-row-ach', ICON_TROPHY, '我的聲音獵人成就', '收藏與踩點累積的徽章', function () {
          try { new Function(onclick).call(achBtn); } catch (e) {}
        });
        secFav.appendChild(ach);
        achBtn.remove();
      }
    }
  }

  function tidyRoutePanel() {
    var panel = document.getElementById('routePanel');
    var content = panel && panel.querySelector('.drawer-content');
    if (!content || content.__ssDone) return;
    content.__ssDone = true;
    panel.classList.add('ss-panel');
    var list = content.querySelector('.route-list');
    if (!list) return;

    panelHead(content, '走讀', '把聲音串成一條路', '選一條路線，地圖會依序帶你走過沿途的聲音；走完或想停，隨時結束。');

    Array.prototype.slice.call(list.querySelectorAll('hr')).forEach(function (h) { h.parentNode.removeChild(h); });
    Array.prototype.slice.call(list.querySelectorAll('.route-btn')).forEach(function (btn) {
      var oc = btn.getAttribute('onclick') || '';
      var m = /toggleRoute\('([^']+)'/.exec(oc);
      var key = m ? m[1] : (/openCustomDrawHelp/.test(oc) ? 'draw' : null);
      var meta = key && ROUTE_META[key];
      if (!meta) return;
      var svg = btn.querySelector('svg');
      btn.classList.add('ss-rt');
      btn.dataset.route = key;
      ['border-left', 'background', 'color', 'border-color', 'justify-content'].forEach(function (p) { btn.style.removeProperty(p); });
      btn.style.setProperty('--rt', meta.color);
      btn.style.setProperty('--rt-soft', hexRgba(meta.color, 0.14));
      btn.innerHTML = '';
      var ico = el('span', 'ss-rt-ico');
      if (svg) { svg.setAttribute('stroke', 'currentColor'); ico.appendChild(svg); }
      btn.appendChild(ico);
      btn.appendChild(el('span', 'ss-rt-text', '<b>' + meta.title + '</b>' + (meta.desc ? '<i>' + meta.desc + '</i>' : '')));
      if (key !== 'clear') btn.appendChild(el('span', 'ss-rt-go', ICON_CHEV));
      if (ROUTE_GROUPS[key]) list.insertBefore(el('div', 'ss-rt-group', ROUTE_GROUPS[key]), btn);
    });
  }

  // 清單與左側面板在桌機上共用同一個位置：誰打開，另一個就讓位。
  function bindPanelList() {
    if (!window.MutationObserver) return;
    ['sidePanel', 'routePanel'].forEach(function (id) {
      var p = document.getElementById(id);
      if (!p) return;
      new MutationObserver(function () {
        if (!p.classList.contains('collapsed') && document.body.classList.contains('ss-list-open')) setList(false);
      }).observe(p, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function tidyPanels() {
    tidySidePanel();
    tidyRoutePanel();
    bindPanelList();
  }

  // ---------------------------------------------------------------- 8. 夜間模式
  // 傍晚六點到清晨六點、或系統偏好深色時自動入夜；左下角的小按鈕可手動切換，手動選擇維持 12 小時。

  var LS_THEME = 'ss-theme-v1';
  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  function ssNote(msg) {
    var n = document.getElementById('ssNote');
    if (!n) { n = el('div', 'ss-note'); n.id = 'ssNote'; n.setAttribute('role', 'status'); document.body.appendChild(n); }
    n.textContent = msg;
    n.classList.add('is-on');
    clearTimeout(ssNote.t);
    ssNote.t = setTimeout(function () { n.classList.remove('is-on'); }, 1800);
  }

  function autoNight() {
    var h = new Date().getHours();
    var sys = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return !!sys || h >= 18 || h < 6;
  }

  function themeChoice() {
    var o = readJSON(LS_THEME);
    if (o && o.until > Date.now() && (o.mode === 'night' || o.mode === 'day')) return o.mode;
    return null;
  }

  function isNight() {
    var c = themeChoice();
    return c ? c === 'night' : autoNight();
  }

  function applyTheme(night) {
    document.body.classList.toggle('ss-night', night);
    var btn = document.getElementById('ssTheme');
    if (btn) {
      btn.innerHTML = night ? ICON_SUN : ICON_MOON;
      btn.setAttribute('aria-pressed', night ? 'true' : 'false');
      btn.title = night ? '切回日間' : '切到夜間';
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', night ? '#0b1517' : '#0c1a1d');
    if (window.ssBasemap) window.ssBasemap.setNight(night);
  }

  function buildTheme() {
    if (document.getElementById('ssTheme')) return;
    var b = el('button', 'ss-theme');
    b.id = 'ssTheme';
    b.type = 'button';
    b.setAttribute('aria-label', '切換日夜模式');
    b.addEventListener('click', function () {
      var night = !document.body.classList.contains('ss-night');
      writeLS(LS_THEME, JSON.stringify({ mode: night ? 'night' : 'day', until: Date.now() + 12 * 3600e3 }));
      applyTheme(night);
      ssNote(night ? '入夜了：地圖與介面一起暗下來' : '回到白天');
    });
    document.body.appendChild(b);
    applyTheme(isNight());
    setInterval(function () { applyTheme(isNight()); }, 10 * 60e3);
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { applyTheme(isNight()); });
  }

  // ---------------------------------------------------------------- boot

  function boot() {
    buildHero();
    buildBar();
    buildChips();
    buildListChip();
    buildIdle();
    buildBarExtras();
    heroGreeting();
    tidyLayout();
    tidyPanels();
    buildTheme();
    bindKeys();
    bindBarSwipe();
    landOnSharedWork();
    waitFor(function () { return window.map && window.globalAudio; }, function () {
      wrapCloseGlobalPlayer();
      disableEmbeddedPlayer();
      wrapRenderMarkers();
      bindAudio();
      bindMap();
      bindSheetGestures();
      bindMediaSession();
      softenBasemap();
    });
    waitFor(function () { return items().length && window.globalMarkerMap && Object.keys(window.globalMarkerMap).length ? 1 : null; }, afterRender);
    var cardBtn = document.querySelector('.close-player-btn');
    if (cardBtn) cardBtn.addEventListener('click', function () { onStopped(); });
    window.addEventListener('resize', syncBarVisibility);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
