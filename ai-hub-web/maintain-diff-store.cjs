const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'session-diffs');
const backup = path.join(path.dirname(dir), 'session-diffs-backup-' + Date.now());
const ignored = new Set(['.angular', '.nx', '.cache', 'node_modules', 'dist', 'build', 'target', '.next', '.git', '.vite', '.svelte-kit']);
const pidFile = path.join(path.dirname(dir), 'logs', 'server.pid');
if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  let alive = false;
  if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  if (alive) throw new Error('Stop the web server before diff maintenance; active sessions may write this store.');
}
let count = 0;
for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
  const file = path.join(dir, entry.name);
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  let removed = 0;
  for (const [key, value] of Object.entries(store.files || {})) {
    if (String(value.path || key).split(/[\\/]/).some(p => ignored.has(p.toLowerCase()))) {
      delete store.files[key];
      removed++;
    }
  }
  if (!removed) continue;
  fs.mkdirSync(backup, { recursive: true });
  fs.copyFileSync(file, path.join(backup, entry.name), fs.constants.COPYFILE_EXCL);
  const before = fs.statSync(file).size;
  const temp = file + '.cleanup.tmp';
  fs.writeFileSync(temp, JSON.stringify(store));
  fs.renameSync(temp, file);
  count += removed;
  console.log(JSON.stringify({ file: entry.name, removed, beforeBytes: before, afterBytes: fs.statSync(file).size }));
}
console.log(JSON.stringify({ removedCacheRecords: count, backup }));
