param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'

$launcher = Join-Path $PSScriptRoot 'local-launcher\dist\K桌面啟動器.exe'

try {
  if ($NoBrowser) {
    throw 'Start-K-Desktop.ps1 不再直接啟動後端；請由安全系統匣啟動器管理 K。'
  }
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "找不到安全系統匣啟動器：$launcher。未啟動一般 K 後端。"
  }

  Start-Process -FilePath $launcher -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
} catch {
  if ($NoBrowser) { throw }
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'K HARNESS') | Out-Null
  exit 1
}
