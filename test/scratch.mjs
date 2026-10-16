import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// One scratch folder per test process. Removed when the process exits cleanly;
// kept after a failure so the files can be inspected.
export const scratchBase = path.join(
  fileURLToPath(new URL('../.runtime/tests/', import.meta.url)),
  `run-${process.pid}-${Date.now()}`
);
mkdirSync(scratchBase, {recursive: true});
process.on('exit', code => {
  if (code || process.exitCode) return;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
            '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:K_TEST_SCRATCH, "OnlyErrorDialogs", "SendToRecycleBin"); ' +
            'if (Test-Path -LiteralPath $env:K_TEST_SCRATCH) { exit 1 }'
        ],
        {env: {...process.env, K_TEST_SCRATCH: scratchBase}, windowsHide: true, stdio: 'ignore'}
      );
      if (result.status !== 0) console.warn(`測試暫存保留，未確認移入回收筒：${scratchBase}`);
    } else rmSync(scratchBase, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  } catch {
    /* A lingering child handle only leaves this run's folder. */
  }
});
