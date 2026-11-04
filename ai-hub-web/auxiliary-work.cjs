const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const digest = text => crypto.createHash('sha256').update(text).digest('hex');

function prepareEdits(root, sources, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 12) throw new Error('Expected 1-12 focused replacements');
  const base = fs.realpathSync(root);
  const allowed = new Map();
  for (const source of sources) {
    if (!allowed.has(source.path)) allowed.set(source.path, []);
    allowed.get(source.path).push(source);
  }
  const lineEdits = new Map();
  edits = edits.map(edit => {
    if (!edit || typeof edit.path !== 'string' || edit.before !== undefined) return edit;
    const target = fs.realpathSync(path.resolve(base, edit.path));
    const relative = path.relative(base, target);
    const ranges = allowed.get(relative) || [];
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.end < edit.start) throw new Error('Invalid edit line range');
    const source = ranges.find(range => edit.start >= range.start && edit.end <= range.end);
    if (!source) throw new Error('Edit outside supplied source range');
    const used = lineEdits.get(relative) || [];
    if (used.some(range => edit.start <= range.end && edit.end >= range.start)) throw new Error('Overlapping line edits');
    used.push(edit); lineEdits.set(relative, used);
    const original = fs.readFileSync(target, 'utf8');
    if (digest(original) !== source.hash) throw new Error('Source changed during analysis: ' + relative);
    const before = original.split(/\r?\n/).slice(edit.start - 1, edit.end).join('\n');
    return { ...edit, path: relative, before };
  });
  const prepared = new Map();
  for (const edit of edits) {
    if (!edit || typeof edit.path !== 'string' || typeof edit.before !== 'string' || typeof edit.after !== 'string' || !edit.before.trim()) throw new Error('Invalid replacement');
    if (edit.before.length + edit.after.length > 30000) throw new Error('Replacement too large');
    const target = fs.realpathSync(path.resolve(base, edit.path));
    const relative = path.relative(base, target);
    const ranges = allowed.get(relative);
    const source = ranges?.find(range => range.raw && typeof edit.before === "string" && range.raw.replace(/\r\n/g, "\n").includes(edit.before.replace(/\r\n/g, "\n")));
    if (!source) throw new Error('Edit outside supplied source scope');
    if (fs.lstatSync(target).nlink > 1) throw new Error('Hard-linked files cannot be edited');
    if (!source.raw || !source.hash) throw new Error('Missing source snapshot');
    const current = fs.readFileSync(target, 'utf8');
    if (digest(current) !== source.hash) throw new Error('Source changed during analysis: ' + relative);
    const original = prepared.get(target)?.after ?? current;
    const normalized = original.replace(/\r\n/g, '\n');
    const before = edit.before.replace(/\r\n/g, '\n');
    if (!source.raw.replace(/\r\n/g, '\n').includes(before)) throw new Error('Replacement not in supplied excerpt');
    const offset = normalized.indexOf(before);
    if (offset < 0 || offset !== normalized.lastIndexOf(before)) throw new Error('Replacement must match exactly once: ' + relative);
    const result = normalized.slice(0, offset) + edit.after.replace(/\r\n/g, '\n') + normalized.slice(offset + before.length);
    prepared.set(target, { path: relative, before: current, after: current.includes('\r\n') ? result.replace(/\n/g, '\r\n') : result, hash: source.hash });
  }
  return prepared;
}

async function syntaxCheck(filename, text, signal) {
  if (signal?.aborted) throw new Error('Cancelled before syntax check');
  if (!/\.(?:js|cjs|mjs)$/i.test(filename)) return { file: filename, status: 'not_checked', detail: 'No automatic syntax checker for this file type' };
  return new Promise((resolve, reject) => {
    const args = ['--check'];
    if (/\.mjs$/i.test(filename)) args.push('--input-type=module');
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 15000);
    child.stderr.on('data', chunk => { if (error.length < 3000) error += chunk.toString().slice(0, 3000 - error.length); });
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (code !== 0 || signal?.aborted) reject(new Error('Syntax check failed: ' + filename + '\n' + error));
      else resolve({ file: filename, status: 'passed', check: 'node --check' });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}

async function applyEdits(root, sources, edits, signal) {
  const prepared = prepareEdits(root, sources, edits);
  const checks = [];
  for (const [target, edit] of prepared) checks.push(await syntaxCheck(target, edit.after, signal));
  // Validate every snapshot again before the first write. Never overwrite concurrent work.
  for (const [target, edit] of prepared) {
    if (signal?.aborted) throw new Error('Cancelled before applying changes');
    if (digest(fs.readFileSync(target, 'utf8')) !== edit.hash) throw new Error('Concurrent source change: ' + edit.path);
  }
  const applied = [];
  try {
    for (const [target, edit] of prepared) {
      if (signal?.aborted) throw new Error('Cancelled while applying changes');
      if (digest(fs.readFileSync(target, 'utf8')) !== edit.hash) throw new Error('Concurrent source change: ' + edit.path);
      fs.writeFileSync(target, edit.after);
      applied.push({ path: edit.path });
    }
  } catch (error) {
    error.message += '; already applied: ' + applied.map(x => x.path).join(', ');
    throw error;
  }
  return { changedFiles: applied, checks, verification: 'Syntax checks only. Main agent must run relevant functional tests before declaring completion.' };
}

module.exports = { digest, prepareEdits, syntaxCheck, applyEdits };
