import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, mkdtemp, writeFile, readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {scratchBase} from './scratch.mjs';
import {readSelfUpdate} from '../src/self-update.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {remoteRouteAllowed} from '../src/remote-access.mjs';
import {startElectronIsolatedLauncher} from '../src/electron-isolated-launcher.mjs';
import {isolatedLauncherPaths} from '../src/isolated-launcher.mjs';

const RUNNING = '0123456789abcdef0123456789abcdef01234567';
const READY = 'abcdef0123456789abcdef0123456789abcdef01';

async function repo({version = RUNNING, ready, result} = {}) {
  await mkdir(scratchBase, {recursive: true});
  const root = await mkdtemp(path.join(scratchBase, 'self-update-'));
  await mkdir(path.join(root, '.local'));
  if (version !== undefined) await writeFile(path.join(root, '.local', 'runtime.json'), JSON.stringify({version}));
  if (ready !== undefined)
    await writeFile(
      path.join(root, '.local', 'update-ready.json'),
      typeof ready === 'string' ? JSON.stringify({ref: ready}) : String(ready)
    );
  if (result !== undefined)
    await writeFile(path.join(root, '.local', 'self-update-result.json'), JSON.stringify(result));
  return root;
}

test('an update is available only for a valid accepted mark that differs from the running version', async () => {
  assert.deepEqual(readSelfUpdate(await repo()), {available: null, failed: null});
  assert.deepEqual(readSelfUpdate(await repo({ready: RUNNING})), {available: null, failed: null});
  assert.deepEqual(readSelfUpdate(await repo({ready: READY})), {available: READY, failed: null});
  for (const ready of [READY.toUpperCase(), 'abc123', '{not json'])
    assert.deepEqual(readSelfUpdate(await repo({ready})), {available: null, failed: null});
  assert.deepEqual(readSelfUpdate(undefined), {available: null, failed: null});
});

test('a failed update is reported only for the version that is still offered', async () => {
  const failure = {ok: false, from: RUNNING, to: READY, finishedAt: '2026-10-24T00:00:00.000Z', reason: '測試未通過'};
  assert.deepEqual(readSelfUpdate(await repo({ready: READY, result: failure})).failed, {
    reason: '測試未通過',
    finishedAt: '2026-10-24T00:00:00.000Z'
  });
  assert.equal(readSelfUpdate(await repo({ready: READY, result: {...failure, to: RUNNING}})).failed, null);
  assert.equal(readSelfUpdate(await repo({ready: READY, result: {...failure, ok: true}})).failed, null);
});

test('the phone may read and press the update button', () => {
  assert.equal(remoteRouteAllowed('GET', '/api/self-update'), true);
  assert.equal(remoteRouteAllowed('POST', '/api/self-update'), true);
});

async function desktop({root, activity = [], gemini = {}, corePending = false, request = async () => {}} = {}) {
  const app = await startDesktop({
    root: path.resolve('.'),
    port: 0,
    requireLaunchToken: true,
    controllerFactory: () => ({state: {conversationActivity: activity}, async close() {}}),
    geminiAccounts: {list: async () => ({accounts: [], ...gemini})},
    coreUpdates: {pending: corePending, async close() {}},
    ...(root ? {selfUpdate: {repoRoot: root, request}} : {})
  });
  const boot = await fetch(app.createLaunchUrl(), {redirect: 'manual'}),
    cookie = boot.headers.get('set-cookie').split(';')[0];
  const call = async method => {
    const response = await fetch(app.origin + '/api/self-update', {
      method,
      headers: {Cookie: cookie, 'Content-Type': 'application/json', 'X-K-Request': '1', Origin: app.origin},
      ...(method === 'POST' ? {body: '{}'} : {})
    });
    return {status: response.status, body: await response.json()};
  };
  return {app, call};
}

test('without a tray launcher there is nothing to update and pressing is refused', async () => {
  const {app, call} = await desktop();
  try {
    assert.deepEqual(await call('GET'), {status: 200, body: {available: false, updating: false, failed: null}});
    assert.equal((await call('POST')).status, 404);
  } finally {
    await app.close();
  }
});

test('pressing update hands the accepted version to the tray launcher once, only when everything is idle', async () => {
  const requested = [];
  const {app, call} = await desktop({root: await repo({ready: READY}), request: async ref => requested.push(ref)});
  try {
    assert.deepEqual((await call('GET')).body, {available: true, updating: false, failed: null});
    assert.deepEqual(await call('POST'), {status: 200, body: {started: true}});
    assert.deepEqual(requested, [READY]);
    assert.equal((await call('GET')).body.updating, true);
    assert.deepEqual(await call('POST'), {status: 409, body: {error: '已經在更新了。'}});
    assert.deepEqual(requested, [READY]);
  } finally {
    await app.close();
  }
});

test('running work refuses the update with one short line and never asks the launcher', async () => {
  const requested = [];
  const {app, call} = await desktop({
    root: await repo({ready: READY}),
    activity: [
      {title: '見觀社群文', busy: true, pendingQuestions: 0, pendingWorkers: 0},
      {title: '小說', busy: false, pendingQuestions: 0, pendingWorkers: 2},
      {title: '閒置', busy: false, pendingQuestions: 0, pendingWorkers: 0}
    ],
    gemini: {busy: true},
    corePending: true,
    request: async ref => requested.push(ref)
  });
  try {
    const {status, body} = await call('POST');
    assert.equal(status, 409);
    assert.equal(body.error, '還有工作在跑，等結束再按。');
    assert.deepEqual(body.busy, [
      '聊天室：見觀社群文 工作中',
      '聊天室：小說 子代理執行中',
      'Gemini 程序執行中',
      '核心更新進行中'
    ]);
    assert.deepEqual(requested, []);
    assert.equal((await call('GET')).body.updating, false);
  } finally {
    await app.close();
  }
});

test('no offered version, or a launcher that cannot be asked, leaves K running and the button usable', async () => {
  const none = await desktop({root: await repo({ready: RUNNING})});
  try {
    assert.deepEqual(await none.call('POST'), {status: 409, body: {error: '目前沒有可更新的版本。'}});
  } finally {
    await none.app.close();
  }
  const broken = await desktop({
    root: await repo({ready: READY}),
    request: async () => {
      throw Error('supervisor disconnected');
    }
  });
  try {
    assert.deepEqual(await broken.call('POST'), {status: 503, body: {error: 'K 無法開始更新，沒有關閉。'}});
    assert.equal((await broken.call('GET')).body.updating, false);
  } finally {
    await broken.app.close();
  }
});

test('the supervisor passes only a valid update request to the tray launcher', async () => {
  await mkdir(scratchBase, {recursive: true});
  const p = isolatedLauncherPaths(
    path.join(await mkdtemp(path.join(scratchBase, 'self-update-launcher-')), 'candidate')
  );
  await mkdir(path.dirname(p.electronExecutable), {recursive: true});
  await writeFile(p.electronExecutable, 'fixture');
  const mainPath = path.join(p.trustedRuntime, 'src', 'electron-isolated-main.cjs');
  await mkdir(path.dirname(mainPath), {recursive: true});
  await writeFile(mainPath, 'fixture');
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send(message, callback) {
      callback?.();
      if (message.type === 'owner-request')
        queueMicrotask(() =>
          child.emit('message', {type: 'owner-response', id: message.id, ok: true, value: {closed: true}})
        );
    }
  });
  const input = new PassThrough(),
    output = new PassThrough();
  let written = '';
  output.on('data', chunk => (written += chunk));
  const owner = await startElectronIsolatedLauncher({
    paths: p,
    mainPath,
    input,
    output,
    processObject: {env: {}, execPath: process.execPath, pid: 98765},
    spawnImpl: () => {
      queueMicrotask(() => child.emit('message', {type: 'owner-ready', origin: 'http://127.0.0.1:47831'}));
      return child;
    }
  });
  try {
    for (const ref of [READY.toUpperCase(), 'short', null, undefined])
      child.emit('message', {type: 'owner-self-update', ref});
    child.emit('message', {type: 'owner-self-update', ref: READY});
    const requests = written
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(event => event.type === 'self-update');
    assert.deepEqual(requests, [{type: 'self-update', ref: READY, pid: 98765}]);
  } finally {
    await owner.protocol.close();
    input.destroy();
    output.destroy();
  }
});

test(
  'the update script parses on PowerShell 5.1 and never touches phone sign-in or kills processes',
  {skip: process.platform !== 'win32'},
  async () => {
    const script = path.resolve('scripts/Self-Update-K.ps1');
    const parsed = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${script}',[ref]$t,[ref]$e);$e.Count`
      ],
      {encoding: 'utf8'}
    );
    assert.equal(parsed.trim(), '0');
    const text = await readFile(script, 'utf8');
    assert.equal(text.charCodeAt(0), 0xfeff, 'Windows PowerShell 5.1 needs the UTF-8 BOM for Chinese text');
    for (const forbidden of ['remote-access', 'remote-sessions', 'Stop-Process', 'taskkill'])
      assert.equal(text.includes(forbidden), false, forbidden);
  }
);
