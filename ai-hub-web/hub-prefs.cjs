const fs = require('node:fs');
const path = require('node:path');

const MAX_SESSION_PINS = 2000;
const MAX_WORKSPACES = 500;
const MAX_VALUE_LENGTH = 1000;
const defaultFile = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'hub-prefs.json');

function cleanList(list, max) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(list) ? list : []) {
    if (typeof value !== 'string') continue;
    const v = value.trim();
    if (!v || v.length > MAX_VALUE_LENGTH || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.slice(-max);
}

function cleanOrder(value) {
  const src = value && typeof value === 'object' ? value : {};
  return { order: cleanList(src.order, MAX_WORKSPACES), pins: cleanList(src.pins, MAX_WORKSPACES) };
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Server-side UI preferences shared by every browser: pinned sessions and workspace order/pins.
// The server needs the session pins itself, because pinned sessions are exempt from the 20-session limit.
function createPrefs(filename = defaultFile) {
  let state;

  function load() {
    if (state) return;
    state = { initialized: false, sessionPins: [], workspaceOrder: { order: [], pins: [] } };
    try {
      if (fs.statSync(filename).size > 1024000) return;
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      state.initialized = saved.initialized === true;
      state.sessionPins = cleanList(saved.sessionPins, MAX_SESSION_PINS);
      state.workspaceOrder = cleanOrder(saved.workspaceOrder);
    } catch { /* First use or damaged preferences: start empty. */ }
  }

  function save() {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temp = filename + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, filename);
  }

  return {
    get() {
      load();
      return {
        initialized: state.initialized,
        sessionPins: [...state.sessionPins],
        workspaceOrder: { order: [...state.workspaceOrder.order], pins: [...state.workspaceOrder.pins] }
      };
    },
    isSessionPinned(id) { load(); return typeof id === 'string' && state.sessionPins.includes(id); },
    // One-time baseline from the first browser that still holds local data. Ignored once initialized.
    seed(payload) {
      load();
      if (state.initialized) return { seeded: false };
      const pins = cleanList(payload?.sessionPins, MAX_SESSION_PINS);
      const order = cleanOrder(payload?.workspaceOrder);
      if (!pins.length && !order.order.length && !order.pins.length) return { seeded: false };
      state.sessionPins = cleanList([...state.sessionPins, ...pins], MAX_SESSION_PINS);
      if (!state.workspaceOrder.order.length && !state.workspaceOrder.pins.length) state.workspaceOrder = order;
      state.initialized = true;
      save();
      return { seeded: true };
    },
    setSessionPin(id, pinned) {
      load();
      if (typeof id !== 'string' || !id.trim() || id.length > MAX_VALUE_LENGTH) throw new Error('Invalid session id');
      const has = state.sessionPins.includes(id);
      if (pinned === has) return false;
      state.sessionPins = pinned ? cleanList([...state.sessionPins, id], MAX_SESSION_PINS) : state.sessionPins.filter(x => x !== id);
      save();
      return true;
    },
    setWorkspaceOrder(value) {
      load();
      const next = cleanOrder(value);
      if (sameList(next.order, state.workspaceOrder.order) && sameList(next.pins, state.workspaceOrder.pins)) return false;
      state.workspaceOrder = next;
      save();
      return true;
    },
    removeSessions(ids) {
      load();
      const drop = new Set(Array.isArray(ids) ? ids : []);
      const next = state.sessionPins.filter(id => !drop.has(id));
      if (next.length === state.sessionPins.length) return false;
      state.sessionPins = next;
      save();
      return true;
    }
  };
}

module.exports = { MAX_SESSION_PINS, createPrefs };
