const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('Testing Model Providers & Sub-popup Modal UI...');

const htmlPath = path.join(__dirname, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. Kiem tra HTML elements
assert(html.includes('id="modelDropdownBtn"'), 'Must have modelDropdownBtn in header');
assert(html.includes('id="modelDropdownMenu"'), 'Must have modelDropdownMenu container');
assert(html.includes('id="modelListOptions"'), 'Must have modelListOptions container for 3 provider options');
assert(html.includes('id="modelProviderModal"'), 'Must have modelProviderModal modal container');
assert(html.includes('id="modelProviderModalTitle"'), 'Must have modelProviderModalTitle');
assert(html.includes('id="modelProviderModalSubtitle"'), 'Must have modelProviderModalSubtitle');
assert(html.includes('id="modelProviderModalIcon"'), 'Must have modelProviderModalIcon');
assert(html.includes('id="modelProviderModalList"'), 'Must have modelProviderModalList for provider models');
assert(html.includes('backToModelMenu()'), 'Must have backToModelMenu() trigger');
assert(html.includes('closeModelProviderModal()'), 'Must have closeModelProviderModal() trigger');

// 2. Kiem tra du lieu MODELS va MODEL_PROVIDERS trong index.html
const modelsMatch = html.match(/const MODELS = \[[\s\S]*?\];/);
const providersMatch = html.match(/const MODEL_PROVIDERS = \[[\s\S]*?\];/);
assert(modelsMatch, 'MODELS array must exist in index.html');
assert(providersMatch, 'MODEL_PROVIDERS array must exist in index.html');

const sandbox = {
  console,
  localStorage: {
    data: {},
    getItem(k) { return this.data[k] || null; },
    setItem(k, v) { this.data[k] = String(v); }
  },
  soundEffects: { playBop() {} },
  showToast() {},
  setSessionModel() {},
  currentSessionId: null,
  currentSelectedModel: 'cx/gpt-6.1-sol'
};

vm.createContext(sandbox);
vm.runInContext(`${modelsMatch[0]}\n${providersMatch[0]}\nthis.MODELS = MODELS;\nthis.MODEL_PROVIDERS = MODEL_PROVIDERS;`, sandbox);

const { MODELS, MODEL_PROVIDERS } = sandbox;

// Kiem tra 3 options chinh
assert.equal(MODEL_PROVIDERS.length, 3, 'Must have exactly 3 model provider options');
const providerIds = Array.from(MODEL_PROVIDERS.map(p => p.id));
assert.deepStrictEqual(JSON.stringify(providerIds), JSON.stringify(['chatgpt', 'claude', 'gemini']), 'Provider options must be chatgpt, claude, gemini');

// Kiem tra model ChatGPT
const chatgptModels = Array.from(MODELS.filter(m => m.group === 'chatgpt'));
assert.equal(chatgptModels.length, 2, 'ChatGPT group must have 2 models');
assert.deepStrictEqual(JSON.stringify(chatgptModels.map(m => m.id)), JSON.stringify(['cx/gpt-6.1-sol', 'ag/gpt-oss-120b-medium']), 'ChatGPT must contain 6.1 sol and antigravity oss 120b');

// Kiem tra model Claude
const claudeModels = Array.from(MODELS.filter(m => m.group === 'claude'));
assert.equal(claudeModels.length, 2, 'Claude group must have 2 supported models');
assert.deepStrictEqual(JSON.stringify(claudeModels.map(m => m.id)), JSON.stringify([
  'ag/claude-sonnet-5-5-high',
  'ag/claude-opus-5-5-high'
]));

// Kiem tra model Gemini
const geminiModels = Array.from(MODELS.filter(m => m.group === 'gemini'));
assert.equal(geminiModels.length, 3, 'Gemini group must have 3 models');
assert.deepStrictEqual(JSON.stringify(geminiModels.map(m => m.id)), JSON.stringify([
  'ag/gemini-3.8-flash',
  'ag/gemini-4-argon-high',
  'ag/gemini-3.1-pro-high'
]));

// 3. Kiem tra logic JavaScript tuong tac: renderModelSelector & openModelProviderPopup
const helperCode = `
  const MODEL_ICONS = {
    openai: '<svg id="mock-openai"></svg>',
    claude: '<svg id="mock-claude"></svg>',
    gemini: '<svg id="mock-gemini"></svg>',
    argon: '<svg id="mock-argon"></svg>'
  };

  function normalizeModelId(modelId) {
    if (modelId === 'ag/gemini-3.8-flash-high') return 'ag/gemini-3.8-flash';
    return modelId;
  }

  function resolveModelMeta(modelId) {
    const normalized = normalizeModelId(modelId);
    if (!normalized) return MODELS[0];
    const exact = MODELS.find(m => m.id === normalized || m.full === normalized);
    if (exact) return exact;
    return MODELS[0];
  }
`;

const jsSnippetMatch = html.match(/\/\/ MODEL SELECTOR & PROVIDER POPUP[\s\S]*?function closeModelDropdown\(\) \{[\s\S]*?\n    \}/);
assert(jsSnippetMatch, 'Model selector and provider popup JS functions must exist in index.html');

// Fake DOM Elements
const fakeDom = {
  currentModelIcon: { innerHTML: '' },
  currentModelName: { innerText: '' },
  modelListOptions: { innerHTML: '' },
  modelDropdownMenu: {
    classList: {
      classes: new Set(['hidden-popover']),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  },
  modelProviderModal: {
    classList: {
      classes: new Set(['hidden']),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  },
  modelProviderModalTitle: { innerText: '' },
  modelProviderModalSubtitle: { innerText: '' },
  modelProviderModalIcon: { innerHTML: '', style: {} },
  modelProviderModalList: { innerHTML: '' }
};

sandbox.document = {
  getElementById(id) {
    return fakeDom[id] || null;
  }
};
sandbox.closeMobileActionMenu = () => {};

vm.runInContext(`
  ${helperCode}
  ${html.slice(html.indexOf('    const auxiliarySettingsLoads ='), html.indexOf('    // MODEL SELECTOR & PROVIDER POPUP'))}
  ${jsSnippetMatch[0]}
  this.renderModelSelector = renderModelSelector;
  this.openModelProviderPopup = openModelProviderPopup;
  this.selectModelFromPopup = selectModelFromPopup;
  this.closeModelProviderModal = closeModelProviderModal;
  this.backToModelMenu = backToModelMenu;
  this.selectModel = selectModel;
  this.toggleModelDropdown = toggleModelDropdown;
  this.closeModelDropdown = closeModelDropdown;
`, sandbox);

// Test 1: renderModelSelector() phai render 3 options (ChatGPT, Claude, Gemini) vao modelListOptions
sandbox.renderModelSelector();
assert.equal(fakeDom.currentModelName.innerText, 'GPT-6.1 Sol');
assert(fakeDom.modelListOptions.innerHTML.includes('ChatGPT'), 'Dropdown must show ChatGPT');
assert(fakeDom.modelListOptions.innerHTML.includes('Claude'), 'Dropdown must show Claude');
assert(fakeDom.modelListOptions.innerHTML.includes('Gemini'), 'Dropdown must show Gemini');
assert(fakeDom.modelListOptions.innerHTML.includes("openModelProviderPopup('chatgpt')"));
assert(fakeDom.modelListOptions.innerHTML.includes("openModelProviderPopup('claude')"));
assert(fakeDom.modelListOptions.innerHTML.includes("openModelProviderPopup('gemini')"));

// Test 2: Bấm vào ChatGPT -> Popup hien thi GPT-6.1 Sol va GPT OSS 120B
sandbox.openModelProviderPopup('chatgpt');
assert(!fakeDom.modelProviderModal.classList.contains('hidden'), 'modelProviderModal must be open');
assert(fakeDom.modelProviderModalTitle.innerText.includes('ChatGPT'), 'Title must mention ChatGPT');
assert(fakeDom.modelProviderModalList.innerHTML.includes('GPT-6.1 Sol'), 'List must include GPT-6.1 Sol');
assert(fakeDom.modelProviderModalList.innerHTML.includes('GPT OSS 120B'), 'List must include GPT OSS 120B');
assert(!fakeDom.modelProviderModalList.innerHTML.includes('Claude Sonnet'), 'ChatGPT popup must not include Claude');

// Test 3: Bấm chọn GPT OSS 120B tu popup
sandbox.selectModelFromPopup('ag/gpt-oss-120b-medium');
assert.equal(sandbox.currentSelectedModel, 'ag/gpt-oss-120b-medium');
assert(fakeDom.modelProviderModal.classList.contains('hidden'), 'Popup must close after selection');
assert.equal(fakeDom.currentModelName.innerText, 'GPT OSS 120B', 'Active model name in header must update');

// Test 4: Bấm vào Claude -> Popup hien thi Sonnet 5.5, Opus 5.5, Sonnet 4.6
sandbox.openModelProviderPopup('claude');
assert(!fakeDom.modelProviderModal.classList.contains('hidden'), 'modelProviderModal must be open for Claude');
assert(fakeDom.modelProviderModalTitle.innerText.includes('Claude'), 'Title must mention Claude');
assert(fakeDom.modelProviderModalList.innerHTML.includes('Claude Sonnet 5.5'));
assert(fakeDom.modelProviderModalList.innerHTML.includes('Claude Opus 5.5'));
assert(!fakeDom.modelProviderModalList.innerHTML.includes('Claude Sonnet 4.6'));
assert(!fakeDom.modelProviderModalList.innerHTML.includes('Gemini'));

// Test 5: Bấm chọn Claude Sonnet 5.5 tu popup
sandbox.selectModelFromPopup('ag/claude-sonnet-5-5-high');
assert.equal(sandbox.currentSelectedModel, 'ag/claude-sonnet-5-5-high');
assert(fakeDom.modelProviderModal.classList.contains('hidden'));
assert.equal(fakeDom.currentModelName.innerText, 'Claude Sonnet 5.5');

// Test 6: Bấm vào Gemini -> Popup hien thi 3.8 Flash, 4 Argon, 3.1 Pro
sandbox.openModelProviderPopup('gemini');
assert(!fakeDom.modelProviderModal.classList.contains('hidden'), 'modelProviderModal must be open for Gemini');
assert(fakeDom.modelProviderModalTitle.innerText.includes('Gemini'), 'Title must mention Gemini');
assert(fakeDom.modelProviderModalList.innerHTML.includes('Gemini 3.8 Flash'));
assert(fakeDom.modelProviderModalList.innerHTML.includes('Gemini 4 Argon'));
assert(fakeDom.modelProviderModalList.innerHTML.includes('Gemini 3.1 Pro'));

// Test 7: Nút backToModelMenu() dong popup va mo dropdown
fakeDom.modelDropdownMenu.classList.add('hidden-popover');
sandbox.backToModelMenu();
assert(fakeDom.modelProviderModal.classList.contains('hidden'), 'Popup must be closed');
assert(fakeDom.modelDropdownMenu.classList.contains('visible-popover'), 'Dropdown menu must be reopened');

console.log('All Model Providers & Sub-popup Modal UI tests passed successfully!');
