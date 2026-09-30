/* Self-hosted classic Worker; no CDN or cross-origin worker URL. */
importScripts('../vendor/building-vendor.js','./building-data-provider.js');
const jobs=new Map();
onmessage=async e=>{if(e.data.cancel){jobs.get(e.data.cancel)?.abort();return;}const {id,data,tile,context}=e.data,ac=new AbortController();jobs.set(id,ac);try{const result=await ASTRABuildingData.decode(data,tile,context,ac.signal);if(!ac.signal.aborted)postMessage({id,result});}catch(error){if(!ac.signal.aborted)postMessage({id,error:String(error.message||error)});}finally{jobs.delete(id);}};
