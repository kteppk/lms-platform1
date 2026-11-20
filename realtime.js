// One same-origin stream per visible page. It carries invalidations, never records.
const Realtime=(()=>{
 let person=null,source=null,group=null,attempt=0,retryTimer,dispatchTimer,connected=false,epoch=0,lastFallback=Date.now();
 const topics=new Set(),jobs=new Map(),dirty=new WeakSet();let flushing=false;
 const online=()=>navigator.onLine!==false,visible=()=>!document.hidden;
 function stop(){epoch++;source?.close();source=null;clearTimeout(retryTimer);connected=false;}
 function emit(values){for(const t of values)topics.add(t);clearTimeout(dispatchTimer);dispatchTimer=setTimeout(()=>{
  if(!visible())return;const list=[...topics];topics.clear();if(!list.length)return;
  if(typeof AppConnection!=='undefined')AppConnection.invalidate();
  document.dispatchEvent(new CustomEvent('lms-live-update',{detail:{topics:list}}));
 },120);}
 function sessionEnded(){stop();document.querySelectorAll('[data-chat-messages]').forEach(n=>n.replaceChildren());if(person?.role!=='guest')location.replace('index.html');}
 function connect(){
  if(!person||!online()||!visible()||typeof EventSource==='undefined')return;
  const token=++epoch,url=new URL('/events',location.origin);if(group)url.searchParams.set('group',group);if(person.role==='guest')url.searchParams.set('public','1');
  const stream=new EventSource(url);source=stream;
  stream.addEventListener('ready',()=>{if(token!==epoch)return;connected=true;attempt=0;emit(['resync']);});
  stream.addEventListener('refresh',event=>{if(token!==epoch)return;try{const v=JSON.parse(event.data);if(Array.isArray(v.topics))emit(v.topics.filter(t=>typeof t==='string'&&t.length<32));}catch{}});
  stream.addEventListener('permissions',()=>{if(token!==epoch)return;stop();document.querySelectorAll('[data-chat-messages]').forEach(n=>n.replaceChildren());location.reload();});
  stream.addEventListener('session',()=>{if(token===epoch)sessionEnded();});
  stream.onerror=()=>{if(token!==epoch)return;stream.close();source=null;connected=false;
   if(person.role!=='guest')fetch('/auth/session',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(r=>{if(token===epoch&&r&&r.user===null)sessionEnded();}).catch(()=>{});
   retryTimer=setTimeout(()=>{if(token===epoch)connect();},Math.min(30000,1000*2**Math.min(attempt++,5))+Math.random()*700);
  };
 }
 function start(value){if(person?.uid===value.uid&&person?.role===value.role&&source)return;stop();person=value;connect();}
 function watchGroup(value){value=value||null;if(group===value)return;group=value;if(person){stop();connect();}}
 function safe(root){if(!root?.isConnected||!visible()||!online())return false;if(document.querySelector('dialog[open]'))return false;
  if(root.contains(document.activeElement)&&(document.activeElement.matches?.('input,textarea,[contenteditable="true"]')||document.activeElement.matches?.('select')&&document.activeElement.closest('form')))return false;
  return ![...root.querySelectorAll('form')].some(form=>{if(form.closest('[hidden]')||form.closest('dialog')&&!form.closest('dialog').open)return false;return dirty.has(form)||form.querySelector('[type="submit"]:disabled');});
 }
 async function flush(){if(flushing)return;flushing=true;try{for(const [key,job]of [...jobs]){
   if(!job.root.isConnected){jobs.delete(key);continue;}if(!safe(job.root))continue;jobs.delete(key);
   const x=scrollX,y=scrollY,min=job.root.style.minHeight,filters=[...job.root.querySelectorAll('input[type="search"]')].map(n=>[n.id,n.value]);
   job.root.style.minHeight=job.root.offsetHeight+'px';
   try{await job.run();for(const [id,value]of filters){const node=id&&document.getElementById(id);if(node&&job.root.contains(node)){node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));}}if(job.options.scroll!==false)window.scrollTo(x,y);}
   catch{/* Keep the last view; reconnection and fallback retry authoritative reads. */}
   finally{job.root.style.minHeight=min;}
  }}finally{flushing=false;}
 }
 function update(key,root,run,options={}){if(!root?.isConnected)return;jobs.set(key,{root,run,options});flush();}
 document.addEventListener('input',event=>{const form=event.target.closest?.('form');if(form)dirty.add(form);},true);
 document.addEventListener('change',event=>{const form=event.target.closest?.('form');if(form)dirty.add(form);},true);
 document.addEventListener('close',()=>flush(),true);document.addEventListener('focusout',()=>setTimeout(flush,0));
 document.addEventListener('visibilitychange',()=>{if(!visible())stop();else{emit(['resync']);connect();flush();}});
 window.addEventListener('online',()=>{emit(['resync']);stop();connect();flush();});window.addEventListener('offline',stop);window.addEventListener('pagehide',stop);
 window.addEventListener('pageshow',event=>{if(event.persisted){stop();connect();emit(['resync']);}});
 setInterval(()=>{if(person&&visible()&&online()&&!connected&&Date.now()-lastFallback>60000){lastFallback=Date.now();emit(['resync']);}if(jobs.size)flush();},2000);
 return {start,stop,logout(){stop();person=null;jobs.clear();topics.clear();},watchGroup,update,emit,safe,get connected(){return connected;}};
})();
