(() => {
  const ICONS = {
    home: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    schedule: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    system: '<svg viewBox="0 0 24 24"><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
    hub: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>',
    prompt: '<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>'
  };

  const tabs = document.createElement('nav');
  tabs.className = 'mobile-tabs';
  tabs.setAttribute('aria-label', 'Điều hướng chính');

  const pages = [
    ['home', 'Tổng quan'],
    ['schedule', 'Hẹn giờ'],
    ['system', 'Laptop'],
    ['hub', 'AI Hub'],
    ['prompt', 'Prompt']
  ];

  const dotMap = new Map();

  for (const [id, label] of pages) {
    const link = document.createElement('a');
    link.href = '#' + id;
    link.dataset.tab = id;
    link.innerHTML = `<span class="tab-icon-wrap">${ICONS[id] || ''}<span class="tab-dot" aria-hidden="true"></span></span><span>${label}</span>`;
    dotMap.set(id, link.querySelector('.tab-dot'));
    link.onclick = e => {
      e.preventDefault();
      if (typeof switchView === 'function') switchView(id);
      syncTabs(id);
    };
    tabs.appendChild(link);
  }

  document.body.appendChild(tabs);

  function syncTabs(explicitView) {
    const activeHash = explicitView ? ('#' + explicitView) : (location.hash || '#home');
    for (const link of tabs.children) {
      if (link.hash === activeHash) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  window.addEventListener('popstate', () => syncTabs());
  window.addEventListener('botot:viewchange', e => syncTabs(e.detail && e.detail.view));
  window.addEventListener('botot:tabbadge', e => {
    const detail = e.detail || {};
    const dot = dotMap.get(detail.tab);
    if (!dot) return;
    dot.className = 'tab-dot' + (detail.active ? (' show ' + (detail.tone || 'online')) : '');
  });

  syncTabs();
})();
