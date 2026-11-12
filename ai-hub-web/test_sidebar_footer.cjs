'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const footer = html.match(/<details\b[^>]*id="sidebarFooter"[^>]*>([\s\S]*?)<\/aside>/);
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
const start = html.indexOf('    function initSidebarFooterState(');
const end = html.indexOf('\n    initSidebarFooterState();', start);
assert.ok(start >= 0 && end > start);
const saved = new Map();
function mount(storage = {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value)
}) {
  const listeners = {};
  const footer = { open: true, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const context = vm.createContext({ document: { getElementById: () => footer }, localStorage: storage });
  vm.runInContext(html.slice(start, end), context);
  context.initSidebarFooterState();
  return { footer, toggle: () => listeners.toggle() };
}
let view = mount();
assert.equal(view.footer.open, true, 'First visit defaults to expanded');
view.footer.open = false;
view.toggle();
view = mount();
assert.equal(view.footer.open, false, 'Collapsed state survives reload');
view.footer.open = true;
view.toggle();
assert.equal(mount().footer.open, true, 'Expanded state survives reload');
view = mount({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
assert.equal(view.footer.open, true);
assert.doesNotThrow(() => view.toggle());
const earlyScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(code => code.includes("document.getElementById('sidebar').classList.add") || (code.includes("document.getElementById('sidebarFooter').open") && !code.includes('function safeRandomId')));
assert.equal(earlyScripts.length, 2);
const restored = new Set();
const earlyFooter = { open: true };
const earlyContext = vm.createContext({
  window: { innerWidth: 1280 },
  localStorage: { getItem: () => 'true' },
  document: { getElementById: id => id === 'sidebar' ? { classList: { add: value => restored.add(value) } } : earlyFooter }
});
for (const code of earlyScripts) vm.runInContext(code, earlyContext);
assert.ok(restored.has('sidebar-collapsed'), 'Sidebar restored before the main app runs');
assert.equal(earlyFooter.open, false, 'Footer restored before the main app runs');
console.log('Sidebar footer disclosure, early persisted reload state and inline syntax passed');
