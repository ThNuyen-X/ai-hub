const { workspaceKey } = require('./workspace-path.cjs');

const MAX_WORKSPACE_SESSIONS = 20;

// Pinned sessions are exempt: they are not counted toward the limit and are never pruned.
function countWorkspaceSessions(cwd, storedSessions, activeSessions, isPinned = () => false) {
  const key = workspaceKey(cwd);
  const inWorkspace = storedSessions.filter(s => workspaceKey(s.cwd) === key);
  const known = new Set(inWorkspace.flatMap(s => [s.id, s.tempName, s.name].filter(Boolean)));
  const seen = new Set();
  let count = inWorkspace.filter(s => !isPinned(s)).length;
  for (const ctx of activeSessions) {
    if (!ctx || ctx.isFinished || seen.has(ctx)) continue;
    seen.add(ctx);
    if (workspaceKey(ctx.info?.cwd) !== key) continue;
    const ids = [ctx.sessionId, ctx.tempName, ctx.resolvedDbId, ctx.info?.sessionId].filter(Boolean);
    if (!ids.some(id => known.has(id)) && !ids.some(id => isPinned({ id }))) count++;
    for (const id of ids) known.add(id);
  }
  return count;
}

function makeWorkspaceSessionRoom(cwd, storedSessions, activeSessions, isRunning, remove, isPinned = () => false) {
  const active = Array.from(activeSessions);
  let excess = countWorkspaceSessions(cwd, storedSessions, active, isPinned) - MAX_WORKSPACE_SESSIONS + 1;
  if (excess <= 0) return;
  const candidates = storedSessions
    .filter(s => workspaceKey(s.cwd) === workspaceKey(cwd) && !isPinned(s) && !isRunning(s))
    .sort((a, b) => String(a.created_at || a.date || '').localeCompare(String(b.created_at || b.date || '')) || String(a.id).localeCompare(String(b.id)));
  // Check capacity first: never partially prune when all remaining slots are running.
  if (candidates.length < excess) throw new Error('Workspace has 20 running sessions. Stop a session before creating another.');
  for (const session of candidates) {
    remove(session);
    if (--excess === 0) break;
  }
}

module.exports = { MAX_WORKSPACE_SESSIONS, countWorkspaceSessions, makeWorkspaceSessionRoom };
