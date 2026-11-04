const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { installRuntimeDiagnostics } = require('./runtime-diagnostics.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-diagnostics-'));
const runtime = new EventEmitter();
Object.assign(runtime, { pid: 123, ppid: 12, version: process.version,
  memoryUsage: () => ({ rss: 104857600, heapUsed: 20971520 }) });
let diagnostics;
try {
  diagnostics = installRuntimeDiagnostics(dir, runtime);
  runtime.emit('uncaughtExceptionMonitor', new Error('test crash'), 'uncaughtException');
  runtime.emit('warning', new Error('test warning'));
  runtime.emit('exit', 1);
  const file = path.join(dir, 'runtime.log');
  const entries = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(entries.map(e => e.event), ['start', 'uncaught_exception', 'warning', 'exit']);
  assert.equal(entries[0].rssMB, 100);
  assert.equal(entries[0].heapMB, 20);
  assert.match(entries[1].error, /test crash/);
  assert.equal(entries[3].code, 1);
  assert.equal(runtime.listenerCount('uncaughtException'), 0, 'Never suppress fatal exceptions');
  fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1));
  diagnostics.record('rotation_test');
  assert.ok(fs.existsSync(path.join(dir, 'runtime.previous.log')));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).event, 'rotation_test');
  console.log('Runtime diagnostics: crash observation, memory, exit and bounded rotation passed');
} finally {
  if (diagnostics) diagnostics.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
