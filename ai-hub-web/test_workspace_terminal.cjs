'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const {
  normalizeWorkspaceRoot,
  computeWindowName,
  escapeForWtArg,
  quoteWinArg,
  wrapCommandAutoClose,
  buildWtLaunchArgs,
  isDeadTabBuffer,
  buildCleanupPowerShellScript,
  parseCliArgs
} = require('./workspace-terminal.cjs');

// 1. Deterministic, case-normalized window naming
const w1 = computeWindowName('C:\\workspaces\\sample-app\\');
const w2 = computeWindowName('c:\\workspaces\\sample-app');
const w3 = computeWindowName('D:\\workspaces\\other-app');
assert.match(w1, /^ai-hub-ws-[0-9a-f]{12}$/);
assert.equal(w1, w2, 'Trailing slash and case differences must resolve to the same window name');
assert.notEqual(w1, w3, 'Different workspaces must map to different window names');
assert.equal(normalizeWorkspaceRoot('C:\\'), 'C:\\');

// 2. WT escaping, quoting and auto-close wrapping
assert.equal(escapeForWtArg('a; b; c'), 'a\\; b\\; c');
assert.equal(quoteWinArg('C:\\workspaces\\sample-app'), 'C:\\workspaces\\sample-app');
assert.equal(quoteWinArg('Gateway local 8080'), '"Gateway local 8080"');
assert.equal(quoteWinArg('D:\\My App\\'), '"D:\\My App\\\\"');
assert.equal(wrapCommandAutoClose('python app.py'), 'python app.py & exit 0');
assert.equal(wrapCommandAutoClose('python app.py', { keepOnError: true }), 'python app.py');

const wtArgs = buildWtLaunchArgs({
  workspaceRoot: 'C:\\workspaces\\sample-app',
  title: 'Auth; Service',
  cwd: 'C:\\workspaces\\sample-app\\backend',
  command: 'set A=1&& python run.py auth'
});
assert.deepEqual(wtArgs.slice(0, 6), [
  '-w', w1,
  'new-tab',
  '--title', '"Auth\\; Service"',
  '-d'
]);
assert.equal(wtArgs[6], 'C:\\workspaces\\sample-app\\backend');
assert.deepEqual(wtArgs.slice(7, 11), ['cmd.exe', '/d', '/s', '/c']);
assert.equal(wtArgs[11], '"set A=1&& python run.py auth & exit 0"');

// 3. Dead tab detection strictly matches Windows Terminal exited banners only
assert.equal(
  isDeadTabBuffer('Build complete\nC:\\workspaces\\sample-app>\n[process exited with code 4294967295 (0xffffffff)]\nYou can now close this terminal with Ctrl+D, or press Enter to restart.'),
  true
);
assert.equal(
  isDeadTabBuffer('[process exited with code 1 (0x00000001)]\nYou can now close this terminal with Ctrl+D, or press Enter to restart.'),
  true
);
assert.equal(isDeadTabBuffer(''), false);
assert.equal(isDeadTabBuffer('93 unchanged chunks\nCompiled successfully.'), false);
assert.equal(isDeadTabBuffer('Log line mentioning [process exited with code 1] without WT footer'), false);

// 4. Cleanup PowerShell script keeps regex backslashes intact (String.raw)
const psScript = buildCleanupPowerShellScript({ workspaceRoot: 'C:\\workspaces\\sample-app', dryRun: true });
assert.ok(psScript.includes("-split '\\r?\\n'"), 'PS script must preserve \\r?\\n regex');
assert.ok(psScript.includes("-match '\\[process exited with code '"), 'PS script must preserve \\[ regex');
assert.ok(psScript.includes("(?i)(^|\\s)/k(\\s|$)"), 'PS script must preserve \\s regex');

// 5. CLI parser
const parsed = parseCliArgs([
  'node', 'workspace-terminal.cjs', 'launch',
  '--workspace', 'C:\\workspaces\\sample-app',
  '--title', 'authentication',
  '--cwd', 'C:\\workspaces\\sample-app\\backend',
  '--', 'python', 'run_service.py', 'authentication'
]);
assert.equal(parsed.subcommand, 'launch');
assert.equal(parsed.opts.workspaceRoot, 'C:\\workspaces\\sample-app');
assert.equal(parsed.opts.title, 'authentication');
assert.equal(parsed.opts.cwd, 'C:\\workspaces\\sample-app\\backend');
assert.equal(parsed.opts.command, 'python run_service.py authentication');

// 6. Real Windows cmd.exe /d /s /c exit-0 verification when inner command fails
if (process.platform === 'win32') {
  const sample = wrapCommandAutoClose('set WT_TEST_ENV=ok&& "' + process.execPath + '" -e "console.log(process.env.WT_TEST_ENV); process.exit(1)"');
  const res = cp.spawnSync('cmd.exe', ['/d', '/s', '/c', '"' + sample + '"'], {
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: true
  });
  assert.equal(res.status, 0, 'Wrapped failing command must still exit 0 so WT closes the tab');
  assert.equal(res.stdout.trim(), 'ok');
}

console.log('Workspace terminal helper: all checks passed');
