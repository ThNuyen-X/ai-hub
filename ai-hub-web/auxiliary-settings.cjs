const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'auxiliary-settings.json');
function createSettings(filename = file) {
  let values;
  function load() {
    if (values) return;
    values = new Map();
    try {
      if (fs.statSync(filename).size > 512000) return;
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      for (const [id, value] of Object.entries(saved).slice(-2000)) if (typeof value === 'string') values.set(id, value);
    } catch { /* First use or damaged optional preferences: use safe defaults. */ }
  }
  return {
    get(id) { load(); return values.get(id) || ''; },
    set(id, model) {
      load();
      if (!id || typeof model !== 'string') throw new Error('Invalid auxiliary preference');
      if (values.get(id) === model) return;
      values.delete(id); values.set(id, model);
      while (values.size > 2000) values.delete(values.keys().next().value);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const temp = filename + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(values)), { mode: 0o600 });
      fs.renameSync(temp, filename);
    }
  };
}
module.exports = { createSettings };
