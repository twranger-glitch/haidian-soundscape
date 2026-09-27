/* dev37.7: self-hosted decoder and original ASTRA renderers; no SDK key required. */
window.HAIDIAN_SHADEMAP_CONFIG = Object.assign({
  visualShadeProvider: 'own',
  buildingMode: 'pipeline',
  buildingManifestFetchClientTimeoutMs: 15000,
  buildingTileIndexFetchClientTimeoutMs: 15000,
  buildingTileUrl: 'https://haidian-dtm-proxy.yhzkiki.workers.dev/buildings/{z}/{x}/{y}.geojson',
  buildingManifestUrl: 'https://haidian-dtm-proxy.yhzkiki.workers.dev/buildings/manifest.json',
  buildingTileIndexUrl: 'https://haidian-dtm-proxy.yhzkiki.workers.dev/buildings/tile-index.json',
  buildingDataVersion: '2026-08-19.0-overture-tainan-city-v1',
  geotiffUrl: './vendor/geotiff-2.1.3/geotiff.js',
  metaGeoTiffWorkerPoolEnabled: true,
  metaGeoTiffWorkerPoolSize: 2,
  canopyCacheTiles: 128,
  metaMaxCachedCogs: 8,
  canopyOverlayDefault: false
}, window.HAIDIAN_SHADEMAP_CONFIG || {});
