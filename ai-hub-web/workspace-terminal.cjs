'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

function normalizeWorkspaceRoot(workspaceRoot) {
  const raw = String(workspaceRoot || '').trim();
  if (!raw) return '';
  let resolved = path.resolve(raw);
  if (process.platform === 'win32') {
    resolved = resolved.replace(/[\\/]+$/, (m, offset) => (offset <= 2 ? '\\' : ''));
  } else if (resolved.length > 1) {
    resolved = resolved.replace(/\/+$/, '');
  }
  return resolved;
}

function computeWindowName(workspaceRoot) {
  const normalized = normalizeWorkspaceRoot(workspaceRoot);
  if (!normalized) throw new Error('workspace root is required');
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 12);
  return 'ai-hub-ws-' + hash;
}

function escapeForWtArg(arg) {
  // Windows Terminal uses ';' as a command separator unless escaped as '\;'.
  return String(arg).replace(/;/g, '\\;');
}

function quoteWinArg(value) {
  const s = String(value || '');
  if (!s) return '""';
  if (!/[\s"&<>|^()]/.test(s)) return s;
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

function wrapCommandAutoClose(command, { keepOnError = false } = {}) {
  const trimmed = String(command || '').trim();
  if (!trimmed) throw new Error('command is required');
  if (keepOnError) return trimmed;
  // Unconditional `& exit 0` ensures cmd.exe exits with code 0 when the child
  // service exits or is terminated, so Windows Terminal's default
  // closeOnExit:"graceful" closes the tab automatically instead of leaving a dead tab.
  return trimmed + ' & exit 0';
}

function buildWtLaunchArgs({ workspaceRoot, title, cwd, command, keepOnError = false }) {
  const windowName = computeWindowName(workspaceRoot);
  const workDir = normalizeWorkspaceRoot(cwd || workspaceRoot);
  const tabTitle = String(title || '').trim() || path.basename(workDir) || 'service';
  const wrapped = wrapCommandAutoClose(command, { keepOnError });
  return [
    '-w', windowName,
    'new-tab',
    '--title', quoteWinArg(escapeForWtArg(tabTitle)),
    '-d', quoteWinArg(workDir),
    'cmd.exe', '/d', '/s', '/c', '"' + escapeForWtArg(wrapped) + '"'
  ];
}

function isDeadTabBuffer(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  const tail = lines.slice(-4).join('\n');
  return /\[process exited with code /i.test(tail)
    && /(You can now close this terminal|press Enter to restart)/i.test(tail);
}

function buildCleanupPowerShellScript({ workspaceRoot = '', all = false, dryRun = false } = {}) {
  const wsLiteral = normalizeWorkspaceRoot(workspaceRoot).replace(/'/g, "''");
  const allFlag = all ? '$true' : '$false';
  const dryFlag = dryRun ? '$true' : '$false';
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$workspace = '${wsLiteral}'
$workspaceLower = $workspace.ToLowerInvariant()
$cleanAll = ${allFlag}
$dryRun = ${dryFlag}

$allProcs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$wtProcs = @($allProcs | Where-Object { $_.Name -eq 'WindowsTerminal.exe' })
$closedIdleShells = 0
$closedDeadTabs = 0
$remainingTabs = 0
$windowsScanned = 0

if ($wtProcs.Count -eq 0) {
  [PSCustomObject]@{
    ok = $true
    closedIdleShells = 0
    closedDeadTabs = 0
    remainingTabs = 0
    windowsScanned = 0
  } | ConvertTo-Json -Compress
  exit 0
}

# Step 1: Close idle legacy shell tabs (cmd /k or powershell -NoExit with 0 child processes)
# strictly scoped to the target workspace path.
if ($workspaceLower -ne '') {
  $wtPids = @($wtProcs | ForEach-Object { [int]$_.ProcessId })
  foreach ($p in $allProcs) {
    if ($wtPids -notcontains [int]$p.ParentProcessId) { continue }
    if ($p.Name -notin @('cmd.exe', 'powershell.exe', 'pwsh.exe')) { continue }
    $cmdLine = [string]$p.CommandLine
    if (-not $cmdLine) { continue }
    $isStickyShell = ($cmdLine -match '(?i)(^|\s)/k(\s|$)') -or ($cmdLine -match '(?i)(^|\s)-NoExit(\s|$)')
    if (-not $isStickyShell) { continue }
    if ($cmdLine.ToLowerInvariant().IndexOf($workspaceLower) -lt 0) { continue }
    $kids = @($allProcs | Where-Object { [int]$_.ParentProcessId -eq [int]$p.ProcessId })
    if ($kids.Count -eq 0) {
      if (-not $dryRun) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
      $closedIdleShells++
    }
  }
  if ($closedIdleShells -gt 0 -and -not $dryRun) {
    Start-Sleep -Milliseconds 350
  }
}

# Refresh process snapshot after idle-shell cleanup
$allProcs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$wtPidsWithWorkspaceChild = @{}
if ($workspaceLower -ne '') {
  foreach ($p in $allProcs) {
    $cl = [string]$p.CommandLine
    if ($cl -and $cl.ToLowerInvariant().IndexOf($workspaceLower) -ge 0) {
      $curr = $p
      for ($depth = 0; $depth -lt 8 -and $curr; $depth++) {
        if ($curr.Name -eq 'WindowsTerminal.exe') {
          $wtPidsWithWorkspaceChild[[int]$curr.ProcessId] = $true
          break
        }
        $parentId = [int]$curr.ParentProcessId
        if ($parentId -le 0) { break }
        $curr = $allProcs | Where-Object { [int]$_.ProcessId -eq $parentId } | Select-Object -First 1
      }
    }
  }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$tabCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::TabItem
)
$tcCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty,
  'TermControl'
)
$closeBtnCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  'CloseButton'
)

function Test-DeadTabText([string]$txt) {
  if (-not $txt) { return $false }
  $lines = @($txt -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
  if ($lines.Count -eq 0) { return $false }
  $tail = ($lines | Select-Object -Last 4) -join [Environment]::NewLine
  return ($tail -match '\[process exited with code ') -and ($tail -match '(You can now close this terminal|press Enter to restart)')
}

function Get-ActiveTermText($win) {
  $tc = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $tcCond)
  if (-not $tc) { return '' }
  $tp = $null
  if ($tc.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
    try { return $tp.DocumentRange.GetText(-1) } catch { return '' }
  }
  return ''
}

foreach ($wtProc in $wtProcs) {
  $pidCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    [int]$wtProc.ProcessId
  )
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCond)
  if (-not $wins -or $wins.Count -eq 0) { continue }

  foreach ($w in $wins) {
    $tabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
    if (-not $tabs -or $tabs.Count -eq 0) { continue }

    $origTab = $null
    $origTabIndex = -1
    for ($i = 0; $i -lt $tabs.Count; $i++) {
      $sip = $null
      if ($tabs[$i].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sip) -and $sip.Current.IsSelected) {
        $origTab = $tabs[$i]
        $origTabIndex = $i
        break
      }
    }

    # Determine if this window is in scope when not --all
    $windowInScope = $cleanAll
    if (-not $windowInScope -and $workspaceLower -ne '') {
      if ($wins.Count -eq 1 -and $wtPidsWithWorkspaceChild.ContainsKey([int]$wtProc.ProcessId)) {
        $windowInScope = $true
      }
    }

    $deadIndices = [System.Collections.Generic.List[int]]::new()
    $matchedWorkspaceInTabs = $false
    for ($i = 0; $i -lt $tabs.Count; $i++) {
      $tab = $tabs[$i]
      $sip = $null
      if (-not $tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sip)) { continue }
      try {
        $sip.Select()
        for ($wait = 0; $wait -lt 8; $wait++) {
          if ($sip.Current.IsSelected) { break }
          Start-Sleep -Milliseconds 30
        }
        Start-Sleep -Milliseconds 70
        $txt = Get-ActiveTermText $w
        if ($workspaceLower -ne '' -and $txt -and $txt.ToLowerInvariant().IndexOf($workspaceLower) -ge 0) {
          $matchedWorkspaceInTabs = $true
        }
        if (Test-DeadTabText $txt) {
          [void]$deadIndices.Add($i)
        }
      } catch {}
    }

    if (-not $windowInScope -and $matchedWorkspaceInTabs) {
      $windowInScope = $true
    }

    if (-not $windowInScope) {
      if ($origTab) {
        try { $origTab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() } catch {}
      }
      continue
    }

    $windowsScanned++

    if ($deadIndices.Count -gt 0 -and -not $dryRun) {
      # Close dead tabs from highest index to lowest so lower indices stay intact.
      for ($k = $deadIndices.Count - 1; $k -ge 0; $k--) {
        $idx = $deadIndices[$k]
        try {
          $currentTabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
          if ($idx -lt 0 -or $idx -ge $currentTabs.Count) { continue }
          $target = $currentTabs[$idx]
          $sip = $null
          if ($target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sip)) {
            $sip.Select()
            Start-Sleep -Milliseconds 70
            # Re-verify before closing so a live tab is never closed even if tab order shifted.
            $txt = Get-ActiveTermText $w
            if (-not (Test-DeadTabText $txt)) { continue }
          }
          $btn = $target.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $closeBtnCond)
          if ($btn) {
            $inv = $null
            if ($btn.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$inv)) {
              $inv.Invoke()
              $closedDeadTabs++
              Start-Sleep -Milliseconds 100
            }
          }
        } catch {}
      }
    } elseif ($dryRun) {
      $closedDeadTabs += $deadIndices.Count
    }

    # Restore original tab if it is still alive and was not closed
    if (-not $dryRun -and $origTabIndex -ge 0 -and (-not $deadIndices.Contains($origTabIndex))) {
      try {
        $origTab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
      } catch {}
    } elseif ($dryRun -and $origTab) {
      try {
        $origTab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
      } catch {}
    }

    try {
      $afterTabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
      if ($afterTabs) { $remainingTabs += $afterTabs.Count }
    } catch {}
  }
}

[PSCustomObject]@{
  ok = $true
  closedIdleShells = $closedIdleShells
  closedDeadTabs = $closedDeadTabs
  remainingTabs = $remainingTabs
  windowsScanned = $windowsScanned
} | ConvertTo-Json -Compress
`.trim();
}

function cleanupWindowsTerminalTabs(options = {}) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: true, closedIdleShells: 0, closedDeadTabs: 0, remainingTabs: 0, windowsScanned: 0 });
  }
  const script = buildCleanupPowerShellScript(options);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(String(stderr || err.message || 'cleanup failed').trim()));
      }
      const raw = String(stdout || '').trim();
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ ok: true, raw });
      }
    });
  });
}

function checkWtAvailable() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('where.exe', ['wt.exe'], { windowsHide: true, timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

async function launchWorkspaceTerminalTab({ workspaceRoot, title, cwd, command, keepOnError = false, skipCleanup = false }) {
  if (process.platform !== 'win32') {
    throw new Error('Windows Terminal launcher is only supported on Windows.');
  }
  const hasWt = await checkWtAvailable();
  if (!hasWt) {
    throw new Error('wt.exe (Windows Terminal) is unavailable. Report the limitation and ask before opening separate visible windows.');
  }

  let cleanupResult = null;
  if (!skipCleanup) {
    try {
      cleanupResult = await cleanupWindowsTerminalTabs({ workspaceRoot });
    } catch (err) {
      cleanupResult = { ok: false, error: err.message };
    }
  }

  const args = buildWtLaunchArgs({ workspaceRoot, title, cwd, command, keepOnError });
  await new Promise((resolve, reject) => {
    const child = spawn('wt.exe', args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

  return {
    ok: true,
    windowName: computeWindowName(workspaceRoot),
    title: String(title || '').trim() || path.basename(normalizeWorkspaceRoot(cwd || workspaceRoot)),
    cwd: normalizeWorkspaceRoot(cwd || workspaceRoot),
    cleanup: cleanupResult
  };
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const subcommand = args[0] || '';
  const opts = { workspaceRoot: '', title: '', cwd: '', keepOnError: false, skipCleanup: false, all: false, dryRun: false, command: '' };
  const sepIndex = args.indexOf('--');
  const flagArgs = sepIndex >= 0 ? args.slice(1, sepIndex) : args.slice(1);
  const cmdParts = sepIndex >= 0 ? args.slice(sepIndex + 1) : [];

  for (let i = 0; i < flagArgs.length; i++) {
    const a = flagArgs[i];
    if ((a === '--workspace' || a === '-w') && i + 1 < flagArgs.length) {
      opts.workspaceRoot = flagArgs[++i];
    } else if ((a === '--title' || a === '-t') && i + 1 < flagArgs.length) {
      opts.title = flagArgs[++i];
    } else if ((a === '--cwd' || a === '-d') && i + 1 < flagArgs.length) {
      opts.cwd = flagArgs[++i];
    } else if (a === '--command' && i + 1 < flagArgs.length) {
      opts.command = flagArgs[++i];
    } else if (a === '--keep-on-error') {
      opts.keepOnError = true;
    } else if (a === '--skip-cleanup') {
      opts.skipCleanup = true;
    } else if (a === '--all') {
      opts.all = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (!opts.workspaceRoot && subcommand === 'window-name') {
      opts.workspaceRoot = a;
    }
  }
  if (!opts.command && cmdParts.length > 0) {
    opts.command = cmdParts.join(' ');
  }
  return { subcommand, opts };
}

async function main() {
  const { subcommand, opts } = parseCliArgs(process.argv);
  if (subcommand === 'window-name') {
    if (!opts.workspaceRoot) {
      console.error('Usage: node workspace-terminal.cjs window-name <workspace-root>');
      process.exit(1);
    }
    console.log(computeWindowName(opts.workspaceRoot));
    return;
  }
  if (subcommand === 'cleanup') {
    const result = await cleanupWindowsTerminalTabs({
      workspaceRoot: opts.workspaceRoot,
      all: opts.all || !opts.workspaceRoot,
      dryRun: opts.dryRun
    });
    console.log(JSON.stringify(result));
    return;
  }
  if (subcommand === 'launch') {
    if (!opts.workspaceRoot || !opts.command) {
      console.error('Usage: node workspace-terminal.cjs launch --workspace <root> --title <name> [--cwd <dir>] -- <command>');
      process.exit(1);
    }
    const result = await launchWorkspaceTerminalTab(opts);
    console.log(JSON.stringify(result));
    return;
  }
  console.error('Usage: node workspace-terminal.cjs <launch|cleanup|window-name> [options]');
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}

module.exports = {
  normalizeWorkspaceRoot,
  computeWindowName,
  escapeForWtArg,
  quoteWinArg,
  wrapCommandAutoClose,
  buildWtLaunchArgs,
  isDeadTabBuffer,
  buildCleanupPowerShellScript,
  cleanupWindowsTerminalTabs,
  launchWorkspaceTerminalTab,
  parseCliArgs
};
