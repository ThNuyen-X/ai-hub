'use strict';

const { spawn, execFile } = require('node:child_process');

function launchDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function openLocalPathOnDesktop(target, { isDir = false, isTextSource = false, reveal = false } = {}) {
  if (process.platform === 'win32') {
    if (isDir) return launchDetached('explorer.exe', [target]);
    if (reveal) return launchDetached('explorer.exe', ['/select,', target]);
    if (isTextSource) return launchDetached('notepad.exe', [target]);
    if (/\.(exe|bat|cmd|msi|ps1)$/i.test(target)) {
      return launchDetached('explorer.exe', ['/select,', target]);
    }

    // Avoid cmd.exe parsing spaces, ampersands and percent signs in file names.
    const literal = "'" + target.replace(/'/g, "''") + "'";
    const script = '$ErrorActionPreference = "Stop"; try { Invoke-Item -LiteralPath ' + literal
      + ' -ErrorAction Stop } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }';
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).trim()));
        else resolve();
      });
    });
  }
  return launchDetached(process.platform === 'darwin' ? 'open' : 'xdg-open', [target]);
}

module.exports = { openLocalPathOnDesktop };
