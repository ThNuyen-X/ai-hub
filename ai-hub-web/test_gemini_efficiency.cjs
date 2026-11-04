const assert = require('node:assert/strict');
const { buildSystemInstruction } = require('./system-instruction.cjs');
const baseline = buildSystemInstruction();
const marker = '[GEMINI EXECUTION EFFICIENCY]';
for (const model of ['ag/gemini-3.8-flash', 'gemini-3.8-flash', 'google/gemini-2.5-pro', 'AG/GEMINI-3.8-FLASH', ' ag/gemini-3.8-flash ']) {
  const prompt = buildSystemInstruction(undefined, model);
  assert.ok(prompt.includes(marker), model);
  assert.ok(prompt.includes('Batch independent searches'));
  assert.ok(prompt.includes('Do not skip verification'));
  assert.equal(prompt.split(marker).length, 2);
}
for (const model of ['', undefined, null, 'cx/gpt-6.1-sol', 'openai/gpt-5', 'ag/claude-sonnet-5-5', 'claude-opus', 'custom-gemini-wrapper', 'geminiish', 'gemini/gpt-5']) {
  assert.equal(buildSystemInstruction(undefined, model), baseline, 'Other models remain byte-identical: ' + model);
}
console.log('Gemini efficiency: scoped model matching, safety rules and unchanged non-Gemini instructions passed');
