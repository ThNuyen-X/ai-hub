'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const source = fs.readFileSync(__dirname + '/public/sound-settings.js', 'utf8');
(async () => {
  const saved = new Map();
  let chimes = 0, stops = 0, notes = 0, warnings = 0;
  let revoked = 0, closed = 0;
  const elements = { soundChoice: {}, soundFileLabel: {}, soundFileInput: { click() {} },
    soundTrimPanel: { classList: { add() {}, remove() {} } }, soundTrimName: {},
    soundTrimStart: {}, soundTrimEnd: {}, soundTrimInfo: {}, soundTrimSave: {} };
  const decoded = { duration: 60, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => new Float32Array(60 * 16000).fill(0.5) };
  const ctx = vm.createContext({
    window: { addEventListener() {}, AudioContext: function () {
      this.decodeAudioData = async () => decoded;
      this.close = async () => { closed++; };
    } },
    Blob, URL: { createObjectURL: () => 'blob:song', revokeObjectURL: () => { revoked++; } },
    document: { getElementById: id => elements[id] },
    localStorage: { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v) },
    Audio: function () {
      this.duration = 60;
      this.play = () => Promise.resolve(); this.pause = () => { stops++; };
      this.removeAttribute = () => {}; this.load = () => {};
      Object.defineProperty(this, 'src', { set: () => { if (this.onloadedmetadata) this.onloadedmetadata(); } });
    },
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
  const file = { name: 'song.mp3', type: 'audio/mpeg', size: 30 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(8) };
  const fileInput = { value: 'file', files: [file] };
  await prefs.upload(fileInput);
  assert.equal(fileInput.value, '');
  assert.equal(prefs.choice, 'soft', 'picking a file must not replace saved sound');
  assert.equal(warnings, 0, 'files larger than 2 MB are accepted');
  elements.soundTrimStart.value = 20;
  let range = prefs.updateTrim('start');
  assert.equal(range.start, 20); assert.equal(range.end, 20.01);
  elements.soundTrimEnd.value = 40;
  range = prefs.updateTrim('end');
  assert.equal(range.start, 32); assert.equal(range.end, 40);
  const clip = prefs.encodeClip(decoded, range.start, range.end);
  assert.equal(clip.size, 44 + 8 * 16000 * 2);
  const wav = new DataView(await clip.arrayBuffer());
  assert.equal(wav.getUint32(24, true), 16000);
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getInt16(44, true), 0, 'clip starts with fade');
  assert.ok(wav.getInt16(44 + 1000 * 2, true) > 0);
  await prefs.saveTrim();
  assert.equal(prefs.choice, 'custom');
  assert.equal(saved.get('ai_hub_sound_filename'), 'song.mp3 [32.00 - 40.00 giây]');
  assert.equal(revoked, 1); assert.equal(closed, 1);
  assert.equal(prefs.pending, null);
  assert.equal(prefs.play({}), true);
  prefs.stop(); assert.ok(stops >= 1);
  await prefs.upload({ files: [file] });
  const original = saved.get('ai_hub_sound_file');
  const quotaStore = ctx.localStorage.setItem;
  ctx.localStorage.setItem = () => { throw new Error('quota'); };
  await prefs.saveTrim();
  assert.equal(saved.get('ai_hub_sound_file'), original);
  assert.ok(prefs.pending, 'failed save keeps selection for retry');
  assert.equal(warnings, 2); // Successful save toast plus quota warning.
  ctx.localStorage.setItem = quotaStore;
  prefs.cancelTrim();
  await prefs.upload({ files: [{ name: 'bad.html', type: 'text/html', size: 10 }] });
  assert.equal(warnings, 3);
  vm.runInContext(source, ctx);
  assert.equal(elements.soundChoice.value, 'custom', 'selection survives reload');
  ctx.soundEffects.enabled = false;
  const before = chimes;
  await prefs.preview(); assert.equal(chimes, before);
  assert.ok(html.includes('window.soundPreferences?.play(ctx)'));
  assert.ok(html.includes('window.soundPreferences?.stop()'));
  console.log('Sound preferences: presets, custom upload, validation, persistence and muted preview passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
