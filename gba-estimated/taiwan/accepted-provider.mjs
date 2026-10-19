/* Admission wrapper for accepted, isolated Estimated Shade only. No route/proof API. */
import {TaiwanPreparedProvider} from './northern-provider.mjs';
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function loadAcceptedRegistry(url,{sha256,fetcher=(u,o)=>globalThis.fetch(u,o),signal}={}){
 if(!/^[a-f0-9]{64}$/.test(sha256??''))throw Error('REGISTRY_SHA_REQUIRED');
 const f=fetcher,r=await f(url,{signal});if(!r.ok)throw Error('REGISTRY_HTTP_'+r.status);
 const reader=r.body.getReader(),chunks=[];let n=0;
 while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>65536){await reader.cancel();throw Error('REGISTRY_SIZE_LIMIT');}chunks.push(value);}
 const bytes=new Uint8Array(n);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.length;}
 if(hex(await crypto.subtle.digest('SHA-256',bytes))!==sha256)throw Error('REGISTRY_SHA_MISMATCH');
 return JSON.parse(new TextDecoder().decode(bytes));
}
export function acceptedCatalog(registry,origin){
 if(registry.schema!=='astra-accepted-taiwan-estimated-v1'||registry.acceptance?.WindowsNorthTaiwanNative!=='PASS'||registry.regions?.length!==2)throw Error('ACCEPTANCE_REQUIRED');
 const p=registry.policy;
 if(p?.NO_PRODUCTION_CHANGE!==true||p.PRODUCTION_MERGE_HOLD!==true||p.Proof!=='INCOMPLETE'||p.winnerId!==null||p.unknownSafelyResolved!==0)throw Error('PROOF_POLICY_CHANGED');
 if(registry.heightClassification!=='ML_ESTIMATED'||registry.verifiedProofEligible!==false||registry.realWorldCoverageComplete!==false)throw Error('ESTIMATED_ONLY');
 const roles=new Set(registry.regions.map(r=>r.role));if(roles.size!==2||!roles.has('north')||!roles.has('south'))throw Error('REGION_PAIR_REQUIRED');
 return {schema:'astra-taiwan-prepared-catalog-v1',policy:structuredClone(p),regions:registry.regions.map(r=>{
  if(r.status!=='prepared'||r.acceptanceStatus!=='PASS'||r.baseURL!==`/regions/${r.role}/`)throw Error('UNACCEPTED_REGION');
  const u=new URL(r.baseURL,origin);if(u.username||u.password||u.search||u.hash)throw Error('INVALID_ORIGIN');
  return {...structuredClone(r),baseURL:u.href};
 })};
}
export function createAcceptedTaiwanProvider(registry,{origin,fetcher,maxCacheBytes}={}){
 return new TaiwanPreparedProvider(acceptedCatalog(registry,origin),{fetcher,maxCacheBytes});
}
// The halo is an acquisition request, never evidence of complete caster coverage.
// No new caster heights, exact-time bounds, proof conclusions or SUN are produced.
export function casterAcquisitionBox(bbox,haloM=1500){
 if(!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite)||!(bbox[0]<bbox[2]&&bbox[1]<bbox[3])||bbox[0]<-180||bbox[2]>180||bbox[1]<-85||bbox[3]>85||!Number.isFinite(haloM)||haloM<0||haloM>1500)throw Error('INVALID_HALO_QUERY');
 const dy=haloM/110000,dx=haloM/(110000*Math.cos(Math.max(Math.abs(bbox[1]),Math.abs(bbox[3]))*Math.PI/180));
 const b=[bbox[0]-dx,bbox[1]-dy,bbox[2]+dx,bbox[3]+dy];
 if(b[0]<-180||b[2]>180||b[1]<-85||b[3]>85)throw Error('HALO_OUTSIDE_SUPPORTED_COORDINATES');return b;
}
export async function queryEstimatedCasters(provider,bbox,{signal,haloM=1500}={}){
 const acquisitionBBox=casterAcquisitionBox(bbox,haloM),r=await provider.queryBBox(acquisitionBBox,{signal});
 return {...r,viewportBBox:[...bbox],acquisitionBBox,acquisitionHaloM:haloM,casterAcquisitionComplete:false,
  proofClassification:'UNKNOWN',verifiedProofEligible:false,unknownResolved:0,
  haloStatus:'BOUNDED_ACQUISITION_ONLY_NO_MAX_HEIGHT_OR_LOW_SUN_DISTANCE_PROOF',
  buildingInventoryComplete:false};
}
