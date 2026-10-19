// New adapter ONLY for the isolated harness. No import of graph/route/proof runtime.
import {createAcceptedTaiwanProvider,casterAcquisitionBox} from './accepted-provider.mjs';
import {EstimatedShadeController,queryPoint} from '../engine/estimated-shade.mjs';
export const isolatedPolicy=Object.freeze({NO_PRODUCTION_CHANGE:true,PRODUCTION_MERGE_HOLD:true,Proof:'INCOMPLETE',winnerId:null,unknownSafelyResolved:0});
const identity=f=>{const p=f?.properties;return p&&['source','source_id','region'].every(k=>typeof p[k]==='string')?JSON.stringify([p.source,p.source_id,p.region]):null;};
export class IsolatedTaiwanProvider{
 constructor(registry,conflictRegistry,options={}){
  if(conflictRegistry?.schema!=='astra-estimated-conflict-registry-v1'||conflictRegistry.action!=='WITHHOLD_ESTIMATED_CASTER_RETAIN_UNKNOWN'||!Array.isArray(conflictRegistry.identities))throw Error('CONFLICT_REGISTRY_REQUIRED');
  for(const r of registry.regions)if(conflictRegistry.manifestSHA256?.[r.role]!==r.manifestSHA256)throw Error('CONFLICT_REGISTRY_SOURCE_MISMATCH');
  this.blocked=new Set(conflictRegistry.identities.map(k=>{if(!Array.isArray(k)||k.length!==3||k.some(v=>typeof v!=='string'))throw Error('CONFLICT_IDENTITY_INVALID');return JSON.stringify(k);}));
  this.core=createAcceptedTaiwanProvider(registry,options);this.conflictSHA=conflictRegistry.sourceEvidenceSHA256;
 }
 get pending(){return this.core.pending;}
 async queryBBox(bbox,options={}){
  const r=await this.core.queryBBox(bbox,options),withheld=r.features.filter(f=>this.blocked.has(identity(f))),features=r.features.filter(f=>!this.blocked.has(identity(f)));
  const unresolvedIds=[...new Set([...(r.unresolvedIds??[]),...withheld.map(identity)])];
  return {...r,features,unresolvedIds,withheld:withheld.map(f=>({identity:identity(f),geometry:structuredClone(f.geometry),reason:'SEALED_SOURCE_CONFLICT'})),
   status:unresolvedIds.length?'unknown/partial':r.status,reasons:[...new Set([...r.reasons,...(withheld.length?['SEALED_SOURCE_CONFLICT']:[])])],
   verifiedProofEligible:false,unknownResolved:0,realWorldCoverageComplete:false,buildingInventoryComplete:false,casterAcquisitionComplete:false,
   conflictRegistrySourceSHA256:this.conflictSHA};
 }
 diagnostics(){return {...this.core.diagnostics(),quarantinedIdentityCount:this.blocked.size};}
}
export class IsolatedEstimatedSession{
 constructor(registry,conflicts,{origin,fetcher,haloM=150,...options}={}){
  casterAcquisitionBox([120,23,120.001,23.001],haloM);
  this.provider=new IsolatedTaiwanProvider(registry,conflicts,{origin,fetcher,...options});this.haloM=haloM;
  // Controller expands acquisition AND filters against the same expanded box.
  // Adding a halo only inside queryBBox would drop off-viewport casters afterward.
  this.controller=new EstimatedShadeController(this.provider,{casterMarginM:haloM});
 }
 async load(bbox,time,{higherSources=[],signal}={}){
  // A known conflict cannot be silently reintroduced via an external height feed.
  const safe=higherSources.filter(s=>!this.provider.blocked.has(identity(s.feature)));
  const scene=await this.controller.load(bbox,time,{higherSources:safe,signal});
  scene.acquisitionMarginM=this.haloM;
  scene.actualBuildingCoverage='INCOMPLETE';scene.casterCoverage='INCOMPLETE';scene.conflictRegistrySourceSHA256=this.provider.conflictSHA;
  return scene;
 }
 queryPoint(scene,point){return queryPoint(scene,point);}
 cancel(){this.controller.cancel();}
 diagnostics(){return this.provider.diagnostics();}
}
