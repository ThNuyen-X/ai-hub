'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTurnScratch, cleanupTurnScratch, scratchInstruction } = require('./session-scratch.cjs');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-scratch-test-'));
  try {
    const env = { AI_HUB_SCRATCH_ROOT: root };
    const a = createTurnScratch('D:/project', '../../session', env);
    const b = createTurnScratch('D:/project', '../../session', env);
    const c = createTurnScratch('E:/project', '../../session', env);
    assert.equal(a.session, b.session);
    assert.notEqual(a.dir, b.dir);
    assert.notEqual(a.workspace, c.workspace);
    fs.writeFileSync(path.join(a.dir, 'crop.png'), 'scratch');
    fs.writeFileSync(path.join(b.dir, 'helper.py'), 'keep while running');
    assert.equal(await cleanupTurnScratch(a), true);
    assert.equal(fs.existsSync(a.dir), false);
    assert.equal(fs.existsSync(b.dir), true);
    assert.equal(await cleanupTurnScratch({ ...b, token: 'wrong' }), false);
    assert.equal(await cleanupTurnScratch(b), true);
    assert.equal(await cleanupTurnScratch(c), true);
    assert.equal(await cleanupTurnScratch(a), false);
    assert.ok(scratchInstruction(a.dir).includes('NOT the project workspace'));
    assert.ok(scratchInstruction(a.dir).includes('deliverables'));
    const expanded = createTurnScratch('D:/project', 'expanded', {
      LOCALAPPDATA: root,
      AI_HUB_SCRATCH_ROOT: '%localappdata%/ai-hub/scratch'
    });
    assert.equal(expanded.root, path.join(root, 'ai-hub', 'scratch'));
    assert.equal(expanded.dir.includes('%'), false);
    assert.equal(await cleanupTurnScratch(expanded), true);
    const unresolved = createTurnScratch('D:/project', 'unresolved', {
      AI_HUB_SCRATCH_ROOT: '%AI_HUB_UNKNOWN_SCRATCH_VARIABLE%/scratch'
    });
    assert.equal(unresolved.dir.includes('%'), false);
    assert.equal(await cleanupTurnScratch(unresolved), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('Scratch: workspace/session isolation, per-turn ownership and safe cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
