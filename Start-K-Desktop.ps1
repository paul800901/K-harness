param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$kRoot = $PSScriptRoot
$kUrl = 'http://127.0.0.1:47831'
$kMutex = New-Object System.Threading.Mutex($false, 'Local\K-Harness-Desktop-47831')
$kLocked = $false
try {
  if (-not (Test-Path -LiteralPath (Join-Path $kRoot 'dist-ui\index.html'))) { throw 'K frontend is not built. Run npm run build:ui inside the K project.' }
  $kLocked = $kMutex.WaitOne(45000)
  if (-not $kLocked) { throw 'K is already starting. Please wait and open it again.' }
  $kReady = $null
  try { $kReady = Invoke-RestMethod "$kUrl/health" -TimeoutSec 2 } catch { $kReady = $null }
  if ($kReady -and ($kReady.app -ne 'k-harness-desktop' -or [IO.Path]::GetFullPath($kReady.workspace).TrimEnd('\','/') -ne [IO.Path]::GetFullPath($kRoot).TrimEnd('\','/'))) { throw 'Port 47831 belongs to another service. It has not been stopped.' }
  if (-not $kReady) {
    $kNode = (Get-Command node -ErrorAction Stop).Source
    $kCodexCommand = Get-Command codex -ErrorAction SilentlyContinue
    $kCodex = if ($kCodexCommand) { $kCodexCommand.Source } else { $null }
    if (-not $kCodex) {
      # Explorer shortcuts do not inherit the Codex app's private PATH.
      $kCodexBin = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
      $kInstalledCodex = Get-ChildItem -Path (Join-Path $kCodexBin '*\codex.exe') -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($kInstalledCodex) { $kCodex = $kInstalledCodex.FullName }
      elseif (Test-Path -LiteralPath (Join-Path $kCodexBin 'codex.exe')) { $kCodex = Join-Path $kCodexBin 'codex.exe' }
    }
    if (-not $kCodex) { throw 'Codex executable not found. Open the installed Codex app once, then start K again.' }
    $kLogs = Join-Path $kRoot '.runtime\desktop-logs'
    New-Item -ItemType Directory -Path $kLogs -Force | Out-Null
    $kStamp = [Guid]::NewGuid().ToString('N')
    $kArgs = '"' + (Join-Path $kRoot 'src\desktop-server.mjs') + '" "' + $kCodex + '"'
    $kProcess = Start-Process -FilePath $kNode -ArgumentList $kArgs -WorkingDirectory $kRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $kLogs "$kStamp.out.log") -RedirectStandardError (Join-Path $kLogs "$kStamp.err.log")
    $kDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
      Start-Sleep -Milliseconds 250
      $kProcess.Refresh()
      if ($kProcess.HasExited) { throw "K backend could not start. See $kLogs\$kStamp.err.log" }
      try { $kReady = Invoke-RestMethod "$kUrl/health" -TimeoutSec 1 } catch { $kReady = $null }
    } while (-not $kReady -and [DateTime]::UtcNow -lt $kDeadline)
    if (-not $kReady -or $kReady.app -ne 'k-harness-desktop') { throw 'K did not become ready. No existing process was terminated.' }
  }
  if (-not $NoBrowser) {
    $kBrowser = @('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($kBrowser) { Start-Process -FilePath $kBrowser -ArgumentList "--app=$kUrl" -WindowStyle Normal | Out-Null }
    else { Start-Process $kUrl | Out-Null }
  }
} catch {
  if ($NoBrowser) { throw }
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'K HARNESS') | Out-Null
  exit 1
} finally {
  if ($kLocked) { $kMutex.ReleaseMutex() }
  $kMutex.Dispose()
}
