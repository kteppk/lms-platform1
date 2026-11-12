const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

// Real page scripts and styles, isolated Auth/API fixtures: no production writes.
const published = process.argv.includes('--published');
const base = published ? 'https://kteppk.github.io/lms-platform1/' : 'http://127.0.0.1:54321/';
const screenshots = process.env.LMS_SCREENSHOTS;
const root = path.resolve(__dirname, '..');
const assets = new Set(['index.html', 'student.html', 'teacher.html', 'admin.html', 'student.js',
  'firebase-config.js', 'portal.js', 'portal.css', 'mobile-nav.js', 'mobile-nav.css',
  'subjects.css', 'assessment.css', 'gradebook.js']);

function fixtures(role) {
  let active = null;
  const name = 'Александра Константинопольская Владимировна';
  return (action, data) => {
    const teacher = { id: 'teacher-fixture', name, position: 'Преподаватель экономики', avatarUrl: null, subjectIds: ['subject'] };
    const test = { id: 'quiz', title: 'Тест с сохранением ответов', timer: 5, questionCount: 2, teacherName: name };
    switch (action) {
      case 'profile': return { uid: role, role, name, email: role + '@example.test', canTeach: role === 'teacher', noPatronymic: false };
      case 'listSubjects': return [{ id: 'subject', title: 'Экономика и финансовая грамотность', description: 'Материалы и задания по предмету.', teacherCount: 1, joined: true, canEdit: true }];
      case 'listTeachers': return [teacher];
      case 'getTeacherProfile': return { ...teacher, id: data.teacherId, canEdit: role !== 'student', revision: 0, documents: [] };
      case 'listNotifications': return { unreadCount: 1, rows: [{ id: 'notice', title: 'Изменения в расписании', body: 'Проверьте время ближайшего занятия.', severity: 'info', destination: 'schedule', created_at: new Date().toISOString(), read: false }] };
      case 'readNotifications': return null;
      case 'listSchedule': return { rows: [1, 2, 3].map(i => ({ id: 'lesson-' + i, lesson_date: data.from, starts_at: '09:00:00', ends_at: '10:30:00', title: 'Основы экономики и финансовая грамотность', teacher_id: teacher.id, group_name: 'ЭК-11', room: 'Аудитория 201', note: 'Учебные материалы размещены в разделе «Предметы».', revision: 0 })), hasMore: false };
      case 'listAccounts': return [{ id: 'person', name, email: 'very-long-student-address-for-mobile-layout@example.test', role: 'student', needs_name: false }];
      case 'listMaterials': return [{ id: 'material', title: 'Материал с длинным заголовком для чтения на телефоне', teacherName: name, createdAt: new Date().toISOString(), text: ('Учебный материал, который удобно читать с телефона.\n').repeat(35), files: [], attachments: [], author: name, description: 'Учебное пособие', fileUrl: '' }];
      case 'listStudentTests': case 'listTeacherTests': return [test];
      case 'listStudents': return [];
      case 'listResults': return { rows: [{ id: 'result', test_title: 'Итоговая работа по экономике', student_name: name, score: 2, total: 3, percentage: 67, status: 'graded', submitted_at: new Date().toISOString() }], hasMore: false };
      case 'listActiveAttempts': return active ? [{ attemptId: active.attemptId, title: active.title, subjectId: null, teacherId: teacher.id }] : [];
      case 'startStudentTest':
        active ??= { attemptId: 'attempt-fixture', title: test.title, teacherId: teacher.id, subjectId: null,
          expiresAt: new Date(Date.now() + 300000).toISOString(), remainingMs: 300000, revision: 0, answers: {},
          questions: [{ type: 'choice', text: 'Выберите ответ', options: ['Первый', 'Второй', 'Третий', 'Четвёртый'] }, { type: 'text', text: 'Объясните решение' }] };
        return active;
      case 'getStudentAttempt': return active;
      case 'saveStudentDraft': active.answers = data.answers; return { revision: ++active.revision };
      default: throw new Error('Unexpected fixture API action: ' + action);
    }
  };
}

async function prepare(browser, role) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ role }) => {
    const user = { uid: role, email: role + '@example.test', getIdToken: async () => 'fixture-token', updateProfile: async () => {} };
    window.firebase = { initializeApp() {}, auth: () => ({ currentUser: user, onAuthStateChanged: callback => { queueMicrotask(() => callback(user)); return () => {}; }, signOut: async () => {} }) };
  }, { role });
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/portal.js?*', async route => { await new Promise(resolve => setTimeout(resolve, 150)); await route.continue(); });
  const api = fixtures(role);
  await page.route('**/functions/v1/lms', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    try {
      const { action, data = {} } = route.request().postDataJSON();
      await route.fulfill({ headers, json: { data: api(action, data) } });
    } catch (error) {
      errors.push(error.message);
      await route.fulfill({ status: 500, headers, json: { error: error.message } });
    }
  });
  await page.goto(base + role + '.html');
  try { await page.getByRole('heading', { name: 'С чего начнём?', exact: true }).waitFor(); }
  catch(error) { console.error({role,url:page.url(),errors,status:await page.locator('#status').textContent().catch(()=>''),body:(await page.locator('body').innerText()).slice(0,1500)});throw error; }
  await page.locator('#mobileNavigation').waitFor();
  return { page, context, errors };
}

async function choose(page, tab) {
  const direct = page.locator('#mobileNavigation [data-mobile-tab="' + tab + '"]');
  if (await direct.count()) await direct.click();
  else {
    await page.locator('#mobileMore').click();
    await page.locator('#mobileMenu [data-mobile-tab="' + tab + '"]').click();
  }
}

async function verify(page, role) {
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [768, 1024], [844, 390]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.locator('main > .tabs').isVisible(), false);
    assert.equal(await page.locator('#mobileNavigation button').count(), 5);
    await choose(page, 'schedule');
    await page.locator('#scheduleFrom').waitFor();
    const layout = await page.evaluate(() => {
      const bar = document.getElementById('mobileNavigation').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, bottom: bar.bottom, height: innerHeight,
        headerHeight: document.querySelector('header').getBoundingClientRect().height,
        targets: [...document.querySelectorAll('#mobileNavigation button')].map(b => ({ width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })) };
    });
    assert.equal(layout.overflow, false, role + ' ' + width + ' overflow');
    assert.ok(Math.abs(layout.bottom - layout.height) <= 1, 'bottom panel stays on screen');
    assert.ok(layout.headerHeight <= 88, 'compact header');
    assert.ok(layout.targets.every(t => t.width >= 44 && t.height >= 44), 'touch targets');
    assert.equal(await page.locator('#mobileNavigation [aria-current="page"]').getAttribute('data-mobile-tab'), 'schedule');
    await page.locator('#mobileMore').click();
    await page.locator('#mobileMenu').waitFor();
    assert.equal(await page.locator('#mobileMore').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#mobileMenu [data-mobile-tab]').count(), await page.locator('main > .tabs [data-tab]').count());
    await page.locator('#mobileMenu [data-mobile-tab="profile"]').click();
    await page.locator('#profileName').waitFor();
    assert.equal(await page.locator('#mobileMenu').isVisible(), false);
    assert.equal(await page.locator('#mobileMore').getAttribute('aria-expanded'), 'false');
    assert.match(await page.locator('#mobileMore').getAttribute('class'), /active/);
    assert.equal(await page.locator('#profileName').evaluate(el => getComputedStyle(el).fontSize), '16px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobileMore').click();
  await page.keyboard.press('Escape');
  await page.locator('#mobileMenu').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#mobileMore').evaluate(el => el === document.activeElement), true);
  await page.locator('#mobileMore').click();
  await page.mouse.click(4, 4);
  await page.locator('#mobileMenu').waitFor({ state: 'hidden' });

  const extra = role === 'admin' ? 'accounts' : role === 'teacher' ? 'journal' : 'results';
  await choose(page, extra);
  await page.locator(role === 'admin' ? '.table-wrap tbody tr' : '#gradeRows h3').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (role === 'admin') {
    const table = await page.locator('.table-wrap').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.equal(table.width, table.scroll, 'accounts fit without sideways scrolling');
    assert.ok((await page.locator('[data-portal="role-save"]').boundingBox()).height >= 44);
  }

  const sections = await page.locator('main > .tabs [data-tab]').evaluateAll(nodes => nodes.map(n => n.dataset.tab));
  const ready = { home: '.quick-grid', subjects: '.subject-card', lectures: role === 'student' ? '#content .item' : '#lectureTitle',
    books: role === 'student' ? '#content .item' : '#bookTitle', tests: role === 'student' ? '#content .item' : '#testTitle',
    students: '#studentsList', journal: '#gradeRows h3', results: '#gradeRows h3', teachers: '.teacher-card',
    schedule: '#scheduleFrom', notifications: '.notice-card', profile: '#profileName', accounts: '.table-wrap tbody tr', announcements: '#announcementTitle' };
  for (const tab of sections) {
    await choose(page, tab);
    await page.locator(ready[tab]).first().waitFor();
    assert.equal(await page.locator('main > .tabs .active').getAttribute('data-tab'), tab);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, role + ' ' + tab);
  }

  if (role === 'student') {
    await choose(page, 'tests');
    await page.getByRole('button', { name: 'Пройти тест', exact: true }).click();
    await page.getByRole('radio', { name: 'Второй', exact: true }).check();
    await page.getByLabel('Ответ 2', { exact: true }).fill('Черновик сохраняется при переходах.');
    await page.locator('#draftStatus').filter({ hasText: 'Ответы сохранены на сервере.' }).waitFor();
    const before = await page.evaluate(() => ({ id: attempt.attemptId, expiresAt: attempt.expiresAt }));
    await choose(page, 'schedule');
    await page.locator('#scheduleFrom').waitFor();
    await choose(page, 'tests');
    await page.locator('#timer').waitFor();
    assert.equal(await page.getByRole('radio', { name: 'Второй', exact: true }).isChecked(), true);
    assert.equal(await page.getByLabel('Ответ 2', { exact: true }).inputValue(), 'Черновик сохраняется при переходах.');
    assert.deepEqual(await page.evaluate(() => ({ id: attempt.attemptId, expiresAt: attempt.expiresAt })), before);
    assert.match(await page.locator('#mobileMore').getAttribute('class'), /active/);
  }

  await choose(page, 'home');
  await page.getByRole('heading', { name: 'С чего начнём?', exact: true }).waitFor();
  await page.evaluate(() => Portal.toast('Проверка уведомлений', 'Нижняя панель остаётся доступной.', 'info', 'schedule'));
  const navBox = await page.locator('#mobileNavigation').boundingBox();
  const toast = await page.locator('#toastRegion .toast').last().boundingBox();
  assert.ok(toast.y + toast.height < navBox.y, 'toast does not cover navigation');
  await page.locator('#toastRegion').evaluate(el => el.replaceChildren());
  if (screenshots) {
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, role + '-mobile.png') });
    await page.locator('#mobileMore').click();
    await page.screenshot({ path: path.join(screenshots, role + '-menu.png') });
  } else await page.locator('#mobileMore').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#mobileMenu').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#mobileNavigation').isVisible(), false);
  assert.equal(await page.locator('main > .tabs').isVisible(), true);
  await page.locator('main > .tabs [data-tab="profile"]').click();
  await page.locator('#profileName').waitFor();
  assert.equal(await page.locator('main > .tabs .active').getAttribute('data-tab'), 'profile');
  console.log('PASS ' + role + ': six screen sizes, all sections, focus/Escape/backdrop, desktop resize, touch targets' + (role === 'student' ? ', same attempt/answers/deadline' : ''));
}

async function main() {
  let server;
  if (!published) {
    server = http.createServer((req, res) => {
      const file = new URL(req.url, base).pathname.slice(1) || 'index.html';
      if (!assets.has(file)) return res.writeHead(404).end();
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(fs.readFileSync(path.join(root, file)));
    });
    await new Promise((resolve, reject) => server.listen(54321, '127.0.0.1', resolve).once('error', reject));
  }
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const role of ['student', 'teacher', 'admin']) {
      const { page, context, errors } = await prepare(browser, role);
      await verify(page, role);
      assert.deepEqual(errors, [], 'browser errors');
      await context.close();
    }
    console.log('PASS ' + (published ? 'published' : 'local') + ' UI; Auth/API fixtures isolated, no production accounts or records created');
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
