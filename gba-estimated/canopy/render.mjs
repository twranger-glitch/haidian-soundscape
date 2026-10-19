// Native 1-pixel ground core + down-sun extrusion; no coarse map route analyzer.
import {worldPoint,pixelMeters,tileKey,Z,policy} from './grid.mjs';
export function serialFrame(frame){return {status:frame.status,bbox:frame.bbox,requestedTiles:frame.requestedTiles,failedTiles:frame.failedTiles,errors:frame.errors,identity:frame.identity,tiles:[...frame.tiles.values()].map(t=>({x:t.x,y:t.y,data:t.data,identity:t.identity})),heightClass:'ML_ESTIMATED',...policy};}
export function drawCanopy(ctx,serial,sun,bbox,width,height){
 const a=worldPoint(bbox[0],bbox[3]),b=worldPoint(bbox[2],bbox[1]),lat=(bbox[1]+bbox[3])/2,m=pixelMeters(lat),tan=Math.tan(sun.altitudeDeg*Math.PI/180),az=sun.azimuthDeg*Math.PI/180;
 if(sun.altitudeDeg<2.5||sun.altitudeDeg>90)return {status:'INCOMPLETE',reason:'CANOPY_SOLAR_UNSUPPORTED',drawnColumns:0,...policy};
 const dx=-Math.sin(az),dy=Math.cos(az),sx=width/(b[0]-a[0]),sy=height/(b[1]-a[1]);let core=0,columns=0,capped=0;
 ctx.save();ctx.globalCompositeOperation='destination-over';ctx.fillStyle='rgba(41,126,78,.25)';
 for(const tile of serial.tiles){const data=tile.data;for(let i=0;i<data.length;i++){const h=data[i];if(h<2||h>=255)continue;const x=tile.x*256+i%256,y=tile.y*256+Math.floor(i/256),length=Math.min(120,(h-.5)/tan)/m;if((h-.5)/tan>120)capped++;
   if(Math.max(x,x+dx*length)+1<a[0]||Math.min(x,x+dx*length)>b[0]||Math.max(y,y+dy*length)+1<a[1]||Math.min(y,y+dy*length)>b[1])continue;
   const points=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]];ctx.beginPath();points.forEach((p,j)=>j?ctx.lineTo((p[0]-a[0])*sx,(p[1]-a[1])*sy):ctx.moveTo((p[0]-a[0])*sx,(p[1]-a[1])*sy));ctx.closePath();ctx.fill();core++;
   // Translate the full square and draw each side's swept quad. No circles/fake crowns.
   ctx.beginPath();for(let j=0;j<4;j++){const p=points[j],q=points[(j+1)%4];ctx.moveTo((p[0]-a[0])*sx,(p[1]-a[1])*sy);ctx.lineTo((q[0]-a[0])*sx,(q[1]-a[1])*sy);ctx.lineTo((q[0]+dx*length-a[0])*sx,(q[1]+dy*length-a[1])*sy);ctx.lineTo((p[0]+dx*length-a[0])*sx,(p[1]+dy*length-a[1])*sy);ctx.closePath();}ctx.fill();columns++;
  }}ctx.restore();return {status:serial.status==='ready'?'ESTIMATED_NATIVE_RASTER_RENDERED':'INCOMPLETE',drawnColumns:columns,corePixels:core,cappedColumns:capped,nativeZoom:Z,displayIsRouteEvidence:false,physicalShadowAccuracy:'NOT_TESTED',...policy};
}
