param(
  [string]$Model = 'gpt-6-astra',
  [string]$ResumeThreadId,
  [switch]$List
)
$ErrorActionPreference = 'Stop'
$kNode = (Get-Command node -ErrorAction Stop).Source
$kEntry = Join-Path $PSScriptRoot 'src/main-cli.mjs'
if ($List) { & $kNode $kEntry '--list'; exit $LASTEXITCODE }
$kCodex = (Get-Command codex -ErrorAction Stop).Source
if ($ResumeThreadId) {
  & $kNode $kEntry $kCodex $Model '--live' $ResumeThreadId
} else {
  & $kNode $kEntry $kCodex $Model '--live'
}
exit $LASTEXITCODE
