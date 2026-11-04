const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8');
const handler = html.match(/window\.regenerateLastUserPrompt = function\(button\) \{[\s\S]*?\n    \};/);
assert.ok(handler, 'regenerate handler exists');
assert.ok(html.includes('onclick="regenerateLastUserPrompt(this)"'));
const sent = [];
const warnings = [];
let mountedRow;
const context = vm.createContext({
  window: {}, isGenerating: false,
  promptHistory: ['Question from another session'],
  promptInput: { value: 'Unsent draft in this session' },
  chatFeed: { contains: row => row === mountedRow },
  sendMessage: options => sent.push(options),
  showToast: (...args) => warnings.push(args)
});
vm.runInContext(handler[0], context);
const row = { dataset: { turnQuestion: 'Question for this response' } };
mountedRow = row;
const button = { closest: selector => {
  assert.equal(selector, '[data-turn-question]');
  return row;
} };
context.window.regenerateLastUserPrompt(button);
assert.equal(sent.length, 1);
assert.equal(sent[0].promptOverride, 'Question for this response');
assert.equal(context.promptInput.value, 'Unsent draft in this session');
row.dataset.turnQuestion = 'Earlier question in the same session';
context.window.regenerateLastUserPrompt(button);
assert.equal(sent[1].promptOverride, 'Earlier question in the same session');
mountedRow = null;
context.window.regenerateLastUserPrompt(button);
assert.equal(sent.length, 2, 'detached response cannot send into another view');
mountedRow = row;
row.dataset.turnQuestion = '';
context.window.regenerateLastUserPrompt(button);
assert.equal(sent.length, 2, 'missing question never falls back to global history');
assert.equal(warnings.length, 1);
row.dataset.turnQuestion = 'Question';
context.isGenerating = true;
context.window.regenerateLastUserPrompt(button);
assert.equal(sent.length, 2, 'running session cannot regenerate');
context.window.regenerateLastUserPrompt();
assert.equal(sent.length, 2);
console.log('PASS regenerate uses the clicked session response and preserves drafts');
