// Optional origin-local handle references only. Never stores data, tokens or
// credentials, never requests write access and never elevates estimated proof.
import {verifyPreparedRoot} from './local-data.mjs';
const DB='astra-gba-readonly-handles',STORE='connections',KEY='taiwan';
const fail=code=>{throw Error(code);};
export function preparedIdentity(registry){
 if(registry?.heightClassification!=='ML_ESTIMATED'||registry.verifiedProofEligible!==false)fail('REMEMBERED_POLICY_CHANGED');
 return ['south','north'].map(role=>{const rs=registry.regions?.filter(r=>r.role===role);if(rs?.length!==1||!/^[a-f0-9]{64}$/.test(rs[0].manifestSHA256)||!rs[0].release)fail('REMEMBERED_REGISTRY_INVALID');const r=rs[0];return{role,id:r.id,release:r.release,manifestSHA256:r.manifestSHA256};});
}
export function validateRemembered(record,registry){
 if(record?.schema!=='astra-readonly-handles-v1'||JSON.stringify(record.identity)!==JSON.stringify(preparedIdentity(registry)))fail('REMEMBERED_SOURCE_CHANGED');
 for(const role of ['south','north'])if(record.handles?.[role]?.kind!=='directory'||typeof record.handles[role].queryPermission!=='function')fail('REMEMBERED_HANDLE_INVALID');
 return record.handles;
}
export function makeRemembered(handles,registry){
 const record={schema:'astra-readonly-handles-v1',identity:preparedIdentity(registry),handles:{south:handles.south,north:handles.north}};validateRemembered(record,registry);return record;
}
// All gesture-bound permission requests are invoked before the first await.
// Startup uses queryPermission only; prompt/denied never become permission.
export async function rememberedAccess(handles,{request=false}={}){
 const checks=['south','north'].map(role=>{
  const h=handles[role],fn=request?h?.requestPermission:h?.queryPermission;
  if(typeof fn!=='function')return Promise.resolve('denied');
  try{return Promise.resolve(fn.call(h,{mode:'read'})).catch(()=> 'denied');}catch(_){return Promise.resolve('denied');}
 });
 const values=await Promise.all(checks);return values.every(v=>v==='granted');
}
export async function verifyRemembered(record,registry){
 const handles=validateRemembered(record,registry);
 for(const role of ['south','north'])await verifyPreparedRoot(handles[role],registry,role);
 return handles;
}
export function createPreparedMemory(options={}){
 let indexedDB;try{indexedDB=Object.hasOwn(options,'indexedDB')?options.indexedDB:globalThis.indexedDB;}catch(_){}
 const timeoutMs=options.timeoutMs??2500;
 async function action(mode,record){
  if(!indexedDB)fail('LOCAL_MEMORY_UNAVAILABLE');
  return new Promise((resolve,reject)=>{
   let db,tx,done=false,result;const end=(error)=>{if(done)return;done=true;clearTimeout(timer);db?.close();error?reject(Error('LOCAL_MEMORY_UNAVAILABLE')):resolve(result);};
   const timer=setTimeout(()=>{try{tx?.abort();}catch(_){}end(true);},timeoutMs);let req;
   try{req=indexedDB.open(DB,1);}catch(_){end(true);return;}
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
   req.onerror=()=>end(true);req.onblocked=()=>end(true);
   req.onsuccess=()=>{db=req.result;if(done){db.close();return;}db.onversionchange=()=>db.close();
    try{tx=db.transaction(STORE,mode==='load'?'readonly':'readwrite');const store=tx.objectStore(STORE),op=mode==='load'?store.get(KEY):mode==='save'?store.put(record,KEY):store.delete(KEY);
     op.onsuccess=()=>{result=op.result??null;};tx.oncomplete=()=>end();tx.onerror=tx.onabort=()=>end(true);
    }catch(_){end(true);}
   };
  });
 }
 return{load:()=>action('load'),save:record=>action('save',record),clear:()=>action('clear')};
}
