'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const start = html.indexOf("hubSource.addEventListener('session_turn_completed', (e) => {");
const end = html.indexOf("hubSource.addEventListener('session_stopped'", start);
assert.ok(start > 0 && end > start);
let handler, chimes = 0, refreshes = 0;
const context = vm.createContext({
  hubSource: { addEventListener: (_, fn) => { handler = fn; } },
  currentSessionId: 'current', isGenerating: false,
  lastStreamedTurnSessionId: 'current', lastTurnCompletedAt: Date.now(),
  currentSessionTitle: { innerText: 'Current' }, currentWorkspace: 'D:\\ai-hub',
  recordUnreadCompletion() {}, updateSessionUrl() {}, selectSession() {},
  soundEffects: { playChime: () => { chimes++; } },
  loadWorkspaceTree: () => { refreshes++; }
});
vm.runInContext(html.slice(start, end), context);
handler({ data: JSON.stringify({ sessionId: 'other', cwd: 'D:\\other-workspace' }) });
assert.equal(chimes, 1, 'Other workspace completion must chime');
handler({ data: JSON.stringify({ sessionId: 'current' }) });
assert.equal(chimes, 1, 'Selected session must not duplicate its existing stream chime');
context.currentSessionId = 'temporary';
handler({ data: JSON.stringify({ sessionId: 'real', tempName: 'temporary' }) });
assert.equal(chimes, 1, 'Selected alias must not duplicate stream chime');
assert.equal(context.currentSessionId, 'real');
context.currentSessionId = null;
handler({ data: JSON.stringify({ sessionId: 'another' }) });
assert.equal(chimes, 2, 'Completion must chime even with no selected session');
assert.equal(refreshes, 4);
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
console.log('Background sound: other workspace, selected stream isolation, aliases and no selected session passed');
