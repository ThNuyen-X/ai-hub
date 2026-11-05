'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEV_PORT, devEndpoint, isDevRunning, findChromeBinary } = require('./browser-dev.cjs');
const { personalAvailable } = require('./browser-personal.cjs');
const { pipeFor } = require('./browser-broker.cjs');
const { BROWSER_INSTRUCTION } = require('./browser-mcp.cjs');

(async () => {
  assert.equal(DEV_PORT, 9223);
  assert.equal(devEndpoint(), 'http://127.0.0.1:9223');
  assert.equal(typeof personalAvailable(), 'boolean');

  const pipeDev = pipeFor('dev');
  const pipePersonal = pipeFor('personal');
  const pipeSso = pipeFor('sso');
  assert.ok(pipeDev.endsWith('-dev'), 'dev pipe must end with -dev');
  assert.ok(pipePersonal.endsWith('-personal'), 'personal pipe must end with -personal');
  assert.ok(pipeSso.endsWith('-sso'), 'sso pipe must end with -sso');
  assert.notEqual(pipeDev, pipePersonal);
  assert.notEqual(pipeDev, pipeSso);

  assert.match(BROWSER_INSTRUCTION, /chrome_devtools \(DEFAULT\)/);
  assert.match(BROWSER_INSTRUCTION, /chrome_devtools_personal/);
  assert.match(BROWSER_INSTRUCTION, /port 9223/);

  const serverContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(serverContent.includes('chrome_devtools_personal'), 'server.js must configure chrome_devtools_personal');
  assert.ok(serverContent.includes('browser-personal.cjs'), 'server.js must reference browser-personal.cjs');

  const batContent = fs.readFileSync(path.join(__dirname, '..', 'start-chrome-dev.bat'), 'utf8');
  assert.ok(batContent.includes('--remote-debugging-port=9223'), 'start-chrome-dev.bat must specify port 9223');
  assert.ok(batContent.includes('chrome-dev-profile'), 'start-chrome-dev.bat must use dedicated profile');

  console.log('Browser Dev Mode: dedicated port 9223, isolated profile, personal mode fallback, and instruction guards passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
