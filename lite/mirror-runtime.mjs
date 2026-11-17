const ORIGIN='https://qqhkuuktgzcyrkfdnjjq.supabase.co/functions/v1/lms-public';
export function createMirrorHandler(assets,options={}){
 const fetcher=options.fetcher||fetch,now=options.now||Date.now,tasks=new Map(),version=options.version||'1';
 const common={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 function answer(entry,request,stale=false){const headers={...common,'Content-Type':'application/json; charset=utf-8','Cache-Control':stale?'no-cache':'public, max-age=10','ETag':entry.etag,'X-Lite-Stale':stale?'1':'0','X-Lite-Checked-At':String(entry.at)};return new Response(request.method==='HEAD'||(!stale&&request.headers.get('If-None-Match')===entry.etag)?null:entry.body,{status:!stale&&request.headers.get('If-None-Match')===entry.etag?304:200,headers});}
 async function update(cache,key,source,cached){
  const headers={};if(cached?.etag)headers['If-None-Match']=cached.etag;
  const upstream=await fetcher(source,{headers,signal:AbortSignal.timeout(7000),redirect:'error'});
  if(upstream.status===404){await cache?.delete(key);return {error:404};}
  if(!upstream.ok&&upstream.status!==304)throw Error('Upstream unavailable');
  const body=upstream.status===304?cached?.body:await upstream.text();if(!body||body.length>300000)throw Error('Invalid response');JSON.parse(body);
  const entry={body,etag:upstream.headers.get('ETag')||'',at:now()};
  if(cache)await cache.put(key,new Response(JSON.stringify(entry),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=300'}}));
  return entry;
 }
 return {async fetch(request,env,ctx){
  void env;const url=new URL(request.url);
  if(!['GET','HEAD'].includes(request.method))return new Response('Read only',{status:405,headers:{...common,'Cache-Control':'no-store'}});
  if(url.pathname==='/api'){
   if([...url.searchParams.keys()].some(k=>!['view','group','post','week','offset','fresh'].includes(k)))return new Response('Invalid request',{status:400});
   const source=new URL(ORIGIN);source.search=url.search;
   const canonical=new URL(url);canonical.searchParams.delete('fresh');canonical.searchParams.set('_build',version);canonical.searchParams.sort();const key=new Request(canonical),cache=options.cache??globalThis.caches?.default;
   let cached;try{const response=await cache?.match(key);if(response)cached=await response.json();}catch{}
   const age=cached?now()-cached.at:Infinity,fresh=url.searchParams.get('fresh')==='1';
   if(cached&&!fresh&&age<15000)return answer(cached,request);
   let task=tasks.get(canonical.href);
   if(!task){if(tasks.size>=64)return new Response('Busy',{status:503});task=update(cache,key,source,cached);tasks.set(canonical.href,task);task.finally(()=>tasks.delete(canonical.href)).catch(()=>{});}
   if(cached&&!fresh&&age<300000){ctx.waitUntil(task.catch(()=>{}));return answer(cached,request,true);}
   try{const entry=await task;if(entry.error===404)return new Response('{"error":"Информация больше не доступна."}',{status:404,headers:{...common,'Content-Type':'application/json','Cache-Control':'no-store'}});return answer(entry,request);}
   catch{if(cached&&age<300000)return answer(cached,request,true);return new Response('{"error":"Нет связи с источником. Повторите позже."}',{status:503,headers:{...common,'Content-Type':'application/json','Cache-Control':'no-store'}});}
  }
  const path=url.pathname==='/'?'/index.html':url.pathname,asset=assets[path];
  if(!asset)return new Response('Not found',{status:404,headers:common});
  const headers={...common,'Content-Type':asset.type,'Cache-Control':path.endsWith('.html')||path==='/sw.js'?'no-cache':'public, max-age=31536000, immutable','ETag':asset.etag,
   'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
  return new Response(request.method==='HEAD'||request.headers.get('If-None-Match')===asset.etag?null:asset.body,{status:request.headers.get('If-None-Match')===asset.etag?304:200,headers});
 }};
}
