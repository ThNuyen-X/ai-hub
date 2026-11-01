const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.resolve(__dirname, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

console.log('Testing Session Context Menu & Touch-Hold interactions...');

// 1. Structure Checks in HTML
assert(html.includes('id="sessionContextMenu"'), 'sessionContextMenu element must exist in HTML');
assert(html.includes('id="sessionContextMenuPanel"'), 'sessionContextMenuPanel element must exist');
assert(html.includes('id="sessionContextMenuBackdrop"'), 'sessionContextMenuBackdrop element must exist');
assert(html.includes('id="sessionCtxBtnOpen"'), 'Open button must exist in context menu');
assert(html.includes('id="sessionCtxBtnOpenNewTab"'), 'Open in new tab button must exist in context menu');
assert(html.includes('id="sessionCtxBtnPin"'), 'Pin button must exist in context menu');
assert(html.includes('id="sessionCtxBtnRename"'), 'Rename button must exist in context menu');
assert(html.includes('id="sessionCtxBtnCopyName"'), 'Copy name button must exist in context menu');
assert(!html.includes('id="sessionCtxBtnCopyId"'), 'Copy ID button should be removed from context menu');
assert(html.includes('id="sessionCtxBtnDelete"'), 'Delete button must exist in context menu');

// 2. CSS Rules Checks
assert(html.includes('-webkit-touch-callout: none !important;'), 'Must suppress iOS callout popup');
assert(html.includes('user-select: none !important;'), 'Must suppress native text selection on long-press');
assert(html.includes('sessionSheetSlideUp'), 'Must define slide-up animation for mobile action sheet');

// 3. Execution Simulation using VM
const startIdx = html.indexOf('let currentContextMenuSession');
assert(startIdx > 0, 'Must find start of session context menu code');
const endIdx = html.indexOf('// A single delegated tooltip covers dynamic rows', startIdx);
assert(endIdx > startIdx, 'Must find end of session context menu code');
const contextMenuCode = html.slice(startIdx, endIdx);

const mockStorage = new Map();
const mockElements = new Map();

function createMockElement(id = '', tag = 'div') {
  const listeners = {};
  const classList = new Set();
  const style = {};
  const el = {
    id,
    tagName: tag.toUpperCase(),
    textContent: '',
    innerText: '',
    innerHTML: '',
    value: '',
    dataset: {},
    classList: {
      add: (cls) => classList.add(cls),
      remove: (cls) => classList.delete(cls),
      toggle: (cls, force) => {
        if (force === undefined) {
          if (classList.has(cls)) classList.delete(cls);
          else classList.add(cls);
        } else if (force) classList.add(cls);
        else classList.delete(cls);
      },
      contains: (cls) => classList.has(cls)
    },
    style,
    addEventListener: (evt, fn) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn);
    },
    dispatchEvent: (evt) => {
      if (listeners[evt.type]) {
        for (const fn of listeners[evt.type]) fn(evt);
      }
    },
    getAttribute: (attr) => el[attr] || null,
    setAttribute: (attr, val) => { el[attr] = val; },
    removeAttribute: (attr) => { delete el[attr]; },
    closest: (selector) => {
      if (selector === '.session-item' && el.classList.contains('session-item')) return el;
      return null;
    },
    contains: () => false,
    appendChild: () => {},
    removeChild: () => {},
    cloneNode: () => createMockElement('', tag),
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 100,
    clientHeight: 100,
    isConnected: true
  };
  return el;
}

const requiredIds = [
  'sessionContextMenu',
  'sessionContextMenuPanel',
  'sessionContextMenuBackdrop',
  'sessionContextMenuTitle',
  'sessionContextMenuStatus',
  'sessionCtxPinIcon',
  'sessionCtxPinLabel',
  'sessionCtxBtnOpen',
  'sessionCtxBtnOpenNewTab',
  'sessionCtxBtnPin',
  'sessionCtxBtnRename',
  'sessionCtxBtnCopyName',
  'sessionCtxBtnDelete',
  'sidebar',
  'toastContainer',
  'pinnedSessionsSection',
  'pinnedSessionsList',
  'workspaceTree',
  'currentSessionTitle',
  'currentSessionFolder',
  'currentSessionFolderTag',
  'promptInput'
];

for (const id of requiredIds) {
  mockElements.set(id, createMockElement(id));
}
mockElements.get('sessionContextMenu').classList.add('hidden');

let openedUrl = null;
let openedTarget = null;
let openedFeatures = null;

const sandbox = {
  console,
  setTimeout: (fn) => fn(),
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  currentWorkspace: 'D:\\ai-hub',
  allSessionsCache: [],
  pinnedSessionsSet: new Set(),
  currentSessionId: null,
  showToast: () => {},
  soundEffects: { playClick: () => {} },
  workspaceRouteSlug: (ws) => 'ai-hub',
  sessionRouteSlug: (s) => (s.name || s.id).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  document: {
    getElementById: (id) => mockElements.get(id) || createMockElement(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement('', tag),
    body: createMockElement('body'),
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  window: {
    innerWidth: 1200,
    innerHeight: 800,
    location: {
      href: 'http://localhost:20130/',
      origin: 'http://localhost:20130',
      pathname: '/'
    },
    open: (url, target, features) => {
      openedUrl = url;
      openedTarget = target;
      openedFeatures = features;
      return {};
    },
    history: {
      pushState: () => {},
      replaceState: () => {}
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  localStorage: {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k)
  },
  navigator: {
    vibrate: () => true
  },
  URL: global.URL,
  Event: class { constructor(t) { this.type = t; } }
};

sandbox.window.writeTextToClipboard = async () => true;

vm.createContext(sandbox);
vm.runInContext(contextMenuCode, sandbox);

// 4. Test openSessionContextMenu on desktop
const sessionData = {
  id: 'sess-abc-123',
  name: 'Fix User Auth Bug',
  wsPath: 'D:\\ai-hub',
  isRunning: false
};

sandbox.openSessionContextMenu(sessionData, 200, 300);
const menu = mockElements.get('sessionContextMenu');
assert(!menu.classList.contains('hidden'), 'Menu should not be hidden when opened');
assert(menu.classList.contains('active'), 'Menu should have active class');
assert.strictEqual(mockElements.get('sessionContextMenuTitle').textContent, 'Fix User Auth Bug');
assert(mockElements.get('sessionCtxBtnOpen').innerHTML.includes('Mở phiên này'), 'Open button should show open option');

// 5. Test getSessionFullUrl and openSessionInNewTab
const generatedUrl = sandbox.getSessionFullUrl('sess-abc-123', 'Fix User Auth Bug', 'D:\\ai-hub');
assert(generatedUrl.startsWith('http://localhost:20130/'), 'Generated URL must have proper origin');
assert(generatedUrl.includes('fix-user-auth-bug'), 'Generated URL slug must contain session slug');

sandbox.openSessionInNewTab('sess-abc-123', 'Fix User Auth Bug', 'D:\\ai-hub');
assert.strictEqual(openedTarget, '_blank', 'Must open in _blank target');
assert.strictEqual(openedFeatures, 'noopener,noreferrer', 'Must provide security attributes');
assert.strictEqual(openedUrl, generatedUrl, 'Must open matching session URL');

// 6. Test closeSessionContextMenu
const closed = sandbox.closeSessionContextMenu();
assert.strictEqual(closed, true, 'closeSessionContextMenu should return true when menu was open');
assert(menu.classList.contains('hidden'), 'Menu must be hidden after close');

// 7. Test handleSessionItemClick click suppression
vm.runInContext('suppressNextSessionClick = true;', sandbox);
let selectCalled = false;
sandbox.selectSession = () => { selectCalled = true; };
sandbox.handleSessionItemClick(null, 'sess-abc-123', 'Fix User Auth Bug', 'D:\\ai-hub');
assert.strictEqual(selectCalled, false, 'selectSession must not be called when suppressNextSessionClick is true');
assert.strictEqual(vm.runInContext('suppressNextSessionClick', sandbox), false, 'suppressNextSessionClick flag should reset to false');

// 8. Test handleSessionItemClick regular click
sandbox.handleSessionItemClick(null, 'sess-abc-123', 'Fix User Auth Bug', 'D:\\ai-hub');
assert.strictEqual(selectCalled, true, 'selectSession should be called normally when not suppressed');

// 9. Test mobile layout positioning
sandbox.window.innerWidth = 400;
sandbox.openSessionContextMenu(sessionData, 100, 100);
const backdrop = mockElements.get('sessionContextMenuBackdrop');
assert(!backdrop.classList.contains('hidden'), 'Backdrop must be shown on mobile viewports (< 640px)');
assert.strictEqual(menu.style.bottom, '0', 'Menu should stretch to bottom on mobile');

console.log('All session context menu & touch-hold tests passed successfully!');
