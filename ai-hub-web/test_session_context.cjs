const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, updated_at TEXT, user_set_name BOOLEAN)');
const insert = db.prepare('INSERT INTO sessions (id, name, updated_at) VALUES (?, ?, ?)');
insert.run('20261031_1', 'Existing chat', '2026-10-31');
const children = [];
let handler;
const context = vm.createContext({
  require(name) {
    if (name === 'node:http') return { createServer(callback) { handler = callback; return {}; } };
    if (name === 'node:fs') return {
      ...fs,
      existsSync: () => true,
      readFileSync: () => '[]',
      writeFileSync() {}
    };
    if (name === 'node:sqlite') return { DatabaseSync: function () {
      return { prepare: sql => db.prepare(sql), close() {} };
    } };
    if (name === 'node:child_process') return {
      execSync() { throw new Error('Unexpected subprocess'); },
      spawn(executable, args) {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 100 + children.length;
        child.args = args;
        children.push(child);
        return child;
      }
    };
    return require(name);
  },
  process: { env: { APPDATA: 'test', NINE_ROUTER_KEY: 'test' }, cwd: () => __dirname, kill() {}, platform: 'win32', on: () => {} },
  console: { log() {}, warn() {}, error() {} },
  __dirname, URL, setTimeout, clearTimeout
});
const serverSource = fs.readFileSync('server.js', 'utf8');
vm.runInContext(serverSource.slice(0, serverSource.indexOf('\nserver.listen(')), context);
function chat(payload) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/api/chat';
  req.headers = { host: 'localhost' };
  const res = new EventEmitter();
  res.chunks = '';
  res.setHeader = () => {};
  res.writeHead = code => { res.status = code; };
  res.write = text => { res.chunks += text; };
  res.end = text => { res.chunks += text || ''; res.ended = true; };
  handler(req, res);
  req.emit('data', JSON.stringify({ prompt: 'Follow up', workspace: __dirname, ...payload }));
  req.emit('end');
  return res;
}
function assertResume(child, id) {
  assert.ok(child.args.includes('--resume'));
  assert.equal(child.args[child.args.indexOf('--session-id') + 1], id);
  assert.ok(!child.args.includes('--name'));
}
// Existing IDs resume even if the client omits or disables the resume flag.
let res = chat({ sessionId: '20261031_1', resume: false });
assert.equal(res.status, 200);
assertResume(children[0], '20261031_1');
children[0].stdout.emit('data', Buffer.from('( O)> resuming openai\n__) 20261031_1\nL L goose is ready\n'));
assert.ok(!res.chunks.includes('event: text\n'));
assert.ok(res.chunks.includes('event: raw_log\n'));
children[0].stdout.emit('data', Buffer.from(JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Actual answer' }] } }) + '\n'));
assert.ok(res.chunks.includes('event: text\n'));
assert.ok(res.chunks.includes('Actual answer'));
children[0].emit('close', 0);
// Names resolve to real IDs, including after the server loses its in-memory state.
res = chat({ sessionId: 'Existing chat' });
assertResume(children[1], '20261031_1');
children[1].emit('close', 0);
// Missing sessions must not silently discard the conversation history.
res = chat({ sessionId: 'missing-session', resume: true });
assert.equal(res.status, 404);
assert.equal(children.length, 2);
// Only the first question creates a new session.
res = chat({});
const first = children[2];
assert.ok(!first.args.includes('--resume'));
const name = first.args[first.args.indexOf('--name') + 1];
assert.ok(name.startsWith('session_'));
insert.run('20261031_2', name, '2026-10-31');
first.emit('close', 0);
assert.match(res.chunks, /"session_id":"20261031_2"/);
res = chat({ sessionId: '20261031_2' });
assertResume(children[3], '20261031_2');
// A stale close callback cannot close the replacement session's stream.
const next = chat({ sessionId: '20261031_1' });
children[3].emit('close', 0);
assert.ok(!next.ended);
children[4].emit('close', 0);
assert.ok(next.ended);
// The UI must accept the real ID even after receiving the temporary name.
const html = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
assert.ok(html.includes('streamSessionId && streamSessionId !== currentSessionId'));
assert.ok(html.includes('resume: !!currentSessionId'));
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
for (const script of scripts) new vm.Script(script[1]);
db.close();
console.log('Session context: existing ID/name, missing session, two-turn continuity, stale process and UI syntax checks passed');
