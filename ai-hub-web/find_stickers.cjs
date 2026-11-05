'use strict';

async function main() {
  const urls = [
    'https://tenor.com/search/doraemon-stickers',
    'https://tenor.com/search/doraemon-sticker-gifs',
    'https://tenor.com/search/doraemon-transparent-gifs'
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      const html = await res.text();
      const matches = html.match(/https:\/\/media\.tenor\.com\/[a-zA-Z0-9_\-\/]+\.(gif|webp|png)/g) || [];
      const unique = [...new Set(matches)];
      console.log(url, 'Found:', unique.length);
      if (unique.length > 0) {
        console.log(unique.slice(0, 8));
      }
    } catch (e) {
      console.error(url, e.message);
    }
  }
}

main();
