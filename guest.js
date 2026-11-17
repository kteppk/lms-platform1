const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const guestPerson={uid:'guest',name:'Гость',role:'guest'};
async function callFunction(action,data={},_account,options={}){
 if(!['listNews','listScheduleGroups','getWeeklySchedule','listSchedule'].includes(action))throw new Error('Войдите или зарегистрируйтесь.');
 const url=new URL('https://qqhkuuktgzcyrkfdnjjq.supabase.co/functions/v1/lms-public');url.searchParams.set('action',action);url.searchParams.set('data',JSON.stringify(data));
 const key='lms-public:'+action+':'+JSON.stringify(data);let cached;try{cached=JSON.parse(localStorage.getItem(key));}catch{}
 try{const res=await fetch(url,{signal:AbortSignal.timeout(12000),cache:options.fresh?'reload':'default'}),json=await res.json();if(!res.ok)throw Error(json.error);try{const keys=Object.keys(localStorage).filter(k=>k.startsWith('lms-public:'));while(keys.length>=30)localStorage.removeItem(keys.shift());localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),value:json.data}));}catch{}return json.data;}
 catch(error){if(cached&&Date.now()-cached.savedAt<7*86400000){const v=cached.value;Object.defineProperty(v,'_offline',{value:{stale:true,savedAt:cached.savedAt},enumerable:false});return v;}throw error;}
}
const Portal={toast(title,body=''){document.getElementById('toastRegion').textContent=title+' '+body;},async navigate(tab){if(!['home','schedule'].includes(tab))return;ActionMenu.closeAll();MobileNavigation.closeMenu();document.querySelectorAll('.tabs button').forEach(n=>n.classList.toggle('active',n.dataset.tab===tab));const root=document.getElementById('portalPage');try{if(tab==='home')await News.home(root,guestPerson);else await Schedule.render(root,guestPerson);}catch(error){root.innerHTML='<p role="alert">'+escapeHtml(error.message)+'</p><button onclick="location.reload()">Повторить</button>';}}};
const Subscriptions={async groupPanel(root){root.innerHTML='<div class="schedule-subscribe-line"><p>Войдите или зарегистрируйтесь, чтобы подписаться на изменения этой группы.</p><a class="connection-link" href="index.html">Войти</a></div>';}};
document.addEventListener('DOMContentLoaded',()=>{MobileNavigation.init(guestPerson,Portal.navigate);Portal.navigate(new URLSearchParams(location.search).get('tab')==='schedule'?'schedule':'home');});
