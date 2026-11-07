'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const start = html.indexOf('    function buildHistoryItemsFromConversation(');
const end = html.indexOf('    function normalizePromptForCompare', start);
const context = vm.createContext({
  currentSelectedModel: 'model-b', currentSessionId: 'test',
  localStorage: { getItem: () => null },
  messageTime: msg => msg.created || null,
  normalizePromptForCompare: text => text.trim(),
  extractSubagentsAndUserText: text => ({ userText: text, subagents: [] }),
  isInternalConversationMessage: () => false
});
vm.runInContext(html.slice(start, end), context);
const user = text => ({ role: 'user', content: [{ type: 'text', text }] });
const answer = (model, text) => ({ role: 'assistant', metadata: model ? { inference: { requestedModel: model } } : {}, content: [{ type: 'text', text }] });
const items = context.buildHistoryItemsFromConversation([
  user('first'), answer('model-a', 'A'), answer('model-a', 'continued'),
  user('second'), answer('model-b', 'B'),
  user('legacy'), answer(null, 'unknown'), answer('model-c', 'different')
]);
const assistants = items.filter(item => item.role === 'assistant');
assert.deepEqual(Array.from(assistants, item => item.modelId), ['model-a', 'model-b', null, 'model-c']);
assert.equal(assistants[0].rawContent.length, 2);
context.currentSelectedModel = 'model-z';
assert.equal(assistants[0].modelId, 'model-a');
assert.ok(html.includes('createAiMessageContainer(item.modelId || null, false, false)'));
assert.ok(html.includes('const model = modelId === null'));
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  if (match[1].trim()) new vm.Script(match[1]);
}
console.log('PASS: per-message model, mixed-model history, legacy unknown, frontend syntax');
