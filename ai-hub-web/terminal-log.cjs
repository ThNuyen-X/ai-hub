const fs = require('node:fs/promises');
const path = require('node:path');

function findLogPaths(command, tempDir, cwd = '') {
  const text = String(command || '');
  const files = [];
  const resolveCandidate = (rawPath) => {
    const cleaned = String(rawPath || '').trim().replace(/^['"]|['"]$/g, '');
    if (!cleaned || !/\.(?:log|txt)$/i.test(cleaned)) return null;
    if (path.isAbsolute(cleaned)) return cleaned;
    const envTempMatch = cleaned.match(/^(?:\$env:TEMP|%TEMP%)[\\/](.+)$/i);
    if (envTempMatch) return tempDir ? path.join(tempDir, envTempMatch[1]) : null;
    const envScratchMatch = cleaned.match(/^(?:\$env:AI_HUB_SCRATCH_DIR|%AI_HUB_SCRATCH_DIR%)[\\/](.+)$/i);
    if (envScratchMatch) return tempDir ? path.join(tempDir, envScratchMatch[1]) : null;
    if (cwd && !cleaned.includes('$') && !cleaned.includes('%')) return path.resolve(cwd, cleaned);
    return null;
  };
  const pushUnique = (file) => {
    if (file && !files.includes(file)) files.push(file);
  };
  // Resolve only literal log names, never evaluate shell expressions.
  const assignments = /\$log\s*=\s*(?:Join-Path\s+(?:\$env:TEMP|\$env:AI_HUB_SCRATCH_DIR)\s+)?(['"])([^'"\r\n]+\.(?:log|txt))\1/gi;
  for (const match of text.matchAll(assignments)) {
    const rest = text.slice(match.index + match[0].length).split(/\$log\s*=/i)[0];
    if (!/(?:\*>|>>?|Tee-Object[^;]*-FilePath|Out-File(?:\s+-FilePath)?)\s*\$log\b/i.test(rest)) continue;
    if (/Join-Path/i.test(match[0])) {
      if (tempDir && path.basename(match[2]) === match[2]) pushUnique(path.join(tempDir, match[2]));
    } else {
      pushUnique(resolveCandidate(match[2]));
    }
  }
  const directPatterns = [
    /(?:\*>|[12]?>|>>|Tee-Object(?:\s+-Append)?(?:\s+-FilePath)?|Out-File(?:\s+-Append)?(?:\s+-FilePath)?)\s*(['"])([^'"\r\n]+\.(?:log|txt))\1/gi,
    /(?:\*>|[12]?>|>>|Tee-Object(?:\s+-Append)?(?:\s+-FilePath)?|Out-File(?:\s+-Append)?(?:\s+-FilePath)?)\s*([^\s;&|'"`]+\.(?:log|txt))(?=\s|$|[;&|])/gi
  ];
  for (const regex of directPatterns) {
    for (const match of text.matchAll(regex)) {
      pushUnique(resolveCandidate(match[2] || match[1]));
    }
  }
  const direct = findLogPath(text);
  if (direct) pushUnique(resolveCandidate(direct));
  return files;
}

function findLogPath(command) {
  const text = String(command || '');
  const variable = text.match(/\$log\s*=\s*(['"])([^'"\r\n]+\.(?:log|txt))\1/i);
  if (variable && /(?:\*>|>>?|Tee-Object[^;]*-FilePath|Out-File(?:\s+-FilePath)?)\s*\$log\b/i.test(text)) return variable[2];
  const direct = text.match(/(?:\*>|2?>|>>|Tee-Object\s+-FilePath|Out-File(?:\s+-FilePath)?)\s*(['"])([^'"\r\n]+\.(?:log|txt))\1/i);
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
async function readCommandLog(command, tempDir, version = '', cwd = '') {
  const files = findLogPaths(command, tempDir, cwd);
  // Later stages create their logs only after earlier stages complete.
  for (const file of files.reverse()) {
    try { return { ...await readLogTail(file, version), file }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}
module.exports = { findLogPath, findLogPaths, readLogTail, readCommandLog };
