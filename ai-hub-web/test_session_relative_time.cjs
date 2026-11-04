const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('    function formatRelativeTime(');
const end = html.indexOf('\n    // THEME ENGINE', start);
assert.ok(start >= 0 && end > start);
const now = Date.parse('2026-11-04T04:53:40Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
const originalTZ = process.env.TZ;
try {
  for (const tz of ['Asia/Ho_Chi_Minh', 'UTC', 'America/New_York']) {
    process.env.TZ = tz;
    const context = vm.createContext({ Date: FixedDate });
    new vm.Script(html.slice(start, end)).runInContext(context);
    const format = context.formatRelativeTime;
    assert.equal(format('2026-11-04 04:53:11'), 'v\u1eeba xong', tz);
    assert.equal(format('2026-11-04T04:53:11.000'), 'v\u1eeba xong', tz);
    for (const value of ['2026-11-04 04:48:40', '2026-11-04T04:48:40Z', '2026-11-04T11:48:40+07:00']) {
      assert.equal(format(value), '5m tr\u01b0\u1edbc', `${tz}: ${value}`);
    }
    assert.equal(format('2026-11-04 02:53:40'), '2h tr\u01b0\u1edbc');
    assert.equal(format('invalid'), '');
    assert.equal(format(null), '');
  }
} finally {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
}
console.log('Session relative time tests passed');
