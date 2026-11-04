const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSources, analyze } = require('./auxiliary-model.cjs');
const { applyEdits } = require('./auxiliary-work.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-aux-work-'));
  const file = path.join(root, 'source.cjs');
  const edit = { path: 'source.cjs', before: 'const value = 1;', after: 'const value = 2;' };
  try {
    fs.writeFileSync(file, 'const value = 1;\r\nmodule.exports = value;\r\n');
    let sources = readSources(root, [{ path: 'source.cjs', end: 2 }]);
    assert.ok(!JSON.stringify(sources).includes('hash'));
    const result = await applyEdits(root, sources, [edit]);
    assert.equal(result.checks[0].status, 'passed');
    assert.match(fs.readFileSync(file, 'utf8'), /value = 2;\r\n/);
    await assert.rejects(applyEdits(root, sources, [edit]), /changed/);
    sources = readSources(root, [{ path: 'source.cjs', start: 2, end: 2 }]);
    await assert.rejects(applyEdits(root, sources, [{ ...edit, before: 'const value = 2;' }]), /excerpt|scope/);
    await assert.rejects(applyEdits(root, sources, [{ ...edit, path: '../other.cjs' }]), /ENOENT|scope/);
    sources = readSources(root, [{ path: 'source.cjs', end: 2 }]);
    await assert.rejects(applyEdits(root, sources, [{ ...edit, before: 'const value = 2;', after: 'const value = ;' }]), /Syntax check failed/);
    assert.match(fs.readFileSync(file, 'utf8'), /value = 2/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(applyEdits(root, sources, [{ ...edit, before: 'const value = 2;' }], controller.signal), /Syntax check failed|Cancelled/);
    const phases = [];
    const output = await analyze({ task: 'Change value to three', mode: 'edit', files: [{ path: 'source.cjs', end: 2 }] }, {
      AI_HUB_AUX_CWD: root, AI_HUB_AUX_MODEL: 'fake', OPENAI_BASE_URL: 'http://localhost/v1', OPENAI_API_KEY: 'fake'
    }, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 'Updated value', edits: [{ path: 'source.cjs', before: 'const value = 2;', after: 'const value = 3;' }] }) } }] }) }), event => phases.push(event.phase));
    assert.equal(output.changedFiles[0].path, 'source.cjs');
    assert.deepEqual(phases, ['waiting', 'validating', 'completed']);
    assert.match(fs.readFileSync(file, 'utf8'), /value = 3/);
    const compactSources = readSources(root, [{ path: 'source.cjs', start: 1, end: 1 }, { path: 'source.cjs', start: 2, end: 2 }]);
    await applyEdits(root, compactSources, [{ path: 'source.cjs', start: 1, end: 1, after: 'const value = 4;' }]);
    assert.match(fs.readFileSync(file, 'utf8'), /value = 4/);
    const latest = readSources(root, [{ path: 'source.cjs', end: 2 }]);
    await assert.rejects(applyEdits(root, latest, [{ path: 'source.cjs', start: 1, end: 3, after: '' }]), /range/);
    await assert.rejects(applyEdits(root, latest, [{ path: 'source.cjs', start: 1, end: 1, after: 'x' }, { path: 'source.cjs', start: 1, end: 1, after: 'y' }]), /Overlapping/);
    console.log('Auxiliary work: CRLF, scope, concurrent edits, syntax rejection, cancellation and structured edit integration passed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
