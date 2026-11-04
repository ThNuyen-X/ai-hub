const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const FILE = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'restart-recovery.json');
const CONTINUE = 'Continue the interrupted task after the AI Hub web server restart. Review the latest conversation and actual workspace state first. Do not repeat completed edits, commits, pushes, deployments or other side effects. Verify unfinished work and report the result. Do not restart the server again unless necessary and explicitly requested.';
function createRecovery(file = FILE) {
  let recovering = false;
  function read() {
    if (!fs.existsSync(file)) return { jobs: [] };
    if (fs.statSync(file).size > 256 * 1024) throw new Error('Recovery checkpoint exceeds safety limit.');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.jobs) || data.jobs.length > 64) throw new Error('Invalid recovery checkpoint.');
    return data;
  }
  function save(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.' + process.pid + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temp, 'w', 0o600);
      fs.writeFileSync(fd, JSON.stringify(data));
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  function checkpoint(contexts, resolveSession) {
    const previous = read();
    if (previous.ownerPid === process.pid && Date.now() - previous.createdAt < 120000
        && previous.jobs.some(j => j.state === 'pending')) throw new Error('A restart is already scheduled.');
    const jobs = [];
    const ids = new Set();
    for (const ctx of new Set(contexts)) {
      if (!ctx || ctx.isFinished) continue;
      const stored = resolveSession(ctx.info?.sessionId || ctx.sessionId);
      if (!stored?.id) throw new Error('Cannot safely resume an unsaved session; retry after it is persisted.');
      if (ids.has(stored.id)) continue;
      ids.add(stored.id);
      if (!ctx.info?.model || !ctx.info?.cwd || !fs.existsSync(ctx.info.cwd)) throw new Error('Invalid recovery workspace or model.');
      jobs.push({ sessionId: stored.id, model: ctx.info.model, auxiliaryModel: ctx.info.auxiliaryModel || '', cwd: ctx.info.cwd,
        oldPid: ctx.process?.pid, state: 'pending' });
    }
    if (jobs.length > 64) throw new Error('Too many active sessions for safe restart.');
    save({ createdAt: Date.now(), ownerPid: process.pid, restartId: randomUUID(), armed: false, jobs });
    return jobs.length;
  }
  function complete(sessionId) {
    const data = read();
    if (data.ownerPid !== process.pid || data.armed) return;
    let changed = false;
    for (const job of data.jobs) if (job.sessionId === sessionId && job.state === 'pending') {
      job.state = 'completed_before_restart'; changed = true;
    }
    if (changed) save(data);
  }
  async function recover(submit, isAlive) {
    if (recovering) return;
    recovering = true;
    try {
      const data = read();
      if (!data.jobs.length || !data.armed || data.ownerPid === process.pid) return;
      if (Date.now() - data.createdAt > 120000 || data.createdAt > Date.now() + 5000) {
        for (const job of data.jobs) if (job.state === 'pending') job.state = 'expired';
        save(data); return;
      }
      for (const job of data.jobs) {
        if (job.state !== 'pending') continue;
        if (!fs.existsSync(job.cwd)) { job.state = 'missing_workspace'; save(data); continue; }
        if (job.oldPid && isAlive(job.oldPid)) { job.state = 'blocked_old_process'; save(data); continue; }
        // Persist the claim before sending: never retry an ambiguous side effect.
        job.state = 'claimed'; save(data);
        try {
          await submit({ sessionId: job.sessionId, model: job.model, auxiliaryModel: job.auxiliaryModel || '', cwd: job.cwd,
            prompt: CONTINUE, streamMode: 'eventsource' });
          job.state = 'submitted';
        } catch (error) {
          job.state = 'failed'; job.error = String(error.message).slice(0, 300);
        }
        save(data);
      }
    } finally { recovering = false; }
  }
  return { checkpoint, complete, recover, read };
}
module.exports = { createRecovery, FILE };
