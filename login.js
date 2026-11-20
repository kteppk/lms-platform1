const openSection=new URLSearchParams(location.search).get('open');if(['home','schedule','curator-chat'].includes(openSection))sessionStorage.setItem('lms-open-section',openSection);
const openGroup=new URLSearchParams(location.search).get('group');if(openSection==='schedule'&&openGroup&&/^[A-Za-z0-9_-]{1,128}$/.test(openGroup))sessionStorage.setItem('lms-open-group',openGroup);
const resetToken=new URLSearchParams(location.search).get('reset');
let handlingForm = false;

function switchTab(tab, button) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  button.classList.add('active');
  document.getElementById('authFormTitle').textContent=tab==='register'?'Создать аккаунт':'Войти в кабинет';
  if(tab==='register')Promise.resolve(nameFieldsReady).catch(()=>showError('Не удалось загрузить форму. Проверьте интернет и повторите.'));
  document.querySelector('.auth-container .subtitle').textContent=tab==='register'?'Имя и фамилия будут видны в учебных списках.':'Войдите в учебную среду техникума.';
  document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
  document.getElementById('error').classList.add('hidden');
}

function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function openCabinet(account, name) {
  const profile = await getProfile(account, name);
  location.replace(cabinetPage(profile.role));
}

async function handleAuthForm(event, action) {
  event.preventDefault();
  if (handlingForm) return;
  handlingForm = true;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;const originalLabel=button.textContent;button.textContent='Подключаемся…';button.setAttribute('aria-busy','true');
  document.getElementById('error').classList.add('hidden');
  try {
    await action();
  } catch (error) {
    showError(error.code === 'auth/email-already-in-use'
      ? 'Этот аккаунт уже существует. Войдите с тем же email и паролем.'
      : authMessage(error));
    AppConnection.recovery(error);
  } finally {
    button.disabled = false;button.textContent=originalLabel;button.removeAttribute('aria-busy');
    handlingForm = false;
  }
}

function handleLogin(event) {
  return handleAuthForm(event, async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    AppConnection.rememberDevice(document.getElementById('loginRemember').checked);
    await auth.setPersistence(document.getElementById('loginRemember').checked?'local':'session');
    const { user } = await auth.signInWithEmailAndPassword(email, password);
    await openCabinet(user);
  });
}

function handleRegister(event) {
  return handleAuthForm(event, async () => {
    const privacy = document.getElementById('regPrivacy');
    if (!privacy.checked) throw new Error('Подтвердите ознакомление с политикой конфиденциальности.');
    const names = (await nameFieldsReady).read('reg');
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    AppConnection.rememberDevice(document.getElementById('regRemember').checked);
    await auth.setPersistence(document.getElementById('regRemember').checked?'local':'session');
    const { user } = await auth.createUserWithEmailAndPassword(email, password, privacy.value);
    const profile = await getProfile(user, names);
    await user.updateProfile({ displayName: profile.name }).catch(()=>{});
    location.replace(cabinetPage(profile.role));
  });
}

function authMessage(error){return ({'auth/invalid-credential':'Проверьте email и пароль.','auth/wrong-password':'Проверьте email и пароль.','auth/user-not-found':'Проверьте email и пароль.','auth/network-request-failed':'Не удалось подключиться. Для первого входа нужен интернет.','auth/too-many-requests':'Слишком много попыток. Попробуйте немного позже.','auth/weak-password':'Используйте пароль не короче 6 символов.'})[error.code]||error.message;}
document.addEventListener('click',event=>{const button=event.target.closest('[data-show-password]');if(!button)return;const input=document.getElementById(button.dataset.showPassword),show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Скрыть':'Показать';button.setAttribute('aria-pressed',String(show));});
function openPasswordReset(){
  document.getElementById('passwordReset')?.remove();const dialog=document.createElement('dialog');dialog.id='passwordReset';dialog.className='subscription-dialog';dialog.setAttribute('aria-labelledby','resetTitle');
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="resetTitle">Восстановить пароль</h2>${ActionMenu.icon('close','Закрыть восстановление пароля','id="resetClose"','ui-icon-button icon-close')}</div><form id="resetForm"><label for="resetEmail">Email аккаунта<input id="resetEmail" type="email" required autocomplete="email" inputmode="email" autofocus></label><p id="resetStatus" role="status"></p><div class="actions"><button type="submit" class="primary">Отправить запрос</button></div></form>`;document.body.append(dialog);dialog.querySelector('#resetEmail').value=document.getElementById('loginEmail').value;
  dialog.querySelector('#resetClose').onclick=()=>dialog.close();dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=dialog.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;try{await auth.sendPasswordResetEmail(dialog.querySelector('#resetEmail').value.trim());dialog.querySelector('#resetStatus').textContent='Если аккаунт существует, запрос передан администрации платформы. Обратитесь к администратору, чтобы получить одноразовую ссылку восстановления.';}catch(error){dialog.querySelector('#resetStatus').textContent=authMessage(error);}finally{button.disabled=false;}};dialog.showModal();
}
auth.onAuthStateChanged(account => {
  if (account && !handlingForm && !resetToken) openCabinet(account).catch(error => {showError(authMessage(error));AppConnection.recovery(error);});
});

document.querySelectorAll('[data-auth-ready]').forEach(button=>button.disabled=false);
document.getElementById('authLoading')?.remove();

if(resetToken){
 if(!/^[A-Za-z0-9_-]{43}$/.test(resetToken))showError('Ссылка восстановления недействительна.');
 else{const dialog=document.createElement('dialog');dialog.className='subscription-dialog';dialog.id='newPasswordDialog';dialog.innerHTML=`<div class="dialog-heading"><h2>Новый пароль</h2>${ActionMenu.icon('close','Закрыть новый пароль','data-reset-close','ui-icon-button icon-close')}</div><form><label for="resetNewPassword">Новый пароль<input id="resetNewPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><label for="resetRepeatPassword">Повторите пароль<input id="resetRepeatPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><p data-reset-status role="status"></p><button type="submit" class="primary">Сохранить новый пароль</button></form>`;document.body.append(dialog);dialog.querySelector('[data-reset-close]').onclick=()=>location.replace('index.html');dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const b=dialog.querySelector('[type="submit"]');if(b.disabled)return;b.disabled=true;try{const password=dialog.querySelector('#resetNewPassword').value;if(password!==dialog.querySelector('#resetRepeatPassword').value)throw Error('Пароли не совпадают.');await LocalAuthentication.completeReset(resetToken,password);location.replace('index.html');}catch(error){dialog.querySelector('[data-reset-status]').textContent=error.message;b.disabled=false;}};dialog.showModal();}
}
