import {localProjection} from './engine/geometry.mjs';import {drawCanopy} from './canopy/render.mjs';
export function createEstimatedOverlay(map,L){
 const paneName='astra-gba-estimated',pane=map.getPane(paneName)??map.createPane(paneName);pane.style.zIndex='375';pane.style.pointerEvents='none';const canvas=L.DomUtil.create('canvas','astra-gba-canvas',pane);canvas.style.pointerEvents='none';let last;
 function clear(){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);last=null;}
 function draw(data){const size=map.getSize();canvas.width=Math.ceil(size.x);canvas.height=Math.ceil(size.y);canvas.style.width=size.x+'px';canvas.style.height=size.y+'px';L.DomUtil.setPosition(canvas,map.containerPointToLayerPoint([0,0]));const ctx=canvas.getContext('2d'),b=map.getBounds(),bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];ctx.clearRect(0,0,canvas.width,canvas.height);const scene=data.scene,projection=localProjection(scene.origin);let pieces=0;
  const trace=poly=>{ctx.beginPath();for(const ring of poly){ring.forEach((p,i)=>{const ll=projection.inverse(p),v=map.latLngToContainerPoint([ll[1],ll[0]]);i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y);});ctx.closePath();}};
  ctx.fillStyle='rgba(93,61,144,.28)';for(const c of scene.casters)for(const poly of c.pieces){trace(poly);ctx.fill('evenodd');pieces++;}
  const canopy=drawCanopy(ctx,data.canopyScene,scene.sun,bbox,canvas.width,canvas.height);ctx.globalCompositeOperation='destination-out';for(const poly of scene.footprints){trace(poly);ctx.fill('evenodd');}ctx.globalCompositeOperation='source-over';last={buildingPieces:pieces,canopy,viewport:bbox,sourceStatus:scene.providerStatus,canopyStatus:data.canopyScene.status,physicalShadowAccuracy:'NOT_TESTED',verifiedProofEligible:false};return last;
 }
 return {draw,clear,diagnostics:()=>last,remove:()=>canvas.remove()};
}
