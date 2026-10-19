/* Isolated Estimated Shade data adapter. Never changes ASTRA proof/model policy. */
const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2,'0')).join('');
const clone = v => structuredClone(v);
const tileXY = (lon,lat,z) => [Math.min(2**z-1,Math.max(0,Math.floor((lon+180)/360*2**z))),Math.min(2**z-1,Math.max(0,Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z)))];
export function estimatedOnly(f) {
 const p=f.properties||{}, h=p.height_m;
 return {...clone(f),astra:{heightM:typeof h==='number'&&Number.isFinite(h)&&h>0?h:null,heightQuality:p.height_quality,source:'GBA ML_ESTIMATED',verifiedProofEligible:false,classification:'unknown',groundDatum:'UNAVAILABLE',buildingPartsComplete:false,routeCacheSafe:false}};
}
export class PreparedProvider {
 constructor(manifest,baseURL,{fetcher=fetch,concurrency=4,maxCacheBytes=32*1024*1024,timeoutMs=15000}={}) {
  if(manifest.schema!=='astra-gba-prepared-v1'||manifest.heightClassification!=='ML_ESTIMATED'||manifest.verifiedProofEligible!==false||manifest.realWorldCoverageComplete!==false)throw Error('UNSUPPORTED_EVIDENCE_MANIFEST');
  this.m=clone(manifest);this.base=baseURL;this.fetcher=fetcher;this.max=concurrency;this.cacheMax=maxCacheBytes;this.timeoutMs=timeoutMs;this.active=0;this.queue=[];this.pending=new Map();this.cache=new Map();this.cacheBytes=0;this.stats={networkRequests:0,coalesced:0,cacheHits:0,abortedRequests:0,failures:0};
 }
 schedule(entry) {
  this.queue.push(entry);this.pump();
 }
 pump() {
  while(this.active<this.max&&this.queue.length){
   const e=this.queue.shift();if(e.controller.signal.aborted){e.reject(Error('CANCELLED'));continue;}
   this.active++;this.stats.networkRequests++;
   const timer=setTimeout(()=>e.controller.abort(),this.timeoutMs);
   this.read(e.rec,e.controller.signal).then(e.resolve,e.reject).finally(()=>{clearTimeout(timer);this.active--;this.pump();});
  }
 }
 async read(rec,signal){
  if(!rec.path||rec.path.includes('..')||rec.path.startsWith('/')||rec.path.includes('\\')||rec.rawBytes>32*1024*1024||rec.bytes>4*1024*1024)throw Error('INVALID_PAGE_RECORD');
  const response=await this.fetcher(new URL(rec.path,this.base),{signal});if(!response.ok)throw Error('HTTP_'+response.status);
  const compressed=new Uint8Array(await response.arrayBuffer());if(compressed.byteLength!==rec.bytes||hex(await crypto.subtle.digest('SHA-256',compressed))!==rec.sha256)throw Error('ASSET_SHA_MISMATCH');
  const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>rec.rawBytes||size>32*1024*1024){await reader.cancel();throw Error('DECOMPRESSED_BYTES_LIMIT');}chunks.push(value);}
  if(size!==rec.rawBytes)throw Error('RAW_SIZE_MISMATCH');const raw=new Uint8Array(size);let pos=0;for(const a of chunks){raw.set(a,pos);pos+=a.length;}
  const fc=JSON.parse(new TextDecoder().decode(raw));if(fc.type!=='FeatureCollection'||!Array.isArray(fc.features)||fc.features.length!==rec.featureCount)throw Error('PAGE_SCHEMA_MISMATCH');
  for(const f of fc.features)if(f.type!=='Feature'||f.properties?.verifiedProofEligible!==false||!f.properties?.prepared_id||!['Polygon','MultiPolygon'].includes(f.geometry?.type))throw Error('FEATURE_EVIDENCE_SCHEMA_MISMATCH');
  return {features:fc.features,bytes:size};
 }
 page(rec,signal){
  const key=this.m.release+':'+rec.path+':'+rec.sha256;
  if(signal?.aborted)return Promise.reject(Error('CANCELLED'));
  const hit=this.cache.get(key);
  if(hit){this.stats.cacheHits++;this.cache.delete(key);this.cache.set(key,hit);return Promise.resolve(clone(hit.features));}
  let e=this.pending.get(key);
  if(e)this.stats.coalesced++;
  else{
   let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});e={rec,promise,resolve,reject,controller:new AbortController(),refs:0};this.pending.set(key,e);
   promise.then(value=>{
    if(value.bytes<=this.cacheMax){while(this.cacheBytes+value.bytes>this.cacheMax&&this.cache.size){const [k,v]=this.cache.entries().next().value;this.cache.delete(k);this.cacheBytes-=v.bytes;}this.cache.set(key,value);this.cacheBytes+=value.bytes;}
   },()=>{this.stats.failures++;}).finally(()=>this.pending.delete(key));this.schedule(e);
  }
  e.refs++;
  return new Promise((resolve,reject)=>{
   let done=false;
   const release=()=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);e.refs--;};
   const abort=()=>{release();if(e.refs===0&&!e.controller.signal.aborted){this.stats.abortedRequests++;e.controller.abort();}reject(Error('CANCELLED'));};
   signal?.addEventListener('abort',abort,{once:true});
   e.promise.then(v=>{if(!done){release();resolve(clone(v.features));}},err=>{if(!done){release();reject(err);}});
  });
 }
 async queryBBox(bbox,{signal}={}){
  if(bbox.length!==4||bbox.some(x=>!Number.isFinite(x))||bbox[0]>bbox[2]||bbox[1]>bbox[3]||bbox[0]<-180||bbox[2]>180||bbox[1]<-85.05112878||bbox[3]>85.05112878)return {status:'unknown/partial',features:[],reasons:['UNSUPPORTED_BBOX_OR_DATELINE_SPLIT_REQUIRED'],verifiedProofEligible:false};
  const z=this.m.servingZoom,[x0,y0]=tileXY(bbox[0],bbox[3],z),[x1,y1]=tileXY(bbox[2],bbox[1],z);if((x1-x0+1)*(y1-y0+1)>64)return {status:'unknown/partial',features:[],reasons:['OPERATIONAL_TILE_QUERY_LIMIT'],verifiedProofEligible:false};
  const reasons=[],pages=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const tile=this.m.tiles[`${z}/${x}/${y}`];if(!tile){reasons.push('TILE_NOT_PREPARED');continue;}pages.push(...tile.pages);}
  const results=await Promise.allSettled(pages.map(r=>this.page(r,signal)));const seen=new Map();
  for(const r of results)if(r.status==='fulfilled'){for(const f of r.value)seen.set(f.properties.prepared_id,estimatedOnly(f));}else reasons.push(String(r.reason?.message||r.reason));
  return {status:reasons.length?'unknown/partial':'estimated-data-ready',features:[...seen.values()],reasons:[...new Set(reasons)],release:this.m.release,verifiedProofEligible:false,realWorldCoverageComplete:false,unknownResolved:0};
 }
 diagnostics(){return {...this.stats,activeRequests:this.active,pendingPages:this.pending.size,cacheRawBytes:this.cacheBytes,cacheRawBytesLimit:this.cacheMax,cacheBytesAreSerializedSizeNotJSHeap:true};}
}
