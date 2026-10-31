const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8').replace(/\r\n/g, '\n');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function definition(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n    function ', start + 1);
  return source.slice(start, end < 0 ? source.length : end).split('\n    async function ')[0].split('\n    // ')[0];
}
const context = vm.createContext({ console, setTimeout, clearTimeout, Date, Number, String, Map });
for (const name of ['messageTime', 'timingLabel', 'safeStringifyCode', 'historyItemText', 'escapeHtml', 'escapeJs', 'buildHistoryItemsFromConversation']) {
  new vm.Script(definition(name)).runInContext(context);
}
assert.equal(context.messageTime({created: 1700000000}), 1700000000000);
assert.equal(context.messageTime({created_at: '2026-10-30T10:00:00Z'}), Date.parse('2026-10-30T10:00:00Z'));
assert.equal(context.messageTime({}), null);
assert.equal(context.messageTime({created: 'invalid'}), null);
assert.match(context.timingLabel({role: 'assistant', startedAt: 1700000000000, elapsedMs: 1250}), /1\.3 giây/);
const items = context.buildHistoryItemsFromConversation([
 {role:'user',created:1700000000,content:[{type:'text',text:'hello'}]},
 {role:'assistant',created:1700000002,content:[{type:'text',text:'world'}]}
]);
assert.equal(items.length,2);
assert.equal(items[0].elapsedMs,2000);
assert.equal(context.historyItemText(items[1]), 'world');
const runtimeContext = '<turn-context>\n<current-time>2026-10-31</current-time>\n<working-directory>D:\\workspace</working-directory>\n</turn-context>';
const cleanedItems = context.buildHistoryItemsFromConversation([
 {role:'user',content:[{type:'text',text:'Fix the database'}]},
 {role:'user',content:[{type:'text',text:runtimeContext}]},
 {role:'assistant',content:[{type:'text',text:'Done'}]},
 {role:'user',content:[{type:'text',text:'Next question\n' + runtimeContext}]}
]);
assert.equal(cleanedItems.length, 3);
assert.equal(cleanedItems[1].questionText, 'Fix the database');
assert.equal(cleanedItems[2].text, 'Next question');
assert.ok(!cleanedItems.some(item => (item.text || '').includes('<turn-context>')));
const filename = 'D:\\folder\\a\'"&<.png';
const encoded = context.escapeJs(filename);
assert.ok(!encoded.includes('"'));
const decoded = encoded.replace(/&#039;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
assert.equal(vm.runInNewContext(`'${decoded}'`),filename);
assert.ok(source.includes('currentSessionHistoryItems = [];\n      currentHistoryRenderIndex = 0;'));
assert.ok(source.includes('if (viewVersion !== sessionViewVersion) return;'));
assert.ok(source.includes('await reader.cancel(); return;'));
assert.ok(source.includes('const FULL_CONV_BATCH_SIZE = 12;'));
assert.ok(source.includes('renderSingleHistoryItem(fullConvMatches[i], fragment)'));
assert.ok(!source.includes('transcript-pagination'));
assert.ok(source.includes("loadFullConvBatch('older')"));
assert.ok(source.includes('requestAnimationFrame(() => requestAnimationFrame(async () =>'));
assert.ok(!source.includes('items.forEach(item => {\n        renderSingleHistoryItem(item, container'));
assert.ok(source.includes('if (mount) {\n        chatFeed.appendChild(row)'));
console.log('Chat UI: 17 regression checks passed');
