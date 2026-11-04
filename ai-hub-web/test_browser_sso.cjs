const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ssoEndpoint } = require('./browser-sso.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-sso-test-'));
try {
  const file = path.join(root, 'DevToolsActivePort');
  fs.writeFileSync(file, '50342\r\n/devtools/browser/test-id\r\n');
  assert.equal(ssoEndpoint(root), 'ws://127.0.0.1:50342/devtools/browser/test-id');
  for (const text of ['0\n/devtools/browser/id', '65536\n/devtools/browser/id', '50342\nws://evil.test', 'abc\n/devtools/browser/id']) {
    fs.writeFileSync(file, text); assert.throws(() => ssoEndpoint(root), /Invalid/);
  }
  const source = fs.readFileSync(path.join(__dirname, 'browser-broker.cjs'), 'utf8');
  assert.ok(source.includes("target === 'sso' ? '-sso' : ''"));
  assert.ok(source.includes("['--autoConnect']"));
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(server.includes('ssoBrowserEnabled && !savedSsoBrowser'));
  assert.ok(server.includes('chrome_devtools_sso:'));
  console.log('SSO browser: explicit loopback endpoint, invalid endpoint rejection, separate broker and resume guard passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
