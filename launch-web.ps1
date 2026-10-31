param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$logDirectory = Join-Path $env:LOCALAPPDATA 'ai-hub\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$mutex = [System.Threading.Mutex]::new($false, 'Local\AIHubWebLauncher')
$locked = $false
try {
    $locked = $mutex.WaitOne(30000)
    if (-not $locked) { throw 'Another AI Hub launch is still in progress. Try again shortly.' }
    # Import the existing private configuration without starting its interactive launcher.
    $config = Join-Path $root 'start-web.bat'
    if (-not (Test-Path -LiteralPath $config)) { throw 'Missing private start-web.bat configuration.' }
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $env:ComSpec
    $info.Arguments = '/d /s /c "call ""' + $config + '"" --export-env >nul && set"'
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $process = [System.Diagnostics.Process]::Start($info)
    $output = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Cannot load launcher configuration.' }
    $process.Dispose()
    foreach ($line in ($output -split '\r?\n')) {
        if ($line -match '^([^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
    $portNumber = 20130
    if ($env:PORT) { $portNumber = [int]$env:PORT }
    $url = "http://127.0.0.1:$portNumber"
    function Test-WebReady {
        $response = $null
        try {
            $request = [System.Net.HttpWebRequest]::Create($url)
            $request.Proxy = $null
            $request.Timeout = 1000
            $request.ReadWriteTimeout = 1000
            $response = $request.GetResponse()
            return [int]$response.StatusCode -eq 200
        } catch { return $false }
        finally { if ($response) { $response.Close() } }
    }
    if (-not (Test-WebReady)) {
        if (-not $env:NINE_ROUTER_KEY) { throw 'Configure NINE_ROUTER_KEY in start-web.bat first.' }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $server = Join-Path $root 'ai-hub-web\server.js'
        $child = Start-Process -FilePath $node -ArgumentList ('"' + $server + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            if (Test-WebReady) { $ready = $true; break }
            if ($child.HasExited) { throw "AI Hub stopped during startup. See $logDirectory\server-error.log" }
            Start-Sleep -Milliseconds 250
        }
        if (-not $ready) { throw "AI Hub did not become ready. See $logDirectory\server-error.log" }
        $child.Dispose()
    }
    if (-not $NoBrowser) { Start-Process $url }
    Write-Output "AI Hub ready: $url"
} catch {
    $_ | Out-String | Add-Content -LiteralPath (Join-Path $logDirectory 'launcher-error.log')
    if (-not $NoBrowser) {
        $shell = New-Object -ComObject WScript.Shell
        $shell.Popup($_.Exception.Message, 0, 'AI Hub - Startup Error', 16) | Out-Null
    }
    throw
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
