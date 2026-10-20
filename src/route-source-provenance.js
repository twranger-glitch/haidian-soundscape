/* Read-only full-geometry evidence handoff. No search, connector, shade or winner. */
(function (root) {
  'use strict';
  const VERSION='mapped-source-handoff-20261020.2', EPS=1e-6;
  const limits=Object.freeze({witnesses:6,vertices:20000,sourceElements:60000,sourceSegments:20000,states:64,candidates:64,comparisons:120000});
  const norm=v=>String(v??'').trim().toLowerCase(), valid=p=>p&&typeof p.lat==='number'&&typeof p.lng==='number'&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
  const distance=(a,b)=>{const r=Math.PI/180,s=Math.sin((b.lat-a.lat)*r/2),t=Math.sin((b.lng-a.lng)*r/2),h=s*s+Math.cos(a.lat*r)*Math.cos(b.lat*r)*t*t;return 6371008.8*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));};
  const length=ps=>ps.slice(1).reduce((n,p,i)=>n+distance(ps[i],p),0);
  const close=(a,b)=>valid(a)&&valid(b)&&distance(a,b)<=EPS;
  function axis(a,b,p){const k=Math.cos(a.lat*Math.PI/180),bx=(b.lng-a.lng)*k,by=b.lat-a.lat,px=(p.lng-a.lng)*k,py=p.lat-a.lat,d=bx*bx+by*by,t=d?(px*bx+py*by)/d:0;return{t,offset:Math.abs(px*by-py*bx)/Math.sqrt(d||1)*111194.92664455873};}
  function canonical(points){
    if(!Array.isArray(points)||points.length<2||points.length>limits.vertices||points.some(p=>!valid(p)))return null;
    const out=[];
    for(const p of points){if(out.length&&close(out.at(-1),p))continue;while(out.length>1){const a=out.at(-2),b=out.at(-1),h=axis(a,p,b);if(h.offset<=EPS&&h.t>=0&&h.t<=1)out.pop();else break;}out.push({lat:p.lat,lng:p.lng});}
    return out.length>=2?out:null;
  }
  function sameGeometry(a,b){const x=canonical(a),y=canonical(b);return !!x&&!!y&&x.length===y.length&&x.every((p,i)=>close(p,y[i]))&&Math.abs(length(a)-length(b))<=EPS;}
  const blockedTags=t=>['no','private','customers','permit','delivery','destination'].some(v=>norm(t?.access)===v||norm(t?.foot)===v)||Object.keys(t||{}).some(k=>/^(foot|access)(:forward|:backward)?:conditional$/.test(k)&&String(t[k]).trim())||['bridge','tunnel'].some(k=>t?.[k]!=null&&!['','no','0','false'].includes(norm(t[k])))||['level','layer'].some(k=>t?.[k]!=null&&norm(t[k])!==''&&Number(t[k])!==0);
  const blockedNode=t=>blockedTags(t)||t?.barrier!=null&&!['','no','none','0','false'].includes(norm(t.barrier));
  function routeSafe(c){
    const m=c?.graphMeta||{},w=c?.walkability||{};
    if(c?.eligible===false||c?.routeQuality?.valid===false||m.requiresOnSitePathConfirmation===true||m.conditionalAccess===true||m.usesConditionalPrivateAccess===true||m.requiresJunctionGeometryConfirmation===true||m.realmWalkabilityClass&&m.realmWalkabilityClass!=='source-supported')return false;
    for(const v of [m.realmSyntheticDistanceM,m.realmPortalDistanceM,m.realmInferredOpenSpaceDistanceM,m.sourceTopologyJoinDistanceM,m.privateAccessDistanceM,m.realmProvenance?.syntheticM,m.realmProvenance?.terminalConnectorM,m.realmProvenance?.inferredOpenSpaceM,w.syntheticM,w.inferredOpenSpaceM])if(v!=null&&(typeof v!=='number'||!Number.isFinite(v)||v>EPS||v<0))return false;
    return true;
  }
  function sourceSegments(w,source,core){
    const stats=w?.graphMeta?.realmProvenance,rows=stats?.segments;
    if(w?.walkability?.state!=='source-supported'||!routeSafe(w)||!Array.isArray(rows)||!rows.length||rows.length>1024)throw Error('SOURCE_WITNESS_NOT_PROVED');
    for(const n of ['aM','bM'])if(typeof w.walkability.endpointGaps?.[n]!=='number'||!Number.isFinite(w.walkability.endpointGaps[n])||w.walkability.endpointGaps[n]>EPS||w.walkability.endpointGaps[n]<0)throw Error('UNVERIFIED_ENDPOINT_GAP');
    for(const n of ['syntheticM','terminalConnectorM','portalM'])if(typeof stats[n]!=='number'||stats[n]!==0)throw Error('SOURCE_WITNESS_CONNECTOR_OR_SYNTHETIC');
    if(![w.distanceM,stats.totalM,stats.mappedPathM].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||Math.abs(stats.totalM-w.distanceM)>EPS||Math.abs(stats.mappedPathM-w.distanceM)>EPS||Math.abs(length(w.points)-w.distanceM)>EPS)throw Error('SOURCE_WITNESS_DISTANCE_MISMATCH');
    const ids=new Set();for(const r of rows){if(r.provenance!=='mapped-path'||r.realmTerminalConnector||r.realmPortalConnector||!Array.isArray(r.sourceWayIds)||!r.sourceWayIds.length||!canonical(r.geometry))throw Error('SOURCE_SEGMENT_EVIDENCE_INCOMPLETE');for(const id of r.sourceWayIds)ids.add(String(id));}
    const nodes=new Map(),ways=new Map(),identities=new Set();for(const e of source.payload.elements){const key=e.type+':'+e.id;if(identities.has(key))throw Error('AMBIGUOUS_SOURCE_IDENTITY');identities.add(key);if(e.type==='node')nodes.set(String(e.id),e);if(e.type==='way')ways.set(String(e.id),e);}
    const segs=[];
    for(const id of [...ids].sort()){
      const way=ways.get(id),t=way?.tags;if(!way||!Array.isArray(way.nodes)||way.nodes.length<2||!t||t.area==='yes'||t['area:highway']||blockedTags(t)||!core.isPedestrianWay(t,{allowPrivateFootAccess:false}))throw Error('SOURCE_WAY_ACCESS_OR_GEOMETRY_UNPROVED');
      if(t['oneway:foot']!=null&&!['','no','0','false','yes','1','true','-1','reverse'].includes(norm(t['oneway:foot'])))throw Error('UNSUPPORTED_SOURCE_WALKING_DIRECTION');
      let mask=['yes','1','true'].includes(norm(t['oneway:foot']))?1:['-1','reverse'].includes(norm(t['oneway:foot']))?2:3;
      if(['no','private','customers','permit','delivery','destination'].includes(norm(t['foot:forward'])))mask&=2;if(['no','private','customers','permit','delivery','destination'].includes(norm(t['foot:backward'])))mask&=1;
      for(let i=1;i<way.nodes.length;i++){
        const u=nodes.get(String(way.nodes[i-1])),v=nodes.get(String(way.nodes[i]));
        if(!u||!v)throw Error('INCOMPLETE_SOURCE_NODE_GEOMETRY');const a={lat:u.lat,lng:u.lon},b={lat:v.lat,lng:v.lon};if(!valid(a)||!valid(b))throw Error('INVALID_SOURCE_NODE_COORDINATES');
        if(blockedNode(u.tags)||blockedNode(v.tags))continue;
        if(distance(a,b)<=EPS)continue;
        const base={wayId:id,ordinal:i-1,wayVersion:way.version??null,wayTimestamp:way.timestamp??null,tags:{...t}};
        if(mask&1)segs.push({...base,id:id+':'+i+':f',from:String(u.id),to:String(v.id),a,b});
        if(mask&2)segs.push({...base,id:id+':'+i+':r',from:String(v.id),to:String(u.id),a:b,b:a});
        if(segs.length>limits.sourceSegments)throw Error('SOURCE_PROOF_WORK_LIMIT');
      }
    }return segs;
  }
  function traceLeg(a,b,segs,previous,tick){
    const epsT=EPS/Math.max(distance(a,b),EPS),aligned=[];
    for(const s of segs){tick();const lo=axis(a,b,s.a),hi=axis(a,b,s.b);if(lo.offset<=EPS&&hi.offset<=EPS&&hi.t>lo.t&&hi.t>epsT&&lo.t<1-epsT)aligned.push({...s,lo:lo.t,hi:hi.t});}
    const byFrom=new Map();for(const s of aligned){if(!byFrom.has(s.from))byFrom.set(s.from,[]);byFrom.get(s.from).push(s);}
    const output=new Map(),queue=[],seen=new Set();
    for(const s of aligned)if(s.lo<=epsT&&s.hi>epsT){
      const parents=previous?previous.filter(p=>p.last.id===s.id||p.last.to===s.from&&close(p.last.b,a)&&close(s.a,a)):[{trace:[]}];
      for(const p of parents)queue.push({s,trace:p.trace.concat(s),base:p});
    }
    for(let i=0;i<queue.length;i++){
      const x=queue[i],s=x.s;if(seen.has(s.id))continue;seen.add(s.id);
      if(s.hi>=1-epsT){output.set(s.id,{last:s,trace:x.trace});if(output.size>limits.states)throw Error('SOURCE_MATCH_AMBIGUITY_LIMIT');continue;}
      for(const n of byFrom.get(s.to)||[])if(Math.abs(n.lo-s.hi)<=epsT&&n.hi>s.hi+epsT)queue.push({s:n,trace:x.trace.concat(n)});
      if(queue.length>limits.sourceSegments*2)throw Error('SOURCE_PROOF_WORK_LIMIT');
    }return [...output.values()];
  }
  function traceRoute(points,segs,tick=()=>{}){let states=null;for(let i=1;i<points.length;i++){if(close(points[i-1],points[i]))continue;states=traceLeg(points[i-1],points[i],segs,states,tick);if(!states.length)throw Error('NO_CONTINUOUS_DIRECTED_SOURCE_COVERAGE');}if(!states?.length)throw Error('NO_CONTINUOUS_DIRECTED_SOURCE_COVERAGE');return states[0].trace.filter((s,i,a)=>!i||s.id!==a[i-1].id);}
  const cross=(a,b,c)=>(b.lng-a.lng)*(c.lat-a.lat)-(b.lat-a.lat)*(c.lng-a.lng);
  function cuts(a,b,c,d){const dx=b.lng-a.lng,dy=b.lat-a.lat,ex=d.lng-c.lng,ey=d.lat-c.lat,den=dx*ey-dy*ex;if(Math.abs(den)<1e-25)return[];const t=((c.lng-a.lng)*ey-(c.lat-a.lat)*ex)/den,u=((c.lng-a.lng)*dy-(c.lat-a.lat)*dx)/den;return t>=0&&t<=1&&u>=0&&u<=1?[t]:[];}
  function inside(p,ring,tick=()=>{}){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){tick();const a=ring[i],b=ring[j];if((a.lat>p.lat)!==(b.lat>p.lat)&&p.lng<(b.lng-a.lng)*(p.lat-a.lat)/(b.lat-a.lat)+a.lng)yes=!yes;}return yes;}
  function touches(a,b,c,d){if(cuts(a,b,c,d).length)return true;const u=axis(a,b,c),v=axis(a,b,d);return u.offset<=EPS&&v.offset<=EPS&&Math.min(u.t,v.t)<=1&&Math.max(u.t,v.t)>=0;}
  function checkHazards(points,realm,tick=()=>{}){
    const counts=realm?.sourceDiagnostics;if(!counts||counts.incompleteObstacleCount||counts.incompleteBarrierCount||counts.relationMissingMemberWays||counts.relationUnclosedRings)throw Error('INCOMPLETE_SOURCE_SAFETY_GEOMETRY');
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];
      for(const o of realm.obstacles||[]){tick();const rings=[o.polygon,...(o.holes||[])];if(!rings[0]?.length)throw Error('INCOMPLETE_SOURCE_SAFETY_GEOMETRY');const ts=[0,1];for(const ring of rings)for(let j=1;j<ring.length;j++){tick();ts.push(...cuts(a,b,ring[j-1],ring[j]));}ts.sort((x,y)=>x-y);for(let j=1;j<ts.length;j++){const t=(ts[j-1]+ts[j])/2,p={lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t};if(inside(p,rings[0],tick)&&!rings.slice(1).some(r=>inside(p,r,tick)))throw Error('KNOWN_BUILDING_OR_WATER_CONFLICT');}}
      for(const wall of realm.barriers||[]){tick();if(wall.geometry?.length===1){const h=axis(a,b,wall.geometry[0]);if(h.offset<=EPS&&h.t>=0&&h.t<=1)throw Error('KNOWN_BARRIER_CONFLICT');}for(let j=1;j<(wall.geometry||[]).length;j++){tick();if(touches(a,b,wall.geometry[j-1],wall.geometry[j]))throw Error('KNOWN_BARRIER_CONFLICT');}}
    }
  }
  // Hash current bytes on every analysis. Object identity alone is not a snapshot lock.
  async function frameHash(payload){const text=JSON.stringify(payload),bytes=new TextEncoder().encode(text);if(bytes.length>8*1024*1024)throw Error('SOURCE_PROOF_WORK_LIMIT');const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');return {sha256,payload:JSON.parse(text)};}
  async function transfer({candidates,mapped,source,a,b,shouldCancel=()=>false,core=root.HaidianPedestrianGraph?._internals}={}){
    const input=candidates||[],diagnostics={version:VERSION,transferred:0,rejected:[],witnesses:[],sourceQueriesAdded:0,shadeQueriesAdded:0,graphMutated:false,geometryChanged:false,eligibilityPolicyChanged:false};
    const finish=cs=>({candidates:cs,diagnostics});const cancel=()=>{if(shouldCancel())throw Error('ROUTE_ANALYSIS_CANCELLED');};cancel();
    if(!Array.isArray(input)||input.length>limits.candidates)return finish(input);
    const all=mapped?.candidates||[];
    if(!source?.available||source?.acquisition?.coverage!=='complete-requested-bbox'||source?.payload?.remark||!source?.relationCompletion||source?.relationCompletion?.skipped>0||source?.relationCompletion?.errors?.length||!Array.isArray(source?.payload?.elements)||source.payload.elements.length>limits.sourceElements||!mapped?.available||all.length>limits.witnesses||!core?.isPedestrianWay||!core?.parsePedestrianRealm){diagnostics.reason='SOURCE_FRAME_OR_MAPPED_WITNESS_UNAVAILABLE';return finish(input);}
    const bounds=source.acquisition.bbox,validBounds=bounds&&['south','north','west','east'].every(k=>Number.isFinite(bounds[k]))&&bounds.south<bounds.north&&bounds.west<bounds.east;
    if(!validBounds){diagnostics.reason='SOURCE_COVERAGE_BOUNDS_MISSING';return finish(input);}
    let hash,realm;try{const locked=await frameHash(source.payload);hash=locked.sha256;source={...source,payload:locked.payload};cancel();realm=core.parsePedestrianRealm(source.payload);}catch(e){if(e.message==='ROUTE_ANALYSIS_CANCELLED')throw e;diagnostics.reason=e.message;return finish(input);}
    diagnostics.parsedPayloadSHA256=hash;diagnostics.comparisons=0;const tick=()=>{cancel();if(++diagnostics.comparisons>limits.comparisons)throw Error('SOURCE_PROOF_WORK_LIMIT');};const witnesses=[];
    for(const w of all){cancel();try{
      if(!canonical(w.points)||!close(w.points[0],a)||!close(w.points.at(-1),b)||w.points.some(p=>p.lat<bounds.south||p.lat>bounds.north||p.lng<bounds.west||p.lng>bounds.east))throw Error('WITNESS_ENDPOINT_OR_SOURCE_BOUNDS_MISMATCH');
      const segs=sourceSegments(w,source,core),trace=traceRoute(w.points,segs,tick);checkHazards(w.points,realm,tick);
      const proof={schema:'astra-full-directed-mapped-source-v1',parsedPayloadSHA256:hash,hashMeaning:'JSON.stringify parsed payload, not original HTTP byte hash',sourceType:'OSM_WAY_GEOMETRY',sourceCandidateId:w.id,fullGeometryCoverage:true,directionPreserved:true,sourceNodeContinuity:true,endpointGapM:0,excludedReferenceIncluded:false,numericalCoincidenceM:EPS,sourceConfidence:'SOURCE_TAGS_NOT_FIELD_SURVEY',distanceM:w.distanceM,
        trace:trace.map(s=>({wayId:s.wayId,wayVersion:s.wayVersion,wayTimestamp:s.wayTimestamp,fromNodeId:s.from,toNodeId:s.to,sourceSegmentOrdinal:s.ordinal,geometry:[{...s.a},{...s.b}],tags:{...s.tags}})),verifiedProofEligible:false};
      witnesses.push({w,proof});diagnostics.witnesses.push({id:w.id,status:'PROVED',sourceSegments:proof.trace.length});
    }catch(e){if(e.message==='ROUTE_ANALYSIS_CANCELLED'||e.message==='SOURCE_PROOF_WORK_LIMIT')throw e;diagnostics.witnesses.push({id:w.id,status:'BLOCKED',reason:e.message});}}
    return finish(input.map(c=>{cancel();if(c?.walkability!=null||!['graph-fastest','graph-shade'].includes(c?.kind))return c;
      if(!routeSafe(c)||!canonical(c.points)||!close(c.points[0],a)||!close(c.points.at(-1),b)){diagnostics.rejected.push({id:c?.id,reason:'EXISTING_ROUTE_SAFETY_OR_ENDPOINT_UNPROVED'});return c;}
      const row=witnesses.find(({w})=>Math.abs(c.distanceM-w.distanceM)<=EPS&&sameGeometry(c.points,w.points));
      if(!row){diagnostics.rejected.push({id:c.id,reason:'NO_IDENTICAL_FULL_DIRECTED_SOURCE_WITNESS'});return c;}
      diagnostics.transferred++;return {...c,walkability:{state:'source-supported',reason:'full identical directed mapped source geometry',syntheticM:0,endpointGaps:{aM:0,bM:0},geometrySource:'OSM ways',scope:'mapped source access/continuity; not field survey'},graphMeta:{...c.graphMeta,sourceWalkHandoff:structuredClone(row.proof)}};
    }));
  }
  root.ASTRARouteSourceProvenance=Object.freeze({version:VERSION,transfer,_internals:Object.freeze({canonical,sameGeometry,sourceSegments,traceRoute,checkHazards,limits,EPS})});
})(typeof window!=='undefined'?window:globalThis);
