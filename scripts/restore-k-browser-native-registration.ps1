param([Parameter(Mandatory=$true)][string]$BackupDirectory)
$ErrorActionPreference='Stop'
$state=Get-Content -LiteralPath (Join-Path $BackupDirectory 'registration-before.json') -Raw | ConvertFrom-Json
$key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.k_harness.browser_assistant'
if($state.key -ne $key){throw 'Not a K native-host registration backup'}
if($state.existed){
 New-Item -Path $key -Force|Out-Null
 Set-Item -Path $key -Value $state.value
 if((Get-Item $key).GetValue('') -ne $state.value){throw 'Registration restore mismatch'}
}elseif(Test-Path $key){
 # Registry entry only; no filesystem deletion or other native hosts.
 [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey('Software\Google\Chrome\NativeMessagingHosts\com.k_harness.browser_assistant',$true)
 if(Test-Path $key){throw 'Registration restore mismatch'}
}
'K native-host registration restored; project files retained.'
