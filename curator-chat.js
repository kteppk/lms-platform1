const CuratorChat=(()=>{
 let active=null,timer=null,generation=0,cleanup=()=>{};const drafts=new Map(),e=v=>escapeHtml(v??'');
 const day=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Krasnoyarsk',day:'numeric',month:'long',year:'numeric'}).format(new Date(value));
 const clock=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Krasnoyarsk',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
 function clear(){clearTimeout(timer);cleanup();cleanup=()=>{};active=null;generation++;document.body.classList.remove('chat-open');document.querySelectorAll('[data-chat-messages]').forEach(n=>n.replaceChildren());}
 async function render(root,person){
  clear();if(!['curator','admin'].includes(person.role))return;
  const token=generation;active=root;document.body.classList.add('chat-open');root.removeAttribute('aria-live');root.classList.add('curator-chat');root.setAttribute('aria-label','Чат кураторов и администрации');
  root.innerHTML=`<div class="chat-heading"><button type="button" class="chat-back" data-chat-back aria-label="Вернуться к новостям"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button><span class="chat-mark" aria-hidden="true">К</span><div><h2>Кураторы и администрация</h2><p>Закрытый рабочий чат</p></div></div><div class="chat-scroll-wrap"><div class="curator-messages" data-chat-messages role="log" aria-label="Сообщения" aria-live="polite" aria-relevant="additions"><button type="button" class="chat-older" data-chat-older>Загрузить предыдущие сообщения</button><div data-chat-history></div></div><button type="button" class="chat-latest" data-chat-latest hidden aria-label="К новым сообщениям">Новые сообщения ↓</button></div><form class="chat-composer" data-chat-form><p data-chat-status role="status"></p><div class="chat-input-row"><label for="chatBody" class="visually-hidden">Сообщение</label><textarea id="chatBody" maxlength="4000" required rows="1" placeholder="Написать сообщение…" enterkeyhint="enter"></textarea><button type="submit" class="chat-send" aria-label="Отправить сообщение" title="Отправить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14"/></svg></button></div><div class="chat-composer-hint"><span>Enter — отправить · Shift + Enter — новая строка</span><span data-chat-count></span></div></form>`;
  const feed=root.querySelector('[data-chat-messages]'),history=root.querySelector('[data-chat-history]'),form=root.querySelector('form'),text=form.querySelector('textarea'),send=form.querySelector('button'),status=root.querySelector('[data-chat-status]'),olderButton=root.querySelector('[data-chat-older]'),latest=root.querySelector('[data-chat-latest]');
  const seen=new Set();let oldest=null,newest=null,busy=false,queued=false,forceDown=false,sending=false,pending=null;
  const valid=()=>root.isConnected&&generation===token;
  const atEnd=()=>feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
  const read=()=>{if(valid()&&newest&&atEnd()&&!document.hidden&&typeof CuratorChatNotifications!=='undefined')CuratorChatNotifications.read(newest).catch(()=>{});};
  function size(){if(!valid())return;const viewport=window.visualViewport;root.style.setProperty('--chat-viewport',(viewport?.height||innerHeight)+'px');root.style.setProperty('--chat-top',(viewport?.offsetTop||0)+'px');root.style.setProperty('--chat-desktop-height',Math.max(360,innerHeight-root.getBoundingClientRect().top-24)+'px');}
  function compose(){text.style.height='auto';text.style.height=Math.min(130,text.scrollHeight)+'px';send.disabled=sending||!text.value.trim()||navigator.onLine===false;root.querySelector('[data-chat-count]').textContent=text.value.length>3500?text.value.length+' / 4000':'';drafts.set(person.uid,text.value);}
  const bottom=()=>{feed.scrollTop=feed.scrollHeight;latest.hidden=true;read();};
  function markup(rows,previous){let lastDay=previous;return rows.map(m=>{const date=day(m.created_at),own=m.author_id===person.uid,separator=date!==lastDay?`<div class="chat-day" data-chat-day="${e(date)}"><span>${e(date)}</span></div>`:'';lastDay=date;return separator+`<article class="curator-message${own?' own-message':''}" data-message-id="${e(m.id)}" data-message-date="${e(date)}">${own?'':`<span class="chat-author-avatar" aria-hidden="true">${e(String(m.author_name||'К').split(/\s+/).slice(0,2).map(s=>[...s][0]).join(''))}</span>`}<div class="chat-bubble">${own?'':`<strong class="chat-author">${e(m.author_name)}</strong>`}<p>${e(m.body)}</p><time datetime="${e(m.created_at)}" title="${e(date)}">${e(clock(m.created_at))}</time></div></article>`;}).join('');}
  async function load(older=false,down=false){
   forceDown||=down;if(busy){if(!older)queued=true;return;}if(!valid())return;busy=true;olderButton.disabled=true;
   try{const initial=!newest,near=atEnd(),height=feed.scrollHeight,top=feed.scrollTop;
    const data=await callFunction('listCuratorMessages',older?{before:oldest}:{after:newest});if(!valid())return;
    const fresh=data.rows.filter(m=>!seen.has(m.id));fresh.forEach(m=>seen.add(m.id));if(!older&&!initial&&data.rows.length===50)queued=true;
    if(fresh.length){oldest=oldest&&BigInt(oldest)<BigInt(fresh[0].id)?oldest:fresh[0].id;const last=fresh.at(-1).id;newest=newest&&BigInt(newest)>BigInt(last)?newest:last;
     if(older){if(history.querySelector('[data-chat-day]')?.dataset.chatDay===day(fresh.at(-1).created_at))history.querySelector('[data-chat-day]').remove();history.insertAdjacentHTML('afterbegin',markup(fresh));}
     else history.insertAdjacentHTML('beforeend',markup(fresh,history.querySelector('.curator-message:last-child')?.dataset.messageDate));
    }
    if(initial||older){olderButton.hidden=data.rows.length<50;olderButton.disabled=olderButton.hidden;}else olderButton.disabled=false;
    if(initial&&!fresh.length)history.innerHTML='<p class="chat-empty">Здесь начинается рабочая переписка.<br>Напишите первое сообщение.</p>';else if(fresh.length)history.querySelector('.chat-empty')?.remove();
    if(older)feed.scrollTop=top+feed.scrollHeight-height;else if(initial||near||forceDown){bottom();forceDown=false;}else if(fresh.length)latest.hidden=false;
    if(!sending)status.textContent='';read();
   }catch(error){if(!valid())return;if(error.code==='permission-denied'){drafts.delete(person.uid);clear();root.innerHTML='<p role="alert">Доступ к чату закрыт. Обновите страницу.</p>';return;}
    status.textContent='Не удалось обновить сообщения. Повторим после восстановления связи.';olderButton.disabled=false;
   }finally{busy=false;if(queued&&valid()){queued=false;queueMicrotask(()=>load());}}
  }
  text.value=drafts.get(person.uid)||'';compose();size();text.oninput=compose;
  text.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&matchMedia('(hover:hover) and (pointer:fine)').matches){event.preventDefault();if(!send.disabled)form.requestSubmit();}};
  root.querySelector('[data-chat-back]').onclick=()=>Portal.navigate('home');olderButton.onclick=()=>load(true);latest.onclick=bottom;feed.onscroll=()=>{if(atEnd()){latest.hidden=true;read();}};
  form.onsubmit=async event=>{event.preventDefault();if(sending||!text.value.trim()||navigator.onLine===false)return;
   const body=text.value;if(!pending||pending.body!==body)pending={body,id:crypto.randomUUID()};sending=true;compose();status.textContent='Отправляем…';
   try{await callFunction('sendCuratorMessage',{body,clientId:pending.id});if(!valid())return;if(text.value===body)text.value='';pending=null;status.textContent='';compose();await load(false,true);}
   catch(error){if(!valid())return;status.textContent=error.message;if(error.code==='permission-denied'){drafts.delete(person.uid);clear();root.innerHTML='<p role="alert">Доступ к чату закрыт.</p>';}}
   finally{sending=false;if(valid())compose();}
  };
  const live=event=>{if(valid()&&event.detail.topics.some(t=>['chat','resync'].includes(t)))load();};
  const network=()=>{if(!valid())return;compose();if(navigator.onLine===false)status.textContent='Нет соединения. Текст остаётся в поле — отправьте его после подключения.';else load();};
  const visible=()=>{if(!document.hidden&&valid()){size();load();read();}};
  document.addEventListener('lms-live-update',live);document.addEventListener('visibilitychange',visible);window.addEventListener('online',network);window.addEventListener('offline',network);window.addEventListener('resize',size);window.visualViewport?.addEventListener('resize',size);window.visualViewport?.addEventListener('scroll',size);
  cleanup=()=>{document.removeEventListener('lms-live-update',live);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',network);window.removeEventListener('offline',network);window.removeEventListener('resize',size);window.visualViewport?.removeEventListener('resize',size);window.visualViewport?.removeEventListener('scroll',size);root.classList.remove('curator-chat');};
  await load();const poll=async()=>{if(!valid())return;if(!document.hidden&&(typeof Realtime==='undefined'||!Realtime.connected))await load();timer=setTimeout(poll,15000);};timer=setTimeout(poll,15000);
 }
 window.addEventListener('pagehide',()=>{clear();drafts.clear();});return {render,clear,isVisible:()=>!!active?.isConnected&&!!active.querySelector('[data-chat-messages]')&&!document.hidden};
})();
