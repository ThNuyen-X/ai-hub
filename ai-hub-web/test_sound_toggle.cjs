'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const start = html.indexOf('    const soundEffects = {');
const end = html.indexOf('    function updateSoundUI()', start);
assert.ok(start > 0 && end > start);
(async () => {
  let unlock, chimes = 0, updates = 0, resumes = 0;
  const storage = new Map([['ai_hub_sound', 'false']]);
  const audio = { state: 'suspended', resume() {
    resumes++;
    return new Promise(resolve => { unlock = () => { audio.state = 'running'; resolve(); }; });
  } };
  const context = vm.createContext({
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    window: { AudioContext: function () { return audio; } },
    updateSoundUI: () => { updates++; }
  });
  const sound = vm.runInContext(html.slice(start, end) + '\nsoundEffects;', context);
  sound.playChime = () => { chimes++; };
  const enabling = sound.toggle();
  assert.equal(storage.get('ai_hub_sound'), 'true');
  assert.equal(resumes, 1);
  assert.equal(chimes, 0, 'confirmation waits for audio unlock');
  unlock();
  await enabling;
  assert.equal(chimes, 1, 'enabling plays one audible confirmation');
  await sound.toggle();
  assert.equal(chimes, 1, 'muting remains silent');
  assert.equal(storage.get('ai_hub_sound'), 'false');
  audio.state = 'suspended';
  const pending = sound.toggle();
  await sound.toggle();
  unlock();
  await pending;
  assert.equal(chimes, 1, 'muting before unlock cancels the confirmation');
  audio.state = 'suspended';
  audio.resume = () => Promise.reject(new Error('Audio blocked'));
  await sound.toggle();
  assert.equal(chimes, 1, 'blocked audio is handled without an unhandled rejection');
  assert.equal(updates, 5);
  console.log('Sound toggle: audible enable, audio unlock, silent mute, cancellation and blocked audio passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
