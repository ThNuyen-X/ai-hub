$shortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\AI Hub Remote.lnk"
if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Da huy tu khoi dong AI Hub Remote Daemon." -ForegroundColor Green
} else {
    Write-Host "Khong tim thay shortcut startup." -ForegroundColor Yellow
}
