// Conditional building-model samples ONLY. UNKNOWN never becomes SUN.
import {buildScene} from '../engine/estimated-shade.mjs';
import {solarPosition} from '../engine/solar.mjs';
import {shadowVector,sweptPieces,inShadow,footprintContains,geometryBounds,expandedBBox} from '../engine/geometry.mjs';
const abort=()=>Object.assign(Error('CANCELLED'),{name:'AbortError'});
const distance=(a,b)=>{const r=Math.PI/180,p=a.lat*r,q=b.lat*r,x=(b.lat-a.lat)*r,y=(b.lng-a.lng)*r;return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(x/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(y/2)**2)));};
export function routeBounds(points){if(!points?.length)throw Error('EMPTY_ROUTE');const a=Math.min(...points.map(p=>p.lng)),b=Math.min(...points.map(p=>p.lat)),c=Math.max(...points.map(p=>p.lng)),d=Math.max(...points.map(p=>p.lat));return [a-.00015,b-.00015,c+.00015,d+.00015];}
export function planRouteSamples(candidate,{speedMps=1.25,spacingM=10}={}){
 if(!Number.isFinite(speedMps)||speedMps<.5||speedMps>2.5||spacingM!==10)throw Error('INVALID_SAMPLING_POLICY');
 const points=candidate.points;if(points.length<2||points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>85||Math.abs(p.lng)>180))throw Error('INVALID_ROUTE_POINTS');
 const lengths=points.slice(1).map((p,i)=>distance(points[i],p)),total=lengths.reduce((a,b)=>a+b,0);
 if(!(total>0)||Math.abs(total-candidate.distanceM)>Math.max(.05,total*1e-6))throw Error('ROUTE_DISTANCE_ACCOUNTING_MISMATCH');
 const count=Math.ceil(total/spacingM),samples=[];let segment=0,offset=0;
 for(let j=0;j<count;j++){const start=j*total/count,end=(j+1)*total/count,mid=(start+end)/2;while(segment<lengths.length-1&&offset+lengths[segment]<mid){offset+=lengths[segment++];}const f=(mid-offset)/lengths[segment],a=points[segment],b=points[segment+1];samples.push({index:j,distanceM:end-start,seconds:(end-start)/speedMps,arrivalOffsetS:mid/speedMps,point:{lat:a.lat+(b.lat-a.lat)*f,lng:a.lng+(b.lng-a.lng)*f}});}
 return {distanceM:total,durationS:total/speedMps,samples};
}
export function createEstimatedRouteField(acquired,origin){
 acquired=structuredClone(acquired);
 const b=buildScene(acquired,{altitudeDeg:45,azimuthDeg:90},origin),snapshot=JSON.stringify([acquired.release,acquired.sourceRegions,acquired.conflictRegistrySourceSHA256]),cache=new Map();let calls=0,hits=0;
 return {snapshot,base:b,stats:()=>({modelQueries:calls,exactQueryCacheHits:hits,exactQueryCacheSize:cache.size}),query(point,time){
  const key=JSON.stringify([snapshot,point.lng,point.lat,new Date(time).getTime()]);if(cache.has(key)){hits++;return structuredClone(cache.get(key));}calls++;
  const p=b.projection.forward([point.lng,point.lat]),timeUTC=new Date(time).toISOString();let value={estimatedClassification:'UNKNOWN',reason:'NO_POSITIVE_BUILDING_SHADOW_EVIDENCE_NOT_CONFIRMED_SUN',sourceIds:[],timeUTC,point,verifiedClassification:'UNKNOWN',verifiedProofEligible:false,unknownSafelyResolved:0};
  if((acquired.unresolvedIds??[]).length)value.reason='SOURCE_CONFLICT_REMAINS_UNKNOWN';
  else if(footprintContains(p,b.footprints))value.reason='INSIDE_BUILDING_NOT_WALKABILITY_EVIDENCE';
  else{
   const sun=solarPosition(time,point.lng,point.lat),sourceIds=[];let unsupported=0;
   for(const c of b.casters){try{if(inShadow(p,sweptPieces(c.polys,shadowVector(c.heightM,sun))))sourceIds.push(c.sourceId);}catch{unsupported++;}}
   if(sourceIds.length)value={...value,estimatedClassification:'ESTIMATED_BUILDING_SHADE',reason:'ML_OR_QUALIFIED_HEIGHT_ESTIMATED_MODEL_CONTRIBUTION_ONLY',sourceIds};
   if(unsupported&&!sourceIds.length)value.reason='UNSUPPORTED_SOLAR_OR_SHADOW_EXTENT';
  }
  value.partial=acquired.status!=='estimated-data-ready'||b.unresolved.length>0;value.modelAssumptions=['flat-local-ground','uniform-LOD1','unverified-roof-parts-and-datum','bounded-caster-acquisition'];if(cache.size<256)cache.set(key,structuredClone(value));return value;
 }};
}
export async function compareEstimatedRoutes(session,generated,departure,{speedMps=1.25,signal,deadline=performance.now()+12000,preparedManifestLocks=[]}={}){
 if(signal?.aborted)throw abort();if(!Number.isFinite(new Date(departure).getTime())||typeof departure==='string'&&!/(Z|[+-]\d\d:\d\d)$/.test(departure))throw Error('EXPLICIT_DEPARTURE_TIME_REQUIRED');
 const accepted=generated.candidates.filter(c=>c.routeAdmission.eligibleForIsolatedEstimate&&c.distanceM<=generated.detourLimitM+.01),rows=[],plans=accepted.map(c=>({candidate:c,...planRouteSamples(c,{speedMps})}));
 if(!plans.length)return {status:'INCOMPLETE',reason:'NO_SOURCE_ELIGIBLE_CANDIDATES',rows:[],Proof:'INCOMPLETE',winnerId:null};
 const all=accepted.flatMap(c=>c.points),bbox=routeBounds(all),scope=expandedBBox(bbox,session.haloM),acquired=await session.provider.queryBBox(scope,{signal});
 const bounded={...acquired,features:acquired.features.filter(f=>{const g=geometryBounds(f.geometry);return g&&g[0]<=scope[2]&&g[2]>=scope[0]&&g[1]<=scope[3]&&g[3]>=scope[1];})};
 const field=createEstimatedRouteField(bounded,[(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2]);let used=0,incomplete=false;
 for(const plan of plans){const entries=[];let shade=0,unknown=0,notSampled=0;
  for(const s of plan.samples){
   if(signal?.aborted)throw abort();if(used>=256||performance.now()>=deadline){incomplete=true;notSampled+=s.seconds;continue;}
   const at=new Date(new Date(departure).getTime()+s.arrivalOffsetS*1000),v=field.query(s.point,at);used++;
   if(v.estimatedClassification==='ESTIMATED_BUILDING_SHADE')shade+=s.seconds;else unknown+=s.seconds;
   entries.push({...s,atUTC:at.toISOString(),...v});if(used%8===0)await new Promise(r=>setTimeout(r,0));
  }
  unknown+=notSampled;const complete=notSampled===0;
  // Preserve the exact route duration in the partition; only roundoff is reconciled.
  shade=Math.min(plan.durationS,Math.max(0,shade));unknown=plan.durationS-shade;
  rows.push({candidateId:plan.candidate.id,distanceM:plan.distanceM,durationS:plan.durationS,points:plan.candidate.points,routeAdmission:plan.candidate.routeAdmission,estimatedBuildingShadeS:shade,unknownS:unknown,confirmedDirectSunS:0,
   sampledModelSunProxyRangeS:[0,unknown],sampleRangeIsContinuousBound:false,sampleRangeAssumption:'MIDPOINT_WEIGHTED_ONLY; ASSUME_PREDICTED_BUILDING_SHADE_TRUE; UNKNOWN_NOT_CONVERTED_TO_SUN; NOT_PHYSICAL_PROOF',
   verifiedDirectSunEnvelopeS:[0,plan.durationS],uncoveredModelProxyS:unknown,notSampledS:notSampled,samplingComplete:complete,classificationCounts:{estimatedShade:entries.filter(e=>e.estimatedClassification==='ESTIMATED_BUILDING_SHADE').length,unknown:entries.filter(e=>e.estimatedClassification==='UNKNOWN').length},samples:entries,
   physicalShadowAccuracy:'NOT_TESTED',verifiedProofEligible:false,unknownSafelyResolved:0});
 }
 const admitted=new Set(preparedManifestLocks.filter(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))),preparedLineageAdmitted=!!acquired.sourceRegions?.length&&acquired.sourceRegions.every(r=>admitted.has(r.manifestSHA256));
 const usableSource=preparedLineageAdmitted&&acquired.status==='estimated-data-ready'&&!(acquired.unresolvedIds??[]).length&&!field.base.unresolved.length&&field.base.casters.length>0;
 const fastest=[...rows].sort((a,b)=>a.durationS-b.durationS||a.candidateId.localeCompare(b.candidateId))[0],ranked=rows.filter(r=>r.samplingComplete).sort((a,b)=>a.uncoveredModelProxyS-b.uncoveredModelProxyS||a.durationS-b.durationS||a.candidateId.localeCompare(b.candidateId));
 return {status:incomplete?'INCOMPLETE':'ESTIMATED_SAMPLE_COMPLETE_NOT_PROOF',rows,fastestCandidateId:fastest.candidateId,estimatedLeastExposureSuggestionId:!incomplete&&usableSource&&rows.length>1?ranked[0]?.candidateId:null,
  comparisonState:incomplete?'SAMPLING_BUDGET_INCOMPLETE':rows.length<2?'INSUFFICIENT_DISTINCT_CANDIDATES':!usableSource?'SOURCE_PARTIAL_NO_RECOMMENDATION':'BOUNDED_ESTIMATED_PROXY_ONLY_NO_VERIFIED_WINNER',
  objective:'MIN_UNCOVERED_BUILDING_MODEL_PROXY_AMONG_BOUNDED_SOURCE_CANDIDATES_NOT_KNOWN_SUN',preparedLineageAdmitted,preparedLineageMeaning:'PREPARED_FILE_IDENTITY_ONLY_NOT_REAL_WORLD_INVENTORY_OR_CASTER_COMPLETENESS',dataStatus:acquired.status,dataReasons:acquired.reasons,unresolvedIds:acquired.unresolvedIds,sourceRegions:acquired.sourceRegions,modelSnapshotIdentity:field.snapshot,sourceCasterLedger:field.base.casters.map(c=>({sourceId:c.sourceId,heightM:c.heightM,heightClass:c.heightClass,provenance:c.provenance,verifiedProofEligible:false})),fieldStats:field.stats(),sampleBudget:256,samplesUsed:used,scope,bbox,
  routeSampling:'10m equal-length midpoint samples at exact traversal time; not continuous integration or exhaustive shade search',selectedDomainCoverageComplete:false,exhaustive:false,Proof:'INCOMPLETE',winnerId:null,selectedId:null,unknownSafelyResolved:0};
}
