let currentTab = 'lectures';
let attempt = null;
let attemptTab = null;
let subjectView = null;
let startingTest = false;
let submitting = false;
let timerInterval;
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

  const titles = { lectures: 'Доступные лекции', books: 'Доступные книги', tests: 'Доступные тесты' };
  content.innerHTML = `<h2 style="margin-bottom:16px">${titles[currentTab]}</h2><div>Загрузка…</div>`;
  const list = content.lastElementChild;
  const tab = currentTab;

  if (tab === 'tests') {
    const tests = await callFunction('listStudentTests');
    list.innerHTML = testCards(tests) || '<p>Нет тестов</p>';
    return;
  }

  const materials = await callFunction('listMaterials', { kind: tab });
  if (tab === 'lectures') {
    list.innerHTML = materials.map(data => {
      const date = new Date(data.createdAt).toLocaleString('ru');
      const files = (data.files ?? []).map((file, index) => materialLink(file, 'Скачать файл ' + (index + 1)));
      return `<div class="item">
        <h3>${escapeHtml(data.title)}</h3>
        <div class="meta">Преподаватель: ${escapeHtml(data.teacherName)} • ${date}</div>
        <p>${escapeHtml(data.text)}</p>
        ${files.filter(Boolean).map(link => `<p style="margin-top:8px">📎 ${link}</p>`).join('')}
      </div>`;
    }).join('') || '<p>Нет лекций</p>';
  } else {
    list.innerHTML = materials.map(data => {
      const link = data.fileUrl ? materialLink(data.fileUrl, 'Читать PDF') : '';
      return `<div class="item">
        <h3>${escapeHtml(data.title)}</h3>
        <div class="meta">Автор: ${escapeHtml(data.author)}</div>
        <p>${escapeHtml(data.description)}</p>
        ${link ? `<p style="margin-top:8px">📖 ${link}</p>` : ''}
      </div>`;
    }).join('') || '<p>Нет книг</p>';
  }
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
    list.innerHTML = `<div class="subjects-grid">${subjects.map(subject => `
      <article class="item subject-card">
        <h3>${escapeHtml(subject.title)}</h3>
        <p class="subject-description">${escapeHtml(subject.description)}</p>
        <p class="meta">Преподавателей: ${escapeHtml(subject.teacherCount)}</p>
        <button class="primary" data-id="${escapeHtml(subject.id)}" onclick="openSubject(this)">Открыть предмет</button>
      </article>`).join('') || '<p>Предметов пока нет.</p>'}</div>`;
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
        <button class="primary" data-id="${escapeHtml(teacher.id)}" onclick="chooseInstructor(this)">Выбрать</button>
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
    <div><h2>${escapeHtml(subject.title)}</h2><p>${escapeHtml(teacher.name)}</p></div></div>
    ${subjectSection('Видеоуроки', videos, 'Видеоуроков пока нет.')}
    ${subjectSection('PDF и книги', [...pdfBooks, ...lecturePdfs], 'Файлов и книг пока нет.')}
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
    attemptTab = sourceTab;
    if (sourceTab === 'subjects') subjectView = sourceSubject;
    attempt = {
      ...test,
      endsAt: test.remainingMs === null ? null : performance.now() + test.remainingMs,
      answers: {},
      pendingPhotos: new Map()
    };
    if (attempt.endsAt !== null) {
      timerInterval = setInterval(updateTimer, 250);
    }
    if (currentTab === attemptTab) await render();
  } catch (error) {
    showError(error);
  } finally {
    startingTest = false;
    button.disabled = false;
  }
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
          <input type="radio" name="q${index}" ${saved === choice ? 'checked' : ''} onchange="attempt.answers[${index}]=${choice}">
          ${escapeHtml(option)}
        </label>`).join('');
    } else if (question.type === 'text') {
      input = `<textarea maxlength="5000" aria-label="Ответ ${index + 1}" style="width:100%;padding:10px;min-height:80px" oninput="attempt.answers[${index}]=this.value">${escapeHtml(saved)}</textarea>`;
    } else {
      input = `<input type="file" accept="image/*" aria-label="Фото ${index + 1}" onchange="uploadPhoto(${index}, this)">
        <small id="photo-status-${index}">${saved ? 'Фото загружено' : ''}</small>`;
    }
    return `<div class="item" style="margin:20px 0"><h4>${index + 1}. ${escapeHtml(question.text)}</h4>${input}</div>`;
  }).join('');

  content.innerHTML = `
    ${attempt.endsAt !== null ? '<div id="timer" class="timer"></div>' : ''}
    <h2>${escapeHtml(attempt.title)}</h2>
    <fieldset id="test-answers" style="border:0" ${submitting ? 'disabled' : ''}>${questions}</fieldset>
    <button id="submit-test" class="primary" onclick="submitTest()" ${submitting ? 'disabled' : ''}>Завершить тест</button>
    <button id="leave-test" class="tab-btn" onclick="returnToTests()" ${submitting ? 'disabled' : ''}>${testReturnLabel()}</button>`;
  if (attempt.endsAt !== null) updateTimer();
}

async function uploadPhoto(index, input) {
  const file = input.files[0];
  if (!file) return;
  const active = attempt;
  const pending = Symbol();
  active.pendingPhotos.set(index, pending);
  delete active.answers[index];
  document.getElementById('photo-status-' + index).textContent = 'Загрузка…';
  try {
    const path = await uploadAttachment('photo', file, { attemptId: active.attemptId });
    if (active.pendingPhotos.get(index) === pending) {
      active.answers[index] = path;
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
    attempt.result = await callFunction('submitStudentTest', {
      attemptId: attempt.attemptId,
      answers: { ...attempt.answers }
    });
    clearInterval(timerInterval);
    if (currentTab === attemptTab) renderResult(attempt.result);
  } catch (error) {
    showError(error);
  } finally {
    submitting = false;
    toggleTestControls(false);
  }
}

function renderResult({ score, total, percentage }) {
  const passed = percentage >= 60;
  content.innerHTML = `
    <div class="result ${passed ? 'good' : 'bad'}">
      <h2>Результат: ${score} из ${total} (${percentage}%)</h2>
      <p>${passed ? '✅ Зачёт!' : '❌ Нужно повторить'}</p>
      <button class="primary" onclick="returnToTests()" style="margin-top:16px">
        ${attemptTab === 'subjects' ? testReturnLabel() : 'Вернуться к тестам'}
      </button>
    </div>`;
}

function testReturnLabel() {
  return attemptTab === 'subjects' ? 'К материалам предмета' : 'К списку тестов';
}

function returnToTests() {
  clearInterval(timerInterval);
  attempt = null;
  attemptTab = null;
  render().catch(showError);
}

watchCabinet('student', render);
