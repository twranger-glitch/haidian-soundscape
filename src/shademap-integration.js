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
    // static   = use pre-generated ./meta-dsm/{z}/{x}/{y}.png instead.
    metaMode: "live-cog",
    metaTileUrl: "./meta-dsm/{z}/{x}/{y}.png",
    metaCogBaseUrl: "https://data.source.coop/tge-labs/meta-chm-v2/chm",
    geotiffUrl: "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.min.js",
    metaMinZoom: 14,
    // z17 aligns with CHMv2's native ~1.19 m Web-Mercator pixels.
    // The bare-earth DEM is overzoomed above its z15 maximum; canopy stays native.
    metaMaxZoom: 17,
    metaTileBuffer: 1,
    metaTileConcurrency: 4,
    metaMaxPreparedTiles: 180,
    metaMaxCachedTiles: 480,
    metaBlendBareTerrain: true,

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
    defaultOpacity: 0.42,
    defaultColor: "#0f172a",

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
    opacity: config.defaultOpacity
  };

  let mapRef = null;
  let shadeLayer = null;
  let enginePromise = null;
  let customBuildingsCache = null;
  let geoTiffPromise = null;
  let liveMoveTimer = null;
  let mapMoveHooked = false;
  const overpassCache = new Map();
  const metaCogCache = new Map();
  const metaSurfaceUrls = new Map();
  const metaSurfacePromises = new Map();
  const demBitmapCache = new Map();

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
            min="0.15" max="0.75" step="0.05" value="${state.opacity}">
        </div>

        <div id="haidianShadeStatus" class="haidian-shade-status">
          尚未啟用陰影模擬。
        </div>

        <div class="haidian-shade-source">
          <b>陰影：</b>ShadeMap Leaflet SDK<br>
          <b>樹冠：</b>Meta / WRI CHMv2（live COG）<br>
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
          Meta 為樹冠高度模型估計；建築高度可能來自 OSM 或預設值。
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
      return bands[0];
    } catch (error) {
      console.warn("[Haidian Shade] Meta COG window failed:", quadkey, error);
      return null;
    }
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
      if (!canopy) return null;

      const dem = await readBareTerrainHeights(x, y, z);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const image = ctx.createImageData(256, 256);

      for (let i = 0; i < canopy.length; i += 1) {
        const chm = canopy[i] > 0 && canopy[i] < 255 ? canopy[i] : 0;
        const ground = dem ? dem[i] : 0;
        terrariumEncodeInto(image.data, i, ground + chm);
      }

      ctx.putImageData(image, 0, 0);
      const url = await canvasToBlobUrl(canvas);
      metaSurfaceUrls.set(key, url);
      const maxCached = Math.max(64, Number(config.metaMaxCachedTiles) || 480);
      while (metaSurfaceUrls.size > maxCached) {
        const oldestKey = metaSurfaceUrls.keys().next().value;
        const oldestUrl = metaSurfaceUrls.get(oldestKey);
        metaSurfaceUrls.delete(oldestKey);
        if (oldestUrl) URL.revokeObjectURL(oldestUrl);
      }
      return url;
    })().finally(() => metaSurfacePromises.delete(key));

    metaSurfacePromises.set(key, promise);
    return promise;
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
    if (!loaded) throw new Error("目前視野沒有可讀取的 Meta CHMv2 canopy data。");

    return { loaded, total: tiles.length, zooms };
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

  function parseHeight(tags) {
    const t = tags || {};

    if (t.height != null) {
      const raw = String(t.height).trim().toLowerCase();
      const value = parseFloat(raw.replace(",", "."));
      if (Number.isFinite(value) && value > 0) {
        if (raw.includes("ft") || raw.includes("'")) {
          return value * 0.3048;
        }
        return value;
      }
    }

    if (t["building:levels"] != null) {
      const levels = parseFloat(
        String(t["building:levels"]).replace(",", ".")
      );
      if (Number.isFinite(levels) && levels > 0) {
        return levels * config.defaultStoreyHeight;
      }
    }

    return config.defaultBuildingHeight;
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

          const height = parseHeight(element.tags);

          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [ring]
            },
            properties: {
              height,
              render_height: height,
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
          `目前縮放層級 z${mapRef.getZoom()} 低於樹冠資料最低 z${config.metaMinZoom}；` +
          "已暫時改用裸地 DEM。放大後重新切換研究模式即可載入樹冠。"
      };
    }

    if (config.metaMode === "live-cog") {
      const prepared = await prepareLiveMetaSurface();
      return {
        source: liveMetaTerrainSource(),
        meta: true,
        warning: config.metaBlendBareTerrain
          ? `Meta CHMv2 已直接從 COG 載入（z${prepared.zooms.join("/")}，${prepared.loaded}/${prepared.total} tiles），並與裸地 DEM 相加。`
          : `Meta CHMv2 已直接從 COG 載入（z${prepared.zooms.join("/")}，${prepared.loaded}/${prepared.total} tiles）；目前未疊加裸地 DEM。`
      };
    }

    const hasMeta = await metaTileAvailable();

    if (hasMeta) {
      return {
        source: metaTerrainSource(),
        meta: true,
        warning: ""
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

    const layer = L.shadeMap({
      date: state.date,
      color: config.defaultColor,
      opacity: state.opacity,
      apiKey: config.apiKey,
      terrainSource: terrain.source,
      getFeatures: getBuildings,
      debug: (message) =>
        console.debug("[Haidian ShadeMap]", message)
    }).addTo(mapRef);

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
    state.enabled = false;

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
    mapRef.on("moveend", () => {
      if (!state.enabled || state.mode === "buildings" || config.metaMode !== "live-cog") return;
      clearTimeout(liveMoveTimer);
      liveMoveTimer = setTimeout(() => {
        if (state.enabled) rebuildShade();
      }, 650);
    });
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
