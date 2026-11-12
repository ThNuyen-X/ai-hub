const fs = require('node:fs/promises');
const path = require('node:path');

function findLogPaths(command, tempDir) {
  const text = String(command || '');
  const files = [];
  // Resolve only literal log names, never evaluate shell expressions.
  const assignments = /\$log\s*=\s*(?:Join-Path\s+\$env:TEMP\s+)?(['"])([^'"\r\n]+\.(?:log|txt))\1/gi;
  for (const match of text.matchAll(assignments)) {
    const rest = text.slice(match.index + match[0].length).split(/\$log\s*=/i)[0];
    if (!/(?:\*>|>>?|Tee-Object[^;]*-FilePath)\s*\$log\b/i.test(rest)) continue;
    if (/Join-Path/i.test(match[0])) {
      if (tempDir && path.basename(match[2]) === match[2]) files.push(path.join(tempDir, match[2]));
    } else if (path.isAbsolute(match[2])) files.push(match[2]);
  }
  const direct = findLogPath(text);
  if (direct && path.isAbsolute(direct) && !files.includes(direct)) files.push(direct);
  return files;
}

function findLogPath(command) {
  const text = String(command || '');
  const variable = text.match(/\$log\s*=\s*(['"])([^'"\r\n]+\.(?:log|txt))\1/i);
  if (variable && /(?:\*>|>>?|Tee-Object[^;]*-FilePath)\s*\$log\b/i.test(text)) return variable[2];
  const direct = text.match(/(?:\*>|2?>|>>|Tee-Object\s+-FilePath)\s*(['"])([^'"\r\n]+\.(?:log|txt))\1/i);
  return direct ? direct[2] : null;
}

const pending = new Map();

function readLogTail(file, version = '') {
  const key = JSON.stringify([file, version]);
  if (pending.has(key)) return pending.get(key);
  const task = readTail(file, version).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

async function readTail(file, version) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a log file');
    const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (version === stamp) return { unchanged: true, version: stamp };
    const head = Buffer.alloc(2);
    await handle.read(head, 0, 2, 0);
    const utf16 = head[0] === 255 && head[1] === 254;
    let start = Math.max(0, stat.size - 65536);
    if (utf16 && start % 2) start++;
    const buffer = Buffer.alloc(stat.size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
    if (start) text = text.slice(text.indexOf('\n') + 1);
    return { text, size: stat.size, modified: stat.mtime.toISOString(), version: stamp };
  } finally { if (handle) await handle.close(); }
}
async function readCommandLog(command, tempDir, version = '') {
  const files = findLogPaths(command, tempDir);
  // Later stages create their logs only after earlier stages complete.
  for (const file of files.reverse()) {
    try { return { ...await readLogTail(file, version), file }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}
module.exports = { findLogPath, findLogPaths, readLogTail, readCommandLog };
