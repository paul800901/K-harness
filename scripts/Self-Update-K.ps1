[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9a-f]{40}$")]
    [string]$Ref,

    [Parameter(Mandatory = $true)]
    [int]$LauncherPid
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
        return $line
    } catch {
        return $fallback
    }
}

try {
    Write-Host "等待 K 完全關閉…"
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        $proc = Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue
        if (-not $proc -or $proc.HasExited) { $launcherGone = $true; break }
        Start-Sleep -Milliseconds 250
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

    Write-Host "正在測試並套用新版本（約 2～3 分鐘）…"
    # A separate process with raw redirection: Windows PowerShell would otherwise turn ordinary
    # git or npm messages on stderr into terminating errors. Only the exit code decides success.
    # Update-K.ps1 stays unchanged for people and other agents; this wrapper turns its throw into a
    # one-line message and exit code instead of a PowerShell error record.
    $updateScript = (Join-Path $root 'Update-K.ps1').Replace("'", "''")
    $wrapper = "`$ProgressPreference = 'SilentlyContinue'; & { try { & '$updateScript' -Ref $Ref; exit 0 } catch { [Console]::Error.WriteLine(`$_.Exception.Message); exit 1 } }"
    $update = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($wrapper))
    ) -WorkingDirectory $root -NoNewWindow -Wait -PassThru -RedirectStandardOutput $logPath -RedirectStandardError $errorLogPath
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
    # Bring K back whatever happened, unless the old launcher is still the one running.
    if ($launcherGone -and (Test-Path -LiteralPath $launcherExe)) {
        Write-Host "正在重新啟動 K…"
        Start-Process -FilePath $launcherExe -WorkingDirectory $root
    }
}
if (-not $updateSuccess) { exit 1 }
