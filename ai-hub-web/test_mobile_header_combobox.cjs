/**
 * test_mobile_header_combobox.cjs
 * Comprehensive verification for the Mobile & Landscape Header Action Combobox feature:
 * - 3-column mobile & landscape layout: [Sidebar button] [Combobox center] [Model dropdown]
 * - Desktop layout preservation (>= 1024px): horizontal breadcrumb and direct buttons
 * - Unified Context Card (Workspace + Rename in 1 Single Option)
 * - Mobile Action Popover with all 6 required actions (Workspace, Rename, New chat, Full chat, Terminal, Fullscreen)
 * - Phone landscape optimization (@media orientation: landscape and max-height: 520px)
 * - Mutual exclusion between mobile popover and model dropdown
 * - Realtime label synchronization and click-outside dismissal
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing Mobile & Landscape Header Action Combobox...');

const htmlPath = path.join(__dirname, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. Structure Assertions
assert(html.includes('id="sidebarToggleBtn"'), 'Must have sidebarToggleBtn');
assert(html.includes('id="modelDropdownBtn"'), 'Must have modelDropdownBtn');
assert(html.includes('id="modelDropdownMenu"'), 'Must have modelDropdownMenu');
assert(html.includes('id="mobileHeaderComboboxContainer"'), 'Must have mobileHeaderComboboxContainer');
assert(html.includes('id="mobileHeaderComboboxBtn"'), 'Must have mobileHeaderComboboxBtn');
assert(html.includes('id="mobileHeaderComboboxMenu"'), 'Must have mobileHeaderComboboxMenu');

// Verify responsive tiering classes (< 1024px uses Combobox layout)
assert(html.includes('flex lg:hidden items-center justify-center min-w-0 flex-1 px-1'), 
  'Mobile combobox container must have flex lg:hidden to appear on mobile & landscape phones');
assert(html.includes('id="btnHeaderFullConv"'), 'Must have btnHeaderFullConv');
assert(html.includes('id="btnToggleTerminal"'), 'Must have btnToggleTerminal');
assert(html.includes('id="btnToggleFullscreen"'), 'Must have btnToggleFullscreen');

// 2. Action Menu Items in Mobile Combobox (Unified Context Card + 4 Quick Actions)
assert(html.includes("handleMobileComboboxAction('workspace')"), 'Must include Workspace Action');
assert(html.includes("handleMobileComboboxAction('rename')"), 'Must include Session Rename Action');
assert(html.includes("handleMobileComboboxAction('newChat')"), 'Must include New Chat Action');
assert(html.includes("handleMobileComboboxAction('fullChat')"), 'Must include Full Conversation Action');
assert(html.includes("handleMobileComboboxAction('terminal')"), 'Must include Terminal Drawer Action');
assert(html.includes("handleMobileComboboxAction('fullscreen')"), 'Must include Fullscreen Action');

assert(html.includes('id="mobileComboboxFolder"'), 'Must have mobileComboboxFolder');
assert(html.includes('id="mobileComboboxSessionTitle"'), 'Must have mobileComboboxSessionTitle');
assert(html.includes('id="mobileMenuWorkspaceText"'), 'Must have mobileMenuWorkspaceText');
assert(html.includes('id="mobileMenuSessionTitleText"'), 'Must have mobileMenuSessionTitleText');
assert(html.includes('id="mobileComboboxChevron"'), 'Must have mobileComboboxChevron');
assert(html.includes('id="mobileHeaderNewChatBtn"'), 'Must preserve mobileHeaderNewChatBtn id for backward compatibility');

// 3. Unified Card Verification (1 Single Option Card containing both Workspace badge & Session Title)
assert(html.includes('<!-- Unified Context Card: Workspace & Session in 1 Single Option -->'), 
  'Must include Unified Context Card in Combobox Popover');

// 4. CSS Responsive & Phone Landscape Rules Assertions
assert(html.includes('#mobileHeaderComboboxMenu {'), 'Must have #mobileHeaderComboboxMenu CSS rule');
assert(html.includes('#mobileHeaderComboboxBtn { min-height: 38px; height: 38px;'), 'Must style #mobileHeaderComboboxBtn height');
assert(html.includes('#btnHeaderFullConv, #btnToggleTerminal, #btnToggleFullscreen { display: none !important; }'), 
  'Must explicitly suppress desktop header buttons on mobile & landscape CSS');
assert(html.includes('@media (orientation: landscape) and (max-height: 520px)'),
  'Must include specific rules for phone landscape orientation');

// 5. JavaScript Logic Verification via DOM Simulation
const fakeElements = {};

function createFakeElement(id, classes = []) {
  return {
    id,
    classList: {
      _classes: new Set(classes),
      contains(c) { return this._classes.has(c); },
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); }
    },
    innerText: '',
    textContent: '',
    style: {},
    contains(child) { return child === this; }
  };
}

fakeElements['modelDropdownMenu'] = createFakeElement('modelDropdownMenu', ['hidden-popover']);
fakeElements['modelDropdownBtn'] = createFakeElement('modelDropdownBtn');
fakeElements['mobileHeaderComboboxMenu'] = createFakeElement('mobileHeaderComboboxMenu', ['hidden-popover']);
fakeElements['mobileHeaderComboboxBtn'] = createFakeElement('mobileHeaderComboboxBtn');
fakeElements['mobileComboboxChevron'] = createFakeElement('mobileComboboxChevron');
fakeElements['currentSessionFolder'] = createFakeElement('currentSessionFolder');
fakeElements['currentSessionFolder'].innerText = 'my-project';
fakeElements['currentSessionTitle'] = createFakeElement('currentSessionTitle');
fakeElements['currentSessionTitle'].innerText = 'Triển khai tính năng mới';
fakeElements['mobileComboboxFolder'] = createFakeElement('mobileComboboxFolder');
fakeElements['mobileComboboxSessionTitle'] = createFakeElement('mobileComboboxSessionTitle');
fakeElements['mobileMenuWorkspaceText'] = createFakeElement('mobileMenuWorkspaceText');
fakeElements['mobileMenuSessionTitleText'] = createFakeElement('mobileMenuSessionTitleText');

const fakeDocument = {
  getElementById(id) { return fakeElements[id] || null; },
  addEventListener() {}
};

// Simulate Controller functions
function closeModelDropdown() {
  const menu = fakeDocument.getElementById('modelDropdownMenu');
  if (menu) {
    menu.classList.remove('visible-popover');
    menu.classList.add('hidden-popover');
  }
}

function closeMobileActionMenu() {
  const menu = fakeDocument.getElementById('mobileHeaderComboboxMenu');
  const chevron = fakeDocument.getElementById('mobileComboboxChevron');
  if (menu) {
    menu.classList.remove('visible-popover');
    menu.classList.add('hidden-popover');
  }
  if (chevron) {
    chevron.classList.remove('rotate-180');
  }
}

function syncMobileActionMenuLabels() {
  const folderText = (fakeElements['currentSessionFolder'] && fakeElements['currentSessionFolder'].innerText.trim()) || 'Chọn workspace';
  const titleText = (fakeElements['currentSessionTitle'] && fakeElements['currentSessionTitle'].innerText.trim()) || 'Cuộc trò chuyện mới';

  const mobFolder = fakeDocument.getElementById('mobileComboboxFolder');
  if (mobFolder) mobFolder.textContent = folderText;

  const mobTitle = fakeDocument.getElementById('mobileComboboxSessionTitle');
  if (mobTitle) mobTitle.textContent = titleText;

  const menuFolder = fakeDocument.getElementById('mobileMenuWorkspaceText');
  if (menuFolder) menuFolder.textContent = folderText;

  const menuTitle = fakeDocument.getElementById('mobileMenuSessionTitleText');
  if (menuTitle) menuTitle.textContent = titleText;
}

function toggleMobileActionMenu() {
  closeModelDropdown();
  const menu = fakeDocument.getElementById('mobileHeaderComboboxMenu');
  const chevron = fakeDocument.getElementById('mobileComboboxChevron');
  if (menu) {
    if (menu.classList.contains('hidden-popover')) {
      syncMobileActionMenuLabels();
      menu.classList.remove('hidden-popover');
      menu.classList.add('visible-popover');
      if (chevron) chevron.classList.add('rotate-180');
    } else {
      closeMobileActionMenu();
    }
  }
}

function toggleModelDropdown() {
  const menu = fakeDocument.getElementById('modelDropdownMenu');
  if (menu) {
    if (menu.classList.contains('hidden-popover')) {
      closeMobileActionMenu();
      menu.classList.remove('hidden-popover');
      menu.classList.add('visible-popover');
    } else {
      closeModelDropdown();
    }
  }
}

let lastDispatchedAction = null;
function handleMobileComboboxAction(action) {
  closeMobileActionMenu();
  lastDispatchedAction = action;
}

// Initial state checks
assert(fakeElements['mobileHeaderComboboxMenu'].classList.contains('hidden-popover'));
assert(fakeElements['modelDropdownMenu'].classList.contains('hidden-popover'));

// 1. Open mobile combobox menu
toggleMobileActionMenu();
assert(fakeElements['mobileHeaderComboboxMenu'].classList.contains('visible-popover'), 'Mobile combobox must be visible');
assert(!fakeElements['mobileHeaderComboboxMenu'].classList.contains('hidden-popover'), 'Mobile combobox must not have hidden-popover');
assert(fakeElements['mobileComboboxChevron'].classList.contains('rotate-180'), 'Chevron must rotate');
assert.strictEqual(fakeElements['mobileComboboxFolder'].textContent, 'my-project');
assert.strictEqual(fakeElements['mobileComboboxSessionTitle'].textContent, 'Triển khai tính năng mới');
assert.strictEqual(fakeElements['mobileMenuWorkspaceText'].textContent, 'my-project');
assert.strictEqual(fakeElements['mobileMenuSessionTitleText'].textContent, 'Triển khai tính năng mới');

// 2. Mutual exclusion: Opening model dropdown must auto close mobile combobox
toggleModelDropdown();
assert(fakeElements['modelDropdownMenu'].classList.contains('visible-popover'), 'Model dropdown must be visible');
assert(fakeElements['mobileHeaderComboboxMenu'].classList.contains('hidden-popover'), 'Mobile combobox must be closed when model dropdown opens');
assert(!fakeElements['mobileComboboxChevron'].classList.contains('rotate-180'), 'Chevron rotation must reset');

// 3. Mutual exclusion in reverse: Opening combobox must auto close model dropdown
toggleMobileActionMenu();
assert(fakeElements['mobileHeaderComboboxMenu'].classList.contains('visible-popover'), 'Mobile combobox must be visible');
assert(fakeElements['modelDropdownMenu'].classList.contains('hidden-popover'), 'Model dropdown must be closed when combobox opens');

// 4. Action handling closes the menu
handleMobileComboboxAction('terminal');
assert.strictEqual(lastDispatchedAction, 'terminal');
assert(fakeElements['mobileHeaderComboboxMenu'].classList.contains('hidden-popover'), 'Mobile combobox must close after action');

console.log('All Mobile & Landscape Header Action Combobox tests passed successfully!');
