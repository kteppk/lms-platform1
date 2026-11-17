const PushSettings=(()=>{
 const supported=()=>isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 let config=null;
 const unbase=v=>Uint8Array.from(atob(v.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 async function subscription(){const registration=await navigator.serviceWorker.getRegistration();return {registration,sub:await registration?.pushManager.getSubscription()};}
 async function render(root){
  root.className='push-settings';root.innerHTML='<details><summary>Уведомления на этом устройстве</summary><div data-push-body><p>Проверяем поддержку браузера…</p></div></details>';
  const body=root.querySelector('[data-push-body]');
  if(!supported()){body.innerHTML='<p>Браузер не поддерживает системные уведомления в этом режиме. На iPhone добавьте сайт на экран «Домой» через меню «Поделиться» и откройте его оттуда. Уведомления внутри сайта доступны всегда.</p>';return;}
  try{const {sub}=await subscription();config=await callFunction('getPushSettings',{endpoint:sub?.endpoint||''});if(!root.isConnected)return;const device=config.device;
   body.innerHTML=`<p>${device?'Уведомления подключены к этому аккаунту.':'Получайте изменения расписания и объявления, даже когда вкладка закрыта.'}</p><label class="check-label"><input type="checkbox" data-push-schedule ${device?.schedule!==false?'checked':''}>Изменения подписанных расписаний</label><label class="check-label"><input type="checkbox" data-push-announcements ${device?.announcements?'checked':''}>Объявления администрации</label><p class="hint">Изменения приходят только по группам, на которые вы подписались колокольчиком. Настройки действуют на этом устройстве.</p><div class="actions"><button type="button" class="primary" data-push-save ${config.publicKey?'':'disabled'}>${device?'Сохранить настройки':'Включить уведомления'}</button>${device?'<button type="button" class="secondary" data-push-off>Отключить на устройстве</button>':''}</div><p data-push-status role="status">${config.publicKey?'':'Служба доставки ещё настраивается.'}</p>`;
   body.querySelector('[data-push-save]').onclick=async()=>{
    const button=body.querySelector('[data-push-save]');button.disabled=true;
    try{const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted')throw Error('Разрешите уведомления в настройках сайта браузера.');
     const registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Служба уведомлений ещё загружается. Обновите страницу и повторите.')),12000))]);let sub=await registration.pushManager.getSubscription();sub??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:unbase(config.publicKey)});
     const json=sub.toJSON();await callFunction('savePushDevice',{endpoint:sub.endpoint,p256dh:json.keys.p256dh,auth:json.keys.auth,schedule:body.querySelector('[data-push-schedule]').checked,announcements:body.querySelector('[data-push-announcements]').checked});await render(root);root.querySelector('details').open=true;Portal.toast('Настройки уведомлений сохранены','','success');
    }catch(error){body.querySelector('[data-push-status]').textContent=error.message;}finally{button.disabled=false;}
   };
   const off=body.querySelector('[data-push-off]');if(off)off.onclick=async()=>{off.disabled=true;try{await detach();await render(root);root.querySelector('details').open=true;}catch(error){body.querySelector('[data-push-status]').textContent=error.message;off.disabled=false;}};
  }catch{if(root.isConnected)body.innerHTML='<p>Не удалось загрузить настройки. Откройте раздел заново при работающем интернете.</p>';}
 }
 async function detach(){if(!supported())return;const {sub}=await subscription();if(sub){await sub.unsubscribe();await callFunction('removePushDevice',{endpoint:sub.endpoint});}}
 return {render,detach};
})();
