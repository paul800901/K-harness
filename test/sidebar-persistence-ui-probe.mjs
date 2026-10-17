// Real Electron processes + built UI + synthetic services; never uses the user's K profile or models.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scratchBase} from './scratch.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const profile = path.join(scratchBase, 'sidebar-persistence');
await mkdir(profile, {recursive: true});
const executable = createRequire(import.meta.url)('electron');
for (const mode of ['write', 'read', 'recent']) {
  const env = {...process.env, K_SIDEBAR_PROBE_ROOT: profile, K_SIDEBAR_PROBE_MODE: mode};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [path.join(root, 'test/fixtures/sidebar-persistence.cjs')], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', data => {
    stdout += data;
  });
  child.stderr.on('data', data => {
    stderr += data;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0, `${mode}: ${stdout}\n${stderr}`);
  const result = JSON.parse(await readFile(path.join(profile, `${mode}.json`), 'utf8'));
  assert.equal(result.hidden, true);
  assert.equal(result.sameSessionPermissionHandlers, true);
  console.log(JSON.stringify(result));
}
console.log(
  'PASS: manual order and explicit recent choice survive full native-process restarts; new activity/new room, actual-session permission handlers and stale bootstrap cookie checked.'
);
