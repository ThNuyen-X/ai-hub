const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
const MAX_CLIENT_BYTES = 2 * 1024 * 1024;

function retainReplayEvent(ctx, item) {
  if (!Array.isArray(ctx.events)) ctx.events = [];
  if (item.event === 'session_file_diffs') {
    ctx.events = ctx.events.filter(e => e.event !== 'session_file_diffs');
  }
  item.bytes = Buffer.byteLength(JSON.stringify(item.payload)) + 80;
  ctx.events.push(item);
  let bytes = ctx.events.reduce((sum, e) => sum + (e.bytes || 0), 0);
  while (ctx.events.length && (bytes > MAX_REPLAY_BYTES || ctx.events.length > 1200)) {
    bytes -= ctx.events.shift().bytes || 0;
    ctx.replayTruncated = true;
  }
  ctx.replayBytes = bytes;
}

function writeBoundedSse(client, chunk) {
  if (client.destroyed || client.writableEnded) return false;
  if (client.writableLength > MAX_CLIENT_BYTES) {
    client.destroy();
    return false;
  }
  return client.write(chunk);
}

async function replayToClient(client, events) {
  for (const item of events) {
    if (client.destroyed || client.writableEnded) return;
    const chunk = `id: ${item.id}\nevent: ${item.event}\ndata: ${JSON.stringify(item.payload)}\n\n`;
    if (!writeBoundedSse(client, chunk)) {
      if (client.destroyed) return;
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer);
          client.off('drain', drained);
          client.off('close', closed);
          client.off('error', failed);
          if (error) reject(error); else resolve();
        };
        const drained = () => finish();
        const closed = () => finish(new Error('SSE closed during replay'));
        const failed = error => finish(error);
        const timer = setTimeout(() => {
          finish(new Error('SSE replay drain timeout'));
          client.destroy();
        }, 10000);
        timer.unref();
        client.once('drain', drained);
        client.once('close', closed);
        client.once('error', failed);
      });
    }
  }
}
module.exports = { retainReplayEvent, writeBoundedSse, replayToClient, MAX_REPLAY_BYTES };
