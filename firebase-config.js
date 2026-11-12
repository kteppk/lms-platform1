// firebase-config.js

// Твоя реальная конфигурация проекта students-70392
const firebaseConfig = {
  apiKey: "AIzaSyD5a1543rVIbV7e9RFFuvk3QUHp4ATDsMA",
  authDomain: "students-70392.firebaseapp.com",
  projectId: "students-70392",
  messagingSenderId: "117845681705",
  appId: "1:117845681705:web:ee3d82e0a696394210de38",
  measurementId: "G-7JT7TEDNB5"
};

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const supabaseProjectUrl = 'https://qqhkuuktgzcyrkfdnjjq.supabase.co';
const lmsBaseUrl = isLocal ? 'http://127.0.0.1:54321' : supabaseProjectUrl;
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
// This script runs in the head, before deferred cabinet modules are ready.
const cabinetScriptsReady = typeof document === 'undefined' || document.readyState === 'complete'
  ? Promise.resolve()
  : new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));

function getProfile(account, registrationName) {
  return callFunction('profile', { name: registrationName }, account);
}

async function callFunction(action, data, account = auth.currentUser) {
  if (!lmsBaseUrl) throw new Error('Адрес проекта Supabase ещё не настроен.');
  if (!account) throw new Error('Войдите в аккаунт.');
  const token = await account.getIdToken();
  const retryable = new Set(['profile','listSubjects','listSubjectTeachers','getSubjectContent','listMaterials',
    'listStudentTests','listTeacherTests','listStudents','getStudentAttempt','listActiveAttempts','listResults',
    'getResult','saveStudentDraft','submitStudentTest','listTeachers','getTeacherProfile','listSchedule','listScheduleGroups','getWeeklySchedule','listNotifications','listAccounts','readNotifications']).has(action);
  for (let attempt = 0; ; attempt++) {
    let response, result;
    try {
      response = await fetch(lmsBaseUrl + '/functions/v1/lms', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data })
      });
      result = await response.json().catch(() => ({}));
    } catch (error) {
      if (!retryable || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    const temporary = [502,503,504].includes(response.status) ||
      ['WORKER_RESOURCE_LIMIT','WORKER_LIMIT','BOOT_ERROR'].includes(result.code);
    if (!response.ok && temporary && retryable && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      const error = new Error(result.error || result.message || 'Сервер временно недоступен.');
      error.code = result.code;
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

function cabinetPage(role) {
  return role === 'admin' ? 'admin.html' : role === 'teacher' ? 'teacher.html' : 'student.html';
}

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.hidden = !message;
}

function watchCabinet(role, onReady) {
  auth.onAuthStateChanged(async (account) => {
    if (!account) {
      location.replace('index.html');
      return;
    }
    try {
      const profile = await getProfile(account);
      if (auth.currentUser?.uid !== account.uid) return;
      if (profile.role !== role && !(role === 'teacher' && profile.role === 'admin' && profile.canTeach)) {
        location.replace(cabinetPage(profile.role));
        return;
      }
      // Cabinet navigation is deferred; even a fast Auth response must wait
      // for those scripts before initializing the first screen.
      await cabinetScriptsReady;
      if (auth.currentUser?.uid !== account.uid) return;
      document.getElementById('userName').textContent = profile.name;
      document.querySelector('main').hidden = false;
      if (typeof Portal !== 'undefined') await Portal.init(profile);
      await onReady();
    } catch (error) {
      showStatus('Не удалось открыть кабинет. ' + error.message);
    }
  });
}

async function logout() {
  try {
    await auth.signOut();
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
