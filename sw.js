/*
 * 海佃溪遊記 離線快取
 * - 首頁：先走網路，斷線時用上次的版本。
 * - 自家檔案、CDN 函式庫：先給快取、背景更新。
 * - 地圖圖磚、照片：先給快取（有上限）。
 * - 聲音：頁面把整段存進 ss-audio-v1，這裡負責把 Range 請求切成 206 回應。
 * - 資料庫 JSON：先走網路，成功就備份，斷線時用備份。
 * 想停用：把 DISABLED 改成 true 重新部署，所有人的快取會自動清掉並解除註冊。
 */
var VERSION = "20261023.11";
var DISABLED = false;
var SHELL = 'ss-shell-' + VERSION;
var CDN = 'ss-cdn-' + VERSION;
var TILES = 'ss-tiles-v1';
var MEDIA = 'ss-media-v1';
var AUDIO = 'ss-audio-v1';
var DATA = 'ss-data-v1';
var KEEP = [SHELL, CDN, TILES, MEDIA, AUDIO, DATA];
var TILE_HOSTS = ['wmts.nlsc.gov.tw', 'tiles.openfreemap.org', 'tile.openstreetmap.org', 'server.arcgisonline.com'];
var CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
var MEDIA_HOSTS = ['res.cloudinary.com'];
var DATA_HOST = 'firebasedatabase.app';
var TILE_MAX = 900;
var MEDIA_MAX = 200;

self.addEventListener('install', function (e) {
  self.skipWaiting();
  if (DISABLED) return;
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(['./', './index.html', './manifest.webmanifest', './src/pwa/icon-192.png'].map(function (u) {
      return c.add(u).catch(function () {});
    }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil((function () {
    if (DISABLED) {
      return caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
        .then(function () { return self.registration.unregister(); })
        .then(function () { return self.clients.matchAll(); })
        .then(function (cs) { cs.forEach(function (c) { c.navigate(c.url); }); });
    }
    return caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('ss-') === 0 && KEEP.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); });
  })());
});

function hostIn(url, list) {
  return list.some(function (h) { return url.hostname === h || url.hostname.endsWith('.' + h); });
}

function withTimeout(p, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

function trim(cacheName, max) {
  return caches.open(cacheName).then(function (c) {
    return c.keys().then(function (keys) {
      if (keys.length <= max) return;
      return Promise.all(keys.slice(0, keys.length - max).map(function (k) { return c.delete(k); }));
    });
  }).catch(function () {});
}

function navigate(req) {
  return withTimeout(fetch(req), 6000).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(SHELL).then(function (c) { c.put('./index.html', copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) { return r || caches.match('./index.html'); }).then(function (r) {
      return r || new Response('<!doctype html><meta charset="utf-8"><title>離線</title><p style="font-family:sans-serif;padding:40px">目前沒有網路，也還沒存下這個網站。連上網後再打開一次就可以離線使用。</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    });
  });
}

function staleWhileRevalidate(cacheName, req) {
  return caches.open(cacheName).then(function (c) {
    return c.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    });
  });
}

function cacheFirst(cacheName, req, max) {
  return caches.open(cacheName).then(function (c) {
    return c.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          c.put(req, res.clone()).then(function () { if (max) trim(cacheName, max); });
        }
        return res;
      });
    });
  });
}

function dataFirst(req, url) {
  var key = url.origin + url.pathname;
  return caches.open(DATA).then(function (c) {
    return fetch(req).then(function (res) {
      if (res && res.ok) c.put(key, res.clone());
      return res;
    }).catch(function () {
      return c.match(key).then(function (r) { if (r) return r; throw new Error('offline'); });
    });
  });
}

function partial(full, rangeHeader) {
  return full.blob().then(function (blob) {
    var size = blob.size;
    var m = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
    var start = 0, end = size - 1;
    if (m) {
      if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - parseInt(m[2], 10)); }
      else {
        if (m[1] !== '') start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
      }
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    }
    var part = blob.slice(start, end + 1);
    var h = new Headers();
    var type = full.headers.get('Content-Type');
    if (type) h.set('Content-Type', type);
    h.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
    h.set('Content-Length', String(part.size));
    h.set('Accept-Ranges', 'bytes');
    return new Response(part, { status: 206, statusText: 'Partial Content', headers: h });
  });
}

function media(req) {
  var range = req.headers.get('range');
  return caches.open(AUDIO).then(function (c) {
    return c.match(req.url).then(function (full) {
      if (full && full.type !== 'opaque') {
        if (range) return partial(full, range);
        return full;
      }
      if (range) return fetch(req);
      return cacheFirst(MEDIA, req, MEDIA_MAX);
    });
  });
}

self.addEventListener('fetch', function (e) {
  if (DISABLED) return;
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (req.mode === 'navigate') { e.respondWith(navigate(req)); return; }
  if (url.origin === self.location.origin) { e.respondWith(staleWhileRevalidate(SHELL, req)); return; }
  if (url.hostname.endsWith(DATA_HOST)) { e.respondWith(dataFirst(req, url)); return; }
  if (hostIn(url, TILE_HOSTS)) { e.respondWith(cacheFirst(TILES, req, TILE_MAX)); return; }
  if (hostIn(url, MEDIA_HOSTS)) { e.respondWith(media(req)); return; }
  if (hostIn(url, CDN_HOSTS)) { e.respondWith(staleWhileRevalidate(CDN, req)); return; }
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'ss-skip-waiting') self.skipWaiting();
});
