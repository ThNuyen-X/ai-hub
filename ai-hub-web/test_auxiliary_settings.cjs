const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createSettings } = require('./auxiliary-settings.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-aux-settings-'));
try {
  const file = path.join(root, 'settings.json');
  const settings = createSettings(file);
  assert.equal(settings.get('session'), '');
  settings.set('session', 'gemini');
  assert.equal(createSettings(file).get('session'), 'gemini');
  settings.set('session', '');
  assert.equal(createSettings(file).get('session'), '');
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  const helper = html.slice(html.indexOf('    const auxiliarySettingsLoads ='), html.indexOf('    // MODEL SELECTOR & PROVIDER POPUP'));
  const storage = new Map();
  const select = { options: [], value: '', replaceChildren() { this.options = []; }, add(value) { this.options.push(value); } };
  const elements = { auxiliaryModelSelect: select, modelDropdownBtn: {}, auxiliaryModelBadge: { classList: { toggle() {} } } };
  const context = vm.createContext({ currentSessionId: null, MODELS: [{ id: 'gemini', name: 'Gemini' }], normalizeModelId: x => x,
    resolveModelMeta: x => ({ name: x }), document: { getElementById: id => elements[id] }, Option: function(text, value) { this.text = text; this.value = value; },
    localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, value) },
    fetch: async () => ({ ok: true, json: async () => ({ auxiliaryModel: '' }) }) });
  vm.runInContext(helper, context);
  vm.runInContext("selectAuxiliaryModel('gemini');", context);
  assert.equal(select.value, 'gemini');
  vm.runInContext("currentSessionId='one'; rememberAuxiliaryModel('one', 'gemini'); renderAuxiliaryModelSelector();", context);
  assert.equal(select.value, 'gemini');
  vm.runInContext("currentSessionId='two'; rememberAuxiliaryModel('two', ''); renderAuxiliaryModelSelector();", context);
  assert.equal(select.value, '');
  vm.runInContext("currentSessionId='one'; renderAuxiliaryModelSelector();", context);
  assert.equal(select.value, 'gemini');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(server.includes('req.url === "/api/auxiliary-settings"'));
  assert.ok(server.includes('data.auxiliaryModel === undefined ? auxiliarySettings.get(data.sessionId)'));
  assert.ok(html.includes('auxiliaryPreferenceSaves.set(sessionId, save)'));
  assert.ok(html.includes("response.headers.get('content-type')?.includes('application/json')"));
  console.log('Auxiliary settings: disk persistence, disabled state, draft and session isolation, selector rendering passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
