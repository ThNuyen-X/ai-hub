'use strict';

const fs = require('fs');
const path = require('path');

const candDir = 'D:/ai-hub/ai-hub-web/public/stickers/candidates';

function toDataUri(filename) {
  const p = path.join(candDir, filename);
  const buf = fs.readFileSync(p);
  return 'data:image/webp;base64,' + buf.toString('base64');
}

const MEMES = {
  eat: toDataUri('cand_4.webp'),        // Doraemon ăn bánh rán
  run: toDataUri('cand_7.webp'),        // Doraemon chạy lon ton
  inspect: toDataUri('cand_12.webp'),   // Doraemon chống cằm ngắm nghía soi trang
  wave: toDataUri('cand_1.webp'),       // Doraemon vẫy tay chào
  click: toDataUri('cand_8.webp'),      // Doraemon nhảy múa vui nhộn khi click
  dance: toDataUri('cand_11.webp'),     // Doraemon lắc vòng hula hoop
  fly: toDataUri('cand_3.webp')         // Doraemon bay chong chóng tre
};

console.log('Encoded all 7 authentic animated memes to Base64:');
for (const [k, v] of Object.entries(MEMES)) {
  console.log(`- ${k}: ${v.length} chars (~${Math.round(v.length * 0.75 / 1024)} KB)`);
}

const template = `'use strict';

/**
 * Doraemon Ultra-Smooth Authentic Animated Meme Cursor (Version 2026.20)
 * 100% Authentic Animated Anime Stickers (Lấy trực tiếp từ Internet):
 * - Ăn bánh rán nhai măm măm cực đáng yêu (Authentic Anime Frame Animation)
 * - Chạy lon ton sải bước siêu mượt mà khi di chuyển chuột
 * - Chống cằm ngắm nghía soi xét nội dung khi hover / inspect
 * - Vẫy tay chào bạn bè thân thiện
 * - Nhảy múa bắn sao lấp lánh & sóng xung kích khi nhấp chuột
 * - Lắc vòng Hula Hoop nhí nhảnh chu mỏ khi nhàn rỗi
 * - Hoàn toàn không nền (100% Transparent), không đơ cứng, siêu mượt mà!
 */

const MEME_DATA = ${JSON.stringify(MEMES)};

function buildDoraemonFeedback(toolName, toolArgs = {}) {
  const normTool = String(toolName || '').replace(/^.*?chrome_devtools(_sso)?[_:]+/, '');
  const pageId = typeof toolArgs.pageId === 'number' ? toolArgs.pageId : undefined;
  let action = '';
  let label = '';
  let uid = toolArgs.uid;

  if (normTool === 'click') {
    action = 'click';
    label = toolArgs.dblClick ? 'Doraemon nhấp đúp xoay vòng! 💫🌀' : 'Doraemon bấm chọn! 🎯✨';
  } else if (normTool === 'hover') {
    action = 'inspect';
    label = 'Doraemon chăm chú ngắm nghía 🔍✨';
  } else if (normTool === 'fill') {
    action = 'fill';
    const val = String(toolArgs.value || '');
    label = val ? 'Gõ: "' + (val.length > 15 ? val.slice(0, 15) + '…' : val) + '" ⌨️🎶' : 'Doraemon gõ phím ⌨️🎶';
  } else if (normTool === 'fill_form') {
    action = 'fill';
    uid = toolArgs.elements?.[0]?.uid;
    label = 'Doraemon điền biểu mẫu 📝✨';
  } else if (normTool === 'drag') {
    action = 'drag';
    uid = toolArgs.from_uid || toolArgs.to_uid;
    label = 'Doraemon gồng mình kéo thả 📦💪';
  } else if (normTool === 'press_key') {
    action = 'press_key';
    label = 'Nhấn: [' + (toolArgs.key || 'Enter') + '] ⌨️⚡';
  } else if (normTool === 'type_text') {
    action = 'fill';
    const text = String(toolArgs.text || '');
    label = text ? 'Gõ: "' + (text.length > 15 ? text.slice(0, 15) + '…' : text) + '" ⌨️🎶' : 'Doraemon gõ phím ⌨️🎶';
  } else if (normTool === 'navigate_page') {
    action = 'navigate';
    const host = toolArgs.url ? String(toolArgs.url).replace(/^https?:\\/\\//, '').split('/')[0] : '';
    label = host ? 'Bay tới: ' + host + ' 🛸💨' : 'Doraemon bay tới trang! 🛸💨';
  } else if (normTool === 'take_snapshot' || normTool === 'take_screenshot') {
    action = 'inspect';
    label = 'Doraemon chăm chú ngắm nghía 🔍✨';
  } else {
    return null;
  }

  const clientCode = \`function(el) {
  try {
    var action = \${JSON.stringify(action)};
    var label = \${JSON.stringify(label)};
    var memes = \${JSON.stringify(MEME_DATA)};
    var doc = document;
    if (!doc || !doc.body) return;

    var overlay = doc.getElementById('__ai_hub_doraemon_overlay');
    // Version check: tự động làm mới sang v2026.20
    if (overlay && overlay.getAttribute('data-v') !== '2026.20') {
      try { overlay.remove(); } catch(e){}
      var oldStyle = doc.getElementById('__ai_hub_doraemon_style');
      if (oldStyle) { try { oldStyle.remove(); } catch(e){} }
      overlay = null;
    }

    if (!overlay) {
      var styleTag = doc.createElement('style');
      styleTag.id = '__ai_hub_doraemon_style';
      styleTag.textContent = [
        '.doraemon-cursor-wrap {',
        '  position: fixed;',
        '  top: 0;',
        '  left: 0;',
        '  pointer-events: none !important;',
        '  z-index: 2147483647;',
        '  transition: transform 0.45s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.3s ease;',
        '  opacity: 1;',
        '  will-change: transform;',
        '}',
        '.doraemon-body-container {',
        '  position: absolute;',
        '  left: -44px;',
        '  top: -48px;',
        '  display: flex;',
        '  align-items: center;',
        '  transition: transform 0.25s ease-out;',
        '}',
        '.doraemon-meme-img {',
        '  width: 88px;',
        '  height: 88px;',
        '  object-fit: contain;',
        '  filter: drop-shadow(0 8px 18px rgba(0,0,0,0.45));',
        '  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);',
        '  image-rendering: auto;',
        '}',
        '.doraemon-turn-left { transform: rotateY(180deg); }',
        '.doraemon-turn-left .doraemon-bubble { transform: rotateY(180deg) translateX(-12px); }',

        /* Sóng xung kích */
        '@keyframes d-ripple { 0% { transform: scale(0.2); opacity: 1; } 100% { transform: scale(3.6); opacity: 0; } }',
        '.doraemon-ripple {',
        '  position: absolute;',
        '  left: -22px;',
        '  top: -22px;',
        '  width: 44px;',
        '  height: 44px;',
        '  border-radius: 50%;',
        '  border: 3.5px solid #00e5ff;',
        '  box-shadow: 0 0 18px #00e5ff, inset 0 0 10px #009fe8;',
        '  pointer-events: none !important;',
        '  animation: d-ripple 0.65s cubic-bezier(0, 0.2, 0.8, 1) forwards;',
        '}',

        /* Bóng thoại hoạt hình */
        '.doraemon-bubble {',
        '  position: absolute;',
        '  left: 70px;',
        '  top: -24px;',
        '  background: #ffffff;',
        '  border: 2.2px solid #009fe8;',
        '  color: #0b4f8a;',
        '  font-family: system-ui, -apple-system, sans-serif;',
        '  font-size: 12px;',
        '  font-weight: 800;',
        '  padding: 5px 12px;',
        '  border-radius: 16px;',
        '  white-space: nowrap;',
        '  box-shadow: 0 6px 16px rgba(0,0,0,0.22);',
        '  pointer-events: none !important;',
        '  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);',
        '  transform-origin: left bottom;',
        '}',
        '.doraemon-bubble::after {',
        '  content: "";',
        '  position: absolute;',
        '  left: -7px;',
        '  bottom: 8px;',
        '  width: 0;',
        '  height: 0;',
        '  border-top: 6px solid transparent;',
        '  border-bottom: 6px solid transparent;',
        '  border-right: 8px solid #009fe8;',
        '}'
      ].join('\\n');
      doc.head.appendChild(styleTag);

      overlay = doc.createElement('div');
      overlay.id = '__ai_hub_doraemon_overlay';
      overlay.setAttribute('data-v', '2026.20');
      overlay.setAttribute('style', 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; overflow: visible;');

      var cursor = doc.createElement('div');
      cursor.className = 'doraemon-cursor-wrap';
      cursor.id = '__ai_hub_doraemon_cursor';

      cursor.innerHTML = [
        '<div id="__ai_hub_doraemon_ripple_slot" style="position:absolute;left:44px;top:48px;"></div>',
        '<div class="doraemon-body-container" id="__ai_hub_doraemon_body_wrap">',
        '  <div class="doraemon-bubble" id="__ai_hub_doraemon_bubble">Doraemon sẵn sàng! 🛸✨</div>',
        '  <img class="doraemon-meme-img" id="__ai_hub_doraemon_img" src="' + memes.eat + '" alt="Doraemon Meme"/>',
        '</div>'
      ].join('\\n');

      overlay.appendChild(cursor);
      doc.body.appendChild(overlay);
    }

    var cursor = doc.getElementById('__ai_hub_doraemon_cursor');
    var bubble = doc.getElementById('__ai_hub_doraemon_bubble');
    var memeImg = doc.getElementById('__ai_hub_doraemon_img');
    var rippleSlot = doc.getElementById('__ai_hub_doraemon_ripple_slot');
    var bodyWrap = doc.getElementById('__ai_hub_doraemon_body_wrap');
    if (!cursor) return;

    if (window.__ai_hub_doraemon_idle_interval) {
      clearInterval(window.__ai_hub_doraemon_idle_interval);
      window.__ai_hub_doraemon_idle_interval = null;
    }
    if (window.__ai_hub_doraemon_timer) {
      clearTimeout(window.__ai_hub_doraemon_timer);
      window.__ai_hub_doraemon_timer = null;
    }

    cursor.style.opacity = '1';

    var targetX = null;
    var targetY = null;
    if (el && typeof el.getBoundingClientRect === 'function') {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } catch(e){}
      var rect = el.getBoundingClientRect();
      targetX = Math.round(rect.left + Math.min(Math.max(rect.width / 2, 8), 40));
      targetY = Math.round(rect.top + Math.min(Math.max(rect.height / 2, 8), 30));
    } else {
      var vw = Math.max(window.innerWidth || 800, 400);
      var vh = Math.max(window.innerHeight || 600, 300);
      targetX = Math.round(vw * 0.45 + (Math.random() * 0.3 - 0.15) * vw);
      targetY = Math.round(vh * 0.35 + (Math.random() * 0.2 - 0.1) * vh);
    }

    if (targetX !== null && targetY !== null) {
      targetX = Math.max(20, Math.min(window.innerWidth - 140, targetX));
      targetY = Math.max(30, Math.min(window.innerHeight - 100, targetY));

      var lastX = typeof window.__ai_hub_doraemon_last_x === 'number' ? window.__ai_hub_doraemon_last_x : targetX;
      var dx = targetX - lastX;
      window.__ai_hub_doraemon_last_x = targetX;
      window.__ai_hub_doraemon_last_y = targetY;

      // Đổi hướng mặt khi chạy sang trái/phải
      if (bodyWrap) {
        if (dx < -6) {
          bodyWrap.classList.add('doraemon-turn-left');
        } else if (dx > 6) {
          bodyWrap.classList.remove('doraemon-turn-left');
        }
      }

      // Khi di chuyển: đổi sang meme chạy lon ton siêu mượt
      if (memeImg && Math.abs(dx) > 10) {
        memeImg.src = memes.run;
      }

      cursor.style.transform = 'translate(' + targetX + 'px, ' + targetY + 'px)';
    }

    if (bubble) bubble.textContent = label || 'Doraemon 🛸';

    // Cử động tương ứng từng hành động
    if (memeImg) {
      if (action === 'click') {
        memeImg.src = memes.click;
        memeImg.style.transform = 'scale(1.2) rotate(-8deg)';
        setTimeout(function() { if (memeImg) memeImg.style.transform = 'none'; }, 500);
      } else if (action === 'inspect') {
        memeImg.src = memes.inspect;
      } else if (action === 'fill') {
        memeImg.src = memes.dance;
      } else if (action === 'navigate') {
        memeImg.src = memes.fly;
      }
    }

    if (action === 'click' && rippleSlot) {
      rippleSlot.innerHTML = '';
      var rip = doc.createElement('div');
      rip.className = 'doraemon-ripple';
      rippleSlot.appendChild(rip);
    }

    // Vòng lặp nhàn rỗi (Living Idle Routine) tự động chuyển cảnh siêu mượt
    window.__ai_hub_doraemon_timer = setTimeout(function() {
      var idleStep = 0;
      var idleActions = [
        { meme: memes.eat, text: 'Măm măm bánh rán nè 🥞😋' },
        { meme: memes.inspect, text: 'Chăm chú ngắm nghía 🔍✨' },
        { meme: memes.wave, text: 'Doraemon chào bạn nha 👋😊' },
        { meme: memes.dance, text: 'Lắc vòng Hula Hoop nhí nhảnh! 🎶' },
        { meme: memes.fly, text: 'Chong chóng tre sẵn sàng! 🛸' }
      ];

      function triggerNextIdle() {
        if (!bodyWrap || !cursor || !memeImg) return;
        var act = idleActions[idleStep % idleActions.length];
        idleStep++;

        memeImg.src = act.meme;
        if (bubble) bubble.textContent = act.text;
        cursor.style.opacity = '0.96';
      }

      triggerNextIdle();
      window.__ai_hub_doraemon_idle_interval = setInterval(triggerNextIdle, 3500);
    }, 1800);

  } catch (e) {}
}\`;

  return {
    function: clientCode,
    args: uid ? [uid] : [],
    waitForStableDom: false,
    ...(pageId !== undefined ? { pageId } : {})
  };
}

module.exports = { buildDoraemonFeedback };
`;

fs.writeFileSync('D:/ai-hub/ai-hub-web/doraemon-cursor.cjs', template, 'utf8');
console.log('Successfully updated D:/ai-hub/ai-hub-web/doraemon-cursor.cjs with Authentic Animated Memes!');
