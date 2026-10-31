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
for (const name of ['extractSubagentsAndUserText', 'parseSubagentReports', 'messageTime', 'timingLabel', 'safeStringifyCode', 'historyItemText', 'escapeHtml', 'escapeJs', 'buildHistoryItemsFromConversation']) {
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
const subagentPrompt = 'thêm nút xem web toàn màn hình, Subagent 20261031_23 completed: {"summary":"task 23 done"}Subagent 20261031_22 completed: {"summary":"task 22 done"}Subagent 20261031_21 completed: {"summary":"task 21 done"} với cả mấy cái này tự nhiên thành câu hỏi của tôi, thiết kế lại đi';
const subagentItems = context.buildHistoryItemsFromConversation([
  { role: 'user', created: 1700000000, content: [{ type: 'text', text: subagentPrompt }] },
  { role: 'assistant', created: 1700000005, content: [{ type: 'text', text: 'Đã thiết kế lại giao diện Subagent.' }] }
]);
assert.equal(subagentItems.length, 3);
assert.equal(subagentItems[0].role, 'user');
assert.ok(subagentItems[0].text.includes('thêm nút xem web toàn màn hình'));
assert.ok(subagentItems[0].text.includes('thiết kế lại đi'));
assert.equal(subagentItems[1].role, 'subagent');
assert.equal(subagentItems[1].subagents.length, 3);
assert.equal(subagentItems[1].subagents[0].id, '20261031_23');
assert.equal(subagentItems[2].role, 'assistant');
assert.equal(subagentItems[2].questionText, subagentItems[0].text);
assert.ok(source.includes('sub_content_${subSnippetId}" class="p-3.5 sm:p-4 text-xs sm:text-[13px] leading-relaxed subagent-body subagent-markdown-body markdown-body border-t hidden"'));
assert.ok(source.includes('id="sub_chevron_${subSnippetId}"\n                        style="transform: rotate(-90deg);"'));
assert.ok(!source.includes('subagent-body ai-content-body'));
assert.ok(html.includes('#promptInput::placeholder'));
assert.ok(html.includes('font-style: italic !important;'));
assert.ok(html.includes('font-weight: 400 !important;'));
assert.ok(html.includes('placeholder:italic placeholder:font-normal placeholder:text-xs'));
assert.ok(html.includes('btnToggleComposerCollapse'));
assert.ok(html.includes('mainDockBox'));
assert.ok(html.includes('composerCollapsedBar'));
assert.ok(html.includes('composerBottomArrow'));
assert.ok(html.includes('composerBottomArrowWrapper'));
assert.ok(html.includes('btnFloatingExpandComposer'));
assert.ok(source.includes('function toggleComposerCollapse('));
assert.ok(source.includes('function handleComposerHeaderClick('));
assert.ok(source.includes('function initHubEvents('));
assert.ok(source.includes('clientTabId'));
assert.ok(source.includes("e.key.toLowerCase() === 'j'"));
console.log('Chat UI: 33 regression checks passed');
