'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { workspaceKey } = require('./workspace-path.cjs');

function key(value) {
  const text = String(value || 'session');
  return text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) + '-' +
    createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function resolveScratchRoot(env = process.env) {
  // Configuration values are not expanded by Node like they are by cmd.exe.
  const fallback = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ai-hub', 'scratch');
  const configured = env.AI_HUB_SCRATCH_ROOT || path.join(env.LOCALAPPDATA || process.env.LOCALAPPDATA || os.tmpdir(), 'ai-hub', 'scratch');
  const source = { ...process.env, ...env };
  const expanded = configured.replace(/%([^%]+)%/g, (match, name) => {
    const found = Object.keys(source).find(k => k.toLowerCase() === name.toLowerCase());
    return found ? source[found] : match;
  });
  // Never create literal placeholder directories or pass percent paths to Goose.
  return path.resolve(expanded.includes('%') ? fallback : expanded);
}

function createTurnScratch(cwd, sessionId, env = process.env) {
  const root = resolveScratchRoot(env);
  const workspace = path.join(root, key(workspaceKey(cwd)));
  const session = path.join(workspace, key(sessionId));
  const dir = path.join(session, randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const token = randomUUID();
  fs.writeFileSync(path.join(dir, '.ai-hub-owned'), token, { flag: 'wx' });
  return { root, workspace, session, dir, token };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function cleanupTurnScratch(scratch) {
  if (!scratch) return false;
  try {
    // Only remove the exact, uniquely owned turn directory; never scan project files.
    const relative = path.relative(scratch.root, scratch.dir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    for (const dir of [scratch.root, scratch.workspace, scratch.session, scratch.dir]) {
      if ((await fsp.lstat(dir)).isSymbolicLink()) return false;
    }
    const markerPath = path.join(scratch.dir, '.ai-hub-owned');
    if (await fsp.readFile(markerPath, 'utf8') !== scratch.token) return false;
    // Remove children first while keeping .ai-hub-owned intact so retries still verify ownership if a file is locked on Windows.
    const entries = await fsp.readdir(scratch.dir).catch(() => []);
    for (const name of entries) {
      if (name === '.ai-hub-owned') continue;
      await fsp.rm(path.join(scratch.dir, name), { recursive: true, force: true, maxRetries: 6, retryDelay: 400 });
    }
    await fsp.rm(scratch.dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 400 });
    for (const dir of [scratch.session, scratch.workspace]) {
      try { await fsp.rmdir(dir); } catch { /* Another turn may still own files here. */ }
    }
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[SCRATCH CLEANUP] ' + error.message);
    return false;
  }
}

function normalizeDirKey(dirPath) {
  const resolved = path.resolve(String(dirPath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function sweepStaleScratch(root, { activeDirs = [], maxAgeMs = 30 * 60 * 1000, now = Date.now() } = {}) {
  const stats = { removed: 0, skipped: 0 };
  if (!root) return stats;
  try {
    const resolvedRoot = path.resolve(root);
    const rootStat = await fsp.lstat(resolvedRoot).catch(() => null);
    if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) return stats;
    const activeSet = new Set((activeDirs || []).filter(Boolean).map(normalizeDirKey));

    const wsEntries = await fsp.readdir(resolvedRoot, { withFileTypes: true }).catch(() => []);
    for (const wsEnt of wsEntries) {
      if (!wsEnt.isDirectory() || wsEnt.isSymbolicLink()) continue;
      const wsDir = path.join(resolvedRoot, wsEnt.name);
      if (wsEnt.name === '__pycache__') {
        await fsp.rm(wsDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
        continue;
      }
      const sessEntries = await fsp.readdir(wsDir, { withFileTypes: true }).catch(() => []);
      for (const sessEnt of sessEntries) {
        if (!sessEnt.isDirectory() || sessEnt.isSymbolicLink()) continue;
        const sessDir = path.join(wsDir, sessEnt.name);
        const turnEntries = await fsp.readdir(sessDir, { withFileTypes: true }).catch(() => []);
        for (const turnEnt of turnEntries) {
          if (!turnEnt.isDirectory() || turnEnt.isSymbolicLink()) continue;
          const turnDir = path.join(sessDir, turnEnt.name);
          if (activeSet.has(normalizeDirKey(turnDir))) {
            stats.skipped += 1;
            continue;
          }
          const markerPath = path.join(turnDir, '.ai-hub-owned');
          const markerStat = await fsp.lstat(markerPath).catch(() => null);
          const hasMarker = Boolean(markerStat && markerStat.isFile() && !markerStat.isSymbolicLink());
          if (!hasMarker && !UUID_RE.test(turnEnt.name)) {
            stats.skipped += 1;
            continue;
          }
          const turnStat = await fsp.lstat(turnDir).catch(() => null);
          const lastMtime = Math.max(hasMarker ? markerStat.mtimeMs : 0, turnStat ? turnStat.mtimeMs : 0);
          if (maxAgeMs > 0 && (now - lastMtime) < maxAgeMs) {
            stats.skipped += 1;
            continue;
          }
          try {
            await fsp.rm(turnDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
            stats.removed += 1;
          } catch {
            stats.skipped += 1;
          }
        }
        try { await fsp.rmdir(sessDir); } catch { /* Non-empty session dir. */ }
      }
      try { await fsp.rmdir(wsDir); } catch { /* Non-empty workspace dir. */ }
    }
  } catch (error) {
    console.warn('[SCRATCH SWEEP] ' + error.message);
  }
  return stats;
}

function scratchInstruction(dir) {
  return '\n\n[AI HUB SCRATCH FILES]:\nAI_HUB_SCRATCH_DIR=' + JSON.stringify(dir) +
    '\nStore ALL disposable helper scripts, OCR output, image crops, screenshots, debug logs and scratch files in this absolute directory, NOT the project workspace (including target/). Use absolute output paths; running a script from scratch does not change its working directory. TEMP, TMP and TMPDIR point here too. Never place deliverables or files needed for a follow-up here: move those to an appropriate persistent location and tell the user. This turn directory is automatically deleted after the agent process closes. Do not delete or modify other sessions\' scratch directories.';
}

module.exports = { resolveScratchRoot, createTurnScratch, cleanupTurnScratch, sweepStaleScratch, scratchInstruction };
