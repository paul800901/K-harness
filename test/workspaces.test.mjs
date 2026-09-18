import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceRuntimeConfig, listWorkspaceDirectories, validateWorkspace } from '../src/workspaces.mjs';

async function fixture() {
  const base = fileURLToPath(new URL('../.runtime/tests/', import.meta.url));
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'workspaces-'));
  await mkdir(path.join(root, 'alpha'));
  await mkdir(path.join(root, 'zeta'));
  await writeFile(path.join(root, 'file.txt'), 'not enumerated');
  return { root, appRoot: path.join(root, 'alpha'), selected: path.join(root, 'zeta') };
}

test('workspace validation rejects drive roots and HOME but accepts a real folder', async () => {
  const f = await fixture();
  assert.equal(await validateWorkspace(f.selected), path.resolve(f.selected));
  await assert.rejects(validateWorkspace(path.parse(f.root).root), /根目錄/);
  await assert.rejects(validateWorkspace(os.homedir()), /HOME/);
  await assert.rejects(validateWorkspace(path.join(f.root, 'missing')), /不存在/);
});

test('workspace browsing returns only immediate real child folders without content scanning', async () => {
  const f = await fixture();
  assert.deepEqual(await listWorkspaceDirectories(f.root), [
    { name: 'alpha', path: path.join(f.root, 'alpha') },
    { name: 'zeta', path: path.join(f.root, 'zeta') },
  ]);
});

test('runtime override keeps K script/key path and points host plus Flash at one workspace', async () => {
  const f = await fixture();
  const result = createWorkspaceRuntimeConfig({ appRoot: f.appRoot, workspace: f.selected, nodeExecutable: process.execPath });
  assert.equal(result.cwd, path.resolve(f.selected));
  const server = result.config.mcp_servers.k_flash;
  assert.equal(server.cwd, path.resolve(f.appRoot));
  assert.equal(server.args[0], path.join(f.appRoot, 'src', 'mcp-stdio.mjs'));
  assert.equal(server.args[server.args.indexOf('--workspace') + 1], path.resolve(f.selected));
  assert.equal(server.args[server.args.indexOf('--key-file') + 1], path.join(f.appRoot, '.env.local'));
});
