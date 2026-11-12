'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const source = fs.readFileSync(__dirname + '/public/sound-settings.js', 'utf8');
(async () => {
  const saved = new Map();
  let chimes = 0, stops = 0, notes = 0, warnings = 0;
  const elements = { soundChoice: {}, soundFileLabel: {}, soundFileInput: { click() {} } };
  const ctx = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById: id => elements[id] },
    localStorage: { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v) },
    Audio: function () { this.play = () => Promise.resolve(); this.pause = () => { stops++; }; },
    soundEffects: { enabled: true, getCtx: () => ({ state: 'running' }), playChime: () => { chimes++; } },
    showToast: () => { warnings++; }, setTimeout: () => 1, clearTimeout() {},
    FileReader: function () { this.readAsDataURL = () => { this.result = 'data:audio/mpeg;base64,AAAA'; this.onload(); }; }
  });
  vm.runInContext(source, ctx);
  const prefs = ctx.window.soundPreferences;
  assert.equal(prefs.choice, 'chime');
  assert.equal(prefs.play({}), false);
  prefs.select('bell'); await Promise.resolve();
  assert.equal(prefs.choice, 'bell');
  assert.equal(chimes, 1);
  const audioCtx = {
    currentTime: 0, destination: {},
    createOscillator: () => { notes++; return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; },
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} })
  };
  assert.equal(prefs.play(audioCtx), true);
  assert.equal(notes, 2);
  prefs.select('soft');
  assert.equal(prefs.play(audioCtx), true);
  assert.equal(notes, 4);
  const fileInput = { value: 'file', files: [{ name: 'song.mp3', type: 'audio/mpeg', size: 100 }] };
  await prefs.upload(fileInput);
  assert.equal(fileInput.value, '');
  assert.equal(prefs.choice, 'custom');
  assert.equal(saved.get('ai_hub_sound_filename'), 'song.mp3');
  assert.equal(prefs.play({}), true);
  prefs.stop(); assert.equal(stops, 1);
  await prefs.upload({ files: [{ name: 'large.mp3', type: 'audio/mpeg', size: 3 * 1024 * 1024 }] });
  assert.equal(warnings, 1);
  await prefs.upload({ files: [{ name: 'bad.html', type: 'text/html', size: 10 }] });
  assert.equal(warnings, 2);
  vm.runInContext(source, ctx);
  assert.equal(elements.soundChoice.value, 'custom', 'selection survives reload');
  ctx.soundEffects.enabled = false;
  const before = chimes;
  await prefs.preview(); assert.equal(chimes, before);
  assert.ok(html.includes('window.soundPreferences?.play(ctx)'));
  assert.ok(html.includes('window.soundPreferences?.stop()'));
  console.log('Sound preferences: presets, custom upload, validation, persistence and muted preview passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
