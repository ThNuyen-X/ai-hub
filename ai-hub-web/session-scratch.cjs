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

function createTurnScratch(cwd, sessionId, env = process.env) {
  const root = path.resolve(env.AI_HUB_SCRATCH_ROOT || path.join(env.LOCALAPPDATA || os.tmpdir(), 'ai-hub', 'scratch'));
  const workspace = path.join(root, key(workspaceKey(cwd)));
  const session = path.join(workspace, key(sessionId));
  const dir = path.join(session, randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const token = randomUUID();
  fs.writeFileSync(path.join(dir, '.ai-hub-owned'), token, { flag: 'wx' });
  return { root, workspace, session, dir, token };
}

async function cleanupTurnScratch(scratch) {
  if (!scratch) return false;
  try {
    // Only remove the exact, uniquely owned turn directory; never scan project files.
    const relative = path.relative(scratch.root, scratch.dir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    for (const dir of [scratch.root, scratch.workspace, scratch.session, scratch.dir]) {
      if ((await fsp.lstat(dir)).isSymbolicLink()) return false;
    }
    if (await fsp.readFile(path.join(scratch.dir, '.ai-hub-owned'), 'utf8') !== scratch.token) return false;
    await fsp.rm(scratch.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    for (const dir of [scratch.session, scratch.workspace]) {
      try { await fsp.rmdir(dir); } catch { /* Another turn may still own files here. */ }
    }
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[SCRATCH CLEANUP] ' + error.message);
    return false;
  }
}

function scratchInstruction(dir) {
  return '\n\n[AI HUB SCRATCH FILES]:\nAI_HUB_SCRATCH_DIR=' + JSON.stringify(dir) +
    '\nStore ALL disposable helper scripts, OCR output, image crops, screenshots, debug logs and scratch files in this absolute directory, NOT the project workspace (including target/). Use absolute output paths; running a script from scratch does not change its working directory. TEMP, TMP and TMPDIR point here too. Never place deliverables or files needed for a follow-up here: move those to an appropriate persistent location and tell the user. This turn directory is automatically deleted after the agent process closes. Do not delete or modify other sessions\' scratch directories.';
}

module.exports = { createTurnScratch, cleanupTurnScratch, scratchInstruction };
