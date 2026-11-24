# Tao / go lich danh thuc may (Windows Task Scheduler, WakeToRun).
# Duoc goi boi server.cjs (syncWakeTask). Tham so qua bien moi truong:
#   WAKE_MODE   = off | daily | once
#   WAKE_AT     = yyyy-MM-ddTHH:mm:ss (gio dia phuong)
#   WAKE_TASK   = ten task
#   WAKE_SCRIPT = duong dan keep-awake.ps1
#   WAKE_MINUTES= so phut giu may thuc sau khi bat
$ErrorActionPreference = 'Stop'
$name = $env:WAKE_TASK

if ($env:WAKE_MODE -eq 'off') {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  exit 0
}

$at = [datetime]::ParseExact($env:WAKE_AT, 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
if ($env:WAKE_MODE -eq 'once') {
  $trigger = New-ScheduledTaskTrigger -Once -At $at
} else {
  $trigger = New-ScheduledTaskTrigger -Daily -At $at
}

$q = [char]34
$arg = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ' + $q + $env:WAKE_SCRIPT + $q + ' -Minutes ' + $env:WAKE_MINUTES
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
$settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 60)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Trigger $trigger -Action $action -Settings $settings -Principal $principal -Description 'Bo Tot Remote: danh thuc may theo lich' -Force | Out-Null
exit 0
