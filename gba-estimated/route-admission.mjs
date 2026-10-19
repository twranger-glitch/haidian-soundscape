// Diagnostic mirror of the pinned route-bridge.mjs admission checks.
// Never changes the bundle, candidate, geometry, source tier or native policy.
export function auditAdmissions(api){
  const bundle=api?.lastCandidateBundle,state=api?._internals?.getEndpointNormalizationState?.();
  if(!bundle||!state||state.busy)throw Error('WAIT_FOR_EXISTING_ROUTE_ANALYSIS');
  if(!Number.isFinite(bundle.fastest?.distanceM)||bundle.fastest.distanceM<=0||!Number.isFinite(bundle.detourPct)||bundle.detourPct<0)throw Error('ORIGINAL_DETOUR_BASELINE_REQUIRED');
  const original=api._internals;
  if(typeof original.candidateWithinDetour!=='function'||typeof original.candidateWalkabilityTier!=='function')throw Error('ROUTE_SAFETY_API_UNAVAILABLE');
  const rows=[];
  for(const c of bundle.eligibleScored??[]){
    const reasons=[];
    const tier=original.candidateWalkabilityTier(c);
    const withinDetour=original.candidateWithinDetour(c,bundle.fastest,bundle.detourPct);
    if(tier!=='source-supported'||c.walkability?.state!=='source-supported')reasons.push('NOT_EXPLICIT_SOURCE_SUPPORTED');
    if(c.eligible===false||c.routeQuality?.valid===false)reasons.push('EXISTING_ELIGIBILITY_REJECTED');
    if(!withinDetour)reasons.push('EXISTING_DETOUR_REJECTED');
    if(c.graphMeta?.requiresOnSitePathConfirmation===true||[c.graphMeta?.realmSyntheticDistanceM,c.walkability?.syntheticM].some(n=>Number(n??0)>.01))reasons.push('UNPROVED_SURFACE');
    if([c.graphMeta?.realmSyntheticDistanceM,c.walkability?.syntheticM].some(n=>n!==undefined&&(!Number.isFinite(Number(n))||Number(n)<0)))reasons.push('INVALID_PROVENANCE_ACCOUNTING');
    if(c.graphMeta?.conditionalAccess===true||c.graphMeta?.usesConditionalPrivateAccess===true)reasons.push('CONDITIONAL_ACCESS');
    const points=c.points;
    if(!Array.isArray(points)||points.length<2)reasons.push('GEOMETRY_MISSING');
    if(points?.length&&(points[0].lat!==state.a?.lat||points[0].lng!==state.a?.lng||points.at(-1).lat!==state.b?.lat||points.at(-1).lng!==state.b?.lng))reasons.push('ROUTING_ENDPOINT_MISMATCH');
    rows.push({candidateId:c.id,kind:c.kind??null,distanceM:c.distanceM,originalEligible:c.eligible!==false,
      nativeWalkabilityTier:tier,declaredWalkabilityState:c.walkability?.state??null,
      requiresOnSitePathConfirmation:c.graphMeta?.requiresOnSitePathConfirmation===true,
      inferredOpenSpaceM:c.walkability?.inferredOpenSpaceM??c.graphMeta?.realmInferredOpenSpaceDistanceM??null,
      unresolvedSyntheticM:c.walkability?.syntheticM??c.graphMeta?.realmSyntheticDistanceM??null,
      withinOriginalDetour:withinDetour,endpointMatches:!reasons.includes('ROUTING_ENDPOINT_MISMATCH'),
      estimatedAdmission:reasons.length?'BLOCKED':'ADMITTED_BY_EXISTING_GATE',reasons});
  }
  const acceptedIds=rows.filter(x=>!x.reasons.length).map(x=>x.candidateId),reasonCounts={};
  for(const row of rows)for(const reason of row.reasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;
  return {schema:'astra-existing-candidate-admission-ledger-v1',status:acceptedIds.length?'SOURCE_SAFE_ADMISSION_AVAILABLE':'NO_SOURCE_SAFE_ADMISSION',
    evaluatedCount:rows.length,acceptedCount:acceptedIds.length,blockedCount:rows.length-acceptedIds.length,acceptedIds,reasonCounts,rows,
    sourceGateUnchanged:true,originalBundleMutated:false,originalComparatorMutated:false,
    terminalConsentIsSurfaceEvidence:false,estimatedAdmissionIsPhysicalAccuracyEvidence:false};
}
