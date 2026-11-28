const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { stripVTControlCharacters } = require('node:util');
const runtimeRoot = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'terminal-runtime', 'node_modules');
const assets = {
  '/terminal-assets/xterm.js': ['@xterm/xterm/lib/xterm.js', 'application/javascript'],
  '/terminal-assets/fit.js': ['@xterm/addon-fit/lib/addon-fit.js', 'application/javascript'],
  '/terminal-assets/xterm.css': ['@xterm/xterm/css/xterm.css', 'text/css']
};
const TERMINAL_INSTRUCTION = '\n\n[EMBEDDED LIVE TERMINAL]: Use hub_terminal shell for builds, tests, deployment, SSH and other long-running commands so the user can attach to the actual PTY in the Terminal drawer. Do not rerun a command merely to show its terminal. Stream child stdout/stderr directly; avoid capture_output=True, quiet flags or file-only redirection unless specifically required. Read-only shell inspections may use the ordinary shell tool. The embedded terminal is view-only; do not start commands requiring interactive input. Prefer this embedded terminal over opening external windows unless the user explicitly requests an external terminal.';
function available() { return fs.existsSync(path.join(runtimeRoot, 'node-pty', 'package.json')); }
function createRuntime({ resolveSession, pty = null } = {}) {
  const terminals = new Map();
  const owners = new Map();
  const register = (ctx, env) => {
    const token = crypto.randomBytes(32).toString('hex');
    owners.set(token, { ctx, env: { ...env }, created: Date.now() });
    return token;
  };
  function start(owner, args) {
    if (!args || typeof args.command !== 'string' || !args.command.trim() || args.command.length > 32768) throw new Error('Invalid command');
    if (owner.ctx.isFinished) throw new Error('Session turn has finished');
    const running = [...terminals.values()].filter(t => !t.done);
    if (running.length >= 8 || running.filter(t => t.owner === owner).length >= 2) throw new Error('Too many live terminals');
    const seconds = Number(args.timeout_secs ?? 120);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new Error('Timeout must be 1-3600 seconds');
    const driver = pty || require(path.join(runtimeRoot, 'node-pty'));
    const cwd = owner.ctx.info.cwd;
    const child = driver.spawn(process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : '/bin/sh',
      process.platform === 'win32' ? '/d /s /c "' + args.command + '"' : ['-c', args.command],
      { name: 'xterm-256color', cols: 120, rows: 30, cwd, useConptyDll: process.platform === 'win32', env: { ...owner.env, TERM: 'xterm-256color', PYTHONUNBUFFERED: '1' } });
    let complete;
    const t = { id: crypto.randomUUID(), owner, command: args.command, child, pid: child.pid, started: Date.now(), done: false,
      output: '', sequence: 0, clients: new Set(), result: new Promise(resolve => { complete = resolve; }) };
    terminals.set(t.id, t);
    if (terminals.size > 128) {
      for (const [id, old] of terminals) {
        if (terminals.size <= 128) break;
        if (old.done && !old.clients.size) { old.exitSubscription?.dispose(); terminals.delete(id); }
      }
    }
    const send = (event, data) => {
      const frame = `id: ${++t.sequence}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of t.clients) {
        if (res.writableLength > 1024 * 1024) { res.destroy(); t.clients.delete(res); }
        else res.write(frame);
      }
    };
    t.dataSubscription = child.onData(data => {
      t.output = (t.output + data).slice(-512 * 1024);
      send('data', { text: data });
    });
    t.exitSubscription = child.onExit(({ exitCode, signal }) => {
      // ConPTY may flush its final output after the process exit notification.
      setTimeout(() => {
      t.done = true; t.exitCode = exitCode; t.signal = signal; t.ended = Date.now();
      clearTimeout(t.timer);
      send('exit', { exitCode, signal, reason: t.reason || '' });
      for (const res of t.clients) res.end();
      t.clients.clear();
      t.dataSubscription?.dispose();
      complete({ terminalId: t.id, exitCode, reason: t.reason || '', output: stripVTControlCharacters(t.output).slice(-65536) });
      }, 100);
    });
    t.timer = setTimeout(() => stop(t, 'Timed out'), seconds * 1000);
    t.timer.unref?.();
    return t;
  }
  function stop(t, reason = 'Stopped by user') {
    if (!t.done && !t.reason) { t.reason = reason; t.child.kill(); }
  }
  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 65536) throw new Error('Request too large'); }
    return JSON.parse(text || '{}');
  }
  function local(req) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress); }
  function browserAllowed(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return false; } catch { return false; }
    }
    return true;
  }
  function belongs(t, id) {
    const ctx = t.owner.ctx;
    return [ctx.sessionId, ctx.tempName, ctx.resolvedDbId, ctx.info?.sessionId].filter(Boolean).includes(id) || resolveSession?.(id) === ctx;
  }
  async function handle(req, res, url) {
    try {
      if (assets[url.pathname] && req.method === 'GET') {
        const [file, mime] = assets[url.pathname];
        const data = await fs.promises.readFile(path.join(runtimeRoot, file));
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' }); res.end(data); return;
      }
      if (!browserAllowed(req)) return json(res, 403, { error: 'Cross-origin terminal access denied' });
      if (url.pathname.startsWith('/api/terminal/internal/')) {
        const owner = owners.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!local(req) || req.headers.origin || !owner) return json(res, 403, { error: 'Invalid terminal capability' });
        if (url.pathname.endsWith('/run') && req.method === 'POST') {
          const t = start(owner, await body(req)); return json(res, 200, { terminalId: t.id, pid: t.pid });
        }
        const t = terminals.get(url.searchParams.get('terminalId'));
        if (!t || t.owner !== owner) return json(res, 404, { error: 'Terminal not found' });
        if (url.pathname.endsWith('/wait') && req.method === 'GET') return json(res, 200, await t.result);
        if (url.pathname.endsWith('/stop') && req.method === 'POST') { stop(t, 'Tool cancelled'); return json(res, 200, { ok: true }); }
        return json(res, 405, { error: 'Unsupported terminal operation' });
      }
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return json(res, 400, { error: 'Session required' });
      if (url.pathname === '/api/terminal/lookup' && req.method === 'GET') {
        const command = url.searchParams.get('command');
        const matches = [...terminals.values()].filter(t => belongs(t, sessionId) && (!command || t.command === command));
        const t = matches[matches.length - 1];
        return json(res, 200, t ? { terminalId: t.id, pid: t.pid, running: !t.done, command: t.command, started: t.started, exitCode: t.exitCode } : { terminalId: null });
      }
      const t = terminals.get(url.searchParams.get('terminalId'));
      if (!t || !belongs(t, sessionId)) return json(res, 404, { error: 'Terminal not found in this session' });
      if (url.pathname === '/api/terminal/stream' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        // Snapshot and subscription happen synchronously so reconnect never loses a chunk.
        res.write(`event: snapshot\ndata: ${JSON.stringify({ text: t.output, running: !t.done, pid: t.pid, exitCode: t.exitCode, command: t.command })}\n\n`);
        if (t.done) { res.end(); return; }
        t.clients.add(res);
        const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
        heartbeat.unref?.();
        req.on('close', () => { clearInterval(heartbeat); t.clients.delete(res); });
        return;
      }
      if (url.pathname === '/api/terminal/resize' && req.method === 'POST') {
        if (!req.headers.origin || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Same-origin JSON request required' });
        const size = await body(req);
        if (!Number.isInteger(size.cols) || !Number.isInteger(size.rows) || size.cols < 10 || size.cols > 500 || size.rows < 2 || size.rows > 200) throw new Error('Invalid terminal size');
        if (!t.done && !t.reason) t.child.resize(size.cols, size.rows);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/terminal/stop' && req.method === 'POST') {
        if (!req.headers.origin || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Same-origin JSON request required' });
        stop(t); return json(res, 200, { ok: true });
      }
      json(res, 405, { error: 'Unsupported terminal operation' });
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); else res.end(); }
  }
  const sweep = setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, t] of terminals) {
      if (t.owner.ctx.isFinished && !t.done) stop(t, 'Session turn ended');
      if (t.done && t.ended < cutoff && !t.clients.size) { t.exitSubscription?.dispose(); terminals.delete(id); }
    }
    for (const [token, owner] of owners) if (owner.ctx.isFinished && ![...terminals.values()].some(t => t.owner === owner)) owners.delete(token);
  }, 60000);
  sweep.unref?.();
  return { register, handle, terminals, start, stop, close() { clearInterval(sweep); for (const t of terminals.values()) { stop(t, 'Server shutting down'); for (const res of t.clients) res.end(); } owners.clear(); } };
}
module.exports = { createRuntime, available, TERMINAL_INSTRUCTION, runtimeRoot };
