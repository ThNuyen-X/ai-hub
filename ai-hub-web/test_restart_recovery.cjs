const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createRecovery } = require('./restart-recovery.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-restart-'));
  const file = path.join(dir, 'checkpoint.json');
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => { received.push(JSON.parse(body)); res.end('{"ok":true}'); });
  });
  const received = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const recovery = createRecovery(file);
    const ctx = { sessionId: 'temp', info: { model: 'model', cwd: dir }, process: { pid: 123 } };
    const resolve = () => ({ id: 'real' });
    function reset() { fs.rmSync(file, { force: true }); recovery.checkpoint([ctx, ctx], resolve); }
    function arm(age = Date.now()) {
      const data = recovery.read(); data.armed = true; data.ownerPid = 999999; data.createdAt = age;
      fs.writeFileSync(file, JSON.stringify(data));
    }
    reset();
    assert.equal(recovery.read().jobs.length, 1);
    assert.throws(() => recovery.checkpoint([ctx], resolve), /already scheduled/);
    const calls = [];
    await recovery.recover(async data => calls.push(data), () => false);
    assert.equal(calls.length, 0, 'Unarmed checkpoints must never resume');
    arm();
    const submit = async payload => {
      calls.push(payload);
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
        method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(3000)
      });
      assert.equal(response.status, 200); await response.json();
    };
    await Promise.all([recovery.recover(submit, () => false), recovery.recover(submit, () => false)]);
    await recovery.recover(submit, () => false);
    assert.equal(calls.length, 1);
    assert.equal(received.length, 1);
    assert.equal(received[0].sessionId, 'real');
    assert.match(received[0].prompt, /Do not repeat completed/);
    reset(); recovery.complete('real'); arm();
    await recovery.recover(submit, () => false);
    assert.equal(calls.length, 1, 'Completed tasks are not restarted');
    reset(); arm();
    await recovery.recover(async () => { throw Error('ambiguous'); }, () => false);
    await recovery.recover(submit, () => false);
    assert.equal(recovery.read().jobs[0].state, 'failed');
    reset(); arm(); await recovery.recover(submit, () => true);
    assert.equal(recovery.read().jobs[0].state, 'blocked_old_process');
    reset(); arm(1); await recovery.recover(submit, () => false);
    assert.equal(recovery.read().jobs[0].state, 'expired');
    fs.rmSync(file); assert.throws(() => recovery.checkpoint([ctx], () => null), /unsaved/);
    fs.writeFileSync(file, '{broken');
    await assert.rejects(recovery.recover(submit, () => false));
    assert.equal(calls.length, 1);
    console.log('Restart recovery: real HTTP handoff, concurrent dedup, arming, completion, stale/corrupt checkpoint and failure safety passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
