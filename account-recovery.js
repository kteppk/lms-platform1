const AccountRecovery=(()=>{
 const e=v=>escapeHtml(v??'');
 async function render(root){
  root.innerHTML='<details><summary>Восстановление доступа</summary><p class="hint">Запросы пользователей, забывших пароль. Одноразовую ссылку нужно передать владельцу аккаунта лично; она действует 30 минут.</p><button type="button" class="secondary" data-recovery-refresh>Обновить запросы</button><div data-recovery-list></div></details>';
  const load=async()=>{try{const rows=await callFunction('listRecoveryRequests');if(!root.isConnected)return;root.querySelector('[data-recovery-list]').innerHTML=rows.map(r=>`<article class="item"><strong>${e(r.name||'Пользователь')}</strong><p>${e(r.email)}</p><small>${e(new Date(r.created_at).toLocaleString('ru-RU'))}</small></article>`).join('')||'<p>Открытых запросов нет. Для выдачи ссылки найдите аккаунт в списке ниже.</p>';}catch{if(root.isConnected)root.querySelector('[data-recovery-list]').textContent='Не удалось загрузить запросы.';}};root.querySelector('[data-recovery-refresh]').onclick=load;await load();
 }
 async function link(uid){
  if(!confirm('Создать одноразовую ссылку восстановления для этого аккаунта? Передайте её только владельцу.'))return;
  const result=await callFunction('createAccountRecovery',{userId:uid});document.getElementById('recoveryLinkDialog')?.remove();const dialog=document.createElement('dialog');dialog.id='recoveryLinkDialog';dialog.className='subscription-dialog';
  dialog.innerHTML=`<div class="dialog-heading"><h2>Ссылка восстановления</h2>${ActionMenu.icon('close','Закрыть ссылку восстановления','data-recovery-close','ui-icon-button icon-close')}</div><p>Ссылка действует ${result.expiresInMinutes} минут и используется один раз. Передайте её владельцу аккаунта лично.</p><input aria-label="Одноразовая ссылка" readonly value="${e(result.url)}"><button type="button" class="primary" data-recovery-copy>Скопировать ссылку</button><p data-recovery-status role="status"></p>`;document.body.append(dialog);dialog.querySelector('[data-recovery-close]').onclick=()=>dialog.close();dialog.querySelector('[data-recovery-copy]').onclick=async()=>{await navigator.clipboard.writeText(result.url);dialog.querySelector('[data-recovery-status]').textContent='Ссылка скопирована.';};dialog.showModal();
 }
 document.addEventListener('click',async event=>{const b=event.target.closest('[data-recovery-user]');if(!b||b.disabled)return;b.disabled=true;try{await link(b.dataset.recoveryUser);}catch(error){Portal.toast('Не удалось восстановить доступ',error.message,'danger');}finally{b.disabled=false;}});
 return {render};
})();
