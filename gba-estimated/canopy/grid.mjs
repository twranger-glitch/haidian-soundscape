// Shared native z17 CHMv2 geometry for route rays and visual ground projection.
// Adapted from ASTRA original z17/quadkey/native-column model; estimated only.
export const Z=17,SIZE=256,WORLD=2**Z*SIZE,R=6378137;
export const policy=Object.freeze({Proof:'INCOMPLETE',winnerId:null,unknownSafelyResolved:0,verifiedProofEligible:false,verifiedClassification:'UNKNOWN'});
export function worldPoint(lon,lat){if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>85)throw Error('CANOPY_COORDINATE_UNSUPPORTED');return [(lon+180)/360*WORLD,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*WORLD];}
export function lonlat(x,y){return [x/WORLD*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/WORLD)))*180/Math.PI];}
export function pixelMeters(lat){return 2*Math.PI*R*Math.cos(lat*Math.PI/180)/WORLD;}
export function tileKey(x,y){return `${Z}/${x}/${y}`;}
export function quadkey(x,y,z=10){let s='';for(let i=z;i;i--)s+=String((x&(1<<(i-1))?1:0)+(y&(1<<(i-1))?2:0));return s;}
export function sourceTile(tx,ty){return {quadkey:quadkey(Math.floor(tx/128),Math.floor(ty/128)),x:(tx%128)*256,y:(ty%128)*256};}
export function tileCoordinates(bbox,max=96){const a=worldPoint(bbox[0],bbox[3]),b=worldPoint(bbox[2],bbox[1]),out=[];for(let y=Math.floor(a[1]/256);y<=Math.floor(b[1]/256);y++)for(let x=Math.floor(a[0]/256);x<=Math.floor(b[0]/256);x++){if(out.length>=max)throw Error('CANOPY_NATIVE_TILE_SCOPE_LIMIT');out.push({x,y,key:tileKey(x,y)});}return out;}
export function rasterValue(frame,gx,gy){const x=Math.floor(gx),y=Math.floor(gy),key=tileKey(Math.floor(x/256),Math.floor(y/256)),tile=frame.tiles.get(key);if(!tile)return {key,height:null,reason:'CANOPY_TILE_MISSING'};const h=tile.data[((y%256)+256)%256*256+((x%256)+256)%256];return {key,height:Number.isInteger(h)&&h>0&&h<255?h:null,reason:h===0?'CANOPY_ZERO_AMBIGUOUS_NOT_SUN':'CANOPY_NODATA',gx:x,gy:y,source:tile.identity};}
// Exact grid traversal, not periodic coarse samples; each intersected native cell once.
export function traceCells(p,unit,maxPixels,visit){let x=Math.floor(p[0]),y=Math.floor(p[1]),t=0;const [dx,dy]=unit,sx=Math.sign(dx),sy=Math.sign(dy),ix=dx?Math.abs(1/dx):Infinity,iy=dy?Math.abs(1/dy):Infinity;let tx=dx?((sx>0?x+1:x)-p[0])/dx:Infinity,ty=dy?((sy>0?y+1:y)-p[1])/dy:Infinity;
 for(let n=0;n<1024&&t<=maxPixels;n++){if(visit(x,y,Math.max(0,t),Math.min(maxPixels,tx,ty)))return true;const next=Math.min(tx,ty);if(!Number.isFinite(next)||next>maxPixels)return false;if(tx===next){x+=sx;tx+=ix;}if(ty===next){y+=sy;ty+=iy;}t=next;}return false;
}
export function queryCanopy(frame,point,sun,{maxDistanceM=120,minHeightM=2,clearanceM=.5}={}){
 const result={...policy,estimatedClassification:'UNKNOWN',reason:'NO_POSITIVE_CANOPY_EVIDENCE_NOT_CONFIRMED_SUN',sourceIds:[],heightClass:'ML_ESTIMATED',partial:frame.status!=='ready',modelAssumptions:['native-z17-CHMv2','vertical-opaque-column','flat-local-ground','no-surveyed-crown-base','bounded-120m-caster-ray','zero-may-be-no-data'],sourceSnapshotIdentity:frame.identity};
 if(sun.altitudeDeg<2.5||sun.altitudeDeg>90||!Number.isFinite(sun.azimuthDeg))return {...result,reason:'CANOPY_SOLAR_GEOMETRY_UNSUPPORTED',partial:true};
 const p=worldPoint(point.lng,point.lat),m=pixelMeters(point.lat),rad=sun.azimuthDeg*Math.PI/180,unit=[Math.sin(rad),-Math.cos(rad)],tan=Math.tan(sun.altitudeDeg*Math.PI/180);let hit,missing=false;
 traceCells(p,unit,maxDistanceM/m,(gx,gy,entry,exit)=>{if(exit-entry<1e-9)return false;const v=rasterValue(frame,gx,gy);if(v.height===null){missing=true;return false;}if(v.height>=minHeightM&&v.height>entry*m*tan+clearanceM){hit={...v,distanceM:entry*m,rayHeightM:entry*m*tan+clearanceM};return true;}return false;});
 if(hit)return {...result,estimatedClassification:'ESTIMATED_CANOPY_SHADE',reason:'CHMV2_ESTIMATED_NATIVE_COLUMN_HIT',sourceIds:[hit.key],caster:{tile:hit.key,gx:hit.gx,gy:hit.gy,heightM:hit.height,distanceM:hit.distanceM,rayHeightM:hit.rayHeightM,source:hit.source},partial:result.partial||missing};
 return {...result,partial:result.partial||missing};
}
