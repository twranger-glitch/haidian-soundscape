/* ASTRA regional building/OSM adapter. OSM-derived data: ODbL 1.0.
 * Pure geometry conversion; no routing graph mutation or guessed coverage. */
(function(global){'use strict';
 const eq=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
 const isBuilding=t=>!!t&&((t.building&&t.building!=='no')||(t['building:part']&&t['building:part']!=='no'));
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 function intersects(a,b,c,d){const on=(p,q,r)=>Math.abs(cross(p,q,r))<1e-12&&r[0]>=Math.min(p[0],q[0])-1e-12&&r[0]<=Math.max(p[0],q[0])+1e-12&&r[1]>=Math.min(p[1],q[1])-1e-12&&r[1]<=Math.max(p[1],q[1])+1e-12;return (cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
 function ringsIntersect(a,b){for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++)if(intersects(a[i-1],a[i],b[j-1],b[j]))return true;return false;}
 function validRing(r){if(!Array.isArray(r)||r.length<4||r.length>4096||!eq(r[0],r.at(-1))||r.some(p=>!p||!p.every(Number.isFinite)))return false;
  let area=0;for(let i=1;i<r.length;i++){area+=r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1];for(let j=i+2;j<r.length;j++){if(i===1&&j===r.length-1)continue;if(intersects(r[i-1],r[i],r[j-1],r[j]))return false;}}return Math.abs(area)>1e-12;
 }
 function inside(p,r){let v=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])v=!v;}return v;}
 function stitch(parts){const rest=parts.map(r=>r.slice()),out=[];while(rest.length){let r=rest.shift(),guard=0;while(!eq(r[0],r.at(-1))&&guard++<parts.length){const i=rest.findIndex(s=>eq(r.at(-1),s[0])||eq(r.at(-1),s.at(-1)));if(i<0)break;let next=rest.splice(i,1)[0];if(eq(r.at(-1),next.at(-1)))next.reverse();r=r.concat(next.slice(1));}if(!validRing(r))return null;out.push(r);}return out;}
 function meters(v){if(v==null||v==='')return null;const s=String(v).trim();if(!/^\d+(\.\d+)?\s*(m|metres?|meters?|ft|feet)?$/i.test(s))return null;const n=parseFloat(s)*(/ft|feet/i.test(s)?.3048:1);return Number.isFinite(n)&&n>=0?n:null;}
 function height(tags){const explicit=meters(tags.height),levels=Number(tags['building:levels']),base=meters(tags.min_height)??(Number(tags['building:min_level'])>0?Number(tags['building:min_level'])*3.1:0);
  if(explicit>base)return {height:explicit,min_height:base,height_source:'OSM height',height_quality:'direct'};
  if(Number.isFinite(levels)&&levels>0&&levels*3.1>base)return {height:levels*3.1,min_height:base,height_source:'OSM building:levels × 3.1 m (estimate)',height_quality:'floors-derived'};
  return {height:null,min_height:base,height_source:'default: unknown OSM height',height_quality:'default'};
 }
 function convert(payload,source={}){
  if(!payload||!Array.isArray(payload.elements))throw Object.assign(new Error('Invalid OSM payload'),{code:'invalid-payload'});
  const nodes=new Map(),ways=new Map(),relations=[],members=new Set(),features=[],issues=[];
  for(const e of payload.elements){if(e.type==='node')nodes.set(String(e.id),[Number(e.lon),Number(e.lat)]);else if(e.type==='way')ways.set(String(e.id),e);else if(e.type==='relation'&&isBuilding(e.tags))relations.push(e);}
  const geometry=e=>Array.isArray(e.geometry)?e.geometry.map(p=>[Number(p.lon),Number(p.lat)]):(e.nodes||[]).map(id=>nodes.get(String(id)));
  const add=(e,polys)=>{const tags=e.tags||{},h=height(tags);features.push({type:'Feature',id:`osm-${e.type}-${e.id}`,geometry:polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys},properties:{...h,building_uid:`osm-${e.type}-${e.id}`,building_source:source.name||'OSM',source_id:`${e.type}/${e.id}`,source_version:source.version||payload.timestamp||'live',source_url:source.url||`https://www.openstreetmap.org/${e.type}/${e.id}`,source_license:'ODbL-1.0',osm_tags:tags,name:tags['name:zh']||tags.name||'',building:tags.building||tags['building:part']||'',height_known:h.height_quality!=='default'}});};
  for(const e of relations){const outer=[],inner=[];let missing=false;for(const m of e.members||[]){if(m.type!=='way'){if(m.type==='relation')missing=true;continue;}members.add(String(m.ref));const w=ways.get(String(m.ref)),r=geometry(m.geometry?m:w||{});if(r.length<2||r.some(p=>!p||!p.every(Number.isFinite))){missing=true;continue;}(m.role==='inner'?inner:outer).push(r);}
   const outs=stitch(outer),ins=stitch(inner);if(missing||!outs?.length||!ins){issues.push({id:e.id,type:'relation',reason:'missing-geometry-or-invalid-ring'});continue;}
   const polys=outs.map(r=>[r]);let invalid=false;for(const r of ins){const p=polys.find(p=>r.slice(0,-1).every(q=>inside(q,p[0]))&&!p.some(existing=>ringsIntersect(r,existing)));if(p&&p.slice(1).some(h=>inside(r[0],h)||inside(h[0],r))){invalid=true;break;}if(!p){invalid=true;break;}p.push(r);}if(invalid){issues.push({id:e.id,type:'relation',reason:'uncontained-hole'});continue;}add(e,polys);
  }
  for(const e of ways.values()){if(!isBuilding(e.tags)||members.has(String(e.id)))continue;const r=geometry(e);if(!validRing(r)){issues.push({id:e.id,type:'way',reason:'missing-geometry-or-invalid-ring'});continue;}add(e,[[r]]);}
  return {type:'FeatureCollection',features,diagnostics:{status:issues.length?'missing-geometry':features.length?'ready':'empty-success',complete:issues.length===0,featureCount:features.length,unknownHeight:features.filter(f=>!f.properties.height_known).length,relationCount:relations.length,issues}};
 }
 const within=(b,a)=>b.west>=a[0]&&b.south>=a[1]&&b.east<=a[2]&&b.north<=a[3];
 global.HaidianBuildingSources={version:'v9.0.0-dev37.8',convert,validRing,inside,stitch,height,within};
})(typeof window!=='undefined'?window:globalThis);
