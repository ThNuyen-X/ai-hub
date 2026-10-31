Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Chọn thư mục Workspace"
$dialog.RootFolder = [System.Environment+SpecialFolder]::MyComputer
$dialog.ShowNewFolderButton = $true

# Modern IFileDialog in Windows 10/11 or top-level handle
$w = New-Object System.Windows.Forms.NativeWindow
# Get foreground window handle
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
"@

$fgHwnd = [Win32]::GetForegroundWindow()
$w.AssignHandle($fgHwnd)

if ($dialog.ShowDialog($w) -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
