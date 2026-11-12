const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
let saved = '{}', refreshes = 0;
const listeners = {};
const acknowledgements = [];
const ctx = vm.createContext({
  fetch: (_, options) => {
    acknowledgements.push(JSON.parse(options.body));
    return Promise.resolve({ ok: true });
  },
  localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
  document: { visibilityState: 'visible' },
  window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
  currentSessionId: 'current',
  allSessionsCache: [{ id: 'real', tempName: 'temp' }],
  loadWorkspaceTree: () => { refreshes++; }
});
const start = html.indexOf('    function readUnreadCompletions()');
const end = html.indexOf('    function initHubEvents(', start);
assert.ok(start > 0 && end > start);
vm.runInContext(html.slice(start, end), ctx);
ctx.recordUnreadCompletion({ sessionId: 'other' });
assert.equal(ctx.isSessionUnread({ id: 'other' }), true);
ctx.recordUnreadCompletion({ sessionId: 'other' });
assert.equal(Object.keys(JSON.parse(saved)).length, 1, 'Counts sessions, not completed turns');
assert.equal(ctx.isSessionUnread({ id: 'other', isRunning: true }), false);
ctx.recordUnreadCompletion({ sessionId: 'current' });
assert.equal(ctx.isSessionUnread({ id: 'current' }), false, 'Visible current session is read');
assert.equal(acknowledgements.at(-1).sessionId, 'current', 'Visible completion acknowledges server unread state');
ctx.currentSessionId = 'temp';
ctx.recordUnreadCompletion({ sessionId: 'real', tempName: 'temp' });
assert.equal(acknowledgements.at(-1).sessionId, 'real');
assert.equal(acknowledgements.at(-1).tempName, 'temp');
ctx.currentSessionId = 'current';
const acknowledgedBeforeHidden = acknowledgements.length;
ctx.document.visibilityState = 'hidden';
ctx.recordUnreadCompletion({ sessionId: 'current' });
assert.equal(acknowledgements.length, acknowledgedBeforeHidden, 'Hidden completion remains unread on server');
assert.equal(ctx.isSessionUnread({ id: 'current' }), true);
ctx.markSessionRead('current');
assert.equal(ctx.isSessionUnread({ id: 'current' }), true, 'Hidden tab cannot mark read');
ctx.document.visibilityState = 'visible';
ctx.markSessionRead('current');
assert.equal(ctx.isSessionUnread({ id: 'current' }), false);
assert.ok(refreshes > 0);
ctx.recordUnreadCompletion({ sessionId: 'temp' });
ctx.recordUnreadCompletion({ sessionId: 'real', tempName: 'temp' });
assert.equal(Object.hasOwn(JSON.parse(saved), 'temp'), false);
assert.equal(ctx.isSessionUnread({ id: 'real' }), true);
ctx.markSessionRead('temp');
assert.equal(ctx.isSessionUnread({ id: 'real' }), false, 'Opening alias clears real ID');
listeners.storage({ key: 'ai_hub_unread_completions' });
assert.ok(refreshes >= 3);
const syncStart = html.indexOf("        hubSource.addEventListener('unread_sync'");
const syncEnd = html.indexOf("        hubSource.addEventListener('sessions_updated'", syncStart);
let syncUnread;
ctx.hubSource = { addEventListener: (_, fn) => { syncUnread = fn; } };
vm.runInContext(html.slice(syncStart, syncEnd), ctx);
saved = '{}';
ctx.currentSessionId = 'temp';
syncUnread({ data: JSON.stringify({ unread: ['real', 'temp', 'background'] }) });
assert.equal(ctx.isSessionUnread({ id: 'real', tempName: 'temp' }), false);
assert.equal(ctx.isSessionUnread({ id: 'background' }), true);
assert.equal(acknowledgements.at(-1).sessionId, 'real', 'Reconnect acknowledges selected session on server');
assert.equal(acknowledgements.at(-1).tempName, 'temp');
const beforeHiddenSync = acknowledgements.length;
ctx.document.visibilityState = 'hidden';
syncUnread({ data: JSON.stringify({ unread: ['real'] }) });
assert.equal(acknowledgements.length, beforeHiddenSync);
assert.equal(ctx.isSessionUnread({ id: 'real' }), true);
saved = 'invalid JSON';
assert.equal(ctx.isSessionUnread({ id: 'other' }), false);
assert.ok(html.includes('const unreadCount = sessions.filter(isSessionUnread).length;'));
assert.ok(html.includes('workspace-unread-badge'));
assert.ok(html.includes('session-unread-dot'));
assert.ok(!html.includes('background: var(--badge-bg);">${sessions.length}</span>'));
assert.ok(html.includes('markSessionRead(sessionId, data.id);'));
assert.ok(html.includes('if (activeMatch || unreadMatch)'));
assert.ok(html.includes("hubSource.addEventListener('session_read'"));
assert.ok(html.includes("hubSource.addEventListener('unread_sync'"));
assert.ok(html.includes("fetch('/api/sessions/mark-read'"));
const serverJs = fs.readFileSync(__dirname + '/server.js', 'utf8');
assert.ok(serverJs.includes('unreadSessionCompletions'));
assert.ok(serverJs.includes('/api/sessions/mark-read'));
assert.ok(serverJs.includes('session_read'));
assert.ok(serverJs.includes('unread_sync'));
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
console.log('Workspace unread badge: completion dedup, visibility, aliases, persistence, multi-device sync and UI syntax passed');
