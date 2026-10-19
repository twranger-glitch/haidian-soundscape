// Displays an existing accepted geometry only; never changes the original
// route selection, geometry, endpoints, comparator or source graph.
export function createEstimatedRouteOverlay(map,L){
 const group=L.layerGroup().addTo(map);let current=null;
 return {show(row){
  if(!Array.isArray(row?.points)||row.points.length<2||row.points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)))throw Error('ESTIMATED_ROUTE_GEOMETRY_REQUIRED');
  group.clearLayers();const latlngs=row.points.map(p=>[p.lat,p.lng]);
  L.polyline(latlngs,{color:'#087e65',weight:6,opacity:.85,dashArray:'10 5',interactive:false}).addTo(group);
  current={candidateId:row.candidateId,pointCount:latlngs.length,geometryUnmodified:true,verifiedSelectionChanged:false};return current;
 },clear(){group.clearLayers();current=null;},diagnostics:()=>current,remove(){group.remove();current=null;}};
}
