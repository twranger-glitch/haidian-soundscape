/*
 * Haidian Soundscape — ShadeMap × Meta CHMv2 live integration
 *
 * Research modes:
 *   full      = live Meta CHMv2 canopy surface + buildings
 *   trees     = live Meta CHMv2 canopy surface, no buildings
 *   buildings = bare-earth DEM + buildings
 *
 * ShadeMap SDK handles shadow computation.
 * Buildings are supplied through getFeatures().
 */
(function () {
  "use strict";

  const DEFAULTS = {
    apiKey: "",
    // live-cog = stream the real Meta CHMv2 COG and build temporary Terrarium tiles in-browser.
    // xyz/static = use pre-generated Terrarium surface XYZ tiles (local or remote URL).
    metaMode: "live-cog",
    metaTileUrl: "./meta-dsm/{z}/{x}/{y}.png",
    metaCogBaseUrl: "https://data.source.coop/tge-labs/meta-chm-v2/chm",
    geotiffUrl: "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.min.js",
    metaMinZoom: 14,
    // z17 aligns with CHMv2's native ~1.19 m Web-Mercator pixels.
    // The bare-earth DEM is overzoomed above its z15 maximum; canopy stays native.
    metaMaxZoom: 17,
    metaTileBuffer: 0,
    metaTileConcurrency: 6,
    metaMaxPreparedTiles: 180,
    metaMaxCachedTiles: 480,
    metaBlendBareTerrain: true,
    metaNoDataFallback: "bare-dem",
    queryCanopyFromCog: true,
    queryZoom: 17,
    canopyCacheTiles: 256,

    bareTerrainTileUrl:
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    bareTerrainMaxZoom: 15,

    buildingMode: "osm",
    buildingGeoJSONUrl: "",
    buildingMinZoom: 15,
    overpassUrl: "https://overpass-api.de/api/interpreter",
    defaultBuildingHeight: 3.1,
    defaultStoreyHeight: 3.1,

    defaultResearchMode: "full",
    defaultOpacity: 0.36,
    defaultColor: "#172554",
    queryOnClick: false,
    canopyOverlayDefault: true,
    canopyOverlayMinHeight: 2,
    canopyOverlayOpacity: 0.28,

    sdkUrl:
      "https://unpkg.com/leaflet-shadow-simulator@0.67.0/dist/leaflet-shadow-simulator.umd.min.js",

    officialShadeMapBase: "https://shademap.app/",
    defaultCenter: [23.00512, 120.23052],

    getMap: null
  };

  const config = Object.assign(
    {},
    DEFAULTS,
    window.HAIDIAN_SHADEMAP_CONFIG || {}
  );

  const state = {
    enabled: false,
    mode: ["full", "trees", "buildings"].includes(config.defaultResearchMode)
      ? config.defaultResearchMode
      : "full",
    date: new Date(),
    opacity: config.defaultOpacity,
    queryOnClick: config.queryOnClick === true,
    canopyOverlay: config.canopyOverlayDefault !== false
  };

  let mapRef = null;
  let shadeLayer = null;
  let shadeReady = false;
  let enginePromise = null;
  let customBuildingsCache = null;
  let geoTiffPromise = null;
  let liveMoveTimer = null;
  let mapMoveHooked = false;
  let mapQueryHooked = false;
  let canopyOverlayLayer = null;
  let queryPopup = null;
  let lastMapDragAt = 0;
  let lastLiveViewSignature = null;
  const overpassCache = new Map();
  const metaCogCache = new Map();
  const metaSurfaceUrls = new Map();
  const metaSurfacePromises = new Map();
  const metaSurfaceMeta = new Map();
  const demBitmapCache = new Map();
  const canopyRasterCache = new Map();
  const canopyRasterPromises = new Map();

  function resolveMap() {
    if (typeof config.getMap === "function") {
      try {
        const m = config.getMap();
        if (m && typeof m.getCenter === "function") return m;
      } catch (_) {}
    }
    if (window.map && typeof window.map.getCenter === "function") {
      return window.map;
    }
    return null;
  }

  function injectStyles() {
    if (document.getElementById("haidian-shade-style")) return;

    const style = document.createElement("style");
    style.id = "haidian-shade-style";
    style.textContent = `
      .haidian-shade-section{
        margin-top:12px;padding-top:12px;
        border-top:1px solid rgba(148,163,184,.3)
      }
      .haidian-shade-title{
        display:flex;align-items:center;gap:6px;flex-wrap:wrap;
        margin-bottom:8px;color:#075985;font-size:11px;font-weight:900
      }
      .haidian-shade-card{
        box-sizing:border-box;padding:10px;border:1px solid #bae6fd;
        border-radius:12px;background:linear-gradient(180deg,#f0fdfa,#f8fafc)
      }
      .haidian-shade-row{
        display:flex;align-items:center;gap:8px;margin:8px 0;
        color:#334155;font-size:12px;font-weight:700
      }
      .haidian-shade-row input[type="range"]{
        width:100%;accent-color:#0f766e
      }
      .haidian-shade-select,.haidian-shade-date{
        width:100%;box-sizing:border-box;padding:7px 8px;
        border:1px solid #99f6e4;border-radius:8px;background:#fff;
        color:#334155;font-size:12px
      }
      .haidian-shade-time{
        min-width:52px;text-align:right;color:#0f766e;
        font-weight:900;font-variant-numeric:tabular-nums
      }
      .haidian-shade-status,.haidian-shade-source{
        margin-top:8px;padding:7px 8px;border-radius:8px;
        font-size:10px;line-height:1.5
      }
      .haidian-shade-status{
        border:1px solid #ccfbf1;background:#fff;color:#64748b
      }
      .haidian-shade-source{
        border:1px solid #e2e8f0;background:#f8fafc;color:#475569
      }
      .haidian-shade-warning{
        border-color:#fcd34d!important;background:#f8fafc!important;
        color:#92400e!important
      }
      .haidian-shade-actions{display:flex;gap:7px;margin-top:9px}
      .haidian-shade-btn{
        flex:1;padding:8px 9px;border:0;border-radius:8px;
        background:#0f766e;color:#fff;font-size:11px;font-weight:900;
        cursor:pointer
      }
      .haidian-shade-btn.secondary{
        border:1px solid #99f6e4;background:#fff;color:#0f766e
      }
      .haidian-shade-badge{
        display:inline-block;padding:2px 5px;border-radius:999px;
        background:#ecfdf5;color:#047857;font-size:9px;font-weight:900
      }
      .haidian-shade-note{
        margin-top:8px;color:#78716c;font-size:9.5px;line-height:1.55
      }
      .haidian-shade-legend{
        display:flex;gap:12px;align-items:center;flex-wrap:wrap;
        margin-top:8px;color:#475569;font-size:9.5px
      }
      .haidian-shade-swatch{
        display:inline-block;width:11px;height:11px;border-radius:3px;
        margin-right:4px;vertical-align:-2px
      }
      .leaflet-tooltip.haidian-shade-query-tooltip{
        white-space:normal!important;max-width:330px;padding:10px 12px!important;
        background:rgba(255,255,255,.97)!important;border:1px solid #99f6e4!important;
        border-radius:12px!important;box-shadow:0 10px 28px rgba(15,23,42,.18)!important;
        color:#0f172a!important
      }
      .leaflet-tooltip.haidian-shade-query-tooltip:before{display:none!important}
      .haidian-shade-query-popup{min-width:238px;line-height:1.45}
      .haidian-shade-query-popup .hsq-title{
        margin-bottom:6px;font-weight:900;color:#0f766e;font-size:13px
      }
      .haidian-shade-query-popup .hsq-grid{
        display:grid;grid-template-columns:auto 1fr;gap:3px 9px;font-size:11px
      }
      .haidian-shade-query-popup .hsq-label{color:#64748b}
      .haidian-shade-query-popup .hsq-value{color:#0f172a;font-weight:800}
      .haidian-shade-query-popup .hsq-foot{
        margin-top:7px;padding-top:6px;border-top:1px solid #e2e8f0;
        color:#78716c;font-size:9px
      }
      @media (max-width:600px){
        .haidian-shade-card{padding:9px}
      }
    `;
    document.head.appendChild(style);
  }

  function getTargetContainer() {
    // Current haidian-soundscape structure (2026-09-11) first,
    // then conservative fallbacks for future markup changes.
    return (
      document.querySelector("#rightToolsMenu > .custom-layer-control") ||
      document.querySelector("#rightToolsWrapper .custom-layer-control") ||
      document.querySelector("#rightToolsWrapper .tools-menu-container") ||
      document.getElementById("rightToolsWrapper")
    );
  }

  function modeLabel(mode) {
    return {
      full: "完整：樹木＋建築",
      trees: "只看樹木",
      buildings: "只看建築"
    }[mode] || mode;
  }

  function buildingSourceLabel() {
    if (config.buildingMode === "custom") return "自訂 GeoJSON";
    if (config.buildingMode === "none") return "未載入";
    return "OpenStreetMap / Overpass";
  }

  function terrainSourceLabel() {
    if (["xyz", "static"].includes(config.metaMode)) {
      return "Meta CHMv2 衍生 XYZ surface tiles";
    }
    return "Meta / WRI CHMv2（live COG）";
  }

  function formatDateInput(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function minutesOfDay(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  function updateTimeLabel() {
    const el = document.getElementById("haidianShadeTimeLabel");
    if (!el) return;
    el.textContent =
      `${String(state.date.getHours()).padStart(2, "0")}:` +
      `${String(state.date.getMinutes()).padStart(2, "0")}`;
  }

  function setStatus(text, warning) {
    const el = document.getElementById("haidianShadeStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("haidian-shade-warning", !!warning);
  }

  function syncDateFromControls() {
    const dateEl = document.getElementById("haidianShadeDate");
    const timeEl = document.getElementById("haidianShadeTime");
    if (!dateEl || !timeEl) return;

    const p = dateEl.value.split("-").map(Number);
    const minutes = Number(timeEl.value);
    if (p.length !== 3 || p.some(Number.isNaN) || Number.isNaN(minutes)) return;

    state.date = new Date(
      p[0],
      p[1] - 1,
      p[2],
      Math.floor(minutes / 60),
      minutes % 60,
      0,
      0
    );
    updateTimeLabel();
    if (shadeLayer && typeof shadeLayer.setDate === "function") {
      shadeLayer.setDate(state.date);
    }
  }

  function injectPanel() {
    if (document.getElementById("haidianShadeSection")) return true;

    const target = getTargetContainer();
    if (!target) return false;

    const section = document.createElement("section");
    section.id = "haidianShadeSection";
    section.className = "haidian-shade-section";
    section.innerHTML = `
      <div class="haidian-shade-title">
        ☀️ 日照與樹蔭模擬
        <span class="haidian-shade-badge">ShadeMap × Meta CHMv2</span>
        <span class="haidian-shade-badge">全球動態載入</span>
      </div>

      <div class="haidian-shade-card">
        <label class="haidian-shade-row" style="cursor:pointer">
          <input id="haidianShadeToggle" type="checkbox"
            style="width:17px;height:17px;margin:0;accent-color:#0f766e">
          <span>顯示即時陰影</span>
        </label>

        <div class="haidian-shade-row" style="display:block">
          <div style="margin-bottom:5px">研究模式</div>
          <select id="haidianShadeMode" class="haidian-shade-select">
            <option value="full">完整：樹木＋建築</option>
            <option value="trees">只看樹木</option>
            <option value="buildings">只看建築</option>
          </select>
        </div>

        <div class="haidian-shade-row" style="display:block">
          <div style="margin-bottom:5px">日期</div>
          <input id="haidianShadeDate" class="haidian-shade-date" type="date">
        </div>

        <div class="haidian-shade-row">
          <div style="min-width:28px">時間</div>
          <input id="haidianShadeTime" type="range"
            min="300" max="1140" step="10">
          <span id="haidianShadeTimeLabel" class="haidian-shade-time"></span>
        </div>

        <div class="haidian-shade-row">
          <div style="min-width:42px">透明度</div>
          <input id="haidianShadeOpacity" type="range"
            min="0.15" max="0.70" step="0.05" value="${state.opacity}">
        </div>

        <label class="haidian-shade-row" style="cursor:pointer">
          <input id="haidianShadeCanopyOverlay" type="checkbox"
            style="width:15px;height:15px;margin:0;accent-color:#059669">
          <span>顯示樹冠範圍（綠色）</span>
        </label>

        <label class="haidian-shade-row" style="cursor:pointer">
          <input id="haidianShadeQueryToggle" type="checkbox"
            style="width:15px;height:15px;margin:0;accent-color:#0f766e">
          <span>點擊地圖查詢樹高／陰影</span>
        </label>

        <div class="haidian-shade-legend">
          <span><i class="haidian-shade-swatch" style="background:rgba(16,185,129,.55)"></i>樹冠範圍</span>
          <span><i class="haidian-shade-swatch" style="background:${config.defaultColor};opacity:${Math.max(.35, state.opacity)}"></i>模擬陰影</span>
        </div>

        <div id="haidianShadeStatus" class="haidian-shade-status">
          尚未啟用陰影模擬。
        </div>

        <div class="haidian-shade-source">
          <b>陰影：</b>ShadeMap Leaflet SDK<br>
          <b>樹冠：</b>${terrainSourceLabel()}<br>
          <b>建築：</b>${buildingSourceLabel()}
        </div>

        <div class="haidian-shade-actions">
          <button id="haidianShadeNow" class="haidian-shade-btn" type="button">
            現在時間
          </button>
          <button id="haidianShadeOfficial"
            class="haidian-shade-btn secondary" type="button">
            官方 ShadeMap ↗
          </button>
        </div>

        <div class="haidian-shade-note">
          Meta CHMv2 為 world-scale 樹冠高度模型；移動到其他城市後會依目前視野自動載入當地資料。
          高解析樹蔭建議在 z14–17 判讀；無資料處會回退裸地 DEM。建築高度可能來自 OSM 或預設值，
          適合環境教育與空間比較，不取代現地測量。
        </div>
      </div>
    `;

    target.appendChild(section);

    const dateEl = document.getElementById("haidianShadeDate");
    const timeEl = document.getElementById("haidianShadeTime");
    const modeEl = document.getElementById("haidianShadeMode");

    dateEl.value = formatDateInput(state.date);
    timeEl.value = Math.min(1140, Math.max(300, minutesOfDay(state.date)));
    modeEl.value = state.mode;
    document.getElementById("haidianShadeCanopyOverlay").checked = state.canopyOverlay;
    document.getElementById("haidianShadeQueryToggle").checked = state.queryOnClick;
    updateTimeLabel();

    if (!config.apiKey || config.apiKey === "YOUR_SHADEMAP_API_KEY") {
      setStatus("尚未設定 ShadeMap API key；介面已整合，但陰影引擎尚不能啟動。", true);
    }

    document
      .getElementById("haidianShadeToggle")
      .addEventListener("change", async (event) => {
        if (event.target.checked) {
          await enableShade();
        } else {
          disableShade();
        }
      });

    modeEl.addEventListener("change", async () => {
      state.mode = modeEl.value;
      if (state.enabled) await rebuildShade();
    });

    dateEl.addEventListener("change", syncDateFromControls);

    timeEl.addEventListener("input", () => {
      const minutes = Number(timeEl.value);
      state.date.setHours(
        Math.floor(minutes / 60),
        minutes % 60,
        0,
        0
      );
      updateTimeLabel();
      if (shadeLayer && typeof shadeLayer.setDate === "function") {
        shadeLayer.setDate(state.date);
      }
    });

    document
      .getElementById("haidianShadeOpacity")
      .addEventListener("input", (event) => {
        state.opacity = Number(event.target.value);
        if (shadeLayer && typeof shadeLayer.setOpacity === "function") {
          shadeLayer.setOpacity(state.opacity);
        }
      });

    document
      .getElementById("haidianShadeCanopyOverlay")
      .addEventListener("change", (event) => {
        state.canopyOverlay = !!event.target.checked;
        syncCanopyOverlay();
      });

    document
      .getElementById("haidianShadeQueryToggle")
      .addEventListener("change", (event) => {
        state.queryOnClick = !!event.target.checked;
        if (!state.queryOnClick && queryPopup && mapRef) {
          try {
            if (mapRef.hasLayer(queryPopup)) mapRef.removeLayer(queryPopup);
          } catch (_) {}
          queryPopup = null;
        }
      });

    document
      .getElementById("haidianShadeNow")
      .addEventListener("click", () => {
        state.date = new Date();
        dateEl.value = formatDateInput(state.date);
        timeEl.value = Math.min(
          1140,
          Math.max(300, minutesOfDay(state.date))
        );
        updateTimeLabel();
        if (shadeLayer && typeof shadeLayer.setDate === "function") {
          shadeLayer.setDate(state.date);
        }
      });

    document
      .getElementById("haidianShadeOfficial")
      .addEventListener("click", () => {
        const center = mapRef
          ? mapRef.getCenter()
          : { lat: config.defaultCenter[0], lng: config.defaultCenter[1] };
        const zoom = mapRef
          ? Math.max(12, Math.min(19, mapRef.getZoom()))
          : 16;
        const base = config.officialShadeMapBase.replace(/\/+$/, "");
        const url =
          `${base}/@${center.lat.toFixed(5)},${center.lng.toFixed(5)},` +
          `${zoom}z,${state.date.getTime()}t,0b,0p,0m`;
        window.open(url, "_blank", "noopener,noreferrer");
      });

    return true;
  }

  function loadScript(src, readyTest) {
    return new Promise((resolve, reject) => {
      if (typeof readyTest === "function" && readyTest()) {
        resolve();
        return;
      }

      const existing = Array.from(document.scripts).find(
        (script) => script.src === src
      );

      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error(`無法載入外部模組：${src}`)),
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error(`無法載入外部模組：${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureEngine() {
    if (window.L && typeof L.shadeMap === "function") return;
    if (enginePromise) return enginePromise;

    enginePromise = (async () => {
      if (!window.L) {
        throw new Error("找不到 Leaflet。請確認主地圖已載入。");
      }
      await loadScript(
        config.sdkUrl,
        () => window.L && typeof L.shadeMap === "function"
      );
      if (typeof L.shadeMap !== "function") {
        throw new Error("ShadeMap Leaflet SDK 載入後仍找不到 L.shadeMap。");
      }
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });

    return enginePromise;
  }

  function fillTemplate(template, x, y, z) {
    return template
      .replace("{x}", x)
      .replace("{y}", y)
      .replace("{z}", z);
  }


  async function ensureGeoTIFF() {
    if (window.GeoTIFF && typeof window.GeoTIFF.fromUrl === "function") return;
    if (geoTiffPromise) return geoTiffPromise;

    geoTiffPromise = (async () => {
      await loadScript(
        config.geotiffUrl,
        () => window.GeoTIFF && typeof window.GeoTIFF.fromUrl === "function"
      );
      if (!window.GeoTIFF || typeof window.GeoTIFF.fromUrl !== "function") {
        throw new Error("GeoTIFF.js 載入失敗，無法讀取 Meta CHMv2 COG。");
      }
    })().catch((error) => {
      geoTiffPromise = null;
      throw error;
    });

    return geoTiffPromise;
  }

  function tileToQuadkey(x, y, z) {
    let qk = "";
    for (let i = z; i > 0; i -= 1) {
      let digit = 0;
      const mask = 1 << (i - 1);
      if (x & mask) digit += 1;
      if (y & mask) digit += 2;
      qk += digit;
    }
    return qk;
  }

  function tileKey(x, y, z) {
    return `${z}/${x}/${y}`;
  }

  async function openMetaCog(url) {
    let promise = metaCogCache.get(url);
    if (!promise) {
      promise = (async () => {
        const tiff = await window.GeoTIFF.fromUrl(url);
        const count = await tiff.getImageCount();
        const levels = [];
        const images = {};

        for (let i = 0; i < count; i += 1) {
          const image = await tiff.getImage(i);
          images[i] = image;
          if (image.fileDirectory.PhotometricInterpretation !== 4) {
            levels.push({ idx: i, width: image.getWidth() });
          }
        }

        levels.sort((a, b) => b.width - a.width);
        if (!levels.length) throw new Error("Meta COG 沒有可讀取的 raster overview。");
        return { tiff, levels, images };
      })();
      metaCogCache.set(url, promise);
    }
    return promise;
  }

  async function readMetaCanopyTile(x, y, z) {
    if (z < 10) return null;

    const key = tileKey(x, y, z);
    if (canopyRasterCache.has(key)) return canopyRasterCache.get(key);
    if (canopyRasterPromises.has(key)) return canopyRasterPromises.get(key);

    const promise = (async () => {
      const scaleFromZ10 = 1 << (z - 10);
      const parentX = Math.floor(x / scaleFromZ10);
      const parentY = Math.floor(y / scaleFromZ10);
      const quadkey = tileToQuadkey(parentX, parentY, 10);
      const url = `${config.metaCogBaseUrl.replace(/\/+$/, "")}/${quadkey}.tif`;

      let cog;
      try {
        cog = await openMetaCog(url);
      } catch (error) {
        console.warn("[Haidian Shade] Meta COG open failed:", url, error);
        return null;
      }

      // CHMv2 native z10 tiles are 32768 px wide with internal overviews.
      // Taylor Geospatial's reference viewer uses overview index (17-z), which
      // makes each requested XYZ tile line up with a 256×256 source window.
      const targetLevel = 17 - z;
      const level = cog.levels[
        Math.min(Math.max(targetLevel, 0), cog.levels.length - 1)
      ];
      const side = level.width / scaleFromZ10;
      const px = (x % scaleFromZ10) * side;
      const py = (y % scaleFromZ10) * side;

      try {
        const bands = await cog.images[level.idx].readRasters({
          window: [
            Math.round(px),
            Math.round(py),
            Math.round(px + side),
            Math.round(py + side)
          ],
          width: 256,
          height: 256,
          resampleMethod: "nearest",
          fillValue: 0
        });
        const raster = bands[0];
        canopyRasterCache.set(key, raster);
        const maxCached = Math.max(32, Number(config.canopyCacheTiles) || 256);
        while (canopyRasterCache.size > maxCached) {
          canopyRasterCache.delete(canopyRasterCache.keys().next().value);
        }
        return raster;
      } catch (error) {
        console.warn("[Haidian Shade] Meta COG window failed:", quadkey, error);
        return null;
      }
    })().finally(() => canopyRasterPromises.delete(key));

    canopyRasterPromises.set(key, promise);
    return promise;
  }

  async function getDemBitmap(x, y, z) {
    const key = tileKey(x, y, z);
    let promise = demBitmapCache.get(key);
    if (!promise) {
      promise = (async () => {
        const url = fillTemplate(config.bareTerrainTileUrl, x, y, z);
        const response = await fetch(url, { mode: "cors", cache: "force-cache" });
        if (!response.ok) throw new Error(`DEM HTTP ${response.status}`);
        return createImageBitmap(await response.blob());
      })();
      demBitmapCache.set(key, promise);
      if (demBitmapCache.size > 80) {
        demBitmapCache.delete(demBitmapCache.keys().next().value);
      }
    }
    return promise;
  }

  async function readBareTerrainHeights(x, y, z) {
    if (!config.metaBlendBareTerrain) return null;

    const demZ = Math.min(z, config.bareTerrainMaxZoom);
    const factor = 1 << (z - demZ);
    const parentX = Math.floor(x / factor);
    const parentY = Math.floor(y / factor);

    try {
      const bitmap = await getDemBitmap(parentX, parentY, demZ);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;

      const crop = 256 / factor;
      const sx = (x % factor) * crop;
      const sy = (y % factor) * crop;
      ctx.drawImage(bitmap, sx, sy, crop, crop, 0, 0, 256, 256);

      const rgba = ctx.getImageData(0, 0, 256, 256).data;
      const heights = new Float32Array(256 * 256);
      for (let i = 0, p = 0; i < heights.length; i += 1, p += 4) {
        heights[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768;
      }
      return heights;
    } catch (error) {
      console.warn("[Haidian Shade] bare DEM merge skipped:", error);
      return null;
    }
  }

  function terrariumEncodeInto(imageData, index, height) {
    const h = Math.max(-32768, Math.min(32767.996, Number.isFinite(height) ? height : 0));
    const value = h + 32768;
    const r = Math.floor(value / 256);
    const gFloat = value - r * 256;
    const g = Math.floor(gFloat);
    const b = Math.max(0, Math.min(255, Math.round((gFloat - g) * 256)));
    const p = index * 4;
    imageData[p] = r;
    imageData[p + 1] = g;
    imageData[p + 2] = b;
    imageData[p + 3] = 255;
  }

  function canvasToBlobUrl(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("瀏覽器無法建立 Meta surface PNG。"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, "image/png");
    });
  }

  async function buildLiveSurfaceTile(x, y, z) {
    const key = tileKey(x, y, z);
    if (metaSurfaceUrls.has(key)) return metaSurfaceUrls.get(key);
    if (metaSurfacePromises.has(key)) return metaSurfacePromises.get(key);

    const promise = (async () => {
      const canopy = await readMetaCanopyTile(x, y, z);
      const dem = await readBareTerrainHeights(x, y, z);
      // CHMv2 is world-scale, but individual locations can be absent/no-data.
      // Keep terrain/building shadows alive with bare DEM instead of failing.
      if (!canopy && !dem) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const image = ctx.createImageData(256, 256);

      const length = 256 * 256;
      for (let i = 0; i < length; i += 1) {
        const raw = canopy ? canopy[i] : 0;
        const chm = raw > 0 && raw < 255 ? raw : 0;
        const ground = dem ? dem[i] : 0;
        terrariumEncodeInto(image.data, i, ground + chm);
      }

      ctx.putImageData(image, 0, 0);
      const url = await canvasToBlobUrl(canvas);
      metaSurfaceUrls.set(key, url);
      metaSurfaceMeta.set(key, { hasCanopy: !!canopy });
      const maxCached = Math.max(64, Number(config.metaMaxCachedTiles) || 480);
      while (metaSurfaceUrls.size > maxCached) {
        const oldestKey = metaSurfaceUrls.keys().next().value;
        const oldestUrl = metaSurfaceUrls.get(oldestKey);
        metaSurfaceUrls.delete(oldestKey);
        metaSurfaceMeta.delete(oldestKey);
        if (oldestUrl) URL.revokeObjectURL(oldestUrl);
      }
      return url;
    })().finally(() => metaSurfacePromises.delete(key));

    metaSurfacePromises.set(key, promise);
    return promise;
  }


  function removeCanopyOverlay() {
    if (!canopyOverlayLayer || !mapRef) return;
    try {
      if (mapRef.hasLayer(canopyOverlayLayer)) {
        mapRef.removeLayer(canopyOverlayLayer);
      }
    } catch (_) {}
  }

  function createCanopyOverlayLayer() {
    if (!window.L || !L.GridLayer) return null;

    const CanopyGrid = L.GridLayer.extend({
      createTile(coords, done) {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        canvas.setAttribute("aria-hidden", "true");

        (async () => {
          if (coords.z < config.metaMinZoom || coords.z > config.metaMaxZoom) {
            done(null, canvas);
            return;
          }

          try {
            await ensureGeoTIFF();
            const canopy = await readMetaCanopyTile(coords.x, coords.y, coords.z);
            if (!canopy) {
              done(null, canvas);
              return;
            }

            const ctx = canvas.getContext("2d");
            const image = ctx.createImageData(256, 256);
            const minHeight = Math.max(0, Number(config.canopyOverlayMinHeight) || 2);

            for (let i = 0; i < canopy.length; i += 1) {
              const h = canopy[i] > 0 && canopy[i] < 255 ? canopy[i] : 0;
              if (h < minHeight) continue;
              const p = i * 4;
              image.data[p] = 16;
              image.data[p + 1] = 185;
              image.data[p + 2] = 129;
              image.data[p + 3] = Math.round(145 + Math.min(h, 30) / 30 * 90);
            }

            ctx.putImageData(image, 0, 0);
            done(null, canvas);
          } catch (error) {
            console.warn("[Haidian Shade] canopy overlay tile:", error);
            done(null, canvas);
          }
        })();

        return canvas;
      }
    });

    return new CanopyGrid({
      tileSize: 256,
      minZoom: config.metaMinZoom,
      maxZoom: config.metaMaxZoom,
      opacity: Number(config.canopyOverlayOpacity) || 0.28,
      zIndex: 650,
      updateWhenIdle: true,
      keepBuffer: 1,
      noWrap: true
    });
  }

  function syncCanopyOverlay() {
    if (!mapRef) return;
    const shouldShow = state.enabled && state.canopyOverlay && state.mode !== "buildings";

    if (!shouldShow) {
      removeCanopyOverlay();
      return;
    }

    if (!canopyOverlayLayer) canopyOverlayLayer = createCanopyOverlayLayer();
    if (!canopyOverlayLayer) return;

    try {
      if (!mapRef.hasLayer(canopyOverlayLayer)) canopyOverlayLayer.addTo(mapRef);
      if (typeof canopyOverlayLayer.bringToFront === "function") {
        canopyOverlayLayer.bringToFront();
      }
    } catch (error) {
      console.warn("[Haidian Shade] canopy overlay:", error);
    }
  }

  function latLngToTilePixel(lat, lon, z) {
    const n = 2 ** z;
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const xf = ((lon + 180) / 360) * n;
    const latRad = safeLat * Math.PI / 180;
    const yf = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
    const x = Math.max(0, Math.min(n - 1, Math.floor(xf)));
    const y = Math.max(0, Math.min(n - 1, Math.floor(yf)));
    const px = Math.max(0, Math.min(255, Math.floor((xf - Math.floor(xf)) * 256)));
    const py = Math.max(0, Math.min(255, Math.floor((yf - Math.floor(yf)) * 256)));
    return { x, y, z, px, py, index: py * 256 + px };
  }

  function pointInRing(lng, lat, ring) {
    let inside = false;
    if (!Array.isArray(ring)) return false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i] && ring[i][0]);
      const yi = Number(ring[i] && ring[i][1]);
      const xj = Number(ring[j] && ring[j][0]);
      const yj = Number(ring[j] && ring[j][1]);
      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
      const intersects = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonFeature(lng, lat, feature) {
    const geometry = feature && feature.geometry;
    if (!geometry) return false;
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];

    return polygons.some((polygon) => {
      if (!polygon || !polygon.length || !pointInRing(lng, lat, polygon[0])) return false;
      for (let i = 1; i < polygon.length; i += 1) {
        if (pointInRing(lng, lat, polygon[i])) return false;
      }
      return true;
    });
  }

  async function getQueryableBuildings() {
    if (config.buildingMode === "none") return [];
    if (config.buildingMode === "custom") {
      try { return await loadCustomBuildings(); } catch (_) { return []; }
    }
    if (!mapRef || mapRef.getZoom() < config.buildingMinZoom) return [];
    return loadOSMBuildings();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function meters(value, digits = 1) {
    return Number.isFinite(value) ? `${value.toFixed(digits)} m` : "—";
  }

  async function shadeStatusAt(latlng) {
    if (!shadeLayer || !mapRef) return { label: "陰影未啟用", shaded: null };
    if (!shadeReady) return { label: "陰影圖層仍在計算", shaded: null };
    const point = mapRef.latLngToContainerPoint(latlng);
    try {
      if (typeof shadeLayer.isPositionInShade === "function") {
        const shaded = await Promise.resolve(shadeLayer.isPositionInShade(point.x, point.y));
        return { label: shaded ? "🌑 陰影" : "☀️ 日照", shaded: !!shaded };
      }
      if (typeof shadeLayer.isPositionInSun === "function") {
        const sunny = await Promise.resolve(shadeLayer.isPositionInSun(point.x, point.y));
        return { label: sunny ? "☀️ 日照" : "🌑 陰影", shaded: !sunny };
      }
      return { label: "此 SDK 版本不支援點位判讀", shaded: null };
    } catch (error) {
      console.warn("[Haidian Shade] point shade query:", error);
      return { label: "陰影圖層仍在計算", shaded: null };
    }
  }

  async function queryPointData(latlng) {
    const qz = Math.max(
      config.metaMinZoom,
      Math.min(config.metaMaxZoom, Number(config.queryZoom) || config.metaMaxZoom)
    );
    const tile = latLngToTilePixel(latlng.lat, latlng.lng, qz);

    let canopy = null;
    let ground = null;
    let buildings = [];

    const canopyPromise = (async () => {
      if (config.queryCanopyFromCog === false) return null;
      await ensureGeoTIFF();
      const raster = await readMetaCanopyTile(tile.x, tile.y, tile.z);
      if (!raster) return null;
      const raw = Number(raster[tile.index]);
      return raw > 0 && raw < 255 ? raw : 0;
    })().catch((error) => {
      console.warn("[Haidian Shade] canopy point query:", error);
      return null;
    });

    const groundPromise = readBareTerrainHeights(tile.x, tile.y, tile.z)
      .then((raster) => raster ? Number(raster[tile.index]) : null)
      .catch(() => null);

    const buildingsPromise = getQueryableBuildings().catch(() => []);
    const shadePromise = shadeStatusAt(latlng);

    [canopy, ground, buildings] = await Promise.all([
      canopyPromise,
      groundPromise,
      buildingsPromise
    ]);
    const shade = await shadePromise;
    const building = buildings.find((feature) =>
      pointInPolygonFeature(latlng.lng, latlng.lat, feature)
    ) || null;

    return {
      canopy,
      ground,
      surface: Number.isFinite(ground) && Number.isFinite(canopy)
        ? ground + canopy
        : null,
      building,
      shade,
      queryZoom: qz
    };
  }

  function pointQueryHtml(latlng, result) {
    const canopyText = result.canopy == null
      ? "—"
      : result.canopy === 0
        ? "0 m（亦可能為 no-data）"
        : meters(result.canopy, result.canopy >= 10 ? 0 : 1);
    const building = result.building;
    const buildingHeight = building && Number(building.properties && building.properties.height);
    const buildingName = building && building.properties && building.properties.name;
    const heightSource = building && building.properties && building.properties.height_source;
    const time = `${formatDateInput(state.date)} ${String(state.date.getHours()).padStart(2, "0")}:${String(state.date.getMinutes()).padStart(2, "0")}`;

    const rows = [
      ["位置", `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`],
      ["Meta 樹冠高度", canopyText],
      ["裸地高程", meters(result.ground)],
      ["樹冠表面高度", meters(result.surface)],
      ["目前狀態", result.shade.label],
      ["模擬時間", time],
      ["研究模式", modeLabel(state.mode)]
    ];

    if (building) {
      rows.push(["建築", buildingName || "OSM building"]);
      rows.push(["建築高度", meters(buildingHeight)]);
      rows.push(["高度來源", heightSource || "未知"]);
    }

    return `
      <div class="haidian-shade-query-popup">
        <div class="hsq-title">🌳 點位日照／樹冠資訊</div>
        <div class="hsq-grid">
          ${rows.map(([label, value]) =>
            `<div class="hsq-label">${escapeHtml(label)}</div><div class="hsq-value">${escapeHtml(value)}</div>`
          ).join("")}
        </div>
        <div class="hsq-foot">
          CHMv2 樹高為約 z${result.queryZoom} raster pixel 的模型估計，不代表單株樹木現地量測。
          「完整」模式的陰影可能由樹冠、建築或地形共同造成，無法由單一陰影像素判定成因。
        </div>
      </div>`;
  }

  function activePopupClassName() {
    const popup = mapRef && mapRef._popup;
    return String(
      popup && popup.options && popup.options.className
        ? popup.options.className
        : ""
    );
  }

  function mapPointQueryShouldYield(event) {
    // Preserve the site's existing interaction modes.  Shade query is a
    // secondary research tool and must never steal clicks from them.
    if (Date.now() - lastMapDragAt < 280) return true;
    if (document.body && document.body.classList.contains("listening-mode")) return true;
    if (window.nimbyFacilityPickMode === true) return true;

    const drawHud = document.getElementById("drawModeHUD");
    if (drawHud && drawHud.classList.contains("active")) return true;

    if (mapRef && mapRef.pm) {
      try {
        if (
          typeof mapRef.pm.globalDrawModeEnabled === "function" &&
          mapRef.pm.globalDrawModeEnabled()
        ) return true;
      } catch (_) {}
    }

    // A 700 ms long-press in the host app opens the submit popup before the
    // browser may synthesize a click.  Do not replace that popup with a shade query.
    if (/\bmap-click-popup\b/.test(activePopupClassName())) return true;

    const target = event && event.originalEvent && event.originalEvent.target;
    if (target && typeof target.closest === "function") {
      if (target.closest(
        ".leaflet-control,.leaflet-popup,.leaflet-tooltip,.leaflet-marker-icon," +
        ".leaflet-interactive,.glass-header,.drawer-panel,.global-player," +
        ".locate-me-wrapper,#rightToolsWrapper,#drawModeHUD"
      )) return true;
    }

    return false;
  }

  function removePointQueryOverlay() {
    if (!queryPopup || !mapRef) {
      queryPopup = null;
      return;
    }
    try {
      if (mapRef.hasLayer(queryPopup)) mapRef.removeLayer(queryPopup);
    } catch (_) {}
    queryPopup = null;
  }

  let pointQuerySerial = 0;
  async function handleMapPointQuery(event) {
    if (!state.enabled || !state.queryOnClick || !mapRef || !window.L) return;
    if (mapPointQueryShouldYield(event)) return;

    const serial = ++pointQuerySerial;
    const latlng = event.latlng;

    removePointQueryOverlay();
    // Use a Tooltip instead of Popup/openOn().  The host soundscape keeps a
    // single work popup alive while audio plays; openOn() would close it and
    // trigger the host's popupclose/player cleanup.
    queryPopup = L.tooltip({
      permanent: true,
      direction: "top",
      offset: [0, -10],
      opacity: 1,
      interactive: true,
      className: "haidian-shade-query-tooltip"
    })
      .setLatLng(latlng)
      .setContent('<div class="haidian-shade-query-popup"><div class="hsq-title">🌳 正在查詢…</div></div>')
      .addTo(mapRef);

    try {
      const result = await queryPointData(latlng);
      if (serial !== pointQuerySerial || !queryPopup) return;
      queryPopup.setContent(pointQueryHtml(latlng, result));
      if (typeof queryPopup.update === "function") queryPopup.update();
    } catch (error) {
      console.error("[Haidian Shade] point query failed:", error);
      if (serial !== pointQuerySerial || !queryPopup) return;
      queryPopup.setContent(
        `<div class="haidian-shade-query-popup"><div class="hsq-title">查詢失敗</div>` +
        `<div class="hsq-foot">${escapeHtml(error.message || error)}</div></div>`
      );
    }
  }

  function hookMapPointQuery() {
    if (!mapRef || mapQueryHooked || typeof mapRef.on !== "function") return;
    mapQueryHooked = true;
    mapRef.on("dragstart", () => { lastMapDragAt = Date.now(); });
    mapRef.on("dragend", () => { lastMapDragAt = Date.now(); });
    mapRef.on("click", handleMapPointQuery);
  }

  function tileRangeForBounds(bounds, z, buffer) {
    const nw = lonLatToXYZ(bounds.getNorth(), bounds.getWest(), z);
    const se = lonLatToXYZ(bounds.getSouth(), bounds.getEast(), z);
    const max = 2 ** z - 1;
    return {
      minX: Math.max(0, Math.min(nw.x, se.x) - buffer),
      maxX: Math.min(max, Math.max(nw.x, se.x) + buffer),
      minY: Math.max(0, Math.min(nw.y, se.y) - buffer),
      maxY: Math.min(max, Math.max(nw.y, se.y) + buffer)
    };
  }

  function currentLiveCoverageSignature() {
    if (!mapRef || config.metaMode !== "live-cog") return null;
    const mapZoom = mapRef.getZoom();
    const clampZoom = (value) => Math.max(
      config.metaMinZoom,
      Math.min(config.metaMaxZoom, value)
    );
    const zooms = Array.from(new Set([
      clampZoom(Math.floor(mapZoom)),
      clampZoom(Math.ceil(mapZoom))
    ]));
    const buffer = Math.max(0, Number(config.metaTileBuffer) || 0);
    const parts = zooms.map((z) => {
      const r = tileRangeForBounds(mapRef.getBounds(), z, buffer);
      return `${z}:${r.minX},${r.maxX},${r.minY},${r.maxY}`;
    });
    return `${state.mode}|${parts.join("|")}`;
  }

  async function runWithConcurrency(items, concurrency, task) {
    let cursor = 0;
    let done = 0;
    const results = [];
    const worker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        try {
          const result = await task(items[index], index);
          results[index] = result;
        } catch (error) {
          results[index] = null;
          console.warn("[Haidian Shade] tile build failed:", items[index], error);
        }
        done += 1;
        if (done === 1 || done % 12 === 0 || done === items.length) {
          setStatus(`正在準備 Meta CHMv2 樹冠高度… ${done}/${items.length}`);
        }
      }
    };

    const count = Math.max(1, Math.min(concurrency, items.length || 1));
    await Promise.all(Array.from({ length: count }, worker));
    return results;
  }

  async function prepareLiveMetaSurface() {
    await ensureGeoTIFF();
    if (!mapRef) throw new Error("Leaflet map 尚未就緒。");

    // Leaflet may be at a fractional zoom. Prebuild both adjacent integer
    // levels so ShadeMap can request either one without falling through.
    const mapZoom = mapRef.getZoom();
    const clampZoom = (value) => Math.max(
      config.metaMinZoom,
      Math.min(config.metaMaxZoom, value)
    );
    const zooms = Array.from(new Set([
      clampZoom(Math.floor(mapZoom)),
      clampZoom(Math.ceil(mapZoom))
    ]));

    const tiles = [];
    const buffer = Math.max(0, Number(config.metaTileBuffer) || 0);
    for (const z of zooms) {
      const range = tileRangeForBounds(mapRef.getBounds(), z, buffer);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          tiles.push({ x, y, z });
        }
      }
    }

    if (tiles.length > config.metaMaxPreparedTiles) {
      throw new Error(
        `目前視野需準備 ${tiles.length} 張 CHMv2 tiles，超過安全上限 ${config.metaMaxPreparedTiles}；請再放大地圖。`
      );
    }

    const results = await runWithConcurrency(
      tiles,
      Number(config.metaTileConcurrency) || 4,
      (tile) => buildLiveSurfaceTile(tile.x, tile.y, tile.z)
    );
    const loaded = results.filter(Boolean).length;
    if (!loaded) throw new Error("目前視野無法建立地形 surface tiles。");

    const canopyTiles = tiles.reduce((count, tile) => {
      const info = metaSurfaceMeta.get(tileKey(tile.x, tile.y, tile.z));
      return count + (info && info.hasCanopy ? 1 : 0);
    }, 0);

    return { loaded, canopyTiles, total: tiles.length, zooms };
  }

  function liveMetaTerrainSource() {
    return {
      tileSize: 256,
      maxZoom: config.metaMaxZoom,
      getSourceUrl: ({ x, y, z }) => {
        const cached = metaSurfaceUrls.get(tileKey(x, y, z));
        if (cached) return cached;

        // A miss should be rare because prepareLiveMetaSurface() builds the
        // visible tile grid + one-tile margin before ShadeMap is created.
        // Returning bare DEM keeps the layer valid while a later moveend rebuild
        // prepares the newly-visible CHM tiles.
        return fillTemplate(config.bareTerrainTileUrl, x, y, z);
      },
      getElevation: ({ r, g, b }) =>
        r * 256 + g + b / 256 - 32768
    };
  }

  function terrariumSource(template, maxZoom) {
    return {
      tileSize: 256,
      maxZoom,
      getSourceUrl: ({ x, y, z }) =>
        fillTemplate(template, x, y, z),
      getElevation: ({ r, g, b }) =>
        r * 256 + g + b / 256 - 32768
    };
  }

  function bareTerrainSource() {
    return terrariumSource(
      config.bareTerrainTileUrl,
      config.bareTerrainMaxZoom
    );
  }

  function metaTerrainSource() {
    return terrariumSource(
      config.metaTileUrl,
      config.metaMaxZoom
    );
  }

  function parseHeightInfo(tags) {
    const t = tags || {};

    if (t.height != null) {
      const raw = String(t.height).trim().toLowerCase();
      const value = parseFloat(raw.replace(",", "."));
      if (Number.isFinite(value) && value > 0) {
        return {
          height: raw.includes("ft") || raw.includes("'") ? value * 0.3048 : value,
          source: "OSM height"
        };
      }
    }

    if (t["building:levels"] != null) {
      const levels = parseFloat(String(t["building:levels"]).replace(",", "."));
      if (Number.isFinite(levels) && levels > 0) {
        return {
          height: levels * config.defaultStoreyHeight,
          source: `OSM building:levels × ${config.defaultStoreyHeight} m`
        };
      }
    }

    return {
      height: config.defaultBuildingHeight,
      source: "預設估計值"
    };
  }

  function parseHeight(tags) {
    return parseHeightInfo(tags).height;
  }

  async function loadCustomBuildings() {
    if (!config.buildingGeoJSONUrl) return [];
    if (customBuildingsCache) return customBuildingsCache;

    const response = await fetch(config.buildingGeoJSONUrl);
    if (!response.ok) {
      throw new Error(
        `自訂建築 GeoJSON 載入失敗：HTTP ${response.status}`
      );
    }

    const collection = await response.json();
    const features = (collection.features || []).filter((feature) => {
      return (
        feature &&
        feature.geometry &&
        ["Polygon", "MultiPolygon"].includes(feature.geometry.type)
      );
    });

    for (const feature of features) {
      feature.properties = feature.properties || {};
      const h = Number(
        feature.properties.height ??
        feature.properties.render_height ??
        config.defaultBuildingHeight
      );
      const safeHeight =
        Number.isFinite(h) && h > 0
          ? h
          : config.defaultBuildingHeight;
      feature.properties.height = safeHeight;
      feature.properties.render_height = safeHeight;
      feature.properties.height_source =
        feature.properties.height_source || "自訂 GeoJSON";
    }

    customBuildingsCache = features;
    return features;
  }

  function boundsCacheKey(bounds) {
    return [
      bounds.getSouth().toFixed(3),
      bounds.getWest().toFixed(3),
      bounds.getNorth().toFixed(3),
      bounds.getEast().toFixed(3)
    ].join(",");
  }

  async function loadOSMBuildings() {
    if (!mapRef || mapRef.getZoom() < config.buildingMinZoom) return [];

    const bounds = mapRef.getBounds();
    const key = boundsCacheKey(bounds);

    if (overpassCache.has(key)) {
      return overpassCache.get(key);
    }

    const query =
      `[out:json][timeout:20];` +
      `way["building"](` +
      `${bounds.getSouth()},${bounds.getWest()},` +
      `${bounds.getNorth()},${bounds.getEast()}` +
      `);out tags geom;`;

    const promise = fetch(
      `${config.overpassUrl}?data=${encodeURIComponent(query)}`
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Overpass HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((json) => {
        const features = [];

        for (const element of json.elements || []) {
          if (!element.geometry || element.geometry.length < 3) continue;

          const ring = element.geometry.map((point) => [
            point.lon,
            point.lat
          ]);

          const first = ring[0];
          const last = ring[ring.length - 1];

          if (first[0] !== last[0] || first[1] !== last[1]) {
            ring.push(first.slice());
          }

          const heightInfo = parseHeightInfo(element.tags);
          const height = heightInfo.height;

          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [ring]
            },
            properties: {
              height,
              render_height: height,
              height_source: heightInfo.source,
              osm_id: element.id,
              name:
                (element.tags &&
                  (element.tags["name:zh"] || element.tags.name)) ||
                "OSM building"
            }
          });
        }

        return features;
      })
      .catch((error) => {
        console.warn("[Haidian Shade] OSM buildings:", error);
        return [];
      });

    overpassCache.set(key, promise);

    if (overpassCache.size > 10) {
      overpassCache.delete(overpassCache.keys().next().value);
    }

    return promise;
  }

  async function getBuildings() {
    if (state.mode === "trees") return [];

    if (config.buildingMode === "none") return [];

    if (config.buildingMode === "custom") {
      try {
        return await loadCustomBuildings();
      } catch (error) {
        console.warn("[Haidian Shade] custom buildings:", error);
        return [];
      }
    }

    return loadOSMBuildings();
  }

  function lonLatToXYZ(lat, lon, z) {
    const n = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n
    );
    return { x, y, z };
  }

  async function metaTileAvailable() {
    if (!config.metaTileUrl || !mapRef) return false;

    const center = mapRef.getCenter();
    const t = lonLatToXYZ(
      center.lat,
      center.lng,
      config.metaMaxZoom
    );
    const url = fillTemplate(
      config.metaTileUrl,
      t.x,
      t.y,
      t.z
    );

    try {
      let response = await fetch(url, {
        method: "HEAD",
        cache: "no-store"
      });
      if (response.ok) return true;

      response = await fetch(url, {
        method: "GET",
        cache: "no-store"
      });
      return response.ok;
    } catch (_) {
      return false;
    }
  }

  async function selectTerrainSource() {
    if (state.mode === "buildings") {
      return {
        source: bareTerrainSource(),
        meta: false,
        warning: ""
      };
    }

    if (mapRef && mapRef.getZoom() < config.metaMinZoom) {
      return {
        source: bareTerrainSource(),
        meta: false,
        warning:
          `目前縮放層級 z${mapRef.getZoom()} 低於高解析樹冠陰影層級 z${config.metaMinZoom}；` +
          "CHMv2 可全球移動查詢，請在任何地點放大後即可載入當地樹冠。"
      };
    }

    if (config.metaMode === "live-cog") {
      const prepared = await prepareLiveMetaSurface();
      const hasCanopy = prepared.canopyTiles > 0;
      const canopySummary = `${prepared.canopyTiles}/${prepared.total} canopy tiles`;
      return {
        source: liveMetaTerrainSource(),
        meta: hasCanopy,
        warning: hasCanopy
          ? (config.metaBlendBareTerrain
              ? `全球 CHMv2 已載入目前視野（z${prepared.zooms.join("/")}，${canopySummary}），並與裸地 DEM 相加；移動到其他地區會自動載入當地資料。`
              : `全球 CHMv2 已載入目前視野（z${prepared.zooms.join("/")}，${canopySummary}）；目前未疊加裸地 DEM。`)
          : "目前視野沒有可讀取的 CHMv2 樹冠像素；陰影暫以裸地 DEM／建築計算。移到其他地區或放大後會重新嘗試載入。"
      };
    }

    const hasMeta = await metaTileAvailable();

    if (hasMeta) {
      return {
        source: metaTerrainSource(),
        meta: true,
        warning: config.metaMode === "xyz"
          ? "已使用遠端 Meta CHMv2 衍生 XYZ surface tiles。"
          : "已使用預先產生的 Meta CHMv2 surface tiles。"
      };
    }

    return {
      source: bareTerrainSource(),
      meta: false,
      warning:
        "找不到目前位置的 Meta CHMv2 tiles，已暫時改用裸地 DEM；樹木模式因此不代表樹冠陰影。"
    };
  }

  async function createShadeLayer() {
    if (!config.apiKey || config.apiKey === "YOUR_SHADEMAP_API_KEY") {
      throw new Error("尚未填入 ShadeMap API key。");
    }

    await ensureEngine();
    const terrain = await selectTerrainSource();

    shadeReady = false;
    const layer = L.shadeMap({
      date: state.date,
      color: config.defaultColor,
      opacity: state.opacity,
      apiKey: config.apiKey,
      terrainSource: terrain.source,
      getFeatures: getBuildings,
      debug: (message) =>
        console.debug("[Haidian ShadeMap]", message)
    });

    if (layer && typeof layer.on === "function") {
      layer.on("idle", () => { shadeReady = true; });
    }
    layer.addTo(mapRef);

    return { layer, terrain };
  }

  async function enableShade() {
    if (!mapRef) {
      setStatus("找不到 Leaflet map。", true);
      return;
    }

    try {
      setStatus("正在載入陰影模擬…");
      const result = await createShadeLayer();
      shadeLayer = result.layer;
      state.enabled = true;
      syncCanopyOverlay();
      if (config.metaMode === "live-cog") {
        lastLiveViewSignature = currentLiveCoverageSignature();
      }

      if (result.terrain.warning) {
        setStatus(result.terrain.warning, !result.terrain.meta);
      } else {
        setStatus(`已啟用：${modeLabel(state.mode)}。`);
      }
    } catch (error) {
      console.error(error);
      state.enabled = false;
      const toggle = document.getElementById("haidianShadeToggle");
      if (toggle) toggle.checked = false;
      setStatus(`啟動失敗：${error.message || error}`, true);
    }
  }

  function disableShade(updateStatus = true) {
    if (shadeLayer) {
      try {
        if (typeof shadeLayer.remove === "function") {
          shadeLayer.remove();
        } else if (mapRef && mapRef.hasLayer(shadeLayer)) {
          mapRef.removeLayer(shadeLayer);
        }
      } catch (_) {}
    }

    shadeLayer = null;
    shadeReady = false;
    state.enabled = false;
    removeCanopyOverlay();

    removePointQueryOverlay();

    if (updateStatus) {
      setStatus("陰影模擬已關閉。");
    }
  }

  async function rebuildShade() {
    disableShade(false);

    const toggle = document.getElementById("haidianShadeToggle");
    if (toggle) toggle.checked = true;

    await enableShade();
  }

  function hookMapMoveRebuild() {
    if (!mapRef || mapMoveHooked || typeof mapRef.on !== "function") return;
    mapMoveHooked = true;
    const scheduleRebuild = () => {
      if (!state.enabled || state.mode === "buildings" || config.metaMode !== "live-cog") return;
      if (document.body && document.body.classList.contains("listening-mode")) return;
      clearTimeout(liveMoveTimer);
      liveMoveTimer = setTimeout(() => {
        if (!state.enabled) return;
        const nextSignature = currentLiveCoverageSignature();
        if (nextSignature && nextSignature === lastLiveViewSignature) return;
        setStatus("正在切換到目前位置的全球 CHMv2 資料…");
        rebuildShade();
      }, 550);
    };
    mapRef.on("moveend", scheduleRebuild);
    mapRef.on("zoomend", scheduleRebuild);
  }

  function boot() {
    injectStyles();

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      mapRef = mapRef || resolveMap();

      const panelReady = injectPanel();

      if (mapRef && panelReady) {
        hookMapMoveRebuild();
        hookMapPointQuery();
        clearInterval(timer);
        return;
      }

      if (attempts > 60) {
        clearInterval(timer);
        console.warn(
          "[Haidian Shade] 找不到 Leaflet map 或右側工具容器。"
        );
      }
    }, 500);
  }

  window.HaidianShade = {
    enable: enableShade,
    disable: disableShade,
    rebuild: rebuildShade,
    get state() {
      return Object.assign({}, state);
    },
    get config() {
      return Object.assign({}, config);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
