// Geometry inspection is never route admission, navigation or winner evidence.
const copy=x=>structuredClone(x),same=(a,b)=>a?.lat===b?.lat&&a?.lng===b?.lng;
export function snapshotUnverifiedGeometry(api){
 const b=api?.lastCandidateBundle,s=api?._internals?.getEndpointNormalizationState?.(),i=api?._internals;
 if(!b||!s||s.busy)throw Error('WAIT_FOR_EXISTING_ROUTE_ANALYSIS');
 if(typeof i.candidateWalkabilityTier!=='function'||typeof i.candidateWithinDetour!=='function'||typeof i.normalizedCandidateEndpointsMatch!=='function')throw Error('ORIGINAL_SAFETY_API_REQUIRED');
 if(!(b.fastest?.distanceM>0)||!Number.isFinite(b.detourPct))throw Error('ORIGINAL_DETOUR_BASELINE_REQUIRED');
 const generated=api.lastCandidates,originalOnly=Array.isArray(generated)?generated:null,chosen=[],rejected=[];
 for(const c of b.eligibleScored??[]){
  // Prefer original generated display candidates; proof witnesses do not become
  // an unbounded inspection workload or a new candidate generator.
  if(originalOnly&&!originalOnly.some(g=>g.id===c.id&&JSON.stringify(g.points)===JSON.stringify(c.points)))continue;
  const reasons=[],m=c.graphMeta??{},w=c.walkability;
  if(i.candidateWalkabilityTier(c)!=='inferred-open-space'||w?.state!=='inferred-open-space'||m.requiresOnSitePathConfirmation!==true)reasons.push('NOT_ORIGINAL_TRUSTED_INFERRED_GEOMETRY');
  if(c.eligible===false||c.routeQuality?.valid===false||!i.candidateWithinDetour(c,b.fastest,b.detourPct))reasons.push('ORIGINAL_SAFETY_GATE_REJECTED');
  if([m.realmSyntheticDistanceM,w?.syntheticM].some(n=>n!==undefined&&(!Number.isFinite(Number(n))||Number(n)<0||Number(n)>.01)))reasons.push('UNRESOLVED_OR_INVALID_SYNTHETIC');
  if(m.conditionalAccess===true||m.usesConditionalPrivateAccess===true)reasons.push('CONDITIONAL_PRIVATE_ACCESS');
  if(!Array.isArray(c.points)||c.points.length<2||!same(c.points[0],s.a)||!same(c.points.at(-1),s.b)||!i.normalizedCandidateEndpointsMatch(c))reasons.push('ORIGINAL_ENDPOINT_OR_REFERENCE_MISMATCH');
  if(reasons.length){rejected.push({candidateId:c.id,reasons});continue;}
  if(chosen.length<2)chosen.push(c);
 }
 if(!chosen.length)throw Error('NO_UNVERIFIED_GEOMETRY_FOR_INSPECTION');
 const departure=chosen[0].analysis?.departure,speedMps=chosen[0].analysis?.walkingSpeedMps;
 if(!Number.isFinite(new Date(departure).getTime())||!/(Z|[+-]\d\d:\d\d)$/.test(departure)||!Number.isFinite(speedMps)||speedMps<.5||speedMps>2.5||chosen.some(c=>c.analysis?.departure!==departure||c.analysis?.walkingSpeedMps!==speedMps))throw Error('EXACT_ORIGINAL_ARRIVAL_CONDITIONS_REQUIRED');
 return {mode:'UNVERIFIED_EXISTING_GEOMETRY_ONLY',departure,speedMps,endpointReferences:copy(s.references??{}),referenceIncludedInMetrics:false,
  navigationAllowed:false,routeComparisonAllowed:false,verifiedRouteEligibilityChanged:false,selectionScope:'FIRST_TWO_ORIGINAL_DISPLAY_CANDIDATES_NOT_NEW_SEARCH_OR_RANKING',rejected,
  input:{candidates:chosen.map(c=>({id:c.id,points:copy(c.points),distanceM:c.distanceM,
   routeAdmission:{eligibleForIsolatedEstimate:false,sourceOnly:false,blockers:['WALKABILITY_UNVERIFIED'],rawBaselineWalkability:copy(c.walkability),terminalPolicyUnchanged:true,verifiedRouteEligibilityChanged:false},
   inspectionAdmission:{purpose:'GEOMETRY_EXPOSURE_ONLY',originalEligible:true,originalWalkabilityTier:'inferred-open-space',requiresOnSitePathConfirmation:true,
    unresolvedSyntheticM:Number(c.graphMeta?.realmSyntheticDistanceM??c.walkability?.syntheticM??0),conditionalAccess:false,geometryUnmodified:true,
    navigationAllowed:false,routeComparisonAllowed:false,endpointReferenceExcluded:true},geometryToken:JSON.stringify(c.points)}))}};
}
export function validateInspectionInput(snapshot){
 if(snapshot?.mode!=='UNVERIFIED_EXISTING_GEOMETRY_ONLY'||snapshot.navigationAllowed!==false||snapshot.routeComparisonAllowed!==false||snapshot.referenceIncludedInMetrics!==false||snapshot.verifiedRouteEligibilityChanged!==false)throw Error('INSPECTION_ISOLATION_REQUIRED');
 const cs=snapshot.input?.candidates;if(!Array.isArray(cs)||cs.length<1||cs.length>2)throw Error('INSPECTION_CANDIDATE_LIMIT');
 for(const c of cs){const a=c.inspectionAdmission,r=c.routeAdmission;
  if(!a||a.purpose!=='GEOMETRY_EXPOSURE_ONLY'||a.originalEligible!==true||a.originalWalkabilityTier!=='inferred-open-space'||a.requiresOnSitePathConfirmation!==true||a.unresolvedSyntheticM<0||a.unresolvedSyntheticM>.01||!Number.isFinite(a.unresolvedSyntheticM)||a.conditionalAccess!==false||a.geometryUnmodified!==true||a.navigationAllowed!==false||a.routeComparisonAllowed!==false||a.endpointReferenceExcluded!==true)throw Error('INSPECTION_LINEAGE_REJECTED');
  if(r?.eligibleForIsolatedEstimate!==false||r.sourceOnly!==false||r.rawBaselineWalkability?.state!=='inferred-open-space'||r.terminalPolicyUnchanged!==true||r.verifiedRouteEligibilityChanged!==false)throw Error('INSPECTION_MUST_NOT_ADMIT_ROUTE');
  if(!Array.isArray(c.points)||c.points.length<2||c.points.length>20000||c.points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>85||Math.abs(p.lng)>180)||JSON.stringify(c.points)!==c.geometryToken)throw Error('INSPECTION_GEOMETRY_CHANGED');
 }
 return true;
}
export function inspectionFromSamples(comparison,snapshot){
 validateInspectionInput(snapshot);
 if(comparison?.Proof!=='INCOMPLETE'||comparison.winnerId!==null||comparison.selectedId!==null||comparison.unknownSafelyResolved!==0||comparison.rows?.length!==snapshot.input.candidates.length)throw Error('INSPECTION_PROOF_ISOLATION_GATE');
 for(let index=0;index<comparison.rows.length;index++){
  const row=comparison.rows[index],source=snapshot.input.candidates[index];
  if(row.candidateId!==source.id||JSON.stringify(row.points)!==source.geometryToken||row.verifiedProofEligible!==false||row.confirmedDirectSunS!==0||!Array.isArray(row.samples)||row.samples.some(s=>s.verifiedClassification!=='UNKNOWN'||s.unknownSafelyResolved!==0||new Date(s.atUTC).getTime()!==new Date(new Date(snapshot.departure).getTime()+s.arrivalOffsetS*1000).getTime()))throw Error('INSPECTION_SAMPLES_NOT_BOUND_TO_INPUT');
 }
 const {fastestCandidateId:omitFastest,estimatedLeastExposureSuggestionId:omitSuggestion,comparisonState:omitState,objective:omitObjective,...sampled}=comparison;
 return {...sampled,schema:'astra-unverified-geometry-inspection-v1',mode:'UNVERIFIED_EXISTING_GEOMETRY_ONLY',
  status:comparison.status==='ESTIMATED_SAMPLE_COMPLETE_NOT_PROOF'&&comparison.preparedLineageAdmitted&&comparison.dataStatus==='estimated-data-ready'&&comparison.canopyStatus==='ready'?'UNVERIFIED_GEOMETRY_SAMPLES_READY':'PARTIAL_UNVERIFIED_GEOMETRY',
  navigationAllowed:false,routeComparisonAllowed:false,walkability:'UNVERIFIED_RETAINS_ORIGINAL_INFERRED_CLASS',
  fastestCandidateId:null,estimatedLeastExposureSuggestionId:null,objective:'DISPLAY_CONDITIONAL_MODEL_SAMPLES_ALONG_EXISTING_GEOMETRY_ONLY',
  endpointReferences:copy(snapshot.endpointReferences),referenceIncludedInMetrics:false,
  rows:sampled.rows.map(r=>({...r,navigationAllowed:false,routeComparisonAllowed:false,walkabilityVerified:false,requiresOnSitePathConfirmation:true,originalWalkability:copy(r.routeAdmission.rawBaselineWalkability)}))};
}
export function checkSourceComparisonInput(input){
 if(!Array.isArray(input?.candidates)||input.candidates.length<1||input.candidates.length>2)throw Error('SOURCE_COMPARISON_CANDIDATE_LIMIT');
 for(const c of input.candidates){const r=c.routeAdmission;
  if(r?.eligibleForIsolatedEstimate!==true||r.sourceOnly!==true||!Array.isArray(r.blockers)||r.blockers.length||r.rawBaselineWalkability?.state!=='source-supported'||r.terminalPolicyUnchanged!==true||r.verifiedRouteEligibilityChanged!==false||c.inspectionAdmission)throw Error('SOURCE_ROUTE_ADMISSION_REQUIRED');
 }
 return true;
}
