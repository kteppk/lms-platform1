const fs=require('node:fs'),path=require('node:path');
const output=path.resolve(process.argv[2]||'.qa-output/pages-redirect'),base='https://kteppk.ru/';
fs.mkdirSync(output,{recursive:true});
for(const route of ['index.html','student.html','teacher.html','admin.html','guest.html','offline.html','404.html','lite/index.html']){
 const dest=route==='404.html'?'index.html':route,href=base+dest;
 const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5;url=${href}"><title>КТЭиП ПК — новый адрес</title><style>body{max-width:42rem;margin:12vh auto;padding:1.5rem;background:#faf7ef;color:#29353b;font:18px/1.6 system-ui}a{color:#9a4532}</style><h1>Платформа переехала</h1><p>Сайт работает на собственном сервере. Аккаунты и пароли сохранены.</p><p><a href="${href}">Открыть платформу</a></p><script>const url=new URL(${JSON.stringify(href)});url.search=location.search;url.hash=location.hash;location.replace(url.href);</script></html>`;
 const target=path.join(output,route);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,html);
}
fs.writeFileSync(path.join(output,'.nojekyll'),'');
const sw=`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('lms-shell:')||k.startsWith('lms-lite:'))await caches.delete(k);for(const c of await self.clients.matchAll({type:'window',includeUncontrolled:true})){const old=new URL(c.url),u=new URL('${base}index.html');u.search=old.search;u.hash=old.hash;await c.navigate(u.href);}await self.registration.unregister();})()));`;
fs.writeFileSync(path.join(output,'sw.js'),sw);fs.writeFileSync(path.join(output,'lite/sw.js'),sw);
console.log('GitHub Pages redirect prepared.');
