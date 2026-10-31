function isTechnicalSessionName(name) {
  return !name || /^(?:session_\d+|\d{8}_\d+|CLI Session|New Chat)$/i.test(name.trim());
}

function sessionTitle(prompt) {
  let text = String(prompt || '')
    .replace(/<turn-context\b[^>]*>[\s\S]*?<\/turn-context>/gi, '')
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (!text) return 'Cu\u1ed9c tr\u00f2 chuy\u1ec7n m\u1edbi';
  if (/Subagent\s+[A-Za-z0-9_.-]+\s+(?:completed|failed|cancelled|stopped|done|error):/i.test(text)) {
    const cleanText = text
      .replace(/Subagent\s+[A-Za-z0-9_.-]+\s+(?:completed|failed|cancelled|stopped|done|error):\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, ' ')
      .replace(/Subagent\s+[A-Za-z0-9_.-]+\s+(?:completed|failed|cancelled|stopped|done|error):\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanText) {
      text = cleanText;
    } else {
      return 'B\u00e1o c\u00e1o t\u00e1c v\u1ee5 Subagent';
    }
  }
  const chars = Array.from(text);
  if (chars.length <= 64) return text;
  const short = chars.slice(0, 61).join('');
  const boundary = short.lastIndexOf(' ');
  return (boundary >= 36 ? short.slice(0, boundary) : short) + '...';
}

function titleFromContent(content) {
  try {
    const items = typeof content === 'string' ? JSON.parse(content) : content;
    return sessionTitle(Array.isArray(items)
      ? items.filter(item => item.type === 'text').map(item => typeof item.text === 'string' ? item.text : item.text?.value || '').join(' ')
      : '');
  } catch {
    return sessionTitle('');
  }
}

module.exports = { isTechnicalSessionName, sessionTitle, titleFromContent };
