const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { BrowserHub } = require('./browser-broker.cjs');
const { BROWSER_INSTRUCTION, browserAvailable } = require('./browser-mcp.cjs');
(async () => {
  assert.equal(typeof browserAvailable(), 'boolean');
  assert.match(BROWSER_INSTRUCTION, /personal Chrome/);
  assert.match(BROWSER_INSTRUCTION, /untrusted data/);
  assert.match(BROWSER_INSTRUCTION, /Do not use chrome_devtools or chrome_devtools_sso by default/);
  assert.match(BROWSER_INSTRUCTION, /Do not list tabs, connect to Chrome, take snapshots\/screenshots/);
  assert.match(BROWSER_INSTRUCTION, /prefer filesystem, shell, tests, or HTTP tools/);
  assert.match(BROWSER_INSTRUCTION, /ask first/);
  assert.match(BROWSER_INSTRUCTION, /This policy applies to both Chrome connections/);
  let starts = 0, active = 0, maximum = 0, initializations = 0;
  const hub = new BrowserHub(() => {
    starts++;
    const child = new EventEmitter(); child.stdout = new PassThrough();
    child.kill = () => child.emit('exit', 1);
    child.stdin = new Writable({ write(chunk, encoding, done) {
      const msg = JSON.parse(chunk.toString()); done();
      if (msg.id === undefined) return;
      if (msg.method === 'initialize') initializations++;
      active++; maximum = Math.max(maximum, active);
      setTimeout(() => {
        active--;
        child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake' } } : { content: [{ type: 'text', text: msg.params?.name || 'tools' }] } }) + '\n');
      }, 5);
    } });
    return child;
  });
  await Promise.all([hub.handle({ method: 'initialize', params: {} }), hub.handle({ method: 'initialize', params: {} })]);
  assert.equal(starts, 1); assert.equal(initializations, 1);
  const results = await Promise.all(['first', 'second', 'third'].map(name => hub.handle({ method: 'tools/call', params: { name } })));
  assert.equal(maximum, 1);
  assert.deepEqual(results.map(x => x.content[0].text), ['first', 'second', 'third']);
  assert.equal(starts, 1);
  await assert.rejects(hub.handle({ method: 'unsupported' }), /Unsupported/);

  const dev = require('./browser-dev.cjs');
  const originalEnsure = dev.ensureDevChrome;
  let browserStarts = 0;
  const lazyHub = new BrowserHub();
  // Fake only the upstream process; keep the production browser-start branch enabled.
  lazyHub.start = hub.start;
  lazyHub.triggerDoraemon = async () => { assert.ok(browserStarts > 0); };
  dev.ensureDevChrome = async () => { browserStarts++; };
  try {
    await Promise.all([lazyHub.handle({ method: 'initialize', params: {} }), lazyHub.handle({ method: 'initialize', params: {} })]);
    await lazyHub.handle({ method: 'tools/list' });
    await lazyHub.handle({ method: 'ping' });
    assert.equal(browserStarts, 0, 'handshake and discovery must not open Chrome');
    const beforeCalls = maximum;
    const lazyResults = await Promise.all(['lazy-first', 'lazy-second'].map(name => lazyHub.handle({ method: 'tools/call', params: { name } })));
    assert.equal(browserStarts, 2, 'each action checks the endpoint inside the serialized queue');
    assert.equal(maximum, beforeCalls, 'lazy startup preserves serialization');
    assert.deepEqual(lazyResults.map(x => x.content[0].text), ['lazy-first', 'lazy-second']);

    dev.ensureDevChrome = async () => { throw new Error('Chrome unavailable'); };
    await assert.rejects(lazyHub.handle({ method: 'tools/call', params: { name: 'blocked' } }), /Chrome unavailable/);
    dev.ensureDevChrome = async () => { browserStarts++; };
    const recovered = await lazyHub.handle({ method: 'tools/call', params: { name: 'recovered' } });
    assert.equal(recovered.content[0].text, 'recovered', 'failed startup must not poison the queue');
  } finally {
    dev.ensureDevChrome = originalEnsure;
  }
  const broker = fs.readFileSync(path.join(__dirname, 'browser-broker.cjs'), 'utf8');
  assert.ok(broker.includes("'--autoConnect'"));
  assert.ok(!broker.includes('--remote-debugging-port'));
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(server.includes('browserEnabled && !savedBrowser'));
  assert.ok(!server.includes('AI_HUB_BROWSER_SESSION'));
  console.log('Shared browser: single upstream initialization, cross-client request serialization, routing and personal Chrome guards passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
