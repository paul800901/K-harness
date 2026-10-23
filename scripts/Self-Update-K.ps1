[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9a-f]{40}$")]
    [string]$Ref,

    [Parameter(Mandatory = $true)]
    [int]$LauncherPid
)

$ErrorActionPreference = "Stop"

try {
    $Host.UI.RawUI.WindowTitle = "K 更新中"
} catch {}

$root = Split-Path -Parent $PSScriptRoot

Write-Host "等待 K 完全關閉…"

# 等待 LauncherPid 結束（最多 60 秒）
$waitStart = [System.Diagnostics.Stopwatch]::StartNew()
while ($waitStart.Elapsed.TotalSeconds -lt 60) {
    $proc = Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.HasExited) {
        break
    }
    Start-Sleep -Milliseconds 250
}

# 讀取 .local/runtime.json 的 version 作為 from
$runtimeJsonPath = Join-Path $root ".local\runtime.json"
$fromVersion = $null
if (Test-Path -LiteralPath $runtimeJsonPath) {
    try {
        $runtimeContent = [System.IO.File]::ReadAllText($runtimeJsonPath, [System.Text.Encoding]::UTF8)
        $runtimeObj = ConvertFrom-Json $runtimeContent
        if ($runtimeObj -and $runtimeObj.version) {
            $fromVersion = [string]$runtimeObj.version
        }
    } catch {}
}

Write-Host "正在測試並套用新版本（約 2～3 分鐘）…"

$localDir = Join-Path $root ".local"
if (-not (Test-Path -LiteralPath $localDir)) {
    New-Item -ItemType Directory -Path $localDir -Force | Out-Null
}
$logPath = Join-Path $localDir "self-update.log"
$resultPath = Join-Path $localDir "self-update-result.json"

$updateScript = Join-Path $root "Update-K.ps1"
$updateSuccess = $false
$failureReason = $null

# Update-K.ps1 throws a generic message on failure; the real cause is the last line of its log.
function Get-LastLogLine([string]$fallback) {
    $lines = @(Get-Content -LiteralPath $logPath -Encoding utf8 -ErrorAction SilentlyContinue) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -notmatch 'K 更新未完成' }
    $line = if ($lines.Count -gt 0) { $lines[-1].Trim() } else { $fallback }
    if ($line.Length -gt 200) { $line = $line.Substring(0, 200) }
    return $line
}

try {
    # 執行 Update-K.ps1 並將完整輸出寫入 .local/self-update.log（覆寫）
    & $updateScript -Ref $Ref *>&1 | Out-File -LiteralPath $logPath -Encoding utf8 -Force
    $updateSuccess = $LASTEXITCODE -eq 0
    if (-not $updateSuccess) { $failureReason = Get-LastLogLine "更新執行失敗，代碼 $LASTEXITCODE" }
} catch {
    $updateSuccess = $false
    $failureReason = Get-LastLogLine $(if ($_.Exception.Message) { $_.Exception.Message } else { '執行 Update-K.ps1 失敗' })
}

$finishedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

if ($updateSuccess) {
    $resultData = @{
        ok = $true
        from = $fromVersion
        to = $Ref
        finishedAt = $finishedAt
    }
} else {
    $resultData = @{
        ok = $false
        from = $fromVersion
        to = $Ref
        finishedAt = $finishedAt
        reason = $failureReason
    }
}

# 用 UTF-8 無 BOM 寫入 .local/self-update-result.json
$jsonResult = ConvertTo-Json -InputObject $resultData -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($resultPath, $jsonResult, $utf8NoBom)

Write-Host "正在重新啟動 K…"

# 不論成敗都啟動啟動器把 K 開回來
$launcherExe = Join-Path $root "local-launcher\dist\K桌面啟動器.exe"
if (Test-Path -LiteralPath $launcherExe) {
    Start-Process -FilePath $launcherExe -WorkingDirectory $root
}

if ($updateSuccess) {
    Start-Sleep -Seconds 2
    exit 0
} else {
    Write-Host "更新失敗：$failureReason"
    Start-Sleep -Seconds 15
    exit 1
}
