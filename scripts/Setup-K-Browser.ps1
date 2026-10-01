param([string]$ChromeExecutable)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$candidate = Join-Path $root '.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee'
$runtime = Join-Path $candidate 'trusted-runtime'
$vault = Join-Path $candidate 'vault'
$extensionSource = Join-Path $runtime 'browser-extension\dist'
$extensionDirectory = Join-Path $root 'installed\k-browser-assistant'
$hostDirectory = $extensionDirectory
$extensionId = 'jhbfglfjhiebacbkjnohgmpgcppadblm'
$browserConfigPath = Join-Path $vault 'k-browser-assistant.json'
$nativeConfigPath = Join-Path $vault 'k-browser-assistant-nativehost.json'
$profileDirectory = Join-Path $vault 'k-chrome-profile'
$descriptorPath = Join-Path $vault 'k-browser-native-link.json'
$nativeHostSource = Join-Path $runtime 'scripts\k-browser-native-host.mjs'
$registerScript = Join-Path $PSScriptRoot 'register-k-browser-native-host.ps1'

if (!(Test-Path -LiteralPath (Join-Path $extensionSource 'manifest.json') -PathType Leaf) -or !(Test-Path -LiteralPath $nativeHostSource -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $runtime 'node_modules\ws\package.json') -PathType Leaf)) {
  throw 'K runtime 不完整；請先執行主安裝器完成 trusted-runtime，再執行本設定。'
}
if (!(Test-Path -LiteralPath $registerScript -PathType Leaf)) { throw "Native host registration script is missing: $registerScript" }
$manifest = Get-Content -LiteralPath (Join-Path $extensionSource 'manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json
if ($manifest.manifest_version -ne 3 -or $manifest.name -ne 'K 瀏覽器助手') { throw 'Trusted runtime 中不是預期的 K 瀏覽器擴充。' }

if (!$ChromeExecutable) {
  $found = Get-Command chrome.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $candidates = @()
  if ($found) { $candidates += $found.Source }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ($base) { $candidates += (Join-Path $base 'Google\Chrome\Application\chrome.exe') }
  }
  $ChromeExecutable = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (!$ChromeExecutable -or !(Test-Path -LiteralPath $ChromeExecutable -PathType Leaf)) { throw '找不到 Chrome；請用 -ChromeExecutable 指定 chrome.exe 完整路徑。' }
$ChromeExecutable = [IO.Path]::GetFullPath($ChromeExecutable)

New-Item -ItemType Directory -Path $vault -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backupDirectory = Join-Path $vault "k-browser-assistant-backups\setup-$stamp"
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
if (Test-Path -LiteralPath $extensionDirectory) {
  Copy-Item -LiteralPath $extensionDirectory -Destination (Join-Path $backupDirectory 'extension-before') -Recurse -Force
}
New-Item -ItemType Directory -Path $extensionDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $extensionSource -Force | Copy-Item -Destination $extensionDirectory -Recurse -Force

$browserConfig = [ordered]@{ enabled = $true; extensionId = $extensionId; chromeExecutable = $ChromeExecutable }
$nativeConfig = [ordered]@{ extensionId = $extensionId; profileDirectory = $profileDirectory; descriptorPath = $descriptorPath }
foreach ($path in @($browserConfigPath, $nativeConfigPath)) {
  if (Test-Path -LiteralPath $path -PathType Leaf) { Copy-Item -LiteralPath $path -Destination (Join-Path $backupDirectory ([IO.Path]::GetFileName($path) + '.before')) }
}
[IO.File]::WriteAllText($browserConfigPath, ($browserConfig | ConvertTo-Json) + "`n", (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText($nativeConfigPath, ($nativeConfig | ConvertTo-Json) + "`n", (New-Object Text.UTF8Encoding($false)))

# Import the runtime module and call its exported entry points; it is deliberately not treated as the main module.
$wrapper = @'
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulePath = path.join(root, '.runtime', 'isolation-pilot', 'sandboxie-candidate-3b6c43ee', 'trusted-runtime', 'scripts', 'k-browser-native-host.mjs');
try {
  const { parseHostArguments, startNativeHost } = await import(pathToFileURL(modulePath).href);
  const { configPath } = parseHostArguments(process.argv.slice(2));
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const host = await startNativeHost({ config });
  await host.done;
} catch {
  process.stderr.write('K browser native host rejected or closed.\n');
  process.exitCode = 1;
}
'@
$wrapperPath = Join-Path $hostDirectory 'host.mjs'
[IO.File]::WriteAllText($wrapperPath, $wrapper, (New-Object Text.UTF8Encoding($false)))

$oldPath = $env:PATH
try {
  $runtimeConfigPath = Join-Path $root '.local\runtime.json'
  if (Test-Path -LiteralPath $runtimeConfigPath -PathType Leaf) {
    $nodeExecutable = (Get-Content -LiteralPath $runtimeConfigPath -Encoding UTF8 -Raw | ConvertFrom-Json).nodeExecutable
    if ($nodeExecutable -and (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { $env:PATH = "$(Split-Path -Parent $nodeExecutable);$oldPath" }
  }
  & $registerScript -HostDirectory $hostDirectory -ConfigPath $nativeConfigPath -BackupDirectory (Join-Path $backupDirectory 'registration') | Out-Null
} finally {
  $env:PATH = $oldPath
}

Write-Output "K 瀏覽器助手已設定，HKCU 僅註冊 K 專用 native host。擴充與設定備份：$backupDirectory"
