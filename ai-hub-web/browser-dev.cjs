'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEV_PORT = 9223;
const DEV_ENDPOINT = `http://127.0.0.1:${DEV_PORT}`;
const DEV_PROFILE = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'ai-hub', 'chrome-dev-profile');

function findChromeBinary() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

function devEndpoint() {
  return DEV_ENDPOINT;
}

async function isDevRunning(timeoutMs = 1200) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${DEV_ENDPOINT}/json/version`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.Browser);
  } catch {
    return false;
  }
}

async function ensureDevChrome() {
  if (await isDevRunning(800)) return DEV_ENDPOINT;

  const chromeBin = findChromeBinary();
  if (!chromeBin) {
    throw new Error('Google Chrome binary not found for dedicated Dev mode.');
  }

  fs.mkdirSync(DEV_PROFILE, { recursive: true });

  const child = spawn(chromeBin, [
    `--remote-debugging-port=${DEV_PORT}`,
    `--user-data-dir=${DEV_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check'
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 150));
    if (await isDevRunning(500)) return DEV_ENDPOINT;
  }

  throw new Error(`Chrome Dev failed to start on port ${DEV_PORT} within deadline.`);
}

module.exports = {
  DEV_PORT,
  devEndpoint,
  isDevRunning,
  ensureDevChrome,
  findChromeBinary
};
