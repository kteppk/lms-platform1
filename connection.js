const AppConnection=(()=>{
  const prefix='lms-reference-v1:',ownerKey='lms-reference-owner-v1',modeKey='lms-reference-mode-v1';
  const policies={listScheduleGroups:300000,getWeeklySchedule:30000,listSchedule:30000,listSubjects:60000,listNews:60000};
  const reads=new Set(['profile','listSubjects','listSubjectTeachers','getSubjectContent','listMaterials','listStudentTests','listTeacherTests','listStudents','getStudentAttempt','listActiveAttempts','listResults','getResult','listResultTests','getTestResults','exportTestResults','listTeachers','getTeacherProfile','listSchedule','listScheduleGroups','getWeeklySchedule','listNotifications','listNotificationSubscriptions','listRoleChanges','listNews','registrationStatistics','searchPeople','getPerson','getPortalSettings','listAccounts']);
  const memory=new Map(),pending=new Map();let owner=null,epoch=0,worker=null;
  const online=()=>navigator.onLine!==false;
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function storage(){try{return sessionStorage.getItem(modeKey)==='session'?sessionStorage:localStorage;}catch{return null;}}
  function read(key,store=storage()){try{return store?.getItem(key);}catch{return null;}}
  function write(key,value,store=storage()){try{store?.setItem(key,value);}catch{/* Private mode or quota must not block the app. */}}
  function stores(){const result=[];try{result.push(localStorage);}catch{}try{result.push(sessionStorage);}catch{}return result;}
  function purgeReferences(){for(const store of stores())try{for(const k of Object.keys(store))if(k.startsWith(prefix)||k===ownerKey)store.removeItem(k);}catch{}memory.clear();}
  function rememberDevice(personal){purgeReferences();owner=null;epoch++;try{sessionStorage.setItem(modeKey,personal?'local':'session');}catch{}}
  function begin(uid){if(owner===uid)return;if(read(ownerKey)&&read(ownerKey)!==uid)purgeReferences();owner=uid;epoch++;write(ownerKey,uid);}
  function entries(uid){if(memory.has(uid))return memory.get(uid);let value={};try{value=JSON.parse(read(prefix+uid)||'{}');if(!value||Array.isArray(value)||typeof value!=='object')value={};}catch{}memory.set(uid,value);return value;}
  const key=(action,data)=>action+':'+JSON.stringify(data??{});
  function peek(action,data={},uid=owner){if(!uid||!policies[action])return null;const item=entries(uid)[key(action,data)];return item&&item.action===action&&Date.now()-item.savedAt<7*86400000?item:null;}
  function store(action,data,value,uid,generation){
    if(owner!==uid||epoch!==generation||!policies[action])return;
    const serialized=JSON.stringify(value);if(serialized.length>160000)return;
    const all=entries(uid);all[key(action,data)]={action,args:data??{},value,savedAt:Date.now(),refresh:false};
    const sorted=Object.keys(all).sort((a,b)=>all[a].savedAt-all[b].savedAt);
    while(sorted.length>18||JSON.stringify(all).length>550000)delete all[sorted.shift()];
    write(prefix+uid,JSON.stringify(all));
  }
  function clone(item,stale){const value=JSON.parse(JSON.stringify(item.value));if(value&&typeof value==='object')Object.defineProperty(value,'_offline',{value:{savedAt:item.savedAt,stale},enumerable:false});return value;}
  function networkError(){const error=new Error('Нет связи с сервером. Изменения не отправлены. Попробуйте после восстановления интернета.');error.code='unavailable';return error;}
  function recoverable(error){return !error?.code||['unavailable','auth/network-request-failed'].includes(error.code);}
  function invalidate(){if(!owner)return;const all=entries(owner);Object.values(all).forEach(v=>v.refresh=true);write(prefix+owner,JSON.stringify(all));}
  async function request(action,data,account,send,options={}){
    begin(account.uid);const uid=account.uid,generation=epoch,cached=peek(action,data,uid);
    if(!online()){if(cached)return clone(cached,true);throw networkError();}
    if(cached&&!options.fresh&&!cached.refresh&&Date.now()-cached.savedAt<policies[action])return clone(cached,false);
    const id=uid+':'+key(action,data);let task=reads.has(action)?pending.get(id):null;
    if(!task){task=send().then(value=>{if(policies[action])store(action,data,value,uid,generation);else if(!reads.has(action)&&!['saveStudentDraft','submitStudentTest','readNotifications','addNotificationSubscription','removeNotificationSubscription'].includes(action))invalidate();return value;});if(reads.has(action)){pending.set(id,task);task.finally(()=>{if(pending.get(id)===task)pending.delete(id);}).catch(()=>{});}}
    if(!cached)return task;
    if(options.fresh)return task.catch(error=>{if(recoverable(error))return clone(cached,true);throw error;});
    let usedCache=false,timer;
    const fallback=new Promise(resolve=>{timer=setTimeout(()=>{usedCache=true;resolve(clone(cached,true));},900);});
    const guarded=task.then(value=>{clearTimeout(timer);if(usedCache&&owner===uid&&epoch===generation)document.dispatchEvent(new CustomEvent('lms-reference-updated',{detail:{action,data}}));return value;},error=>{clearTimeout(timer);if(recoverable(error)){usedCache=true;return clone(cached,true);}throw error;});
    return Promise.race([guarded,fallback]);
  }
  function note(...values){const metadata=values.map(v=>v?._offline).filter(Boolean);if(!metadata.length)return '';const oldest=Math.min(...metadata.map(m=>m.savedAt)),stale=metadata.some(m=>m.stale)||!online();return `<p class="cache-note${stale?' stale':''}" role="status">${stale?'Сохранённая копия. Возможны изменения.':'Сохранено на устройстве.'} Обновлено: ${e(new Date(oldest).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'}))}.${stale?' Подключитесь к интернету и нажмите «Обновить».':''}</p>`;}
  function savedSchedules(){const uid=owner||read(ownerKey);if(!uid)return [];return Object.values(entries(uid)).filter(v=>v.action==='getWeeklySchedule'&&Date.now()-v.savedAt<7*86400000&&v.value?.group&&Array.isArray(v.value.cells)).sort((a,b)=>b.savedAt-a.savedAt);}
  function hasDrafts(uid){return stores().some(s=>{try{return Object.keys(s).some(k=>k.startsWith('lms-attempt-'+uid+'-'));}catch{return false;}});}
  function clearUser(uid){owner=null;epoch++;pending.clear();purgeReferences();for(const s of stores())try{for(const k of Object.keys(s))if(k==='lms-attempt-'+uid||k.startsWith('lms-attempt-'+uid+'-')||k==='lms-schedule-group:'+uid)s.removeItem(k);}catch{}}
  function recovery(error){
    if(!recoverable(error))return;
    document.getElementById('appLoading')?.remove();document.getElementById('connectionRecovery')?.remove();
    const section=document.createElement('section');section.id='connectionRecovery';section.className='connection-recovery';
    section.innerHTML=`<h2>Не удалось подключиться</h2><p>Для входа и проверки прав нужен интернет. Можно повторить подключение${savedSchedules().length?' или прочитать сохранённое расписание':''}.</p><div class="actions"><button type="button" class="secondary" data-connection="retry">Повторить</button>${savedSchedules().length?'<a class="connection-link" href="offline.html">Сохранённое расписание</a>':''}<button type="button" class="secondary" data-connection="logout">Выйти</button></div>`;
    (document.querySelector('.auth-container')||document.querySelector('main')?.parentElement||document.body).append(section);
  }
  function status(){const bar=document.getElementById('connectionStatus');if(!bar)return;bar.hidden=online();bar.textContent='Нет интернета. Доступны ранее сохранённые расписания и справочные данные. Отправка работ требует подключения.';}
  function ready(){document.getElementById('appLoading')?.remove();document.getElementById('connectionRecovery')?.remove();}
  function updateButton(registration){
    if(!registration.waiting||!registration.active||!navigator.serviceWorker.controller||document.getElementById('appUpdate'))return;
    worker=registration.waiting;const box=document.createElement('aside');box.id='appUpdate';box.className='app-update';box.innerHTML='<span>Доступно обновление сайта.</span><button type="button" class="secondary" data-connection="update">Обновить сайт</button>';const heading=document.querySelector('body > header');if(heading)heading.after(box);else(document.querySelector('.auth-container')||document.body).prepend(box);
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-connection]');if(!button)return;
    if(button.dataset.connection==='retry')location.reload();
    if(button.dataset.connection==='logout'&&typeof logout==='function')logout();
    if(button.dataset.connection==='update'){
      if(typeof attempt!=='undefined'&&attempt&&!attempt.result){alert('Сначала завершите или сохраните текущую попытку. Обновление можно установить позже.');return;}
      if(!confirm('Страница будет перезагружена. Сохраните заполненные формы перед обновлением. Продолжить?'))return;
      navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});worker?.postMessage({type:'ACTIVATE_UPDATE'});
    }
  });
  document.addEventListener('DOMContentLoaded',()=>{
    const bar=document.createElement('aside');bar.id='connectionStatus';bar.className='connection-status';bar.setAttribute('role','status');document.body.prepend(bar);status();
    if(document.querySelector('main[hidden]')){const box=document.createElement('section');box.id='appLoading';box.className='connection-recovery';box.innerHTML='<p role="status">Открываем кабинет…</p><p>При медленном интернете это может занять немного времени.</p>';document.querySelector('main').before(box);setTimeout(()=>{if(box.isConnected)box.insertAdjacentHTML('beforeend','<button type="button" class="secondary" data-connection="retry">Повторить загрузку</button>');},12000);}
  });
  window.addEventListener('online',status);window.addEventListener('offline',status);
  window.addEventListener('load',()=>{
    if(!('serviceWorker' in navigator))return;
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{updateButton(reg);reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',()=>updateButton(reg)));}).catch(()=>{});
  });
  return {request,note,begin,rememberDevice,savedSchedules,hasDrafts,clearUser,recovery,ready,online,peek,networkError,recoverable,invalidate,draftStorage:storage};
})();
