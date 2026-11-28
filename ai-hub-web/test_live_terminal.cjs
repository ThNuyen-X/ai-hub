const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createRuntime, available } = require('./terminal-runtime.cjs');
(async () => {
  assert.ok(available(), 'Install terminal-runtime dependencies before running the integration test');
  const ctx = { sessionId: 'terminal-test', info: { cwd: process.cwd() } };
  const runtime = createRuntime({ resolveSession: id => id === 'terminal-test' ? ctx : null });
  const server = http.createServer((req, res) => runtime.handle(req, res, new URL(req.url, 'http://localhost')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const token = runtime.register(ctx, process.env);
  const other = runtime.register({ sessionId: 'other', info: { cwd: process.cwd() } }, process.env);
  const api = (route, data, capability = token) => fetch(base + route, { method: data ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + capability, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
  let mcp;
  try {
    assert.equal((await api('/api/terminal/internal/run', { command: 'echo forbidden' }, 'wrong')).status, 403);
    const command = `"${process.execPath}" -e "console.log('PTY-START');setTimeout(()=>{console.log('PTY-END')},1200)"`;
    const run = await api('/api/terminal/internal/run', { command, timeout_secs: 15 });
    assert.equal(run.status, 200); const t = await run.json();
    assert.ok(t.pid > 0);
    assert.equal((await api('/api/terminal/internal/wait?terminalId=' + t.terminalId, null, other)).status, 404);
    assert.equal((await fetch(base + '/api/terminal/lookup?sessionId=other&command=' + encodeURIComponent(command)).then(r => r.json())).terminalId, null);
    const stream = await fetch(base + '/api/terminal/stream?sessionId=terminal-test&terminalId=' + t.terminalId);
    const reader = stream.body.getReader();
    let text = ''; let observedLive = false;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
      if (text.includes('PTY-START') && !runtime.terminals.get(t.terminalId).done) observedLive = true;
    }
    assert.ok(observedLive, 'Must deliver actual PTY output before command exits');
    assert.ok(text.includes('PTY-END')); assert.ok(text.includes('event: exit'));
    const result = await api('/api/terminal/internal/wait?terminalId=' + t.terminalId).then(r => r.json());
    assert.equal(result.exitCode, 0); assert.ok(result.output.includes('PTY-END'));
    const reconnect = await fetch(base + '/api/terminal/stream?sessionId=terminal-test&terminalId=' + t.terminalId).then(r => r.text());
    assert.ok(reconnect.includes('PTY-END'), 'Reopening must replay the same terminal, not rerun');
    assert.equal(runtime.terminals.size, 1);
    assert.equal((await fetch(base + '/api/terminal/stop?sessionId=terminal-test&terminalId=' + t.terminalId, { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    for (const file of ['xterm.js', 'fit.js', 'xterm.css']) assert.equal((await fetch(base + '/terminal-assets/' + file)).status, 200);
    const slow = await api('/api/terminal/internal/run', { command: `"${process.execPath}" -e "setTimeout(()=>{},10000)"`, timeout_secs: 1 }).then(r => r.json());
    const timeout = await api('/api/terminal/internal/wait?terminalId=' + slow.terminalId).then(r => r.json());
    assert.equal(timeout.reason, 'Timed out');
    const stopped = await api('/api/terminal/internal/run', { command: `"${process.execPath}" -e "setTimeout(()=>{},10000)"`, timeout_secs: 15 }).then(r => r.json());
    const stopUrl = base + '/api/terminal/stop?sessionId=terminal-test&terminalId=' + stopped.terminalId;
    assert.equal((await fetch(stopUrl, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal((await api('/api/terminal/internal/wait?terminalId=' + stopped.terminalId).then(r => r.json())).reason, 'Stopped by user');
    mcp = spawn(process.execPath, [path.join(__dirname, 'terminal-mcp.cjs')], { env: { ...process.env, AI_HUB_TERMINAL_URL: base, AI_HUB_TERMINAL_TOKEN: token }, windowsHide: true });
    const reply = new Promise((resolve, reject) => { let buffer = ''; mcp.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) { const message = JSON.parse(line); if (message.id === 7) resolve(message); } }); mcp.on('error', reject); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'shell', arguments: { command: 'echo MCP-PTY', timeout_secs: 10 } } }) + '\n');
    const message = await reply; assert.equal(message.result.isError, false); assert.ok(message.result.content[0].text.includes('MCP-PTY'));
    for (const file of ['terminal-runtime.cjs', 'terminal-mcp.cjs', 'public/live-terminal.js']) new vm.Script(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    console.log('Live terminal PTY, streaming, reconnect, isolation, security, cancellation and MCP tests passed');
  } finally { mcp?.kill(); runtime.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
