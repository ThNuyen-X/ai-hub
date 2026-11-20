'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function main() {
  let launched;
  let failure = null;
  const context = {
    Buffer, process: { platform: 'win32' }, module: { exports: {} },
    require(name) {
      assert.equal(name, 'node:child_process');
      return {
        spawn(command, args) {
          launched = { command, args };
          const child = new EventEmitter();
          child.unref = () => {};
          queueMicrotask(() => child.emit(failure ? 'error' : 'spawn', failure));
          return child;
        },
        execFile(command, args, options, callback) {
          launched = { command, args, options };
          callback(failure, '', failure ? 'No application associated' : '');
        }
      };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./open-local-path.cjs'), 'utf8'), context);
  const open = context.module.exports.openLocalPathOnDesktop;
  const target = "D:\\My files\\O'Brien & 100% report.docx";
  await open(target);
  assert.equal(launched.command, 'powershell.exe');
  assert.ok(launched.args.includes('-NonInteractive'));
  const script = Buffer.from(launched.args.at(-1), 'base64').toString('utf16le');
  assert.ok(script.includes("Invoke-Item -LiteralPath 'D:\\My files\\O''Brien & 100% report.docx'"));
  assert.ok(script.includes('exit 1'));
  assert.equal(launched.options.windowsHide, true);
  failure = new Error('launch failed');
  await assert.rejects(open(target), /No application associated/);
  await assert.rejects(open('D:\\test.txt', { isTextSource: true }), /launch failed/);
  failure = null;
  await open('D:\\test.txt', { isTextSource: true });
  assert.equal(launched.command, 'notepad.exe');
  await open(target, { reveal: true });
  assert.equal(launched.command, 'explorer.exe');
  assert.equal(launched.args[0], '/select,');
  await open('D:\\unsafe.exe');
  assert.equal(launched.command, 'explorer.exe');
  await open('D:\\My files', { isDir: true });
  assert.equal(launched.args[0], 'D:\\My files');
  console.log('Desktop file opening: quoting, association errors, spawn errors and safe routing passed');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
