// Independent geometric solar position, Meeus/NOAA equations. No refraction.
const rad=Math.PI/180,deg=180/Math.PI,norm=x=>(x%360+360)%360;
export function solarPosition(time,lon,lat){
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>85.05112878)throw Error('UNSUPPORTED_SOLAR_COORDINATES');
 if(typeof time==='string'&&!/(Z|[+-]\d\d:\d\d)$/.test(time))throw Error('EXPLICIT_TIMEZONE_REQUIRED');
 const d=new Date(time);if(!Number.isFinite(d.getTime())||d.getUTCFullYear()<1901||d.getUTCFullYear()>2099)throw Error('UNSUPPORTED_TIME');
 const jd=d.getTime()/86400000+2440587.5,t=(jd-2451545)/36525;
 const L=norm(280.46646+t*(36000.76983+.0003032*t))*rad,M=(357.52911+t*(35999.05029-.0001537*t))*rad;
 const e=.016708634-t*(.000042037+.0000001267*t);
 const C=(1.914602-t*(.004817+.000014*t))*Math.sin(M)+(.019993-.000101*t)*Math.sin(2*M)+.000289*Math.sin(3*M);
 const omega=(125.04-1934.136*t)*rad,lambda=L+C*rad-(.00569+.00478*Math.sin(omega))*rad;
 const eps0=23+(26+(21.448-t*(46.815+t*(.00059-t*.001813)))/60)/60,eps=(eps0+.00256*Math.cos(omega))*rad;
 const decl=Math.asin(Math.sin(eps)*Math.sin(lambda)),y=Math.tan(eps/2)**2;
 const eq=4*deg*(y*Math.sin(2*L)-2*e*Math.sin(M)+4*e*y*Math.sin(M)*Math.cos(2*L)-.5*y*y*Math.sin(4*L)-1.25*e*e*Math.sin(2*M));
 const minutes=d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60+d.getUTCMilliseconds()/60000;
 const solarMinutes=((minutes+eq+4*lon)%1440+1440)%1440,H=(solarMinutes/4-180)*rad,phi=lat*rad;
 const altitude=Math.asin(Math.max(-1,Math.min(1,Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(H))))*deg;
 const azimuth=norm(Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(decl)*Math.cos(phi))*deg+180);
 return {altitudeDeg:altitude,azimuthDeg:azimuth,timeUTC:d.toISOString(),model:'Meeus-NOAA-geometric-no-refraction',verifiedProofEligible:false};
}
