[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9a-f]{40}$")]
    [string]$Ref,

    [Parameter(Mandatory = $true)]
    [int]$LauncherPid,

    # Tests run this script in the background; nothing may appear on the desktop then.
    [switch]$NoWindow
)

# Runs from the repository root, outside the runtime that Update-K.ps1 replaces. Never touches
# phone sign-in files and never ends any process; the tray launcher already closed K normally.
$ErrorActionPreference = "Stop"
try { $Host.UI.RawUI.WindowTitle = "K 更新中" } catch {}

$root = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $root ".local"
$logPath = Join-Path $localDir "self-update.log"
$errorLogPath = Join-Path $localDir "self-update-error.log"
$resultPath = Join-Path $localDir "self-update-result.json"
$launcherExe = Join-Path $root "local-launcher\dist\K桌面啟動器.exe"
$fromVersion = $null
$updateSuccess = $false
$failureReason = "更新沒有完成。"
$launcherGone = $false
$updateLock = $null

# The only thing a person can see while K is closed: a small window in the taskbar with the current
# step and the time spent. It closes itself once K answers again. The launcher starts this script
# hidden, and Windows ignores a hidden process's first request to show a window, so the window is
# shown a second time through user32.
$window = $null
$stepLabel = $null
$timeLabel = $null
$note = $null
$startedAt = [DateTime]::UtcNow
if (-not $NoWindow) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        Add-Type -Namespace KUpdate -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);'
        $window = New-Object System.Windows.Forms.Form
        $window.Text = "K 更新中"
        $window.Font = New-Object System.Drawing.Font("Microsoft JhengHei UI", 11)
        $window.ClientSize = New-Object System.Drawing.Size(520, 190)
        $window.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
        $window.MaximizeBox = $false
        $window.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
        $iconPath = Join-Path $root "frontend\assets\k-logo.ico"
        if (Test-Path -LiteralPath $iconPath) { $window.Icon = New-Object System.Drawing.Icon($iconPath) }
        $stepLabel = New-Object System.Windows.Forms.Label
        $stepLabel.Location = New-Object System.Drawing.Point(24, 22)
        $stepLabel.Size = New-Object System.Drawing.Size(472, 60)
        $stepLabel.Font = New-Object System.Drawing.Font("Microsoft JhengHei UI", 13, [System.Drawing.FontStyle]::Bold)
        $timeLabel = New-Object System.Windows.Forms.Label
        $timeLabel.Location = New-Object System.Drawing.Point(24, 88)
        $timeLabel.Size = New-Object System.Drawing.Size(472, 28)
        $note = New-Object System.Windows.Forms.Label
        $note.Location = New-Object System.Drawing.Point(24, 124)
        $note.Size = New-Object System.Drawing.Size(472, 54)
        $note.AutoEllipsis = $true
        $note.Text = "完成後 K 會自動重新開啟，不用自己開 K；手機畫面留著不用動，K 回來會自己重新整理。"
        $window.Controls.AddRange(@($stepLabel, $timeLabel, $note))
        $window.Show()
        # 4 = shown without taking the focus from whatever the person is doing.
        [void][KUpdate.Native]::ShowWindow($window.Handle, 4)
        [System.Windows.Forms.Application]::DoEvents()
    } catch { $window = $null }
}
function Show-Step([string]$text) {
    Write-Host $text
    if ($window) { try { $stepLabel.Text = $text; [System.Windows.Forms.Application]::DoEvents() } catch {} }
}
function Show-Note([string]$text) {
    if ($window) { try { $note.Text = $text; [System.Windows.Forms.Application]::DoEvents() } catch {} }
}
function Update-Clock {
    if (-not $window) { return }
    try {
        $spent = [DateTime]::UtcNow - $startedAt
        $timeLabel.Text = "已經過 {0}:{1:00}，大概要 2～3 分鐘。" -f [int][Math]::Floor($spent.TotalMinutes), $spent.Seconds
        [System.Windows.Forms.Application]::DoEvents()
    } catch {}
}
# Which step the installer is in, from what it has written so far; the log is read while it is still open.
function Get-Step {
    try {
        $stream = New-Object System.IO.FileStream($logPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $text = $reader.ReadToEnd()
        $reader.Dispose()
        if ($text -match '程式已套用') { return "新版本已套用…" }
        if ($text -match 'k-harness@\S+ test') { return "新版本測試中（約 1～2 分鐘）…" }
        if ($text -match 'vite v') { return "新版本建置中…" }
    } catch {}
    return "新版本準備中…"
}
function Test-KListening {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $listening = $client.ConnectAsync("127.0.0.1", 47831).Wait(300)
        $client.Dispose()
        return $listening
    } catch { return $false }
}

# The real cause is what the installer (Node, UTF-8) printed. Update-K.ps1 throws only a generic message,
# which the wrapper below writes in the console code page (it reads back with replacement characters);
# the installer's own "build left at …" notice comes after the cause. Without a console, Windows
# PowerShell also writes progress records to stderr as CLIXML ("#< CLIXML", "<Objs …>"). Those lines
# are skipped.
function Get-FailureLine([string]$fallback) {
    try {
        $candidates = @(@($logPath, $errorLogPath) | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
            Get-Content -LiteralPath $_ -Encoding utf8
        } | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_) -and -not $_.Contains([char]0xFFFD) -and
            $_ -notmatch 'K 更新未完成|未套用的建置暫存留在|^\s*#< CLIXML|^\s*<Objs\b'
        })
        $line = if ($candidates.Count -gt 0) { [string]$candidates[$candidates.Count - 1] } else { $fallback }
        $line = $line.Trim()
        if ($line.Length -gt 200) { $line = $line.Substring(0, 200) }
        # The installer found K listening again (2026-10-24: the K icon was clicked while tests were still
        # running). Say what happened in the button's terms instead of asking to "leave and stop K".
        if ($line -match '離開並停止 K') { $line = "更新進行中 K 又被開啟了，這次沒有套用；再按一次更新即可。" }
        return $line
    } catch {
        return $fallback
    }
}

try {
    # Until K is started again below, a launcher opened by hand sees this name and does not start K:
    # the installer stops when K is listening, and a running launcher holds the exe the update
    # replaces. The name disappears with this process, so a crash never locks K out. Best effort: if
    # the name cannot be created, the update still runs and K is still started again below.
    try { $updateLock = New-Object System.Threading.Mutex($false, "Local\KHarnessSelfUpdate") } catch {}

    Show-Step "等待 K 完全關閉…"
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        $proc = Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue
        if (-not $proc -or $proc.HasExited) { $launcherGone = $true; break }
        Start-Sleep -Milliseconds 250
        Update-Clock
    }
    if (-not $launcherGone) {
        # The old launcher is still running: replacing its exe would fail, so nothing is applied.
        $failureReason = "啟動器沒有結束，這次沒有更新。"
        return
    }

    try {
        $runtime = [System.IO.File]::ReadAllText((Join-Path $localDir "runtime.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($runtime.version) { $fromVersion = [string]$runtime.version }
    } catch {}

    Show-Step "新版本準備中…"
    # A separate process with raw redirection: Windows PowerShell would otherwise turn ordinary
    # git or npm messages on stderr into terminating errors. Only the exit code decides success.
    # Update-K.ps1 stays unchanged for people and other agents; this wrapper turns its throw into a
    # one-line message and exit code instead of a PowerShell error record.
    $updateScript = (Join-Path $root 'Update-K.ps1').Replace("'", "''")
    $wrapper = "`$ProgressPreference = 'SilentlyContinue'; & { try { & '$updateScript' -Ref $Ref; exit 0 } catch { [Console]::Error.WriteLine(`$_.Exception.Message); exit 1 } }"
    $update = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($wrapper))
    ) -WorkingDirectory $root -NoNewWindow -PassThru -RedirectStandardOutput $logPath -RedirectStandardError $errorLogPath
    # Windows PowerShell reports the exit code only for a process whose handle it opened before the exit.
    $null = $update.Handle
    $lastStep = ""
    while (-not $update.HasExited) {
        Start-Sleep -Milliseconds 500
        Update-Clock
        if ($window) {
            $step = Get-Step
            if ($step -ne $lastStep) { $lastStep = $step; Show-Step $step }
        }
    }
    $update.WaitForExit()
    $updateSuccess = $update.ExitCode -eq 0
    if (-not $updateSuccess) { $failureReason = Get-FailureLine "更新執行失敗，代碼 $($update.ExitCode)" }
} catch {
    $updateSuccess = $false
    $failureReason = Get-FailureLine $(if ($_.Exception.Message) { $_.Exception.Message } else { "更新沒有完成。" })
} finally {
    try {
        $result = [ordered]@{ ok = $updateSuccess; from = $fromVersion; to = $Ref; finishedAt = [DateTime]::UtcNow.ToString("o") }
        if (-not $updateSuccess) { $result.reason = $failureReason }
        [System.IO.File]::WriteAllText($resultPath, (ConvertTo-Json -InputObject $result -Compress), (New-Object System.Text.UTF8Encoding($false)))
    } catch {}
    if ($updateLock) { $updateLock.Dispose() }
    # Bring K back whatever happened, unless the old launcher is still the one running.
    if ($launcherGone -and (Test-Path -LiteralPath $launcherExe)) {
        if ($updateSuccess) { Show-Step "更新完成，K 重新啟動中…" }
        else { Show-Step "更新沒成功，K 以原版重新啟動中…"; Show-Note "原因：$failureReason" }
        Start-Process -FilePath $launcherExe -WorkingDirectory $root
        # The window stays until K answers again (at most 90 seconds), then a moment longer so the
        # outcome can be read: K's own window follows a few seconds after its port answers.
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        while ($window -and [DateTime]::UtcNow -lt $deadline -and -not (Test-KListening)) { Start-Sleep -Milliseconds 500; Update-Clock }
        $deadline = [DateTime]::UtcNow.AddSeconds($(if ($updateSuccess) { 2 } else { 10 }))
        while ($window -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500; Update-Clock }
    } elseif ($window) {
        if ($launcherGone) { Show-Step "找不到 K 啟動器，這次沒有重新開啟 K；請交給 AI 檢查。" }
        else { Show-Step "啟動器沒有結束，這次沒有更新；請從系統匣或桌面捷徑重新開啟 K。" }
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while ([DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500; Update-Clock }
    }
    if ($window) { try { $window.Close(); $window.Dispose() } catch {} }
}
if (-not $updateSuccess) { exit 1 }
