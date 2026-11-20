/* Generated for release __VERSION__. Static files only; no API, tokens or uploads. */
if(['kteppk.github.io','vm756327.vps.masterhost.tech'].includes(self.location.hostname)){importScripts('./moved-sw.js');}else{
const VERSION=__VERSION__;
const BUILD=__BUILD__;
// Push messages carry no auth tokens or chat content. Never navigate off-site.
self.addEventListener('push',event=>{event.waitUntil((async()=>{let data={};try{data=event.data?.json()||{};}catch{}if(data.category==='lesson'&&data.expiresAt&&Date.parse(data.expiresAt)<=Date.now())return;const route=data.category==='chat'?'curator-chat':data.destination==='schedule'?'schedule':'home';await self.registration.showNotification(String(data.title||'КТЭиП ПК').slice(0,150),{body:String(data.body||'На платформе новое уведомление.').slice(0,500),tag:route==='curator-chat'?'curator-chat':String(data.id||'lms-update'),icon:new URL('app-icon-192.png',self.registration.scope).href,data:{route,groupId:/^[A-Za-z0-9_-]{1,128}$/.test(data.groupId||'')?data.groupId:null}});})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const destination=event.notification.data?.route;const route=['schedule','curator-chat'].includes(destination)?destination:'home';const url=new URL('index.html',self.registration.scope);url.searchParams.set('open',route);const group=event.notification.data?.groupId;if(route==='schedule'&&group&&/^[A-Za-z0-9_-]{1,128}$/.test(group))url.searchParams.set('group',group);const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const target=windows.find(w=>new URL(w.url).origin===self.location.origin&&w.url.startsWith(self.registration.scope));if(target){await target.navigate(url.href);await target.focus();}else await self.clients.openWindow(url.href);})());});
importScripts('./sw-manifest.js?v='+VERSION+'&build='+BUILD);
const PREFIX='lms-shell:'+self.registration.scope+':',CACHE=PREFIX+VERSION+':'+BUILD;
const urls=new Set(OFFLINE_ASSETS.map(p=>new URL(p,self.registration.scope).href));
const connection=OFFLINE_ASSETS.find(p=>p.startsWith('connection.js?'));
const matchesShell=html=>html.includes('src="'+connection+'"');
const pageURL=request=>{const u=new URL(request.url);if(u.href===self.registration.scope||u.pathname===new URL(self.registration.scope).pathname)u.pathname+='index.html';if(u.pathname.endsWith('.html'))u.search='';return u.href;};
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE),queue=[...urls];
 async function download(){while(queue.length){const url=queue.shift(),response=await fetch(url,{cache:'reload'});if(!response.ok)throw Error('Incomplete shell');if(url.endsWith('.html')&&!matchesShell(await response.clone().text()))throw Error('Mixed release');await cache.put(url,response);}}
 await Promise.all([download(),download()]);
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 const canonical=pageURL(request);if(!urls.has(canonical))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(request.mode!=='navigate')return await cache.match(canonical)||fetch(request);
  let timer;
  const network=fetch(request).then(async response=>{if(!response.ok)throw Error('Navigation failed');if(matchesShell(await response.clone().text()))await cache.put(canonical,response.clone());return response;});
  event.waitUntil(network.catch(()=>{}));
  const cached=await cache.match(canonical),fallback=()=>cached||cache.match(new URL('offline.html',self.registration.scope).href);
  try{return await Promise.race([network,new Promise((resolve,reject)=>{timer=setTimeout(async()=>{const value=await fallback();if(value)resolve(value);else reject(Error('Offline'));},2500);})]);}
  catch{return await fallback()||new Response('Нет подключения. Откройте сайт с интернетом для первого сохранения.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
  finally{clearTimeout(timer);}
 })());
});

}
