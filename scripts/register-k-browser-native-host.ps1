param(
 [Parameter(Mandatory=$true)][string]$HostDirectory,
 [Parameter(Mandatory=$true)][string]$ConfigPath,
 [Parameter(Mandatory=$true)][string]$BackupDirectory
)
$ErrorActionPreference='Stop'
# Deliberately scoped to this one per-user host; no service or startup entry.
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach($p in @($HostDirectory,$ConfigPath,$BackupDirectory)) {
 if(![IO.Path]::GetFullPath($p).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Native host paths must stay inside K'}
}
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if($config.extensionId -notmatch '^[a-p]{32}$'){throw 'Invalid extension identity'}
$hostScript=Join-Path $HostDirectory 'host.mjs'
if(!(Test-Path -LiteralPath $hostScript -PathType Leaf)){throw 'Missing native host script'}
New-Item -ItemType Directory -Path $BackupDirectory -ErrorAction Stop | Out-Null
$key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.k_harness.browser_assistant'
$priorExists=Test-Path $key
$priorValue=if($priorExists){(Get-Item $key).GetValue('')}else{$null}
@{key=$key;existed=$priorExists;value=$priorValue}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $BackupDirectory 'registration-before.json') -Encoding utf8
foreach($name in @('host.bat','com.k_harness.browser_assistant.json')) {
 $file=Join-Path $HostDirectory $name
 if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination (Join-Path $BackupDirectory $name)}
}
$node=(Get-Command node -ErrorAction Stop).Source
$bat='@echo off'+"`r`n"+'"'+$node+'" "'+$hostScript+'" --config "'+[IO.Path]::GetFullPath($ConfigPath)+'" %*'+"`r`n"
[IO.File]::WriteAllText((Join-Path $HostDirectory 'host.bat'),$bat,[Text.Encoding]::ASCII)
$manifest=Join-Path $HostDirectory 'com.k_harness.browser_assistant.json'
$manifestJson=@{name='com.k_harness.browser_assistant';description='K browser assistant background connection';path=(Join-Path $HostDirectory 'host.bat');type='stdio';allowed_origins=@("chrome-extension://$($config.extensionId)/")}|ConvertTo-Json
[IO.File]::WriteAllText($manifest,$manifestJson,(New-Object Text.UTF8Encoding($false)))
New-Item -Path $key -Force|Out-Null
Set-Item -Path $key -Value $manifest
if((Get-Item $key).GetValue('') -ne $manifest){throw 'Native host registration readback mismatch'}
@{manifest=$manifest;backup=$BackupDirectory;scope='HKCU K browser assistant only';verified=$true}|ConvertTo-Json
