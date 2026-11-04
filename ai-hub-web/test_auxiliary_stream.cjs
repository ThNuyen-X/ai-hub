const assert = require('node:assert/strict');
const { readCompletion } = require('./auxiliary-stream.cjs');
function response(text, size = 7) {
  const bytes = new TextEncoder().encode(text); let offset = 0;
  return { headers: new Headers({ 'content-type': 'text/event-stream' }), body: new ReadableStream({ pull(controller) { if (offset >= bytes.length) return controller.close(); controller.enqueue(bytes.slice(offset, offset += size)); } }) };
}
(async () => {
  const phases = [];
  const text = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Xin chào' } }] }) + '\r\n\r\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 8 } }) + '\n\ndata: [DONE]\n\n';
  const result = await readCompletion(response(text), event => phases.push(event.phase), Date.now());
  assert.equal(result.choices[0].message.content, 'Xin chào');
  assert.equal(result.usage.total_tokens, 8);
  assert.deepEqual(phases, ['receiving']);
  await assert.rejects(readCompletion(response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), () => {}, Date.now()), /interrupted/);
  await assert.rejects(readCompletion(response('data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n'), () => {}, Date.now()), /truncated/);
  await assert.rejects(readCompletion(response('data: {"error":{"message":"rate limited"}}\n'), () => {}, Date.now()), /rate limited/);
  console.log('Auxiliary streaming: chunk boundaries, UTF-8, usage, progress, truncated and interrupted output passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
