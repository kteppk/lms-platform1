const Gradebook = (() => {
  let state;
  const date = value => value ? new Date(value).toLocaleString('ru') : '—';
  const status = row => row.status === 'pending_review' ? 'Ожидает проверки' : `${row.score} из ${row.total} (${row.percentage}%)`;
  const error = e => showStatus(e.message);
  function filters() {
    const form = document.getElementById('gradeFilters');
    return Object.fromEntries(new FormData(form));
  }
  async function render(root, teacher) {
    const token = {};
    state = { root, teacher, offset: 0, token, filters: {} };
    root.innerHTML = `<h2>${teacher ? 'Журнал оценок' : 'Мои результаты'}</h2>
      <form id="gradeFilters" class="grade-filters" onsubmit="event.preventDefault(); Gradebook.filter()">
        ${teacher ? '<label>Студент<input name="studentName" maxlength="120"></label>' : ''}
        <label>Статус<select name="status"><option value="">Все</option><option value="pending_review">Ожидает проверки</option><option value="graded">Проверено</option></select></label>
        <label>С даты (UTC)<input name="fromDate" type="date"></label>
        <label>По дату (UTC)<input name="toDate" type="date"></label>
        <button class="primary" type="submit">Показать</button>
      </form>
      <div class="subject-actions">${teacher ? '<button class="secondary" onclick="Gradebook.exportCsv(this)">Скачать CSV</button>' : ''}</div>
      <div id="gradeRows" class="subject-section" aria-live="polite">Загрузка…</div>`;
    await load(token);
  }
  async function load(token = state.token) {
    const current = state;
    const { rows, hasMore } = await callFunction('listResults', { ...current.filters, offset: current.offset });
    if (state !== current || state.token !== token || !current.root.isConnected || !document.getElementById('gradeRows')) return;
    document.getElementById('gradeRows').innerHTML = rows.map(row => `<article class="item">
      <h3>${escapeHtml(row.test_title)}</h3>
      ${current.teacher ? `<p>${escapeHtml(row.student_name)}</p>` : ''}
      <p class="grade-status">${escapeHtml(status(row))}</p><p class="meta">Сдано: ${escapeHtml(date(row.submitted_at))}</p>
      <button class="primary" data-id="${escapeHtml(row.id)}" onclick="Gradebook.open(this)">${current.teacher ? 'Открыть работу' : 'Посмотреть'}</button>
    </article>`).join('') || '<p>Результатов пока нет.</p>';
    document.getElementById('gradeRows').insertAdjacentHTML('beforeend', `<div class="subject-actions">
      <button class="tab-btn" onclick="Gradebook.page(-1)" ${current.offset === 0 ? 'disabled' : ''}>Назад</button>
      <span>Страница ${current.offset / 50 + 1}</span>
      <button class="tab-btn" onclick="Gradebook.page(1)" ${hasMore ? '' : 'disabled'}>Далее</button></div>`);
  }
  async function filter() {
    state.filters = filters(); state.offset = 0; state.token = {};
    try { await load(); } catch (e) { error(e); }
  }
  async function page(step) {
    state.offset = Math.max(0, state.offset + step * 50); state.token = {};
    try { await load(); } catch (e) { error(e); }
  }
  async function open(button) {
    const current = state;
    button.disabled = true; showStatus('');
    try {
      const row = await callFunction('getResult', { resultId: button.dataset.id });
      if (current !== state || !current.root.isConnected || !document.getElementById('gradeRows')) return;
      current.result = row;
      current.root.innerHTML = `<button class="tab-btn" onclick="Gradebook.back()">← К журналу</button>
        <h2 class="subject-section">${escapeHtml(row.title)}</h2>
        <p>${escapeHtml(current.teacher ? row.studentName : row.teacherName)}</p>
        <p class="grade-status">${escapeHtml(status(row))}</p><p>Сдано: ${escapeHtml(date(row.submittedAt))}</p>
        <form id="reviewForm" onsubmit="event.preventDefault(); Gradebook.save(this)">
          ${row.questions.map((q, i) => {
            let answer = q.type === 'photo' ? (q.photoUrl ? `${materialLink(q.photoUrl, 'Открыть фотоответ')}<img class="review-photo" src="${escapeHtml(safeMaterialUrl(q.photoUrl))}" alt="Фотоответ на вопрос ${i + 1}">` : 'Фото не приложено') :
              escapeHtml(q.type === 'choice' ? (q.options[q.answer] ?? 'Нет ответа') : (q.answer || 'Нет ответа'));
            return `<section class="item subject-section"><h3>${i + 1}. ${escapeHtml(q.text)}</h3>
              <div class="review-answer">${answer}</div>
              ${q.type === 'choice' && current.teacher ? `<p>Правильный вариант: ${escapeHtml(q.options[q.correct])}</p>` : ''}
              ${q.type !== 'choice' && current.teacher ? `<label>Баллы (максимум 1)
                <select class="manual-score" data-index="${i}" required>
                  <option value="">Выберите оценку</option>
                  <option value="0" ${q.score === 0 ? 'selected' : ''}>0 — не зачтено</option>
                  <option value="1" ${q.score === 1 ? 'selected' : ''}>1 — зачтено</option>
                </select></label>` : `<p>Баллы: ${q.score === null ? 'ожидает проверки' : escapeHtml(q.score) + ' / 1'}</p>`}
            </section>`;
          }).join('') || '<p>Версия вопросов для старого результата не сохранилась.</p>'}
          ${current.teacher && row.questions.some(q => q.type !== 'choice') ? `
            <label for="reviewFeedback">Комментарий преподавателя</label>
            <textarea id="reviewFeedback" maxlength="5000">${escapeHtml(row.feedback)}</textarea>
            <button class="primary" type="submit">Сохранить проверку</button>` :
            `<p class="review-answer">${escapeHtml(row.feedback || 'Комментариев пока нет.')}</p>`}
        </form>
        ${row.gradedAt ? `<p class="meta">Проверено: ${escapeHtml(date(row.gradedAt))}</p>` : ''}
        ${current.teacher && row.reviews.length ? `<details class="subject-section"><summary>История проверок</summary>
          ${row.reviews.map(r => `<p>${escapeHtml(date(r.reviewed_at))}: ${r.score} / ${row.total} — ${escapeHtml(r.feedback)}</p>`).join('')}</details>` : ''}`;
    } catch (e) { error(e); } finally { button.disabled = false; }
  }
  async function back() {
    const { root, teacher } = state;
    try { await render(root, teacher); } catch (e) { error(e); }
  }
  async function save(form) {
    const current = state;
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const grades = Object.fromEntries([...form.querySelectorAll('.manual-score')].map(el => [el.dataset.index, Number(el.value)]));
      const result = await callFunction('reviewResult', { resultId: current.result.id, revision: current.result.reviewRevision,
        grades, feedback: form.querySelector('#reviewFeedback').value });
      if (state !== current || !form.isConnected) return;
      current.result.reviewRevision = result.reviewRevision;
      await back(); showStatus('Проверка сохранена.');
    } catch (e) { error(e); } finally { button.disabled = false; }
  }
  async function exportCsv(button) {
    button.disabled = true;
    const exportFilters = { ...state.filters };
    try {
      let rows = [];
      for (let offset = 0; ; offset += 50) {
        if (offset >= 5000) throw new Error('Сузьте фильтр: в одной выгрузке доступно до 5000 работ.');
        const page = await callFunction('listResults', { ...exportFilters, offset });
        rows.push(...page.rows); if (!page.hasMore) break;
      }
      const cell = value => '"' + String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""') + '"';
      const lines = [['Студент', 'Тест', 'Статус', 'Баллы', 'Максимум', 'Процент', 'Сдано (UTC)'],
        ...rows.map(r => [r.student_name,r.test_title,r.status === 'pending_review' ? 'Ожидает проверки' : 'Проверено',r.score,r.total,r.percentage,r.submitted_at])];
      const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'gradebook.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { error(e); } finally { button.disabled = false; }
  }
  return { render, filter, page, open, back, save, exportCsv };
})();
