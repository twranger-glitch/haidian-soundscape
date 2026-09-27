/* Original CPU viewport renderer. No SDK, API key, shaders or WebGL ownership.
 * Visual cells call the same point model as route samples at the slider time.
 * A cell is an approximation over its area; it is not a footprint survey.
 */
(function(global){
 'use strict';
 const tick=()=>new Promise(r=>setTimeout(r,0));
 function classify(model){
  if(!model||model.ok===false||model.reliability==='partial'||model.routeCacheSafe===false)return 'unknown';
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
 function create(options){
  const map=options.map,doc=options.document||document;
  const canvas=doc.createElement('canvas');canvas.className='haidian-own-shade-canvas';
  Object.assign(canvas.style,{position:'absolute',pointerEvents:'none',zIndex:'450',opacity:String(options.opacity??0.5)});
  const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw Error('Canvas 2D unavailable');
  const pane=map.getPane?.('overlayPane')||map.getPanes().overlayPane;pane.appendChild(canvas);
  let disposed=false,generation=0,timer=null,running=false,pending=null,lastKey=null,visible=true;
  const stats={renders:0,completed:0,cancelled:0,samples:0,errors:0,active:0,maxActive:0,canvasCount:1,webglContexts:0,queueDepth:0,cacheHits:0,lastFrameMs:0,firstPaintMs:null,unknown:0};
  const started=performance.now();
  const invalidate=()=>{generation++;pending=null;stats.queueDepth=0;canvas.style.visibility='hidden';lastKey=null;clearTimeout(timer);};
  function key(){const b=map.getBounds(),size=map.getSize();return [b.getSouth(),b.getWest(),b.getNorth(),b.getEast(),map.getZoom(),size.x,size.y,options.date().getTime(),options.mode(),options.modelKey?.()||''].join('|');}
  function request(){
   if(disposed||!visible)return;
   const k=key();if(k===lastKey&&!running){stats.cacheHits++;canvas.style.visibility='visible';return;}
   const job={generation:++generation,key:k,date:new Date(options.date()),mode:options.mode()};pending=job;stats.queueDepth=1;
   clearTimeout(timer);timer=setTimeout(pump,Math.max(0,options.debounceMs??100));
  }
  async function pump(){
   if(running||disposed||!pending)return;
   const job=pending;pending=null;stats.queueDepth=0;running=true;
   const valid=()=>!disposed&&visible&&generation===job.generation;
   const t=performance.now();stats.renders++;
   try{
    await options.prepare?.();if(!valid())return;
    const size=map.getSize(),maxCells=Math.min(2400,Math.max(64,options.maxCells||1600));
    let cell=Math.max(8,options.cellPx||12,Math.ceil(Math.sqrt(size.x*size.y/maxCells)));
    while(Math.ceil(size.x/cell)*Math.ceil(size.y/cell)>maxCells)cell++;
    canvas.width=Math.max(1,Math.ceil(size.x));canvas.height=Math.max(1,Math.ceil(size.y));
    const origin=map.containerPointToLayerPoint([0,0]);
    canvas.style.transform=`translate(${origin.x}px,${origin.y}px)`;
    ctx.clearRect(0,0,canvas.width,canvas.height);canvas.style.visibility='visible';
    const cols=Math.ceil(size.x/cell),rows=Math.ceil(size.y/cell);let next=0,unknown=0,lastYield=performance.now();
    const cells=cols*rows;
    async function worker(){while(valid()){
     const i=next++;if(i>=cells)return;
     const x=(i%cols)*cell,y=Math.floor(i/cols)*cell,p=map.containerPointToLatLng([Math.min(size.x,x+cell/2),Math.min(size.y,y+cell/2)]);
     let model;stats.active++;stats.maxActive=Math.max(stats.maxActive,stats.active);
     try{model=await options.analyze(p.lat,p.lng,job.date,{canopyTimeoutMs:1200});}catch(_){stats.errors++;}finally{stats.active--;}
     if(!valid())return;stats.samples++;
     const state=classify(model);if(state==='unknown')unknown++;
     ctx.fillStyle=state==='shade'?'#172554':state==='unknown'?'rgba(202,138,4,.38)':state==='night'?'rgba(30,41,59,.3)':'rgba(0,0,0,0)';
     if(state!=='sun')ctx.fillRect(x,y,cell,cell);
     if(stats.firstPaintMs===null&&state==='shade')stats.firstPaintMs=performance.now()-started;
     if(performance.now()-lastYield>=8){await tick();lastYield=performance.now();}
    }}
    await Promise.all([worker(),worker()]);
    if(valid()){
     stats.completed++;stats.unknown=unknown;stats.cellPx=cell;stats.cells=cells;stats.lastFrameMs=performance.now()-t;
     lastKey=key();options.onStatus?.({state:unknown?'partial':'complete',unknown,cells,cellPx:cell,ms:stats.lastFrameMs,terrain:'bounded-flat-surface; distant terrain not included'});
    }else stats.cancelled++;
   }catch(error){if(valid())options.onStatus?.({state:'unknown',error:String(error.message||error)});}
   finally{running=false;if(pending&&!disposed)timer=setTimeout(pump,0);}
  }
  const start=()=>invalidate(),end=()=>request();
  for(const event of ['movestart','zoomstart'])map.on(event,start);
  for(const event of ['moveend','zoomend','resize'])map.on(event,end);
  return {request,invalidate,setOpacity(v){canvas.style.opacity=String(v);},setVisible(v){visible=!!v;if(!visible)invalidate();else request();},
   diagnostics(){return {...stats,generation,running,queueDepth:pending?1:0,disposed};},
   dispose(){if(disposed)return;disposed=true;invalidate();for(const e of ['movestart','zoomstart'])map.off(e,start);for(const e of ['moveend','zoomend','resize'])map.off(e,end);canvas.remove();stats.canvasCount=0;}
  };
 }
 global.HaidianOwnShade={version:'v9.0.0-dev37.5',create,classify,terrainOcclusion,terrainTileAddress};
})(typeof window!=='undefined'?window:globalThis);
