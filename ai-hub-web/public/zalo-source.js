(() => {
  'use strict';
  const INBOX = 'D:\\ai-hub\\ai-hub-data\\zalo-inbox';
  const UPLOADS = 'D:\\ai-hub\\ai-hub-data\\uploads';
  let busy = false, items = [], ownerSession = null, selected = new Set();
  let mainMode = 'local'; // 'local' | 'upload' | 'zalo'
  let zaloTab = 'mydocs'; // 'mydocs' | 'files' | 'media' | 'links'
  let localDir = '', localParent = '', localDrives = [], localItems = [], localSelected = new Set(), localReq = 0;

  const modal = document.createElement('div');
  modal.id = 'zaloSourceModal';
  modal.className = 'hidden fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-md';
  modal.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Đính kèm tệp & Zalo" class="w-full max-w-2xl rounded-2xl border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden modal-enter" style="background:var(--spotlight-bg);border-color:var(--border);color:var(--text-main);box-shadow:var(--shadow-popover)">
    <div class="px-3.5 sm:px-5 py-3 sm:py-4 border-b flex items-center justify-between shrink-0" style="border-color:var(--border-subtle)">
      <div class="flex items-center space-x-2.5 min-w-0">
        <div class="w-8 h-8 rounded-xl border flex items-center justify-center text-blue-400 shrink-0" style="background:var(--bg-card);border-color:var(--border-subtle)">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </div>
        <div class="min-w-0">
          <h2 class="text-sm font-bold truncate">Đính kèm vào cuộc trò chuyện</h2>
          <p class="text-[11px] truncate" style="color:var(--text-sub)">Chọn file trên PC, tải từ điện thoại, lấy từ Zalo hoặc Ctrl+V trực tiếp vào ô chat</p>
        </div>
      </div>
      <button type="button" data-action="close" aria-label="Close" class="w-9 h-9 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-hover)] text-zinc-400 hover:text-white text-base">&#10005;</button>
    </div>

    <div class="px-3.5 sm:px-5 pt-2.5 pb-1.5 border-b shrink-0 overflow-x-auto scrollbar-none" style="border-color:var(--border-subtle)">
      <div class="inline-flex p-1 rounded-xl gap-1.5 border min-w-fit" style="background:var(--bg-surface);border-color:var(--border-subtle)">
        <button type="button" data-mode="local" class="px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1.5">
          <span>💻 File trên máy (PC)</span>
        </button>
        <button type="button" data-mode="upload" class="px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1.5">
          <span>📱 Tải từ thiết bị</span>
        </button>
        <button type="button" data-mode="zalo" class="px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1.5">
          <span>💬 Zalo My Documents</span>
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-3">
      <!-- ZALO SUBTABS & CONTROLS -->
      <div data-zalo-controls hidden class="space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="inline-flex p-1 rounded-xl gap-1 border flex-wrap" style="background:var(--bg-surface);border-color:var(--border-subtle)">
            <button type="button" data-action="mydocs" data-tab="mydocs" class="px-2.5 py-1 rounded-lg text-xs border">Tổng hợp</button>
            <button type="button" data-action="files" data-tab="files" class="px-2.5 py-1 rounded-lg text-xs border">Tài liệu</button>
            <button type="button" data-action="media" data-tab="media" class="px-2.5 py-1 rounded-lg text-xs border">Ảnh / Video</button>
            <button type="button" data-action="links" data-tab="links" class="px-2.5 py-1 rounded-lg text-xs border">Link</button>
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" data-action="list" class="px-2.5 py-1 rounded-lg border text-xs font-semibold hover:bg-[var(--bg-hover)]" style="border-color:var(--border-subtle)">Làm mới</button>
            <button type="button" data-action="more" class="px-2.5 py-1 rounded-lg border text-xs font-semibold hover:bg-[var(--bg-hover)]" style="border-color:var(--border-subtle)">Tải thêm</button>
          </div>
        </div>
      </div>

      <!-- LOCAL SERVER BROWSER CONTROLS -->
      <div data-local-controls class="space-y-2.5">
        <div data-drives class="flex items-center gap-1.5 flex-wrap"></div>
        <div class="p-2.5 rounded-xl border flex items-center justify-between gap-2" style="background:var(--bg-surface);border-color:var(--border)">
          <div data-breadcrumbs class="flex items-center gap-1 text-xs font-mono overflow-x-auto scrollbar-none flex-1"></div>
          <button type="button" data-action="up" class="p-1 rounded hover:bg-[var(--bg-hover)] text-xs shrink-0" style="color:var(--text-sub)">⬆ Lên trên</button>
        </div>
      </div>

      <!-- DEVICE UPLOAD PANEL -->
      <div data-upload-panel hidden class="space-y-3">
        <input data-file-input type="file" multiple class="hidden">
        <div data-dropzone class="rounded-2xl border-2 border-dashed p-6 text-center space-y-2.5 cursor-pointer transition-colors hover:bg-[var(--bg-hover)]" style="border-color:var(--border);background:var(--bg-card)">
          <div class="w-11 h-11 rounded-2xl mx-auto flex items-center justify-center text-blue-400 border" style="background:var(--bg-surface);border-color:var(--border-subtle)">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          </div>
          <div class="text-xs sm:text-sm font-semibold">Bấm để chọn ảnh / tệp từ Điện thoại hoặc Thiết bị đang dùng</div>
          <p class="text-[11px]" style="color:var(--text-sub)">Hỗ trợ chọn nhiều tệp, kéo-thả hoặc chụp ảnh trực tiếp trên điện thoại · Lưu vào D:\\ai-hub\\ai-hub-data\\uploads</p>
        </div>
      </div>

      <!-- SEARCH & STATUS BAR -->
      <div data-list-section class="space-y-2.5">
        <div class="flex items-center justify-between gap-2">
          <input data-search type="search" placeholder="Lọc nhanh tên tệp, thư mục, ảnh hoặc link..." class="flex-1 px-3 py-1.5 rounded-lg text-xs border bg-transparent focus:outline-none" style="border-color:var(--border-subtle);color:var(--text-main)">
          <span data-status class="text-[11px] font-mono truncate max-w-[230px]" role="status" style="color:var(--text-sub)"></span>
        </div>
        <div data-items class="max-h-64 overflow-y-auto border rounded-xl p-1.5 space-y-1" style="border-color:var(--border-subtle);background:var(--bg-card)"></div>
      </div>

      <div class="flex items-center justify-between gap-2 pt-1 flex-wrap">
        <div data-selected class="text-[11px] font-mono truncate max-w-sm" style="color:var(--text-sub)">Chưa chọn mục nào</div>
        <button type="button" data-action="attach" class="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm">Đưa vào ô chat</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) run('close'); });

  const status = modal.querySelector('[data-status]'), list = modal.querySelector('[data-items]'), selectedCount = modal.querySelector('[data-selected]');
  const zaloControls = modal.querySelector('[data-zalo-controls]'), localControls = modal.querySelector('[data-local-controls]');
  const uploadPanel = modal.querySelector('[data-upload-panel]'), listSection = modal.querySelector('[data-list-section]');
  const drives = modal.querySelector('[data-drives]'), breadcrumbs = modal.querySelector('[data-breadcrumbs]');
  const fileInput = modal.querySelector('[data-file-input]'), dropzone = modal.querySelector('[data-dropzone]');
  const attachBtn = modal.querySelector('[data-action="attach"]');

  const session = () => typeof currentSessionId === 'undefined' ? null : currentSessionId;
  const workspace = () => typeof currentWorkspace === 'undefined' ? '' : (currentWorkspace || '');
  const draftKey = () => JSON.stringify([workspace(), session() || (typeof currentDraftSessionKey === 'undefined' ? '' : currentDraftSessionKey)]);
  const attachments = new Map();

  const chips = document.createElement('div');
  chips.id = 'zaloAttachmentChips';
  chips.className = 'flex flex-wrap gap-1.5 px-3 pt-2';
  chips.hidden = true;
  chips.style.display = 'none';
  promptInput.before(chips);
  let renderedKey = '';

  function addChipGroup(group) {
    const key = draftKey();
    const pending = attachments.get(key) || [];
    pending.push(group);
    attachments.set(key, pending);
    renderChips();
  }

  function addLocalPathsChip(fileList, sourceLabel = 'File') {
    if (!Array.isArray(fileList) || !fileList.length) return;
    const ref = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const itemsList = fileList.map(f => ({
      name: f.name || String(f.path || '').split(/[\\/]/).pop(),
      path: f.path,
      kind: f.isDirectory ? 'folder' : 'file'
    }));
    const lines = itemsList.map(x => `- ${x.kind === 'folder' ? 'Thư mục' : 'Tệp'}: "${x.path}"`).join('\n');
    const reference = `\n[Đính kèm (${sourceLabel})]:\n${lines}\n`;
    addChipGroup({ ref, sourceLabel, items: itemsList, reference });
  }

  function renderChips() {
    renderedKey = draftKey();
    chips.replaceChildren();
    const pending = attachments.get(renderedKey) || [];
    chips.hidden = !pending.length;
    chips.style.display = pending.length ? 'flex' : 'none';
    for (const group of pending) {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-2 max-w-full rounded-lg border px-2.5 py-1 text-xs';
      chip.style.cssText = 'border-color:var(--border);background:var(--bg-card);color:var(--text-main)';
      const label = document.createElement('span');
      label.className = 'truncate max-w-[260px]';
      const prefix = group.sourceLabel || 'Zalo';
      label.textContent = prefix + ' · ' + (group.items.length === 1 ? group.items[0].name : group.items.length + ' mục');
      chip.title = group.items.map(x => x.path || x.name).join('\n');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Bỏ mục đính kèm');
      remove.onclick = () => {
        selected.clear();
        localSelected.clear();
        render();
        const next = (attachments.get(draftKey()) || []).filter(x => x.ref !== group.ref);
        if (next.length) attachments.set(draftKey(), next);
        else attachments.delete(draftKey());
        renderChips();
      };
      chip.append(label, remove);
      chips.appendChild(chip);
    }
  }

  window.zaloComposer = {
    snapshot() { return (attachments.get(draftKey()) || []).slice(); },
    context(groups) { return groups.map(x => x.reference).join('\n'); },
    consume(groups) {
      const refs = new Set(groups.map(x => x.ref));
      const key = draftKey();
      const rest = (attachments.get(key) || []).filter(x => !refs.has(x.ref));
      if (rest.length) attachments.set(key, rest);
      else attachments.delete(key);
      renderChips();
    },
    addPaths(paths, label = 'File') { addLocalPathsChip(paths, label); }
  };

  const chipObserver = new MutationObserver(() => { if (renderedKey !== draftKey()) renderChips(); });
  chipObserver.observe(document.getElementById('chatFeed') || document.body, { childList: true });
  window.addEventListener('pagehide', () => chipObserver.disconnect(), { once: true });

  async function api(action, id) {
    const res = await fetch('/api/zalo-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }), signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Zalo request failed');
    return data;
  }

  async function uploadBrowserFiles(fileObjects, sourceLabel = 'Tải lên') {
    const listFiles = Array.from(fileObjects || []).filter(Boolean);
    if (!listFiles.length) return [];
    const uploaded = [];
    for (const f of listFiles) {
      const res = await fetch('/api/attach-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || 'clipboard.png') },
        body: f,
        signal: AbortSignal.timeout(30000)
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Tải tệp lên thất bại');
      uploaded.push({ path: data.file.path, name: data.file.name, isDirectory: false });
    }
    if (uploaded.length) addLocalPathsChip(uploaded, sourceLabel);
    return uploaded;
  }

  async function loadLocal(dir) {
    const target = dir !== undefined ? dir : (localDir || workspace() || INBOX);
    const req = ++localReq;
    status.textContent = 'Đang nạp thư mục...';
    const res = await fetch('/api/fs-files?dir=' + encodeURIComponent(target), { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (req !== localReq) return;
    if (!res.ok || data.error) throw new Error(data.error || 'Không nạp được thư mục');
    localDir = data.current || target;
    localParent = data.parent || '';
    localDrives = data.drives || [];
    localItems = data.items || [];
    status.textContent = `${localItems.length} mục`;
    render();
  }

  const badgeText = { file: 'FILE', image: 'ẢNH', video: 'VIDEO', link: 'LINK', folder: 'THƯ MỤC' };

  function renderLocalNav() {
    drives.replaceChildren();
    breadcrumbs.replaceChildren();
    const shortcuts = [];
    if (workspace()) shortcuts.push({ label: 'Workspace', path: workspace() });
    shortcuts.push({ label: 'Zalo Inbox', path: INBOX });
    shortcuts.push({ label: 'Uploads', path: UPLOADS });
    for (const d of localDrives) shortcuts.push({ label: typeof d === 'string' ? d : d.name || d.path, path: typeof d === 'string' ? d : d.path });

    for (const raw of shortcuts) {
      const b = document.createElement('button');
      b.type = 'button';
      const active = (localDir || '').toLowerCase() === String(raw.path).toLowerCase();
      b.className = 'px-3 py-1.5 rounded-lg border text-xs font-bold ' + (active ? 'bg-blue-600 text-white border-blue-500' : '');
      if (!active) b.style.cssText = 'border-color:var(--border-subtle);color:var(--text-sub)';
      b.textContent = raw.label;
      b.onclick = () => loadLocal(raw.path).catch(e => { status.textContent = e.message; });
      drives.appendChild(b);
    }
    let accum = '';
    for (const [i, p] of (localDir || '').split(/[\\/]/).filter(Boolean).entries()) {
      accum = i === 0 && localDir.includes(':') ? p + '\\' : accum + (accum.endsWith('\\') ? '' : '\\') + p;
      const full = accum, b = document.createElement('button');
      b.type = 'button';
      b.className = 'px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] shrink-0';
      b.textContent = p;
      b.onclick = () => loadLocal(full).catch(e => { status.textContent = e.message; });
      breadcrumbs.appendChild(b);
    }
  }

  function render() {
    modal.querySelectorAll('[data-mode]').forEach(b => {
      const on = b.dataset.mode === mainMode;
      b.style.cssText = on ? 'background:var(--bg-card);color:var(--text-main);border-color:var(--border);box-shadow:var(--shadow-sm);font-weight:600' : 'background:transparent;color:var(--text-sub);border-color:transparent';
    });
    modal.querySelectorAll('[data-tab]').forEach(b => {
      const on = b.dataset.tab === zaloTab;
      b.style.cssText = on ? 'background:var(--bg-card);color:var(--text-main);border-color:var(--border);font-weight:600' : 'background:transparent;color:var(--text-sub);border-color:transparent';
    });

    localControls.hidden = mainMode !== 'local';
    zaloControls.hidden = mainMode !== 'zalo';
    uploadPanel.hidden = mainMode !== 'upload';
    listSection.hidden = mainMode === 'upload';
    attachBtn.hidden = mainMode === 'upload';

    if (mainMode === 'upload') {
      selectedCount.textContent = 'Chọn tệp từ điện thoại hoặc kéo-thả vào khung trên';
      return;
    }

    list.replaceChildren();
    const q = modal.querySelector('[data-search]').value.toLowerCase();

    if (mainMode === 'local') {
      renderLocalNav();
      selectedCount.textContent = localSelected.size ? `Đã chọn ${localSelected.size} mục trên PC` : (localDir || 'Chọn tệp hoặc thư mục');
      attachBtn.textContent = 'Gắn chip vào ô chat';
      for (const item of localItems.filter(x => x.name.toLowerCase().includes(q))) {
        const chosen = localSelected.has(item.path);
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-[var(--bg-hover)] gap-2.5 border';
        row.style.cssText = chosen ? 'border-color:rgba(59,130,246,.55);background:rgba(59,130,246,.12)' : 'border-color:transparent';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = chosen;
        check.disabled = false;
        check.setAttribute('aria-label', item.name);
        check.onchange = () => {
          if (check.checked) localSelected.set ? null : localSelected.add(item.path);
          else localSelected.delete(item.path);
          render();
        };

        const left = document.createElement('div');
        left.className = 'flex items-center gap-2 min-w-0 flex-1';
        const icon = document.createElement('span');
        icon.textContent = item.isDirectory ? '📁' : '📄';
        const name = document.createElement('span');
        name.className = 'font-medium truncate';
        name.textContent = item.name;
        left.append(icon, name);

        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-500/10 text-blue-400 shrink-0';
        action.textContent = item.isDirectory ? 'Mở ➜' : 'Chọn ngay ➜';
        action.onclick = e => {
          e.stopPropagation();
          if (item.isDirectory) loadLocal(item.path).catch(err => { status.textContent = err.message; });
          else {
            addLocalPathsChip([item], 'File PC');
            modal.classList.add('hidden');
            promptInput.focus();
          }
        };

        row.onclick = e => {
          if (e.target.closest('button,input')) return;
          if (item.isDirectory) loadLocal(item.path).catch(err => { status.textContent = err.message; });
          else { check.checked = !check.checked; check.onchange(); }
        };
        row.append(check, left, action);
        list.appendChild(row);
      }
    } else if (mainMode === 'zalo') {
      selectedCount.textContent = selected.size ? `Đã chọn ${selected.size} mục Zalo` : 'Chưa chọn mục nào';
      attachBtn.textContent = 'Đưa vào ô chat (chưa tải)';
      for (const item of items.filter(x => (x.name + ' ' + (x.url || '')).toLowerCase().includes(q))) {
        const chosen = selected.has(item.id), row = document.createElement('div');
        row.className = 'flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer hover:bg-[var(--bg-hover)] gap-2.5 border';
        row.style.cssText = chosen ? 'border-color:rgba(59,130,246,.55);background:rgba(59,130,246,.12)' : 'border-color:transparent';
        if (item.kind !== 'folder') {
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.checked = chosen;
          check.disabled = false;
          check.setAttribute('aria-label', item.name);
          check.onchange = () => { if (check.checked) selected.add(item.id); else selected.delete(item.id); render(); };
          row.onclick = e => { if (!e.target.closest('button,input')) { check.checked = !check.checked; check.onchange(); } };
          row.appendChild(check);
        }
        const badge = document.createElement('span');
        badge.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 border';
        badge.style.cssText = 'border-color:var(--border-subtle);color:var(--text-sub)';
        badge.textContent = badgeText[item.kind] || 'MỤC';
        const label = document.createElement('div');
        label.className = 'flex-1 min-w-0';
        const title = document.createElement('div');
        title.className = 'font-medium break-words';
        title.textContent = item.name;
        const meta = document.createElement('div');
        meta.className = 'text-[11px] truncate';
        meta.style.color = 'var(--text-sub)';
        meta.textContent = [item.size, item.date, item.domain || item.url].filter(Boolean).join(' · ') || 'My Documents';
        label.append(title, meta);
        row.append(badge, label);
        if (item.kind === 'folder' || item.kind === 'link') {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-500/10 text-blue-400 shrink-0';
          b.textContent = item.kind === 'folder' ? 'Mở folder' : 'Mở link';
          b.disabled = busy;
          b.onclick = () => run(item.kind === 'folder' ? 'folder' : 'open', item.id);
          row.appendChild(b);
        }
        list.appendChild(row);
      }
    }

    if (!list.children.length) {
      const empty = document.createElement('div');
      empty.className = 'py-6 text-center text-xs italic';
      empty.style.color = 'var(--text-sub)';
      empty.textContent = busy ? 'Đang lấy danh sách...' : 'Không có mục phù hợp ở đây.';
      list.appendChild(empty);
    }
  }

  async function run(action, id) {
    if (busy) return;
    if (action === 'close') { modal.classList.add('hidden'); return; }
    if (action === 'up') { if (localParent) await loadLocal(localParent).catch(e => { status.textContent = e.message; }); return; }

    if (action === 'attach' && mainMode === 'local') {
      const chosen = localItems.filter(x => localSelected.has(x.path));
      if (!chosen.length) { status.textContent = 'Chọn ít nhất một tệp hoặc thư mục.'; return; }
      addLocalPathsChip(chosen, 'File PC');
      localSelected.clear();
      render();
      modal.classList.add('hidden');
      promptInput.focus();
      return;
    }

    if (['mydocs', 'files', 'media', 'links'].includes(action)) zaloTab = action;
    busy = true;
    modal.querySelectorAll('button').forEach(b => { b.disabled = true; });
    render();
    status.textContent = action === 'attach' ? 'Đang gắn chip...' : 'Đang kết nối Zalo...';
    try {
      if (action === 'attach') {
        const chosen = items.filter(x => selected.has(x.id));
        if (!chosen.length) throw new Error('Chọn ít nhất một mục.');
        const res = await fetch('/api/zalo-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'select', ids: chosen.map(x => x.id) }), signal: AbortSignal.timeout(20000) });
        const r = await res.json();
        if (!res.ok || r.error) throw new Error(r.error);
        if (session() !== ownerSession) throw new Error('Phiên chat đã thay đổi. Mở lại trình chọn.');
        const reference = '\n[Zalo selection: ' + r.ref + ']\n' + chosen.map((x, i) => `${i}. ${x.kind}: ${x.name}${x.url ? ' | ' + x.url : ''}`).join('\n') + '\nChưa tải nội dung. Chỉ lấy file nếu cần cho yêu cầu của tôi. Metadata: ' + r.manifest + '\nDùng node D:/ai-hub/ai-hub-web/zalo-source.cjs describe ' + r.ref + ' để xem lựa chọn; dùng download/open ' + r.ref + ' INDEX khi cần. Nếu tham chiếu hết hạn, báo tôi chọn lại; không lấy nhầm file.\n';
        addChipGroup({ ref: r.ref, sourceLabel: 'Zalo', items: chosen.map(x => ({ name: x.name, kind: x.kind })), reference });
        selected.clear();
        modal.classList.add('hidden');
        promptInput.focus();
      } else {
        const r = await api(action, id);
        if (Array.isArray(r.items)) { items = r.items; selected.clear(); status.textContent = `${items.length} mục từ Zalo Web`; }
        else status.textContent = 'Đã mở link trong tab Chrome mới.';
      }
    } catch (e) { status.textContent = e.message; }
    finally { busy = false; modal.querySelectorAll('button').forEach(b => { b.disabled = false; }); render(); }
  }

  modal.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    if (busy) return;
    mainMode = b.dataset.mode;
    render();
    if (mainMode === 'local') loadLocal(localDir || workspace() || INBOX).catch(e => { status.textContent = e.message; });
    else if (mainMode === 'zalo' && !items.length) run('mydocs');
  }));

  modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => run(b.dataset.action)));
  modal.querySelector('[data-search]').addEventListener('input', render);

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); });
  dropzone.addEventListener('drop', async e => {
    e.preventDefault();
    try {
      const up = await uploadBrowserFiles(e.dataTransfer?.files, 'Tải lên');
      if (up.length) { modal.classList.add('hidden'); promptInput.focus(); }
    } catch (err) { status.textContent = err.message; }
  });
  fileInput.addEventListener('change', async () => {
    try {
      const up = await uploadBrowserFiles(fileInput.files, 'Điện thoại');
      fileInput.value = '';
      if (up.length) { modal.classList.add('hidden'); promptInput.focus(); }
    } catch (err) { status.textContent = err.message; }
  });

  // CTRL+V PASTE HANDLER ON PROMPT INPUT:
  // 1) If plain text is being pasted -> let browser paste text normally.
  // 2) If files/images or empty text paste -> check Windows Explorer FileDropList first (zero-copy original paths),
  //    otherwise upload clipboard image/file to D:\ai-hub\ai-hub-data\uploads and attach as chip.
  promptInput.addEventListener('paste', async e => {
    const cd = e.clipboardData;
    const text = cd ? cd.getData('text/plain') : '';
    const browserFiles = cd && cd.files ? Array.from(cd.files) : [];
    if (text && !browserFiles.length) return;
    e.preventDefault();
    try {
      const res = await fetch('/api/clipboard-files', { method: 'POST', signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      if (res.ok && Array.isArray(data.files) && data.files.length > 0) {
        addLocalPathsChip(data.files, 'Clipboard PC');
        if (typeof showToast === 'function') showToast(`Đã đính kèm ${data.files.length} mục từ Clipboard máy tính`, 'success', 2000);
        return;
      }
    } catch {}
    if (browserFiles.length > 0) {
      try {
        const up = await uploadBrowserFiles(browserFiles, 'Clipboard');
        if (up.length && typeof showToast === 'function') showToast(`Đã đính kèm ${up.length} tệp/ảnh từ Clipboard`, 'success', 2000);
      } catch (err) {
        if (typeof showToast === 'function') showToast('Lỗi dán tệp: ' + err.message, 'error');
      }
    }
  });

  window.openZaloSource = (initialMode) => {
    if (busy) return;
    ownerSession = session();
    if (initialMode && ['local', 'upload', 'zalo'].includes(initialMode)) mainMode = initialMode;
    modal.classList.remove('hidden');
    render();
    if (mainMode === 'local') loadLocal(localDir || workspace() || INBOX).catch(e => { status.textContent = e.message; });
    else if (mainMode === 'zalo') run('mydocs');
  };
})();
