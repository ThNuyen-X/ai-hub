'use strict';

const fs = require('fs');
const path = require('path');

async function findTransparent() {
  const urls = [
    'https://tenor.com/search/doraemon-sticker',
    'https://tenor.com/search/doraemon-dance-sticker',
    'https://tenor.com/search/doraemon-flying-sticker',
    'https://tenor.com/search/doraemon-happy-sticker'
  ];

  const allUrls = new Set();
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const matches = html.match(/https:\/\/media\.tenor\.com\/[a-zA-Z0-9_\-\/]+AAAAm\/[a-zA-Z0-9_\-]+\.webp/g) || [];
      matches.forEach(m => allUrls.add(m));
    } catch(e) {}
  }

  console.log('Total candidate sticker URLs:', allUrls.size);
  const arr = Array.from(allUrls);
  
  // Download first 20 to test transparency
  const outDir = 'D:/ai-hub/ai-hub-web/public/stickers/candidates';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (let i = 0; i < Math.min(arr.length, 25); i++) {
    const itemUrl = arr[i];
    try {
      const res = await fetch(itemUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const filename = `cand_${i}.webp`;
        fs.writeFileSync(path.join(outDir, filename), buf);
      }
    } catch(e) {}
  }
  console.log('Downloaded 25 candidates for preview.');
}

findTransparent();
