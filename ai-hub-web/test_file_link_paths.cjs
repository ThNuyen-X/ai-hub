const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  new vm.Script(match[1]);
}
function extract(start, end) {
  const i = html.indexOf(start);
  assert.ok(i >= 0, start);
  const j = html.indexOf(end, i + start.length);
  assert.ok(j > i, end);
  return html.slice(i, j);
}
const context = vm.createContext({
  hubServerPlatform: 'win32', hubLocalDrives: ['E:', 'D:'],
  getRecordedFileChange: () => null, customRenderer: {},
  renderPathBadgeHtml: (p, text) => ({ kind: 'file', path: p, text }),
  renderWebLinkHtml: (p, text) => ({ kind: 'web', path: p, text })
});
vm.runInContext(extract('    function isLocalFilePath(', '    function buildPathCacheKey('), context);
vm.runInContext(extract('    customRenderer.link = function(', '    customRenderer.codespan = function('), context);
const unicodeName = 'B\u00e1o c\u00e1o tri\u1ec3n khai SSO.docx';
const raw = 'E:/SSO/Document/' + unicodeName;
for (const href of [raw, raw.replace(/ /g, '%20'), 'E:/SSO/Document/' + encodeURIComponent(unicodeName), 'file:///' + raw.replace(/ /g, '%20')]) {
  const result = context.customRenderer.link({ href, text: 'Open Word' });
  assert.equal(result.kind, 'file');
  assert.equal(result.path, raw);
}
for (const name of [unicodeName, 'Document/report.docx', 'report.xlsx', 'manual.pdf', 'clip.mp4']) {
  assert.equal(context.isLocalFilePath(name), true, name);
}
assert.equal(context.customRenderer.link({href: 'E:/report%2520name.docx'}).path, 'E:/report%20name.docx');
assert.doesNotThrow(() => context.customRenderer.link({href: 'E:/bad%ZZ.docx'}));
assert.equal(context.customRenderer.link({href: 'https://example.com/report%20name.docx'}).kind, 'web');
assert.equal(context.customRenderer.link({href: 'javascript:alert(1)'}).kind, 'web');
assert.equal(context.isLocalFilePath('/home/user/report.docx'), false);
console.log('File link paths: encoded spaces, Unicode, one-pass decoding and document/media extensions PASS');
