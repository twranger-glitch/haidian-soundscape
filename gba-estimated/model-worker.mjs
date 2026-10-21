import {IsolatedEstimatedSession} from './taiwan/isolated-session.mjs';
import {createLocalFetcher} from './local-data.mjs';
import {connectRemotePrepared} from './remote-data.mjs';
import {CoalescedCanopyProvider as CanopyProvider} from './canopy/coalesced-provider.mjs?v=20261020.5';import {loadDecoder} from './canopy/decoder.mjs';import {serialFrame} from './canopy/render.mjs';
import {expandedBBox} from './engine/geometry.mjs';import {routeBounds} from './routing/estimated-route.mjs';
import {compareCanopyRoutes,checkCanopyComparison} from './routing/connected-estimated-route.mjs';
import {validateInspectionInput,inspectionFromSamples,checkSourceComparisonInput} from './geometry-inspection.mjs';
let session,canopy,registry,local,active;
self.onmessage=async({data:m})=>{
 if(m.op==='cancel'){active?.abort();session?.cancel();return;}
 const controller=new AbortController();active?.abort();active=controller;const signal=controller.signal;
 try{let result;
  if(m.op==='connect'){registry=m.registry;session=null;canopy=null;local=m.transport==='authenticated-same-origin'?await connectRemotePrepared(registry,m.sourceLock,{origin:location.origin,signal}):createLocalFetcher(m.handles,registry,{origin:location.origin});session=new IsolatedEstimatedSession(registry,m.conflicts,{origin:location.origin,fetcher:local.fetcher,haloM:150});canopy=new CanopyProvider({decoder:loadDecoder,fetcher:local.fetcher});result={connected:true,mode:m.transport==='authenticated-same-origin'?'AUTHENTICATED_SAME_ORIGIN_READ_ONLY':'READ_ONLY_LOCAL_PREPARED_PUBLIC_CHMV2',writes:0,hfTransfers:0};}
  else if(!session)throw Error('PREPARED_NOT_CONNECTED');
  else if(m.op==='warm'){const scope=expandedBBox(m.bbox??routeBounds(m.input.candidates.flatMap(c=>c.points)),150),frame=await canopy.acquire(scope,{signal,deadline:performance.now()+8000});result={status:frame.status,loadedTiles:frame.tiles.size,errors:frame.errors,dataOnly:true,routeSamplesEvaluated:0};}
  else if(m.op==='scene'){const scope=expandedBBox(m.bbox,150),[scene,frame]=await Promise.all([session.load(m.bbox,m.departure,{signal}),canopy.acquire(scope,{signal,deadline:performance.now()+8000})]);const {projection,...s}=scene;result={scene:s,canopyScene:serialFrame(frame),diagnostics:session.diagnostics(),canopyDiagnostics:canopy.stats(),localReads:local.stats};}
  else if(m.op==='compare'){checkSourceComparisonInput(m.input);const {comparison,frame}=await compareCanopyRoutes(session,m.input,m.departure,{canopy,signal,preparedManifestLocks:registry.regions.map(r=>r.manifestSHA256),deadline:performance.now()+12000,speedMps:m.speedMps});checkCanopyComparison(comparison);result={comparison,canopySnapshotIdentity:frame.identity,diagnostics:session.diagnostics(),canopyDiagnostics:canopy.stats(),localReads:local.stats};}
  else if(m.op==='inspect'){validateInspectionInput(m.snapshot);const {comparison,frame}=await compareCanopyRoutes(session,m.snapshot.input,m.snapshot.departure,{canopy,signal,preparedManifestLocks:registry.regions.map(r=>r.manifestSHA256),deadline:performance.now()+12000,speedMps:m.snapshot.speedMps});checkCanopyComparison(comparison);result={inspection:inspectionFromSamples(comparison,m.snapshot),canopySnapshotIdentity:frame.identity,diagnostics:session.diagnostics(),canopyDiagnostics:canopy.stats(),localReads:local.stats};}
  else throw Error('UNKNOWN_OPERATION');if(signal.aborted)throw Object.assign(Error('CANCELLED'),{name:'AbortError'});self.postMessage({id:m.id,ok:true,result});
 }catch(e){self.postMessage({id:m.id,ok:false,error:e.message,cancelled:signal.aborted});}
};
