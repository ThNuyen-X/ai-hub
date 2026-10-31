param(
    [string]$InitialDirectory = $env:AI_HUB_PICKER_INITIAL_DIRECTORY
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$dialog = $null
$form = $null
$exitCode = 0
try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Chọn thư mục workspace làm việc'
    $dialog.ShowNewFolderButton = $true
    if ($InitialDirectory -and (Test-Path -LiteralPath $InitialDirectory -PathType Container)) {
        $dialog.SelectedPath = $InitialDirectory
    }

    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(10, 10)
    $form.Show()
    [void]$form.Activate()
    $form.BringToFront()

    $result = @{ ok = $false; message = 'Đã hủy chọn' }
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
        $result = @{ ok = $true; path = $dialog.SelectedPath }
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 3))
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $exitCode = 1
} finally {
    if ($dialog) { $dialog.Dispose() }
    if ($form) { $form.Close(); $form.Dispose() }
}
exit $exitCode
