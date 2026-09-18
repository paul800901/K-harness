$ErrorActionPreference = 'Stop'
$kRoot = Split-Path $PSScriptRoot -Parent
$kDesktop = [Environment]::GetFolderPath('Desktop')
$kTarget = Join-Path $kDesktop 'K HARNESS.lnk'
if (Test-Path -LiteralPath $kTarget) { throw "Existing shortcut preserved: $kTarget" }
$kShell = New-Object -ComObject WScript.Shell
$kLink = $kShell.CreateShortcut($kTarget)
$kLink.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$kLink.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $kRoot 'Start-K-Desktop.ps1') + '"'
$kLink.WorkingDirectory = $kRoot
$kLink.Description = 'K HARNESS - local desktop frontend and backend'
$kLink.IconLocation = (Join-Path $kRoot 'frontend\assets\k-logo.ico') + ',0'
$kLink.Save()
$kReadback = $kShell.CreateShortcut($kTarget)
if ($kReadback.WorkingDirectory -ne $kRoot -or $kReadback.Arguments -ne $kLink.Arguments) { throw 'Shortcut verification failed.' }
Write-Output $kTarget
