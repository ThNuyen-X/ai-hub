const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const source = fs.readFileSync('server.js', 'utf8');
const query = source.match(/db\.prepare\(`(SELECT s\.id,[\s\S]*?ORDER BY s\.updated_at DESC)`\)/)[1];
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE sessions (id TEXT, name TEXT, working_dir TEXT, created_at TEXT, updated_at TEXT, archived_at TEXT, session_type TEXT, parent_session_id TEXT);
CREATE TABLE messages (id INTEGER, session_id TEXT, role TEXT, content_json TEXT);
INSERT INTO sessions VALUES
('main', 'My chat', 'D:/project', '', '', NULL, 'user', NULL),
('child', 'Delegated task', 'D:/project', '', '', NULL, 'sub_agent', 'main'),
('renamed-child', 'Research files', 'D:/other', '', '', NULL, 'sub_agent', 'main'),
('archived', 'Old chat', 'D:/project', '', '', '2026-10-31', 'user', NULL),
('nested', 'Nested task', 'D:/project', '', '', NULL, 'user', 'main');`);
assert.deepEqual(db.prepare(query).all().map(row => row.id), ['main']);
assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 5);
db.close();
console.log('Session visibility: hides delegated, renamed child, nested and archived sessions without deleting history');
