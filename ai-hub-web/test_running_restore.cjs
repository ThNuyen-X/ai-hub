const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('    function restoreRunningResponse(');
const end = html.indexOf('    async function reconnectRunningSession(', start);
const calls = [];
const ctx = vm.createContext({
  handleSessionStreamEvent: (event) => calls.push(event),
  appendAiText: (_, text) => calls.push(text),
  appendAiThinking: (_, text) => calls.push(text),
  appendToolCard: () => calls.push('tool'),
  flushAiTextRender: () => {}
});
vm.runInContext(html.slice(start, end), ctx);
const container = { historyItem: { rawContent: [] } };
ctx.restoreRunningResponse(container, { replayEvents: [{ id: 8, event: 'text', payload: { text: 'restored' } }], replayEventId: 8 }, { rawContent: [{ type: 'text', text: 'duplicate' }] });
assert.equal(calls.length, 1);
assert.equal(calls[0].text, 'restored');
assert.equal(container.replayEventId, 8);
calls.length = 0;
ctx.restoreRunningResponse(container, {}, { rawContent: [{ type: 'text', text: 'SQLite fallback' }, { type: 'thinking', thinking: 'thought' }, { type: 'toolRequest', name: 'shell' }] });
assert.deepEqual(calls, ['SQLite fallback', 'thought', 'tool']);
assert.equal(container.historyItem.rawContent.length, 3);
assert.ok(html.includes("'&lastEventId=' + replayCursor"));
assert.ok(html.includes('runningItem = items.pop();'));
const server = fs.readFileSync('server.js', 'utf8');
assert.ok(server.includes('replayEvents: coalesceSessionEventsForReplay(runningCtx.events || [])'));
console.log('Running restore: replay snapshot, cursor deduplication and SQLite fallback passed');
