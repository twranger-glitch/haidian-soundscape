/*
 * 聲景投稿：站內直接錄音／上傳、挑照片、在地圖上釘位置，一鍵送出。
 *
 * 後端接線（兩件事，都免費）：
 *  1. Cloudinary 後台 → Settings → Upload → Upload presets → Add：Signing mode 選 Unsigned，
 *     把 preset 名稱填進 CONFIG.uploadPreset。
 *  2. 把 tools/apps-script-submit.gs 的 doPost 貼進現有的 Apps Script 專案，部署成網頁應用程式
 *     （執行身分：我；存取權：任何人），把網址填進 CONFIG.endpoint。
 * 兩個都還沒填時，表單照樣能填、能錄、能釘位置，但送出時會改用 Google 表單接手。
 */
(function () {
  'use strict';

  var CONFIG = window.SS_SUBMIT_CONFIG || {
    cloudName: 'dcccnd4gk',
    uploadPreset: '',
    endpoint: '',
    maxAudioMB: 40,
    maxImageMB: 12,
    fallbackForm: 'https://docs.google.com/forms/d/e/1FAIpQLSdEq8I8O6zWZ95RO0Jf-YCKAuwUedMHsnThrU71FcTJQbuGGg/viewform',
    fallbackGpsEntry: 'entry.255203319'
  };

  var CATS = ['自然絮語', '常民聲', '活動與產業', '空間聲', '歲月回音'];
  var CAT_CLS = { '自然絮語': 'cat-nature', '常民聲': 'cat-culture', '活動與產業': 'cat-industry', '空間聲': 'cat-space', '歲月回音': 'cat-history' };
  var DEFAULT_CENTER = [23.03, 120.21];
  var LS_AUTHOR = 'ss-sub-author';

  var I = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>'
  };

  // ------------------------------------------------------------ utils
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function fmtMB(b) { return (b / 1048576).toFixed(1) + ' MB'; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function localDateTime(d) {
    d = d || new Date();
    var p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function note(msg) {
    var n = document.getElementById('ssNote');
    if (!n) { n = el('div', 'ss-note'); n.id = 'ssNote'; n.setAttribute('role', 'status'); document.body.appendChild(n); }
    n.textContent = msg;
    n.classList.add('is-on');
    clearTimeout(note.t);
    note.t = setTimeout(function () { n.classList.remove('is-on'); }, 2200);
  }
  function backendReady() { return !!(CONFIG.cloudName && CONFIG.uploadPreset && CONFIG.endpoint); }

  // ------------------------------------------------------------ EXIF GPS（只讀 JPEG）
  function exifGps(file) {
    return new Promise(function (resolve) {
      if (!/jpe?g$/i.test(file.name || '') && file.type !== 'image/jpeg') return resolve(null);
      var reader = new FileReader();
      reader.onerror = function () { resolve(null); };
      reader.onload = function () {
        try {
          var v = new DataView(reader.result);
          if (v.getUint16(0) !== 0xFFD8) return resolve(null);
          var off = 2, len = v.byteLength;
          while (off < len) {
            if (v.getUint8(off) !== 0xFF) return resolve(null);
            var marker = v.getUint8(off + 1);
            var size = v.getUint16(off + 2);
            if (marker === 0xE1 && v.getUint32(off + 4) === 0x45786966) { // "Exif"
              return resolve(parseTiff(v, off + 10));
            }
            if (marker === 0xDA) break;
            off += 2 + size;
          }
          resolve(null);
        } catch (e) { resolve(null); }
      };
      reader.readAsArrayBuffer(file.slice(0, 256 * 1024));
    });

    function parseTiff(v, base) {
      var little = v.getUint16(base) === 0x4949;
      var u16 = function (o) { return v.getUint16(o, little); };
      var u32 = function (o) { return v.getUint32(o, little); };
      if (u16(base + 2) !== 0x2A) return null;
      var ifd0 = base + u32(base + 4);
      var gpsIfd = null;
      var n = u16(ifd0);
      for (var i = 0; i < n; i++) {
        var e = ifd0 + 2 + i * 12;
        if (u16(e) === 0x8825) { gpsIfd = base + u32(e + 8); break; }
      }
      if (!gpsIfd) return null;
      var tags = {};
      var m = u16(gpsIfd);
      for (var j = 0; j < m; j++) {
        var t = gpsIfd + 2 + j * 12;
        var tag = u16(t), type = u16(t + 2), count = u32(t + 4);
        if (type === 2 && count <= 4) tags[tag] = String.fromCharCode(v.getUint8(t + 8));
        else if (type === 5 && count === 3) {
          var p = base + u32(t + 8), arr = [];
          for (var k = 0; k < 3; k++) { var num = u32(p + k * 8), den = u32(p + k * 8 + 4); arr.push(den ? num / den : 0); }
          tags[tag] = arr;
        }
      }
      if (!tags[2] || !tags[4]) return null;
      var lat = tags[2][0] + tags[2][1] / 60 + tags[2][2] / 3600;
      var lon = tags[4][0] + tags[4][1] / 60 + tags[4][2] / 3600;
      if (tags[1] === 'S') lat = -lat;
      if (tags[3] === 'W') lon = -lon;
      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return null;
      return { lat: lat, lon: lon };
    }
  }

  // ------------------------------------------------------------ state
  var st = {
    audioBlob: null, audioName: '', audioUrl: '', audioDur: 0,
    photoFile: null, photoUrl: '', photoGps: null,
    pos: null, posSource: '',
    cat: '', rec: null, recChunks: [], recTimer: null, recStart: 0, stream: null,
    busy: false, miniMap: null, miniMarker: null
  };
  var root, form, audioPreview;

  // ------------------------------------------------------------ build
  function build() {
    if (root) return root;
    root = el('div', 'modal-overlay ss-sub');
    root.id = 'ssSub';
    root.innerHTML =
      '<div class="ss-sub-box" role="dialog" aria-modal="true" aria-labelledby="ssSubTitle">' +
        '<div class="ss-sub-head">' +
          '<div><span class="ss-sub-eyebrow">投稿</span><h2 class="ss-sub-title" id="ssSubTitle">把一段聲音放上地圖</h2></div>' +
          '<button type="button" class="ss-sub-close" aria-label="關閉">' + I.close + '</button>' +
        '</div>' +
        '<form class="ss-sub-form" novalidate>' +

          '<section class="ss-sub-sec" data-sec="audio">' +
            '<h3 class="ss-sub-h"><span class="ss-sub-num">1</span>聲音<small>現場錄，或選一個檔案</small></h3>' +
            '<div class="ss-sub-audio">' +
              '<div class="ss-sub-rec">' +
                '<button type="button" class="ss-sub-recbtn" id="ssSubRec">' + I.mic + '</button>' +
                '<div class="ss-sub-rectext"><b id="ssSubRecLabel">按一下開始錄音</b><i id="ssSubRecHint">用手機麥克風，錄到你覺得夠了再按停止</i></div>' +
              '</div>' +
              '<label class="ss-sub-filebtn">' + I.file + '<span>選音檔或影片</span><input type="file" id="ssSubAudioFile" accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.mp4,.mov"></label>' +
            '</div>' +
            '<div class="ss-sub-preview" id="ssSubAudioPreview" hidden>' +
              '<button type="button" class="ss-sub-pp" id="ssSubPP">' + I.play + '</button>' +
              '<div class="ss-sub-pv-text"><b id="ssSubAudioName">錄音</b><i id="ssSubAudioMeta"></i></div>' +
              '<button type="button" class="ss-sub-x" id="ssSubAudioClear" aria-label="移除聲音">' + I.trash + '</button>' +
            '</div>' +
          '</section>' +

          '<section class="ss-sub-sec" data-sec="photo">' +
            '<h3 class="ss-sub-h"><span class="ss-sub-num">2</span>照片<small>選填，當作封面</small></h3>' +
            '<label class="ss-sub-photo" id="ssSubPhotoBox">' + I.photo + '<span>拍一張或選一張</span><input type="file" id="ssSubPhoto" accept="image/*"></label>' +
            '<div class="ss-sub-photo-note" id="ssSubPhotoNote" hidden></div>' +
          '</section>' +

          '<section class="ss-sub-sec" data-sec="pos">' +
            '<h3 class="ss-sub-h"><span class="ss-sub-num">3</span>位置<small>拖動圖釘，或點地圖</small></h3>' +
            '<div class="ss-sub-map" id="ssSubMap"></div>' +
            '<div class="ss-sub-posrow">' +
              '<button type="button" class="ss-sub-chipbtn" id="ssSubLocate">' + I.locate + '用我現在的位置</button>' +
              '<button type="button" class="ss-sub-chipbtn" id="ssSubPhotoPos" hidden>' + I.photo + '用照片裡的位置</button>' +
              '<span class="ss-sub-pos" id="ssSubPosText">還沒選位置</span>' +
            '</div>' +
          '</section>' +

          '<section class="ss-sub-sec" data-sec="meta">' +
            '<h3 class="ss-sub-h"><span class="ss-sub-num">4</span>說明</h3>' +
            '<label class="ss-sub-field"><span>標題</span><input type="text" id="ssSubTitleIn" maxlength="40" placeholder="例如：清晨的鹽水溪排水" required></label>' +
            '<div class="ss-sub-field"><span>類別</span><div class="ss-sub-cats" id="ssSubCats" role="radiogroup"></div></div>' +
            '<label class="ss-sub-field"><span>採集者</span><input type="text" id="ssSubAuthor" maxlength="24" placeholder="你的名字或暱稱"></label>' +
            '<label class="ss-sub-field"><span>這是什麼聲音？</span><textarea id="ssSubDesc" rows="3" maxlength="300" placeholder="在哪裡、什麼時候、聽到了什麼，為什麼想留下來"></textarea></label>' +
            '<div class="ss-sub-row2">' +
              '<label class="ss-sub-field"><span>採集時間</span><input type="datetime-local" id="ssSubWhen"></label>' +
              '<label class="ss-sub-field"><span>Email（選填）</span><input type="email" id="ssSubEmail" placeholder="審核有問題時聯絡你"></label>' +
            '</div>' +
            '<input type="text" id="ssSubWeb" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">' +
          '</section>' +

          '<div class="ss-sub-foot">' +
            '<div class="ss-sub-status" id="ssSubStatus"></div>' +
            '<button type="submit" class="ss-sub-send" id="ssSubSend">' + I.check + '<span>送出到地圖</span></button>' +
            '<p class="ss-sub-fine">送出即同意以 CC BY-NC 授權，讓大家在非商業用途下聆聽與引用；可隨時申請下架。</p>' +
          '</div>' +
        '</form>' +
        '<div class="ss-sub-done" id="ssSubDone" hidden></div>' +
      '</div>';
    document.body.appendChild(root);
    form = $('.ss-sub-form', root);
    audioPreview = new Audio();
    audioPreview.preload = 'metadata';

    // categories
    var cats = $('#ssSubCats', root);
    CATS.forEach(function (c) {
      var b = el('button', 'ss-sub-cat', '<span class="ss-dot ' + CAT_CLS[c] + '"></span>' + c);
      b.type = 'button';
      b.dataset.cat = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', function () { setCat(c); });
      cats.appendChild(b);
    });

    $('.ss-sub-close', root).addEventListener('click', close);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    $('#ssSubRec', root).addEventListener('click', toggleRec);
    $('#ssSubAudioFile', root).addEventListener('change', function (e) { if (e.target.files[0]) setAudio(e.target.files[0], e.target.files[0].name); e.target.value = ''; });
    $('#ssSubAudioClear', root).addEventListener('click', function () { clearAudio(); });
    $('#ssSubPP', root).addEventListener('click', togglePreview);
    audioPreview.addEventListener('ended', function () { $('#ssSubPP', root).innerHTML = I.play; });
    audioPreview.addEventListener('pause', function () { $('#ssSubPP', root).innerHTML = I.play; });
    audioPreview.addEventListener('play', function () { $('#ssSubPP', root).innerHTML = I.pause; });
    audioPreview.addEventListener('loadedmetadata', function () {
      if (isFinite(audioPreview.duration)) { st.audioDur = audioPreview.duration; syncAudioMeta(); }
    });
    $('#ssSubPhoto', root).addEventListener('change', function (e) { if (e.target.files[0]) setPhoto(e.target.files[0]); });
    $('#ssSubLocate', root).addEventListener('click', useMyLocation);
    $('#ssSubPhotoPos', root).addEventListener('click', function () { if (st.photoGps) setPos(st.photoGps.lat, st.photoGps.lon, 'photo', true); });
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    var author = readLS(LS_AUTHOR);
    if (author) $('#ssSubAuthor', root).value = author;
    $('#ssSubTitleIn', root).addEventListener('input', syncMeta);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('active')) close(); });
    return root;
  }

  // ------------------------------------------------------------ open / close
  function open(opts) {
    opts = opts || {};
    build();
    if (typeof window.closeAllDrawers === 'function') window.closeAllDrawers();
    if (typeof window.closeModal === 'function') { try { window.closeModal('submitChoiceModal'); } catch (e) {} }
    if (window.map && typeof window.map.closePopup === 'function') window.map.closePopup();
    $('#ssSubDone', root).hidden = true;
    form.hidden = false;
    if (!$('#ssSubWhen', root).value) $('#ssSubWhen', root).value = localDateTime();
    root.classList.add('active');
    document.body.classList.add('ss-sub-open');
    setTimeout(function () {
      initMiniMap();
      if (opts.latlng) setPos(opts.latlng.lat, opts.latlng.lng, 'map', true);
      else if (!st.pos && window.map) {
        var c = window.map.getCenter();
        setPos(c.lat, c.lng, '', true, true);
      }
    }, 60);
  }

  function close() {
    if (!root) return;
    if (st.rec && st.rec.state === 'recording') stopRec();
    try { audioPreview.pause(); } catch (e) {}
    root.classList.remove('active');
    document.body.classList.remove('ss-sub-open');
  }

  // ------------------------------------------------------------ mini map
  function initMiniMap() {
    var box = $('#ssSubMap', root);
    if (!window.L || !box) return;
    if (st.miniMap) { st.miniMap.invalidateSize(); return; }
    var center = st.pos ? [st.pos.lat, st.pos.lon] : (window.map ? [window.map.getCenter().lat, window.map.getCenter().lng] : DEFAULT_CENTER);
    var m = L.map(box, { zoomControl: false, attributionControl: false, tap: true });
    m.setView(center, 16);
    L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', { maxZoom: 20 }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    var icon = L.divIcon({ className: 'ss-sub-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] });
    st.miniMarker = L.marker(center, { draggable: true, icon: icon, autoPan: true }).addTo(m);
    st.miniMarker.on('dragend', function () { var ll = st.miniMarker.getLatLng(); setPos(ll.lat, ll.lng, 'map'); });
    m.on('click', function (e) { setPos(e.latlng.lat, e.latlng.lng, 'map'); });
    st.miniMap = m;
    setTimeout(function () { m.invalidateSize(); }, 200);
  }

  function setPos(lat, lon, source, pan, tentative) {
    lat = +lat; lon = +lon;
    if (!isFinite(lat) || !isFinite(lon)) return;
    st.pos = tentative ? null : { lat: lat, lon: lon };
    st.posSource = source;
    if (st.miniMarker) st.miniMarker.setLatLng([lat, lon]);
    if (st.miniMap && pan) st.miniMap.setView([lat, lon], Math.max(st.miniMap.getZoom(), 16));
    var t = $('#ssSubPosText', root);
    if (tentative) t.textContent = '圖釘先放在畫面中間，拖到真正的地點';
    else t.textContent = lat.toFixed(5) + ', ' + lon.toFixed(5) + (source === 'gps' ? '（我的位置）' : source === 'photo' ? '（照片）' : '');
    t.classList.toggle('is-set', !tentative);
    markSec('pos', !tentative);
    if (!tentative) status('');
  }

  function useMyLocation() {
    var b = $('#ssSubLocate', root);
    if (!navigator.geolocation) { note('這個裝置抓不到位置，請直接拖圖釘'); return; }
    b.disabled = true;
    b.classList.add('is-busy');
    navigator.geolocation.getCurrentPosition(function (p) {
      b.disabled = false; b.classList.remove('is-busy');
      setPos(p.coords.latitude, p.coords.longitude, 'gps', true);
    }, function () {
      b.disabled = false; b.classList.remove('is-busy');
      note('抓不到位置，請直接在小地圖上拖圖釘');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  // ------------------------------------------------------------ audio
  function pickMime() {
    if (!window.MediaRecorder) return '';
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }

  function toggleRec() {
    if (st.rec && st.rec.state === 'recording') { stopRec(); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      note('這個瀏覽器不能直接錄音，請改用「選音檔或影片」');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      st.stream = stream;
      var mime = pickMime();
      var rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined);
      st.recChunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) st.recChunks.push(e.data); };
      rec.onstop = function () {
        var type = rec.mimeType || mime || 'audio/webm';
        var blob = new Blob(st.recChunks, { type: type });
        var ext = /mp4|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
        stream.getTracks().forEach(function (t) { t.stop(); });
        st.stream = null;
        if (blob.size < 2000) { note('沒錄到聲音，再試一次'); syncRecUI(false); return; }
        setAudio(blob, '現場錄音.' + ext);
        syncRecUI(false);
      };
      st.rec = rec;
      rec.start(500);
      st.recStart = Date.now();
      syncRecUI(true);
      st.recTimer = setInterval(function () {
        var s = (Date.now() - st.recStart) / 1000;
        $('#ssSubRecLabel', root).textContent = '錄音中 ' + fmtTime(s);
        if (s >= 600) stopRec();
      }, 250);
    }).catch(function () {
      note('沒有取得麥克風權限，請改用「選音檔或影片」');
    });
  }

  function stopRec() {
    clearInterval(st.recTimer);
    try { if (st.rec && st.rec.state !== 'inactive') st.rec.stop(); } catch (e) {}
  }

  function syncRecUI(on) {
    var b = $('#ssSubRec', root);
    b.classList.toggle('is-rec', on);
    b.innerHTML = on ? I.stop : I.mic;
    b.setAttribute('aria-label', on ? '停止錄音' : '開始錄音');
    if (!on) {
      $('#ssSubRecLabel', root).textContent = st.audioBlob ? '重新錄一段' : '按一下開始錄音';
      $('#ssSubRecHint', root).textContent = st.audioBlob ? '會取代現在這段聲音' : '用手機麥克風，錄到你覺得夠了再按停止';
    } else {
      $('#ssSubRecHint', root).textContent = '再按一下停止。最長 10 分鐘。';
    }
  }

  function setAudio(blob, name) {
    if (blob.size > CONFIG.maxAudioMB * 1048576) { note('檔案太大了（上限 ' + CONFIG.maxAudioMB + ' MB），請剪短一點'); return; }
    clearAudio(true);
    st.audioBlob = blob;
    st.audioName = name || 'audio';
    st.audioUrl = URL.createObjectURL(blob);
    st.audioDur = 0;
    audioPreview.src = st.audioUrl;
    $('#ssSubAudioName', root).textContent = st.audioName;
    syncAudioMeta();
    $('#ssSubAudioPreview', root).hidden = false;
    markSec('audio', true);
    status('');
    syncRecUI(false);
    if (!$('#ssSubTitleIn', root).value && /錄音/.test(st.audioName) === false) {
      var base = st.audioName.replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
      if (!/^(rec|audio|voice|\d)/i.test(base)) $('#ssSubTitleIn', root).value = base;
    }
  }

  function syncAudioMeta() {
    var m = $('#ssSubAudioMeta', root);
    if (!st.audioBlob) { m.textContent = ''; return; }
    m.textContent = (st.audioDur ? fmtTime(st.audioDur) + '・' : '') + fmtMB(st.audioBlob.size);
  }

  function clearAudio(silent) {
    try { audioPreview.pause(); } catch (e) {}
    if (st.audioUrl) URL.revokeObjectURL(st.audioUrl);
    st.audioBlob = null; st.audioUrl = ''; st.audioName = ''; st.audioDur = 0;
    audioPreview.removeAttribute('src');
    if (root) { $('#ssSubAudioPreview', root).hidden = true; markSec('audio', false); if (!silent) syncRecUI(false); }
  }

  function togglePreview() {
    if (!st.audioUrl) return;
    if (audioPreview.paused) {
      if (window.globalAudio && !window.globalAudio.paused) window.globalAudio.pause();
      audioPreview.play().catch(function () {});
    } else audioPreview.pause();
  }

  // ------------------------------------------------------------ photo
  function setPhoto(file) {
    if (!/^image\//.test(file.type)) { note('請選一張照片'); return; }
    if (file.size > CONFIG.maxImageMB * 1048576) { note('照片太大了（上限 ' + CONFIG.maxImageMB + ' MB）'); return; }
    if (st.photoUrl) URL.revokeObjectURL(st.photoUrl);
    st.photoFile = file;
    st.photoUrl = URL.createObjectURL(file);
    var box = $('#ssSubPhotoBox', root);
    box.classList.add('has-photo');
    box.style.backgroundImage = 'url("' + st.photoUrl + '")';
    box.querySelector('span').textContent = '換一張';
    markSec('photo', true);
    st.photoGps = null;
    $('#ssSubPhotoPos', root).hidden = true;
    var noteEl = $('#ssSubPhotoNote', root);
    noteEl.hidden = true;
    exifGps(file).then(function (gps) {
      if (!gps) return;
      st.photoGps = gps;
      $('#ssSubPhotoPos', root).hidden = false;
      noteEl.hidden = false;
      noteEl.innerHTML = I.pin + ' 這張照片有位置資訊。<button type="button" class="ss-sub-link" id="ssSubUsePhotoPos">用它當採集地點</button>';
      $('#ssSubUsePhotoPos', root).addEventListener('click', function () { setPos(gps.lat, gps.lon, 'photo', true); noteEl.hidden = true; });
      if (!st.pos) setPos(gps.lat, gps.lon, 'photo', true);
    });
  }

  // ------------------------------------------------------------ meta
  function syncMeta() {
    markSec('meta', !!($('#ssSubTitleIn', root).value.trim() && st.cat));
    status('');
  }

  function setCat(c) {
    st.cat = c;
    setTimeout(syncMeta, 0);
    root.querySelectorAll('.ss-sub-cat').forEach(function (b) {
      var on = b.dataset.cat === c;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function markSec(name, ok) {
    var s = root.querySelector('.ss-sub-sec[data-sec="' + name + '"]');
    if (s) s.classList.toggle('is-done', !!ok);
  }

  function validate() {
    var problems = [];
    if (!st.audioBlob) problems.push({ sec: 'audio', msg: '還沒有聲音：錄一段，或選一個檔案' });
    if (!st.pos) problems.push({ sec: 'pos', msg: '把圖釘拖到採集的地點' });
    if (!$('#ssSubTitleIn', root).value.trim()) problems.push({ sec: 'meta', msg: '給這段聲音一個標題' });
    if (!st.cat) problems.push({ sec: 'meta', msg: '選一個類別' });
    return problems;
  }

  function status(msg, kind) {
    var s = $('#ssSubStatus', root);
    s.textContent = msg || '';
    s.className = 'ss-sub-status' + (kind ? ' is-' + kind : '');
  }

  // ------------------------------------------------------------ upload / submit
  function uploadCloudinary(file, kind, onProgress) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('file', file, file.name || (kind === 'image' ? 'cover.jpg' : 'audio'));
      fd.append('upload_preset', CONFIG.uploadPreset);
      fd.append('folder', 'haidian-site');
      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(CONFIG.cloudName) + '/' + (kind === 'image' ? 'image' : 'video') + '/upload');
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        try {
          var r = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && r.secure_url) resolve(r);
          else reject(new Error(r.error && r.error.message || ('上傳失敗 ' + xhr.status)));
        } catch (e) { reject(new Error('上傳回應看不懂')); }
      };
      xhr.onerror = function () { reject(new Error('上傳時斷線了')); };
      xhr.send(fd);
    });
  }

  function postMeta(payload) {
    return fetch(CONFIG.endpoint, { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {}
        if (j && j.ok) return j;
        throw new Error(j && j.error ? j.error : '後端沒有回應成功');
      });
  }

  function submit() {
    if (st.busy) return;
    if ($('#ssSubWeb', root).value) return; // 機器人填的
    var problems = validate();
    if (problems.length) {
      status(problems[0].msg, 'warn');
      var s = root.querySelector('.ss-sub-sec[data-sec="' + problems[0].sec + '"]');
      if (s) { s.classList.add('is-shake'); s.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(function () { s.classList.remove('is-shake'); }, 600); }
      return;
    }
    var author = $('#ssSubAuthor', root).value.trim();
    if (author) writeLS(LS_AUTHOR, author);
    var when = $('#ssSubWhen', root).value;
    var payload = {
      source: 'site',
      uid: uuid(),
      title: $('#ssSubTitleIn', root).value.trim(),
      author: author || '海佃特派員',
      description: $('#ssSubDesc', root).value.trim(),
      category: st.cat,
      date: when ? when.replace('T', ' ') + ':00' : '',
      lat: +st.pos.lat.toFixed(6),
      lon: +st.pos.lon.toFixed(6),
      posSource: st.posSource,
      email: $('#ssSubEmail', root).value.trim(),
      page: location.href.split('?')[0]
    };

    if (!backendReady()) { fallbackToForm(payload); return; }

    st.busy = true;
    var send = $('#ssSubSend', root);
    send.disabled = true;
    send.classList.add('is-busy');
    status('上傳聲音…', 'busy');
    var file = st.audioBlob;
    if (!(file instanceof File)) { try { file = new File([st.audioBlob], st.audioName, { type: st.audioBlob.type }); } catch (e) { file = st.audioBlob; } }

    uploadCloudinary(file, 'audio', function (p) { status('上傳聲音… ' + Math.round(p * 100) + '%', 'busy'); })
      .then(function (a) {
        payload.audio = { url: a.secure_url, publicId: a.public_id, resourceType: a.resource_type, cloudName: CONFIG.cloudName, duration: a.duration || st.audioDur || 0, bytes: a.bytes };
        payload.audioMp3 = 'https://res.cloudinary.com/' + CONFIG.cloudName + '/video/upload/' + a.public_id + '.mp3';
        if (!st.photoFile) return null;
        status('上傳照片…', 'busy');
        return uploadCloudinary(st.photoFile, 'image', function (p) { status('上傳照片… ' + Math.round(p * 100) + '%', 'busy'); });
      })
      .then(function (c) {
        if (c) payload.cover = { url: c.secure_url.replace('/image/upload/', '/image/upload/f_auto,q_auto,w_1200/'), publicId: c.public_id };
        status('寫入地圖資料…', 'busy');
        return postMeta(payload);
      })
      .then(function () {
        st.busy = false;
        send.disabled = false; send.classList.remove('is-busy');
        status('');
        showDone(payload);
      })
      .catch(function (err) {
        st.busy = false;
        send.disabled = false; send.classList.remove('is-busy');
        status('送出失敗：' + (err && err.message || err) + '。再試一次，或改用表單。', 'err');
        var retry = el('button', 'ss-sub-link', '改用 Google 表單送出');
        retry.type = 'button';
        retry.addEventListener('click', function () { fallbackToForm(payload); });
        $('#ssSubStatus', root).appendChild(document.createTextNode(' '));
        $('#ssSubStatus', root).appendChild(retry);
      });
  }

  function fallbackToForm(payload) {
    var url = CONFIG.fallbackForm + '?usp=pp_url&' + CONFIG.fallbackGpsEntry + '=' + encodeURIComponent(payload.lat + ', ' + payload.lon);
    var w = window.open(url, '_blank');
    var box = $('#ssSubDone', root);
    form.hidden = true;
    box.hidden = false;
    box.innerHTML =
      '<div class="ss-sub-done-ico">' + I.file + '</div>' +
      '<h3>站內直送還沒接上，先用表單</h3>' +
      '<p>已經把座標 <code>' + esc(payload.lat + ', ' + payload.lon) + '</code> 帶進 Google 表單，請在表單裡上傳剛才的聲音與照片，其他欄位照抄即可：</p>' +
      '<dl class="ss-sub-copy"><dt>標題</dt><dd>' + esc(payload.title) + '</dd><dt>類別</dt><dd>' + esc(payload.category) + '</dd><dt>採集者</dt><dd>' + esc(payload.author) + '</dd>' + (payload.description ? '<dt>說明</dt><dd>' + esc(payload.description) + '</dd>' : '') + '</dl>' +
      (w ? '' : '<p><a class="ss-sub-link" href="' + esc(url) + '" target="_blank" rel="noopener">表單沒有自動打開？按這裡</a></p>') +
      '<div class="ss-sub-done-acts"><button type="button" class="ss-sub-send" id="ssSubBack">' + I.check + '<span>回到地圖</span></button></div>';
    $('#ssSubBack', root).addEventListener('click', close);
  }

  function showDone(payload) {
    var box = $('#ssSubDone', root);
    form.hidden = true;
    box.hidden = false;
    box.innerHTML =
      '<div class="ss-sub-done-ico is-ok">' + I.check + '</div>' +
      '<h3>送出了，謝謝你留下這段聲音</h3>' +
      '<p>「' + esc(payload.title) + '」已經寫進資料庫，通常幾分鐘內就會出現在地圖上；需要的話可以先把頁面重新整理。</p>' +
      '<div class="ss-sub-done-acts">' +
        '<button type="button" class="ss-sub-send" id="ssSubBack">' + I.check + '<span>回到地圖</span></button>' +
        '<button type="button" class="ss-sub-chipbtn" id="ssSubAgain">再投一段</button>' +
      '</div>';
    $('#ssSubBack', root).addEventListener('click', function () { close(); resetForm(); });
    $('#ssSubAgain', root).addEventListener('click', function () { resetForm(); box.hidden = true; form.hidden = false; });
  }

  function resetForm() {
    clearAudio();
    if (st.photoUrl) URL.revokeObjectURL(st.photoUrl);
    st.photoFile = null; st.photoUrl = ''; st.photoGps = null;
    var box = $('#ssSubPhotoBox', root);
    box.classList.remove('has-photo'); box.style.backgroundImage = ''; box.querySelector('span').textContent = '拍一張或選一張';
    $('#ssSubPhotoNote', root).hidden = true;
    $('#ssSubPhotoPos', root).hidden = true;
    $('#ssSubTitleIn', root).value = '';
    $('#ssSubDesc', root).value = '';
    $('#ssSubWhen', root).value = localDateTime();
    setCat('');
    st.pos = null;
    if (st.miniMap) setPos(st.miniMap.getCenter().lat, st.miniMap.getCenter().lng, '', false, true);
    markSec('photo', false); markSec('meta', false);
    status('');
  }

  // ------------------------------------------------------------ hook into the page
  function hook() {
    // 標頭「我要投稿」
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.glass-header .btn-submit, [onclick*="submitChoiceModal"]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      open();
    }, true);
    // 地圖長按／右鍵
    var wait = function (n) {
      if (typeof window.showSubmitPopup === 'function') {
        window.showSubmitPopup = function (latlng) { open({ latlng: latlng }); };
        return;
      }
      if (n < 200) setTimeout(function () { wait(n + 1); }, 100);
    };
    wait(0);
    window.ssSubmit = { open: open, close: close, ready: backendReady, config: CONFIG };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook, { once: true });
  else hook();
})();
