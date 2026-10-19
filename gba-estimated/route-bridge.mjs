// Reads existing accepted candidates; never replaces endpoints, graph or comparator.
export function snapshotAcceptedRoutes(api){
 const bundle=api?.lastCandidateBundle,state=api?._internals?.getEndpointNormalizationState?.();if(!bundle||!state||state.busy)throw Error('WAIT_FOR_EXISTING_ROUTE_ANALYSIS');
 if(!Number.isFinite(bundle.fastest?.distanceM)||bundle.fastest.distanceM<=0||!Number.isFinite(bundle.detourPct)||bundle.detourPct<0)throw Error('ORIGINAL_DETOUR_BASELINE_REQUIRED');
 const original=api._internals;if(typeof original.candidateWithinDetour!=='function'||typeof original.candidateWalkabilityTier!=='function')throw Error('ROUTE_SAFETY_API_UNAVAILABLE');
 const rejected=[],accepted=[];for(const c of bundle.eligibleScored??[]){const reasons=[];
  if(original.candidateWalkabilityTier(c)!=='source-supported'||c.walkability?.state!=='source-supported')reasons.push('NOT_EXPLICIT_SOURCE_SUPPORTED');
  if(c.eligible===false||c.routeQuality?.valid===false)reasons.push('EXISTING_ELIGIBILITY_REJECTED');
  if(!original.candidateWithinDetour(c,bundle.fastest,bundle.detourPct))reasons.push('EXISTING_DETOUR_REJECTED');
  if(c.graphMeta?.requiresOnSitePathConfirmation===true||[c.graphMeta?.realmSyntheticDistanceM,c.walkability?.syntheticM].some(n=>Number(n??0)>.01))reasons.push('UNPROVED_SURFACE');
  if([c.graphMeta?.realmSyntheticDistanceM,c.walkability?.syntheticM].some(n=>n!==undefined&&(!Number.isFinite(Number(n))||Number(n)<0)))reasons.push('INVALID_PROVENANCE_ACCOUNTING');
  if(c.graphMeta?.conditionalAccess===true||c.graphMeta?.usesConditionalPrivateAccess===true)reasons.push('CONDITIONAL_ACCESS');
  const points=c.points;if(!Array.isArray(points)||points.length<2)reasons.push('GEOMETRY_MISSING');
  if(points?.length&&(points[0].lat!==state.a?.lat||points[0].lng!==state.a?.lng||points.at(-1).lat!==state.b?.lat||points.at(-1).lng!==state.b?.lng))reasons.push('ROUTING_ENDPOINT_MISMATCH');
  if(reasons.length){rejected.push({candidateId:c.id,reasons});continue;}accepted.push(c);
 }
 const ordered=[...accepted].sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id));if(!ordered.length)throw Error('NO_EXISTING_SOURCE_SAFE_CANDIDATES');
 const preferred=[bundle.selected,bundle.provisionalSelected,bundle.candidateSetSelected].find(c=>c&&accepted.includes(c)&&c!==ordered[0]);
 const chosen=[ordered[0],preferred??ordered[1]].filter(Boolean);
 const departure=chosen[0].analysis?.departure,speedMps=chosen[0].analysis?.walkingSpeedMps;if(!Number.isFinite(new Date(departure).getTime())||!Number.isFinite(speedMps)||speedMps<.5||speedMps>2.5||chosen.some(c=>c.analysis?.departure!==departure||c.analysis?.walkingSpeedMps!==speedMps))throw Error('EXACT_ROUTE_TIME_OR_SPEED_MISSING');
 return {departure,speedMps,input:{candidates:chosen.map(c=>({id:c.id,points:structuredClone(c.points),distanceM:c.distanceM,routeAdmission:{eligibleForIsolatedEstimate:true,blockers:[],sourceOnly:true,rawBaselineWalkability:structuredClone(c.walkability),terminalPolicyUnchanged:true,verifiedRouteEligibilityChanged:false}}))},endpointReferences:structuredClone(state.references??{}),referenceIncludedInMetrics:false,rejected,sourceCandidateCount:accepted.length,comparedCount:chosen.length,selectionScope:'BOUNDED_TWO_EXISTING_SOURCE_SUPPORTED_ROUTES_NOT_GLOBAL',verifiedComparisonUnmodified:true};
}
