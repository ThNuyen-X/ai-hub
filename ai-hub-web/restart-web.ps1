param([int]$Port = 20130)
$ErrorActionPreference = 'Stop'
$logDir = Join-Path $env:LOCALAPPDATA 'ai-hub\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
function Write-RestartLog([string]$Message) {
    Add-Content -LiteralPath (Join-Path $logDir 'restart-worker.log') -Value ((Get-Date -Format o) + ' ' + $Message)
}
Write-RestartLog 'Worker entered; validating checkpoint and process identities.'
$mutex = [System.Threading.Mutex]::new($false, 'Local\AIHubSafeRestart')
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) { throw 'Another restart worker is active.' }
    $checkpoint = Join-Path $env:LOCALAPPDATA 'ai-hub\restart-recovery.json'
    $data = Get-Content -LiteralPath $checkpoint -Raw | ConvertFrom-Json
    $age = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $data.createdAt)
    if ($age -lt 0 -or $age -gt 120000 -or $data.armed) { throw 'Checkpoint is stale or already consumed.' }
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    $owners = @($listeners.OwningProcess | Select-Object -Unique)
    if ($owners.Count -ne 1 -or $owners[0] -ne $data.ownerPid) { throw 'Server identity changed; restart cancelled.' }
    $serverId = [int]$data.ownerPid
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$serverId"
    $serverPath = Join-Path $PSScriptRoot 'server.js'
    if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notlike "*$serverPath*") {
        throw 'Port owner is not the expected AI Hub server.'
    }
    # Validate ALL identities before stopping anything. Never terminate arbitrary tool descendants.
    $agents = @()
    foreach ($job in $data.jobs) {
        if ($job.state -ne 'pending' -or -not $job.oldPid) { continue }
        $agent = Get-CimInstance Win32_Process -Filter "ProcessId=$($job.oldPid)"
        if ($agent) {
            if ($agent.Name -ne 'goose.exe' -or $agent.ParentProcessId -ne $serverId) {
                throw 'Agent identity changed; refusing to stop a reused PID.'
            }
            $agents += [int]$job.oldPid
        }
    }
    # Stop the server before updating the handoff so close callbacks cannot overwrite it.
    # Killing only the parent leaves the independent restart worker alive.
    & taskkill.exe /PID $serverId /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot stop old server.' }
    foreach ($agentId in $agents) {
        $agent = Get-CimInstance Win32_Process -Filter "ProcessId=$agentId"
        if ($agent -and $agent.Name -eq 'goose.exe' -and $agent.ParentProcessId -eq $serverId) {
            Stop-Process -Id $agentId -Force -ErrorAction Stop
        }
    }
    # Re-read completions written before server shutdown, then arm the one-shot handoff.
    $data = Get-Content -LiteralPath $checkpoint -Raw | ConvertFrom-Json
    $data.armed = $true
    $temp = $checkpoint + '.worker.tmp'
    [System.IO.File]::WriteAllText($temp, ($data | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $checkpoint -Force
    foreach ($agentId in $agents) {
        if (Get-Process -Id $agentId -ErrorAction SilentlyContinue) { throw 'Old agent is still alive; recovery cancelled.' }
    }
    Write-RestartLog 'Old processes stopped; launching replacement server.'
    & (Join-Path $PSScriptRoot '..\launch-web.ps1') -NoBrowser
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port" -TimeoutSec 5
    if ($response.StatusCode -ne 200) { throw 'Replacement server failed HTTP readiness.' }
    Write-RestartLog 'Replacement server confirmed HTTP 200.'
} catch {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    ($_ | Out-String) | Add-Content (Join-Path $logDir 'restart-worker-error.log')
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
