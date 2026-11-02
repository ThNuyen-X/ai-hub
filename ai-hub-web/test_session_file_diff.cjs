'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  computeMultiHunkUnifiedDiff,
  startTurnSnapshot,
  captureExplicitToolPaths,
  syncTurnChanges,
  finalizeTurnSnapshot,
  migrateSessionDiffStore,
  deleteSessionDiffStore,
  getSessionFileChangesSummary,
  getSessionSingleFileDiff
} = require('./session-file-diff.cjs');

async function runTests() {
  // 1. Multi-hunk Myers diff calculation with 3 context lines
  const baseLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const nextLines = [...baseLines];
  nextLines[1] = 'line 2 updated';
  nextLines[17] = 'line 18 updated';
  nextLines.splice(18, 0, 'line 18.5 inserted');

  const multi = computeMultiHunkUnifiedDiff(baseLines.join('\n'), nextLines.join('\n'), 'src/Demo.java', 3);
  assert.equal(multi.added, 3);
  assert.equal(multi.removed, 2);
  const hunkCount = (multi.diff.match(/^@@ /gm) || []).length;
  assert.equal(hunkCount, 2, 'Distant changes must split into 2 separate 3-line-context hunks');

  // 2. Per-session baseline isolation (dirty git working tree before session starts must NOT appear in session diff)
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hub-sess-diff-'));
  const tempSessionId = 'test_temp_' + Date.now();
  const realSessionId = 'test_real_' + Date.now();

  try {
    const untouchedDirtyFile = path.join(tmpWorkspace, 'DirtyBeforeSession.java');
    const editedFile = path.join(tmpWorkspace, 'Service.java');
    const deletedFile = path.join(tmpWorkspace, 'Legacy.java');
    const addedFile = path.join(tmpWorkspace, 'NewHelper.java');
    const scratchFile = path.join(tmpWorkspace, 'temp_script.py');

    fs.writeFileSync(untouchedDirtyFile, 'class DirtyBeforeSession { int x = 1; }\n', 'utf8');
    fs.writeFileSync(editedFile, 'class Service {\n  String greet() {\n    return "old";\n  }\n}\n', 'utf8');
    fs.writeFileSync(deletedFile, 'class Legacy {}\n', 'utf8');

    // Turn 1 starts with tempSessionId
    const tracker1 = startTurnSnapshot(tmpWorkspace);
    await tracker1.readyPromise;

    captureExplicitToolPaths(tracker1, tempSessionId, 'edit', { path: 'Service.java' }, tmpWorkspace);
    fs.writeFileSync(editedFile, 'class Service {\n  String greet() {\n    return "step1";\n  }\n}\n', 'utf8');

    const liveUpdates = syncTurnChanges(tracker1, tempSessionId, { explicitOnly: true, allowWorkspaceScan: false });
    assert.equal(liveUpdates.length, 1);
    assert.equal(liveUpdates[0].status, 'modified');
    assert.equal(liveUpdates[0].added, 1);
    assert.equal(liveUpdates[0].removed, 1);

    // Shell script modifies addedFile, deletes Legacy.java, and creates+deletes scratchFile
    fs.writeFileSync(addedFile, 'class NewHelper {\n  int ok = 1;\n}\n', 'utf8');
    fs.writeFileSync(scratchFile, 'print("scratch")\n', 'utf8');
    fs.unlinkSync(scratchFile);
    fs.unlinkSync(deletedFile);

    // Finalize Turn 1 and migrate tempSessionId -> realSessionId
    const finalTurn1 = await finalizeTurnSnapshot(tracker1, tempSessionId, realSessionId);
    assert.equal(finalTurn1.length, 3, 'Only the 3 net changed files in session must be reported');

    // Untouched file must NOT appear
    const dirtyLookup = getSessionSingleFileDiff(realSessionId, 'DirtyBeforeSession.java', tmpWorkspace);
    assert.equal(dirtyLookup.hasChanges, false);

    // Turn 2: further edit Service.java and verify baseline stays locked to pre-Turn-1 ("old" -> "final")
    const tracker2 = startTurnSnapshot(tmpWorkspace);
    await tracker2.readyPromise;
    fs.writeFileSync(editedFile, 'class Service {\n  String greet() {\n    return "final";\n  }\n}\n', 'utf8');
    await finalizeTurnSnapshot(tracker2, realSessionId, realSessionId);

    const serviceDiff = getSessionSingleFileDiff(realSessionId, 'Service.java', tmpWorkspace);
    assert.equal(serviceDiff.inSession, true);
    assert.equal(serviceDiff.hasChanges, true);
    assert.equal(serviceDiff.status, 'modified');
    assert.ok(serviceDiff.diff.includes('-    return "old";'), 'Baseline from start of session must be preserved across turns');
    assert.ok(serviceDiff.diff.includes('+    return "final";'), 'Latest content must be diffed against initial session baseline');
    assert.ok(!serviceDiff.diff.includes('step1'), 'Intermediate turn state must not remain in net session diff');

    // Turn 3: revert Service.java back to its original pre-session content -> must disappear from session changes
    const tracker3 = startTurnSnapshot(tmpWorkspace);
    await tracker3.readyPromise;
    fs.writeFileSync(editedFile, 'class Service {\n  String greet() {\n    return "old";\n  }\n}\n', 'utf8');
    await finalizeTurnSnapshot(tracker3, realSessionId, realSessionId);

    const revertedDiff = getSessionSingleFileDiff(realSessionId, 'Service.java', tmpWorkspace);
    assert.equal(revertedDiff.hasChanges, false, 'File reverted back to pre-session baseline must report hasChanges=false');

    const summary = getSessionFileChangesSummary(realSessionId);
    assert.equal(summary.length, 2, 'Summary must now contain only NewHelper.java (added) and Legacy.java (deleted)');
    assert.ok(summary.some(f => f.relPath === 'NewHelper.java' && f.status === 'added'));
    assert.ok(summary.some(f => f.relPath === 'Legacy.java' && f.status === 'deleted'));

    // Explicit migration helper check
    const migratedId = realSessionId + '_migrated';
    migrateSessionDiffStore(realSessionId, migratedId);
    assert.equal(getSessionFileChangesSummary(migratedId).length, 2);
    deleteSessionDiffStore(migratedId);
  } finally {
    deleteSessionDiffStore(tempSessionId);
    deleteSessionDiffStore(realSessionId);
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }

  console.log('Session file diff engine: all checks passed');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
