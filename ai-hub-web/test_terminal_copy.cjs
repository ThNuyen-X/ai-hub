const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const start = html.indexOf('    function getToolArgumentsClipboardText(');
const end = html.indexOf('    function appendToolCard(', start);
const ctx = vm.createContext({});
vm.runInContext(html.slice(start, end), ctx);
const command = 'powershell -NoProfile -Command "Get-Content \'D:\\test folder\\file.txt\'"';
for (const name of ['shell', 'developer__shell', 'bash', 'cmd']) {
  assert.equal(ctx.getToolArgumentsClipboardText(name, { command, timeout_secs: 30 }), command);
  assert.equal(ctx.getToolArgumentsClipboardText(name, JSON.stringify({ command, timeout_secs: 30 })), command);
}
assert.equal(ctx.getToolArgumentsClipboardText('shell', { command: 'echo first\necho second' }), 'echo first\necho second');
assert.equal(ctx.getToolArgumentsClipboardText('shell', 'git status --short'), 'git status --short');
const args = { path: 'test.txt', before: 'old', after: 'new' };
assert.equal(ctx.getToolArgumentsClipboardText('edit', args), JSON.stringify(args, null, 2));
const workspace = 'E:\\SSO\\code\\test folder';
assert.equal(ctx.getToolArgumentsClipboardText('shell', { command }, workspace), "cmd.exe /d /s /c '" + ('cd /d "' + workspace + '" && ' + command).replace(/'/g, "''") + "'");
assert.equal(ctx.getToolArgumentsClipboardText('shell', JSON.stringify({ command: 'git status' }), workspace), "cmd.exe /d /s /c 'cd /d \"" + workspace + "\" && git status'");
// Execute the generated clipboard text in Windows PowerShell, not just compare strings.
if (process.platform === 'win32') {
  const cp = require('node:child_process');
  const sample = ctx.getToolArgumentsClipboardText('shell', { command: 'node -p "process.cwd()"' }, __dirname);
  const output = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', sample], { encoding: 'utf8' });
  assert.equal(output.trim().toLowerCase(), __dirname.toLowerCase());
}
assert.equal(ctx.getToolArgumentsClipboardText('shell', { command: 'pwd' }, "/tmp/user's project"), "cd -- '/tmp/user'\\''s project' && pwd");
assert.equal(ctx.getToolArgumentsClipboardText('edit', args, workspace), JSON.stringify(args, null, 2));
assert.ok(html.includes('data-clip="${escapeHtml(getToolArgumentsClipboardText(toolName, args, currentWorkspace))}"'));
console.log('Terminal copy: raw commands, JSON argument decoding, quoting, multiline and non-shell fallback passed');
