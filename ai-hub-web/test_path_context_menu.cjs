'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.resolve(__dirname, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

console.log('Testing Path Context Menu (Right-click & Mobile Long-Press)...');

// 1. HTML & CSS Structure checks
for (const id of [
  'pathContextMenu',
  'pathContextMenuPanel',
  'pathContextMenuBackdrop',
  'pathContextMenuIcon',
  'pathContextMenuTitle',
  'pathContextMenuFullPath',
  'pathContextMenuStatus',
  'pathCtxBtnPreview',
  'pathCtxBtnOpen',
  'pathCtxBtnCopy'
]) {
  assert.ok(html.includes(`id="${id}"`), `Missing #${id} in index.html`);
}
assert.ok(html.includes('#pathContextMenu.active'), 'Missing #pathContextMenu.active CSS rule');
assert.ok(html.includes('#pathContextMenu.active #pathContextMenuPanel'), 'Missing mobile centered modal CSS rule for #pathContextMenuPanel');

// 2. Extract Path Context Menu JS block and execute in VM sandbox
const startIdx = html.indexOf('let currentContextMenuPath = null;');
assert.ok(startIdx > 0, 'Must find start of path context menu JS');
const endIdx = html.indexOf('window.closeFilePreview = function()', startIdx);
assert.ok(endIdx > startIdx, 'Must find end of path context menu JS');
const pathMenuCode = html.slice(startIdx, endIdx);

const docListeners = {};
const mockElements = new Map();

function createMockEl(id = '', attrs = {}) {
  const listeners = {};
  const classSet = new Set();
  const el = {
    id,
    attrs: { ...attrs },
    textContent: '',
    innerHTML: '',
    disabled: false,
    style: {},
    className: '',
    offsetHeight: 210,
    classList: {
      add: (c) => classSet.add(c),
      remove: (c) => classSet.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classSet.has(c)) classSet.delete(c);
          else classSet.add(c);
        } else if (force) classSet.add(c);
        else classSet.delete(c);
      },
      contains: (c) => classSet.has(c)
    },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    click() {
      for (const fn of (listeners.click || [])) fn({ preventDefault() {}, stopPropagation() {} });
    },
    contains(target) { return target === el; },
    closest(sel) {
      if (sel === '.local-path-badge' && classSet.has('local-path-badge')) return el;
      if (sel === '[data-local-path-action="1"]' && this.attrs['data-local-path-action'] === '1') return el;
      if (sel === '[data-file-diff-row="1"]' && this.attrs['data-file-diff-row'] === '1') return el;
      if (sel === '[data-ws-folder-row="1"]' && this.attrs['data-ws-folder-row'] === '1') return el;
      if (sel === '#currentSessionWorkspaceBadge' && this.id === 'currentSessionWorkspaceBadge') return el;
      return null;
    }
  };
  return el;
}

for (const id of [
  'pathContextMenu',
  'pathContextMenuPanel',
  'pathContextMenuBackdrop',
  'pathContextMenuIcon',
  'pathContextMenuTitle',
  'pathContextMenuFullPath',
  'pathContextMenuStatus',
  'pathCtxBtnPreview',
  'pathCtxPreviewLabel',
  'pathCtxBtnOpen',
  'pathCtxOpenLabel',
  'pathCtxBtnCopy',
  'pathCtxCopyLabel'
]) {
  mockElements.set(id, createMockEl(id));
}
mockElements.get('pathContextMenu').classList.add('hidden');

let pendingTimers = [];
let nextTimerId = 1;
let lastPreviewCall = null;
let lastOpenCall = null;
let copiedText = null;
let sessionMenuClosedCount = 0;

const recordedMap = new Map([
  ['src/ManagerUserController.java', {
    path: 'E:/SSO/code/sso/src/ManagerUserController.java',
    status: 'modified',
    added: 5,
    removed: 2
  }]
]);

const sandbox = {
  console,
  hubServerPlatform: 'win32',
  currentWorkspace: 'E:\\SSO\\code\\sso',
  currentPreviewedPath: '',
  localPathExistenceCache: new Map(),
  buildPathCacheKey: (p) => 'E:\\SSO\\code\\sso::' + p,
  getRecordedFileChange: (p) => recordedMap.get(p) || null,
  resolvePathFromClickEvent: (p) => p,
  closeSessionContextMenu: () => { sessionMenuClosedCount++; return true; },
  hideHubTooltip: () => {},
  previewLocalFile: (rawPath, e, mode, mutKey) => { lastPreviewCall = { rawPath, mode, mutKey }; },
  openLocalPath: (rawPath) => { lastOpenCall = rawPath; },
  showToast: () => {},
  soundEffects: { playClick: () => {} },
  navigator: { vibrate: () => true },
  setTimeout: (fn, ms) => {
    const id = nextTimerId++;
    pendingTimers.push({ id, fn, ms });
    return id;
  },
  clearTimeout: (id) => {
    pendingTimers = pendingTimers.filter(t => t.id !== id);
  },
  document: {
    getElementById: (id) => mockElements.get(id) || null,
    addEventListener: (type, fn) => {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    }
  },
  window: {
    innerWidth: 1280,
    innerHeight: 800,
    writeTextToClipboard: async (txt) => { copiedText = txt; return true; }
  }
};

function flushTimers(filterMs = null) {
  const toRun = pendingTimers.filter(t => filterMs === null || t.ms === filterMs);
  pendingTimers = pendingTimers.filter(t => filterMs !== null && t.ms !== filterMs);
  for (const t of toRun) t.fn();
}

vm.createContext(sandbox);
vm.runInContext(pathMenuCode + '\ninitPathContextMenu();', sandbox);

// 3. Verify unverified badge is ignored
const unverifiedBadge = createMockEl('', { 'data-path': 'fake.js', 'data-unverified': '1' });
unverifiedBadge.classList.add('local-path-badge');
assert.equal(sandbox.resolvePathContextTarget(unverifiedBadge), null, 'Unverified path badge must not open path menu');

// 4. Desktop right-click on a modified file badge
const validBadge = createMockEl('', { 'data-path': 'src/ManagerUserController.java' });
validBadge.classList.add('local-path-badge');
let prevented = false;
for (const fn of (docListeners.contextmenu || [])) {
  fn({
    target: validBadge,
    clientX: 300,
    clientY: 240,
    preventDefault() { prevented = true; },
    stopPropagation() {}
  });
}
assert.equal(prevented, true, 'Right-click on path badge must prevent native context menu');
assert.ok(sessionMenuClosedCount >= 1, 'Opening path menu must close session menu if open');
const menuEl = mockElements.get('pathContextMenu');
assert.equal(menuEl.classList.contains('hidden'), false);
assert.equal(menuEl.classList.contains('active'), true);
assert.equal(mockElements.get('pathContextMenuTitle').textContent, 'ManagerUserController.java');
assert.equal(mockElements.get('pathContextMenuFullPath').textContent, 'E:\\SSO\\code\\sso\\src\\ManagerUserController.java');
assert.ok(mockElements.get('pathContextMenuStatus').innerHTML.includes('+5') && mockElements.get('pathContextMenuStatus').innerHTML.includes('-2'));
assert.equal(mockElements.get('pathCtxPreviewLabel').textContent, 'Xem thay đổi & nội dung');

// Test Copy Path action
mockElements.get('pathCtxBtnCopy').click();
flushTimers(160);
assert.equal(copiedText, 'E:\\SSO\\code\\sso\\src\\ManagerUserController.java', 'Copy path must copy resolved full Windows path');
assert.equal(menuEl.classList.contains('hidden'), true, 'Menu must close after Copy Path');

// Test Preview & Open actions from tool diff row (preserving cardMutKey)
const diffRow = createMockEl('', { 'data-file-diff-row': '1', 'data-path': 'src/ManagerUserController.java', 'data-mut-key': 'tool_7:0' });
for (const fn of (docListeners.contextmenu || [])) {
  fn({ target: diffRow, clientX: 400, clientY: 300, preventDefault() {}, stopPropagation() {} });
}
mockElements.get('pathCtxBtnPreview').click();
flushTimers(160);
assert.deepEqual(lastPreviewCall, { rawPath: 'src/ManagerUserController.java', mode: 'step-diff', mutKey: 'tool_7:0' });

for (const fn of (docListeners.contextmenu || [])) {
  fn({ target: validBadge, clientX: 400, clientY: 300, preventDefault() {}, stopPropagation() {} });
}
mockElements.get('pathCtxBtnOpen').click();
flushTimers(160);
assert.equal(lastOpenCall, 'src/ManagerUserController.java');

// Compact filename uses the same desktop and mobile delegates, preserving action identity.
const filenameButton = createMockEl('', { 'data-local-path-action': '1', 'data-path': 'src/ManagerUserController.java', 'data-mut-key': 'tool_8:0' });
assert.equal(sandbox.resolvePathContextTarget(filenameButton).cardMutKey, 'tool_8:0');
for (const fn of (docListeners.contextmenu || [])) {
  fn({ target: filenameButton, clientX: 300, clientY: 240, preventDefault() {}, stopPropagation() {} });
}
mockElements.get('pathCtxBtnPreview').click();
flushTimers(160);
assert.deepEqual(lastPreviewCall, { rawPath: 'src/ManagerUserController.java', mode: 'step-diff', mutKey: 'tool_8:0' });
sandbox.window.innerWidth = 390;
for (const fn of (docListeners.touchstart || [])) {
  fn({ target: filenameButton, touches: [{ clientX: 120, clientY: 220 }] });
}
flushTimers(450);
assert.equal(menuEl.classList.contains('hidden'), false, 'Filename hold opens existing mobile popup');
for (const fn of (docListeners.touchend || [])) fn({});
sandbox.window.handlePathClick('src/ManagerUserController.java', { preventDefault() {}, stopPropagation() {} });
sandbox.closePathContextMenu();
flushTimers(160);

// 5. Mobile touch-hold (long-press 450ms): scroll >8px cancels, holding 450ms opens modal & suppresses release click
sandbox.window.innerWidth = 390;
lastPreviewCall = null;

// (a) Scroll > 8px cancels long-press
for (const fn of (docListeners.touchstart || [])) {
  fn({ target: validBadge, touches: [{ clientX: 100, clientY: 200 }] });
}
for (const fn of (docListeners.touchmove || [])) {
  fn({ target: validBadge, touches: [{ clientX: 100, clientY: 220 }] });
}
flushTimers(450);
assert.equal(menuEl.classList.contains('hidden'), true, 'Touch scroll >8px must cancel path long-press');

// (b) Hold 450ms triggers centered mobile popup & suppresses accidental tap-through
for (const fn of (docListeners.touchstart || [])) {
  fn({ target: validBadge, touches: [{ clientX: 120, clientY: 220 }] });
}
flushTimers(450);
assert.equal(menuEl.classList.contains('hidden'), false, '450ms touch-hold must open path context menu');
assert.equal(mockElements.get('pathContextMenuBackdrop').classList.contains('hidden'), false, 'Mobile backdrop must appear on <640px');

for (const fn of (docListeners.touchend || [])) {
  fn({});
}

// Finger release triggers click / handlePathClick -> MUST be suppressed!
sandbox.window.handlePathClick('src/ManagerUserController.java', { preventDefault() {}, stopPropagation() {} });
assert.equal(lastPreviewCall, null, 'Release click immediately after long-press must be suppressed');

// Subsequent normal tap works normally
sandbox.window.handlePathClick('src/ManagerUserController.java', { preventDefault() {}, stopPropagation() {} });
assert.equal(lastPreviewCall.rawPath, 'src/ManagerUserController.java', 'Subsequent normal tap must open preview normally');

console.log('All Path Context Menu & Mobile Long-Press tests passed!');
