'use strict';
window.soundPreferences = {
  audio: null,
  timer: null,
  pending: null,
  revision: 0,
  saving: false,
  get choice() { return localStorage.getItem('ai_hub_sound_choice') || 'chime'; },
  stop() {
    clearTimeout(this.timer);
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
  },
  play(ctx) {
    const choice = this.choice;
    this.stop();
    if (choice === 'chime') return false;
    if (choice === 'custom') {
      const source = localStorage.getItem('ai_hub_sound_file');
      if (!source || !/^data:audio\//.test(source)) return false;
      const audio = new Audio(source);
      this.audio = audio;
      audio.volume = 0.7;
      audio.onended = () => { if (this.audio === audio) this.stop(); };
      audio.play().catch(() => { if (this.audio === audio) { this.stop(); soundEffects.playBop(); } });
      this.timer = setTimeout(() => this.stop(), 8000);
      return true;
    }
    const notes = choice === 'bell' ? [880, 1320] : choice === 'soft' ? [392, 523.25] : null;
    if (!notes) return false;
    notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * 0.14;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      osc.start(start); osc.stop(start + 0.5);
    });
    return true;
  },
  sync() {
    const select = document.getElementById('soundChoice');
    if (select) select.value = this.choice;
    const label = document.getElementById('soundFileLabel');
    if (label) label.textContent = localStorage.getItem('ai_hub_sound_filename') || 'Chưa chọn file nhạc';
  },
  select(value) {
    if (!['chime', 'bell', 'soft', 'custom'].includes(value)) return;
    if (value === 'custom' && !localStorage.getItem('ai_hub_sound_file')) {
      document.getElementById('soundFileInput').click(); this.sync(); return;
    }
    this.stop();
    localStorage.setItem('ai_hub_sound_choice', value);
    this.sync();
    this.preview();
  },
  async preview() {
    if (!soundEffects.enabled) return;
    try {
      const ctx = soundEffects.getCtx(false);
      if (!ctx) return;
      if (ctx.state === 'suspended') await ctx.resume();
      if (soundEffects.enabled) soundEffects.playChime();
    } catch (_) {}
  },
  cancelTrim() {
    this.revision++;
    this.stop();
    if (this.pending) {
      this.pending.player.pause();
      this.pending.player.removeAttribute('src');
      this.pending.player.load();
      URL.revokeObjectURL(this.pending.url);
      this.pending = null;
    }
    const panel = document.getElementById('soundTrimPanel');
    if (panel) panel.classList.add('hidden');
  },
  async upload(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    this.cancelTrim();
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name)) {
      showToast('Chọn file âm thanh hợp lệ.', 'warning'); return;
    }
    const revision = this.revision;
    const url = URL.createObjectURL(file);
    const player = new Audio();
    player.preload = 'metadata';
    this.pending = { file, url, player, duration: 0 };
    try {
      await new Promise((resolve, reject) => {
        player.onloadedmetadata = resolve;
        player.onerror = reject;
        player.src = url;
      });
      if (revision !== this.revision) return;
      const duration = player.duration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid duration');
      this.pending.duration = duration;
      document.getElementById('soundTrimName').textContent = file.name + ' (' + duration.toFixed(1) + ' giây)';
      const start = document.getElementById('soundTrimStart');
      const end = document.getElementById('soundTrimEnd');
      start.max = end.max = duration;
      start.value = 0;
      end.value = Math.min(8, duration).toFixed(3);
      document.getElementById('soundTrimPanel').classList.remove('hidden');
      this.updateTrim();
    } catch (_) {
      if (revision !== this.revision) return;
      this.cancelTrim();
      showToast('Không đọc được file nhạc. Hãy thử định dạng MP3 hoặc WAV.', 'warning');
    } finally {
      player.onloadedmetadata = player.onerror = null;
    }
  },
  updateTrim(changed) {
    if (!this.pending) return;
    this.stop();
    const startInput = document.getElementById('soundTrimStart');
    const endInput = document.getElementById('soundTrimEnd');
    const duration = this.pending.duration;
    let start = Math.max(0, Math.min(Number(startInput.value) || 0, Math.max(0, duration - 0.01)));
    let end = Math.max(start + 0.01, Math.min(Number(endInput.value) || 0, duration));
    if (end - start > 8) {
      if (changed === 'end') start = end - 8;
      else end = start + 8;
    }
    startInput.value = String(start);
    endInput.value = String(end);
    document.getElementById('soundTrimInfo').textContent = 'Đoạn đã chọn: ' + (end - start).toFixed(2) + ' / 8 giây';
    return { start, end };
  },
  async previewTrim() {
    const range = this.updateTrim();
    if (!range) return;
    if (!soundEffects.enabled) { showToast('Bật loa để nghe thử.', 'warning'); return; }
    const player = new Audio(this.pending.url);
    this.audio = player;
    player.volume = 0.7;
    player.currentTime = range.start;
    player.ontimeupdate = () => { if (this.audio === player && player.currentTime >= range.end) this.stop(); };
    player.onended = () => { if (this.audio === player) this.stop(); };
    try {
      await player.play();
      if (this.audio === player) this.timer = setTimeout(() => this.stop(), (range.end - range.start) * 1000);
    } catch (_) {
      if (this.audio === player) { this.stop(); showToast('Không phát được đoạn nhạc.', 'warning'); }
    }
  },
  encodeClip(buffer, start, end) {
    const sampleRate = 16000;
    const frames = Math.min(8 * sampleRate, Math.floor((Math.min(end, buffer.duration) - start) * sampleRate));
    if (frames <= 0) throw new Error('Empty clip');
    const data = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(data);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, frames * 2, true);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    for (let i = 0; i < frames; i++) {
      const position = (start + i / sampleRate) * buffer.sampleRate;
      const index = Math.floor(position);
      const fraction = position - index;
      let sample = 0;
      for (const channel of channels) {
        const a = channel[Math.min(index, channel.length - 1)];
        const b = channel[Math.min(index + 1, channel.length - 1)];
        sample += a + (b - a) * fraction;
      }
      // A short fade avoids clicks at arbitrary cut points.
      sample = Math.max(-1, Math.min(1, sample / channels.length)) * Math.min(1, i / 160, (frames - 1 - i) / 160);
      view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return new Blob([data], { type: 'audio/wav' });
  },
  async saveTrim() {
    if (this.saving || !this.pending) return;
    const range = this.updateTrim();
    const { file } = this.pending;
    const revision = this.revision;
    const button = document.getElementById('soundTrimSave');
    this.saving = true;
    button.disabled = true;
    button.textContent = 'Đang cắt và lưu...';
    let ctx;
    try {
      // Decode only on save; the original file never goes into localStorage.
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      if (revision !== this.revision) return;
      const clip = this.encodeClip(buffer, range.start, range.end);
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(clip);
      });
      if (revision !== this.revision) return;
      const label = file.name + ' [' + range.start.toFixed(2) + ' - ' + range.end.toFixed(2) + ' giây]';
      localStorage.setItem('ai_hub_sound_file', source);
      localStorage.setItem('ai_hub_sound_filename', label);
      this.cancelTrim();
      this.select('custom');
      showToast('Đã lưu đoạn nhạc thông báo.', 'success');
    } catch (_) {
      if (revision === this.revision) showToast('Không thể cắt hoặc lưu nhạc. File có thể không được hỗ trợ, quá nặng để xử lý hoặc bộ nhớ đã đầy.', 'warning');
    } finally {
      if (ctx) await ctx.close().catch(() => {});
      this.saving = false;
      button.disabled = false;
      button.textContent = 'Lưu đoạn nhạc';
    }
  }
};
window.addEventListener('pagehide', () => window.soundPreferences.cancelTrim());
window.soundPreferences.sync();
