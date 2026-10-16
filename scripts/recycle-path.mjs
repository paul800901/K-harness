import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {lstat, realpath, rm} from 'node:fs/promises';

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Windows deletion is successful only when the exact source disappears and Explorer
// reports a new Recycle Bin entry with the same original location. There is no fallback.
export async function recyclePath(target, intendedParent) {
  target = path.resolve(target);
  intendedParent = path.resolve(intendedParent);
  const relative = path.relative(intendedParent, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    samePath(target, path.parse(target).root) ||
    samePath(intendedParent, path.parse(intendedParent).root)
  )
    throw Error('回收目標必須是 intended parent 內的非根目錄項目。');

  const parentReal = await realpath(intendedParent),
    targetReal = await realpath(target),
    info = await lstat(target);
  if (!samePath(parentReal, intendedParent) || !samePath(targetReal, target) || info.isSymbolicLink())
    throw Error('回收目標或其父路徑含 junction／symlink，拒絕操作。');
  if (!info.isFile() && !info.isDirectory()) throw Error('回收目標不是一般檔案或目錄。');

  if (process.platform !== 'win32') {
    await rm(target, {recursive: info.isDirectory(), force: true, maxRetries: 3});
    return {path: target, recycled: false, platform: process.platform};
  }

  const script = String.raw`
$ErrorActionPreference = 'Stop'
if (-not [Environment]::UserInteractive) { throw 'Non-interactive session cannot use the Recycle Bin; nothing deleted.' }
Add-Type -AssemblyName Microsoft.VisualBasic
$target = [IO.Path]::GetFullPath($env:K_RECYCLE_TARGET)
function Get-Matches($originalPath) {
  $shell = New-Object -ComObject Shell.Application
  $bin = $shell.Namespace(10)
  if ($null -eq $bin) { throw 'Recycle Bin is unavailable.' }
  $parent = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($originalPath)).TrimEnd('\')
  $name = [IO.Path]::GetFileName($originalPath)
  @($bin.Items() | Where-Object {
    $deletedFrom = $_.ExtendedProperty('System.Recycle.DeletedFrom')
    if ($deletedFrom) {
      [string]::Equals(([IO.Path]::GetFullPath([string]$deletedFrom)).TrimEnd('\'), $parent, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Name, $name, [StringComparison]::OrdinalIgnoreCase)
    }
    else { $false }
  })
}
$before = @(Get-Matches $target).Count
if (Test-Path -LiteralPath $target -PathType Container) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($target, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($target, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
}
if (Test-Path -LiteralPath $target) { throw 'Source path still exists after recycle request.' }
$after = @(Get-Matches $target).Count
if ($after -le $before) { throw 'Recycle Bin readback did not confirm a new matching item.' }
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: {...process.env, K_RECYCLE_TARGET: target},
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`未能確認移入資源回收筒；原路徑狀態未知，未自動重試（${result.stderr.trim() || result.status}）。`);
  return {path: target, recycled: true, recycleBinReadback: true};
}
