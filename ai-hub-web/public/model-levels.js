(function (root) {
  'use strict';
  // Only expose variant IDs advertised by the router or verified by live requests.
  const levels = {
    'ag/gemini-4-hydrogen-high': ['low', 'medium', 'high'],
    'ag/gemini-4-argon-high': ['low', 'medium', 'high'],
    'ag/gemini-3.8-flash': ['low', 'medium', 'high'],
    'ag/gemini-3.1-pro-high': ['low', 'high'],
    'ag/claude-sonnet-5-5-high': ['low', 'medium', 'high'],
    'ag/claude-opus-5-5-high': ['low', 'medium', 'high']
  };
  function variants(model) {
    const supported = levels[model.id];
    if (!supported) return [model];
    const base = model.id.replace(/-(low|medium|high)$/, '');
    const choices = supported.map(level => ({ ...model,
      id: base + '-' + level, full: base + '-' + level,
      name: model.name + ' / ' + level[0].toUpperCase() + level.slice(1), level
    }));
    if (!choices.some(choice => choice.id === model.id)) choices.unshift({ ...model, level: 'default' });
    return choices;
  }
  const levelMeta = {
    'default': { label: 'Mặc định', icon: '✨', desc: 'Cấu hình tiêu chuẩn 9Router' },
    'low': { label: 'Low', icon: '⚡', desc: 'Tốc độ phản hồi nhanh, tiết kiệm token' },
    'medium': { label: 'Medium', icon: '⚖️', desc: 'Cân bằng tối ưu tốc độ & chiều sâu lập luận' },
    'high': { label: 'High', icon: '🧠', desc: 'Suy luận chuyên sâu, giải quyết tác vụ phức tạp' }
  };
  function getLevelMeta(level) {
    return levelMeta[level] || { label: level ? level[0].toUpperCase() + level.slice(1) : 'Default', icon: '✨', desc: '' };
  }
  const api = { levels, variants, levelMeta, getLevelMeta };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ModelLevels = api;
})(typeof globalThis === 'object' ? globalThis : this);
