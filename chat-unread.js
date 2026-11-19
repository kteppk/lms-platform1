// Read position is stored per account on the server; message text is never cached.
const CuratorChatNotifications=(()=>{
 let person=null,epoch=0,ready=false,busy=false,queued=false,notifyQueued=false,lastIncoming=0n,lastRead=0n,wanted=0n,marking=false;
 const cursor=value=>typeof value==='string'&&/^\d{1,18}$/.test(value)?BigInt(value):0n;
 const reading=()=>typeof CuratorChat!=='undefined'&&CuratorChat.isVisible();
 function paint(count){
  const value=Math.max(0,Number(count)||0),label=value>99?'99+':String(value);
  for(const node of document.querySelectorAll('.tabs [data-tab="curator-chat"],.mobile-menu-grid [data-mobile-tab="curator-chat"]')){
   node.dataset.chatLabel='Чат кураторов';let badge=node.querySelector('[data-chat-unread]');
   if(!badge){badge=document.createElement('span');badge.className='chat-unread';badge.dataset.chatUnread='';badge.setAttribute('aria-hidden','true');node.append(' ',badge);}
   badge.hidden=!value;badge.textContent=value?label:'';node.setAttribute('aria-label',`Чат кураторов: непрочитанных сообщений ${value}`);
  }
  if(typeof MobileNavigation!=='undefined')MobileNavigation.setChatUnread?.(value);
  if(!value)document.querySelectorAll('[data-chat-toast]').forEach(n=>n.remove());
 }
 function stop(){epoch++;person=null;ready=false;queued=false;notifyQueued=false;paint(0);document.querySelectorAll('[data-chat-unread]').forEach(n=>n.remove());}
 async function announce(data,token){
  const latest=data.latestIncoming;if(!latest||!data.unreadCount||reading()||document.hidden)return;
  const account=person?.uid;if(!account)return;const key='lms-chat-announced-v1:'+account;
  const show=()=>{if(token!==epoch||person?.uid!==account||reading()||document.hidden)return;let stored=0n;
   try{stored=cursor(localStorage.getItem(key));}catch{}if(stored>=cursor(latest.id))return;
   try{localStorage.setItem(key,latest.id);}catch{}
   const toast=Portal.toast('Новое сообщение в чате кураторов',`От: ${latest.authorName}. Непрочитанных: ${data.unreadCount}.`,'info','curator-chat');toast?.setAttribute('data-chat-toast','');
  };
  if(navigator.locks?.request)await navigator.locks.request(key,show);else show();
 }
 async function refresh(notify=true){
  if(!person||document.hidden||navigator.onLine===false)return;
  if(busy){queued=true;notifyQueued||=notify;return;}busy=true;const token=epoch;
  try{const data=await callFunction('getCuratorChatSummary',{},undefined,{fresh:true});if(token!==epoch||!person)return;
   const read=cursor(data.lastReadId);if(read<lastRead){queued=true;return;}lastRead=read;
   const incoming=cursor(data.latestIncoming?.id),fresh=ready&&incoming>lastIncoming;lastIncoming=incoming>lastIncoming?incoming:lastIncoming;
   paint(data.unreadCount);ready=true;if(notify&&fresh)await announce(data,token);
  }catch(error){if(token===epoch&&error.code==='permission-denied')stop();}
  finally{busy=false;if(queued&&person){const again=notifyQueued;queued=false;notifyQueued=false;queueMicrotask(()=>refresh(again));}}
 }
 function start(value){
  if(!['admin','curator'].includes(value.role)){if(person)stop();return;}
  if(person?.uid===value.uid&&person.role===value.role)return;
  stop();person=value;lastIncoming=0n;lastRead=0n;wanted=0n;ready=false;refresh(false);
 }
 async function read(messageId){
  if(!person||!reading())return;const id=cursor(messageId);if(id>wanted)wanted=id;if(marking||wanted<=lastRead)return;
  marking=true;const token=epoch;
  try{while(token===epoch&&person&&reading()&&wanted>lastRead){const target=wanted;
    const data=await callFunction('markCuratorChatRead',{messageId:target.toString()});if(token!==epoch)return;
    lastRead=cursor(data.lastReadId)>lastRead?cursor(data.lastReadId):lastRead;paint(data.unreadCount);
    if(lastRead<target)break;
   }}catch(error){if(token===epoch&&error.code==='permission-denied')stop();}
  finally{marking=false;if(token===epoch)refresh(false);}
 }
 document.addEventListener('lms-live-update',event=>{if(event.detail.topics.some(t=>['chat','chat-unread','resync'].includes(t)))refresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.addEventListener('online',()=>refresh());window.addEventListener('pagehide',stop);
 setInterval(()=>{if(person&&(typeof Realtime==='undefined'||!Realtime.connected))refresh();},15000);
 return {start,refresh,read,stop};
})();
