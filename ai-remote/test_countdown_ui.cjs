const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, 'public/index.html'), 'utf8');
const source = html.slice(html.indexOf('    let scheduleStatusVersion ='), html.indexOf('    async function snoozeUptimeAlert'));
(async () => {
  const input = { value: '20' };
  const events = [];
  let resolveRequest;
  let requests = 0;
  const context = vm.createContext({
    document: { getElementById: id => id === 'custom-countdown-min' ? input : id === 'custom-countdown-action' ? { value: 'shutdown' } : { scrollIntoView: () => events.push('visible') } },
    fetch: () => { requests++; return new Promise(resolve => { resolveRequest = resolve; }); },
    applyScheduleStatusToUi: d => { assert.equal(d.schedule.countdownActive, true); events.push('render'); },
    showToast: msg => events.push(msg)
  });
  vm.runInContext(source, context);
  const pending = context.startCustomCountdown();
  assert.equal(input.value, '20', 'retain input while saving');
  assert.equal(await context.setCountdownTimer(20), false, 'coalesce repeated click');
  assert.equal(requests, 1);
  resolveRequest({ ok: true, json: async () => ({ ok: true, schedule: { countdownActive: true }, message: 'saved' }) });
  await pending;
  assert.deepEqual(events, ['render', 'visible', 'saved']);
  assert.equal(input.value, '');
  input.value = '30';
  const failed = context.startCustomCountdown();
  resolveRequest({ ok: false, json: async () => ({ ok: false, error: 'failed' }) });
  await failed;
  assert.equal(input.value, '30', 'retain input on error');
  assert.equal(events.filter(e => e === 'render').length, 1);
  assert.ok(html.includes('!countdownRequestPending && statusVersion === scheduleStatusVersion'));
  const actionSource = html.slice(html.indexOf('    async function systemAction(a)'), html.indexOf('    function confirmSystemAction(type)'));
  let powerRequests = 0;
  let confirmed = false;
  const powerContext = vm.createContext({
    confirm: () => confirmed,
    fetch: async () => { powerRequests++; return { json: async () => ({ ok: true }) }; },
    showToast() {}
  });
  vm.runInContext(actionSource, powerContext);
  await powerContext.systemAction('lock');
  await powerContext.systemAction('screen-off');
  assert.equal(powerRequests, 0, 'reject accidental immediate lock and screen-off');
  confirmed = true;
  await powerContext.systemAction('lock');
  await powerContext.systemAction('screen-off');
  assert.equal(powerRequests, 2, 'explicit confirmation permits immediate controls');
  console.log('PASS: countdown render, duplicate clicks, errors, stale polls, immediate power confirmation');
})().catch(err => { console.error(err); process.exitCode = 1; });
