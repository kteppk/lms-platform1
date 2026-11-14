/* Generated for release "0.7.5". Static files only; no API, tokens or uploads. */
const VERSION="0.7.5";
importScripts('./sw-manifest.js?v='+VERSION);
const PREFIX='lms-shell:'+self.registration.scope+':',CACHE=PREFIX+VERSION;
const urls=new Set(OFFLINE_ASSETS.map(p=>new URL(p,self.registration.scope).href));
const pageURL=request=>{const u=new URL(request.url);if(u.href===self.registration.scope||u.pathname===new URL(self.registration.scope).pathname)u.pathname+='index.html';if(u.pathname.endsWith('.html'))u.search='';return u.href;};
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE),queue=[...urls];
 async function download(){while(queue.length){const url=queue.shift(),response=await fetch(url);if(!response.ok)throw Error('Incomplete shell');if(url.endsWith('.html')&&!(await response.clone().text()).includes('v='+VERSION))throw Error('Mixed release');await cache.put(url,response);}}
 await Promise.all([download(),download()]);
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 const canonical=pageURL(request);if(!urls.has(canonical))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(request.mode!=='navigate')return await cache.match(canonical)||fetch(request);
  let timer;
  const network=fetch(request).then(async response=>{if(!response.ok)throw Error('Navigation failed');if((await response.clone().text()).includes('v='+VERSION))await cache.put(canonical,response.clone());return response;});
  event.waitUntil(network.catch(()=>{}));
  const cached=await cache.match(canonical),fallback=()=>cached||cache.match(new URL('offline.html',self.registration.scope).href);
  try{return await Promise.race([network,new Promise((resolve,reject)=>{timer=setTimeout(async()=>{const value=await fallback();if(value)resolve(value);else reject(Error('Offline'));},2500);})]);}
  catch{return await fallback()||new Response('Нет подключения. Откройте сайт с интернетом для первого сохранения.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
  finally{clearTimeout(timer);}
 })());
});
