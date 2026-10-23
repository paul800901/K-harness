import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, mkdtemp, writeFile, readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFileSync, spawn} from 'node:child_process';
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

async function desktop({
  root,
  activity = [],
  gemini = {},
  corePending = false,
  controller = {},
  request = async () => {}
} = {}) {
  const app = await startDesktop({
    root: path.resolve('.'),
    port: 0,
    requireLaunchToken: true,
    controllerFactory: () => ({state: {conversationActivity: activity}, async close() {}, ...controller}),
    geminiAccounts: {list: async () => ({accounts: [], ...gemini})},
    coreUpdates: {pending: corePending, async close() {}},
    ...(root ? {selfUpdate: {repoRoot: root, request}} : {})
  });
  const boot = await fetch(app.createLaunchUrl(), {redirect: 'manual'}),
    cookie = boot.headers.get('set-cookie').split(';')[0];
  const call = async (method, route = '/api/self-update', body = '{}') => {
    const response = await fetch(app.origin + route, {
      method,
      headers: {Cookie: cookie, 'Content-Type': 'application/json', 'X-K-Request': '1', Origin: app.origin},
      ...(method === 'POST' ? {body} : {})
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
    // Obvious work is refused from the live snapshot at once, before the slower checks.
    assert.deepEqual(body.busy, ['聊天室：見觀社群文 工作中', '聊天室：小說 子代理執行中', '核心更新進行中']);
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

// Runs the real script under Windows PowerShell 5.1 against a fake repository and a fake Update-K.ps1.
async function runScript(updateLines, launcherPid) {
  await mkdir(scratchBase, {recursive: true});
  const root = await mkdtemp(path.join(scratchBase, 'self-update-script-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, '.local'));
  await writeFile(path.join(root, 'scripts', 'Self-Update-K.ps1'), await readFile('scripts/Self-Update-K.ps1'));
  await writeFile(path.join(root, '.local', 'runtime.json'), JSON.stringify({version: RUNNING}));
  await writeFile(path.join(root, 'Update-K.ps1'), '\ufeff' + updateLines.join('\r\n'));
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'scripts', 'Self-Update-K.ps1'),
        '-Ref',
        READY,
        '-LauncherPid',
        String(launcherPid)
      ],
      {stdio: 'ignore', timeout: 120000}
    );
  } catch {}
  return JSON.parse(await readFile(path.join(root, '.local', 'self-update-result.json'), 'utf8'));
}
const ended = () => {
  const {pid} = spawn(process.execPath, ['-e', ''], {stdio: 'ignore'});
  return new Promise(resolve => setTimeout(() => resolve(pid), 500));
};

test(
  'the update script judges only the exit code and reports the installer cause, not PowerShell noise',
  {skip: process.platform !== 'win32'},
  async () => {
    const pid = await ended();
    const success = await runScript(
      [
        'param([string]$Ref)',
        "$ErrorActionPreference='Stop'",
        "[Console]::Error.WriteLine('npm warn deprecated')",
        "Write-Output 'ok'",
        'exit 0'
      ],
      pid
    );
    assert.equal(success.ok, true);
    assert.equal(success.to, READY);
    const failure = await runScript(
      [
        'param([string]$Ref)',
        "$ErrorActionPreference='Stop'",
        "Write-Output 'building'",
        "& node -e \"console.error('npm warn old');console.error('候選缺少 dist-ui/index.html');console.error('未套用的建置暫存留在 C:/x（可從 Git 版本重建）');process.exit(1)\"",
        "if($LASTEXITCODE -ne 0){throw 'K 更新未完成；沒有強制結束工作，請保留錯誤交給 AI 檢查。'}"
      ],
      pid
    );
    assert.deepEqual([failure.ok, failure.from, failure.reason], [false, RUNNING, '候選缺少 dist-ui/index.html']);
  }
);

test(
  'the update script applies nothing while the old launcher is still running',
  {skip: process.platform !== 'win32', timeout: 120000},
  async () => {
    const launcher = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100000)'], {stdio: 'ignore'});
    try {
      const result = await runScript(
        ['param([string]$Ref)', "Set-Content -LiteralPath (Join-Path $PSScriptRoot 'applied.txt') -Value x", 'exit 0'],
        launcher.pid
      );
      assert.deepEqual([result.ok, result.reason], [false, '啟動器沒有結束，這次沒有更新。']);
    } finally {
      launcher.kill();
    }
  }
);

test('the request carries nothing: any body content is refused and K chooses the version', async () => {
  const requested = [];
  const {app, call} = await desktop({root: await repo({ready: READY}), request: async ref => requested.push(ref)});
  try {
    assert.equal((await call('POST', '/api/self-update', JSON.stringify({ref: RUNNING}))).status, 400);
    assert.deepEqual(requested, []);
  } finally {
    await app.close();
  }
});

test('two presses at once hand off once, and no new work starts while the update is reserved', async () => {
  const requested = [];
  let release;
  const {app, call} = await desktop({
    root: await repo({ready: READY}),
    // The asynchronous checks are slow, so both presses overlap them.
    gemini: {},
    controller: {backgroundCommands: () => new Promise(resolve => (release = () => resolve(0)))},
    request: async ref => requested.push(ref)
  });
  try {
    const first = call('POST');
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(await call('POST'), {status: 409, body: {error: '已經在更新了。'}});
    assert.equal((await call('POST', '/api/send', JSON.stringify({text: 'x'}))).status, 503);
    // Stopping work and answering a question are never blocked by a pending update.
    for (const route of ['/api/stop', '/api/answer']) assert.notEqual((await call('POST', route)).status, 503, route);
    release();
    assert.deepEqual(await first, {status: 200, body: {started: true}});
    assert.deepEqual(requested, [READY]);
  } finally {
    await app.close();
  }
});

test('background commands, a discussion or an unconfirmable state count as busy', async () => {
  for (const [controller, expected, gemini] of [
    [{backgroundCommands: async () => 1}, '背景命令執行中'],
    [{discussionBusy: true}, '討論進行中'],
    [{}, 'Gemini 程序執行中', {busy: true}],
    [
      {
        backgroundCommands: async () => {
          throw Error('terminal list unavailable');
        }
      },
      '部分工作狀態無法確認'
    ]
  ]) {
    const requested = [];
    const {app, call} = await desktop({
      root: await repo({ready: READY}),
      controller,
      gemini,
      request: async ref => requested.push(ref)
    });
    try {
      const {status, body} = await call('POST');
      assert.equal(status, 409);
      assert.deepEqual(body.busy, [expected]);
      assert.deepEqual(requested, []);
      assert.equal((await call('GET')).body.updating, false);
    } finally {
      await app.close();
    }
  }
});
