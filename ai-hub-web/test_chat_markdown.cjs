'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const start = html.indexOf('    function parseChatMarkdown(');
const end = html.indexOf('    function renderInternalMessageCard(', start);
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = () => '<pre>custom code toolbar</pre>';
const link = () => '<a>custom path badge</a>';
const customRenderer = { code, link };
const context = vm.createContext({
  escapeHtml, customRenderer,
  marked: {
    Renderer: class Renderer {},
    parse(text, { renderer }) {
      assert.equal(renderer.code, code, 'Preserve custom fenced code rendering');
      assert.equal(renderer.link, link, 'Preserve file links');
      return renderer.html({ text });
    }
  }
});
vm.runInContext(html.slice(start, end), context);
const raw = '</div></div><div style="position:fixed">summary JSX</div><script>alert(1)</script>';
assert.equal(context.parseChatMarkdown(raw), escapeHtml(raw));
assert.equal(context.parseChatMarkdown(''), '');
assert.equal(customRenderer.html, undefined, 'Do not mutate the shared renderer');
context.marked.parse = (text, { renderer }) => renderer.html(text);
assert.equal(context.parseChatMarkdown(raw), escapeHtml(raw), 'Support string HTML tokens');
for (const expression of ["entry.text || ''", "sub.summary || sub.raw || ''", "markdownText || ''", 'answerPart', 'raw']) {
  assert.ok(html.includes(`parseChatMarkdown(${expression})`), `Protect Markdown path: ${expression}`);
  assert.ok(!html.includes(`marked.parse(${expression})`));
}
console.log('Chat Markdown: raw HTML escaped, wrappers protected, custom renderers preserved');
