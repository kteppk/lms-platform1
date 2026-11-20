const SubjectContent=(()=>{
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

  function reviewCards(tests) {
    return tests.map(test => `<article class="item subject-card"><h4>${escapeHtml(test.title)}</h4><p class="meta">Вопросов: ${escapeHtml(test.questionCount)}</p></article>`).join('');
  }

  function render({ subject, teacher, lectures, books, tests }, testCards=reviewCards) {
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
  return {render,avatar:teacherAvatar};
})();
