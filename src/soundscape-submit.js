/*
 * 聲景投稿：站內直接錄音／上傳、剪頭尾、挑照片、在地圖上釘位置，一鍵送出。
 *
 * 後端接線（兩件事，都免費）：
 *  1. Cloudinary 後台 → Settings → Upload → Upload presets → Add：Signing mode 選 Unsigned，
 *     把 preset 名稱填進 CONFIG.uploadPreset。
 *  2. 把 tools/apps-script-submit.gs 的 doPost 貼進現有的 Apps Script 專案，部署成網頁應用程式
 *     （執行身分：我；存取權：任何人），把網址填進 CONFIG.endpoint。
 * 兩個都還沒填時，表單照樣能填、能錄、能釘位置，但送出時會改用 Google 表單接手。
 *
 * 流程上的省力設計：
 *  - 錄音／選檔後在瀏覽器裡解碼，畫出波形、可剪頭尾，送出前用 lamejs 壓成 128k mp3，
 *    檔案小、不吃 Cloudinary 轉檔額度、每台裝置都能播。
 *  - 照片先縮到 1600px 再上傳。
 *  - 草稿自動保存（文字在 localStorage、錄音與照片在 IndexedDB），重開頁面接得回來。
 *  - 沒網路或送出失敗，可以排隊；回到有網路自動送出。
 *  - 送出後地圖立刻出現「剛送出」的點，等後台真的上架後自動換成正式的。
 */
(function () {
  'use strict';

  var CONFIG = window.SS_SUBMIT_CONFIG || {
    cloudName: 'dcccnd4gk',
    uploadPreset: 'haidian-site-unsigned',
    endpoint: 'https://script.google.com/macros/s/AKfycby4WSyAF4RMSahol0m5xoJ9LmIzn7JLIkdvJVOQlXvHFIzhKouqhxxDS0bGSg4oaLiVTg/exec',
    maxAudioMB: 60,
    maxImageMB: 20,
    maxVideoMB: 300,
    maxMinutes: 10,
    mp3Kbps: 128,
    lamejsUrl: 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.0/lame.min.js',
    fallbackForm: 'https://docs.google.com/forms/d/e/1FAIpQLSdEq8I8O6zWZ95RO0Jf-YCKAuwUedMHsnThrU71FcTJQbuGGg/viewform',
    fallbackGpsEntry: 'entry.255203319',
    requireLogin: true   // 送出前要先用網站原本的 Google 登入（和「登入探險」同一個）；GAS 會向 Firebase 驗證
  };

  var CATS = ['自然絮語', '常民聲', '活動與產業', '空間聲', '歲月回音'];
  var CAT_HINT = {
    '自然絮語': '鳥叫、蟲鳴、風聲、水聲，大自然自己發出的聲音',
    '常民聲': '市場叫賣、廟口、街坊聊天，日常生活裡人的聲音',
    '活動與產業': '工廠、農漁作業、施工、節慶活動，工作或特別場合的聲音',
    '空間聲': '橋下、隧道、空曠處，聽得出這個空間樣子的聲音',
    '歲月回音': '長輩講古、老物件、快要消失的聲音'
  };
  var CAT_CLS = { '自然絮語': 'cat-nature', '常民聲': 'cat-culture', '活動與產業': 'cat-industry', '空間聲': 'cat-space', '歲月回音': 'cat-history' };
  var DEFAULT_CENTER = [23.03, 120.21];
  var LS_AUTHOR = 'ss-sub-author';
  var LS_DRAFT = 'ss-sub-draft-v1';
  var LS_MINE = 'ss-my-subs-v1';
  var LS_PLACE = 'ss-place-v1';
  var DB_NAME = 'ss-submit';
  var DB_VER = 1;

  var I = {
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
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
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 12v6M9.5 14.5 12 12l2.5 2.5"/></svg>'
  };

  // ------------------------------------------------------------ utils
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function readJSON(k) { try { return JSON.parse(readLS(k) || 'null'); } catch (e) { return null; } }
  function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function fmtTime1(s) { s = Math.max(0, s || 0); var m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); }
  function fmtMB(b) { return b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
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
    note.t = setTimeout(function () { n.classList.remove('is-on'); }, 2400);
  }
  function backendReady() { return !!(CONFIG.cloudName && CONFIG.uploadPreset && CONFIG.endpoint); }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function isNetErr(err) { return !!(err && (err.net || /斷線|Failed to fetch|NetworkError|Load failed/i.test(String(err.message || err)))); }

  // ------------------------------------------------------------ IndexedDB（草稿與排隊）
  function db() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('no idb'));
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('draft')) d.createObjectStore('draft');
        if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idb(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(store, mode);
        var s = tx.objectStore(store);
        var out = fn(s);
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { return null; });
  }
  function idbGet(store, key) { return idb(store, 'readonly', function (s) { return s.get(key); }); }
  function idbPut(store, val, key) { return idb(store, 'readwrite', function (s) { return key !== undefined ? s.put(val, key) : s.put(val); }); }
  function idbDel(store, key) { return idb(store, 'readwrite', function (s) { return s.delete(key); }); }
  function idbAll(store) { return idb(store, 'readonly', function (s) { return s.getAll(); }); }

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
            if (marker === 0xE1 && v.getUint32(off + 4) === 0x45786966) return resolve(parseTiff(v, off + 10));
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

  // ------------------------------------------------------------ 音訊：解碼、波形、mp3
  var actx = null;
  function audioCtx() {
    if (actx) return actx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    return actx;
  }

  function decodeBlob(blob) {
    var ctx = audioCtx();
    if (!ctx) return Promise.reject(new Error('no audio context'));
    return blob.arrayBuffer().then(function (buf) {
      return new Promise(function (resolve, reject) {
        var p;
        try { p = ctx.decodeAudioData(buf, resolve, reject); } catch (e) { reject(e); return; }
        if (p && p.then) p.then(resolve, reject);
      });
    });
  }

  function peaksOf(audioBuffer, n) {
    var ch0 = audioBuffer.getChannelData(0);
    var ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
    var len = ch0.length, step = Math.max(1, Math.floor(len / n)), out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = i * step, e = Math.min(len, s + step), peak = 0;
      for (var j = s; j < e; j += 2) {
        var v = Math.abs(ch0[j]);
        if (ch1) v = Math.max(v, Math.abs(ch1[j]));
        if (v > peak) peak = v;
      }
      out[i] = peak;
    }
    return out;
  }

  var mp3Worker = null;
  function encoderWorker() {
    if (mp3Worker) return mp3Worker;
    var src = [
      'var lameOk=false;try{importScripts(' + JSON.stringify(CONFIG.lamejsUrl) + ');lameOk=true;}catch(e){}',
      'onmessage=function(e){var d=e.data;if(!lameOk){postMessage({error:"lamejs"});return;}',
      'try{var enc=new lamejs.Mp3Encoder(d.channels.length,d.sampleRate,d.kbps);var out=[];var block=1152*8;var L=d.channels[0],R=d.channels[1];var n=L.length;',
      'for(var i=0;i<n;i+=block){var l=L.subarray(i,i+block);var buf=R?enc.encodeBuffer(l,R.subarray(i,i+block)):enc.encodeBuffer(l);if(buf.length)out.push(new Uint8Array(buf));if((i/block)%20===0)postMessage({progress:i/n});}',
      'var end=enc.flush();if(end.length)out.push(new Uint8Array(end));var blob=new Blob(out,{type:"audio/mpeg"});postMessage({done:blob});}catch(err){postMessage({error:String(err)});}}'
    ].join('\n');
    mp3Worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
    return mp3Worker;
  }

  function toInt16(f32, from, to) {
    var n = to - from, out = new Int16Array(n);
    for (var i = 0; i < n; i++) { var v = f32[from + i]; v = v < -1 ? -1 : v > 1 ? 1 : v; out[i] = v < 0 ? v * 32768 : v * 32767; }
    return out;
  }

  function encodeMp3(audioBuffer, start, end, onProgress) {
    return new Promise(function (resolve, reject) {
      var sr = audioBuffer.sampleRate;
      var s = Math.max(0, Math.floor(start * sr)), e = Math.min(audioBuffer.length, Math.floor(end * sr));
      if (e - s < sr * 0.3) return reject(new Error('剪得太短了'));
      var chans = [toInt16(audioBuffer.getChannelData(0), s, e)];
      if (audioBuffer.numberOfChannels > 1) chans.push(toInt16(audioBuffer.getChannelData(1), s, e));
      var w;
      try { w = encoderWorker(); } catch (err) { return reject(err); }
      var timer = setTimeout(function () { cleanup(); reject(new Error('壓縮逾時')); }, 240000);
      function cleanup() { clearTimeout(timer); w.onmessage = null; w.onerror = null; }
      w.onmessage = function (ev) {
        var d = ev.data;
        if (d.progress != null && onProgress) onProgress(d.progress);
        if (d.done) { cleanup(); resolve(d.done); }
        if (d.error) { cleanup(); mp3Worker = null; try { w.terminate(); } catch (x) {} reject(new Error(d.error)); }
      };
      w.onerror = function () { cleanup(); mp3Worker = null; try { w.terminate(); } catch (x) {} reject(new Error('壓縮失敗')); };
      w.postMessage({ channels: chans, sampleRate: sr, kbps: CONFIG.mp3Kbps }, chans.map(function (c) { return c.buffer; }));
    });
  }

  // ------------------------------------------------------------ 照片縮圖
  function shrinkImage(file) {
    var MAX = 1600;
    var load = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : new Promise(function (resolve, reject) { var im = new Image(); im.onload = function () { resolve(im); }; im.onerror = reject; im.src = URL.createObjectURL(file); });
    return load.then(function (im) {
      var w = im.width, h = im.height;
      var scale = Math.min(1, MAX / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(im, 0, 0, cw, ch);
      if (im.close) im.close();
      return new Promise(function (resolve) { c.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.84); });
    }).then(function (b) {
      if (!b) return file;
      return b.size < file.size || file.type !== 'image/jpeg' ? new File([b], 'cover.jpg', { type: 'image/jpeg' }) : file;
    }).catch(function () { return file; });
  }

  // ------------------------------------------------------------ state
  var st = {
    audioBlob: null, audioName: '', audioUrl: '', audioDur: 0, buffer: null, peaks: null,
    trimStart: 0, trimEnd: 0, mp3: null, mp3Key: '',
    photoFile: null, photoBlob: null, photoUrl: '', photoGps: null, photoFromVideo: false,
    audioKind: 'audio', videoGps: null, thumbUrl: '', whenTouched: false,
    pos: null, posSource: '', place: '',
    cat: '', rec: null, recChunks: [], recTimer: null, recStart: 0, stream: null, meter: null,
    busy: false, miniMap: null, miniMarker: null, restoring: false
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
          '<div><span class="ss-sub-eyebrow">投稿</span><h2 class="ss-sub-title" id="ssSubTitle">把一段聲音放上地圖</h2><p class="ss-sub-lead" id="ssSubLead">只有 4 件事一定要做：<b>聲音、位置、標題、類別</b>。其他都可以跳過。</p></div>' +
          '<div class="ss-sub-headacts"><button type="button" class="ss-sub-minebtn" id="ssSubMineBtn">我的投稿</button>' +
          '<button type="button" class="ss-sub-close" aria-label="關閉">' + I.close + '</button></div>' +
        '</div>' +
        '<div class="ss-sub-draftbar" id="ssSubDraftBar" hidden><span>已接回上次沒送出的草稿</span><button type="button" class="ss-sub-link" id="ssSubDraftClear">清掉重來</button></div>' +
        '<form class="ss-sub-form" novalidate>' +

          '<section class="ss-sub-sec" data-sec="audio">' +
            '<h3 class="ss-sub-h"><span class="ss-sub-num">1</span>聲音<em class="ss-sub-req">必填</em><small>錄影、錄音，或選一個檔案</small></h3>' +
            '<div class="ss-sub-ways" id="ssSubWays">' +
              '<label class="ss-sub-way is-video">' + I.cam + '<b>錄影</b><i id="ssSubVideoHint">開相機錄一段，畫面、聲音、位置一次帶齊</i><input type="file" id="ssSubVideoCap" accept="video/*" capture="environment"></label>' +
              '<button type="button" class="ss-sub-way is-mic" id="ssSubMic">' + I.mic + '<b>錄音</b><i>只錄聲音，用這支手機的麥克風</i></button>' +
              '<label class="ss-sub-way is-file">' + I.file + '<b>選檔</b><i>手機裡現成的影片或音檔</i><input type="file" id="ssSubAudioFile" accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.mp4,.mov,.3gp"></label>' +
            '</div>' +
            '<p class="ss-sub-ways-note" id="ssSubWaysNote">影片只會取出聲音和一張截圖當封面，不會上傳整支影片。</p>' +
            '<div class="ss-sub-rec" id="ssSubRecPanel" hidden>' +
              '<button type="button" class="ss-sub-recbtn is-rec" id="ssSubRec" aria-label="停止錄音">' + I.stop + '</button>' +
              '<div class="ss-sub-rectext"><b id="ssSubRecLabel">錄音中</b><i id="ssSubRecHint" hidden></i><div class="ss-sub-meter" id="ssSubMeter" hidden><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>' +
            '</div>' +
            '<div class="ss-sub-preview" id="ssSubAudioPreview" hidden>' +
              '<div class="ss-sub-pv-row">' +
                '<button type="button" class="ss-sub-pp" id="ssSubPP">' + I.play + '</button>' +
                '<img class="ss-sub-pv-thumb" id="ssSubThumb" alt="" hidden>' +
                '<div class="ss-sub-pv-text"><b id="ssSubAudioName">錄音</b><i id="ssSubAudioMeta"></i></div>' +
                '<button type="button" class="ss-sub-x" id="ssSubAudioClear" aria-label="移除聲音">' + I.trash + '</button>' +
              '</div>' +
              '<div class="ss-sub-wave" id="ssSubWaveBox" hidden>' +
                '<canvas id="ssSubWave" height="64"></canvas>' +
                '<div class="ss-sub-trim">' +
                  '<label><span>開始</span><input type="range" id="ssSubTrimA" min="0" max="1000" value="0"><b id="ssSubTrimAT">0:00.0</b></label>' +
                  '<label><span>結束</span><input type="range" id="ssSubTrimB" min="0" max="1000" value="1000"><b id="ssSubTrimBT">0:00.0</b></label>' +
                '</div>' +
                '<div class="ss-sub-trimnote" id="ssSubTrimNote">拖兩個滑桿剪掉頭尾，送出前會壓成 mp3。</div>' +
              '</div>' +
            '</div>' +
          '</section>' +

          '<section class="ss-sub-sec" data-sec="photo">' +
            '<h3 class="ss-sub-h"><span class="ss-sub-num">2</span>照片<em class="ss-sub-opt">選填</em><small>當作封面，錄影的話會自動用影片截圖</small></h3>' +
            '<label class="ss-sub-photo" id="ssSubPhotoBox">' + I.photo + '<span>拍一張或選一張</span><input type="file" id="ssSubPhoto" accept="image/*"></label>' +
            '<div class="ss-sub-photo-note" id="ssSubPhotoNote" hidden></div>' +
          '</section>' +

          '<section class="ss-sub-sec" data-sec="pos">' +
            '<h3 class="ss-sub-h"><span class="ss-sub-num">3</span>位置<em class="ss-sub-req">必填</em><small>拖動圖釘，或點地圖</small></h3>' +
            '<div class="ss-sub-map" id="ssSubMap"></div>' +
            '<div class="ss-sub-posrow">' +
              '<button type="button" class="ss-sub-chipbtn" id="ssSubLocate">' + I.locate + '用我現在的位置</button>' +
              '<button type="button" class="ss-sub-chipbtn" id="ssSubPhotoPos" hidden>' + I.photo + '用照片裡的位置</button>' +
              '<button type="button" class="ss-sub-chipbtn" id="ssSubVideoPos" hidden>' + I.cam + '用影片裡的位置</button>' +
            '</div>' +
            '<div class="ss-sub-pos" id="ssSubPosText">還沒選位置</div>' +
          '</section>' +

          '<section class="ss-sub-sec" data-sec="meta">' +
            '<h3 class="ss-sub-h"><span class="ss-sub-num">4</span>說明<small>標題和類別要填，其他可以留白</small></h3>' +
            '<label class="ss-sub-field"><span>標題<em class="ss-sub-req">必填</em></span><input type="text" id="ssSubTitleIn" maxlength="40" placeholder="例如：清晨的鹽水溪排水" required></label>' +
            '<div class="ss-sub-field"><span>類別<em class="ss-sub-req">必填</em></span><div class="ss-sub-cats" id="ssSubCats" role="radiogroup"></div><p class="ss-sub-cathint" id="ssSubCatHint">不確定就選最接近的，之後可以再調整。</p></div>' +
            '<label class="ss-sub-field"><span>採集者<em class="ss-sub-opt">選填</em></span><input type="text" id="ssSubAuthor" maxlength="24" placeholder="會公開在地圖上；不填就寫「海佃特派員」"></label>' +
            '<label class="ss-sub-field"><span>這是什麼聲音？<em class="ss-sub-opt">選填</em></span><textarea id="ssSubDesc" rows="3" maxlength="300" placeholder="在哪裡、什麼時候、聽到了什麼，為什麼想留下來"></textarea></label>' +
            '<div class="ss-sub-row2">' +
              '<label class="ss-sub-field"><span>採集時間<em class="ss-sub-opt">已自動帶入</em></span><input type="datetime-local" id="ssSubWhen"></label>' +
              '<label class="ss-sub-field" id="ssSubEmailField"><span>Email<em class="ss-sub-opt">選填・不公開</em></span><input type="email" id="ssSubEmail" placeholder="有問題時聯絡你"></label>' +
            '</div>' +
            '<input type="text" id="ssSubWeb" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">' +
          '</section>' +

          '<div class="ss-sub-foot">' +
            '<ul class="ss-sub-todo" id="ssSubTodo" aria-label="送出前要完成的項目"></ul>' +
            '<div class="ss-sub-auth" id="ssSubAuth" hidden></div>' +
            '<div class="ss-sub-status" id="ssSubStatus"></div>' +
            '<div class="ss-sub-progress" id="ssSubProgress" hidden><i></i></div>' +
            '<button type="submit" class="ss-sub-send" id="ssSubSend">' + I.check + '<span>送出到地圖</span></button>' +
            '<p class="ss-sub-fine">送出即同意以 CC BY-NC 授權，讓大家在非商業用途下聆聽與引用；可隨時申請下架。</p>' +
          '</div>' +
        '</form>' +
        '<div class="ss-sub-done" id="ssSubDone" hidden></div>' +
        '<div class="ss-sub-mine" id="ssSubMine" hidden></div>' +
      '</div>';
    document.body.appendChild(root);
    form = $('.ss-sub-form', root);
    audioPreview = new Audio();
    audioPreview.preload = 'metadata';

    var cats = $('#ssSubCats', root);
    CATS.forEach(function (c) {
      var b = el('button', 'ss-sub-cat', '<span class="ss-dot ' + CAT_CLS[c] + '"></span>' + c);
      b.type = 'button';
      b.dataset.cat = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.title = CAT_HINT[c];
      b.addEventListener('click', function () { setCat(c); });
      cats.appendChild(b);
    });
    $('#ssSubTodo', root).addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-sec]');
      if (b) jumpTo(b.dataset.sec);
    });
    if (needLogin()) {
      $('#ssSubEmailField', root).hidden = true;
      $('#ssSubLead', root).innerHTML = inAppBrowser()
        ? '<b class="ss-sub-warn">你是在 LINE 或 Facebook 裡面打開的。</b>送出時要用 Google 登入，這裡不能登入，建議先改用 Safari 或 Chrome 打開再開始。'
        : '只有 4 件事一定要做：<b>聲音、位置、標題、類別</b>，最後用 Google 帳號登入就能送出。';
    }

    $('.ss-sub-close', root).addEventListener('click', close);
    $('#ssSubMineBtn', root).addEventListener('click', showMine);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    $('#ssSubRec', root).addEventListener('click', toggleRec);
    $('#ssSubMic', root).addEventListener('click', toggleRec);
    $('#ssSubVideoCap', root).addEventListener('change', function (e) { if (e.target.files[0]) setVideo(e.target.files[0]); e.target.value = ''; });
    $('#ssSubAudioFile', root).addEventListener('change', function (e) { var f = e.target.files[0]; if (f) { if (isVideoFile(f)) setVideo(f); else setAudio(f, f.name); } e.target.value = ''; });
    if (!isTouch()) $('#ssSubVideoHint', root).textContent = '選一段影片，會取出聲音、截圖和位置';
    $('#ssSubAudioClear', root).addEventListener('click', function () { clearAudio(); saveDraft(); });
    $('#ssSubPP', root).addEventListener('click', togglePreview);
    audioPreview.addEventListener('ended', function () { $('#ssSubPP', root).innerHTML = I.play; });
    audioPreview.addEventListener('pause', function () { $('#ssSubPP', root).innerHTML = I.play; });
    audioPreview.addEventListener('play', function () { $('#ssSubPP', root).innerHTML = I.pause; });
    audioPreview.addEventListener('timeupdate', function () {
      if (st.buffer && audioPreview.currentTime >= st.trimEnd - 0.05) { audioPreview.pause(); audioPreview.currentTime = st.trimStart; }
      drawWave();
    });
    audioPreview.addEventListener('loadedmetadata', function () {
      if (isFinite(audioPreview.duration) && !st.audioDur) { st.audioDur = audioPreview.duration; syncAudioMeta(); }
    });
    $('#ssSubTrimA', root).addEventListener('input', onTrim);
    $('#ssSubTrimB', root).addEventListener('input', onTrim);
    $('#ssSubPhoto', root).addEventListener('change', function (e) { if (e.target.files[0]) setPhoto(e.target.files[0]); });
    $('#ssSubLocate', root).addEventListener('click', useMyLocation);
    $('#ssSubPhotoPos', root).addEventListener('click', function () { if (st.photoGps) setPos(st.photoGps.lat, st.photoGps.lon, 'photo', true); });
    $('#ssSubVideoPos', root).addEventListener('click', function () { if (st.videoGps) setPos(st.videoGps.lat, st.videoGps.lon, 'video', true); });
    $('#ssSubWhen', root).addEventListener('input', function () { st.whenTouched = true; });
    $('#ssSubDraftClear', root).addEventListener('click', function () { resetForm(); clearDraft(); $('#ssSubDraftBar', root).hidden = true; });
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    var author = readLS(LS_AUTHOR);
    if (author) $('#ssSubAuthor', root).value = author;
    ['ssSubTitleIn', 'ssSubAuthor', 'ssSubDesc', 'ssSubWhen', 'ssSubEmail'].forEach(function (id) {
      $('#' + id, root).addEventListener('input', function () { syncMeta(); saveDraft(); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('active')) close(); });
    window.addEventListener('resize', debounce(drawWave, 150));
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
    $('#ssSubMine', root).hidden = true;
    form.hidden = false;
    if (opts.mine) setTimeout(showMine, 0);
    if (!$('#ssSubWhen', root).value) $('#ssSubWhen', root).value = localDateTime();
    root.classList.add('active');
    document.body.classList.add('ss-sub-open');
    renderAuth();
    refreshTodo();
    var first = !st.miniMap;
    setTimeout(function () {
      initMiniMap();
      if (opts.latlng) setPos(opts.latlng.lat, opts.latlng.lng, 'map', true);
      else if (!st.pos && window.map) {
        var c = window.map.getCenter();
        setPos(c.lat, c.lng, '', true, true);
      }
      if (first) restoreDraft();
    }, 60);
  }

  function close() {
    if (!root) return;
    if (st.rec && st.rec.state === 'recording') stopRec();
    try { audioPreview.pause(); } catch (e) {}
    root.classList.remove('active');
    document.body.classList.remove('ss-sub-open');
  }

  // ------------------------------------------------------------ mini map + 地名
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

  var lookupPlace = debounce(function (lat, lon) {
    var key = (+lat).toFixed(4) + ',' + (+lon).toFixed(4);
    var cache = readJSON(LS_PLACE) || {};
    if (cache[key]) return paintPlace(cache[key], key);
    if (navigator.onLine === false) return;
    var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=zh-TW&lat=' + lat + '&lon=' + lon;
    fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var a = (j && j.address) || {};
      var spot = j && j.name ? j.name : (a.amenity || a.leisure || a.road || a.neighbourhood || '');
      var area = a.city_district || a.suburb || a.town || a.village || '';
      var name = [area, spot].filter(Boolean).join('・');
      if (!name) return;
      cache = readJSON(LS_PLACE) || {};
      cache[key] = name;
      writeLS(LS_PLACE, JSON.stringify(cache));
      paintPlace(name, key);
    }).catch(function () {});
  }, 900);

  function paintPlace(name, key) {
    if (!st.pos) return;
    var cur = (+st.pos.lat).toFixed(4) + ',' + (+st.pos.lon).toFixed(4);
    if (cur !== key) return;
    st.place = name;
    var t = $('#ssSubPosText', root);
    var n = t.querySelector('.ss-sub-place');
    if (!n) { n = el('span', 'ss-sub-place'); t.insertBefore(n, t.firstChild); }
    n.textContent = name;
    saveDraft();
  }

  function setPos(lat, lon, source, pan, tentative) {
    lat = +lat; lon = +lon;
    if (!isFinite(lat) || !isFinite(lon)) return;
    st.pos = tentative ? null : { lat: lat, lon: lon };
    st.posSource = source;
    st.place = '';
    if (st.miniMarker) st.miniMarker.setLatLng([lat, lon]);
    if (st.miniMap && pan) st.miniMap.setView([lat, lon], Math.max(st.miniMap.getZoom(), 16));
    var t = $('#ssSubPosText', root);
    if (tentative) t.innerHTML = '<span class="ss-sub-coord">圖釘先放在畫面中間，拖到真正的地點</span>';
    else t.innerHTML = '<span class="ss-sub-coord">' + lat.toFixed(5) + ', ' + lon.toFixed(5) + (source === 'gps' ? '（我的位置）' : source === 'photo' ? '（照片）' : source === 'video' ? '（影片）' : '') + '</span>';
    t.classList.toggle('is-set', !tentative);
    markSec('pos', !tentative);
    if (!tentative) { status(''); lookupPlace(lat, lon); saveDraft(); }
  }

  function useMyLocation(silent) {
    var b = $('#ssSubLocate', root);
    if (!navigator.geolocation) { if (!silent) note('這個裝置抓不到位置，請直接拖圖釘'); return; }
    b.disabled = true;
    b.classList.add('is-busy');
    navigator.geolocation.getCurrentPosition(function (p) {
      b.disabled = false; b.classList.remove('is-busy');
      setPos(p.coords.latitude, p.coords.longitude, 'gps', true);
    }, function () {
      b.disabled = false; b.classList.remove('is-busy');
      if (!silent) note('抓不到位置，請直接在小地圖上拖圖釘');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  // ------------------------------------------------------------ 錄音
  function pickMime() {
    if (!window.MediaRecorder) return '';
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'];
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }

  function startMeter(stream) {
    var ctx = audioCtx();
    var box = $('#ssSubMeter', root);
    if (!ctx || !box) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      var src = ctx.createMediaStreamSource(stream);
      var an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      var data = new Uint8Array(an.frequencyBinCount);
      var bars = box.querySelectorAll('i');
      box.hidden = false;
      var raf;
      var tick = function () {
        an.getByteFrequencyData(data);
        var per = Math.floor(data.length / bars.length);
        for (var i = 0; i < bars.length; i++) {
          var sum = 0;
          for (var j = 0; j < per; j++) sum += data[i * per + j];
          bars[i].style.height = Math.max(8, Math.min(100, (sum / per) / 2.2)) + '%';
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
      st.meter = { stop: function () { cancelAnimationFrame(raf); try { src.disconnect(); } catch (e) {} box.hidden = true; } };
    } catch (e) {}
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
        if (st.meter) { st.meter.stop(); st.meter = null; }
        if (blob.size < 2000) { note('沒錄到聲音，再試一次'); syncRecUI(false); return; }
        setAudio(blob, '現場錄音.' + ext);
        syncRecUI(false);
      };
      st.rec = rec;
      rec.start(500);
      st.recStart = Date.now();
      syncRecUI(true);
      startMeter(stream);
      st.recTimer = setInterval(function () {
        var s = (Date.now() - st.recStart) / 1000;
        $('#ssSubRecLabel', root).textContent = '錄音中 ' + fmtTime(s);
        if (s >= CONFIG.maxMinutes * 60) stopRec();
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
    $('#ssSubRecPanel', root).hidden = !on;
    $('#ssSubWays', root).hidden = on;
    $('#ssSubWaysNote', root).hidden = on;
    $('#ssSubRecHint', root).hidden = true;
    if (on) $('#ssSubRecLabel', root).textContent = '錄音中 0:00';
    else $('#ssSubWaysNote', root).textContent = st.audioBlob ? '再錄或再選一次，會取代現在這段聲音。' : '影片只會取出聲音和一張截圖當封面，不會上傳整支影片。';
  }

  function isTouch() {
    return !!(navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }

  function isVideoFile(f) {
    return /^video\//.test(f.type || '') || /\.(mp4|mov|m4v|webm|3gp|3g2|mkv|avi)$/i.test(f.name || '');
  }

  // ------------------------------------------------------------ 錄影檔：取聲音、截封面、讀座標
  function setVideo(file) {
    if (file.size > CONFIG.maxVideoMB * 1048576) { note('影片太大了（上限 ' + CONFIG.maxVideoMB + ' MB），請先剪短再選'); return; }
    setAudio(file, file.name || '現場錄影.mp4', { kind: 'video' });
    if (st.audioBlob !== file) return;
    if (!st.whenTouched && !st.restoring && file.lastModified && Date.now() - file.lastModified > 90e3) {
      $('#ssSubWhen', root).value = localDateTime(new Date(file.lastModified));
    }
    var fresh = file.lastModified && Date.now() - file.lastModified < 20 * 60e3;
    grabFrame(file).then(function (blob) {
      if (st.audioBlob !== file || !blob) return;
      if (st.thumbUrl) URL.revokeObjectURL(st.thumbUrl);
      st.thumbUrl = URL.createObjectURL(blob);
      var th = $('#ssSubThumb', root);
      th.src = st.thumbUrl; th.hidden = false;
      if (!st.photoFile && !st.restoring) {
        setPhoto(new File([blob], 'cover.jpg', { type: 'image/jpeg' }), { fromVideo: true });
      }
    }).catch(function () {});
    videoGps(file).then(function (gps) {
      if (st.audioBlob !== file) return;
      st.videoGps = gps;
      $('#ssSubVideoPos', root).hidden = !gps;
      if (st.restoring) return;
      if (gps) {
        if (!st.pos) setPos(gps.lat, gps.lon, 'video', true);
        else {
          var t = $('#ssSubTrimNote', root);
          t.innerHTML = I.pin + ' 影片裡有位置資訊。<button type="button" class="ss-sub-link" id="ssSubUseVideoPos">用它當採集地點</button>';
          $('#ssSubUseVideoPos', root).addEventListener('click', function () { setPos(gps.lat, gps.lon, 'video', true); syncTrimText(); });
        }
      } else if (!st.pos && fresh) {
        // 剛錄完、影片沒帶座標：人大概還在現場，先抓目前位置
        useMyLocation(true);
      }
    });
  }

  function grabFrame(file) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
      var url = URL.createObjectURL(file), done = false, timer;
      var finish = function (b) { if (done) return; done = true; clearTimeout(timer); try { v.removeAttribute('src'); v.load(); } catch (e) {} URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('frame')); };
      timer = setTimeout(function () { finish(null); }, 15000);
      v.onerror = function () { finish(null); };
      v.onloadedmetadata = function () {
        var d = isFinite(v.duration) ? v.duration : 0;
        v.currentTime = d > 0.4 ? Math.min(1.5, d * 0.25) : 0.01;
      };
      v.onseeked = function () {
        try {
          var w = v.videoWidth, h = v.videoHeight;
          if (!w || !h) return finish(null);
          var scale = Math.min(1, 1600 / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(function (b) { finish(b); }, 'image/jpeg', 0.84);
        } catch (e) { finish(null); }
      };
      v.src = url;
      v.load();
    });
  }

  // 手機相機錄的 mp4/mov 會把座標寫成 ISO 6709（例如 +23.0320+120.2100/），在檔頭或檔尾找得到
  function videoGps(file) {
    if (!window.TextDecoder) return Promise.resolve(null);
    var N = 4 * 1048576;
    var parts = file.size > 2 * N ? [file.slice(0, N), file.slice(file.size - N)] : [file];
    return Promise.all(parts.map(function (p) { return p.arrayBuffer(); })).then(function (bufs) {
      var dec = new TextDecoder('latin1');
      for (var i = 0; i < bufs.length; i++) {
        var txt = dec.decode(bufs[i]);
        var m = /([+-]\d{1,2}\.\d{2,})([+-]\d{1,3}\.\d{2,})([+-]\d+(?:\.\d+)?)?(?:CRS[^\/]{0,40})?\//.exec(txt);
        if (m) {
          var lat = +m[1], lon = +m[2];
          if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) return { lat: lat, lon: lon };
        }
      }
      return null;
    }).catch(function () { return null; });
  }

  // ------------------------------------------------------------ 聲音檔：預覽、波形、剪輯
  function setAudio(blob, name, opts) {
    opts = opts || {};
    if (blob.size > CONFIG.maxAudioMB * 1048576) { note('檔案太大了（上限 ' + CONFIG.maxAudioMB + ' MB），請剪短一點'); return; }
    clearAudio(true);
    st.audioBlob = blob;
    st.audioKind = opts.kind || (/^video\//.test(blob.type || '') ? 'video' : 'audio');
    st.audioName = name || 'audio';
    st.audioUrl = URL.createObjectURL(blob);
    st.audioDur = 0;
    audioPreview.src = st.audioUrl;
    $('#ssSubAudioName', root).textContent = st.audioName;
    syncAudioMeta();
    $('#ssSubAudioPreview', root).hidden = false;
    $('#ssSubWaveBox', root).hidden = true;
    markSec('audio', true);
    status('');
    syncRecUI(false);
    if (!$('#ssSubTitleIn', root).value && !/錄音/.test(st.audioName)) {
      var base = st.audioName.replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
      if (!/^(rec|audio|voice|img|vid|\d)/i.test(base)) { $('#ssSubTitleIn', root).value = base; syncMeta(); }
    }
    if (!opts.skipSave) saveDraft();
    $('#ssSubAudioMeta', root).textContent = '解析中…';
    decodeBlob(blob).then(function (buf) {
      if (st.audioBlob !== blob) return;
      st.buffer = buf;
      st.audioDur = buf.duration;
      st.trimStart = 0;
      st.trimEnd = buf.duration;
      st.peaks = peaksOf(buf, 600);
      $('#ssSubWaveBox', root).hidden = false;
      var a = $('#ssSubTrimA', root), b = $('#ssSubTrimB', root);
      a.value = 0; b.value = 1000;
      syncTrimText();
      drawWave();
      syncAudioMeta();
    }).catch(function () {
      if (st.audioBlob !== blob) return;
      st.buffer = null;
      syncAudioMeta();
      $('#ssSubTrimNote', root).textContent = st.audioKind === 'video' ? '這支影片的聲音瀏覽器讀不出來，會上傳整支影片，由伺服器轉成 mp3。' : '這個格式瀏覽器讀不出來，會直接上傳原檔。';
      if (st.audioKind === 'video' && blob.size > CONFIG.maxAudioMB * 1048576) { note('影片太大又讀不出聲音（上限 ' + CONFIG.maxAudioMB + ' MB）'); clearAudio(); }
    });
  }

  function onTrim() {
    if (!st.buffer) return;
    var a = $('#ssSubTrimA', root), b = $('#ssSubTrimB', root);
    var d = st.buffer.duration;
    var s = +a.value / 1000 * d, e = +b.value / 1000 * d;
    if (e - s < 0.5) {
      if (this === a) { s = Math.max(0, e - 0.5); a.value = Math.round(s / d * 1000); }
      else { e = Math.min(d, s + 0.5); b.value = Math.round(e / d * 1000); }
    }
    st.trimStart = s; st.trimEnd = e;
    st.mp3 = null;
    syncTrimText();
    drawWave();
    syncAudioMeta();
    if (!audioPreview.paused) { if (audioPreview.currentTime < s || audioPreview.currentTime > e) audioPreview.currentTime = s; }
    else audioPreview.currentTime = s;
  }

  function syncTrimText() {
    $('#ssSubTrimAT', root).textContent = fmtTime1(st.trimStart);
    $('#ssSubTrimBT', root).textContent = fmtTime1(st.trimEnd);
    var cut = st.buffer ? (st.buffer.duration - (st.trimEnd - st.trimStart)) : 0;
    $('#ssSubTrimNote', root).textContent = (cut > 0.2 ? '會剪掉 ' + cut.toFixed(1) + ' 秒，留下 ' + fmtTime1(st.trimEnd - st.trimStart) + '。送出前壓成 mp3。' : '拖兩個滑桿剪掉頭尾，送出前會壓成 mp3。') + (st.audioKind === 'video' ? '只上傳聲音，不上傳影片。' : '');
  }

  function drawWave() {
    var c = $('#ssSubWave', root);
    if (!c || !st.peaks || $('#ssSubWaveBox', root).hidden) return;
    var w = c.clientWidth || 300, h = 64, dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = h * dpr; }
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var n = st.peaks.length, d = st.buffer.duration;
    var s = st.trimStart / d * w, e = st.trimEnd / d * w;
    var cur = (audioPreview.currentTime || 0) / d * w;
    for (var i = 0; i < n; i++) {
      var x = i / n * w;
      var bh = Math.max(2, st.peaks[i] * (h - 8));
      var inside = x >= s && x <= e;
      g.fillStyle = inside ? (x <= cur ? '#0f766e' : '#1b2a2d') : 'rgba(12,26,29,0.18)';
      g.fillRect(x, (h - bh) / 2, Math.max(1, w / n - 0.5), bh);
    }
    g.fillStyle = 'rgba(12,26,29,0.08)';
    g.fillRect(0, 0, s, h);
    g.fillRect(e, 0, w - e, h);
    g.fillStyle = '#f3c26b';
    g.fillRect(s - 1, 0, 2, h);
    g.fillRect(e - 1, 0, 2, h);
  }

  function syncAudioMeta() {
    var m = $('#ssSubAudioMeta', root);
    if (!st.audioBlob) { m.textContent = ''; return; }
    var dur = st.buffer ? (st.trimEnd - st.trimStart) : st.audioDur;
    var est = st.buffer ? '約 ' + fmtMB(dur * CONFIG.mp3Kbps * 125) + '（mp3）' : fmtMB(st.audioBlob.size);
    m.textContent = (dur ? fmtTime(dur) + '・' : '') + est;
  }

  function clearAudio(silent) {
    try { audioPreview.pause(); } catch (e) {}
    if (st.audioUrl) URL.revokeObjectURL(st.audioUrl);
    st.audioBlob = null; st.audioUrl = ''; st.audioName = ''; st.audioDur = 0; st.buffer = null; st.peaks = null; st.mp3 = null; st.trimStart = 0; st.trimEnd = 0;
    audioPreview.removeAttribute('src');
    st.audioKind = 'audio'; st.videoGps = null;
    if (st.thumbUrl) { URL.revokeObjectURL(st.thumbUrl); st.thumbUrl = ''; }
    if (root) {
      var th = $('#ssSubThumb', root); th.hidden = true; th.removeAttribute('src');
      $('#ssSubVideoPos', root).hidden = true;
      if (st.photoFromVideo) clearPhoto();
      $('#ssSubAudioPreview', root).hidden = true;
      $('#ssSubWaveBox', root).hidden = true;
      markSec('audio', false);
      if (!silent) syncRecUI(false);
    }
  }

  function togglePreview() {
    if (!st.audioUrl) return;
    if (audioPreview.paused) {
      if (window.globalAudio && !window.globalAudio.paused) window.globalAudio.pause();
      if (st.buffer && (audioPreview.currentTime < st.trimStart || audioPreview.currentTime >= st.trimEnd - 0.1)) audioPreview.currentTime = st.trimStart;
      audioPreview.play().catch(function () {});
    } else audioPreview.pause();
  }

  // 送出用的 mp3：剪好、壓好，同樣的設定不重做
  function prepareAudio(onProgress) {
    if (!st.buffer) return Promise.resolve({ blob: st.audioBlob, name: st.audioName, encoded: false });
    var key = st.audioName + '|' + st.trimStart.toFixed(2) + '|' + st.trimEnd.toFixed(2);
    if (st.mp3 && st.mp3Key === key) return Promise.resolve({ blob: st.mp3, name: 'sound.mp3', encoded: true });
    return encodeMp3(st.buffer, st.trimStart, st.trimEnd, onProgress).then(function (blob) {
      st.mp3 = blob; st.mp3Key = key;
      return { blob: blob, name: 'sound.mp3', encoded: true };
    }).catch(function (err) {
      // lamejs 載不到（例如離線）就退回原檔
      if (st.trimStart > 0.2 || st.trimEnd < st.buffer.duration - 0.2) throw new Error('沒辦法壓縮，剪頭尾就不會生效：' + (err.message || err));
      return { blob: st.audioBlob, name: st.audioName, encoded: false };
    });
  }

  // ------------------------------------------------------------ 照片
  function setPhoto(file, opts) {
    opts = opts || {};
    if (!/^image\//.test(file.type)) { note('請選一張照片'); return; }
    if (file.size > CONFIG.maxImageMB * 1048576) { note('照片太大了（上限 ' + CONFIG.maxImageMB + ' MB）'); return; }
    if (st.photoUrl) URL.revokeObjectURL(st.photoUrl);
    st.photoFile = file;
    st.photoBlob = null;
    st.photoFromVideo = !!opts.fromVideo;
    st.photoUrl = URL.createObjectURL(file);
    var box = $('#ssSubPhotoBox', root);
    box.classList.add('has-photo');
    box.style.backgroundImage = 'url("' + st.photoUrl + '")';
    box.querySelector('span').textContent = opts.fromVideo ? '影片截圖當封面・換一張' : '換一張';
    markSec('photo', true);
    st.photoGps = null;
    $('#ssSubPhotoPos', root).hidden = true;
    var noteEl = $('#ssSubPhotoNote', root);
    noteEl.hidden = true;
    shrinkImage(file).then(function (b) {
      if (st.photoFile !== file) return;
      st.photoBlob = b;
      box.querySelector('span').textContent = (st.photoFromVideo ? '影片截圖當封面・換一張 · ' : '換一張 · ') + fmtMB(b.size);
      if (!opts.skipSave) saveDraft();
    });
    exifGps(file).then(function (gps) {
      if (!gps || st.photoFile !== file) return;
      st.photoGps = gps;
      $('#ssSubPhotoPos', root).hidden = false;
      if (!st.pos) { setPos(gps.lat, gps.lon, 'photo', true); return; }
      noteEl.hidden = false;
      noteEl.innerHTML = I.pin + ' 這張照片有位置資訊。<button type="button" class="ss-sub-link" id="ssSubUsePhotoPos">用它當採集地點</button>';
      $('#ssSubUsePhotoPos', root).addEventListener('click', function () { setPos(gps.lat, gps.lon, 'photo', true); noteEl.hidden = true; });
    });
  }

  // ------------------------------------------------------------ 說明
  function syncMeta() {
    markSec('meta', !!($('#ssSubTitleIn', root).value.trim() && st.cat));
    status('');
  }

  function setCat(c) {
    st.cat = c;
    root.querySelectorAll('.ss-sub-cat').forEach(function (b) {
      var on = b.dataset.cat === c;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var hint = $('#ssSubCatHint', root);
    if (hint) { hint.textContent = c ? c + '：' + CAT_HINT[c] : '不確定就選最接近的，之後可以再調整。'; hint.classList.toggle('is-on', !!c); }
    setTimeout(function () { syncMeta(); saveDraft(); }, 0);
  }

  function markSec(name, ok) {
    var s = root.querySelector('.ss-sub-sec[data-sec="' + name + '"]');
    if (s) s.classList.toggle('is-done', !!ok);
    refreshTodo();
  }

  // 送出鈕上方的「還差什麼」：一眼看出哪幾項還沒好，點一下跳過去
  function todoItems() {
    var list = [
      { sec: 'audio', label: '聲音', ok: !!st.audioBlob },
      { sec: 'pos', label: '位置', ok: !!st.pos },
      { sec: 'meta', label: '標題', ok: !!$('#ssSubTitleIn', root).value.trim() },
      { sec: 'meta', label: '類別', ok: !!st.cat }
    ];
    if (needLogin()) list.push({ sec: 'auth', label: 'Google 登入', ok: !!authValid() });
    return list;
  }
  function refreshTodo() {
    var ul = root && $('#ssSubTodo', root);
    if (!ul) return;
    var items = todoItems();
    var left = items.filter(function (x) { return !x.ok; }).length;
    ul.innerHTML = '<li class="ss-sub-todo-h">' + (left ? '還差 ' + left + ' 項' : '都好了，可以送出') + '</li>' + items.map(function (x) {
      return '<li class="' + (x.ok ? 'is-ok' : '') + '"><button type="button" data-sec="' + x.sec + '">' + (x.ok ? I.check : '<i></i>') + esc(x.label) + '</button></li>';
    }).join('');
    ul.classList.toggle('is-ready', !left);
    $('#ssSubSend', root).classList.toggle('is-pending', !!left);
  }
  function jumpTo(sec) {
    var s = sec === 'auth' ? $('#ssSubAuth', root) : root.querySelector('.ss-sub-sec[data-sec="' + sec + '"]');
    if (!s) return;
    s.classList.add('is-shake');
    s.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { s.classList.remove('is-shake'); }, 600);
  }

  // ------------------------------------------------------------ 登入：沿用網站原本「登入探險」的 Firebase Google 登入
  var SS_REOPEN = 'ss-sub-reopen';
  function needLogin() { return !!CONFIG.requireLogin; }
  function fbAuth() { try { return window.firebase && firebase.auth ? firebase.auth() : null; } catch (e) { return null; } }
  function authValid() {
    var a = fbAuth(), u = a && a.currentUser;
    return u && u.email ? { email: u.email, name: u.displayName || '', user: u } : null;
  }
  function authToken() {
    var a = authValid();
    if (a) return a.user.getIdToken();
    var e = new Error('請先登入再送出'); e.needLogin = true;
    return Promise.reject(e);
  }
  function inAppBrowser() { return /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(navigator.userAgent || ''); }
  function signIn() {
    var a = fbAuth();
    if (!a || authValid()) return;
    saveDraft();
    var btn = $('#ssSubGBtn', root);
    if (btn) btn.disabled = true;
    // 用彈出視窗登入，投稿頁留在原地；網站原本手機版是整頁跳轉，會把投稿頁關掉
    a.signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function () {
      renderAuth();
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      var code = err && err.code || '';
      if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code)) return;
      if (/popup-blocked|operation-not-supported/.test(code)) {
        // 瀏覽器擋彈出視窗才退回整頁跳轉，回來後自動打開投稿頁，草稿會接回
        try { sessionStorage.setItem(SS_REOPEN, '1'); } catch (e) {}
        a.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
        return;
      }
      status('登入沒有成功：' + (err && err.message || err), 'err');
    });
  }
  function signOut() {
    var a = fbAuth();
    if (a) a.signOut();
  }
  function watchAuth() {
    var a = fbAuth();
    if (!a) return;
    a.onAuthStateChanged(function (u) {
      if (root) renderAuth();
      syncQueueBadge();
      if (u) processQueue();
      var reopen = false;
      try { reopen = sessionStorage.getItem(SS_REOPEN); if (u) sessionStorage.removeItem(SS_REOPEN); } catch (e) {}
      if (u && reopen && !(root && root.classList.contains('active'))) setTimeout(function () { open({ mine: reopen === 'mine' }); }, 400);
    });
  }
  function renderAuth() {
    var box = $('#ssSubAuth', root);
    if (!needLogin()) { box.hidden = true; return; }
    box.hidden = false;
    var a = authValid();
    if (a) {
      box.className = 'ss-sub-auth is-in';
      box.innerHTML = '<span class="ss-sub-auth-ico">' + I.check + '</span><div class="ss-sub-auth-t"><b>已登入' + (a.name ? '：' + esc(a.name) : '') + '</b><i>' + esc(a.email) + '・不會公開</i></div><button type="button" class="ss-sub-link" id="ssSubAuthOut">換帳號</button>';
      $('#ssSubAuthOut', box).addEventListener('click', signOut);
      if (/登入/.test($('#ssSubStatus', root).textContent)) status('');
      refreshTodo();
      return;
    }
    box.className = 'ss-sub-auth';
    if (inAppBrowser()) {
      var ext = location.href.split('#')[0];
      ext += (ext.indexOf('?') > -1 ? '&' : '?') + 'openExternalBrowser=1';
      box.innerHTML = '<div class="ss-sub-auth-t"><b>最後一步：用 Google 帳號登入</b><i>你是在 LINE 或 Facebook 裡面打開這個網頁，Google 不允許在這裡登入。請改用 Safari 或 Chrome 打開。</i></div>' +
        '<div class="ss-sub-auth-acts"><a class="ss-sub-chipbtn" href="' + esc(ext) + '" target="_blank" rel="noopener">用瀏覽器打開</a><button type="button" class="ss-sub-chipbtn" id="ssSubCopyUrl">複製網址</button></div>';
      $('#ssSubCopyUrl', box).addEventListener('click', function () {
        var u = location.href.split('#')[0];
        (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { note('網址複製好了，貼到 Safari 或 Chrome'); }, function () { window.prompt('複製這個網址，貼到 Safari 或 Chrome', u); });
      });
      refreshTodo();
      return;
    }
    box.innerHTML = '<div class="ss-sub-auth-t"><b>最後一步：用 Google 帳號登入</b><i>和右上角「登入探險」是同一個登入。只用來確認是真人、有問題時聯絡你，email 不會公開。</i></div>' +
      '<button type="button" class="ss-sub-gbtn" id="ssSubGBtn"><span class="ss-sub-g">G</span>用 Google 帳號登入</button>';
    $('#ssSubGBtn', box).addEventListener('click', signIn);
    refreshTodo();
  }

  function validate() {
    var problems = [];
    if (!st.audioBlob) problems.push({ sec: 'audio', msg: '還沒有聲音：錄一段，或選一個檔案' });
    if (!st.pos) problems.push({ sec: 'pos', msg: '把圖釘拖到採集的地點' });
    if (!$('#ssSubTitleIn', root).value.trim()) problems.push({ sec: 'meta', msg: '給這段聲音一個標題' });
    if (!st.cat) problems.push({ sec: 'meta', msg: '選一個類別' });
    if (needLogin() && !authValid()) problems.push({ sec: 'auth', msg: inAppBrowser() ? '請改用 Safari 或 Chrome 打開，才能用 Google 登入' : '最後一步：按「用 Google 帳號登入」' });
    return problems;
  }

  function status(msg, kind) {
    var s = $('#ssSubStatus', root);
    s.textContent = msg || '';
    s.className = 'ss-sub-status' + (kind ? ' is-' + kind : '');
  }
  function progress(p) {
    var box = $('#ssSubProgress', root);
    if (p == null) { box.hidden = true; return; }
    box.hidden = false;
    box.firstChild.style.width = Math.round(p * 100) + '%';
  }

  // ------------------------------------------------------------ 草稿
  var saveDraft = debounce(function () {
    if (!root || st.restoring) return;
    var d = {
      title: $('#ssSubTitleIn', root).value, cat: st.cat, author: $('#ssSubAuthor', root).value, desc: $('#ssSubDesc', root).value,
      when: $('#ssSubWhen', root).value, email: $('#ssSubEmail', root).value,
      pos: st.pos, posSource: st.posSource, place: st.place, trimStart: st.trimStart, trimEnd: st.trimEnd,
      hasAudio: !!st.audioBlob, hasPhoto: !!st.photoFile, at: Date.now()
    };
    var empty = !d.title && !d.desc && !d.hasAudio && !d.hasPhoto && !d.cat;
    if (empty) { clearDraft(); return; }
    writeLS(LS_DRAFT, JSON.stringify(d));
    if (st.audioBlob) idbPut('draft', { blob: st.audioBlob, name: st.audioName }, 'audio'); else idbDel('draft', 'audio');
    if (st.photoFile) idbPut('draft', { blob: st.photoFile, name: st.photoFile.name || 'photo.jpg' }, 'photo'); else idbDel('draft', 'photo');
  }, 500);

  function clearDraft() {
    try { localStorage.removeItem(LS_DRAFT); } catch (e) {}
    idbDel('draft', 'audio'); idbDel('draft', 'photo');
  }

  function restoreDraft() {
    var d = readJSON(LS_DRAFT);
    if (!d || Date.now() - (d.at || 0) > 7 * 86400e3) return;
    st.restoring = true;
    $('#ssSubTitleIn', root).value = d.title || '';
    $('#ssSubAuthor', root).value = d.author || $('#ssSubAuthor', root).value;
    $('#ssSubDesc', root).value = d.desc || '';
    if (d.when) $('#ssSubWhen', root).value = d.when;
    $('#ssSubEmail', root).value = d.email || '';
    if (d.cat) setCat(d.cat);
    if (d.pos) { setPos(d.pos.lat, d.pos.lon, d.posSource || 'map', true); if (d.place) { st.place = d.place; } }
    syncMeta();
    var jobs = [];
    if (d.hasAudio) jobs.push(idbGet('draft', 'audio').then(function (r) {
      if (r && r.blob) {
        if (isVideoFile({ type: r.blob.type, name: r.name })) setVideo(new File([r.blob], r.name || 'video.mp4', { type: r.blob.type || 'video/mp4' }));
        else setAudio(r.blob, r.name, { skipSave: true });
        if (d.trimEnd) {
          var tryTrim = function (n) {
            if (st.buffer) {
              st.trimStart = Math.min(d.trimStart || 0, st.buffer.duration); st.trimEnd = Math.min(d.trimEnd, st.buffer.duration);
              $('#ssSubTrimA', root).value = Math.round(st.trimStart / st.buffer.duration * 1000);
              $('#ssSubTrimB', root).value = Math.round(st.trimEnd / st.buffer.duration * 1000);
              syncTrimText(); drawWave(); syncAudioMeta();
            } else if (n < 40) setTimeout(function () { tryTrim(n + 1); }, 250);
          };
          tryTrim(0);
        }
      }
    }));
    if (d.hasPhoto) jobs.push(idbGet('draft', 'photo').then(function (r) { if (r && r.blob) setPhoto(new File([r.blob], r.name || 'photo.jpg', { type: r.blob.type || 'image/jpeg' }), { skipSave: true }); }));
    Promise.all(jobs).then(function () {
      st.restoring = false;
      $('#ssSubDraftBar', root).hidden = false;
    });
  }

  // ------------------------------------------------------------ 上傳與送出
  function uploadCloudinary(file, kind, onProgress) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('file', file, file.name || (kind === 'image' ? 'cover.jpg' : 'sound.mp3'));
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
      xhr.onerror = function () { var e = new Error('上傳時斷線了'); e.net = true; reject(e); };
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

  // 一筆投稿從上傳到寫入；排隊重送也走這裡
  function deliver(job, report) {
    report = report || function () {};
    var payload = job.payload;
    if (needLogin() && !authValid()) { var le = new Error('請先在下面登入再送出'); le.needLogin = true; return Promise.reject(le); }
    var audioFile = job.audio.blob instanceof File ? job.audio.blob : new File([job.audio.blob], job.audio.name, { type: job.audio.blob.type || 'audio/mpeg' });
    report('上傳聲音…', 0);
    return uploadCloudinary(audioFile, 'audio', function (p) { report('上傳聲音… ' + Math.round(p * 100) + '%', p * 0.7); })
      .then(function (a) {
        payload.audio = { url: a.secure_url, publicId: a.public_id, resourceType: a.resource_type, cloudName: CONFIG.cloudName, duration: a.duration || 0, bytes: a.bytes, format: a.format };
        payload.audioMp3 = a.format === 'mp3' ? a.secure_url : 'https://res.cloudinary.com/' + CONFIG.cloudName + '/video/upload/' + a.public_id + '.mp3';
        if (!job.photo) return null;
        report('上傳照片…', 0.75);
        var photoFile = job.photo.blob instanceof File ? job.photo.blob : new File([job.photo.blob], job.photo.name || 'cover.jpg', { type: job.photo.blob.type || 'image/jpeg' });
        return uploadCloudinary(photoFile, 'image', function (p) { report('上傳照片… ' + Math.round(p * 100) + '%', 0.75 + p * 0.2); });
      })
      .then(function (c) {
        if (c) payload.cover = { url: c.secure_url.replace('/image/upload/', '/image/upload/f_auto,q_auto,w_1200/'), publicId: c.public_id };
        report('寫入地圖資料…', 0.97);
        return (needLogin() ? authToken().then(function (t) { payload.idToken = t; }) : Promise.resolve())
          .then(function () { return postMeta(payload); }).catch(function (err) {
          if (/Failed to fetch|NetworkError|Load failed/i.test(String(err.message))) err.net = true;
          if (/登入/.test(String(err.message))) err.needLogin = true;
          throw err;
        });
      })
      .then(function (j) { delete payload.idToken; payload._review = !!(j && j.review); report('完成', 1); return payload; });
  }

  function collectPayload() {
    var author = $('#ssSubAuthor', root).value.trim();
    if (author) writeLS(LS_AUTHOR, author);
    var when = $('#ssSubWhen', root).value;
    return {
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
      place: st.place || '',
      email: $('#ssSubEmail', root).value.trim(),
      page: location.href.split('?')[0]
    };
  }

  function submit() {
    if (st.busy) return;
    if ($('#ssSubWeb', root).value) return;
    var problems = validate();
    if (problems.length) {
      status(problems[0].msg, 'warn');
      if (problems[0].sec === 'auth') renderAuth();
      jumpTo(problems[0].sec);
      return;
    }
    var payload = collectPayload();
    if (!backendReady()) { fallbackToForm(payload); return; }

    st.busy = true;
    var send = $('#ssSubSend', root);
    send.disabled = true;
    send.classList.add('is-busy');
    try { audioPreview.pause(); } catch (e) {}
    status('整理聲音…', 'busy');
    progress(0);

    prepareAudio(function (p) { status('壓成 mp3… ' + Math.round(p * 100) + '%', 'busy'); progress(p * 0.25); })
      .then(function (a) {
        var job = { id: payload.uid, payload: payload, audio: { blob: a.blob, name: a.name }, photo: st.photoFile ? { blob: st.photoBlob || st.photoFile, name: 'cover.jpg' } : null, createdAt: Date.now() };
        if (navigator.onLine === false) { enqueue(job); return 'queued'; }
        return deliver(job, function (msg, p) { status(msg, 'busy'); progress(0.25 + p * 0.75); }).then(function () { return 'sent'; }).catch(function (err) {
          if (isNetErr(err)) { st.lastJob = job; throw err; }
          throw err;
        });
      })
      .then(function (how) {
        st.busy = false;
        send.disabled = false; send.classList.remove('is-busy');
        status(''); progress(null);
        rememberMine(payload, how === 'queued');
        if (how === 'sent' && !payload._review) addFreshMarker(payload);
        clearDraft();
        showDone(payload, how);
      })
      .catch(function (err) {
        st.busy = false;
        send.disabled = false; send.classList.remove('is-busy');
        progress(null);
        status('送出失敗：' + (err && err.message || err) + '。', 'err');
        if (err && err.needLogin) { renderAuth(); jumpTo('auth'); return; }
        var box = $('#ssSubStatus', root);
        if (st.lastJob && isNetErr(err)) {
          var q = el('button', 'ss-sub-link', '排隊，回到有網路時自動送出');
          q.type = 'button';
          q.addEventListener('click', function () {
            var job = st.lastJob; st.lastJob = null;
            enqueue(job);
            rememberMine(job.payload, true);
            clearDraft();
            status(''); showDone(job.payload, 'queued');
          });
          box.appendChild(document.createTextNode(' '));
          box.appendChild(q);
        }
        var retry = el('button', 'ss-sub-link', '改用 Google 表單');
        retry.type = 'button';
        retry.addEventListener('click', function () { fallbackToForm(payload); });
        box.appendChild(document.createTextNode(' '));
        box.appendChild(retry);
      });
  }

  // ------------------------------------------------------------ 排隊：沒網路也能先投
  var queueBusy = false;
  function enqueue(job) {
    delete job.payload.idToken;
    idbPut('queue', job).then(syncQueueBadge);
  }

  function syncQueueBadge() {
    idbAll('queue').then(function (list) {
      var n = (list || []).length;
      document.querySelectorAll('[data-ss-queue]').forEach(function (node) {
        node.hidden = !n;
        node.textContent = !n ? '' : needLogin() && !authValid() ? '有 ' + n + ' 筆投稿在排隊，登入後就會送出' : '有 ' + n + ' 筆投稿在排隊，回到有網路會自動送出';
      });
    });
  }

  function processQueue() {
    if (queueBusy || !backendReady() || navigator.onLine === false || (needLogin() && !authValid())) return;
    queueBusy = true;
    idbAll('queue').then(function (list) {
      list = (list || []).sort(function (a, b) { return a.createdAt - b.createdAt; });
      var i = 0;
      function next() {
        if (i >= list.length) return;
        var job = list[i++];
        return deliver(job).then(function () {
          return idbDel('queue', job.id).then(function () {
            markMineSent(job.payload.uid);
            if (!job.payload._review) addFreshMarker(job.payload);
            note('剛才排隊的「' + job.payload.title + '」已經送出了');
            return next();
          });
        }).catch(function (err) {
          if (isNetErr(err)) return; // 還是沒網路，下次再試
          // 真的失敗（例如檔案被拒），留著讓人看得到，但不要卡住後面的
          return next();
        });
      }
      return next();
    }).then(function () { queueBusy = false; syncQueueBadge(); }, function () { queueBusy = false; });
  }

  // ------------------------------------------------------------ 我的投稿與「剛送出」的點
  function rememberMine(payload, queued) {
    var mine = readJSON(LS_MINE) || [];
    mine = mine.filter(function (m) { return m.uid !== payload.uid; });
    mine.unshift({ uid: payload.uid, title: payload.title, lat: payload.lat, lon: payload.lon, category: payload.category, at: Date.now(), queued: !!queued, review: !!payload._review });
    writeLS(LS_MINE, JSON.stringify(mine.slice(0, 50)));
  }
  function markMineSent(uid) {
    var mine = readJSON(LS_MINE) || [];
    mine.forEach(function (m) { if (m.uid === uid) m.queued = false; });
    writeLS(LS_MINE, JSON.stringify(mine));
  }

  var freshLayer = null;
  function addFreshMarker(p) {
    if (!window.map || !window.L) return;
    if (!freshLayer) freshLayer = L.layerGroup().addTo(window.map);
    var icon = L.divIcon({ className: 'ss-fresh-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
    var m = L.marker([p.lat, p.lon], { icon: icon, zIndexOffset: 5000 });
    m.bindTooltip('剛送出：' + esc(p.title) + '<br><small>幾分鐘內會正式上架</small>', { direction: 'top', offset: [0, -12], className: 'ss-tip' });
    m.__uid = p.uid;
    freshLayer.addLayer(m);
  }

  // 「剛送出」的暫時點只撐到正式上架那一刻；上架過一次就不再出現，之後被下架或刪除也不會冒出來
  function syncFresh() {
    var all = readJSON(LS_MINE) || [];
    var live = {}, changed = false;
    (window.allMarkersData || []).forEach(function (i) { live[i.uid] = 1; });
    all.forEach(function (m) { if (live[m.uid] && !m.seen) { m.seen = true; changed = true; } });
    if (changed) writeLS(LS_MINE, JSON.stringify(all));
    var pending = all.filter(function (m) { return !m.seen && !m.queued && !m.review && !live[m.uid] && Date.now() - m.at < 15 * 60e3; });
    if (freshLayer) freshLayer.clearLayers();
    pending.forEach(addFreshMarker);
  }

  // ------------------------------------------------------------ 完成畫面
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
      '<dl class="ss-sub-copy"><dt>標題</dt><dd>' + esc(payload.title) + '</dd><dt>類別</dt><dd>' + esc(payload.category) + '</dd><dt>採集者</dt><dd>' + esc(payload.author) + '</dd>' + (payload.place ? '<dt>地點</dt><dd>' + esc(payload.place) + '</dd>' : '') + (payload.description ? '<dt>說明</dt><dd>' + esc(payload.description) + '</dd>' : '') + '</dl>' +
      (w ? '' : '<p><a class="ss-sub-link" href="' + esc(url) + '" target="_blank" rel="noopener">表單沒有自動打開？按這裡</a></p>') +
      '<div class="ss-sub-done-acts"><button type="button" class="ss-sub-send" id="ssSubBack">' + I.check + '<span>回到地圖</span></button><button type="button" class="ss-sub-chipbtn" id="ssSubEdit">回去改內容</button></div>';
    $('#ssSubBack', root).addEventListener('click', close);
    $('#ssSubEdit', root).addEventListener('click', function () { box.hidden = true; form.hidden = false; });
  }

  function showDone(payload, how) {
    var box = $('#ssSubDone', root);
    form.hidden = true;
    box.hidden = false;
    var queued = how === 'queued';
    box.innerHTML =
      '<div class="ss-sub-done-ico ' + (queued ? 'is-wait' : 'is-ok') + '">' + (queued ? I.clock : I.check) + '</div>' +
      '<h3>' + (queued ? '先收著了，回到有網路會自動送出' : '送出了，謝謝你留下這段聲音') + '</h3>' +
      '<p>' + (queued
        ? '「' + esc(payload.title) + '」已經存在這台裝置裡；等手機連上網路、再打開這個網站，就會自動上傳。'
        : payload._review
          ? '「' + esc(payload.title) + '」已經收到了。內容裡有些字詞需要管理者先看一下，看過就會上架。'
          : '「' + esc(payload.title) + '」已經寫進資料庫，地圖上先放了一個「剛送出」的點，幾分鐘內會正式上架。') + '</p>' +
      '<div class="ss-sub-done-acts">' +
        '<button type="button" class="ss-sub-send" id="ssSubBack">' + I.pin + '<span>' + (queued || payload._review ? '回到地圖' : '去看那個點') + '</span></button>' +
        '<button type="button" class="ss-sub-chipbtn" id="ssSubAgain">再投一段</button>' +
        (needLogin() ? '<button type="button" class="ss-sub-chipbtn" id="ssSubSeeMine">看我的投稿</button>' : '') +
      '</div>';
    $('#ssSubBack', root).addEventListener('click', function () {
      close(); resetForm();
      if (!queued && !payload._review && window.map) { try { window.map.flyTo([payload.lat, payload.lon], Math.max(window.map.getZoom(), 16)); } catch (e) {} }
    });
    $('#ssSubAgain', root).addEventListener('click', function () { resetForm(); box.hidden = true; form.hidden = false; });
    if ($('#ssSubSeeMine', root)) $('#ssSubSeeMine', root).addEventListener('click', function () { resetForm(); showMine(); });
  }

  function clearPhoto() {
    if (st.photoUrl) URL.revokeObjectURL(st.photoUrl);
    st.photoFile = null; st.photoBlob = null; st.photoUrl = ''; st.photoGps = null; st.photoFromVideo = false;
    var box = $('#ssSubPhotoBox', root);
    box.classList.remove('has-photo'); box.style.backgroundImage = ''; box.querySelector('span').textContent = '拍一張或選一張';
    $('#ssSubPhotoNote', root).hidden = true;
    $('#ssSubPhotoPos', root).hidden = true;
    markSec('photo', false);
  }

  function resetForm() {
    clearAudio();
    clearPhoto();
    st.whenTouched = false;
    $('#ssSubTitleIn', root).value = '';
    $('#ssSubDesc', root).value = '';
    $('#ssSubWhen', root).value = localDateTime();
    $('#ssSubDraftBar', root).hidden = true;
    st.cat = '';
    root.querySelectorAll('.ss-sub-cat').forEach(function (b) { b.classList.remove('is-on'); b.setAttribute('aria-checked', 'false'); });
    var hint = $('#ssSubCatHint', root);
    hint.textContent = '不確定就選最接近的，之後可以再調整。'; hint.classList.remove('is-on');
    st.pos = null; st.place = '';
    if (st.miniMap) setPos(st.miniMap.getCenter().lat, st.miniMap.getCenter().lng, '', false, true);
    markSec('photo', false); markSec('meta', false);
    status(''); progress(null);
  }

  // ------------------------------------------------------------ 我的投稿：登入後向後端查自己每一件的狀態（含以前用表單投的）
  var MINE_STATE = {
    live: { label: '已上架', cls: 'is-live' },
    review: { label: '待審中', cls: 'is-review', hint: '內容裡有些字詞要管理者先看過' },
    working: { label: '處理中', cls: 'is-working', hint: '通常幾分鐘內會好' },
    problem: { label: '處理中', cls: 'is-working', hint: '管理者會協助處理' },
    hidden: { label: '已下架', cls: 'is-hidden' },
    queued: { label: '排隊中', cls: 'is-working', hint: '還在這台裝置裡，有網路就會送出' }
  };
  function showMine() {
    var box = $('#ssSubMine', root);
    form.hidden = true;
    $('#ssSubDone', root).hidden = true;
    box.hidden = false;
    var head = '<div class="ss-sub-mine-head"><button type="button" class="ss-sub-link" id="ssSubMineBack">← 回到投稿</button><h3>我的投稿</h3></div>';
    var back = function () { $('#ssSubMineBack', box).addEventListener('click', function () { box.hidden = true; form.hidden = false; }); };
    if (!backendReady()) { box.innerHTML = head + '<p class="ss-sub-mine-empty">站內投稿還沒接上後端。</p>'; back(); return; }
    if (needLogin() && !authValid()) {
      box.innerHTML = head + '<p class="ss-sub-mine-empty">登入後就能看到你投過的每一件、現在是什麼狀態。</p><div class="ss-sub-mine-login"><button type="button" class="ss-sub-gbtn" id="ssSubMineLogin"><span class="ss-sub-g">G</span>用 Google 帳號登入</button></div>';
      back();
      $('#ssSubMineLogin', box).addEventListener('click', function () {
        var a = fbAuth();
        if (!a) return;
        a.signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(showMine).catch(function (err) {
          if (/popup-blocked|operation-not-supported/.test(err && err.code || '')) { try { sessionStorage.setItem(SS_REOPEN, 'mine'); } catch (e) {} a.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); }
        });
      });
      return;
    }
    box.innerHTML = head + '<p class="ss-sub-mine-empty">讀取中…</p>';
    back();
    var queued = (readJSON(LS_MINE) || []).filter(function (m) { return m.queued; }).map(function (m) { return { uid: m.uid, title: m.title, category: m.category, at: '', state: 'queued' }; });
    authToken().then(function (t) {
      return fetch(CONFIG.endpoint, { method: 'POST', body: JSON.stringify({ action: 'mine', idToken: t }) }).then(function (r) { return r.json(); });
    }).then(function (j) {
      if (!j || !j.ok) throw new Error(j && j.error || '讀不到');
      if (box.hidden) return;
      renderMine(queued.concat(j.items || []), authValid());
    }).catch(function (err) {
      if (box.hidden) return;
      box.innerHTML = head + '<p class="ss-sub-mine-empty">讀不到你的投稿：' + esc(err && err.message || err) + '</p>';
      back();
    });
  }
  function renderMine(items, who) {
    var box = $('#ssSubMine', root);
    var live = {};
    (window.allMarkersData || []).forEach(function (i) { live[i.uid] = 1; });
    var count = {};
    items.forEach(function (x) { count[x.state] = (count[x.state] || 0) + 1; });
    box.innerHTML = '<div class="ss-sub-mine-head"><button type="button" class="ss-sub-link" id="ssSubMineBack">← 回到投稿</button><h3>我的投稿</h3>' +
      (who ? '<p>' + esc(who.email) + '・共 ' + items.length + ' 件' + (count.live ? '，' + count.live + ' 件在地圖上' : '') + '</p>' : '') + '</div>' +
      (items.length ? '<ul class="ss-sub-mine-list">' + items.map(function (x) {
        var st = MINE_STATE[x.state] || MINE_STATE.working;
        var canSee = x.state === 'live' && live[x.uid];
        return '<li><div class="ss-sub-mine-t"><b>' + esc(x.title) + '</b><i>' + esc([x.category, x.at].filter(Boolean).join('・')) + (st.hint ? '・' + esc(st.hint) : '') + '</i></div>' +
          '<span class="ss-sub-mine-st ' + st.cls + '">' + st.label + '</span>' +
          (canSee ? '<button type="button" class="ss-sub-chipbtn" data-see="' + esc(x.uid) + '">' + I.pin + '看</button>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="ss-sub-mine-empty">這個帳號還沒有投稿紀錄。投第一段吧！</p>') +
      '<p class="ss-sub-fine">想下架自己的作品，請寫信給管理者，或在作品卡片上按「原作者申請下架」。</p>';
    $('#ssSubMineBack', box).addEventListener('click', function () { box.hidden = true; form.hidden = false; });
    box.querySelectorAll('[data-see]').forEach(function (b) {
      b.addEventListener('click', function () {
        var uid = b.getAttribute('data-see');
        close();
        if (typeof window.focusMarkerOnMap === 'function') setTimeout(function () { window.focusMarkerOnMap(uid); }, 250);
      });
    });
  }

  // ------------------------------------------------------------ hook into the page
  function hook() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[onclick*="submitChoiceModal"]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      open();
    }, true);
    var wait = function (n) {
      if (typeof window.showSubmitPopup === 'function') {
        window.showSubmitPopup = function (latlng) { open({ latlng: latlng }); };
        return;
      }
      if (n < 200) setTimeout(function () { wait(n + 1); }, 100);
    };
    wait(0);

    // 資料載好後：放上「剛送出」的點、試著送出排隊的投稿
    var waitData = function (n) {
      if (window.map && window.allMarkersData && window.allMarkersData.length) { syncFresh(); return; }
      if (n < 600) setTimeout(function () { waitData(n + 1); }, 200);
    };
    waitData(0);
    setTimeout(function () { syncQueueBadge(); processQueue(); }, 4000);
    window.addEventListener('online', function () { setTimeout(processQueue, 1500); });
    var waitAuth = function (n) { if (fbAuth()) watchAuth(); else if (n < 100) setTimeout(function () { waitAuth(n + 1); }, 200); };
    waitAuth(0);

    window.ssSubmit = {
      open: open, close: close, mine: function () { open({ mine: true }); }, ready: backendReady, config: CONFIG,
      queue: processQueue, pending: function () { return idbAll('queue'); }, mine: function () { return readJSON(LS_MINE) || []; },
      _st: st, _prepare: prepareAudio
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook, { once: true });
  else hook();
})();
