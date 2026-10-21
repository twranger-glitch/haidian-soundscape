// Authorization lifecycle only. Never supplies model, height, shade or proof evidence.
import {SERVICE_PREFIX,validateDescriptor} from './remote-data.mjs';
const aborted=()=>Object.assign(Error('CANCELLED'),{name:'AbortError'});
export class RemoteSessionGate{
 constructor({origin,registry,sourceLock,fetcher=(u,o)=>globalThis.fetch(u,o),onBlocked=()=>{},clock=globalThis,isVisible=()=>globalThis.document?.visibilityState!=='hidden'}){
  const u=new URL(origin);if(u.origin!==origin||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('SECURE_SAME_ORIGIN_REQUIRED');
  Object.assign(this,{origin,registry,sourceLock,fetcher,onBlocked,clock,isVisible});this.closed=false;this.pending=null;this.timer=null;this.reason=null;this.stats={requests:0,coalesced:0,failures:0,active:0,peakActive:0};
 }
 async probe(signal){
  const c=new AbortController(),cancel=()=>c.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  const timer=this.clock.setTimeout(()=>c.abort(),2500);this.stats.requests++;this.stats.active++;this.stats.peakActive=Math.max(this.stats.peakActive,this.stats.active);
  try{
   const url=this.origin+SERVICE_PREFIX+'descriptor.json',f=this.fetcher,r=await f(url,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:c.signal});
   if(!r.ok){await r.body?.cancel();throw Error([401,403].includes(r.status)?'PRIVATE_SOURCE_AUTH_REQUIRED':'PRIVATE_SOURCE_SESSION_UNAVAILABLE');}
   if(r.redirected||r.url&&r.url!==url){await r.body?.cancel();throw Error('PRIVATE_SOURCE_SESSION_IDENTITY_CHANGED');}
   const length=r.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>65536)){await r.body?.cancel();throw Error('PRIVATE_SOURCE_SESSION_IDENTITY_CHANGED');}
   if(!r.body)throw Error('PRIVATE_SOURCE_SESSION_IDENTITY_CHANGED');const reader=r.body.getReader(),chunks=[];let n=0;
   const cancelBody=()=>{reader.cancel().catch(()=>{});};c.signal.addEventListener('abort',cancelBody,{once:true});
   try{while(true){if(c.signal.aborted)throw aborted();const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>65536)throw Error('PRIVATE_SOURCE_SESSION_IDENTITY_CHANGED');chunks.push(value);}}
   catch(e){await reader.cancel().catch(()=>{});throw e;}finally{c.signal.removeEventListener('abort',cancelBody);reader.releaseLock();}
   if(c.signal.aborted)throw aborted();const bytes=new Uint8Array(n);let at=0;for(const b of chunks){bytes.set(b,at);at+=b.length;}
   try{validateDescriptor(JSON.parse(new TextDecoder().decode(bytes)),this.registry,this.sourceLock);}catch{throw Error('PRIVATE_SOURCE_SESSION_IDENTITY_CHANGED');}
   if(this.closed)throw Error(this.reason??'PRIVATE_SOURCE_SESSION_CLOSED');return true;
  }catch(e){
   if(signal.aborted)throw aborted();
   const reason=e.message?.startsWith('PRIVATE_SOURCE_')?e.message:'PRIVATE_SOURCE_SESSION_UNAVAILABLE';this.stats.failures++;this.block(reason);throw Error(reason);
  }finally{this.clock.clearTimeout(timer);signal.removeEventListener('abort',cancel);this.stats.active--;}
 }
 async authorize(signal,{fresh=false}={}){
  if(signal?.aborted)throw aborted();if(this.closed)throw Error(this.reason??'PRIVATE_SOURCE_SESSION_CLOSED');
  // Last-subscriber abort may still be unwinding. Never join that old request.
  if(this.pending?.controller.signal.aborted)await this.pending.promise.catch(()=>{});
  // A post-compute check cannot reuse a probe that began before computation ended.
  if(fresh&&this.pending)await this.subscribe(this.pending,signal);
  if(signal?.aborted)throw aborted();if(this.closed)throw Error(this.reason??'PRIVATE_SOURCE_SESSION_CLOSED');
  let e=this.pending;
  if(!e){e={controller:new AbortController(),refs:0};this.pending=e;e.promise=this.probe(e.controller.signal).finally(()=>{if(this.pending===e)this.pending=null;});e.promise.catch(()=>{});}else this.stats.coalesced++;
  return this.subscribe(e,signal);
 }
 subscribe(e,signal){
  if(signal?.aborted)return Promise.reject(aborted());e.refs++;
  return new Promise((resolve,reject)=>{let done=false;const release=()=>{if(done)return;done=true;signal?.removeEventListener('abort',cancel);e.refs--;};const cancel=()=>{release();if(!e.refs)e.controller.abort();reject(aborted());};signal?.addEventListener('abort',cancel,{once:true});e.promise.then(v=>{if(!done){release();resolve(v);}},err=>{if(!done){release();reject(err);}});});
 }
 block(reason){if(this.closed)return;this.reason=reason;this.close();try{this.onBlocked(Error(reason));}catch{}}
 start(){if(this.timer!==null||this.closed)return;const tick=async()=>{this.timer=null;if(this.closed)return;if(this.isVisible())await this.authorize().catch(()=>{});if(!this.closed)this.timer=this.clock.setTimeout(tick,10000);};this.timer=this.clock.setTimeout(tick,10000);}
 close(){if(this.closed)return;this.closed=true;if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;this.pending?.controller.abort();}
}

export class AuthorizedWorkerRPC{
 constructor(base,gate){this.base=base;this.gate=gate;this.controller=null;this.serial=0;this.stopped=false;}
 get closed(){return this.stopped||this.base.closed||this.gate.closed;}
 cancel(reason='SUPERSEDED'){this.serial++;this.controller?.abort();this.controller=null;this.base.cancel(reason);}
 async run(data){
  if(this.closed)throw Error('PRIVATE_SOURCE_SESSION_CLOSED');this.cancel();const serial=this.serial,c=new AbortController();this.controller=c;
  let expired=false;const timer=this.gate.clock.setTimeout(()=>{expired=true;this.destroy();},12000);
  const current=()=>{if(c.signal.aborted||serial!==this.serial)throw aborted();if(this.closed)throw Error(this.gate.reason??'PRIVATE_SOURCE_SESSION_CLOSED');};
  try{await this.gate.authorize(c.signal);current();const result=await this.base.run(data);current();await this.gate.authorize(c.signal,{fresh:true});current();return result;}
  catch(e){if(expired)throw Error('ESTIMATED_OPERATION_TIME_LIMIT_RECONNECT_REQUIRED');throw e;}
  finally{this.gate.clock.clearTimeout(timer);if(this.controller===c)this.controller=null;}
 }
 recheck(){return this.gate.authorize();}
 destroy(){if(this.stopped)return;this.stopped=true;this.cancel('ESTIMATED_DISABLED');this.gate.close();this.base.destroy();}
}
