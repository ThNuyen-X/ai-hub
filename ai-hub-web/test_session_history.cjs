'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { readHistoryPage, historyOutput, PREVIEW_LIMIT } = require('./session-history.cjs');
const db = new DatabaseSync(':memory:');
try {
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, message_id TEXT, role TEXT, created_timestamp INTEGER, content_json TEXT, metadata_json TEXT)');
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= 145; i++) {
    insert.run(i, 'demo', 'm' + i, i % 2 ? 'assistant' : 'user', i,
      JSON.stringify([{ type: 'text', text: 'message ' + i }]), null);
  }
  insert.run(146, 'other', 'private', 'user', 146, '[]', null);
  const first = readHistoryPage(db, 'demo');
  assert.equal(first.conversation.length, 60);
  assert.equal(first.conversation[0].id, 'm86');
  assert.equal(first.conversation.at(-1).id, 'm145');
  assert.equal(first.historyPage.hasMore, true);
  const second = readHistoryPage(db, 'demo', { before: first.historyPage.before });
  assert.equal(second.conversation.at(-1).id, 'm85');
  const third = readHistoryPage(db, 'demo', { before: second.historyPage.before });
  assert.equal(third.conversation.length, 25);
  assert.equal(third.historyPage.hasMore, false);
  assert.equal(new Set([...first.conversation, ...second.conversation, ...third.conversation].map(x => x.id)).size, 145);
  assert.equal(readHistoryPage(db, 'demo', { limit: 9000 }).conversation.length, 100);
  assert.equal(readHistoryPage(db, 'missing').historyPage.hasMore, false);
  const output = '<script>unsafe</script>' + 'x'.repeat(9_000_000);
  const block = { type: 'toolResponse', id: 'call', toolResult: { value: { isError: true, content: [{ text: output }] } } };
  insert.run(147, 'demo', 'large', 'user', 147, JSON.stringify([block]), null);
  const page = readHistoryPage(db, 'demo', { limit: 1 });
  const preview = page.conversation[0].content[0];
  assert.equal(historyOutput(preview).length, PREVIEW_LIMIT);
  assert.equal(preview.historySource.messageId, 'large');
  assert.equal(preview.historySource.length, output.length);
  assert.equal(preview.toolResult.value.isError, true);
  assert.ok(JSON.stringify(page).length < 8000);
  assert.equal(historyOutput(JSON.parse(db.prepare('SELECT content_json FROM messages WHERE id=147').get().content_json)[0]), output);
  assert.equal(historyOutput({ toolResult: { value: { stdout: 'ok', stderr: 'err' } } }), 'ok\n[STDERR]: err');
  insert.run(200, 'long-turn', 'question', 'user', 200, JSON.stringify([{ type: 'text', text: 'Original question' }]), '{"userVisible":true}');
  for (let i = 201; i <= 380; i++) insert.run(i, 'long-turn', 'long' + i, i % 2 ? 'assistant' : 'user', i,
    JSON.stringify(i % 2 ? [{ type: 'text', text: 'Working' }] : [{ type: 'toolResponse', output: 'done' }]), null);
  const longPage = readHistoryPage(db, 'long-turn');
  assert.equal(longPage.conversation.length, 60);
  assert.equal(longPage.conversation[0].historyQuestion.id, 'question');
  assert.equal(longPage.historyPage.before, 321);
  const older = readHistoryPage(db, 'long-turn', { before: 321 });
  assert.equal(older.conversation[0].historyQuestion.id, 'question');
  const oldest = readHistoryPage(db, 'long-turn', { before: 261 });
  assert.equal(oldest.conversation[0].historyQuestion.id, 'question');
  const original = readHistoryPage(db, 'long-turn', { before: 201 });
  assert.equal(original.conversation[0].id, 'question');
  assert.equal(original.conversation[0].historyQuestion, undefined);
} finally { db.close(); }
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc\s*=/.test(match[1])) new vm.Script(match[2]);
}
assert.ok(html.includes('&limit=60'));
assert.ok(html.includes('sessionHistoryAbort?.abort()'));
assert.ok(html.includes('version !== sessionViewVersion'));
assert.ok(html.includes('if (!container.isHistorical) appendTerminalLog'));
assert.ok(html.includes('card._hydrateBody = () =>'));
assert.ok(html.includes('if (card?._hydrateBody) card._hydrateBody()'));
assert.ok(html.includes('seedSessionFileChangesFromHistory([], data?.sessionFileChanges)'));
console.log('Session history: pagination, isolation, large-output previews and UI syntax passed');
