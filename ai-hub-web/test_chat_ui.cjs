const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8').replace(/\r\n/g, '\n');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function definition(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n    function ', start + 1);
  return source.slice(start, end < 0 ? source.length : end).split('\n    async function ')[0].split('\n    // ')[0];
}
const context = vm.createContext({ console, setTimeout, clearTimeout, Date, Number, String, Map });
for (const name of ['extractSubagentsAndUserText', 'parseSubagentReports', 'normalizePromptForCompare', 'prepareRunningSessionHistoryItems', 'messageTime', 'timingLabel', 'safeStringifyCode', 'historyItemText', 'escapeHtml', 'escapeJs', 'isInternalConversationMessage', 'classifyInternalEntry', 'buildInternalItemTitle', 'appendInternalHistoryEntry', 'buildHistoryItemsFromConversation']) {
  new vm.Script(definition(name)).runInContext(context);
}
assert.equal(context.messageTime({created: 1700000000}), 1700000000000);
assert.equal(context.messageTime({created_at: '2026-10-30T10:00:00Z'}), Date.parse('2026-10-30T10:00:00Z'));
assert.equal(context.messageTime({}), null);
assert.equal(context.messageTime({created: 'invalid'}), null);
assert.match(context.timingLabel({role: 'assistant', startedAt: 1700000000000, elapsedMs: 1250}), /1\.3 giây/);
const items = context.buildHistoryItemsFromConversation([
 {role:'user',created:1700000000,content:[{type:'text',text:'hello'}]},
 {role:'assistant',created:1700000002,content:[{type:'text',text:'world'}]}
]);
assert.equal(items.length,2);
assert.equal(items[0].elapsedMs,2000);
assert.equal(context.historyItemText(items[1]), 'world');
const runtimeContext = '<turn-context>\n<current-time>2026-10-31</current-time>\n<working-directory>D:\\workspace</working-directory>\n</turn-context>';
const cleanedItems = context.buildHistoryItemsFromConversation([
 {role:'user',content:[{type:'text',text:'Fix the database'}]},
 {role:'user',content:[{type:'text',text:runtimeContext}]},
 {role:'assistant',content:[{type:'text',text:'Done'}]},
 {role:'user',content:[{type:'text',text:'Next question\n' + runtimeContext}]}
]);
assert.equal(cleanedItems.length, 3);
assert.equal(cleanedItems[1].questionText, 'Fix the database');
assert.equal(cleanedItems[2].text, 'Next question');
assert.ok(!cleanedItems.some(item => (item.text || '').includes('<turn-context>')));
const filename = 'D:\\folder\\a\'"&<.png';
const encoded = context.escapeJs(filename);
assert.ok(!encoded.includes('"'));
const decoded = encoded.replace(/&#039;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
assert.equal(vm.runInNewContext(`'${decoded}'`),filename);
assert.ok(source.includes('currentSessionHistoryItems = [];\n      currentHistoryRenderIndex = 0;'));
assert.ok(source.includes('if (viewVersion !== sessionViewVersion) return;'));
assert.ok(source.includes('await reader.cancel(); return;'));
assert.ok(source.includes('const FULL_CONV_BATCH_SIZE = 12;'));
assert.ok(source.includes('renderSingleHistoryItem(fullConvMatches[i], fragment)'));
assert.ok(!source.includes('transcript-pagination'));
assert.ok(source.includes("loadFullConvBatch('older')"));
assert.ok(source.includes('requestAnimationFrame(() => requestAnimationFrame(async () =>'));
assert.ok(!source.includes('items.forEach(item => {\n        renderSingleHistoryItem(item, container'));
assert.ok(source.includes('if (mount) {\n        chatFeed.appendChild(row)'));
const subagentPrompt = 'thêm nút xem web toàn màn hình, Subagent 20261031_23 completed: {"summary":"task 23 done"}Subagent 20261031_22 completed: {"summary":"task 22 done"}Subagent 20261031_21 completed: {"summary":"task 21 done"} với cả mấy cái này tự nhiên thành câu hỏi của tôi, thiết kế lại đi';
const subagentItems = context.buildHistoryItemsFromConversation([
  { role: 'user', created: 1700000000, content: [{ type: 'text', text: subagentPrompt }] },
  { role: 'assistant', created: 1700000005, content: [{ type: 'text', text: 'Đã thiết kế lại giao diện Subagent.' }] }
]);
assert.equal(subagentItems.length, 3);
assert.equal(subagentItems[0].role, 'user');
assert.ok(subagentItems[0].text.includes('thêm nút xem web toàn màn hình'));
assert.ok(subagentItems[0].text.includes('thiết kế lại đi'));
assert.equal(subagentItems[1].role, 'subagent');
assert.equal(subagentItems[1].subagents.length, 3);
assert.equal(subagentItems[1].subagents[0].id, '20261031_23');
assert.equal(subagentItems[2].role, 'assistant');
assert.equal(subagentItems[2].questionText, subagentItems[0].text);
assert.ok(source.includes('sub_content_${subSnippetId}" class="p-3.5 sm:p-4 text-xs sm:text-[13px] leading-relaxed subagent-body subagent-markdown-body markdown-body border-t hidden"'));
assert.ok(source.includes('id="sub_chevron_${subSnippetId}"\n                        style="transform: rotate(-90deg);"'));
assert.ok(!source.includes('subagent-body ai-content-body'));
assert.ok(html.includes('#promptInput::placeholder'));
assert.ok(html.includes('font-style: italic !important;'));
assert.ok(html.includes('font-weight: 400 !important;'));
assert.ok(html.includes('placeholder:italic placeholder:font-normal placeholder:text-xs'));
assert.ok(html.includes('btnToggleComposerCollapse'));
assert.ok(html.includes('mainDockBox'));
assert.ok(html.includes('composerCollapsedBar'));
assert.ok(html.includes('composerBottomArrow'));
assert.ok(html.includes('composerBottomArrowWrapper'));
assert.ok(html.includes('btnFloatingExpandComposer'));
assert.ok(source.includes('function toggleComposerCollapse('));
assert.ok(source.includes('function handleComposerHeaderClick('));
assert.ok(source.includes('function initHubEvents('));
assert.ok(source.includes('clientTabId'));
assert.ok(source.includes("e.key.toLowerCase() === 'j'"));

// Verify multi-step assistant turns (separated by toolResponse user messages) merge into 1 AI block
const multiStepTurnItems = context.buildHistoryItemsFromConversation([
  { role: 'user', created: 1700001000, content: [{ type: 'text', text: 'Run two tools' }] },
  {
    role: 'assistant',
    created: 1700001001,
    content: [
      { type: 'thinking', thinking: 'Step 1 thinking' },
      { type: 'toolRequest', id: 'call_1', toolCall: { value: { name: 'shell', arguments: { command: 'echo 1' } } } }
    ]
  },
  {
    role: 'user',
    created: 1700001002,
    content: [
      { type: 'toolResponse', id: 'call_1', toolResult: { status: 'success', value: { content: [{ type: 'text', text: '1' }] } } }
    ]
  },
  {
    role: 'assistant',
    created: 1700001003,
    content: [
      { type: 'thinking', thinking: 'Step 2 thinking' },
      { type: 'toolRequest', id: 'call_2', toolCall: { value: { name: 'shell', arguments: { command: 'echo 2' } } } }
    ]
  },
  {
    role: 'user',
    created: 1700001004,
    content: [
      { type: 'toolResponse', id: 'call_2', toolResult: { status: 'success', value: { content: [{ type: 'text', text: '2' }] } } }
    ]
  },
  {
    role: 'assistant',
    created: 1700001005,
    content: [
      { type: 'text', text: 'Final answer after 2 tools.' }
    ]
  }
]);
assert.equal(multiStepTurnItems.length, 2);
assert.equal(multiStepTurnItems[0].role, 'user');
assert.equal(multiStepTurnItems[1].role, 'assistant');
assert.equal(multiStepTurnItems[1].rawContent.length, 5);
assert.equal(multiStepTurnItems[1].startedAt, 1700001001000);
assert.equal(multiStepTurnItems[1].endedAt, 1700001005000);
assert.equal(multiStepTurnItems[1].elapsedMs, 5000);

// Verify switching away and back to a running session (Screenshot_16 scenario):
// 1. Mid-turn partial assistant steps in SQLite are popped so reconnectRunningSession streams into a single live AI block
// 2. hasPrompt is true so selectSession does NOT append a duplicate user question at the bottom
// 3. Mode prefix ([Yêu cầu: ...]) is stripped by normalizePromptForCompare
const midTurnConv = context.buildHistoryItemsFromConversation([
  { role: 'user', created: 1700002000, content: [{ type: 'text', text: '[Yêu cầu: Hãy tư vấn, giải thích]\n\ncác phần này đã chạy mượt mà, ổn định và tối ưu tài nguyên rồi chứ' }] },
  {
    role: 'assistant',
    created: 1700002002,
    content: [
      { type: 'thinking', thinking: 'Checking processes' },
      { type: 'toolRequest', id: 'call_a', toolCall: { value: { name: 'shell', arguments: { command: 'Get-Process' } } } }
    ]
  },
  {
    role: 'user',
    created: 1700002005,
    content: [
      { type: 'toolResponse', id: 'call_a', toolResult: { status: 'success', value: { content: [{ type: 'text', text: 'ok' }] } } }
    ]
  }
]);
assert.equal(midTurnConv.length, 2);
assert.equal(midTurnConv[0].text, 'các phần này đã chạy mượt mà, ổn định và tối ưu tài nguyên rồi chứ');
const prepared = context.prepareRunningSessionHistoryItems(midTurnConv, {
  prompt: '[Yêu cầu: Hãy tư vấn, giải thích]\n\ncác phần này đã chạy mượt mà, ổn định và tối ưu tài nguyên rồi chứ',
  startTime: 1700002000500
});
assert.equal(midTurnConv.length, 1);
assert.equal(midTurnConv[0].role, 'user');
assert.equal(prepared.hasPrompt, true);
assert.equal(prepared.promptText, 'các phần này đã chạy mượt mà, ổn định và tối ưu tài nguyên rồi chứ');
assert.ok(source.includes('function detachActiveStream('));
assert.ok(source.includes('es._closeAndDone = closeAndDone;'));
assert.ok(source.indexOf('<div class="ai-content-body space-y-2.5"></div>') < source.indexOf('class="live-progress-container'));
assert.ok(!source.includes("aiContainer.updateProgress('Đã xong tác vụ')"));
assert.ok(source.includes("aiContainer.updateProgress('Đang xử lý kết quả & tiếp tục...')"));

assert.ok(source.includes('body: JSON.stringify({ id: sessionId, sessionId })'));
assert.ok(source.includes('body: JSON.stringify({ id: sessionId, sessionId, name: newName.trim(), newName: newName.trim() })'));

assert.ok(html.includes('rel="manifest" href="/manifest.json?v=3"'));
assert.ok(html.includes('href="/icon-192.png?v=3"'));
assert.ok(fs.existsSync('public/favicon.ico'));
assert.ok(fs.existsSync('public/manifest.json'));

// 5 new UX/stability regression checks:
// (1) Red/Green Diff Viewer & Tool File Mutation Tracking
context.hubServerPlatform = 'win32';
context.hubLocalDrives = ['C:\\', 'D:\\'];
context.currentWorkspace = 'D:\\ai-hub';
context.sessionFileChanges = new Map();
context.localPathExistenceCache = new Map();
context.Int32Array = Int32Array;
for (const fnName of [
  'normalizeTrackPathKey', 'getRecordedFileChange', 'computeUnifiedLineDiff', 'parseUnifiedDiffToRows',
  'isFailedToolOutput', 'unescapePythonLiteral', 'extractHelperPythonScriptMutations', 'extractShellPythonFileMutations',
  'extractToolFileMutations', 'rebuildDiffFromSnippets', 'recordToolMutationsInSession', 'isLocalFilePath'
]) {
  new vm.Script(definition(fnName)).runInContext(context);
}

const sampleDiff = context.computeUnifiedLineDiff('line1\noldLine\nline3\n', 'line1\nnewLine1\nnewLine2\nline3\n', 'server.js');
assert.equal(sampleDiff.added, 2);
assert.equal(sampleDiff.removed, 1);
const parsedDiff = context.parseUnifiedDiffToRows(sampleDiff.diff);
assert.equal(parsedDiff.added, 2);
assert.equal(parsedDiff.removed, 1);
assert.ok(parsedDiff.rows.some(r => r.type === 'del' && r.sign === '-' && r.text === 'oldLine'));
assert.ok(parsedDiff.rows.some(r => r.type === 'add' && r.sign === '+' && r.text === 'newLine1'));

const writeMuts = context.extractToolFileMutations('developer__write', { path: 'D:\\ai-hub\\demo.js', content: 'const x = 1;\nconst y = 2;' }, 'Created file', false);
assert.equal(writeMuts.length, 1);
assert.equal(writeMuts[0].status, 'added');
assert.equal(writeMuts[0].added, 2);
assert.equal(writeMuts[0].removed, 0);

const delMuts = context.extractToolFileMutations('developer__shell', { command: 'del /f /q "D:\\ai-hub\\obsolete.txt"' }, '', false);
assert.equal(delMuts.length, 1);
assert.equal(delMuts[0].status, 'deleted');
assert.equal(delMuts[0].path, 'D:\\ai-hub\\obsolete.txt');
context.recordToolMutationsInSession(delMuts);
assert.equal(context.getRecordedFileChange('D:\\ai-hub\\obsolete.txt').status, 'deleted');

assert.ok(html.includes('id="filePreviewDiffContainer"'));
assert.ok(html.includes('id="filePreviewDiffTableBody"'));
assert.ok(html.includes('.diff-viewer-table tr.diff-row-add'));
assert.ok(html.includes('.diff-viewer-table tr.diff-row-del'));
assert.ok(source.includes('window.switchFilePreviewTab = function('));

// (2) Thinking process card defaults to closed (details.open = false)
assert.ok(!source.includes('details.open = !container.isHistorical'));
assert.ok(source.includes('details.open = false;'));
assert.ok(source.includes("container._thoughtElement.querySelector('.thought-body')"));

// (3) Non-local paths rejected on Windows & unverified badges checked via /api/check-paths
assert.equal(context.isLocalFilePath('/etc/nginx/nginx.conf'), false);
assert.equal(context.isLocalFilePath('/usr/local/bin/node'), false);
assert.equal(context.isLocalFilePath('/var/log/syslog'), false);
assert.equal(context.isLocalFilePath('/api/session'), false);
assert.equal(context.isLocalFilePath('\\\\remote-pc\\share\\doc.txt'), false);
assert.equal(context.isLocalFilePath('Z:\\unmounted\\secret.txt'), false);
assert.equal(context.isLocalFilePath('application/json'), false);
assert.equal(context.isLocalFilePath('origin/main'), false);
assert.equal(context.isLocalFilePath('https://github.com/block/goose'), false);
assert.equal(context.isLocalFilePath('D:\\ai-hub\\ai-hub-web\\server.js'), true);
assert.equal(context.isLocalFilePath('D:\\ai-hub\\obsolete.txt'), true);
assert.equal(context.isLocalFilePath('public/index.html'), true);
assert.ok(source.includes("fetch('/api/check-paths'"));
assert.ok(html.includes('.local-path-badge[data-unverified="1"]'));

// (4) User scroll-up lock prevents auto-scroll to bottom when new stream/tool items arrive
assert.ok(source.includes('let isChatUserScrolledUp = false;'));
assert.ok(source.includes('if (!force && isChatUserScrolledUp) return;'));
assert.ok(source.includes('if (isChatUserScrolledUp || distanceToBottom > 80)'));
assert.ok(!source.includes('container.contentBody.appendChild(card);\n      scrollToBottom();'));

// (5) Quick prompt suggestion button aligned left
assert.ok(html.includes('id="composerTopBar" class="composer-suggestions-header relative flex items-center justify-start w-full pb-1.5 px-0'));
assert.ok(!html.includes('max-w-4xl mx-auto pb-1.5 px-0.5'));


// (6) Per-session model memory & mobile HTTP clipboard fallback & Cốc Cốc icon route support
assert.ok(source.includes('function setSessionModel(sessionId, modelId)'));
assert.ok(source.includes('function getSessionModel(sessionId, explicitOnly = false)'));
assert.ok(source.includes('const resolvedSessionModel = (data?.isRunning && data?.activeSessionInfo?.model)'));
assert.ok(source.includes('window.writeTextToClipboard = function(text)'));
assert.ok(source.includes("document.execCommand('copy')"));
assert.ok(!source.includes('navigator.clipboard.writeText(text).then(() => {'));
assert.ok(html.includes('<link rel="icon" href="/favicon.ico" sizes="any">'));
assert.ok(html.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'));
assert.ok(source.includes('function refreshFaviconForCurrentRoute()'));

// (7) Option 1 Inline Edit & Rewind only on the latest user question
const serverSource = fs.readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
assert.ok(html.includes('.user-message-row:not([data-latest-user-question="true"]) .user-edit-btn'));
assert.ok(html.includes('.user-message-row:not([data-latest-user-question="true"]) .user-edit-sep'));
assert.ok(source.includes('function syncLatestUserQuestionEditButton()'));
assert.ok(source.includes('window.cancelInlineUserEdit = function(id)'));
assert.ok(source.includes('window.saveInlineUserEditOnly = function(id)'));
assert.ok(source.includes('window.submitInlineUserEdit = async function(id)'));
assert.ok(source.includes('user-edit-submit-btn'));
assert.ok(source.includes('title="Gửi câu hỏi và sinh lại câu trả lời (Enter)"'));
assert.ok(source.includes('await sendMessage({ promptOverride: newPrompt, rewindLastTurn: true });'));
assert.ok(source.includes('rewindLastTurn: !!opts.rewindLastTurn'));
assert.ok(serverSource.includes('function truncateLastUserTurn(sessionId, newTitlePrompt = "")'));
assert.ok(serverSource.includes('if (data.rewindLastTurn && data.sessionId)'));

// (8) Mobile Enter for newline (Send button only) vs Desktop Enter to send & Responsive polish
let sendMessageCallCount = 0;
const promptInputAttrs = {};
const mobileInputSandbox = {
  window: {
    innerWidth: 390,
    matchMedia: () => ({ matches: true }),
  },
  navigator: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  },
  promptInput: {
    value: 'Xin chào',
    setAttribute(k, v) { promptInputAttrs[k] = v; },
    getAttribute(k) { return promptInputAttrs[k]; }, addEventListener() {},
  },
  promptHistory: [],
  promptHistoryIndex: 0,
  slashMenu: { classList: { remove() {} } },
  autoResizeTextarea() {},
  sendMessage() { sendMessageCallCount++; },
  setTimeout,
};
vm.createContext(mobileInputSandbox);
vm.runInContext(
  [
    definition('isMobileChatInput'),
    definition('syncComposerInputMode'),
    definition('handlePromptInputKeydown'),
  ].join('\n'),
  mobileInputSandbox
);

assert.equal(mobileInputSandbox.isMobileChatInput(), true);
mobileInputSandbox.syncComposerInputMode();
assert.equal(promptInputAttrs.enterkeyhint, 'enter');
assert.ok(promptInputAttrs.placeholder.includes('Enter xuống dòng, bấm Gửi để gửi'));

let mobileEnterPrevented = false;
mobileInputSandbox.handlePromptInputKeydown({
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  preventDefault() { mobileEnterPrevented = true; },
});
assert.equal(mobileEnterPrevented, false, 'Mobile Enter must not preventDefault so newline is inserted');
assert.equal(sendMessageCallCount, 0, 'Mobile Enter must not call sendMessage()');

let mobileCtrlEnterPrevented = false;
mobileInputSandbox.handlePromptInputKeydown({
  key: 'Enter',
  shiftKey: false,
  ctrlKey: true,
  metaKey: false,
  isComposing: false,
  preventDefault() { mobileCtrlEnterPrevented = true; },
});
assert.equal(mobileCtrlEnterPrevented, true);
assert.equal(sendMessageCallCount, 1);

mobileInputSandbox.window.innerWidth = 1280;
mobileInputSandbox.window.matchMedia = () => ({ matches: false });
mobileInputSandbox.navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0';
assert.equal(mobileInputSandbox.isMobileChatInput(), false);
mobileInputSandbox.syncComposerInputMode();
assert.equal(promptInputAttrs.enterkeyhint, 'send');
assert.ok(promptInputAttrs.placeholder.includes('Enter gửi, Shift+Enter xuống dòng'));

let desktopShiftEnterPrevented = false;
mobileInputSandbox.handlePromptInputKeydown({
  key: 'Enter',
  shiftKey: true,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  preventDefault() { desktopShiftEnterPrevented = true; },
});
assert.equal(desktopShiftEnterPrevented, false);
assert.equal(sendMessageCallCount, 1);

let desktopImePrevented = false;
mobileInputSandbox.handlePromptInputKeydown({
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: true,
  preventDefault() { desktopImePrevented = true; },
});
assert.equal(desktopImePrevented, false);
assert.equal(sendMessageCallCount, 1);

let desktopEnterPrevented = false;
mobileInputSandbox.handlePromptInputKeydown({
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  preventDefault() { desktopEnterPrevented = true; },
});
assert.equal(desktopEnterPrevented, true);
assert.equal(sendMessageCallCount, 2);

assert.ok(!html.includes('</button>\n</button>'), 'No duplicate closing button tag in header');
assert.ok(html.includes('#slashCommandsMenu { left: 8px !important; right: 8px !important;'));
assert.ok(html.includes('@media (min-width: 640px) and (max-width: 1023px)'));
assert.ok(html.includes('#sessionSearchInput, #modelSearchInput, #fullConvSearchInput, #wsPathInput, #workspaceListFilterInput, #gitCommitMessageInput, .inline-user-edit-textarea { font-size: 16px !important; }'));

assert.ok(!source.includes('stopBtn.innerText'));
assert.ok(html.includes('id="stopBtn"'));
assert.ok(!html.includes('<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">\n                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>\n              </svg>\n              <span>Dừng</span>'));

assert.ok(!html.includes('id="inputStatsCounter"'));
assert.ok(!html.includes('onclick="toggleSlashMenu()"'));

// (9) Per-session chat input draft isolation (Session A -> Session B -> back to Session A)
const draftStore = new Map();
const draftSandbox = {
  Map,
  String,
  Array,
  Math,
  sessionDraftsMap: new Map(),
  currentDraftSessionKey: '__new__',
  currentSessionId: 'session_A',
  allSessionsCache: [
    { id: 'session_A', name: 'Phiên A' },
    { id: 'session_B', name: 'Phiên B' },
  ],
  localStorage: {
    getItem(k) { return draftStore.has(k) ? draftStore.get(k) : null; },
    setItem(k, v) { draftStore.set(k, String(v)); },
    removeItem(k) { draftStore.delete(k); },
  },
  promptInput: { value: '', scrollHeight: 48, style: { height: '' } },
  charCount: { innerText: '' },
};
vm.createContext(draftSandbox);
vm.runInContext(
  [
    definition('autoResizeTextarea'),
    definition('setSessionDraft'),
    definition('getSessionDraft'),
    definition('saveCurrentSessionDraft'),
    definition('restoreSessionDraft'),
  ].join('\n'),
  draftSandbox
);

// User types in Session A without sending
draftSandbox.promptInput.value = 'Đoạn chat đang gõ dở ở phiên A';
draftSandbox.autoResizeTextarea();
assert.equal(draftSandbox.getSessionDraft('session_A'), 'Đoạn chat đang gõ dở ở phiên A');
assert.equal(draftSandbox.getSessionDraft('Phiên A'), 'Đoạn chat đang gõ dở ở phiên A');

// Switch to Session B: saves A, sets currentSessionId = session_B, restores B (empty)
draftSandbox.saveCurrentSessionDraft();
draftSandbox.currentSessionId = 'session_B';
draftSandbox.currentDraftSessionKey = 'session_B';
draftSandbox.restoreSessionDraft('session_B');
assert.equal(draftSandbox.promptInput.value, '', 'Session B must not carry over Session A draft');
assert.equal(draftSandbox.charCount.innerText, '0 ký tự');

// Switch back to Session A: draft of Session A must still be there
draftSandbox.saveCurrentSessionDraft();
draftSandbox.currentSessionId = 'session_A';
draftSandbox.currentDraftSessionKey = 'session_A';
draftSandbox.restoreSessionDraft('session_A');
assert.equal(draftSandbox.promptInput.value, 'Đoạn chat đang gõ dở ở phiên A', 'Session A draft must be restored when switching back');

// Clear draft on send in Session A
draftSandbox.setSessionDraft('session_A', '');
assert.equal(draftSandbox.getSessionDraft('session_A'), '');

// New-session unsent draft persistence across session switch & clicking "Tạo phiên mới" again
const newSessionFnSrc = definition('newSession');
assert.ok(newSessionFnSrc.includes('restoreSessionDraft(nextNewSessionKey)'), 'newSession() must restore pending new-session draft');
assert.ok(!newSessionFnSrc.includes("promptInput.value = '';"), 'newSession() must not wipe unsent new-session draft');

// 1) User opens new session (new-111) and types unsent message
draftSandbox.currentSessionId = null;
draftSandbox.currentDraftSessionKey = 'new-111';
draftSandbox.promptInput.value = 'Tin nhắn nháp ở phiên mới chưa gửi';
draftSandbox.autoResizeTextarea();
assert.equal(draftSandbox.getSessionDraft('__new__'), 'Tin nhắn nháp ở phiên mới chưa gửi');

// 2) User switches to existing Session B -> Session B is empty
draftSandbox.saveCurrentSessionDraft();
draftSandbox.currentSessionId = 'session_B';
draftSandbox.currentDraftSessionKey = 'session_B';
draftSandbox.restoreSessionDraft('session_B');
assert.equal(draftSandbox.promptInput.value, '');

// 3) User clicks "Tạo phiên mới" again (generates new-222) -> unsent draft is preserved!
draftSandbox.saveCurrentSessionDraft();
draftSandbox.currentSessionId = null;
draftSandbox.currentDraftSessionKey = 'new-222';
draftSandbox.restoreSessionDraft('new-222');
assert.equal(draftSandbox.promptInput.value, 'Tin nhắn nháp ở phiên mới chưa gửi');

// 4) Page reload (F5) hydration guard: saveCurrentSessionDraft before first restore must not wipe localStorage
draftSandbox.sessionDraftsMap.clear();
draftSandbox.sessionDraftHydrated = false;
draftSandbox.promptInput.value = '';
draftSandbox.currentSessionId = null;
draftSandbox.currentDraftSessionKey = '__new__';
draftSandbox.saveCurrentSessionDraft();
assert.equal(draftStore.get('ai_hub_session_draft:__new__'), 'Tin nhắn nháp ở phiên mới chưa gửi');
draftSandbox.restoreSessionDraft('new-333');
assert.equal(draftSandbox.promptInput.value, 'Tin nhắn nháp ở phiên mới chưa gửi');

// 5) Once sent in new session, draft is cleared for subsequent new sessions
draftSandbox.setSessionDraft('new-333', '');
draftSandbox.currentDraftSessionKey = 'new-444';
draftSandbox.restoreSessionDraft('new-444');
assert.equal(draftSandbox.promptInput.value, '');

// (10) Collapsible thinking & execution process group (default collapsed above final answer)
const processGroupSandbox = {
  window: {},
  soundEffects: { playClick() {} },
  document: {
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        innerHTML: '',
        textContent: '',
        children: [],
        attrs: { 'aria-expanded': 'false' },
        classList: {
          _set: new Set(['hidden']),
          toggle(cls, force) {
            if (force === undefined) {
              if (this._set.has(cls)) { this._set.delete(cls); return false; }
              this._set.add(cls); return true;
            }
            if (force) this._set.add(cls); else this._set.delete(cls);
            return force;
          },
          contains(cls) { return this._set.has(cls); },
        },
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        insertBefore(child, ref) {
          const idx = this.children.indexOf(ref);
          if (idx >= 0) this.children.splice(idx, 0, child);
          else this.children.unshift(child);
          child.parentElement = this;
          return child;
        },
        get firstChild() { return this.children[0] || null; },
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; },
      };
      el._labelEl = { textContent: '' };
      el._metaEl = { textContent: '' };
      el._chevronEl = {
        classList: {
          _set: new Set(),
          toggle(cls, force) {
            if (force) this._set.add(cls); else this._set.delete(cls);
          },
          contains(cls) { return this._set.has(cls); },
        }
      };
      el._bodyEl = {
        children: [],
        classList: el.classList,
        appendChild(c) { this.children.push(c); return c; },
      };
      el.querySelector = (sel) => {
        if (sel === '.ai-process-body') return el._bodyEl;
        if (sel === '.ai-process-label') return el._labelEl;
        if (sel === '.ai-process-meta') return el._metaEl;
        if (sel === '.ai-process-chevron') return el._chevronEl;
        return null;
      };
      el.closest = (sel) => (sel === '.ai-process-group' ? el : null);
      return el;
    },
  },
};
vm.createContext(processGroupSandbox);
vm.runInContext(
  [
    definition('ensureAiProcessGroup'),
    definition('updateAiProcessGroupSummary'),
    definition('toggleAiProcessGroup'),
    definition('moveActiveTextToProcessGroup'),
  ].join('\n'),
  processGroupSandbox
);

const mockContentBody = processGroupSandbox.document.createElement('div');
const mockFinalResultBlock = { innerHTML: '<p>Final answer</p>', children: [] };
mockContentBody.appendChild(mockFinalResultBlock);
const mockContainer = { contentBody: mockContentBody };

const procBody = processGroupSandbox.ensureAiProcessGroup(mockContainer);
assert.ok(procBody, 'Process group body must be created');
assert.equal(mockContentBody.children[0], mockContainer._processGroup, 'Process group must be inserted at the top before final answer');
assert.equal(mockContentBody.children[1], mockFinalResultBlock, 'Final answer must remain below process group');
assert.equal(procBody.classList.contains('hidden'), true, 'Process group body must be collapsed (hidden) by default');

mockContainer._thoughtCount = 2;
mockContainer._toolCount = 3;
processGroupSandbox.updateAiProcessGroupSummary(mockContainer);
assert.equal(mockContainer._processGroupLabel.textContent, 'Quá trình suy nghĩ & thực thi');
assert.equal(mockContainer._processGroupMeta.textContent, '(2 suy nghĩ • 3 thực thi)');

// Toggle open -> expanded
processGroupSandbox.toggleAiProcessGroup(mockContainer._processGroup);
assert.equal(procBody.classList.contains('hidden'), false, 'Clicking toggle must expand process group');
assert.equal(mockContainer._processGroup.getAttribute('aria-expanded'), 'true');
assert.equal(mockContainer._processGroup._chevronEl.classList.contains('rotate-90'), true);

// Toggle close -> collapsed again
processGroupSandbox.toggleAiProcessGroup(mockContainer._processGroup);
assert.equal(procBody.classList.contains('hidden'), true, 'Clicking toggle again must collapse process group');
assert.equal(mockContainer._processGroup.getAttribute('aria-expanded'), 'false');
assert.equal(mockContainer._processGroup._chevronEl.classList.contains('rotate-90'), false);

// Intermediate text before tool call moves into processBody
let cursorRemoved = false;
const intermediateBlock = {
  innerHTML: '<p>Kiểm tra cấu trúc file...</p>',
  style: {},
  querySelectorAll() { return [{ remove() { cursorRemoved = true; } }]; },
};
mockContainer.activeTextContainer = intermediateBlock;
processGroupSandbox.moveActiveTextToProcessGroup(mockContainer);
assert.equal(cursorRemoved, true);
assert.equal(procBody.children.includes(intermediateBlock), true, 'Intermediate pre-tool text must move into collapsible process group');
assert.equal(mockContainer.activeTextContainer, null);

// Plain header mode for thinking & tool execution (plain-text headers while keeping expand/collapse, fileDiffBar, and light/dark viewer boxes)
assert.ok(source.includes('window.USE_PLAIN_PROCESS_HEADER = true;'), 'Plain process header mode must be enabled by default');
assert.ok(source.includes('id="fileDiffBar_${cardId}"'), 'File diff bar (xem file thay đổi) must be preserved');
assert.ok(source.includes('id="outputPre_${cardId}"'), 'Dark output frame and light args frame must be preserved');

// Verify internal / compaction messages (userVisible: false / # Conversation Summary) render as collapsible 1-line title cards instead of walls of text or duplicate user bubbles
const compactedItems = context.buildHistoryItemsFromConversation([
  { role: 'user', created: 1700010000, metadata: { userVisible: true, agentVisible: false }, content: [{ type: 'text', text: 'cái trang chủ của provt hãy để hiển thị đầy đủ các tính năng theo role đi' }] },
  { role: 'assistant', created: 1700010002, metadata: { userVisible: true, agentVisible: false }, content: [{ type: 'thinking', thinking: 'Checking index.jsp' }] },
  { role: 'user', created: 1700010010, metadata: { userVisible: false, agentVisible: true }, content: [{ type: 'text', text: '# Conversation Summary\n\n## User Intent\n- Hiển thị đầy đủ các tính năng' }] },
  { role: 'assistant', created: 1700010011, metadata: { userVisible: false, agentVisible: true }, content: [{ type: 'text', text: 'Your context was compacted. The previous message contains a summary of the conversation so far.\nDo not mention that you read a summary or that conversation summarization occurred.' }] },
  { role: 'user', created: 1700010012, metadata: { userVisible: false, agentVisible: true }, content: [{ type: 'text', text: 'cái trang chủ của provt hãy để hiển thị đầy đủ các tính năng theo role đi' }] },
  { role: 'assistant', created: 1700010015, metadata: { userVisible: true, agentVisible: true }, content: [{ type: 'text', text: 'Đã cập nhật đầy đủ các tính năng theo role.' }] }
]);
assert.equal(compactedItems.filter(i => i.role === 'user').length, 1, 'Repeated prompt with userVisible:false must NOT create a duplicate user bubble');
const internalItem = compactedItems.find(i => i.role === 'internal');
assert.ok(internalItem, 'Compaction messages must be grouped into an internal history item');
assert.equal(internalItem.entries.length, 3, 'All 3 consecutive compaction messages must be grouped into 1 collapsible internal card');
assert.ok(internalItem.title.includes('Tin nhắn nội bộ hệ thống'), 'Internal item must have a 1-line title');
assert.ok(context.historyItemText(internalItem).includes('# Conversation Summary'), 'Internal item must be searchable in Full Conversation Modal');
assert.ok(source.includes('function renderInternalMessageCard('), 'renderInternalMessageCard must exist');
assert.ok(source.includes('function toggleInternalMessageAccordion('), 'toggleInternalMessageAccordion must exist');

// Regression checks for write tool (+597 -0) vs Session diff (+448 -157) sync & Diff Viewer CSS
const diffContext = vm.createContext({
  console, setTimeout, clearTimeout, Date, Number, String, Map, Set, Array, Object, Boolean, RegExp, JSON, Int32Array,
  hubServerPlatform: 'win32',
  currentWorkspace: 'E:\\SSO\\code\\sso',
  currentSessionId: '20261102_10',
  sessionFileChanges: new Map(),
  _pendingFileDiffSyncSet: new Set(),
  _syncedFileDiffKeys: new Set(),
  _fileDiffSyncTimer: null,
  _sessionHistoryMutationsSeeded: false,
  _sessionHelperScriptsMap: new Map(),
  _toolCardMutationsByKey: new Map()
});
for (const name of [
  'escapeHtml', 'escapeJs', 'normalizeTrackPathKey', 'getRecordedFileChange',
  'computeUnifiedLineDiff', 'parseUnifiedDiffToRows',
  'isFailedToolOutput', 'unescapePythonLiteral',
  'extractHelperPythonScriptMutations', 'extractShellPythonFileMutations',
  'extractToolFileMutations',
  'resetSessionFileChangeTracking', 'isSameTrackedFilePath',
  'buildToolFileStatusPillHtml', 'buildToolFileStatsHtml',
  'applyServerDiffToSessionAndDOM', 'scheduleFileDiffSync',
  'applySessionFileChangesBatch', 'rebuildDiffFromSnippets',
  'recordToolMutationsInSession', 'seedSessionFileChangesFromHistory'
]) {
  new vm.Script(definition(name)).runInContext(diffContext);
}

const jspPath = 'pro-vt-sso/src/main/webapp/WEB-INF/jsp/index.jsp';
const mut1 = diffContext.extractToolFileMutations('write', { path: jspPath, content: Array.from({ length: 921 }, (_, i) => 'line ' + i).join('\n') }, 'Wrote ' + jspPath + ' (921 lines)', false);
assert.equal(mut1.length, 1);
assert.equal(mut1[0].isFullWrite, true);
assert.equal(mut1[0].added, 921);
diffContext.recordToolMutationsInSession(mut1, false);

const mut2 = diffContext.extractToolFileMutations('write', { path: jspPath, content: Array.from({ length: 597 }, (_, i) => 'new ' + i).join('\n') }, 'Wrote ' + jspPath + ' (597 lines)', false);
assert.equal(mut2[0].added, 597);
diffContext.recordToolMutationsInSession(mut2, false);
assert.equal(diffContext.getRecordedFileChange(jspPath).added, 597, 'Repeated full-file write must not sum 921 + 597');

const mockDiffRow = {
  attrs: { 'data-is-full-write': '1', 'data-path': jspPath },
  pill: { outerHTML: '' },
  stats: { outerHTML: '' },
  getAttribute(k) { return this.attrs[k] || ''; },
  querySelector(sel) { return sel === '.file-diff-status-pill' ? this.pill : (sel === '.file-diff-stats' ? this.stats : null); }
};
const mockBadge = {
  attrs: { 'data-path': 'E:\\SSO\\code\\sso\\pro-vt-sso\\src\\main\\webapp\\WEB-INF\\jsp\\index.jsp' },
  icon: { textContent: '🟢' },
  diffPill: { className: 'path-diff-pill hidden', innerHTML: '' },
  getAttribute(k) { return this.attrs[k] || ''; },
  querySelector(sel) { return sel === '.path-icon' ? this.icon : (sel === '.path-diff-pill' ? this.diffPill : null); }
};
diffContext.document = {
  querySelectorAll(sel) {
    if (sel === '[data-file-diff-row="1"]') return [mockDiffRow];
    if (sel === '.local-path-badge') return [mockBadge];
    return [];
  }
};

// Raw Git diff payload (without inSession/source='session') MUST be ignored so Git changes never leak in
diffContext.applyServerDiffToSessionAndDOM(jspPath, {
  success: true,
  inGit: true,
  hasChanges: true,
  status: 'modified',
  added: 999,
  removed: 888,
  path: 'E:\\SSO\\code\\sso\\pro-vt-sso\\src\\main\\webapp\\WEB-INF\\jsp\\index.jsp',
  diff: '--- a/index.jsp\n+++ b/index.jsp\n@@ -1 +1 @@\n-git\n+leak'
});
assert.equal(diffContext.getRecordedFileChange(jspPath).added, 597, 'Git-only diff payload must be ignored');

// Session-scoped diff payload MUST update session state and DOM badges
diffContext.applyServerDiffToSessionAndDOM(jspPath, {
  success: true,
  inSession: true,
  source: 'session',
  hasChanges: true,
  status: 'modified',
  added: 448,
  removed: 157,
  path: 'E:\\SSO\\code\\sso\\pro-vt-sso\\src\\main\\webapp\\WEB-INF\\jsp\\index.jsp',
  diff: '--- a/index.jsp\n+++ b/index.jsp\n@@ -1 +1 @@\n-old\n+new'
});
const syncedChange = diffContext.getRecordedFileChange(jspPath);
assert.equal(syncedChange.serverSynced, true);
assert.equal(syncedChange.status, 'modified');
assert.equal(syncedChange.added, 448);
assert.equal(syncedChange.removed, 157);
assert.ok(mockDiffRow.pill.outerHTML.includes('SỬA'), 'Inline tool diff bar pill must update to SỬA');
assert.ok(mockDiffRow.stats.outerHTML.includes('+448') && mockDiffRow.stats.outerHTML.includes('-157'), 'Inline tool diff bar stats must update from +597 -0 to +448 -157');
assert.equal(mockBadge.icon.textContent, '📝');
assert.ok(mockBadge.diffPill.innerHTML.includes('+448') && mockBadge.diffPill.innerHTML.includes('-157'), 'Inline path badge must update to +448 -157');

// Historical scroll-up lazy render must not overwrite server-synced session diff
diffContext.recordToolMutationsInSession(mut1, false);
assert.equal(diffContext.getRecordedFileChange(jspPath).added, 448);
assert.equal(diffContext.getRecordedFileChange(jspPath).removed, 157);

// Failed edit tool calls (even with isError=false in legacy rows) must NOT record false diffs
const ctrlPath = 'pro-vt-sso/src/main/java/com/viettel/manageruser/controller/ManagerUserController.java';
const failedEditMuts = diffContext.extractToolFileMutations(
  'edit',
  { path: ctrlPath, before: 'old line', after: 'UserAccountRole.keepExistingAccountRoles();' },
  'No match found for the specified text.\n\nDid you mean:\n...',
  false
);
assert.equal(failedEditMuts.length, 0, 'Failed edit output must not produce false file mutations');

// Sequential Python shell replacements must chain overlapping snippets into net session diff
const pyCmd1 = `python -c "from pathlib import Path; p=Path('${ctrlPath}'); b=p.read_bytes(); old=b'if (!rolesBOList.isEmpty()) {\\r\\n    usersFormUpdate.setRoleCode(rolesBOList.get(0).getRoleCode());'; new=b'if (rolesBOList != null && !rolesBOList.isEmpty()) {\\r\\n    RolesBO accountRole = rolesBOList.get(0);\\r\\n    usersFormUpdate.setRoleCode(accountRole.getRoleCode());\\r\\n    UserAccountRole.keep(roleMap, accountRole);'; assert b.count(old)==1; p.write_bytes(b.replace(old,new))"`;
const pyCmd2 = `python -c "from pathlib import Path; p=Path('${ctrlPath}'); b=p.read_bytes(); old=b'    UserAccountRole.keep(roleMap, accountRole);'; new=b'    roleMap.put(accountRole.getRoleCode(), accountRole.getRoleName());'; assert b.count(old)==1; p.write_bytes(b.replace(old,new))"`;
diffContext.recordToolMutationsInSession(diffContext.extractToolFileMutations('shell', { command: pyCmd1 }, 'OK', false), false);
diffContext.recordToolMutationsInSession(diffContext.extractToolFileMutations('shell', { command: pyCmd2 }, 'OK', false), false);
const ctrlChange = diffContext.getRecordedFileChange(ctrlPath);
assert.ok(ctrlChange, 'Python shell replacement on ManagerUserController.java must be tracked');
assert.ok(ctrlChange.diff.includes('roleMap.put(accountRole.getRoleCode(), accountRole.getRoleName());'), 'Chained Python edit must reflect final code');
assert.ok(!ctrlChange.diff.includes('UserAccountRole.keep'), 'Intermediate overwritten Python snippet must be merged out');

// Scratch file created in session and later deleted via Path(...).unlink() must cancel out
const helperMap = new Map();
const scratchPath = 'update-temp-helper.py';
const scratchWrite = diffContext.extractToolFileMutations('write', {
  path: scratchPath,
  content: "target = 'src/Foo.java'\nupdate(target, 'int a = 1;', 'int a = 2;')\n"
}, 'Created update-temp-helper.py', false, helperMap);
diffContext.recordToolMutationsInSession(scratchWrite, false);
assert.ok(diffContext.getRecordedFileChange(scratchPath), 'Scratch script recorded when created');
const helperRunAndDel = diffContext.extractToolFileMutations('shell', {
  command: `python ${scratchPath} & python -c "from pathlib import Path; Path('${scratchPath}').unlink()"`
}, 'Updated src/Foo.java', false, helperMap);
diffContext.recordToolMutationsInSession(helperRunAndDel, false);
assert.equal(diffContext.getRecordedFileChange(scratchPath), null, 'Deleted scratch file created in same session must cancel out');
assert.ok(diffContext.getRecordedFileChange('src/Foo.java')?.diff.includes('+int a = 2;'), 'Helper python script target mutation must be tracked');

// Diff Viewer CSS & Session-only API checks
const diffCssBlock = html.match(/\.diff-viewer-table\s*\{[\s\S]*?\.diff-viewer-table\s+td\.diff-code\s*\{[\s\S]*?\}/);
assert.ok(diffCssBlock, 'Diff viewer CSS block must exist');
assert.ok(!/\.diff-row-add\s+td\.diff-code/.test(diffCssBlock[0]), 'td.diff-code must not use green text on added rows');
assert.ok(!/\.diff-row-del\s+td\.diff-code/.test(diffCssBlock[0]), 'td.diff-code must not use red text on deleted rows');
assert.ok(/td\.diff-code\s*\{[\s\S]*?color:\s*var\(--text-main\)/.test(diffCssBlock[0]), 'td.diff-code must keep var(--text-main) contrast across themes');
assert.ok(diffCssBlock[0].includes('[data-theme="warm"] .diff-viewer-table tr.diff-row-add'), 'Warm theme green row background rule must exist');
assert.ok(diffCssBlock[0].includes('[data-theme="warm"] .diff-viewer-table tr.diff-row-del'), 'Warm theme red row background rule must exist');
assert.ok(!source.includes('/api/file-diff?'), 'Frontend must not query Git /api/file-diff anymore');
assert.ok(source.includes('/api/session-file-diff?sessionId='), 'Frontend must query session-scoped /api/session-file-diff');
assert.ok(html.includes('± Thay đổi trong phiên'), 'Diff modal tab must clarify session-scoped changes');

// --- Gemini 3.8 Flash adaptive model switch & legacy -high migration ---
const serverSrc = fs.readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
assert.ok(html.includes('id: "ag/gemini-3.8-flash", name: "Gemini 3.8 Flash"'), 'Frontend MODELS must use adaptive ag/gemini-3.8-flash');
assert.ok(serverSrc.includes('id: "ag/gemini-3.8-flash", name: "Gemini 3.8 Flash"'), 'Backend AVAILABLE_MODELS must use adaptive ag/gemini-3.8-flash');
assert.ok(serverSrc.includes('normalizeModelId(data.model)'), 'Backend /api/chat must normalize legacy ag/gemini-3.8-flash-high');

const modelsMatch = html.match(/const MODELS = \[[\s\S]*?\];/);
const modelHelpersMatch = html.match(/const sessionModelsMap = new Map\(\);[\s\S]*?function applySessionModelSelection\(modelId\) \{[\s\S]*?\n    \}/);
assert.ok(modelsMatch && modelHelpersMatch, 'Model helpers must exist in index.html');
const mockStorage = new Map([['ai_hub_session_model:20261102_4', 'ag/gemini-3.8-flash-high']]);
const modelCtx = {
  currentSelectedModel: 'cx/gpt-6.1-sol',
  allSessionsCache: [{ id: '20261102_4', name: 'cai-trang-chu', model: 'ag/gemini-3.8-flash-high' }],
  localStorage: {
    getItem(k) { return mockStorage.has(k) ? mockStorage.get(k) : null; },
    setItem(k, v) { mockStorage.set(k, String(v)); }
  },
  renderModelSelector() {}
};
vm.createContext(modelCtx);
vm.runInContext(`${modelsMatch[0]}\n${modelHelpersMatch[0]}`, modelCtx);
assert.equal(modelCtx.normalizeModelId('ag/gemini-3.8-flash-high'), 'ag/gemini-3.8-flash');
assert.equal(modelCtx.normalizeModelId('ag/gemini-4-argon-high'), 'ag/gemini-4-argon-high');
assert.equal(modelCtx.resolveModelMeta('ag/gemini-3.8-flash-high').id, 'ag/gemini-3.8-flash');
assert.equal(modelCtx.getSessionModel('20261102_4'), 'ag/gemini-3.8-flash');
assert.equal(mockStorage.get('ai_hub_session_model:20261102_4'), 'ag/gemini-3.8-flash');
modelCtx.applySessionModelSelection('ag/gemini-3.8-flash-high');
assert.equal(modelCtx.currentSelectedModel, 'ag/gemini-3.8-flash');

console.log('Chat UI: 177 regression checks passed');
