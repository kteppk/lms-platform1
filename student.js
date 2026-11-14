let currentTab = 'home';
let attempt = null;
let attemptTab = null;
let subjectView = null;
let startingTest = false;
let submitting = false;
let timerInterval;
let draftTimer;
let draftPromise = null;
const content = document.getElementById('content');

function switchTab(tab, button) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(item => item.classList.toggle('active', item === button));
  render().catch(showError);
}

function showError(error) {
  showStatus(error.message);
}

async function render() {
  showStatus('');
  if (currentTab === attemptTab && attempt) {
    if (attempt.result) renderResult(attempt.result);
    else renderTest();
    return;
  }

  if (await Portal.render(currentTab, content)) return;
  if (currentTab === 'results') { await Gradebook.render(content, false); return; }

  if (currentTab === 'subjects') {
    const back = subjectView?.fromChooser ? 'К преподавателям' : 'К предметам';
    content.innerHTML = `${subjectView ?
      `<button type="button" class="tab-btn" onclick="backFromSubject()">← ${back}</button>` :
      '<h2 style="margin-bottom:16px">Предметы</h2>'}
      <div aria-live="polite">Загрузка…</div>`;
    const list = content.lastElementChild;
    try {
      await renderSubjectView(list);
    } catch (error) {
      if (list.isConnected) {
        list.textContent = '';
        showError(error);
      }
    }
    return;
  }

  const titles = { lectures: 'Доступные материалы', tests: 'Доступные тесты' };
  content.innerHTML = `<h2 style="margin-bottom:16px">${titles[currentTab]}</h2><div>Загрузка…</div>`;
  const list = content.lastElementChild;
  const tab = currentTab;

  if (tab === 'tests') {
    const tests = await callFunction('listStudentTests');
    list.innerHTML = testCards(tests) || '<p>Нет тестов</p>';
    return;
  }

  if(tab!=='lectures')return;
  const [lectures,pdfs]=await Promise.all([callFunction('listMaterials',{kind:'lectures'}),callFunction('listMaterials',{kind:'books'})]);
  if(!list.isConnected)return;
  const materials=[...lectures.map(d=>({...d,_legacyPdf:false})),...pdfs.map(d=>({...d,_legacyPdf:true}))].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  list.innerHTML=materials.map(data=>`<article class="item"><h3>${escapeHtml(data.title)}</h3><div class="meta">Преподаватель: ${escapeHtml(data.teacherName)} · ${new Date(data.createdAt).toLocaleString('ru-RU')}</div>${data.author?`<p class="meta">Автор: ${escapeHtml(data.author)}</p>`:''}<p class="subject-description">${escapeHtml(data._legacyPdf?data.description:data.text)}</p>${(data._legacyPdf?[data.fileUrl]:data.files??[]).map((url,i)=>`<p>${materialLink(url,data._legacyPdf?'Открыть PDF':'Открыть файл '+(i+1))}</p>`).join('')}</article>`).join('')||'<p>Материалов пока нет.</p>';
}

function testCards(tests) {
  return tests.map(test => `
    <div class="item subject-card">
      <h3>${escapeHtml(test.title)}</h3>
      <div class="meta">Преподаватель: ${escapeHtml(test.teacherName)} • ${test.questionCount} вопросов ${test.timer ? `• Таймер: ${test.timer} мин` : ''}</div>
      <button class="primary" data-id="${escapeHtml(test.id)}" onclick="startTest(this)">Пройти тест</button>
    </div>`).join('');
}

async function renderSubjectView(list) {
  const selection = subjectView;
  if (!selection) {
    const subjects = await callFunction('listSubjects');
    list.innerHTML = `${AppConnection.note(subjects)}${SubjectSearch.toolbar()}<div class="subjects-grid">${subjects.map(subject => `
      <article class="item subject-card" ${SubjectSearch.attrs(subject)}>
        <h3>${escapeHtml(subject.title)}</h3>
        <p class="subject-description subject-preview">${escapeHtml(subject.description)}</p>
        <p class="meta">Преподавателей: ${escapeHtml(subject.teacherCount)}</p>
        <button class="primary" data-id="${escapeHtml(subject.id)}" onclick="openSubject(this)">Открыть предмет</button>
      </article>`).join('') || '<p>Предметов пока нет.</p>'}</div>`;
    SubjectSearch.update();
    return;
  }

  if (selection.teacherId) {
    const page = await callFunction('getSubjectContent', {
      subjectId: selection.subjectId, teacherId: selection.teacherId
    });
    list.innerHTML = subjectContent(page);
    return;
  }

  const { subject, teachers } = await callFunction('listSubjectTeachers', { subjectId: selection.subjectId });
  if (!list.isConnected) return;
  if (teachers.length === 1) {
    subjectView = { subjectId: subject.id, teacherId: teachers[0].id, fromChooser: false };
    await render();
    return;
  }

  list.innerHTML = `<h2 class="subject-heading">${escapeHtml(subject.title)}</h2>
    <p class="subject-description">${escapeHtml(subject.description)}</p>
    ${teachers.length ? '<h3 style="margin:16px 0 12px">Выберите преподавателя</h3>' : ''}
    <div class="subjects-grid">${teachers.map(teacher => `
      <article class="item subject-card">
        <div class="subject-heading">${teacherAvatar(teacher.name)}<h3>${escapeHtml(teacher.name)}</h3></div>
        <div class="actions"><button class="primary" data-id="${escapeHtml(teacher.id)}" onclick="chooseInstructor(this)">Выбрать</button>
        ${ActionMenu.render(`<button type="button" data-id="${escapeHtml(teacher.id)}" onclick="Portal.openTeacher(this.dataset.id)">О преподавателе</button>`,'Действия с преподавателем')}</div>
      </article>`).join('') || '<p>У этого предмета пока нет преподавателей.</p>'}</div>`;
}

function openSubject(button) {
  subjectView = { subjectId: button.dataset.id };
  render().catch(showError);
}

function chooseInstructor(button) {
  subjectView = { subjectId: subjectView.subjectId, teacherId: button.dataset.id, fromChooser: true };
  render().catch(showError);
}

function backFromSubject() {
  subjectView = subjectView?.fromChooser ? { subjectId: subjectView.subjectId } : null;
  render().catch(showError);
}

function teacherAvatar(name) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toUpperCase();
  return `<span class="subject-avatar" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

function attachmentActions(file) {
  return `<div class="subject-actions">
    ${file.viewUrl ? materialLink(file.viewUrl, file.mime === 'application/pdf' ? 'Открыть PDF' : 'Открыть видео') : ''}
    ${materialLink(file.downloadUrl, 'Скачать')}
  </div>`;
}

function subjectSection(title, cards, emptyMessage) {
  return `<section class="subject-section"><h3>${escapeHtml(title)}</h3>
    ${cards.join('') || `<p>${escapeHtml(emptyMessage)}</p>`}</section>`;
}

function subjectContent({ subject, teacher, lectures, books, tests }) {
  const lectureFiles = lectures.flatMap(lecture =>
    lecture.attachments.map(file => ({ ...file, lectureTitle: lecture.title })));
  const videos = lectureFiles.filter(file => file.mime === 'video/mp4').map(file => {
    const source = safeMaterialUrl(file.viewUrl);
    return `<article class="item subject-card">
      <h4>${escapeHtml(file.name || file.lectureTitle)}</h4>
      ${source ? `<video class="subject-video" src="${escapeHtml(source)}" controls preload="none"
        aria-label="${escapeHtml(file.name || file.lectureTitle)}"></video>` : ''}
      ${attachmentActions(file)}
    </article>`;
  });
  const lecturePdfs = lectureFiles.filter(file => file.mime === 'application/pdf').map(file => `
    <article class="item subject-card">
      <h4>${escapeHtml(file.name || file.lectureTitle)}</h4>
      ${attachmentActions(file)}
    </article>`);
  const pdfBooks = books.map(book => `<article class="item subject-card">
    <h4>${escapeHtml(book.title)}</h4>
    <p class="meta">${escapeHtml(book.author)}</p>
    <p class="subject-description">${escapeHtml(book.description)}</p>
    ${book.attachments.map(attachmentActions).join('')}
  </article>`);
  const lectureCards = lectures.flatMap(lecture => {
    const files = lecture.attachments.filter(file => file.mime !== 'application/pdf' && file.mime !== 'video/mp4');
    if (!lecture.text && !files.length) return [];
    return [`<article class="item subject-card">
      <h4>${escapeHtml(lecture.title)}</h4>
      ${lecture.text ? `<p class="subject-description">${escapeHtml(lecture.text)}</p>` : ''}
      ${files.map(file => `<p>${materialLink(file.downloadUrl, file.name || 'Скачать вложение')}</p>`).join('')}
    </article>`];
  });
  return `<div class="subject-heading">${teacherAvatar(teacher.name)}
    <div><h2>${escapeHtml(subject.title)}</h2><p>${escapeHtml(teacher.name)}</p><button class="secondary" data-id="${escapeHtml(teacher.id)}" onclick="Portal.openTeacher(this.dataset.id)">О преподавателе</button></div></div>
    <p class="subject-description subject-full-description">${escapeHtml(subject.description)}</p>
    ${subjectSection('Видеоуроки', videos, 'Видеоуроков пока нет.')}
    ${subjectSection('PDF и учебные материалы', [...pdfBooks, ...lecturePdfs], 'PDF-файлов пока нет.')}
    ${subjectSection('Лекции и презентации', lectureCards, 'Лекций пока нет.')}
    ${subjectSection('Тесты', [testCards(tests)].filter(Boolean), 'Тестов пока нет.')}`;
}

async function startTest(button) {
  if (attempt) {
    showStatus('Завершите текущую попытку, прежде чем начать другой тест.');
    return;
  }
  if (startingTest) return;
  const sourceTab = currentTab;
  const sourceSubject = subjectView;
  startingTest = true;
  button.disabled = true;
  showStatus('');
  try {
    const test = await callFunction('startStudentTest', { testId: button.dataset.id });
    await adoptAttempt(test, sourceTab, sourceSubject);
  } catch (error) {
    showError(error);
  } finally {
    startingTest = false;
    button.disabled = false;
  }
}

function sessionKey() { return 'lms-attempt-' + auth.currentUser.uid; }
function draftKey(id) { return sessionKey() + '-' + id; }
function draftStorage(){return AppConnection.draftStorage();}
function draftMessage(message) {
  const el = document.getElementById('draftStatus');
  if (el) el.textContent = message;
}
function cacheDraft(active) {
  try {
    if (active.dirty) draftStorage()?.setItem(draftKey(active.attemptId), JSON.stringify({ revision: active.revision, answers: active.answers }));
    else draftStorage()?.removeItem(draftKey(active.attemptId));
  } catch { draftMessage('Браузер не смог сохранить локальную копию. Дождитесь сохранения на сервере.'); }
}
function setAnswer(index, value) {
  if (!attempt || attempt.result || submitting) return;
  attempt.answers[index] = value;
  attempt.dirty = true;
  cacheDraft(attempt);
  draftMessage('Сохранение…');
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraftNow().catch(showError), 300);
}
async function saveDraftNow() {
  clearTimeout(draftTimer);
  if (draftPromise) await draftPromise;
  const active = attempt;
  if (!active || active.result || !active.dirty) return;
  draftPromise = (async () => {
    while (attempt === active && active.dirty && !active.result) {
      const answers = { ...active.answers };
      const response = await callFunction('saveStudentDraft', { attemptId: active.attemptId, revision: active.revision, answers });
      active.revision = response.revision;
      active.dirty = JSON.stringify(answers) !== JSON.stringify(active.answers);
      cacheDraft(active);
      draftMessage(active.dirty ? 'Сохранение…' : 'Ответы сохранены на сервере.');
    }
  })();
  try { await draftPromise; }
  catch (e) { draftMessage('Ответы не сохранены на сервере. Локальная копия остаётся в этом браузере.'); throw e; }
  finally { draftPromise = null; }
}
async function adoptAttempt(data, tab, selection) {
  clearInterval(timerInterval);
  attempt = { ...data, answers: data.answers ?? {}, pendingPhotos: new Map(), dirty: false,
    endsAt: data.remainingMs === null ? null : performance.now() + data.remainingMs };
  attemptTab = tab;
  subjectView = selection;
  let conflict = false;
  try {
    const local = JSON.parse(draftStorage()?.getItem(draftKey(data.attemptId)) || 'null');
    if (!data.result && local && (data.remainingMs === null || data.remainingMs > 0)) {
      if (local.revision === data.revision) { attempt.answers = local.answers; attempt.dirty = true; }
      else if (JSON.stringify(local.answers) !== JSON.stringify(data.answers)) conflict = true;
    }
    if (data.result) draftStorage()?.removeItem(draftKey(data.attemptId));
    sessionStorage.setItem(sessionKey(), JSON.stringify({ id: data.attemptId, tab, selection }));
  } catch { /* Server restoration still works when browser storage is disabled. */ }
  currentTab = tab;
  document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('onclick')?.includes("'" + tab + "'")));
  await render();
  if (conflict) showStatus('На сервере более новая версия ответов. Локальная копия сохранена; перед продолжением скачайте её для сверки.');
  if (attempt.dirty) saveDraftNow().catch(showError);
  if (!data.result && attempt.endsAt !== null) timerInterval = setInterval(updateTimer, 250);
  await refreshActiveAttempts();
}
async function resumeSavedAttempt(button) {
  button.disabled = true;
  try {
    if (attempt && !attempt.result) await saveDraftNow();
    const data = await callFunction('getStudentAttempt', { attemptId: button.dataset.id });
    const selection = data.subjectId ? { subjectId: data.subjectId, teacherId: data.teacherId, fromChooser: true } : null;
    await adoptAttempt(data, selection ? 'subjects' : 'tests', selection);
  } catch (e) { showError(e); } finally { button.disabled = false; }
}
async function refreshActiveAttempts() {
  const active = await callFunction('listActiveAttempts');
  const el = document.getElementById('resumeNotice');
  el.hidden = !active.length;
  el.innerHTML = `<p>Незавершённые работы</p>${active.map(a => `<button class="tab-btn" data-id="${escapeHtml(a.attemptId)}" onclick="resumeSavedAttempt(this)">Продолжить: ${escapeHtml(a.title)}</button>`).join('')}`;
}
function downloadLocalDraft() {
  const raw = draftStorage()?.getItem(draftKey(attempt.attemptId));
  if (!raw) { showStatus('Локальных несохранённых ответов нет.'); return; }
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'my-draft.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function initializeStudent() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey()) || 'null');
    if (saved) {
      const data = await callFunction('getStudentAttempt', { attemptId: saved.id });
      await adoptAttempt(data, saved.tab === 'subjects' ? 'subjects' : 'tests', saved.selection);
      return;
    }
  } catch { try { sessionStorage.removeItem(sessionKey()); } catch {} }
  await render();
  await refreshActiveAttempts();
}

function updateTimer() {
  const seconds = Math.max(0, Math.ceil((attempt.endsAt - performance.now()) / 1000));
  const timer = document.getElementById('timer');
  if (timer) {
    timer.textContent = `⏱ Осталось: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  if (!seconds) {
    clearInterval(timerInterval);
    submitTest(true);
  }
}

function renderTest() {
  const questions = attempt.questions.map((question, index) => {
    let input;
    const saved = attempt.answers[index];
    if (question.type === 'choice') {
      input = question.options.map((option, choice) => `
        <label class="quiz-option">
          <input type="radio" name="q${index}" ${saved === choice ? 'checked' : ''} onchange="setAnswer(${index},${choice})">
          ${escapeHtml(option)}
        </label>`).join('');
    } else if (question.type === 'text') {
      input = `<textarea maxlength="5000" aria-label="Ответ ${index + 1}" style="width:100%;padding:10px;min-height:80px" oninput="setAnswer(${index},this.value)">${escapeHtml(saved)}</textarea>`;
    } else {
      input = `<input type="file" accept="image/*" aria-label="Фото ${index + 1}" onchange="uploadPhoto(${index}, this)">
        <small id="photo-status-${index}">${saved ? 'Фото загружено' : ''}</small>`;
    }
    return `<div class="item" style="margin:20px 0"><h4>${index + 1}. ${escapeHtml(question.text)}</h4>${input}</div>`;
  }).join('');

  content.innerHTML = `
    ${attempt.endsAt !== null ? '<div id="timer" class="timer"></div>' : ''}
    <h2>${escapeHtml(attempt.title)}</h2>
    <p id="draftStatus" role="status">${attempt.dirty ? 'Есть несохранённые изменения.' : 'Ответы сохранены на сервере.'}</p>
    <fieldset id="test-answers" style="border:0" ${submitting ? 'disabled' : ''}>${questions}</fieldset>
    <button id="submit-test" class="primary" onclick="submitTest()" ${submitting ? 'disabled' : ''}>Завершить тест</button>
    <button id="leave-test" class="tab-btn" onclick="returnToTests()" ${submitting ? 'disabled' : ''}>Сохранить и выйти</button>
    <button class="tab-btn" onclick="downloadLocalDraft()">Скачать локальный черновик</button>`;
  if (attempt.endsAt !== null) updateTimer();
}

async function uploadPhoto(index, input) {
  const file = input.files[0];
  if (!file) return;
  const active = attempt;
  const pending = Symbol();
  active.pendingPhotos.set(index, pending);
  document.getElementById('photo-status-' + index).textContent = 'Загрузка…';
  try {
    const path = await uploadAttachment('photo', file, { attemptId: active.attemptId });
    if (active.pendingPhotos.get(index) === pending) {
      if (attempt === active) setAnswer(index, path);
      const status = document.getElementById('photo-status-' + index);
      if (attempt === active && status) status.textContent = 'Фото загружено';
    }
  } catch (error) {
    if (attempt === active && active.pendingPhotos.get(index) === pending) {
      input.value = '';
      const status = document.getElementById('photo-status-' + index);
      if (status) status.textContent = '';
      showStatus('Не удалось загрузить фото. ' + error.message);
    }
  } finally {
    if (active.pendingPhotos.get(index) === pending) active.pendingPhotos.delete(index);
  }
}

function toggleTestControls(disabled) {
  for (const id of ['test-answers', 'submit-test', 'leave-test']) {
    const element = document.getElementById(id);
    if (element) element.disabled = disabled;
  }
}

async function submitTest(timedOut = false) {
  if (!attempt || attempt.result || submitting) return;
  if (!timedOut && attempt.pendingPhotos.size) {
    showStatus('Дождитесь загрузки фото.');
    return;
  }
  submitting = true;
  toggleTestControls(true);
  showStatus('');
  try {
    try { await saveDraftNow(); } catch (error) { if (!timedOut || error.code !== 'deadline-exceeded') throw error; }
    attempt.result = await callFunction('submitStudentTest', {
      attemptId: attempt.attemptId,
      answers: { ...attempt.answers }, revision: attempt.revision
    });
    attempt.dirty = false;
    cacheDraft(attempt);
    clearInterval(timerInterval);
    if (currentTab === attemptTab) renderResult(attempt.result);
    await refreshActiveAttempts();
  } catch (error) {
    showError(error);
  } finally {
    submitting = false;
    toggleTestControls(false);
  }
}

function renderResult({ score, total, percentage, status, feedback }) {
  const pending = status === 'pending_review';
  content.innerHTML = `
    <div class="result">
      <h2>${pending ? 'Работа отправлена' : `Результат: ${score} из ${total} (${percentage}%)`}</h2>
      <p>${pending ? 'Ожидает проверки преподавателем. Итог появится в разделе «Мои результаты».' : 'Результат сохранён. Все попытки и комментарии доступны в разделе «Мои результаты».'}</p>
      ${feedback ? `<p class="review-answer">${escapeHtml(feedback)}</p>` : ''}
      <button class="primary" onclick="returnToTests()" style="margin-top:16px">
        ${attemptTab === 'subjects' ? testReturnLabel() : 'Вернуться к тестам'}
      </button>
    </div>`;
}

function testReturnLabel() {
  return attemptTab === 'subjects' ? 'К материалам предмета' : 'К списку тестов';
}

async function returnToTests() {
  if (attempt && !attempt.result) {
    if (attempt.pendingPhotos.size) { showStatus('Дождитесь загрузки фото.'); return; }
    try { await saveDraftNow(); } catch (e) { showError(e); return; }
  }
  clearInterval(timerInterval);
  attempt = null;
  attemptTab = null;
  try { sessionStorage.removeItem(sessionKey()); } catch {}
  await render().catch(showError);
  await refreshActiveAttempts().catch(showError);
}

watchCabinet('student', initializeStudent);
