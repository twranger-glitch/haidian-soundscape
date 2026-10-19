// Precedence within exactly equivalent full geometry. No overlap-threshold conflation.
import {geometryIdentity} from './geometry.mjs';
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const gbaFamily=s=>typeof s==='string'&&/^(gba(?:$|[.\s/_-])|globalbuildingatlas(?:$|[.\s/_-]))/i.test(s);
export function resolveHeight(candidates){
 const accepted=[],rejected=[];
 for(const c of candidates){
  const p=c.feature?.properties||{},h=c.heightM??p.height_m;
  if(typeof h!=='number'||!Number.isFinite(h)||h<=0){rejected.push({sourceId:c.sourceId,reason:'HEIGHT_MISSING_OR_INVALID'});continue;}
  if(c.kind==='GBA'){
   if(p.verifiedProofEligible!==false||!['ML_ESTIMATED','ML_ESTIMATED_VAR_INVALID'].includes(p.height_quality)){rejected.push({sourceId:c.sourceId,reason:'GBA_EVIDENCE_CLASS_INVALID'});continue;}
   accepted.push({...c,heightM:h,heightClass:'ML_ESTIMATED',rank:2,varianceIsErrorBound:false});
  }else if(c.kind==='QUALIFIED_HEIGHT'){
   const e=c.provenance;
   if(!e||typeof e.family!=='string'||!e.family||gbaFamily(e.family)||gbaFamily(e.sourceName)||e.heightMethod==='ML_ESTIMATED'||!['REPORTED','MEASURED'].includes(e.heightClass)||!hash(e.sourceSHA256)||!e.sourceName||!e.version||e.qualification!=='height-and-full-footprint-attested'||e.heightReference!=='above-local-base-m'){
    rejected.push({sourceId:c.sourceId,reason:'QUALIFIED_HEIGHT_EVIDENCE_INSUFFICIENT'});continue;
   }
   accepted.push({...c,heightM:h,heightClass:e.heightClass,rank:3});
  }else if(c.kind==='OVERTURE_FLOORS_DERIVED'){
   if(c.provenance?.method!=='recorded-floors-derived-height'){rejected.push({sourceId:c.sourceId,reason:'FLOORS_PROVENANCE_MISSING'});continue;}
   accepted.push({...c,heightM:h,heightClass:'FLOORS_DERIVED',rank:1});
  }else rejected.push({sourceId:c.sourceId,reason:'SOURCE_CLASS_UNKNOWN'});
 }
 if(!accepted.length)return {status:'UNKNOWN',rejected,verifiedProofEligible:false};
 const rank=Math.max(...accepted.map(c=>c.rank)),top=accepted.filter(c=>c.rank===rank);
 if(new Set(top.map(c=>c.heightM)).size!==1)return {status:'UNKNOWN',reason:'HIGHEST_PRIORITY_HEIGHT_CONFLICT',rejected,conflictingSources:top.map(c=>c.sourceId),verifiedProofEligible:false};
 top.sort((a,b)=>String(a.sourceId).localeCompare(String(b.sourceId)));
 return {status:'HEIGHT_AVAILABLE_FOR_ESTIMATED_MODEL',selected:top[0],rejected,suppressed:accepted.filter(c=>c.rank<rank).map(c=>c.sourceId),verifiedProofEligible:false};
}
export function groupSources(features,higherSources=[]){
 const groups=new Map(),rejected=[];
 const all=features.map(feature=>({kind:'GBA',feature,sourceId:feature.properties?.gba_key??feature.id})).concat(higherSources);
 for(const c of all){try{const id=geometryIdentity(c.feature?.geometry);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(c);}catch(e){rejected.push({sourceId:c.sourceId,reason:String(e.message)});}}
 return {groups:[...groups].map(([identity,candidates])=>({identity,candidates,geometry:candidates[0].feature.geometry,resolution:resolveHeight(candidates)})),rejected,identityRule:'exact-complete-geometry-no-rounding-no-overlap-threshold'};
}
