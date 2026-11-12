const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'server.cjs'), 'utf8');
let now = 1000000;
class Clock extends Date { static now() { return now; } }
const calls = [];
const config = { schedule: { waitAiIdle: false }, uptimeAlert: { enabled: false } };
let response;
const context = vm.createContext({
  req: { method: 'POST' }, pathname: '/api/schedule/countdown',
  readJson: async () => ({ minutes: 30, action: 'shutdown' }),
  remoteConfig: config, waitingForAiIdleReason: null, Date: Clock,
  saveConfig() {}, buildStatusScheduleSummary: () => ({ schedule: config.schedule }),
  sendJson: data => { response = data; },
  triggerSystemShutdown: (...args) => calls.push(args),
  os: { uptime: () => 0 }, isAnyAiSessionRunning: async () => false,
  shutdownState: { active: false }, getTodayDateString: () => 'today'
});
const start = source.indexOf('  if (req.method === "POST" && pathname === "/api/schedule/countdown")');
const end = source.indexOf('  //', start + 5);
const route = source.slice(start, end);
const schedulerStart = source.indexOf('async function evaluateUptimeAndSchedules()');
const schedulerEnd = source.indexOf('\nsetInterval(', schedulerStart);
vm.runInContext(source.slice(schedulerStart, schedulerEnd), context);
(async () => {
  for (const action of ['shutdown', 'restart', 'screen-off', 'lock']) {
    context.readJson = async () => ({ minutes: 30, action });
    vm.runInContext('(function(){' + route + '})()', context);
    await new Promise(setImmediate);
    assert.equal(response.ok, true);
    assert.equal(config.schedule.countdownTargetAt, now + 1800000);
    assert.equal(config.schedule.countdownAction, action);
    calls.length = 0;
    await context.evaluateUptimeAndSchedules();
    assert.equal(calls.length, 0, 'saving or checking a future schedule must not execute ' + action);
    now += 1800000;
    await context.evaluateUptimeAndSchedules();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], action);
    assert.equal(config.schedule.countdownActive, false);
  }
  console.log('PASS: all countdown actions save without execution and fire only when due (mocked power commands)');
})().catch(e => { console.error(e); process.exitCode = 1; });
