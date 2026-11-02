'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const start = html.indexOf('window.openFullscreenCode = function');
const end = html.indexOf('window.toggleFullscreenWrap = function', start);
assert.ok(start > 0 && end > start);
const els = {};
function el(id) {
  const c = new Set(['hidden']);
  return els[id] = { id, innerText: '', textContent: '', innerHTML: '', style: {},
    classList: { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x) } };
}
['fullscreenCodeModal', 'fullscreenCodeLang', 'fullscreenCodeContent', 'fullscreenCodeMeta', 'fullscreenCodePre', 'fullscreenWrapBtn'].forEach(el);
let highlighted = 0;
const ctx = vm.createContext({
  window: { _codeSnippets: { code_a: 'int a = 1;\nint b = 2;', code_big: 'x'.repeat(30000) } },
  document: { getElementById: id => els[id] || null },
  soundEffects: { playClick() {} },
  hljs: {
    getLanguage: l => l === 'java',
    highlight: (c) => { highlighted++; return { value: '<span>' + c + '</span>' }; },
    highlightAuto: () => { throw new Error('should not auto-detect large code'); }
  }
});
vm.runInContext('let activeFullscreenCodeId = null; let fullscreenIsWrapped = false;\n' + html.slice(start, end), ctx);

ctx.window.openFullscreenCode('code_a', 'java');
assert.equal(els.fullscreenCodeModal.classList.contains('hidden'), false, 'Modal must open');
assert.ok(els.fullscreenCodeContent.innerHTML.includes('int a = 1;'));
assert.equal(els.fullscreenCodeLang.innerText, 'java');
assert.ok(els.fullscreenCodeMeta.innerText.startsWith('2 dòng'));
assert.equal(highlighted, 1);

els.fullscreenCodeModal.classList.add('hidden');
ctx.window.openFullscreenCode('code_big', '');
assert.equal(els.fullscreenCodeModal.classList.contains('hidden'), false, 'Large code without language must still open');
assert.equal(els.fullscreenCodeContent.textContent.length, 30000);

els.fullscreenCodeModal.classList.add('hidden');
ctx.window.openFullscreenCode('missing', 'java');
assert.equal(els.fullscreenCodeModal.classList.contains('hidden'), false, 'Unknown snippet opens empty instead of throwing');
assert.ok(!/rawCode/.test(html.slice(start, end)), 'rawCode must not be referenced in fullscreen viewer');
console.log('Fullscreen code viewer: opens for highlighted, large and missing snippets');
