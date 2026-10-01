$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $PSScriptRoot 'dist'
$icon = Join-Path $projectRoot 'frontend\assets\k-logo.ico'
$exe = Join-Path $dist 'K桌面啟動器.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw '找不到 Windows C# 編譯器。' }
if (-not (Test-Path -LiteralPath $icon)) { throw '找不到 K 圖示。' }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
& $compiler /nologo /target:winexe /optimize+ "/win32icon:$icon" "/out:$exe" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll (Join-Path $PSScriptRoot 'KTrayLauncher.cs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output $exe
