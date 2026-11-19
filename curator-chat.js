const CuratorChat=(()=>{
 let active=null,timer=null,generation=0;const e=v=>escapeHtml(v??'');
 function clear(){clearTimeout(timer);active=null;generation++;document.querySelectorAll('[data-chat-messages]').forEach(n=>n.replaceChildren());}
 async function render(root,person){
  clear();if(!['curator','admin'].includes(person.role))return;
  const token=generation;active=root;root.innerHTML='<h2>Чат кураторов и администрации</h2><p class="section-lead">Закрытая рабочая переписка. Доступ имеют только кураторы-студенты и администрация.</p><button type="button" class="secondary" data-chat-older>Ранее</button><div class="curator-messages" data-chat-messages aria-live="polite"></div><form data-chat-form><label for="chatBody">Сообщение<textarea id="chatBody" maxlength="4000" required rows="3"></textarea></label><p data-chat-status role="status"></p><button type="submit" class="primary">Отправить</button></form>';
  const seen=new Set();let oldest=null,newest=null,busy=false,queued=false;
  async function load(older=false){
   if(busy){if(!older)queued=true;return;}if(!root.isConnected||generation!==token)return;busy=true;
   try{const initial=!newest;const data=await callFunction('listCuratorMessages',older?{before:oldest}:{after:newest});if(!root.isConnected||generation!==token)return;
    const fresh=data.rows.filter(m=>!seen.has(m.id));fresh.forEach(m=>seen.add(m.id));
    if(!older&&!initial&&data.rows.length===50)queued=true;
    if(fresh.length){oldest=oldest&&BigInt(oldest)<BigInt(fresh[0].id)?oldest:fresh[0].id;const last=fresh.at(-1).id;newest=newest&&BigInt(newest)>BigInt(last)?newest:last;}
    const list=root.querySelector('[data-chat-messages]');list.insertAdjacentHTML(older?'afterbegin':'beforeend',fresh.map(m=>`<article class="curator-message${m.author_id===person.uid?' own-message':''}"><div><strong>${e(m.author_name)}</strong><time>${e(new Date(m.created_at).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'}))}</time></div><p>${e(m.body)}</p></article>`).join(''));
    if(older||initial)root.querySelector('[data-chat-older]').disabled=data.rows.length<50;
    root.querySelector('[data-chat-status]').textContent='';
   }catch(error){if(!root.isConnected||generation!==token)return;if(error.code==='permission-denied'){clear();root.innerHTML='<p role="alert">Доступ к чату закрыт. Обновите страницу.</p>';return;}root.querySelector('[data-chat-status]').textContent='Не удалось обновить сообщения. Повторим при восстановлении связи.';}
   finally{busy=false;if(queued&&root.isConnected&&generation===token){queued=false;queueMicrotask(()=>load());}}
  }
  root.querySelector('[data-chat-older]').onclick=()=>load(true);
  root.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),text=form.querySelector('textarea');if(button.disabled)return;button.disabled=true;if(form._pendingBody!==text.value){form._clientId=crypto.randomUUID();form._pendingBody=text.value;}form._clientId??=crypto.randomUUID();
   try{await callFunction('sendCuratorMessage',{body:text.value,clientId:form._clientId});text.value='';form._clientId=null;await load();}
   catch(error){if(!root.isConnected||generation!==token)return;root.querySelector('[data-chat-status]').textContent=error.message;if(error.code==='permission-denied'){clear();root.innerHTML='<p>Доступ к чату закрыт.</p>';}}
   finally{button.disabled=false;}
  };
  const live=event=>{if(generation!==token||!root.isConnected){document.removeEventListener('lms-live-update',live);return;}if(event.detail.topics.some(t=>['chat','resync'].includes(t)))load();};
  document.addEventListener('lms-live-update',live);
  await load();const poll=async()=>{if(!root.isConnected||generation!==token){document.removeEventListener('lms-live-update',live);return;}if(!document.hidden&&(typeof Realtime==='undefined'||!Realtime.connected))await load();timer=setTimeout(poll,15000);};timer=setTimeout(poll,15000);
 }
 window.addEventListener('pagehide',clear);return {render,clear};
})();
