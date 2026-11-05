'use strict';

const fs = require('fs');
const path = require('path');

const targetDir = 'D:/ai-hub/ai-hub-web/public/stickers';
if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

async function searchKeywords() {
  const queries = [
    'doraemon-eating-dorayaki-sticker',
    'doraemon-eating-sticker',
    'doraemon-dorayaki-sticker',
    'doraemon-running-sticker',
    'doraemon-wave-sticker',
    'doraemon-dance-sticker',
    'doraemon-flying-copter-sticker',
    'doraemon-search-sticker'
  ];

  const results = {};

  for (const q of queries) {
    try {
      const url = `https://tenor.com/search/${q}-gifs`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const html = await res.text();
      // Match all animated media
      const matches = html.match(/https:\/\/media\.tenor\.com\/[a-zA-Z0-9_\-\/]+\.(gif|webp)/g) || [];
      const unique = [...new Set(matches)];
      results[q] = unique.slice(0, 5);
      console.log(`Query "${q}": found ${unique.length} stickers`);
    } catch (e) {
      console.error(q, e.message);
    }
  }

  fs.writeFileSync('D:/ai-hub/ai-hub-web/public/stickers_found.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Saved stickers_found.json');
}

searchKeywords();
