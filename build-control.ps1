$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll ('/win32icon:' + (Join-Path $PSScriptRoot 'ai-hub-web\public\ai-hub-cube.ico')) ('/out:' + (Join-Path $PSScriptRoot 'ai-hub.exe')) (Join-Path $PSScriptRoot 'AiHubControl.cs')
if ($LASTEXITCODE -ne 0) { throw 'Control center compilation failed.' }
Write-Output 'Built ai-hub.exe'
