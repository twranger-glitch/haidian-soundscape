/* Isolated multi-region adapter. Not a Production graph or proof provider. */
import {PreparedProvider} from '../client/prepared-provider.mjs';
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const clone=x=>structuredClone(x),intersect=(a,b)=>[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];
const valid=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3]&&b[0]>=-180&&b[2]<=180&&b[1]>=-85&&b[3]<=85;
const positive=b=>b[0]<b[2]&&b[1]<b[3];
const cancelled=()=>Object.assign(Error('CANCELLED'),{name:'AbortError'});
export function coverage(bbox,regions){
 if(!valid(bbox))return {covered:false,missing:[{bbox,reason:'INVALID_BBOX'}]};
 const xs=[bbox[0],bbox[2]],ys=[bbox[1],bbox[3]];
 for(const r of regions){const b=intersect(bbox,r.bounds);if(positive(b)){xs.push(b[0],b[2]);ys.push(b[1],b[3]);}}
 const x=[...new Set(xs)].sort((a,b)=>a-b),y=[...new Set(ys)].sort((a,b)=>a-b),missing=[];
 for(let i=1;i<x.length;i++)for(let j=1;j<y.length;j++){
  const b=[x[i-1],y[j-1],x[i],y[j]],p=[(b[0]+b[2])/2,(b[1]+b[3])/2];
  if(!regions.some(r=>r.status==='prepared'&&r.bounds[0]<=p[0]&&p[0]<=r.bounds[2]&&r.bounds[1]<=p[1]&&p[1]<=r.bounds[3]))missing.push({bbox:b,reason:'REGION_NOT_PREPARED'});
 }
 return {covered:!missing.length,missing,meaning:'DECLARED_REGION_RECTANGLES_ONLY_NOT_REAL_WORLD_COMPLETENESS'};
}
class Gate{
 constructor(max){this.max=max;this.active=0;this.queue=[];this.peak=0;}
 run(fn,signal){return new Promise((resolve,reject)=>{
  const e={fn,signal,resolve,reject};e.abort=()=>{const i=this.queue.indexOf(e);if(i>=0){this.queue.splice(i,1);reject(cancelled());}};
  if(signal?.aborted)return reject(cancelled());signal?.addEventListener('abort',e.abort,{once:true});this.queue.push(e);this.pump();
 });}
 pump(){while(this.active<this.max&&this.queue.length){const e=this.queue.shift();e.signal?.removeEventListener('abort',e.abort);if(e.signal?.aborted){e.reject(cancelled());continue;}
 this.active++;this.peak=Math.max(this.peak,this.active);Promise.resolve().then(e.fn).then(e.resolve,e.reject).finally(()=>{this.active--;this.pump();});}}
}
export class TaiwanPreparedProvider{
 constructor(catalog,{fetcher=(u,o)=>globalThis.fetch(u,o),maxCacheBytes=32*1024*1024}={}){
  if(catalog.schema!=='astra-taiwan-prepared-catalog-v1'||!Array.isArray(catalog.regions)||catalog.regions.length>8||!catalog.regions.length)throw Error('INVALID_CATALOG');
  this.catalog=clone(catalog);this.fetcher=fetcher;this.cacheMax=Math.min(maxCacheBytes,32*1024*1024);if(!Number.isFinite(this.cacheMax)||this.cacheMax<0)throw Error('INVALID_CACHE');this.gate=new Gate(4);this.slots=new Map();this.stats={manifestRequests:0,manifestCacheHits:0,manifestFailures:0};
  const ids=new Set();for(const r of this.catalog.regions){
   if(ids.has(r.id)||!valid(r.bounds)||!['prepared','missing'].includes(r.status))throw Error('INVALID_REGION');ids.add(r.id);if(r.readBounds&&!valid(r.readBounds))throw Error('INVALID_READ_BOUNDS');
   if(r.status==='prepared'&&(!/^[0-9a-f]{64}$/.test(r.manifestSHA256)||!r.release||!r.baseURL))throw Error('INVALID_SOURCE_LOCK');
   if(r.status==='prepared'){const u=new URL(r.baseURL);if(!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))||u.username||u.password||u.search||u.hash)throw Error('INVALID_BASE_URL');}
  }
 }
 get pending(){return new Map([...this.slots.values()].flatMap(s=>s.provider?[...s.provider.pending].map(([k,v])=>[s.region.id+':'+k,v]):[]));}
 async fetchBound(url,options={}){return this.gate.run(async()=>{
  const f=this.fetcher,res=await f(url,options);if(!res.ok)return new Response(null,{status:res.status});
  const reader=res.body.getReader(),chunks=[];let n=0;while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>16*1024*1024){await reader.cancel();throw Error('TRANSFER_SIZE_LIMIT');}chunks.push(value);}
  return new Response(new Blob(chunks),{status:res.status});
 },options.signal);}
 acquire(region,signal){
  if(signal?.aborted)return Promise.reject(cancelled());let s=this.slots.get(region.id);
  if(s?.provider){this.stats.manifestCacheHits++;return Promise.resolve(s.provider);}
  // An aborted no-subscriber load must settle before the same source is retried.
  if(s?.controller.signal.aborted)return s.promise.catch(()=>{}).then(()=>this.acquire(region,signal));
  if(!s){
   s={region,controller:new AbortController(),refs:0};this.slots.set(region.id,s);this.stats.manifestRequests++;
   s.promise=(async()=>{
    const timer=setTimeout(()=>s.controller.abort(),15000);
    try{
     const res=await this.fetchBound(new URL('manifest.json',region.baseURL),{signal:s.controller.signal});if(!res.ok)throw Error('MANIFEST_HTTP_'+res.status);
     const reader=res.body.getReader(),chunks=[];let n=0;while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>16*1024*1024){await reader.cancel();throw Error('MANIFEST_SIZE_LIMIT');}chunks.push(value);}
     const data=new Uint8Array(n);let at=0;for(const c of chunks){data.set(c,at);at+=c.length;}
     if(hex(await crypto.subtle.digest('SHA-256',data))!==region.manifestSHA256)throw Error('MANIFEST_SHA_MISMATCH');const m=JSON.parse(new TextDecoder().decode(data));
     if(m.release!==region.release||m.servingZoom!==15)throw Error('MANIFEST_RELEASE_OR_ZOOM_MISMATCH');
     if(!m.tiles||Object.keys(m.tiles).length>100000)throw Error('INVALID_TILE_INDEX');
     for(const [tile,t] of Object.entries(m.tiles)){
      if(!/^15\/\d+\/\d+$/.test(tile)||!Array.isArray(t.pages))throw Error('INVALID_TILE_INDEX');
      for(const p of t.pages)if(!new RegExp('^serving/xyz/'+tile+'/part-[0-9]+\\.geojson\\.gz$').test(p.path)||!Number.isSafeInteger(p.bytes)||p.bytes<0||p.bytes>4*1024*1024||!Number.isSafeInteger(p.rawBytes)||p.rawBytes<0||p.rawBytes>32*1024*1024||!Number.isSafeInteger(p.featureCount)||p.featureCount<0||! /^[0-9a-f]{64}$/.test(p.sha256))throw Error('INVALID_PAGE_LOCK');
     }
     // Divide total serialized page cache across all catalog slots, not per region.
     s.provider=new PreparedProvider(m,region.baseURL,{fetcher:(u,o)=>this.fetchBound(u,o),maxCacheBytes:Math.floor(this.cacheMax/this.catalog.regions.filter(r=>r.status==='prepared').length)});
     return s.provider;
    }catch(e){this.stats.manifestFailures++;if(this.slots.get(region.id)===s)this.slots.delete(region.id);throw e;}finally{clearTimeout(timer);}
   })();
  }
  s.refs++;
  return new Promise((resolve,reject)=>{
   let done=false;const release=()=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);s.refs--;};
   const abort=()=>{release();if(s.refs===0&&!s.provider)s.controller.abort();reject(cancelled());};signal?.addEventListener('abort',abort,{once:true});
   s.promise.then(p=>{if(!done){release();resolve(p);}},e=>{if(!done){release();reject(e);}});
  });
 }
 async queryBBox(bbox,{signal}={}){
  const cov=coverage(bbox,this.catalog.regions),reasons=cov.missing.map(m=>m.reason),sourceRegions=[];
  if(!valid(bbox))return this.result([],reasons,cov,sourceRegions);
  const regions=this.catalog.regions.filter(r=>r.status==='prepared'&&positive(intersect(bbox,r.readBounds??r.bounds)));
  // A total tile membership cap, identical to the sealed per-query limit.
  const xy=(lon,lat)=>[Math.floor((lon+180)/360*32768),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*32768)];
  let tileCount=0;for(const r of regions){const b=intersect(bbox,r.readBounds??r.bounds),a=xy(b[0],b[3]),c=xy(b[2],b[1]);tileCount+=(c[0]-a[0]+1)*(c[1]-a[1]+1);}
  if(tileCount>64)return this.result([],['OPERATIONAL_TILE_QUERY_LIMIT'],cov,sourceRegions);
  const results=await Promise.allSettled(regions.map(async r=>{const p=await this.acquire(r,signal);await Promise.allSettled([...p.pending.values()].filter(e=>e.controller.signal.aborted).map(e=>e.promise));if(signal?.aborted)throw cancelled();const v=await p.queryBBox(intersect(bbox,r.readBounds??r.bounds),{signal});if(p.m.geometryCoverageComplete===false){v.reasons.push('SOURCE_GEOMETRY_INCOMPLETE');v.status='unknown/partial';}return {r,v};}));
  if(signal?.aborted)throw cancelled();
  const seen=new Map(),conflicts=new Set();
  for(const a of results){if(a.status!=='fulfilled'){reasons.push(String(a.reason?.message||a.reason));continue;}const {r,v}=a.value;reasons.push(...v.reasons);sourceRegions.push({id:r.id,release:r.release,manifestSHA256:r.manifestSHA256,status:v.status});
   for(const f of v.features){const p=f.properties,id=p.source!==undefined&&p.source_id!==undefined&&p.region!==undefined?JSON.stringify([p.source,p.source_id,p.region]):p.prepared_id,old=seen.get(id);if(conflicts.has(id))continue;
    if(old&&JSON.stringify([old.geometry,old.properties.height_m,old.properties.height_quality])!==JSON.stringify([f.geometry,f.properties.height_m,f.properties.height_quality])){conflicts.add(id);seen.delete(id);reasons.push('CONFLICTING_SOURCE_ID');continue;}
    if(!old){f.astra.regionSources=[r.id];seen.set(id,f);}else old.astra.regionSources.push(r.id);
   }
  }
  // Conflicted identities are withheld from estimated casting; not discarded as sun.
  return this.result([...seen.values()],reasons,cov,sourceRegions,[...conflicts]);
 }
 result(features,reasons,coverage,sourceRegions,unresolvedIds=[]){return {features,reasons:[...new Set(reasons)],coverage,sourceRegions,unresolvedIds,status:reasons.length?'unknown/partial':'estimated-data-ready',verifiedProofEligible:false,realWorldCoverageComplete:false,unknownResolved:0,release:sourceRegions.map(r=>r.id+':'+r.release).sort().join('|')};}
 diagnostics(){const pages=[...this.slots.values()].filter(s=>s.provider).map(s=>s.provider.diagnostics());return {...this.stats,regionsLoaded:pages.length,globalActiveRequests:this.gate.active,peakRequests:this.gate.peak,globalConcurrencyLimit:4,cacheRawBytes:pages.reduce((a,b)=>a+b.cacheRawBytes,0),cacheRawBytesLimit:this.cacheMax,cacheBytesAreSerializedSizeNotJSHeap:true,pages};}
}
