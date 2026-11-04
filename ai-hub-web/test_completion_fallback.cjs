const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf("hubSource.addEventListener('session_turn_completed', (e) => {");
const end = html.indexOf("hubSource.addEventListener('session_stopped'", start);
let handler;
let closed = 0;
let refreshed = 0;
const context = {
  hubSource: { addEventListener: (_, callback) => { handler = callback; } },
  currentSessionId: 'real-id', isGenerating: true,
  window: { activeChatEventSource: { _closeAndDone: () => { closed++; } } },
  lastStreamedTurnSessionId: null, lastTurnCompletedAt: 0,
  recordUnreadCompletion: () => {},
  loadWorkspaceTree: () => { refreshed++; }, updateSessionUrl: () => {},
  selectSession: () => {}, currentSessionTitle: null, currentWorkspace: '', Date
};
vm.runInNewContext(html.slice(start, end), context);
handler({ data: JSON.stringify({ sessionId: 'other-id' }) });
assert.equal(closed, 0, 'Do not stop another session');
handler({ data: JSON.stringify({ sessionId: 'real-id' }) });
assert.equal(closed, 1, 'Global completion must release a stuck response stream');
context.currentSessionId = 'temporary-id';
handler({ data: JSON.stringify({ sessionId: 'real-id', tempName: 'temporary-id' }) });
assert.equal(closed, 2, 'Resolve temporary IDs before closing the matching stream');
assert.equal(refreshed, 3);
console.log('Completion fallback: matching session, alias resolution and isolation passed');
