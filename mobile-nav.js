const MobileNavigation = (() => {
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    subjects: '<path d="M12 5C8 2 3 4 3 4v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1Zm0 0v15"/>',
    schedule: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
    results: '<path d="M4 3v18h17M8 16v-4m5 4V8m5 8v-6"/>',
    journal: '<rect x="5" y="3" width="16" height="18" rx="2"/><path d="M3 7h4m-4 5h4m-4 5h4m4-9h6m-6 5h6m-6 5h4"/>',
    accounts: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3 5"/>',
    teachers: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2m-12-6 4 4 4-4"/>',
    profile: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M6 19a6 6 0 0 1 12 0"/>',
    notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 13h4"/>',
    lectures: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8m-8 4h6"/>',
    books: '<path d="M5 3h14v18H6a3 3 0 0 1 0-6h13M5 3v12m3-8h7"/>',
    tests: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 8 1 1 2-2m2 1h3m-8 6 1 1 2-2m2 1h3"/>',
    announcements: '<path d="m3 11 17-7v16L3 15zm4 5 2 5h3l-2-4M20 9h2m-2 6h2"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    logout: '<path d="M10 4H4v16h6m4-13 5 5-5 5m-6-5h11"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.lectures}</svg>`;
  let navigate, menu, bar, activeTab, opener, primaryTabs = [];
  const mobile = () => matchMedia('(max-width: 1024px)').matches;

  function closeMenu() {
    if (!menu) return;
    if (menu.open) menu.close();
    document.body.classList.remove('mobile-menu-open');
    document.getElementById('mobileMore').setAttribute('aria-expanded', 'false');
  }

  function sync() {
    const selected = document.querySelector('main > .tabs [data-tab].active');
    if (!selected || !bar) return;
    const tab = selected.dataset.tab;
    document.querySelectorAll('[data-mobile-tab]').forEach(button => {
      const current = button.dataset.mobileTab === tab;
      button.classList.toggle('active', current);
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const more = document.getElementById('mobileMore');
    more.classList.toggle('active', !primaryTabs.includes(tab));
    more.setAttribute('aria-label', primaryTabs.includes(tab) ? 'Ещё: все разделы' : `Ещё: открыт раздел «${selected.textContent.trim()}»`);
    if (activeTab && activeTab !== tab && mobile()) window.scrollTo({ top: 0, behavior: 'instant' });
    activeTab = tab;
  }

  function updateName() {
    const name = document.getElementById('userName').textContent.trim();
    const initials = name.split(/\s+/u).slice(0, 2).map(word => [...word][0]).join('').toUpperCase();
    document.querySelector('.profile-link').setAttribute('aria-label', `Мой профиль: ${name}`);
    document.querySelector('.profile-link').title = name;
    document.querySelector('.mobile-initials').textContent = initials;
    document.getElementById('mobileProfileName').textContent = name;
  }

  function init(person, onNavigate) {
    if (document.getElementById('mobileNavigation')) return;
    navigate = onNavigate;
    const tabs = [...document.querySelectorAll('main > .tabs button[data-tab]')];
    if (!tabs.length) return;
    const has = tab => tabs.some(button => button.dataset.tab === tab);
    const fourth = has('accounts') ? 'notifications' : has('journal') ? 'journal' : 'results';
    primaryTabs = ['home', has('accounts') ? 'accounts' : 'subjects', 'schedule', fourth];
    const labels = { home: 'Главная', subjects: 'Предметы', accounts: 'Аккаунты', schedule: 'Расписание', results: 'Результаты', journal: 'Результаты', notifications: 'События' };

    bar = document.createElement('nav');
    bar.id = 'mobileNavigation';
    bar.className = 'mobile-navigation';
    bar.setAttribute('aria-label', 'Нижняя навигация');
    bar.innerHTML = primaryTabs.map(tab => `<button type="button" class="mobile-nav-button" data-mobile-tab="${tab}">${svg(tab)}<span>${labels[tab]}</span></button>`).join('') +
      `<button type="button" class="mobile-nav-button" id="mobileMore" aria-haspopup="dialog" aria-expanded="false" aria-controls="mobileMenu">${svg('more')}<span>Ещё</span></button>`;
    document.body.append(bar);

    menu = document.createElement('dialog');
    menu.id = 'mobileMenu';
    menu.className = 'mobile-menu';
    menu.setAttribute('aria-labelledby', 'mobileMenuTitle');
    menu.innerHTML = `<div class="mobile-menu-handle" aria-hidden="true"></div>
      <div class="mobile-menu-heading"><div><p class="eyebrow">${{ student: 'Кабинет студента', teacher: 'Кабинет преподавателя', admin: 'Кабинет администратора' }[person.role]}</p><h2 id="mobileMenuTitle">Все разделы</h2></div><button type="button" class="mobile-icon-button" data-mobile-action="close" aria-label="Закрыть меню">${svg('close')}</button></div>
      <p id="mobileProfileName" class="mobile-profile-name"></p>
      <nav class="mobile-menu-grid" aria-label="Все разделы кабинета">${tabs.map(button => `<button type="button" data-mobile-tab="${button.dataset.tab}">${svg(button.dataset.tab === 'students' ? 'accounts' : button.dataset.tab)}<span>${escapeHtml(button.textContent.trim())}</span></button>`).join('')}</nav>
      <div class="mobile-menu-footer"><button type="button" data-mobile-action="logout">${svg('logout')}<span>Выйти из аккаунта</span></button></div>`;
    document.body.append(menu);
    for (const link of document.querySelectorAll('header .user-info a[href]')) {
      if (new URL(link.href).pathname === location.pathname) continue;
      const copy = link.cloneNode(true);
      copy.className = 'mobile-cabinet-link';
      menu.querySelector('.mobile-menu-footer').prepend(copy);
    }

    const profileButton = document.querySelector('.profile-link');
    const initials = document.createElement('span');
    initials.className = 'mobile-initials';
    initials.setAttribute('aria-hidden', 'true');
    profileButton.append(initials);
    const bell = document.getElementById('notificationButton');
    bell.classList.add('mobile-header-bell');
    // Keep the accessible full text and the unread count on the desktop as well.
    const label = document.createElement('span');
    label.className = 'notification-label';
    label.textContent = 'Уведомления';
    for (const node of [...bell.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
    bell.prepend(label);
    bell.insertAdjacentHTML('afterbegin', svg('notifications'));
    updateName();
    new MutationObserver(updateName).observe(document.getElementById('userName'), { childList: true, characterData: true, subtree: true });
    for (const tab of tabs) new MutationObserver(sync).observe(tab, { attributes: true, attributeFilter: ['class'] });

    document.getElementById('mobileMore').addEventListener('click', event => {
      opener = event.currentTarget;
      menu.showModal();
      document.body.classList.add('mobile-menu-open');
      opener.setAttribute('aria-expanded', 'true');
    });
    menu.addEventListener('close', () => {
      if (menu.open) return;
      document.body.classList.remove('mobile-menu-open');
      document.getElementById('mobileMore').setAttribute('aria-expanded', 'false');
      if (mobile() && opener?.isConnected) opener.focus({ preventScroll: true });
    });
    // A click on the backdrop closes the sheet; clicks on its padding do not.
    menu.addEventListener('click', event => {
      if (event.target !== menu) return;
      const box = menu.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeMenu();
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-mobile-tab], [data-mobile-action]');
      if (!button || button.disabled) return;
      if (button.dataset.mobileTab) {
        closeMenu();
        navigate(button.dataset.mobileTab);
      } else if (button.dataset.mobileAction === 'close') closeMenu();
      else if (button.dataset.mobileAction === 'logout') { closeMenu(); logout(); }
    });
    matchMedia('(max-width: 1024px)').addEventListener('change', event => { if (!event.matches) closeMenu(); });
    document.body.classList.add('has-mobile-navigation');
    sync();
  }

  return { init, closeMenu };
})();
