// Same-origin authenticated transport only. No HF token, endpoint supplied by a
// user, redirects, filesystem handles, write API or elevation of estimated data.
export const SERVICE_PREFIX='/__astra/prepared/v1/';
const fail=m=>{throw Error(m);};
const aborted=s=>{if(s?.aborted)throw Object.assign(Error('CANCELLED'),{name:'AbortError'});};
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function validateDescriptor(d,registry,lock){
 if(d?.schema!=='astra-private-prepared-service-v1'||d.transport!=='AUTHENTICATED_SAME_ORIGIN_READ_ONLY'||d.heightClassification!=='ML_ESTIMATED'||d.verifiedProofEligible!==false||d.realWorldCoverageComplete!==false||d.Proof!=='INCOMPLETE'||d.winnerId!==null||d.unknownSafelyResolved!==0)fail('REMOTE_SOURCE_POLICY_CHANGED');
 for(const k of ['repository','commit','publicationSHA256','inventorySHA256'])if(typeof lock?.[k]!=='string'||d.source?.[k]!==lock[k])fail('REMOTE_SOURCE_IDENTITY_CHANGED');
 if(d.regions?.length!==registry.regions.length||new Set(d.regions.map(r=>r.role)).size!==d.regions.length)fail('REMOTE_REGION_IDENTITY_CHANGED');
 for(const r of registry.regions){const p=d.regions.find(p=>p.role===r.role);if(!p||p.release!==r.release||p.manifestSHA256!==r.manifestSHA256||lock.sourceManifests?.[r.role]!==r.manifestSHA256)fail('REMOTE_MANIFEST_IDENTITY_CHANGED');}
 return true;
}
export async function connectRemotePrepared(registry,lock,{origin,signal,fetcher=(u,o)=>globalThis.fetch(u,o)}={}){
 const home=new URL(origin);if(home.origin!==origin||!(home.protocol==='https:'||home.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(home.hostname)))fail('SECURE_SAME_ORIGIN_REQUIRED');
 const manifests=new Map(),pages=new Map(),stats={mode:'AUTHENTICATED_SAME_ORIGIN_READ_ONLY',descriptorRequests:0,manifestReads:0,pageReads:0,bytesRead:0,failures:0,writes:0,hfTransfers:0};
 async function bytes(relative,limit,s,expected){
  aborted(s);const url=new URL(SERVICE_PREFIX+relative,origin),f=fetcher;
  const r=await f(url.href,{signal:s,method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
  if(!r.ok){await r.body?.cancel();fail('REMOTE_SOURCE_HTTP_'+r.status);}
  if(r.redirected||r.url&&r.url!==url.href){await r.body?.cancel();fail('REMOTE_REDIRECT_REJECTED');}
  const len=r.headers.get('content-length');if(len!==null&&(!/^\d+$/.test(len)||Number(len)>limit||expected?.bytes!==undefined&&Number(len)!==expected.bytes)){await r.body?.cancel();fail('REMOTE_SIZE_MISMATCH');}
  if(!r.body)fail('REMOTE_EMPTY_RESPONSE');const reader=r.body.getReader(),chunks=[];let n=0;
  try{while(true){aborted(s);const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit)fail('REMOTE_SIZE_LIMIT');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  aborted(s);if(expected?.bytes!==undefined&&n!==expected.bytes)fail('REMOTE_SIZE_MISMATCH');const b=new Uint8Array(n);let at=0;for(const a of chunks){b.set(a,at);at+=a.length;}
  if(expected?.sha256&&await sha(b)!==expected.sha256)fail('REMOTE_SHA_MISMATCH');stats.bytesRead+=n;return b;
 }
 const parentSignal=signal,connectController=new AbortController(),cancelConnect=()=>connectController.abort();parentSignal?.addEventListener('abort',cancelConnect,{once:true});if(parentSignal?.aborted)cancelConnect();signal=connectController.signal;
 let descriptor;try{
 stats.descriptorRequests++;descriptor=JSON.parse(new TextDecoder().decode(await bytes('descriptor.json',65536,signal)));validateDescriptor(descriptor,registry,lock);
 await Promise.all(registry.regions.map(async r=>{
  const b=await bytes(`regions/${r.role}/manifest.json`,16*1024*1024,signal,{sha256:r.manifestSHA256}),m=JSON.parse(new TextDecoder().decode(b));
  if(m.release!==r.release||m.schema!=='astra-gba-prepared-v1'||m.servingZoom!==15||m.heightClassification!=='ML_ESTIMATED'||m.verifiedProofEligible!==false||m.realWorldCoverageComplete!==false||!m.tiles)fail('REMOTE_MANIFEST_POLICY_CHANGED');
  for(const [tile,t]of Object.entries(m.tiles)){
   if(!/^15\/\d+\/\d+$/.test(tile)||!Array.isArray(t.pages))fail('REMOTE_PAGE_INDEX_INVALID');
   for(const p of t.pages){const key=r.role+'/'+p.path;if(!new RegExp('^serving/xyz/'+tile+'/part-\\d+\\.geojson\\.gz$').test(p.path)||pages.has(key)||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>4*1024*1024||! /^[a-f0-9]{64}$/.test(p.sha256))fail('REMOTE_PAGE_INDEX_INVALID');pages.set(key,p);}
  }
  manifests.set(r.role,b);stats.manifestReads++;
 }));
 }catch(e){connectController.abort();throw e;}finally{parentSignal?.removeEventListener('abort',cancelConnect);}
 const read=async(url,options={})=>{
  aborted(options.signal);const u=new URL(url,origin);
  if(u.username||u.password||u.search||u.hash||options.method&&options.method!=='GET')fail('READ_ONLY_SOURCE_REQUEST');
  if(u.origin==='https://data.source.coop'&&/^\/tge-labs\/meta-chm-v2\/chm\/[0-3]{10}\.tif$/.test(u.pathname)){
   const f=fetcher;return f(u.href,{...options,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
  }
  if(u.origin!==origin)fail('UNTRUSTED_SOURCE_URL');
  const m=/^\/regions\/(north|south)\/(manifest\.json|serving\/xyz\/15\/\d+\/\d+\/part-\d+\.geojson\.gz)$/.exec(u.pathname);
  if(!m)fail('UNLISTED_PREPARED_FILE');
  if(m[2]==='manifest.json')return new Response(manifests.get(m[1]).slice());
  const key=m[1]+'/'+m[2],rec=pages.get(key);if(!rec)fail('UNLISTED_PREPARED_FILE');
  try{const b=await bytes('regions/'+key,4*1024*1024,options.signal,rec);stats.pageReads++;return new Response(b);}catch(e){stats.failures++;throw e;}
 };
 return {fetcher:read,stats,descriptor};
}
