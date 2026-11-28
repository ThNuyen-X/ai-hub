(() => {
  let view = null;
  let assets;
  function loadScript(src) {
    return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('Cannot load terminal assets')); }; document.head.appendChild(script); });
  }
  function loadAssets() {
    if (!assets) assets = (async () => {
      if (!document.getElementById('xtermStyles')) { const link = document.createElement('link'); link.id = 'xtermStyles'; link.rel = 'stylesheet'; link.href = '/terminal-assets/xterm.css'; document.head.appendChild(link); }
      await loadScript('/terminal-assets/xterm.js'); await loadScript('/terminal-assets/fit.js');
    })().catch(error => { assets = null; throw error; });
    return assets;
  }
  function close() {
    const old = view; view = null;
    if (!old) return;
    old.controller.abort(); old.stream?.close(); old.observer?.disconnect();
    cancelAnimationFrame(old.frame); old.term?.dispose(); old.host?.remove();
    if (old.hiddenFeed) document.getElementById('terminalLogsFeed')?.classList.remove('hidden');
  }
  async function open({ sessionId, command, show }) {
    close();
    const state = { controller: new AbortController(), frame: 0 };
    view = state;
    try {
      const query = new URLSearchParams({ sessionId, ...(command ? { command } : {}) });
      const response = await fetch('/api/terminal/lookup?' + query, { signal: state.controller.signal });
      if (!response.ok) throw new Error('Live terminal unavailable');
      const data = await response.json();
      if (view !== state) return true;
      if (!data.terminalId) { view = null; return false; }
      await loadAssets();
      if (view !== state) return true;
      show();
      state.host = document.createElement('div');
      state.host.id = 'embeddedTerminal';
      state.host.style.cssText = 'flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;background:#09090b;padding:6px;overflow:hidden';
      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'display:flex;gap:12px;align-items:center;color:#a1a1aa;font:12px monospace;padding:4px;min-height:26px';
      const status = document.createElement('span'); status.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      status.textContent = 'PTY ' + data.pid + (data.running ? ' | Running | View only' : ' | Exit ' + data.exitCode);
      status.title = data.command;
      const copy = document.createElement('button'); copy.textContent = 'Copy'; copy.onclick = () => {
        const buffer = state.term.buffer.active; const lines = [];
        for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i).translateToString(true));
        navigator.clipboard.writeText(state.term.getSelection() || lines.join('\n')).catch(() => {});
      };
      const stop = document.createElement('button'); stop.textContent = 'Stop'; stop.style.color = '#fb7185'; stop.disabled = !data.running;
      query.set('terminalId', data.terminalId);
      stop.onclick = async () => {
        if (stop.disabled || !confirm('Dung lenh dang chay? Thao tac nay co the ngat build/deploy.')) return;
        stop.disabled = true;
        try { const r = await fetch('/api/terminal/stop?' + query, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: state.controller.signal }); if (!r.ok) throw new Error('Stop failed'); }
        catch (error) { if (view === state) { stop.disabled = false; status.textContent = error.message; } }
      };
      toolbar.append(status, copy, stop);
      const screen = document.createElement('div'); screen.style.cssText = 'flex:1;min-height:0;overflow:hidden';
      state.host.append(toolbar, screen);
      document.getElementById('terminalLogsFeed').classList.add('hidden'); state.hiddenFeed = true;
      document.getElementById('terminalDrawer').appendChild(state.host);
      state.term = new Terminal({ disableStdin: true, cursorBlink: false, scrollback: 5000, fontSize: 12, theme: { background: '#09090b', foreground: '#e2e8f0' }, allowProposedApi: false });
      const fit = new FitAddon.FitAddon(); state.term.loadAddon(fit); state.term.open(screen);
      state.observer = new ResizeObserver(() => { cancelAnimationFrame(state.frame); state.frame = requestAnimationFrame(() => { if (view === state && screen.clientWidth && screen.clientHeight) fit.fit(); }); });
      state.term.onResize(size => {
        if (!stop.disabled && view === state) fetch('/api/terminal/resize?' + query, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(size), signal: state.controller.signal }).catch(() => {});
      });
      state.observer.observe(screen);
      state.stream = new EventSource('/api/terminal/stream?' + query);
      state.stream.addEventListener('snapshot', e => {
        if (view !== state) return;
        const snapshot = JSON.parse(e.data); state.term.reset(); state.term.write(snapshot.text);
        status.textContent = 'PTY ' + snapshot.pid + (snapshot.running ? ' | Running | View only' : ' | Exit ' + snapshot.exitCode);
        stop.disabled = !snapshot.running;
        if (!snapshot.running) state.stream.close();
      });
      state.stream.addEventListener('data', e => { if (view === state) state.term.write(JSON.parse(e.data).text); });
      state.stream.addEventListener('exit', e => {
        if (view !== state) return;
        const exit = JSON.parse(e.data); status.textContent = 'PTY ' + data.pid + ' | Exit ' + exit.exitCode + (exit.reason ? ' | ' + exit.reason : '');
        stop.disabled = true; state.stream.close();
      });
      state.stream.onerror = () => { if (view === state) status.textContent = 'Reconnecting to PTY ' + data.pid + '...'; };
      return true;
    } catch (error) {
      const current = view === state;
      if (current) close();
      if (current && error.name !== 'AbortError') {
        console.warn('[Terminal]', error.message);
        show();
        const message = document.createElement('div');
        message.style.cssText = 'padding:12px;color:#fb7185';
        message.textContent = 'Cannot attach live terminal: ' + error.message + '. Close and reopen to retry.';
        document.getElementById('terminalDrawer').appendChild(message);
        view = { controller: new AbortController(), host: message };
      }
      return true;
    }
  }
  window.HubLiveTerminal = { open, close };
  window.addEventListener('pagehide', close);
})();
