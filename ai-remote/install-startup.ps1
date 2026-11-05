$shortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\AI Hub Remote.lnk"
$targetScript = Join-Path $PSScriptRoot "launch-remote.vbs"
$iconPath = Join-Path $PSScriptRoot "public\icon.svg"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$targetScript`""
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = "AI Hub Remote Controller Daemon"
$Shortcut.Save()

Write-Host "========================================================" -ForegroundColor Green
Write-Host " Da dang ky AI Hub Remote Daemon vao Startup cua Windows!" -ForegroundColor Yellow
Write-Host " Duong dan: $shortcutPath" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Green
