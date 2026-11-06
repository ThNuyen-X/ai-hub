'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { buildDoraemonFeedback } = require('./doraemon-cursor.cjs');

const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc\s*=/.test(match[1]) && match[2].trim()) new vm.Script(match[2]);
}

assert.match(html, /\.browser-activity,\s*\.browser-tool-card\s*\{[^}]*container-type:\s*inline-size/);
assert.match(html, /\.browser-tool-card\s*>\s*div:first-child\s*\{[^}]*flex-wrap:\s*nowrap/);
assert.match(html, /\.browser-tool-card\s+\.browser-tool-action\s*\{[^}]*flex-shrink:\s*0;\s*white-space:\s*nowrap/);
assert.match(html, /@container\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.browser-tool-card\s+\.tool-status-label\s*\{\s*display:\s*none;/);
assert.match(html, /@container\s*\(max-width:\s*430px\)\s*\{[\s\S]*?\.browser-meta-target\s*\{\s*flex-basis:\s*100%;/);

const start = html.indexOf('    function buildCompactFileStatusHtml(');
const end = html.indexOf('    function expandToolCardOutput(', start);
const actStart = html.indexOf('    function updateBrowserActivity(');
const actEnd = html.indexOf('    // EVENT PROCESSING LOGIC', actStart);
assert.ok(start > 0 && end > start && actStart > 0 && actEnd > actStart);

function makeEl(tag = 'div') {
  const classes = new Set();
  const children = [];
  const el = {
    tagName: tag.toUpperCase(),
    id: '',
    innerHTML: '',
    textContent: '',
    title: '',
    style: {},
    dataset: {},
    children,
    classList: {
      add: (...xs) => xs.forEach(x => classes.add(x)),
      remove: (...xs) => xs.forEach(x => classes.delete(x)),
      contains: x => classes.has(x)
    },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    append(...nodes) { children.push(...nodes); },
    appendChild(node) { children.push(node); return node; },
    replaceChildren(...nodes) { children.length = 0; children.push(...nodes); },
    querySelector(sel) {
      const matchNode = n => {
        if (!n) return false;
        if (sel === 'strong') return n.tagName === 'STRONG';
        if (sel === 'small') return n.tagName === 'SMALL';
        if (sel.startsWith('.')) return (n.className || '').split(/\s+/).includes(sel.slice(1)) || n.classList?.contains(sel.slice(1));
        return false;
      };
      const walk = list => {
        for (const c of list) {
          if (matchNode(c)) return c;
          const found = c.children ? walk(c.children) : null;
          if (found) return found;
        }
        return null;
      };
      return walk(children);
    }
  };
  Object.defineProperty(el, 'className', {
    get() { return [...classes].join(' '); },
    set(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach(x => classes.add(x)); }
  });
  return el;
}

const byId = new Map();
const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const ctx = vm.createContext({
  window: {},
  document: { createElement: makeEl, getElementById: id => byId.get(id) },
  escapeHtml,
  escapeJs: s => String(s ?? ''),
  closeActiveThoughtIfNeeded() {},
  flushAiTextRender() {},
  moveActiveTextToProcessGroup() {},
  appendTerminalLog() {},
  formatToolOutputForDisplay: text => ({ text: text || '', truncated: false }),
  ensureAiProcessGroup: () => makeEl('div'),
  updateAiProcessGroupSummary() {},
  getToolArgumentsClipboardText: () => '',
  currentWorkspace: 'D:/ai-hub',
  notifyNewMessageArrived() {},
  extractToolFileMutations: () => [],
  _sessionHelperScriptsMap: new Map(),
  _sessionHistoryMutationsSeeded: true,
  recordToolMutationsInSession() {},
  _toolCardMutationsByKey: new Map(),
  getRecordedFileChange: () => null,
  buildToolFileStatusPillHtml: () => '',
  buildToolFileStatsHtml: () => ''
});

vm.runInContext(html.slice(start, end) + '\n' + html.slice(actStart, actEnd), ctx);

const navMeta = ctx.describeBrowserToolCall('chrome_devtools__navigate_page', { pageId: 3, url: 'https://example.com/docs/guide' });
assert.equal(navMeta.actionLabel, 'Mở trang');
assert.equal(navMeta.channel.key, 'dev');
assert.equal(navMeta.summary, 'Tab #3 · example.com/docs/guide');

const ssoMeta = ctx.describeBrowserToolCall('chrome_devtools_sso__fill_form', { pageId: 1, elements: [{ uid: '4_1', value: 'demo_user' }, { uid: '4_2', value: 'sample' }] });
assert.equal(ssoMeta.channel.key, 'sso');
assert.equal(ssoMeta.actionLabel, 'Điền biểu mẫu');
assert.match(ssoMeta.summary, /^Tab #1 · 2 trường \(demo_user\)/);

const personalMeta = ctx.describeBrowserToolCall('chrome_devtools_personal__evaluate_script', { pageId: 0, function: 'async () => { return document.title; }' });
assert.equal(personalMeta.channel.key, 'personal');
assert.equal(personalMeta.actionLabel, 'Chạy JS');
assert.match(personalMeta.summary, /return document\.title/);

const card = ctx.appendToolCard({ isHistorical: true }, 'chrome_devtools_sso__click', { pageId: 3, uid: '43_13' }, true, '', false);
assert.ok(card.classList.contains('browser-tool-card'));
assert.ok(card.innerHTML.includes('browser-tool-action'));
assert.ok(card.innerHTML.includes('data-channel="sso"'));
assert.ok(card.innerHTML.includes('>Nhấn chuột<'));
assert.ok(card.innerHTML.includes('Tab #3 · #43_13'));
assert.ok(!card.innerHTML.includes('chrome_devtools_sso__click'));
assert.ok(card.innerHTML.includes('tool-status-label'));

const badgeNode = makeEl('span');
byId.set('badge_' + card.id, badgeNode);
ctx.updateToolCardResult(card, 'ok', false);
assert.ok(badgeNode.innerHTML.includes('tool-status-label'));
assert.ok(badgeNode.innerHTML.includes('Hoàn thành'));

const aiRow = makeEl('div');
const aiBody = makeEl('div');
aiBody.className = 'ai-content-body';
aiRow.appendChild(aiBody);
ctx.updateBrowserActivity({ row: aiRow }, 'chrome_devtools_personal__navigate_page', { pageId: 2, url: 'https://example.com/dashboard?tab=metrics' }, 'working', 'c1');
const actCard = aiBody.children[0];
assert.equal(actCard.dataset.state, 'working');
assert.equal(actCard.dataset.steps, '1');
assert.equal(actCard.querySelector('strong').textContent, 'Đang thao tác trên Chrome');
assert.equal(actCard.querySelector('.browser-activity-step').textContent, '#1');
assert.equal(actCard.querySelector('small').children.length, 4);
ctx.updateBrowserActivity({ row: aiRow }, '', {}, 'completed', 'c1');
assert.equal(actCard.dataset.state, 'completed');
assert.equal(actCard.querySelector('.browser-activity-pill-text').textContent, 'Hoàn tất');

const doraemon = buildDoraemonFeedback('click', { pageId: 0, uid: '1_1' });
assert.ok(doraemon.function.includes('max-width: min(240px, calc(100vw - 24px))'));
assert.ok(doraemon.function.includes('bubble-below'));

console.log('Browser responsive redesign checks passed!');
