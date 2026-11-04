const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateModel, readSources, coordinationInstruction, analyze } = require('./auxiliary-model.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-aux-'));
  try {
    fs.writeFileSync(path.join(root, 'source.js'), 'one\ntwo\nthree\n');
    fs.writeFileSync(path.join(root, '.env'), 'PRIVATE=value');
    assert.equal(validateModel('', []), '');
    assert.equal(validateModel('ag/gemini-3.8-flash-high', [{ id: 'ag/gemini-3.8-flash' }]), 'ag/gemini-3.8-flash');
    assert.throws(() => validateModel('bad', []), /Unknown/);
    assert.equal(readSources(root, [{ path: 'source.js', start: 2, end: 2 }])[0].text, '2: two');
    assert.throws(() => readSources(root, [{ path: '../' }]), /outside/i);
    assert.throws(() => readSources(root, [{ path: '.env' }]), /Sensitive/);
    assert.throws(() => readSources(root, [{ path: 'source.js', end: 700 }]), /range/);
    assert.equal(coordinationInstruction(''), '');
    assert.match(coordinationInstruction('example'), /focused edits/);
    const env = { AI_HUB_AUX_CWD: root, AI_HUB_AUX_MODEL: 'test-model', OPENAI_BASE_URL: 'http://localhost/v1', OPENAI_API_KEY: 'test' };
    let request;
    const output = await analyze({ task: 'Find the bug', files: [{ path: 'source.js', start: 2, end: 2 }] }, env, async (url, options) => {
      request = JSON.parse(options.body);
      assert.equal(url, 'http://localhost/v1/chat/completions');
      assert.ok(options.signal);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Diagnosis' } }], usage: { total_tokens: 10 } }) };
    });
    assert.equal(output.result, 'Diagnosis');
    assert.equal(request.model, 'test-model');
    assert.equal(request.tools, undefined);
    assert.ok(!JSON.stringify(output.sources).includes('two'));
    assert.match(request.messages[1].content, /2: two/);
    await assert.rejects(analyze({ task: 'x', files: [] }, env, async () => ({ ok: false, status: 429 })), /429/);
    await assert.rejects(analyze({ task: 'x', files: [] }, env, async () => ({ ok: true, json: async () => ({}) })), /no text/);

    const child = spawn(process.execPath, [path.join(__dirname, 'auxiliary-model.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = [];
    let buffer = '';
    const completed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error('MCP smoke test timed out')); }, 5000);
      child.on('error', reject);
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          responses.push(JSON.parse(buffer.slice(0, newline)));
          buffer = buffer.slice(newline + 1);
          if (responses.length === 2) { clearTimeout(timeout); child.stdin.end(); resolve(); }
        }
      });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    await completed;
    assert.equal(responses[0].result.serverInfo.name, 'auxiliary_model');
    assert.equal(responses[1].result.tools[0].name, 'analyze');
    const realSetTimeout = global.setTimeout;
    global.setTimeout = callback => realSetTimeout(callback, 5);
    try {
      await assert.rejects(analyze({ task: 'x', files: [] }, env, async (_url, options) => {
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      }), /timed out/);
    } finally { global.setTimeout = realSetTimeout; }

    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.match(server, /validateAuxiliaryModel\(data.auxiliaryModel, AVAILABLE_MODELS\)/);
    assert.match(server, /--with-extension/);
    const ui = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
    assert.match(ui, /auxiliaryModel: turnAuxiliaryModel/);
    assert.match(ui, /rememberAuxiliaryModel\(activeSId, turnAuxiliaryModel\)/);
    console.log('Auxiliary model: scope, validation, isolated analysis, errors, MCP and integration passed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
