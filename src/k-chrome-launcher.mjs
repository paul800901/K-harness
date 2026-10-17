import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../scripts/start-k-chrome-minimized.ps1', import.meta.url));
let starting = null;

/**
 * Start K's dedicated Chrome, minimized, when an AI browser request finds no
 * connected profile, then wait for the browser assistant to connect. A running
 * Chrome holds `lockfile` in its user data directory and is only waited for:
 * starting it again would make Chrome open that window itself, in front.
 * Requests from several rooms share one start.
 */
export async function startKChrome({
  chromeExecutable,
  userDataDir,
  mode,
  listProfiles,
  signal,
  env = process.env,
  execFileImpl = execFile,
  timeoutMs = 20000,
  intervalMs = 500
}) {
  starting ??= (async () => {
    if (await access(path.join(userDataDir, 'lockfile')).then(() => true, () => false)) return;
    const powershell = path.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = ['-NoProfile', '-NonInteractive', '-File', script, '-Chrome', chromeExecutable, '-UserDataDir', userDataDir];
    if (mode === 'incognito') args.push('-Incognito');
    await new Promise((resolve, reject) =>
      execFileImpl(powershell, args, {windowsHide: true, timeout: 30000}, error =>
        error ? reject(Error('無法開啟 K 專用 Chrome。', {cause: error})) : resolve()
      )
    );
  })().finally(() => (starting = null));
  await starting;
  for (const deadline = Date.now() + timeoutMs; ; ) {
    const profiles = await listProfiles();
    if (profiles.some(profile => profile.connected)) return profiles;
    if (Date.now() >= deadline) break;
    await delay(intervalMs, undefined, {signal});
  }
  throw Error(`K 專用 Chrome 已開啟，但瀏覽器助手沒有在 ${Math.round(timeoutMs / 1000)} 秒內連上；請確認擴充已啟用。`);
}
