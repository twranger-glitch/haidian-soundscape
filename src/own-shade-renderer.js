/* ASTRA Unified Shade: continuous building geometry. Canopy projection remains
 * in the original CHMv2 tile renderer; both share data and solar geometry.
 * Never calls a route analyzer per display pixel; never reads Canvas as evidence. */
(function(global){
 'use strict';
 const tick=()=>new Promise(r=>setTimeout(r,0));
 function classify(model){
  if(!model||model.ok===false)return 'unknown';
  if(model.classification==='confirmed-shade')return 'shade';
  if(model.reliability==='partial'||model.routeCacheSafe===false)return 'unknown';
  return model.state==='night'?'night':model.shaded===true?'shade':model.state==='sun'?'sun':'unknown';
 }
 function terrainOcclusion(receiverHeight,samples,altitudeRad,clearanceM=0.5){
  if(!Number.isFinite(receiverHeight)||!Number.isFinite(altitudeRad))return {state:'unknown'};
  if(altitudeRad<=0)return {state:'night'};
  for(const s of samples){
   if(!Number.isFinite(s.groundM)||!Number.isFinite(s.heightM)||!Number.isFinite(s.distanceM))return {state:'unknown'};
   if(s.groundM+s.heightM>receiverHeight+clearanceM+s.distanceM*Math.tan(altitudeRad))return {state:'shade',distanceM:s.distanceM};
  }
  return {state:'sun',scope:'bounded-ray-only'};
 }
 function terrainTileAddress(x,y,z,maxZoom=15){
  const sourceZ=Math.min(z,maxZoom),factor=2**(z-sourceZ);
  return {x:Math.floor(x/factor),y:Math.floor(y/factor),z:sourceZ,factor,sx:(x%factor)*256/factor,sy:(y%factor)*256/factor,size:256/factor};
 }
 // Project an opaque vertical prism. The union of both horizontal faces and
 // every swept boundary (including courtyard walls) handles concavity and holes
 // without convex-hull bridges. Opaque mask compositing performs the union.
 function projectBuilding(feature,solar,project,height){
  if(!solar||solar.night||solar.altitudeRad<=0)return null;
  const g=feature?.geometry,polys=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
  const meta=height||{},top=Number(meta.height),base=Math.max(0,Number(meta.baseHeight)||0);
  if(!Number.isFinite(top)||top<=base)return null;
  const bearing=Number(solar.sunBearingDeg)*Math.PI/180,tan=Math.tan(solar.altitudeRad),faces=[];
  const move=(p,h)=>{const lat=Number(p[1]),lng=Number(p[0]);return project({lat:lat-Math.cos(bearing)*h/tan/111195.08,lng:lng-Math.sin(bearing)*h/tan/(111195.08*Math.max(.01,Math.cos(lat*Math.PI/180)))});};
  for(const poly of polys){
   if(!poly?.length)continue;
   const bottom=poly.map(r=>r.map(p=>move(p,base))),roof=poly.map(r=>r.map(p=>move(p,top)));
   faces.push({rings:bottom},{rings:roof});
   for(let r=0;r<poly.length;r++)for(let i=1;i<poly[r].length;i++)faces.push({rings:[[bottom[r][i-1],bottom[r][i],roof[r][i],roof[r][i-1]]]});
  }
  return {faces,heightM:top,baseHeightM:base,lengthM:top/tan,quality:meta.quality||'default',heightSource:meta.source||'unknown'};
 }
 function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
 function containsShadow(shadow,p){return !!shadow?.faces.some(f=>f.rings.reduce((inside,r)=>inside!==inRing(p,r),false));}
 const featureIndexes=new WeakMap();
 function candidates(features,origin,radius){
  let index=featureIndexes.get(features);if(!index){const cells=new Map(),wide=[];for(const f of features){const b=global.ASTRABuildingData?.featureBox(f);if(!b)continue;const x0=Math.floor(b.west/.002),x1=Math.floor(b.east/.002),y0=Math.floor(b.south/.002),y1=Math.floor(b.north/.002);if((x1-x0+1)*(y1-y0+1)>100){wide.push(f);continue;}for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const k=x+','+y;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(f);}}index={cells,wide};featureIndexes.set(features,index);}
  const dy=radius/111195.08,dx=dy/Math.max(.08,Math.cos(origin.lat*Math.PI/180)),out=new Set(index.wide);
  for(let x=Math.floor((origin.lng-dx)/.002);x<=Math.floor((origin.lng+dx)/.002);x++)for(let y=Math.floor((origin.lat-dy)/.002);y<=Math.floor((origin.lat+dy)/.002);y++)for(const f of index.cells.get((((x+90000)%180000+180000)%180000-90000)+','+y)||[])out.add(f);return [...out];
 }
 // Same vertical-prism union as Canvas. Ground receiver, flat local model.
 // Missing heights are only plausible evidence, never a confirmed shadow.
 function evidenceQuality(feature,height){
  const q=feature?.properties?.geometry_quality;
  return Number(height?.height)>0&&height?.quality==='measured'&&(!q||q==='source-footprint');
 }
 function findEvidence(features,origin,solar,height,radius=1200,options={}){
  if(!solar||solar.night)return null;const cos=Math.cos(origin.lat*Math.PI/180),project=p=>({x:(((p.lng-origin.lng+180)%360+360)%360-180)*111195.08*cos,y:(p.lat-origin.lat)*111195.08});let best=null;
  const tanAlt=Math.tan(Math.max(.001,solar.altitudeRad)),rayWidth=Math.max(0,Number(options.rayWidthM)||0),unknownMaxHeight=Math.max(6,Number(options.unknownMaxHeightM)||24),clearance=Math.max(0,Number(options.clearanceM)||0),bearing=Number(solar.sunBearingDeg)*Math.PI/180,right={x:Math.cos(bearing),y:-Math.sin(bearing)};
  const uncertaintyPoints=[{x:0,y:0}];if(rayWidth>0)for(const scale of [-1,-.5,.5,1])uncertaintyPoints.push({x:right.x*rayWidth*scale,y:right.y*rayWidth*scale});
  for(const f of candidates(features,origin,radius)){
   const meta=height(f),knownTop=Number(meta.height),unknown=!(knownTop>0),precise=evidenceQuality(f,meta)&&!unknown,base=Math.max(0,Number(meta.baseHeight)||0);
   // Uncertain evidence must still obey the same bounded physical reach as the
   // legacy route-ray model. An unknown-height footprint may veto sunlight only
   // if a building no taller than the configured unknown-height ceiling could cast
   // to this receiver. Estimated/levels heights use their actual estimate. Neither
   // case is promoted to confirmed shade; a geometrically relevant hit stays unknown.
   const probeTop=unknown?Math.max(base+.1,unknownMaxHeight):knownTop;
   const h=precise?meta:{...meta,height:probeTop},shape=projectBuilding(f,solar,project,h);
   if(!shape)continue;
   const hits=precise?containsShadow(shape,{x:0,y:0}):uncertaintyPoints.some(pt=>containsShadow(shape,pt));if(!hits)continue;
   const b=global.ASTRABuildingData.featureBox(f),near=project({lng:Math.max(b.west,Math.min(b.east,origin.lng)),lat:Math.max(b.south,Math.min(b.north,origin.lat))}),distance=Math.hypot(near.x,near.y);if(distance>radius)continue;
   const requiredHeight=distance*tanAlt+clearance;
   if(!precise&&requiredHeight>probeTop+1e-6)continue;
   const row={type:'building',feature:f,height:unknown?null:meta.height,heightSource:meta.source,heightQuality:meta.quality,distance,requiredHeight,confidence:precise?'high':'possible',plausibleUnknownHeight:unknown};
   if(!best||(precise&&!best.precise)||(precise===best.precise&&distance<best.distance))best={...row,precise};
  }return best;
 }
 function create(options){
  const map=options.map,doc=options.document||document,canvas=doc.createElement('canvas');canvas.className='haidian-own-shade-canvas haidian-building-shadow-canvas';
  Object.assign(canvas.style,{position:'absolute',pointerEvents:'none',zIndex:'451',opacity:String(options.opacity??.5)});
  const ctx=canvas.getContext('2d'),masks=[doc.createElement('canvas'),doc.createElement('canvas')];
  const pane=map.getPane?.('overlayPane')||map.getPanes().overlayPane;pane.appendChild(canvas);
  let disposed=false,generation=0,timer=null,controller=null,running=false,pending=false,frame=null;
  const stats={renders:0,completed:0,cancelled:0,features:0,measured:0,estimated:0,unknownHeight:0,faces:0,canvasCount:1,webglContexts:0,queueDepth:0,lastFrameMs:0,firstPaintMs:null,partial:true,modelPointCalls:0};
  const activated=performance.now();
  function invalidate(){generation++;frame=null;pending=false;clearTimeout(timer);controller?.abort();canvas.style.visibility='hidden';options.invalidate?.();}
  function request(){if(disposed)return;invalidate();pending=true;stats.queueDepth=1;timer=setTimeout(pump,options.debounceMs??160);options.onRequest?.();}
  async function pump(){
   if(disposed||running||!pending)return;pending=false;stats.queueDepth=0;running=true;controller=new AbortController();const signal=controller.signal,serial=generation,start=performance.now(),valid=()=>!signal.aborted&&!disposed&&serial===generation;
   stats.renders++;
   try{
    const mode=options.mode(),date=new Date(options.date()),center=map.getCenter();
    const data=mode==='trees'?{features:[],complete:true}:await options.prepare(signal,{date,mode,center});
    if(!valid())return;
    const size=map.getSize(),origin=map.containerPointToLayerPoint([0,0]);canvas.width=Math.max(1,Math.min(2400,Math.ceil(size.x)));canvas.height=Math.max(1,Math.min(1800,Math.ceil(size.y)));
    canvas.style.transform=`translate(${origin.x}px,${origin.y}px)`;for(const m of masks){m.width=canvas.width;m.height=canvas.height;}
    const solar=options.solar(data?.solarOrigin||center,date),features=data?.features||[];
    let n=0,faces=0,measured=0,estimated=0,unknown=0,lastYield=performance.now();
    for(const feature of features){
     if(!valid())return;
     const height=options.height(feature),shape=projectBuilding(feature,solar,p=>map.latLngToContainerPoint({...p,lng:p.lng+360*Math.round((map.getCenter().lng-p.lng)/360)}),height);if(!shape){if(!solar.night)unknown++;continue;}
     const precise=evidenceQuality(feature,height);
     if(precise)measured++;else if(height.quality==='default')unknown++;else estimated++;
     const mask=masks[precise?1:0].getContext('2d');mask.fillStyle='#172554';
     for(const face of shape.faces){mask.beginPath();for(const ring of face.rings){if(!ring.length)continue;mask.moveTo(ring[0].x,ring[0].y);for(let i=1;i<ring.length;i++)mask.lineTo(ring[i].x,ring[i].y);mask.closePath();}mask.fill('evenodd');faces++;}
     n++;if(performance.now()-lastYield>7){await tick();lastYield=performance.now();}
    }
    if(!valid())return;
    // Unknown/inferred heights are visibly distinguished, not sold as measured.
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.globalAlpha=.48;ctx.drawImage(masks[0],0,0);ctx.globalAlpha=1;ctx.drawImage(masks[1],0,0);
    stats.features=n;stats.faces=faces;stats.measured=measured;stats.estimated=estimated;stats.unknownHeight=unknown;stats.partial=!data?.complete||unknown>0||estimated>0||size.x>2400||size.y>1800;stats.lastFrameMs=performance.now()-start;stats.completed++;
    if(n&&stats.firstPaintMs===null)stats.firstPaintMs=performance.now()-activated;
    frame={snapshot:data,date:new Date(date),mode,solar,center,bounds:map.getBounds?.(),generation:serial};
    canvas.style.visibility='visible';options.onCommit?.(frame);options.onStatus?.({state:stats.partial?'partial':'complete',...stats});
   }catch(e){if(!signal.aborted){stats.partial=true;options.onStatus?.({state:'unknown',error:e.message});}}
   finally{if(signal.aborted)stats.cancelled++;running=false;if(pending&&!disposed)timer=setTimeout(pump,0);}
  }
  const start=()=>invalidate(),end=()=>request();for(const e of ['movestart','zoomstart'])map.on(e,start);for(const e of ['moveend','zoomend','resize'])map.on(e,end);
  return {request,invalidate,getFrame(){return frame;},setOpacity(v){canvas.style.opacity=String(v);},diagnostics(){return {...stats,generation,running,queueDepth:pending?1:0,disposed};},dispose(){if(disposed)return;disposed=true;invalidate();for(const e of ['movestart','zoomstart'])map.off(e,start);for(const e of ['moveend','zoomend','resize'])map.off(e,end);canvas.remove();for(const m of masks){m.width=0;m.height=0;}stats.canvasCount=0;}};
 }
 global.HaidianOwnShade={version:'v9.0.0-dev37.8',create,projectBuilding,containsShadow,findEvidence,evidenceQuality,classify,terrainOcclusion,terrainTileAddress};
})(typeof window!=='undefined'?window:globalThis);
