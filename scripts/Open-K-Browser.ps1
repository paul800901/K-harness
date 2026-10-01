param([switch]$Incognito)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$vault=Join-Path $root '.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault'
$config=Join-Path $vault 'k-browser-assistant.json'
if(!(Test-Path -LiteralPath $config)){throw '請先執行 scripts/Setup-K-Browser.ps1 設定 K 瀏覽器助手。'}
$chrome=(Get-Content -LiteralPath $config -Encoding UTF8 -Raw | ConvertFrom-Json).chromeExecutable
if(!$chrome -or !(Test-Path -LiteralPath $chrome -PathType Leaf)){throw '找不到設定的 Chrome，請重新執行 Setup-K-Browser.ps1。'}
$arguments=@(('"--user-data-dir='+ (Join-Path $vault 'k-chrome-profile') +'"'),'--enable-features=CDPScreenshotNewSurface','--new-window','about:blank')
if($Incognito){$arguments+='--incognito'}
Start-Process -FilePath $chrome -ArgumentList $arguments
