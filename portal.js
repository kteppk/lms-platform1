const Portal = (() => {
  let profile, teachers=[], selectedTeacher=null, editingTeacher=null, accountRows=[], accountOffset=0, accountSearch='', pendingTeacher=null;
  let noticeRows=[], noticeOffset=0, seen=new Set(), polling=false, pendingSubscriptions=false;
  const noticeById=new Map();
  const roles={student:'Студент',teacher:'Преподаватель',admin:'Администратор'};
  const categories={diploma:'Диплом',award:'Грамота',certificate:'Сертификат',other:'Другой документ'};
  const e=value=>escapeHtml(value);
  const field=(key,label,value='',type='text',extra='')=>`<div class="form-group"><label for="${key}">${label}</label><input id="${key}" type="${type}" value="${e(value)}" ${extra}></div>`;
  const area=(key,label,value='',max=5000)=>`<div class="form-group"><label for="${key}">${label}</label><textarea id="${key}" maxlength="${max}">${e(value)}</textarea></div>`;
  const button=(label,action,extra='',cls='secondary')=>`<button type="button" class="${cls}" data-portal="${action}" ${extra}>${label}</button>`;
  const empty=message=>`<p class="empty-state">${message}</p>`;
  const val=key=>document.getElementById(key).value;
  function avatar(person){
    const url=safeMaterialUrl(person.avatarUrl);
    return url?`<img class="avatar" loading="lazy" decoding="async" src="${e(url)}" alt="Фото ${e(person.name)}">`:
      `<span class="avatar" aria-hidden="true">${e(person.name?.split(/\s+/).slice(0,2).map(p=>p[0]).join(''))}</span>`;
  }
  function navigate(tab){
    if(typeof MobileNavigation!=='undefined')MobileNavigation.closeMenu();
    document.getElementById('notificationsDialog')?.close();
    const target=document.querySelector(`.tabs [data-tab="${tab}"]`);
    if(target) target.click();
    else document.querySelector('.tabs [data-tab="notifications"]')?.click();
  }
  function nameNotice(){
    let notice=document.getElementById('nameNotice');
    if(!notice){notice=document.createElement('aside');notice.id='nameNotice';notice.className='notice-danger';notice.setAttribute('role','alert');document.querySelector('main .tabs').after(notice);}
    notice.className='profile-prompt';notice.setAttribute('role','status');notice.hidden=!profile.needsNameReview;
    notice.innerHTML=`<div><strong>Подтвердите данные профиля</strong><p>Имя и фамилия теперь заполняются отдельно. Отчество необязательно.</p></div>${button('Заполнить профиль','navigate','data-tab="profile"')}`;
  }
  function toast(title,body='',severity='info',destination){
    const root=document.getElementById('toastRegion');if(!root)return;
    while(root.children.length>=3)root.firstElementChild.remove();
    const node=document.createElement('div');node.className='toast'+(severity==='danger'?' danger':severity==='success'?' success':'');
    node.innerHTML=`<strong>${e(title)}</strong>${button('✕','close-toast','aria-label="Закрыть уведомление"','')}${body?`<p>${e(body)}</p>`:''}${destination?button('Открыть','navigate',`data-tab="${e(destination)}"`,'toast-open'):''}`;
    root.append(node);setTimeout(()=>node.remove(),severity==='danger'?20000:9000);
  }
  async function poll(initial=false){
    if(polling||document.hidden||!AppConnection.online())return;polling=true;
    try{
      const feed=await callFunction('listNotifications');
      const fresh=feed.rows.filter(n=>!n.read&&!seen.has(n.id));
      feed.rows.forEach(n=>seen.add(n.id));
      document.getElementById('notificationCount').textContent=feed.unreadCount;
      document.getElementById('notificationButton').setAttribute('aria-label',`Уведомления: непрочитанных ${feed.unreadCount}`);
      if(!initial&&fresh.length===1){const n=fresh[0],preview=n.category==='schedule'?n.body.split('\n')[0]:n.body.length>240?n.body.slice(0,240)+'…':n.body;toast(n.title,preview,n.severity,n.destination);}
      else if(!initial&&fresh.length>1)toast('Новые уведомления',`Новых событий: ${fresh.length}. Откройте историю изменений.`,fresh.some(n=>n.severity==='danger')?'danger':'info','notifications');
    }catch{ /* A failed background refresh never interrupts a test or form. */ }
    finally{polling=false;}
  }
  async function init(person){
    profile=person;
    Subscriptions.init(profile);
    document.getElementById('userName').textContent=profile.name;
    nameNotice();
    if(!document.getElementById('toastRegion')){
      const root=document.createElement('div');root.id='toastRegion';root.setAttribute('role','status');root.setAttribute('aria-live','polite');document.body.append(root);
      const dialog=document.createElement('dialog');dialog.id='notificationsDialog';dialog.className='notification-dialog';dialog.setAttribute('aria-labelledby','notificationDialogTitle');
      dialog.innerHTML=`<div class="dialog-heading"><h2 id="notificationDialogTitle">Уведомления</h2>${button('Закрыть','close-dialog')}</div><div id="popupNotices"></div>`;document.body.append(dialog);
      const bell=document.createElement('button');bell.id='notificationButton';bell.className='notification-button';bell.dataset.portal='open-notifications';bell.innerHTML='Уведомления <span class="badge" id="notificationCount">0</span>';
      document.querySelector('.user-info .logout').before(bell);
      if(profile.role==='admin'){
        const link=document.createElement('a');link.href=location.pathname.endsWith('teacher.html')?'admin.html':profile.canTeach?'teacher.html':'admin.html';
        link.textContent=location.pathname.endsWith('teacher.html')?'Администрирование':profile.canTeach?'Учебный кабинет':'Администрирование';
        link.className='tab-btn';document.querySelector('.user-info').append(link);
      }
      const connection=navigator.connection;const slow=connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType);
      setInterval(()=>poll(),slow?300000:120000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
      // Current server roles, including demotion, are checked when the user returns.
      window.addEventListener('focus',()=>getProfile(auth.currentUser).then(p=>{if(p.role!==profile.role)location.replace(cabinetPage(p.role));}).catch(()=>{}));
    }
    if(typeof MobileNavigation!=='undefined')MobileNavigation.init(profile,navigate);
    poll(true);
  }
  async function home(container){return News.home(container,profile);}
  async function myProfile(container){
    const [names,current]=await Promise.all([nameFieldsReady,getProfile(auth.currentUser)]);if(!container.isConnected)return;
    if(current.role!==profile.role){location.replace(cabinetPage(current.role));return;}
    profile={...profile,...current};document.getElementById('userName').textContent=profile.name;nameNotice();
    container.innerHTML=`<h2>Мой профиль</h2><p class="section-lead">Имя в материалах, результатах и списках пользователей.</p>
      ${!profile.nameConfirmed?`<p class="legacy-name">Ранее указано: <strong>${e(profile.name)}</strong>. Распределите данные по полям — мы не будем угадывать их порядок.</p>`:''}
      <form data-portal-form="name">${names.fields('profile',profile)}<button class="primary" type="submit">Сохранить ФИО</button></form>
      <div class="account-details"><span>${e(profile.email)}</span><span class="badge">${roles[profile.role]}</span></div>
      ${profile.canTeach?`<section class="profile-block"><h2>Профессиональный профиль</h2><p>Образование, стаж, квалификация, дипломы и грамоты доступны пользователям платформы.</p><div class="actions">${button('Заполнить профиль преподавателя','edit-own-profile','','primary')}${button('Посмотреть свой профиль','view-teacher',`data-id="${e(profile.uid)}"`)}</div></section>`:''}`;
  }
  async function renderTeachers(container){
    container.innerHTML='<h2>Преподаватели</h2><p>Загрузка профилей…</p>';
    teachers=await callFunction('listTeachers');if(!container.isConnected)return;
    container.innerHTML=`<h2>Преподаватели</h2><p class="section-lead">Образование, опыт и достижения преподавателей техникума.</p><div class="teacher-grid">${teachers.map(t=>`<article class="item teacher-card">${avatar(t)}<h3>${e(t.name)}</h3><p class="meta">${e(t.position||'Преподаватель')}</p><span class="badge mint">Предметов: ${t.subjectIds.length}</span><div class="actions">${button('Открыть профиль','view-teacher',`data-id="${e(t.id)}"`,'primary')}</div></article>`).join('')||empty('Профили преподавателей пока не добавлены.')}</div>`;
  }
  async function viewTeacher(uid,container=document.getElementById('portalPage')){
    selectedTeacher=await callFunction('getTeacherProfile',{teacherId:uid});if(!container?.isConnected)return;
    const p=selectedTeacher;
    container.innerHTML=`${button('← Все преподаватели','teacher-list')}<div class="profile-heading">${avatar(p)}<div><h2>${e(p.name)}</h2><p>${e(p.position||'Преподаватель')}</p>${p.experience_years!==null&&p.experience_years!==undefined?`<span class="badge mint">Стаж: ${p.experience_years} лет</span>`:''}</div></div>
      ${p.canEdit?button('Редактировать профиль','edit-teacher',`data-id="${e(p.id)}"`,'primary'):''}
      ${[['О преподавателе',p.bio],['Образование',p.education],['Квалификация и повышение квалификации',p.qualification]].map(([title,body])=>`<section class="profile-block"><h3>${title}</h3><p>${e(body||'Информация пока не заполнена.')}</p></section>`).join('')}
      <section class="profile-block"><h3>Дипломы, грамоты и сертификаты</h3><p class="hint">Документы, которые преподаватель добавил в свой профиль.</p><div class="document-list">${p.documents.map(d=>{
        const url=safeMaterialUrl(d.url);return `<article class="item"><span class="badge">${categories[d.category]}</span><h4>${e(d.title)}</h4><p class="meta">${e(d.issued_year||'')}</p>${url&&d.mime.startsWith('image/')?`<a href="${e(url)}" target="_blank" rel="noopener noreferrer"><img class="document-preview" src="${e(url)}" alt="${e(d.title)}" loading="lazy"></a>`:''}${url?materialLink(url,d.mime==='application/pdf'?'Открыть PDF / скачать':'Открыть документ'):''}</article>`;
      }).join('')||empty('Документов пока нет. Преподаватель может добавить их в своём профиле.')}</div></section>`;
  }
  async function editTeacher(uid){
    const container=document.getElementById('portalPage');
    editingTeacher=await callFunction('getTeacherProfile',{teacherId:uid});if(!container?.isConnected)return;
    const p=editingTeacher;
    if(!p.canEdit)throw new Error('Недостаточно прав.');
    container.innerHTML=`${button('← К профилю','view-teacher',`data-id="${e(uid)}"`)}<h2 style="margin-top:20px">Профиль преподавателя</h2><p class="section-lead">${e(p.name)}. Добавляйте только документы, которыми вы готовы поделиться с пользователями платформы.</p>
      <form data-portal-form="teacher-profile"><div class="field-grid">${field('teacherPosition','Должность',p.position??'','text','maxlength="200"')}${field('teacherExperience','Педагогический стаж, лет',p.experience_years??'','number','min="0" max="80"')}
      <div class="full-width">${area('teacherBio','О себе',p.bio??'')}${area('teacherEducation','Образование: учебное заведение, специальность, год',p.education??'')}${area('teacherQualification','Квалификация и повышение квалификации',p.qualification??'',3000)}</div>
      ${field('teacherAvatar','Фотография (JPG, PNG, WebP, до 5 МБ)','','file','accept=".jpg,.jpeg,.png,.webp"')}<div><label class="check-label"><input id="removeAvatar" type="checkbox">Убрать текущую фотографию</label></div></div><button class="primary" type="submit">Сохранить профиль</button></form>
      <section class="profile-block"><h3>Добавить документ</h3><form data-portal-form="document"><div class="field-grid">${field('documentTitle','Название документа','','text','required maxlength="200"')}<div class="form-group"><label for="documentCategory">Вид документа</label><select id="documentCategory">${Object.entries(categories).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></div>${field('documentYear','Год выдачи','','number','min="1950" max="2200"')}${field('documentFile','Файл (PDF или изображение, до 10 МБ)','','file','required accept=".pdf,.jpg,.jpeg,.png,.webp"')}</div><button class="primary" type="submit">Добавить документ</button></form></section>
      <section class="profile-block"><h3>Загруженные документы</h3>${p.documents.map(d=>`<article class="item"><h4>${e(d.title)}</h4><p>${categories[d.category]} ${e(d.issued_year||'')}</p>${materialLink(d.url,'Открыть документ')}<div class="actions">${button('Удалить','delete-document',`data-id="${e(d.id)}"`,'danger-button')}</div></article>`).join('')||empty('Добавьте первый документ.')}</section>`;
  }
  async function uploadProfile(file,teacherId,purpose){
    const mime=file.type||({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'})[file.name.split('.').pop().toLowerCase()];
    const grant=await callFunction('createProfileUpload',{teacherId,purpose,mime,size:file.size});
    const form=new FormData();form.append('cacheControl','3600');form.append('',new Blob([file],{type:mime}),file.name);
    const result=await fetch(new URL(grant.url,lmsBaseUrl),{method:'PUT',headers:{'x-upsert':'false'},body:form});
    if(!result.ok)throw new Error('Хранилище не приняло файл.');return grant.path;
  }
  async function renderSchedule(container){ return Schedule.render(container,profile); }
  function noticeCards(rows){
    return rows.map(n=>`<article class="item notice-card ${n.read?'':'unread'} ${n.severity==='danger'?'danger':''}"><span class="notice-category">${n.category==='schedule'?'По подписке':n.category==='announcement'?'Объявление':'Личное'}</span><span class="meta">${e(new Date(n.created_at).toLocaleString('ru-RU'))}${n.read?'':' · Новое'}</span><h3>${e(n.title)}</h3><p>${e(n.body)}</p><div class="actions">${button('Открыть','notice-open',`data-id="${e(n.id)}" data-tab="${e(n.destination)}"`)}${n.read?'':button('Прочитано','notice-read',`data-id="${e(n.id)}"`)}</div></article>`).join('')||empty('Уведомлений пока нет.');
  }
  async function renderNotices(container,popup=false){
    const feed=await callFunction('listNotifications',{offset:popup?0:noticeOffset});if(!container?.isConnected)return;noticeRows=feed.rows;feed.rows.forEach(n=>noticeById.set(n.id,n));
    container.innerHTML=`${popup?'':'<h2>Уведомления</h2><p class="section-lead">Личные результаты, объявления и изменения расписаний по вашим подпискам.</p>'}<div class="actions" style="margin-bottom:20px">${button('Мои подписки','subscriptions')}${button('Прочитать эту страницу','notices-read-page')}${popup?button('Вся история','navigate','data-tab="notifications"'):''}</div>${noticeCards(feed.rows)}${popup?'':`<div class="actions">${button('← Назад','notices-prev',noticeOffset?'':'disabled')}${button('Далее →','notices-next',feed.rows.length===50?'':'disabled')}</div>`}`;
    document.getElementById('notificationCount').textContent=feed.unreadCount;
  }
  async function renderAccounts(container){
    container.innerHTML='<h2>Аккаунты и роли</h2><p role="status">Загрузка аккаунтов…</p>';
    const rows=await callFunction('listAccounts',{search:accountSearch,offset:accountOffset});if(!container.isConnected)return;accountRows=rows;
    container.innerHTML=`<h2>Аккаунты и роли</h2><p class="section-lead">Новые пользователи — студенты. Изменение роли сохраняет материалы и результаты. Последний администратор защищён от понижения.</p><section id="registrationStats" class="registration-statistics"></section><form class="account-search" data-portal-form="accounts-search"><input id="accountSearch" aria-label="Поиск по ФИО или email" placeholder="Найти по ФИО или email" value="${e(accountSearch)}" maxlength="120"><button class="primary" type="submit">Найти</button></form><div class="table-wrap"><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Действие</th></tr></thead><tbody>${rows.map(p=>`<tr><td class="account-name"><strong>${e(p.name)}</strong><small>${e(p.email)}</small>${p.needs_name?'<span class="badge">Заполнить поля ФИО</span>':''}${p.id===profile.uid?'<span class="badge">Это вы</span>':''}</td><td><select aria-label="Роль ${e(p.email)}" data-role-id="${e(p.id)}">${Object.entries(roles).map(([role,label])=>`<option value="${role}" ${role===p.role?'selected':''}>${label}</option>`).join('')}</select></td><td>${button('Сохранить роль','role-save',`data-id="${e(p.id)}"`)}</td></tr>`).join('')}</tbody></table></div>${!rows.length?empty('Аккаунты не найдены.'):''}<details class="role-log"><summary>История назначения ролей</summary><p>Последние 50 назначений. Доступны только администрации. Уведомление получает только владелец изменённого аккаунта.</p>${button('Загрузить историю','role-log')}<div id="roleChangeLog"></div></details><div class="actions">${button('← Назад','accounts-prev',accountOffset?'':'disabled')}${button('Далее →','accounts-next',rows.length===50?'':'disabled')}</div>`;
    await News.statistics(container.querySelector('#registrationStats'));
  }
  async function announcements(container){return News.manager(container);}
  async function render(tab,parent){
    if(!['home','profile','teachers','schedule','notifications','accounts','announcements'].includes(tab))return false;
    parent.innerHTML='<section id="portalPage" aria-live="polite"></section>';const target=parent.firstElementChild;
    if(tab==='home')await home(target);
    if(tab==='profile')await myProfile(target);
    if(tab==='teachers'){const uid=pendingTeacher;pendingTeacher=null;if(uid)await viewTeacher(uid,target);else await renderTeachers(target);}
    if(tab==='schedule')await renderSchedule(target);
    if(tab==='notifications'){if(pendingSubscriptions){pendingSubscriptions=false;await Subscriptions.render(target);}else await renderNotices(target);}
    if(tab==='accounts')await renderAccounts(target);
    if(tab==='announcements')await announcements(target);
    return true;
  }
  async function action(name,node){
    const container=document.getElementById('portalPage');
    if(name==='navigate')return navigate(node.dataset.tab);
    if(name==='subscriptions')return openSubscriptions();
    if(name==='role-log'){const rows=await callFunction('listRoleChanges');const target=container.querySelector('#roleChangeLog');target.innerHTML=rows.length?rows.map(r=>`<article class="role-log-row"><strong>${e(r.user_name)}</strong><span>${e(roles[r.old_role])} → ${e(roles[r.new_role])}</span><small>${e(r.actor_name)} · ${e(new Date(r.created_at).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'}))}</small></article>`).join(''):'<p>Назначений пока нет.</p>';return;}
    if(name==='close-toast')return node.closest('.toast').remove();
    if(name==='close-dialog')return document.getElementById('notificationsDialog').close();
    if(name==='open-notifications'){const dialog=document.getElementById('notificationsDialog');dialog.showModal();return renderNotices(document.getElementById('popupNotices'),true);}
    if(name==='view-teacher'){if(!container){navigate('teachers');await new Promise(r=>setTimeout(r,0));}return viewTeacher(node.dataset.id);}
    if(name==='teacher-list')return renderTeachers(container);
    if(name==='edit-own-profile')return editTeacher(profile.uid);
    if(name==='edit-teacher')return editTeacher(node.dataset.id);
    if(name==='delete-document'){
      if(!confirm('Удалить документ из профиля?'))return;
      await callFunction('deleteTeacherDocument',{teacherId:editingTeacher.id,id:node.dataset.id});toast('Документ удалён');return editTeacher(editingTeacher.id);
    }
    if(name==='role-save'){
      const p=accountRows.find(p=>p.id===node.dataset.id);if(!p)return;
      const role=document.querySelector(`[data-role-id="${p.id}"]`).value;
      if(role===p.role){toast('Роль уже назначена');return;}
      await callFunction('setAccountRole',{userId:p.id,role,expectedRole:p.role});toast('Роль обновлена',`${p.name}: ${roles[role]}.`,'success');
      if(p.id===profile.uid&&role!=='admin'){location.replace(cabinetPage(role));return;}return renderAccounts(container);
    }
    if(name==='accounts-next'||name==='accounts-prev'){accountOffset=Math.max(0,accountOffset+(name.endsWith('next')?50:-50));return renderAccounts(container);}
    if(name==='notices-next'||name==='notices-prev'){noticeOffset=Math.max(0,noticeOffset+(name.endsWith('next')?50:-50));return renderNotices(container);}
    if(['notice-read','notice-open','notices-read-page'].includes(name)){
      const noticeRoot=node.closest('#popupNotices')||container;
      const ids=name==='notices-read-page'?[...noticeRoot.querySelectorAll('[data-portal="notice-open"]')].map(n=>n.dataset.id):[node.dataset.id];
      await callFunction('readNotifications',{ids});await poll();
      if(name==='notice-open'){const notice=noticeById.get(node.dataset.id);if(notice?.context?.groupId)Schedule.selectGroup(notice.context.groupId);return navigate(node.dataset.tab);}
      const popup=document.getElementById('notificationsDialog').open;return renderNotices(popup?document.getElementById('popupNotices'):container,popup);
    }
  }
  async function formAction(kind){
    const container=document.getElementById('portalPage');
    if(kind==='name'){
      const names=(await nameFieldsReady).read('profile');
      const saved=await callFunction('updateMyProfile',{...names,nameRevision:profile.nameRevision});profile={...profile,...saved};
      document.getElementById('userName').textContent=profile.name;nameNotice();await auth.currentUser.updateProfile({displayName:profile.name}).catch(()=>{});toast('ФИО сохранено','','success');await poll();return;
    }
    if(kind==='teacher-profile'){
      const uid=editingTeacher.id,photo=document.getElementById('teacherAvatar').files[0];
      const data={teacherId:uid,position:val('teacherPosition'),bio:val('teacherBio'),education:val('teacherEducation'),qualification:val('teacherQualification'),experienceYears:val('teacherExperience')===''?null:Number(val('teacherExperience')),revision:editingTeacher.revision};
      if(photo)data.avatarPath=await uploadProfile(photo,uid,'avatar');else if(document.getElementById('removeAvatar').checked)data.avatarPath=null;
      try{await callFunction('saveTeacherProfile',data);}catch(error){if(data.avatarPath)await callFunction('removeProfileUpload',{teacherId:uid,path:data.avatarPath}).catch(()=>{});throw error;}
      toast('Профиль сохранён','','success');return viewTeacher(uid);
    }
    if(kind==='document'){
      const uid=editingTeacher.id,file=document.getElementById('documentFile').files[0];if(!file)throw new Error('Выберите файл.');
      const path=await uploadProfile(file,uid,'document');
      try{await callFunction('addTeacherDocument',{teacherId:uid,title:val('documentTitle'),category:val('documentCategory'),year:val('documentYear')===''?null:Number(val('documentYear')),path,fileName:file.name});}
      catch(error){await callFunction('removeProfileUpload',{teacherId:uid,path}).catch(()=>{});throw error;}
      toast('Документ добавлен','','success');return editTeacher(uid);
    }
    if(kind==='accounts-search'){accountOffset=0;accountSearch=val('accountSearch');return renderAccounts(container);}
    if(kind==='announcement'){
      await callFunction('publishAnnouncement',{title:val('announcementTitle'),body:val('announcementBody'),important:document.getElementById('announcementImportant').checked});toast('Объявление опубликовано','','success');return announcements(container);
    }
  }
  document.addEventListener('click',async event=>{
    const node=event.target.closest('[data-portal]');if(!node||node.disabled)return;
    node.disabled=true;try{await action(node.dataset.portal,node);}catch(error){showStatus(error.message);toast('Не удалось выполнить действие',error.message,'danger');}finally{node.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-portal-form]');if(!form)return;event.preventDefault();
    const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;showStatus('');
    try{await formAction(form.dataset.portalForm);}catch(error){showStatus(error.message);toast('Изменения не сохранены',error.message,'danger');}finally{submit.disabled=false;}
  });
  function openTeacher(uid){pendingTeacher=uid;navigate('teachers');}
  function openSubscriptions(){pendingSubscriptions=true;navigate('notifications');}
  return {init,render,navigate,toast,openTeacher,openSubscriptions};
})();
