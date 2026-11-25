const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
let buildDoraemonFeedback = null;
function getDoraemonFeedback(name, args) {
  try {
    delete require.cache[require.resolve('./doraemon-cursor.cjs')];
    return require('./doraemon-cursor.cjs').buildDoraemonFeedback(name, args);
  } catch {
    return null;
  }
}
const mode = process.argv.includes('--sso') ? 'sso' : (process.argv.includes('--personal') ? 'personal' : 'dev');
// A new pipe namespace prevents proxies from reusing an eager-start daemon.
const basePipe = '\\\\.\\pipe\\ai-hub-browser-lazy-v2-' + crypto.createHash('sha256').update(__dirname + (process.env.USERNAME || '')).digest('hex').slice(0, 20);
const pipeFor = target => basePipe + (target === 'sso' ? '-sso' : '') + (target === 'personal' ? '-personal' : (target === 'dev' ? '-dev' : ''));
const pipe = pipeFor(mode);
const entry = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'browser-mcp', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js');
const MAX_FRAME = 16 * 1024 * 1024;
function readLines(stream, consume) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > MAX_FRAME) { stream.destroy(new Error('Browser MCP frame too large')); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (line.trim()) { try { consume(JSON.parse(line)); } catch { stream.destroy(new Error('Invalid browser MCP JSON')); return; } }
    }
  });
}
const ALLOWED_WRITE_ROOTS = [
  path.resolve(__dirname, '..', 'ai-hub-data', 'previews'),
  path.resolve(__dirname, '..', 'ai-hub-data', 'scratch'),
  path.resolve(os.tmpdir()),
  process.env.TEMP ? path.resolve(process.env.TEMP) : null,
  process.env.TMP ? path.resolve(process.env.TMP) : null
].filter(Boolean);
const WRITE_PATH_KEYS = ['filePath', 'requestFilePath', 'responseFilePath', 'outputDirPath'];
function isPathInsideRoot(targetPath, rootPath) {
  const normTarget = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
  const normRoot = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;
  return normTarget === normRoot || normTarget.startsWith(normRoot + path.sep);
}
function validateBrowserOutputPaths(callParams) {
  const args = callParams?.arguments;
  if (!args || typeof args !== 'object') return;
  for (const key of WRITE_PATH_KEYS) {
    const raw = args[key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const resolved = path.resolve(raw.trim());
    const allowed = ALLOWED_WRITE_ROOTS.some(root => isPathInsideRoot(resolved, root));
    if (!allowed) {
      throw new Error(`Access denied: "${raw}" is outside allowed AI Hub output directories (previews, scratch, temp).`);
    }
    const dirToCreate = key === 'outputDirPath' ? resolved : path.dirname(resolved);
    try { fs.mkdirSync(dirToCreate, { recursive: true }); } catch {}
  }
}
class BrowserHub {
  constructor(start) {
    this.customStart = Boolean(start);
    if (!start) {
      if (mode === 'sso') {
        start = () => spawn(process.execPath, [entry,
          '--ws-endpoint=' + require('./browser-sso.cjs').ssoEndpoint(),
          '--allow-unrestricted-paths',
          '--no-usage-statistics', '--no-performance-crux'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
      } else if (mode === 'personal') {
        start = () => spawn(process.execPath, [entry,
          ...['--autoConnect'],
          '--allow-unrestricted-paths',
          '--no-usage-statistics', '--no-performance-crux'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
      } else {
        start = () => spawn(process.execPath, [entry,
          '--browserUrl=' + require('./browser-dev.cjs').devEndpoint(),
          '--allow-unrestricted-paths',
          '--no-usage-statistics', '--no-performance-crux'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
      }
    }
    this.start = start; this.pending = new Map(); this.nextId = 0; this.queue = Promise.resolve(); this.queued = 0;
    this.emptyParamTools = new Set(['list_pages']);
  }
  launch() {
    if (this.child) return;
    const child = this.start(); this.child = child;
    const failed = () => {
      if (this.child !== child) return;
      this.child = null; this.ready = null;
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser MCP disconnected; action was not retried.')); }
      this.pending.clear();
    };
    child.on('error', failed); child.on('exit', failed); child.stdin.on('error', failed);
    child.stdout.on('error', failed);
    readLines(child.stdout, message => {
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Do not release the queue onto an upstream operation with an ambiguous outcome.
        if (this.child) this.child.kill();
        reject(new Error('Browser request timed out; not retried. Check page state before trying again.'));
      }, 120000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async initialize(params) {
    if (!this.ready) {
      // MCP initialization and tool discovery must not open a browser.
      this.launch();
      this.ready = this.request('initialize', { ...params, capabilities: {}, clientInfo: { name: 'ai-hub-shared-browser', version: '1.0' } }).then(result => {
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        return result;
      }).catch(error => { this.ready = null; throw error; });
    }
    return this.ready;
  }
  async triggerDoraemon(params) {
    if (!this.child || !params?.name) return;
    const feedback = getDoraemonFeedback(params.name, params.arguments);
    if (!feedback) return;
    try {
      await Promise.race([
        this.request('tools/call', {
          name: 'evaluate_script',
          arguments: feedback
        }),
        new Promise(resolve => setTimeout(resolve, 700))
      ]);
    } catch {
      // Non-blocking: visual animation failure never interrupts real tool execution
    }
  }
  async handle(message) {
    if (message.method === 'initialize') {
      const result = await this.initialize(message.params);
      // Clients do not share upstream subscriptions or roots; expose supported proxy tools only.
      return { ...result, capabilities: { tools: {} } };
    }
    if (message.method === 'ping') return {};
    if (!['tools/list', 'tools/call'].includes(message.method)) throw new Error('Unsupported shared browser method');
    if (!this.ready) throw new Error('Initialize browser MCP first');
    await this.ready;
    if (this.queued >= 32) throw new Error('Browser queue full; wait for current browser actions');
    this.queued++;
    const result = this.queue.then(async () => {
      if (!this.child) throw new Error('Browser MCP disconnected; initialize again');
      if (message.method === 'tools/call') {
        // Keep startup inside the shared queue, before feedback or the real action.
        if (mode === 'dev' && !this.customStart) {
          await require('./browser-dev.cjs').ensureDevChrome();
        }
        await this.triggerDoraemon(message.params).catch(() => {});
        let callParams = message.params;
        if (callParams && this.emptyParamTools.has(callParams.name) && callParams.arguments && typeof callParams.arguments === 'object' && Object.prototype.hasOwnProperty.call(callParams.arguments, 'reason')) {
          const rest = { ...callParams.arguments };
          delete rest.reason;
          callParams = { ...callParams, arguments: rest };
        }
        validateBrowserOutputPaths(callParams);
        return this.request(message.method, callParams);
      }
      const res = await this.request(message.method, message.params);
      if (message.method === 'tools/list' && res && Array.isArray(res.tools)) {
        for (const t of res.tools) {
          const props = t?.inputSchema?.properties;
          if (t?.name && (!props || typeof props !== 'object' || Object.keys(props).length === 0)) {
            this.emptyParamTools.add(t.name);
          }
        }
      }
      return res;
    });
    this.queue = result.catch(() => {});
    try { return await result; } finally { this.queued--; }
  }
}
function runDaemon(target = mode) {
  const hub = new BrowserHub();
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    readLines(socket, message => {
      if (message.id === undefined) return;
      const send = payload => {
        if (socket.destroyed) return;
        if (socket.writableLength > MAX_FRAME) { socket.destroy(); return; }
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...payload }) + '\n');
      };
      hub.handle(message).then(result => send({ result }), error => send({ error: { code: -32000, message: error.message } }));
    });
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(pipeFor(target));
}
function connect(target = 'dev') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeFor(target));
    socket.once('connect', () => { socket.removeListener('error', reject); resolve(socket); });
    socket.once('error', reject);
  });
}
async function runProxy(target = 'dev') {
  let socket;
  try { socket = await connect(target); } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
    const dir = path.join(process.env.LOCALAPPDATA || '.', 'ai-hub', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const log = fs.openSync(path.join(dir, 'browser-broker.log'), 'a');
    try {
      const modeFlag = target === 'sso' ? ['--sso'] : (target === 'personal' ? ['--personal'] : ['--dev']);
      const child = spawn(process.execPath, [__filename, '--daemon', ...modeFlag], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } finally { fs.closeSync(log); }
    for (let i = 0; i < 50; i++) {
      try { socket = await connect(target); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!socket) throw new Error(`Shared Chrome broker (${target}) did not start`);
  }
  socket.on('error', error => { console.error(error.message); process.exitCode = 1; });
  // Only this proxy ends with the turn. The daemon and authorized Chrome connection survive.
  process.stdin.pipe(socket); socket.pipe(process.stdout);
  process.stdin.on('end', () => socket.end());
}
if (require.main === module) {
  if (process.argv.includes('--daemon')) runDaemon(mode);
  else runProxy(mode).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { BrowserHub, pipe, pipeFor, runProxy };
