$ErrorActionPreference = 'Stop'
$kRoot = Split-Path $PSScriptRoot -Parent
$kDesktop = [Environment]::GetFolderPath('Desktop')
$kTarget = Join-Path $kDesktop 'K HARNESS.lnk'
$kLauncher = & (Join-Path $kRoot 'local-launcher\Build-K-Launcher.ps1')
if (-not (Test-Path -LiteralPath $kLauncher)) { throw 'K tray launcher build did not produce an executable.' }
$kShell = New-Object -ComObject WScript.Shell
$kOld = if (Test-Path -LiteralPath $kTarget) { $kShell.CreateShortcut($kTarget) } else { $null }
if ($kOld -and $kOld.TargetPath -ne $kLauncher -and $kOld.Arguments -notlike '*Start-K-Desktop.ps1*') { throw "Existing unrelated shortcut preserved: $kTarget" }
$kLink = $kShell.CreateShortcut($kTarget)
$kLink.TargetPath = $kLauncher
$kLink.Arguments = ''
$kLink.WorkingDirectory = $kRoot
$kLink.Description = 'K 執行中樞 - 系統匣桌面啟動器'
$kLink.IconLocation = $kLauncher + ',0'
$kLink.Save()
$kReadback = $kShell.CreateShortcut($kTarget)
if ($kReadback.TargetPath -ne $kLauncher -or $kReadback.WorkingDirectory -ne $kRoot -or $kReadback.Arguments) { throw 'Shortcut verification failed.' }
Write-Output $kTarget
