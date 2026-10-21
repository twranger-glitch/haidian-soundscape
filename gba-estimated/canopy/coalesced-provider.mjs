// Acquisition lifecycle only. The SHA-locked native raster decoder, range pins,
// source policy, projection and query geometry remain in provider.mjs unchanged.
// GeoTIFF COG metadata/request state is shared in that provider: distinct frame
// acquisitions drain serially; identical native tile sets share one producer.
import {CanopyProvider} from './provider.mjs';
import {tileCoordinates} from './grid.mjs';
const FRAME_LIMIT=8,SUBSCRIBER_LIMIT=64,MAX_FRAME_MS=12000;
const abort=()=>Object.assign(Error('CANOPY_CANCELLED'),{name:'AbortError'});
let emptyIdentity;
const emptySHA=()=>emptyIdentity??=crypto.subtle.digest('SHA-256',new TextEncoder().encode('[]')).then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''));
export class CoalescedCanopyProvider extends CanopyProvider{
 constructor(options={}){super(options);this.frameJobs=new Map();this.frameQueue=[];this.activeFrame=null;this.frameSubscribers=0;this.frameMetrics={acquisitions:0,physicalFrames:0,coalescedFrames:0,subscriberAborts:0,subscriberDeadlines:0,physicalAborts:0,queuedAbandons:0,cacheOnlyFrames:0,cacheReadyFrames:0,queueRejects:0,peakPhysicalFrames:0,peakSubscribers:0};}
 async partial(bbox,requested,reason){return{tiles:new Map(),status:'partial',identity:await emptySHA(),sourceBase:this.base,requestedTiles:requested,failedTiles:requested,errors:[{reason}],bbox:[...bbox],coverageIsGlobalProof:false};}
 acquire(bbox,{signal,deadline=performance.now()+MAX_FRAME_MS}={}){
  this.frameMetrics.acquisitions++;
  if(signal?.aborted)return Promise.reject(abort());
  let tiles;try{
   if(!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite)||bbox[0]>bbox[2]||bbox[1]>bbox[3])throw Error('CANOPY_ACQUISITION_BBOX_INVALID');
   tiles=tileCoordinates(bbox);
  }catch(e){return this.partial(Array.isArray(bbox)?bbox:[],0,e.message);}
  const now=performance.now();if(!Number.isFinite(deadline))return this.partial(bbox,tiles.length,'CANOPY_ACQUISITION_DEADLINE_INVALID');
  const expires=Math.min(deadline,now+MAX_FRAME_MS);
  if(expires<=now){this.frameMetrics.subscriberDeadlines++;return this.partial(bbox,tiles.length,'CANOPY_ACQUISITION_DEADLINE');}
  if(this.frameSubscribers>=SUBSCRIBER_LIMIT){this.frameMetrics.queueRejects++;return this.partial(bbox,tiles.length,'CANOPY_ACQUISITION_SUBSCRIBER_LIMIT');}
  // Cached rasters do not touch GeoTIFF shared request state. Do not let an
  // unrelated slow download block an already verified complete native frame.
  if(tiles.length&&tiles.every(t=>this.cache.has(t.key)))return this.cachedFrame(bbox,tiles,{signal,expires});
  const key=JSON.stringify([this.base,tiles.map(t=>t.key)]);let entry=this.frameJobs.get(key);
  if(entry?.controller.signal.aborted)entry=null;
  if(entry)this.frameMetrics.coalescedFrames++;
  else{
   if(this.frameQueue.length+(this.activeFrame?1:0)>=FRAME_LIMIT){this.frameMetrics.queueRejects++;return this.partial(bbox,tiles.length,'CANOPY_ACQUISITION_QUEUE_LIMIT');}
   entry={key,bbox:[...bbox],list:tiles,requested:tiles.length,controller:new AbortController(),clients:new Set(),started:false};this.frameJobs.set(key,entry);this.frameQueue.push(entry);
  }
  return new Promise((resolve,reject)=>{
   const client={bbox:[...bbox],resolve,reject,done:false,timer:null};
   const release=()=>{if(client.done)return false;client.done=true;clearTimeout(client.timer);signal?.removeEventListener('abort',client.abort);entry.clients.delete(client);this.frameSubscribers--;return true;};
   client.finish=(error,frame)=>{if(signal?.aborted){client.abort();return;}if(performance.now()>=expires){client.timeout();return;}if(!release())return;if(error)reject(error);else resolve({...frame,tiles:new Map(frame.tiles),bbox:[...client.bbox],errors:frame.errors.map(e=>({...e}))});};
   client.abort=()=>{if(!release())return;this.frameMetrics.subscriberAborts++;reject(abort());this.abandon(entry);};
   client.timeout=()=>{if(!release())return;this.frameMetrics.subscriberDeadlines++;this.partial(client.bbox,entry.requested,'CANOPY_ACQUISITION_DEADLINE').then(resolve,reject);this.abandon(entry);};
   entry.clients.add(client);this.frameSubscribers++;this.frameMetrics.peakSubscribers=Math.max(this.frameMetrics.peakSubscribers,this.frameSubscribers);
   signal?.addEventListener('abort',client.abort,{once:true});client.timer=setTimeout(client.timeout,Math.max(0,expires-performance.now()));
   // A late same-turn abort must not be missed between the first check/listener.
   if(signal?.aborted)client.abort();else this.pumpFrames();
  });
 }
 async cachedFrame(bbox,list,{signal,expires}){
  this.frameSubscribers++;this.frameMetrics.peakSubscribers=Math.max(this.frameMetrics.peakSubscribers,this.frameSubscribers);this.frameMetrics.cacheOnlyFrames++;
  try{
   const frame=await this.assembleCachedFrame(bbox,list);
   if(signal?.aborted)throw abort();if(performance.now()>=expires){this.frameMetrics.subscriberDeadlines++;return this.partial(bbox,list.length,'CANOPY_ACQUISITION_DEADLINE');}
   return frame;
  }finally{this.frameSubscribers--;}
 }
 async assembleCachedFrame(bbox,list){
   const tiles=new Map(),versions=new Map(),errors=[];
   for(const t of list){const tile=this.cache.get(t.key);this.cache.delete(t.key);this.cache.set(t.key,tile);this.metrics.tileCacheHits++;tiles.set(t.key,tile);
    const u=tile.identity.sourceURL,p=tile.identity.remotePin;if(versions.has(u)&&versions.get(u)!==p)errors.push({reason:'CANOPY_FRAME_SOURCE_VERSION_CONFLICT',url:u});versions.set(u,p);
   }
   // Same native source/window/decoded SHA/remote-pin identity rule as the
   // original provider; no time bucket, generated data or geographic shortcut.
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...tiles].map(([k,t])=>[k,t.identity.rasterSHA256,t.identity.remotePin]))));
   return{tiles,status:errors.length?'partial':'ready',identity:[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join(''),sourceBase:this.base,requestedTiles:list.length,failedTiles:0,errors,bbox:[...bbox],coverageIsGlobalProof:false};
 }
 async tile(t,signal){
  const value=await super.tile(t,signal);
  // The native provider has now completed decoding, source receipt validation,
  // onTile and LRU publication. A queued subset must not await unrelated data.
  // Only cached rasters are read here: no parallel frame, range or decoder work.
  for(const e of [...this.frameQueue]){
   if(e.controller.signal.aborted||!e.clients.size||!e.list.length||!e.list.every(t=>this.cache.has(t.key)))continue;
   this.frameQueue.splice(this.frameQueue.indexOf(e),1);if(this.frameJobs.get(e.key)===e)this.frameJobs.delete(e.key);
   this.frameMetrics.cacheReadyFrames++;
   this.assembleCachedFrame(e.bbox,e.list).then(frame=>{for(const c of [...e.clients])c.finish(null,frame);},error=>{for(const c of [...e.clients])c.finish(error);});
  }
  return value;
 }
 abandon(entry){
  if(entry.clients.size||entry.controller.signal.aborted)return;
  if(entry.started)this.frameMetrics.physicalAborts++;else this.frameMetrics.queuedAbandons++;entry.controller.abort();
  if(!entry.started){const i=this.frameQueue.indexOf(entry);if(i>=0)this.frameQueue.splice(i,1);if(this.frameJobs.get(entry.key)===entry)this.frameJobs.delete(entry.key);}
 }
 pumpFrames(){
  if(this.activeFrame)return;
  while(this.frameQueue.length){const e=this.frameQueue.shift();if(e.controller.signal.aborted||!e.clients.size){if(this.frameJobs.get(e.key)===e)this.frameJobs.delete(e.key);continue;}this.activeFrame=e;e.started=true;this.frameMetrics.physicalFrames++;this.frameMetrics.peakPhysicalFrames=1;this.runFrame(e);break;}
 }
 async runFrame(entry){
  try{
   // Subscriber clocks enforce their own original deadlines. The physical job
   // also retains the original 12s ceiling, never extended by a later joiner.
   const frame=await super.acquire(entry.bbox,{signal:entry.controller.signal,deadline:performance.now()+MAX_FRAME_MS});
   for(const c of [...entry.clients])c.finish(null,frame);
  }catch(e){for(const c of [...entry.clients])c.finish(e);}
  finally{if(this.frameJobs.get(entry.key)===entry)this.frameJobs.delete(entry.key);this.activeFrame=null;this.pumpFrames();}
 }
 stats(){return{...super.stats(),acquisitionLifecycle:{...this.frameMetrics,activePhysicalFrames:this.activeFrame?1:0,queuedFrames:this.frameQueue.length,pendingFrameIdentities:this.frameJobs.size,subscribers:this.frameSubscribers,physicalFrameLimit:1,pendingFrameLimit:FRAME_LIMIT,subscriberLimit:SUBSCRIBER_LIMIT,physicalFrameTimeLimitMs:MAX_FRAME_MS}};}
}
