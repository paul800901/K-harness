import {mkdir, open, rename, stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Persist one complete snapshot. Retry only its replacement, never caller work.
// Windows Defender or a concurrent reader can hold the target for about a second;
// wait for the lock by time, not attempt count, so a finished operation is not reported as failed.
export async function atomicWrite(target, data, {lockWaitMs = 10000} = {}) {
  await mkdir(path.dirname(target), {recursive: true});
  const temporary = `${target}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx');
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  return replaceFile(temporary, target, {lockWaitMs});
}

// Windows briefly locks files (antivirus, indexer); wait out the lock instead of failing the save.
// shouldStop lets a caller that is shutting down give up between attempts; it then gets null.
export async function replaceFile(temporary, target, {lockWaitMs = 10000, shouldStop = () => false} = {}) {
  const deadline = Date.now() + lockWaitMs;
  for (let attempt = 0; ; attempt++) {
    if (attempt && shouldStop()) return null;
    try {
      await rename(temporary, target);
      return target;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error;
      // A directory in the target's place is permanent, not a lock; do not wait for it.
      if ((await stat(target).catch(() => null))?.isDirectory()) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(10 * (attempt + 1), 100)));
    }
  }
}
