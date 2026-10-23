/*
 * 聲景底圖：縮小或在臺灣以外時，用 OpenFreeMap 的向量地圖（免申請、免金鑰、全世界）；
 * 在臺灣放大後交回國土測繪中心的臺灣通用電子地圖。
 * 只在「臺灣通用電子地圖」為選取底圖、且不在圖資模式時生效。
 */
(function () {
  'use strict';

  var STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
  var NLSC_MIN_ZOOM = 13;

  var PALETTE = {
    background: '#f3f1ea',
    park: '#e1e8d8',
    wood: '#d9e2d0',
    residential: '#efece4',
    water: '#bdd8d5',
    waterway: '#a7cdc9',
    building: '#e5e0d4',
    buildingLine: '#d8d1c3',
    roadMinor: '#ffffff',
    roadCasing: '#ddd6c8',
    roadMajor: '#fffdf8',
    motorway: '#f6e3bd',
    motorwayCasing: '#e6cc98',
    rail: '#d3ccbe',
    boundary: '#b6ae9e',
    text: '#3a4749',
    textSoft: '#7a8483',
    halo: '#f7f5ef',
    waterText: '#3d7672'
  };

  var baseStyle = null;
  var glLayer = null;

  var LABEL = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name'], ['get', 'name_en']];

  function recolor(style) {
    var P = PALETTE;
    var fills = {
      background: { 'background-color': P.background },
      park: { 'fill-color': P.park },
      water: { 'fill-color': P.water },
      landuse_residential: { 'fill-color': P.residential },
      landcover_wood: { 'fill-color': P.wood },
      building: { 'fill-color': P.building, 'fill-outline-color': P.buildingLine },
      road_area_pier: { 'fill-color': P.background }
    };
    style.layers.forEach(function (l) {
      var id = l.id;
      var paint = l.paint = l.paint || {};
      if (fills[id]) Object.assign(paint, fills[id]);
      if (id === 'waterway') paint['line-color'] = P.waterway;
      if (id === 'road_pier') paint['line-color'] = P.background;
      if (/^highway_(path|minor)$/.test(id)) paint['line-color'] = P.roadMinor;
      if (/casing$/.test(id) && /highway_major|tunnel_motorway/.test(id)) paint['line-color'] = P.roadCasing;
      if (/^highway_major_(inner|subtle)$/.test(id)) paint['line-color'] = P.roadMajor;
      if (/^highway_motorway(_bridge)?_casing$/.test(id)) paint['line-color'] = P.motorwayCasing;
      if (/^highway_motorway(_bridge)?_inner$/.test(id) || id === 'highway_motorway_subtle') paint['line-color'] = P.motorway;
      if (/^railway/.test(id) && !/dashline/.test(id)) paint['line-color'] = P.rail;
      if (/^railway.*dashline$/.test(id)) paint['line-color'] = P.background;
      if (/^boundary/.test(id)) paint['line-color'] = P.boundary;
      if (l.type === 'raster') paint['raster-opacity'] = 0.25;

      if (l.type === 'symbol' && l.layout && l.layout['text-field'] && !/shield/.test(id)) {
        if (id !== 'highway-shield-non-us') l.layout['text-field'] = LABEL;
        paint['text-halo-color'] = P.halo;
        paint['text-halo-width'] = 1.4;
        paint['text-color'] = /^water/.test(id) ? P.waterText : (/^highway-name|waterway_line_label/.test(id) ? P.textSoft : P.text);
      }
    });
    return style;
  }

  function isTaiwanBase() {
    var r = document.querySelector('input[name="basemap"]:checked');
    return !r || r.value === 'taiwan';
  }

  function syncClasses(map) {
    var body = document.body;
    body.classList.toggle('ss-taiwan-base', isTaiwanBase());
    body.classList.toggle('ss-zoom-world', map.getZoom() < NLSC_MIN_ZOOM);
  }

  function tagLayers() {
    var tw = window.taiwanLayer && window.taiwanLayer.getContainer && window.taiwanLayer.getContainer();
    var osm = window.osmLayer && window.osmLayer.getContainer && window.osmLayer.getContainer();
    if (tw) tw.classList.add('ss-nlsc-tiles');
    if (osm) osm.classList.add('ss-osm-tiles');
  }

  // MapLibre 很重（約 800 KB、還要 WebGL 繪圖），只有縮小到全臺以上或看臺灣以外時才需要，
  // 所以等真的要用才下載；放大回臺灣就把它拿掉，不在背後白白繪圖。
  var GL_JS = 'https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js';
  var GL_CSS = 'https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css';
  var GL_LEAFLET = 'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js';
  var TAIWAN_VIEW = [21.7, 26.5, 118.0, 122.3];
  var glLoading = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('載入失敗：' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadGl() {
    if (window.L && L.maplibreGL) return Promise.resolve();
    if (glLoading) return glLoading;
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = GL_CSS;
    document.head.appendChild(css);
    glLoading = (window.maplibregl ? Promise.resolve() : loadScript(GL_JS)).then(function () { return loadScript(GL_LEAFLET); });
    glLoading.catch(function () { glLoading = null; });
    return glLoading;
  }

  function needWorld(map) {
    if (!isTaiwanBase() || document.body.classList.contains('haidian-v4-mode-data')) return false;
    if (map.getZoom() < NLSC_MIN_ZOOM) return true;
    var c = map.getCenter();
    return !(c.lat >= TAIWAN_VIEW[0] && c.lat <= TAIWAN_VIEW[1] && c.lng >= TAIWAN_VIEW[2] && c.lng <= TAIWAN_VIEW[3]);
  }

  function addGl(map) {
    if (glLayer) {
      if (!map.hasLayer(glLayer)) { glLayer.options.style = recolor(JSON.parse(JSON.stringify(baseStyle))); glLayer.addTo(map); }
      styleGl();
      return Promise.resolve();
    }
    return loadGl().then(function () {
      return baseStyle ? baseStyle : fetch(STYLE_URL).then(function (r) { return r.json(); });
    }).then(function (style) {
      baseStyle = style;
      if (glLayer) return;
      glLayer = L.maplibreGL({
        style: recolor(JSON.parse(JSON.stringify(style))),
        attributionControl: false,
        interactive: false
      });
      if (needWorld(map)) glLayer.addTo(map);
      styleGl();
      map.attributionControl && map.attributionControl.addAttribution('&copy; <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>');
    }).catch(function (e) { console.warn('聲景底圖載入失敗，維持原底圖', e); });
  }
  function styleGl() {
    var c = glLayer && glLayer.getContainer && glLayer.getContainer();
    if (c) { c.classList.add('ss-world-base'); c.style.zIndex = '0'; }
  }

  function syncGl(map) {
    if (needWorld(map)) addGl(map);
    else if (glLayer && map.hasLayer(glLayer)) map.removeLayer(glLayer);
  }

  function start(map) {
    if (!window.L || map.__ssWorldBase) return;
    map.__ssWorldBase = true;
    [window.taiwanLayer, window.osmLayer].forEach(function (l) { if (l) l.on('add', tagLayers); });
    tagLayers();
    map.on('zoomend moveend', function () { syncClasses(map); syncGl(map); });
    document.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'basemap') { tagLayers(); syncClasses(map); syncGl(map); }
    });
    syncClasses(map);
    syncGl(map);
  }

  (function wait(n) {
    if (window.map && window.L) return start(window.map);
    if (n > 200) return;
    setTimeout(function () { wait(n + 1); }, 100);
  })(0);
})();
