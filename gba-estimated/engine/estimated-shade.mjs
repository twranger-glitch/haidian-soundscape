import {solarPosition} from './solar.mjs';
import {localProjection,validateGeometry,shadowVector,sweptPieces,inShadow,footprintContains,geometryBounds,expandedBBox} from './geometry.mjs';
import {groupSources} from './source-priority.mjs';
const abort=()=>Object.assign(Error('CANCELLED'),{name:'AbortError'});
export function buildScene(result,sun,origin,higherSources=[]){
 result=structuredClone(result);higherSources=structuredClone(higherSources);
 const projection=localProjection(origin),casters=[],unresolved=[],footprints=[];
 const policy={mode:'ISOLATED_ESTIMATED_SHADE',verifiedProofEligible:false,verifiedClassification:'UNKNOWN',unknownSafelyResolved:0,Proof:'INCOMPLETE',winnerId:null,productionChange:false,sourceCoverageComplete:false};
 const sources=result.features.concat(higherSources.map(s=>s.feature));
 const vertexCount=sources.reduce((n,f)=>n+(f?.geometry?.type==='Polygon'?f.geometry.coordinates:f?.geometry?.type==='MultiPolygon'?f.geometry.coordinates.flat():[]).reduce((m,r)=>m+r.length,0),0);
 if(sources.length>1024||vertexCount>8192)return {...policy,casters,footprints,unresolved:[{reason:'ESTIMATED_RENDER_SCOPE_LIMIT',featureCount:sources.length,vertexCount}],origin,projection,sun,providerStatus:result.status};
 const grouped=groupSources(result.features,higherSources);unresolved.push(...grouped.rejected);
 for(const group of grouped.groups){
  try{
   const polys=validateGeometry(group.geometry,projection);footprints.push(...polys);
   if(group.resolution.status==='UNKNOWN'){unresolved.push({geometryIdentity:group.identity,reason:group.resolution.reason||'HEIGHT_UNKNOWN',resolution:group.resolution});continue;}
   const selected=group.resolution.selected,vector=shadowVector(selected.heightM,sun),pieces=sweptPieces(polys,vector);
   casters.push({sourceId:selected.sourceId,heightM:selected.heightM,heightClass:selected.heightClass,provenance:selected.provenance??selected.feature.properties,polys,pieces,vector,geometryIdentity:group.identity,resolution:group.resolution,modelAssumptions:['uniform-LOD1-height','flat-local-ground','vertical-prism','unverified-roof-parts-and-datum'],verifiedProofEligible:false});
  }catch(e){unresolved.push({geometryIdentity:group.identity,reason:String(e.message)});}
 }
 return {...policy,casters,footprints,unresolved,providerStatus:result.status,providerReasons:result.reasons??[],release:result.release,origin,projection,sun};
}
export function queryPoint(scene,lonlat){
 const policy={verifiedClassification:'UNKNOWN',verifiedProofEligible:false,unknownSafelyResolved:0,Proof:'INCOMPLETE',winnerId:null};
 if(!Array.isArray(lonlat)||lonlat.length!==2||lonlat.some(x=>!Number.isFinite(x)))return {...policy,estimatedClassification:'UNKNOWN',reason:'INVALID_POINT'};
 const p=scene.projection.forward(lonlat);
 if(footprintContains(p,scene.footprints))return {...policy,estimatedClassification:'UNKNOWN',reason:'INSIDE_BUILDING_NOT_WALKABILITY_EVIDENCE'};
 const sources=scene.casters.filter(c=>inShadow(p,c.pieces));
 return {...policy,estimatedClassification:sources.length?'ESTIMATED_BUILDING_SHADE':'UNKNOWN',sourceIds:sources.map(c=>c.sourceId),reason:sources.length?'ESTIMATED_GEOMETRIC_CONTRIBUTION_ONLY':'NO_POSITIVE_BUILDING_SHADOW_EVIDENCE_NOT_CONFIRMED_SUN',partial:scene.providerStatus!=='estimated-data-ready'||scene.unresolved.length>0};
}
export class EstimatedShadeController{
 constructor(provider,{casterMarginM=50}={}){this.provider=provider;this.casterMarginM=casterMarginM;this.id=0;this.active=null;this.scene=null;this.acquisition=null;}
 async load(bbox,time,{higherSources=[],signal}={}){
  const extra=structuredClone(higherSources),scope=expandedBBox(bbox,this.casterMarginM);
  this.active?.abort();const controller=new AbortController(),id=++this.id;this.active=controller;
  const cancelled=()=>controller.abort();signal?.addEventListener('abort',cancelled,{once:true});if(signal?.aborted)controller.abort();
  try{
   // Drain the aborted subscriber/pending page before reacquiring the same key.
   // Promise settlement is the synchronization event; no timing sleep.
   if(this.acquisition)await this.acquisition.catch(()=>{});
   // Subscriber cancellation can settle before the underlying fetch promise.
   // The hash-locked PreparedProvider exposes pending entries; wait only for
   // aborted fetches, leaving still-used peer requests available for coalescing.
   const cancelledPages=this.provider.pending instanceof Map?[...this.provider.pending.values()].filter(e=>e.controller.signal.aborted).map(e=>e.promise):[];
   if(cancelledPages.length)await Promise.allSettled(cancelledPages);
   if(controller.signal.aborted)throw abort();
   if(id!==this.id)throw abort();
   this.acquisition=this.provider.queryBBox(scope,{signal:controller.signal});
   const result=await this.acquisition;if(controller.signal.aborted||id!==this.id)throw abort();
   const bounded={...result,features:result.features.filter(f=>{const b=geometryBounds(f.geometry);return !b||b[0]<=scope[2]&&b[2]>=scope[0]&&b[1]<=scope[3]&&b[3]>=scope[1];})};
   const origin=[(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2],sun=solarPosition(time,...origin),scene=buildScene(bounded,sun,origin,extra);
   scene.acquisitionBBox=scope;scene.viewportBBox=[...bbox];scene.acquisitionMarginM=this.casterMarginM;scene.acquisitionIsGlobalCasterCompletenessProof=false;
   if(controller.signal.aborted||id!==this.id)throw abort();this.scene=scene;return scene;
  }finally{signal?.removeEventListener('abort',cancelled);}
 }
 cancel(){this.active?.abort();}
}
export function renderCanvas(ctx,scene,bbox,width,height){
 const [x0,y0]=scene.projection.forward([bbox[0],bbox[1]]),[x1,y1]=scene.projection.forward([bbox[2],bbox[3]]);
 const px=p=>[(p[0]-x0)/(x1-x0)*width,height-(p[1]-y0)/(y1-y0)*height];let drawn=0;ctx.clearRect(0,0,width,height);ctx.fillStyle='rgba(38,65,85,0.24)';
 for(const c of scene.casters)for(const poly of c.pieces){ctx.beginPath();for(const ring of poly){ring.forEach((p,i)=>{const [x,y]=px(p);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.closePath();}ctx.fill('evenodd');drawn++;}
 // Ground-shadow display excludes all building interiors, matching point queries.
 ctx.globalCompositeOperation='destination-out';
 for(const poly of scene.footprints){ctx.beginPath();for(const ring of poly){ring.forEach((p,i)=>{const [x,y]=px(p);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.closePath();}ctx.fill('evenodd');}
 ctx.globalCompositeOperation='source-over';
 ctx.fillStyle='#283c49';ctx.font='14px sans-serif';ctx.fillText('ESTIMATED · ML heights / flat ground · NOT Verified Proof',12,24);return {drawnPieces:drawn,verifiedProofEligible:false};
}
