const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('    function consumeEventSourceStream(');
const end = html.indexOf('    // SSE STREAM CONSUMER (FALLBACK', start);
const sources = [], timers = new Map(), listeners = new Map(), events = [];
let timerId = 0, mode = 'offline', settled = false;
class EventSource {
  static OPEN = 1;
  static CLOSED = 2;
  constructor(url) { this.url = url; this.readyState = 0; this.handlers = {}; sources.push(this); }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  close() { this.readyState = 2; }
}
const target = { addEventListener: (n, fn) => listeners.set(n, fn), removeEventListener: n => listeners.delete(n) };
const context = vm.createContext({
  window: { ...target }, document: { ...target, visibilityState: 'visible' },
  EventSource, AbortSignal, Date, console, encodeURIComponent,
  sessionViewVersion: 1, currentSessionId: 'session', lastRunningToolCard: null,
  closeActiveThoughtIfNeeded() {}, flushAiTextRender() {},
  handleSessionStreamEvent: d => events.push(d),
  setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
  clearTimeout: id => timers.delete(id),
  fetch: async () => {
    if (mode === 'offline') throw new Error('offline');
    return { ok: true, json: async () => [{ id: 'session', isRunning: mode === 'running' }] };
  }
});
vm.runInContext(html.slice(start, end), context);
const ai = { viewVersion: 1, replayEventId: 8, finishProgress() {} };
const done = context.consumeEventSourceStream('session', ai).then(() => { settled = true; });
const tick = async () => { const entry = timers.entries().next().value; assert.ok(entry); timers.delete(entry[0]); await entry[1](); await new Promise(setImmediate); };
(async () => {
  sources[0].handlers.text({ data: '{"type":"text","text":"hello"}', lastEventId: '9' });
  sources[0].readyState = 2;
  sources[0].onerror();
  await tick();
  assert.equal(settled, false, 'offline status must not finish a task');
  assert.equal(timers.size, 1, 'retry while offline');
  mode = 'running';
  await listeners.get('visibilitychange')();
  await new Promise(setImmediate);
  assert.equal(sources.length, 2, 'closed stream rebuilt on tab return');
  assert.ok(sources[1].url.includes('lastEventId=9'), 'resume from last delivered event');
  sources[1].handlers.text({ data: '{"type":"text"}', lastEventId: '9' });
  assert.equal(events.length, 1, 'duplicate replay ignored');
  sources[1].readyState = 2;
  mode = 'finished';
  await listeners.get('online')();
  await done;
  assert.equal(settled, true, 'confirmed finished task releases UI');
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0, 'recovery listeners cleaned up');
  console.log('Stream recovery: offline retry, closed stream, visibility, cursor, deduplication and cleanup passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
