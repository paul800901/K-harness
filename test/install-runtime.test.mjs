import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, writeFile, readFile, stat, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {
  activateRuntime,
  rollbackRuntime,
  installationPaths,
  readSettings,
  pruneReleases
} from '../scripts/install-runtime.mjs';
import {scratchBase} from './scratch.mjs';
import {recyclePath} from '../scripts/recycle-path.mjs';

const checkStopped = async () => {};
async function file(name, value) {
  await mkdir(path.dirname(name), {recursive: true});
  await writeFile(name, value);
}
async function fixture() {
  const base = path.join(scratchBase, 'install-tests');
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, '可搬-')),
    p = installationPaths(root);
  await file(path.join(p.runtime, 'src/electron-isolated-launcher.mjs'), 'old');
  await file(path.join(p.runtime, 'dist-ui/index.html'), 'old-ui');
  await file(p.launcher, 'old-launcher');
  await file(p.entry, 'old-entry');
  await file(path.join(p.candidate, 'agent-home/.codex/fake-login'), 'DO NOT CHANGE');
  await file(path.join(p.candidate, 'vault/private-state/fake-chat'), 'KEEP CHAT');
  const prepared = path.join(p.candidate, 'prepared');
  for (const [name, value] of [
    ['src/electron-isolated-launcher.mjs', 'new'],
    ['dist-ui/index.html', 'new-ui'],
    ['local-launcher/dist/K桌面啟動器.exe', 'new-launcher'],
    ['Start-K-Desktop.ps1', 'new-entry']
  ])
    await file(path.join(prepared, name), value);
  return {root, p, prepared};
}
test('install exchanges only code; rollback also works for legacy runtime without embedded launcher', async () => {
  const {root, p, prepared} = await fixture();
  const result = await activateRuntime({
    root,
    prepared,
    version: 'new-commit',
    settings: {nodeExecutable: process.execPath, dictationModel: 'local-model'},
    checkStopped
  });
  assert.equal(await readFile(p.launcher, 'utf8'), 'new-launcher');
  assert.equal((await readSettings(root)).version, 'new-commit');
  assert.equal(await readFile(path.join(result.previous, 'runtime/src/electron-isolated-launcher.mjs'), 'utf8'), 'old');
  await rollbackRuntime(root, {checkStopped});
  assert.equal(await readFile(p.launcher, 'utf8'), 'old-launcher');
  assert.equal(await readFile(p.entry, 'utf8'), 'old-entry');
  assert.equal(await readFile(path.join(p.runtime, 'src/electron-isolated-launcher.mjs'), 'utf8'), 'old');
  assert.equal(await readFile(path.join(p.candidate, 'agent-home/.codex/fake-login'), 'utf8'), 'DO NOT CHANGE');
  assert.equal(await readFile(path.join(p.candidate, 'vault/private-state/fake-chat'), 'utf8'), 'KEEP CHAT');
});
test('activation keeps only the newest three program copies and never other release folders', async () => {
  const {root, p, prepared} = await fixture(),
    releases = path.join(p.candidate, 'releases');
  for (const time of [100, 200, 300, 400]) await file(path.join(releases, `before-${time}`, 'runtime/x'), 'old');
  await file(path.join(releases, 'browser-program-before-1/x'), 'other');
  const result = await activateRuntime({root, prepared, version: 'pruned', checkStopped});
  const left = (await readdir(releases)).sort();
  assert.deepEqual(
    left,
    ['before-300', 'before-400', path.basename(result.previous), 'browser-program-before-1'].sort()
  );
  assert.equal((await readSettings(root)).previous, result.previous);
  assert.deepEqual(await pruneReleases(p.candidate), []);
});
test('running work prevents activation, preserving existing code and candidate', async () => {
  const {root, p, prepared} = await fixture();
  await assert.rejects(
    activateRuntime({
      root,
      prepared,
      version: 'new',
      checkStopped: async () => {
        throw Error('running');
      }
    }),
    /running/
  );
  assert.equal(await readFile(p.launcher, 'utf8'), 'old-launcher');
  assert.ok(await stat(prepared));
  await assert.rejects(stat(path.join(p.candidate, 'agent-home/.codex/config.toml')), {code: 'ENOENT'});
});

test('activation creates the missing K Codex Windows sandbox config', async () => {
  const {root, p, prepared} = await fixture();
  await activateRuntime({root, prepared, version: 'windows-config', checkStopped});
  assert.equal(
    await readFile(path.join(p.candidate, 'agent-home/.codex/config.toml'), 'utf8'),
    '[windows]\nsandbox = "unelevated"\n'
  );
});

test('activation leaves an existing Codex config byte for byte unchanged', async () => {
  const {root, p, prepared} = await fixture(),
    config = path.join(p.candidate, 'agent-home/.codex/config.toml');
  const existing = '# user choice\r\n[windows]\r\nsandbox = "elevated"\r\n';
  await writeFile(config, existing);
  await activateRuntime({root, prepared, version: 'preserve-config', checkStopped});
  assert.equal(await readFile(config, 'utf8'), existing);
});
test('missing build output does not replace the current runtime', async () => {
  const {root, p} = await fixture();
  const prepared = path.join(p.candidate, 'incomplete');
  await mkdir(prepared);
  await assert.rejects(activateRuntime({root, prepared, version: 'broken', checkStopped}));
  assert.equal(await readFile(path.join(p.runtime, 'dist-ui/index.html'), 'utf8'), 'old-ui');
});
test('path outside this installation cannot be activated', async () => {
  const {root} = await fixture();
  await assert.rejects(
    activateRuntime({root, prepared: path.resolve(root, '../unrelated'), version: 'x', checkStopped}),
    /版本路徑/
  );
});

test(
  'Windows recycle helper confirms an actual fixture entry in the Recycle Bin',
  {skip: process.platform !== 'win32'},
  async () => {
    const {p} = await fixture(),
      parent = path.join(p.candidate, 'recycle-fixture'),
      target = path.join(parent, '保留確認目錄'),
      archive = path.join(parent, 'fixture-archive.zip');
    await file(path.join(target, 'fixture.txt'), 'recoverable fixture');
    const result = await recyclePath(target, parent);
    assert.deepEqual(result, {path: target, recycled: true, recycleBinReadback: true});
    await assert.rejects(stat(target), {code: 'ENOENT'});
    await file(archive, 'fixture archive');
    assert.deepEqual(await recyclePath(archive, parent), {
      path: archive,
      recycled: true,
      recycleBinReadback: true
    });
    await assert.rejects(stat(archive), {code: 'ENOENT'});
  }
);

test(
  'installed updater archives the repository root rather than its ignored runtime subtree',
  {skip: process.platform !== 'win32'},
  async () => {
    const {root, p} = await fixture();
    const git = args => {
      const result = spawnSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true});
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    // A dependency-free fixture permits the real prepare flow without downloading packages.
    await file(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'updater-archive-fixture', version: '1.0.0', private: true})
    );
    await file(
      path.join(root, 'package-lock.json'),
      JSON.stringify({
        name: 'updater-archive-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {'': {name: 'updater-archive-fixture', version: '1.0.0'}}
      })
    );
    await file(path.join(root, '.gitignore'), '.runtime/\nnode_modules/\n');
    await file(path.join(root, 'root-sentinel.txt'), 'pinned repository content');
    git(['init', '--quiet']);
    git(['add', '.']);
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=NUL',
      'commit',
      '--quiet',
      '-m',
      'fixture'
    ]);
    const version = git(['rev-parse', 'HEAD']);
    for (const name of [
      'scripts/manage-install.mjs',
      'scripts/install-runtime.mjs',
      'scripts/recycle-path.mjs',
      'src/atomic-write.mjs'
    ])
      await file(path.join(p.runtime, name), await readFile(new URL('../' + name, import.meta.url)));
    const result = spawnSync(
      process.execPath,
      [path.join(p.runtime, 'scripts/manage-install.mjs'), '--root', root, '--ref', version, '--prepare-only'],
      {
        cwd: p.runtime,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: {...process.env, npm_config_cache: path.join(p.candidate, 'npm-cache')}
      }
    );
    // The fixture deliberately has no Electron, so it must stop before activation.
    assert.equal(result.status, 1);
    assert.match(result.stderr, /electron/);
    const [prepared] = (await readdir(p.candidate, {withFileTypes: true})).filter(
      entry => entry.isDirectory() && entry.name.startsWith('prepare-')
    );
    assert.ok(prepared, 'candidate archive was prepared');
    assert.equal(
      await readFile(path.join(p.candidate, prepared.name, 'root-sentinel.txt'), 'utf8'),
      'pinned repository content'
    );
    assert.equal(await readFile(path.join(p.runtime, 'dist-ui/index.html'), 'utf8'), 'old-ui');
  }
);
