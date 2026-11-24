const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

const fnMatch = serverSrc.match(/function resolveGooseMaxTokens\([\s\S]*?\n\}/);
assert.ok(fnMatch, 'server.js must define resolveGooseMaxTokens');

const sandbox = { process: { env: {} } };
vm.runInNewContext(fnMatch[0], sandbox);
const { resolveGooseMaxTokens } = sandbox;

// Gemini routes default to 65536 to avoid 9Router 16384 output cutoff
for (const model of [
  'ag/gemini-4-neon-medium',
  'ag/gemini-4-argon-medium',
  'ag/gemini-4-hydrogen-high',
  'ag/gemini-3.8-flash',
  'gemini-2.5-flash'
]) {
  assert.equal(resolveGooseMaxTokens(model, ''), '65536', `Expected 65536 for ${model}`);
}

// Non-Gemini routes stay unset so Goose preserves native defaults (e.g. 128000 for GPT-6.1)
for (const model of ['cx/gpt-6.1-sol', 'ag/claude-opus-5-5-medium', 'ag/gpt-oss-120b-medium', '']) {
  assert.equal(resolveGooseMaxTokens(model, ''), '', `Expected empty override for ${model}`);
}

// Explicit env override always wins
assert.equal(resolveGooseMaxTokens('cx/gpt-6.1-sol', '32768'), '32768');
assert.equal(resolveGooseMaxTokens('ag/gemini-4-neon-medium', '98304'), '98304');

// Verify server.js wires GOOSE_MAX_TOKENS into spawn env and warns on thinking-only cutoff
assert.ok(serverSrc.includes('const gooseMaxTokens = resolveGooseMaxTokens(model);'), 'server.js must call resolveGooseMaxTokens(model)');
assert.ok(serverSrc.includes('env.GOOSE_MAX_TOKENS = gooseMaxTokens;'), 'server.js must assign env.GOOSE_MAX_TOKENS');
assert.ok(serverSrc.includes('stepHasThinking && !stepHasText && !stepHasToolCall && !stepHasError'), 'server.js must detect thinking-only truncated turns');

console.log('test_gemini_max_tokens: all assertions passed');
