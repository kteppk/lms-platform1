const AdministrationTools=(()=>{
 const e=v=>escapeHtml(v??'');let onlineRoot=null,busy=false,again=false;
 async function online(root=onlineRoot){
  if(!root?.isConnected||document.hidden)return;onlineRoot=root;if(busy){again=true;return;}busy=true;
  try{const data=await callFunction('getOnlineStats',{},undefined,{fresh:true});if(!root.isConnected)return;
   const labels={student:'Студенты',teacher:'Преподаватели',curator:'Кураторы',admin:'Администрация'};
   root.innerHTML=`<div class="page-heading"><h3>Онлайн сейчас</h3><span class="online-live">${data.available?'В реальном времени':'Восстанавливаем соединение'}</span></div><div class="online-stat-grid"><div class="online-total"><strong>${e(data.accounts)}</strong><span>аккаунтов онлайн</span></div>${Object.entries(labels).map(([role,label])=>`<div><strong>${e(data.roles[role])}</strong><span>${label}</span></div>`).join('')}<div><strong>${e(data.guestConnections)}</strong><span>гостевых подключений</span></div></div><p class="hint">Сайт открыт на видимом экране. Один аккаунт считается один раз, даже в нескольких вкладках. Гости считаются по подключениям. При обрыве интернета данные обновляются после обнаружения разрыва.</p>`;
  }catch{if(root.isConnected)root.innerHTML='<h3>Онлайн сейчас</h3><p role="status">Не удалось обновить статистику. Повторим при восстановлении связи.</p>';}
  finally{busy=false;if(again){again=false;queueMicrotask(()=>online());}}
 }
 async function requests(root){
  root.innerHTML='<h3>Заявки на предметы</h3><p role="status">Загрузка заявок…</p>';
  try{const rows=await callFunction('listSubjectJoinRequests',{},undefined,{fresh:true});if(!root.isConnected)return;
   root.innerHTML=`<div class="page-heading"><h3>Заявки на предметы <span class="badge">${rows.length}</span></h3></div><p class="hint">Только администрация может разрешить преподавателю вести существующий предмет.</p><div class="subject-requests">${rows.map(r=>`<article class="subject-request"><div><strong>${e(r.subject_title)}</strong><p>${e(r.teacher_name)}</p><small>${e(new Date(r.created_at).toLocaleString('ru-RU'))}${r.archived?' · предмет удалён':''}</small></div><div class="actions"><button type="button" class="primary" data-request="${e(r.id)}" data-approve="true" ${r.archived?'disabled':''}>Одобрить</button><button type="button" class="secondary" data-request="${e(r.id)}" data-approve="false">Отклонить</button></div></article>`).join('')||'<p class="empty-state">Новых заявок нет.</p>'}</div><p data-request-status role="status"></p>`;
   root.onclick=async event=>{const b=event.target.closest('[data-request]');if(!b||b.disabled)return;const row=b.closest('article');row.querySelectorAll('button').forEach(n=>n.disabled=true);
    try{await callFunction('reviewSubjectJoinRequest',{requestId:b.dataset.request,approve:b.dataset.approve==='true'});Portal.toast(b.dataset.approve==='true'?'Заявка одобрена':'Заявка отклонена','','success');await requests(root);}
    catch(error){if(root.isConnected){root.querySelector('[data-request-status]').textContent=error.message;row.querySelectorAll('button').forEach(n=>n.disabled=false);}}
   };
  }catch(error){if(root.isConnected)root.innerHTML='<h3>Заявки на предметы</h3><p role="alert">'+e(error.message)+'</p>';}
 }
 document.addEventListener('lms-live-update',event=>{if(event.detail.topics.some(t=>['presence','resync'].includes(t)))online();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)online();});
 setInterval(()=>{if(typeof Realtime==='undefined'||!Realtime.connected)online();},15000);
 return {online,requests};
})();
