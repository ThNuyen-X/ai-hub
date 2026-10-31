const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read config from start-web.bat if present
const batPath = path.join(__dirname, '..', 'start-web.bat');
const env = { ...process.env };

if (fs.existsSync(batPath)) {
  const content = fs.readFileSync(batPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.trim().match(/^set\s+"?([A-Za-z0-9_]+)=([^"]*)"?$/i);
    if (match) {
      env[match[1]] = match[2];
    }
  }
}

const port = env.PORT || '20130';

try {
  const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
  const lines = out.split('\n');
  const pids = new Set();
  for (const line of lines) {
    if (line.includes('LISTENING')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
  }
  for (const pid of pids) {
    console.log(`Killing process ${pid}...`);
    try { execSync(`taskkill /F /PID ${pid}`); } catch (_) {}
  }
} catch (e) {
  console.log('No existing process found or killed.');
}

const child = spawn('node', ['server.js'], {
  cwd: __dirname,
  detached: true,
  stdio: 'ignore',
  shell: false,
  windowsHide: true,
  env
});
child.unref();
console.log(`Spawned new server.js with PID ${child.pid}`);
