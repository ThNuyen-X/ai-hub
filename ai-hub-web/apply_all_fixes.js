const fs = require('fs');
const path = require('path');

const bakPath = path.join(__dirname, 'public', 'index.html.bak');
const targetPath = path.join(__dirname, 'public', 'index.html');

let content = fs.readFileSync(bakPath, 'utf8');

console.log('[1/7] Read original clean template from index.html.bak (length:', content.length, ')');

// ========================================================
// 1. FIX SSE STREAM: Hỗ trợ text & complete event
// ========================================================
const oldSseBlock = `            if (data.type === 'stdout' && data.text) {
              appendAiText(aiContainer, data.text);
              appendTerminalLog('text', data.text);
            } else if (data.type === 'status') {`;

const newSseBlock = `            if ((data.type === 'stdout' || data.type === 'text') && (data.text !== undefined || data.value !== undefined)) {
              const textVal = (data.text !== undefined) ? data.text : data.value;
              if (textVal) {
                appendAiText(aiContainer, textVal);
                appendTerminalLog('text', textVal);
              }
            } else if (data.type === 'status') {`;

if (!content.includes(oldSseBlock)) {
  throw new Error('Không tìm thấy oldSseBlock');
}
content = content.replace(oldSseBlock, newSseBlock);

const oldFinishBlock = `} else if (data.type === 'done' || data.type === 'finish') {`;
const newFinishBlock = `} else if (data.type === 'done' || data.type === 'finish' || data.type === 'complete') {`;

if (!content.includes(oldFinishBlock)) {
  throw new Error('Không tìm thấy oldFinishBlock');
}
content = content.replace(oldFinishBlock, newFinishBlock);
console.log('[OK] Step 1: SSE stream handling fixed for text and complete.');

// ========================================================
// 2. FIX HEADER RESPONSIVE (Screenshot_2.png)
// ========================================================
// Responsive padding cho header
content = content.replace(
  '<header class="h-14 px-3 sm:px-5 flex items-center justify-between border-b shrink-0 z-20 backdrop-blur-md"',
  '<header class="h-14 px-2 sm:px-5 flex items-center justify-between border-b shrink-0 z-20 backdrop-blur-md"'
);

// Sidebar toggle button: p-1.5 sm:p-2
content = content.replace(
  `id="sidebarToggleBtn"\n                class="p-2 rounded-lg border ease-spring hover:bg-[var(--bg-hover)] active:scale-95 shrink-0 shadow-2xs transition-colors"`,
  `id="sidebarToggleBtn"\n                class="p-1.5 sm:p-2 rounded-lg border ease-spring hover:bg-[var(--bg-hover)] active:scale-95 shrink-0 shadow-2xs transition-colors"`
);

// Workspace Badge: max-w thu gọn trên mobile hẹp
content = content.replace(
  `max-w-[95px] sm:max-w-[170px] md:max-w-[220px] shadow-2xs group`,
  `max-w-[75px] xs:max-w-[105px] sm:max-w-[170px] md:max-w-[220px] shadow-2xs group`
);

// btnHeaderFullConv: tinh chỉnh nút xem toàn bộ chat trên header
const oldHeaderFullConvBtn = `<button onclick="openFullConversationModal()" 
                id="btnHeaderFullConv"
                class="flex items-center space-x-1 px-2 py-1.5 rounded-lg border text-xs ease-spring hover:bg-[var(--bg-hover)] shadow-2xs"
                style="background: var(--bg-card); border-color: var(--border); color: var(--text-sub);"
                title="Mở popup xem toàn bộ lịch sử đoạn chat">
          <svg class="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <span class="hidden md:inline text-[11px] font-medium">Toàn bộ chat</span>
        </button>`;

const newHeaderFullConvBtn = `<button onclick="openFullConversationModal()" 
                id="btnHeaderFullConv"
                class="flex items-center space-x-1 p-1.5 sm:px-2 sm:py-1.5 rounded-lg border text-xs ease-spring hover:bg-[var(--bg-hover)] shadow-2xs"
                style="background: var(--bg-card); border-color: var(--border); color: var(--text-sub);"
                title="Mở popup xem toàn bộ lịch sử đoạn chat">
          <svg class="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <span class="hidden sm:inline text-[11px] font-medium">Toàn bộ chat</span>
        </button>`;

content = content.replace(oldHeaderFullConvBtn, newHeaderFullConvBtn);

// btnToggleTerminal responsive
content = content.replace(
  `id="btnToggleTerminal"\n                class="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono ease-spring hover:bg-[var(--bg-hover)] shadow-2xs"`,
  `id="btnToggleTerminal"\n                class="flex items-center space-x-1 sm:space-x-1.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border text-xs font-mono ease-spring hover:bg-[var(--bg-hover)] shadow-2xs"`
);

// modelDropdownBtn & currentModelName responsive
content = content.replace(
  `id="modelDropdownBtn" onclick="toggleModelDropdown()"\n                  class="flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-medium ease-spring hover:bg-[var(--bg-hover)] shadow-2xs"`,
  `id="modelDropdownBtn" onclick="toggleModelDropdown()"\n                  class="flex items-center space-x-1 sm:space-x-1.5 px-2 sm:px-3 py-1.5 rounded-lg border text-xs font-medium ease-spring hover:bg-[var(--bg-hover)] shadow-2xs"`
);
content = content.replace(
  `id="currentModelName" class="font-semibold text-xs truncate max-w-[110px] sm:max-w-[140px]"`,
  `id="currentModelName" class="font-semibold text-xs truncate max-w-[65px] xs:max-w-[100px] sm:max-w-[140px]"`
);

console.log('[OK] Step 2: Header responsive classes applied.');

// ========================================================
// 3. FIX COMPOSER DOCK RESPONSIVE (Screenshot_1.png)
// ========================================================
// Mode switcher container
content = content.replace(
  `<div class="px-3.5 pt-2 pb-1.5 flex items-center justify-between border-b text-[11px] select-none"`,
  `<div class="px-2.5 sm:px-3.5 pt-1.5 pb-1 flex items-center justify-between border-b text-[11px] select-none overflow-x-auto scrollbar-none"`
);
content = content.replace(
  `<span class="text-[10px] font-medium" style="color: var(--text-sub);">Chế độ:</span>`,
  `<span class="text-[9.5px] font-medium hidden xs:inline" style="color: var(--text-sub);">Chế độ:</span>`
);

// Textarea padding responsive
content = content.replace(
  `class="w-full text-xs md:text-sm px-4 pt-3.5 pb-2 bg-transparent border-0 focus:outline-none resize-none leading-relaxed font-medium"`,
  `class="w-full text-xs md:text-sm px-3 sm:px-4 pt-2.5 sm:pt-3.5 pb-2 bg-transparent border-0 focus:outline-none resize-none leading-relaxed font-medium"`
);

// Bottom toolbar bên trong dock
const oldDockToolbar = `        <!-- Integrated Bottom Toolbar -->
        <div class="px-3.5 pb-2.5 pt-1.5 flex items-center justify-between border-t"
             style="border-color: var(--border-subtle);">
          
          <!-- Left: Status, Folder, Char Count & Attach File Button -->
          <div class="flex items-center space-x-2 text-[11px]">
            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[10px]"
                  style="background: var(--badge-bg); color: var(--badge-text);">
              <span id="sessionStatusDot" class="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-glow"></span>
              <span id="sessionStatus">Sẵn sàng</span>
            </span>
            
            <button onclick="openWorkspaceModal()" 
                    class="hover:underline flex items-center gap-1 font-mono text-[11px] truncate max-w-[150px] hidden sm:inline"
                    style="color: var(--text-sub);" title="Bấm để đổi Workspace">
              <span>📁</span>
              <span id="currentSessionFolderTag">sso</span>
            </button>

            <!-- Attach File Path helper button (Windows Explorer multi-file picker) -->
            <button id="btnAttachFile" type="button" onclick="attachFilesViaExplorer()" title="Chọn tệp bằng Windows Explorer (hỗ trợ chọn nhiều tệp)"
                    class="p-1 rounded hover:bg-[var(--bg-hover)] ease-spring text-[var(--text-sub)] hover:text-blue-400 flex items-center gap-1 active:scale-95">
              <svg id="attachFileIcon" class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
              <span id="attachFileLabel" class="text-[10px] hidden md:inline">Đính kèm file</span>
            </button>

            <span id="charCount" class="font-mono text-[10px] hidden sm:inline" style="color: var(--text-sub);">
              0 ký tự
            </span>
          </div>

          <!-- Right: Slash menu trigger & Action Buttons -->
          <div class="flex items-center space-x-2">
            <button onclick="toggleSlashMenu()" 
                    class="px-2 py-1 rounded-lg border text-xs font-mono font-semibold ease-spring hover:bg-[var(--bg-hover)] shadow-2xs"
                    style="border-color: var(--border-subtle); color: var(--text-sub);"
                    title="Menu lệnh gõ tắt (/)">
              /
            </button>

            <!-- Stop Task Button (Visible while running) -->
            <button id="stopBtn" 
                    class="hidden h-8 px-3.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white ease-spring flex items-center gap-1.5 shadow-lg shadow-rose-600/30 animate-pulse">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
              </svg>
              <span>Dừng (Esc)</span>
            </button>

            <!-- Live Word & Token Stats Counter -->
            <span id="inputStatsCounter" class="text-[10px] font-mono px-2 py-0.5 rounded select-none hidden sm:inline" 
                  style="color: var(--text-sub); background: var(--badge-bg);" 
                  title="Ước tính số từ và tokens trong prompt">0 từ · ~0 tokens</span>

            <!-- Send Button -->
            <button id="sendBtn" 
                    class="h-8 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 ease-spring hover:opacity-90 active:scale-95 shadow-sm"
                    style="background: var(--send-btn-bg); color: var(--send-btn-text);">
              <span>Gửi</span>
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>

        </div>`;

const newDockToolbar = `        <!-- Integrated Bottom Toolbar -->
        <div class="px-2 sm:px-3.5 pb-2 pt-1.5 flex items-center justify-between border-t gap-1 sm:gap-2 select-none"
             style="border-color: var(--border-subtle);">
          
          <!-- Left: Status, Folder, Char Count & Attach File Button -->
          <div class="flex items-center space-x-1 sm:space-x-1.5 text-[11px] shrink-0">
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px]"
                  style="background: var(--badge-bg); color: var(--badge-text);" title="Trạng thái phiên làm việc">
              <span id="sessionStatusDot" class="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-glow shrink-0"></span>
              <span id="sessionStatus" class="hidden sm:inline">Sẵn sàng</span>
            </span>
            
            <button onclick="openWorkspaceModal()" 
                    class="hover:underline flex items-center gap-1 font-mono text-[11px] truncate max-w-[110px] hidden sm:inline"
                    style="color: var(--text-sub);" title="Bấm để đổi Workspace">
              <span>📁</span>
              <span id="currentSessionFolderTag">sso</span>
            </button>

            <!-- Attach File Path helper button (Modal picker chỉ lấy path, không mở file) -->
            <button id="btnAttachFile" type="button" onclick="openAttachFileModal()" title="Đính kèm đường dẫn tệp vào prompt (chỉ lấy path, không mở file)"
                    class="h-7 w-7 sm:h-auto sm:w-auto p-1 sm:px-2 sm:py-1 rounded-lg hover:bg-[var(--bg-hover)] ease-spring text-[var(--text-sub)] hover:text-blue-400 flex items-center justify-center gap-1 active:scale-95 transition-all shrink-0">
              <svg id="attachFileIcon" class="w-3.5 h-3.5 shrink-0 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
              <span id="attachFileLabel" class="text-[10px] hidden md:inline">Đính kèm file</span>
            </button>

            <span id="charCount" class="font-mono text-[10px] hidden sm:inline" style="color: var(--text-sub);">
              0 ký tự
            </span>
          </div>

          <!-- Right: Slash menu trigger & Action Buttons -->
          <div class="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
            <button onclick="toggleSlashMenu()" 
                    class="h-7 w-7 flex items-center justify-center rounded-lg border text-xs font-mono font-semibold ease-spring hover:bg-[var(--bg-hover)] shadow-2xs shrink-0"
                    style="border-color: var(--border-subtle); color: var(--text-sub);"
                    title="Menu lệnh gõ tắt (/)">
              /
            </button>

            <!-- Stop Task Button (Visible while running) -->
            <button id="stopBtn" 
                    class="hidden h-7 sm:h-8 px-2.5 sm:px-3 rounded-lg sm:rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white ease-spring flex items-center gap-1 shadow-lg shadow-rose-600/30 animate-pulse shrink-0">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
              </svg>
              <span>Dừng</span>
            </button>

            <!-- Live Word & Token Stats Counter -->
            <span id="inputStatsCounter" class="text-[10px] font-mono px-2 py-0.5 rounded select-none hidden md:inline" 
                  style="color: var(--text-sub); background: var(--badge-bg);" 
                  title="Ước tính số từ và tokens trong prompt">0 từ • ~0 tokens</span>

            <!-- Send Button -->
            <button id="sendBtn" 
                    class="h-7 sm:h-8 px-2.5 sm:px-3.5 rounded-lg sm:rounded-xl text-xs font-semibold flex items-center gap-1 sm:gap-1.5 ease-spring hover:opacity-90 active:scale-95 shadow-sm shrink-0"
                    style="background: var(--send-btn-bg); color: var(--send-btn-text);">
              <span>Gửi</span>
              <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>

        </div>`;

if (!content.includes(oldDockToolbar)) {
  throw new Error('Không tìm thấy oldDockToolbar');
}
content = content.replace(oldDockToolbar, newDockToolbar);
console.log('[OK] Step 3: Composer dock responsive toolbar applied.');

// ========================================================
// 4. ATTACH FILE MODAL (CHỈ LẤY PATH) & FULL CONVERSATION MODAL
// ========================================================
const mStartPattern = '<!-- ========================================================\n       ATTACH FILE HELPER MODAL';
const mEndPattern = '<!-- ========================================================\n       MODAL: WORKSPACE SWITCHER';

const modalStartIdx = content.indexOf(mStartPattern);
const modalEndIdx = content.indexOf(mEndPattern);

if (modalStartIdx === -1 || modalEndIdx === -1 || modalStartIdx >= modalEndIdx) {
  throw new Error('Không tìm thấy vị trí ATTACH FILE HELPER MODAL');
}

const newModalsSection = `<!-- ========================================================
       ATTACH FILE HELPER MODAL (CHỈ LẤY PATH FILE, KHÔNG MỞ FILE)
       ======================================================== -->
  <div id="attachFileModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/65 backdrop-blur-md">
    <div class="w-full max-w-lg rounded-2xl border shadow-2xl flex flex-col max-h-[88vh] overflow-hidden modal-enter"
         style="background: var(--spotlight-bg); border-color: var(--border); box-shadow: var(--shadow-popover);">
      
      <!-- Header -->
      <div class="px-4 py-3 border-b flex items-center justify-between shrink-0" style="border-color: var(--border-subtle);">
        <div class="flex items-center space-x-2">
          <svg class="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          <div>
            <h3 class="text-xs font-bold text-[var(--text-main)]">Đính kèm đường dẫn File vào Prompt</h3>
            <p class="text-[10px] text-[var(--text-sub)]">Chỉ chèn đường dẫn (path) tệp vào khung chat, không mở hay đọc nội dung</p>
          </div>
        </div>
        <button onclick="closeAttachFileModal()" class="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-[var(--bg-hover)]">✕</button>
      </div>

      <!-- Action & Filter Bar -->
      <div class="p-3 border-b flex flex-col gap-2 shrink-0" style="border-color: var(--border-subtle); background: var(--bg-surface);">
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input id="attachFileSearchInput" type="text" placeholder="Tìm tệp trong thư mục..." oninput="filterAttachFiles(this.value)"
                   class="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border bg-transparent focus:outline-none"
                   style="border-color: var(--border); color: var(--text-main);">
          </div>
          <button onclick="attachFilesViaExplorer()" type="button" title="Mở hộp thoại Windows Explorer (Desktop)"
                  class="px-2.5 py-1.5 rounded-lg border text-xs font-medium ease-spring hover:bg-[var(--bg-hover)] text-blue-400 shrink-0 flex items-center gap-1"
                  style="border-color: var(--border-subtle);">
            <span>Explorer...</span>
          </button>
        </div>

        <!-- Breadcrumb / Current Dir -->
        <div class="flex items-center justify-between text-[11px] font-mono px-1 text-[var(--text-sub)]">
          <div id="attachFileBreadcrumbs" class="truncate flex items-center gap-1">...</div>
          <button id="btnAttachNavUp" onclick="navigateUpAttachFolder()" class="px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] text-blue-400 shrink-0" title="Lên thư mục cha">⬆ Lên</button>
        </div>
      </div>

      <!-- Files and Folders List -->
      <div id="attachFilesListContainer" class="flex-1 overflow-y-auto p-2 space-y-1 min-h-[160px] max-h-[300px]">
        <div class="p-4 text-center text-xs text-[var(--text-sub)] animate-pulse">Đang tải danh sách tệp...</div>
      </div>

      <!-- Manual Path Input & Footer -->
      <div class="p-3 border-t flex flex-col gap-2 shrink-0" style="border-color: var(--border-subtle); background: var(--bg-surface);">
        <div class="flex items-center gap-2">
          <input id="attachFilePathInput" type="text" placeholder="Hoặc dán/nhập đường dẫn tệp thủ công..."
                 class="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono border bg-transparent focus:outline-none"
                 style="border-color: var(--border); color: var(--text-main);"
                 onkeydown="if(event.key==='Enter') confirmAttachManualFile()">
          <button onclick="confirmAttachManualFile()" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white ease-spring shrink-0">
            Chèn Path
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- ========================================================
       MODAL: TOÀN BỘ ĐOẠN CHAT (FULL CONVERSATION POPUP)
       ======================================================== -->
  <div id="fullConversationModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/65 backdrop-blur-md">
    <div class="w-full max-w-3xl rounded-2xl border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden modal-enter"
         style="background: var(--spotlight-bg); border-color: var(--border); box-shadow: var(--shadow-popover);">
      
      <!-- Modal Header -->
      <div class="px-4 py-3 border-b flex items-center justify-between shrink-0" style="border-color: var(--border-subtle);">
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
          <div>
            <h3 class="text-xs font-bold text-[var(--text-main)]" id="fullConvModalTitle">Toàn bộ lịch sử đoạn chat</h3>
            <p class="text-[10.5px] text-[var(--text-sub)]" id="fullConvModalSubtitle">0 tin nhắn</p>
          </div>
        </div>

        <div class="flex items-center space-x-1.5">
          <button onclick="copyFullConversationText()" class="px-2.5 py-1.5 rounded-lg border text-xs font-medium ease-spring hover:bg-[var(--bg-hover)] text-[var(--text-main)] flex items-center gap-1 shadow-2xs"
                  style="border-color: var(--border); background: var(--bg-card);" title="Sao chép toàn bộ văn bản cuộc trò chuyện">
            <svg class="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            <span class="hidden sm:inline">Sao chép tất cả</span>
          </button>
          <button onclick="closeFullConversationModal()" class="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[var(--bg-hover)] ease-spring">✕</button>
        </div>
      </div>

      <!-- Quick Search Filter in Modal -->
      <div class="px-4 py-2 border-b shrink-0" style="border-color: var(--border-subtle); background: var(--bg-surface);">
        <div class="relative flex items-center">
          <svg class="w-3.5 h-3.5 absolute left-2.5 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input id="fullConvSearchInput" type="text" placeholder="Tìm kiếm nội dung trong cuộc trò chuyện..." oninput="filterFullConvModal(this.value)"
                 class="w-full pl-8 pr-3 py-1 rounded-lg text-xs border bg-transparent focus:outline-none"
                 style="border-color: var(--border-subtle); color: var(--text-main);">
        </div>
      </div>

      <!-- Messages Content Area -->
      <div id="fullConvMessagesContainer" class="flex-1 overflow-y-auto p-4 space-y-4 select-text">
        <!-- Rendered conversation -->
      </div>

    </div>
  </div>

  `;

content = content.slice(0, modalStartIdx) + newModalsSection + content.slice(modalEndIdx);
console.log('[OK] Step 4: Modals section updated.');

// ========================================================
// 5. ATTACH FILE JAVASCRIPT LOGIC (CHỈ LẤY PATH)
// ========================================================
const oldAttachJsStart = '    // ATTACH FILES VIA WINDOWS EXPLORER (MULTI-SELECT)';
const oldAttachJsEnd = '    // CUSTOM MARKED RENDERER';

const startIdx = content.indexOf(oldAttachJsStart);
const endIdx = content.indexOf(oldAttachJsEnd);

if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
  throw new Error('Không tìm thấy khối Attach JS cũ');
}

const newAttachJs = `// ATTACH FILES VIA WINDOWS EXPLORER (MULTI-SELECT)
    let isBrowsingFiles = false;

    async function attachFilesViaExplorer() {
      if (isBrowsingFiles) return;
      soundEffects.playClick();

      const btn = document.getElementById('btnAttachFile');
      const label = document.getElementById('attachFileLabel');
      const icon = document.getElementById('attachFileIcon');

      isBrowsingFiles = true;
      if (btn) btn.classList.add('opacity-70', 'pointer-events-none');
      if (label) label.innerText = 'Đang chọn...';
      if (icon) icon.classList.add('animate-spin');

      showToast('Đang mở hộp thoại Windows Explorer để chọn tệp...', 'info', 2000);

      try {
        const res = await fetch('/api/browse-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initialDir: currentWorkspace || '' })
        });
        const data = await res.json();

        if (data.ok && Array.isArray(data.files) && data.files.length > 0) {
          soundEffects.playSuccess();
          closeAttachFileModal();
          const formattedFiles = data.files.map(f => (f.includes(' ') ? \`"\${f}"\` : f));
          
          const currentVal = promptInput.value || '';
          let insertStr = '';

          if (!currentVal.trim()) {
            insertStr = formattedFiles.join('\\n') + '\\n';
            promptInput.value = insertStr;
          } else {
            const endsWithNewline = /\\n\\s*$/.test(currentVal);
            if (formattedFiles.length === 1) {
              const endsWithSpace = /\\s$/.test(currentVal);
              insertStr = (endsWithSpace ? '' : ' ') + formattedFiles[0] + ' ';
            } else {
              if (endsWithNewline) {
                insertStr = formattedFiles.join('\\n') + '\\n';
              } else {
                insertStr = '\\n' + formattedFiles.join('\\n') + '\\n';
              }
            }
            promptInput.value = currentVal + insertStr;
          }

          promptInput.focus();
          promptInput.selectionStart = promptInput.selectionEnd = promptInput.value.length;
          autoResizeTextarea();
          if (typeof updateInputStats === 'function') updateInputStats();
          
          if (data.files.length === 1) {
            showToast(\`Đã đính kèm tệp: \${data.files[0].split(/[\\\\/]/).pop()}\`, 'success');
          } else {
            showToast(\`Đã đính kèm \${data.files.length} tệp vào khung chat!\`, 'success');
          }
        } else if (data.message && !data.message.toLowerCase().includes('hủy') && !data.message.toLowerCase().includes('hu?')) {
          showToast(data.message, 'warning');
        }
      } catch (err) {
        console.error('Lỗi khi mở Explorer chọn file:', err);
        showToast('Không thể mở Explorer: ' + err.message, 'error');
      } finally {
        isBrowsingFiles = false;
        if (btn) btn.classList.remove('opacity-70', 'pointer-events-none');
        if (label) label.innerText = 'Đính kèm file';
        if (icon) icon.classList.remove('animate-spin');
      }
    }

    // ========================================================
    // MODAL: ATTACH FILE PATH PICKER (CHỈ LẤY PATH FILE)
    // ========================================================
    let attachFileCurrentDir = '';
    let attachFileAllItems = [];

    async function openAttachFileModal() {
      soundEffects.playClick();
      const modal = document.getElementById('attachFileModal');
      if (modal) modal.classList.remove('hidden');
      attachFileCurrentDir = currentWorkspace || '';
      await loadAttachFolder(attachFileCurrentDir);
      const searchInp = document.getElementById('attachFileSearchInput');
      if (searchInp) { searchInp.value = ''; searchInp.focus(); }
    }

    function closeAttachFileModal() {
      const modal = document.getElementById('attachFileModal');
      if (modal) modal.classList.add('hidden');
    }

    async function loadAttachFolder(dirPath) {
      const container = document.getElementById('attachFilesListContainer');
      const breadcrumbs = document.getElementById('attachFileBreadcrumbs');
      if (!container) return;
      container.innerHTML = '<div class="p-4 text-center text-xs text-[var(--text-sub)] animate-pulse">Đang tải danh sách tệp...</div>';

      try {
        const res = await fetch(\`/api/fs-files?dir=\${encodeURIComponent(dirPath || '')}\`);
        const data = await res.json();
        attachFileCurrentDir = data.current || dirPath;
        attachFileAllItems = data.items || [];

        if (breadcrumbs) {
          const parts = attachFileCurrentDir.split(/[\\\\/]/).filter(Boolean);
          const short = parts.slice(-3).join(' / ');
          breadcrumbs.innerText = short ? ('.../' + short) : attachFileCurrentDir;
          breadcrumbs.title = attachFileCurrentDir;
        }

        renderAttachFileList(attachFileAllItems);
      } catch (err) {
        container.innerHTML = \`<div class="p-4 text-center text-xs text-rose-400">Lỗi nạp thư mục: \${escapeHtml(err.message)}</div>\`;
      }
    }

    function renderAttachFileList(items) {
      const container = document.getElementById('attachFilesListContainer');
      if (!container) return;
      if (!items || items.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-xs text-zinc-500 italic">Thư mục trống hoặc không tìm thấy tệp phù hợp.</div>';
        return;
      }

      container.innerHTML = items.map(item => {
        if (item.isDirectory) {
          return \`
            <div onclick="loadAttachFolder('\${escapeJs(item.path)}')"
                 class="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ease-spring hover:bg-[var(--bg-hover)] transition-colors">
              <div class="flex items-center space-x-2 truncate min-w-0">
                <span class="text-amber-400 text-sm">📁</span>
                <span class="font-medium text-[var(--text-main)] truncate">\${escapeHtml(item.name)}</span>
              </div>
              <span class="text-[10px] text-[var(--text-sub)] shrink-0">Thư mục</span>
            </div>
          \`;
        } else {
          const sizeKb = item.size ? Math.ceil(item.size / 1024) + ' KB' : '';
          return \`
            <div onclick="selectAttachFile('\${escapeJs(item.path)}', '\${escapeJs(item.name)}')"
                 class="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ease-spring hover:bg-blue-500/10 hover:text-blue-400 transition-colors group"
                 title="Bấm để chèn đường dẫn vào khung chat (chỉ lấy path, không mở file)">
              <div class="flex items-center space-x-2 truncate min-w-0">
                <span class="text-blue-400 text-xs">📄</span>
                <span class="font-mono text-[11.5px] text-[var(--text-main)] group-hover:text-blue-400 truncate">\${escapeHtml(item.name)}</span>
              </div>
              <div class="flex items-center space-x-1.5 shrink-0">
                <span class="text-[10px] font-mono text-[var(--text-sub)]">\${sizeKb}</span>
                <span class="text-[10px] font-semibold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 ease-spring">Chèn Path</span>
              </div>
            </div>
          \`;
        }
      }).join('');
    }

    function filterAttachFiles(query) {
      query = (query || '').toLowerCase().trim();
      if (!query) {
        renderAttachFileList(attachFileAllItems);
        return;
      }
      const filtered = attachFileAllItems.filter(i => i.name.toLowerCase().includes(query));
      renderAttachFileList(filtered);
    }

    function navigateUpAttachFolder() {
      soundEffects.playClick();
      if (!attachFileCurrentDir) return;
      const parts = attachFileCurrentDir.split(/[\\\\/]/).filter(Boolean);
      if (parts.length <= 1) return;
      parts.pop();
      let parent = parts.join('\\\\');
      if (parent.length === 2 && parent.endsWith(':')) parent += '\\\\';
      loadAttachFolder(parent);
    }

    function selectAttachFile(fullPath, fileName) {
      soundEffects.playSuccess();
      closeAttachFileModal();

      let insertPath = fullPath;
      if (currentWorkspace && fullPath.toLowerCase().startsWith(currentWorkspace.toLowerCase())) {
        let rel = fullPath.slice(currentWorkspace.length);
        if (rel.startsWith('\\\\') || rel.startsWith('/')) rel = rel.slice(1);
        if (rel) insertPath = rel;
      }
      if (insertPath.includes(' ')) insertPath = \`"\${insertPath}"\`;

      const curVal = promptInput.value || '';
      if (!curVal.trim()) {
        promptInput.value = insertPath + ' ';
      } else {
        const endsWithSpace = /\\s$/.test(curVal);
        promptInput.value = curVal + (endsWithSpace ? '' : ' ') + insertPath + ' ';
      }

      promptInput.focus();
      promptInput.selectionStart = promptInput.selectionEnd = promptInput.value.length;
      autoResizeTextarea();
      if (typeof updateInputStats === 'function') updateInputStats();
      showToast(\`Đã đính kèm đường dẫn: \${fileName || insertPath}\`, 'success', 2000);
    }

    function confirmAttachManualFile() {
      const inp = document.getElementById('attachFilePathInput');
      const val = (inp ? inp.value : '').trim();
      if (!val) {
        showToast('Vui lòng nhập đường dẫn tệp', 'warning');
        return;
      }
      selectAttachFile(val, val.split(/[\\\\/]/).pop());
    }

    `;

content = content.slice(0, startIdx) + newAttachJs + content.slice(endIdx);
console.log('[OK] Step 5: Attach file JavaScript logic updated.');

// ESC modal support cho fullConversationModal
content = content.replace(
  `else if (!attachFileModal.classList.contains('hidden')) closeAttachFileModal();`,
  `else if (!attachFileModal.classList.contains('hidden')) closeAttachFileModal();
        else if (document.getElementById('fullConversationModal') && !document.getElementById('fullConversationModal').classList.contains('hidden')) closeFullConversationModal();`
);

// ========================================================
// 6. SESSION HISTORY PAGINATION, LAZY LOADING & FULL CONVERSATION POPUP
// ========================================================
const oldSelectSessionStart = '    async function selectSession(sessionId, sessionTitle, wsPath) {';
const oldSelectSessionEnd = '    // MESSAGE BUBBLE BUILDERS';

const sStartIdx = content.indexOf(oldSelectSessionStart);
const sEndIdx = content.indexOf(oldSelectSessionEnd);

if (sStartIdx === -1 || sEndIdx === -1 || sStartIdx >= sEndIdx) {
  throw new Error('Không tìm thấy khối selectSession cũ');
}

const newSelectSessionJs = `// ========================================================
    // SESSION HISTORY PAGINATION & LAZY LOADING
    // ========================================================
    let currentSessionHistoryItems = [];
    let currentHistoryRenderIndex = 0; // Vị trí tin nhắn bắt đầu render trong currentSessionHistoryItems
    const HISTORY_CHUNK_SIZE = 15; // Số lượng tin nhắn nạp mỗi lần

    function buildHistoryItemsFromConversation(conversation) {
      const items = [];
      const toolResponsesMap = new Map();

      // 1. Map tool responses
      (conversation || []).forEach(msg => {
        (msg.content || []).forEach(c => {
          if (c.type === 'toolResponse' && c.id) {
            let out = '';
            let isErr = false;
            if (c.toolResult) {
              isErr = !!c.toolResult.value?.isError;
              const trVal = c.toolResult.value;
              if (trVal) {
                if (typeof trVal.stdout === 'string' || typeof trVal.stderr === 'string') {
                  out = (trVal.stdout || '') + (trVal.stderr ? ('\\n[STDERR]: ' + trVal.stderr) : '');
                } else if (trVal.structuredContent?.stdout !== undefined) {
                  out = (trVal.structuredContent.stdout || '') + (trVal.structuredContent.stderr ? ('\\n[STDERR]: ' + trVal.structuredContent.stderr) : '');
                } else if (Array.isArray(trVal.content)) {
                  out = trVal.content.map(x => (typeof x === 'string' ? x : x.text || '')).join('\\n');
                } else if (typeof trVal === 'string') {
                  out = trVal;
                } else {
                  try { out = JSON.stringify(trVal, null, 2); } catch (_) { out = String(trVal); }
                }
              }
            } else if (c.output || c.text) {
              out = c.output || c.text || '';
            }
            toolResponsesMap.set(c.id, { output: out, isError: isErr });
          }
        });
      });

      // 2. Extract user and assistant message items
      (conversation || []).forEach(msg => {
        if (msg.role === 'user') {
          const userTexts = [];
          (msg.content || []).forEach(c => {
            if (c.type === 'toolResponse') return;
            if (typeof c === 'string') userTexts.push(c);
            else if (typeof c.text === 'string') userTexts.push(c.text);
            else if (c.text?.value) userTexts.push(c.text.value);
          });
          const fullPrompt = userTexts.join('\\n').trim();
          if (fullPrompt) {
            items.push({ role: 'user', text: fullPrompt });
          }
        } else if (msg.role === 'assistant') {
          items.push({ role: 'assistant', rawContent: msg.content || [], toolResponsesMap });
        }
      });

      return items;
    }

    function renderSingleHistoryItem(item, container, prepend = false) {
      if (item.role === 'user') {
        const row = document.createElement('div');
        row.className = 'w-full flex justify-end my-3 px-1 sm:px-2 group';
        const isCodeLike = item.text.includes('\\n') || item.text.startsWith('$') || item.text.includes('kubectl') || item.text.includes('curl ') || item.text.includes('SELECT ');
        const userSnippetId = 'user_' + Math.random().toString(36).substring(2, 9);
        window._codeSnippets[userSnippetId] = (item.text || '').trim();

        row.innerHTML = \`
          <div class="flex flex-col items-end max-w-[92%] sm:max-w-[80%] md:max-w-[72%] lg:max-w-[65%] space-y-1">
            <div class="flex items-center space-x-2 text-[11px] font-semibold select-none pr-1" style="color: var(--text-sub);">
              <button onclick="editUserPrompt('\${userSnippetId}')" 
                      class="opacity-75 sm:opacity-0 sm:group-hover:opacity-100 ease-spring text-[10.5px] font-normal hover:text-[var(--text-main)] flex items-center gap-1 p-0.5"
                      title="Chỉnh sửa câu hỏi này để gửi lại">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                <span>Sửa</span>
              </button>
              <span>•</span>
              <button onclick="copySnippet('\${userSnippetId}', this)" 
                      class="opacity-75 sm:opacity-0 sm:group-hover:opacity-100 ease-spring text-[10.5px] font-normal hover:text-[var(--text-main)] flex items-center gap-1 p-0.5"
                      title="Sao chép nội dung câu hỏi">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                <span>Chép</span>
              </button>
              <span>•</span>
              <span>Bạn</span>
            </div>
            <div class="user-bubble text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap \${isCodeLike ? 'font-mono text-[11.5px]' : 'font-medium'}">\${escapeHtml((item.text || '').trim())}</div>
          </div>
        \`;
        if (prepend && container.firstChild) {
          container.insertBefore(row, container.firstChild);
        } else {
          container.appendChild(row);
        }
      } else if (item.role === 'assistant') {
        const aiContainer = createAiMessageContainer(currentSelectedModel, false);
        if (aiContainer.row && aiContainer.row.parentNode === chatFeed) {
          aiContainer.row.remove();
        }

        let hasText = false;
        let hasTools = false;

        (item.rawContent || []).forEach(c => {
          if (c.type === 'thinking' || c.thinking) {
            const thoughtText = typeof c.thinking === 'string' ? c.thinking : (c.thinking?.value || '');
            if (thoughtText.trim()) appendAiText(aiContainer, \`<think>\\n\${thoughtText}\\n</think>\\n\`);
          } else if (c.type === 'toolRequest') {
            hasTools = true;
            const toolName = c.toolCall?.value?.name || c.name || 'tool';
            const toolArgs = c.toolCall?.value?.arguments || c.arguments || {};
            const resp = c.id && item.toolResponsesMap ? item.toolResponsesMap.get(c.id) : null;
            const toolOutput = resp ? resp.output : null;
            const isErr = resp ? resp.isError : false;
            appendToolCard(aiContainer, toolName, toolArgs, false, toolOutput, isErr);
          } else if (c.tool_use) {
            hasTools = true;
            const toolName = c.tool_use.name || 'tool';
            const toolArgs = c.tool_use.input || {};
            appendToolCard(aiContainer, toolName, toolArgs, false, c.tool_use.output || null);
          } else if (c.type === 'text' || c.text) {
            const txt = typeof c.text === 'string' ? c.text : (c.text?.value || '');
            if (txt.trim()) {
              appendAiText(aiContainer, txt);
              hasText = true;
            }
          }
        });

        if (!hasText) {
          if (hasTools) {
            appendToolDoneNotice(aiContainer);
          } else {
            appendAiText(aiContainer, '_Không có phản hồi văn bản._');
          }
        }

        if (prepend && container.firstChild) {
          container.insertBefore(aiContainer.row, container.firstChild);
        } else {
          container.appendChild(aiContainer.row);
        }
      }
    }

    function renderHistoryLazyBanner() {
      const existing = document.getElementById('historyLazyBanner');
      if (existing) existing.remove();
      if (currentHistoryRenderIndex <= 0) return;

      const banner = document.createElement('div');
      banner.id = 'historyLazyBanner';
      banner.className = 'py-2 px-3 mb-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs select-none sticky top-0 z-20 backdrop-blur-md transition-all shadow-xs';
      banner.style.background = 'var(--bg-card)';
      banner.style.borderColor = 'var(--border)';

      const remaining = currentHistoryRenderIndex;
      banner.innerHTML = \`
        <div class="flex items-center space-x-1.5 text-[var(--text-sub)]">
          <svg class="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span class="text-[11px]">Còn <b>\${remaining}</b> tin nhắn cũ hơn</span>
        </div>
        <div class="flex items-center space-x-1.5">
          <button onclick="loadMoreSessionHistory()" class="px-2 py-1 rounded-md border text-[11px] font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-blue-400 ease-spring" style="border-color: var(--border-subtle);">
            ↑ Tải thêm
          </button>
          <button onclick="openFullConversationModal()" class="px-2 py-1 rounded-md border text-[11px] font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-main)] ease-spring" style="border-color: var(--border-subtle);">
            Xem popup
          </button>
        </div>
      \`;
      chatFeed.insertBefore(banner, chatFeed.firstChild);
    }

    function loadMoreSessionHistory() {
      if (currentHistoryRenderIndex <= 0) return;
      const prevScrollHeight = chatFeed.scrollHeight;
      const prevScrollTop = chatFeed.scrollTop;

      const nextStart = Math.max(0, currentHistoryRenderIndex - HISTORY_CHUNK_SIZE);
      const itemsToPrepend = currentSessionHistoryItems.slice(nextStart, currentHistoryRenderIndex);
      currentHistoryRenderIndex = nextStart;

      const frag = document.createDocumentFragment();
      itemsToPrepend.forEach(item => {
        renderSingleHistoryItem(item, frag, false);
      });

      const banner = document.getElementById('historyLazyBanner');
      if (banner && banner.nextSibling) {
        chatFeed.insertBefore(frag, banner.nextSibling);
      } else {
        chatFeed.insertBefore(frag, chatFeed.firstChild);
      }

      renderHistoryLazyBanner();

      requestAnimationFrame(() => {
        const heightDiff = chatFeed.scrollHeight - prevScrollHeight;
        chatFeed.scrollTop = prevScrollTop + heightDiff;
      });
    }

    // Lazy load scroll listener on chatFeed
    let isHistoryScrollListening = false;
    function attachHistoryScrollListener() {
      if (isHistoryScrollListening) return;
      isHistoryScrollListening = true;
      chatFeed.addEventListener('scroll', () => {
        if (chatFeed.scrollTop < 60 && currentHistoryRenderIndex > 0) {
          loadMoreSessionHistory();
        }
      });
    }

    async function selectSession(sessionId, sessionTitle, wsPath) {
      soundEffects.playClick();
      if (window.innerWidth < 1024) {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (sidebar) sidebar.classList.add('-translate-x-full');
        if (backdrop) backdrop.classList.add('hidden');
      }
      currentSessionId = sessionId;
      if (wsPath) {
        currentWorkspace = wsPath;
        const base = wsPath.split(/[\\\\/]/).pop() || wsPath;
        currentSessionFolder.innerText = base;
        currentSessionFolderTag.innerText = base;
        if (heroWorkspaceLabel) heroWorkspaceLabel.innerText = wsPath;
      }
      currentSessionTitle.innerText = sessionTitle || sessionId;

      chatFeed.innerHTML = \`
        <div class="flex items-center justify-center p-8 space-x-2 text-xs" style="color: var(--text-sub);">
          <div class="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          <span>Đang nạp chi tiết phiên làm việc...</span>
        </div>
      \`;

      loadWorkspaceTree();

      try {
        const res = await fetch(\`/api/session?id=\${encodeURIComponent(sessionId)}\`);
        const data = await res.json();

        chatFeed.innerHTML = '';

        if (!data || !data.conversation || data.conversation.length === 0) {
          currentSessionHistoryItems = [];
          currentHistoryRenderIndex = 0;
          chatFeed.innerHTML = \`
            <div class="text-center py-16 text-xs" style="color: var(--text-sub);">
              Phiên này chưa có tin nhắn hoặc lịch sử đã được lưu trữ.
            </div>
          \`;
          return;
        }

        // Trích xuất danh sách các items
        currentSessionHistoryItems = buildHistoryItemsFromConversation(data.conversation);
        const totalItems = currentSessionHistoryItems.length;

        // Tính toán chunk mới nhất để hiển thị
        if (totalItems <= HISTORY_CHUNK_SIZE) {
          currentHistoryRenderIndex = 0;
          currentSessionHistoryItems.forEach(item => {
            renderSingleHistoryItem(item, chatFeed, false);
          });
        } else {
          currentHistoryRenderIndex = totalItems - HISTORY_CHUNK_SIZE;
          const initialChunk = currentSessionHistoryItems.slice(currentHistoryRenderIndex);
          initialChunk.forEach(item => {
            renderSingleHistoryItem(item, chatFeed, false);
          });
          renderHistoryLazyBanner();
          attachHistoryScrollListener();
        }

        scrollToBottom();
      } catch (err) {
        showToast('Lỗi khi nạp chi tiết phiên: ' + err.message, 'error');
      }
    }

    // ========================================================
    // MODAL: FULL CONVERSATION POPUP
    // ========================================================
    function openFullConversationModal() {
      soundEffects.playClick();
      const modal = document.getElementById('fullConversationModal');
      const title = document.getElementById('fullConvModalTitle');
      const subtitle = document.getElementById('fullConvModalSubtitle');
      const container = document.getElementById('fullConvMessagesContainer');
      const searchInp = document.getElementById('fullConvSearchInput');

      if (!modal || !container) return;
      modal.classList.remove('hidden');

      if (title) title.innerText = currentSessionTitle.innerText || 'Toàn bộ cuộc trò chuyện';
      if (subtitle) subtitle.innerText = \`\${currentSessionHistoryItems.length} tin nhắn trong phiên\`;
      if (searchInp) searchInp.value = '';

      renderFullConvModalContent(currentSessionHistoryItems);
    }

    function closeFullConversationModal() {
      const modal = document.getElementById('fullConversationModal');
      if (modal) modal.classList.add('hidden');
    }

    function renderFullConvModalContent(items) {
      const container = document.getElementById('fullConvMessagesContainer');
      if (!container) return;
      container.innerHTML = '';

      if (!items || items.length === 0) {
        container.innerHTML = '<div class="text-center py-12 text-xs text-zinc-500 italic">Phiên này chưa có tin nhắn nào.</div>';
        return;
      }

      items.forEach(item => {
        renderSingleHistoryItem(item, container, false);
      });
    }

    function filterFullConvModal(query) {
      query = (query || '').toLowerCase().trim();
      const rows = document.querySelectorAll('#fullConvMessagesContainer > div');
      rows.forEach(r => {
        if (!query) {
          r.style.display = '';
        } else {
          const match = r.innerText.toLowerCase().includes(query);
          r.style.display = match ? '' : 'none';
        }
      });
    }

    async function copyFullConversationText() {
      soundEffects.playClick();
      const lines = [];
      currentSessionHistoryItems.forEach(item => {
        if (item.role === 'user') {
          lines.push(\`### [BẠN]:\\n\${item.text}\\n\`);
        } else if (item.role === 'assistant') {
          const texts = [];
          (item.rawContent || []).forEach(c => {
            if (c.type === 'text' || c.text) {
              const t = typeof c.text === 'string' ? c.text : (c.text?.value || '');
              if (t.trim()) texts.push(t.trim());
            }
          });
          lines.push(\`### [AI AGENT]:\\n\${texts.join('\\n\\n')}\\n\`);
        }
      });

      const fullText = lines.join('\\n---\\n\\n');
      try {
        await navigator.clipboard.writeText(fullText);
        showToast('Đã sao chép toàn bộ nội dung trò chuyện!', 'success');
      } catch (err) {
        showToast('Không thể sao chép: ' + err.message, 'error');
      }
    }

    `;

content = content.slice(0, sStartIdx) + newSelectSessionJs + content.slice(sEndIdx);
console.log('[OK] Step 6: Session lazy loading and full conversation popup logic applied.');

// ========================================================
// 7. KIỂM TRA TÍNH TOÀN VẸN CÚ PHÁP TRƯỚC KHI GHI
// ========================================================
if (!content.trim().endsWith('</html>')) {
  throw new Error('Tệp không kết thúc bằng </html>! Huỷ ghi đè.');
}

// Kiểm tra cú pháp Javascript trong file
const sStart = content.indexOf('<script>');
const sEnd = content.lastIndexOf('</script>');
const jsCode = content.slice(sStart + 8, sEnd);
try {
  new Function(jsCode);
  console.log('[OK] Step 7: JavaScript syntax validation passed!');
} catch (syntaxErr) {
  console.error('Lỗi cú pháp JavaScript:', syntaxErr);
  throw syntaxErr;
}

fs.writeFileSync(targetPath, content, 'utf8');
console.log('[SUCCESS] public/index.html đã được cập nhật hoàn hảo và toàn vẹn!');
