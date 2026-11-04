param(
    [int]$Port = 20130,
    [string]$CheckpointPath = $null,
    [string]$LogDir = $null,
    [scriptblock]$KillServerAction = $null,
    [scriptblock]$KillAgentAction = $null,
    [scriptblock]$LaunchWebAction = $null,
    [scriptblock]$VerifyWebAction = $null,
    [scriptblock]$GetNetConnectionsAction = $null,
    [scriptblock]$GetCimProcessAction = $null,
    [switch]$SkipMutex,
    [switch]$AsFunctionOnly
)

$ErrorActionPreference = 'Stop'
$ScriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

function Invoke-AIHubRestartWorker {
    param(
        [int]$Port = 20130,
        [string]$CheckpointPath = $null,
        [string]$LogDir = $null,
        [string]$ScriptDir = $null,
        [scriptblock]$KillServerAction = $null,
        [scriptblock]$KillAgentAction = $null,
        [scriptblock]$LaunchWebAction = $null,
        [scriptblock]$VerifyWebAction = $null,
        [scriptblock]$GetNetConnectionsAction = $null,
        [scriptblock]$GetCimProcessAction = $null,
        [switch]$SkipMutex
    )

    $effectiveScriptDir = if ($ScriptDir) { $ScriptDir } elseif ($PSScriptRoot) { $PSScriptRoot } elseif ($script:ScriptDirectory) { $script:ScriptDirectory } else { Split-Path -Parent (Get-Command Invoke-AIHubRestartWorker -ErrorAction SilentlyContinue).ScriptBlock.File }
    $effectiveLogDir = if ($LogDir) { $LogDir } else { Join-Path $env:LOCALAPPDATA 'ai-hub\logs' }
    New-Item -ItemType Directory -Path $effectiveLogDir -Force | Out-Null
    function Write-RestartLog([string]$Message) {
        Add-Content -LiteralPath (Join-Path $effectiveLogDir 'restart-worker.log') -Value ((Get-Date -Format o) + ' ' + $Message)
    }

    Write-RestartLog 'Worker entered; validating checkpoint and process identities.'

    $mutex = if (-not $SkipMutex) { [System.Threading.Mutex]::new($false, 'Local\AIHubSafeRestart') } else { $null }
    $locked = $false
    $serverStopped = $false
    $allAcquiredProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

    try {
        if ($mutex) {
            $locked = $mutex.WaitOne(0)
            if (-not $locked) { throw 'Another restart worker is active.' }
        }

        $checkpoint = if ($CheckpointPath) { $CheckpointPath } else { Join-Path $env:LOCALAPPDATA 'ai-hub\restart-recovery.json' }
        if (-not (Test-Path -LiteralPath $checkpoint)) { throw 'Checkpoint file does not exist.' }
        $data = Get-Content -LiteralPath $checkpoint -Raw | ConvertFrom-Json
        $age = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $data.createdAt)
        if ($age -lt 0 -or $age -gt 120000 -or $data.armed) { throw 'Checkpoint is stale or already consumed.' }

        $listeners = if ($GetNetConnectionsAction) {
            & $GetNetConnectionsAction -Port $Port
        } else {
            @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        }
        $owners = @($listeners.OwningProcess | Select-Object -Unique)
        if ($owners.Count -ne 1 -or $owners[0] -ne $data.ownerPid) { throw 'Server identity changed; restart cancelled.' }

        $serverId = [int]$data.ownerPid
        $serverProc = $null
        try {
            $serverProc = [System.Diagnostics.Process]::GetProcessById($serverId)
            # Explicitly open and retain OS process handle to guard against TOCTOU PID reuse
            $null = $serverProc.Handle
            $allAcquiredProcesses.Add($serverProc)
        } catch [System.ArgumentException] {
            throw "Server process PID $serverId no longer exists."
        } catch [System.InvalidOperationException] {
            throw "Server process PID $serverId already exited."
        } catch {
            throw "Cannot acquire handle for server process PID $serverId : $($_.Exception.Message)"
        }

        $serverStartTime = $null
        try {
            $serverStartTime = $serverProc.StartTime
        } catch {}

        $process = if ($GetCimProcessAction) {
            & $GetCimProcessAction -ProcessId $serverId
        } else {
            Get-CimInstance Win32_Process -Filter "ProcessId=$serverId" -ErrorAction SilentlyContinue
        }
        $serverPath = Join-Path $effectiveScriptDir 'server.js'
        if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notlike "*$serverPath*") {
            throw 'Port owner is not the expected AI Hub server.'
        }
        if ($serverStartTime -and $process.CreationDate) {
            $diffSec = [Math]::Abs(($serverStartTime - $process.CreationDate).TotalSeconds)
            if ($diffSec -gt 3.0) {
                throw 'Server process start time mismatch; refusing to restart.'
            }
        }

        # Validate ALL agent identities and acquire open OS process handles before stopping anything.
        # Holding the open handle in .NET retains the Win32 Process Object, preventing OS PID reuse.
        $agents = @()
        foreach ($job in $data.jobs) {
            if ($job.state -ne 'pending' -or -not $job.oldPid) { continue }
            $agentId = [int]$job.oldPid
            $proc = $null
            try {
                $proc = [System.Diagnostics.Process]::GetProcessById($agentId)
                # Explicitly open and retain OS handle
                $null = $proc.Handle
                $allAcquiredProcesses.Add($proc)
            } catch [System.ArgumentException] {
                # Process already terminated before worker started
                continue
            } catch [System.InvalidOperationException] {
                # Process exited between GetProcessById and Handle property access
                continue
            } catch [System.ComponentModel.Win32Exception] {
                Write-RestartLog "Win32 error acquiring handle for agent PID $agentId : $($_.Exception.Message)"
                continue
            }

            $agentStartTime = $null
            try {
                $agentStartTime = $proc.StartTime
            } catch {}

            $agentCim = if ($GetCimProcessAction) {
                & $GetCimProcessAction -ProcessId $agentId
            } else {
                Get-CimInstance Win32_Process -Filter "ProcessId=$agentId" -ErrorAction SilentlyContinue
            }

            if ($agentCim) {
                if ($agentCim.Name -ne 'goose.exe' -or $agentCim.ParentProcessId -ne $serverId) {
                    throw 'Agent identity changed; refusing to stop a reused PID.'
                }
                if ($agentStartTime -and $agentCim.CreationDate) {
                    $diffSec = [Math]::Abs(($agentStartTime - $agentCim.CreationDate).TotalSeconds)
                    if ($diffSec -gt 3.0) {
                        throw 'Agent process start time mismatch; refusing to stop a reused PID.'
                    }
                }
                $agents += @{
                    Process = $proc
                    Pid = $agentId
                    SessionId = [string]$job.sessionId
                }
            }
        }

        # Stop the server before updating handoff so close callbacks cannot overwrite it.
        if ($KillServerAction) {
            & $KillServerAction -Process $serverProc -TargetPid $serverId
        } else {
            try {
                if (-not $serverProc.HasExited) {
                    $serverProc.Kill()
                }
            } catch {
                & taskkill.exe /PID $serverId /F | Out-Null
            }

            try {
                $null = $serverProc.WaitForExit(3000)
            } catch {}

            if (-not $serverProc.HasExited) {
                Write-RestartLog "Server PID $serverId not exited after Kill(); falling back to taskkill /F."
                & taskkill.exe /PID $serverId /F | Out-Null
            }
        }

        # Bounded wait and positive verification that the server process has actually exited
        try {
            $null = $serverProc.WaitForExit(3000)
        } catch {}

        if (-not $serverProc.HasExited) {
            throw "Failed to stop old server PID $serverId; process remains alive. Aborting restart before agent cleanup or replacement launch."
        }

        $serverStopped = $true
        Write-RestartLog 'Old server positively confirmed stopped.'

        # --- SESSION CLEANUP & HANDOFF (BEST-EFFORT / ISOLATED) ---
        # Once the server is stopped, we must attempt replacement launch regardless of agent/checkpoint errors,
        # but never resume sessions whose agents may still be running (fail closed for recovery).
        $unsafeSessionIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($agentInfo in $agents) {
            $proc = $agentInfo.Process
            $sid = $agentInfo.SessionId
            $agentPid = $agentInfo.Pid
            $agentExited = $false

            try {
                if ($KillAgentAction) {
                    & $KillAgentAction -Process $proc -TargetPid $agentPid -SessionId $sid
                } else {
                    if (-not $proc.HasExited) {
                        # Terminate directly on the retained native OS handle
                        $proc.Kill()
                    }
                }
            } catch [System.InvalidOperationException] {
                Write-RestartLog "Agent PID $agentPid already exited."
            } catch [System.ComponentModel.Win32Exception] {
                Write-RestartLog "Win32 error stopping agent PID $agentPid : $($_.Exception.Message)"
            } catch {
                Write-RestartLog "Stop-Process error on agent PID $agentPid : $($_.Exception.Message)"
            }

            # Bounded wait directly on the OS process handle (up to 3000ms)
            try {
                $agentExited = $proc.WaitForExit(3000)
            } catch {
                $agentExited = $proc.HasExited
            }

            if (-not $agentExited) {
                Write-RestartLog "Agent PID $agentPid did not exit within timeout. Disallowing session recovery for $sid."
                if ($sid) { [void]$unsafeSessionIds.Add($sid) }
            }
        }

        # Update checkpoint with armed status and mark any unsafe sessions
        try {
            if (Test-Path -LiteralPath $checkpoint) {
                $latestData = Get-Content -LiteralPath $checkpoint -Raw | ConvertFrom-Json
                if ($latestData -and $latestData.jobs) {
                    foreach ($job in $latestData.jobs) {
                        if ($unsafeSessionIds.Contains([string]$job.sessionId)) {
                            $job.state = 'blocked_old_process'
                        }
                    }
                    $latestData.armed = $true
                    $temp = $checkpoint + '.worker.tmp'
                    [System.IO.File]::WriteAllText($temp, ($latestData | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
                    Move-Item -LiteralPath $temp -Destination $checkpoint -Force
                    Write-RestartLog 'Checkpoint armed for replacement server.'
                }
            }
        } catch {
            Write-RestartLog "Failed to update checkpoint: $($_.Exception.Message). Continuing to launch replacement server."
        }

        Write-RestartLog 'Old processes stopped; launching replacement server.'
        if ($LaunchWebAction) {
            & $LaunchWebAction
        } else {
            & (Join-Path $effectiveScriptDir '..\launch-web.ps1') -NoBrowser
        }

        if ($VerifyWebAction) {
            & $VerifyWebAction -Port $Port
        } else {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port" -TimeoutSec 5
            if ($response.StatusCode -ne 200) { throw 'Replacement server failed HTTP readiness.' }
        }
        Write-RestartLog 'Replacement server confirmed HTTP 200.'
    } catch {
        New-Item -ItemType Directory -Path $effectiveLogDir -Force | Out-Null
        ($_ | Out-String) | Add-Content (Join-Path $effectiveLogDir 'restart-worker-error.log')
        if ($serverStopped) {
            try {
                Write-RestartLog 'Attempting emergency launch of replacement server after error.'
                if ($LaunchWebAction) {
                    & $LaunchWebAction
                } else {
                    & (Join-Path $effectiveScriptDir '..\launch-web.ps1') -NoBrowser
                }
            } catch {
                Write-RestartLog "Emergency launch also failed: $($_.Exception.Message)"
            }
        }
        throw
    } finally {
        # Safely dispose every acquired OS process handle regardless of early errors or normal exit
        foreach ($p in $allAcquiredProcesses) {
            if ($p) {
                try { $p.Dispose() } catch {}
            }
        }
        if ($locked -and $mutex) { $mutex.ReleaseMutex() }
        if ($mutex) { $mutex.Dispose() }
    }
}

if (-not $AsFunctionOnly) {
    try {
        Invoke-AIHubRestartWorker @PSBoundParameters
    } catch {
        exit 1
    }
}
