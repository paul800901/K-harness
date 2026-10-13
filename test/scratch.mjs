import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
    rmSync(scratchBase, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  } catch {
    /* A lingering child handle only leaves this run's folder. */
  }
});
