/* dev37.5 public default. Own visualization and route scoring need no ShadeMap key.
 * Keep any licensed-provider key in your own deployment configuration, not this release.
 */
window.HAIDIAN_SHADEMAP_CONFIG = Object.assign({
  visualShadeProvider: 'own',
  ownMaxCells: 1600,
  metaGeoTiffWorkerPoolEnabled: false
}, window.HAIDIAN_SHADEMAP_CONFIG || {});
