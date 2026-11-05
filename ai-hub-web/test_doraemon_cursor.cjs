'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { buildDoraemonFeedback } = require('./doraemon-cursor.cjs');
const { BrowserHub } = require('./browser-broker.cjs');

(async () => {
  // 1. Check feedback generator
  const clickFeedback = buildDoraemonFeedback('click', { uid: '1_2', pageId: 0 });
  assert.ok(clickFeedback, 'Click feedback should be generated');
  assert.equal(clickFeedback.pageId, 0);
  assert.deepEqual(clickFeedback.args, ['1_2']);
  assert.ok(clickFeedback.function.includes('__ai_hub_doraemon_cursor'));
  assert.ok(clickFeedback.function.includes('d-ripple'));
  assert.ok(clickFeedback.function.includes('doraemon-meme-img') || clickFeedback.function.includes('doraemon-full-body'), 'Must render meme or full-body Doraemon');

  // MCP expects a callable function and passes resolved DOM elements, not UID attributes.
  const feedbackFn = require('node:vm').runInNewContext('(' + clickFeedback.function + ')');
  assert.equal(typeof feedbackFn, 'function');
  assert.ok(clickFeedback.function.includes('targetEl.getBoundingClientRect()'));
  assert.ok(!clickFeedback.function.includes('data-devtools-uid'));
  const quotedFeedback = buildDoraemonFeedback('fill', { uid: '1_3', value: "O'Brien\\notes\n" });
  assert.equal(typeof require('node:vm').runInNewContext('(' + quotedFeedback.function + ')'), 'function');

  const fillFeedback = buildDoraemonFeedback('fill', { uid: '1_3', value: 'Hello Doraemon', pageId: 1 });
  assert.ok(fillFeedback);
  assert.deepEqual(fillFeedback.args, ['1_3']);
  assert.ok(fillFeedback.function.includes('Hello Doraemon'));

  const navFeedback = buildDoraemonFeedback('navigate_page', { url: 'https://example.com' });
  assert.ok(navFeedback);
  assert.deepEqual(navFeedback.args, []);
  assert.ok(navFeedback.function.includes('example.com'));

  assert.ok(!clickFeedback.function.includes("addEventListener('mousemove'"), 'AI feedback must not follow the human mouse');
  assert.ok(!clickFeedback.function.includes('setInterval('), 'No perpetual animation timers');
  const vm = require('node:vm');
  const root = { style: { display: '' } };
  let removed = 0;
  let cleared = 0;
  const captureContext = {
    document: {
      getElementById: () => root,
      querySelectorAll: () => [{ remove() { removed++; } }]
    },
    window: { __ai_hub_doraemon_state: { idleTimer: 1 } },
    clearTimeout() { cleared++; }
  };
  for (const name of ['take_screenshot', 'take_snapshot', 'screencast_start', 'screencast_stop']) {
    root.style.display = '';
    const feedback = buildDoraemonFeedback(name, { pageId: 7, uid: 'element' });
    assert.equal(feedback.pageId, 7);
    assert.deepEqual(feedback.args, []);
    vm.runInNewContext('(' + feedback.function + ')()', captureContext);
    assert.equal(root.style.display, 'none');
    if (name === 'screencast_start') assert.equal(captureContext.window.__ai_hub_meme_recording, true);
    if (name === 'screencast_stop') assert.equal(captureContext.window.__ai_hub_meme_recording, false);
  }
  assert.equal(removed, 4);
  assert.equal(cleared, 4);
  vm.runInNewContext('(' + clickFeedback.function + ')()', {
    window: { __ai_hub_meme_recording: true },
    document: { getElementById() { throw new Error('Recording must not create an overlay'); } }
  });

  // Unknown or self-eval tools must return null to prevent loops
  assert.equal(buildDoraemonFeedback('evaluate_script', {}), null);
  assert.equal(buildDoraemonFeedback('unrelated_tool', {}), null);

  // 2. Test BrowserHub triggerDoraemon execution with mock child
  const executedCalls = [];
  const hub = new BrowserHub(() => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(chunk, encoding, done) {
        const msg = JSON.parse(chunk.toString());
        done();
        if (msg.id === undefined) return;
        if (msg.method === 'initialize') {
          child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } }) + '\n');
          return;
        }
        executedCalls.push(msg.params?.name);
        setTimeout(() => {
          child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: msg.params?.name || 'ok' }] } }) + '\n');
        }, 5);
      }
    });
    return child;
  });

  await hub.handle({ method: 'initialize', params: {} });
  
  // Call 'click' tool
  const result = await hub.handle({
    method: 'tools/call',
    params: { name: 'click', arguments: { uid: 'btn_1' } }
  });

  assert.equal(result.content[0].text, 'click');
  // Both evaluate_script (Doraemon animation) and click should have run
  assert.ok(executedCalls.includes('evaluate_script'), 'evaluate_script for Doraemon should be called');
  assert.ok(executedCalls.includes('click'), 'Original click should be called');
  assert.equal(executedCalls[0], 'evaluate_script');
  assert.equal(executedCalls[1], 'click');

  for (const name of ['take_screenshot', 'screencast_start', 'screencast_stop']) {
    executedCalls.length = 0;
    await hub.handle({ method: 'tools/call', params: { name, arguments: { pageId: 7 } } });
    assert.deepEqual(executedCalls, ['evaluate_script', name], 'Hide feedback before capture');
  }

  console.log('Doraemon cursor generator and BrowserHub trigger tests passed successfully!');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
