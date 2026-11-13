const Subscriptions = (() => {
  let person,settingsRoot=null,settingsToken=0,selectedGroup='';
  const panels=new WeakMap(),e=value=>escapeHtml(value??'');
  const button=(text,action,attrs='',cls='secondary')=>`<button type="button" class="${cls}" data-sub-action="${action}" ${attrs}>${text}</button>`;
  const label=s=>s.scope==='mine'?'Мои занятия во всех группах':`Группа ${s.group_name}${s.scope==='subject'?' · '+s.subject_title:' · всё расписание'}`;
  function init(profile){person=profile;}
  function subjects(cells){
    const map=new Map();for(const c of cells??[])if(c.status==='lesson'&&c.title){
      if(!map.has(c.title))map.set(c.title,{title:c.title,id:c.subject_id??null});
      else if(map.get(c.title).id!==c.subject_id)map.get(c.title).id=null;
    }return [...map.values()].sort((a,b)=>a.title.localeCompare(b.title,'ru'));
  }
  async function groupPanel(root,group,cells){
    panels.set(root,{group,cells});root.dataset.subGroupPanel='true';
    try{
      const own=await callFunction('listNotificationSubscriptions');if(!root.isConnected)return;
      const full=own.find(s=>s.scope==='group'&&s.group_id===group.id),specific=own.filter(s=>s.scope==='subject'&&s.group_id===group.id);
      root.innerHTML=`<div><strong>Уведомления об этом расписании</strong><p>${full?'Вы подписаны на все изменения группы.':specific.length?`Подписок на предметы: ${specific.length}.`:'Выбор группы не включает уведомления автоматически.'}</p></div><div class="actions">${button(full?'Не уведомлять о группе':'Подписаться на группу','group',`data-group="${e(group.id)}" ${full?`data-id="${e(full.id)}"`:''} aria-pressed="${!!full}"`)}${button('Выбрать предмет','subject-dialog')}${button('Мои подписки','settings')}</div>`;
    }catch{if(root.isConnected)root.innerHTML=`<p>Не удалось загрузить подписки.</p>${button('Повторить','group-retry')}`;}
  }
  async function render(root){
    settingsRoot=root;const token=++settingsToken;
    root.innerHTML='<h2>Мои подписки</h2><p role="status">Загрузка…</p>';
    const [own,groups]=await Promise.all([callFunction('listNotificationSubscriptions'),callFunction('listScheduleGroups')]);
    if(!root.isConnected||token!==settingsToken)return;
    const mine=own.find(s=>s.scope==='mine');
    root.innerHTML=`<div class="section-kicker">Центр уведомлений</div><h2>Мои подписки</h2><p class="section-lead">Сообщаем об изменениях только выбранных расписаний. Подписки действуют с момента включения; старые события не рассылаются.</p>
      <div class="actions"><button type="button" class="secondary" data-portal="navigate" data-tab="notifications">← К уведомлениям</button></div>
      <section class="subscription-section"><h3>Вы получаете изменения</h3><div class="subscription-list">${own.map(s=>`<article class="subscription-row"><div><strong>${e(label(s))}</strong><p>${s.scope==='mine'?'Пары, где администратор назначил вас преподавателем.':s.scope==='subject'?'Включая замену и отмену этого предмета.':'Все дни и предметы выбранной группы.'}</p></div>${button('Отписаться','remove',`data-id="${e(s.id)}"`)}</article>`).join('')||'<p class="empty-state">Подписок пока нет. Личные результаты и важные объявления администрации доступны без подписки.</p>'}</div></section>
      ${person.canTeach?`<section class="subscription-section"><h3>Моё расписание преподавателя</h3><p>Только занятия, где вы назначены преподавателем. Если в расписании указаны лишь инициалы, попросите администратора выбрать ваш профиль при редактировании пары.</p>${button(mine?'Отключить мои занятия':'Уведомлять о моих занятиях','mine',mine?`data-id="${e(mine.id)}"`:'')}</section>`:''}
      <section class="subscription-section"><h3>Добавить расписание</h3><form data-sub-form="add" class="subscription-form"><label for="subGroup">Группа<select id="subGroup" required><option value="">Выберите группу</option>${groups.map(g=>`<option value="${e(g.id)}" ${g.id===selectedGroup?'selected':''}>${e(g.name)}</option>`).join('')}</select></label><label for="subScope">Что отслеживать<select id="subScope"><option value="group">Всё расписание группы</option><option value="subject">Один предмет в группе</option></select></label><label id="subSubjectLabel" for="subSubject" hidden>Предмет<input id="subSubject" list="subSubjects" maxlength="200" placeholder="Выберите или введите название"><datalist id="subSubjects"></datalist></label><button type="submit" class="primary">Подписаться</button></form></section>
      <aside class="subscription-policy"><h3>Личные и системные сообщения</h3><p>Результаты работ и изменения доступа приходят только владельцу аккаунта. Историю назначения ролей видит администрация. Автоматические изменения чужих материалов и профилей не рассылаются всем.</p></aside>`;
    if(selectedGroup)await updateSubjects(root.querySelector('[data-sub-form="add"]'));
  }
  async function updateSubjects(form){
    const id=form.querySelector('#subGroup').value;selectedGroup=id;form._subjects=[];
    if(!id)return;
    const data=await callFunction('getWeeklySchedule',{groupId:id});if(!form.isConnected||form.querySelector('#subGroup').value!==id)return;
    form._subjects=subjects(data.cells);form.querySelector('#subSubjects').innerHTML=form._subjects.map(s=>`<option value="${e(s.title)}"></option>`).join('');
  }
  function openDialog(group,cells){
    document.getElementById('subscriptionDialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='subscriptionDialog';dialog.className='subscription-dialog';dialog.setAttribute('aria-labelledby','subscriptionDialogTitle');
    dialog.innerHTML=`<h2 id="subscriptionDialogTitle">Предмет в группе ${e(group.name)}</h2><p>Уведомления о новых занятиях, заменах, аудиториях и отменах выбранного предмета.</p><form data-sub-form="subject" data-group="${e(group.id)}"><label for="subDialogTitle">Предмет<input id="subDialogTitle" required maxlength="200" list="subDialogSubjects" placeholder="Например, Математика"><datalist id="subDialogSubjects">${subjects(cells).map(s=>`<option value="${e(s.title)}"></option>`).join('')}</datalist></label><div class="actions"><button class="primary" type="submit">Подписаться</button>${button('Отмена','close')}</div></form><p class="subscription-error" role="alert" hidden></p>`;
    dialog.querySelector('form')._subjects=subjects(cells);document.body.append(dialog);dialog.showModal();
    dialog.addEventListener('cancel',event=>{if(dialog.dataset.busy)event.preventDefault();});
  }
  async function refresh(){
    if(settingsRoot?.isConnected)await render(settingsRoot);
    for(const root of document.querySelectorAll('[data-sub-group-panel]')){const ctx=panels.get(root);if(ctx)await groupPanel(root,ctx.group,ctx.cells);}
  }
  document.addEventListener('change',event=>{
    const form=event.target.closest('[data-sub-form="add"]');if(!form)return;
    if(event.target.id==='subScope'){
      const subject=event.target.value==='subject';form.querySelector('#subSubjectLabel').hidden=!subject;form.querySelector('#subSubject').required=subject;
    }
    if(event.target.id==='subGroup')updateSubjects(form).catch(error=>Portal.toast('Не удалось загрузить предметы',error.message,'danger'));
  });
  document.addEventListener('click',async event=>{
    const node=event.target.closest('[data-sub-action]');if(!node||node.disabled||!person)return;
    node.disabled=true;
    try{
      const action=node.dataset.subAction,root=node.closest('[data-sub-group-panel]'),ctx=panels.get(root);
      if(action==='close')return node.closest('dialog').close();
      if(action==='settings')return Portal.openSubscriptions();
      if(action==='subject-dialog')return openDialog(ctx.group,ctx.cells);
      if(action==='group-retry')return groupPanel(root,ctx.group,ctx.cells);
      if(action==='remove'||node.dataset.id)await callFunction('removeNotificationSubscription',{id:node.dataset.id});
      else if(action==='mine')await callFunction('addNotificationSubscription',{scope:'mine'});
      else if(action==='group')await callFunction('addNotificationSubscription',{scope:'group',groupId:node.dataset.group});
      await refresh();Portal.toast(node.dataset.id?'Подписка отключена':'Подписка включена','','success');
    }catch(error){Portal.toast('Не удалось изменить подписку',error.message,'danger');}finally{node.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-sub-form]');if(!form)return;event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
    const dialog=form.closest('dialog');if(dialog)dialog.dataset.busy='true';
    try{
      const scoped=form.dataset.subForm==='subject',scope=scoped?'subject':form.querySelector('#subScope').value;
      const title=scoped?form.querySelector('#subDialogTitle').value:form.querySelector('#subSubject').value;
      await callFunction('addNotificationSubscription',{scope,groupId:scoped?form.dataset.group:form.querySelector('#subGroup').value,
        subjectTitle:scope==='subject'?title:undefined,subjectId:scope==='subject'?(form._subjects??[]).find(s=>s.title===title)?.id??null:undefined});
      if(dialog)dialog.close();await refresh();Portal.toast('Подписка включена','Будущие изменения появятся в ваших уведомлениях.','success');
    }catch(error){if(dialog){const target=dialog.querySelector('.subscription-error');target.textContent=error.message;target.hidden=false;}else Portal.toast('Подписка не сохранена',error.message,'danger');}
    finally{button.disabled=false;if(dialog)delete dialog.dataset.busy;}
  });
  return {init,render,groupPanel};
})();
