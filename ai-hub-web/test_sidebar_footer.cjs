'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const footer = html.match(/<details\b[^>]*id="sidebarFooter"[^>]*>([\s\S]*?)<\/details>/);
assert.ok(footer, 'Footer uses native accessible disclosure');
assert.match(footer[0].split('>')[0], /\bopen\b/, 'Footer starts expanded');
assert.match(footer[1], /<summary\b[^>]*aria-label="[^"]+"[^>]*>[\s\S]*?<svg\b[\s\S]*?<\/summary>/);
assert.match(footer[1], /group-open:rotate-0/, 'Chevron reflects expanded state');
for (const id of ['audioToggleBtn', 'themeBtn-dark', 'memePackBtn-doraemon']) {
  assert.ok(footer[1].includes(`id="${id}"`), `${id} remains inside collapsible footer`);
}
assert.ok(!footer[1].includes('id="workspaceTree"'), 'Workspace navigation stays visible');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  new vm.Script(script[1]);
}
console.log('Sidebar footer disclosure and inline syntax passed');
