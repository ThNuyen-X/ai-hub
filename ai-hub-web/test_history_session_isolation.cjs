'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const start = html.indexOf('    let sessionHistoryPage = null;');
const end = html.indexOf('    // Lazy load scroll listener', start);
assert.ok(start > 0 && end > start);
let resolveRequest;
let requests = 0;
let aborted = false;
let banners = 0;
const context = vm.createContext({
  AbortController,
  currentSessionId: 'old-session', sessionViewVersion: 1,
  currentHistoryRenderIndex: 0, currentSessionHistoryItems: [],
  document: {
    getElementById: () => null,
    createElement: () => { banners++; return {}; }
  },
  chatFeed: { insertBefore() {} },
  fetch: () => { requests++; return new Promise(resolve => { resolveRequest = resolve; }); }
});
vm.runInContext(html.slice(start, end), context);
const run = code => vm.runInContext(code, context);
(async () => {
  run("sessionHistoryPage = { hasMore: true, before: 100 }; sessionHistoryConversation = [{ role: 'user', content: 'old' }]; sessionHistoryAbort = new AbortController();");
  context.oldSignal = run('sessionHistoryAbort.signal');
  context.oldSignal.addEventListener('abort', () => { aborted = true; });
  const pending = context.loadMoreSessionHistory();
  assert.equal(requests, 1);
  // Reproduce switching to a fresh chat while the old history request is pending.
  run('sessionViewVersion++; resetSessionHistoryPaging(); currentSessionId = null; currentSessionHistoryItems = []; currentHistoryRenderIndex = 0;');
  assert.ok(aborted);
  assert.equal(run('sessionHistoryPage'), null);
  assert.equal(run('sessionHistoryConversation.length'), 0);
  assert.equal(run('sessionHistoryLoading'), false);
  resolveRequest({ ok: true, json: async () => ({ conversation: [{ role: 'user', content: 'old' }], historyPage: { hasMore: true } }) });
  await pending;
  assert.equal(context.currentSessionHistoryItems.length, 0);
  assert.equal(banners, 0);
  await context.loadMoreSessionHistory();
  assert.equal(await context.fetchOlderSessionHistory(), false);
  assert.equal(requests, 1, 'A new chat must not fetch old history');
  // Even after sending the first new prompt, no previous page state survives.
  context.currentSessionId = 'new-session';
  await context.loadMoreSessionHistory();
  assert.equal(requests, 1);
  assert.equal(banners, 0);
  const newSession = html.slice(html.indexOf('    function newSession('), html.indexOf('    function newSessionInWorkspace('));
  assert.match(newSession, /sessionViewVersion\+\+;\s+resetSessionHistoryPaging\(\);/);
  assert.match(html, /const viewVersion = \+\+sessionViewVersion;\s+resetSessionHistoryPaging\(\);/);
  console.log('PASS: new-chat history isolation, abort, stale responses, and pagination guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
