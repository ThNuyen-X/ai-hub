'use strict';
const fs = require('fs');
const path = require('path');

function toDataUri(relPath) {
  const full = path.join('D:/ai-hub/ai-hub-web/public/stickers', relPath);
  const buf = fs.readFileSync(full);
  const ext = path.extname(full).slice(1);
  const mime = ext === 'webp' ? 'image/webp' : (ext === 'gif' ? 'image/gif' : 'image/png');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const MEMES_DORAEMON = {
  eat: toDataUri('candidates/cand_4.webp'),
  run: toDataUri('candidates/cand_7.webp'),
  inspect: toDataUri('candidates/cand_12.webp'),
  wave: toDataUri('candidates/cand_1.webp'),
  click: toDataUri('candidates/cand_8.webp'),
  dance: toDataUri('candidates/cand_11.webp'),
  fly: toDataUri('candidates/cand_3.webp')
};

const MEMES_DRAGONBALL = {
  eat: toDataUri('dragonball/db_1.webp'),
  run: toDataUri('dragonball/db_19.webp'),
  inspect: toDataUri('dragonball/db_7.webp'),
  wave: toDataUri('dragonball/db_21.webp'),
  click: toDataUri('dragonball/db_34.webp'),
  dance: toDataUri('dragonball/db_3.webp'),
  fly: toDataUri('dragonball/db_25.webp')
};

console.log('Doraemon Pack ready');
console.log('Dragon Ball Pack ready');

const template = `'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PACKS = {
  doraemon: ${JSON.stringify(MEMES_DORAEMON)},
  dragonball: ${JSON.stringify(MEMES_DRAGONBALL)}
};

const THEMES_CONFIG = {
  doraemon: {
    name: 'Doraemon',
    primary: '#009fe8',
    bubbleBg: '#ffffff',
    bubbleColor: '#0f172a',
    bubbleBorder: 'rgba(0, 159, 232, 0.45)',
    shadow: 'rgba(0, 159, 232, 0.35)',
    actionText: {
      idle: 'Doraemon đang ăn bánh rán! 🍘',
      run: 'Doraemon đang chạy lon ton! 🏃',
      inspect: 'Doraemon đang soi kính lúp! 🔍',
      wave: 'Doraemon vẫy tay chào bạn! 👋',
      click: 'Doraemon đang nhảy múa! 🎶',
      dance: 'Doraemon đang bơi lắc vòng! 🛸',
      fly: 'Doraemon bay chong chóng tre! ✨',
      typing: 'Doraemon đang gõ phím cặm cụi! ✍️',
      nav: 'Doraemon đưa bạn du hành! 🚀'
    }
  },
  dragonball: {
    name: 'Dragon Ball (Goku & Vegeta)',
    primary: '#f59e0b',
    bubbleBg: '#1e1b4b',
    bubbleColor: '#fef08a',
    bubbleBorder: 'rgba(245, 158, 11, 0.65)',
    shadow: 'rgba(245, 158, 11, 0.45)',
    actionText: {
      idle: 'Goku ăn no nê ngon lành! 🍖',
      run: 'Goku đang phi nước đại thần tốc! ⚡',
      inspect: 'Vegeta dò chỉ số sức mạnh Scouter! 🎯',
      wave: 'Goku chào đồng đội thân thiện! 👋',
      click: 'Super Saiyan bộc phát Ki dũng mãnh! 🔥',
      dance: 'Goku múa nhảy tưng bừng ăn mừng! 💃',
      fly: 'Piccolo bay thiền lơ lửng giữa trời! 🧘',
      typing: 'Goku tích tụ năng lượng luyện công! ⚡',
      nav: 'Dịch chuyển tức thời Instant Transmission! ✨'
    }
  }
};

function getActivePack() {
  try {
    const configPath = path.join(__dirname, 'meme_cursor_config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg && cfg.pack && PACKS[cfg.pack]) return cfg.pack;
    }
  } catch (e) {}
  return 'doraemon';
}

function buildDoraemonFeedback(toolName, rawArgs) {
  const norm = String(toolName || '').replace(/^.*?chrome_devtools[_:]+/, '');
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  let action = 'idle';
  let targetUid = null;
  let customText = '';

  switch (norm) {
    case 'click':
      action = 'click';
      targetUid = args.uid || null;
      customText = 'Bấm chuột';
      break;
    case 'hover':
      action = 'inspect';
      targetUid = args.uid || null;
      customText = 'Rê chuột soi kỹ';
      break;
    case 'fill':
    case 'type_text':
      action = 'typing';
      targetUid = args.uid || null;
      customText = args.value ? 'Gõ: ' + String(args.value).slice(0, 20) : 'Nhập văn bản';
      break;
    case 'fill_form':
      action = 'typing';
      targetUid = (args.elements && args.elements[0] && args.elements[0].uid) || null;
      customText = 'Điền biểu mẫu';
      break;
    case 'navigate_page':
      action = 'nav';
      customText = 'Điều hướng tới ' + (args.url ? String(args.url).slice(0, 24) : 'trang mới');
      break;
    case 'new_page':
      action = 'nav';
      customText = 'Mở tab mới';
      break;
    case 'select_page':
      action = 'wave';
      customText = 'Chuyển tab #' + (args.pageId ?? '');
      break;
    case 'take_snapshot':
    case 'take_screenshot':
      action = 'inspect';
      targetUid = args.uid || null;
      customText = 'Quan sát toàn diện trang';
      break;
    case 'wait_for':
      action = 'dance';
      customText = 'Chờ nội dung xuất hiện';
      break;
    case 'press_key':
      action = 'typing';
      customText = 'Nhấn phím ' + (args.key || '');
      break;
    case 'drag':
      action = 'run';
      targetUid = args.to_uid || args.from_uid || null;
      customText = 'Kéo thả phần tử';
      break;
    default:
      return null;
  }

  const activePackName = getActivePack();
  const theme = THEMES_CONFIG[activePackName] || THEMES_CONFIG.doraemon;
  const memes = PACKS[activePackName] || PACKS.doraemon;

  const fnSource = \`(() => {
    try {
      const PACK_ID = '\${activePackName}';
      const MEME_DATA = \${JSON.stringify(memes)};
      const THEME_CFG = \${JSON.stringify(theme)};

      let root = document.getElementById('__ai_hub_doraemon_root');
      if (!root) {
        root = document.createElement('div');
        root.id = '__ai_hub_doraemon_root';
        root.dataset.pack = PACK_ID;
        root.dataset.v = '2026.30';
        document.documentElement.appendChild(root);
      } else if (root.dataset.pack !== PACK_ID) {
        root.dataset.pack = PACK_ID;
        const oldStyle = document.getElementById('__ai_hub_doraemon_style');
        if (oldStyle) oldStyle.remove();
        const oldCursor = document.getElementById('__ai_hub_doraemon_cursor');
        if (oldCursor) oldCursor.remove();
      }

      if (!document.getElementById('__ai_hub_doraemon_style')) {
        const style = document.createElement('style');
        style.id = '__ai_hub_doraemon_style';
        style.textContent = [
          '* { cursor: default !important; }',
          '.doraemon-cursor-wrap {',
          '  position: fixed; z-index: 2147483647; pointer-events: none;',
          '  width: 72px; height: 72px;',
          '  transform: translate(-36px, -36px);',
          '  transition: left 0.18s cubic-bezier(0.2, 0, 0.2, 1), top 0.18s cubic-bezier(0.2, 0, 0.2, 1);',
          '  will-change: left, top, transform;',
          '  user-select: none;',
          '}',
          '.doraemon-meme-img {',
          '  width: 100%; height: 100%; object-fit: contain;',
          '  filter: drop-shadow(0 4px 10px ' + THEME_CFG.shadow + ');',
          '  transition: transform 0.2s ease;',
          '}',
          '.doraemon-turn-left { transform: rotateY(180deg); }',
          '.doraemon-speech-bubble {',
          '  position: absolute; bottom: 76px; left: 50%; transform: translateX(-50%);',
          '  background: ' + THEME_CFG.bubbleBg + '; color: ' + THEME_CFG.bubbleColor + ';',
          '  border: 1.5px solid ' + THEME_CFG.bubbleBorder + ';',
          '  padding: 4px 10px; border-radius: 14px; font-size: 11px; font-weight: 700;',
          '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
          '  white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,0.18);',
          '  pointer-events: none; opacity: 0; transform: translateX(-50%) translateY(4px);',
          '  transition: opacity 0.22s ease, transform 0.22s ease;',
          '}',
          '.doraemon-speech-bubble.active { opacity: 1; transform: translateX(-50%) translateY(0); }',
          '.d-ripple {',
          '  position: fixed; width: 44px; height: 44px; border-radius: 50%;',
          '  border: 3px solid ' + THEME_CFG.primary + '; pointer-events: none;',
          '  transform: translate(-50%, -50%) scale(0.2);',
          '  opacity: 1; animation: dRipplePop 0.65s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;',
          '  z-index: 2147483646;',
          '}',
          '@keyframes dRipplePop {',
          '  0% { transform: translate(-50%, -50%) scale(0.2); opacity: 1; }',
          '  100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }',
          '}'
        ].join('\\n');
        document.head.appendChild(style);
      }

      let cursor = document.getElementById('__ai_hub_doraemon_cursor');
      if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = '__ai_hub_doraemon_cursor';
        cursor.className = 'doraemon-cursor-wrap';
        cursor.innerHTML = [
          '<div id=\"__doraemon_bubble\" class=\"doraemon-speech-bubble\"></div>',
          '<img id=\"__doraemon_img\" class=\"doraemon-meme-img\" src=\"' + MEME_DATA.eat + '\" alt=\"' + THEME_CFG.name + '\" />'
        ].join('');
        root.appendChild(cursor);

        window.__ai_hub_doraemon_state = {
          posX: window.innerWidth / 2,
          posY: window.innerHeight / 2,
          lastMoveTime: Date.now(),
          currentAction: 'idle',
          turnLeft: false
        };

        const updatePos = (x, y) => {
          const s = window.__ai_hub_doraemon_state;
          const dx = x - s.posX;
          if (Math.abs(dx) > 10) {
            s.turnLeft = dx < 0;
            const img = document.getElementById('__doraemon_img');
            if (img) {
              if (s.turnLeft) img.classList.add('doraemon-turn-left');
              else img.classList.remove('doraemon-turn-left');
            }
          }
          s.posX = x; s.posY = y;
          cursor.style.left = x + 'px';
          cursor.style.top = y + 'px';
        };

        window.addEventListener('mousemove', (e) => {
          updatePos(e.clientX, e.clientY);
          const s = window.__ai_hub_doraemon_state;
          s.lastMoveTime = Date.now();
          if (s.currentAction !== 'run' && s.currentAction !== 'inspect' && s.currentAction !== 'click') {
            s.currentAction = 'run';
            const img = document.getElementById('__doraemon_img');
            if (img && img.src !== MEME_DATA.run) img.src = MEME_DATA.run;
            const b = document.getElementById('__doraemon_bubble');
            if (b) {
              b.textContent = THEME_CFG.actionText.run;
              b.classList.add('active');
            }
          }
        }, { passive: true });

        setInterval(() => {
          const s = window.__ai_hub_doraemon_state;
          if (!s) return;
          const idleTime = Date.now() - s.lastMoveTime;
          if (idleTime > 1200 && s.currentAction === 'run') {
            s.currentAction = 'idle';
            const img = document.getElementById('__doraemon_img');
            const b = document.getElementById('__doraemon_bubble');
            if (img) img.src = MEME_DATA.eat;
            if (b) {
              b.textContent = THEME_CFG.actionText.idle;
              b.classList.add('active');
              setTimeout(() => { if (s.currentAction === 'idle') b.classList.remove('active'); }, 2500);
            }
          }
        }, 600);
      }

      let tx = window.__ai_hub_doraemon_state ? window.__ai_hub_doraemon_state.posX : (window.innerWidth / 2);
      let ty = window.__ai_hub_doraemon_state ? window.__ai_hub_doraemon_state.posY : (window.innerHeight / 2);

      const targetEl = arguments[0] ? document.querySelector('[data-devtools-uid=\"' + arguments[0] + '\"]') : null;
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        tx = rect.left + rect.width / 2;
        ty = rect.top + rect.height / 2;
      }

      cursor.style.left = tx + 'px';
      cursor.style.top = ty + 'px';
      if (window.__ai_hub_doraemon_state) {
        window.__ai_hub_doraemon_state.posX = tx;
        window.__ai_hub_doraemon_state.posY = ty;
        window.__ai_hub_doraemon_state.lastMoveTime = Date.now();
      }

      const img = document.getElementById('__doraemon_img');
      const b = document.getElementById('__doraemon_bubble');
      const act = '\${action}';

      if (act === 'click') {
        const rip = document.createElement('div');
        rip.className = 'd-ripple';
        rip.style.left = tx + 'px';
        rip.style.top = ty + 'px';
        document.body.appendChild(rip);
        setTimeout(() => rip.remove(), 700);
        if (img) img.src = MEME_DATA.click || MEME_DATA.dance;
        if (b) {
          b.textContent = '\${customText} ' + THEME_CFG.actionText.click;
          b.classList.add('active');
          setTimeout(() => b.classList.remove('active'), 2500);
        }
      } else if (act === 'inspect') {
        if (img) img.src = MEME_DATA.inspect;
        if (b) {
          b.textContent = '\${customText} ' + THEME_CFG.actionText.inspect;
          b.classList.add('active');
        }
      } else if (act === 'typing') {
        if (img) img.src = MEME_DATA.run;
        if (b) {
          b.textContent = '\${customText} ' + THEME_CFG.actionText.typing;
          b.classList.add('active');
          setTimeout(() => b.classList.remove('active'), 2500);
        }
      } else if (act === 'nav') {
        if (img) img.src = MEME_DATA.fly;
        if (b) {
          b.textContent = '\${customText} ' + THEME_CFG.actionText.nav;
          b.classList.add('active');
          setTimeout(() => b.classList.remove('active'), 3000);
        }
      } else if (act === 'wave') {
        if (img) img.src = MEME_DATA.wave;
        if (b) {
          b.textContent = THEME_CFG.actionText.wave;
          b.classList.add('active');
          setTimeout(() => b.classList.remove('active'), 2500);
        }
      }
    } catch (e) {}
  })();\`;

  return {
    function: fnSource,
    args: targetUid ? [String(targetUid)] : [],
    pageId: args.pageId ?? undefined
  };
}

module.exports = {
  buildDoraemonFeedback,
  getActivePack,
  PACKS,
  THEMES_CONFIG
};
`;

fs.writeFileSync('D:/ai-hub/ai-hub-web/doraemon-cursor.cjs', template, 'utf8');
console.log('Successfully wrote multi-pack doraemon-cursor.cjs with Doraemon and Dragon Ball!');
