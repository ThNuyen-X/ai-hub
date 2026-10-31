const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('public/index.html', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('    function updateFullConvPosition()');
const end = source.indexOf('    function renderFullConvModalContent(', start);
let rows = [], rendered = 0;
const container = {
  scrollTop: 30, attrs: {},
  get scrollHeight() { return rows.length * 20; },
  setAttribute(k, v) { this.attrs[k] = v; },
  prepend(fragment) { rows.unshift(...fragment.rows); },
  append(fragment) { rows.push(...fragment.rows); }
};
const position = {};
const context = vm.createContext({
  setTimeout, console,
  document: {
    getElementById: id => id === 'fullConvPosition' ? position : container,
    createDocumentFragment: () => ({rows: []})
  },
  renderSingleHistoryItem: (item, fragment) => { rendered++; fragment.rows.push(item); }
});
vm.runInContext(`let fullConvRenderVersion=1, fullConvLoading=false, fullConvStart=24, fullConvEnd=24; const FULL_CONV_BATCH_SIZE=12; let fullConvMatches=Array.from({length:36},(_,i)=>i); ${source.slice(start,end)}`, context);
(async () => {
  await context.loadFullConvBatch('newer');
  assert.deepEqual(rows, Array.from({length:12}, (_,i) => i+24));
  assert.equal(rendered,12);
  assert.equal(container.attrs['aria-busy'],'false');
  await context.loadFullConvBatch('older');
  assert.equal(rows[0],12);
  assert.equal(rows.at(-1),35);
  assert.equal(container.scrollTop,270);
  assert.equal(position.textContent,'Tin 13–36 / 36');
  const pending = context.loadFullConvBatch('older');
  vm.runInContext('fullConvRenderVersion++',context);
  await pending;
  assert.equal(rows.length,24,'Cancelled batch must not alter the conversation');
  console.log('Conversation modal: bounded batches, chronology, scroll anchoring and cancellation passed');
})().catch(error => { console.error(error); process.exitCode=1; });
