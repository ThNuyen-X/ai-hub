(() => {
  const tabs = document.createElement('nav');
  tabs.className = 'mobile-tabs';
  tabs.setAttribute('aria-label', 'Dieu huong chinh');
  const pages = [['home', 'Trang chủ'], ['schedule', 'Lịch & Báo'], ['system', 'Laptop'], ['hub', 'AI Hub'], ['prompt', 'Prompt']];
  for (const [id, label] of pages) {
    const link = document.createElement('a');
    link.href = '#' + id;
    link.textContent = label;
    link.onclick = e => { e.preventDefault(); switchView(id); syncTabs(); };
    tabs.appendChild(link);
  }
  document.body.appendChild(tabs);
  function syncTabs() {
    for (const link of tabs.children) {
      if (link.hash === (location.hash || '#home')) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  window.addEventListener('popstate', syncTabs);
  document.addEventListener('click', () => queueMicrotask(syncTabs));
  syncTabs();

})();
