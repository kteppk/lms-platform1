// Retire offline shells on former origins after switching to the primary domain.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('lms-shell:')||key.startsWith('lms-lite:'))await caches.delete(key);
 for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
  const old=new URL(client.url),relative=old.pathname.replace(/^\/lms-platform1\/?/,'').replace(/^\/+/,''),url=new URL('https://kteppk.ru/'+relative);url.search=old.search;url.hash=old.hash;await client.navigate(url.href);
 }
 await self.registration.unregister();
})()));
