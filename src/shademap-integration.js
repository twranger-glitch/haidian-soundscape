/*
 * Haidian Soundscape — ShadeMap × Meta CHMv2 live integration v8.0.2
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
    queryCanopyTimeoutMs: 12000,
    queryDemTimeoutMs: 6000,
    // v8.0.1: the browser must wait longer than the Worker's 8 s upstream budget,
    // then still leave enough time for the clearly-labelled global fallback.
    queryGroundTotalTimeoutMs: 14500,
    queryGlobalDemFallbackTimeoutMs: 4500,
    // v7.5: if the ShadeMap render is still busy when a point is clicked,
    // keep the tooltip alive and refresh sun/shade automatically on SDK idle.
    queryShadeRetryMs: 250,
    queryShadeRetryTimeoutMs: 10000,

    // v7.9.2: solar-ray occluder tracing with spatial-consensus tolerance.
    // ShadeMap exposes only sun/shade, so a shaded point casts reverse rays
    // toward the sun. We keep the exact center ray, then test a narrow fan of
    // parallel rays to absorb OSM alignment / screen quantization error. A
    // building that is only found off-center is downgraded rather than treated
    // as certain. CHMv2 is sampled along the center ray.
    queryShadeSourceEnabled: true,
    queryShadeSourceTimeoutMs: 3600,
    queryShadeSourceMaxDistanceM: 240,
    queryShadeSourceSampleStepM: 1.25,
    queryShadeSourceCanopyMaxHeightM: 55,
    queryShadeSourceRayClearanceM: 0.5,
    queryShadeSourceRayWidthM: 9,
    queryShadeSourceRayStepM: 1.5,
    queryShadeSourceCorridorMinHits: 2,
    queryShadeSourceRayBaseToleranceM: 3.5,
    queryShadeSourceRayAngularToleranceDeg: 3,
    queryShadeSourceUnknownBuildingMaxHeightM: 24,
    // The building fetch must cover possible shadow casters outside the visible
    // viewport. This padding is intentionally a little larger than the source
    // tracing radius so edge-of-screen clicks do not lose their occluder.
    buildingShadowFetchPaddingM: 280,
    queryShadeSourceMixedDistanceToleranceM: 3,
    queryShadeSourceMinAltitudeDeg: 1.5,

    // v8.0.0 experimental Tree-Folio-inspired canopy contribution prototype.
    // CHMv2 is a raster canopy-height model, not a surveyed single-tree inventory,
    // so the selected object is deliberately called a local canopy patch. The
    // current-sun shadow is estimated from the same vertical-column semantics used
    // by the DSM surface and split into ground/building receivers when cached OSM
    // building coverage is available.
    queryCanopyBenefitEnabled: true,
    queryCanopyBenefitTimeoutMs: 5500,
    queryCanopyBenefitMinHeightM: 2,
    queryCanopyBenefitMaxRadiusM: 14,
    queryCanopyBenefitMaxPixels: 420,
    queryCanopyBenefitShadowCellM: 1.25,
    queryCanopyBenefitMaxShadowLengthM: 90,
    queryCanopyBenefitMinSolarAltitudeDeg: 3,
    queryCanopyBenefitOverlay: true,

    // v7.8.6 lifecycle policy: terrain/data caches may be reused, but renderer DOM
    // ownership is single-canvas. Date/time changes stay in-place via setDate(), are
    // debounced, and the SDK canvas is hidden until the matching renderer becomes idle.
    // Viewport changes still replace the renderer, with retired canvases scrubbed only
    // after SDK remove()/idle safe points (never force WEBGL_lose_context).
    navigationRebuildDelayMs: 520,
    dateUpdateDebounceMs: 180,
    hardCanvasCleanup: false,
    retiredCanvasCleanupDelayMs: 1200,
    layerSwapDelayMs: 80,
    preserveShadeLayerDuringNavigation: true,

    // Host-page UX: desktop top banner can be collapsed to a compact pill.
    headerMinimizeEnabled: true,
    headerMinimizeRemember: "session",

    bareTerrainTileUrl:
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    bareTerrainMaxZoom: 15,
    bareTerrainLabel: "Mapzen / Tilezen global terrain DEM",
    bareTerrainNote: "Global fallback terrain used by the shadow engine until authoritative regional terrain tiles are configured.",

    // v7.7 authoritative Taiwan point elevation. Keep the credential OFF the browser:
    // put the MOI DTM api_key in a server-side proxy (Cloudflare Worker template included).
    // v7.8.8: Taiwan point queries prefer the official proxy, but if it times out or
    // fails they may use the global Terrarium DEM as an explicitly non-authoritative fallback.
    taiwanOfficialDtmProxyUrl: "",
    taiwanOfficialDtmLabel: "內政部 DTM API 20 m（2010–2019 合併資料）",
    // v8.0.1: the Worker may legitimately wait up to 8 s for MOI. The old 5 s
    // browser timeout abandoned valid 5–8 s official responses too early.
    taiwanOfficialDtmTimeoutMs: 9000,
    taiwanGlobalDemFallbackEnabled: true,
    // Legacy safety switch. When global fallback is disabled, this still controls
    // whether a non-official Taiwan value is withheld.
    taiwanHideGlobalDemPointValue: true,
    // Optional future Terrarium XYZ generated from an official Taiwan DTM download.
    // This is separate from the point API. When populated in a later data-build,
    // it can replace the global DEM inside the actual ShadeMap terrain surface.
    taiwanTerrainTileUrl: "",
    taiwanTerrainMaxZoom: 13,
    taiwanTerrainLabel: "內政部官方 DTM Terrarium XYZ",
    taiwanTerrainDatasetLabel: "2025 年版官方 20 m DTM（自建 tiles）",

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
    lockMapMaxZoomToMeta: true,
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
  let shadePreviousMaxZoom = null;
  let shadeZoomConstraintApplied = false;
  let shadeLayer = null;
  let shadeReady = false;
  let shadeLayerSerial = 0;
  let shadeIdleHandler = null;
  let shadeDomObserver = null;
  let shadeHostCanvasBaseline = null;
  let shadeCanvasMountBaseline = null;
  let shadeActiveCanvas = null;
  let shadeCanvasCleanupTimers = [];
  let shadeDateUpdateTimer = null;
  let shadeDateRequestSerial = 0;
  let shadeAppliedDateMs = null;
  let shadePendingDate = null;
  let enginePromise = null;
  let customBuildingsCache = null;
  let geoTiffPromise = null;
  let liveMoveTimer = null;
  let shadeRebuildSerial = 0;
  let shadeNavigationSuspended = false;
  let mapMoveHooked = false;
  let mapQueryHooked = false;
  let canopyOverlayLayer = null;
  let queryPopup = null;
  let queryPointMarker = null;
  let querySampleCell = null;
  let queryCanopyBenefitLayer = null;
  let activePointQuery = null;
  let pointShadeRetryTimer = null;
  let lastMapDragAt = 0;
  let lastLiveViewSignature = null;
  const overpassCache = new Map();
  let lastBuildingFeatures = [];
  let lastBuildingCoverageKey = null;
  const metaCogCache = new Map();
  const metaSurfaceUrls = new Map();
  const metaSurfacePromises = new Map();
  const metaSurfaceMeta = new Map();
  const demBitmapCache = new Map();
  const officialDtmPointCache = new Map();
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

  function initShadeCanvasBaseline() {
    if (!mapRef || !mapRef.getContainer || shadeHostCanvasBaseline) return;
    const container = mapRef.getContainer();
    if (!container) return;
    shadeHostCanvasBaseline = new Set(Array.from(container.querySelectorAll("canvas")));
  }

  function isLikelyShadeCanvas(canvas) {
    if (!canvas || !mapRef || !mapRef.getContainer) return false;
    if (shadeHostCanvasBaseline && shadeHostCanvasBaseline.has(canvas)) return false;
    // Our canopy overlay is an L.GridLayer whose canvas tiles carry .leaflet-tile.
    // Never touch those; the stale artifact observed in v7.4 lives in the
    // overlay/map pane as a viewport-sized SDK canvas.
    if (canvas.classList && canvas.classList.contains("leaflet-tile")) return false;
    const container = mapRef.getContainer();
    if (!container || !container.contains(canvas)) return false;
    const inMapPane = !!canvas.closest(".leaflet-map-pane,.leaflet-overlay-pane");
    return inMapPane;
  }

  function getLikelyShadeCanvases() {
    if (!mapRef || !mapRef.getContainer) return [];
    const container = mapRef.getContainer();
    if (!container) return [];
    return Array.from(container.querySelectorAll("canvas")).filter(isLikelyShadeCanvas);
  }

  function beginShadeCanvasOwnership(serial) {
    if (!mapRef || !mapRef.getContainer) {
      shadeCanvasMountBaseline = null;
      shadeActiveCanvas = null;
      return;
    }
    const canvases = new Set(getLikelyShadeCanvases());
    shadeCanvasMountBaseline = { serial, canvases };
    shadeActiveCanvas = null;
  }

  function canvasExistedBeforeMount(canvas, serial) {
    const baseline = shadeCanvasMountBaseline;
    return !!(
      baseline &&
      baseline.serial === serial &&
      baseline.canvases &&
      baseline.canvases.has(canvas)
    );
  }

  function retireShadeCanvas(canvas) {
    if (!canvas) return;
    if (shadeActiveCanvas === canvas) shadeActiveCanvas = null;
    try {
      canvas.classList.remove("haidian-shade-sdk-canvas");
      canvas.classList.add("haidian-shade-retired-canvas");
      canvas.setAttribute && canvas.setAttribute("aria-hidden", "true");
    } catch (_) {}
  }

  function claimShadeCanvas(canvas, serial) {
    if (!canvas) return null;
    const token = String(serial);
    if (shadeActiveCanvas && shadeActiveCanvas !== canvas) {
      retireShadeCanvas(shadeActiveCanvas);
    }
    try {
      canvas.dataset.haidianShadeOwner = token;
      canvas.classList.remove("haidian-shade-retired-canvas");
      canvas.classList.add("haidian-shade-sdk-canvas");
      canvas.removeAttribute && canvas.removeAttribute("aria-hidden");
    } catch (_) {}
    shadeActiveCanvas = canvas;
    return canvas;
  }

  function reconcileShadeCanvasOwnership(preferredCanvas) {
    if (!mapRef || !mapRef.getContainer || !shadeLayer || !shadeLayerSerial) return null;
    const token = String(shadeLayerSerial);
    const canvases = getLikelyShadeCanvases();
    const eligible = [];

    canvases.forEach((canvas) => {
      const owner = String(canvas.dataset.haidianShadeOwner || "");
      const existedBeforeThisMount = canvasExistedBeforeMount(canvas, shadeLayerSerial);

      // Anything belonging to an older renderer, or present before this renderer
      // mounted without an owner, can never be adopted by the current renderer.
      if ((owner && owner !== token) || (!owner && existedBeforeThisMount)) {
        retireShadeCanvas(canvas);
        return;
      }

      // Current-owner canvases and genuinely new unowned canvases are candidates.
      eligible.push(canvas);
    });

    let winner = null;
    if (preferredCanvas && eligible.includes(preferredCanvas)) {
      winner = preferredCanvas;
    } else {
      const fresh = eligible.filter((canvas) => !canvas.dataset.haidianShadeOwner);
      if (fresh.length) {
        // A newly inserted SDK canvas supersedes the old framebuffer. This matters
        // for setDate()/internal redraws that may replace the DOM canvas without
        // changing our renderer serial.
        winner = fresh[fresh.length - 1];
      } else if (shadeActiveCanvas && eligible.includes(shadeActiveCanvas)) {
        winner = shadeActiveCanvas;
      } else if (eligible.length) {
        // Recover deterministically if a previous version left multiple canvases
        // with the same serial: the last DOM canvas wins, all siblings retire.
        winner = eligible[eligible.length - 1];
      }
    }

    if (winner) claimShadeCanvas(winner, shadeLayerSerial);
    eligible.forEach((canvas) => {
      if (canvas !== winner) retireShadeCanvas(canvas);
    });
    return winner;
  }

  function markActiveShadeCanvases(preferredCanvas) {
    return reconcileShadeCanvasOwnership(preferredCanvas);
  }

  function getShadeCanvasDiagnostics() {
    const canvases = getLikelyShadeCanvases();
    const active = canvases.filter((canvas) =>
      canvas.classList && canvas.classList.contains("haidian-shade-sdk-canvas") &&
      !canvas.classList.contains("haidian-shade-retired-canvas")
    );
    const retired = canvases.filter((canvas) =>
      canvas.classList && canvas.classList.contains("haidian-shade-retired-canvas")
    );
    const token = shadeLayerSerial ? String(shadeLayerSerial) : "";
    const currentOwner = active.filter((canvas) =>
      String(canvas.dataset.haidianShadeOwner || "") === token
    );
    return {
      total: canvases.length,
      active: active.length,
      retired: retired.length,
      currentOwner: currentOwner.length,
      ownerSerial: shadeLayerSerial || 0,
      rebuildSerial: shadeRebuildSerial,
      ready: !!shadeReady,
      navigationSuspended: !!shadeNavigationSuspended
    };
  }

  function enforceShadeCanvasInvariant(reason) {
    reconcileShadeCanvasOwnership();
    const info = getShadeCanvasDiagnostics();
    if (info.active > 1 || info.currentOwner > 1) {
      console.warn("[Haidian Shade] canvas invariant violation", reason || "", info);
      reconcileShadeCanvasOwnership();
    }
    return getShadeCanvasDiagnostics();
  }

  function webglCapability() {
    const result = { webgl: false, webgl2: false };
    try {
      result.webgl = !!document.createElement("canvas").getContext("webgl");
    } catch (_) {}
    try {
      result.webgl2 = !!document.createElement("canvas").getContext("webgl2");
    } catch (_) {}
    return result;
  }

  function retireActiveShadeCanvases() {
    let count = 0;
    getLikelyShadeCanvases().forEach((canvas) => {
      retireShadeCanvas(canvas);
      count += 1;
    });
    shadeActiveCanvas = null;
    return count;
  }

  function cleanupRetiredShadeCanvases() {
    if (!mapRef || !mapRef.getContainer) return 0;
    const container = mapRef.getContainer();
    let removed = 0;
    Array.from(container.querySelectorAll("canvas.haidian-shade-retired-canvas")).forEach((canvas) => {
      if (canvas === shadeActiveCanvas) return;
      try { canvas.remove(); removed += 1; } catch (_) {}
    });
    return removed;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function isWebGLContextFailure(error) {
    const message = String(error && (error.message || error) || "");
    return /createShader|createTexture|createProgram|webgl|context.*null|reading ['"]create/i.test(message);
  }

  function clearCanvasCleanupTimers() {
    shadeCanvasCleanupTimers.forEach((id) => clearTimeout(id));
    shadeCanvasCleanupTimers = [];
  }

  function scheduleRetiredCanvasScrub(customDelay) {
    clearCanvasCleanupTimers();
    const configured = Number(config.retiredCanvasCleanupDelayMs) || 1200;
    const wait = Math.max(120, customDelay == null ? configured : Number(customDelay) || configured);
    shadeCanvasCleanupTimers.push(setTimeout(() => {
      // While a renderer is still drawing, CSS retirement is sufficient. Physical
      // removal waits until a safe idle point so SDK internals are not disturbed.
      if (shadeLayer && !shadeReady) {
        scheduleRetiredCanvasScrub(Math.max(300, wait));
        return;
      }
      cleanupRetiredShadeCanvases();
      enforceShadeCanvasInvariant("post-scrub");
    }, wait));
  }

  function installShadeCanvasObserver() {
    if (!mapRef || !mapRef.getContainer || shadeDomObserver) return;
    initShadeCanvasBaseline();
    const container = mapRef.getContainer();
    if (!container || typeof MutationObserver === "undefined") return;
    shadeDomObserver = new MutationObserver((records) => {
      const addedShadeCanvases = [];
      for (const record of records) {
        for (const node of Array.from(record.addedNodes || [])) {
          if (!node || node.nodeType !== 1) continue;
          const canvases = node.tagName === "CANVAS" ? [node] :
            (node.querySelectorAll ? Array.from(node.querySelectorAll("canvas")) : []);
          canvases.forEach((canvas) => {
            if (isLikelyShadeCanvas(canvas)) addedShadeCanvases.push(canvas);
          });
        }
      }

      if (shadeLayer) {
        const preferred = addedShadeCanvases.length
          ? addedShadeCanvases[addedShadeCanvases.length - 1]
          : null;
        reconcileShadeCanvasOwnership(preferred);
        return;
      }

      // A late canvas from a renderer that has already been removed is always
      // retired immediately. It may be physically scrubbed at the next safe point.
      addedShadeCanvases.forEach(retireShadeCanvas);
      if (addedShadeCanvases.length) scheduleRetiredCanvasScrub();
    });
    shadeDomObserver.observe(container, { childList: true, subtree: true });
  }

  function captureViewSnapshot() {
    if (!mapRef) return null;
    const bounds = mapRef.getBounds();
    return {
      zoom: mapRef.getZoom(),
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
      mode: state.mode
    };
  }

  function snapshotBounds(snapshot) {
    return {
      getNorth: () => snapshot.north,
      getSouth: () => snapshot.south,
      getEast: () => snapshot.east,
      getWest: () => snapshot.west
    };
  }

  function snapshotCoverageSignature(snapshot) {
    if (!snapshot || config.metaMode !== "live-cog") return null;
    const clampZoom = (value) => Math.max(
      config.metaMinZoom,
      Math.min(config.metaMaxZoom, value)
    );
    const zooms = Array.from(new Set([
      clampZoom(Math.floor(snapshot.zoom)),
      clampZoom(Math.ceil(snapshot.zoom))
    ]));
    const buffer = Math.max(0, Number(config.metaTileBuffer) || 0);
    const bounds = snapshotBounds(snapshot);
    const parts = zooms.map((z) => {
      const r = tileRangeForBounds(bounds, z, buffer);
      return `${z}:${r.minX},${r.maxX},${r.minY},${r.maxY}`;
    });
    return `${snapshot.mode}|${parts.join("|")}`;
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
      /* Precision point-query cursor: override Leaflet's default grab/open-hand cursor. */
      .leaflet-container.haidian-shade-query-active,
      .leaflet-container.haidian-shade-query-active.leaflet-grab,
      .leaflet-container.haidian-shade-query-active .leaflet-grab{
        cursor:crosshair!important;
      }
      /* v7.5: navigation never shows a retired SDK canvas while the next
         CHMv2 viewport is being prepared. */
      .leaflet-container.haidian-shade-navigation .haidian-shade-sdk-canvas{
        visibility:hidden!important;opacity:0!important;
      }
      .leaflet-container canvas.haidian-shade-retired-canvas{
        visibility:hidden!important;opacity:0!important;pointer-events:none!important;
      }
      .leaflet-tooltip.haidian-shade-query-tooltip{
        white-space:normal!important;max-width:300px;padding:0!important;
        background:#fff!important;border:1px solid #99f6e4!important;
        border-radius:14px!important;box-shadow:0 12px 30px rgba(15,23,42,.18)!important;
        color:#0f172a!important;overflow:hidden
      }
      .leaflet-tooltip.haidian-shade-query-tooltip:before{display:none!important}
      .haidian-shade-query-popup{min-width:246px;line-height:1.38;background:#fff;isolation:isolate}
      .haidian-shade-query-popup .hsq-head{
        display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
        padding:10px 11px 8px;border-bottom:1px solid #ecfdf5;background:#f8fffd
      }
      .haidian-shade-query-popup .hsq-head-actions{display:flex;align-items:flex-start;gap:6px}
      .haidian-shade-query-popup .hsq-close{
        display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;
        width:30px;height:30px;margin:-3px -4px 0 0;padding:0;border:0;border-radius:8px;
        background:transparent;color:#64748b;font-size:20px;font-weight:800;line-height:1;
        cursor:pointer;touch-action:manipulation
      }
      .haidian-shade-query-popup .hsq-close:hover{background:#ecfdf5;color:#047857}
      .haidian-shade-query-popup .hsq-close:focus-visible{outline:2px solid #14b8a6;outline-offset:1px}
      .haidian-shade-query-popup .hsq-title{
        margin:0;font-weight:900;color:#0f766e;font-size:13px
      }
      .haidian-shade-query-popup .hsq-coord{margin-top:2px;color:#94a3b8;font-size:9px;font-weight:650}
      .haidian-shade-query-popup .hsq-status{
        flex:0 0 auto;padding:4px 7px;border-radius:999px;background:#eef2ff;color:#3730a3;
        font-size:10px;font-weight:900;white-space:nowrap
      }
      .haidian-shade-query-popup .hsq-status.is-sun{background:#fff7ed;color:#c2410c}
      .haidian-shade-query-popup .hsq-status.is-shade{background:#eef2ff;color:#4338ca}
      .haidian-shade-query-popup .hsq-status.is-tree{background:#ecfdf5;color:#047857}
      .haidian-shade-query-popup .hsq-status.is-building{background:#eff6ff;color:#1d4ed8}
      .haidian-shade-query-popup .hsq-status.is-mixed{background:#f5f3ff;color:#6d28d9}
      .haidian-shade-query-popup .hsq-status.is-night{background:#f1f5f9;color:#334155}
      .haidian-shade-query-popup .hsq-status.is-unknown{background:#f8fafc;color:#475569}
      .haidian-shade-query-popup .hsq-status.is-pending{background:#f1f5f9;color:#64748b}
      .haidian-shade-query-popup .hsq-main{padding:9px 11px 8px;background:#fff}
      .haidian-shade-query-popup .hsq-metrics{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .haidian-shade-query-popup .hsq-metric{
        padding:8px;border:1px solid #e2e8f0;border-radius:10px;background:#fff
      }
      .haidian-shade-query-popup .hsq-metric-label{color:#64748b;font-size:9px;font-weight:750}
      .haidian-shade-query-popup .hsq-metric-value{margin-top:2px;color:#0f172a;font-size:15px;font-weight:950}
      .haidian-shade-query-popup .hsq-metric small{font-size:9px;color:#94a3b8;font-weight:700}
      .haidian-shade-query-popup .hsq-row{
        display:flex;justify-content:space-between;gap:10px;margin-top:7px;padding-top:7px;
        border-top:1px solid #f1f5f9;font-size:10.5px
      }
      .haidian-shade-query-popup .hsq-row-label{color:#64748b}
      .haidian-shade-query-popup .hsq-row-value{color:#0f172a;font-weight:850;text-align:right}
      .haidian-shade-query-popup .hsq-pending{
        color:#0f766e;font-weight:800;animation:haidianShadeQueryPulse 1.1s ease-in-out infinite
      }
      .haidian-shade-query-popup .hsq-muted{color:#94a3b8;font-weight:700}
      @keyframes haidianShadeQueryPulse{0%,100%{opacity:.48}50%{opacity:1}}
      .haidian-shade-query-popup .hsq-benefit{
        margin-top:8px;padding:8px 9px;border:1px solid #d1fae5;border-radius:10px;background:#f7fffb
      }
      .haidian-shade-query-popup .hsq-benefit-head{
        display:flex;align-items:center;justify-content:space-between;gap:8px;color:#065f46;font-size:10px;font-weight:900
      }
      .haidian-shade-query-popup .hsq-benefit-head small{color:#64748b;font-size:8px;font-weight:750}
      .haidian-shade-query-popup .hsq-benefit-metrics{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
      .haidian-shade-query-popup .hsq-benefit-metric{padding:5px 6px;border-radius:8px;background:#fff;border:1px solid #ecfdf5}
      .haidian-shade-query-popup .hsq-benefit-metric span{display:block;color:#64748b;font-size:8px;font-weight:750}
      .haidian-shade-query-popup .hsq-benefit-metric b{display:block;margin-top:1px;color:#0f172a;font-size:12px}
      .haidian-shade-query-popup .hsq-benefit-split{margin-top:6px;color:#475569;font-size:9px;font-weight:750}
      .haidian-shade-query-popup .hsq-benefit-note{margin-top:4px;color:#94a3b8;font-size:8px;line-height:1.35}

      .haidian-shade-query-popup details.hsq-details{
        margin-top:8px;border-top:1px solid #e2e8f0;padding-top:7px;color:#64748b;font-size:9px
      }
      .haidian-shade-query-popup details.hsq-details summary{
        cursor:pointer;list-style:none;color:#64748b;font-size:9.5px;font-weight:850;user-select:none
      }
      .haidian-shade-query-popup details.hsq-details summary::-webkit-details-marker{display:none}
      .haidian-shade-query-popup details.hsq-details summary:after{content:' ▾'}
      .haidian-shade-query-popup details.hsq-details[open] summary:after{content:' ▴'}
      .haidian-shade-query-popup .hsq-detail-grid{
        display:grid;grid-template-columns:auto 1fr;gap:3px 7px;margin-top:6px;word-break:break-word
      }
      .haidian-shade-query-popup .hsq-detail-grid b{color:#475569;font-weight:800}

      /* Desktop banner: manually collapse the large top banner into a small pill. */
      .haidian-header-minimize-btn{display:none}
      @media (min-width:601px){
        .glass-header{overflow:visible!important}
        .haidian-header-minimize-btn{
          display:flex;position:absolute;left:50%;bottom:-13px;transform:translateX(-50%);
          width:38px;height:24px;align-items:center;justify-content:center;
          border:1px solid rgba(148,163,184,.45);border-radius:0 0 11px 11px;
          background:rgba(255,255,255,.96);color:#475569;cursor:pointer;
          box-shadow:0 5px 12px rgba(15,23,42,.12);z-index:3;font-size:15px;font-weight:900;
          line-height:1;transition:background .18s ease,color .18s ease
        }
        .haidian-header-minimize-btn:hover{background:#ecfdf5;color:#047857}
        .glass-header.haidian-manual-minimized{
          left:50%!important;top:10px!important;transform:translateX(-50%)!important;
          width:auto!important;max-width:235px!important;min-width:0!important;
          padding:8px 34px 8px 12px!important;border-radius:999px!important;gap:6px!important;
          box-shadow:0 5px 16px rgba(15,23,42,.14)!important
        }
        .glass-header.haidian-manual-minimized .nav-buttons{display:none!important}
        .glass-header.haidian-manual-minimized .project-title{
          width:auto!important;margin:0!important;font-size:14px!important;white-space:nowrap!important;
          line-height:1.2!important
        }
        .glass-header.haidian-manual-minimized .project-title .sub-title{display:none!important}
        .glass-header.haidian-manual-minimized .haidian-header-minimize-btn{
          left:auto;right:4px;bottom:auto;top:50%;transform:translateY(-50%);
          width:26px;height:26px;border-radius:50%;border:0;box-shadow:none;background:transparent;
        }
      }
      @media (max-width:600px){
        .haidian-shade-card{padding:9px}
      }
    `;
    document.head.appendChild(style);
  }

  function installDesktopHeaderMinimizer() {
    if (config.headerMinimizeEnabled === false) return false;
    const header = document.querySelector(".glass-header");
    if (!header || document.getElementById("haidianHeaderMinimizeBtn")) return !!header;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "haidianHeaderMinimizeBtn";
    button.className = "haidian-header-minimize-btn";
    header.appendChild(button);

    const storageKey = "haidianHeaderManuallyMinimized";
    const storage = config.headerMinimizeRemember === "local"
      ? window.localStorage
      : window.sessionStorage;
    let minimized = false;
    try { minimized = storage.getItem(storageKey) === "1"; } catch (_) {}

    const render = () => {
      header.classList.toggle("haidian-manual-minimized", minimized);
      button.textContent = minimized ? "⌄" : "⌃";
      button.setAttribute("aria-expanded", minimized ? "false" : "true");
      button.setAttribute("aria-label", minimized ? "展開上方選單" : "縮小上方選單");
      button.title = minimized ? "展開上方選單" : "縮小上方選單";
    };

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      minimized = !minimized;
      try { storage.setItem(storageKey, minimized ? "1" : "0"); } catch (_) {}
      render();
      if (mapRef && typeof mapRef.invalidateSize === "function") {
        window.setTimeout(() => mapRef.invalidateSize({ pan: false }), 180);
      }
    });

    render();
    return true;
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

  function clearShadeDateUpdateTimer() {
    if (shadeDateUpdateTimer) clearTimeout(shadeDateUpdateTimer);
    shadeDateUpdateTimer = null;
  }

  function flushShadeDateUpdate(requestSerial) {
    if (requestSerial != null && requestSerial !== shadeDateRequestSerial) return false;
    shadeDateUpdateTimer = null;
    if (!shadePendingDate) return false;
    if (!state.enabled || !shadeLayer || typeof shadeLayer.setDate !== "function") return false;

    // If the map is moving or this layer is already stale, do not touch it. The
    // replacement renderer is constructed from the latest state.date instead.
    if (
      shadeNavigationSuspended ||
      shadeLayerSerial !== shadeRebuildSerial
    ) return false;

    const desired = new Date(shadePendingDate.getTime());
    const desiredMs = desired.getTime();
    if (shadeAppliedDateMs === desiredMs) {
      shadePendingDate = null;
      return false;
    }

    // Never stack setDate() calls on top of an unfinished WebGL render. Keep only
    // the newest requested time and let onActiveShadeIdle() flush it next.
    if (!shadeReady) return false;

    shadeReady = false;
    setNavigationCanvasState(true);
    setStatus("正在更新太陽位置／陰影時間…");
    const previousAppliedDateMs = shadeAppliedDateMs;
    // Commit ownership of this request before entering SDK code so even a
    // synchronous idle callback cannot recursively issue the same setDate().
    shadeAppliedDateMs = desiredMs;
    shadePendingDate = null;
    try {
      shadeLayer.setDate(desired);
      return true;
    } catch (error) {
      shadeAppliedDateMs = previousAppliedDateMs;
      shadePendingDate = desired;
      shadeReady = true;
      setNavigationCanvasState(false);
      console.warn("[Haidian Shade] setDate:", error);
      setStatus(`時間更新失敗：${error.message || error}`, true);
      return false;
    }
  }

  function applyShadeDate(date, immediate) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
    shadePendingDate = new Date(date.getTime());
    const requestSerial = ++shadeDateRequestSerial;
    clearShadeDateUpdateTimer();

    const wait = immediate === true
      ? 0
      : Math.max(80, Number(config.dateUpdateDebounceMs) || 180);
    shadeDateUpdateTimer = setTimeout(() => {
      flushShadeDateUpdate(requestSerial);
    }, wait);
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
    applyShadeDate(state.date, true);
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
          <b>陰影地形：</b>${escapeHtml(dynamicShadowTerrainLabel(mapRef && mapRef.getCenter ? mapRef.getCenter() : null))}<br>
          <b>臺灣點位海拔：</b>${escapeHtml(officialTerrainConfigured() ? (config.taiwanTerrainLabel || "內政部官方 DTM Terrarium XYZ") : (config.taiwanOfficialDtmLabel || "內政部 DTM 20 m"))}${officialTerrainConfigured() ? "" : "（需安全代理）"}<br>
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
          高解析樹蔭建議在 z14–17 判讀。v7.7 將「點位海拔」與「陰影地形」分開標示：臺灣點位海拔可由內政部 20 m DTM 安全代理取得；
          若設定官方 DTM Terrarium XYZ，臺灣的陰影地形也會改用該官方資料；未設定或 tile 缺失時才使用全球 DEM fallback。兩者不混稱為同一份資料。
          建築高度可能來自 OSM 或預設值，適合環境教育與空間比較，不取代現地測量。
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
      applyShadeDate(state.date, false);
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
        syncPointQueryCursor();
        if (!state.queryOnClick) {
          removePointQueryOverlay();
        } else if (state.enabled) {
          setStatus("點位查詢已開啟：十字游標中心就是 CHMv2 取樣位置。單擊查詢，拖曳仍可移動地圖。");
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
        applyShadeDate(state.date, true);
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

  function tileCenterLatLng(x, y, z) {
    const n = Math.pow(2, z);
    const lng = ((x + 0.5) / n) * 360 - 180;
    const mercY = Math.PI * (1 - 2 * ((y + 0.5) / n));
    const lat = Math.atan(Math.sinh(mercY)) * 180 / Math.PI;
    return { lat, lng };
  }

  function officialTerrainConfigured() {
    return typeof config.taiwanTerrainTileUrl === "string" &&
      config.taiwanTerrainTileUrl.trim().length > 0;
  }

  function globalTerrainSpec(regionCode = null) {
    return {
      id: "global",
      template: config.bareTerrainTileUrl,
      maxZoom: Math.max(0, Number(config.bareTerrainMaxZoom) || 15),
      label: config.bareTerrainLabel || "全球地形 DEM fallback",
      dataset: "global-fallback",
      authoritative: false,
      region: regionCode || null
    };
  }

  function groundTerrainSpecForTile(x, y, z) {
    const center = tileCenterLatLng(x, y, z);
    const region = taiwanOfficialDtmRegion(center);
    if (region && officialTerrainConfigured()) {
      return {
        id: `moi-${region.code}`,
        template: config.taiwanTerrainTileUrl,
        maxZoom: Math.max(0, Number(config.taiwanTerrainMaxZoom) || 14),
        label: config.taiwanTerrainLabel || "內政部官方 DTM Terrarium XYZ",
        dataset: config.taiwanTerrainDatasetLabel || "官方 DTM static tiles",
        authoritative: true,
        region: region.code
      };
    }
    return globalTerrainSpec(region ? region.code : null);
  }

  function dynamicShadowTerrainLabel(latlng) {
    if (latlng && taiwanOfficialDtmRegion(latlng) && officialTerrainConfigured()) {
      return config.taiwanTerrainLabel || "內政部官方 DTM Terrarium XYZ";
    }
    return config.bareTerrainLabel || "全球地形 DEM fallback";
  }

  async function getDemBitmapForSpec(spec, x, y, z) {
    const key = `${spec.id}:${tileKey(x, y, z)}`;
    let promise = demBitmapCache.get(key);
    if (!promise) {
      promise = (async () => {
        const url = fillTemplate(spec.template, x, y, z);
        const response = await fetch(url, { mode: "cors", cache: "force-cache" });
        if (!response.ok) throw new Error(`${spec.label} HTTP ${response.status}`);
        return createImageBitmap(await response.blob());
      })();
      // Do not poison the bitmap cache with a rejected Promise. A transient global
      // terrain failure must be retryable on the next point/tile request.
      promise.catch(() => {
        if (demBitmapCache.get(key) === promise) demBitmapCache.delete(key);
      });
      demBitmapCache.set(key, promise);
      if (demBitmapCache.size > 120) {
        demBitmapCache.delete(demBitmapCache.keys().next().value);
      }
    }
    return promise;
  }

  async function readGroundTerrainHeights(x, y, z) {
    if (!config.metaBlendBareTerrain) return null;

    const spec = groundTerrainSpecForTile(x, y, z);
    const demZ = Math.min(z, spec.maxZoom);
    const factor = 1 << (z - demZ);
    const parentX = Math.floor(x / factor);
    const parentY = Math.floor(y / factor);

    try {
      const bitmap = await getDemBitmapForSpec(spec, parentX, parentY, demZ);
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
      heights.__terrainSpec = spec;
      return heights;
    } catch (error) {
      // If official static terrain is configured but one tile is absent, fail
      // over to the global terrain for continuity instead of breaking ShadeMap.
      if (spec.authoritative) {
        console.warn("[Haidian Shade] official terrain tile missing; using global fallback:", error);
        const fallback = globalTerrainSpec(spec.region);
        try {
          const fallbackZ = Math.min(z, fallback.maxZoom);
          const factor = 1 << (z - fallbackZ);
          const parentX = Math.floor(x / factor);
          const parentY = Math.floor(y / factor);
          const bitmap = await getDemBitmapForSpec(fallback, parentX, parentY, fallbackZ);
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
          heights.__terrainSpec = fallback;
          return heights;
        } catch (fallbackError) {
          console.warn("[Haidian Shade] global terrain fallback also failed:", fallbackError);
          return null;
        }
      }
      console.warn("[Haidian Shade] ground DEM merge skipped:", error);
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
      const dem = await readGroundTerrainHeights(x, y, z);
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
      metaSurfaceMeta.set(key, {
        hasCanopy: !!canopy,
        terrainId: dem && dem.__terrainSpec ? dem.__terrainSpec.id : "none",
        terrainLabel: dem && dem.__terrainSpec ? dem.__terrainSpec.label : "無地面 DEM",
        terrainAuthoritative: !!(dem && dem.__terrainSpec && dem.__terrainSpec.authoritative)
      });
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

    // Point queries must feel immediate. Never start a fresh Overpass request
    // from a click. Reuse the building features already loaded for ShadeMap.
    // If they are not ready yet, return [] and let the core canopy/DEM/shade
    // result render without waiting up to Overpass' 20-second timeout.
    return Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures : [];
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

  function solarPositionAt(latlng, date) {
    const when = date instanceof Date ? date : new Date(date || Date.now());
    const lat = Number(latlng && latlng.lat);
    const lng = Number(latlng && latlng.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Number.isNaN(when.getTime())) {
      return null;
    }

    // Compact SunCalc-style solar position math. The result is adequate for UI
    // semantics (day/night + shadow-source ray direction) and does not add a
    // second network/runtime dependency beside the existing ShadeMap SDK.
    const rad = Math.PI / 180;
    const dayMs = 86400000;
    const J1970 = 2440588;
    const J2000 = 2451545;
    const e = rad * 23.4397;
    const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
    const rightAscension = (l, b) => Math.atan2(
      Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e),
      Math.cos(l)
    );
    const declination = (l, b) => Math.asin(
      Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)
    );
    const azimuth = (H, phi, dec) => Math.atan2(
      Math.sin(H),
      Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)
    );
    const altitude = (H, phi, dec) => Math.asin(
      Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)
    );

    const d = toDays(when);
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const P = rad * 102.9372;
    const L = M + C + P + Math.PI;
    const dec = declination(L, 0);
    const ra = rightAscension(L, 0);
    const lw = rad * -lng;
    const phi = rad * lat;
    const H = rad * (280.16 + 360.9856235 * d) - lw - ra;
    const altitudeRad = altitude(H, phi, dec);
    const azimuthRad = azimuth(H, phi, dec);
    const sunBearingDeg = ((azimuthRad + Math.PI) / rad + 360) % 360;

    return {
      altitudeRad,
      altitudeDeg: altitudeRad / rad,
      azimuthRad,
      sunBearingDeg,
      night: altitudeRad <= 0
    };
  }

  function destinationLatLng(latlng, bearingDeg, distanceM) {
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;
    const phi1 = Number(latlng.lat) * rad;
    const lambda1 = Number(latlng.lng) * rad;
    const theta = Number(bearingDeg) * rad;
    const delta = Math.max(0, Number(distanceM) || 0) / R;
    const sinPhi1 = Math.sin(phi1);
    const cosPhi1 = Math.cos(phi1);
    const sinDelta = Math.sin(delta);
    const cosDelta = Math.cos(delta);
    const phi2 = Math.asin(
      sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta)
    );
    const lambda2 = lambda1 + Math.atan2(
      Math.sin(theta) * sinDelta * cosPhi1,
      cosDelta - sinPhi1 * Math.sin(phi2)
    );
    return {
      lat: phi2 * deg,
      lng: ((lambda2 * deg + 540) % 360) - 180
    };
  }


  function webMercatorPixelCenterLatLng(gx, gy, z) {
    const world = 256 * Math.pow(2, z);
    const x = (Number(gx) + 0.5) / world;
    const y = (Number(gy) + 0.5) / world;
    const lng = x * 360 - 180;
    const merc = Math.PI * (1 - 2 * y);
    const lat = Math.atan(Math.sinh(merc)) * 180 / Math.PI;
    return { lat, lng };
  }

  function latLngFromLocalMeters(origin, x, y) {
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;
    const lat0 = Number(origin && origin.lat) * rad;
    const lng0 = Number(origin && origin.lng) * rad;
    return {
      lat: (lat0 + Number(y || 0) / R) * deg,
      lng: (lng0 + Number(x || 0) / (R * Math.max(0.05, Math.cos(lat0)))) * deg
    };
  }

  function canopyPixelSizeMeters(lat, z) {
    const zoom = Math.max(0, Number(z) || 0);
    const cosLat = Math.max(0.05, Math.cos(Number(lat || 0) * Math.PI / 180));
    return 156543.03392804097 * cosLat / Math.pow(2, zoom);
  }

  async function segmentLocalCanopyPatch(latlng) {
    if (config.queryCanopyBenefitEnabled === false || config.queryCanopyFromCog === false) return null;
    const z = Math.max(10, Math.min(17, Number(config.queryZoom) || 17));
    const seed = latLngToTilePixel(latlng.lat, latlng.lng, z);
    const seedGx = seed.x * 256 + seed.px;
    const seedGy = seed.y * 256 + seed.py;
    const pixelSizeM = canopyPixelSizeMeters(latlng.lat, z);
    const maxRadiusM = Math.max(pixelSizeM, Number(config.queryCanopyBenefitMaxRadiusM) || 14);
    const maxRadiusPx = Math.max(1, Math.ceil(maxRadiusM / pixelSizeM));
    const minHeight = Math.max(0.5, Number(config.queryCanopyBenefitMinHeightM) || 2);
    const maxPixels = Math.max(24, Number(config.queryCanopyBenefitMaxPixels) || 420);
    const worldTiles = Math.pow(2, z);
    const tileRasters = new Map();

    const minGx = Math.max(0, seedGx - maxRadiusPx - 1);
    const maxGx = Math.min(worldTiles * 256 - 1, seedGx + maxRadiusPx + 1);
    const minGy = Math.max(0, seedGy - maxRadiusPx - 1);
    const maxGy = Math.min(worldTiles * 256 - 1, seedGy + maxRadiusPx + 1);
    const minTx = Math.floor(minGx / 256);
    const maxTx = Math.floor(maxGx / 256);
    const minTy = Math.floor(minGy / 256);
    const maxTy = Math.floor(maxGy / 256);
    const tileJobs = [];
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      for (let ty = minTy; ty <= maxTy; ty += 1) {
        const key = tileKey(tx, ty, z);
        tileJobs.push((async () => {
          tileRasters.set(key, await readMetaCanopyTile(tx, ty, z));
        })());
      }
    }
    await Promise.all(tileJobs);

    const valueAt = (gx, gy) => {
      if (gx < minGx || gx > maxGx || gy < minGy || gy > maxGy) return 0;
      const tx = Math.floor(gx / 256);
      const ty = Math.floor(gy / 256);
      const px = gx - tx * 256;
      const py = gy - ty * 256;
      const raster = tileRasters.get(tileKey(tx, ty, z));
      if (!raster) return 0;
      const raw = Number(raster[py * 256 + px]);
      return Number.isFinite(raw) && raw > 0 && raw < 255 ? raw : 0;
    };

    const seedHeight = valueAt(seedGx, seedGy);
    if (!(seedHeight >= minHeight)) return null;

    const queue = [[seedGx, seedGy]];
    let cursor = 0;
    const seen = new Set([`${seedGx},${seedGy}`]);
    const accepted = [];
    let truncated = false;
    const dirs = [
      [-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]
    ];

    while (cursor < queue.length) {
      const [gx, gy] = queue[cursor++];
      const dx = gx - seedGx;
      const dy = gy - seedGy;
      if (Math.hypot(dx, dy) > maxRadiusPx + 0.15) continue;
      const height = valueAt(gx, gy);
      if (!(height >= minHeight)) continue;
      accepted.push({ gx, gy, height });
      if (accepted.length >= maxPixels) {
        truncated = true;
        break;
      }
      for (const [ox, oy] of dirs) {
        const nx = gx + ox;
        const ny = gy + oy;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (Math.hypot(nx - seedGx, ny - seedGy) > maxRadiusPx + 0.15) continue;
        if (valueAt(nx, ny) >= minHeight) queue.push([nx, ny]);
      }
    }

    if (!accepted.length) return null;
    if (!truncated) {
      truncated = accepted.some((p) => Math.hypot(p.gx - seedGx, p.gy - seedGy) >= maxRadiusPx - 0.75);
    }
    let heightSum = 0;
    let maxHeight = 0;
    const pixels = accepted.map((p) => {
      heightSum += p.height;
      maxHeight = Math.max(maxHeight, p.height);
      return {
        ...p,
        latlng: webMercatorPixelCenterLatLng(p.gx, p.gy, z)
      };
    });
    const areaM2 = pixels.length * pixelSizeM * pixelSizeM;
    return {
      center: { lat: Number(latlng.lat), lng: Number(latlng.lng) },
      z,
      seedHeight,
      pixelSizeM,
      pixelCount: pixels.length,
      areaM2,
      equivalentDiameterM: 2 * Math.sqrt(areaM2 / Math.PI),
      meanHeight: heightSum / pixels.length,
      maxHeight,
      maxRadiusM,
      truncated,
      pixels
    };
  }

  function convexHullLocal(points) {
    if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];
    const unique = [];
    const seen = new Set();
    for (const p of points) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }
    if (unique.length < 3) return unique;
    unique.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of unique) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = unique.length - 1; i >= 0; i -= 1) {
      const p = unique[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function buildingReceiverCoverageKnown() {
    if (config.buildingMode === "none" || state.mode === "trees") return false;
    if (config.buildingMode === "custom") return Array.isArray(lastBuildingFeatures);
    return !!lastBuildingCoverageKey;
  }

  function estimateCanopyShadowContribution(patch, solar, buildings = null) {
    if (!patch || !Array.isArray(patch.pixels) || !patch.pixels.length || !solar || solar.night) return null;
    const minAltitude = Math.max(0, Number(config.queryCanopyBenefitMinSolarAltitudeDeg) || 3);
    if (!(solar.altitudeDeg >= minAltitude)) {
      return { unavailableReason: "太陽高度過低；目前投影陰影會超出可靠試算範圍" };
    }
    const tanAlt = Math.tan(Math.max(0.001, solar.altitudeRad));
    const cellM = Math.max(0.75, Number(config.queryCanopyBenefitShadowCellM) || patch.pixelSizeM || 1.25);
    const stepM = Math.max(0.45, Math.min(cellM * 0.72, patch.pixelSizeM || cellM));
    const maxShadowLength = Math.max(10, Number(config.queryCanopyBenefitMaxShadowLengthM) || 90);
    const downBearing = (Number(solar.sunBearingDeg) + 180) % 360;
    const theta = downBearing * Math.PI / 180;
    const dir = { x: Math.sin(theta), y: Math.cos(theta) };
    const cells = new Map();
    let theoreticalMaxLength = 0;

    for (const pixel of patch.pixels) {
      const base = localMetersFromLatLng(patch.center, pixel.latlng);
      const length = Math.min(maxShadowLength, Math.max(0, Number(pixel.height) / tanAlt));
      theoreticalMaxLength = Math.max(theoreticalMaxLength, length);
      const steps = Math.max(1, Math.ceil(length / stepM));
      for (let i = 0; i <= steps; i += 1) {
        const distance = Math.min(length, i * stepM);
        const x = base.x + dir.x * distance;
        const y = base.y + dir.y * distance;
        const ix = Math.floor(x / cellM);
        const iy = Math.floor(y / cellM);
        const key = `${ix},${iy}`;
        if (!cells.has(key)) {
          cells.set(key, {
            ix, iy,
            x: (ix + 0.5) * cellM,
            y: (iy + 0.5) * cellM,
            maxCasterHeight: Number(pixel.height) || 0
          });
        } else {
          cells.get(key).maxCasterHeight = Math.max(cells.get(key).maxCasterHeight, Number(pixel.height) || 0);
        }
      }
    }

    const receiverBuildings = Array.isArray(buildings) ? buildings : (Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures : []);
    const receiverKnown = buildingReceiverCoverageKnown();
    let buildingCells = 0;
    const shadowPoints = [];
    for (const cell of cells.values()) {
      const ll = latLngFromLocalMeters(patch.center, cell.x, cell.y);
      cell.latlng = ll;
      shadowPoints.push({ x: cell.x, y: cell.y, latlng: ll });
      if (receiverKnown && receiverBuildings.some((feature) => pointInPolygonFeature(ll.lng, ll.lat, feature))) {
        cell.receiver = "building";
        buildingCells += 1;
      } else {
        cell.receiver = receiverKnown ? "ground" : "unclassified";
      }
    }

    const cellArea = cellM * cellM;
    const totalAreaM2 = cells.size * cellArea;
    const buildingAreaM2 = receiverKnown ? buildingCells * cellArea : null;
    const groundAreaM2 = receiverKnown ? totalAreaM2 - buildingAreaM2 : null;
    const crownLocal = patch.pixels.map((pixel) => {
      const local = localMetersFromLatLng(patch.center, pixel.latlng);
      return { x: local.x, y: local.y, latlng: pixel.latlng };
    });
    return {
      totalAreaM2,
      groundAreaM2,
      buildingAreaM2,
      receiverKnown,
      groundPercent: receiverKnown && totalAreaM2 > 0 ? groundAreaM2 / totalAreaM2 * 100 : null,
      buildingPercent: receiverKnown && totalAreaM2 > 0 ? buildingAreaM2 / totalAreaM2 * 100 : null,
      shadowCellM: cellM,
      shadowCellCount: cells.size,
      maxShadowLengthM: theoreticalMaxLength,
      downBearingDeg: downBearing,
      crownHull: convexHullLocal(crownLocal),
      shadowHull: convexHullLocal(shadowPoints),
      cells: Array.from(cells.values())
    };
  }

  async function analyzeCanopyBenefitAt(latlng, solar = null) {
    const sun = solar || solarPositionAt(latlng, state.date);
    const patch = await segmentLocalCanopyPatch(latlng);
    if (!patch) return { available: false, reason: "此點未形成可分析的 CHMv2 樹冠片" };
    if (!sun || sun.night) {
      return { available: true, patch, solar: sun, shadow: null, reason: "夜間不計算目前樹冠投影陰影" };
    }
    let receiverBuildings = [];
    try {
      receiverBuildings = await getQueryableBuildings();
    } catch (_) {}
    const shadow = estimateCanopyShadowContribution(patch, sun, receiverBuildings);
    return {
      available: true,
      patch,
      solar: sun,
      shadow,
      reason: shadow && shadow.unavailableReason ? shadow.unavailableReason : ""
    };
  }

  function removeCanopyBenefitOverlay() {
    if (!queryCanopyBenefitLayer || !mapRef) {
      queryCanopyBenefitLayer = null;
      return;
    }
    try {
      if (mapRef.hasLayer(queryCanopyBenefitLayer)) mapRef.removeLayer(queryCanopyBenefitLayer);
    } catch (_) {}
    queryCanopyBenefitLayer = null;
  }

  function drawCanopyBenefitOverlay(result) {
    removeCanopyBenefitOverlay();
    if (config.queryCanopyBenefitOverlay === false || !mapRef || !window.L || !result || !result.patch) return;
    try {
      if (!mapRef.getPane("haidianShadeBenefitPane")) {
        const pane = mapRef.createPane("haidianShadeBenefitPane");
        pane.style.zIndex = "685";
        pane.style.pointerEvents = "none";
      }
      const layers = [];
      const crownHull = result.shadow && Array.isArray(result.shadow.crownHull) ? result.shadow.crownHull : [];
      const shadowHull = result.shadow && Array.isArray(result.shadow.shadowHull) ? result.shadow.shadowHull : [];
      if (crownHull.length >= 3) {
        layers.push(L.polygon(crownHull.map((p) => [p.latlng.lat, p.latlng.lng]), {
          pane: "haidianShadeBenefitPane", color: "#047857", weight: 2, opacity: 0.95, fillColor: "#10b981", fillOpacity: 0.12,
          interactive: false
        }));
      }
      if (shadowHull.length >= 3) {
        layers.push(L.polygon(shadowHull.map((p) => [p.latlng.lat, p.latlng.lng]), {
          pane: "haidianShadeBenefitPane", color: "#6d28d9", weight: 2, opacity: 0.85, dashArray: "5 4", fillColor: "#7c3aed", fillOpacity: 0.10,
          interactive: false
        }));
      }
      if (!layers.length) return;
      queryCanopyBenefitLayer = L.layerGroup(layers).addTo(mapRef);
    } catch (error) {
      console.warn("[Haidian Shade] canopy benefit overlay:", error);
    }
  }

  async function resolveCanopyBenefit(serial, model, targetLatLng, targetKind = "clicked-canopy", priority = 2) {
    if (config.queryCanopyBenefitEnabled === false || !model || !targetLatLng) return;
    const targetKey = `${Number(targetLatLng.lat).toFixed(6)},${Number(targetLatLng.lng).toFixed(6)}:${targetKind}`;
    const currentPriority = Number(model.canopyBenefitTargetPriority) || 0;
    if (model.canopyBenefitResolving && priority < currentPriority) return;
    if (model.canopyBenefitTargetKey === targetKey && (model.canopyBenefitResolving || model.canopyBenefit)) return;

    const localToken = (Number(model.canopyBenefitToken) || 0) + 1;
    model.canopyBenefitToken = localToken;
    model.canopyBenefitTargetKey = targetKey;
    model.canopyBenefitTargetKind = targetKind;
    model.canopyBenefitTargetPriority = priority;
    model.canopyBenefitResolving = true;
    model.canopyBenefit = undefined;
    model.canopyBenefitError = "";
    removeCanopyBenefitOverlay();
    refreshPointQueryTooltip(serial, model);
    try {
      const result = await withTimeout(
        analyzeCanopyBenefitAt(targetLatLng, solarPositionAt(targetLatLng, state.date)),
        Math.max(1800, Number(config.queryCanopyBenefitTimeoutMs) || 5500),
        "樹冠遮蔭試算"
      );
      if (serial !== pointQuerySerial || model.canopyBenefitToken !== localToken) return;
      model.canopyBenefit = result;
      if (result && result.available) drawCanopyBenefitOverlay(result);
    } catch (error) {
      if (serial !== pointQuerySerial || model.canopyBenefitToken !== localToken) return;
      model.canopyBenefit = null;
      model.canopyBenefitError = error && error.message ? error.message : "樹冠遮蔭試算失敗";
    } finally {
      if (serial === pointQuerySerial && model.canopyBenefitToken === localToken) {
        model.canopyBenefitResolving = false;
        refreshPointQueryTooltip(serial, model);
      }
    }
  }

  function buildingHeightMeta(feature) {
    const properties = feature && feature.properties ? feature.properties : {};
    const height = Number(properties.height);
    const source = String(properties.height_source || "");
    const safeHeight = Number.isFinite(height) && height > 0
      ? height
      : Number(config.defaultBuildingHeight) || 3.1;
    let quality = "default";
    if (/^OSM height$/i.test(source) || /自訂 GeoJSON/i.test(source)) quality = "measured";
    else if (/building:levels/i.test(source)) quality = "levels";
    else if (source && !/預設|default/i.test(source)) quality = "estimated";
    return { height: safeHeight, source: source || "預設估計值", quality };
  }

  function buildingHeightForFeature(feature) {
    return buildingHeightMeta(feature).height;
  }

  function localMetersFromLatLng(origin, point) {
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const lat0 = Number(origin && origin.lat) * rad;
    const lat = Number(point && point.lat) * rad;
    const lng0 = Number(origin && origin.lng) * rad;
    const lng = Number(point && point.lng) * rad;
    return {
      x: (lng - lng0) * Math.cos(lat0) * R,
      y: (lat - lat0) * R
    };
  }

  function cross2d(a, b) {
    return a.x * b.y - a.y * b.x;
  }

  function outerRingsForFeature(feature) {
    const geometry = feature && feature.geometry;
    if (!geometry) return [];
    if (geometry.type === "Polygon") {
      return geometry.coordinates && geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
    }
    if (geometry.type === "MultiPolygon") {
      return (geometry.coordinates || []).map((polygon) => polygon && polygon[0]).filter(Boolean);
    }
    return [];
  }

  function featureRayEntryDistance(latlng, feature, bearingDeg, lateralOffsetM = 0) {
    const bearingRad = Number(bearingDeg) * Math.PI / 180;
    const dir = { x: Math.sin(bearingRad), y: Math.cos(bearingRad) };
    const right = { x: Math.cos(bearingRad), y: -Math.sin(bearingRad) };
    const rayOrigin = {
      x: right.x * Number(lateralOffsetM || 0),
      y: right.y * Number(lateralOffsetM || 0)
    };

    const shiftedOrigin = Math.abs(lateralOffsetM) < 0.001
      ? latlng
      : destinationLatLng(
          latlng,
          (Number(bearingDeg) + (lateralOffsetM >= 0 ? 90 : 270)) % 360,
          Math.abs(lateralOffsetM)
        );
    if (pointInPolygonFeature(shiftedOrigin.lng, shiftedOrigin.lat, feature)) return 0;

    let best = Infinity;
    for (const ring of outerRingsForFeature(feature)) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i += 1) {
        const aRaw = ring[i];
        const bRaw = ring[i + 1];
        if (!aRaw || !bRaw) continue;
        const a0 = localMetersFromLatLng(latlng, { lat: Number(aRaw[1]), lng: Number(aRaw[0]) });
        const b0 = localMetersFromLatLng(latlng, { lat: Number(bRaw[1]), lng: Number(bRaw[0]) });
        const a = { x: a0.x - rayOrigin.x, y: a0.y - rayOrigin.y };
        const seg = { x: b0.x - a0.x, y: b0.y - a0.y };
        const denom = cross2d(dir, seg);
        if (Math.abs(denom) < 1e-9) continue;
        const t = cross2d(a, seg) / denom;
        const u = cross2d(a, dir) / denom;
        if (t >= -0.05 && u >= -1e-7 && u <= 1 + 1e-7) best = Math.min(best, Math.max(0, t));
      }
    }
    return Number.isFinite(best) ? best : null;
  }

  function shadeSourceRayOffsets() {
    const width = Math.max(0, Number(config.queryShadeSourceRayWidthM) || 6);
    const step = Math.max(0.5, Math.min(width || 1.5, Number(config.queryShadeSourceRayStepM) || 1.5));
    if (width <= 0) return [0];
    const offsets = [0];
    for (let d = step; d <= width + 1e-6; d += step) {
      offsets.push(-d, d);
    }
    if (Math.abs(offsets[offsets.length - 1]) < width - 1e-6) offsets.push(-width, width);
    return offsets;
  }

  function findBuildingShadowEvidence(latlng, solar) {
    if (!solar || solar.night || state.mode === "trees" || config.buildingMode === "none") return null;
    const buildings = Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures : [];
    if (!buildings.length) return null;

    const tanAlt = Math.tan(Math.max(0.001, solar.altitudeRad));
    const maxDistance = Math.max(20, Number(config.queryShadeSourceMaxDistanceM) || 240);
    const clearance = Math.max(0, Number(config.queryShadeSourceRayClearanceM) || 0.5);
    const unknownMaxHeight = Math.max(6, Number(config.queryShadeSourceUnknownBuildingMaxHeightM) || 24);
    const minCorridorHits = Math.max(1, Number(config.queryShadeSourceCorridorMinHits) || 2);
    const legacyInnerTolerance = Math.max(0, Number(config.queryShadeSourceLegacyInnerToleranceM) || 1.5);
    const baseTolerance = Math.max(0, Number(config.queryShadeSourceRayBaseToleranceM) || 3.5);
    const angularToleranceRad = Math.max(0, Number(config.queryShadeSourceRayAngularToleranceDeg) || 3) * Math.PI / 180;
    const maxRayWidth = Math.max(0, Number(config.queryShadeSourceRayWidthM) || 9);
    const offsets = shadeSourceRayOffsets();
    const confirmed = [];
    const plausible = [];

    for (const feature of buildings) {
      const hits = [];
      for (const offset of offsets) {
        const distance = featureRayEntryDistance(latlng, feature, solar.sunBearingDeg, offset);
        if (!Number.isFinite(distance) || distance > maxDistance) continue;
        hits.push({ distance: Math.max(0, distance), offset });
      }
      if (!hits.length) continue;

      // Allow a slightly wider corridor for a distant caster: a small azimuth
      // mismatch or OSM alignment error grows laterally with distance. Nearby
      // buildings still get only a tight tolerance, while long low-sun shadows
      // can tolerate a few additional metres without opening the full 9 m fan.
      let admissibleHits = hits.filter((hit) => {
        const allowed = Math.min(
          maxRayWidth,
          baseTolerance + hit.distance * Math.tan(angularToleranceRad)
        );
        return Math.abs(hit.offset) <= allowed + 1e-6;
      });
      if (!admissibleHits.length) continue;

      // If the coarse fan catches only one off-center ray, refine immediately
      // around that hit. This distinguishes a real polygon band from a one-pixel
      // edge accident without globally doubling the ray count for every building.
      const hasCenterBeforeRefine = admissibleHits.some((hit) => Math.abs(hit.offset) < 0.05);
      if (!hasCenterBeforeRefine && admissibleHits.length < minCorridorHits) {
        const coarse = admissibleHits[0];
        const rayStep = Math.max(0.5, Number(config.queryShadeSourceRayStepM) || 1.5);
        const refineOffsets = [coarse.offset - rayStep / 2, coarse.offset + rayStep / 2];
        for (const offset of refineOffsets) {
          if (Math.abs(offset) > maxRayWidth + 1e-6) continue;
          if (admissibleHits.some((hit) => Math.abs(hit.offset - offset) < 1e-6)) continue;
          const distance = featureRayEntryDistance(latlng, feature, solar.sunBearingDeg, offset);
          if (!Number.isFinite(distance) || distance > maxDistance) continue;
          const allowed = Math.min(
            maxRayWidth,
            baseTolerance + distance * Math.tan(angularToleranceRad)
          );
          if (Math.abs(offset) <= allowed + 1e-6) admissibleHits.push({ distance: Math.max(0, distance), offset });
        }
      }

      // Prefer the center ray if it exists; otherwise use the nearest lateral
      // probe. The number of agreeing probes is retained as spatial-consensus
      // evidence so a single far-edge hit cannot masquerade as high confidence.
      admissibleHits.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || a.distance - b.distance);
      const centerHit = admissibleHits.find((hit) => Math.abs(hit.offset) < 0.05) || null;
      const chosen = centerHit || admissibleHits[0];
      const distance = chosen.distance;
      const entryOffset = chosen.offset;
      const heightMeta = buildingHeightMeta(feature);
      const requiredHeight = distance * tanAlt + clearance;
      const margin = heightMeta.height - requiredHeight;
      const corridorHitCount = admissibleHits.length;
      // v8.0.2: preserve the v7.9.2 far-edge false-positive guard, but restore
      // v7.9.1 sensitivity inside the original narrow ±1.5 m corridor. A thin
      // or slightly shifted footprint can legitimately intersect only one probe;
      // if that lone probe is close to the center ray, retain it as low-confidence
      // building evidence instead of dropping the source to unknown.
      const legacyInnerFallback = !centerHit
        && corridorHitCount === 1
        && Math.abs(entryOffset) <= legacyInnerTolerance + 1e-6;
      const corridorConsensus = !!centerHit || corridorHitCount >= minCorridorHits || legacyInnerFallback;
      const base = {
        type: "building",
        feature,
        height: heightMeta.height,
        heightSource: heightMeta.source,
        heightQuality: heightMeta.quality,
        distance,
        rayHeight: requiredHeight,
        requiredHeight,
        clearanceMargin: margin,
        corridorOffsetM: entryOffset,
        corridorCentralHit: !!centerHit,
        corridorHitCount,
        corridorProbeCount: offsets.length,
        corridorConsensus,
        corridorLegacyInnerFallback: legacyInnerFallback
      };

      if (margin > 0 && corridorConsensus) {
        let confidence = heightMeta.quality === "measured"
          ? "high"
          : heightMeta.quality === "levels" || heightMeta.quality === "estimated"
            ? "medium"
            : "medium";
        if (!centerHit) confidence = legacyInnerFallback ? "possible" : (Math.abs(entryOffset) <= 3 ? "medium" : "possible");
        confirmed.push({ ...base, confidence, plausibleUnknownHeight: false });
      } else if (heightMeta.quality === "default" && requiredHeight <= unknownMaxHeight && corridorConsensus) {
        // A footprint with no height is useful evidence, but never high confidence.
        // Spatial consensus lets a building survive small OSM alignment errors while
        // the physically required height prevents a distant implausible building
        // from being blamed for the shadow.
        plausible.push({
          ...base,
          confidence: "possible",
          plausibleUnknownHeight: true,
          inferredMinimumHeight: requiredHeight
        });
      }
    }

    const rank = (a, b) => {
      if (a.corridorCentralHit !== b.corridorCentralHit) return a.corridorCentralHit ? -1 : 1;
      if (a.corridorHitCount !== b.corridorHitCount) return b.corridorHitCount - a.corridorHitCount;
      const offsetDelta = Math.abs(a.corridorOffsetM) - Math.abs(b.corridorOffsetM);
      if (Math.abs(offsetDelta) > 1e-6) return offsetDelta;
      return a.distance - b.distance;
    };
    confirmed.sort(rank);
    plausible.sort(rank);
    return confirmed[0] || plausible[0] || null;
  }

  async function findCanopyShadowEvidence(latlng, solar) {
    if (!solar || solar.night || state.mode === "buildings" || config.queryCanopyFromCog === false) return null;
    const tanAlt = Math.tan(Math.max(0.001, solar.altitudeRad));
    const maxConfigured = Math.max(20, Number(config.queryShadeSourceMaxDistanceM) || 240);
    const maxCanopy = Math.max(10, Number(config.queryShadeSourceCanopyMaxHeightM) || 55);
    const step = Math.max(0.75, Number(config.queryShadeSourceSampleStepM) || 1.25);
    const clearance = Math.max(0, Number(config.queryShadeSourceRayClearanceM) || 0.5);
    const maxDistance = Math.min(maxConfigured, maxCanopy / tanAlt + step);
    const samples = [];
    const rasters = new Map();

    for (let distance = 0; distance <= maxDistance; distance += step) {
      const rayHeight = distance * tanAlt + clearance;
      if (rayHeight > maxCanopy) break;
      const sampleLatLng = distance === 0
        ? { lat: Number(latlng.lat), lng: Number(latlng.lng) }
        : destinationLatLng(latlng, solar.sunBearingDeg, distance);
      const tile = queryTileAt(sampleLatLng);
      samples.push({ distance, rayHeight, tile });
      const key = tileKey(tile.x, tile.y, tile.z);
      if (!rasters.has(key)) rasters.set(key, null);
    }

    await Promise.all(Array.from(rasters.keys()).map(async (key) => {
      const [z, x, y] = key.split("/").map(Number);
      const raster = await readMetaCanopyTile(x, y, z);
      rasters.set(key, raster);
    }));

    for (const sample of samples) {
      const key = tileKey(sample.tile.x, sample.tile.y, sample.tile.z);
      const canopy = canopyValueFromRaster(rasters.get(key), sample.tile);
      if (Number.isFinite(canopy) && canopy > sample.rayHeight) {
        return {
          type: "tree",
          height: canopy,
          distance: sample.distance,
          rayHeight: sample.rayHeight,
          clearanceMargin: canopy - sample.rayHeight,
          sampleLatLng: webMercatorPixelCenterLatLng(
            sample.tile.x * 256 + sample.tile.px,
            sample.tile.y * 256 + sample.tile.py,
            sample.tile.z
          ),
          confidence: "high"
        };
      }
    }
    return null;
  }

  function compassDirectionZh(bearingDeg) {
    const labels = [
      "北", "北北東", "東北", "東北東", "東", "東南東", "東南", "南南東",
      "南", "南南西", "西南", "西南偏西", "西", "西北偏西", "西北", "北北西"
    ];
    const bearing = ((Number(bearingDeg) % 360) + 360) % 360;
    return labels[Math.round(bearing / 22.5) % 16];
  }

  async function inferShadeSource(latlng, solar) {
    if (config.queryShadeSourceEnabled === false) {
      return { type: "unknown", reason: "陰影來源判讀已停用" };
    }
    if (!solar || solar.night) return { type: "night", reason: "太陽位於地平線下" };
    const minAltitude = Math.max(0, Number(config.queryShadeSourceMinAltitudeDeg) || 1.5);
    if (solar.altitudeDeg < minAltitude) {
      return { type: "unknown", reason: "太陽接近地平線；遮蔽來源超出可靠判讀距離" };
    }

    const building = findBuildingShadowEvidence(latlng, solar);
    let tree = null;
    let treeError = "";
    try {
      tree = await withTimeout(
        findCanopyShadowEvidence(latlng, solar),
        Math.max(900, Number(config.queryShadeSourceTimeoutMs) || 3600),
        "樹冠陰影來源"
      );
    } catch (error) {
      treeError = error && error.message ? error.message : "樹冠來源讀取失敗";
    }

    const bearingText = `${compassDirectionZh(solar.sunBearingDeg)} ${solar.sunBearingDeg.toFixed(0)}°`;
    const mixedTolerance = Math.max(1, Number(config.queryShadeSourceMixedDistanceToleranceM) || 3);

    if (building && tree) {
      const delta = Math.abs(building.distance - tree.distance);
      if (delta <= mixedTolerance) {
        return {
          type: "mixed",
          building,
          tree,
          confidence: building.plausibleUnknownHeight ? "medium" : "high",
          bearingDeg: solar.sunBearingDeg,
          bearingText,
          method: "反向太陽光線同時命中建築 footprint 與 CHMv2 樹冠；兩者距離接近"
        };
      }
      if (tree.distance < building.distance) {
        return {
          type: "tree",
          tree,
          confidence: "high",
          bearingDeg: solar.sunBearingDeg,
          bearingText,
          method: "反向太陽光線先命中 CHMv2 樹冠，再到達建築候選"
        };
      }
      return {
        type: "building",
        building,
        confidence: building.plausibleUnknownHeight ? "possible" : building.confidence,
        bearingDeg: solar.sunBearingDeg,
        bearingText,
        method: building.plausibleUnknownHeight
          ? "反向太陽光線／空間容差扇形命中 OSM 建築；OSM 缺高度，依遮蔽所需最低高度判為可能建築"
          : "反向太陽光線／空間容差扇形命中 OSM 建築，且建築高度足以截斷太陽視線"
      };
    }
    if (building) {
      return {
        type: "building",
        building,
        confidence: building.plausibleUnknownHeight ? "possible" : building.confidence,
        bearingDeg: solar.sunBearingDeg,
        bearingText,
        method: building.plausibleUnknownHeight
          ? "反向太陽光線／空間容差扇形命中 OSM 建築；OSM 缺高度，依遮蔽所需最低高度判為可能建築"
          : (treeError
              ? "反向太陽光線命中 OSM 建築且高度足夠；樹冠來源查詢未完成"
              : "反向太陽光線／空間容差扇形命中 OSM 建築，且建築高度足以截斷太陽視線")
      };
    }
    if (tree) {
      return {
        type: "tree",
        tree,
        confidence: "high",
        bearingDeg: solar.sunBearingDeg,
        bearingText,
        method: "反向太陽光線沿線的 CHMv2 樹冠高度高於太陽視線"
      };
    }
    return {
      type: "unknown",
      reason: treeError || "反向太陽光線未找到足以解釋此陰影的建築或樹冠",
      bearingDeg: solar.sunBearingDeg,
      bearingText,
      method: "ShadeMap 回傳陰影後，以反向太陽光線檢查 OSM 建築 footprint 與 CHMv2 樹冠"
    };
  }

  async function resolvePointShadeSource(serial, model) {
    if (!model || model.shadeSourceResolving) return;
    const shade = model.shade;
    if (!shade || shade.night || shade.shaded !== true) {
      model.shadeSource = null;
      return;
    }
    model.shadeSourceResolving = true;
    model.shadeSource = undefined;
    refreshPointQueryTooltip(serial, model);
    try {
      const source = await inferShadeSource(model.latlng, model.solar || shade.solar || solarPositionAt(model.latlng, state.date));
      if (serial !== pointQuerySerial) return;
      model.shadeSource = source || { type: "unknown", reason: "無法判讀陰影來源" };
      const sourceTree = model.shadeSource && model.shadeSource.tree;
      if (sourceTree && sourceTree.sampleLatLng && !(Number.isFinite(model.canopy) && model.canopy >= Math.max(0.5, Number(config.queryCanopyBenefitMinHeightM) || 2))) {
        resolveCanopyBenefit(serial, model, sourceTree.sampleLatLng, "shadow-source", 1);
      }
    } catch (error) {
      if (serial !== pointQuerySerial) return;
      model.shadeSource = {
        type: "unknown",
        reason: error && error.message ? error.message : "陰影來源判讀失敗"
      };
    } finally {
      if (serial === pointQuerySerial) {
        model.shadeSourceResolving = false;
        refreshPointQueryTooltip(serial, model);
      }
    }
  }

  async function shadeStatusAt(latlng) {
    const solar = solarPositionAt(latlng, state.date);
    if (solar && solar.night) {
      return { label: "🌙 夜間", shaded: null, night: true, solar };
    }
    if (!shadeLayer || !mapRef) return { label: "陰影未啟用", shaded: null, night: false, solar };
    if (!shadeReady) return { label: "⏳ 陰影計算中…", shaded: null, night: false, solar };
    const point = mapRef.latLngToContainerPoint(latlng);
    try {
      if (typeof shadeLayer.isPositionInShade === "function") {
        const shaded = await Promise.resolve(shadeLayer.isPositionInShade(point.x, point.y));
        return { label: shaded ? "◐ 陰影" : "☀️ 日照", shaded: !!shaded, night: false, solar };
      }
      if (typeof shadeLayer.isPositionInSun === "function") {
        const sunny = await Promise.resolve(shadeLayer.isPositionInSun(point.x, point.y));
        return { label: sunny ? "☀️ 日照" : "◐ 陰影", shaded: !sunny, night: false, solar };
      }
      return { label: "此 SDK 版本不支援點位判讀", shaded: null, night: false, solar };
    } catch (error) {
      console.warn("[Haidian Shade] point shade query:", error);
      return { label: "⏳ 陰影計算中…", shaded: null, night: false, solar };
    }
  }

  function withTimeout(promise, ms, label) {
    const timeout = Math.max(500, Number(ms) || 0);
    if (!timeout) return Promise.resolve(promise);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error(`${label || "資料"}讀取逾時`)),
        timeout
      );
      Promise.resolve(promise).then(
        (value) => { window.clearTimeout(timer); resolve(value); },
        (error) => { window.clearTimeout(timer); reject(error); }
      );
    });
  }

  function queryTileAt(latlng) {
    const qz = Math.max(
      config.metaMinZoom,
      Math.min(config.metaMaxZoom, Number(config.queryZoom) || config.metaMaxZoom)
    );
    return latLngToTilePixel(latlng.lat, latlng.lng, qz);
  }

  function canopyValueFromRaster(raster, tile) {
    if (!raster) return null;
    const raw = Number(raster[tile.index]);
    return raw > 0 && raw < 255 ? raw : 0;
  }

  async function queryCanopyAtTile(tile) {
    if (config.queryCanopyFromCog === false) return null;
    await ensureGeoTIFF();
    const raster = await readMetaCanopyTile(tile.x, tile.y, tile.z);
    return canopyValueFromRaster(raster, tile);
  }

  function taiwanOfficialDtmRegion(latlng) {
    if (!latlng || !Number.isFinite(Number(latlng.lat)) || !Number.isFinite(Number(latlng.lng))) return null;
    const lat = Number(latlng.lat);
    const lng = Number(latlng.lng);

    // Main island first. These are intentionally broad service-selection bounds,
    // not administrative boundary claims. The upstream DTM service remains the
    // authority for whether a point has data.
    if (lng >= 119.9 && lng <= 122.1 && lat >= 21.7 && lat <= 25.6) {
      return { code: "TW", dataset: "TW_DLA_20100101_20191101_20M_3826_DEM" };
    }
    // Penghu and Kinmen dataset identifiers are also exposed by the official API.
    if (lng >= 119.1 && lng <= 119.9 && lat >= 22.9 && lat <= 24.0) {
      return { code: "PH", dataset: "PH_DLA_20100101_20191101_20M_3825_DEM" };
    }
    if (lng >= 118.0 && lng <= 118.7 && lat >= 24.2 && lat <= 24.7) {
      return { code: "KM", dataset: "KM_DLA_20160101_20170101_20M_3825_DEM" };
    }
    return null;
  }

  function officialDtmProxyConfigured() {
    return typeof config.taiwanOfficialDtmProxyUrl === "string" &&
      config.taiwanOfficialDtmProxyUrl.trim().length > 0;
  }

  async function queryOfficialTaiwanDtm(latlng) {
    const region = taiwanOfficialDtmRegion(latlng);
    if (!region) return null;
    if (!officialDtmProxyConfigured()) {
      const error = new Error("官方 DTM 安全代理尚未設定");
      error.code = "OFFICIAL_DTM_NOT_CONFIGURED";
      throw error;
    }

    // About 1 m keying is finer than the source 20 m grid and avoids needless
    // duplicate network calls while preserving deterministic clicked locations.
    const key = `${region.code}:${Number(latlng.lat).toFixed(5)},${Number(latlng.lng).toFixed(5)}`;
    if (officialDtmPointCache.has(key)) return officialDtmPointCache.get(key);

    const promise = (async () => {
      const base = new URL(config.taiwanOfficialDtmProxyUrl, window.location.href);
      base.searchParams.set("lat", Number(latlng.lat).toFixed(7));
      base.searchParams.set("lng", Number(latlng.lng).toFixed(7));
      base.searchParams.set("region", region.code);
      base.searchParams.set("dataset", region.dataset);

      const controller = new AbortController();
      const timeoutMs = Math.max(1000, Number(config.taiwanOfficialDtmTimeoutMs) || 9000);
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(base.toString(), {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          cache: "force-cache",
          headers: { "Accept": "application/json" },
          signal: controller.signal
        });
      } catch (error) {
        if (controller.signal.aborted || (error && error.name === "AbortError")) {
          const timeoutError = new Error(`官方 DTM timeout（${timeoutMs} ms）`);
          timeoutError.code = "OFFICIAL_DTM_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`官方 DTM HTTP ${response.status}`);
      const payload = await response.json();
      const elevation = Number(
        payload && (payload.elevation ?? payload.height ?? payload.z)
      );
      if (!Number.isFinite(elevation)) throw new Error("官方 DTM 回傳缺少有效高程");
      return {
        height: elevation,
        source: String(payload.source || config.taiwanOfficialDtmLabel || "內政部 DTM 20 m"),
        dataset: String(payload.dataset || region.dataset),
        authoritative: true,
        region: region.code
      };
    })();

    officialDtmPointCache.set(key, promise);
    if (officialDtmPointCache.size > 256) {
      officialDtmPointCache.delete(officialDtmPointCache.keys().next().value);
    }
    try {
      return await promise;
    } catch (error) {
      officialDtmPointCache.delete(key);
      throw error;
    }
  }

  async function queryGlobalTerrainFallback(latlng, tile, reason = "") {
    const region = taiwanOfficialDtmRegion(latlng);
    const sampled = await withTimeout(
      sampleGroundTerrainHeightAtTilePixel(tile, globalTerrainSpec(region ? region.code : null)),
      Math.max(1000, Number(config.queryGlobalDemFallbackTimeoutMs) || 4500),
      "全球 DEM 備援"
    );
    if (!sampled || !Number.isFinite(Number(sampled.height))) {
      throw new Error("全球 DEM 備援未回傳有效高程");
    }
    return {
      height: Number(sampled.height),
      source: `${sampled.spec ? sampled.spec.label : (config.bareTerrainLabel || "全球地形 DEM")}（全球備援；非官方 DTM）`,
      dataset: sampled.spec ? sampled.spec.dataset : "global-fallback",
      authoritative: false,
      withheldFallback: false,
      fallback: true,
      fallbackReason: String(reason || "官方 DTM 暫不可用"),
      region: region ? region.code : null
    };
  }

  async function queryPointGround(latlng, tile) {
    const region = taiwanOfficialDtmRegion(latlng);
    if (region && officialTerrainConfigured()) {
      const sampled = await sampleGroundTerrainHeightAtTilePixel(tile);
      return {
        height: sampled ? sampled.height : null,
        source: sampled && sampled.spec ? sampled.spec.label : (config.taiwanTerrainLabel || "內政部官方 DTM Terrarium XYZ"),
        dataset: sampled && sampled.spec ? sampled.spec.dataset : (config.taiwanTerrainDatasetLabel || "official-static-tiles"),
        authoritative: !!(sampled && sampled.spec && sampled.spec.authoritative),
        withheldFallback: false,
        fallback: false,
        fallbackReason: "",
        region: region.code
      };
    }

    if (region && officialDtmProxyConfigured()) {
      try {
        const official = await queryOfficialTaiwanDtm(latlng);
        return Object.assign({ fallback: false, fallbackReason: "" }, official);
      } catch (error) {
        if (config.taiwanGlobalDemFallbackEnabled !== false) {
          console.warn("[Haidian Shade] official DTM unavailable; using global point fallback:", error);
          return queryGlobalTerrainFallback(
            latlng,
            tile,
            error && error.message ? error.message : "官方 DTM 查詢失敗"
          );
        }
        throw error;
      }
    }

    if (region && config.taiwanGlobalDemFallbackEnabled !== false) {
      return queryGlobalTerrainFallback(latlng, tile, "官方 DTM 安全代理尚未設定");
    }

    if (region && config.taiwanHideGlobalDemPointValue !== false) {
      return {
        height: null,
        source: `${config.taiwanOfficialDtmLabel || "內政部 DTM 20 m"}（尚未介接）`,
        dataset: region.dataset,
        authoritative: false,
        withheldFallback: true,
        fallback: false,
        fallbackReason: "",
        region: region.code
      };
    }

    const sampled = await sampleGroundTerrainHeightAtTilePixel(tile);
    return {
      height: sampled ? sampled.height : null,
      source: sampled && sampled.spec ? sampled.spec.label : (config.bareTerrainLabel || "全球地形 DEM"),
      dataset: sampled && sampled.spec ? sampled.spec.dataset : "global-fallback",
      authoritative: !!(sampled && sampled.spec && sampled.spec.authoritative),
      withheldFallback: false,
      fallback: false,
      fallbackReason: "",
      region: region ? region.code : null
    };
  }

  async function sampleGroundTerrainHeightAtTilePixel(tile, forcedSpec = null) {
    if (!config.metaBlendBareTerrain) return null;

    const spec = forcedSpec || groundTerrainSpecForTile(tile.x, tile.y, tile.z);
    const demZ = Math.min(tile.z, spec.maxZoom);
    const factor = 1 << (tile.z - demZ);
    const parentX = Math.floor(tile.x / factor);
    const parentY = Math.floor(tile.y / factor);
    const bitmap = await getDemBitmapForSpec(spec, parentX, parentY, demZ);

    const sourceX = Math.max(0, Math.min(255, Math.floor(((tile.x % factor) * 256 + tile.px) / factor)));
    const sourceY = Math.max(0, Math.min(255, Math.floor(((tile.y % factor) * 256 + tile.py) / factor)));
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, sourceX, sourceY, 1, 1, 0, 0, 1, 1);
    const rgba = ctx.getImageData(0, 0, 1, 1).data;
    return {
      height: rgba[0] * 256 + rgba[1] + rgba[2] / 256 - 32768,
      spec
    };
  }

  function findCachedBuildingAt(latlng) {
    const buildings = Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures : [];
    return buildings.find((feature) =>
      pointInPolygonFeature(latlng.lng, latlng.lat, feature)
    ) || null;
  }

  function pointQueryViewModel(latlng, tile) {
    return {
      latlng,
      queryZoom: tile.z,
      sampleTile: tile,
      canopy: undefined,
      canopyError: "",
      ground: undefined,
      groundError: "",
      groundSource: "",
      groundDataset: "",
      groundAuthoritative: false,
      groundWithheldFallback: false,
      groundFallback: false,
      groundFallbackReason: "",
      shade: undefined,
      solar: solarPositionAt(latlng, state.date),
      shadeSource: undefined,
      shadeSourceResolving: false,
      canopyBenefit: undefined,
      canopyBenefitResolving: false,
      canopyBenefitError: "",
      canopyBenefitTargetKey: "",
      canopyBenefitTargetKind: "",
      canopyBenefitTargetPriority: 0,
      canopyBenefitToken: 0,
      building: findCachedBuildingAt(latlng)
    };
  }


  function canopyBenefitHtml(model) {
    if (!model) return "";
    const minHeight = Math.max(0.5, Number(config.queryCanopyBenefitMinHeightM) || 2);
    const sourceTree = model.shadeSource && model.shadeSource.tree;
    const lowSourceHeight = sourceTree && Number.isFinite(Number(sourceTree.height)) ? Number(sourceTree.height) : null;
    const lowPointHeight = Number.isFinite(Number(model.canopy)) ? Number(model.canopy) : null;
    const hasBenefitState = model.canopyBenefitResolving || model.canopyBenefit !== undefined || !!model.canopyBenefitError;
    if (!hasBenefitState) {
      const candidateHeight = lowSourceHeight > 0 ? lowSourceHeight : lowPointHeight;
      if (Number.isFinite(candidateHeight) && candidateHeight > 0 && candidateHeight < minHeight) {
        const targetLabel = lowSourceHeight > 0 ? "遮蔭來源樹冠" : "點選樹冠片";
        return `<div class="hsq-benefit"><div class="hsq-benefit-head"><span>🌳 樹冠遮蔭試算</span><small>實驗 · ${escapeHtml(targetLabel)}</small></div><div class="hsq-benefit-note">樹冠高度 ${escapeHtml(meters(candidateHeight, 1))}，低於遮蔭面積試算門檻（${escapeHtml(meters(minHeight, 1))}）；保留樹蔭來源判讀，但暫不計算投影面積。</div></div>`;
      }
      return "";
    }
    const targetLabel = model.canopyBenefitTargetKind === "shadow-source" ? "遮蔭來源樹冠" : "點選樹冠片";
    if (model.canopyBenefitResolving) {
      return `<div class="hsq-benefit"><div class="hsq-benefit-head"><span>🌳 樹冠遮蔭試算</span><small>實驗 · ${escapeHtml(targetLabel)}</small></div><div class="hsq-benefit-note">正在從 CHMv2 擷取局部樹冠片並估算目前太陽角度下的投影陰影…</div></div>`;
    }
    if (model.canopyBenefitError) {
      return `<div class="hsq-benefit"><div class="hsq-benefit-head"><span>🌳 樹冠遮蔭試算</span><small>實驗</small></div><div class="hsq-benefit-note">${escapeHtml(model.canopyBenefitError)}</div></div>`;
    }
    const benefit = model.canopyBenefit;
    if (!benefit || !benefit.available || !benefit.patch) {
      const reason = benefit && benefit.reason ? benefit.reason : "目前無法建立可分析的 CHMv2 樹冠片";
      return `<div class="hsq-benefit"><div class="hsq-benefit-head"><span>🌳 樹冠遮蔭試算</span><small>實驗 · ${escapeHtml(targetLabel)}</small></div><div class="hsq-benefit-note">${escapeHtml(reason)}</div></div>`;
    }
    const patch = benefit.patch;
    const shadow = benefit.shadow;
    const area = (value) => Number.isFinite(value) ? `${value < 10 ? value.toFixed(1) : value.toFixed(0)} m²` : "—";
    let shadowMetric = "暫不估算";
    if (!shadow && /夜間/.test(String(benefit.reason || ""))) shadowMetric = "夜間";
    else if (shadow && !shadow.unavailableReason) shadowMetric = area(shadow.totalAreaM2);
    else if (shadow && /太陽高度過低/.test(String(shadow.unavailableReason || ""))) shadowMetric = "太陽過低";
    let split = "";
    if (shadow && !shadow.unavailableReason && shadow.receiverKnown) {
      split = `地表 ${area(shadow.groundAreaM2)}（${shadow.groundPercent.toFixed(0)}%） · 建築 ${area(shadow.buildingAreaM2)}（${shadow.buildingPercent.toFixed(0)}%）`;
    } else if (shadow && !shadow.unavailableReason) {
      split = "接收面分類：目前沒有可確認的建築 coverage；先只顯示總投影面積";
    }
    const noteParts = [
      "CHMv2 raster 局部樹冠片，非單株樹普查",
      patch.truncated ? "樹冠片碰到範圍／像素上限，面積為下限" : "",
      benefit.reason || "",
      shadow && Number.isFinite(shadow.maxShadowLengthM) ? `最遠投影約 ${shadow.maxShadowLengthM.toFixed(0)} m` : ""
    ].filter(Boolean);
    return `<div class="hsq-benefit">
      <div class="hsq-benefit-head"><span>🌳 樹冠遮蔭試算</span><small>實驗 · ${escapeHtml(targetLabel)}</small></div>
      <div class="hsq-benefit-metrics">
        <div class="hsq-benefit-metric"><span>局部樹冠片</span><b>${escapeHtml(area(patch.areaM2))}</b></div>
        <div class="hsq-benefit-metric"><span>目前投影陰影</span><b>${escapeHtml(shadowMetric)}</b></div>
      </div>
      ${split ? `<div class="hsq-benefit-split">${escapeHtml(split)}</div>` : ""}
      <div class="hsq-benefit-note">${escapeHtml(noteParts.join(" · "))}</div>
    </div>`;
  }

  function pointQueryHtmlProgress(model) {
    const latlng = model.latlng;
    const pending = '<span class="hsq-pending">讀取中…</span>';
    const canopyAvailable = Number.isFinite(model.canopy) && model.canopy > 0;
    const canopyText = model.canopy === undefined
      ? pending
      : model.canopyError
        ? '<span class="hsq-muted">暫不可用</span>'
        : model.canopy == null
          ? '<span class="hsq-muted">無資料</span>'
          : canopyAvailable
            ? escapeHtml(meters(model.canopy, model.canopy >= 10 ? 0 : 1))
            : '<span class="hsq-muted">未偵測</span> <small>0 / no-data</small>';

    const inTaiwan = !!taiwanOfficialDtmRegion(latlng);
    const groundAvailable = Number.isFinite(model.ground) && !model.groundWithheldFallback;
    const groundText = model.ground === undefined
      ? pending
      : groundAvailable
        ? `${escapeHtml(meters(model.ground))}${model.groundFallback ? ' <small>全球 DEM</small>' : ''}`
        : "—";

    const canopyTop = groundAvailable && canopyAvailable
      ? model.ground + model.canopy
      : null;
    const solar = model.solar || (model.shade && model.shade.solar) || solarPositionAt(latlng, state.date);
    const isNight = !!(solar && solar.night);
    const source = model.shadeSource;
    const shade = model.shade;

    let statusLabel = "讀取中…";
    let shadeClass = "is-pending";
    let primaryMetricLabel = "日照狀態";
    let primaryMetricValue = pending;

    if (isNight) {
      statusLabel = "🌙 夜間";
      shadeClass = "is-night";
      primaryMetricValue = '🌙 夜間 <small>太陽已落下</small>';
    } else if (shade === undefined) {
      statusLabel = "讀取中…";
    } else if (shade && shade.shaded === false) {
      statusLabel = "☀️ 日照";
      shadeClass = "is-sun";
      primaryMetricValue = "☀️ 直接日照";
    } else if (shade && shade.shaded === true) {
      primaryMetricLabel = "陰影來源";
      if (source === undefined || model.shadeSourceResolving) {
        statusLabel = "◐ 陰影・來源判讀中";
        shadeClass = "is-shade";
        primaryMetricValue = '<span class="hsq-pending">判讀中…</span>';
      } else if (source && source.type === "building") {
        statusLabel = source.confidence === "possible" ? "🏢 可能為建築陰影" : "🏢 建築陰影";
        shadeClass = "is-building";
        const confidence = source.confidence === "high"
          ? "高信心"
          : source.confidence === "medium"
            ? "中信心"
            : source.confidence === "possible"
              ? "可能"
              : "推定";
        primaryMetricValue = `🏢 建築物 <small>${confidence}</small>`;
      } else if (source && source.type === "tree") {
        statusLabel = "🌳 樹蔭";
        shadeClass = "is-tree";
        primaryMetricValue = `🌳 樹冠 <small>${source.confidence === "high" ? "高信心" : "推定"}</small>`;
      } else if (source && source.type === "mixed") {
        statusLabel = "🌳🏢 複合遮蔽";
        shadeClass = "is-mixed";
        primaryMetricValue = `🌳🏢 樹冠＋建築 <small>${source.confidence === "high" ? "高信心" : "中信心"}</small>`;
      } else {
        statusLabel = "◐ 陰影・來源未判定";
        shadeClass = "is-unknown";
        primaryMetricValue = '<span class="hsq-muted">尚未判定</span>';
      }
    } else if (shade && shade.shaded == null) {
      statusLabel = String(shade.label || "陰影判讀暫不可用");
      shadeClass = /計算|讀取/.test(statusLabel) ? "is-pending" : "is-unknown";
      primaryMetricValue = `<span class="hsq-muted">${escapeHtml(statusLabel.replace(/^[^\s]+\s*/, ""))}</span>`;
    }

    const building = model.building;
    const buildingHeight = building && Number(building.properties && building.properties.height);
    const buildingHeightAvailable = Number.isFinite(buildingHeight) && buildingHeight > 0;
    const buildingName = building && building.properties && building.properties.name;
    const heightSource = building && building.properties && building.properties.height_source;
    const time = `${formatDateInput(state.date)} ${String(state.date.getHours()).padStart(2, "0")}:${String(state.date.getMinutes()).padStart(2, "0")}`;

    const secondaryRows = [];
    const sourceBuilding = source && source.building;
    const sourceTree = source && source.tree;
    if (sourceBuilding) {
      const feature = sourceBuilding.feature;
      const name = feature && feature.properties && feature.properties.name;
      secondaryRows.push(["遮蔽建築", escapeHtml(name || "OSM building")]);
      if (sourceBuilding.plausibleUnknownHeight) {
        secondaryRows.push(["建築高度資料", "OSM 未提供"]);
        if (Number.isFinite(sourceBuilding.inferredMinimumHeight)) {
          secondaryRows.push(["遮蔽所需最低高度", escapeHtml(`約 ${meters(sourceBuilding.inferredMinimumHeight)}`)]);
        }
      } else if (Number.isFinite(sourceBuilding.height)) {
        secondaryRows.push(["遮蔽物高度", escapeHtml(meters(sourceBuilding.height))]);
      }
      if (Number.isFinite(sourceBuilding.distance)) {
        secondaryRows.push(["建築遮蔽距離", escapeHtml(sourceBuilding.distance < 1 ? "點位上方" : `約 ${sourceBuilding.distance.toFixed(0)} m`)]);
      }
      if (sourceBuilding.corridorCentralHit === false && Number.isFinite(sourceBuilding.corridorOffsetM)) {
        secondaryRows.push(["幾何容差", escapeHtml(`偏移約 ${Math.abs(sourceBuilding.corridorOffsetM).toFixed(1)} m；鄰近光線一致`)]);
      }
    }
    if (sourceTree) {
      if (Number.isFinite(sourceTree.height)) {
        secondaryRows.push(["遮蔽樹冠高度", escapeHtml(meters(sourceTree.height, sourceTree.height >= 10 ? 0 : 1))]);
      }
      if (Number.isFinite(sourceTree.distance)) {
        secondaryRows.push(["樹冠遮蔽距離", escapeHtml(sourceTree.distance < 1 ? "點位上方" : `約 ${sourceTree.distance.toFixed(0)} m`)]);
      }
    }

    if (building) {
      secondaryRows.push(["點位建築", escapeHtml(buildingName || "OSM building")]);
      if (buildingHeightAvailable) secondaryRows.push(["點位建築高度", escapeHtml(meters(buildingHeight))]);
    }
    if (canopyAvailable) {
      secondaryRows.push(["點位樹冠高度", escapeHtml(meters(model.canopy, model.canopy >= 10 ? 0 : 1))]);
      if (Number.isFinite(canopyTop)) secondaryRows.push(["點位樹冠頂海拔", escapeHtml(meters(canopyTop))]);
    }
    secondaryRows.push(["模擬時間", escapeHtml(time)]);

    const officialStatus = inTaiwan
      ? (model.ground === undefined
          ? "官方 DTM 查詢中"
          : model.groundAuthoritative
            ? "已使用內政部官方 DTM"
            : model.groundFallback
              ? "官方 DTM 暫不可用；已切全球 DEM 備援"
              : officialDtmProxyConfigured()
                ? (model.groundError ? "官方 DTM 查詢失敗" : "官方 DTM 未回傳有效值")
                : "官方 DTM 尚未啟用")
      : "不在臺灣官方 DTM 範圍";

    let canopyInterpretation = "查詢中";
    if (model.canopyError) canopyInterpretation = "讀取失敗";
    else if (model.canopy == null && model.canopy !== undefined) canopyInterpretation = "沒有可讀取資料";
    else if (model.canopy === 0) canopyInterpretation = "0 值：可能無樹或 no-data";
    else if (canopyAvailable) canopyInterpretation = "有效樹冠像素";

    let shadeInterpretation = "讀取中";
    if (isNight) shadeInterpretation = "夜間：太陽位於地平線下，不歸類為樹蔭或建築陰影";
    else if (shade && shade.shaded === false) shadeInterpretation = "ShadeMap SDK：直接日照";
    else if (shade && shade.shaded === true) shadeInterpretation = "ShadeMap SDK：陰影";
    else if (shade && shade.label) shadeInterpretation = String(shade.label);

    let sourceInterpretation = "—";
    if (source === undefined && shade && shade.shaded === true) sourceInterpretation = "判讀中";
    else if (source && source.type === "building") sourceInterpretation = source.confidence === "possible" ? "建築物（可能）" : "建築物（光線追蹤）";
    else if (source && source.type === "tree") sourceInterpretation = "樹冠（光線追蹤）";
    else if (source && source.type === "mixed") sourceInterpretation = "樹冠＋建築（光線追蹤）";
    else if (source && source.type === "unknown") sourceInterpretation = "來源未判定";
    else if (isNight) sourceInterpretation = "不適用";
    else if (shade && shade.shaded === false) sourceInterpretation = "不適用";

    const detailItems = [
      ["日照判讀", shadeInterpretation],
      ["陰影來源", sourceInterpretation],
      ["樹冠資料源", "Meta / WRI CHMv2"],
      ["樹冠判讀", canopyInterpretation],
      ["取樣層級", `z${model.queryZoom}`],
      ["點位高程", groundAvailable ? (model.groundSource || "—") : officialStatus],
      ["陰影地形", dynamicShadowTerrainLabel(latlng)],
      ["研究模式", modeLabel(state.mode)]
    ];
    if (solar && Number.isFinite(solar.altitudeDeg)) {
      detailItems.splice(2, 0, ["太陽高度", `${solar.altitudeDeg.toFixed(1)}°`]);
      detailItems.splice(3, 0, ["太陽方位", `${solar.sunBearingDeg.toFixed(0)}°`]);
    }
    if (source && source.method) detailItems.splice(2, 0, ["來源方法", source.method]);
    if (source && source.bearingText) detailItems.splice(2, 0, ["遮蔽物方向", source.bearingText]);
    if (source && source.confidence) {
      const sourceConfidence = source.confidence === "high"
        ? "高信心"
        : source.confidence === "medium"
          ? "中信心"
          : source.confidence === "possible"
            ? (sourceBuilding && sourceBuilding.plausibleUnknownHeight
                ? "可能；建築高度缺資料"
                : "可能；需較大幾何容差")
            : source.confidence;
      detailItems.splice(2, 0, ["來源信心", sourceConfidence]);
    }
    if (source && source.reason) detailItems.splice(2, 0, ["來源限制", source.reason]);
    if (groundAvailable && model.groundDataset) detailItems.splice(detailItems.length - 2, 0, ["高程資料集", model.groundDataset]);
    if (inTaiwan && model.groundFallback) {
      detailItems.splice(detailItems.length - 2, 0, ["DTM 狀態", officialStatus]);
      detailItems.splice(detailItems.length - 2, 0, ["備援高程說明", "全球 DEM 可出現負高程；低窪區不一定是錯誤，但點位精度低於官方 DTM"]);
      if (model.groundFallbackReason) detailItems.splice(detailItems.length - 2, 0, ["備援原因", model.groundFallbackReason]);
    }
    if (building && heightSource) detailItems.push(["點位建築高度來源", heightSource]);
    if (sourceBuilding && sourceBuilding.feature && sourceBuilding.feature.properties && sourceBuilding.feature.properties.height_source) {
      detailItems.push(["遮蔽建築高度來源", sourceBuilding.feature.properties.height_source]);
    }
    if (model.canopyBenefit && model.canopyBenefit.available && model.canopyBenefit.patch) {
      const benefitPatch = model.canopyBenefit.patch;
      detailItems.push(["樹冠試算物件", "CHMv2 局部連通樹冠片（非單株辨識）"]);
      detailItems.push(["樹冠片最大高度", meters(benefitPatch.maxHeight, benefitPatch.maxHeight >= 10 ? 0 : 1)]);
      detailItems.push(["樹冠片等效直徑", meters(benefitPatch.equivalentDiameterM)]);
      detailItems.push(["樹冠試算限制", "目前為 DSM 垂直柱幾何投影；尚未扣除樹冠孔隙、樹本身被建築遮住等 3D 效應"]);
    }

    return `
      <div class="haidian-shade-query-popup">
        <div class="hsq-head">
          <div>
            <div class="hsq-title">🌤️ 點位日照</div>
            <div class="hsq-coord">${escapeHtml(`${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`)}</div>
          </div>
          <div class="hsq-head-actions">
            <div class="hsq-status ${shadeClass}">${escapeHtml(statusLabel)}</div>
            <button class="hsq-close" type="button" aria-label="關閉點位日照卡片" title="關閉">×</button>
          </div>
        </div>
        <div class="hsq-main">
          <div class="hsq-metrics">
            <div class="hsq-metric">
              <div class="hsq-metric-label">${escapeHtml(primaryMetricLabel)}</div>
              <div class="hsq-metric-value">${primaryMetricValue}</div>
            </div>
            <div class="hsq-metric">
              <div class="hsq-metric-label">地面海拔</div>
              <div class="hsq-metric-value">${groundText}</div>
            </div>
          </div>
          ${secondaryRows.map(([label, value]) => `
            <div class="hsq-row"><span class="hsq-row-label">${escapeHtml(label)}</span><span class="hsq-row-value">${value}</span></div>
          `).join("")}
          ${canopyBenefitHtml(model)}
          <details class="hsq-details">
            <summary>資料與精度</summary>
            <div class="hsq-detail-grid">
              ${detailItems.map(([label, value]) => `<b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span>`).join("")}
            </div>
          </details>
        </div>
      </div>`;
  }

  function refreshPointQueryTooltip(serial, model) {
    if (serial !== pointQuerySerial || !queryPopup) return false;
    queryPopup.setContent(pointQueryHtmlProgress(model));
    if (typeof queryPopup.update === "function") queryPopup.update();
    return true;
  }

  function clearPointShadeRetry() {
    if (pointShadeRetryTimer) {
      clearTimeout(pointShadeRetryTimer);
      pointShadeRetryTimer = null;
    }
  }

  async function refreshActivePointShade() {
    const active = activePointQuery;
    if (!active || active.serial !== pointQuerySerial || !queryPopup) return;
    if (!shadeLayer || !shadeReady) return;
    try {
      const shade = await shadeStatusAt(active.latlng);
      if (!activePointQuery || activePointQuery.serial !== active.serial) return;
      active.model.shade = shade;
      active.model.solar = shade && shade.solar ? shade.solar : active.model.solar;
      if (active.model.canopyBenefitTargetKind === "clicked-canopy" && Number.isFinite(active.model.canopy) && active.model.canopy >= Math.max(0.5, Number(config.queryCanopyBenefitMinHeightM) || 2)) {
        active.model.canopyBenefit = undefined;
        active.model.canopyBenefitTargetKey = "";
        resolveCanopyBenefit(active.serial, active.model, active.latlng, "clicked-canopy", 2);
      } else if (active.model.canopyBenefitTargetKind === "shadow-source") {
        // Shadow-source canopy selection is time-dependent. Drop the old source
        // before re-tracing at the new solar position so its projected footprint
        // never survives a timeline change as stale evidence.
        active.model.canopyBenefitToken = (Number(active.model.canopyBenefitToken) || 0) + 1;
        active.model.canopyBenefit = undefined;
        active.model.canopyBenefitTargetKey = "";
        active.model.canopyBenefitTargetKind = "";
        active.model.canopyBenefitTargetPriority = 0;
        active.model.canopyBenefitResolving = false;
        removeCanopyBenefitOverlay();
      }
      if (shade && shade.shaded === true && !shade.night) {
        resolvePointShadeSource(active.serial, active.model);
      } else {
        active.model.shadeSource = null;
        active.model.shadeSourceResolving = false;
      }
      refreshPointQueryTooltip(active.serial, active.model);
      clearPointShadeRetry();
    } catch (_) {}
  }

  function schedulePointShadeRetry(serial, startedAt) {
    clearPointShadeRetry();
    const start = Number(startedAt) || Date.now();
    const tick = async () => {
      if (
        !activePointQuery ||
        activePointQuery.serial !== serial ||
        serial !== pointQuerySerial ||
        !queryPopup
      ) return;

      if (shadeReady && shadeLayer) {
        await refreshActivePointShade();
        return;
      }

      const elapsed = Date.now() - start;
      if (elapsed >= Math.max(1000, Number(config.queryShadeRetryTimeoutMs) || 10000)) {
        activePointQuery.model.shade = {
          label: "陰影仍在背景計算；完成後再點一次可重新判讀",
          shaded: null
        };
        refreshPointQueryTooltip(serial, activePointQuery.model);
        clearPointShadeRetry();
        return;
      }

      pointShadeRetryTimer = setTimeout(
        tick,
        Math.max(100, Number(config.queryShadeRetryMs) || 250)
      );
    };
    pointShadeRetryTimer = setTimeout(
      tick,
      Math.max(100, Number(config.queryShadeRetryMs) || 250)
    );
  }

  function onActiveShadeIdle(layer, serial) {
    if (
      !state.enabled ||
      layer !== shadeLayer ||
      serial !== shadeLayerSerial ||
      serial !== shadeRebuildSerial ||
      shadeNavigationSuspended
    ) return;

    shadeReady = true;
    markActiveShadeCanvases();
    enforceShadeCanvasInvariant("idle");

    // A newer time may have been requested while the previous setDate()/initial
    // render was still running. Chain only the latest request and keep the canvas
    // hidden; do not flash an intermediate framebuffer.
    if (shadePendingDate) {
      const pendingMs = shadePendingDate.getTime();
      if (shadeAppliedDateMs !== pendingMs) {
        if (flushShadeDateUpdate()) return;
        if (!shadeReady) return;
      } else {
        shadePendingDate = null;
      }
    }

    // Reveal only the single current-owner canvas after the CURRENT generation
    // is idle. Retired siblings stay hidden and are scrubbed after this safe point.
    setNavigationCanvasState(false);
    setStatus(`陰影計算完成：${modeLabel(state.mode)}。`);
    scheduleRetiredCanvasScrub(260);
    refreshActivePointShade();
  }

  function activePopupClassName() {
    const popup = mapRef && mapRef._popup;
    if (!popup) return "";

    // Leaflet keeps map._popup pointing at the last popup object even after
    // popup.close()/map.removeLayer(popup).  That stale reference must not keep
    // shade point-query permanently disabled after the host submit popup closes.
    // Prefer the public layer-membership check; fall back to Popup._map only when
    // hasLayer() is unavailable (older/custom Leaflet hosts).
    if (mapRef && typeof mapRef.hasLayer === "function") {
      try {
        if (!mapRef.hasLayer(popup)) return "";
      } catch (_) {}
    } else if (Object.prototype.hasOwnProperty.call(popup, "_map") && popup._map !== mapRef) {
      return "";
    }

    return String(
      popup.options && popup.options.className
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

  function syncPointQueryCursor() {
    if (!mapRef || !mapRef.getContainer) return;
    const container = mapRef.getContainer();
    if (!container) return;
    container.classList.toggle(
      "haidian-shade-query-active",
      !!(state.enabled && state.queryOnClick)
    );
  }

  function removePointQueryOverlay() {
    clearPointShadeRetry();
    removeCanopyBenefitOverlay();
    activePointQuery = null;
    if (!mapRef) {
      queryPopup = null;
      queryPointMarker = null;
      querySampleCell = null;
      return;
    }
    try {
      if (queryPopup && mapRef.hasLayer(queryPopup)) mapRef.removeLayer(queryPopup);
      if (queryPointMarker && mapRef.hasLayer(queryPointMarker)) mapRef.removeLayer(queryPointMarker);
      if (querySampleCell && mapRef.hasLayer(querySampleCell)) mapRef.removeLayer(querySampleCell);
    } catch (_) {}
    queryPopup = null;
    queryPointMarker = null;
    querySampleCell = null;
  }

  function drawQuerySampleCell(tile) {
    if (!mapRef || !tile || !window.L) return;
    try {
      if (querySampleCell && mapRef.hasLayer(querySampleCell)) {
        mapRef.removeLayer(querySampleCell);
      }
      querySampleCell = null;
      if (!mapRef.getPane("haidianShadeQueryPane")) {
        const pane = mapRef.createPane("haidianShadeQueryPane");
        pane.style.zIndex = "690";
        pane.style.pointerEvents = "none";
      }
      const gx = tile.x * 256 + tile.px;
      const gy = tile.y * 256 + tile.py;
      const nw = mapRef.unproject(L.point(gx, gy), tile.z);
      const se = mapRef.unproject(L.point(gx + 1, gy + 1), tile.z);
      querySampleCell = L.rectangle(L.latLngBounds(nw, se), {
        pane: "haidianShadeQueryPane",
        color: "#0f766e",
        weight: 2,
        opacity: 0.95,
        fillColor: "#ffffff",
        fillOpacity: 0.10,
        interactive: false
      }).addTo(mapRef);
    } catch (error) {
      console.warn("[Haidian Shade] sample cell:", error);
    }
  }

  let pointQuerySerial = 0;

  function closePointQueryOverlay() {
    // Invalidate all in-flight async work so a late response cannot resurrect
    // the marker, canopy-benefit overlay, or tooltip after the user closes it.
    pointQuerySerial += 1;
    removePointQueryOverlay();
  }

  function bindPointQueryTooltipControls() {
    if (!queryPopup) return;
    const element = typeof queryPopup.getElement === "function"
      ? queryPopup.getElement()
      : queryPopup._container;
    if (!element || element.__haidianShadeQueryControlsBound || typeof element.addEventListener !== "function") return;
    element.__haidianShadeQueryControlsBound = true;
    element.addEventListener("click", (event) => {
      const target = event && event.target;
      const close = target && typeof target.closest === "function" ? target.closest(".hsq-close") : null;
      if (!close) return;
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      closePointQueryOverlay();
    });
  }

  async function handleMapPointQuery(event) {
    if (!state.enabled || !state.queryOnClick || !mapRef || !window.L) return;
    if (mapPointQueryShouldYield(event)) return;

    const serial = ++pointQuerySerial;
    const latlng = event.latlng;
    const tile = queryTileAt(latlng);
    const model = pointQueryViewModel(latlng, tile);

    removePointQueryOverlay();
    activePointQuery = { serial, latlng, model, startedAt: Date.now() };
    queryPointMarker = L.marker(latlng, {
      interactive: false,
      keyboard: false,
      zIndexOffset: 4900,
      icon: L.divIcon({
        className: "haidian-shade-query-target",
        html: "<span><i></i></span>",
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      })
    }).addTo(mapRef);

    // Draw the exact CHMv2 sample cell immediately; it does not need network data.
    drawQuerySampleCell(tile);

    // Keep the point card above the query-cell/canopy-benefit panes. Leaflet's
    // default tooltip pane is z650, while those diagnostic overlays live at
    // z685/z690; without a dedicated pane their polygons can paint over the card.
    if (!mapRef.getPane("haidianShadeQueryTooltipPane")) {
      const pane = mapRef.createPane("haidianShadeQueryTooltipPane");
      pane.style.zIndex = "720";
    }
    queryPopup = L.tooltip({
      permanent: true,
      direction: "top",
      offset: [0, -10],
      opacity: 1,
      interactive: true,
      pane: "haidianShadeQueryTooltipPane",
      className: "haidian-shade-query-tooltip"
    })
      .setLatLng(latlng)
      .setContent(pointQueryHtmlProgress(model))
      .addTo(mapRef);
    bindPointQueryTooltipControls();

    // 1) Shade status: independent and usually available immediately.
    shadeStatusAt(latlng).then((shade) => {
      if (serial !== pointQuerySerial) return;
      model.shade = shade;
      model.solar = shade && shade.solar ? shade.solar : model.solar;
      if (shade && shade.shaded === true && !shade.night) {
        resolvePointShadeSource(serial, model);
      } else {
        model.shadeSource = null;
        model.shadeSourceResolving = false;
      }
      refreshPointQueryTooltip(serial, model);
      if (shade && shade.shaded == null && !shade.night && /計算/.test(String(shade.label || ""))) {
        schedulePointShadeRetry(serial, activePointQuery && activePointQuery.startedAt);
      }
    }).catch(() => {
      if (serial !== pointQuerySerial) return;
      model.shade = { label: "陰影判讀暫不可用", shaded: null };
      refreshPointQueryTooltip(serial, model);
      schedulePointShadeRetry(serial, activePointQuery && activePointQuery.startedAt);
    });

    // 2) Canopy: often already in cache because the visible ShadeMap surface used it.
    withTimeout(
      queryCanopyAtTile(tile),
      config.queryCanopyTimeoutMs,
      "CHMv2"
    ).then((canopy) => {
      if (serial !== pointQuerySerial) return;
      model.canopy = canopy;
      if (Number.isFinite(canopy) && canopy >= Math.max(0.5, Number(config.queryCanopyBenefitMinHeightM) || 2)) {
        resolveCanopyBenefit(serial, model, latlng, "clicked-canopy", 2);
      }
      refreshPointQueryTooltip(serial, model);
    }).catch((error) => {
      if (serial !== pointQuerySerial) return;
      model.canopy = null;
      model.canopyError = error && error.message ? error.message : "CHMv2 讀取失敗";
      refreshPointQueryTooltip(serial, model);
    });

    // 3) Ground elevation: in Taiwan, prefer the official MOI 20 m DTM via a
    // server-side proxy. The secret/api_key never enters this browser bundle.
    // Elsewhere (or when explicitly allowed) use the global DEM fallback.
    withTimeout(
      queryPointGround(latlng, tile),
      Math.max(3000, Number(config.queryGroundTotalTimeoutMs) || 14500),
      "地面高程"
    ).then((groundResult) => {
      if (serial !== pointQuerySerial) return;
      model.ground = groundResult ? groundResult.height : null;
      model.groundSource = groundResult ? groundResult.source : "—";
      model.groundDataset = groundResult ? groundResult.dataset : "";
      model.groundAuthoritative = !!(groundResult && groundResult.authoritative);
      model.groundWithheldFallback = !!(groundResult && groundResult.withheldFallback);
      model.groundFallback = !!(groundResult && groundResult.fallback);
      model.groundFallbackReason = groundResult && groundResult.fallbackReason ? String(groundResult.fallbackReason) : "";
      refreshPointQueryTooltip(serial, model);
    }).catch((error) => {
      if (serial !== pointQuerySerial) return;
      model.ground = null;
      model.groundSource = taiwanOfficialDtmRegion(latlng)
        ? (config.taiwanOfficialDtmLabel || "內政部 DTM 20 m")
        : (config.bareTerrainLabel || "全球地形 DEM");
      model.groundError = error && error.message ? error.message : "地面高程讀取失敗";
      model.groundFallback = false;
      model.groundFallbackReason = "";
      refreshPointQueryTooltip(serial, model);
    });

    // Building lookup is intentionally synchronous from the already-loaded cache.
    refreshPointQueryTooltip(serial, model);
  }

  function hookMapPointQuery() {
    if (!mapRef || mapQueryHooked || typeof mapRef.on !== "function") return;
    mapQueryHooked = true;

    const clearQueryForNavigation = () => {
      lastMapDragAt = Date.now();
      pointQuerySerial += 1;
      removePointQueryOverlay();
    };

    // Query markers/cells describe one exact viewport sample. They must never
    // survive pan/zoom/view reset, regardless of ShadeMap research mode.
    mapRef.on("movestart", clearQueryForNavigation);
    mapRef.on("zoomstart", clearQueryForNavigation);
    mapRef.on("viewreset", clearQueryForNavigation);
    mapRef.on("zoomlevelschange", clearQueryForNavigation);
    mapRef.on("dragend", () => { lastMapDragAt = Date.now(); });
    mapRef.on("click", handleMapPointQuery);
    if (typeof document.addEventListener === "function") {
      document.addEventListener("keydown", (event) => {
        if (!queryPopup || !activePointQuery || !event || event.key !== "Escape") return;
        closePointQueryOverlay();
      });
    }
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
    return snapshotCoverageSignature(captureViewSnapshot());
  }

  async function runWithConcurrency(items, concurrency, task, progressSerial) {
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
        if (
          (done === 1 || done % 12 === 0 || done === items.length) &&
          (progressSerial == null || progressSerial === shadeRebuildSerial)
        ) {
          setStatus(`正在準備 Meta CHMv2 樹冠高度… ${done}/${items.length}`);
        }
      }
    };

    const count = Math.max(1, Math.min(concurrency, items.length || 1));
    await Promise.all(Array.from({ length: count }, worker));
    return results;
  }

  async function prepareLiveMetaSurface(snapshot, serial) {
    await ensureGeoTIFF();
    if (!mapRef) throw new Error("Leaflet map 尚未就緒。");

    const view = snapshot || captureViewSnapshot();
    if (!view) throw new Error("無法取得目前地圖視野。");

    // Freeze zoom/bounds at rebuild start. If the user moves again, the serial
    // becomes stale and this preparation is allowed to finish only as cache
    // warming; it will never mount an obsolete ShadeMap layer.
    const mapZoom = view.zoom;
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
    const bounds = snapshotBounds(view);
    for (const z of zooms) {
      const range = tileRangeForBounds(bounds, z, buffer);
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
      (tile) => buildLiveSurfaceTile(tile.x, tile.y, tile.z),
      serial
    );
    const loaded = results.filter(Boolean).length;
    if (!loaded) throw new Error("目前視野無法建立地形 surface tiles。");

    const canopyTiles = tiles.reduce((count, tile) => {
      const info = metaSurfaceMeta.get(tileKey(tile.x, tile.y, tile.z));
      return count + (info && info.hasCanopy ? 1 : 0);
    }, 0);
    const officialTerrainTiles = tiles.reduce((count, tile) => {
      const info = metaSurfaceMeta.get(tileKey(tile.x, tile.y, tile.z));
      return count + (info && info.terrainAuthoritative ? 1 : 0);
    }, 0);
    const globalTerrainTiles = tiles.reduce((count, tile) => {
      const info = metaSurfaceMeta.get(tileKey(tile.x, tile.y, tile.z));
      return count + (info && info.terrainId === "global" ? 1 : 0);
    }, 0);

    return { loaded, canopyTiles, officialTerrainTiles, globalTerrainTiles, total: tiles.length, zooms, snapshot: view };
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

  function paddedBuildingBounds(bounds) {
    const paddingM = Math.max(0, Number(config.buildingShadowFetchPaddingM) || 0);
    if (!paddingM || !bounds) return {
      south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast()
    };
    const centerLat = (bounds.getSouth() + bounds.getNorth()) / 2;
    const latPad = paddingM / 111320;
    const lngPad = paddingM / (111320 * Math.max(0.2, Math.cos(centerLat * Math.PI / 180)));
    return {
      south: bounds.getSouth() - latPad,
      west: bounds.getWest() - lngPad,
      north: bounds.getNorth() + latPad,
      east: bounds.getEast() + lngPad
    };
  }

  async function loadOSMBuildings() {
    if (!mapRef || mapRef.getZoom() < config.buildingMinZoom) return [];

    const bounds = mapRef.getBounds();
    const padded = paddedBuildingBounds(bounds);
    const key = [padded.south, padded.west, padded.north, padded.east].map((v) => Number(v).toFixed(3)).join(",");

    if (overpassCache.has(key)) {
      return overpassCache.get(key).then((features) => {
        lastBuildingFeatures = Array.isArray(features) ? features : [];
        lastBuildingCoverageKey = key;
        return lastBuildingFeatures;
      });
    }

    const query =
      `[out:json][timeout:20];` +
      `way["building"](` +
      `${padded.south},${padded.west},` +
      `${padded.north},${padded.east}` +
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

        lastBuildingFeatures = features;
        lastBuildingCoverageKey = key;
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

  async function selectTerrainSource(snapshot, serial) {
    const view = snapshot || captureViewSnapshot();
    if (state.mode === "buildings") {
      return {
        source: bareTerrainSource(),
        meta: false,
        warning: ""
      };
    }

    if (view && view.zoom < config.metaMinZoom) {
      return {
        source: bareTerrainSource(),
        meta: false,
        warning:
          `目前縮放層級 z${view.zoom} 低於高解析樹冠陰影層級 z${config.metaMinZoom}；` +
          "CHMv2 可全球移動查詢，請在任何地點放大後即可載入當地樹冠。"
      };
    }

    if (config.metaMode === "live-cog") {
      const prepared = await prepareLiveMetaSurface(view, serial);
      const hasCanopy = prepared.canopyTiles > 0;
      const canopySummary = `${prepared.canopyTiles}/${prepared.total} canopy tiles`;
      const terrainSummary = prepared.officialTerrainTiles
        ? `官方 DTM ${prepared.officialTerrainTiles}/${prepared.total} tiles` +
          (prepared.globalTerrainTiles ? `，全球 fallback ${prepared.globalTerrainTiles}/${prepared.total}` : "")
        : `全球 DEM ${prepared.globalTerrainTiles || prepared.total}/${prepared.total} tiles`;
      return {
        source: liveMetaTerrainSource(),
        meta: hasCanopy,
        warning: hasCanopy
          ? (config.metaBlendBareTerrain
              ? `全球 CHMv2 已載入目前視野（z${prepared.zooms.join("/")}，${canopySummary}），地面來源：${terrainSummary}；移動到其他地區會自動載入當地資料。`
              : `全球 CHMv2 已載入目前視野（z${prepared.zooms.join("/")}，${canopySummary}）；目前未疊加地面 DEM。`)
          : `目前視野沒有可讀取的 CHMv2 樹冠像素；陰影以 ${terrainSummary}／建築計算。移到其他地區或放大後會重新嘗試載入。`
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

  function shouldConstrainMapZoomForShade() {
    return config.lockMapMaxZoomToMeta !== false && state.mode !== "buildings";
  }

  function applyShadeZoomConstraint() {
    if (!mapRef || typeof mapRef.setMaxZoom !== "function") return;
    if (!shouldConstrainMapZoomForShade()) {
      restoreShadeZoomConstraint();
      return;
    }

    if (!shadeZoomConstraintApplied) {
      const currentMax = typeof mapRef.getMaxZoom === "function" ? mapRef.getMaxZoom() : null;
      shadePreviousMaxZoom = Number.isFinite(currentMax) ? currentMax : null;
      shadeZoomConstraintApplied = true;
    }

    const limit = Number(config.metaMaxZoom) || 17;
    mapRef.setMaxZoom(limit);
    if (mapRef.getZoom() > limit) {
      mapRef.setZoom(limit, { animate: false });
    }
  }

  function restoreShadeZoomConstraint() {
    if (!mapRef || !shadeZoomConstraintApplied) return;
    try {
      if (typeof mapRef.setMaxZoom === "function" && Number.isFinite(shadePreviousMaxZoom)) {
        mapRef.setMaxZoom(shadePreviousMaxZoom);
      }
    } catch (_) {}
    shadePreviousMaxZoom = null;
    shadeZoomConstraintApplied = false;
  }

  async function mountPreparedShadeLayer(terrain, serial) {
    if (!config.apiKey || config.apiKey === "YOUR_SHADEMAP_API_KEY") {
      throw new Error("尚未填入 ShadeMap API key。");
    }
    if (!mapRef || serial !== shadeRebuildSerial || !state.enabled) return null;

    await ensureEngine();
    if (serial !== shadeRebuildSerial || !state.enabled) return null;

    // Validate browser capability without touching any SDK-owned canvas.
    const webgl = webglCapability();
    if (!webgl.webgl && !webgl.webgl2) {
      throw new Error("瀏覽器目前無法建立 WebGL context；請確認硬體加速/WebGL 已啟用。");
    }
    clearCanvasCleanupTimers();

    const mountDate = new Date(state.date.getTime());
    const layer = L.shadeMap({
      date: mountDate,
      color: config.defaultColor,
      opacity: state.opacity,
      apiKey: config.apiKey,
      terrainSource: terrain.source,
      getFeatures: getBuildings,
      debug: (message) =>
        console.debug("[Haidian ShadeMap]", message)
    });

    beginShadeCanvasOwnership(serial);
    shadeLayer = layer;
    shadeLayerSerial = serial;
    shadeReady = false;
    shadeAppliedDateMs = mountDate.getTime();
    if (shadePendingDate && shadePendingDate.getTime() === shadeAppliedDateMs) {
      shadePendingDate = null;
    }

    const idleHandler = () => onActiveShadeIdle(layer, serial);
    shadeIdleHandler = idleHandler;
    if (layer && typeof layer.on === "function") {
      layer.on("idle", idleHandler);
    }

    try {
      layer.addTo(mapRef);
    } catch (error) {
      try {
        if (idleHandler && layer && typeof layer.off === "function") layer.off("idle", idleHandler);
      } catch (_) {}
      try {
        if (layer && typeof layer.remove === "function") layer.remove();
      } catch (_) {}
      if (shadeLayer === layer) {
        shadeLayer = null;
        shadeLayerSerial = 0;
        shadeIdleHandler = null;
        shadeReady = false;
        shadeAppliedDateMs = null;
        shadeCanvasMountBaseline = null;
        shadeActiveCanvas = null;
      }
      if (isWebGLContextFailure(error)) {
        const webgl = webglCapability();
        error.message = `${error.message || error}（WebGL preflight: webgl=${webgl.webgl}, webgl2=${webgl.webgl2}）`;
      }
      throw error;
    }

    markActiveShadeCanvases();
    enforceShadeCanvasInvariant("mount");
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (shadeLayer === layer && shadeLayerSerial === serial) markActiveShadeCanvases();
      });
    }
    setTimeout(() => {
      if (shadeLayer === layer && shadeLayerSerial === serial) markActiveShadeCanvases();
    }, 120);

    return layer;
  }

  function setNavigationCanvasState(active) {
    if (!mapRef || !mapRef.getContainer) return;
    const container = mapRef.getContainer();
    if (!container) return;
    container.classList.toggle("haidian-shade-navigation", !!active);
  }

  function detachShadeLayerOnly(options) {
    const opts = options || {};
    const layer = shadeLayer;
    const idleHandler = shadeIdleHandler;

    // Hide the current SDK canvas before calling the SDK's documented remove().
    // Do not force context loss or delete SDK-owned DOM synchronously.
    retireActiveShadeCanvases();

    shadeLayer = null;
    shadeLayerSerial = 0;
    shadeIdleHandler = null;
    shadeReady = false;
    shadeAppliedDateMs = null;
    shadeCanvasMountBaseline = null;
    shadeActiveCanvas = null;

    if (layer) {
      try {
        if (idleHandler && typeof layer.off === "function") {
          layer.off("idle", idleHandler);
        }
      } catch (_) {}
      try {
        if (mapRef && typeof mapRef.hasLayer === "function" && mapRef.hasLayer(layer)) {
          mapRef.removeLayer(layer);
        }
      } catch (_) {}
      try {
        if (typeof layer.remove === "function") layer.remove();
      } catch (_) {}
    }

    if (opts.scheduleScrub !== false) scheduleRetiredCanvasScrub();
  }

  async function enableShade() {
    if (!mapRef) {
      setStatus("找不到 Leaflet map。", true);
      return;
    }

    state.enabled = true;
    syncPointQueryCursor();
    initShadeCanvasBaseline();
    installShadeCanvasObserver();
    applyShadeZoomConstraint();
    setNavigationCanvasState(true);

    const serial = ++shadeRebuildSerial;
    const snapshot = captureViewSnapshot();

    try {
      setStatus("正在載入陰影模擬所需的 CHMv2／地形資料…");
      const terrain = await selectTerrainSource(snapshot, serial);

      // Critical v7.5 rule: a stale async terrain preparation may warm caches,
      // but it is NEVER allowed to create/add a ShadeMap layer.
      if (serial !== shadeRebuildSerial || !state.enabled) return;

      const layer = await mountPreparedShadeLayer(terrain, serial);
      if (!layer || serial !== shadeRebuildSerial || !state.enabled) return;

      syncCanopyOverlay();
      lastLiveViewSignature = snapshotCoverageSignature(snapshot);
      // Keep the SDK canvas hidden until onActiveShadeIdle() confirms that this
      // exact renderer generation has completed its first frame.

      if (terrain.warning) {
        setStatus(`${terrain.warning} 陰影引擎正在完成畫面計算…`, !terrain.meta);
      } else {
        setStatus(`已載入：${modeLabel(state.mode)}；陰影引擎正在完成畫面計算…`);
      }
    } catch (error) {
      if (serial !== shadeRebuildSerial || !state.enabled) return;
      console.error(error);
      detachShadeLayerOnly();
      state.enabled = false;
      syncPointQueryCursor();
      restoreShadeZoomConstraint();
      setNavigationCanvasState(false);
      const toggle = document.getElementById("haidianShadeToggle");
      if (toggle) toggle.checked = false;
      setStatus(`啟動失敗：${error.message || error}`, true);
    }
  }

  function suspendShadeForNavigation() {
    if (!state.enabled || state.mode === "buildings" || config.metaMode !== "live-cog") return;
    shadeNavigationSuspended = true;
    setNavigationCanvasState(true);
    // v7.8.6: do NOT destroy the WebGL layer at every movestart. Keep the old
    // renderer hidden while terrain/data preparation runs, then replace it once
    // after navigation settles. It is never directly revealed for a changed
    // viewport, even when CHMv2 coverage tiles are unchanged.
    if (config.preserveShadeLayerDuringNavigation === false) detachShadeLayerOnly();
    removePointQueryOverlay();
    setStatus("地圖移動中：暫時隱藏陰影；停下後更新目前視野…");
  }

  function disableShade(updateStatus = true) {
    shadeRebuildSerial += 1;
    shadeNavigationSuspended = false;
    clearTimeout(liveMoveTimer);
    clearShadeDateUpdateTimer();
    shadeDateRequestSerial += 1;
    shadePendingDate = null;
    shadeAppliedDateMs = null;
    clearPointShadeRetry();
    detachShadeLayerOnly();
    state.enabled = false;
    removeCanopyOverlay();

    removePointQueryOverlay();
    syncPointQueryCursor();
    restoreShadeZoomConstraint();
    setNavigationCanvasState(false);

    if (updateStatus) {
      setStatus("陰影模擬已關閉。");
    }
  }

  async function rebuildShade() {
    if (!mapRef || !state.enabled) return;

    const serial = ++shadeRebuildSerial;
    shadeNavigationSuspended = false;
    setNavigationCanvasState(true);

    const snapshot = captureViewSnapshot();
    if (!snapshot) return;

    try {
      setStatus("正在準備目前視野的 Meta CHMv2／地形資料…");
      applyShadeZoomConstraint();

      // Prepare only data first. No SDK layer is mounted until we know this
      // rebuild is still the newest requested viewport.
      const terrain = await selectTerrainSource(snapshot, serial);
      if (serial !== shadeRebuildSerial || !state.enabled) return;

      // Swap instances only after replacement terrain is ready. This minimizes
      // time without shade and drastically reduces WebGL context churn.
      detachShadeLayerOnly({ scheduleScrub: false });
      await delay(Math.max(40, Number(config.layerSwapDelayMs) || 80));
      if (serial !== shadeRebuildSerial || !state.enabled) return;
      // The old SDK instance has now been removed and yielded a safe turn. Physically
      // remove its retired DOM before the replacement renderer can be mistaken for it.
      cleanupRetiredShadeCanvases();

      const layer = await mountPreparedShadeLayer(terrain, serial);
      if (!layer || serial !== shadeRebuildSerial || !state.enabled) return;

      syncPointQueryCursor();
      syncCanopyOverlay();
      lastLiveViewSignature = snapshotCoverageSignature(snapshot);
      // Remain under the navigation mask until the current-generation idle event.

      if (terrain.warning) {
        setStatus(`${terrain.warning} 陰影引擎正在完成畫面計算…`, !terrain.meta);
      } else {
        setStatus(`已更新目前位置：${modeLabel(state.mode)}；陰影引擎正在完成畫面計算…`);
      }
    } catch (error) {
      if (serial !== shadeRebuildSerial || !state.enabled) return;
      console.error(error);
      detachShadeLayerOnly();
      setNavigationCanvasState(false);
      setStatus(`更新失敗：${error.message || error}`, true);
    }
  }

  function hookMapMoveRebuild() {
    if (!mapRef || mapMoveHooked || typeof mapRef.on !== "function") return;
    mapMoveHooked = true;

    const startNavigation = () => {
      if (!state.enabled || state.mode === "buildings" || config.metaMode !== "live-cog") return;
      if (document.body && document.body.classList.contains("listening-mode")) return;

      // Invalidate the current preparation BEFORE any stale async task gets a
      // chance to mount. Keep the current SDK instance hidden until the debounced rebuild swaps it.
      shadeRebuildSerial += 1;
      clearTimeout(liveMoveTimer);
      suspendShadeForNavigation();
    };

    const scheduleRebuild = () => {
      if (!state.enabled || state.mode === "buildings" || config.metaMode !== "live-cog") return;
      if (document.body && document.body.classList.contains("listening-mode")) return;

      clearTimeout(liveMoveTimer);
      liveMoveTimer = setTimeout(() => {
        if (!state.enabled) return;

        // Terrain/CHMv2 caches may be reused, but the WebGL renderer is viewport-
        // specific. Always rebuild once after a real pan/zoom settles; never
        // reveal the pre-navigation framebuffer merely because data coverage is
        // unchanged. rebuildShade() still delays SDK teardown until replacement
        // terrain is ready, avoiding movestart-time context churn.
        rebuildShade();
      }, Math.max(180, Number(config.navigationRebuildDelayMs) || 520));
    };

    mapRef.on("movestart", startNavigation);
    mapRef.on("zoomstart", startNavigation);
    mapRef.on("moveend", scheduleRebuild);
    mapRef.on("zoomend", scheduleRebuild);
  }

  function boot() {
    injectStyles();
    installDesktopHeaderMinimizer();

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      mapRef = mapRef || resolveMap();
      installDesktopHeaderMinimizer();

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
    },
    analyzeCanopyAt(lat, lng, date) {
      const latlng = { lat: Number(lat), lng: Number(lng) };
      const when = date ? new Date(date) : state.date;
      return analyzeCanopyBenefitAt(latlng, solarPositionAt(latlng, when));
    },
    getCanvasDiagnostics: getShadeCanvasDiagnostics
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
