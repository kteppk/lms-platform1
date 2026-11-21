// firebase-config.js

// Local VPS authentication; no account data is sent to Firebase.
const firebaseConfig={projectId:'lms-local',authDomain:location.hostname};
const isLocal=['localhost','127.0.0.1'].includes(location.hostname);
const lmsBaseUrl=location.origin;
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
let nameFieldsPromise;
const nameFieldsReady={then(resolve,reject){nameFieldsPromise??=import('./name-fields.mjs?v=identity1');return nameFieldsPromise.then(resolve,reject);}};
let cacheAccount=null;
auth.onAuthStateChanged?.(account=>{if(typeof AppConnection==='undefined')return;if(account){if(cacheAccount&&cacheAccount!==account.uid)AppConnection.clearUser(cacheAccount);AppConnection.begin(account.uid);cacheAccount=account.uid;}else if(cacheAccount){AppConnection.clearUser(cacheAccount);cacheAccount=null;if(typeof Realtime!=='undefined')Realtime.logout();}});
// This script runs in the head, before deferred cabinet modules are ready.
const cabinetScriptsReady = typeof document === 'undefined' || document.readyState === 'complete'
  ? Promise.resolve()
  : new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));

function getProfile(account, registrationName) {
  return callFunction('profile', typeof registrationName==='object'&&registrationName!==null?{nameFields:registrationName}:{name:registrationName}, account);
}

async function callFunction(action,data,account=auth.currentUser,options={}) {
  if(!account)throw new Error('Войдите в аккаунт.');
  const send=()=>sendFunction(action,data,account);
  return typeof AppConnection==='undefined'?send():AppConnection.request(action,data,account,send,options);
}
async function sendFunction(action, data, account = auth.currentUser) {
  if (!lmsBaseUrl) throw new Error('Адрес сервера ещё не настроен.');
  if (!account) throw new Error('Войдите в аккаунт.');
  if(typeof navigator!=='undefined'&&navigator.onLine===false){const error=new Error('Нет интернета. Запрос не отправлен.');error.code='unavailable';throw error;}
  const token = await account.getIdToken();
  const retryable = new Set(['profile','listSubjects','listSubjectTeachers','getSubjectContent','listMaterials',
    'listStudentTests','listTeacherTests','listStudents','getStudentAttempt','listActiveAttempts','listResults',
    'getResult','listResultTests','getTestResults','exportTestResults','saveStudentDraft','submitStudentTest','listTeachers','getTeacherProfile','listSchedule','listScheduleGroups','getWeeklySchedule','listNotifications','listNotificationSubscriptions','listRoleChanges','listNews','registrationStatistics','listCuratorMessages','getOnlineStats','listSubjectJoinRequests','getCuratorChatSummary','markCuratorChatRead','getPushSettings','listRecoveryRequests','getMyEducation','getGroupLessonTimes','getLessonReminder','exportSchedule','searchPeople','getPerson','getPortalSettings','listAccounts','readNotifications']).has(action);
  for (let attempt = 0; ; attempt++) {
    let response, result;
    const controller=typeof AbortController!=='undefined'?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),10000):null;
    try {
      response = await fetch(lmsBaseUrl + '/functions/v1/lms', {
        method: 'POST', signal:controller?.signal,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data })
      });
      result = await response.json();
    } catch (error) {
      if (!retryable || attempt >= 2){const failure=new Error(retryable?'Не удалось подключиться к серверу. Повторите загрузку.':'Не удалось подтвердить сохранение. Проверьте результат после восстановления связи перед повторной отправкой.');failure.code='unavailable';throw failure;}
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    } finally {if(timeout)clearTimeout(timeout);}
    const temporary = [502,503,504].includes(response.status) ||
      ['WORKER_RESOURCE_LIMIT','WORKER_LIMIT','BOOT_ERROR'].includes(result.code);
    if (!response.ok && temporary && retryable && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      const error = new Error(result.error || result.message || 'Сервер временно недоступен.');
      error.code = temporary?'unavailable':result.code;
      throw error;
    }
    return result.data;
  }
}

async function uploadAttachment(kind, file, context = {}) {
  const extension = file.name.split('.').pop().toLowerCase();
  const knownTypes = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp4: 'video/mp4', html: 'text/html',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
    avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff'
  };
  const mime = file.type || knownTypes[extension];
  const grant = await callFunction('createUpload', { kind, mime, size: file.size, ...context });
  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', new Blob([file], { type: mime }), file.name);
  const response = await fetch(new URL(grant.url, lmsBaseUrl), {
    method: 'PUT',
    headers: { 'x-upsert': 'false' },
    body
  });
  if (!response.ok) throw new Error('Хранилище не приняло файл.');
  return grant.path;
}

function teacherProfileLinkId(){
  const uid=new URLSearchParams(location.search).get('teacher')||'';
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid)?uid:'';
}

function cabinetPage(role,teacherId='') {
  const page=role === 'admin' ? 'admin.html' : role === 'teacher' ? 'teacher.html' : 'student.html';
  return teacherId?page+'?teacher='+encodeURIComponent(teacherId):page;
}

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.hidden = !message;
}

function watchCabinet(role, onReady) {
  auth.onAuthStateChanged(async (account) => {
    if (!account) {
      const teacher=teacherProfileLinkId();
      location.replace(teacher?'index.html?teacher='+encodeURIComponent(teacher):'index.html');
      return;
    }
    try {
      const profile = await getProfile(account);
      if (auth.currentUser?.uid !== account.uid) return;
      if (profile.role !== role && !(role === 'student' && profile.role === 'curator') && !(role === 'teacher' && profile.role === 'admin' && profile.canTeach)) {
        location.replace(cabinetPage(profile.role,teacherProfileLinkId()));
        return;
      }
      // Cabinet navigation is deferred; even a fast Auth response must wait
      // for those scripts before initializing the first screen.
      await cabinetScriptsReady;
      if (auth.currentUser?.uid !== account.uid) return;
      document.getElementById('userName').textContent = profile.name;
      document.querySelector('main').hidden = false;
      if(typeof AppConnection!=='undefined')AppConnection.ready();
      if (typeof Portal !== 'undefined') await Portal.init(profile);
      await onReady();
      const target=sessionStorage.getItem('lms-open-section');sessionStorage.removeItem('lms-open-section');const group=sessionStorage.getItem('lms-open-group');sessionStorage.removeItem('lms-open-group');if(target==='schedule'&&group&&/^[A-Za-z0-9_-]{1,128}$/.test(group))Schedule.selectGroup(group);
      if(['home','schedule'].includes(target)||target==='curator-chat'&&['admin','curator'].includes(profile.role))Portal.navigate(target);
      const teacher=teacherProfileLinkId();
      if(teacher)Portal.openTeacher(teacher);
    } catch (error) {
      showStatus('Не удалось открыть кабинет. ' + error.message);
      if(typeof AppConnection!=='undefined')AppConnection.recovery(error);
    }
  });
}

async function logout() {
  try {
    const uid=auth.currentUser?.uid;
    if(uid&&typeof AppConnection!=='undefined'&&AppConnection.hasDrafts(uid)&&!confirm('На устройстве есть несохранённые ответы теста. При выходе локальные копии будут удалены. Сначала можно вернуться к работе и скачать копию. Выйти?'))return;
    if(typeof PushSettings!=='undefined')await PushSettings.detach().catch(()=>{});
    if(typeof CuratorChat!=='undefined')CuratorChat.clear();
    await auth.signOut();
    if(uid&&typeof AppConnection!=='undefined')AppConnection.clearUser(uid);
  } catch (error) {
    showStatus('Не удалось выйти. ' + error.message);
  }
}

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);
}

function safeMaterialUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    const link = new URL(url, lmsBaseUrl);
    if (link.protocol === 'https:' || (isLocal && link.hostname === '127.0.0.1')) {
      return link.href;
    }
  } catch {
    return '';
  }
  return '';
}

function materialLink(url, label) {
  const href = safeMaterialUrl(url);
  return href ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' +
    escapeHtml(label) + '</a>' : '';
}
