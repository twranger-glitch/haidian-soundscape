// Read-only user-authorized prepared storage. No Token, writes, or HF requests.
const fail=m=>{throw Error(m);};const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
const aborted=s=>{if(s?.aborted)throw Object.assign(Error('SOURCE_READ_CANCELLED'),{name:'AbortError'});};
async function fileAt(dir,parts){let h=dir;for(const n of parts.slice(0,-1))h=await h.getDirectoryHandle(n);return h.getFileHandle(parts.at(-1));}
export async function readBounded(dir,relative,limit,{signal,expectedSHA256,expectedBytes}={}){
 aborted(signal);if(!relative||relative.includes('\\')||relative.includes(':')||relative.split('/').some(p=>!p||p==='.'||p==='..'))fail('INVALID_LOCAL_PATH');
 const h=await fileAt(dir,relative.split('/')),before=await h.getFile();if(before.size>limit||expectedBytes!==undefined&&before.size!==expectedBytes)fail('LOCAL_SIZE_MISMATCH');const b=await before.arrayBuffer();aborted(signal);const after=await h.getFile();if(after.size!==before.size||after.lastModified!==before.lastModified||b.byteLength!==before.size)fail('LOCAL_SOURCE_CHANGED');if(expectedSHA256&&await hash(b)!==expectedSHA256)fail('LOCAL_SHA_MISMATCH');return b;
}
export async function verifyPreparedRoot(handle,registry,role,{signal}={}){
 const r=registry.regions.find(r=>r.role===role);if(!r||handle?.kind!=='directory')fail('PREPARED_DIRECTORY_REQUIRED');
 const bytes=await readBounded(handle,'manifest.json',16*1024*1024,{signal,expectedSHA256:r.manifestSHA256}),m=JSON.parse(new TextDecoder().decode(bytes));
 if(m.release!==r.release||m.heightClassification!=='ML_ESTIMATED'||m.verifiedProofEligible!==false)fail('PREPARED_POLICY_CHANGED');
 return {handle,role,release:r.release,manifestSHA256:r.manifestSHA256};
}
export async function connectPreparedRoots(root,registry,{signal,maxDirectories=128,maxDepth=6,locations={}}={}){
 if(root?.kind!=='directory')fail('DIRECTORY_PERMISSION_REQUIRED');const queue=[{h:root,depth:0}],found={},inspected=[];let visited=0;
 for(const r of registry.regions){for(const parts of locations[r.role]??[]){try{let h=root;for(const n of parts){if(!n||n==='.'||n==='..'||/[\\/:]/.test(n))fail('INVALID_LOCATION_HINT');h=await h.getDirectoryHandle(n);}const verified=await verifyPreparedRoot(h,registry,r.role,{signal});found[r.role]=h;const {handle,...receipt}=verified;inspected.push(receipt);break;}catch(e){if(!['NotFoundError','TypeMismatchError'].includes(e.name))throw e;}}}
 if(found.south&&found.north)return {handles:found,inspected,mode:'USER_AUTHORIZED_READ_ONLY',rawReprocessed:false,FULL_READBACK:false,hfTransfers:0};
 while(queue.length&&Object.keys(found).length<registry.regions.length){aborted(signal);if(++visited>maxDirectories)fail('PREPARED_DIRECTORY_SEARCH_LIMIT');const {h,depth}=queue.shift();
  if(depth===0||h.name==='prepared'){
   try{const b=await readBounded(h,'manifest.json',16*1024*1024,{signal}),digest=await hash(b),r=registry.regions.find(r=>r.manifestSHA256===digest);if(r){const m=JSON.parse(new TextDecoder().decode(b));if(m.release!==r.release||m.heightClassification!=='ML_ESTIMATED'||m.verifiedProofEligible!==false)fail('PREPARED_POLICY_CHANGED');if(!found[r.role]){found[r.role]=h;inspected.push({role:r.role,release:r.release,manifestSHA256:digest});}}}
   catch(e){if(!['NotFoundError','TypeMismatchError'].includes(e.name))throw e;}
  }
  if(h.name==='prepared'||depth>=maxDepth)continue;
  const dirs=[];for await(const entry of h.values()){if(entry.kind==='directory'&&!entry.name.startsWith('.'))dirs.push(entry);if(dirs.length>maxDirectories)fail('PREPARED_DIRECTORY_SEARCH_LIMIT');}
  dirs.sort((a,b)=>Number(/GBA|e\d+_n\d+/.test(b.name))-Number(/GBA|e\d+_n\d+/.test(a.name))||a.name.localeCompare(b.name));for(const d of dirs)queue.push({h:d,depth:depth+1});
 }
 if(!found.south||!found.north)fail('BOTH_PREPARED_RELEASES_REQUIRED');return {handles:found,inspected,mode:'USER_AUTHORIZED_READ_ONLY',rawReprocessed:false,FULL_READBACK:false,hfTransfers:0};
}
export function createLocalFetcher(handles,registry,{origin,publicFetcher=(u,o)=>globalThis.fetch(u,o)}={}){
 const regions=new Map(registry.regions.map(r=>[r.role,r])),manifestLoads=new Map(),stats={manifestReads:0,pageReads:0,bytesRead:0,failures:0,writes:0,hfTransfers:0};
 async function manifest(role,signal){if(!manifestLoads.has(role))manifestLoads.set(role,(async()=>{const b=await readBounded(handles[role],'manifest.json',16*1024*1024,{signal,expectedSHA256:regions.get(role).manifestSHA256});stats.manifestReads++;stats.bytesRead+=b.byteLength;const m=JSON.parse(new TextDecoder().decode(b)),by=new Map();if(m.release!==regions.get(role).release)fail('MANIFEST_RELEASE_MISMATCH');for(const [tile,t]of Object.entries(m.tiles)){if(!/^15\/\d+\/\d+$/.test(tile))fail('INVALID_TILE');for(const rec of t.pages){if(!new RegExp('^serving/xyz/'+tile+'/part-\\d+\\.geojson\\.gz$').test(rec.path)||by.has(rec.path))fail('INVALID_PAGE_PATH');by.set(rec.path,rec);}}return {b,by};})().catch(e=>{manifestLoads.delete(role);throw e;}));return manifestLoads.get(role);}
 const fetcher=async(url,options={})=>{const u=new URL(url,origin);if(u.username||u.password||options.method&&options.method!=='GET')fail('READ_ONLY_SOURCE_REQUEST');if(u.origin!==origin||!u.pathname.startsWith('/regions/')){if(u.protocol==='https:'&&u.origin==='https://data.source.coop'&&/^\/tge-labs\/meta-chm-v2\/chm\/[0-3]{10}\.tif$/.test(u.pathname)&&!u.search&&!u.hash)return publicFetcher(u.href,options);fail('UNTRUSTED_SOURCE_URL');}
  if(options.method&&options.method!=='GET'||u.search||u.hash||u.username||u.password)fail('READ_ONLY_SOURCE_REQUEST');const m=/^\/regions\/(north|south)\/(.+)$/.exec(u.pathname);if(!m||decodeURIComponent(m[2])!==m[2]||!handles[m[1]])fail('LOCAL_SOURCE_NOT_CONNECTED');
  try{const {b,by}=await manifest(m[1],options.signal);if(m[2]==='manifest.json')return new Response(b,{status:200});const rec=by.get(m[2]);if(!rec)fail('UNLISTED_PREPARED_FILE');const bytes=await readBounded(handles[m[1]],rec.path,4*1024*1024,{signal:options.signal,expectedSHA256:rec.sha256,expectedBytes:rec.bytes});stats.pageReads++;stats.bytesRead+=bytes.byteLength;return new Response(bytes,{status:200});}catch(e){stats.failures++;if(['NotFoundError','TypeMismatchError'].includes(e.name))return new Response(null,{status:404});throw e;}
 };return {fetcher,stats};
}
