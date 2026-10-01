param([string]$Ref,[switch]$Rollback,[string]$InstallRoot=$PSScriptRoot,[switch]$PrepareOnly)
$ErrorActionPreference='Stop'
if($Rollback -and ($Ref -or $PrepareOnly)){throw '退版不能與指定版本或僅建置合用。'}
if(-not $Rollback -and -not $Ref){throw '請指定 -Ref 版本標記，或 -Rollback 退回上一版。'}
$arguments=@((Join-Path $PSScriptRoot 'scripts\manage-install.mjs'),'--root',$InstallRoot)
if($Rollback){$arguments+='--rollback'}else{$arguments+=@('--fetch','--ref',$Ref)}
if($PrepareOnly){$arguments+='--prepare-only'}
& node @arguments
if($LASTEXITCODE -ne 0){throw 'K 更新未完成；沒有強制結束工作，請保留錯誤交給 AI 檢查。'}
