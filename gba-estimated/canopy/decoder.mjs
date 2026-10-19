// Browser worker only. UMD bundle is local and SHA-locked by the application server.
let ready;
export function loadDecoder(){return ready??=(async()=>{await import('../vendor/geotiff-2.1.3/geotiff.js');const d=globalThis.GeoTIFF;if(typeof d?.fromCustomClient!=='function')throw Error('CHMV2_GEOTIFF_INITIALIZATION_FAILED');return d;})();}
