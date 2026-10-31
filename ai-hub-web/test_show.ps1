Add-Type -AssemblyName System.Windows.Forms

$f = New-Object System.Windows.Forms.Form
$f.TopMost = $true
$f.StartPosition = 'CenterScreen'
$f.Show()
$f.Activate()

$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = "Chon Workspace"
$d.ShowNewFolderButton = $true

$res = $d.ShowDialog($f)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $d.SelectedPath
}
$f.Dispose()
