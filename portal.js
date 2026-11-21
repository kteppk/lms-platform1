const Portal = (() => {
  let profile, teachers=[], editingTeacher=null, accountRows=[], accountOffset=0, accountSearch='', pendingTeacher=null;
  let noticeOffset=0, seen=new Set(), polling=false,pollAgain=false,noticeRevision=0,readingNotices=false;
  let unreadCount=null,badgeMotion=null;
  const noticeById=new Map();
  const saveTimers=new WeakMap();
  const roles={student:'Студент',curator:'Куратор-студент',teacher:'Преподаватель',admin:'Администратор'};
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
    if(tab==='announcements')tab='home';
    ActionMenu.closeAll();
    if(typeof MobileNavigation!=='undefined')MobileNavigation.closeMenu();
    DesktopNavigation.close();
    closeProfileMenu();
    closeNoticePopover();
    if(tab==='notifications'){openNotices().catch(error=>toast('Не удалось загрузить уведомления',error.message,'danger'));return;}
    document.getElementById('notificationsDialog')?.close();
    const target=document.querySelector(`.tabs [data-tab="${tab}"]`);
    if(target) target.click();
    else openNotices().catch(error=>toast('Не удалось загрузить уведомления',error.message,'danger'));
  }
  function closeProfileMenu(restore=false){
    const menu=document.getElementById('profileMenu'),trigger=document.querySelector('header .profile-link');
    if(!menu||menu.hidden)return;
    menu.hidden=true;trigger.setAttribute('aria-expanded','false');
    if(restore)trigger.focus();
  }
  function closeNoticePopover(restore=false){
    const panel=document.getElementById('noticePopover'),bell=document.getElementById('notificationButton');
    if(!panel||panel.hidden)return;
    ActionMenu.closeAll();
    panel.hidden=true;bell.setAttribute('aria-expanded','false');
    if(restore)bell.focus({preventScroll:true});
  }
  async function readNoticePopover(){
    if(readingNotices)return;
    const list=document.getElementById('recentNotices');
    readingNotices=true;++noticeRevision;
    list.innerHTML='<p role="status">Загрузка уведомлений…</p>';
    try{
      const feed=await callFunction('readAllNotifications');
      updateNoticeFeed(feed,true);
      renderRecentNotices(feed.rows);
    }catch{
      list.innerHTML='<p role="status">Не удалось отметить уведомления прочитанными.</p>'+button('Повторить','retry-notices');
    }finally{readingNotices=false;flushNoticePoll();}
  }
  function setupHeader(){
    const info=document.querySelector('header .user-info'),trigger=info.querySelector('.profile-link');
    const bell=document.createElement('button');bell.type='button';bell.id='notificationButton';bell.className='notification-button header-bell';
    bell.setAttribute('aria-label','Уведомления');bell.setAttribute('aria-expanded','false');bell.setAttribute('aria-controls','noticePopover');
    bell.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 13h4"/></svg><span class="badge" id="notificationCount" aria-hidden="true" hidden></span>';
    info.prepend(bell);
    const notices=document.createElement('section');notices.id='noticePopover';notices.className='notice-popover';notices.hidden=true;notices.setAttribute('aria-labelledby','noticePopoverTitle');
    notices.innerHTML=`<div class="notice-popover-heading"><h2 id="noticePopoverTitle">Уведомления</h2>${ActionMenu.render(button('Вся история','open-notifications')+button('Мои подписки','subscriptions')+button('Настройки уведомлений','notice-settings'),'Действия с уведомлениями')}</div><div id="recentNotices" class="notice-popover-list"></div>`;
    bell.after(notices);
    bell.addEventListener('click',()=>{
      if(!notices.hidden){closeNoticePopover();return;}
      closeProfileMenu();ActionMenu.closeAll();
      notices.hidden=false;bell.setAttribute('aria-expanded','true');
      readNoticePopover();
    });
    const teaching=location.pathname.endsWith('/teacher.html');
    const cabinet=profile.role==='admin'&&profile.canTeach&&!teaching?'<a href="teacher.html">Учебный кабинет</a>':button('Учебный кабинет','navigate','data-tab="home"','profile-menu-item');
    const admin=profile.role==='admin'&&teaching?'<a href="admin.html?tab=accounts">Админ панель</a>':'';
    const panel=document.createElement('div');panel.id='profileMenu';panel.className='profile-menu';panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label','Действия аккаунта');
    const name=trigger.querySelector('#userName');panel.append(name);
    panel.insertAdjacentHTML('beforeend',cabinet+admin+button('Выйти','account-logout','','profile-menu-item profile-menu-logout')+button('Справочник','navigate','data-tab="help"','profile-menu-item'));
    info.append(panel);
    trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','profileMenu');
    trigger.addEventListener('click',()=>{if(!panel.hidden){closeProfileMenu();return;}closeNoticePopover();ActionMenu.closeAll();panel.hidden=false;trigger.setAttribute('aria-expanded','true');});
    document.addEventListener('click',event=>{
      if(!panel.contains(event.target)&&!trigger.contains(event.target))closeProfileMenu();
      if(!notices.contains(event.target)&&!bell.contains(event.target))closeNoticePopover();
    });
    info.addEventListener('focusout',event=>{
      if(event.relatedTarget&&!info.contains(event.relatedTarget)){closeProfileMenu();closeNoticePopover();}
    });
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.defaultPrevented)return;
      if(!notices.hidden){event.preventDefault();closeNoticePopover(true);}
      else if(!panel.hidden){event.preventDefault();closeProfileMenu(true);}
    });
  }
  async function openNotices(view='history',reset=true){
    closeProfileMenu();
    closeNoticePopover();
    const dialog=document.getElementById('notificationsDialog'),target=dialog.querySelector('#popupNotices');
    const changed=target.dataset.noticeView!==view;
    target.dataset.noticeView=view;
    if(reset)noticeOffset=0;
    if(changed)target.replaceChildren();
    if(!dialog.open)dialog.showModal();
    if(view==='subscriptions')return Subscriptions.render(target);
    if(view==='settings'){
      target.innerHTML='<h3>Настройки браузерных уведомлений</h3><section></section>';
      return PushSettings.render(target.querySelector('section'),profile.role);
    }
    return renderNotices(target);
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
    node.innerHTML=`<strong>${e(title)}</strong>${ActionMenu.icon('close','Закрыть уведомление','data-portal="close-toast"','ui-icon-button icon-close')}${body?`<p>${e(body)}</p>`:''}${destination?button('Открыть','navigate',`data-tab="${e(destination)}"`,'toast-open'):''}`;
    root.append(node);setTimeout(()=>node.remove(),severity==='danger'?20000:9000);
    return node;
  }
  function setUnread(count){
    const badge=document.getElementById('notificationCount');
    badge.textContent=count>99?'99+':String(count);badge.hidden=!count;
    document.getElementById('notificationButton').setAttribute('aria-label',count?`Уведомления: непрочитанных ${count}`:'Уведомления');
    if(count===unreadCount)return;
    badgeMotion?.cancel();
    if(unreadCount!==null&&count>unreadCount&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      badgeMotion=badge.animate?.([
        {scale:'1'},{scale:'1.24',offset:.48},{scale:'1'}
      ],{duration:240,easing:'ease-out'});
    }
    unreadCount=count;
  }
  function saveButton(button){
    clearTimeout(saveTimers.get(button));
    button.dataset.saveFeedback='pending';
    button.setAttribute('aria-busy','true');
    return saved=>{
      button.removeAttribute('aria-busy');
      if(!saved||!button.isConnected){delete button.dataset.saveFeedback;return;}
      button.dataset.saveFeedback='saved';
      saveTimers.set(button,setTimeout(()=>delete button.dataset.saveFeedback,1000));
    };
  }
  function updateNoticeFeed(feed,initial){
    const fresh=feed.rows.filter(n=>n.category!=='chat'&&!n.read&&!seen.has(n.id));
    feed.rows.forEach(n=>seen.add(n.id));
    setUnread(feed.unreadCount);
    if(!initial&&fresh.length===1){const n=fresh[0],preview=n.category==='schedule'?n.body.split('\n')[0]:n.body.length>240?n.body.slice(0,240)+'…':n.body;toast(n.title,preview,n.severity,n.destination);}
    else if(!initial&&fresh.length>1)toast('Новые уведомления',`Новых событий: ${fresh.length}. Откройте историю изменений.`,fresh.some(n=>n.severity==='danger')?'danger':'info','notifications');
  }
  function flushNoticePoll(){
    if(pollAgain&&!polling&&!readingNotices){pollAgain=false;void poll();}
  }
  async function poll(initial=false){
    if(document.hidden||!AppConnection.online())return;
    if(polling||readingNotices){pollAgain=true;return;}
    polling=true;
    const revision=noticeRevision;
    try{
      const feed=await callFunction('listNotifications');
      if(revision!==noticeRevision)return;
      updateNoticeFeed(feed,initial);
      if(!document.getElementById('noticePopover').hidden)renderRecentNotices(feed.rows);
    }catch{ /* A failed background refresh never interrupts a test or form. */ }
    finally{polling=false;flushNoticePoll();}
  }
  async function init(person){
    profile=person;
    if(typeof Realtime!=='undefined')Realtime.start(person);
    AccountTools.init(profile,update=>{profile={...profile,...update};});
    Subscriptions.init(profile);
    if(['curator','admin'].includes(profile.role)&&!document.querySelector('[data-tab="curator-chat"]')){const b=document.createElement('button');b.className='tab-btn';b.dataset.tab='curator-chat';b.textContent='Чат кураторов';b.onclick=()=>switchTab('curator-chat',b);document.querySelector('.tabs [data-tab="profile"]').before(b);}
    document.getElementById('userName').textContent=profile.name;
    nameNotice();
    if(!document.getElementById('toastRegion')){
      const root=document.createElement('div');root.id='toastRegion';root.setAttribute('role','status');root.setAttribute('aria-live','polite');document.body.append(root);
      const dialog=document.createElement('dialog');dialog.id='notificationsDialog';dialog.className='notification-dialog';dialog.setAttribute('aria-labelledby','notificationDialogTitle');
      dialog.innerHTML=`<div class="dialog-heading"><h2 id="notificationDialogTitle">Уведомления</h2><div class="dialog-actions">${ActionMenu.render(button('Мои подписки','subscriptions')+button('Настройки уведомлений','notice-settings')+button('Прочитать эту страницу','notices-read-page','disabled')+button('Вся история','open-notifications'),'Действия с уведомлениями')}${ActionMenu.icon('close','Закрыть уведомления','data-portal="close-dialog" autofocus','ui-icon-button icon-close')}</div></div><div id="popupNotices"></div>`;document.body.append(dialog);
      dialog.addEventListener('close',()=>{if(document.activeElement===document.body)document.getElementById('notificationButton').focus({preventScroll:true});});
      setupHeader();
      const connection=navigator.connection;const slow=connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType);
      setInterval(()=>poll(),slow?300000:120000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
      // Current server roles, including demotion, are checked when the user returns.
      window.addEventListener('focus',()=>getProfile(auth.currentUser).then(p=>{if(p.role!==profile.role)location.replace(cabinetPage(p.role));}).catch(()=>{}));
    }
    DesktopNavigation.init();if(typeof MobileNavigation!=='undefined')MobileNavigation.init(profile,navigate);
    if(typeof CuratorChatNotifications!=='undefined')CuratorChatNotifications.start(profile);
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
      ${['student','curator'].includes(profile.role)?'<section class="profile-block" id="myEducation"></section>':''}
      ${AccountTools.profileSections(profile)}
      ${profile.canTeach?`<section class="profile-block"><h2>Профессиональный профиль</h2><p>Образование, стаж, квалификация, дипломы и грамоты доступны пользователям платформы.</p><div class="actions">${button('Заполнить профиль преподавателя','edit-own-profile','','primary')}${ActionMenu.render(button('Посмотреть свой профиль','view-teacher',`data-id="${e(profile.uid)}"`),'Действия с профилем')}</div></section>`:''}`;
    if(container.querySelector('#myEducation'))await EducationProfile.render(container.querySelector('#myEducation'));
  }
  async function renderTeachers(container){
    delete container.dataset.teacherId;
    delete container.dataset.teacherScreen;
    container.innerHTML='<h2>Преподаватели</h2><p>Загрузка профилей…</p>';
    teachers=await callFunction('listTeachers');if(!container.isConnected)return;
    container.innerHTML=`<h2>Преподаватели</h2><div class="teacher-grid">${teachers.map(t=>{
      const titles=t.subjectTitles?.join(', ');
      return `<article class="item teacher-card">${avatar(t)}<div class="teacher-card-details"><h3>${e(t.name)}</h3><p>${e(t.position||'Преподаватель')}</p><p class="teacher-card-subjects">Предметов: ${t.subjectIds.length}${titles?' · '+e(titles):''}</p>${button('Открыть профиль','view-teacher',`data-id="${e(t.id)}"`,'secondary')}</div></article>`;
    }).join('')||empty('Профили преподавателей пока не добавлены.')}</div>`;
  }
  function teacherDetails(p){return `<div class="teacher-profile-overview"><span>${e(p.position||'Преподаватель')}</span>${p.experience_years!=null?`<span>Педагогический стаж: ${e(p.experience_years)} лет</span>`:''}<span>Документов: ${(p.documents||[]).length}</span></div>${[['Образование',p.education],['Квалификация и повышение квалификации',p.qualification],...(p.bio?[['Дополнительная информация',p.bio]]:[])].map(([title,body])=>`<section class="profile-block"><h3>${title}</h3><p class="teacher-profile-text">${e(body||'Информация пока не заполнена.')}</p></section>`).join('')}
      <section class="profile-block"><h3>Дипломы, грамоты и сертификаты</h3><p class="hint">Документы, которые преподаватель добавил в свой профиль.</p><div class="document-list">${p.documents.map(d=>{
        const url=safeMaterialUrl(d.url);return `<article class="item"><span class="badge">${categories[d.category]}</span><h4>${e(d.title)}</h4><p class="meta">${e(d.issued_year||'')}</p>${url&&d.mime.startsWith('image/')?`<a href="${e(url)}" target="_blank" rel="noopener noreferrer"><img class="document-preview" src="${e(url)}" alt="${e(d.title)}" loading="lazy"></a>`:''}${url?materialLink(url,d.mime==='application/pdf'?'Открыть PDF / скачать':'Открыть документ'):''}</article>`;
      }).join('')||empty('Документов пока нет. Преподаватель может добавить их в своём профиле.')}</div></section>`; }
  async function viewTeacher(uid,container=document.getElementById('portalPage'),showSubjects=false){
    container.dataset.teacherId=uid;
    const screen=showSubjects?'subjects':'profile';
    container.dataset.teacherScreen=screen;
    const p=await callFunction('getTeacherProfile',{teacherId:uid});
    if(!container.isConnected||container.dataset.teacherId!==uid||container.dataset.teacherScreen!==screen)return;
    if(showSubjects){
      container.innerHTML=`${button('← К профилю','view-teacher',`data-id="${e(uid)}"`)}<div class="subject-heading">${avatar(p)}<div><h2>Предметы преподавателя</h2><p>${e(p.name)}</p></div></div>`+
        SubjectSearch.catalog(p.subjects||[],s=>button('Открыть предмет','teacher-subject-open',`data-id="${e(s.id)}" data-teacher="${e(uid)}"`,'primary'),false);
      SubjectSearch.update();
      return;
    }
    container.innerHTML=`${button('← Все преподаватели','teacher-list')}<div class="profile-heading">${avatar(p)}<div><h2>${e(p.name)}</h2><p>${e(p.position||'Преподаватель')}</p><div class="actions">${button('Посмотреть предметы','teacher-subjects',`data-id="${e(uid)}"`)}${button('Поделиться профилем','share-teacher',`data-id="${e(uid)}" data-name="${e(p.name)}"`)}</div></div></div>
      ${p.canEdit?button('Редактировать профиль','edit-teacher',`data-id="${e(p.id)}"`,'primary'):''}
      ${teacherDetails(p)}`;
  }
  async function viewTeacherSubject(uid,subjectId,container){
    container.dataset.teacherScreen='subject';
    container.dataset.teacherSubjectId=subjectId;
    const page=await callFunction('getSubjectContent',{subjectId,teacherId:uid});
    if(!container.isConnected||container.dataset.teacherId!==uid||container.dataset.teacherScreen!=='subject'||container.dataset.teacherSubjectId!==subjectId)return;
    container.innerHTML=button('← К предметам преподавателя','teacher-subjects',`data-id="${e(uid)}"`)+SubjectContent.render(page);
  }
  async function editTeacher(uid){
    const container=document.getElementById('portalPage');
    editingTeacher=await callFunction('getTeacherProfile',{teacherId:uid});if(!container?.isConnected)return;
    const p=editingTeacher;
    if(!p.canEdit)throw new Error('Недостаточно прав.');
    container.innerHTML=`${button('← К профилю','view-teacher',`data-id="${e(uid)}"`)}<h2 style="margin-top:20px">Профиль преподавателя</h2><p class="section-lead">${e(p.name)}. Добавляйте только документы, которыми вы готовы поделиться с пользователями платформы.</p>
      <form data-portal-form="teacher-profile"><div class="field-grid">${field('teacherPosition','Должность',p.position??'','text','maxlength="200"')}${field('teacherExperience','Педагогический стаж, лет',p.experience_years??'','number','min="0" max="80"')}
      <div class="full-width">${area('teacherEducation','Образование: учебное заведение, специальность, год',p.education??'')}${area('teacherQualification','Квалификация и повышение квалификации',p.qualification??'',3000)}</div>
      ${field('teacherAvatar','Фотография (JPG, PNG, WebP, до 5 МБ)','','file','accept=".jpg,.jpeg,.png,.webp"')}<div><label class="check-label"><input id="removeAvatar" type="checkbox">Убрать текущую фотографию</label></div></div><button class="primary" type="submit">Сохранить профиль</button></form>
      <section class="profile-block"><h3>Добавить документ</h3><form data-portal-form="document"><div class="field-grid">${field('documentTitle','Название документа','','text','required maxlength="200"')}<div class="form-group"><label for="documentCategory">Вид документа</label><select id="documentCategory">${Object.entries(categories).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></div>${field('documentYear','Год выдачи','','number','min="1950" max="2200"')}${field('documentFile','Файл (PDF или изображение, до 10 МБ)','','file','required accept=".pdf,.jpg,.jpeg,.png,.webp"')}</div><button class="primary" type="submit">Добавить документ</button></form></section>
      <section class="profile-block"><h3>Загруженные документы</h3>${p.documents.map(d=>`<article class="item"><h4>${e(d.title)}</h4><p>${categories[d.category]} ${e(d.issued_year||'')}</p>${materialLink(d.url,'Открыть документ')}<div class="actions">${ActionMenu.render(button('Удалить','delete-document',`data-id="${e(d.id)}"`,'danger-button'),'Действия с документом')}</div></article>`).join('')||empty('Добавьте первый документ.')}</section>`;
  }
  async function uploadProfile(file,teacherId,purpose){
    const mime=file.type||({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'})[file.name.split('.').pop().toLowerCase()];
    const grant=await callFunction('createProfileUpload',{teacherId,purpose,mime,size:file.size});
    const form=new FormData();form.append('cacheControl','3600');form.append('',new Blob([file],{type:mime}),file.name);
    const result=await fetch(new URL(grant.url,lmsBaseUrl),{method:'PUT',headers:{'x-upsert':'false'},body:form});
    if(!result.ok)throw new Error('Хранилище не приняло файл.');return grant.path;
  }
  async function renderSchedule(container){ return Schedule.render(container,profile); }
  function renderRecentNotices(rows){
    const list=document.getElementById('recentNotices');
    const recent=rows.slice(0,5);
    recent.forEach(n=>noticeById.set(n.id,n));
    const cards=recent.map(n=>`<button type="button" class="notice-preview${n.read?'':' unread'}${n.severity==='danger'?' danger':''}" data-portal="notice-open" data-id="${e(n.id)}" data-tab="${e(n.destination)}"><strong>${e(n.title)}</strong><span class="notice-preview-body">${e(n.body)}</span></button>`).join('')||empty('Уведомлений пока нет.');
    if(list.innerHTML!==cards)list.innerHTML=cards;
  }
  function noticeCards(rows){
    return rows.map(n=>`<article class="item notice-card ${n.read?'':'unread'} ${n.severity==='danger'?'danger':''}"><span class="notice-category">${n.category==='schedule'?'По подписке':n.category==='announcement'?'Объявление':n.category==='chat'?'Чат кураторов':'Личное'}</span><span class="meta">${e(new Date(n.created_at).toLocaleString('ru-RU'))}${n.read?'':' · Новое'}</span><h3>${e(n.title)}</h3><p>${e(n.body)}</p><div class="actions notice-actions">${button('Открыть','notice-open',`data-id="${e(n.id)}" data-tab="${e(n.destination)}"`)}${n.read?'':ActionMenu.render(button('Прочитано','notice-read',`data-id="${e(n.id)}"`),'Действия с уведомлением')}</div></article>`).join('')||empty('Уведомлений пока нет.');
  }
  async function renderNotices(container){
    const offset=noticeOffset,revision=noticeRevision,feed=await callFunction('listNotifications',{offset});
    if(!container?.isConnected||container.dataset.noticeView!=='history'||noticeOffset!==offset||revision!==noticeRevision)return;
    feed.rows.forEach(n=>noticeById.set(n.id,n));
    document.querySelector('#notificationsDialog [data-portal="notices-read-page"]').disabled=!feed.rows.some(n=>!n.read);
    container.innerHTML=`<div data-notice-list>${noticeCards(feed.rows)}</div>${offset||feed.rows.length===50?`<div class="actions pagination-actions">${button('Назад','notices-prev',offset?'':'disabled')}${button('Далее','notices-next',feed.rows.length===50?'':'disabled')}</div>`:''}`;
    setUnread(feed.unreadCount);
  }
  async function renderAccounts(container){
    container.innerHTML='<h2>Админ панель</h2><p role="status">Загрузка аккаунтов…</p>';
    const rows=await callFunction('listAccounts',{search:accountSearch,offset:accountOffset});if(!container.isConnected)return;accountRows=rows;
    container.innerHTML=`<h2>Аккаунты и роли</h2><p class="section-lead">Новые пользователи — студенты. Изменение роли сохраняет материалы и результаты. Последний администратор защищён от понижения.</p><section id="registrationStats" class="registration-statistics"></section><form class="account-search" data-portal-form="accounts-search"><input id="accountSearch" aria-label="Поиск по ФИО или email" placeholder="Найти по ФИО или email" value="${e(accountSearch)}" maxlength="120"><button class="primary" type="submit">Найти</button></form><div class="table-wrap"><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Действие</th></tr></thead><tbody>${rows.map(p=>`<tr><td class="account-name"><strong>${e(p.name)}</strong><small>${e(p.email)}</small>${p.needs_name?'<span class="badge">Заполнить поля ФИО</span>':''}${p.id===profile.uid?'<span class="badge">Это вы</span>':''}</td><td><select aria-label="Роль ${e(p.email)}" data-role-id="${e(p.id)}">${Object.entries(roles).map(([role,label])=>`<option value="${role}" ${role===p.role?'selected':''}>${label}</option>`).join('')}</select></td><td>${button('Сохранить роль','role-save',`data-id="${e(p.id)}"`)}<button type="button" class="secondary" data-recovery-user="${e(p.id)}">Восстановить доступ</button></td></tr>`).join('')}</tbody></table></div>${!rows.length?empty('Аккаунты не найдены.'):''}<details class="role-log"><summary>История назначения ролей</summary><p>Последние 50 назначений. Доступны только администрации. Уведомление получает только владелец изменённого аккаунта.</p>${button('Загрузить историю','role-log')}<div id="roleChangeLog"></div></details><div class="actions">${button('← Назад','accounts-prev',accountOffset?'':'disabled')}${button('Далее →','accounts-next',rows.length===50?'':'disabled')}</div>`;
    const live=document.createElement('section');live.className='profile-block online-statistics';container.querySelector('#registrationStats').before(live);AdministrationTools.online(live);
    const requests=document.createElement('section');requests.className='profile-block';container.querySelector('#registrationStats').after(requests);AdministrationTools.requests(requests);
    const recovery=document.createElement('section');recovery.className='profile-block';requests.after(recovery);AccountRecovery.render(recovery);
    await News.statistics(container.querySelector('#registrationStats'));
  }
  async function announcements(container){return News.home(container,profile);}
  async function render(tab,parent){
    if(!['home','profile','teachers','schedule','accounts','announcements','help','curator-chat'].includes(tab))return false;
    if(tab!=='curator-chat')CuratorChat.clear();
    if(tab!=='schedule'&&typeof Realtime!=='undefined')Realtime.watchGroup(null);
    parent.innerHTML='<section id="portalPage" aria-live="polite"></section>';const target=parent.firstElementChild;
    if(tab==='curator-chat')await CuratorChat.render(target,profile);
    if(tab==='home')await home(target);
    if(tab==='profile')await myProfile(target);
    if(tab==='teachers'){const selection=pendingTeacher;pendingTeacher=null;if(selection)await viewTeacher(selection.uid,target,selection.showSubjects);else await renderTeachers(target);}
    if(tab==='schedule')await renderSchedule(target);
    if(tab==='accounts')await renderAccounts(target);
    if(tab==='announcements')await announcements(target);
    if(tab==='help')await AccountTools.render(tab,target);
    return true;
  }
  async function action(name,node){
    const container=document.getElementById('portalPage');
    if(name==='navigate')return navigate(node.dataset.tab);
    if(name==='subscriptions')return openSubscriptions();
    if(name==='account-logout'){closeProfileMenu();return logout();}
    if(name==='notice-settings')return openNotices('settings');
    if(name==='role-log'){const rows=await callFunction('listRoleChanges');const target=container.querySelector('#roleChangeLog');target.innerHTML=rows.length?rows.map(r=>`<article class="role-log-row"><strong>${e(r.user_name)}</strong><span>${e(roles[r.old_role])} → ${e(roles[r.new_role])}</span><small>${e(r.actor_name)} · ${e(new Date(r.created_at).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'}))}</small></article>`).join(''):'<p>Назначений пока нет.</p>';return;}
    if(name==='close-toast')return node.closest('.toast').remove();
    if(name==='close-dialog')return document.getElementById('notificationsDialog').close();
    if(name==='open-notifications')return openNotices();
    if(name==='retry-notices')return readNoticePopover();
    if(name==='view-teacher'){if(!container){navigate('teachers');await new Promise(r=>setTimeout(r,0));}return viewTeacher(node.dataset.id);}
    if(name==='teacher-subjects')return viewTeacher(node.dataset.id,container,true);
    if(name==='share-teacher'){
      const url=new URL('index.html',location.href);
      url.searchParams.set('teacher',node.dataset.id);
      if(navigator.share){
        try{await navigator.share({title:node.dataset.name,url:url.href});return;}
        catch(error){if(error.name==='AbortError')return;}
      }
      try{await navigator.clipboard.writeText(url.href);toast('Ссылка на профиль скопирована');}
      catch{prompt('Ссылка на профиль преподавателя',url.href);}
      return;
    }
    if(name==='teacher-subject-open'){
      const {id,teacher}=node.dataset;
      if(typeof openInstructorSubject==='function')return openInstructorSubject(id,teacher);
      return viewTeacherSubject(teacher,id,container);
    }
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
    if(name==='notices-next'||name==='notices-prev'){noticeOffset=Math.max(0,noticeOffset+(name.endsWith('next')?50:-50));return openNotices('history',false);}
    if(['notice-read','notice-open','notices-read-page'].includes(name)){
      const noticeRoot=document.getElementById('popupNotices');
      const ids=name==='notices-read-page'?[...noticeRoot.querySelectorAll('[data-portal="notice-open"]')].map(n=>n.dataset.id):[node.dataset.id];
      const notice=noticeById.get(node.dataset.id);
      if(name!=='notice-open'||!notice?.read){await callFunction('readNotifications',{ids});await poll();}
      if(name==='notice-open'){if(notice?.context?.groupId)Schedule.selectGroup(notice.context.groupId);return navigate(node.dataset.tab);}
      return renderNotices(noticeRoot);
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
      const data={teacherId:uid,position:val('teacherPosition'),education:val('teacherEducation'),qualification:val('teacherQualification'),experienceYears:val('teacherExperience')===''?null:Number(val('teacherExperience')),revision:editingTeacher.revision};
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
    node.disabled=true;try{await action(node.dataset.portal,node);}catch(error){showStatus(error.message);toast('Не удалось выполнить действие',error.message,'danger');}finally{
      if(node.dataset.portal==='notices-read-page'){
        const root=node.closest('#notificationsDialog')?.querySelector('#popupNotices')||node.closest('#portalPage');
        node.disabled=!root?.querySelector('.notice-card.unread');
      }else node.disabled=false;
    }
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-portal-form]');if(!form)return;event.preventDefault();
    const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;showStatus('');
    const kind=form.dataset.portalForm,complete=kind==='accounts-search'?null:saveButton(submit);
    try{await formAction(kind);complete?.(true);}
    catch(error){complete?.(false);showStatus(error.message);toast('Изменения не сохранены',error.message,'danger');}
    finally{submit.disabled=false;}
  });
  function openTeacher(uid,showSubjects=false){pendingTeacher={uid,showSubjects};navigate('teachers');}
  function openSubscriptions(){return openNotices('subscriptions');}
  document.addEventListener('lms-live-update',async event=>{
    if(!profile)return;const changed=event.detail.topics,all=changed.includes('resync'),root=document.getElementById('portalPage');
    if(all||changed.includes('profile')){const current=await getProfile(auth.currentUser).catch(()=>null);if(current){profile={...profile,...current};document.getElementById('userName').textContent=profile.name;AccountTools.syncHeader(profile.avatarUrl);}}
    if(all||changed.some(t=>['notices','subscriptions'].includes(t))){
      await poll();
      const popup=document.getElementById('notificationsDialog');
      if(popup?.open){const target=popup.querySelector('#popupNotices');if(target.dataset.noticeView==='history')await renderNotices(target).catch(()=>{});}
    }
    if(!root?.isConnected)return;
    const tab=document.querySelector('.tabs [data-tab].active')?.dataset.tab;
    const relevant=tab==='accounts'&&(all||changed.includes('accounts'))||tab==='profile'&&(all||changed.includes('profile'))||tab==='teachers'&&(all||changed.some(t=>['content','people'].includes(t)))||tab==='help'&&(all||changed.includes('settings'));
    if(relevant&&!root.querySelector('[data-portal-form="teacher-profile"]'))Realtime.update('portal-view',root,()=>{
      if(tab==='accounts')return renderAccounts(root);
      if(tab==='profile'&&!root.dataset.teacherId)return myProfile(root);
      if(tab==='teachers'||tab==='profile'){
        const {teacherId,teacherScreen,teacherSubjectId}=root.dataset;
        if(!teacherId)return renderTeachers(root);
        return teacherScreen==='subject'?viewTeacherSubject(teacherId,teacherSubjectId,root):viewTeacher(teacherId,root,teacherScreen==='subjects');
      }
      return AccountTools.render(tab,root);
    });
  });
  return {teacherDetails,init,render,navigate,toast,openTeacher,openSubscriptions,saveButton};
})();
