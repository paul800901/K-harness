import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {scratchBase} from './scratch.mjs';
import {startKChrome} from '../src/k-chrome-launcher.mjs';

let n = 0;
async function profileDir() {
  const dir = path.join(scratchBase, `k-chrome-${n++}`);
  await mkdir(dir, {recursive: true});
  return dir;
}
// Holds the file the way a running Chrome does (no sharing) until released.
async function holdLock(file) {
  const holder = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$f = [IO.File]::Open($env:K_LOCK, 'OpenOrCreate', 'ReadWrite', 'None'); 'locked'; [Console]::In.ReadLine() | Out-Null; $f.Close()"
    ],
    {env: {...process.env, K_LOCK: file}, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']}
  );
  await new Promise((resolve, reject) => {
    holder.stdout.on('data', data => String(data).includes('locked') && resolve());
    holder.on('error', reject);
    holder.on('exit', () => reject(Error('lock holder exited')));
  });
  return () => new Promise(resolve => (holder.on('exit', resolve), holder.stdin.end('\n')));
}
const connected = [{profileId: 'a'.repeat(32), connected: true, modes: ['regular']}],
  waiting = [{profileId: 'a'.repeat(32), connected: false, modes: []}];

test('a running K Chrome is never started again, only waited for', async () => {
  const userDataDir = await profileDir();
  const release = await holdLock(path.join(userDataDir, 'lockfile'));
  let runs = 0,
    lists = 0;
  const options = {chromeExecutable: 'C:\\fake\\chrome.exe', userDataDir, intervalMs: 1, execFileImpl: () => runs++};
  try {
    assert.deepEqual(await startKChrome({...options, listProfiles: async () => (++lists < 2 ? waiting : connected)}), connected);
    await assert.rejects(
      startKChrome({...options, timeoutMs: 10, listProfiles: async () => waiting}),
      /瀏覽器助手沒有在 0 秒內連上/
    );
  } finally {
    await release();
  }
  assert.equal(runs, 0);
});

test('a lockfile left behind by a crash does not stop K from starting Chrome', async () => {
  const userDataDir = await profileDir();
  await writeFile(path.join(userDataDir, 'lockfile'), '');
  let runs = 0;
  await startKChrome({
    chromeExecutable: 'C:\\fake\\chrome.exe',
    userDataDir,
    listProfiles: async () => connected,
    execFileImpl: (file, args, options, done) => {
      runs++;
      done(null);
    }
  });
  assert.equal(runs, 1);
});

test('requests from several rooms share one Chrome start', async () => {
  const userDataDir = await profileDir();
  let runs = 0,
    finish;
  const options = {
    chromeExecutable: 'C:\\fake\\chrome.exe',
    userDataDir,
    listProfiles: async () => connected,
    execFileImpl: (file, args, opts, done) => {
      runs++;
      finish = done;
    }
  };
  const first = startKChrome(options),
    second = startKChrome(options);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  finish(null);
  assert.deepEqual(await Promise.all([first, second]), [connected, connected]);
  assert.equal(runs, 1);
});

test('K Chrome starts through the minimizing script, then waits for the assistant to connect', async () => {
  const userDataDir = await profileDir();
  const runs = [];
  let lists = 0;
  const profiles = await startKChrome({
    chromeExecutable: 'C:\\fake\\chrome.exe',
    userDataDir,
    env: {SystemRoot: 'C:\\Windows'},
    intervalMs: 1,
    listProfiles: async () => (++lists < 3 ? waiting : connected),
    execFileImpl: (file, args, options, done) => {
      runs.push({file, args, options});
      done(null);
    }
  });
  assert.deepEqual(profiles, connected);
  assert.equal(lists, 3);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].file, path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.match(runs[0].args[runs[0].args.indexOf('-File') + 1], /start-k-chrome-minimized\.ps1$/);
  assert.equal(runs[0].args[runs[0].args.indexOf('-Chrome') + 1], 'C:\\fake\\chrome.exe');
  assert.equal(runs[0].args[runs[0].args.indexOf('-UserDataDir') + 1], userDataDir);
  assert.equal(runs[0].args.at(-1), userDataDir, 'Chrome always starts with a regular window');
  assert.equal(runs[0].options.windowsHide, true);
});

test('a failed start or an assistant that never connects is reported, not retried', async () => {
  const userDataDir = await profileDir();
  let runs = 0;
  await assert.rejects(
    startKChrome({
      chromeExecutable: 'C:\\fake\\chrome.exe',
      userDataDir,
        listProfiles: async () => connected,
      execFileImpl: (file, args, options, done) => {
        runs++;
        done(Error('spawn failed'));
      }
    }),
    /無法開啟 K 專用 Chrome/
  );
  await assert.rejects(
    startKChrome({
      chromeExecutable: 'C:\\fake\\chrome.exe',
      userDataDir,
        timeoutMs: 20,
      intervalMs: 5,
      listProfiles: async () => waiting,
      execFileImpl: (file, args, options, done) => {
        runs++;
        done(null);
      }
    }),
    /沒有在 0 秒內連上/
  );
  assert.equal(runs, 2, 'each request starts Chrome at most once');
});

test('a request stopped before Chrome starts never starts it', async () => {
  const userDataDir = await profileDir();
  let runs = 0;
  await assert.rejects(
    startKChrome({
      chromeExecutable: 'C:\\fake\\chrome.exe',
      userDataDir,
        signal: AbortSignal.abort(),
      listProfiles: async () => connected,
      execFileImpl: () => runs++
    }),
    {name: 'AbortError'}
  );
  assert.equal(runs, 0);
});

test('a stopped request stops waiting at once while the start another room needs continues', async () => {
  const userDataDir = await profileDir();
  let runs = 0,
    finish;
  const options = {
    chromeExecutable: 'C:\\fake\\chrome.exe',
    userDataDir,
    listProfiles: async () => connected,
    execFileImpl: (file, args, opts, done) => {
      runs++;
      finish = done;
    }
  };
  const abort = new AbortController();
  const stopped = startKChrome({...options, signal: abort.signal}),
    other = startKChrome(options);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  abort.abort();
  await assert.rejects(stopped, {name: 'AbortError'});
  finish(null);
  assert.deepEqual(await other, connected);
  assert.equal(runs, 1);
});

test('cancelling the request stops waiting for the assistant', async () => {
  const userDataDir = await profileDir();
  const abort = new AbortController();
  const pending = startKChrome({
    chromeExecutable: 'C:\\fake\\chrome.exe',
    userDataDir,
    signal: abort.signal,
    intervalMs: 10000,
    listProfiles: async () => waiting,
    execFileImpl: (file, args, options, done) => done(null)
  });
  setTimeout(() => abort.abort(), 20);
  await assert.rejects(pending, {name: 'AbortError'});
});
