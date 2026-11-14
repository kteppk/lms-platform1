const AccountTools=(()=>{
 let actor,onPhoto,settings=null,search='',role='',offset=0,searchGeneration=0,previewURL=null;
 const e=v=>escapeHtml(v??''),roles={student:'Студент',teacher:'Преподаватель',admin:'Администратор'};
 const faq=[
  ['Начало работы','Как войти и заполнить профиль?','Войдите по email и паролю. При регистрации укажите имя и фамилию отдельно; отчество необязательно. В «Мой профиль» можно исправить ФИО, загрузить фотографию и поменять пароль.'],
  ['Предметы','Как открыть материалы преподавателя?','Откройте «Предметы» и найдите дисциплину через поиск. Если преподавателей несколько, выберите нужного. На странице доступны полное описание, лекции, видео, PDF и тесты этого преподавателя. Ранее опубликованные материалы также доступны в разделе «Материалы».'],
  ['Расписание','Как увидеть расписание своей группы?','В разделе «Расписание» выберите группу. Будут показаны только её занятия. Основное расписание повторяется каждую неделю, пока администратор не изменит ячейку. «Нет пары» означает отмену занятия, «Не заполнено» — отсутствие внесённых данных.'],
  ['Уведомления','Как подписаться и отписаться от расписания?','В расписании выбранной группы нажмите колокольчик. Красный перечёркнутый колокольчик означает действующую подписку: нажмите ещё раз, чтобы отписаться. Просмотр группы сам по себе не включает подписку. Все подписки доступны в уведомлениях через меню «⋯» → «Мои подписки».'],
  ['Тесты','Что делать, если пропал интернет во время теста?','Сохраняйте вкладку открытой и дождитесь восстановления связи. Черновик на этом устройстве помогает восстановить ответы; статус под тестом показывает, сохранены ли они на сервере. После перезагрузки продолжится та же попытка с прежним сроком. Таймер продолжает идти без интернета. Не выходите из аккаунта с несохранённым черновиком.'],
  ['Результаты','Где посмотреть баллы и комментарий преподавателя?','Откройте «Мои результаты» и выберите тест. Можно увидеть свои попытки и открыть ответы. Текстовые и фотоответы сначала ожидают ручной проверки. Оценка 2–5 появляется после полной проверки, если преподаватель настроил шкалу; до этого отображаются баллы и статус.'],
  ['Люди','Как найти человека и загрузить фото?','В разделе «Люди» введите ФИО или его часть и при необходимости выберите роль. Email и результаты других пользователей в поиске не показываются. Фото можно загрузить в «Мой профиль» из галереи или файла; с компьютера можно вставить изображение из буфера. Фотография видна пользователям платформы.'],
  ['Аккаунт','Как поменять или восстановить пароль?','Если вы помните пароль, откройте «Мой профиль» → «Изменить пароль», введите старый пароль и дважды новый. Если пароль забыт, используйте «Забыли пароль?» на странице входа. Проверяйте также папку «Спам» в почте. Не отправляйте свой пароль в форме обратной связи.'],
  ['Слабый интернет','Почему показано «Сохранено на устройстве»?','Часть расписания, предметов и новостей сохраняется на вашем устройстве. У сохранённой копии есть дата; без сети её актуальность не подтверждена. Для проверки свежих данных подключитесь к интернету и обновите раздел. Вход впервые, загрузка файлов и отправка изменений требуют связи. На общем устройстве не включайте «Запомнить меня».'],
  ['Преподавателю','Как добавить предмет, материал или тест?','В «Предметы» создайте дисциплину или присоединитесь к существующей. Откройте предмет для публикации материалов. При создании теста выберите нужный предмет и типы вопросов. Удаление теста переносит его в архив: история и уже начатые попытки сохраняются. Редактирование и архивирование доступны через «⋯».'],
  ['Преподавателю','Как проверить работы и перенести оценки в журнал?','В «Результаты тестов» выберите тест, откройте работу со статусом «Ожидает проверки», оцените текстовые/фотоответы и сохраните комментарий. При необходимости настройте шкалу 2–5. В меню «⋯» доступны Excel и печать; история попыток находится в меню строки студента.'],
  ['Администратору','Как назначить роль и изменить расписание?','В «Аккаунты и роли» найдите аккаунт, выберите роль и сохраните. Последнего администратора нельзя понизить. В расписании выберите группу и нажмите ячейку: заполните занятие или отметьте «Нет пары». Для добавления группы используйте «⋯». При конфликте сначала обновите данные, затем повторите изменение.'],
 ];
 function avatar(p){const url=safeMaterialUrl(p.avatarUrl);return url?`<img class="avatar account-avatar" src="${e(url)}" alt="Фото ${e(p.name)}" loading="lazy" decoding="async">`:`<span class="avatar account-avatar" aria-hidden="true">${e(String(p.name||'').split(/\s+/).slice(0,2).map(s=>[...s][0]).join(''))}</span>`;}
 function syncHeader(url){
  const link=document.querySelector('.profile-link');if(!link)return;
  let img=link.querySelector('.account-header-avatar');const safe=safeMaterialUrl(url);
  if(!safe){img?.remove();link.classList.remove('has-photo');return;}
  if(!img){img=document.createElement('img');img.className='account-header-avatar';img.alt='';link.prepend(img);}
  img.onload=()=>link.classList.add('has-photo');img.onerror=()=>{img.remove();link.classList.remove('has-photo');};img.src=safe;
 }
 function init(person,callback){actor=person;onPhoto=callback;syncHeader(person.avatarUrl);}
 function profileSections(p){
  actor={...actor,...p};if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
  return `<section class="profile-block account-photo"><h2>Фотография профиля</h2><p class="hint">Ваша фотография видна пользователям платформы.</p><form id="accountPhotoForm" data-account-form="avatar"><div class="photo-upload-line"><div id="accountPhotoPreview">${avatar(p)}</div><div class="photo-upload-fields"><label for="accountPhoto">JPG, PNG или WebP, до 5 МБ<input id="accountPhoto" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="hint" tabindex="0" data-photo-paste>Выберите файл или вставьте изображение из буфера (Ctrl+V).</p></div></div><div class="actions"><button class="primary" type="submit">Сохранить фотографию</button>${p.avatarUrl?'<button type="button" class="secondary" data-account="remove-avatar">Убрать фотографию</button>':''}</div><p data-photo-status role="status"></p></form></section>
   <section class="profile-block"><details class="account-password"><summary>Изменить пароль</summary><p class="hint">Нужен текущий пароль. Новый — от 8 до 128 символов.</p><form data-account-form="password">${[['oldPassword','Старый пароль','current-password'],['newPassword','Новый пароль','new-password'],['repeatPassword','Повторите новый пароль','new-password']].map(([id,label,complete])=>`<label for="${id}">${label}</label><div class="password-control"><input id="${id}" type="password" autocomplete="${complete}" required ${id!=='oldPassword'?'minlength="8" maxlength="128"':''}><button type="button" class="secondary" data-account="show-password" data-input="${id}" aria-label="Показать: ${label.toLowerCase()}" aria-pressed="false">Показать</button></div>`).join('')}<p data-password-status role="status"></p><button type="submit" class="primary">Изменить пароль</button></form></details></section>`;
 }
 async function people(root){
  const generation=++searchGeneration;
  root.innerHTML=`<h2>Люди</h2><p class="section-lead">Найдите студента, преподавателя или администратора по ФИО.</p><form data-account-form="people" class="people-search"><label for="peopleSearch">ФИО<input id="peopleSearch" type="search" maxlength="200" value="${e(search)}" placeholder="Фамилия или имя" autocomplete="off"></label><label for="peopleRole">Роль<select id="peopleRole"><option value="">Все роли</option>${Object.entries(roles).map(([id,name])=>`<option value="${id}" ${id===role?'selected':''}>${name}</option>`).join('')}</select></label><button type="submit" class="primary">Найти</button></form><div id="peopleResults" aria-live="polite"><p role="status">Загрузка людей…</p></div>`;
  const data=await callFunction('searchPeople',{search,role,offset});if(!root.isConnected||generation!==searchGeneration)return;
  root.querySelector('#peopleResults').innerHTML=`<div class="people-grid">${data.rows.map(p=>`<article class="person-card">${avatar(p)}<div><h3>${e(p.name)}</h3><p class="meta">${e(roles[p.role])}${p.position?' · '+e(p.position):''}</p><button type="button" class="secondary" data-account="person" data-id="${e(p.id)}">Открыть профиль</button></div></article>`).join('')||'<p class="empty-state">Никого не найдено. Проверьте ФИО или измените роль.</p>'}</div><div class="actions pagination-actions"><button type="button" data-account="people-prev" class="secondary" ${offset?'':'disabled'}>← Назад</button><span>Страница ${offset/30+1}</span><button type="button" data-account="people-next" class="secondary" ${data.hasMore?'':'disabled'}>Далее →</button></div>`;
 }
 async function person(root,uid){
  const generation=++searchGeneration;root.innerHTML='<p role="status">Загрузка профиля…</p>';
  const p=await callFunction('getPerson',{userId:uid});if(!root.isConnected||generation!==searchGeneration)return;
  root.innerHTML=`<button type="button" class="secondary" data-account="people">← К поиску людей</button><div class="profile-heading">${avatar(p)}<div><h2>${e(p.name)}</h2><span class="badge">${e(roles[p.role])}</span></div></div><div class="actions">${p.hasTeacherProfile?`<button type="button" class="primary" data-portal="view-teacher" data-id="${e(p.id)}">Профиль преподавателя</button>`:''}${p.id===actor.uid?'<button type="button" class="secondary" data-portal="navigate" data-tab="profile">Изменить свой профиль</button>':''}</div>`;
 }
 function feedbackLink(){
  return settings?.feedbackUrl?`<a class="feedback-link primary" href="${e(settings.feedbackUrl)}" target="_blank" rel="noopener noreferrer">Идеи, улучшения и ошибки ↗</a><p class="hint">Откроется Google Форма в новой вкладке.</p>`:'<button type="button" class="feedback-link secondary" disabled>Идеи, улучшения и ошибки</button><p class="hint">Форма скоро появится.</p>';
 }
 async function help(root){
  ++searchGeneration;
  root.innerHTML=`<h2>Справочник</h2><p class="section-lead">Ответы на вопросы об учебной платформе.</p><label class="help-search" for="helpSearch">Найти ответ<input id="helpSearch" type="search" placeholder="Например, пароль или расписание"></label><div class="help-answers">${faq.map(([topic,q,a])=>`<details class="help-answer" data-help-search="${e((topic+' '+q+' '+a).toLocaleLowerCase('ru-RU').replaceAll('ё','е'))}"><summary><span>${e(topic)}</span>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</div><p id="helpEmpty" class="empty-state" hidden>Подходящего ответа пока нет. Попробуйте другое слово.</p><section class="profile-block"><h3>Есть идея или заметили ошибку?</h3><div id="feedbackLink"><p role="status">Проверяем форму обратной связи…</p></div></section>${actor.role==='admin'?'<section class="profile-block"><details><summary>Подключить Google Форму</summary><p class="hint">Создайте форму для идей, улучшений и ошибок, разрешите её заполнение и вставьте ссылку для отправки ответов. Пароли в форме запрашивать не нужно.</p><form data-account-form="settings"><label for="feedbackUrl">Ссылка Google Формы<input id="feedbackUrl" type="url" maxlength="2000" placeholder="https://forms.gle/…"></label><p data-settings-status role="status"></p><button type="submit" class="primary">Сохранить ссылку</button></form></details></section>':''}`;
  try{settings=await callFunction('getPortalSettings');if(!root.isConnected)return;root.querySelector('#feedbackLink').innerHTML=feedbackLink();if(actor.role==='admin')root.querySelector('#feedbackUrl').value=settings.feedbackUrl||'';}
  catch{if(root.isConnected)root.querySelector('#feedbackLink').innerHTML='<p class="hint">Не удалось проверить ссылку. Откройте справочник после восстановления связи.</p>';settings=null;}
 }
 async function preparePhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024||file.size===0)throw new Error('Выберите JPG, PNG или WebP до 5 МБ.');
  let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error('Не удалось открыть изображение. Выберите другую фотографию.');}
  try{const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.82));if(!blob)throw new Error('Не удалось подготовить фото.');return new File([blob],'avatar.webp',{type:blob.type});
  }finally{bitmap.close();}
 }
 async function uploadPhoto(file){
  const photo=await preparePhoto(file),grant=await callFunction('createAvatarUpload',{mime:photo.type,size:photo.size});
  const form=new FormData();form.append('cacheControl','3600');form.append('',photo,photo.name);
  try{const response=await fetch(new URL(grant.url,lmsBaseUrl),{method:'PUT',headers:{'x-upsert':'false'},body:form});if(!response.ok)throw new Error('Не удалось загрузить фото. Повторите при работающем интернете.');return grant.path;}
  catch(error){await callFunction('removeAvatarUpload',{path:grant.path}).catch(()=>{});throw error;}
 }
 async function savePhoto(form,path){
  const update=await callFunction('saveMyAvatar',{path,revision:actor.avatarRevision??0});actor={...actor,...update};onPhoto(update);syncHeader(update.avatarUrl);
  if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
  form.querySelector('#accountPhotoPreview').innerHTML=avatar(actor);form.reset();
  let remove=form.querySelector('[data-account="remove-avatar"]');if(!update.avatarUrl)remove?.remove();else if(!remove)form.querySelector('.actions').insertAdjacentHTML('beforeend','<button type="button" class="secondary" data-account="remove-avatar">Убрать фотографию</button>');
  form.querySelector('[data-photo-status]').textContent=update.avatarUrl?'Фотография сохранена.':'Фотография удалена.';
 }
 async function password(form){
  const user=auth.currentUser,old=form.querySelector('#oldPassword'),next=form.querySelector('#newPassword'),repeat=form.querySelector('#repeatPassword'),status=form.querySelector('[data-password-status]');
  if(!user?.email)throw new Error('Войдите в аккаунт заново.');
  if(next.value!==repeat.value)throw new Error('Новые пароли не совпадают.');if(next.value===old.value)throw new Error('Новый пароль должен отличаться от старого.');
  status.textContent='Проверяем пароль…';
  try{await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email,old.value));await user.updatePassword(next.value);form.reset();status.textContent='Пароль изменён.';}
  catch(error){const messages={'auth/wrong-password':'Старый пароль указан неверно.','auth/invalid-credential':'Старый пароль указан неверно.','auth/invalid-login-credentials':'Старый пароль указан неверно.','auth/weak-password':'Новый пароль не соответствует требованиям. Попробуйте более сложный пароль.','auth/too-many-requests':'Слишком много попыток. Попробуйте позже.','auth/network-request-failed':'Не удалось связаться с сервером входа. Проверьте интернет.','auth/requires-recent-login':'Повторите проверку старого пароля.','auth/user-disabled':'Этот аккаунт отключён. Обратитесь к администратору.'};throw new Error(messages[error.code]||'Не удалось изменить пароль. Попробуйте позже.');}
  finally{old.value='';form.querySelectorAll('input[type="text"]').forEach(n=>n.type='password');form.querySelectorAll('[data-account="show-password"]').forEach(n=>{n.textContent='Показать';n.setAttribute('aria-pressed','false');n.setAttribute('aria-label','Показать пароль');});}
 }
 document.addEventListener('input',event=>{if(event.target.id==='helpSearch'){const words=event.target.value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё','е').split(/\s+/);const rows=[...document.querySelectorAll('[data-help-search]')];for(const row of rows)row.hidden=!words.every(w=>row.dataset.helpSearch.includes(w));document.getElementById('helpEmpty').hidden=rows.some(r=>!r.hidden);}});
 document.addEventListener('change',event=>{if(event.target.id!=='accountPhoto')return;const file=event.target.files[0],root=event.target.closest('form');if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}root.querySelector('[data-photo-status]').textContent='';if(!file){root.querySelector('#accountPhotoPreview').innerHTML=avatar(actor);return;}if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){event.target.value='';root.querySelector('[data-photo-status]').textContent='Выберите JPG, PNG или WebP до 5 МБ.';root.querySelector('#accountPhotoPreview').innerHTML=avatar(actor);return;}previewURL=URL.createObjectURL(file);root.querySelector('#accountPhotoPreview').innerHTML=`<img class="avatar account-avatar" alt="Предпросмотр фотографии" src="${e(previewURL)}">`;});
 document.addEventListener('paste',event=>{const form=event.target.closest('#accountPhotoForm');if(!form)return;const file=[...(event.clipboardData?.items||[])].find(i=>i.kind==='file'&&i.type.startsWith('image/'))?.getAsFile();if(!file)return;event.preventDefault();const transfer=new DataTransfer();transfer.items.add(file);const input=form.querySelector('#accountPhoto');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
 document.addEventListener('click',async event=>{
  const node=event.target.closest('[data-account]');if(!node||node.disabled)return;const action=node.dataset.account,root=document.getElementById('portalPage');
  if(action==='show-password'){const input=document.getElementById(node.dataset.input),show=input.type==='password';input.type=show?'text':'password';node.textContent=show?'Скрыть':'Показать';node.setAttribute('aria-label',show?'Скрыть пароль':'Показать пароль');node.setAttribute('aria-pressed',String(show));return;}
  node.disabled=true;
  try{if(action==='people')await people(root);if(action==='person')await person(root,node.dataset.id);if(action==='people-prev'||action==='people-next'){offset=Math.max(0,offset+(action==='people-next'?30:-30));await people(root);}if(action==='remove-avatar'){const form=node.closest('form');if(form.dataset.busy)return;form.dataset.busy='true';try{await savePhoto(form,null);}finally{delete form.dataset.busy;}}}
  catch(error){Portal.toast('Не удалось выполнить действие',error.message,'danger');}finally{node.disabled=false;}
 });
 document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-account-form]');if(!form)return;event.preventDefault();if(form.dataset.busy)return;form.dataset.busy='true';const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  const kind=form.dataset.accountForm,status=form.querySelector('[data-password-status],[data-photo-status],[data-settings-status]');if(status)status.textContent='';
  try{
   if(kind==='people'){search=form.querySelector('#peopleSearch').value;role=form.querySelector('#peopleRole').value;offset=0;await people(document.getElementById('portalPage'));}
   if(kind==='avatar'){const file=form.querySelector('#accountPhoto').files[0];if(!file)throw new Error('Выберите фотографию.');const path=await uploadPhoto(file);try{await savePhoto(form,path);}catch(error){await callFunction('removeAvatarUpload',{path}).catch(()=>{});throw error;}}
   if(kind==='password')await password(form);
   if(kind==='settings'){if(!settings)throw new Error('Откройте справочник заново, чтобы загрузить настройки.');settings=await callFunction('savePortalSettings',{feedbackUrl:form.querySelector('#feedbackUrl').value,revision:settings.revision});form.querySelector('#feedbackUrl').value=settings.feedbackUrl||'';document.getElementById('feedbackLink').innerHTML=feedbackLink();status.textContent='Ссылка сохранена.';}
  }catch(error){if(status)status.textContent=error.message;else Portal.toast('Не удалось загрузить данные',error.message,'danger');}
  finally{delete form.dataset.busy;submit.disabled=false;}
 });
 return {init,profileSections,syncHeader,render:(tab,root)=>tab==='people'?people(root):help(root)};
})();
