'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const start = html.indexOf('    function buildCompactFileStatusHtml(');
const end = html.indexOf('    function expandToolCardOutput(', start);
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const elements = new Map();
function element() {
  const classes = new Set(['hidden']);
  return { innerHTML: '', style: {}, classList: {
    add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x)
  } };
}
const ctx = vm.createContext({
  window: {}, document: { createElement: element, getElementById: id => elements.get(id) },
  escapeHtml, escapeJs: x => String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  closeActiveThoughtIfNeeded() {}, flushAiTextRender() {}, moveActiveTextToProcessGroup() {},
  appendTerminalLog() {}, formatToolOutputForDisplay: text => ({ text }),
  ensureAiProcessGroup: () => ({ appendChild() {} }), updateAiProcessGroupSummary() {},
  getToolArgumentsClipboardText: () => '', currentWorkspace: 'D:/work', notifyNewMessageArrived() {},
  extractToolFileMutations: () => [], _sessionHelperScriptsMap: new Map(),
  _sessionHistoryMutationsSeeded: true, recordToolMutationsInSession() {},
  _toolCardMutationsByKey: new Map(), getRecordedFileChange: () => null,
  buildToolFileStatusPillHtml: () => '',
  buildToolFileStatsHtml: (status, added, removed) => `<span>+${added}</span><span>-${removed}</span>`
});
vm.runInContext(html.slice(start, end), ctx);
function header(card) { return card.innerHTML.slice(0, card.innerHTML.indexOf('<div id="fileDiffBar_')); }
for (const name of ['edit', 'developer__write', 'patch', 'replace']) {
  for (const [running, error, label] of [[true, false, 'Đang chạy'], [false, false, 'Hoàn thành'], [false, true, 'Lỗi']]) {
    const card = ctx.appendToolCard({ isHistorical: true }, name, { path: 'D:\\work\\long directory\\example.js' }, running, '', error);
    const h = header(card);
    assert.ok(h.includes('>example.js</button>'));
    assert.ok(h.includes(`aria-label="${label}"`));
    assert.ok(!h.includes('Chỉnh sửa file'));
    assert.ok(!h.includes('>Hoàn thành<'));
    assert.ok(!h.includes('Xem +/-'));
    assert.ok(h.includes('min-w-0'));
    const status = element();
    elements.set('badge_' + card.id, status);
    ctx.updateToolCardResult(card, '', error);
    assert.ok(status.innerHTML.includes(`aria-label="${error ? 'Lỗi' : 'Hoàn thành'}"`));
    assert.ok(!status.innerHTML.includes('workspace-running-spinner'));
  }
}
const shell = ctx.appendToolCard({ isHistorical: true }, 'shell', { command: 'echo OK' });
assert.ok(header(shell).includes('Thực thi Terminal'), 'Non-file tools retain their labels');
const pathHtml = ctx.buildCompactFileNameHtml('D:\\work\\<sample>.js', 'tool_9:0');
assert.ok(pathHtml.includes('&lt;sample&gt;.js</button>'));
assert.ok(pathHtml.includes('data-local-path-action="1"'));
assert.ok(pathHtml.includes('data-mut-key="tool_9:0"'));
assert.ok(pathHtml.includes("event.stopPropagation(); openLocalPath("));
assert.ok(!pathHtml.includes('previewLocalFile'));
assert.ok(ctx.buildCompactFileStatusHtml(true, false).includes('workspace-running-spinner'));

// Exercise the actual inline mutation renderer, including click separation and registration.
const nodes = new Map();
for (const id of ['fileDiffBar_card_test', 'inlineFileDiff_card_test', 'toolFilePath_card_test']) nodes.set('#' + id, element());
const mutation = { path: 'src/example.js', status: 'modified', added: 11, removed: 2 };
ctx.extractToolFileMutations = () => [mutation];
const card = { _cardData: { cardId: 'card_test', toolName: 'edit', args: {}, output: '' }, querySelector: id => nodes.get(id) };
ctx.renderToolCardFileChanges(card);
const name = nodes.get('#toolFilePath_card_test').innerHTML;
const stats = nodes.get('#inlineFileDiff_card_test').innerHTML;
assert.ok(name.includes('>example.js</button>'));
assert.ok(name.includes('data-mut-key="card_test:0"'));
assert.ok(stats.includes('+11') && stats.includes('-2'));
assert.ok(stats.includes("event.stopPropagation(); previewLocalFile('src/example.js', event, 'step-diff', 'card_test:0')"));
assert.ok(!stats.includes('Xem +/-'));
assert.equal(ctx._toolCardMutationsByKey.get('card_test:0'), mutation);
assert.ok(nodes.get('#fileDiffBar_card_test').classList.contains('hidden'));
assert.equal(nodes.get('#fileDiffBar_card_test').innerHTML, '');
ctx.extractToolFileMutations = () => [mutation, { ...mutation, path: 'src/second.js' }];
ctx.renderToolCardFileChanges(card);
assert.ok(!nodes.get('#fileDiffBar_card_test').classList.contains('hidden'));
assert.ok(nodes.get('#inlineFileDiff_card_test').classList.contains('hidden'));
console.log('Compact file header: initial/live states, safe basename, action separation, inline counts and multi-file fallback passed');
