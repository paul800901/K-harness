import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {desktopControlMcp} from '../src/desktop-control-mcp.mjs';
import {geminiSettings, geminiMcpConfig} from '../src/gemini-worker.mjs';
import {scratchBase} from './scratch.mjs';

async function fixture() {
  const base = scratchBase;
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'desktop-control-mcp-'));
  await mkdir(path.join(root, '.runtime'), {recursive: true});
  return {
    root,
    save: data => writeFile(path.join(root, '.runtime/desktop-control.json'), JSON.stringify(data))
  };
}

test('desktopControlMcp returns null without root, fullAccess or binding file', async () => {
  const f = await fixture();
  assert.equal(await desktopControlMcp(), null);
  assert.equal(await desktopControlMcp({root: null, fullAccess: true}), null);
  assert.equal(await desktopControlMcp({root: f.root, fullAccess: false}), null);
  assert.equal(await desktopControlMcp({root: f.root, fullAccess: true}), null);
});

test('desktopControlMcp rejects relative executable path', async () => {
  const f = await fixture();
  await f.save({executable: 'relative/windows-mcp.exe'});
  await assert.rejects(desktopControlMcp({root: f.root, fullAccess: true}), /桌面控制本機接線位置無效。/);
  await f.save({executable: ''});
  await assert.rejects(desktopControlMcp({root: f.root, fullAccess: true}), /桌面控制本機接線位置無效。/);
});

test('desktopControlMcp returns null if executable does not exist or is not a file', async () => {
  const f = await fixture();
  await f.save({executable: path.join(f.root, 'nonexistent.exe')});
  assert.equal(await desktopControlMcp({root: f.root, fullAccess: true}), null);

  const folder = path.join(f.root, 'not-a-file');
  await mkdir(folder);
  await f.save({executable: folder});
  assert.equal(await desktopControlMcp({root: f.root, fullAccess: true}), null);
});

test('desktopControlMcp returns correct command, args and env when valid', async () => {
  const f = await fixture();
  const exe = path.join(f.root, 'windows-mcp.exe');
  await writeFile(exe, 'fixture');
  await f.save({executable: exe});

  const result = await desktopControlMcp({root: f.root, fullAccess: true});
  assert.deepEqual(result, {
    command: exe,
    args: [
      'serve',
      '--transport',
      'stdio',
      '--no-control',
      '--exclude-tools',
      'PowerShell,FileSystem,Registry,Process,Scrape,ControlStatus'
    ],
    env: {ANONYMIZED_TELEMETRY: 'false'}
  });
});

test('Gemini geminiSettings and geminiMcpConfig include k_desktop when desktop is provided', () => {
  const desktop = {command: 'C:\\fake\\windows-mcp.exe', args: ['serve'], env: {ANONYMIZED_TELEMETRY: 'false'}};
  const settings = geminiSettings('D:\\fake\\workspace', 'danger-full-access', [], null, null, {allow: []}, {desktop});
  assert.ok(settings.permissions.allow.includes('mcp(k_desktop/*)'));
  assert.ok(!settings.permissions.deny.includes('mcp(*)'));

  // Without desktop, mcp(k_desktop/*) is absent
  const settingsNoDesktop = geminiSettings('D:\\fake\\workspace', 'danger-full-access', [], null, null, {allow: []});
  assert.ok(!settingsNoDesktop.permissions.allow.includes('mcp(k_desktop/*)'));

  const mcpConfig = geminiMcpConfig(null, null, undefined, null, desktop);
  assert.deepEqual(mcpConfig.mcpServers.k_desktop, desktop);

  const mcpConfigNoDesktop = geminiMcpConfig(null, null, undefined, null, null);
  assert.equal(mcpConfigNoDesktop.mcpServers.k_desktop, undefined);
});
