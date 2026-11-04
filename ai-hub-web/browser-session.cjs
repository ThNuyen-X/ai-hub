const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
function sessionKey(sessionId, dbPath) {
  let db;
  if (!sessionId) throw new Error('Missing browser session identity');
  if (String(sessionId).startsWith('session_')) return sessionId;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT name FROM sessions WHERE id = ?').get(sessionId);
    return row?.name?.startsWith('session_') ? row.name : sessionId;
  } finally { if (db) db.close(); }
}
function profilePath(key, root = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'browser-profiles')) {
  if (!key) throw new Error('Missing browser session identity');
  return path.join(root, crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32));
}
async function endpoint(profile) {
  try {
    const lines = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    const port = Number(lines[0]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const url = `http://127.0.0.1:${port}`;
    const response = await fetch(url + '/json/version', { signal: AbortSignal.timeout(1000) });
    const data = await response.json();
    // The browser's random endpoint must match our profile's port file, not a reused port.
    return response.ok && data.webSocketDebuggerUrl?.endsWith(lines[1]) ? url : null;
  } catch { return null; }
}
async function ensureBrowser(key) {
  const profile = profilePath(key);
  fs.mkdirSync(profile, { recursive: true });
  const current = await endpoint(profile);
  if (current) return current;
  const chrome = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(file => fs.existsSync(file));
  if (!chrome) throw new Error('Google Chrome is not installed');
  const portFile = path.join(profile, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });
  const child = spawn(chrome, ['--user-data-dir=' + profile, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  for (let i = 0; i < 80; i++) {
    const url = await endpoint(profile);
    if (url) return url;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Session Chrome did not become ready. Close only this session browser and retry.');
}
module.exports = { sessionKey, profilePath, endpoint, ensureBrowser };
