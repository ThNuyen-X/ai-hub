'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../ai-hub-data/zalo-inbox');
const UPLOADS = path.resolve(__dirname, '../ai-hub-data/uploads');
const { execFile } = require('node:child_process');
const BASE = 'http://127.0.0.1:9223';
let busy = false;
let catalog = new Map();
let catalogTime = 0;
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', e => {
      const r = JSON.parse(e.data), p = this.pending.get(r.id);
      if (!p) return;
      clearTimeout(p.timer); this.pending.delete(r.id);
      if (r.error) p.reject(new Error(r.error.message)); else p.resolve(r.result);
    });
    ws.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Chrome disconnected')); } this.pending.clear(); });
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Chrome operation timed out')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Zalo page operation failed');
    return r.result.value;
  }
  close() { this.ws.close(); }
}
async function connect() {
  const tabs = await fetch(BASE + '/json/list', { signal: AbortSignal.timeout(4000) }).then(r => r.json());
  const tab = tabs.find(t => t.type === 'page' && new URL(t.url).hostname === 'chat.zalo.me');
  if (!tab) throw new Error('Open Zalo Web in the dedicated Chrome (port 9223) and log in first.');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', () => reject(new Error('Cannot connect to Zalo Chrome')), { once: true }); });
  return new CDP(ws);
}
const delay = ms => new Promise(r => setTimeout(r, ms));
function safeName(name) {
  const value = String(name || 'zalo-file').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 160);
  return !value || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? '_' + value : value;
}
function validLink(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
async function list(c, action) {
  if (action === 'mydocs') {
    const alreadyInMyDocs = await c.evaluate(`(() => {const h=document.querySelector('main .header-title, main .chat-title, main [class*="header"]');return !!h&&/My[\\s\\u00a0]+Documents/.test(h.innerText);})()`);
    if (!alreadyInMyDocs) {
      await c.evaluate(`(() => {const i=document.querySelector('#contact-search-input');if(!i)throw Error('Zalo search is unavailable');i.focus();i.select();})()`);
      await c.call('Input.insertText', { text: 'My Documents' });
      await delay(700);
      await c.evaluate(`(() => {const e=document.querySelector('[data-translate-inner="KEY_NAME_SEND2ME"]') || Array.from(document.querySelectorAll('.txt-highlight')).filter(e=>e.innerText?.trim()==='Documents').find(e=>e.getClientRects().length);if(!e)throw Error('My Documents was not found. Open it in Zalo first.');e.click();})()`);
      await delay(1000);
      const opened = await c.evaluate(`(() => {const h=document.querySelector('main .header-title, main .chat-title, main [class*="header"]');return !!h&&/My[\\s\\u00a0]+Documents/.test(h.innerText);})()`);
      if (!opened) throw new Error('Cannot verify My Documents. Open it in Zalo, then use File / Folder.');
    }
    action = 'overview';
  }
  if (['overview', 'files', 'links', 'media'].includes(action)) {
    if (action === 'overview') {
      await c.evaluate(`(() => {
        const back = document.querySelector('[data-id="btn_MutualGrp_Back"]');
        if (back) back.click();
        else if (!document.querySelector('.chat-info__header')) document.querySelector('[data-translate-title="STR_CONVERSATION_INFO"]')?.click();
      })()`);
      await delay(900);
    } else {
      const tabMap = { files: 'div_MediaStore_FileTab', media: 'div_MediaStore_MediaTab', links: 'div_MediaStore_LinkTab' };
      const sectionMap = { files: 'info-files-container', links: 'info-links-container' };
      await c.evaluate(`(() => {
        const tab = document.querySelector(${JSON.stringify(`[data-id="${tabMap[action]}"]`)});
        if (tab) { tab.click(); return; }
        const section = ${JSON.stringify(action === 'media')} ? document.querySelector('[data-id="div_MediaStore_MediaList"]')?.parentElement : document.getElementById(${JSON.stringify(sectionMap[action] || '')});
        if (!section) document.querySelector('[data-translate-title="STR_CONVERSATION_INFO"]')?.click();
      })()`);
      await delay(650);
      await c.evaluate(`(() => {
        const tab = document.querySelector(${JSON.stringify(`[data-id="${tabMap[action]}"]`)});
        if (tab) { tab.click(); return; }
        const section = ${JSON.stringify(action === 'media')} ? document.querySelector('[data-id="div_MediaStore_MediaList"]')?.parentElement : document.getElementById(${JSON.stringify(sectionMap[action] || '')});
        section?.querySelector('[data-translate-inner="STR_VIEW_ALL"]')?.click();
      })()`);
      await delay(650);
    }
  }
  if (action === 'more') {
    await c.evaluate(`(() => {const scope=document.querySelector('#info-files-container');const b=scope && Array.from(scope.querySelectorAll('button,div,span')).find(e=>e.children.length===0&&/^(Tải thêm|Load more)$/.test(e.innerText.trim()));if(b)b.click();})()`);
    await delay(600);
  }
  const hasPanel = await c.evaluate(`!!(document.querySelector('#info-files-container') || document.querySelector('#info-links-container') || document.querySelector('[data-id="div_MediaStore_MediaTab"]'))`);
  if (!hasPanel) throw new Error('Zalo storage panel is not ready. Open conversation info, then refresh.');
  const items = await c.evaluate(`(() => {
    if(location.hostname!=='chat.zalo.me'||!document.querySelector('main'))throw Error('Log in to Zalo Web and open My Documents first.');
    window.__aiHubZaloItems ||= new Map(); const out=[];
    const add=(el,kind,name,extra={})=>{const id=crypto.randomUUID();window.__aiHubZaloItems.set(id,el);out.push({id,kind,name,...extra});};
    const scope=document.querySelector('#info-files-container');
    for(const e of document.querySelectorAll('.cb-info-file-item')) {const n=e.querySelector('.cb-info-file-item__file-name');if(!n)continue;const folder=e.matches('.cb-info-file-item--folder,[data-type="folder"]')||!!e.querySelector('[id*="icon-folder"],.file-icon-folder');add(e,folder?'folder':'file',n.getAttribute('title')||n.innerText,{size:e.querySelector('.cb-info-file-item__file-size')?.innerText||'',date:e.querySelector('.cb-info-file-item__send-date')?.innerText.trim()||''});}
    const seenMedia=new Set();
    for(const [index,e] of Array.from(document.querySelectorAll('[data-id="div_MediaStore_MediaItem"],.media-store-preview-item')).entries()){const video=!!e.querySelector('video,[class*="video"],[class*="play"]')||e.className.includes('video');const key=e.querySelector('[id]')?.id||String(index+1);if(seenMedia.has(key))continue;seenMedia.add(key);add(e,video?'video':'image',(video?'Video ':'Image ')+key,{date:e.getAttribute('title')||''});}
    const seen=new Set();
    for(const title of document.querySelectorAll('.chat-info-link__title')){const e=title.closest('.chat-info-link')||title.parentElement;const raw=(title.getAttribute('title')||title.innerText||'').trim();if(!raw||seen.has(raw))continue;seen.add(raw);add(e,'link',raw,{domain:e?.querySelector('.chat-info-link__subtitle')?.innerText||''});}
    return {conversation:document.querySelector('main [class*="header"] [class*="title"]')?.innerText||'',items:out,hasMore:!!(scope&&/Tải thêm|Load more/.test(scope.innerText)),notice:'Only items available in the open Zalo conversation are listed. Use Zalo to change conversations or folders.'};
  })()`);
  for (const item of items.items) {
    if (item.kind === 'link' && !item.url) item.url = validLink(item.name);
  }
  for (const item of items.items) catalog.set(item.id, item);
  while (catalog.size > 2000) catalog.delete(catalog.keys().next().value);
  catalogTime = Date.now();
  return { ...items, inbox: ROOT };
}
async function download(c, item) {
  const dir = path.join(ROOT, crypto.randomUUID());
  await fs.promises.mkdir(dir, { recursive: true });
  if (['image', 'video'].includes(item.kind)) {
    await c.evaluate(`(() => {const e=window.__aiHubZaloItems?.get(${JSON.stringify(item.id)});if(!e?.isConnected)throw Error('Media reference expired; select it again');(e.querySelector('.img-center-box')||e).click();})()`);
    await delay(700);
  }
  // Zalo uses the File System Access picker; capture only this selected save operation.
  await c.call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  await c.evaluate(`(() => {
    const el=window.__aiHubZaloItems?.get(${JSON.stringify(item.id)});if(!el||!el.isConnected)throw Error('List changed; refresh first.');
    const media=${JSON.stringify(['image', 'video'].includes(item.kind))};
    const b=media?document.querySelector('[data-translate-title="STR_SAVE_PHOTO_AS"], [data-translate-title="STR_SAVE_VIDEO_AS"]'):el.querySelector('[icon="icon-solid-download"]');if(!b)throw Error('This item has no download button.');
    if(window.__aiHubZaloSave)throw Error('A Zalo save is already running.');
    const state={original:window.showSaveFilePicker,chunks:[],done:false};window.__aiHubZaloSave=state;
    window.showSaveFilePicker=async()=>({kind:'file',name:${JSON.stringify(safeName(item.name))},createWritable:async()=>({write:async data=>{if(data&&data.type==='write')data=data.data;const blob=new Blob([data]);if((state.size||0)+blob.size>104857600)throw Error('Maximum file size is 100 MB');state.size=(state.size||0)+blob.size;state.chunks.push(blob);},close:async()=>{state.blob=new Blob(state.chunks);state.chunks=[];state.done=true;},abort:async()=>{state.error='Save aborted';}})});
    b.click();return true;
  })()`);
  try {
    for (let n = 0; n < 120; n++) {
      await delay(500);
      const status = await c.evaluate(`(() => {const s=window.__aiHubZaloSave;return {done:!!s?.done,size:s?.blob?.size||0,error:s?.error};})()`);
      if (status.error) throw new Error(status.error);
      if (status.done) {
        if (!status.size || status.size > 104857600) throw new Error('Empty file or file exceeds 100 MB');
        const dest = path.join(dir, safeName(item.name)), partial = dest + '.part';
        const handle = await fs.promises.open(partial, 'wx');
        try {
          for (let offset = 0; offset < status.size; offset += 262144) {
            const data = await c.evaluate(`(async()=>{const b=window.__aiHubZaloSave.blob.slice(${offset},${offset + 262144});return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(Error('Cannot read selected file'));r.readAsDataURL(b);});})()`);
            await handle.write(Buffer.from(data, 'base64'));
          }
        } finally { await handle.close(); }
        await fs.promises.rename(partial, dest);
        return { path: dest, bytes: status.size };
      }
      const names = await fs.promises.readdir(dir);
      const completed = names.find(name => !/\.(crdownload|tmp|part)$/i.test(name));
      if (completed) { const dest = path.join(dir, completed); const stat = await fs.promises.stat(dest); if (stat.isFile() && stat.size) return { path: dest, bytes: stat.size }; }
    }
    throw new Error('Download timed out. The file may have expired or Zalo may require confirmation.');
  } finally {
    await c.evaluate(`(() => {const s=window.__aiHubZaloSave;if(s){window.showSaveFilePicker=s.original;delete window.__aiHubZaloSave;}})()`).catch(() => {});
    await c.call('Page.setDownloadBehavior', { behavior: 'default' }).catch(() => {});
  }
}
async function operate(data) {
  if (busy) throw new Error('Zalo is busy. Wait for the current operation.');
  busy = true; let c;
  try {
    if(data.action==='select') return await saveSelection(data.ids);
    if(data.action==='describe') return await readSelection(data.ref);
    c = await connect();
    if (['list', 'overview', 'files', 'links', 'media', 'more', 'mydocs'].includes(data.action)) return await list(c, data.action);
    const item = catalog.get(data.id);
    if (!item || Date.now() - catalogTime > 10 * 60 * 1000) throw new Error('Selection expired. Refresh the list.');
    if (data.action === 'download' && ['file', 'image', 'video'].includes(item.kind)) return await download(c, item);
    if (data.action === 'open' && item.kind === 'link') {
      if (!item.url) {
        await c.evaluate(`(() => {const e=window.__aiHubZaloItems?.get(${JSON.stringify(item.id)});if(!e?.isConnected)throw Error('Refresh the list');const t=e.querySelector('.chat-info-link__title');if(!t)throw Error('Link unavailable');t.click();})()`);
        return { opened: true };
      }
      const url = validLink(item.url); if (!url) throw new Error('Only HTTP/HTTPS links are allowed');
      await c.call('Target.createTarget', { url }); return { url };
    }
    if (data.action === 'folder' && item.kind === 'folder') {
      await c.evaluate(`(() => {const e=window.__aiHubZaloItems?.get(${JSON.stringify(item.id)});if(!e?.isConnected)throw Error('Refresh the list');e.click();})()`);
      await delay(400); return await list(c, 'list');
    }
    throw new Error('Unsupported Zalo operation');
  } finally { if (c) c.close(); busy = false; }
}
const REFS = path.resolve(ROOT, '../zalo-selections');
async function saveSelection(ids) {
  if(!Array.isArray(ids)||!ids.length||ids.length>50)throw Error('Select between 1 and 50 items');
  const items=ids.map(id=>{const x=catalog.get(id);if(!x)throw Error('List changed; refresh first');return {...x};});
  const ref=crypto.randomUUID();
  await fs.promises.mkdir(REFS,{recursive:true});
  await fs.promises.writeFile(path.join(REFS,ref+'.json'),JSON.stringify({ref,created:new Date().toISOString(),items},null,2),{flag:'wx'});
  return {ref,items,manifest:path.join(REFS,ref+'.json')};
}
async function readSelection(ref) {
  if(!/^[a-f0-9-]{36}$/.test(ref||''))throw Error('Invalid selection reference');
  return JSON.parse(await fs.promises.readFile(path.join(REFS,ref+'.json'),'utf8'));
}
function readWindowsClipboardFiles() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise(resolve => {
    execFile('powershell.exe', [
      '-NoProfile', '-Sta', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; if([System.Windows.Forms.Clipboard]::ContainsFileDropList()){[System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { Write-Output $_ }}'
    ], { timeout: 3500, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const paths = String(stdout).split(/\r?\n/).map(s => s.trim()).filter(p => p && fs.existsSync(p));
      resolve(paths.map(p => {
        const stat = fs.statSync(p);
        return { path: p, name: path.basename(p), isDirectory: stat.isDirectory(), size: stat.isDirectory() ? 0 : stat.size };
      }));
    });
  });
}
async function saveUploadedFile(name, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Empty upload file');
  if (buffer.length > 50 * 1024 * 1024) throw new Error('Maximum upload size is 50 MB');
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(UPLOADS, day, crypto.randomUUID().slice(0, 8));
  await fs.promises.mkdir(dir, { recursive: true });
  const clean = safeName(name || 'uploaded-file');
  const dest = path.join(dir, clean);
  await fs.promises.writeFile(dest, buffer, { flag: 'wx' });
  return { path: dest, name: clean, bytes: buffer.length };
}
function handle(req, res) {
  const pathname = (req.url || '').split('?')[0];
  if (pathname !== '/api/zalo-source' && pathname !== '/api/attach-upload' && pathname !== '/api/clipboard-files') return false;
  const reply = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (req.method !== 'POST') { reply(405, { error: 'POST required' }); return true; }
  if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host && req.headers.origin !== 'https://' + req.headers.host) { reply(403, { error: 'Invalid origin' }); return true; }
  if (pathname === '/api/clipboard-files') {
    readWindowsClipboardFiles().then(files => reply(200, { ok: true, files })).catch(e => reply(400, { error: e.message }));
    return true;
  }
  if (pathname === '/api/attach-upload') {
    const rawName = decodeURIComponent(req.headers['x-file-name'] || 'upload.bin');
    const chunks = []; let total = 0, tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > 50 * 1024 * 1024) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      try {
        if (tooLarge) throw new Error('Maximum upload size is 50 MB');
        const saved = await saveUploadedFile(rawName, Buffer.concat(chunks));
        reply(200, { ok: true, file: saved });
      } catch (e) { reply(400, { error: e.message }); }
    });
    return true;
  }
  let body = '', large = false;
  req.on('data', chunk => { if (large) return; body += chunk; if (body.length > 4096) { large = true; body = ''; } });
  req.on('end', async () => { try { if (large) throw new Error('Request too large'); reply(200, { ok: true, ...await operate(JSON.parse(body)) }); } catch (e) { reply(400, { error: e.message }); } });
  return true;
}
module.exports = { handle, operate, safeName, validLink, ROOT, UPLOADS, readSelection, saveUploadedFile, readWindowsClipboardFiles };
if(require.main===module){
  const [action,ref,index]=process.argv.slice(2);
  (async()=>{
    const selected=await readSelection(ref);
    if(action==='describe'){console.log(JSON.stringify(selected,null,2));return;}
    const item=selected.items[Number(index)];if(!item)throw Error('Invalid item index');
    if(!['download','open'].includes(action))throw Error('Use describe REF or download/open REF INDEX');
    // Ask the running server to use its current catalog and browser connection.
    const response=await fetch('http://127.0.0.1:20130/api/zalo-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:item.id})});
    const result=await response.json();if(!response.ok)throw Error(result.error);console.log(JSON.stringify(result));
  })().catch(e=>{console.error(e.message);process.exitCode=1;});
}
