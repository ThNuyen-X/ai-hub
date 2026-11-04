const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const restartWebPs1Path = path.join(__dirname, 'restart-web.ps1');
const restartWebPs1Content = fs.readFileSync(restartWebPs1Path, 'utf8');

// 1. Static Source Guards (Ensure API contract & handle invariants)
assert.ok(restartWebPs1Content.includes('function Invoke-AIHubRestartWorker'), 'Must export callable Invoke-AIHubRestartWorker production function');
assert.ok(restartWebPs1Content.includes('$null = $proc.Handle'), 'Must eagerly access .Handle to acquire and retain OS process handle');
assert.ok(restartWebPs1Content.includes('$null = $serverProc.Handle'), 'Must eagerly access server process .Handle to guard against TOCTOU PID reuse');
assert.ok(restartWebPs1Content.includes('$allAcquiredProcesses'), 'Must track all acquired process handles in outer list');
assert.ok(restartWebPs1Content.includes('$p.Dispose()'), 'Must dispose acquired processes in outer finally block');
assert.ok(restartWebPs1Content.includes('$diffSec = [Math]::Abs'), 'Must compare StartTime with CIM CreationDate');
assert.ok(restartWebPs1Content.includes('[System.ComponentModel.Win32Exception]'), 'Must explicitly handle Win32Exception / Access Denied');
assert.ok(restartWebPs1Content.includes('blocked_old_process'), 'Must fail-closed for sessions with unverified agent exit');
assert.ok(restartWebPs1Content.includes('Attempting emergency launch of replacement server after error'), 'Must attempt emergency launch in outer catch when server stopped');
assert.ok(restartWebPs1Content.includes('Failed to stop old server PID'), 'Must abort when server process does not exit');

// 2. Real Mocked Behavioral Tests Executing restart-web.ps1's Orchestration
// We run PowerShell with restart-web.ps1 dot-sourced with -AsFunctionOnly, invoking Invoke-AIHubRestartWorker
// directly with isolated dependency injection boundaries.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-restart-test-'));

const testScript = `
$ErrorActionPreference = 'Stop'
$scriptRoot = '${__dirname.replace(/\\/g, '\\\\')}'
$tempBase = '${tempDir.replace(/\\/g, '\\\\')}'
. (Join-Path $scriptRoot 'restart-web.ps1') -AsFunctionOnly

function New-TestHarness([string]$Name) {
    $dir = Join-Path $tempBase $Name
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $checkpoint = Join-Path $dir 'restart-recovery.json'
    $logDir = Join-Path $dir 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    return @{
        Dir = $dir
        Checkpoint = $checkpoint
        LogDir = $logDir
    }
}

function Safe-StopProcess($proc) {
    if ($proc) {
        try {
            if (-not $proc.HasExited) { $proc.Kill(); $null = $proc.WaitForExit(1000) }
        } catch {}
        try { $proc.Dispose() } catch {}
    }
}

# --- TEST 1: Prevalidation Failure - Agent identity mismatch (PID reuse prevented) ---
Write-Host 'Running Test 1: PID reuse prevention...'
$h1 = New-TestHarness 'test1_pid_reuse'
$dummyProc = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru
$serverProcMock = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru

$cpData1 = @{
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    ownerPid = $serverProcMock.Id
    armed = $false
    jobs = @(
        @{ sessionId = 'sess_1'; oldPid = $dummyProc.Id; state = 'pending' }
    )
}
[System.IO.File]::WriteAllText($h1.Checkpoint, ($cpData1 | ConvertTo-Json -Depth 5))

$script:serverKilled1 = $false
$script:webLaunched1 = $false
$errorThrown1 = $false

try {
    Invoke-AIHubRestartWorker -Port 20130 -CheckpointPath $h1.Checkpoint -LogDir $h1.LogDir -ScriptDir $scriptRoot -SkipMutex \`
        -GetNetConnectionsAction { param($p) @([pscustomobject]@{ OwningProcess = $serverProcMock.Id }) } \`
        -GetCimProcessAction { param($ProcessId)
            if ($ProcessId -eq $serverProcMock.Id) {
                return [pscustomobject]@{ Name = 'node.exe'; CommandLine = "node $(Join-Path $scriptRoot 'server.js')"; CreationDate = $serverProcMock.StartTime }
            }
            # Return fake identity for agent (e.g. reused PID as notepad.exe)
            return [pscustomobject]@{ Name = 'notepad.exe'; ParentProcessId = 99999; CreationDate = $dummyProc.StartTime }
        } \`
        -KillServerAction { param($Process, $TargetPid) $script:serverKilled1 = $true; if (-not $Process.HasExited) { $Process.Kill(); $null = $Process.WaitForExit(2000) } } \`
        -LaunchWebAction { $script:webLaunched1 = $true } \`
        -VerifyWebAction { param($p) }
} catch {
    if ($_.Exception.Message -like '*Agent identity changed; refusing to stop a reused PID*') {
        $errorThrown1 = $true
    } else {
        throw "Test 1 unexpected error: $($_.Exception.Message)"
    }
} finally {
    Safe-StopProcess $dummyProc
    Safe-StopProcess $serverProcMock
}

if (-not $errorThrown1) { throw 'Test 1 Failed: PID reuse was not rejected during prevalidation.' }
if ($script:serverKilled1) { throw 'Test 1 Failed: Server was killed despite agent identity mismatch.' }
if ($script:webLaunched1) { throw 'Test 1 Failed: Web was launched despite prevalidation failure.' }

# --- TEST 2: Prevalidation Failure - Process StartTime mismatch ---
Write-Host 'Running Test 2: StartTime mismatch prevention...'
$h2 = New-TestHarness 'test2_time_mismatch'
$dummyProc2 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru
$serverProcMock2 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru

$cpData2 = @{
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    ownerPid = $serverProcMock2.Id
    armed = $false
    jobs = @(
        @{ sessionId = 'sess_2'; oldPid = $dummyProc2.Id; state = 'pending' }
    )
}
[System.IO.File]::WriteAllText($h2.Checkpoint, ($cpData2 | ConvertTo-Json -Depth 5))

$errorThrown2 = $false
try {
    Invoke-AIHubRestartWorker -Port 20130 -CheckpointPath $h2.Checkpoint -LogDir $h2.LogDir -ScriptDir $scriptRoot -SkipMutex \`
        -GetNetConnectionsAction { param($p) @([pscustomobject]@{ OwningProcess = $serverProcMock2.Id }) } \`
        -GetCimProcessAction { param($ProcessId)
            if ($ProcessId -eq $serverProcMock2.Id) {
                return [pscustomobject]@{ Name = 'node.exe'; CommandLine = "node $(Join-Path $scriptRoot 'server.js')"; CreationDate = $serverProcMock2.StartTime }
            }
            # Same name/parent but mismatched creation date (>3s difference)
            return [pscustomobject]@{ Name = 'goose.exe'; ParentProcessId = $serverProcMock2.Id; CreationDate = $dummyProc2.StartTime.AddHours(-1) }
        } \`
        -KillServerAction { param($Process, $TargetPid) if (-not $Process.HasExited) { $Process.Kill(); $null = $Process.WaitForExit(2000) } } \`
        -LaunchWebAction { } \`
        -VerifyWebAction { param($p) }
} catch {
    if ($_.Exception.Message -like '*Agent process start time mismatch*') {
        $errorThrown2 = $true
    }
} finally {
    Safe-StopProcess $dummyProc2
    Safe-StopProcess $serverProcMock2
}
if (-not $errorThrown2) { throw 'Test 2 Failed: StartTime mismatch was not rejected.' }

# --- TEST 3: Vanished Agent - Normal Flow with process already exited ---
Write-Host 'Running Test 3: Vanished agent handling...'
$h3 = New-TestHarness 'test3_vanished'
$vanished = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Milliseconds 100"' -PassThru
$vanishedPid = $vanished.Id
$vanished.WaitForExit(2000)
$vanished.Dispose()

$serverProcMock3 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru
$cpData3 = @{
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    ownerPid = $serverProcMock3.Id
    armed = $false
    jobs = @(
        @{ sessionId = 'sess_vanished'; oldPid = $vanishedPid; state = 'pending' }
    )
}
[System.IO.File]::WriteAllText($h3.Checkpoint, ($cpData3 | ConvertTo-Json -Depth 5))

$script:webLaunched3 = $false
try {
    Invoke-AIHubRestartWorker -Port 20130 -CheckpointPath $h3.Checkpoint -LogDir $h3.LogDir -ScriptDir $scriptRoot -SkipMutex \`
        -GetNetConnectionsAction { param($p) @([pscustomobject]@{ OwningProcess = $serverProcMock3.Id }) } \`
        -GetCimProcessAction { param($ProcessId)
            if ($ProcessId -eq $serverProcMock3.Id) {
                return [pscustomobject]@{ Name = 'node.exe'; CommandLine = "node $(Join-Path $scriptRoot 'server.js')"; CreationDate = $serverProcMock3.StartTime }
            }
            return $null # CIM already returns null for exited agent
        } \`
        -KillServerAction { param($Process, $TargetPid) if (-not $Process.HasExited) { $Process.Kill(); $null = $Process.WaitForExit(2000) } } \`
        -LaunchWebAction { $script:webLaunched3 = $true } \`
        -VerifyWebAction { param($p) }
} finally {
    Safe-StopProcess $serverProcMock3
}

if (-not $script:webLaunched3) { throw 'Test 3 Failed: Web was not launched when agent vanished cleanly.' }
$resultCp3 = Get-Content -LiteralPath $h3.Checkpoint -Raw | ConvertFrom-Json
if (-not $resultCp3.armed) { throw 'Test 3 Failed: Checkpoint was not armed.' }

# --- TEST 4: Access Denied / Win32Exception during Agent Kill ---
Write-Host 'Running Test 4: Access denied handling & fail-closed session isolation...'
$h4 = New-TestHarness 'test4_access_denied'
$stubbornAgent4 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru
$serverProcMock4 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru

$cpData4 = @{
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    ownerPid = $serverProcMock4.Id
    armed = $false
    jobs = @(
        @{ sessionId = 'sess_denied'; oldPid = $stubbornAgent4.Id; state = 'pending' }
    )
}
[System.IO.File]::WriteAllText($h4.Checkpoint, ($cpData4 | ConvertTo-Json -Depth 5))

$script:webLaunched4 = $false
try {
    Invoke-AIHubRestartWorker -Port 20130 -CheckpointPath $h4.Checkpoint -LogDir $h4.LogDir -ScriptDir $scriptRoot -SkipMutex \`
        -GetNetConnectionsAction { param($p) @([pscustomobject]@{ OwningProcess = $serverProcMock4.Id }) } \`
        -GetCimProcessAction { param($ProcessId)
            if ($ProcessId -eq $serverProcMock4.Id) {
                return [pscustomobject]@{ Name = 'node.exe'; CommandLine = "node $(Join-Path $scriptRoot 'server.js')"; CreationDate = $serverProcMock4.StartTime }
            }
            return [pscustomobject]@{ Name = 'goose.exe'; ParentProcessId = $serverProcMock4.Id; CreationDate = $stubbornAgent4.StartTime }
        } \`
        -KillServerAction { param($Process, $TargetPid) if (-not $Process.HasExited) { $Process.Kill(); $null = $Process.WaitForExit(2000) } } \`
        -KillAgentAction { param($Process, $TargetPid, $SessionId)
            # Simulate Win32 Access Denied error
            throw [System.ComponentModel.Win32Exception]::new(5, 'Access is denied (Mock)')
        } \`
        -LaunchWebAction { $script:webLaunched4 = $true } \`
        -VerifyWebAction { param($p) }
} finally {
    Safe-StopProcess $stubbornAgent4
    Safe-StopProcess $serverProcMock4
}

if (-not $script:webLaunched4) { throw 'Test 4 Failed: Web launch was aborted due to agent termination access denied.' }
$resultCp4 = Get-Content -LiteralPath $h4.Checkpoint -Raw | ConvertFrom-Json
if (-not $resultCp4.armed) { throw 'Test 4 Failed: Checkpoint was not armed.' }
$job4 = $resultCp4.jobs | Where-Object { $_.sessionId -eq 'sess_denied' }
if ($job4.state -ne 'blocked_old_process') { throw "Test 4 Failed: Expected state blocked_old_process, got $($job4.state)" }

# --- TEST 5: Checkpoint Write Failure after Server Stopped ---
Write-Host 'Running Test 5: Checkpoint write failure resilience...'
$h5 = New-TestHarness 'test5_checkpoint_failure'
$serverProcMock5 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru

$cpData5 = @{
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    ownerPid = $serverProcMock5.Id
    armed = $false
    jobs = @()
}
[System.IO.File]::WriteAllText($h5.Checkpoint, ($cpData5 | ConvertTo-Json -Depth 5))

$script:webLaunched5 = $false
try {
    Invoke-AIHubRestartWorker -Port 20130 -CheckpointPath $h5.Checkpoint -LogDir $h5.LogDir -ScriptDir $scriptRoot -SkipMutex \`
        -GetNetConnectionsAction { param($p) @([pscustomobject]@{ OwningProcess = $serverProcMock5.Id }) } \`
        -GetCimProcessAction { param($ProcessId)
            return [pscustomobject]@{ Name = 'node.exe'; CommandLine = "node $(Join-Path $scriptRoot 'server.js')"; CreationDate = $serverProcMock5.StartTime }
        } \`
        -KillServerAction { param($Process, $TargetPid)
            if (-not $Process.HasExited) { $Process.Kill(); $null = $Process.WaitForExit(2000) }
            # Invalidate checkpoint path after stopping server to force write failure
            Remove-Item -LiteralPath $h5.Checkpoint -Force
            New-Item -ItemType Directory -Path $h5.Checkpoint -Force | Out-Null
        } \`
        -LaunchWebAction { $script:webLaunched5 = $true } \`
        -VerifyWebAction { param($p) }
} finally {
    Safe-StopProcess $serverProcMock5
    if (Test-Path -LiteralPath $h5.Checkpoint) {
        Remove-Item -LiteralPath $h5.Checkpoint -Recurse -Force
    }
}

if (-not $script:webLaunched5) { throw 'Test 5 Failed: Web launch was aborted when checkpoint update failed.' }

# --- TEST 6: Emergency Replacement Launch on Error in Catch Block ---
Write-Host 'Running Test 6: Emergency web launch in catch block...'
$h6 = New-TestHarness 'test6_emergency_launch'
$serverProcMock6 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 10"' -PassThru

$cpData6 = @{
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    ownerPid = $serverProcMock6.Id
    armed = $false
    jobs = @()
}
[System.IO.File]::WriteAllText($h6.Checkpoint, ($cpData6 | ConvertTo-Json -Depth 5))

$script:launchCount6 = 0
$fatalCaught6 = $false
try {
    Invoke-AIHubRestartWorker -Port 20130 -CheckpointPath $h6.Checkpoint -LogDir $h6.LogDir -ScriptDir $scriptRoot -SkipMutex \`
        -GetNetConnectionsAction { param($p) @([pscustomobject]@{ OwningProcess = $serverProcMock6.Id }) } \`
        -GetCimProcessAction { param($ProcessId)
            return [pscustomobject]@{ Name = 'node.exe'; CommandLine = "node $(Join-Path $scriptRoot 'server.js')"; CreationDate = $serverProcMock6.StartTime }
        } \`
        -KillServerAction { param($Process, $TargetPid) if (-not $Process.HasExited) { $Process.Kill(); $null = $Process.WaitForExit(2000) } } \`
        -LaunchWebAction { $script:launchCount6++ } \`
        -VerifyWebAction { param($p) throw 'Mock readiness check failed catastrophically' }
} catch {
    if ($_.Exception.Message -like '*readiness check failed catastrophically*') {
        $fatalCaught6 = $true
    }
} finally {
    Safe-StopProcess $serverProcMock6
}

if (-not $fatalCaught6) { throw 'Test 6 Failed: Fatal error was not propagated.' }
# LaunchWebAction should have been called twice: 1 normal attempt + 1 emergency launch in catch block
if ($script:launchCount6 -lt 2) { throw "Test 6 Failed: Emergency launch was not called. Expected >= 2 launches, got $($script:launchCount6)" }

# --- TEST 7: Stop Server Failure - Server refuses to exit aborts restart cleanly ---
Write-Host 'Running Test 7: Stop server failure aborts before agent cleanup or launch...'
$h7 = New-TestHarness 'test7_server_stop_failure'
$stubbornServer7 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 15"' -PassThru
$agentProc7 = Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 15"' -PassThru

$cpData7 = @{
    createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    ownerPid = $stubbornServer7.Id
    armed = $false
    jobs = @(
        @{ sessionId = 'sess_stubborn_server'; oldPid = $agentProc7.Id; state = 'pending' }
    )
}
[System.IO.File]::WriteAllText($h7.Checkpoint, ($cpData7 | ConvertTo-Json -Depth 5))

$script:agentKilled7 = $false
$script:webLaunched7 = $false
$stopServerFailedCaught7 = $false

try {
    Invoke-AIHubRestartWorker -Port 20130 -CheckpointPath $h7.Checkpoint -LogDir $h7.LogDir -ScriptDir $scriptRoot -SkipMutex \`
        -GetNetConnectionsAction { param($p) @([pscustomobject]@{ OwningProcess = $stubbornServer7.Id }) } \`
        -GetCimProcessAction { param($ProcessId)
            if ($ProcessId -eq $stubbornServer7.Id) {
                return [pscustomobject]@{ Name = 'node.exe'; CommandLine = "node $(Join-Path $scriptRoot 'server.js')"; CreationDate = $stubbornServer7.StartTime }
            }
            return [pscustomobject]@{ Name = 'goose.exe'; ParentProcessId = $stubbornServer7.Id; CreationDate = $agentProc7.StartTime }
        } \`
        -KillServerAction { param($Process, $TargetPid)
            # Intentionally do nothing: simulate a server process that refuses to exit
        } \`
        -KillAgentAction { param($Process, $TargetPid, $SessionId)
            $script:agentKilled7 = $true
        } \`
        -LaunchWebAction {
            $script:webLaunched7 = $true
        } \`
        -VerifyWebAction { param($p) }
} catch {
    if ($_.Exception.Message -like '*Failed to stop old server PID*process remains alive*') {
        $stopServerFailedCaught7 = $true
    } else {
        throw "Test 7 unexpected error: $($_.Exception.Message)"
    }
} finally {
    Safe-StopProcess $stubbornServer7
    Safe-StopProcess $agentProc7
}

if (-not $stopServerFailedCaught7) { throw 'Test 7 Failed: Failure to stop old server was not caught.' }
if ($script:webLaunched7) { throw 'Test 7 Failed: Web was launched despite old server remaining alive.' }
if ($script:agentKilled7) { throw 'Test 7 Failed: Agent cleanup was performed despite old server remaining alive.' }

$resultCp7 = Get-Content -LiteralPath $h7.Checkpoint -Raw | ConvertFrom-Json
if ($resultCp7.armed) { throw 'Test 7 Failed: Checkpoint must NOT be armed when server stop fails.' }

Write-Output 'ALL_ORCHESTRATION_TESTS_PASSED'
`;

try {
  const stdout = execFileSync('powershell.exe', ['-NoProfile', '-Command', testScript], {
    encoding: 'utf8',
    timeout: 35000
  });
  assert.ok(stdout.includes('ALL_ORCHESTRATION_TESTS_PASSED'), 'PowerShell production orchestration tests must pass');
  console.log('Restart worker behavior: handle-based process termination, bounded wait, PID reuse rejection, isolated recovery, stop-server verification and emergency web launch verified.');
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}
