const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const port = process.env.PORT || '20130';

if (process.argv.includes('--worker')) {
  // This process is detached from the chat tool before the old server is stopped.
  setTimeout(() => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'restart-web.ps1'), '-Port', String(port)], {
      stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true
    });
    console.log(new Date().toISOString() + ' Restart PowerShell worker started.');
    child.once('error', error => { console.error('Restart worker failed: ' + error.message); process.exitCode = 1; });
    child.once('exit', (code, signal) => {
      console.log(new Date().toISOString() + ` Restart worker exited: code=${code} signal=${signal}`);
      if (code !== 0) process.exitCode = 1;
    });
  }, 2000);
} else {
  (async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/restart-checkpoint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Checkpoint failed');
    const logDir = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.openSync(path.join(logDir, 'restart-worker.log'), 'a');
    try {
      const worker = spawn(process.execPath, [__filename, '--worker'], {
        detached: true, stdio: ['ignore', log, log], windowsHide: true, env: process.env
      });
      await new Promise((resolve, reject) => {
        worker.once('spawn', resolve);
        worker.once('error', reject);
      });
      worker.unref();
      console.log(`Restart scheduled; ${result.sessions} session(s) checkpointed for continuation.`);
    } finally { fs.closeSync(log); }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
