const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('public/index.html', 'utf8');
const start = source.indexOf('    const hubTooltip =');
const end = source.indexOf('    // UTILITIES', start);
let pending;
const listeners = {};
class Element {
  constructor(text = '', width = 200) {
    this.textContent = text; this.scrollWidth = width; this.clientWidth = 100;
    this.scrollHeight = this.clientHeight = 20;
    this.attrs = new Map(); this.dataset = {}; this.style = {}; this.isConnected = true;
  }
  closest() { return this; }
  hasAttribute(k) { return this.attrs.has(k); }
  getAttribute(k) { return k === 'data-tooltip' ? this.dataset.tooltip ?? null : this.attrs.get(k) ?? null; }
  setAttribute(k, v) { this.attrs.set(k, v); }
  removeAttribute(k) { this.attrs.delete(k); }
  contains(node) { return node === this; }
  getBoundingClientRect() { return { left: 290, top: 220, bottom: 240, width: 100, height: 50 }; }
}
const tooltip = new Element();
const context = vm.createContext({ Element,
  document: { createElement: () => tooltip, body: { appendChild() {} }, addEventListener(k, fn) { listeners[k] = fn; } },
  window: { innerWidth: 400, innerHeight: 300, addEventListener() {} },
  setTimeout(fn) { pending = fn; return 1; }, clearTimeout() { pending = null; }
});
vm.runInContext(source.slice(start, end), context);
const hover = target => context.revealTruncatedText({ target, type: 'pointerover' });
const clipped = new Element('Full session title');
hover(clipped);
assert.ok(tooltip.hidden);
pending();
assert.equal(tooltip.textContent, 'Full session title');
assert.equal(clipped.getAttribute('aria-describedby'), 'hubTooltip');
assert.ok(parseFloat(tooltip.style.left) <= 288);
assert.equal(tooltip.style.top, '162px');
listeners.keydown({ key: 'Escape' });
assert.ok(tooltip.hidden);
assert.equal(clipped.getAttribute('aria-describedby'), null);
const workspace = new Element('my-app');
workspace.setAttribute('title', 'D:\\workspace\\my-app');
workspace.setAttribute('aria-describedby', 'existing-help');
hover(workspace); pending();
assert.equal(tooltip.textContent, 'D:\\workspace\\my-app');
assert.ok(!workspace.hasAttribute('title'));
assert.equal(workspace.getAttribute('aria-describedby'), 'existing-help hubTooltip');
listeners.scroll();
assert.equal(workspace.getAttribute('aria-describedby'), 'existing-help');
hover(new Element('Short', 30));
assert.equal(pending, null);
const detached = new Element('Removed row');
hover(detached); detached.isConnected = false; pending();
assert.ok(tooltip.hidden);
console.log('Custom tooltips: delay, viewport position, Escape, native suppression, accessibility and cleanup passed');
