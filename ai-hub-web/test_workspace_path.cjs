const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { cleanWorkspacePath, workspaceKey } = require('./workspace-path.cjs');
const normal = 'D:\\workspace\\my-app';
const extended = '\\\\?\\' + normal;
assert.equal(cleanWorkspacePath(extended), normal);
assert.equal(workspaceKey(extended), workspaceKey(normal));
assert.equal(workspaceKey(normal + '\\'), workspaceKey(normal.toLowerCase()));
assert.equal(cleanWorkspacePath('\\\\?\\UNC\\server\\share\\project'), '\\\\server\\share\\project');
assert.notEqual(workspaceKey('D:\\one\\my-app'), workspaceKey('D:\\two\\my-app'));
const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('    function normPath(');
const end = html.indexOf('\n    function ', start + 1);
const context = vm.createContext({
  currentWorkspace: 'E:\\SSO\\code\\sso',
  localPathExistenceCache: new Map(),
  getRecordedFileChange: () => null
});
vm.runInContext(html.slice(start, end), context);
assert.equal(context.normPath(extended), context.normPath(normal));
assert.equal(context.normPath('\\\\?\\UNC\\server\\share'), context.normPath('\\\\server\\share'));
assert.equal(context.normPath(normal + '\\'), context.normPath(normal.toLowerCase()));
assert.notEqual(context.normPath('D:\\one\\my-app'), context.normPath('D:\\two\\my-app'));

// Verify Windows file paths with backslash sequences like \f (\file) are escaped in onclick and resolved via data-path
const escStart = html.indexOf('    function escapeHtml(str)');
const escEnd = html.indexOf('    // EVENT PROCESSING LOGIC', escStart);
const badgeStart = html.indexOf('    function buildPathCacheKey(rawPath)');
const badgeEnd = html.indexOf('    function downgradeInvalidBadgeElement(badge)', badgeStart);
const resolveStart = html.indexOf('    function resolvePathFromClickEvent(rawPath, e)');
const resolveEnd = html.indexOf('    window.openLocalPath =', resolveStart);
vm.runInContext(html.slice(escStart, escEnd) + '\n' + html.slice(badgeStart, badgeEnd) + '\n' + html.slice(resolveStart, resolveEnd), context);

const winImgPath = 'E:\\SSO\\Document\\file\\p73.png';
const badgeHtml = context.renderPathBadgeHtml(winImgPath, winImgPath, true);
assert.ok(badgeHtml.includes('data-path="E:\\SSO\\Document\\file\\p73.png"'));
assert.ok(badgeHtml.includes("handlePathClick('E:\\\\SSO\\\\Document\\\\file\\\\p73.png', event)"));
assert.ok(badgeHtml.includes("previewLocalFile('E:\\\\SSO\\\\Document\\\\file\\\\p73.png', event)"));
assert.equal(
  context.resolvePathFromClickEvent('E:SSODocument\x0cilep73.png', {
    target: { closest: () => ({ getAttribute: (k) => k === 'data-path' ? winImgPath : null }) }
  }),
  winImgPath
);
console.log('Workspace paths: 13 normalization, deduplication and Windows backslash path badge checks passed');
