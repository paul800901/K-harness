import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const currentUrl = new URL('../Start-K-Desktop.ps1', import.meta.url);

test('desktop PowerShell entry delegates only to tray launcher and fails closed', async () => {
  const source = await readFile(currentUrl, 'utf8');
  assert.match(source, /local-launcher\\dist\\K桌面啟動器\.exe/);
  assert.match(source, /Test-Path -LiteralPath \$launcher -PathType Leaf/);
  assert.match(source, /Start-Process -FilePath \$launcher .* -WindowStyle Hidden/);
  assert.match(source, /if \(\$NoBrowser\)\s*\{\s*throw .*不再直接啟動後端/s);
  assert.match(source, /if \(\$NoBrowser\) \{ throw \}/);
  assert.doesNotMatch(source, /src\\desktop-server\.mjs|Invoke-RestMethod/);
  assert.equal((source.match(/Start-Process/g) ?? []).length, 1);
});

test('missing tray executable is checked before any process is started', async () => {
  const source = await readFile(currentUrl, 'utf8');
  const missingCheck = source.indexOf('Test-Path -LiteralPath $launcher -PathType Leaf');
  const startCall = source.indexOf('Start-Process -FilePath $launcher');
  assert.ok(missingCheck >= 0);
  assert.ok(startCall > missingCheck);
  assert.match(source, /找不到安全系統匣啟動器.*未啟動一般 K 後端/s);
});
