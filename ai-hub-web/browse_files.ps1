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
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Chọn tập tin đính kèm (giữ Ctrl để chọn nhiều tệp)'
    $dialog.Multiselect = $true
    $dialog.CheckFileExists = $true
    $dialog.CheckPathExists = $true
    $dialog.RestoreDirectory = $true
    $dialog.Filter = 'Tất cả các tập tin (*.*)|*.*|Mã nguồn (*.js;*.ts;*.jsx;*.tsx;*.py;*.java;*.html;*.css;*.json;*.md;*.sql;*.sh;*.ps1)|*.js;*.ts;*.jsx;*.tsx;*.py;*.java;*.html;*.css;*.json;*.md;*.sql;*.sh;*.ps1|Văn bản (*.txt;*.md;*.log;*.csv)|*.txt;*.md;*.log;*.csv'
    if ($InitialDirectory -and (Test-Path -LiteralPath $InitialDirectory -PathType Container)) {
        $dialog.InitialDirectory = $InitialDirectory
    }

    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(10, 10)
    $form.Show()
    [void]$form.Activate()
    $form.BringToFront()

    $result = @{ ok = $false; files = @(); message = 'Đã hủy chọn' }
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.FileNames.Count -gt 0) {
        $result = @{ ok = $true; files = @($dialog.FileNames) }
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
