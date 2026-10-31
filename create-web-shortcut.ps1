param([string]$ShortcutDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconPath = Join-Path $PSScriptRoot 'ai-hub-web\public\ai-hub-cube.ico'
$launcherPath = Join-Path $PSScriptRoot 'start-web.bat'
if (-not (Test-Path -LiteralPath $launcherPath)) { throw "Launcher not found: $launcherPath" }
if (-not (Test-Path -LiteralPath $ShortcutDirectory -PathType Container)) { throw 'Shortcut directory not found' }

# Faceted cube with a luminous core and detached satellite; no background tile.
$frames = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.ScaleTransform(($size / 120.0), ($size / 120.0))
    $g.TranslateTransform(-4, -2)
    foreach ($face in @(
        @{ XY=@(14,42, 60,16, 106,42, 60,69); A='#395A70'; B='#162D42' },
        @{ XY=@(14,42, 60,69, 60,120, 14,93); A='#213F55'; B='#0B1C2D' },
        @{ XY=@(60,69, 106,42, 106,93, 60,120); A='#17354F'; B='#071423' }
    )) {
        $points = for ($i=0; $i -lt $face.XY.Count; $i+=2) {
            [System.Drawing.PointF]::new($face.XY[$i], $face.XY[$i+1])
        }
        $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
            [System.Drawing.Point]::new(14,16), [System.Drawing.Point]::new(106,120),
            [System.Drawing.ColorTranslator]::FromHtml($face.A), [System.Drawing.ColorTranslator]::FromHtml($face.B))
        $g.FillPolygon($brush, [System.Drawing.PointF[]]$points)
        $brush.Dispose()
    }
    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        [System.Drawing.Point]::new(20,16), [System.Drawing.Point]::new(100,120),
        [System.Drawing.ColorTranslator]::FromHtml('#B4FFF1'), [System.Drawing.ColorTranslator]::FromHtml('#159EDB'))
    $pen = [System.Drawing.Pen]::new($gradient, 4.5)
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Bevel
    foreach ($coords in @(
        @(14,42,60,16,106,42,106,93,60,120,14,93,14,42),
        @(14,42,60,69,106,42), @(60,69,60,120)
    )) {
        $points = for ($i=0; $i -lt $coords.Count; $i+=2) {
            [System.Drawing.PointF]::new($coords[$i], $coords[$i+1])
        }
        $g.DrawLines($pen,[System.Drawing.PointF[]]$points)
    }
    $pen.Width = 3
    $g.DrawLine($pen,30,67,30,83)
    $g.DrawLine($pen,30,83,44,91)
    $g.DrawLine($pen,90,67,90,83)
    $g.DrawLine($pen,90,83,76,91)
    $core = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#A1FFF0'))
    $g.FillPolygon($core,[System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(60,32),[System.Drawing.PointF]::new(79,43),
        [System.Drawing.PointF]::new(60,54),[System.Drawing.PointF]::new(41,43)))
    $g.FillEllipse($core,104,6,16,16)
    $core.Dispose()
    $pen.Dispose()
    $gradient.Dispose()
    $stream = [System.IO.MemoryStream]::new()
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $frames += ,@{ Size = $size; Bytes = $stream.ToArray() }
    if ($size -eq 256) {
        $bitmap.Save((Join-Path $env:TEMP 'ai-hub-mark-preview.png'))
        $bitmap.Save((Join-Path $PSScriptRoot 'ai-hub-web\public\ai-hub-cube.png'))
    }
    $stream.Dispose()
    $g.Dispose()
    $bitmap.Dispose()
}
$writer = [System.IO.BinaryWriter]::new([System.IO.File]::Create($iconPath))
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $writer.Write([byte]($frame.Size % 256))
        $writer.Write([byte]($frame.Size % 256))
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose() }

$shell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path $ShortcutDirectory 'AI Hub.lnk'
$oldPath = Join-Path $ShortcutDirectory 'ai-hub.lnk'
if ((Test-Path -LiteralPath $oldPath) -and -not (Test-Path -LiteralPath $shortcutPath)) {
    Move-Item -LiteralPath $oldPath -Destination $shortcutPath
}
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $PSScriptRoot 'ai-hub.exe'
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'AI Hub'
$shortcut.Save()
Write-Output "Created shortcut: $shortcutPath"
