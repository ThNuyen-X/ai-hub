'use strict';

const PAGE_SIZE = 60;
const PREVIEW_LIMIT = 6000;

function historyOutput(block) {
  const value = block.toolResult?.value;
  if (value !== undefined && value !== null) {
    if (typeof value === 'string') return value;
    if (typeof value.stdout === 'string' || typeof value.stderr === 'string') {
      return (value.stdout || '') + (value.stderr ? '\n[STDERR]: ' + value.stderr : '');
    }
    if (value.structuredContent?.stdout !== undefined) {
      return (value.structuredContent.stdout || '') + (value.structuredContent.stderr ? '\n[STDERR]: ' + value.structuredContent.stderr : '');
    }
    if (Array.isArray(value.content)) return value.content.map(x => typeof x === 'string' ? x : x?.text || '').join('\n');
    return JSON.stringify(value, null, 2);
  }
  return String(block.output || block.text || '');
}

function previewMessage(row, sessionId) {
  let content = [];
  let metadata;
  try { content = JSON.parse(row.content_json || '[]'); } catch {}
  try { if (row.metadata_json) metadata = JSON.parse(row.metadata_json); } catch {}
  if (Array.isArray(content)) content = content.map((block, index) => {
    if (!block || block.type !== 'toolResponse') return block;
    const output = historyOutput(block);
    if (output.length <= PREVIEW_LIMIT) return block;
    return {
      type: 'toolResponse', id: block.id,
      toolResult: { value: { isError: !!block.toolResult?.value?.isError, content: [{ type: 'text', text: output.slice(0, PREVIEW_LIMIT) }] } },
      historySource: { sessionId, messageId: row.message_id, blockIndex: index, length: output.length }
    };
  });
  return { id: row.message_id, role: row.role, created: row.created_timestamp, content, ...(metadata !== undefined ? { metadata } : {}) };
}

function readHistoryPage(db, sessionId, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || PAGE_SIZE));
  const before = Number(options.before);
  const hasBefore = Number.isSafeInteger(before) && before > 0;
  // Fetch one sentinel row rather than COUNT(*) on every scroll request.
  const rows = db.prepare(`SELECT id, message_id, role, created_timestamp, content_json, metadata_json
    FROM messages WHERE session_id = ? ${hasBefore ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`)
    .all(...(hasBefore ? [sessionId, before, limit + 1] : [sessionId, limit + 1]));
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  rows.reverse();
  return {
    conversation: rows.map(row => previewMessage(row, sessionId)),
    historyPage: { hasMore, before: rows[0]?.id || null, limit }
  };
}

module.exports = { PAGE_SIZE, PREVIEW_LIMIT, historyOutput, previewMessage, readHistoryPage };
