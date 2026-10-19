// Local flat-ground geometry only. No source geometry repairs or simplification.
const R=6378137,rad=Math.PI/180,eps=1e-7;
export const polygons=g=>g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function onSegment(p,a,b){return Math.abs(cross(a,b,p))<=eps*Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1]))&&p[0]>=Math.min(a[0],b[0])-eps&&p[0]<=Math.max(a[0],b[0])+eps&&p[1]>=Math.min(a[1],b[1])-eps&&p[1]<=Math.max(a[1],b[1])+eps;}
function segmentsTouch(a,b,c,d){const x=cross(a,b,c),y=cross(a,b,d),u=cross(c,d,a),v=cross(c,d,b);return x*y<0&&u*v<0||onSegment(c,a,b)||onSegment(d,a,b)||onSegment(a,c,d)||onSegment(b,c,d);}
export function ringContains(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(onSegment(p,a,b))return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function polygonContains(p,poly){return ringContains(p,poly[0])&&!poly.slice(1).some(h=>ringContains(p,h));}
export function footprintContains(p,polys){return polys.some(poly=>polygonContains(p,poly));}
export function localProjection(origin){
 const [lon,lat]=origin,k=R*rad*Math.cos(lat*rad);
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>85.05112878||Math.abs(lon)>180)throw Error('INVALID_MODEL_ORIGIN');
 return {forward:p=>[(p[0]-lon)*k,(p[1]-lat)*R*rad],inverse:p=>[p[0]/k+lon,p[1]/(R*rad)+lat],kind:'local-equirectangular-estimated-not-survey'};
}
export function validateGeometry(g,projection,maxRadiusM=3000,maxVertices=1024){
 const source=polygons(g);if(!source.length)throw Error('UNSUPPORTED_GEOMETRY');let vertices=0;
 const local=source.map(poly=>poly.map(ring=>{
  if(!Array.isArray(ring)||ring.length<4)throw Error('INCOMPLETE_RING');
  vertices+=ring.length;if(vertices>maxVertices)throw Error('GEOMETRY_VERTEX_SCOPE_LIMIT');
  if(ring.some(p=>!Array.isArray(p)||p.length<2||p.slice(0,2).some(x=>!Number.isFinite(x))||Math.abs(p[0])>180||Math.abs(p[1])>85.05112878))throw Error('INVALID_COORDINATE');
  if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error('UNCLOSED_RING');
  const r=ring.map(projection.forward);if(r.some(p=>Math.hypot(...p)>maxRadiusM))throw Error('LOCAL_GEOMETRY_SCOPE_LIMIT');
  let area=0;for(let i=0;i<r.length-1;i++)area+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];if(Math.abs(area)<eps)throw Error('DEGENERATE_RING');
  for(let i=0;i<r.length-1;i++)for(let j=i+1;j<r.length-1;j++){if(j===i+1||i===0&&j===r.length-2)continue;if(segmentsTouch(r[i],r[i+1],r[j],r[j+1]))throw Error('SELF_INTERSECTING_RING');}
  return r;
 }));
 for(const poly of local){
  const outer=poly[0];for(const h of poly.slice(1)){if(!ringContains(h[0],outer))throw Error('HOLE_OUTSIDE_OUTER');for(let i=0;i<h.length-1;i++)for(let j=0;j<outer.length-1;j++)if(segmentsTouch(h[i],h[i+1],outer[j],outer[j+1]))throw Error('HOLE_TOUCHES_OUTER');}
  const holes=poly.slice(1);for(let i=0;i<holes.length;i++)for(let j=i+1;j<holes.length;j++){if(ringContains(holes[i][0],holes[j])||ringContains(holes[j][0],holes[i]))throw Error('OVERLAPPING_HOLES');for(let a=0;a<holes[i].length-1;a++)for(let b=0;b<holes[j].length-1;b++)if(segmentsTouch(holes[i][a],holes[i][a+1],holes[j][b],holes[j][b+1]))throw Error('OVERLAPPING_HOLES');}
 }
 for(let i=0;i<local.length;i++)for(let j=i+1;j<local.length;j++){
  const a=local[i],b=local[j];
  if(polygonContains(a[0][0],b)||polygonContains(b[0][0],a))throw Error('OVERLAPPING_MULTIPOLYGON_COMPONENTS');
  for(const ar of a)for(const br of b)for(let x=0;x<ar.length-1;x++)for(let y=0;y<br.length-1;y++)if(segmentsTouch(ar[x],ar[x+1],br[y],br[y+1]))throw Error('TOUCHING_MULTIPOLYGON_COMPONENTS_UNSUPPORTED');
 }
 return local;
}
function canonicalRing(r){
 if(!Array.isArray(r)||r.length<4||r.length>1024||r.some(p=>!Array.isArray(p)||p.length<2||p.slice(0,2).some(x=>!Number.isFinite(x))))throw Error('IDENTITY_GEOMETRY_INVALID_OR_SCOPE_LIMIT');
 if(r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])throw Error('UNCLOSED_RING');
 const points=r.slice(0,-1).map(p=>[p[0],p[1]]),versions=[];
 for(const order of [points,[...points].reverse()]){let i=0;for(let j=1;j<order.length;j++)if(order[j][0]<order[i][0]||order[j][0]===order[i][0]&&order[j][1]<order[i][1])i=j;versions.push(JSON.stringify([...order.slice(i),...order.slice(0,i)]));}
 return versions.sort()[0];
}
export function geometryIdentity(g){const pp=polygons(g);if(!pp.length)throw Error('UNSUPPORTED_GEOMETRY');if(pp.flat(2).length>1024)throw Error('IDENTITY_GEOMETRY_SCOPE_LIMIT');return JSON.stringify(pp.map(poly=>[canonicalRing(poly[0]),...poly.slice(1).map(canonicalRing).sort()]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}
export function geometryBounds(g){const ps=polygons(g).flat(2);if(!ps.length)return null;let b=[Infinity,Infinity,-Infinity,-Infinity];for(const p of ps){if(!Array.isArray(p)||p.slice(0,2).some(x=>!Number.isFinite(x)))return null;b=[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])];}return b;}
export function expandedBBox(bbox,marginM=50){if(bbox.length!==4||bbox.some(x=>!Number.isFinite(x))||bbox[0]>bbox[2]||bbox[1]>bbox[3]||!Number.isFinite(marginM)||marginM<0)throw Error('INVALID_ACQUISITION_SCOPE');const k=R*rad*Math.cos((bbox[1]+bbox[3])/2*rad),dx=marginM/k,dy=marginM/(R*rad);return [bbox[0]-dx,bbox[1]-dy,bbox[2]+dx,bbox[3]+dy];}
export function shadowVector(height,sun,maxLengthM=1500){
 if(!Number.isFinite(height)||height<=0)throw Error('HEIGHT_UNKNOWN');if(!Number.isFinite(sun.altitudeDeg)||!Number.isFinite(sun.azimuthDeg)||sun.altitudeDeg<=0||sun.altitudeDeg>90)throw Error('NO_DAYLIGHT_GEOMETRY');
 const length=height/Math.tan(sun.altitudeDeg*rad);if(!Number.isFinite(length)||length>maxLengthM)throw Error('SHADOW_EXTENT_UNSUPPORTED_NOT_CLAMPED');
 return [-Math.sin(sun.azimuthDeg*rad)*length,-Math.cos(sun.azimuthDeg*rad)*length];
}
export function sweptPieces(polys,vector){
 const pieces=[];for(const poly of polys){pieces.push(poly,poly.map(r=>r.map(p=>[p[0]+vector[0],p[1]+vector[1]])));for(const ring of poly)for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1],c=[b[0]+vector[0],b[1]+vector[1]],d=[a[0]+vector[0],a[1]+vector[1]];if(Math.abs(cross(a,b,c))>eps)pieces.push([[a,b,c,d,a]]);}}
 return pieces;
}
export function inShadow(point,pieces){return pieces.some(p=>polygonContains(point,p));}
