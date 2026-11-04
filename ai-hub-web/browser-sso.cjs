const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(process.env.TEMP || process.env.TMP || '.', 'chrome-sso-dev');
function ssoAvailable() { return fs.existsSync(path.join(directory, 'DevToolsActivePort')); }
function ssoEndpoint(root = directory) {
  const lines = fs.readFileSync(path.join(root, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(lines[1] || '')) throw new Error('Invalid SSO Chrome DevToolsActivePort');
  return `ws://127.0.0.1:${port}${lines[1]}`;
}
if (require.main === module) {
  require('./browser-broker.cjs').runProxy('sso').catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { ssoAvailable, ssoEndpoint };
