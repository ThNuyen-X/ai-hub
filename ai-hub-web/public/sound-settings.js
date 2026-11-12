'use strict';
window.soundPreferences = {
  audio: null,
  timer: null,
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
    if (label) label.textContent = localStorage.getItem('ai_hub_sound_filename') || 'Chưa chọn file (tối đa 2 MB)';
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
  async upload(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if ((!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name)) || file.size > 2 * 1024 * 1024) {
      showToast('Chọn file âm thanh hợp lệ, tối đa 2 MB.', 'warning'); return;
    }
    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file.type.startsWith('audio/') ? file : new Blob([file], { type: 'audio/mpeg' }));
      });
      // Store the large payload first; quota failure leaves the previous selection intact.
      localStorage.setItem('ai_hub_sound_file', source);
      localStorage.setItem('ai_hub_sound_filename', file.name);
      this.select('custom');
    } catch (_) { showToast('Không thể lưu nhạc. Bộ nhớ trình duyệt có thể đã đầy.', 'warning'); }
  }
};
window.addEventListener('pagehide', () => window.soundPreferences.stop());
window.soundPreferences.sync();
