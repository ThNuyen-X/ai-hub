const { execSync } = require('child_process');
const ps = `powershell -NoProfile -Sta -Command "[void][System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms'); $f = New-Object Windows.Forms.FolderBrowserDialog; $f.ShowNewFolderButton = $true; if($f.ShowDialog() -eq 'OK'){ Write-Output $f.SelectedPath }"`;
console.log('PS Command:', ps);
try {
  const res = execSync(ps, { encoding: 'utf8', timeout: 5000 });
  console.log('Result:', res);
} catch (e) {
  console.log('Err:', e.message);
}
