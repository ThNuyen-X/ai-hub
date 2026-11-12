const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { findLogPath, findLogPaths, readLogTail, readCommandLog } = require('./terminal-log.cjs');
(async () => {
  assert.equal(findLogPath("$log='E:\\build.log'; & { mvn package } *> $log"), 'E:\\build.log');
  assert.equal(findLogPath('mvn package > "E:\\build.log"'), 'E:\\build.log');
  assert.equal(findLogPath("$log='E:\\build.log'; echo $log"), null);
  assert.equal(findLogPath('mvn package'), null);
  const dir = process.env.AI_HUB_SCRATCH_DIR || process.env.TEMP;
  assert.ok(dir, 'Scratch directory required');
  fs.mkdirSync(dir, { recursive: true });
  const stageName = 'terminal-stage-' + process.pid;
  const stageFiles = [path.join(dir, stageName + '-a.log'), path.join(dir, stageName + '-b.log')];
  const command = `$log=Join-Path $env:TEMP '${stageName}-a.log'; mvn *> $log; $log=Join-Path $env:TEMP '${stageName}-b.log'; docker *> $log`;
  assert.deepEqual(findLogPaths(command, dir), stageFiles);
  assert.deepEqual(findLogPaths(command), []);
  try {
    assert.equal(await readCommandLog(command, dir), null);
    fs.writeFileSync(stageFiles[0], 'package');
    const packageLog = await readCommandLog(command, dir);
    assert.equal(packageLog.text, 'package');
    fs.writeFileSync(stageFiles[1], 'docker');
    assert.equal((await readCommandLog(command, dir, packageLog.version)).text, 'docker');
  } finally { for (const file of stageFiles) if (fs.existsSync(file)) fs.unlinkSync(file); }
  const file = path.join(dir, 'terminal-log-test-' + process.pid + '.log');
  try {
    fs.writeFileSync(file, '\uFEFFhello\r\nworld', 'utf16le');
    const initial = await readLogTail(file);
    assert.equal(initial.text, 'hello\r\nworld');
    const first = readLogTail(file, initial.version);
    assert.equal(readLogTail(file, initial.version), first, 'Concurrent reads must coalesce');
    assert.deepEqual(await first, { unchanged: true, version: initial.version });
    fs.appendFileSync(file, '\r\nnew', 'utf16le');
    assert.equal((await readLogTail(file, initial.version)).text, 'hello\r\nworld\r\nnew');
    fs.writeFileSync(file, 'x'.repeat(90000) + '\nlast line');
    const tail = await readLogTail(file);
    assert.equal(tail.text, 'last line');
    assert.equal(tail.size, 90010);
  } finally { fs.unlinkSync(file); }
  const html = fs.readFileSync('public/index.html', 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  assert.ok(html.includes("openToolTerminal('${cardId}')"));
  assert.ok(html.includes("watch.controller?.abort()"));
  assert.ok(html.includes("pre.style.color = '#e2e8f0'"), 'Live output must contrast with dark terminal in light/warm themes');
  assert.ok(!html.includes("pre.style.color = 'var(--text-main)'"));
  assert.ok(html.includes('#terminalLogsFeed, #liveTerminalOutput { color: #e2e8f0; }'));
  const listeners = {}, nodes = new Map(), timers = new Map();
  let timerId = 0, requests = 0, hidden = false;
  const card = { _cardData: { args: { command: 'build' }, output: '' }, querySelector: () => true };
  const feed = { classList: { add() {}, remove() {} } };
  const document = {
    get hidden() { return hidden; },
    getElementById: id => id === 'card' ? card : nodes.get(id),
    createElement: () => ({ style: {}, remove() { nodes.delete(this.id); } }),
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  const context = vm.createContext({ document, window: { addEventListener() {} },
    currentSessionId: 'session', terminalLogsFeed: feed, terminalAutoScroll: true,
    terminalDrawer: { appendChild(pre) { nodes.set(pre.id, pre); } },
    toggleTerminalDrawer() {}, AbortController, URLSearchParams,
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    async fetch() { requests++; return { ok: true, json: async () => ({ version: 'v1', running: true, text: 'log', file: 'build.log' }) }; }
  });
  vm.runInContext(html.slice(html.indexOf('    let liveTerminalWatch = null;'), html.indexOf('    function toggleTerminalDrawer(forceState)')), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  context.openToolTerminal('card');
  await settle();
  assert.equal(requests, 1);
  hidden = true; listeners.visibilitychange();
  assert.equal(timers.size, 0, 'Hidden tabs must cancel polling');
  hidden = false; listeners.visibilitychange();
  await settle();
  assert.equal(requests, 2, 'Visible tabs resume once');
  context.stopLiveTerminalWatch();
  assert.equal(timers.size, 0);
  assert.equal(nodes.size, 0);
  console.log('Terminal log tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
