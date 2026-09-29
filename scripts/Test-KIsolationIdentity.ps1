[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RunRoot,
    [Parameter(Mandatory = $true)][string]$OwnerSid,
    [Parameter(Mandatory = $true)][string]$SandboxSid,
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$OwnerProcessId,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$GitPath
)

$ErrorActionPreference = 'Stop'
$checks = [System.Collections.Generic.List[object]]::new()
$failed = $false

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail = '') {
    $script:checks.Add([ordered]@{ name = $Name; passed = $Passed; detail = $Detail })
    if (-not $Passed) { $script:failed = $true }
}

function Is-AccessDenied([Exception]$ErrorRecordException) {
    while ($null -ne $ErrorRecordException) {
        if ($ErrorRecordException -is [UnauthorizedAccessException]) { return $true }
        if (($ErrorRecordException.HResult -band 0xFFFF) -eq 5) { return $true }
        $ErrorRecordException = $ErrorRecordException.InnerException
    }
    return $false
}

function Invoke-VersionCheck([string]$Executable, [string]$Name) {
    try {
        if (-not [IO.Path]::IsPathRooted($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
            Add-Check $Name $false 'Executable path is unavailable.'
            return
        }
        $info = [Diagnostics.ProcessStartInfo]::new()
        $info.FileName = [IO.Path]::GetFullPath($Executable)
        $info.Arguments = '--version'
        $info.WorkingDirectory = (Join-Path $RunRoot 'workspace')
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $process = [Diagnostics.Process]::new()
        $process.StartInfo = $info
        try {
            if (-not $process.Start()) { Add-Check $Name $false 'Process did not start.'; return }
            $outTask = $process.StandardOutput.ReadToEndAsync()
            $errTask = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(15000)) { $process.Kill(); $process.WaitForExit(); throw 'Tool version probe timed out.' }
            $version = $outTask.GetAwaiter().GetResult().Trim()
            [void]$errTask.GetAwaiter().GetResult()
            Add-Check $Name ($process.ExitCode -eq 0 -and $version.Length -gt 0) $(if ($process.ExitCode -eq 0 -and $version.Length -gt 0) { $version } else { 'Version command failed.' })
        } finally { $process.Dispose() }
    } catch { Add-Check $Name $false 'Version command could not be started.' }
}

try {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $currentSid = $current.User.Value
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Add-Check 'identity-is-sandbox-user' ($currentSid -eq $SandboxSid -and $currentSid -ne $OwnerSid) 'Current SID must equal the new sandbox SID and differ from OwnerSid.'
    Add-Check 'identity-is-not-administrator' (-not $isAdmin) 'Windows principal must not be an administrator.'

    $expectedRoot = 'D:\K-harness\.runtime\isolation-pilot\' + [IO.Path]::GetFileName([IO.Path]::GetFullPath($RunRoot))
    Add-Check 'runroot-is-fixed-pilot-child' ([IO.Path]::GetFullPath($RunRoot).Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) 'RunRoot must be a direct child of the fixed pilot base.'
    $workspace = Join-Path $RunRoot 'workspace'
    $ownerPrivate = Join-Path $RunRoot 'owner-private'
    $fakeCookie = Join-Path $ownerPrivate 'fake-cookie.txt'
    $fakeHumanToken = Join-Path $ownerPrivate 'fake-human-token.txt'
    $trustedFixture = Join-Path $ownerPrivate 'trusted-runtime.fixture.txt'

    try {
        [void][IO.File]::ReadAllText($fakeCookie)
        Add-Check 'fake-cookie-read-denied' $false 'The sandbox identity read the owner-only fake cookie.'
    } catch {
        Add-Check 'fake-cookie-read-denied' (Is-AccessDenied $_.Exception) 'Read must fail specifically with access denied.'
    }
    try {
        [void][IO.File]::ReadAllText($fakeHumanToken)
        Add-Check 'fake-human-token-read-denied' $false 'The sandbox identity read the owner-only fake token.'
    } catch {
        Add-Check 'fake-human-token-read-denied' (Is-AccessDenied $_.Exception) 'Read must fail specifically with access denied.'
    }
    try {
        [IO.File]::WriteAllText($trustedFixture, 'K_ISOLATION_FAKE_TRUSTED_FIXTURE')
        Add-Check 'trusted-fixture-write-denied' $false 'The sandbox identity could write the owner-only fake fixture.'
    } catch {
        Add-Check 'trusted-fixture-write-denied' (Is-AccessDenied $_.Exception) 'Write must fail specifically with access denied.'
    }

    try {
        if (-not (Test-Path -LiteralPath $workspace -PathType Container)) { throw 'Workspace unavailable.' }
        $probe = Join-Path $workspace 'sandbox-write-read.probe'
        $probeText = 'K_ISOLATION_WORKSPACE_PROBE'
        [IO.File]::WriteAllText($probe, $probeText)
        $readback = [IO.File]::ReadAllText($probe)
        Add-Check 'workspace-read-write' ($readback -eq $probeText) 'A synthetic workspace file must be writable and readable.'
    } catch { Add-Check 'workspace-read-write' $false 'Workspace read/write failed.' }

    try {
        # The trusted parent verifies SID before and after the child. A low
        # privilege CIM GetOwnerSid failure must not skip the actual VM_READ test.
        $ownerProcess = [Diagnostics.Process]::GetProcessById($OwnerProcessId)
        if ($ownerProcess.HasExited) { throw 'Owner process exited before the memory probe.' }
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KIsolationNative {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@ -ErrorAction Stop
        $handle = [KIsolationNative]::OpenProcess(0x0010, $false, $OwnerProcessId)
        if ($handle -eq [IntPtr]::Zero) {
            $win32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            Add-Check 'owner-process-vm-read-denied' ($win32 -eq 5) $(if ($win32 -eq 5) { 'OpenProcess(PROCESS_VM_READ) returned ACCESS_DENIED.' } else { "Unexpected Win32 error $win32; owner memory isolation not proven." })
        } else {
            [void][KIsolationNative]::CloseHandle($handle)
            Add-Check 'owner-process-vm-read-denied' $false 'The sandbox identity opened the owner process for VM_READ.'
        }
    } catch { Add-Check 'owner-process-vm-read-denied' $false 'OpenProcess probe failed; owner memory isolation not proven.' }

    Invoke-VersionCheck $NodePath 'node-version'
    Invoke-VersionCheck $GitPath 'git-version'
} catch {
    Add-Check 'test-harness' $false 'The identity test harness failed before completing all checks.'
}

$result = [ordered]@{
    status = if ($failed) { 'failed' } else { 'passed' }
    currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    ownerSid = $OwnerSid
    checks = @($checks.ToArray())
}
$result | ConvertTo-Json -Depth 6 -Compress
if ($failed) { exit 1 }
