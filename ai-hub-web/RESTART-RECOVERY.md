# Safe self-restart

Use `node D:\ai-hub\ai-hub-web\restart.cjs` only after restart authorization.
The running server must already contain the checkpoint endpoint. Initial installation
requires a normal manual restart; the helper refuses to stop a server when checkpointing fails.

## Guarantees and limits

- Local CLI checkpoint requests only; browser Origin requests are rejected.
- Checkpoint contains session IDs, model, workspace and old PIDs, not API keys or original prompts.
- File is outside the repository in LocalAppData/ai-hub, atomically replaced after fsync.
- One restart worker at a time, verified server PID/command line and agent parent PIDs.
- New chat requests are rejected briefly after checkpointing to prevent missed new tasks.
- A checkpoint must be explicitly armed by the worker and less than two minutes old.
- Completed tasks are excluded when completion is observed before shutdown.
- Recovery claims each job on disk before submission; concurrent recovery calls are coalesced.
- No automatic retry after an ambiguous submission, stale checkpoint, missing workspace,
  invalid JSON or surviving old agent. Inspect checkpoint states and worker logs instead.
- Pending jobs are submitted sequentially. No polling daemon, database, full transcript copy,
  or additional permanent timer is introduced.

Continuation adds one explicit follow-up to the existing conversation. It is not instruction-level
execution resumption and cannot promise exactly-once external effects. The agent must inspect
actual state before repeating edits, deploys or other side effects. Arbitrary tool subprocesses
are not recursively terminated: do not restart while an unrelated deploy/build is in progress.
If a request may have succeeded but its response was lost, inspect the session before manual retry.
This does not automatically recover crashes, power failures, or ad-hoc taskkill restarts.

## Diagnostics

- LocalAppData/ai-hub/restart-recovery.json: pending, claimed, submitted, failed,
  completed_before_restart, blocked_old_process, expired, missing_workspace.
- LocalAppData/ai-hub/logs/restart-worker.log
- LocalAppData/ai-hub/logs/restart-worker-error.log

Unit and loopback HTTP tests cover persistence, arming, duplicate and concurrent submissions,
completion, ambiguous failure, old-process guard, expiry and corrupt checkpoints.
Windows worker syntax is checked separately. Killing/relaunching a real production server
is a distinct smoke test and must not be implied by those tests.
