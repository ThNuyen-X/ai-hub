const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hasSessionExtension } = require('./session-extensions.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-extensions-'));
const file = path.join(dir, 'sessions.db');
try {
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE sessions (id TEXT, name TEXT, extension_data TEXT)');
    const add = db.prepare('INSERT INTO sessions VALUES (?, ?, ?)');
    add.run('one', 'alias', JSON.stringify({ 'enabled_extensions.v0': { extensions: [{ name: 'auxiliary_model' }] } }));
    add.run('two', 'empty', '{}');
  } finally { db.close(); }
  assert.equal(hasSessionExtension(file, 'one', 'auxiliary_model'), true);
  assert.equal(hasSessionExtension(file, 'alias', 'auxiliary_model'), true);
  assert.equal(hasSessionExtension(file, 'two', 'auxiliary_model'), false);
  assert.equal(hasSessionExtension(file, 'missing', 'auxiliary_model'), false);
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(server.includes('const savedAuxiliary = auxiliaryModel && resume && hasSessionExtension('));
  assert.ok(server.includes('if (auxiliaryModel && !savedAuxiliary)'));
  console.log('Session extension dedup: saved, alias, empty and missing sessions passed.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
