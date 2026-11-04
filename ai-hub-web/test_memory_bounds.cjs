const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { retainReplayEvent, writeBoundedSse, replayToClient, MAX_REPLAY_BYTES } = require('./sse-buffer.cjs');
const diff = require('./session-file-diff.cjs');
async function main() {
  const ctx = { events: [] };
  for (let id = 1; id <= 100; id++) retainReplayEvent(ctx, { id, event: 'session_file_diffs', payload: { files: [{ path: 'a', added: id }] } });
  assert.equal(ctx.events.length, 1);
  assert.equal(ctx.events[0].payload.files[0].added, 100);
  for (let id = 101; id < 220; id++) retainReplayEvent(ctx, { id, event: 'text', payload: { text: 'x'.repeat(100000) } });
  assert.ok(ctx.replayBytes <= MAX_REPLAY_BYTES);
  assert.ok(ctx.replayTruncated);
  let destroyed = false;
  assert.equal(writeBoundedSse({ writableLength: 3 * 1024 * 1024, destroy() { destroyed = true; }, write() { throw Error('Must not write'); } }, 'test'), false);
  assert.ok(destroyed);
  const client = new EventEmitter();
  let writes = 0;
  client.write = () => { writes++; if (writes === 1) { setImmediate(() => client.emit('drain')); return false; } return true; };
  await replayToClient(client, [{ id: 1, event: 'text', payload: {} }, { id: 2, event: 'text', payload: {} }]);
  assert.equal(writes, 2);
  assert.equal(client.listenerCount('close'), 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-memory-'));
  const sid = 'memory_bounds_' + Date.now();
  try {
    fs.mkdirSync(path.join(dir, '.angular', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.angular', 'cache', 'a.json'), '{}');
    fs.writeFileSync(path.join(dir, 'source.js'), 'old\n');
    const tracker = diff.startTurnSnapshot(dir);
    await tracker.readyPromise;
    assert.ok(![...tracker.preFiles.keys()].some(k => k.includes('.angular')));
    fs.writeFileSync(path.join(dir, '.angular', 'cache', 'a.json'), '{"changed":true}');
    fs.writeFileSync(path.join(dir, 'source.js'), 'new\n');
    const summary = await diff.finalizeTurnSnapshot(tracker, sid, sid);
    assert.equal(summary.length, 1);
    assert.ok(!Object.hasOwn(summary[0], 'diff'), 'Summary excludes full diff');
    assert.match(diff.getSessionSingleFileDiff(sid, 'source.js', dir).diff, /\+new/);
    const incomplete = diff.startTurnSnapshot(dir);
    await incomplete.readyPromise;
    incomplete.isPreScanComplete = false;
    incomplete.preFiles.clear();
    assert.equal(diff.syncTurnChanges(incomplete, sid + '_incomplete', { allowWorkspaceScan: true }).length, 0);
  } finally {
    diff.deleteSessionDiffStore(sid);
    diff.deleteSessionDiffStore(sid + '_incomplete');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('Memory bounds: replay bytes, latest diff, backpressure, drain, cache exclusion, metadata-only and incomplete snapshots passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
