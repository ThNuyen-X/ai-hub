(() => {
  'use strict';
  const INBOX = 'D:\\ai-hub\\ai-hub-data\\zalo-inbox';
  let busy = false, items = [], ownerSession = null, selected = new Set(), activeTab = 'mydocs';
  let inboxDir = INBOX, inboxParent = '', inboxDrives = [], inboxItems = [], inboxReq = 0;
  const modal = document.createElement('div');
  modal.id = 'zaloSourceModal';
  modal.className = 'hidden fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-md';
  modal.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Zalo My Documents" class="w-full max-w-2xl rounded-2xl border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden modal-enter" style="background:var(--spotlight-bg);border-color:var(--border);color:var(--text-main);box-shadow:var(--shadow-popover)">
    <div class="px-3.5 sm:px-5 py-3 sm:py-4 border-b flex items-center justify-between shrink-0" style="border-color:var(--border-subtle)">
      <div class="flex items-center space-x-2.5 min-w-0">
        <svg class="w-5 h-5 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M9 8h6l-6 7h6"/></svg>
        <div class="min-w-0"><h2 class="text-sm font-bold truncate">Zalo · My Documents</h2><p class="text-[11px] truncate" style="color:var(--text-sub)">Chọn trực tiếp trên web hoặc điện thoại · Không dùng Windows Explorer</p></div>
      </div>
      <button type="button" data-action="close" aria-label="Close" class="w-9 h-9 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-hover)] text-zinc-400 hover:text-white text-base">&#10005;</button>
    </div>
    <div class="px-3.5 sm:px-5 pt-2.5 pb-1 border-b shrink-0 overflow-x-auto scrollbar-none" style="border-color:var(--border-subtle)">
      <div class="inline-flex p-1 rounded-xl gap-1.5 border min-w-fit" style="background:var(--bg-surface);border-color:var(--border-subtle)">
        <button type="button" data-action="mydocs" data-tab="mydocs" class="px-3 py-1.5 rounded-lg text-xs border">Tổng hợp</button>
        <button type="button" data-action="files" data-tab="files" class="px-3 py-1.5 rounded-lg text-xs border">Tài liệu</button>
        <button type="button" data-action="media" data-tab="media" class="px-3 py-1.5 rounded-lg text-xs border">Ảnh / Video</button>
        <button type="button" data-action="links" data-tab="links" class="px-3 py-1.5 rounded-lg text-xs border">Link</button>
        <button type="button" data-action="inbox" data-tab="inbox" class="px-3 py-1.5 rounded-lg text-xs border">Thư mục đã tải</button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-3">
      <div data-zalo-controls class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 flex-wrap">
          <button type="button" data-action="list" class="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--bg-hover)]" style="border-color:var(--border-subtle)">Làm mới</button>
          <button type="button" data-action="more" class="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-[var(--bg-hover)]" style="border-color:var(--border-subtle)">Tải thêm danh sách</button>
        </div>
        <span data-status class="text-xs font-mono truncate max-w-full" role="status" style="color:var(--text-sub)"></span>
      </div>
      <div data-inbox-controls hidden class="space-y-2.5">
        <div data-drives class="flex items-center gap-1.5 flex-wrap"></div>
        <div class="p-2.5 rounded-xl border flex items-center justify-between gap-2" style="background:var(--bg-surface);border-color:var(--border)">
          <div data-breadcrumbs class="flex items-center gap-1 text-xs font-mono overflow-x-auto scrollbar-none flex-1"></div>
          <button type="button" data-action="up" class="p-1 rounded hover:bg-[var(--bg-hover)] text-xs shrink-0" style="color:var(--text-sub)">⬆ Lên trên</button>
        </div>
      </div>
      <input data-search type="search" placeholder="Lọc nhanh tên file, ảnh, video hoặc link..." class="w-full px-3 py-1.5 rounded-lg text-xs border bg-transparent focus:outline-none" style="border-color:var(--border-subtle);color:var(--text-main)">
      <div data-items class="max-h-64 overflow-y-auto border rounded-xl p-1.5 space-y-1" style="border-color:var(--border-subtle);background:var(--bg-card)"></div>
      <div class="flex items-center justify-between gap-2 pt-1 flex-wrap">
        <div data-selected class="text-[11px] font-mono truncate max-w-sm" style="color:var(--text-sub)">Chưa chọn mục nào</div>
        <button type="button" data-action="attach" class="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm">Đưa vào ô chat (chưa tải)</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) run('close'); });
  const status = modal.querySelector('[data-status]'), list = modal.querySelector('[data-items]'), selectedCount = modal.querySelector('[data-selected]');
  const zaloControls = modal.querySelector('[data-zalo-controls]'), inboxControls = modal.querySelector('[data-inbox-controls]');
  const drives = modal.querySelector('[data-drives]'), breadcrumbs = modal.querySelector('[data-breadcrumbs]');
  const session = () => typeof currentSessionId === 'undefined' ? null : currentSessionId;
  const draftKey = () => JSON.stringify([typeof currentWorkspace === 'undefined' ? '' : currentWorkspace, session() || (typeof currentDraftSessionKey === 'undefined' ? '' : currentDraftSessionKey)]);
  const attachments = new Map();
  const chips = document.createElement('div');
  chips.id = 'zaloAttachmentChips'; chips.className = 'flex flex-wrap gap-1.5 px-3 pt-2'; chips.hidden = true; chips.style.display = 'none';
  promptInput.before(chips);
  let renderedKey = '';
  function renderChips() {
    renderedKey = draftKey(); chips.replaceChildren();
    const pending = attachments.get(renderedKey) || [];
    chips.hidden = !pending.length; chips.style.display = pending.length ? 'flex' : 'none';
    for (const group of pending) {
      const chip = document.createElement('span'); chip.className = 'inline-flex items-center gap-2 max-w-full rounded-lg border px-2.5 py-1 text-xs';
      chip.style.cssText = 'border-color:var(--border);background:var(--bg-card);color:var(--text-main)';
      const label = document.createElement('span'); label.className = 'truncate max-w-[240px]';
      label.textContent = 'Zalo · ' + (group.items.length === 1 ? group.items[0].name : group.items.length + ' mục');
      chip.title = group.items.map(x => x.name).join('\n') + '\nChưa tải nội dung';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Bỏ lựa chọn Zalo');
      remove.onclick = () => { selected.clear(); render(); const next = (attachments.get(draftKey()) || []).filter(x => x.ref !== group.ref); if (next.length) attachments.set(draftKey(), next); else attachments.delete(draftKey()); renderChips(); };
      chip.append(label, remove); chips.appendChild(chip);
    }
  }
  window.zaloComposer = {
    snapshot() { return (attachments.get(draftKey()) || []).slice(); },
    context(groups) { return groups.map(x => x.reference).join('\n'); },
    consume(groups) { const refs = new Set(groups.map(x => x.ref)); const key = draftKey(); const rest = (attachments.get(key) || []).filter(x => !refs.has(x.ref)); if (rest.length) attachments.set(key, rest); else attachments.delete(key); renderChips(); }
  };
  const chipObserver = new MutationObserver(() => { if (renderedKey !== draftKey()) renderChips(); });
  chipObserver.observe(document.getElementById('chatFeed') || document.body, { childList: true });
  window.addEventListener('pagehide', () => chipObserver.disconnect(), { once: true });
  async function api(action, id) {
    const res = await fetch('/api/zalo-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }), signal: AbortSignal.timeout(20000) });
    const data = await res.json(); if (!res.ok || data.error) throw new Error(data.error || 'Zalo request failed'); return data;
  }
  async function loadInbox(dir = INBOX) {
    const req = ++inboxReq;
    const res = await fetch('/api/fs-files?dir=' + encodeURIComponent(dir), { signal: AbortSignal.timeout(15000) });
    const data = await res.json(); if (req !== inboxReq) return;
    if (!res.ok || data.error) throw new Error(data.error || 'Không nạp được thư mục');
    inboxDir = data.current || dir; inboxParent = data.parent || ''; inboxDrives = data.drives || []; inboxItems = data.items || [];
    render();
  }
  const badgeText = { file: 'FILE', image: 'ẢNH', video: 'VIDEO', link: 'LINK', folder: 'THƯ MỤC' };
  function renderInboxNav() {
    drives.replaceChildren(); breadcrumbs.replaceChildren();
    for (const raw of [{ label: 'Zalo Inbox', path: INBOX }, ...inboxDrives.map(d => ({ label: typeof d === 'string' ? d : d.name || d.path, path: typeof d === 'string' ? d : d.path }))]) {
      const b = document.createElement('button'); b.type = 'button';
      const active = inboxDir.toLowerCase().startsWith(String(raw.path).toLowerCase());
      b.className = 'px-3 py-1.5 rounded-lg border text-xs font-bold ' + (active ? 'bg-blue-600 text-white border-blue-500' : '');
      if (!active) b.style.cssText = 'border-color:var(--border-subtle);color:var(--text-sub)';
      b.textContent = raw.label; b.onclick = () => loadInbox(raw.path).catch(e => { status.textContent = e.message; }); drives.appendChild(b);
    }
    let accum = '';
    for (const [i, p] of (inboxDir || '').split(/[\\/]/).filter(Boolean).entries()) {
      accum = i === 0 && inboxDir.includes(':') ? p + '\\' : accum + (accum.endsWith('\\') ? '' : '\\') + p;
      const full = accum, b = document.createElement('button'); b.type = 'button'; b.className = 'px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] shrink-0';
      b.textContent = p; b.onclick = () => loadInbox(full).catch(e => { status.textContent = e.message; }); breadcrumbs.appendChild(b);
    }
  }
  function render() {
    const isInbox = activeTab === 'inbox';
    zaloControls.hidden = isInbox; inboxControls.hidden = !isInbox;
    modal.querySelector('[data-action="attach"]').hidden = isInbox;
    modal.querySelectorAll('[data-tab]').forEach(b => {
      const on = b.dataset.tab === activeTab;
      b.style.cssText = on ? 'background:var(--bg-card);color:var(--text-main);border-color:var(--border);box-shadow:var(--shadow-sm);font-weight:600' : 'background:transparent;color:var(--text-sub);border-color:transparent';
    });
    selectedCount.textContent = isInbox ? (inboxDir || INBOX) : (selected.size ? `Đã chọn ${selected.size} mục` : 'Chưa chọn mục nào');
    list.replaceChildren(); const q = modal.querySelector('[data-search]').value.toLowerCase();
    if (isInbox) {
      renderInboxNav();
      for (const item of inboxItems.filter(x => x.name.toLowerCase().includes(q))) {
        const row = document.createElement('div'); row.className = 'flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-[var(--bg-hover)] gap-2';
        const left = document.createElement('div'); left.className = 'flex items-center gap-2.5 min-w-0';
        const icon = document.createElement('span'); icon.textContent = item.isDirectory ? '📁' : '📄';
        const name = document.createElement('span'); name.className = 'font-medium truncate'; name.textContent = item.name;
        const action = document.createElement('button'); action.type = 'button'; action.className = 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-500/10 text-blue-400 shrink-0';
        action.textContent = item.isDirectory ? 'Mở ➜' : 'Chọn ngay ➜';
        row.onclick = () => item.isDirectory ? loadInbox(item.path).catch(e => { status.textContent = e.message; }) : (selectAttachFile(item.path, item.name), modal.classList.add('hidden'));
        left.append(icon, name); row.append(left, action); list.appendChild(row);
      }
    } else {
      for (const item of items.filter(x => (x.name + ' ' + (x.url || '')).toLowerCase().includes(q))) {
        const chosen = selected.has(item.id), row = document.createElement('div');
        row.className = 'flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-[var(--bg-hover)] gap-2.5 border';
        row.style.cssText = chosen ? 'border-color:rgba(59,130,246,.55);background:rgba(59,130,246,.12)' : 'border-color:transparent';
        if (item.kind !== 'folder') {
          const check = document.createElement('input'); check.type = 'checkbox'; check.checked = chosen; check.disabled = false;
          check.setAttribute('aria-label', item.name); check.onchange = () => { if (check.checked) selected.add(item.id); else selected.delete(item.id); render(); };
          row.onclick = e => { if (!e.target.closest('button,input')) { check.checked = !check.checked; check.onchange(); } };
          row.appendChild(check);
        }
        const badge = document.createElement('span'); badge.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 border';
        badge.style.cssText = 'border-color:var(--border-subtle);color:var(--text-sub)'; badge.textContent = badgeText[item.kind] || 'MỤC';
        const label = document.createElement('div'); label.className = 'flex-1 min-w-0';
        const title = document.createElement('div'); title.className = 'font-medium break-words'; title.textContent = item.name;
        const meta = document.createElement('div'); meta.className = 'text-[11px] truncate'; meta.style.color = 'var(--text-sub)';
        meta.textContent = [item.size, item.date, item.domain || item.url].filter(Boolean).join(' · ') || 'My Documents';
        label.append(title, meta); row.append(badge, label);
        if (item.kind === 'folder' || item.kind === 'link') {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-500/10 text-blue-400 shrink-0';
          b.textContent = item.kind === 'folder' ? 'Mở folder' : 'Mở link'; b.disabled = busy;
          b.onclick = () => run(item.kind === 'folder' ? 'folder' : 'open', item.id); row.appendChild(b);
        }
        list.appendChild(row);
      }
    }
    if (!list.children.length) {
      const empty = document.createElement('div'); empty.className = 'py-6 text-center text-xs italic'; empty.style.color = 'var(--text-sub)';
      empty.textContent = busy ? 'Đang lấy danh sách...' : 'Không có mục phù hợp ở đây.'; list.appendChild(empty);
    }
  }
  async function run(action, id) {
    if (busy) return;
    if (action === 'close') { modal.classList.add('hidden'); return; }
    if (action === 'up') { if (inboxParent) await loadInbox(inboxParent); return; }
    if (action === 'inbox') { activeTab = 'inbox'; render(); await loadInbox(inboxDir || INBOX).catch(e => { status.textContent = e.message; }); return; }
    if (['mydocs', 'files', 'media', 'links'].includes(action)) activeTab = action;
    busy = true; modal.querySelectorAll('button').forEach(b => { b.disabled = true; }); render(); status.textContent = action === 'attach' ? 'Đang gắn chip...' : 'Đang kết nối Zalo...';
    try {
      if (action === 'attach') {
        const chosen = items.filter(x => selected.has(x.id)); if (!chosen.length) throw new Error('Chọn ít nhất một mục.');
        const res = await fetch('/api/zalo-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'select', ids: chosen.map(x => x.id) }), signal: AbortSignal.timeout(20000) });
        const r = await res.json(); if (!res.ok || r.error) throw new Error(r.error);
        if (session() !== ownerSession) throw new Error('Phiên chat đã thay đổi. Mở lại trình chọn Zalo.');
        const reference = '\n[Zalo selection: ' + r.ref + ']\n' + chosen.map((x, i) => `${i}. ${x.kind}: ${x.name}${x.url ? ' | ' + x.url : ''}`).join('\n') + '\nChưa tải nội dung. Chỉ lấy file nếu cần cho yêu cầu của tôi. Metadata: ' + r.manifest + '\nDùng node D:/ai-hub/ai-hub-web/zalo-source.cjs describe ' + r.ref + ' để xem lựa chọn; dùng download/open ' + r.ref + ' INDEX khi cần. Nếu tham chiếu hết hạn, báo tôi chọn lại; không lấy nhầm file.\n';
        const key = draftKey(), pending = attachments.get(key) || [];
        pending.push({ ref: r.ref, items: chosen.map(x => ({ name: x.name, kind: x.kind })), reference });
        attachments.set(key, pending); selected.clear(); renderChips(); modal.classList.add('hidden'); promptInput.focus();
      } else {
        const r = await api(action, id);
        if (Array.isArray(r.items)) { items = r.items; selected.clear(); status.textContent = `${items.length} mục từ Zalo Web`; }
        else status.textContent = 'Đã mở link trong tab Chrome mới.';
      }
    } catch (e) { status.textContent = e.message; }
    finally { busy = false; modal.querySelectorAll('button').forEach(b => { b.disabled = false; }); render(); }
  }
  modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => run(b.dataset.action)));
  modal.querySelector('[data-search]').addEventListener('input', render);
  window.openZaloSource = () => { if (busy) return; ownerSession = session(); modal.classList.remove('hidden'); run('mydocs'); };
})();
