/* Haidian Soundscape — ShadeMap configuration
 * This template is safe to commit. GitHub Actions injects the API key only into the deployed artifact.
 */
window.HAIDIAN_SHADEMAP_CONFIG = {
  // Required by leaflet-shadow-simulator / ShadeMap.
  apiKey: __SHADEMAP_API_KEY_JSON__,

  // Real Meta / WRI CHMv2 canopy height, streamed dynamically from public COGs.
  // World-scale/global: moving the map to another city selects that location's COG automatically.
  // No local 1321232301.tif and no pre-generated meta-dsm folder are required.
  metaMode: "live-cog",
  metaCogBaseUrl: "https://data.source.coop/tge-labs/meta-chm-v2/chm",
  geotiffUrl: "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.min.js",
  metaMinZoom: 14,
  metaMaxZoom: 17,
  // v7: smaller live-COG prefetch window for faster first render.
  metaTileBuffer: 0,
  metaTileConcurrency: 6,
  metaMaxPreparedTiles: 180,
  metaMaxCachedTiles: 480,

  // v8.2.0 — CHMv2 warm-start performance foundation.
  // After the host map is ready, a small center-first subset of the current
  // viewport is prepared while the browser is idle. The same bounded live-COG
  // caches are reused when ShadeMap is enabled; obsolete queued viewport work
  // is cancelled cooperatively after pan/zoom invalidates its generation.
  metaWarmStartEnabled: true,
  metaWarmStartDelayMs: 1800,
  metaWarmStartMaxTiles: 6,
  metaWarmStartConcurrency: 3,
  metaMaxCachedCogs: 16,

  metaBlendBareTerrain: true,
  metaNoDataFallback: "bare-dem",

  // v7 future-ready: when pre-generated Terrarium surface XYZ tiles are hosted
  // on Hugging Face + Cloudflare, switch metaMode to "xyz" and set this URL.
  // Example: "https://your-worker.workers.dev/meta-dsm/{z}/{x}/{y}.png"
  metaTileUrl: "./meta-dsm/{z}/{x}/{y}.png",

  // Point-query can keep reading the public CHMv2 COG even after terrain moves
  // to fast XYZ tiles, so clicked canopy-height values remain available.
  queryCanopyFromCog: true,
  queryZoom: 17,
  canopyCacheTiles: 256,
  // Point-query rows update independently. Slow CHMv2/DEM sources no longer block the whole tooltip.
  queryCanopyTimeoutMs: 12000,
  queryDemTimeoutMs: 6000,
  // v8.0.1: wait past the Worker's 8 s MOI upstream budget, then preserve
  // enough total time to fall back to the global Terrarium DEM if needed.
  queryGroundTotalTimeoutMs: 14500,
  queryGlobalDemFallbackTimeoutMs: 4500,
  // v7.5: point shade status auto-refreshes after the SDK emits idle.
  queryShadeRetryMs: 250,
  queryShadeRetryTimeoutMs: 10000,

  // v7.9.2: reverse solar-ray occluder tracing with spatial consensus.
  // The exact center ray is still authoritative, but a small parallel-ray fan
  // absorbs OSM alignment / screen-position error. Off-center-only matches are
  // downgraded instead of presented as certain. CHMv2 remains center-ray based.
  queryShadeSourceEnabled: true,
  queryShadeSourceTimeoutMs: 3600,
  queryShadeSourceMaxDistanceM: 240,
  queryShadeSourceSampleStepM: 1.25,
  queryShadeSourceCanopyMaxHeightM: 55,
  queryShadeSourceRayClearanceM: 0.5,
  queryShadeSourceRayWidthM: 9,
  queryShadeSourceRayStepM: 1.5,
  queryShadeSourceCorridorMinHits: 2,
  // v8.0.2: a lone off-center hit inside the original v7.9.1 narrow corridor
  // is retained as low-confidence building evidence. Farther lone hits still
  // require spatial consensus and remain rejected.
  queryShadeSourceLegacyInnerToleranceM: 1.5,
  queryShadeSourceRayBaseToleranceM: 3.5,
  queryShadeSourceRayAngularToleranceDeg: 3,
  queryShadeSourceUnknownBuildingMaxHeightM: 24,
  buildingShadowFetchPaddingM: 280,
  queryShadeSourceMixedDistanceToleranceM: 3,
  queryShadeSourceMinAltitudeDeg: 1.5,

  // v8.0.0 experimental canopy-contribution prototype. Click a CHMv2 canopy
  // pixel while point query is enabled to estimate a local canopy patch, its
  // current projected shadow, and the ground/building receiver split. This is
  // deliberately labelled experimental: CHMv2 is raster canopy height, not
  // single-tree segmentation or LiDAR crown geometry.
  queryCanopyBenefitEnabled: true,
  queryCanopyBenefitTimeoutMs: 5500,
  queryCanopyBenefitMinHeightM: 2,
  queryCanopyBenefitMaxRadiusM: 14,
  queryCanopyBenefitMaxPixels: 420,
  queryCanopyBenefitShadowCellM: 1.25,
  queryCanopyBenefitMaxShadowLengthM: 90,
  queryCanopyBenefitMinSolarAltitudeDeg: 3,
  queryCanopyBenefitOverlay: true,

  // v8.1.0 — daily time-integrated canopy shade value.
  // Integrates the same local CHMv2 canopy patch across the daytime window
  // and reports m²·h (shadow area × time), with ground/building receiver split
  // when building coverage is known.
  queryCanopyDailyEnabled: true,
  queryCanopyDailyStartHour: 8,
  queryCanopyDailyEndHour: 18,
  queryCanopyDailyStepMinutes: 30,

  // v7.8.6 lifecycle: SDK remove() + generation gating + one active canvas owner.
  // No WEBGL_lose_context and no synchronous deletion of the current SDK-owned canvas.
  navigationRebuildDelayMs: 520,
  dateUpdateDebounceMs: 180,
  hardCanvasCleanup: false,
  retiredCanvasCleanupDelayMs: 1200,
  layerSwapDelayMs: 80,
  preserveShadeLayerDuringNavigation: true,

  // Desktop banner UX: manual collapse to a compact pill; remember only for the current browser tab/session.
  headerMinimizeEnabled: true,
  headerMinimizeRemember: "session",

  // Bare-earth terrain used by the shadow engine today. CHMv2 canopy height is added to this before ShadeMap sees it.
  // In Taiwan this remains a GLOBAL FALLBACK until official DTM Terrarium tiles are generated.
  bareTerrainTileUrl: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  bareTerrainMaxZoom: 15,
  bareTerrainLabel: "Mapzen / Tilezen global terrain DEM (shadow fallback)",

  // v8.0.1 — authoritative Taiwan point elevation (MOI-first with aligned timeout budget).
  // DO NOT put the MOI DTM api_key in this file. Configure the included Cloudflare
  // Worker and set only its public proxy URL here. v7.8.8 prefers the official value
  // but can fall back to the global Terrarium DEM, clearly labelled as non-official.
  taiwanOfficialDtmProxyUrl: "https://haidian-dtm-proxy.yhzkiki.workers.dev/elevation",
  taiwanOfficialDtmLabel: "內政部 DTM API 20 m（2010–2019 合併資料）",
  taiwanOfficialDtmTimeoutMs: 9000,
  taiwanGlobalDemFallbackEnabled: true,
  taiwanHideGlobalDemPointValue: true,

  // v8.0.3 — official 2025 Taiwan 20 m DTM, converted to Terrarium XYZ z13.
  // Cloudflare proxies/caches the public Hugging Face tiles; Mapzen remains the explicit fallback.
  taiwanTerrainTileUrl: "https://haidian-dtm-proxy.yhzkiki.workers.dev/terrain/{z}/{x}/{y}.png",
  taiwanTerrainMaxZoom: 13,
  taiwanTerrainLabel: "內政部官方 DTM Terrarium XYZ",
  taiwanTerrainDatasetLabel: "2025 年版官方 20 m DTM（自建 tiles）",

  // Prototype: fetch visible OSM building footprints at runtime.
  // For production reliability, you can later switch to "custom" and host GeoJSON.
  buildingMode: "osm",
  buildingGeoJSONUrl: "./data/buildings.geojson",
  buildingMinZoom: 15,

  defaultResearchMode: "full",

  // v7 presentation/query defaults.
  defaultOpacity: 0.36,
  defaultColor: "#172554",
  queryOnClick: false,
  pointCardCompact: true,
  pointCardTechnicalDetailsDefaultOpen: false,
  // Keep tree/full analysis at or below the native CHMv2 Web-Mercator level.
  // The host map max zoom is restored when ShadeMap is turned off (or buildings-only mode is used).
  lockMapMaxZoomToMeta: true,
  canopyOverlayDefault: true,
  canopyOverlayMinHeight: 2,
  canopyOverlayOpacity: 0.28,

  // Pin versions so a CDN "latest" update cannot silently break the site.
  sdkUrl: "https://unpkg.com/leaflet-shadow-simulator@0.67.0/dist/leaflet-shadow-simulator.umd.min.js"
};
