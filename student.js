let user;
let currentTab = 'lectures';
let attempt = null;
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
  if (currentTab === 'tests' && attempt) {
    if (attempt.result) renderResult(attempt.result);
    else renderTest();
    return;
  }

  const titles = { lectures: 'Доступные лекции', books: 'Доступные книги', tests: 'Доступные тесты' };
  content.innerHTML = `<h2 style="margin-bottom:16px">${titles[currentTab]}</h2><div>Загрузка…</div>`;
  const list = content.lastElementChild;
  const tab = currentTab;

  if (tab === 'tests') {
    const tests = await callFunction('listStudentTests');
    list.innerHTML = tests.map(test => `
      <div class="item">
        <h3>${escapeHtml(test.title)}</h3>
        <div class="meta">Преподаватель: ${escapeHtml(test.teacherName)} • ${test.questionCount} вопросов ${test.timer ? `• Таймер: ${test.timer} мин` : ''}</div>
        <button class="primary" data-id="${escapeHtml(test.id)}" onclick="startTest(this)">Пройти тест</button>
      </div>
    `).join('') || '<p>Нет тестов</p>';
    return;
  }

  const snapshot = await db.collection(tab).orderBy('createdAt', 'desc').get();
  if (tab === 'lectures') {
    list.innerHTML = snapshot.docs.map(doc => {
      const data = doc.data();
      const date = data.createdAt?.toDate().toLocaleString('ru') || '';
      const files = (data.files ?? []).map((file, index) => materialLink(file, 'Скачать файл ' + (index + 1)));
      return `<div class="item">
        <h3>${escapeHtml(data.title)}</h3>
        <div class="meta">Преподаватель: ${escapeHtml(data.teacherName)} • ${date}</div>
        <p>${escapeHtml(data.text)}</p>
        ${files.filter(Boolean).map(link => `<p style="margin-top:8px">📎 ${link}</p>`).join('')}
      </div>`;
    }).join('') || '<p>Нет лекций</p>';
  } else {
    list.innerHTML = snapshot.docs.map(doc => {
      const data = doc.data();
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

async function startTest(button) {
  if (attempt || startingTest) return;
  startingTest = true;
  button.disabled = true;
  showStatus('');
  try {
    const test = await callFunction('startStudentTest', { testId: button.dataset.id });
    attempt = {
      ...test,
      endsAt: test.remainingMs === null ? null : performance.now() + test.remainingMs,
      answers: {},
      pendingPhotos: new Map()
    };
    if (attempt.endsAt !== null) {
      timerInterval = setInterval(updateTimer, 250);
    }
    if (currentTab === 'tests') await render();
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
    <button id="leave-test" class="tab-btn" onclick="returnToTests()" ${submitting ? 'disabled' : ''}>К списку тестов</button>`;
  if (attempt.endsAt !== null) updateTimer();
}

async function uploadPhoto(index, input) {
  const file = input.files[0];
  if (!file) return;
  const active = attempt;
  const ref = storage.ref(`test_answers/${user.uid}/${active.attemptId}/${crypto.randomUUID()}`);
  active.pendingPhotos.set(index, ref.fullPath);
  delete active.answers[index];
  document.getElementById('photo-status-' + index).textContent = 'Загрузка…';
  try {
    await ref.put(file);
    if (active.pendingPhotos.get(index) === ref.fullPath) {
      active.answers[index] = ref.fullPath;
      const status = document.getElementById('photo-status-' + index);
      if (attempt === active && status) status.textContent = 'Фото загружено';
    }
  } catch (error) {
    if (attempt === active && active.pendingPhotos.get(index) === ref.fullPath) {
      input.value = '';
      const status = document.getElementById('photo-status-' + index);
      if (status) status.textContent = '';
      showStatus('Не удалось загрузить фото. ' + error.message);
    }
  } finally {
    if (active.pendingPhotos.get(index) === ref.fullPath) active.pendingPhotos.delete(index);
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
    if (currentTab === 'tests') renderResult(attempt.result);
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
      <button class="primary" onclick="returnToTests()" style="margin-top:16px">Вернуться к тестам</button>
    </div>`;
}

function returnToTests() {
  clearInterval(timerInterval);
  attempt = null;
  render().catch(showError);
}

watchCabinet('student', (profile) => {
  user = profile;
  return render();
});
