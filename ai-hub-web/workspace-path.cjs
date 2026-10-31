const path = require('node:path');

function cleanWorkspacePath(value) {
  let clean = String(value || '').trim().replace(/\//g, '\\');
  if (/^\\\\\?\\UNC\\/i.test(clean)) clean = '\\\\' + clean.slice(8);
  else if (/^\\\\\?\\[a-z]:\\/i.test(clean)) clean = clean.slice(4);
  return path.win32.normalize(clean);
}

function workspaceKey(value) {
  return cleanWorkspacePath(value).replace(/[\\/]+$/, '').toLowerCase();
}

module.exports = { cleanWorkspacePath, workspaceKey };
