const readline = require('node:readline');
async function serve() {
  const base = process.env.AI_HUB_TERMINAL_URL;
  const token = process.env.AI_HUB_TERMINAL_TOKEN;
  const active = new Map();
  const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  async function api(route, data, signal) {
    const response = await fetch(base + '/api/terminal/internal/' + route, {
      method: data ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}), signal
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Terminal request failed');
    return value;
  }
  async function cancel(job) {
    job.cancelled = true;
    if (job.id) await api('stop?terminalId=' + job.id, {}).catch(() => {});
  }
  const input = readline.createInterface({ input: process.stdin });
  input.on('close', () => { for (const job of active.values()) cancel(job); });
  input.on('line', async line => {
    let req;
    try {
      req = JSON.parse(line);
      if (req.method === 'notifications/cancelled') { const job = active.get(req.params?.requestId); if (job) await cancel(job); return; }
      if (req.id == null) return;
      let result;
      if (req.method === 'initialize') result = { protocolVersion: req.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'hub_terminal', version: '1.0.0' } };
      else if (req.method === 'ping') result = {};
      else if (req.method === 'tools/list') result = { tools: [{ name: 'shell', description: 'Run a command in a real embedded PTY. The user can attach live in the Terminal drawer without rerunning. Use for builds, tests, deployment and SSH. No interactive input; stream child output directly. Returns terminal ID, exit code and bounded output when finished.', inputSchema: { type: 'object', properties: { command: { type: 'string', maxLength: 32768 }, timeout_secs: { type: 'integer', minimum: 1, maximum: 3600, default: 120 } }, required: ['command'], additionalProperties: false } }] };
      else if (req.method === 'tools/call') {
        if (req.params?.name !== 'shell') throw new Error('Unknown terminal tool');
        const job = { cancelled: false };
        active.set(req.id, job);
        try {
          const t = await api('run', req.params.arguments);
          job.id = t.terminalId;
          if (job.cancelled) await cancel(job);
          const value = await api('wait?terminalId=' + t.terminalId);
          result = { isError: value.exitCode !== 0 || !!value.reason, content: [{ type: 'text', text: JSON.stringify(value) }] };
        } catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
        finally { active.delete(req.id); }
      } else { send({ id: req.id, error: { code: -32601, message: 'Method not found' } }); return; }
      send({ id: req.id, result });
    } catch (error) { if (req?.id != null) send({ id: req.id, error: { code: -32602, message: error.message } }); }
  });
}
if (require.main === module) serve().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { serve };
