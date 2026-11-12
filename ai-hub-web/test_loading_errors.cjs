const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const code = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
new vm.Script(code);
const start = code.indexOf('    function buildInlineErrorHtml(');
const end = code.indexOf('    function buildWorkspaceTreeSkeletonHtml(', start);
const classes = new Set();
const host = { children: [], appendChild(el) { this.children.push(el); } };
function element() {
  return { style: {}, children: [], setAttribute() {}, addEventListener() {}, append(...els) { this.children.push(...els); }, remove() { host.children = host.children.filter(el => el !== this); } };
}
const timers = new Map();
let timer = 0;
const ctx = {
  escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  document: { createElement: element, getElementById: id => id === 'toastContainer' ? host : { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } } },
  setTimeout: fn => { timers.set(++timer, fn); return timer; },
  clearTimeout: id => timers.delete(id)
};
vm.createContext(ctx);
vm.runInContext(code.slice(start, end), ctx);
ctx.showToast('success', 'success');
ctx.showToast('starting', 'info');
assert.equal(host.children.length, 0, 'Routine notifications remain silent');
ctx.showToast('<script>unsafe</script>\ntrace', 'error');
assert.equal(host.children.length, 1, 'Errors use a toast');
assert.equal(host.children[0].children[0].textContent, '<script>unsafe</script>\ntrace', 'Error is assigned as safe text, not HTML');
assert.ok(!html.includes('id="hubInlineErrors"'), 'No persistent sidebar error panel');
ctx.beginTopLoading();
ctx.beginTopLoading();
ctx.endTopLoading();
assert.ok(classes.has('is-loading'), 'Concurrent operation keeps loader visible');
ctx.endTopLoading();
for (const fn of timers.values()) fn();
assert.ok(!classes.has('is-loading'));
ctx.beginTopLoading();
ctx.endTopLoading();
ctx.beginTopLoading();
for (const fn of timers.values()) fn();
assert.ok(classes.has('is-loading'), 'New operation cancels delayed hide');
assert.ok(html.includes('currentPreviewRequestVersion++;'));
assert.ok(html.includes('if (reqVersion !== currentPreviewRequestVersion) return;'));
assert.ok(html.includes('prefers-reduced-motion: reduce'));
const chatLoader = code.slice(code.indexOf('    function buildChatFeedSkeletonHtml('), code.indexOf('    function buildFolderExplorerSkeletonHtml('));
assert.equal((chatLoader.match(/hub-inline-spinner/g) || []).length, 1, 'Chat session uses one loading indicator');
assert.ok(!chatLoader.includes('hub-skeleton'), 'Do not simulate loading question and answer bubbles');
assert.match(html, /\[data-theme="warm"\] #filePreviewContent\.hljs\s*\{\s*background: var\(--bg-surface\);\s*color: var\(--text-main\);/, 'Warm full-file code overrides the highlighter dark background');
const syntaxStart = code.indexOf('    function getPreviewSyntaxLanguage(');
const syntaxEnd = code.indexOf('    function renderDiffTableIntoModal(', syntaxStart);
ctx.window = {};
vm.runInContext(code.slice(syntaxStart, syntaxEnd), ctx);
assert.equal(ctx.getPreviewSyntaxLanguage('Controller.java'), 'java');
assert.equal(ctx.getPreviewSyntaxLanguage('index.jsp'), 'xml');
assert.equal(ctx.highlightDiffCodeLine('<unsafe>', 'java'), '&lt;unsafe&gt;');
ctx.window.hljs = { getLanguage: () => true, highlight: () => ({ value: '<span class="hljs-keyword">public</span>' }) };
assert.ok(ctx.highlightDiffCodeLine('public', 'java').includes('hljs-keyword'));
console.log('Loading, inline errors and diff syntax highlighting checks passed');
