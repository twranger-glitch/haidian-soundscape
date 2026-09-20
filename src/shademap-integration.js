/*
 * Haidian Soundscape — ShadeMap × Meta CHMv2 live integration v8.7.1
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
    // Optional v8.3 hybrid accelerator. Keep metaMode="live-cog" globally and
    // route only fully-covered priority viewports to hosted prebuilt surfaces.
    metaPrebuiltEnabled: false,
    metaPrebuiltRegions: [],
    metaCogBaseUrl: "https://data.source.coop/tge-labs/meta-chm-v2/chm",
    geotiffUrl: "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.min.js",
    metaMinZoom: 14,
    // z17 aligns with CHMv2's native ~1.19 m Web-Mercator pixels.
    // The bare-earth DEM is overzoomed above its z15 maximum; canopy stays native.
    metaMaxZoom: 17,
    metaTileBuffer: 0,
    // v8.4.0: prepare a bounded upstream caster fringe in the direction of the
    // sun. A tree just outside the viewport may still cast a long afternoon
    // shadow into the visible map, so viewport-only CHMv2 preparation is not
    // sufficient for fidelity.
    metaSunCasterBufferEnabled: true,
    metaSunCasterMinZoom: 16,
    metaSunCasterMaxShadowLengthM: 120,
    metaSunCasterMaxTiles: 1,
    metaSunCasterMinSolarAltitudeDeg: 2.5,
    // v8.3.0: this is the upper bound; effective concurrency is adapted to
    // save-data/effective-connection hints and hardwareConcurrency when available.
    metaTileConcurrency: 8,
    metaAdaptiveConcurrencyEnabled: true,
    metaMaxPreparedTiles: 180,
    metaMaxCachedTiles: 480,
    // v8.3.1: warm beyond the blocking first-preview set. Sixteen center-first
    // tiles remains bounded, while any extra completed tiles are reused by the
    // later background upgrade.
    metaWarmStartEnabled: true,
    metaWarmStartDelayMs: 1200,
    metaWarmStartMaxTiles: 16,
    metaWarmStartConcurrency: 4,
    // First activation may reveal a clearly-labelled provisional shade frame after
    // only the critical center-first surfaces are ready. The remaining CHMv2 tiles
    // start after that renderer reaches idle, then one generation-safe rebuild
    // upgrades the viewport to the complete surface.
    metaProgressiveEnabled: true,
    metaProgressiveInitialTiles: 8,
    // v8.3.1: do not synchronously manufacture ground-only blobs for every
    // peripheral tile before the first frame. A shared flat Terrarium placeholder
    // makes the preview truly progressive; the complete CHMv2+DTM surface replaces
    // it after the renderer reaches idle.
    metaProgressiveFallbackMode: "flat-zero",
    // Keep building network work off both the preview and the CHMv2 surface-complete
    // critical paths. v8.3.2 upgrades buildings independently after the surface frame.
    metaProgressiveDeferBuildings: true,
    buildingProgressiveDecoupleEnabled: true,
    buildingWarmPrefetchEnabled: true,
    buildingWarmPrefetchDelayMs: 250,
    buildingFetchClientTimeoutMs: 12000,
    buildingUpgradeDelayMs: 80,
    // v8.7.1 forest-performance: use progressive rendering on every normal
    // viewport navigation, not only the first activation. Upgrade/full phases
    // explicitly bypass progressive mode to avoid rebuild loops.
    metaProgressiveFirstActivationOnly: false,
    metaProgressiveMinTiles: 12,
    metaProgressiveBackgroundConcurrency: 3,
    metaProgressiveBackgroundStartDelayMs: 160,
    metaProgressiveUpgradeDelayMs: 120,
    // Yield while encoding CHMv2+DEM Terrarium tiles so dense forest views do
    // not monopolize the browser main thread during a 100+ tile background fill.
    metaSurfaceEncodeYieldRows: 64,
    // GeoTIFF.js can decode compressed COG blocks in Web Workers. Keep the pool
    // intentionally small so decoding leaves CPU headroom for Leaflet/WebGL.
    metaGeoTiffWorkerPoolEnabled: true,
    metaGeoTiffWorkerPoolSize: 2,
    metaMaxCachedCogs: 16,
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
    // v8.5.1: low-sun building shadows can originate well outside the viewport.
    // Use the fixed padding as a floor and expand physically from sun altitude.
    buildingShadowDynamicPaddingEnabled: true,
    buildingShadowMaxCasterHeightM: 120,
    buildingShadowFetchPaddingMaxM: 1800,
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

    // v8.1.0: time-integrated daily canopy shade analysis. The selected CHMv2
    // canopy patch is segmented once, then projected across a configurable
    // daytime window. Results are reported as area-hours (m²·h) rather than
    // pretending the raster patch is a surveyed individual tree.
    queryCanopyDailyEnabled: true,
    queryCanopyDailyStartHour: 8,
    queryCanopyDailyEndHour: 18,
    queryCanopyDailyStepMinutes: 30,

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

    // v8.7.0: hosted/versioned building tiles are the preferred production
    // shadow source. The client accepts both the legacy explicit tile-key index
    // and the compact x/y-range index used by larger Tainan/Taiwan publications.
    // A matching Worker data-version header is still mandatory.
    buildingMode: "pipeline",
    buildingGeoJSONUrl: "",
    buildingTileUrl: "",
    buildingManifestUrl: "",
    buildingTileIndexUrl: "",
    buildingDataVersion: "",
    // v8.6.3: generic height calibration. Never special-case a named building.
    // Low-confidence estimates may be upgraded only from nearby high-confidence
    // direct/floor-derived buildings with compatible class and footprint size.
    buildingHeightContextRadiusM: 1200,
    buildingHeightContextMinAnchors: 2,
    buildingHeightContextMaxAnchors: 6,
    buildingHeightContextAreaRatioMin: 0.45,
    buildingHeightContextAreaRatioMax: 2.2,
    buildingHeightContextMaxM: 80,
    buildingTileZoom: 16,
    buildingPipelineFallbackToOsm: true,
    buildingPipelineCoverageGateEnabled: true,
    buildingPipelineRequireCompleteTiles: true,
    buildingPipelineRequireTileIndex: true,
    buildingManifestRequireVersionHeader: true,
    buildingTileFetchClientTimeoutMs: 5000,
    buildingManifestFetchClientTimeoutMs: 4000,
    buildingTileIndexFetchClientTimeoutMs: 4000,
    buildingTileCacheMaxEntries: 160,
    // Kept for backward-compatible reviewer links. When production is already
    // pipeline mode, ?buildingPipeline=1 is simply a no-op.
    buildingPilotQueryParam: "buildingPipeline",
    buildingPilotQueryValue: "1",
    buildingDebugOverlayDefault: false,
    buildingMinZoom: 15,
    overpassUrl: "https://overpass-api.de/api/interpreter",
    overpassUrls: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter"
    ],
    buildingFetchTotalTimeoutMs: 26000,
    defaultBuildingHeight: 3.1,
    defaultStoreyHeight: 3.1,

    defaultResearchMode: "full",
    defaultOpacity: 0.36,
    defaultColor: "#172554",
    queryOnClick: false,
    canopyOverlayDefault: true,
    canopyOverlayMinHeight: 2,
    // v8.4.1: keep canopy extent visible, but do not let the green diagnostic
    // wash out the ground-receiver shade calibration.
    canopyOverlayOpacity: 0.22,
    // v8.4.2 keeps the z17 CHMv2 truth grid but softens only display overzoom.
    // This avoids the chunky z18-z20 appearance without claiming new spatial detail.
    canopyOverlaySmoothOverzoom: true,
    // Ground shade is split into an exact beneath-canopy core plus a sampled
    // down-sun projection. v8.4.2 applies conservative one-pixel gap closure
    // to both masks, then a low-alpha one-pixel edge feather before compositing.
    groundCanopyShadeEnabled: true,
    groundCanopyShadeMinHeightM: 2,
    groundCanopyShadeMaxShadowLengthM: 120,
    groundCanopyShadeMinSolarAltitudeDeg: 2.5,
    groundCanopyShadeSampleStepPx: 2,
    // v8.7.1 forest-performance: bound the expensive dense-canopy receiver
    // renderer and cooperatively yield between row batches. Final quality stays
    // unchanged; only scheduling is throttled.
    groundCanopyShadeMaxConcurrentTiles: 2,
    groundCanopyShadeYieldRows: 8,
    canopyOverlayYieldRows: 32,
    groundCanopyShadeOpacity: 0.56,
    groundCanopyShadeCoreOpacity: 0.72,
    groundCanopyShadeProjectedOpacity: 0.52,
    groundCanopyShadeGapFillPx: 1,
    groundCanopyShadeCoreGapFillPx: 1,
    groundCanopyShadeProjectedGapFillPx: 1,
    groundCanopyShadeFeatherPx: 1,
    groundCanopyShadeFeatherStrength: 0.32,
    groundCanopyShadeSmoothOverzoom: true,
    groundCanopyShadeBlendMode: "multiply",
    groundCanopyShadeColor: "#172554",
    groundCanopyShadeDisplayMaxZoom: 20,
    // Do not clamp the Leaflet camera to CHMv2's native z17. Above z17 the
    // canopy/shade diagnostics are overzoomed from the native raster; no fake
    // extra spatial resolution is claimed.
    lockMapMaxZoomToMeta: false,

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
    canopyOverlay: config.canopyOverlayDefault !== false,
    groundCanopyShade: config.groundCanopyShadeEnabled !== false,
    buildingDebugOverlay: config.buildingDebugOverlayDefault === true
  };

  let mapRef = null;
  let shadePreviousMaxZoom = null;
  let shadeZoomConstraintApplied = false;
  let shadeLayer = null;
  let buildingDebugLayer = null;
  let buildingAttributionAdded = "";
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
  let geoTiffWorkerPool = null;
  let geoTiffWorkerPoolDisabled = false;
  let liveMoveTimer = null;
  let shadeRebuildSerial = 0;
  let shadeNavigationSuspended = false;
  let mapMoveHooked = false;
  let mapQueryHooked = false;
  let canopyOverlayLayer = null;
  let groundCanopyShadeLayer = null;
  let groundCanopyShadeGeneration = 0;
  let groundCanopyShadeActiveRenders = 0;
  const groundCanopyShadeRenderQueue = [];
  let queryPopup = null;
  let queryPointMarker = null;
  let querySampleCell = null;
  let queryCanopyBenefitLayer = null;
  let activePointQuery = null;
  let pointShadeRetryTimer = null;
  let lastMapDragAt = 0;
  let lastLiveViewSignature = null;
  let metaWarmStartTimer = null;
  let metaWarmStartIdleHandle = null;
  let metaWarmStartSerial = 0;
  let metaWarmStartCompleted = false;
  let metaProgressiveUsed = false;
  let pendingProgressiveUpgrade = null;
  let pendingBuildingUpgrade = null;
  let progressiveCanopyOverlayDeferred = false;
  let shadeLayerPhase = "full";
  let lastBuildingFetchError = null;
  let buildingWarmPrefetchTimer = null;
  let buildingWarmPrefetchSerial = 0;
  let metaActivationStartedAt = 0;
  let metaActivationInProgress = false;
  const metaPerf = {
    cogOpens: 0,
    cogCacheHits: 0,
    canopyReads: 0,
    canopyCacheHits: 0,
    canopyPromiseJoins: 0,
    groundCanopyShadeTiles: 0,
    groundCanopyShadeCasterTiles: 0,
    groundCanopyShadeRenderMs: 0,
    groundCanopyShadeCorePixels: 0,
    groundCanopyShadeProjectedPixels: 0,
    groundCanopyShadeGapFillPixels: 0,
    groundCanopyShadeCoreGapFillPixels: 0,
    groundCanopyShadeProjectedGapFillPixels: 0,
    groundCanopyShadeFeatherPixels: 0,
    groundCanopyShadePointOverrides: 0,
    groundCanopyShadeActivePeak: 0,
    groundCanopyShadeQueuedPeak: 0,
    cooperativeYields: 0,
    geoTiffPoolCreates: 0,
    geoTiffPoolFallbacks: 0,
    surfaceBuilds: 0,
    surfaceCacheHits: 0,
    surfaceBuildMs: 0,
    staleQueuedSkipped: 0,
    warmStartRuns: 0,
    warmStartTiles: 0,
    warmStartLoaded: 0,
    warmStartMs: 0,
    progressiveRuns: 0,
    progressiveInitialTiles: 0,
    progressiveBackgroundTiles: 0,
    progressiveProvisionalTiles: 0,
    progressiveFlatFallbackTiles: 0,
    progressiveInitialMs: 0,
    progressiveFallbackMs: 0,
    progressivePreviewBuildingsDeferred: 0,
    buildingPrefetchRuns: 0,
    buildingPrefetchLoaded: 0,
    buildingFetches: 0,
    buildingFetchErrors: 0,
    buildingUpgradeRuns: 0,
    buildingUpgrades: 0,
    buildingUpgradeSkipped: 0,
    buildingFetchMs: 0,
    provisionalSurfaceBuilds: 0,
    provisionalSurfaceCacheHits: 0,
    progressiveUpgrades: 0,
    progressiveBackgroundMs: 0,
    activeConcurrencyLast: 0,
    progressiveBackgroundConcurrencyLast: 0,
    warmConcurrencyLast: 0,
    prebuiltChecks: 0,
    prebuiltHits: 0,
    prebuiltMisses: 0,
    lastPreviewMs: 0,
    lastSurfaceCompleteMs: 0,
    lastBuildingCompleteMs: 0,
    lastCompleteMs: 0,
    lastBuildingFetchMs: 0,
    lastBuildingError: null,
    lastWarmStart: null,
    lastProgressive: null
  };
  const overpassCache = new Map();
  const buildingTileCache = new Map();
  let buildingManifestCache = null;
  let buildingManifestPromise = null;
  let buildingTileIndexCache = null;
  let buildingTileIndexPromise = null;
  let lastBuildingPipelineStatus = { mode: "idle", sourceCounts: {}, tileCount: 0, error: null };
  let lastBuildingFeatures = [];
  let lastBuildingCoverageKey = null;
  const metaCogCache = new Map();
  const metaSurfaceUrls = new Map();
  const metaProvisionalSurfaceUrls = new Map();
  let metaFlatZeroTerrariumUrl = null;
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

  function prebuiltRegionForSnapshot(snapshot) {
    if (!snapshot || config.metaPrebuiltEnabled !== true || !Array.isArray(config.metaPrebuiltRegions)) return null;
    const zooms = Array.from(new Set([Math.floor(snapshot.zoom), Math.ceil(snapshot.zoom)]));
    return config.metaPrebuiltRegions.find((region) => {
      if (!region) return false;
      const south = Number(region.south);
      const west = Number(region.west);
      const north = Number(region.north);
      const east = Number(region.east);
      if (![south, west, north, east].every(Number.isFinite)) return false;
      const minZoom = Number.isFinite(Number(region.minZoom)) ? Number(region.minZoom) : config.metaMinZoom;
      const maxZoom = Number.isFinite(Number(region.maxZoom)) ? Number(region.maxZoom) : config.metaMaxZoom;
      const zoomCovered = zooms.every((z) => z >= minZoom && z <= maxZoom);
      return zoomCovered &&
        snapshot.south >= south && snapshot.north <= north &&
        snapshot.west >= west && snapshot.east <= east;
    }) || null;
  }

  async function prebuiltSurfaceAvailable(snapshot) {
    const region = prebuiltRegionForSnapshot(snapshot);
    if (!region || !config.metaTileUrl) return false;
    metaPerf.prebuiltChecks += 1;
    const centerLat = (snapshot.north + snapshot.south) / 2;
    const centerLng = (snapshot.east + snapshot.west) / 2;
    const regionMax = Number.isFinite(Number(region.maxZoom)) ? Number(region.maxZoom) : config.metaMaxZoom;
    const z = Math.max(0, Math.min(regionMax, Math.ceil(snapshot.zoom)));
    const tile = lonLatToXYZ(centerLat, centerLng, z);
    const url = fillTemplate(config.metaTileUrl, tile.x, tile.y, z);
    try {
      let response = await fetch(url, { method: "HEAD", cache: "force-cache" });
      if (!response.ok && (response.status === 405 || response.status === 501)) {
        response = await fetch(url, { method: "GET", cache: "force-cache" });
      }
      if (response.ok) {
        metaPerf.prebuiltHits += 1;
        return true;
      }
    } catch (_) {}
    metaPerf.prebuiltMisses += 1;
    return false;
  }


  function directionalCasterExpansion(snapshot, z) {
    const none = { left: 0, right: 0, top: 0, bottom: 0, tiles: 0 };
    if (!snapshot || config.metaSunCasterBufferEnabled === false || state.mode === "buildings") return none;
    if (z < Math.max(config.metaMinZoom, Number(config.metaSunCasterMinZoom) || 16)) return none;
    const center = {
      lat: (snapshot.north + snapshot.south) / 2,
      lng: (snapshot.east + snapshot.west) / 2
    };
    const solar = solarPositionAt(center, state.date);
    const minAltitude = Math.max(0, Number(config.metaSunCasterMinSolarAltitudeDeg) || 2.5);
    if (!solar || solar.night || solar.altitudeDeg < minAltitude) return none;
    const maxShadowM = Math.max(0, Number(config.metaSunCasterMaxShadowLengthM) || 120);
    const tileM = canopyPixelSizeMeters(center.lat, z) * 256;
    const requested = Math.ceil(maxShadowM / Math.max(1, tileM));
    const maxTiles = Math.max(0, Number(config.metaSunCasterMaxTiles) || 1);
    const tiles = Math.max(0, Math.min(maxTiles, requested));
    if (!tiles) return none;
    const theta = Number(solar.sunBearingDeg) * Math.PI / 180;
    const east = Math.sin(theta);
    const north = Math.cos(theta);
    return {
      left: east < -0.15 ? tiles : 0,
      right: east > 0.15 ? tiles : 0,
      top: north > 0.15 ? tiles : 0,
      bottom: north < -0.15 ? tiles : 0,
      tiles,
      bearing: solar.sunBearingDeg,
      altitude: solar.altitudeDeg
    };
  }

  function metaTileRangeForSnapshot(snapshot, z) {
    const buffer = Math.max(0, Number(config.metaTileBuffer) || 0);
    const bounds = snapshotBounds(snapshot);
    const range = tileRangeForBounds(bounds, z, buffer);
    const extra = directionalCasterExpansion(snapshot, z);
    const max = Math.pow(2, z) - 1;
    return {
      minX: Math.max(0, range.minX - extra.left),
      maxX: Math.min(max, range.maxX + extra.right),
      minY: Math.max(0, range.minY - extra.top),
      maxY: Math.min(max, range.maxY + extra.bottom),
      caster: extra
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
    // Coverage signature intentionally excludes the time-dependent directional
    // caster fringe. Timeline changes stay in-place via ShadeMap.setDate(); they
    // must not invalidate an otherwise identical viewport generation.
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
      .haidian-shade-query-popup .hsq-benefit-daily{margin-top:8px;padding-top:8px;border-top:1px dashed #a7f3d0}
      .haidian-shade-query-popup .hsq-benefit-daily-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#92400e;font-size:9.5px;font-weight:900}
      .haidian-shade-query-popup .hsq-benefit-daily-head small{color:#78716c;font-size:7.5px;font-weight:750;text-align:right}
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

  function buildingPilotRequested() {
    const key = String(config.buildingPilotQueryParam || "").trim();
    if (!key || !config.buildingTileUrl || !window.location) return false;
    try {
      const params = new URLSearchParams(window.location.search || "");
      const expected = String(config.buildingPilotQueryValue == null ? "1" : config.buildingPilotQueryValue);
      return params.get(key) === expected;
    } catch (_) {
      return false;
    }
  }

  function effectiveBuildingMode() {
    return buildingPilotRequested() ? "pipeline" : config.buildingMode;
  }

  function buildingSourceLabel() {
    if (effectiveBuildingMode() === "custom") return "自訂 GeoJSON";
    if (effectiveBuildingMode() === "pipeline") {
      const st = lastBuildingPipelineStatus || {};
      if (st.mode === "pipeline-hybrid") return "預建建物圖磚（Overture＋OSM）＋ OpenStreetMap live 補齊";
      if (st.fallback === "OSM") return "OpenStreetMap / Overpass（預建圖磚範圍外或不完整時自動 fallback）";
      return buildingPilotRequested() && config.buildingMode !== "pipeline"
        ? "預建建物圖磚（測試模式）"
        : "預建建物圖磚（Overture＋OSM；可擴展至全臺）";
    }
    if (effectiveBuildingMode() === "none") return "未載入";
    return "OpenStreetMap / Overpass";
  }

  function buildingRuntimeStatusText() {
    if (effectiveBuildingMode() === "none") return "未載入";
    if (effectiveBuildingMode() === "pipeline") {
      const st = lastBuildingPipelineStatus || {};
      if (st.mode === "idle") return config.buildingTileUrl ? "等待載入預建圖磚" : "尚未設定建築圖磚 URL";
      if (st.mode === "pipeline-outside-coverage") return `預建圖磚 AOI 外；已切換 OSM${st.fallbackFeatureCount != null ? ` ${st.fallbackFeatureCount} 棟` : ""}`;
      if (st.mode === "pipeline-manifest-error") return `建物 manifest／版本無法確認；已切換 OSM${st.fallbackFeatureCount != null ? ` ${st.fallbackFeatureCount} 棟` : ""}`;
      if (st.mode === "pipeline-index-error") return `建物 tile 索引無法確認；已切換 OSM${st.fallbackFeatureCount != null ? ` ${st.fallbackFeatureCount} 棟` : ""}`;
      if (st.mode === "pipeline-incomplete") return `預建圖磚不完整；已切換 OSM${st.fallbackFeatureCount != null ? ` ${st.fallbackFeatureCount} 棟` : ""}`;
      const counts = st.sourceCounts || {};
      const parts = Object.keys(counts).sort().map((k) => `${k} ${counts[k]}`).join("、");
      const tileSummary = Number.isFinite(st.successfulTileCount)
        ? `${st.successfulTileCount}/${st.tileCount || 0} tiles`
        : `${st.tileCount || 0} tiles`;
      const partial = st.failedTileCount ? `，失敗 ${st.failedTileCount}` : "";
      const fallback = st.fallback ? `；fallback ${st.fallback} ${st.fallbackFeatureCount || 0} 棟` : "";
      return `${tileSummary}${partial}；${st.featureCount || 0} 棟${parts ? `（${parts}）` : ""}${fallback}`;
    }
    if (effectiveBuildingMode() === "osm") {
      if (lastBuildingFetchError) return `Overpass 失敗：${lastBuildingFetchError.message || lastBuildingFetchError}`;
      if (lastBuildingCoverageKey) return `Overpass 已取得 ${Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures.length : 0} 棟`;
      return "Overpass 尚未查詢";
    }
    return Array.isArray(lastBuildingFeatures) ? `已載入 ${lastBuildingFeatures.length} 棟` : "尚未載入";
  }

  function updateBuildingRuntimeStatus() {
    const el = document.getElementById("haidianShadeBuildingRuntime");
    if (el) el.textContent = buildingRuntimeStatusText();
  }

  function syncBuildingAttribution() {
    if (!mapRef || !mapRef.attributionControl) return;
    const pipelineStatus = lastBuildingPipelineStatus || {};
    const pipelineHybrid = effectiveBuildingMode() === "pipeline" && pipelineStatus.mode === "pipeline-hybrid";
    const pipelineFellBack = effectiveBuildingMode() === "pipeline" && pipelineStatus.fallback === "OSM" && !pipelineHybrid;
    const desired = effectiveBuildingMode() === "pipeline" && (!pipelineFellBack || pipelineHybrid)
      ? "© OpenStreetMap contributors, Overture Maps Foundation"
      : ((effectiveBuildingMode() === "osm" || pipelineFellBack) ? "© OpenStreetMap contributors" : "");
    if (buildingAttributionAdded && buildingAttributionAdded !== desired) {
      try { mapRef.attributionControl.removeAttribution(buildingAttributionAdded); } catch (_) {}
      buildingAttributionAdded = "";
    }
    if (desired && buildingAttributionAdded !== desired) {
      try { mapRef.attributionControl.addAttribution(desired); buildingAttributionAdded = desired; } catch (_) {}
    }
  }

  function syncBuildingDebugOverlay() {
    if (buildingDebugLayer && mapRef) {
      try { mapRef.removeLayer(buildingDebugLayer); } catch (_) {}
      buildingDebugLayer = null;
    }
    if (!state.buildingDebugOverlay || !mapRef || !window.L || typeof L.geoJSON !== "function") return;
    const features = Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures : [];
    if (!features.length) return;
    buildingDebugLayer = L.geoJSON({ type: "FeatureCollection", features }, {
      style: (feature) => {
        const source = feature && feature.properties && feature.properties.building_source;
        const color = source === "NLSC" ? "#2563eb" : source === "Overture" ? "#f97316" : "#7c3aed";
        return { color, weight: 1.4, opacity: 0.9, fillOpacity: 0.04 };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        const label = `${p.building_source || "OSM"}｜${Number(p.height || p.render_height || 0).toFixed(1)} m｜${p.height_source || "height unknown"}`;
        try { layer.bindTooltip(label, { sticky: true }); } catch (_) {}
      }
    }).addTo(mapRef);
  }

  function terrainSourceLabel() {
    if (["xyz", "static"].includes(config.metaMode)) {
      return "Meta CHMv2 衍生 XYZ surface tiles";
    }
    if (config.metaMode === "live-cog" && config.metaPrebuiltEnabled === true) {
      return "Meta / WRI CHMv2（優先區預建 surface + live COG fallback）";
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
    redrawGroundCanopyShadeOverlay();
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
          <input id="haidianShadeGroundCanopy" type="checkbox"
            style="width:15px;height:15px;margin:0;accent-color:#172554">
          <span>補足地面樹蔭（校正）</span>
        </label>

        <label class="haidian-shade-row" style="cursor:pointer">
          <input id="haidianShadeQueryToggle" type="checkbox"
            style="width:15px;height:15px;margin:0;accent-color:#0f766e">
          <span>點擊地圖查詢樹高／陰影</span>
        </label>

        <div class="haidian-shade-legend">
          <span><i class="haidian-shade-swatch" style="background:rgba(16,185,129,.55)"></i>樹冠範圍</span>
          <span><i class="haidian-shade-swatch" style="background:${config.defaultColor};opacity:${Math.max(.35, state.opacity)}"></i>ShadeMap 陰影</span>
          <span><i class="haidian-shade-swatch" style="background:${config.groundCanopyShadeColor || config.defaultColor};opacity:${Math.max(.25, Number(config.groundCanopyShadeOpacity) || .42)}"></i>地面樹蔭補償</span>
        </div>

        <div id="haidianShadeStatus" class="haidian-shade-status">
          尚未啟用陰影模擬。
        </div>

        <div class="haidian-shade-source">
          <b>陰影：</b>ShadeMap Leaflet SDK<br>
          <b>樹冠：</b>${terrainSourceLabel()}<br>
          <b>陰影地形：</b>${escapeHtml(dynamicShadowTerrainLabel(mapRef && mapRef.getCenter ? mapRef.getCenter() : null))}<br>
          <b>臺灣點位海拔：</b>${escapeHtml(officialTerrainConfigured() ? (config.taiwanTerrainLabel || "內政部官方 DTM Terrarium XYZ") : (config.taiwanOfficialDtmLabel || "內政部 DTM 20 m"))}${officialTerrainConfigured() ? "" : "（需安全代理）"}<br>
          <b>建築：</b>${buildingSourceLabel()}<br>
          <b>建築載入：</b><span id="haidianShadeBuildingRuntime">${escapeHtml(buildingRuntimeStatusText())}</span>
        </div>

        <label class="haidian-shade-row" style="cursor:pointer">
          <input id="haidianShadeBuildingDebug" type="checkbox"
            style="width:15px;height:15px;margin:0;accent-color:#f97316">
          <span>顯示實際送入 ShadeMap 的建築輪廓（除錯）</span>
        </label>

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
          CHMv2 原生樹冠解析度以 z17 為基準；v8.4 可繼續放大檢視，但 z18–20 僅為原生資料 overzoom，不代表新增空間精度。
          「地面樹蔭補償」依 CHMv2 樹高與目前太陽方向，先建立連續的樹冠下地面核心，再補上背陽投影；v8.4.2 只做保守的一像素裂縫修補與低透明邊緣平滑，z18–20 顯示採高品質 overzoom，降低方塊感但不宣稱新增資料精度，仍屬模型估計。
          v7.7 將「點位海拔」與「陰影地形」分開標示：臺灣點位海拔可由內政部 20 m DTM 安全代理取得；
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
    document.getElementById("haidianShadeGroundCanopy").checked = state.groundCanopyShade;
    document.getElementById("haidianShadeQueryToggle").checked = state.queryOnClick;
    document.getElementById("haidianShadeBuildingDebug").checked = state.buildingDebugOverlay;
    updateTimeLabel();
    updateBuildingRuntimeStatus();
    syncBuildingAttribution();

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
      redrawGroundCanopyShadeOverlay();
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
      redrawGroundCanopyShadeOverlay();
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
      .getElementById("haidianShadeGroundCanopy")
      .addEventListener("change", (event) => {
        state.groundCanopyShade = !!event.target.checked;
        syncGroundCanopyShadeOverlay();
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
      .getElementById("haidianShadeBuildingDebug")
      .addEventListener("change", (event) => {
        state.buildingDebugOverlay = !!event.target.checked;
        syncBuildingDebugOverlay();
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
        redrawGroundCanopyShadeOverlay();
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

  function getGeoTiffWorkerPool() {
    if (config.metaGeoTiffWorkerPoolEnabled === false || geoTiffWorkerPoolDisabled) return null;
    if (geoTiffWorkerPool) return geoTiffWorkerPool;
    if (!window.GeoTIFF || typeof window.GeoTIFF.Pool !== "function") {
      geoTiffWorkerPoolDisabled = true;
      return null;
    }
    try {
      const size = Math.max(1, Math.floor(Number(config.metaGeoTiffWorkerPoolSize) || 2));
      geoTiffWorkerPool = new window.GeoTIFF.Pool(size);
      metaPerf.geoTiffPoolCreates += 1;
      return geoTiffWorkerPool;
    } catch (error) {
      geoTiffWorkerPoolDisabled = true;
      console.warn("[Haidian Shade] GeoTIFF worker pool unavailable; falling back to main-thread decode:", error);
      return null;
    }
  }

  async function readMetaRasterWindow(image, options) {
    const pool = getGeoTiffWorkerPool();
    if (!pool) return image.readRasters(options);
    try {
      return await image.readRasters(Object.assign({}, options, { pool }));
    } catch (error) {
      // Some CSP/browser combinations can reject worker construction even though
      // GeoTIFF.Pool exists. Retry once without the pool instead of losing canopy.
      geoTiffWorkerPoolDisabled = true;
      geoTiffWorkerPool = null;
      metaPerf.geoTiffPoolFallbacks += 1;
      console.warn("[Haidian Shade] GeoTIFF worker decode failed; retrying without pool:", error);
      return image.readRasters(options);
    }
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

  function monotonicNow() {
    return typeof performance !== "undefined" && performance && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  async function yieldToBrowser() {
    metaPerf.cooperativeYields += 1;
    const schedulerApi = typeof globalThis !== "undefined" ? globalThis.scheduler : null;
    if (schedulerApi && typeof schedulerApi.yield === "function") {
      await schedulerApi.yield();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function groundCanopyShadeConcurrencyLimit() {
    return Math.max(1, Math.floor(Number(config.groundCanopyShadeMaxConcurrentTiles) || 2));
  }

  function releaseGroundCanopyShadeRenderSlot() {
    groundCanopyShadeActiveRenders = Math.max(0, groundCanopyShadeActiveRenders - 1);
    while (groundCanopyShadeRenderQueue.length) {
      const waiter = groundCanopyShadeRenderQueue.shift();
      if (!waiter) continue;
      if (
        waiter.generation !== groundCanopyShadeGeneration ||
        !state.enabled ||
        !state.groundCanopyShade ||
        state.mode === "buildings"
      ) {
        waiter.resolve(null);
        continue;
      }
      groundCanopyShadeActiveRenders += 1;
      metaPerf.groundCanopyShadeActivePeak = Math.max(
        metaPerf.groundCanopyShadeActivePeak,
        groundCanopyShadeActiveRenders
      );
      waiter.resolve(releaseGroundCanopyShadeRenderSlot);
      break;
    }
  }

  async function acquireGroundCanopyShadeRenderSlot(generation) {
    const limit = groundCanopyShadeConcurrencyLimit();
    if (groundCanopyShadeActiveRenders < limit) {
      groundCanopyShadeActiveRenders += 1;
      metaPerf.groundCanopyShadeActivePeak = Math.max(
        metaPerf.groundCanopyShadeActivePeak,
        groundCanopyShadeActiveRenders
      );
      return releaseGroundCanopyShadeRenderSlot;
    }
    return new Promise((resolve) => {
      groundCanopyShadeRenderQueue.push({ generation, resolve });
      metaPerf.groundCanopyShadeQueuedPeak = Math.max(
        metaPerf.groundCanopyShadeQueuedPeak,
        groundCanopyShadeRenderQueue.length
      );
    });
  }

  function touchMapEntry(map, key) {
    if (!map || !map.has(key)) return undefined;
    const value = map.get(key);
    map.delete(key);
    map.set(key, value);
    return value;
  }

  function effectiveMetaConcurrency(requested, purpose = "active") {
    let limit = Math.max(1, Number(requested) || (purpose === "warm" ? 4 : 6));
    if (config.metaAdaptiveConcurrencyEnabled === false) return limit;

    const nav = typeof navigator !== "undefined" ? navigator : (window && window.navigator ? window.navigator : null);
    const connection = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    if (connection && connection.saveData) limit = Math.min(limit, 2);
    const effectiveType = connection && String(connection.effectiveType || "").toLowerCase();
    if (effectiveType === "slow-2g" || effectiveType === "2g") limit = Math.min(limit, 2);
    else if (effectiveType === "3g") limit = Math.min(limit, 4);

    const cores = nav && Number(nav.hardwareConcurrency);
    if (Number.isFinite(cores) && cores > 0) {
      if (cores <= 4) limit = Math.min(limit, 4);
      else if (cores <= 6) limit = Math.min(limit, 6);
      else limit = Math.min(limit, 8);
    }

    return Math.max(1, Math.floor(limit));
  }

  function progressiveTileSplit(tiles) {
    const list = Array.isArray(tiles) ? tiles : [];
    const requested = Math.max(1, Number(config.metaProgressiveInitialTiles) || 12);
    const count = Math.min(requested, list.length);
    return {
      initial: list.slice(0, count),
      background: list.slice(count)
    };
  }

  async function openMetaCog(url) {
    let promise = metaCogCache.get(url);
    if (promise) {
      metaPerf.cogCacheHits += 1;
      touchMapEntry(metaCogCache, url);
      return promise;
    }

    metaPerf.cogOpens += 1;
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

    // A transient CORS/range/network failure must remain retryable. Do not keep a
    // rejected COG promise pinned in the warm-start cache for the whole session.
    promise.catch(() => {
      if (metaCogCache.get(url) === promise) metaCogCache.delete(url);
    });
    metaCogCache.set(url, promise);
    const maxCached = Math.max(2, Number(config.metaMaxCachedCogs) || 16);
    while (metaCogCache.size > maxCached) {
      metaCogCache.delete(metaCogCache.keys().next().value);
    }
    return promise;
  }

  async function readMetaCanopyTile(x, y, z) {
    if (z < 10) return null;

    const key = tileKey(x, y, z);
    if (canopyRasterCache.has(key)) {
      metaPerf.canopyCacheHits += 1;
      return touchMapEntry(canopyRasterCache, key);
    }
    if (canopyRasterPromises.has(key)) {
      metaPerf.canopyPromiseJoins += 1;
      return canopyRasterPromises.get(key);
    }

    metaPerf.canopyReads += 1;
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
        const bands = await readMetaRasterWindow(cog.images[level.idx], {
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

  function flatZeroTerrariumUrl() {
    if (metaFlatZeroTerrariumUrl) return metaFlatZeroTerrariumUrl;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    // Terrarium encoding for elevation 0 m is rgb(128, 0, 0).
    ctx.fillStyle = "rgb(128,0,0)";
    ctx.fillRect(0, 0, 256, 256);
    metaFlatZeroTerrariumUrl = canvas.toDataURL("image/png");
    return metaFlatZeroTerrariumUrl;
  }

  async function buildProvisionalBareSurfaceTile(x, y, z) {
    const key = tileKey(x, y, z);
    if (metaSurfaceUrls.has(key)) return touchMapEntry(metaSurfaceUrls, key);
    if (metaProvisionalSurfaceUrls.has(key)) {
      metaPerf.provisionalSurfaceCacheHits += 1;
      return touchMapEntry(metaProvisionalSurfaceUrls, key);
    }

    metaPerf.provisionalSurfaceBuilds += 1;
    const dem = await readGroundTerrainHeights(x, y, z);
    if (!dem) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(256, 256);
    const yieldRows = Math.max(0, Math.floor(Number(config.metaSurfaceEncodeYieldRows) || 0));
    for (let y = 0; y < 256; y += 1) {
      const row = y * 256;
      for (let x = 0; x < 256; x += 1) {
        const i = row + x;
        terrariumEncodeInto(image.data, i, dem[i]);
      }
      if (yieldRows && (y + 1) % yieldRows === 0 && y < 255) await yieldToBrowser();
    }
    ctx.putImageData(image, 0, 0);
    const url = await canvasToBlobUrl(canvas);
    metaProvisionalSurfaceUrls.set(key, url);
    const maxCached = Math.max(32, Math.min(192, Number(config.metaMaxCachedTiles) || 480));
    while (metaProvisionalSurfaceUrls.size > maxCached) {
      const oldestKey = metaProvisionalSurfaceUrls.keys().next().value;
      const oldestUrl = metaProvisionalSurfaceUrls.get(oldestKey);
      metaProvisionalSurfaceUrls.delete(oldestKey);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    }
    return url;
  }

  async function buildLiveSurfaceTile(x, y, z) {
    const key = tileKey(x, y, z);
    if (metaSurfaceUrls.has(key)) {
      metaPerf.surfaceCacheHits += 1;
      const cached = touchMapEntry(metaSurfaceUrls, key);
      if (metaSurfaceMeta.has(key)) touchMapEntry(metaSurfaceMeta, key);
      return cached;
    }
    if (metaSurfacePromises.has(key)) return metaSurfacePromises.get(key);

    metaPerf.surfaceBuilds += 1;
    const startedAt = monotonicNow();
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

      const yieldRows = Math.max(0, Math.floor(Number(config.metaSurfaceEncodeYieldRows) || 0));
      for (let y = 0; y < 256; y += 1) {
        const row = y * 256;
        for (let x = 0; x < 256; x += 1) {
          const i = row + x;
          const raw = canopy ? canopy[i] : 0;
          const chm = raw > 0 && raw < 255 ? raw : 0;
          const ground = dem ? dem[i] : 0;
          terrariumEncodeInto(image.data, i, ground + chm);
        }
        if (yieldRows && (y + 1) % yieldRows === 0 && y < 255) await yieldToBrowser();
      }

      ctx.putImageData(image, 0, 0);
      const url = await canvasToBlobUrl(canvas);
      const provisionalUrl = metaProvisionalSurfaceUrls.get(key);
      if (provisionalUrl) {
        metaProvisionalSurfaceUrls.delete(key);
        URL.revokeObjectURL(provisionalUrl);
      }
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
    })().finally(() => {
      metaPerf.surfaceBuildMs += Math.max(0, monotonicNow() - startedAt);
      metaSurfacePromises.delete(key);
    });

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
          const displayMaxZoom = Math.max(config.metaMaxZoom, Number(config.groundCanopyShadeDisplayMaxZoom) || 20);
          if (coords.z < config.metaMinZoom || coords.z > displayMaxZoom) {
            done(null, canvas);
            return;
          }

          try {
            await ensureGeoTIFF();
            const req = displayCanopyRasterRequest(coords.x, coords.y, coords.z);
            const canopy = await readMetaCanopyTile(req.parentX, req.parentY, req.nativeZ);
            if (!canopy) {
              done(null, canvas);
              return;
            }

            const smallSize = Math.max(1, Math.round(req.cropSize));
            const small = document.createElement("canvas");
            small.width = smallSize;
            small.height = smallSize;
            const sctx = small.getContext("2d");
            const image = sctx.createImageData(smallSize, smallSize);
            const minHeight = Math.max(0, Number(config.canopyOverlayMinHeight) || 2);
            const overlayYieldRows = Math.max(0, Math.floor(Number(config.canopyOverlayYieldRows) || 0));
            for (let yy = 0; yy < smallSize; yy += 1) {
              for (let xx = 0; xx < smallSize; xx += 1) {
                const sx = Math.max(0, Math.min(255, Math.floor(req.cropX + xx)));
                const sy = Math.max(0, Math.min(255, Math.floor(req.cropY + yy)));
                const h = Number(canopy[sy * 256 + sx]);
                if (!(h >= minHeight && h < 255)) continue;
                const p = (yy * smallSize + xx) * 4;
                image.data[p] = 16;
                image.data[p + 1] = 185;
                image.data[p + 2] = 129;
                image.data[p + 3] = Math.round(145 + Math.min(h, 30) / 30 * 90);
              }
              if (overlayYieldRows && (yy + 1) % overlayYieldRows === 0 && yy < smallSize - 1) {
                await yieldToBrowser();
              }
            }
            sctx.putImageData(image, 0, 0);
            const ctx = canvas.getContext("2d");
            const smoothOverzoom = req.scale > 1 && config.canopyOverlaySmoothOverzoom !== false;
            ctx.imageSmoothingEnabled = smoothOverzoom;
            if (smoothOverzoom && "imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
            ctx.drawImage(small, 0, 0, smallSize, smallSize, 0, 0, 256, 256);
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
      maxZoom: Math.max(config.metaMaxZoom, Number(config.groundCanopyShadeDisplayMaxZoom) || 20),
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

    // v8.3: during the provisional progressive frame, do not let the Leaflet
    // canopy overlay launch an unbounded second wave of CHMv2 reads. The overlay
    // returns after the full surface upgrade, when its tiles should be cache hits.
    if (progressiveCanopyOverlayDeferred) {
      removeCanopyOverlay();
      return;
    }

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


  function displayCanopyRasterRequest(x, y, z) {
    const displayZ = Math.max(0, Number(z) || 0);
    const nativeZ = Math.min(displayZ, Number(config.metaMaxZoom) || 17);
    if (displayZ <= nativeZ) {
      return { nativeZ, parentX: x, parentY: y, scale: 1, cropX: 0, cropY: 0, cropSize: 256 };
    }
    const scale = 1 << (displayZ - nativeZ);
    const parentX = Math.floor(x / scale);
    const parentY = Math.floor(y / scale);
    const cropSize = 256 / scale;
    return {
      nativeZ,
      parentX,
      parentY,
      scale,
      cropX: (x % scale) * cropSize,
      cropY: (y % scale) * cropSize,
      cropSize
    };
  }

  function parseShadeColor(value) {
    const raw = String(value || config.defaultColor || "#172554").trim();
    const m = raw.match(/^#([0-9a-f]{6})$/i);
    if (!m) return { r: 23, g: 37, b: 84 };
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16)
    };
  }

  function markGroundCanopyMask(mask, width, height, x, y, radius, alpha) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const r = Math.max(0, Math.floor(radius));
    const minX = Math.max(0, ix - r);
    const maxX = Math.min(width - 1, ix + r);
    const minY = Math.max(0, iy - r);
    const maxY = Math.min(height - 1, iy + r);
    for (let yy = minY; yy <= maxY; yy += 1) {
      const row = yy * width;
      for (let xx = minX; xx <= maxX; xx += 1) {
        const idx = row + xx;
        if (alpha > mask[idx]) mask[idx] = alpha;
      }
    }
  }

  function fillGroundCanopySmallGaps(mask, width, height, passes) {
    const rounds = Math.max(0, Math.floor(Number(passes) || 0));
    if (!rounds || !mask || !width || !height) return 0;
    let filledTotal = 0;
    for (let pass = 0; pass < rounds; pass += 1) {
      const src = mask.slice();
      let filled = 0;
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const idx = y * width + x;
          if (src[idx]) continue;
          const left = src[idx - 1];
          const right = src[idx + 1];
          const up = src[idx - width];
          const down = src[idx + width];
          const ul = src[idx - width - 1];
          const ur = src[idx - width + 1];
          const dl = src[idx + width - 1];
          const dr = src[idx + width + 1];
          const bridge = (left && right) || (up && down) || (ul && dr) || (ur && dl);
          const neighbours = [left, right, up, down, ul, ur, dl, dr].filter(Boolean);
          if (!bridge && neighbours.length < 3) continue;
          let maxAlpha = 0;
          for (const value of neighbours) if (value > maxAlpha) maxAlpha = value;
          mask[idx] = Math.max(1, Math.round(maxAlpha * 0.9));
          filled += 1;
        }
      }
      filledTotal += filled;
      if (!filled) break;
    }
    return filledTotal;
  }

  function featherGroundCanopyMask(mask, width, height, radius, strength) {
    const r = Math.max(0, Math.min(2, Math.floor(Number(radius) || 0)));
    const mix = Math.max(0, Math.min(0.75, Number(strength) || 0));
    if (!r || !mix || !mask || !width || !height) {
      return { mask: mask ? mask.slice() : new Uint8Array(0), feathered: 0 };
    }
    const src = mask;
    const out = mask.slice();
    let feathered = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        if (src[idx]) continue;
        let occupied = 0;
        let maxAlpha = 0;
        let sumAlpha = 0;
        let neighbours = 0;
        for (let dy = -r; dy <= r; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -r; dx <= r; dx += 1) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            neighbours += 1;
            const value = src[yy * width + xx] || 0;
            if (!value) continue;
            occupied += 1;
            sumAlpha += value;
            if (value > maxAlpha) maxAlpha = value;
          }
        }
        // Require at least two supporting neighbours. This produces a soft
        // anti-aliased edge around real shade masses without growing isolated
        // pixels or thin noise into a broad halo.
        if (occupied < 2 || !neighbours) continue;
        const coverage = occupied / neighbours;
        const meanAlpha = sumAlpha / occupied;
        const candidate = Math.round(
          Math.max(meanAlpha, maxAlpha * 0.8) * mix * Math.min(1, coverage * 2.4)
        );
        if (candidate < 6) continue;
        out[idx] = Math.min(96, candidate);
        feathered += 1;
      }
    }
    return { mask: out, feathered };
  }

  function composeGroundCanopyMasks(coreMask, projectedMask, coreOpacity, projectedOpacity) {
    const length = Math.min(coreMask ? coreMask.length : 0, projectedMask ? projectedMask.length : 0);
    const output = new Uint8Array(length);
    const coreScale = Math.max(0, Math.min(1, Number(coreOpacity) || 0));
    const projectedScale = Math.max(0, Math.min(1, Number(projectedOpacity) || 0));
    for (let i = 0; i < length; i += 1) {
      const core = Math.round((coreMask[i] || 0) * coreScale);
      const projected = Math.round((projectedMask[i] || 0) * projectedScale);
      // Alpha union: preserve a strong beneath-canopy core without double-counting
      // overlapping projected shade into an opaque solid block.
      output[i] = Math.min(255, core + projected - Math.round(core * projected / 255));
    }
    return output;
  }

  function groundCanopySourcePixelBounds(targetMinX, targetMinY, targetSpan, ux, uy, maxShadowPx, worldPx) {
    const shiftedMinX = targetMinX - ux * maxShadowPx;
    const shiftedMinY = targetMinY - uy * maxShadowPx;
    const shiftedMaxX = targetMinX + targetSpan - ux * maxShadowPx;
    const shiftedMaxY = targetMinY + targetSpan - uy * maxShadowPx;
    return {
      minX: Math.max(0, Math.floor(Math.min(targetMinX, shiftedMinX)) - 2),
      maxX: Math.min(worldPx - 1, Math.ceil(Math.max(targetMinX + targetSpan, shiftedMaxX)) + 2),
      minY: Math.max(0, Math.floor(Math.min(targetMinY, shiftedMinY)) - 2),
      maxY: Math.min(worldPx - 1, Math.ceil(Math.max(targetMinY + targetSpan, shiftedMaxY)) + 2)
    };
  }

  async function renderGroundCanopyShadeTile(coords, canvas, generation) {
    const startedAt = monotonicNow();
    if (
      config.groundCanopyShadeEnabled === false ||
      !state.groundCanopyShade ||
      state.mode === "buildings" ||
      coords.z < config.metaMinZoom ||
      coords.z > Math.max(config.metaMaxZoom, Number(config.groundCanopyShadeDisplayMaxZoom) || 20)
    ) return;

    const releaseRenderSlot = await acquireGroundCanopyShadeRenderSlot(generation);
    if (!releaseRenderSlot) return;
    try {
    if (generation !== groundCanopyShadeGeneration || !state.enabled || !state.groundCanopyShade) return;

    const center = tileCenterLatLng(coords.x, coords.y, coords.z);
    const solar = solarPositionAt(center, state.date);
    const minAltitude = Math.max(0, Number(config.groundCanopyShadeMinSolarAltitudeDeg) || 2.5);
    if (!solar || solar.night || solar.altitudeDeg < minAltitude) return;

    const req = displayCanopyRasterRequest(coords.x, coords.y, coords.z);
    const evalZ = req.nativeZ;
    const scale = req.scale;
    const targetSpan = 256 / scale;
    const targetMinX = coords.x * 256 / scale;
    const targetMinY = coords.y * 256 / scale;
    const targetW = Math.max(1, Math.round(targetSpan));
    const targetH = targetW;
    const pixelSizeM = canopyPixelSizeMeters(center.lat, evalZ);
    const tanAlt = Math.tan(Math.max(0.001, solar.altitudeRad));
    const maxShadowM = Math.max(10, Number(config.groundCanopyShadeMaxShadowLengthM) || 120);
    const maxShadowPx = maxShadowM / Math.max(0.05, pixelSizeM);
    const downBearing = (Number(solar.sunBearingDeg) + 180) % 360;
    const theta = downBearing * Math.PI / 180;
    const ux = Math.sin(theta);
    const uy = -Math.cos(theta); // Web-Mercator tile y grows southward.
    const worldPx = Math.pow(2, evalZ) * 256;
    const sourceBounds = groundCanopySourcePixelBounds(
      targetMinX, targetMinY, targetSpan, ux, uy, maxShadowPx, worldPx
    );
    const minTx = Math.floor(sourceBounds.minX / 256);
    const maxTx = Math.floor(sourceBounds.maxX / 256);
    const minTy = Math.floor(sourceBounds.minY / 256);
    const maxTy = Math.floor(sourceBounds.maxY / 256);
    const rasterMap = new Map();
    const casterTiles = [];
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      for (let ty = minTy; ty <= maxTy; ty += 1) casterTiles.push({ x: tx, y: ty, z: evalZ });
    }
    metaPerf.groundCanopyShadeCasterTiles += casterTiles.length;
    await ensureGeoTIFF();
    await Promise.all(casterTiles.map(async (tile) => {
      const key = tileKey(tile.x, tile.y, tile.z);
      rasterMap.set(key, await readMetaCanopyTile(tile.x, tile.y, tile.z));
    }));
    if (generation !== groundCanopyShadeGeneration || !state.enabled || !state.groundCanopyShade) return;

    const coreMask = new Uint8Array(targetW * targetH);
    const projectedMask = new Uint8Array(targetW * targetH);
    const minHeight = Math.max(0.5, Number(config.groundCanopyShadeMinHeightM) || 2);
    const sampleStep = Math.max(1, Math.floor(Number(config.groundCanopyShadeSampleStepPx) || 2));
    const walkStep = Math.max(0.9, sampleStep * 0.8);
    const targetMaxX = targetMinX + targetSpan;
    const targetMaxY = targetMinY + targetSpan;
    const shadeYieldRows = Math.max(0, Math.floor(Number(config.groundCanopyShadeYieldRows) || 0));
    let shadeRowsSinceYield = 0;
    const maybeYieldGroundShade = async () => {
      if (!shadeYieldRows) return true;
      shadeRowsSinceYield += 1;
      if (shadeRowsSinceYield < shadeYieldRows) return true;
      shadeRowsSinceYield = 0;
      await yieldToBrowser();
      return generation === groundCanopyShadeGeneration && state.enabled && state.groundCanopyShade;
    };

    // v8.4.1: create an exact native-pixel ground core beneath every CHMv2
    // canopy pixel that overlaps this display tile. This avoids the striped
    // beneath-canopy gaps produced by using the projection sampling grid alone.
    for (const tile of casterTiles) {
      const raster = rasterMap.get(tileKey(tile.x, tile.y, tile.z));
      if (!raster) continue;
      const tileGx = tile.x * 256;
      const tileGy = tile.y * 256;
      const gx0 = Math.max(tileGx, Math.floor(targetMinX));
      const gx1 = Math.min(tileGx + 255, Math.ceil(targetMaxX) - 1);
      const gy0 = Math.max(tileGy, Math.floor(targetMinY));
      const gy1 = Math.min(tileGy + 255, Math.ceil(targetMaxY) - 1);
      if (gx1 < gx0 || gy1 < gy0) continue;
      for (let gy = gy0; gy <= gy1; gy += 1) {
        const localY = gy - tileGy;
        const my = Math.max(0, Math.min(targetH - 1, Math.floor(gy - targetMinY)));
        for (let gx = gx0; gx <= gx1; gx += 1) {
          const localX = gx - tileGx;
          const h = Number(raster[localY * 256 + localX]);
          if (!(h >= minHeight && h < 255)) continue;
          const mx = Math.max(0, Math.min(targetW - 1, Math.floor(gx - targetMinX)));
          const idx = my * targetW + mx;
          const alpha = Math.max(175, Math.min(245, Math.round(180 + Math.min(35, h) / 35 * 65)));
          if (alpha > coreMask[idx]) coreMask[idx] = alpha;
        }
        if (!await maybeYieldGroundShade()) return;
      }
    }

    // Project a sampled set of canopy columns down-sun. The exact core above
    // supplies beneath-canopy coverage; this pass is intentionally bounded for
    // speed and can include casters just outside the visible tile.
    for (const tile of casterTiles) {
      const raster = rasterMap.get(tileKey(tile.x, tile.y, tile.z));
      if (!raster) continue;
      const tileGx = tile.x * 256;
      const tileGy = tile.y * 256;
      const lx0 = Math.max(0, Math.floor(sourceBounds.minX - tileGx));
      const lx1 = Math.min(255, Math.ceil(sourceBounds.maxX - tileGx));
      const ly0 = Math.max(0, Math.floor(sourceBounds.minY - tileGy));
      const ly1 = Math.min(255, Math.ceil(sourceBounds.maxY - tileGy));
      for (let py = ly0; py <= ly1; py += sampleStep) {
        for (let px = lx0; px <= lx1; px += sampleStep) {
          let h = 0;
          const yEnd = Math.min(256, py + sampleStep);
          const xEnd = Math.min(256, px + sampleStep);
          for (let yy = py; yy < yEnd; yy += 1) {
            const row = yy * 256;
            for (let xx = px; xx < xEnd; xx += 1) {
              const raw = Number(raster[row + xx]);
              if (raw > h && raw > 0 && raw < 255) h = raw;
            }
          }
          if (h < minHeight) continue;
          const lengthPx = Math.min(maxShadowM, h / tanAlt) / Math.max(0.05, pixelSizeM);
          const steps = Math.max(1, Math.ceil(lengthPx / walkStep));
          const sourceX = tileGx + px + Math.min(sampleStep, 2) * 0.5;
          const sourceY = tileGy + py + Math.min(sampleStep, 2) * 0.5;
          const alpha = Math.max(125, Math.min(225, Math.round(130 + Math.min(35, h) / 35 * 95)));
          const radius = Math.max(1, Math.floor(sampleStep / 2));
          for (let i = 1; i <= steps; i += 1) {
            const d = Math.min(lengthPx, i * walkStep);
            const outX = sourceX + ux * d - targetMinX;
            const outY = sourceY + uy * d - targetMinY;
            if (outX < -sampleStep || outY < -sampleStep || outX >= targetSpan + sampleStep || outY >= targetSpan + sampleStep) continue;
            markGroundCanopyMask(projectedMask, targetW, targetH, outX, outY, radius, alpha);
          }
        }
        if (!await maybeYieldGroundShade()) return;
      }
    }

    const legacyGapFill = Math.max(0, Math.floor(Number(config.groundCanopyShadeGapFillPx) || 0));
    const coreGapFill = fillGroundCanopySmallGaps(
      coreMask,
      targetW,
      targetH,
      config.groundCanopyShadeCoreGapFillPx == null
        ? legacyGapFill
        : Math.max(0, Math.floor(Number(config.groundCanopyShadeCoreGapFillPx) || 0))
    );
    const projectedGapFill = fillGroundCanopySmallGaps(
      projectedMask,
      targetW,
      targetH,
      config.groundCanopyShadeProjectedGapFillPx == null
        ? legacyGapFill
        : Math.max(0, Math.floor(Number(config.groundCanopyShadeProjectedGapFillPx) || 0))
    );
    if (generation !== groundCanopyShadeGeneration) return;

    let corePixels = 0;
    let projectedPixels = 0;
    for (let i = 0; i < coreMask.length; i += 1) {
      if (coreMask[i]) corePixels += 1;
      if (projectedMask[i]) projectedPixels += 1;
    }
    metaPerf.groundCanopyShadeCorePixels += corePixels;
    metaPerf.groundCanopyShadeProjectedPixels += projectedPixels;
    metaPerf.groundCanopyShadeGapFillPixels += coreGapFill + projectedGapFill;
    metaPerf.groundCanopyShadeCoreGapFillPixels += coreGapFill;
    metaPerf.groundCanopyShadeProjectedGapFillPixels += projectedGapFill;

    const legacyOpacity = Math.max(0.05, Math.min(1, Number(config.groundCanopyShadeOpacity) || 0.56));
    const coreOpacity = config.groundCanopyShadeCoreOpacity == null
      ? Math.min(1, legacyOpacity * 1.25)
      : Math.max(0.05, Math.min(1, Number(config.groundCanopyShadeCoreOpacity) || 0.72));
    const projectedOpacity = config.groundCanopyShadeProjectedOpacity == null
      ? legacyOpacity
      : Math.max(0.05, Math.min(1, Number(config.groundCanopyShadeProjectedOpacity) || 0.52));
    let mask = composeGroundCanopyMasks(coreMask, projectedMask, coreOpacity, projectedOpacity);
    const feathered = featherGroundCanopyMask(
      mask,
      targetW,
      targetH,
      Math.max(0, Math.floor(Number(config.groundCanopyShadeFeatherPx) || 0)),
      Math.max(0, Math.min(0.75, Number(config.groundCanopyShadeFeatherStrength) || 0))
    );
    mask = feathered.mask;
    metaPerf.groundCanopyShadeFeatherPixels += feathered.feathered;

    const small = document.createElement("canvas");
    small.width = targetW;
    small.height = targetH;
    const sctx = small.getContext("2d");
    const image = sctx.createImageData(targetW, targetH);
    const color = parseShadeColor(config.groundCanopyShadeColor || config.defaultColor);
    for (let i = 0; i < mask.length; i += 1) {
      const a = mask[i];
      if (!a) continue;
      const p = i * 4;
      image.data[p] = color.r;
      image.data[p + 1] = color.g;
      image.data[p + 2] = color.b;
      image.data[p + 3] = a;
    }
    sctx.putImageData(image, 0, 0);
    const ctx = canvas.getContext("2d");
    const smoothOverzoom = scale > 1 && config.groundCanopyShadeSmoothOverzoom !== false;
    ctx.imageSmoothingEnabled = smoothOverzoom;
    if (smoothOverzoom && "imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(small, 0, 0, targetW, targetH, 0, 0, 256, 256);
    metaPerf.groundCanopyShadeTiles += 1;
    metaPerf.groundCanopyShadeRenderMs += Math.max(0, monotonicNow() - startedAt);
    } finally {
      releaseRenderSlot();
    }
  }

  function removeGroundCanopyShadeOverlay() {
    if (!groundCanopyShadeLayer || !mapRef) return;
    groundCanopyShadeGeneration += 1;
    try {
      if (mapRef.hasLayer(groundCanopyShadeLayer)) mapRef.removeLayer(groundCanopyShadeLayer);
    } catch (_) {}
  }

  function createGroundCanopyShadeLayer() {
    if (!window.L || !L.GridLayer || !mapRef) return null;
    if (!mapRef.getPane("haidianGroundCanopyShadePane")) {
      const pane = mapRef.createPane("haidianGroundCanopyShadePane");
      pane.style.zIndex = "660";
      pane.style.pointerEvents = "none";
      const blendMode = String(config.groundCanopyShadeBlendMode || "normal").trim();
      if (blendMode && blendMode !== "normal") pane.style.mixBlendMode = blendMode;
    }
    const GroundShadeGrid = L.GridLayer.extend({
      createTile(coords, done) {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        canvas.setAttribute("aria-hidden", "true");
        const generation = groundCanopyShadeGeneration;
        renderGroundCanopyShadeTile(coords, canvas, generation)
          .then(() => done(null, canvas))
          .catch((error) => {
            console.warn("[Haidian Shade] ground canopy shade tile:", error);
            done(null, canvas);
          });
        return canvas;
      }
    });
    return new GroundShadeGrid({
      pane: "haidianGroundCanopyShadePane",
      tileSize: 256,
      minZoom: config.metaMinZoom,
      maxZoom: Math.max(config.metaMaxZoom, Number(config.groundCanopyShadeDisplayMaxZoom) || 20),
      opacity: 1,
      updateWhenIdle: true,
      keepBuffer: 1,
      noWrap: true
    });
  }

  function redrawGroundCanopyShadeOverlay() {
    groundCanopyShadeGeneration += 1;
    if (groundCanopyShadeLayer && typeof groundCanopyShadeLayer.redraw === "function") {
      try { groundCanopyShadeLayer.redraw(); } catch (_) {}
    }
  }

  function syncGroundCanopyShadeOverlay() {
    if (!mapRef) return;
    const shouldShow = state.enabled && state.groundCanopyShade && state.mode !== "buildings" && config.groundCanopyShadeEnabled !== false;
    if (progressiveCanopyOverlayDeferred) {
      removeGroundCanopyShadeOverlay();
      return;
    }
    if (!shouldShow) {
      removeGroundCanopyShadeOverlay();
      return;
    }
    if (!groundCanopyShadeLayer) groundCanopyShadeLayer = createGroundCanopyShadeLayer();
    if (!groundCanopyShadeLayer) return;
    try {
      if (!mapRef.hasLayer(groundCanopyShadeLayer)) groundCanopyShadeLayer.addTo(mapRef);
      if (typeof groundCanopyShadeLayer.bringToFront === "function") groundCanopyShadeLayer.bringToFront();
      // v8.4.1: the ground-receiver shade pane intentionally sits above the
      // green canopy diagnostic so valid ground shade is not visually washed out.
    } catch (error) {
      console.warn("[Haidian Shade] ground canopy shade overlay:", error);
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
    if (effectiveBuildingMode() === "none") return [];
    if (effectiveBuildingMode() === "custom") {
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
    if (effectiveBuildingMode() === "none" || state.mode === "trees") return false;
    if (effectiveBuildingMode() === "custom") return Array.isArray(lastBuildingFeatures);
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

  function dailyPhaseForHour(hour) {
    const h = Number(hour);
    if (h < 11) return "morning";
    if (h < 14) return "midday";
    return "afternoon";
  }

  function summarizeCanopyDailySamples(samples, stepHours, receiverKnown) {
    const safeStep = Math.max(1 / 60, Number(stepHours) || 0.5);
    const phases = {
      morning: { label: "上午", areaHoursM2: 0, groundAreaHoursM2: 0, buildingAreaHoursM2: 0, analyzedHours: 0, sampleCount: 0 },
      midday: { label: "中午", areaHoursM2: 0, groundAreaHoursM2: 0, buildingAreaHoursM2: 0, analyzedHours: 0, sampleCount: 0 },
      afternoon: { label: "下午", areaHoursM2: 0, groundAreaHoursM2: 0, buildingAreaHoursM2: 0, analyzedHours: 0, sampleCount: 0 }
    };
    let areaHoursM2 = 0;
    let groundAreaHoursM2 = 0;
    let buildingAreaHoursM2 = 0;
    let analyzedHours = 0;
    let validSampleCount = 0;
    let skippedLowSunCount = 0;
    let peakAreaM2 = 0;
    let peakAt = null;

    for (const sample of Array.isArray(samples) ? samples : []) {
      if (!sample || !sample.shadow || sample.shadow.unavailableReason) {
        if (sample && sample.shadow && /太陽高度過低/.test(String(sample.shadow.unavailableReason || ""))) skippedLowSunCount += 1;
        continue;
      }
      const area = Number(sample.shadow.totalAreaM2);
      if (!Number.isFinite(area) || area <= 0) continue;
      const ground = Number(sample.shadow.groundAreaM2);
      const building = Number(sample.shadow.buildingAreaM2);
      const phaseKey = sample.phase && phases[sample.phase] ? sample.phase : dailyPhaseForHour(sample.hour);
      const phase = phases[phaseKey];
      areaHoursM2 += area * safeStep;
      if (receiverKnown && Number.isFinite(ground)) groundAreaHoursM2 += ground * safeStep;
      if (receiverKnown && Number.isFinite(building)) buildingAreaHoursM2 += building * safeStep;
      analyzedHours += safeStep;
      validSampleCount += 1;
      phase.areaHoursM2 += area * safeStep;
      if (receiverKnown && Number.isFinite(ground)) phase.groundAreaHoursM2 += ground * safeStep;
      if (receiverKnown && Number.isFinite(building)) phase.buildingAreaHoursM2 += building * safeStep;
      phase.analyzedHours += safeStep;
      phase.sampleCount += 1;
      if (area > peakAreaM2) {
        peakAreaM2 = area;
        peakAt = sample.date instanceof Date ? new Date(sample.date.getTime()) : sample.date || null;
      }
    }

    const averageAreaM2 = analyzedHours > 0 ? areaHoursM2 / analyzedHours : 0;
    const groundPercent = receiverKnown && areaHoursM2 > 0 ? groundAreaHoursM2 / areaHoursM2 * 100 : null;
    const buildingPercent = receiverKnown && areaHoursM2 > 0 ? buildingAreaHoursM2 / areaHoursM2 * 100 : null;
    for (const phase of Object.values(phases)) {
      phase.averageAreaM2 = phase.analyzedHours > 0 ? phase.areaHoursM2 / phase.analyzedHours : 0;
    }
    return {
      areaHoursM2,
      groundAreaHoursM2: receiverKnown ? groundAreaHoursM2 : null,
      buildingAreaHoursM2: receiverKnown ? buildingAreaHoursM2 : null,
      groundPercent,
      buildingPercent,
      analyzedHours,
      averageAreaM2,
      peakAreaM2,
      peakAt,
      validSampleCount,
      skippedLowSunCount,
      receiverKnown,
      phases
    };
  }

  function estimateCanopyDailyBenefit(patch, latlng, baseDate, buildings = null) {
    if (config.queryCanopyDailyEnabled === false || !patch || !latlng) return null;
    const startHour = Math.max(0, Math.min(23.5, Number(config.queryCanopyDailyStartHour) || 8));
    const endHour = Math.max(startHour + 0.25, Math.min(24, Number(config.queryCanopyDailyEndHour) || 18));
    const stepMinutes = Math.max(10, Math.min(120, Number(config.queryCanopyDailyStepMinutes) || 30));
    const stepHours = stepMinutes / 60;
    const date = baseDate instanceof Date && Number.isFinite(baseDate.getTime()) ? new Date(baseDate.getTime()) : new Date();
    const receiverBuildings = Array.isArray(buildings) ? buildings : (Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures : []);
    const receiverKnown = buildingReceiverCoverageKnown();
    const samples = [];

    for (let hour = startHour; hour < endHour - 1e-9; hour += stepHours) {
      const midpointHour = Math.min(endHour, hour + stepHours / 2);
      const sampleDate = new Date(date.getTime());
      sampleDate.setHours(0, 0, 0, 0);
      sampleDate.setMinutes(Math.round(midpointHour * 60));
      const solar = solarPositionAt(latlng, sampleDate);
      const shadow = solar && !solar.night
        ? estimateCanopyShadowContribution(patch, solar, receiverBuildings)
        : null;
      samples.push({
        date: sampleDate,
        hour: midpointHour,
        phase: dailyPhaseForHour(midpointHour),
        solar,
        shadow
      });
    }

    const summary = summarizeCanopyDailySamples(samples, stepHours, receiverKnown);
    return {
      startHour,
      endHour,
      stepMinutes,
      samples,
      ...summary
    };
  }

  async function analyzeCanopyBenefitAt(latlng, solar = null) {
    const sun = solar || solarPositionAt(latlng, state.date);
    const patch = await segmentLocalCanopyPatch(latlng);
    if (!patch) return { available: false, reason: "此點未形成可分析的 CHMv2 樹冠片" };
    let receiverBuildings = [];
    try {
      receiverBuildings = await getQueryableBuildings();
    } catch (_) {}
    const daily = estimateCanopyDailyBenefit(patch, latlng, state.date, receiverBuildings);
    if (!sun || sun.night) {
      return { available: true, patch, solar: sun, shadow: null, daily, reason: "夜間不計算目前樹冠投影陰影；全天累積仍依所選日期計算" };
    }
    const shadow = estimateCanopyShadowContribution(patch, sun, receiverBuildings);
    return {
      available: true,
      patch,
      solar: sun,
      shadow,
      daily,
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
    const height = Number(properties.height ?? properties.render_height);
    const source = String(properties.height_source || "");
    const declaredQuality = String(properties.height_quality || "").toLowerCase();
    const safeHeight = Number.isFinite(height) && height > 0
      ? height
      : Number(config.defaultBuildingHeight) || 3.1;
    let quality = "default";
    if (declaredQuality === "direct" || /^OSM height$/i.test(source) || /direct height/i.test(source) || /自訂 GeoJSON/i.test(source)) quality = "measured";
    else if (declaredQuality === "floors-derived" || /building:levels|num_floors/i.test(source)) quality = "levels";
    else if (["context-inferred", "heuristic", "estimated"].includes(declaredQuality) || (source && !/預設|default/i.test(source))) quality = "estimated";
    return { height: safeHeight, source: source || "預設估計值", quality, declaredQuality };
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
    if (!solar || solar.night || state.mode === "trees" || effectiveBuildingMode() === "none") return null;
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
        if (!shaded && config.groundCanopyShadeEnabled !== false && state.groundCanopyShade && state.mode !== "buildings") {
          const tree = await findCanopyShadowEvidence(latlng, solar);
          if (tree) {
            metaPerf.groundCanopyShadePointOverrides += 1;
            return { label: "🌳 樹蔭", shaded: true, night: false, solar, groundCanopy: true, groundCanopyTree: tree };
          }
        }
        return { label: shaded ? "◐ 陰影" : "☀️ 日照", shaded: !!shaded, night: false, solar };
      }
      if (typeof shadeLayer.isPositionInSun === "function") {
        const sunny = await Promise.resolve(shadeLayer.isPositionInSun(point.x, point.y));
        if (sunny && config.groundCanopyShadeEnabled !== false && state.groundCanopyShade && state.mode !== "buildings") {
          const tree = await findCanopyShadowEvidence(latlng, solar);
          if (tree) {
            metaPerf.groundCanopyShadePointOverrides += 1;
            return { label: "🌳 樹蔭", shaded: true, night: false, solar, groundCanopy: true, groundCanopyTree: tree };
          }
        }
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
    const daily = benefit.daily;
    const areaHours = (value) => Number.isFinite(value) ? `${value < 100 ? value.toFixed(1) : value.toFixed(0)} m²·h` : "—";
    const hours = (value) => Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)} 小時` : "—";
    let dailyHtml = "";
    if (daily && Number.isFinite(daily.areaHoursM2)) {
      const dailySplit = daily.receiverKnown
        ? `地表 ${areaHours(daily.groundAreaHoursM2)}（${daily.groundPercent.toFixed(0)}%） · 建築 ${areaHours(daily.buildingAreaHoursM2)}（${daily.buildingPercent.toFixed(0)}%）`
        : "接收面分類：目前沒有可確認的建築 coverage；全天累積先顯示總遮蔭量";
      const phaseText = [daily.phases && daily.phases.morning, daily.phases && daily.phases.midday, daily.phases && daily.phases.afternoon]
        .filter(Boolean)
        .map((phase) => `${phase.label} ${areaHours(phase.areaHoursM2)}`)
        .join(" · ");
      dailyHtml = `<div class="hsq-benefit-daily">
        <div class="hsq-benefit-daily-head">☀️ 今日累積遮蔭 <small>${String(daily.startHour).padStart(2, "0")}:00–${String(daily.endHour).padStart(2, "0")}:00 · 每 ${daily.stepMinutes} 分</small></div>
        <div class="hsq-benefit-metrics">
          <div class="hsq-benefit-metric"><span>累積遮蔭量</span><b>${escapeHtml(areaHours(daily.areaHoursM2))}</b></div>
          <div class="hsq-benefit-metric"><span>可估算時段</span><b>${escapeHtml(hours(daily.analyzedHours))}</b></div>
          <div class="hsq-benefit-metric"><span>平均投影面積</span><b>${escapeHtml(area(daily.averageAreaM2))}</b></div>
          <div class="hsq-benefit-metric"><span>峰值投影面積</span><b>${escapeHtml(area(daily.peakAreaM2))}</b></div>
        </div>
        <div class="hsq-benefit-split">${escapeHtml(dailySplit)}</div>
        ${phaseText ? `<div class="hsq-benefit-note">${escapeHtml(phaseText)}</div>` : ""}
      </div>`;
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
      ${dailyHtml}
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

    if (model.navigationUpdating) {
      statusLabel = "⏳ 更新中";
      shadeClass = "is-pending";
      primaryMetricValue = '<span class="hsq-pending">地圖移動後重新計算…</span>';
    } else if (isNight) {
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
      if (model.canopyBenefit.daily) {
        const daily = model.canopyBenefit.daily;
        detailItems.push(["全天積分視窗", `${daily.startHour}:00–${daily.endHour}:00，每 ${daily.stepMinutes} 分鐘取樣`]);
        detailItems.push(["全天累積單位", "m²·h（投影陰影面積 × 時間），不是單純面積或單株樹普查值"]);
      }
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
      // v8.6.2: a point card may have been opened while the building pipeline
      // was still warming/falling back. Re-resolve the building against the
      // newest cache so the card and shadow-source logic use the same geometry
      // and corrected height after the pipeline upgrade completes.
      active.model.building = findCachedBuildingAt(active.latlng);
      active.model.navigationUpdating = false;
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
        if (shade.groundCanopy && shade.groundCanopyTree) {
          active.model.shadeSource = {
            type: "tree",
            tree: shade.groundCanopyTree,
            confidence: "high",
            method: "CHMv2 地面樹蔭反向太陽光線判讀"
          };
          active.model.shadeSourceResolving = false;
        } else {
          resolvePointShadeSource(active.serial, active.model);
        }
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

  function clearPendingProgressiveUpgrade() {
    pendingProgressiveUpgrade = null;
  }

  function armProgressiveUpgrade(terrain, serial) {
    if (!terrain || !terrain.progressive || typeof terrain.progressiveStart !== "function") {
      progressiveCanopyOverlayDeferred = false;
      clearPendingProgressiveUpgrade();
      return;
    }
    progressiveCanopyOverlayDeferred = true;
    pendingProgressiveUpgrade = {
      serial,
      snapshotSignature: snapshotCoverageSignature(terrain.snapshot),
      start: terrain.progressiveStart,
      started: false
    };
  }

  function startProgressiveUpgradeAfterPreview(serial) {
    const pending = pendingProgressiveUpgrade;
    if (!pending || pending.serial !== serial || pending.started) return false;
    pending.started = true;
    setStatus("漸進式陰影預覽已顯示；正在背景補齊周邊 CHMv2 surface tiles…");
    const backgroundStartDelay = Math.max(0, Number(config.metaProgressiveBackgroundStartDelayMs) || 0);
    delay(backgroundStartDelay)
      .then(() => {
        if (pendingProgressiveUpgrade !== pending) return null;
        if (!state.enabled || serial !== shadeRebuildSerial) return null;
        return pending.start();
      })
      .then((summary) => {
        if (!summary) return;
        if (pendingProgressiveUpgrade !== pending) return;
        if (!state.enabled || serial !== shadeRebuildSerial) return;
        if (pending.snapshotSignature !== snapshotCoverageSignature(captureViewSnapshot())) return;
        pendingProgressiveUpgrade = null;
        metaPerf.progressiveUpgrades += 1;
        setStatus("周邊 CHMv2 surface tiles 已補齊；正在升級為完整陰影…");
        setTimeout(() => {
          if (!state.enabled || serial !== shadeRebuildSerial) return;
          rebuildShade({ phase: "surface", buildingPolicy: "cached-only" });
        }, Math.max(0, Number(config.metaProgressiveUpgradeDelayMs) || 0));
      })
      .catch((error) => {
        if (pendingProgressiveUpgrade === pending) pendingProgressiveUpgrade = null;
        progressiveCanopyOverlayDeferred = false;
        console.warn("[Haidian Shade] progressive surface completion failed:", error);
        if (state.enabled && serial === shadeRebuildSerial) {
          syncCanopyOverlay();
          syncGroundCanopyShadeOverlay();
          setStatus("漸進式陰影預覽已顯示；部分周邊 CHMv2 資料未能補齊，移動地圖或重新啟用時會再嘗試。", true);
        }
      });
    return true;
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
    const progressivePreview = startProgressiveUpgradeAfterPreview(serial);
    if (progressivePreview) {
      if (metaActivationInProgress && metaActivationStartedAt) {
        metaPerf.lastPreviewMs = Math.round(Math.max(0, monotonicNow() - metaActivationStartedAt));
      }
    } else {
      if (shadeLayerPhase === "surface" && config.buildingProgressiveDecoupleEnabled !== false) {
        if (metaActivationInProgress && metaActivationStartedAt) {
          metaPerf.lastSurfaceCompleteMs = Math.round(Math.max(0, monotonicNow() - metaActivationStartedAt));
        }
        startBuildingUpgradeAfterSurface(serial);
      } else {
        if (metaActivationInProgress && metaActivationStartedAt) {
          const elapsed = Math.round(Math.max(0, monotonicNow() - metaActivationStartedAt));
          if (!metaPerf.lastSurfaceCompleteMs) metaPerf.lastSurfaceCompleteMs = elapsed;
          if (shadeLayerPhase === "full") {
            metaPerf.lastBuildingCompleteMs = elapsed;
            metaPerf.buildingUpgrades += 1;
          }
          metaPerf.lastCompleteMs = elapsed;
          metaActivationInProgress = false;
        }
        setStatus(`陰影計算完成：${modeLabel(state.mode)}。`);
      }
    }
    if (!progressivePreview) {
      syncCanopyOverlay();
      syncGroundCanopyShadeOverlay();
    }
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
        ".glass-header,.drawer-panel,.global-player," +
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

  function closeConflictingPopupForPointQuery() {
    if (!mapRef) return;
    const popup = mapRef._popup;
    if (!popup || popup === queryPopup) return;
    try {
      if (typeof mapRef.hasLayer === "function" && !mapRef.hasLayer(popup)) return;
      if (typeof mapRef.closePopup === "function") mapRef.closePopup(popup);
      else if (typeof mapRef.removeLayer === "function") mapRef.removeLayer(popup);
    } catch (_) {}
  }

  async function runPointQueryAtLatLng(latlng) {
    if (!latlng || !Number.isFinite(Number(latlng.lat)) || !Number.isFinite(Number(latlng.lng))) return;
    closeConflictingPopupForPointQuery();

    const serial = ++pointQuerySerial;
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
        if (shade.groundCanopy && shade.groundCanopyTree) {
          model.shadeSource = {
            type: "tree",
            tree: shade.groundCanopyTree,
            confidence: "high",
            method: "CHMv2 地面樹蔭反向太陽光線判讀"
          };
          model.shadeSourceResolving = false;
        } else {
          resolvePointShadeSource(serial, model);
        }
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

  async function handleMapPointQuery(event) {
    if (!state.enabled || !state.queryOnClick || !mapRef || !window.L) return;
    if (mapPointQueryShouldYield(event)) return;
    return runPointQueryAtLatLng(event && event.latlng);
  }

  function handleInteractivePathPointQueryCapture(event) {
    // v8.6.2: when point-query mode is enabled, clicking a Leaflet building
    // polygon must measure that geographic point instead of opening/selecting
    // the building layer. Capture only interactive map paths; controls, markers,
    // popups, drawing/NIMBY/listening modes keep their original behavior.
    if (!state.enabled || !state.queryOnClick || !mapRef || !event) return;
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (!target.closest(".leaflet-interactive")) return;
    if (target.closest(".leaflet-control,.leaflet-popup,.leaflet-tooltip,.leaflet-marker-icon")) return;

    const synthetic = { originalEvent: event, latlng: null };
    if (mapPointQueryShouldYield(synthetic)) return;

    let latlng = null;
    try {
      if (typeof mapRef.mouseEventToLatLng === "function") {
        latlng = mapRef.mouseEventToLatLng(event);
      } else if (typeof mapRef.containerPointToLatLng === "function" && typeof mapRef.mouseEventToContainerPoint === "function") {
        latlng = mapRef.containerPointToLatLng(mapRef.mouseEventToContainerPoint(event));
      }
    } catch (_) {}
    if (!latlng) return;

    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    Promise.resolve(runPointQueryAtLatLng(latlng)).catch((error) => {
      console.warn("[Haidian Shade] point-query interactive-path capture:", error);
    });
  }

  function hookMapPointQuery() {
    if (!mapRef || mapQueryHooked || typeof mapRef.on !== "function") return;
    mapQueryHooked = true;

    const markQueryForNavigation = () => {
      lastMapDragAt = Date.now();
      if (!activePointQuery || activePointQuery.serial !== pointQuerySerial || !queryPopup) return;
      activePointQuery.model.navigationUpdating = true;
      refreshPointQueryTooltip(activePointQuery.serial, activePointQuery.model);
    };

    // v8.4.0: a point card is a geographic bookmark, not a viewport artifact.
    // Keep its marker/cell/tooltip attached to the same LatLng while panning or
    // zooming; the current renderer's idle event refreshes the sun/shade result.
    mapRef.on("movestart", markQueryForNavigation);
    mapRef.on("zoomstart", markQueryForNavigation);
    mapRef.on("viewreset", markQueryForNavigation);
    mapRef.on("zoomlevelschange", markQueryForNavigation);
    mapRef.on("dragend", () => { lastMapDragAt = Date.now(); });
    mapRef.on("click", handleMapPointQuery);
    const mapContainer = typeof mapRef.getContainer === "function" ? mapRef.getContainer() : null;
    if (mapContainer && typeof mapContainer.addEventListener === "function") {
      mapContainer.addEventListener("click", handleInteractivePathPointQueryCapture, true);
    }
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

  async function runWithConcurrency(items, concurrency, task, progressSerial, options = {}) {
    let cursor = 0;
    let done = 0;
    let started = 0;
    const results = [];
    const shouldContinue = typeof options.shouldContinue === "function"
      ? options.shouldContinue
      : null;
    const worker = async () => {
      while (true) {
        if (shouldContinue && !shouldContinue()) return;
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        started += 1;
        try {
          const result = await task(items[index], index);
          results[index] = result;
        } catch (error) {
          results[index] = null;
          console.warn("[Haidian Shade] tile build failed:", items[index], error);
        }
        done += 1;
        if (options.yieldBetweenTasks === true && index < items.length - 1) {
          await yieldToBrowser();
        }
        if (
          options.suppressStatus !== true &&
          (done === 1 || done % 12 === 0 || done === items.length) &&
          (progressSerial == null || progressSerial === shadeRebuildSerial)
        ) {
          setStatus(`正在準備 Meta CHMv2 樹冠高度… ${done}/${items.length}`);
        }
      }
    };

    const count = Math.max(1, Math.min(concurrency, items.length || 1));
    await Promise.all(Array.from({ length: count }, worker));
    metaPerf.staleQueuedSkipped += Math.max(0, items.length - started);
    return results;
  }

  function liveMetaTilesForSnapshot(view) {
    if (!view) return { tiles: [], zooms: [] };
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
    const centerLat = (view.north + view.south) / 2;
    const centerLng = (view.east + view.west) / 2;

    const casterBuffers = [];
    for (const z of zooms) {
      const range = metaTileRangeForSnapshot(view, z);
      casterBuffers.push({ z, ...range.caster });
      const centerTile = lonLatToXYZ(centerLat, centerLng, z);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          tiles.push({
            x, y, z,
            priority: Math.abs(x - centerTile.x) + Math.abs(y - centerTile.y)
          });
        }
      }
    }

    // Center-first ordering does not change numerical results. It only means that
    // an interrupted viewport job leaves the most useful hot tiles behind.
    tiles.sort((a, b) => a.priority - b.priority || b.z - a.z || a.y - b.y || a.x - b.x);
    return { tiles, zooms, casterBuffers };
  }

  function summarizePreparedMetaTiles(tiles, zooms, view, loaded) {
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

  async function prepareLiveMetaSurface(snapshot, serial, options = {}) {
    await ensureGeoTIFF();
    if (!mapRef) throw new Error("Leaflet map 尚未就緒。");

    const view = snapshot || captureViewSnapshot();
    if (!view) throw new Error("無法取得目前地圖視野。");

    // Freeze zoom/bounds at rebuild start. If the user moves again, the serial
    // becomes stale: already-running range requests may finish and warm caches,
    // but queued obsolete tiles are no longer started and can never mount a layer.
    const plan = liveMetaTilesForSnapshot(view);
    const tiles = plan.tiles;
    const zooms = plan.zooms;

    if (tiles.length > config.metaMaxPreparedTiles) {
      throw new Error(
        `目前視野需準備 ${tiles.length} 張 CHMv2 tiles，超過安全上限 ${config.metaMaxPreparedTiles}；請再放大地圖。`
      );
    }

    const activeConcurrency = effectiveMetaConcurrency(config.metaTileConcurrency, "active");
    metaPerf.activeConcurrencyLast = activeConcurrency;
    const shouldContinue = () => serial === shadeRebuildSerial && state.enabled;
    const progressiveMinTiles = Math.max(2, Math.floor(Number(config.metaProgressiveMinTiles) || 2));
    const allowProgressive = options.progressive === true &&
      config.metaProgressiveEnabled !== false &&
      tiles.length >= progressiveMinTiles;

    if (allowProgressive) {
      const split = progressiveTileSplit(tiles);
      if (split.background.length) {
        metaPerf.progressiveRuns += 1;
        metaPerf.progressiveInitialTiles += split.initial.length;
        metaPerf.progressiveBackgroundTiles += split.background.length;

        const initialStartedAt = monotonicNow();
        const initialResults = await runWithConcurrency(
          split.initial,
          activeConcurrency,
          (tile) => buildLiveSurfaceTile(tile.x, tile.y, tile.z),
          serial,
          { shouldContinue }
        );
        const initialLoaded = initialResults.filter(Boolean).length;
        metaPerf.progressiveInitialMs += Math.max(0, monotonicNow() - initialStartedAt);
        if (!initialLoaded) throw new Error("目前視野無法建立漸進式首幀 surface tiles。");

        // v8.3.1 fast preview: v8.3.0 still blocked the first frame while it
        // synchronously created one ground-only PNG blob for every background tile.
        // Real-browser timing showed that path dominated preview latency. By default
        // use one shared 0 m Terrarium placeholder for peripheral tiles and let the
        // post-idle upgrade replace them with full CHMv2+DTM surfaces. The slower
        // ground-blob path remains available as an explicit accuracy/debug option.
        const fallbackStartedAt = monotonicNow();
        const fallbackMode = String(config.metaProgressiveFallbackMode || "flat-zero");
        let provisionalLoaded = 0;
        if (fallbackMode === "ground-blob") {
          const provisionalResults = await runWithConcurrency(
            split.background,
            activeConcurrency,
            (tile) => buildProvisionalBareSurfaceTile(tile.x, tile.y, tile.z),
            serial,
            { suppressStatus: true, shouldContinue }
          );
          provisionalLoaded = provisionalResults.filter(Boolean).length;
        } else {
          // Materialize once before the SDK asks synchronously for tile URLs.
          flatZeroTerrariumUrl();
          provisionalLoaded = split.background.length;
          metaPerf.progressiveFlatFallbackTiles += split.background.length;
        }
        metaPerf.progressiveFallbackMs += Math.max(0, monotonicNow() - fallbackStartedAt);
        metaPerf.progressiveProvisionalTiles += provisionalLoaded;
        metaProgressiveUsed = true;

        let backgroundPromise = null;
        const backgroundConcurrency = effectiveMetaConcurrency(
          Number(config.metaProgressiveBackgroundConcurrency) || Math.min(4, activeConcurrency),
          "background"
        );
        metaPerf.progressiveBackgroundConcurrencyLast = backgroundConcurrency;
        const startBackground = () => {
          if (backgroundPromise) return backgroundPromise;
          const startedAt = monotonicNow();
          backgroundPromise = runWithConcurrency(
            split.background,
            backgroundConcurrency,
            (tile) => buildLiveSurfaceTile(tile.x, tile.y, tile.z),
            serial,
            { suppressStatus: true, shouldContinue, yieldBetweenTasks: true }
          ).then((results) => {
            const backgroundLoaded = results.filter(Boolean).length;
            const elapsed = Math.max(0, monotonicNow() - startedAt);
            metaPerf.progressiveBackgroundMs += elapsed;
            const summary = summarizePreparedMetaTiles(
              tiles, zooms, view, initialLoaded + backgroundLoaded
            );
            metaPerf.lastProgressive = {
              initial: split.initial.length,
              initialLoaded,
              provisionalLoaded,
              background: split.background.length,
              backgroundLoaded,
              elapsedMs: Math.round(elapsed),
              completed: serial === shadeRebuildSerial && state.enabled
            };
            return summary;
          }).catch((error) => {
            metaPerf.lastProgressive = {
              initial: split.initial.length,
              initialLoaded,
              provisionalLoaded,
              background: split.background.length,
              backgroundLoaded: 0,
              elapsedMs: Math.round(Math.max(0, monotonicNow() - startedAt)),
              error: error && error.message ? error.message : String(error),
              completed: false
            };
            throw error;
          });
          return backgroundPromise;
        };

        const summary = summarizePreparedMetaTiles(split.initial, zooms, view, initialLoaded);
        return Object.assign(summary, {
          total: tiles.length,
          progressive: true,
          initialTotal: split.initial.length,
          provisionalTotal: provisionalLoaded,
          fallbackMode,
          backgroundTotal: split.background.length,
          startBackground
        });
      }
    }

    const results = await runWithConcurrency(
      tiles,
      activeConcurrency,
      (tile) => buildLiveSurfaceTile(tile.x, tile.y, tile.z),
      serial,
      { shouldContinue }
    );
    const loaded = results.filter(Boolean).length;
    if (!loaded) throw new Error("目前視野無法建立地形 surface tiles。");

    return summarizePreparedMetaTiles(tiles, zooms, view, loaded);
  }

  function installMetaPreconnectHints() {
    if (!document || !document.head || typeof document.createElement !== "function") return;
    const urls = [config.metaCogBaseUrl, config.geotiffUrl];
    const seen = new Set();
    for (const value of urls) {
      if (!value) continue;
      try {
        const origin = new URL(value, window.location && window.location.href ? window.location.href : undefined).origin;
        if (!origin || seen.has(origin)) continue;
        seen.add(origin);
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = origin;
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
      } catch (_) {}
    }
  }

  function cancelMetaWarmStart() {
    metaWarmStartSerial += 1;
    clearTimeout(metaWarmStartTimer);
    metaWarmStartTimer = null;
    if (metaWarmStartIdleHandle != null && typeof window.cancelIdleCallback === "function") {
      try { window.cancelIdleCallback(metaWarmStartIdleHandle); } catch (_) {}
    }
    metaWarmStartIdleHandle = null;
  }

  async function runMetaWarmStart(localSerial) {
    if (
      localSerial !== metaWarmStartSerial ||
      metaWarmStartCompleted ||
      state.enabled ||
      state.mode === "buildings" ||
      config.metaMode !== "live-cog" ||
      config.metaWarmStartEnabled === false ||
      !mapRef
    ) return;

    const view = captureViewSnapshot();
    if (!view) return;
    if (prebuiltRegionForSnapshot(view) && await prebuiltSurfaceAvailable(view)) {
      metaPerf.lastWarmStart = { attempted: 0, loaded: 0, elapsedMs: 0, skipped: "prebuilt-coverage", completed: true };
      metaWarmStartCompleted = true;
      scheduleBuildingWarmPrefetch();
      return;
    }
    const plan = liveMetaTilesForSnapshot(view);
    const maxTiles = Math.max(0, Number(config.metaWarmStartMaxTiles) || 0);
    const tiles = maxTiles ? plan.tiles.slice(0, maxTiles) : [];
    if (!tiles.length) return;

    const startedAt = monotonicNow();
    metaPerf.warmStartRuns += 1;
    metaPerf.warmStartTiles += tiles.length;
    try {
      await ensureGeoTIFF();
      if (localSerial !== metaWarmStartSerial || state.enabled) return;
      const warmConcurrency = effectiveMetaConcurrency(config.metaWarmStartConcurrency, "warm");
      metaPerf.warmConcurrencyLast = warmConcurrency;
      const results = await runWithConcurrency(
        tiles,
        warmConcurrency,
        (tile) => buildLiveSurfaceTile(tile.x, tile.y, tile.z),
        null,
        {
          suppressStatus: true,
          shouldContinue: () => localSerial === metaWarmStartSerial && !state.enabled
        }
      );
      const loaded = results.filter(Boolean).length;
      const elapsed = Math.max(0, monotonicNow() - startedAt);
      metaPerf.warmStartLoaded += loaded;
      metaPerf.warmStartMs += elapsed;
      metaPerf.lastWarmStart = {
        attempted: tiles.length,
        loaded,
        elapsedMs: Math.round(elapsed),
        zooms: plan.zooms.slice(),
        completed: localSerial === metaWarmStartSerial && !state.enabled
      };
      if (localSerial === metaWarmStartSerial && !state.enabled) {
        metaWarmStartCompleted = true;
        scheduleBuildingWarmPrefetch();
      }
    } catch (error) {
      metaPerf.lastWarmStart = {
        attempted: tiles.length,
        loaded: 0,
        elapsedMs: Math.round(Math.max(0, monotonicNow() - startedAt)),
        error: error && error.message ? error.message : String(error),
        completed: false
      };
      console.debug("[Haidian Shade] CHMv2 warm-start skipped:", error);
    }
  }

  function scheduleMetaWarmStart() {
    if (
      metaWarmStartCompleted ||
      config.metaWarmStartEnabled === false ||
      config.metaMode !== "live-cog" ||
      state.mode === "buildings" ||
      state.enabled
    ) return;

    cancelMetaWarmStart();
    const localSerial = metaWarmStartSerial;
    const delayMs = Math.max(0, Number(config.metaWarmStartDelayMs) || 0);
    metaWarmStartTimer = setTimeout(() => {
      metaWarmStartTimer = null;
      const invoke = () => {
        metaWarmStartIdleHandle = null;
        runMetaWarmStart(localSerial);
      };
      if (typeof window.requestIdleCallback === "function") {
        metaWarmStartIdleHandle = window.requestIdleCallback(invoke, { timeout: 2500 });
      } else {
        invoke();
      }
    }, delayMs);
  }

  function getMetaDiagnostics() {
    return {
      mode: config.metaMode,
      warmStartEnabled: config.metaWarmStartEnabled !== false,
      warmStartCompleted: metaWarmStartCompleted,
      progressiveEnabled: config.metaProgressiveEnabled !== false,
      progressiveUsed: metaProgressiveUsed,
      progressivePending: !!pendingProgressiveUpgrade,
      buildingUpgradePending: !!pendingBuildingUpgrade,
      geoTiffWorkerPoolEnabled: config.metaGeoTiffWorkerPoolEnabled !== false,
      geoTiffWorkerPoolActive: !!geoTiffWorkerPool && !geoTiffWorkerPoolDisabled,
      groundCanopyShadeEnabled: config.groundCanopyShadeEnabled !== false && state.groundCanopyShade,
      shadeLayerPhase,
      counters: Object.assign({}, metaPerf, {
        lastWarmStart: metaPerf.lastWarmStart ? Object.assign({}, metaPerf.lastWarmStart) : null
      }),
      cache: {
        cogs: metaCogCache.size,
        canopyRasters: canopyRasterCache.size,
        canopyPending: canopyRasterPromises.size,
        surfaceUrls: metaSurfaceUrls.size,
        provisionalSurfaceUrls: metaProvisionalSurfaceUrls.size,
        surfacePending: metaSurfacePromises.size,
        demBitmaps: demBitmapCache.size
      }
    };
  }

  function resetMetaDiagnostics() {
    for (const key of Object.keys(metaPerf)) {
      if (key === "lastWarmStart" || key === "lastProgressive" || key === "lastBuildingError") metaPerf[key] = null;
      else metaPerf[key] = 0;
    }
  }

  function liveMetaTerrainSource(options = {}) {
    const useFlatFallback = options.flatFallback === true;
    const flatUrl = useFlatFallback ? flatZeroTerrariumUrl() : null;
    return {
      tileSize: 256,
      maxZoom: config.metaMaxZoom,
      getSourceUrl: ({ x, y, z }) => {
        const key = tileKey(x, y, z);
        const cached = metaSurfaceUrls.get(key);
        if (cached) return cached;
        const provisional = metaProvisionalSurfaceUrls.get(key);
        if (provisional) return provisional;

        // Progressive preview must not block on 18+ synthesized ground blobs.
        // A single flat tile keeps the peripheral renderer valid for a few seconds;
        // the automatic complete rebuild replaces it with CHMv2+DTM surfaces.
        if (flatUrl) return flatUrl;

        // Non-progressive misses retain the previous bare-DEM fallback behavior.
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

  function parseHeightInfo(tags, areaM2 = 0) {
    const t = tags || {};

    if (t.height != null) {
      const raw = String(t.height).trim().toLowerCase();
      const value = parseFloat(raw.replace(",", "."));
      if (Number.isFinite(value) && value > 0) {
        return {
          height: raw.includes("ft") || raw.includes("'") ? value * 0.3048 : value,
          source: "OSM height",
          quality: "direct"
        };
      }
    }

    if (t["building:levels"] != null) {
      const levels = parseFloat(String(t["building:levels"]).replace(",", "."));
      if (Number.isFinite(levels) && levels > 0) {
        return {
          height: levels * config.defaultStoreyHeight,
          source: `OSM building:levels × ${config.defaultStoreyHeight} m`,
          quality: "floors-derived"
        };
      }
    }

    const text = `${t.building || ""} ${t["building:use"] || ""} ${t.amenity || ""} ${t.office || ""} ${t.shop || ""}`.toLowerCase();
    let height = null;
    let source = "";
    if (/shed|garage|carport|hut|storage/.test(text)) {
      height = 3.1;
      source = "OSM semantic heuristic: ancillary structure";
    } else if (/warehouse|industrial|factory/.test(text)) {
      height = 7.0;
      source = "OSM semantic heuristic: industrial/warehouse";
    } else if (/school|education|college|university|civic|public/.test(text)) {
      height = 12.4;
      source = "OSM semantic heuristic: education/public building";
    } else if (/commercial|office|retail|hospital|hotel/.test(text)) {
      height = 12.4;
      source = "OSM semantic heuristic: commercial/institutional building";
    } else if (/apartments|residential/.test(text)) {
      height = areaM2 >= 500 ? 18.6 : (areaM2 >= 180 ? 12.4 : 9.3);
      source = "OSM semantic/footprint heuristic: residential building";
    } else if (/house|detached|terrace/.test(text)) {
      height = 9.3;
      source = "OSM semantic heuristic: house/terrace";
    } else if (areaM2 > 0) {
      if (areaM2 < 35) height = 3.1;
      else if (areaM2 < 180) height = 9.3;
      else if (areaM2 < 1200) height = 12.4;
      else height = 15.5;
      source = "OSM footprint heuristic";
    } else {
      height = config.defaultBuildingHeight;
      source = "預設估計值";
    }

    return { height, source, quality: "heuristic" };
  }

  function parseHeight(tags, areaM2 = 0) {
    return parseHeightInfo(tags, areaM2).height;
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

  function currentBuildingFetchPaddingM(bounds) {
    const base = Math.max(0, Number(config.buildingShadowFetchPaddingM) || 0);
    if (config.buildingShadowDynamicPaddingEnabled === false || !bounds) return base;
    try {
      const center = mapRef && typeof mapRef.getCenter === "function"
        ? mapRef.getCenter()
        : { lat: (bounds.getSouth() + bounds.getNorth()) / 2, lng: (bounds.getWest() + bounds.getEast()) / 2 };
      const solar = solarPositionAt(center, state.date);
      if (!solar || solar.night) return base;
      const altitude = Math.max(1.5, Number(solar.altitudeDeg) || 1.5) * Math.PI / 180;
      const casterHeight = Math.max(3.1, Number(config.buildingShadowMaxCasterHeightM) || 120);
      const physical = casterHeight / Math.max(0.02, Math.tan(altitude));
      const maxPad = Math.max(base, Number(config.buildingShadowFetchPaddingMaxM) || 1800);
      return Math.min(maxPad, Math.max(base, physical + 40));
    } catch (_) {
      return base;
    }
  }

  function paddedBuildingBounds(bounds) {
    const paddingM = currentBuildingFetchPaddingM(bounds);
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


  function normalizeBuildingCoverageRegion(raw, fallbackId = "coverage") {
    let values = null;
    let id = fallbackId;
    let label = "";
    if (Array.isArray(raw)) {
      values = raw.slice(0, 4).map(Number);
    } else if (raw && typeof raw === "object") {
      if (Array.isArray(raw.aoi)) values = raw.aoi.slice(0, 4).map(Number);
      else values = [raw.west, raw.south, raw.east, raw.north].map(Number);
      id = String(raw.id || raw.code || fallbackId);
      label = String(raw.label || raw.name || "");
    }
    if (!values || values.length < 4 || !values.every(Number.isFinite)) return null;
    if (!(values[0] < values[2] && values[1] < values[3])) return null;
    return { id, label, west: values[0], south: values[1], east: values[2], north: values[3] };
  }

  function buildingManifestCoverageRegions(manifest) {
    const rawRegions = manifest && Array.isArray(manifest.coverage_regions)
      ? manifest.coverage_regions
      : (manifest && manifest.latest_run && Array.isArray(manifest.latest_run.coverage_regions)
        ? manifest.latest_run.coverage_regions
        : null);
    const regions = [];
    if (rawRegions) {
      rawRegions.forEach((raw, i) => {
        const region = normalizeBuildingCoverageRegion(raw, `coverage-${i + 1}`);
        if (region) regions.push(region);
      });
    }
    if (regions.length) return regions;
    const legacyRaw = manifest && manifest.latest_run && Array.isArray(manifest.latest_run.aoi)
      ? manifest.latest_run.aoi
      : (manifest && Array.isArray(manifest.aoi) ? manifest.aoi : null);
    const legacy = normalizeBuildingCoverageRegion(legacyRaw, "legacy-aoi");
    return legacy ? [legacy] : [];
  }

  function buildingManifestAoi(manifest) {
    const regions = buildingManifestCoverageRegions(manifest);
    if (!regions.length) return null;
    return {
      west: Math.min(...regions.map((r) => r.west)),
      south: Math.min(...regions.map((r) => r.south)),
      east: Math.max(...regions.map((r) => r.east)),
      north: Math.max(...regions.map((r) => r.north))
    };
  }

  async function loadBuildingManifest() {
    if (buildingManifestCache) return buildingManifestCache;
    if (buildingManifestPromise) return buildingManifestPromise;
    if (!config.buildingManifestUrl) return null;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Math.max(1000, Number(config.buildingManifestFetchClientTimeoutMs) || 4000);
    const timeoutId = controller ? setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs) : null;
    buildingManifestPromise = fetch(config.buildingManifestUrl, controller ? { signal: controller.signal } : undefined)
      .then(async (response) => {
        if (!response.ok) throw new Error(`building manifest HTTP ${response.status}`);
        const workerDataVersion = String(response.headers && response.headers.get("X-Building-Data-Version") || "").trim();
        const expectedVersion = String(config.buildingDataVersion || "").trim();
        if (config.buildingManifestRequireVersionHeader !== false && expectedVersion && !workerDataVersion) {
          throw new Error("building manifest missing X-Building-Data-Version");
        }
        if (expectedVersion && workerDataVersion && workerDataVersion !== expectedVersion) {
          throw new Error(`building data version mismatch: worker=${workerDataVersion}, site=${expectedVersion}`);
        }
        const manifest = await response.json();
        manifest.__workerDataVersion = workerDataVersion;
        return manifest;
      })
      .then((manifest) => {
        if (!buildingManifestAoi(manifest)) throw new Error("building manifest has no valid AOI");
        buildingManifestCache = manifest;
        return manifest;
      })
      .catch((error) => {
        buildingManifestPromise = null;
        throw error;
      })
      .finally(() => { if (timeoutId) clearTimeout(timeoutId); });
    return buildingManifestPromise;
  }

  function normalizeBuildingTileKey(value) {
    const key = String(value || "").replace(/^\/+/, "");
    return /^\d+\/\d+\/\d+\.geojson$/.test(key) ? key : "";
  }

  function normalizeBuildingTileIndex(index) {
    const expectedVersion = String(config.buildingDataVersion || "").trim();
    const indexVersion = String(index && index.data_version || "").trim();
    const indexZoom = Number(index && index.tile_zoom);
    const configuredZoom = Number(config.buildingTileZoom) || 16;
    if (expectedVersion && indexVersion !== expectedVersion) {
      throw new Error(`building tile index version mismatch: index=${indexVersion || "missing"}, site=${expectedVersion}`);
    }
    if (!Number.isFinite(indexZoom) || indexZoom !== configuredZoom) {
      throw new Error(`building tile index zoom ${indexZoom} != configured ${configuredZoom}`);
    }

    const keys = Array.isArray(index && index.tile_keys)
      ? index.tile_keys.map(normalizeBuildingTileKey).filter(Boolean)
      : [];
    const tileKeySet = keys.length ? new Set(keys) : null;

    const rowRangeMap = new Map();
    const rows = index && Array.isArray(index.x_ranges) ? index.x_ranges : [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const x = Number(row[0]);
      if (!Number.isSafeInteger(x)) continue;
      const ranges = [];
      for (let i = 1; i + 1 < row.length; i += 2) {
        const y0 = Number(row[i]);
        const y1 = Number(row[i + 1]);
        if (!Number.isSafeInteger(y0) || !Number.isSafeInteger(y1)) continue;
        ranges.push([Math.min(y0, y1), Math.max(y0, y1)]);
      }
      if (ranges.length) rowRangeMap.set(x, ranges);
    }

    const declaredCount = Number(index && index.tile_count);
    const hasCompact = rowRangeMap.size > 0;
    if (!tileKeySet && !hasCompact && declaredCount > 0) {
      throw new Error("building tile index has no usable tile_keys or x_ranges");
    }
    return Object.assign({}, index, {
      tileKeySet,
      tile_keys: keys,
      rowRangeMap,
      indexEncoding: hasCompact ? String(index.encoding || "x-y-ranges-v1") : "tile-keys-v1"
    });
  }

  function buildingTileIndexHas(index, tile) {
    if (!index || !tile) return false;
    const z = Number(tile.z);
    const x = Number(tile.x);
    const y = Number(tile.y);
    if (![z, x, y].every(Number.isSafeInteger)) return false;
    if (index.tileKeySet) return index.tileKeySet.has(`${z}/${x}/${y}.geojson`);
    if (index.rowRangeMap instanceof Map) {
      const ranges = index.rowRangeMap.get(x);
      if (!ranges) return false;
      return ranges.some((pair) => y >= pair[0] && y <= pair[1]);
    }
    return false;
  }

  async function loadBuildingTileIndex() {
    if (buildingTileIndexCache) return buildingTileIndexCache;
    if (buildingTileIndexPromise) return buildingTileIndexPromise;
    if (!config.buildingTileIndexUrl) return null;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Math.max(1000, Number(config.buildingTileIndexFetchClientTimeoutMs) || 4000);
    const timeoutId = controller ? setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs) : null;
    buildingTileIndexPromise = fetch(config.buildingTileIndexUrl, controller ? { signal: controller.signal, cache: "no-store" } : { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`building tile index HTTP ${response.status}`);
        return response.json();
      })
      .then((index) => {
        const normalized = normalizeBuildingTileIndex(index);
        buildingTileIndexCache = normalized;
        return normalized;
      })
      .catch((error) => {
        buildingTileIndexPromise = null;
        throw error;
      })
      .finally(() => { if (timeoutId) clearTimeout(timeoutId); });
    return buildingTileIndexPromise;
  }

  function buildingPipelineCoverageForBounds(padded, manifest) {
    const regions = buildingManifestCoverageRegions(manifest);
    const aoi = buildingManifestAoi(manifest);
    if (!regions.length || !padded) return { status: "unknown", aoi, regions: [], matchedRegions: [] };
    const overlaps = regions.filter((region) => !(
      padded.east < region.west || padded.west > region.east ||
      padded.north < region.south || padded.south > region.north
    ));
    const fullRegion = regions.find((region) => (
      padded.west >= region.west && padded.east <= region.east &&
      padded.south >= region.south && padded.north <= region.north
    ));
    return {
      status: fullRegion ? "full" : (overlaps.length ? "partial" : "outside"),
      aoi,
      regions,
      matchedRegions: overlaps.map((region) => region.id),
      fullRegion: fullRegion ? fullRegion.id : ""
    };
  }

  function buildingHeightFamily(feature) {
    const props = feature && feature.properties ? feature.properties : {};
    const text = `${props.class || ""} ${props.subtype || ""} ${props.building || ""} ${props.amenity || ""}`.toLowerCase();
    if (/apartments|residential|dormitory|house|detached|terrace/.test(text)) return "residential";
    if (/school|education|college|university|civic|public/.test(text)) return "education-public";
    if (/commercial|office|retail|hospital|hotel/.test(text)) return "commercial-institutional";
    if (/warehouse|industrial|factory/.test(text)) return "industrial";
    if (/shed|garage|carport|hut|storage/.test(text)) return "ancillary";
    return "generic";
  }

  function buildingFeatureMetrics(feature) {
    const geometry = feature && feature.geometry;
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    let sumArea = 0;
    let weightedLat = 0;
    let weightedLng = 0;

    for (const polygon of polygons || []) {
      const ring = polygon && polygon[0];
      if (!Array.isArray(ring) || ring.length < 4) continue;
      let latMean = 0;
      let count = 0;
      for (const point of ring) {
        if (!Array.isArray(point) || point.length < 2) continue;
        latMean += Number(point[1]);
        count += 1;
      }
      if (!count) continue;
      latMean = latMean / count;
      const cosLat = Math.max(0.1, Math.cos(latMean * Math.PI / 180));
      const metersPerLon = 111320 * cosLat;
      const metersPerLat = 111320;
      let twiceArea = 0;
      let cxNumerator = 0;
      let cyNumerator = 0;
      for (let i = 0; i < ring.length - 1; i += 1) {
        const a = ring[i];
        const b = ring[i + 1];
        if (!a || !b) continue;
        const ax = Number(a[0]) * metersPerLon;
        const ay = Number(a[1]) * metersPerLat;
        const bx = Number(b[0]) * metersPerLon;
        const by = Number(b[1]) * metersPerLat;
        if (![ax, ay, bx, by].every(Number.isFinite)) continue;
        const cross = ax * by - bx * ay;
        twiceArea += cross;
        cxNumerator += (ax + bx) * cross;
        cyNumerator += (ay + by) * cross;
      }
      const signedArea = twiceArea / 2;
      const area = Math.abs(signedArea);
      if (!(area > 0.5)) continue;
      let lng = 0;
      let lat = 0;
      if (Math.abs(twiceArea) > 1e-9) {
        const cx = cxNumerator / (3 * twiceArea);
        const cy = cyNumerator / (3 * twiceArea);
        lng = cx / metersPerLon;
        lat = cy / metersPerLat;
      } else {
        const valid = ring.filter((pt) => pt && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])));
        if (!valid.length) continue;
        lng = valid.reduce((sum, pt) => sum + Number(pt[0]), 0) / valid.length;
        lat = valid.reduce((sum, pt) => sum + Number(pt[1]), 0) / valid.length;
      }
      sumArea += area;
      weightedLng += lng * area;
      weightedLat += lat * area;
    }

    if (!(sumArea > 0)) return null;
    return { areaM2: sumArea, lat: weightedLat / sumArea, lng: weightedLng / sumArea };
  }

  function buildingMetricDistanceM(a, b) {
    if (!a || !b) return Infinity;
    const rad = Math.PI / 180;
    const lat1 = Number(a.lat) * rad;
    const lat2 = Number(b.lat) * rad;
    const dLat = lat2 - lat1;
    const dLng = (Number(b.lng) - Number(a.lng)) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
  }

  function weightedMedianHeight(entries) {
    const sorted = (entries || []).slice().sort((a, b) => a.height - b.height);
    const total = sorted.reduce((sum, item) => sum + item.weight, 0);
    if (!(total > 0)) return null;
    let acc = 0;
    for (const item of sorted) {
      acc += item.weight;
      if (acc >= total / 2) return item.height;
    }
    return sorted.length ? sorted[sorted.length - 1].height : null;
  }

  function calibrateLowConfidenceBuildingHeights(features, contextFeatures) {
    const targets = Array.isArray(features) ? features : [];
    const context = Array.isArray(contextFeatures) ? contextFeatures : targets;
    if (!targets.length || !context.length) return targets;

    const radius = Math.max(100, Number(config.buildingHeightContextRadiusM) || 1200);
    const minAnchors = Math.max(2, Number(config.buildingHeightContextMinAnchors) || 2);
    const maxAnchors = Math.max(minAnchors, Number(config.buildingHeightContextMaxAnchors) || 6);
    const minRatio = Math.max(0.1, Number(config.buildingHeightContextAreaRatioMin) || 0.45);
    const maxRatio = Math.max(minRatio, Number(config.buildingHeightContextAreaRatioMax) || 2.2);
    const maxHeight = Math.max(12.4, Number(config.buildingHeightContextMaxM) || 80);

    const anchors = [];
    for (const feature of context) {
      const props = feature && feature.properties ? feature.properties : {};
      const quality = String(props.height_quality || "").toLowerCase();
      const height = Number(props.height ?? props.render_height);
      if (!["direct", "floors-derived"].includes(quality) || !Number.isFinite(height) || height <= 0) continue;
      const metrics = buildingFeatureMetrics(feature);
      if (!metrics) continue;
      anchors.push({ feature, props, metrics, height, family: buildingHeightFamily(feature) });
    }
    if (anchors.length < minAnchors) return targets;

    for (const feature of targets) {
      const props = feature && feature.properties ? feature.properties : {};
      const quality = String(props.height_quality || "").toLowerCase();
      if (!["heuristic", "fallback", "estimated", "missing", ""].includes(quality)) continue;
      const metrics = buildingFeatureMetrics(feature);
      if (!metrics) continue;
      const family = buildingHeightFamily(feature);
      // Do not extrapolate a generic/unknown footprint from unrelated anchor
      // classes. Context calibration is only allowed when the building has a
      // meaningful semantic family (residential, school, commercial, etc.).
      if (family === "generic") continue;
      const candidates = [];
      for (const anchor of anchors) {
        if (anchor.feature === feature) continue;
        if (family !== "generic" && anchor.family !== family) continue;
        const ratio = anchor.metrics.areaM2 / Math.max(1, metrics.areaM2);
        if (ratio < minRatio || ratio > maxRatio) continue;
        const distance = buildingMetricDistanceM(metrics, anchor.metrics);
        if (!Number.isFinite(distance) || distance > radius) continue;
        const areaPenalty = Math.abs(Math.log(Math.max(0.01, ratio)));
        const weight = 1 / Math.max(50, distance + 180 * areaPenalty);
        candidates.push({ height: anchor.height, distance, weight, ratio });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      const selected = candidates.slice(0, maxAnchors);
      if (selected.length < minAnchors) continue;
      const inferred = weightedMedianHeight(selected);
      if (!Number.isFinite(inferred) || inferred <= 0) continue;
      const height = Math.round(Math.min(maxHeight, Math.max(3.1, inferred)) * 1000) / 1000;
      const original = Number(props.height ?? props.render_height);
      props.height_original_estimate_m = Number.isFinite(original) ? original : null;
      props.height = height;
      props.render_height = height;
      props.height_quality = "context-inferred";
      props.height_source = `local class/footprint matched weighted median of ${selected.length} direct/floor-derived buildings within ${Math.round(radius)} m`;
      props.height_context_anchor_count = selected.length;
      props.height_context_family = family;
    }
    return targets;
  }

  function normalizePipelineBuildingFeature(feature) {
    if (!feature || !feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) return null;
    feature.properties = feature.properties || {};
    const props = feature.properties;
    const h = Number(props.height ?? props.render_height ?? config.defaultBuildingHeight);
    const safeHeight = Number.isFinite(h) && h > 0 ? h : config.defaultBuildingHeight;
    props.height = safeHeight;
    props.render_height = safeHeight;
    props.building_source = props.building_source || props.source || "unknown";
    props.height_source = props.height_source || "prebuilt building tile";
    props.height_quality = props.height_quality || (Number.isFinite(h) && h > 0 ? "estimated" : "fallback");
    props.building_uid = props.building_uid || `${props.building_source}:${props.source_id || props.id || JSON.stringify(feature.geometry).slice(0, 80)}`;
    return feature;
  }

  function buildingTileRangeForBounds(padded, z) {
    const nw = lonLatToXYZ(padded.north, padded.west, z);
    const se = lonLatToXYZ(padded.south, padded.east, z);
    const out = [];
    for (let x = Math.min(nw.x, se.x); x <= Math.max(nw.x, se.x); x += 1) {
      for (let y = Math.min(nw.y, se.y); y <= Math.max(nw.y, se.y); y += 1) out.push({ x, y, z });
    }
    return out;
  }


  function expandPlainBuildingBounds(bounds, extraM) {
    const meters = Math.max(0, Number(extraM) || 0);
    if (!bounds || !meters) return bounds;
    const centerLat = (Number(bounds.south) + Number(bounds.north)) / 2;
    const latPad = meters / 111320;
    const lngPad = meters / (111320 * Math.max(0.2, Math.cos(centerLat * Math.PI / 180)));
    return {
      south: Number(bounds.south) - latPad,
      west: Number(bounds.west) - lngPad,
      north: Number(bounds.north) + latPad,
      east: Number(bounds.east) + lngPad
    };
  }

  async function loadPipelineHeightContext(baseFeatures, padded, z, tileIndex) {
    const features = Array.isArray(baseFeatures) ? baseFeatures : [];
    const needsContext = features.some((feature) => {
      const props = feature && feature.properties ? feature.properties : {};
      const quality = String(props.height_quality || "").toLowerCase();
      return ["heuristic", "fallback", "estimated", "missing", ""].includes(quality);
    });
    if (!needsContext || !tileIndex) return features;

    const radius = Math.max(0, Number(config.buildingHeightContextRadiusM) || 0);
    if (!radius) return features;
    const expanded = expandPlainBuildingBounds(padded, radius);
    const contextTiles = buildingTileRangeForBounds(expanded, z)
      .filter((tile) => buildingTileIndexHas(tileIndex, tile));

    const settled = await Promise.allSettled(contextTiles.map(fetchBuildingTile));
    const unique = new Map();
    for (const feature of features) {
      const props = feature && feature.properties ? feature.properties : {};
      const uid = props.building_uid || `${props.building_source || "unknown"}:${props.source_id || unique.size}`;
      unique.set(uid, feature);
    }
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const feature of result.value || []) {
        const props = feature && feature.properties ? feature.properties : {};
        const uid = props.building_uid || `${props.building_source || "unknown"}:${props.source_id || unique.size}`;
        if (!unique.has(uid)) unique.set(uid, feature);
      }
    }
    return Array.from(unique.values());
  }

  async function fetchBuildingTile(tile) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (buildingTileCache.has(key)) return buildingTileCache.get(key);
    if (!config.buildingTileUrl) return [];
    const url = fillTemplate(config.buildingTileUrl, tile.x, tile.y, tile.z);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Math.max(1000, Number(config.buildingTileFetchClientTimeoutMs) || 5000);
    const timeoutId = controller ? setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs) : null;
    const promise = fetch(url, controller ? { signal: controller.signal } : undefined)
      .then((response) => {
        if (!response.ok) throw new Error(`building tile HTTP ${response.status}`);
        return response.json();
      })
      .then((collection) => (collection.features || []).map(normalizePipelineBuildingFeature).filter(Boolean))
      .catch((error) => {
        buildingTileCache.delete(key);
        throw error;
      })
      .finally(() => { if (timeoutId) clearTimeout(timeoutId); });
    buildingTileCache.set(key, promise);
    const cacheLimit = Math.max(32, Number(config.buildingTileCacheMaxEntries) || 160);
    if (buildingTileCache.size > cacheLimit) buildingTileCache.delete(buildingTileCache.keys().next().value);
    return promise;
  }

  async function loadPipelineBuildings() {
    if (!mapRef || mapRef.getZoom() < config.buildingMinZoom || !config.buildingTileUrl) return [];
    const padded = paddedBuildingBounds(mapRef.getBounds());
    const z = Math.max(0, Number(config.buildingTileZoom) || 16);

    let manifest = null;
    let coverage = { status: "unknown", aoi: null };
    if (config.buildingPipelineCoverageGateEnabled !== false) {
      try {
        manifest = await loadBuildingManifest();
        coverage = buildingPipelineCoverageForBounds(padded, manifest);
      } catch (error) {
        lastBuildingPipelineStatus = {
          mode: "pipeline-manifest-error", sourceCounts: {}, tileCount: 0,
          coverageComplete: false, fetchComplete: false,
          error: error && error.message ? error.message : String(error)
        };
        updateBuildingRuntimeStatus();
        return [];
      }
      if (!manifest || coverage.status === "outside") {
        lastBuildingPipelineStatus = {
          mode: "pipeline-outside-coverage", sourceCounts: {}, tileCount: 0,
          coverageStatus: coverage.status, coverageAoi: coverage.aoi,
          coverageComplete: false, fetchComplete: false, error: null
        };
        updateBuildingRuntimeStatus();
        return [];
      }
      // v8.6.3: partial overlap is no longer thrown away. Load the published
      // pipeline tiles that do exist, then merge them with live OSM for the
      // uncovered part of the viewport. This prevents a hard seam at the pilot AOI.
      const manifestZoom = Number(manifest && manifest.tile_zoom);
      if (Number.isFinite(manifestZoom) && manifestZoom !== z) {
        lastBuildingPipelineStatus = {
          mode: "pipeline-manifest-error", sourceCounts: {}, tileCount: 0,
          coverageComplete: false, fetchComplete: false,
          error: `building manifest tile zoom ${manifestZoom} != configured ${z}`
        };
        updateBuildingRuntimeStatus();
        return [];
      }
    }

    let tileIndex = null;
    if (config.buildingPipelineRequireTileIndex !== false) {
      try {
        tileIndex = await loadBuildingTileIndex();
      } catch (error) {
        lastBuildingPipelineStatus = {
          mode: "pipeline-index-error", sourceCounts: {}, tileCount: 0,
          coverageStatus: coverage.status, coverageAoi: coverage.aoi,
          coverageComplete: false, fetchComplete: false,
          error: error && error.message ? error.message : String(error)
        };
        updateBuildingRuntimeStatus();
        return [];
      }
      if (!tileIndex || (!tileIndex.tileKeySet && !(tileIndex.rowRangeMap instanceof Map))) {
        lastBuildingPipelineStatus = {
          mode: "pipeline-index-error", sourceCounts: {}, tileCount: 0,
          coverageStatus: coverage.status, coverageAoi: coverage.aoi,
          coverageComplete: false, fetchComplete: false,
          error: "building tile index unavailable"
        };
        updateBuildingRuntimeStatus();
        return [];
      }
    }

    const tiles = buildingTileRangeForBounds(padded, z);
    const expectedTiles = tileIndex
      ? tiles.filter((tile) => buildingTileIndexHas(tileIndex, tile))
      : tiles;
    const knownEmptyTileCount = Math.max(0, tiles.length - expectedTiles.length);
    const settled = await Promise.allSettled(expectedTiles.map(fetchBuildingTile));
    const groups = [];
    const errors = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") groups.push(result.value);
      else errors.push({ tile: expectedTiles[i], error: result.reason && result.reason.message ? result.reason.message : String(result.reason) });
    });

    if (errors.length && config.buildingPipelineRequireCompleteTiles !== false) {
      lastBuildingPipelineStatus = {
        mode: "pipeline-incomplete", sourceCounts: {}, tileCount: tiles.length,
        expectedTileCount: expectedTiles.length, knownEmptyTileCount,
        successfulTileCount: groups.length, failedTileCount: errors.length,
        featureCount: 0, coverageStatus: coverage.status, coverageAoi: coverage.aoi,
        coverageComplete: coverage.status === "full", fetchComplete: false,
        errors: errors.slice(0, 4), error: errors[0].error
      };
      console.warn("[Haidian Shade] prebuilt building coverage incomplete; falling back to OSM", errors);
      updateBuildingRuntimeStatus();
      return [];
    }

    const unique = new Map();
    const sourceCounts = {};
    for (const group of groups) {
      for (const feature of group) {
        const props = feature.properties || {};
        const uid = props.building_uid || `${props.building_source || "unknown"}:${props.source_id || unique.size}`;
        if (unique.has(uid)) continue;
        unique.set(uid, feature);
        const source = props.building_source || "unknown";
        sourceCounts[source] = (sourceCounts[source] || 0) + 1;
      }
    }
    const features = Array.from(unique.values());
    const contextFeatures = await loadPipelineHeightContext(features, padded, z, tileIndex);
    calibrateLowConfidenceBuildingHeights(features, contextFeatures);
    lastBuildingFeatures = features;
    lastBuildingCoverageKey = `pipeline:${z}:${tiles.map((t) => `${t.x}/${t.y}`).join("|")}`;
    lastBuildingFetchError = null;
    lastBuildingPipelineStatus = {
      mode: errors.length ? "pipeline-partial" : (features.length ? "pipeline" : "pipeline-empty"),
      sourceCounts, tileCount: tiles.length, expectedTileCount: expectedTiles.length, knownEmptyTileCount,
      successfulTileCount: groups.length, failedTileCount: errors.length,
      featureCount: features.length, paddingM: Math.round(currentBuildingFetchPaddingM(mapRef.getBounds())),
      coverageStatus: coverage.status, coverageAoi: coverage.aoi,
      coverageRegions: Array.isArray(coverage.regions) ? coverage.regions.length : 0,
      coverageRegionBoxes: Array.isArray(coverage.regions) ? coverage.regions.map((region) => ({
        id: region.id, west: region.west, south: region.south, east: region.east, north: region.north
      })) : [],
      matchedCoverageRegions: Array.isArray(coverage.matchedRegions) ? coverage.matchedRegions : [],
      coverageComplete: config.buildingPipelineCoverageGateEnabled === false || coverage.status === "full",
      fetchComplete: !errors.length,
      manifestBuiltAtUtc: manifest && manifest.built_at_utc ? manifest.built_at_utc : null,
      manifestFeatureCount: manifest && Number.isFinite(Number(manifest.feature_count)) ? Number(manifest.feature_count) : null,
      errors: errors.slice(0, 4), error: errors.length ? errors[0].error : null
    };
    if (errors.length) console.warn("[Haidian Shade] some prebuilt building tiles failed", errors);
    updateBuildingRuntimeStatus();
    syncBuildingAttribution();
    syncBuildingDebugOverlay();
    return features;
  }

  function overpassEndpointList() {
    const configured = Array.isArray(config.overpassUrls) ? config.overpassUrls : [];
    const urls = configured.concat(config.overpassUrl || []).map((value) => String(value || "").trim()).filter(Boolean);
    return Array.from(new Set(urls));
  }

  async function fetchOverpassJson(query) {
    const endpoints = overpassEndpointList();
    if (!endpoints.length) throw new Error("No Overpass endpoint configured");
    const perEndpointTimeoutMs = Math.max(3000, Number(config.buildingFetchClientTimeoutMs) || 12000);
    const totalTimeoutMs = Math.max(perEndpointTimeoutMs, Number(config.buildingFetchTotalTimeoutMs) || 26000);
    const deadline = Date.now() + totalTimeoutMs;
    const errors = [];

    for (const endpoint of endpoints) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const timeoutMs = Math.max(1000, Math.min(perEndpointTimeoutMs, remaining));
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => {
        try { controller.abort("overpass-timeout"); } catch (_) { try { controller.abort(); } catch (_) {} }
      }, timeoutMs) : null;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "Accept": "application/json" },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller ? controller.signal : undefined
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (!json || !Array.isArray(json.elements)) throw new Error("invalid JSON payload");
        return { json, endpoint };
      } catch (error) {
        const timedOut = controller && controller.signal && controller.signal.aborted;
        errors.push(`${endpoint}: ${timedOut ? `timeout after ${timeoutMs} ms` : (error && error.message ? error.message : String(error))}`);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
    throw new Error(`Overpass unavailable (${errors.join(" | ") || "total timeout"})`);
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
        updateBuildingRuntimeStatus();
        syncBuildingDebugOverlay();
        return lastBuildingFeatures;
      });
    }

    const query =
      `[out:json][timeout:20];` +
      `way["building"](` +
      `${padded.south},${padded.west},` +
      `${padded.north},${padded.east}` +
      `);out tags geom;`;

    const fetchStartedAt = monotonicNow();
    metaPerf.buildingFetches += 1;
    lastBuildingFetchError = null;

    const promise = fetchOverpassJson(query)
      .then(({ json, endpoint }) => {
        const features = [];

        for (const element of json.elements || []) {
          if (!element.geometry || element.geometry.length < 3) continue;

          const ring = element.geometry.map((point) => [point.lon, point.lat]);
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first.slice());

          const shell = {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [ring] },
            properties: {}
          };
          const metrics = buildingFeatureMetrics(shell);
          const areaM2 = metrics ? metrics.areaM2 : 0;
          const heightInfo = parseHeightInfo(element.tags, areaM2);
          const tags = element.tags || {};
          const height = heightInfo.height;

          features.push({
            type: "Feature",
            geometry: shell.geometry,
            properties: {
              height,
              render_height: height,
              height_source: heightInfo.source,
              height_quality: heightInfo.quality || "heuristic",
              building_source: "OSM-live",
              source_id: `OSM:${element.id}`,
              source_version: "live-overpass",
              osm_id: element.id,
              name: tags["name:zh"] || tags.name || "OSM building",
              subtype: tags.building || "",
              class: tags["building:use"] || tags.amenity || "",
              building: tags.building || "",
              amenity: tags.amenity || "",
              building_levels: tags["building:levels"] || "",
              overpass_endpoint: endpoint,
              building_uid: `osm-live-${element.id}`
            }
          });
        }

        calibrateLowConfidenceBuildingHeights(features, features);
        lastBuildingFeatures = features;
        lastBuildingCoverageKey = key;
        lastBuildingFetchError = null;
        updateBuildingRuntimeStatus();
        syncBuildingDebugOverlay();
        return features;
      })
      .catch((error) => {
        lastBuildingFetchError = error;
        metaPerf.buildingFetchErrors += 1;
        metaPerf.lastBuildingError = error && error.message ? error.message : String(error);
        // Never pin a transient Overpass failure in the promise cache. A later
        // activation/pan must be able to retry the same viewport.
        overpassCache.delete(key);
        console.warn("[Haidian Shade] OSM buildings:", error);
        updateBuildingRuntimeStatus();
        return [];
      })
      .finally(() => {
        const elapsed = Math.max(0, monotonicNow() - fetchStartedAt);
        metaPerf.buildingFetchMs += elapsed;
        metaPerf.lastBuildingFetchMs = Math.round(elapsed);
      });

    overpassCache.set(key, promise);
    if (overpassCache.size > 10) overpassCache.delete(overpassCache.keys().next().value);
    return promise;
  }

  function featureCentroidInsideAoi(feature, aoi) {
    if (!aoi) return false;
    const metrics = buildingFeatureMetrics(feature);
    if (!metrics) return false;
    return metrics.lng >= aoi.west && metrics.lng <= aoi.east && metrics.lat >= aoi.south && metrics.lat <= aoi.north;
  }

  function featureCentroidInsideCoverageRegions(feature, regions, fallbackAoi = null) {
    const list = Array.isArray(regions) ? regions : [];
    if (!list.length) return featureCentroidInsideAoi(feature, fallbackAoi);
    return list.some((region) => featureCentroidInsideAoi(feature, region));
  }

  function mergePipelineWithOsmFallback(pipeline, fallback, coverageRegions, fallbackAoi = null) {
    const preferred = Array.isArray(pipeline) ? pipeline : [];
    const live = Array.isArray(fallback) ? fallback : [];
    if (!preferred.length) return live;
    if (!live.length) return preferred;
    const merged = preferred.slice();
    const seen = new Set(preferred.map((feature) => {
      const props = feature && feature.properties ? feature.properties : {};
      return String(props.building_uid || props.source_id || "");
    }).filter(Boolean));
    for (const feature of live) {
      // The published pipeline owns geometry only inside its actual coverage
      // regions. This matters for Taiwan's disjoint main-island/offshore-island
      // publication: the overall envelope must not suppress live OSM in gaps.
      if (featureCentroidInsideCoverageRegions(feature, coverageRegions, fallbackAoi)) continue;
      const props = feature && feature.properties ? feature.properties : {};
      const uid = String(props.building_uid || props.source_id || "");
      if (uid && seen.has(uid)) continue;
      if (uid) seen.add(uid);
      merged.push(feature);
    }
    return merged;
  }

  async function getBuildings() {
    if (state.mode === "trees") return [];

    if (effectiveBuildingMode() === "none") return [];

    if (effectiveBuildingMode() === "custom") {
      try {
        return await loadCustomBuildings();
      } catch (error) {
        console.warn("[Haidian Shade] custom buildings:", error);
        return [];
      }
    }

    if (effectiveBuildingMode() === "pipeline") {
      const pipeline = await loadPipelineBuildings();
      const status = lastBuildingPipelineStatus || {};
      const pipelineComplete = !!(status.coverageComplete && status.fetchComplete);
      if (pipelineComplete || config.buildingPipelineFallbackToOsm === false) return pipeline;

      const fallback = await loadOSMBuildings();
      const fallbackOk = Array.isArray(fallback) && fallback.length > 0 && !lastBuildingFetchError;

      // v8.6.3: when the viewport crosses the pilot AOI boundary, keep the
      // prebuilt buildings that are valid inside the AOI and use live OSM only
      // for the uncovered area. If live OSM fails, retain the pipeline subset
      // instead of making all buildings disappear.
      if (status.coverageStatus === "partial" && Array.isArray(pipeline) && pipeline.length) {
        const merged = mergePipelineWithOsmFallback(
          pipeline, fallback, status.coverageRegionBoxes || [], status.coverageAoi || null
        );
        lastBuildingFeatures = merged;
        lastBuildingCoverageKey = `hybrid:${lastBuildingCoverageKey || "partial"}`;
        const counts = {};
        for (const feature of merged) {
          const source = feature && feature.properties && feature.properties.building_source || "unknown";
          counts[source] = (counts[source] || 0) + 1;
        }
        lastBuildingPipelineStatus = Object.assign({}, status, {
          mode: "pipeline-hybrid",
          sourceCounts: counts,
          fallback: "OSM",
          fallbackFeatureCount: Array.isArray(fallback) ? fallback.length : 0,
          hybridFeatureCount: merged.length,
          effectiveCoverageComplete: fallbackOk,
          fallbackError: lastBuildingFetchError && (lastBuildingFetchError.message || String(lastBuildingFetchError)) || null
        });
        updateBuildingRuntimeStatus();
        syncBuildingAttribution();
        syncBuildingDebugOverlay();
        return merged;
      }

      lastBuildingPipelineStatus = Object.assign({}, status, {
        fallback: "OSM",
        fallbackFeatureCount: Array.isArray(fallback) ? fallback.length : 0,
        fallbackError: lastBuildingFetchError && (lastBuildingFetchError.message || String(lastBuildingFetchError)) || null
      });
      updateBuildingRuntimeStatus();
      syncBuildingAttribution();
      return fallback;
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

  async function selectTerrainSource(snapshot, serial, options = {}) {
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
      if (prebuiltRegionForSnapshot(view) && await prebuiltSurfaceAvailable(view)) {
        return {
          source: metaTerrainSource(),
          meta: true,
          prebuilt: true,
          snapshot: view,
          warning: "目前視野已命中預建 CHMv2 surface tiles；全球其他地區仍保留 live COG fallback。"
        };
      }
      const firstActivationOnly = config.metaProgressiveFirstActivationOnly !== false;
      const allowProgressive = options.progressive !== false &&
        config.metaProgressiveEnabled !== false &&
        (!firstActivationOnly || !metaProgressiveUsed);
      const prepared = await prepareLiveMetaSurface(view, serial, { progressive: allowProgressive });
      const hasCanopy = prepared.canopyTiles > 0;
      const canopySummary = `${prepared.canopyTiles}/${prepared.total} canopy tiles`;
      const terrainSummary = prepared.officialTerrainTiles
        ? `官方 DTM ${prepared.officialTerrainTiles}/${prepared.total} tiles` +
          (prepared.globalTerrainTiles ? `，全球 fallback ${prepared.globalTerrainTiles}/${prepared.total}` : "")
        : `全球 DEM ${prepared.globalTerrainTiles || prepared.total}/${prepared.total} tiles`;
      return {
        source: liveMetaTerrainSource({
          flatFallback: !!prepared.progressive && prepared.fallbackMode !== "ground-blob"
        }),
        meta: hasCanopy,
        progressive: !!prepared.progressive,
        progressiveInitial: prepared.initialTotal || 0,
        progressiveBackground: prepared.backgroundTotal || 0,
        progressiveStart: prepared.startBackground || null,
        snapshot: view,
        warning: prepared.progressive
          ? `漸進式首幀：中心 ${prepared.initialTotal}/${prepared.total} 張使用完整 CHMv2 surface；周邊先用快速暫存地形，首幀後背景補齊其餘 ${prepared.backgroundTotal} 張，再自動升級為完整陰影。`
          : (hasCanopy
            ? (config.metaBlendBareTerrain
                ? `全球 CHMv2 已載入目前視野（z${prepared.zooms.join("/")}，${canopySummary}），地面來源：${terrainSummary}；移動到其他地區會自動載入當地資料。`
                : `全球 CHMv2 已載入目前視野（z${prepared.zooms.join("/")}，${canopySummary}）；目前未疊加地面 DEM。`)
            : `目前視野沒有可讀取的 CHMv2 樹冠像素；陰影以 ${terrainSummary}／建築計算。移到其他地區或放大後會重新嘗試載入。`)
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
    return config.lockMapMaxZoomToMeta === true && state.mode !== "buildings";
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

  function getPreviewBuildingsCachedOnly() {
    if (state.mode === "trees" || effectiveBuildingMode() === "none") return [];
    if (config.metaProgressiveDeferBuildings === false) return getBuildings();

    if (effectiveBuildingMode() === "custom") {
      const cached = Array.isArray(customBuildingsCache) ? customBuildingsCache : [];
      if (!cached.length) metaPerf.progressivePreviewBuildingsDeferred += 1;
      return cached;
    }

    if (effectiveBuildingMode() === "pipeline") {
      if (Array.isArray(lastBuildingFeatures) && lastBuildingFeatures.length) return lastBuildingFeatures;
      metaPerf.progressivePreviewBuildingsDeferred += 1;
      return [];
    }

    if (effectiveBuildingMode() === "osm" && mapRef) {
      try {
        const padded = paddedBuildingBounds(mapRef.getBounds());
        const key = [padded.south, padded.west, padded.north, padded.east]
          .map((v) => Number(v).toFixed(3)).join(",");
        if (lastBuildingCoverageKey === key && Array.isArray(lastBuildingFeatures)) {
          return lastBuildingFeatures;
        }
      } catch (_) {}
      metaPerf.progressivePreviewBuildingsDeferred += 1;
      return [];
    }

    return [];
  }

  function clearPendingBuildingUpgrade() {
    pendingBuildingUpgrade = null;
  }

  function cancelBuildingWarmPrefetch() {
    buildingWarmPrefetchSerial += 1;
    clearTimeout(buildingWarmPrefetchTimer);
    buildingWarmPrefetchTimer = null;
  }

  function scheduleBuildingWarmPrefetch() {
    if (
      config.buildingWarmPrefetchEnabled === false ||
      state.enabled ||
      state.mode === "trees" ||
      effectiveBuildingMode() === "none" ||
      !mapRef
    ) return;
    cancelBuildingWarmPrefetch();
    const localSerial = buildingWarmPrefetchSerial;
    buildingWarmPrefetchTimer = setTimeout(() => {
      buildingWarmPrefetchTimer = null;
      if (localSerial !== buildingWarmPrefetchSerial || state.enabled) return;
      metaPerf.buildingPrefetchRuns += 1;
      Promise.resolve(getBuildings())
        .then((features) => {
          if (localSerial !== buildingWarmPrefetchSerial || state.enabled) return;
          if (!lastBuildingFetchError) metaPerf.buildingPrefetchLoaded += Array.isArray(features) ? features.length : 0;
        })
        .catch(() => {});
    }, Math.max(0, Number(config.buildingWarmPrefetchDelayMs) || 0));
  }

  function finishSurfaceOnlyActivation(message, isError) {
    if (metaActivationInProgress && metaActivationStartedAt && !metaPerf.lastSurfaceCompleteMs) {
      metaPerf.lastSurfaceCompleteMs = Math.round(Math.max(0, monotonicNow() - metaActivationStartedAt));
    }
    metaActivationInProgress = false;
    setStatus(message, !!isError);
  }

  function startBuildingUpgradeAfterSurface(serial) {
    if (config.buildingProgressiveDecoupleEnabled === false || state.mode === "trees" || effectiveBuildingMode() === "none") {
      if (metaActivationInProgress && metaActivationStartedAt) {
        const elapsed = Math.round(Math.max(0, monotonicNow() - metaActivationStartedAt));
        if (!metaPerf.lastSurfaceCompleteMs) metaPerf.lastSurfaceCompleteMs = elapsed;
        metaPerf.lastCompleteMs = elapsed;
        metaActivationInProgress = false;
      }
      setStatus(`陰影計算完成：${modeLabel(state.mode)}。`);
      return false;
    }

    const signature = snapshotCoverageSignature(captureViewSnapshot());
    const pending = { serial, signature };
    pendingBuildingUpgrade = pending;
    metaPerf.buildingUpgradeRuns += 1;
    setStatus("地形＋樹冠陰影已完成；建築資料正在背景載入…");

    Promise.resolve(getBuildings())
      .then((features) => {
        if (pendingBuildingUpgrade !== pending || !state.enabled || serial !== shadeRebuildSerial) return;
        if (signature !== snapshotCoverageSignature(captureViewSnapshot())) return;
        pendingBuildingUpgrade = null;
        if (lastBuildingFetchError) {
          metaPerf.buildingUpgradeSkipped += 1;
          finishSurfaceOnlyActivation("地形＋樹冠陰影已完成；建築資料暫時無法取得，稍後移動地圖或重新啟用會再嘗試。", true);
          return;
        }
        if (!Array.isArray(features) || !features.length) {
          metaPerf.buildingUpgradeSkipped += 1;
          if (metaActivationInProgress && metaActivationStartedAt) {
            const elapsed = Math.round(Math.max(0, monotonicNow() - metaActivationStartedAt));
            metaPerf.lastBuildingCompleteMs = elapsed;
            metaPerf.lastCompleteMs = elapsed;
            metaActivationInProgress = false;
          }
          setStatus(`陰影計算完成：${modeLabel(state.mode)}（目前視野無可用建築資料）。`);
          return;
        }
        setStatus("建築資料已載入；正在加入建築陰影…");
        setTimeout(() => {
          if (!state.enabled || serial !== shadeRebuildSerial) return;
          rebuildShade({ phase: "full", buildingPolicy: "normal" });
        }, Math.max(0, Number(config.buildingUpgradeDelayMs) || 0));
      })
      .catch((error) => {
        if (pendingBuildingUpgrade !== pending) return;
        pendingBuildingUpgrade = null;
        metaPerf.buildingUpgradeSkipped += 1;
        metaPerf.lastBuildingError = error && error.message ? error.message : String(error);
        finishSurfaceOnlyActivation("地形＋樹冠陰影已完成；建築資料背景載入失敗。", true);
      });
    return true;
  }

  async function mountPreparedShadeLayer(terrain, serial, options = {}) {
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
      getFeatures: options.buildingPolicy === "cached-only" || (terrain && terrain.progressive)
        ? getPreviewBuildingsCachedOnly
        : getBuildings,
      debug: (message) =>
        console.debug("[Haidian ShadeMap]", message)
    });

    beginShadeCanvasOwnership(serial);
    shadeLayer = layer;
    shadeLayerSerial = serial;
    shadeLayerPhase = options.phase || (terrain && terrain.progressive ? "preview" : "full");
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
    cancelMetaWarmStart();
    cancelBuildingWarmPrefetch();
    clearPendingBuildingUpgrade();
    metaActivationStartedAt = monotonicNow();
    metaActivationInProgress = true;
    metaPerf.lastPreviewMs = 0;
    metaPerf.lastSurfaceCompleteMs = 0;
    metaPerf.lastBuildingCompleteMs = 0;
    metaPerf.lastCompleteMs = 0;
    metaPerf.lastBuildingFetchMs = 0;
    metaPerf.lastBuildingError = null;
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
      const terrain = await selectTerrainSource(snapshot, serial, { progressive: true });

      // Critical v7.5 rule: a stale async terrain preparation may warm caches,
      // but it is NEVER allowed to create/add a ShadeMap layer.
      if (serial !== shadeRebuildSerial || !state.enabled) return;

      const layer = await mountPreparedShadeLayer(terrain, serial, {
        phase: terrain && terrain.progressive ? "preview" : "full",
        buildingPolicy: terrain && terrain.progressive ? "cached-only" : "normal"
      });
      if (!layer || serial !== shadeRebuildSerial || !state.enabled) return;

      lastLiveViewSignature = snapshotCoverageSignature(snapshot);
      armProgressiveUpgrade(terrain, serial);
      syncCanopyOverlay();
      syncGroundCanopyShadeOverlay();
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
    clearPendingProgressiveUpgrade();
    shadeNavigationSuspended = true;
    setNavigationCanvasState(true);
    // v7.8.6: do NOT destroy the WebGL layer at every movestart. Keep the old
    // renderer hidden while terrain/data preparation runs, then replace it once
    // after navigation settles. It is never directly revealed for a changed
    // viewport, even when CHMv2 coverage tiles are unchanged.
    if (config.preserveShadeLayerDuringNavigation === false) detachShadeLayerOnly();
    if (activePointQuery && activePointQuery.serial === pointQuerySerial && queryPopup) {
      activePointQuery.model.navigationUpdating = true;
      refreshPointQueryTooltip(activePointQuery.serial, activePointQuery.model);
    }
    setStatus("地圖移動中：暫時隱藏陰影；停下後更新目前視野…");
  }

  function disableShade(updateStatus = true) {
    clearPendingProgressiveUpgrade();
    clearPendingBuildingUpgrade();
    cancelBuildingWarmPrefetch();
    progressiveCanopyOverlayDeferred = false;
    metaActivationInProgress = false;
    metaActivationStartedAt = 0;
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
    removeGroundCanopyShadeOverlay();

    removePointQueryOverlay();
    syncPointQueryCursor();
    restoreShadeZoomConstraint();
    setNavigationCanvasState(false);

    if (updateStatus) {
      setStatus("陰影模擬已關閉。");
    }
  }

  async function rebuildShade(options = {}) {
    if (!mapRef || !state.enabled) return;

    clearPendingProgressiveUpgrade();
    clearPendingBuildingUpgrade();
    const serial = ++shadeRebuildSerial;
    shadeNavigationSuspended = false;
    setNavigationCanvasState(true);

    const snapshot = captureViewSnapshot();
    if (!snapshot) return;

    try {
      setStatus("正在準備目前視野的 Meta CHMv2／地形資料…");
      applyShadeZoomConstraint();

      // Prepare only data first. No SDK layer is mounted until we know this
      // rebuild is still the newest requested viewport. Upgrade phases already
      // have all CHMv2 surfaces cached and must not re-enter progressive mode.
      const upgradePhase = options.phase === "surface" || options.phase === "full";
      const terrain = await selectTerrainSource(snapshot, serial, { progressive: !upgradePhase });
      if (serial !== shadeRebuildSerial || !state.enabled) return;

      // Swap instances only after replacement terrain is ready. This minimizes
      // time without shade and drastically reduces WebGL context churn.
      detachShadeLayerOnly({ scheduleScrub: false });
      await delay(Math.max(40, Number(config.layerSwapDelayMs) || 80));
      if (serial !== shadeRebuildSerial || !state.enabled) return;
      // The old SDK instance has now been removed and yielded a safe turn. Physically
      // remove its retired DOM before the replacement renderer can be mistaken for it.
      cleanupRetiredShadeCanvases();

      const layer = await mountPreparedShadeLayer(terrain, serial, {
        phase: options.phase || (terrain && terrain.progressive ? "preview" : "full"),
        buildingPolicy: options.buildingPolicy || (terrain && terrain.progressive ? "cached-only" : "normal")
      });
      if (!layer || serial !== shadeRebuildSerial || !state.enabled) return;

      syncPointQueryCursor();
      lastLiveViewSignature = snapshotCoverageSignature(snapshot);
      armProgressiveUpgrade(terrain, serial);
      syncCanopyOverlay();
      syncGroundCanopyShadeOverlay();
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
    installMetaPreconnectHints();

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      mapRef = mapRef || resolveMap();
      installDesktopHeaderMinimizer();

      const panelReady = injectPanel();

      if (mapRef && panelReady) {
        hookMapMoveRebuild();
        hookMapPointQuery();
        scheduleMetaWarmStart();
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
    analyzeCanopyDayAt(lat, lng, date) {
      const latlng = { lat: Number(lat), lng: Number(lng) };
      const when = date ? new Date(date) : state.date;
      return segmentLocalCanopyPatch(latlng).then(async (patch) => {
        if (!patch) return { available: false, reason: "此點未形成可分析的 CHMv2 樹冠片" };
        let buildings = [];
        try { buildings = await getQueryableBuildings(); } catch (_) {}
        return { available: true, patch, daily: estimateCanopyDailyBenefit(patch, latlng, when, buildings) };
      });
    },
    getCanvasDiagnostics: getShadeCanvasDiagnostics,
    getMetaDiagnostics,
    resetMetaDiagnostics,
    redrawGroundCanopyShade: redrawGroundCanopyShadeOverlay,
    setBuildingDebugOverlay(enabled) {
      state.buildingDebugOverlay = !!enabled;
      const el = document.getElementById("haidianShadeBuildingDebug");
      if (el) el.checked = state.buildingDebugOverlay;
      syncBuildingDebugOverlay();
      return state.buildingDebugOverlay;
    },
    getBuildingDiagnostics() {
      const counts = {};
      const heightQualityCounts = {};
      const overpassEndpoints = {};
      for (const feature of (Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures : [])) {
        const props = feature && feature.properties ? feature.properties : {};
        const source = props.building_source || "OSM/legacy";
        counts[source] = (counts[source] || 0) + 1;
        const quality = props.height_quality || "unknown";
        heightQualityCounts[quality] = (heightQualityCounts[quality] || 0) + 1;
        if (props.overpass_endpoint) overpassEndpoints[props.overpass_endpoint] = (overpassEndpoints[props.overpass_endpoint] || 0) + 1;
      }
      return {
        mode: effectiveBuildingMode(),
        configuredMode: config.buildingMode,
        pilotRequested: buildingPilotRequested(),
        pilotQueryParam: String(config.buildingPilotQueryParam || ""),
        tileUrlConfigured: !!config.buildingTileUrl,
        manifestUrlConfigured: !!config.buildingManifestUrl,
        tileIndexUrlConfigured: !!config.buildingTileIndexUrl,
        dataVersion: String(config.buildingDataVersion || ""),
        workerDataVersion: buildingManifestCache && buildingManifestCache.__workerDataVersion || "",
        tileZoom: Number(config.buildingTileZoom) || 16,
        coverageGateEnabled: config.buildingPipelineCoverageGateEnabled !== false,
        requireCompleteTiles: config.buildingPipelineRequireCompleteTiles !== false,
        requireTileIndex: config.buildingPipelineRequireTileIndex !== false,
        manifestLoaded: !!buildingManifestCache,
        tileIndexLoaded: !!buildingTileIndexCache,
        tileIndexCount: buildingTileIndexCache ? Number(buildingTileIndexCache.tile_count || (buildingTileIndexCache.tile_keys || []).length || 0) : 0,
        tileIndexEncoding: buildingTileIndexCache && buildingTileIndexCache.indexEncoding || "",
        manifestAoi: buildingManifestAoi(buildingManifestCache),
        coverageRegionCount: buildingManifestCoverageRegions(buildingManifestCache).length,
        manifestPreset: buildingManifestCache && buildingManifestCache.latest_run && buildingManifestCache.latest_run.preset || "",
        manifestFeatureCount: buildingManifestCache && Number(buildingManifestCache.feature_count) || 0,
        effectiveFetchPaddingM: mapRef ? Math.round(currentBuildingFetchPaddingM(mapRef.getBounds())) : null,
        cachedTiles: buildingTileCache.size,
        featureCount: Array.isArray(lastBuildingFeatures) ? lastBuildingFeatures.length : 0,
        sourceCounts: counts,
        heightQualityCounts,
        overpassEndpoints,
        coverageKey: lastBuildingCoverageKey,
        lastPipelineStatus: Object.assign({}, lastBuildingPipelineStatus),
        lastOverpassError: lastBuildingFetchError && (lastBuildingFetchError.message || String(lastBuildingFetchError))
      };
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
