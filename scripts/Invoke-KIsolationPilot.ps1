[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RunRoot,
    [Parameter(Mandatory = $true)][string]$OwnerSid,
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$OwnerProcessId,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$GitPath
)

$ErrorActionPreference = 'Stop'
$PilotBase = 'D:\K-harness\.runtime\isolation-pilot'
$SandboxName = 'KAgentSandbox'
$runId = $null
$createdAccount = $false
$creationAttempted = $false
$accountSid = $null
$sandboxPassword = $null
$passwordText = $null
$runRootCreated = $false
$result = [ordered]@{
    runId = $null
    status = 'failed'
    account = $SandboxName
    accountDisabled = $null
    checks = @()
    errors = @()
}

function Assert-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Invoke-KIsolationPilot must be run from an elevated PowerShell session.'
    }
}

function Assert-NoReparseAncestors([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $cursor = [IO.DirectoryInfo]$full
    while ($null -ne $cursor) {
        if ($cursor.Exists -and (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw "Reparse-point ancestor is not allowed: $($cursor.FullName)"
        }
        $cursor = $cursor.Parent
    }
}

function Add-AllowRule(
    [Security.AccessControl.DirectorySecurity]$Acl,
    [Security.Principal.SecurityIdentifier]$Sid,
    [Security.AccessControl.FileSystemRights]$Rights,
    [Security.AccessControl.InheritanceFlags]$Inheritance = [Security.AccessControl.InheritanceFlags]::None
) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $Sid, $Rights, $Inheritance, [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$Acl.AddAccessRule($rule)
}

function Set-PilotDirectoryAcl([string]$Path, [string]$Owner, [string]$Sandbox, [string]$Role) {
    $ownerId = [Security.Principal.SecurityIdentifier]::new($Owner)
    $systemId = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $adminsId = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $sandboxId = [Security.Principal.SecurityIdentifier]::new($Sandbox)
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in @($ownerId, $systemId, $adminsId)) {
        Add-AllowRule $acl $sid ([Security.AccessControl.FileSystemRights]::FullControl) $inherit
    }
    if ($Role -eq 'root') {
        Add-AllowRule $acl $sandboxId ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
    } elseif ($Role -eq 'tools') {
        Add-AllowRule $acl $sandboxId ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $inherit
    } elseif ($Role -eq 'workspace') {
        Add-AllowRule $acl $sandboxId ([Security.AccessControl.FileSystemRights]::Modify) $inherit
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function New-RandomPassword {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
        return ([BitConverter]::ToString($bytes) -replace '-', '') + 'aA9!'
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        $rng.Dispose()
    }
}

function Write-FakeSecret([string]$Path, [int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
        [IO.File]::WriteAllText($Path, [Convert]::ToBase64String($bytes), [Text.Encoding]::UTF8)
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        $rng.Dispose()
    }
}

function Get-ProcessOwnerSid([int]$ProcessId) {
    $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    if (-not $process) { throw 'OwnerProcessId does not identify a running process.' }
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop
    if ($owner.ReturnValue -ne 0 -or -not $owner.Sid) { throw 'Could not verify OwnerProcessId ownership.' }
    return [string]$owner.Sid
}

function Quote-Argument([string]$Value) {
    if ($Value.Contains('"')) { throw 'A process argument contains a quote.' }
    return '"' + $Value + '"'
}

try {
    Assert-Elevated
    $ownerIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $ownerSidObject = [Security.Principal.SecurityIdentifier]::new($OwnerSid)
    if ($ownerIdentity.User.Value -ne $ownerSidObject.Value) { throw 'OwnerSid must match the elevated caller identity.' }
    if ((Get-ProcessOwnerSid $OwnerProcessId) -ne $ownerSidObject.Value) { throw 'OwnerProcessId must belong to OwnerSid.' }

    $PilotBase = [IO.Path]::GetFullPath($PilotBase)
    $RunRoot = [IO.Path]::GetFullPath($RunRoot).TrimEnd('\', '/')
    $expectedPrefix = $PilotBase.TrimEnd('\') + '\'
    if (-not $RunRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'RunRoot must be a direct UUID child of the fixed pilot base.' }
    $leaf = [IO.Path]::GetFileName($RunRoot)
    $parsedGuid = [Guid]::Empty
    if (-not [Guid]::TryParseExact($leaf, 'D', [ref]$parsedGuid) -or $RunRoot.Substring($expectedPrefix.Length).Contains('\')) {
        throw 'RunRoot must be a new direct child named with a canonical UUID.'
    }
    $runId = $parsedGuid.ToString('D')
    $result.runId = $runId
    if (Get-LocalUser -Name $SandboxName -ErrorAction SilentlyContinue) { throw 'KAgentSandbox already exists; refusing to alter an unknown account.' }
    foreach ($value in @($NodePath, $GitPath)) {
        if (-not [IO.Path]::IsPathRooted($value) -or $value.Contains('"') -or -not (Test-Path -LiteralPath $value -PathType Leaf)) {
            throw 'NodePath and GitPath must be existing absolute executable paths without quotes.'
        }
    }
    $NodePath = [IO.Path]::GetFullPath($NodePath)
    $GitPath = [IO.Path]::GetFullPath($GitPath)

    Assert-NoReparseAncestors $PilotBase
    if (-not (Test-Path -LiteralPath $PilotBase -PathType Container)) { [void][IO.Directory]::CreateDirectory($PilotBase) }
    Assert-NoReparseAncestors $PilotBase
    if (Test-Path -LiteralPath $RunRoot) { throw 'RunRoot already exists; refusing to reuse or overwrite pilot data.' }
    [void][IO.Directory]::CreateDirectory($RunRoot)
    $runRootCreated = $true
    Assert-NoReparseAncestors $RunRoot

    $ownerDir = Join-Path $RunRoot 'owner-private'
    $toolsDir = Join-Path $RunRoot 'tools'
    $workspaceDir = Join-Path $RunRoot 'workspace'
    foreach ($directory in @($ownerDir, $toolsDir, $workspaceDir)) { [void][IO.Directory]::CreateDirectory($directory) }

    $passwordText = New-RandomPassword
    $sandboxPassword = ConvertTo-SecureString -String $passwordText -AsPlainText -Force
    $creationAttempted = $true
    [void](New-LocalUser -Name $SandboxName -Password $sandboxPassword -Description "K pilot $runId" -AccountNeverExpires)
    $createdAccount = $true
    $passwordText = $null
    Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $SandboxName
    $accountSid = (Get-LocalUser -Name $SandboxName).SID.Value
    $adminMembers = Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop
    if ($adminMembers | Where-Object { $_.SID.Value -eq $accountSid }) { throw 'KAgentSandbox is a member of Administrators; refusing to run the pilot.' }

    Set-PilotDirectoryAcl $RunRoot $ownerSidObject.Value $accountSid 'root'
    Set-PilotDirectoryAcl $ownerDir $ownerSidObject.Value $accountSid 'private'
    Set-PilotDirectoryAcl $toolsDir $ownerSidObject.Value $accountSid 'tools'
    Set-PilotDirectoryAcl $workspaceDir $ownerSidObject.Value $accountSid 'workspace'
    [void][IO.Directory]::CreateDirectory((Join-Path $workspaceDir 'temp'))
    [void][IO.Directory]::CreateDirectory((Join-Path $workspaceDir 'tmp'))
    $fakeCookiePath = Join-Path $ownerDir 'fake-cookie.txt'
    $fakeTokenPath = Join-Path $ownerDir 'fake-human-token.txt'
    $trustedFixturePath = Join-Path $ownerDir 'trusted-runtime.fixture.txt'
    Write-FakeSecret $fakeCookiePath 32
    Write-FakeSecret $fakeTokenPath 32
    [IO.File]::WriteAllText($trustedFixturePath, 'K_ISOLATION_FAKE_TRUSTED_FIXTURE', [Text.Encoding]::UTF8)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Test-KIsolationIdentity.ps1') -Destination (Join-Path $toolsDir 'Test-KIsolationIdentity.ps1')
    Assert-NoReparseAncestors $RunRoot

    $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $testScript = Join-Path $toolsDir 'Test-KIsolationIdentity.ps1'
    $arguments = @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        (Quote-Argument $testScript), '-RunRoot', (Quote-Argument $RunRoot),
        '-OwnerSid', (Quote-Argument $ownerSidObject.Value), '-SandboxSid', (Quote-Argument $accountSid),
        '-OwnerProcessId', [string]$OwnerProcessId, '-NodePath', (Quote-Argument $NodePath), '-GitPath', (Quote-Argument $GitPath)
    ) -join ' '
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $powerShell
    $startInfo.Arguments = $arguments
    $startInfo.WorkingDirectory = $workspaceDir
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.UserName = $SandboxName
    $startInfo.Domain = '.'
    $startInfo.Password = $sandboxPassword
    # Replace the inherited environment: never carry human credentials or user-profile paths into the low-privilege child.
    $startInfo.EnvironmentVariables.Clear()
    $startInfo.EnvironmentVariables['SystemRoot'] = $env:SystemRoot
    $startInfo.EnvironmentVariables['WINDIR'] = $env:WINDIR
    $startInfo.EnvironmentVariables['PATH'] = Join-Path $env:SystemRoot 'System32'
    $startInfo.EnvironmentVariables['TEMP'] = Join-Path $workspaceDir 'temp'
    $startInfo.EnvironmentVariables['TMP'] = Join-Path $workspaceDir 'tmp'
    $startInfo.EnvironmentVariables['USERPROFILE'] = $workspaceDir
    $startInfo.LoadUserProfile = $false
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'Low-privilege identity process did not start.' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(90000)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'The isolated identity probe exceeded 90 seconds and was stopped.'
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $childResult = $null
        try { $childResult = $stdout | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Identity test did not return valid JSON.' }
        $result.accountSid = $accountSid
        $result.actualChildSid = $childResult.currentSid
        if ($childResult.currentSid -ne $accountSid) { throw 'The child did not run under the newly created account SID.' }
        if ((Get-ProcessOwnerSid $OwnerProcessId) -ne $ownerSidObject.Value) { throw 'Owner process changed during the memory probe.' }
        $result.checks = @($childResult.checks)
        if ($process.ExitCode -ne 0 -or $childResult.status -ne 'passed') {
            $result.errors += 'The low-privilege identity checks did not all pass.'
            if ($stderr) { $result.errors += 'The test process reported an error (details omitted from this result).'}
        } else {
            $result.status = 'passed'
        }
    } finally {
        $process.Dispose()
        $startInfo.Password = $null
        $sandboxPassword = $null
    }
} catch {
    $result.errors += $_.Exception.Message
} finally {
    $passwordText = $null
    $sandboxPassword = $null
    $pilotAccountOwned = $createdAccount
    if (-not $pilotAccountOwned -and $creationAttempted -and $runId) {
        try {
            $partialAccount = Get-LocalUser -Name $SandboxName -ErrorAction Stop
            $pilotAccountOwned = ($partialAccount.Description -eq "K pilot $runId")
        } catch { $pilotAccountOwned = $false }
    }
    if ($pilotAccountOwned) {
        try {
            Disable-LocalUser -Name $SandboxName -ErrorAction Stop
            $enabledAfter = (Get-LocalUser -Name $SandboxName -ErrorAction Stop).Enabled
            $result.accountDisabled = ($enabledAfter -eq $false)
            if ($enabledAfter -ne $false) { $result.status = 'failed'; $result.errors += 'KAgentSandbox could not be verified disabled.' }
        } catch {
            $result.accountDisabled = $false
            $result.status = 'failed'
            $result.errors += 'KAgentSandbox disable/readback failed; manual review is required.'
        }
    }
    if ($runRootCreated) {
        $resultPath = Join-Path $RunRoot 'result.json'
        try {
            [IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Depth 8), [Text.Encoding]::UTF8)
        } catch {
            $result.status = 'failed'
            $result.errors += 'Could not write the pilot result JSON inside RunRoot.'
        }
    }
}

$result | ConvertTo-Json -Depth 8
if ($result.status -ne 'passed') { exit 1 }
