param(
 [string]$Ref='HEAD',
 [string]$InstallRoot=$PSScriptRoot,
 [string]$CodexExecutable,
 [string]$ClaudeExecutable,
 [string]$DictationPython,
 [string]$DictationModel
)
$ErrorActionPreference='Stop'
$arguments=@((Join-Path $PSScriptRoot 'scripts\manage-install.mjs'),'--root',$InstallRoot,'--ref',$Ref)
if($CodexExecutable){$arguments+=@('--codex',$CodexExecutable)}
if($ClaudeExecutable){$arguments+=@('--claude',$ClaudeExecutable)}
if($DictationPython){$arguments+=@('--dictation-python',$DictationPython)}
if($DictationModel){$arguments+=@('--dictation-model',$DictationModel)}
& node @arguments
if($LASTEXITCODE -ne 0){throw 'K 設定失敗；請保留上方錯誤交給 AI 檢查。'}
