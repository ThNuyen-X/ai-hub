const { workspaceKey } = require('./workspace-path.cjs');

const MAX_WORKSPACE_SESSIONS = 20;

function countWorkspaceSessions(cwd, storedSessions, activeSessions) {
  const key = workspaceKey(cwd);
  const stored = storedSessions.filter(s => workspaceKey(s.cwd) === key);
  const known = new Set(stored.flatMap(s => [s.id, s.tempName, s.name].filter(Boolean)));
  const seen = new Set();
  let count = stored.length;
  for (const ctx of activeSessions) {
    if (!ctx || ctx.isFinished || seen.has(ctx)) continue;
    seen.add(ctx);
    if (workspaceKey(ctx.info?.cwd) !== key) continue;
    const ids = [ctx.sessionId, ctx.tempName, ctx.resolvedDbId, ctx.info?.sessionId].filter(Boolean);
    if (!ids.some(id => known.has(id))) count++;
    for (const id of ids) known.add(id);
  }
  return count;
}

function makeWorkspaceSessionRoom(cwd, storedSessions, activeSessions, isRunning, remove) {
  const active = Array.from(activeSessions);
  let excess = countWorkspaceSessions(cwd, storedSessions, active) - MAX_WORKSPACE_SESSIONS + 1;
  if (excess <= 0) return;
  const candidates = storedSessions
    .filter(s => workspaceKey(s.cwd) === workspaceKey(cwd) && !isRunning(s))
    .sort((a, b) => String(a.created_at || a.date || '').localeCompare(String(b.created_at || b.date || '')) || String(a.id).localeCompare(String(b.id)));
  // Check capacity first: never partially prune when all remaining slots are running.
  if (candidates.length < excess) throw new Error('Workspace has 20 running sessions. Stop a session before creating another.');
  for (const session of candidates) {
    remove(session);
    if (--excess === 0) break;
  }
}

module.exports = { MAX_WORKSPACE_SESSIONS, countWorkspaceSessions, makeWorkspaceSessionRoom };
