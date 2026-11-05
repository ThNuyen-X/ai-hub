Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinUtil {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
}
"@

$chrome = Get-Process chrome | Where-Object { $_.MainWindowTitle -match "Doraemon|Phòng Thí Nghiệm|New Tab|Jaian" }
if ($chrome) {
    $target = $chrome[0]
    Write-Output "Bringing to front window: $($target.MainWindowTitle) (PID: $($target.Id))"
    [WinUtil]::ShowWindow($target.MainWindowHandle, 3) # SW_MAXIMIZE
    [WinUtil]::SetForegroundWindow($target.MainWindowHandle)
    [WinUtil]::SwitchToThisWindow($target.MainWindowHandle, $true)
} else {
    Write-Output "Target Chrome window not found."
}
