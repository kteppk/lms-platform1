const News = (()=>{
  const e=v=>escapeHtml(v),names={site:'Новости сайта',college:'Новости техникума'},kinds={news:'Новость',announcement:'Объявление',update:'Журнал обновлений'};
  const records=new Map(),states=new WeakMap();
  function article(n,manage=false){
    records.set(n.id,n);
    const long=n.body.length>600,commit=/^[a-f0-9]{40}$/.test(n.commit_sha??'')?n.commit_sha:null;
    return `<article class="news-article" data-news-id="${e(n.id)}"><div class="news-meta"><span class="news-tag" data-news-channel="${e(n.channel)}">${names[n.channel]||names.site}</span><span>${kinds[n.kind]||'Новость'}</span><time datetime="${e(n.published_at)}">${e(new Date(n.published_at).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk',dateStyle:'long',timeStyle:'short'}))}</time>${manage&&!n.imported?ActionMenu.render(`<button type="button" class="secondary" data-news-action="edit" data-id="${e(n.id)}">Редактировать</button><button type="button" class="danger-button" data-news-action="delete" data-id="${e(n.id)}">Удалить</button>`,'Действия с публикацией'):''}</div><h3>${e(n.title)}</h3><p class="news-body">${e(long?n.body.slice(0,380)+'…':n.body)}</p>${long?`<details class="news-full"><summary>Читать полностью</summary><p class="news-body">${e(n.body)}</p></details>`:''}${commit?`<a class="commit-link" href="https://github.com/kteppk/lms-platform1/commit/${commit}" target="_blank" rel="noopener noreferrer">Коммит ${commit.slice(0,7)} ↗</a>`:''}</article>`;
  }
  async function feed(root,channel,more=false,manage=false,fresh=false){
    let state=states.get(root);if(!more||!state){state={channel,offset:0,manage};states.set(root,state);root.innerHTML='<p role="status">Загрузка новостей…</p>';}
    try{
      const data=await callFunction('listNews',{channel,offset:state.offset},undefined,{fresh:fresh||manage});if(!root.isConnected||states.get(root)!==state)return;
      if(!more)root.innerHTML=AppConnection.note(data)+'<div class="news-items"></div>';
      root.querySelector('.news-items').insertAdjacentHTML('beforeend',data.rows.filter(n=>![...root.querySelectorAll('[data-news-id]')].some(node=>node.dataset.newsId===n.id)).map(n=>article(n,manage)).join('')||(!more?'<p class="empty-state">Публикаций пока нет.</p>':''));
      state.offset+=data.rows.length;root.querySelector('[data-news-action="more"]')?.remove();
      if(data.hasMore)root.insertAdjacentHTML('beforeend','<button type="button" class="secondary news-more" data-news-action="more">Показать более ранние</button>');
    }catch(error){if(root.isConnected){if(!more)root.innerHTML='<p role="status">Не удалось загрузить новости.</p><button type="button" class="secondary" data-news-action="retry">Повторить</button>';else Portal.toast('Не удалось загрузить новости',error.message,'danger');}}
  }
  async function home(root,person){
    root.innerHTML=`<div class="news-masthead"><span class="eyebrow">КТЭиП ПК · Учебная платформа</span><span class="edition-mark">КЫЗЫЛ / ВЫПУСК ${e(SiteRelease.version)}</span><div class="page-heading"><h2>Главная</h2>${ActionMenu.render('<button type="button" data-news-action="refresh-home">Обновить новости</button>'+(person.role==='admin'?'<button type="button" data-portal="navigate" data-tab="announcements">Опубликовать новость</button>':''),'Действия с новостями')}</div><p>События техникума и изменения учебной платформы.</p></div><section class="news-feed" aria-labelledby="news-feed-title"><h2 id="news-feed-title">Новости</h2><div data-news-feed="all"></div></section>`;
    await feed(root.querySelector('[data-news-feed]'),'all');
  }

  function editor(root,post=null){
    root._editingNews=post;
    root.querySelector('#newsEditor').innerHTML=`<h3>${post?'Редактировать публикацию':'Новая публикация'}</h3><form data-news-form><div class="field-grid"><label for="newsChannel">Тег<select id="newsChannel"><option value="site" ${post?.channel==='site'?'selected':''}>Новости сайта</option><option value="college" ${post?.channel==='college'?'selected':''}>Новости техникума</option></select></label><label for="newsKind">Вид публикации<select id="newsKind">${Object.entries(kinds).map(([v,t])=>`<option value="${v}" ${post?.kind===v?'selected':''}>${t}</option>`).join('')}</select></label></div><label for="newsTitle">Заголовок<input id="newsTitle" required maxlength="200" value="${e(post?.title??'')}"></label><label for="newsBody">Текст<textarea id="newsBody" required maxlength="20000" rows="7">${e(post?.body??'')}</textarea></label><label class="check-label"><input id="newsNotify" type="checkbox">Также отправить общее уведомление (текст до 2000 символов)</label><label class="check-label"><input id="newsImportant" type="checkbox">Выделить уведомление как важное</label><p class="hint">По умолчанию публикация появляется только на главной. Для рассылки включите «Также отправить общее уведомление». Обновления GitHub добавляются автоматически, без рассылки.</p><div class="actions"><button type="submit" class="primary">${post?'Сохранить изменения':'Опубликовать'}</button>${post?'<button type="button" class="secondary" data-news-action="cancel">Отменить</button>':''}</div></form>`;
  }
  async function manager(root){
    root.innerHTML='<h2>Новости и объявления</h2><p class="section-lead">Одна лента новостей с тегами. Новые публикации появляются сверху.</p><section id="newsEditor" class="news-editor"></section><section class="news-management"><h3>Опубликованные новости</h3><label for="newsManageChannel">Показать<select id="newsManageChannel"><option value="all">Все новости</option><option value="site">Новости сайта</option><option value="college">Новости техникума</option></select></label><div data-news-feed="all"></div></section>';
    root.dataset.newsManager='true';editor(root);await feed(root.querySelector('[data-news-feed]'),'all',false,true);
  }
  async function statistics(root){
    root.innerHTML='<p role="status">Загрузка статистики…</p>';
    const d=await callFunction('registrationStatistics');if(!root.isConnected)return;
    root.innerHTML=`<h3>Регистрации на платформе</h3><div class="registration-totals">${[['Всего аккаунтов',d.total],['Студенты',d.students],['Преподаватели',d.teachers],['Администраторы',d.admins]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><p class="hint">По текущей роли аккаунта. За последние 7 дней зарегистрировались: ${d.last7}; за 30 дней: ${d.last30}.</p><details class="registration-months"><summary>Регистрации по месяцам</summary><div class="table-wrap"><table><caption>Последние шесть месяцев · время Кызыла · текущие роли</caption><thead><tr><th scope="col">Месяц</th><th scope="col">Студенты</th><th scope="col">Преподаватели</th><th scope="col">Администраторы</th></tr></thead><tbody>${d.months.map(m=>`<tr><th scope="row">${e(m.month)}</th><td>${m.students}</td><td>${m.teachers}</td><td>${m.admins}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  document.addEventListener('change',event=>{if(event.target.id==='newsManageChannel'){const root=event.target.closest('[data-news-manager]'),list=root.querySelector('[data-news-feed]');list.dataset.newsFeed=event.target.value;feed(list,event.target.value,false,true);}});
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-news-action]');if(!button||button.disabled)return;button.disabled=true;
    const root=button.closest('[data-news-manager]'),list=button.closest('[data-news-feed]'),post=records.get(button.dataset.id);
    try{
      if(button.dataset.newsAction==='refresh-home'){return await Promise.allSettled([...button.closest('#portalPage').querySelectorAll('[data-news-feed]')].map(node=>feed(node,node.dataset.newsFeed,false,false,true)));}
      if(button.dataset.newsAction==='more'||button.dataset.newsAction==='retry')return await feed(list,list.dataset.newsFeed,button.dataset.newsAction==='more',!!root);
      if(button.dataset.newsAction==='edit'){editor(root,post);root.querySelector('#newsTitle').focus();root.querySelector('#newsEditor').scrollIntoView({block:'start'});}
      if(button.dataset.newsAction==='cancel')editor(root);
      if(button.dataset.newsAction==='delete'&&confirm('Удалить публикацию с главной страницы?')){await callFunction('deleteNewsPost',{id:post.id,revision:post.revision});await feed(root.querySelector('[data-news-feed]'),root.querySelector('#newsManageChannel').value,false,true);if(root._editingNews?.id===post.id)editor(root);Portal.toast('Публикация удалена','','success');}
    }catch(error){Portal.toast('Не удалось изменить новость',error.message,'danger');}finally{button.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-news-form]');if(!form)return;event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
    const root=form.closest('[data-news-manager]'),post=root._editingNews;
    try{
      const channel=form.querySelector('#newsChannel').value;
      await callFunction('saveNewsPost',{id:post?.id,revision:post?.revision,channel,kind:form.querySelector('#newsKind').value,title:form.querySelector('#newsTitle').value,body:form.querySelector('#newsBody').value,notify:form.querySelector('#newsNotify').checked,important:form.querySelector('#newsImportant').checked});
      editor(root);root.querySelector('#newsManageChannel').value='all';const list=root.querySelector('[data-news-feed]');list.dataset.newsFeed='all';await feed(list,'all',false,true);Portal.toast('Публикация сохранена','','success');
    }catch(error){Portal.toast('Публикация не сохранена',error.message,'danger');}finally{button.disabled=false;}
  });
  return {home,manager,statistics};
})();
