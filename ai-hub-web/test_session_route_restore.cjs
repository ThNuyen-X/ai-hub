'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const declaration = html.match(/let allowAutoReconnect = (true|false);/)[0];
const start = html.indexOf('    async function restoreSessionFromUrl(');
const end = html.indexOf("    window.addEventListener('popstate'", start);
assert.ok(start > 0 && end > start);
const selections = [];
const context = vm.createContext({
  URL, window: { location: { href: 'http://localhost/workspace/selected-chat' } },
  allSessionsCache: [
    { id: 'selected', name: 'Selected', cwd: 'D:/workspace', slug: 'selected-chat' },
    { id: 'running', name: 'Running', cwd: 'D:/workspace', slug: 'running-chat', isRunning: true }
  ],
  sessionRouteSlug: s => s.slug, workspaceRouteSlug: () => 'workspace',
  currentWorkspace: 'D:/workspace', currentSessionId: null,
  currentSessionFolder: {}, currentSessionFolderTag: {}, heroWorkspaceLabel: {},
  localStorage: { getItem: () => null },
  updateSessionUrl: id => selections.push(['url', id]),
  selectSession: async id => { context.currentSessionId = id; selections.push(['select', id]); },
  newSession: () => selections.push(['home']),
  currentSessionTitle: {}
});
vm.runInContext(declaration + '\n' + html.slice(start, end), context);
(async () => {
  // Sidebar/API loading occurs before restoreSessionFromUrl; it must not schedule a different chat.
  assert.equal(vm.runInContext('allowAutoReconnect', context), false);
  await context.restoreSessionFromUrl();
  assert.deepEqual(selections, [['select', 'selected'], ['url', 'selected']]);
  assert.equal(context.currentSessionId, 'selected');
  assert.equal(vm.runInContext('allowAutoReconnect', context), false);
  selections.length = 0;
  context.window.location.href = 'http://localhost/';
  await context.restoreSessionFromUrl();
  assert.deepEqual(selections, [['home']], 'Home must not jump to the running chat either');
  console.log('Session routing: reload honors URL before background running-session discovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
