const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, working_dir TEXT, created_at TEXT, updated_at TEXT, user_set_name BOOLEAN, archived_at TEXT, session_type TEXT, parent_session_id TEXT, provider_name TEXT, model_config_json TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content_json TEXT);
CREATE TABLE usage_ledger (session_id TEXT);`);

let now = 1_000_000;
const RealDate = Date;
class FakeDate extends RealDate { static now() { return now; } }
const timers = [];
const cleared = new Set();
const spawns = [];
const children = [];
let handler;

const context = vm.createContext({
  require(name) {
    if (name === './browser-mcp.cjs') return { browserAvailable: () => false, BROWSER_INSTRUCTION: '' };
    if (name === 'node:http') return { createServer(cb) { handler = cb; return {}; } };
    if (name === 'node:fs') return { ...fs, existsSync: () => true, readFileSync: () => '[]', writeFileSync() {} };
    if (name === 'node:sqlite') return { DatabaseSync: function () { return { prepare: s => db.prepare(s), exec: s => db.exec(s), close() {} }; } };
    if (name === 'node:child_process') return {
      execSync() { throw new Error('Unexpected subprocess'); },
      spawn(executable, args) {
        spawns.push({ executable, args });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 500 + spawns.length;
        child.args = args;
        child.kill = () => { child.killed = true; };
        if (!/taskkill/i.test(String(executable))) children.push(child);
        return child;
      }
    };
    return require(name);
  },
  process: { env: { APPDATA: 'test', NINE_ROUTER_KEY: 'test' }, cwd: () => __dirname, kill() {}, platform: 'win32', on: () => {} },
  console: { log() {}, warn() {}, error() {} },
  __dirname, URL, setTimeout, clearTimeout,
  Date: FakeDate,
  setInterval(fn, ms) { const t = { fn, ms, id: timers.length, unref() {} }; timers.push(t); return t; },
  clearInterval(t) { if (t) cleared.add(t.id); }
});
const src = fs.readFileSync('server.js', 'utf8');
vm.runInContext(src.slice(0, src.indexOf('\nserver.listen(')), context);

function chat(payload) {
  const req = new EventEmitter();
  req.method = 'POST'; req.url = '/api/chat'; req.headers = { host: 'localhost' };
  const res = new EventEmitter();
  res.chunks = '';
  res.setHeader = () => {};
  res.writeHead = c => { res.status = c; };
  res.write = t => { res.chunks += t; };
  res.end = t => { res.chunks += t || ''; res.ended = true; };
  handler(req, res);
  req.emit('data', JSON.stringify({ prompt: 'hi', workspace: __dirname, ...payload }));
  req.emit('end');
  return res;
}
const baseTimers = timers.length;
const tick = () => { for (const t of timers.slice(baseTimers)) if (!cleared.has(t.id)) t.fn(); };
const taskkills = () => spawns.filter(s => /taskkill/i.test(String(s.executable)));
const msg = o => Buffer.from(JSON.stringify(o) + '\n');
const WARN = 180000, KILL = 600000;

// 1) Silent model: warn after 3 min, kill after 10 min, error is surfaced.
let res = chat({ prompt: 'silent case' });
assert.equal(res.status, 200);
assert.equal(timers.length - baseTimers, 1, 'watchdog timer created per turn');
assert.equal(timers[baseTimers].ms, 15000);
now += WARN - 1000; tick();
assert.ok(!res.chunks.includes('[WATCHDOG]'), 'no warning before 3 minutes');
now += 2000; tick();
assert.ok(res.chunks.includes('[WATCHDOG]'), 'warning after 3 minutes');
const warnCount = res.chunks.split('[WATCHDOG]').length;
now += 30000; tick();
assert.equal(res.chunks.split('[WATCHDOG]').length, warnCount, 'warning is sent only once');
assert.equal(taskkills().length, 0, 'not killed before 10 minutes');
now += KILL; tick();
assert.equal(taskkills().length, 1, 'killed after 10 minutes');
assert.equal(Array.from(taskkills()[0].args).slice(0, 2).join(' '), '/pid ' + children[0].pid);
assert.ok(taskkills()[0].args.includes('/t') && taskkills()[0].args.includes('/f'));
assert.ok(res.chunks.includes('event: error') && res.chunks.includes('tiếp tục'), 'clear error with recovery hint');
now += KILL; tick();
assert.equal(taskkills().length, 1, 'timer stops after kill (no repeated kill)');
children[0].emit('close', 1);
assert.ok(cleared.has(timers[baseTimers].id), 'timer cleared on close');

// 2) Output resets the idle clock and re-arms the warning.
res = chat({ prompt: 'active case' });
const t2 = timers.length - 1;
const c2 = children[children.length - 1];
now += WARN + 1000; tick();
assert.ok(res.chunks.includes('[WATCHDOG]'));
c2.stdout.emit('data', msg({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } }));
now += KILL - 1000; tick();
assert.equal(taskkills().length, 1, 'activity resets idle clock, no kill');
c2.stderr.emit('data', Buffer.from('some stderr\n'));
now += KILL - 1000; tick();
assert.equal(taskkills().length, 1, 'stderr counts as activity');
c2.emit('close', 0);
assert.ok(cleared.has(timers[t2].id));

// 3) A long-running tool must never be killed; kill resumes after the tool response.
res = chat({ prompt: 'tool case' });
const t3 = timers.length - 1;
const c3 = children[children.length - 1];
c3.stdout.emit('data', msg({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolRequest', id: 'call_1', toolCall: { value: { name: 'shell', arguments: { command: 'build' } } } }] } }));
now += KILL * 3; tick();
assert.equal(taskkills().length, 1, 'running tool is not killed');
assert.ok(!res.chunks.includes('[WATCHDOG]'), 'no warning while a tool runs');
c3.stdout.emit('data', msg({ type: 'toolResponse', id: 'call_1', toolResult: { status: 'success', value: { content: [{ type: 'text', text: 'done' }] } } }));
now += KILL + 1000; tick();
assert.equal(taskkills().length, 2, 'silence after the tool finished is killed');
assert.equal(taskkills()[1].args[1], String(c3.pid));
c3.emit('close', 1);

// 4) Parallel tool calls in one chunk are balanced correctly.
res = chat({ prompt: 'parallel tools' });
const c4 = children[children.length - 1];
c4.stdout.emit('data', Buffer.concat([
  msg({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolRequest', id: 'a', toolCall: { value: { name: 'shell', arguments: {} } } }] } }),
  msg({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolRequest', id: 'b', toolCall: { value: { name: 'shell', arguments: {} } } }] } })
]));
c4.stdout.emit('data', msg({ type: 'toolResponse', id: 'a', toolResult: { status: 'success', value: { content: [{ type: 'text', text: 'x' }] } } }));
now += KILL * 2; tick();
assert.equal(taskkills().length, 2, 'one tool still pending, not killed');
c4.stdout.emit('data', msg({ type: 'toolResponse', id: 'b', toolResult: { status: 'success', value: { content: [{ type: 'text', text: 'y' }] } } }));
now += KILL + 1000; tick();
assert.equal(taskkills().length, 3, 'killed once all tools finished and silence persists');
c4.emit('close', 1);

// 5) Source guard: timer is unref'd and cleared on error.
assert.ok(/stallTimer\.unref/.test(src) && /child\.on\("error", \(\) => clearInterval\(stallTimer\)\)/.test(src));
console.log('Stall watchdog: warn once, kill after idle, activity reset, running tools protected, parallel tools and cleanup passed');
