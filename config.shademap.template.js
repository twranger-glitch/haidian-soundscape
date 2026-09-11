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
  // v7.5: point shade status auto-refreshes after the SDK emits idle.
  queryShadeRetryMs: 250,
  queryShadeRetryTimeoutMs: 10000,

  // v7.5 lifecycle safety. Pan/zoom tears down the old SDK canvas first,
  // waits for navigation to settle, then mounts only the newest viewport.
  navigationRebuildDelayMs: 520,
  hardCanvasCleanup: true,

  // Desktop banner UX: manual collapse to a compact pill; remember only for the current browser tab/session.
  headerMinimizeEnabled: true,
  headerMinimizeRemember: "session",

  // Bare-earth terrain. CHMv2 canopy height is added to this before ShadeMap sees it.
  bareTerrainTileUrl: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  bareTerrainMaxZoom: 15,
  bareTerrainLabel: "Mapzen / Tilezen global terrain DEM",
  // This is a real published DEM source, not a guessed height. For Taiwan-specific
  // authoritative analysis, a later build can replace it with the Ministry of Interior DTM tiles.

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
  // Keep tree/full analysis at or below the native CHMv2 Web-Mercator level.
  // The host map max zoom is restored when ShadeMap is turned off (or buildings-only mode is used).
  lockMapMaxZoomToMeta: true,
  canopyOverlayDefault: true,
  canopyOverlayMinHeight: 2,
  canopyOverlayOpacity: 0.28,

  // Pin versions so a CDN "latest" update cannot silently break the site.
  sdkUrl: "https://unpkg.com/leaflet-shadow-simulator@0.67.0/dist/leaflet-shadow-simulator.umd.min.js"
};
