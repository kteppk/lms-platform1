const News = (()=>{
  const e=v=>escapeHtml(v),names={site:'Новости сайта',college:'Новости техникума'},kinds={news:'Новость',announcement:'Объявление',update:'Журнал обновлений'};
  const records=new Map(),states=new WeakMap(),editorPhotos=new WeakMap();let currentPerson=null;
  const maxPhotos=4, maxPhotoBytes=140*1024;
  const photoUrl=id=>typeof id==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)?'/storage/v1/news-photo/'+id:'';
  function gallery(post){
    const images=(post.photos||[]).map(photoUrl).filter(Boolean);
    return images.length?`<div class="news-photos">${images.map((url,i)=>`<a href="${url}" target="_blank" rel="noopener" aria-label="Открыть фото ${i+1}"><img src="${url}" alt="Фото ${i+1} к публикации «${e(post.title)}»" loading="lazy" decoding="async"></a>`).join('')}</div>`:'';
  }
  async function preparePhoto(file){
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024||!file.size)throw Error('Выберите фото JPEG, PNG или WebP размером до 20 МБ.');
    let image;
    try{image=await createImageBitmap(file);}catch{throw Error('Не удалось открыть фото «'+file.name+'».');}
    try{
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
      for(const size of [1600,1200,900,650]){
        const scale=Math.min(1,size/Math.max(image.width,image.height));
        canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
        context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
        for(const quality of [.85,.72,.58]){
          const imageUrl=canvas.toDataURL('image/jpeg',quality),data=imageUrl.split(',')[1];
          if(data&&Math.ceil(data.length*3/4)<=maxPhotoBytes)return {data,url:imageUrl};
        }
      }
      throw Error('Не удалось уменьшить размер фото «'+file.name+'».');
    }finally{image.close();}
  }
  function photoEditor(form,post){
    const photos=(post?.photos||[]).filter(photoUrl).map(id=>({id,url:photoUrl(id)}));
    form.insertAdjacentHTML('beforeend',`<fieldset class="news-photo-editor"><legend>Фотографии</legend><label for="newsPhotos">Добавить фото<input id="newsPhotos" type="file" multiple accept="image/jpeg,image/png,image/webp"></label><small>До ${maxPhotos} фото. JPEG, PNG или WebP.</small><div class="news-photo-editor-list"></div><p class="news-photo-error" role="status"></p></fieldset>`);
    const field=form.querySelector('.news-photo-editor'),input=field.querySelector('input'),list=field.querySelector('.news-photo-editor-list'),status=field.querySelector('[role="status"]'),submit=form.querySelector('[type="submit"]');
    form.querySelector('.actions').before(field);
    const update=()=>{
      list.innerHTML=photos.map(({url},i)=>`<article><img src="${url}" alt="Фото ${i+1}"><button type="button" class="secondary" data-remove-photo="${i}" aria-label="Убрать фото ${i+1}">Убрать фото</button></article>`).join('');
      input.disabled=photos.length>=maxPhotos;
    };
    list.onclick=event=>{const button=event.target.closest('[data-remove-photo]');if(!button||form.dataset.preparingPhotos||submit.disabled)return;photos.splice(Number(button.dataset.removePhoto),1);status.textContent='';update();};
    input.onchange=async()=>{
      const chosen=[...input.files];input.value='';if(!chosen.length||submit.disabled)return;
      if(photos.length+chosen.length>maxPhotos){status.textContent='Можно прикрепить до четырёх фотографий.';return;}
      input.disabled=submit.disabled=true;form.dataset.preparingPhotos='true';status.textContent='Подготавливаем фото…';
      try{const prepared=[];for(const file of chosen)prepared.push(await preparePhoto(file));photos.push(...prepared);status.textContent='';}
      catch(error){status.textContent=error.message;}
      finally{delete form.dataset.preparingPhotos;submit.disabled=false;update();}
    };
    editorPhotos.set(form,photos);update();
  }
  async function refresh(list){
    const state=states.get(list);if(!state||!list.isConnected)return;
    if(state.loading){state.refreshAfter=true;return;}
    const target=Math.max(state.offset,1),rows=[];let offset=0,hasMore=false;
    do{const data=await callFunction('listNews',{channel:state.channel,offset,order:list.dataset.order||'newest'},undefined,{fresh:true});
      if(states.get(list)!==state||!list.isConnected||data._offline?.stale)return;rows.push(...data.rows);hasMore=data.hasMore;offset+=data.rows.length;
      if(!data.rows.length)break;
    }while(hasMore&&offset<target&&offset<500);
    const items=list.querySelector('.news-items');if(!items)return;
    const opened=new Set([...items.querySelectorAll('.news-article')].filter(n=>n.querySelector('details[open]')).map(n=>n.dataset.newsId));
    const anchor=[...items.children].find(n=>n.getBoundingClientRect().bottom>0),position=anchor?.getBoundingClientRect().top,id=anchor?.dataset.newsId;
    items.innerHTML=rows.map(n=>article(n,state.manage)).join('')||'<p class="empty-state">Публикаций пока нет.</p>';state.offset=offset;
    for(const n of items.querySelectorAll('.news-article'))if(opened.has(n.dataset.newsId))n.querySelector('details')?.setAttribute('open','');
    list.querySelector('[data-news-action="more"]')?.remove();if(hasMore)list.insertAdjacentHTML('beforeend','<button type="button" class="secondary news-more" data-news-action="more">Показать более ранние</button>');
    const replacement=[...items.children].find(n=>n.dataset.newsId===id);if(replacement&&position!==undefined)window.scrollBy(0,replacement.getBoundingClientRect().top-position);
  }
  const heart=n=>`<svg viewBox="0 0 24 24" width="22" height="22" fill="${n.liked?'currentColor':'none'}" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>`;
  const like=n=>`<button type="button" class="news-like${n.liked?' is-liked':''}" data-news-action="like" data-id="${e(n.id)}" aria-pressed="${!!n.liked}" aria-label="${n.liked?'Убрать лайк':'Нравится'}" title="${currentPerson?.role==='guest'?'Войдите, чтобы поставить лайк':'Нравится'}">${heart(n)}<span>${Number(n.like_count)||0}</span></button>`;
  function article(n,manage=false){
    records.set(n.id,n);
    const long=n.body.length>600,commit=/^[a-f0-9]{40}$/.test(n.commit_sha??'')?n.commit_sha:null;
    return `<article class="news-article" data-news-id="${e(n.id)}"><div class="news-meta"><span class="news-tag" data-news-channel="${e(n.channel)}">${names[n.channel]||names.site}</span><span>${kinds[n.kind]||'Новость'}</span><time datetime="${e(n.published_at)}">${e(new Date(n.published_at).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk',dateStyle:'long',timeStyle:'short'}))}</time>${manage&&n.can_edit?ActionMenu.render(`<button type="button" class="secondary" data-news-action="edit" data-id="${e(n.id)}">Редактировать</button><button type="button" class="danger-button" data-news-action="delete" data-id="${e(n.id)}">Удалить</button>`,'Действия с публикацией'):''}</div><h3>${e(n.title)}</h3><p class="news-body">${e(long?n.body.slice(0,380)+'…':n.body)}</p>${long?`<details class="news-full"><summary>Читать полностью</summary><p class="news-body">${e(n.body)}</p></details>`:''}${commit?`<a class="commit-link" href="https://github.com/kteppk/lms-platform1/commit/${commit}" target="_blank" rel="noopener noreferrer">Коммит ${commit.slice(0,7)} ↗</a>`:''}${gallery(n)}<div class="news-reactions">${like(n)}</div></article>`;
  }
  async function feed(root,channel,more=false,manage=false,fresh=false){
    let state=states.get(root);if(!more||!state){state={channel,offset:0,manage};states.set(root,state);root.innerHTML='<p role="status">Загрузка новостей…</p>';}
    state.loading=true;try{
      const data=await callFunction('listNews',{channel,offset:state.offset,order:root.dataset.order||'newest'},undefined,{fresh:fresh||manage});if(!root.isConnected||states.get(root)!==state)return;
      if(!more)root.innerHTML=AppConnection.note(data)+'<div class="news-items"></div>';
      root.querySelector('.news-items').insertAdjacentHTML('beforeend',data.rows.filter(n=>![...root.querySelectorAll('[data-news-id]')].some(node=>node.dataset.newsId===n.id)).map(n=>article(n,manage)).join('')||(!more?'<p class="empty-state">Публикаций пока нет.</p>':''));
      state.offset+=data.rows.length;root.querySelector('[data-news-action="more"]')?.remove();
      if(data.hasMore)root.insertAdjacentHTML('beforeend','<button type="button" class="secondary news-more" data-news-action="more">Показать более ранние</button>');
    }catch(error){if(root.isConnected&&states.get(root)===state){if(!more)root.innerHTML='<p role="status">Не удалось загрузить новости.</p><button type="button" class="secondary" data-news-action="retry">Повторить</button>';else Portal.toast('Не удалось загрузить новости',error.message,'danger');}}
    finally{state.loading=false;if(state.refreshAfter&&states.get(root)===state&&root.isConnected){state.refreshAfter=false;Realtime.update('news',root,()=>refresh(root),{scroll:false});}}
  }
  async function home(root,person){
    currentPerson=person;
    const manage=['admin','curator'].includes(person.role);if(manage)root.dataset.newsManager='true';else delete root.dataset.newsManager;
    const compose=manage?'<button type="button" class="primary news-composer-button" data-news-action="compose">Написать новость</button>':'';
    const menu=ActionMenu.render('<button type="button" data-news-action="refresh-home">Обновить новости</button>','Действия с новостями');
    root.innerHTML=`<div class="news-masthead"><span class="eyebrow">КТЭиП ПК · Учебная платформа</span><span class="edition-mark">КЫЗЫЛ / ВЫПУСК ${e(SiteRelease.version)}</span><div class="page-heading"><h2 id="news-title">Новости</h2><div class="news-heading-actions">${compose}${menu}</div></div><p>События техникума и изменения учебной платформы.</p></div><section class="news-feed" aria-labelledby="news-title"<div data-news-feed="all"></div></section>`;
    if(manage)root.querySelector('.news-masthead').insertAdjacentHTML('afterend','<section id="newsEditor" class="news-editor" hidden></section>');
    const section=root.querySelector('.news-feed');section.insertAdjacentHTML('beforebegin','<div class="news-layout"><aside class="news-filters"><h3>Ваша лента</h3><label for="newsTag">Теги<select id="newsTag"><option value="all">Все новости</option><option value="site">Новости сайта</option><option value="college">Новости техникума</option></select></label><label for="newsOrder">Порядок публикаций<select id="newsOrder"><option value="newest">Свежие сначала</option><option value="oldest">Старые сначала</option></select></label><p>Выберите тему и порядок новостей.</p></aside></div>');root.querySelector('.news-layout').prepend(section);
    await feed(root.querySelector('[data-news-feed]'),'all',false,manage);
  }

  function editor(root,post=null){
    root._editingNews=post;
    root.querySelector('#newsEditor').innerHTML=`<h3>${post?'Редактировать публикацию':'Новая публикация'}</h3><form data-news-form><div class="field-grid"><label for="newsChannel">Тег<select id="newsChannel"><option value="site" ${post?.channel==='site'?'selected':''}>Новости сайта</option><option value="college" ${post?.channel==='college'?'selected':''}>Новости техникума</option></select></label><label for="newsKind">Вид публикации<select id="newsKind">${Object.entries(kinds).map(([v,t])=>`<option value="${v}" ${post?.kind===v?'selected':''}>${t}</option>`).join('')}</select></label></div><label for="newsTitle">Заголовок<input id="newsTitle" required maxlength="200" value="${e(post?.title??'')}"></label><label for="newsBody">Текст<textarea id="newsBody" required maxlength="20000" rows="7">${e(post?.body??'')}</textarea></label><label class="check-label"><input id="newsNotify" type="checkbox">Также отправить общее уведомление (текст до 2000 символов)</label><label class="check-label"><input id="newsImportant" type="checkbox">Выделить уведомление как важное</label><p class="hint">По умолчанию публикация появляется только в новостях. Для рассылки включите «Также отправить общее уведомление». Обновления GitHub добавляются автоматически, без рассылки.</p><div class="actions"><button type="submit" class="primary">${post?'Сохранить изменения':'Опубликовать'}</button>${post?'<button type="button" class="secondary" data-news-action="cancel">Отменить</button>':''}</div></form>`;
    const target=root.querySelector('#newsEditor');target.hidden=false;target.querySelector('h3').outerHTML=`<div class="dialog-heading"><h3>${post?'Редактировать публикацию':'Новая публикация'}</h3>${ActionMenu.icon('close','Закрыть редактор публикации','data-news-action="cancel"','ui-icon-button icon-close')}</div>`;
    photoEditor(target.querySelector('form'),post);
    if(currentPerson.role!=='admin'){target.querySelector('#newsKind').innerHTML='<option value="news">Новость</option>';target.querySelector('#newsNotify').closest('label').remove();target.querySelector('#newsImportant').closest('label').remove();target.querySelector('.hint').textContent='Куратор может публиковать новости и менять свои записи. Общие рассылки отправляет администрация.';}
  }
  async function manager(root){return home(root,currentPerson);}
  async function statistics(root){
    root.innerHTML='<p role="status">Загрузка статистики…</p>';
    const d=await callFunction('registrationStatistics');if(!root.isConnected)return;
    root.innerHTML=`<h3>Регистрации на платформе</h3><div class="registration-totals">${[['Всего аккаунтов',d.total],['Студенты',d.students],['Преподаватели',d.teachers],['Администраторы',d.admins]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><p class="hint">По текущей роли аккаунта. За последние 7 дней зарегистрировались: ${d.last7}; за 30 дней: ${d.last30}.</p><details class="registration-months"><summary>Регистрации по месяцам</summary><div class="table-wrap"><table><caption>Последние шесть месяцев · время Кызыла · текущие роли</caption><thead><tr><th scope="col">Месяц</th><th scope="col">Студенты</th><th scope="col">Преподаватели</th><th scope="col">Администраторы</th></tr></thead><tbody>${d.months.map(m=>`<tr><th scope="row">${e(m.month)}</th><td>${m.students}</td><td>${m.teachers}</td><td>${m.admins}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  document.addEventListener('change',event=>{if(['newsTag','newsOrder'].includes(event.target.id)){const root=event.target.closest('#portalPage'),list=root.querySelector('[data-news-feed]');list.dataset.newsFeed=root.querySelector('#newsTag').value;list.dataset.order=root.querySelector('#newsOrder').value;feed(list,list.dataset.newsFeed,false,root.dataset.newsManager==='true');}if(event.target.id==='newsManageChannel'){const root=event.target.closest('[data-news-manager]'),list=root.querySelector('[data-news-feed]');list.dataset.newsFeed=event.target.value;feed(list,event.target.value,false,true);}});
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-news-action]');if(!button||button.disabled)return;button.disabled=true;
    const root=button.closest('[data-news-manager]'),list=button.closest('[data-news-feed]'),post=records.get(button.dataset.id);
    try{
      if(button.dataset.newsAction==='compose'){editor(root);root.querySelector('#newsTitle').focus();return;}
      if(button.dataset.newsAction==='like'){
        if(currentPerson?.role==='guest'){location.href='index.html';return;}
        const result=await callFunction('setNewsLike',{id:post.id,liked:!post.liked});Object.assign(post,result);
        document.querySelectorAll('.news-like').forEach(node=>{if(node.dataset.id===post.id)node.outerHTML=like(post);});return;
      }
      if(button.dataset.newsAction==='refresh-home'){return await Promise.allSettled([...button.closest('#portalPage').querySelectorAll('[data-news-feed]')].map(node=>feed(node,node.dataset.newsFeed,false,!!button.closest('[data-news-manager]'),true)));}
      if(button.dataset.newsAction==='more'||button.dataset.newsAction==='retry')return await feed(list,list.dataset.newsFeed,button.dataset.newsAction==='more',!!root);
      if(button.dataset.newsAction==='edit'){editor(root,post);root.querySelector('#newsTitle').focus();root.querySelector('#newsEditor').scrollIntoView({block:'start'});}
      if(button.dataset.newsAction==='cancel'){root._editingNews=null;root.querySelector('#newsEditor').hidden=true;root.querySelector('#newsEditor').replaceChildren();}
      if(button.dataset.newsAction==='delete'&&confirm('Удалить публикацию из новостей?')){await callFunction('deleteNewsPost',{id:post.id,revision:post.revision});await feed(root.querySelector('[data-news-feed]'),root.querySelector('#newsTag').value,false,true);if(root._editingNews?.id===post.id){root.querySelector('#newsEditor').hidden=true;root._editingNews=null;}Portal.toast('Публикация удалена','','success');}
    }catch(error){Portal.toast('Не удалось изменить новость',error.message,'danger');}finally{button.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-news-form]');if(!form)return;event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
    const root=form.closest('[data-news-manager]'),post=root._editingNews;
    try{
      const channel=form.querySelector('#newsChannel').value;
      const photos=(editorPhotos.get(form)||[]).map(({id,data})=>id?{id}:{data});
      await callFunction('saveNewsPost',{id:post?.id,revision:post?.revision,channel,kind:form.querySelector('#newsKind').value,title:form.querySelector('#newsTitle').value,body:form.querySelector('#newsBody').value,notify:form.querySelector('#newsNotify')?.checked===true,important:form.querySelector('#newsImportant')?.checked===true,photos});
      root._editingNews=null;root.querySelector('#newsEditor').hidden=true;root.querySelector('#newsEditor').replaceChildren();root.querySelector('#newsTag').value='all';const list=root.querySelector('[data-news-feed]');list.dataset.newsFeed='all';await feed(list,'all',false,true);Portal.toast('Публикация сохранена','','success');
    }catch(error){Portal.toast('Публикация не сохранена',error.message,'danger');}finally{button.disabled=false;}
  });
  document.addEventListener('lms-live-update',event=>{if(event.detail.topics.some(t=>['resync','news'].includes(t)))for(const root of document.querySelectorAll('[data-news-feed]'))Realtime.update('news',root,()=>refresh(root),{scroll:false});});
  return {home,manager,statistics};
})();
