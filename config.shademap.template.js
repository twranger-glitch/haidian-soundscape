/* Haidian Soundscape — ShadeMap configuration
 * This template is safe to commit. GitHub Actions injects the API key only into the deployed artifact.
 */
window.HAIDIAN_SHADEMAP_CONFIG = {
  // Required by leaflet-shadow-simulator / ShadeMap.
  apiKey: __SHADEMAP_API_KEY_JSON__,

  // Real Meta / WRI CHMv2 canopy height, streamed directly from public COGs.
  // No local 1321232301.tif and no pre-generated meta-dsm folder are required.
  metaMode: "live-cog",
  metaCogBaseUrl: "https://data.source.coop/tge-labs/meta-chm-v2/chm",
  geotiffUrl: "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.min.js",
  metaMinZoom: 14,
  metaMaxZoom: 17,
  metaTileBuffer: 1,
  metaTileConcurrency: 4,
  metaMaxPreparedTiles: 180,
  metaMaxCachedTiles: 480,
  metaBlendBareTerrain: true,

  // Bare-earth terrain. CHMv2 canopy height is added to this before ShadeMap sees it.
  bareTerrainTileUrl: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  bareTerrainMaxZoom: 15,

  // Prototype: fetch visible OSM building footprints at runtime.
  // For production reliability, you can later switch to "custom" and host GeoJSON.
  buildingMode: "osm",
  buildingGeoJSONUrl: "./data/buildings.geojson",
  buildingMinZoom: 15,

  defaultResearchMode: "full",

  // Pin versions so a CDN "latest" update cannot silently break the site.
  sdkUrl: "https://unpkg.com/leaflet-shadow-simulator@0.67.0/dist/leaflet-shadow-simulator.umd.min.js"
};
