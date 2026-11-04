async function readCompletion(response, report, started, signal) {
  if (!response.headers?.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Provider error');
    if (data.choices?.[0]?.finish_reason === 'length') throw new Error('Auxiliary output truncated; narrow the task');
    return { ...data, firstContentMs: Date.now() - started };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', content = '', usage = null, firstContentMs = null, lastReport = 0, finished = false, reason = null;
  function line(text) {
    if (!text.startsWith('data:')) return;
    const payload = text.slice(5).trim();
    if (payload === '[DONE]') { finished = true; return; }
    if (!payload) return;
    const data = JSON.parse(payload);
    if (data.error) throw new Error(data.error.message || 'Provider stream error');
    if (data.usage) usage = data.usage;
    const choice = data.choices?.[0];
    if (choice?.finish_reason) { reason = choice.finish_reason; finished = true; }
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) {
      content += delta;
      if (content.length > 80000) throw new Error('Auxiliary output exceeds safety limit');
      if (firstContentMs === null) firstContentMs = Date.now() - started;
      if (!lastReport || Date.now() - lastReport >= 1000) {
        lastReport = Date.now();
        report({ phase: 'receiving', firstContentMs, outputChars: content.length, elapsedMs: Date.now() - started });
      }
    }
  }
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Auxiliary cancelled');
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 160000) throw new Error('Provider event exceeds safety limit');
      let index;
      while ((index = pending.indexOf('\n')) >= 0) { line(pending.slice(0, index).replace(/\r$/, '')); pending = pending.slice(index + 1); }
      if (done) { if (pending.trim()) line(pending); break; }
    }
    if (!finished) throw new Error('Auxiliary stream interrupted; no edits applied');
    if (reason === 'length') throw new Error('Auxiliary output truncated; narrow the task');
    return { choices: [{ message: { content } }], usage, firstContentMs };
  } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
}
module.exports = { readCompletion };
