'use strict';

const fs = require('fs');
const path = require('path');

const targetDir = 'D:/ai-hub/ai-hub-web/public/stickers';
if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

const list = [
  { name: 'eat_dorayaki.gif', url: 'https://media.tenor.com/n1XOa4zfUOAAAAAM/doraemon-fudgy-pie.gif' },
  { name: 'eat_dorayaki.webp', url: 'https://media.tenor.com/n1XOa4zfUOAAAAA1/doraemon-fudgy-pie.webp' },
  { name: 'run.gif', url: 'https://media.tenor.com/6SKtWG55Cs0AAAAM/doraemon-nobita.gif' },
  { name: 'run.webp', url: 'https://media.tenor.com/6SKtWG55Cs0AAAA1/doraemon-nobita.webp' },
  { name: 'run_manga.gif', url: 'https://media.tenor.com/wunvDDqXXnYAAAAM/doraemon-manga.gif' },
  { name: 'happy_dance.gif', url: 'https://media.tenor.com/egra90T4vG8AAAAM/doraemon.gif' },
  { name: 'happy_jump.webp', url: 'https://media.tenor.com/vtsSzeQwEQ0AAAAm/doraemon-doraemon-jump.webp' },
  { name: 'smile_wave.gif', url: 'https://media.tenor.com/79FnKwO_NN8AAAAM/doraemon-smile.gif' },
  { name: 'hula_hoop.webp', url: 'https://media.tenor.com/jN-mdRIDNaYAAAAm/doraemon-hula-hoop.webp' },
  { name: 'manga_sit.webp', url: 'https://media.tenor.com/DS2DukCkQ6kAAAAm/doraemon-manga.webp' },
  { name: 'eat_marshmallow.gif', url: 'https://media.tenor.com/eDAhS_MSitgAAAAM/mashmellow-doraemon.gif' }
];

async function downloadAll() {
  for (const item of list) {
    try {
      const res = await fetch(item.url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(path.join(targetDir, item.name), buf);
        console.log(`Saved ${item.name} (${buf.length} bytes)`);
      } else {
        console.log(`Failed ${item.name}: ${res.status}`);
      }
    } catch (e) {
      console.error(item.name, e.message);
    }
  }
}

downloadAll();
