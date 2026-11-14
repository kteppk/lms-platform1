const Subscriptions=(()=>{
 let person,settingsRoot=null,settingsToken=0;const panels=new WeakMap(),e=v=>escapeHtml(v??'');
 const bell=active=>`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>${active?'<path class="subscription-bell-slash" d="m3 3 18 18"/>':''}</svg>`;
 function control(group,sub){const active=!!sub,title=active?'Отписаться от расписания':'Подписаться на расписание';return `<button type="button" class="subscription-bell${active?' is-subscribed':''}" data-sub-action="group" data-group="${e(group.id)}" ${active?`data-id="${e(sub.id)}"`:''} aria-pressed="${active}" aria-label="${title} группы ${e(group.name)}" title="${title}">${bell(active)}</button>`;}
 function init(profile){person=profile;}
 async function groupPanel(root,group){
  panels.set(root,{group});root.dataset.subGroupPanel='true';
  try{
   const own=await callFunction('listNotificationSubscriptions');if(!root.isConnected)return;
   const sub=own.find(s=>s.scope==='group'&&s.group_id===group.id);
   root.innerHTML=`<div class="schedule-subscribe-line"><div><strong>Уведомления об этом расписании</strong><p>${sub?'Подписка на группу включена.':'Подпишитесь на изменения вашей группы.'}</p></div>${control(group,sub)}</div><details class="schedule-subscription-help"><summary>Как работают уведомления</summary><ul><li>Колокольчик включает подписку только на выбранную группу. Красный перечёркнутый колокольчик означает, что подписка включена; нажмите его повторно, чтобы отписаться.</li><li>Изменения предмета, преподавателя, аудитории, времени и отмены пар появляются в разделе «Уведомления» на сайте. События до подписки не рассылаются.</li><li>Расписание обновляется после сохранения изменений администратором. Кнопка «Обновить» проверяет свежую версию. При слабом интернете ориентируйтесь на дату сохранённой копии.</li></ul></details>`;
  }catch{if(root.isConnected)root.innerHTML='<p>Не удалось загрузить состояние подписки.</p><button type="button" class="secondary" data-sub-action="group-retry">Повторить</button>';}
 }
 async function render(root){
  settingsRoot=root;const token=++settingsToken;root.innerHTML='<h2>Мои подписки</h2><p role="status">Загрузка…</p>';
  const [own,groups]=await Promise.all([callFunction('listNotificationSubscriptions'),callFunction('listScheduleGroups')]);if(!root.isConnected||token!==settingsToken)return;
  root.innerHTML=`<div class="section-kicker">Центр уведомлений</div><h2>Мои подписки</h2><p class="section-lead">Изменения расписания приходят только по группам, на которые вы подписались.</p><div class="actions"><button type="button" class="secondary" data-portal="navigate" data-tab="notifications">← К уведомлениям</button></div><section class="subscription-section"><h3>Ваши группы</h3><div class="subscription-list">${own.filter(s=>s.scope==='group').map(s=>`<article class="subscription-row"><div><strong>Группа ${e(s.group_name)}</strong><p>Все изменения расписания этой группы.</p></div>${control({id:s.group_id,name:s.group_name},s)}</article>`).join('')||'<p class="empty-state">Подписок пока нет. Выберите группу ниже или нажмите колокольчик в её расписании.</p>'}</div></section><section class="subscription-section"><h3>Добавить группу</h3><form data-sub-form="group" class="subscription-group-form"><label for="subGroup">Группа<select id="subGroup" required><option value="">Выберите группу</option>${groups.map(g=>`<option value="${e(g.id)}">${e(g.name)}</option>`).join('')}</select></label><button type="submit" class="subscription-bell" title="Подписаться на расписание" aria-label="Подписаться на расписание выбранной группы">${bell(false)}</button></form></section><aside class="subscription-policy"><p>Повторное нажатие красного перечёркнутого колокольчика отключает подписку. Уже полученные уведомления остаются в истории. Личные результаты работ и объявления администрации доступны отдельно.</p></aside>`;
 }
 async function refresh(){if(settingsRoot?.isConnected)await render(settingsRoot);for(const root of document.querySelectorAll('[data-sub-group-panel]')){const ctx=panels.get(root);if(ctx)await groupPanel(root,ctx.group);}}
 document.addEventListener('click',async event=>{
  const node=event.target.closest('[data-sub-action]');if(!node||node.disabled||!person)return;node.disabled=true;
  try{
   const root=node.closest('[data-sub-group-panel]');if(node.dataset.subAction==='group-retry')return await groupPanel(root,panels.get(root).group);
   const subscribed=!!node.dataset.id;
   if(subscribed)await callFunction('removeNotificationSubscription',{id:node.dataset.id});else await callFunction('addNotificationSubscription',{scope:'group',groupId:node.dataset.group});
   await refresh();Portal.toast(subscribed?'Подписка отключена':'Вы подписались на расписание',subscribed?'Новые изменения этой группы больше не будут приходить.':'Изменения выбранной группы появятся в разделе «Уведомления».','success');
  }catch(error){Portal.toast('Не удалось изменить подписку',error.message,'danger');}finally{node.disabled=false;}
 });
 document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-sub-form="group"]');if(!form)return;event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
  try{await callFunction('addNotificationSubscription',{scope:'group',groupId:form.querySelector('#subGroup').value});await refresh();Portal.toast('Вы подписались на расписание','Изменения выбранной группы появятся в разделе «Уведомления».','success');}
  catch(error){Portal.toast('Подписка не сохранена',error.message,'danger');}finally{button.disabled=false;}
 });
 return {init,render,groupPanel};
})();
