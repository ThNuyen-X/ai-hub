const { DatabaseSync } = require('node:sqlite');
function hasSessionExtension(dbPath, sessionId, name) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT extension_data FROM sessions WHERE id = ? OR name = ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1').get(sessionId, sessionId, sessionId);
    if (!row) return false;
    const data = JSON.parse(row.extension_data || '{}');
    return (data['enabled_extensions.v0']?.extensions || []).some(extension => extension.name === name);
  } finally { if (db) db.close(); }
}
module.exports = { hasSessionExtension };
