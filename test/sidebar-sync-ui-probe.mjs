// Real server, SSE, authenticated phone route and two isolated browser stores. No native model calls.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {mkdir, mkdtemp, writeFile, readFile} from 'node:fs/promises';
import {launchProbeBrowser, probeEvidenceDir, probeTlsCertificate} from './ui-probe.mjs';
import {scratchBase} from './scratch.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {remoteKeyHash} from '../src/remote-access.mjs';
const root = await mkdtemp(path.join(scratchBase, 'sidebar-sync-'));
const output = probeEvidenceDir('sidebar-sync-20261027');
await mkdir(output, {recursive: true});
const remotePort = 54858, httpsPort = 54859, origin = `https://sidebar.test.ts.net:${httpsPort}`;
const key = 'synthetic-sidebar-key';
await mkdir(path.join(root, '.local'));
await writeFile(path.join(root, '.local/remote-access.json'), JSON.stringify({origin,
  login: 'sidebar@example.invalid', keyHash: remoteKeyHash(key), port: remotePort}));
const sessions = ['A', 'B', 'C'].map((id, i) => ({threadId: id, title: id, workspace: root,
  model: 'gpt-6.1-sol', sortAt: `2026-01-0${3-i}T00:00:00Z`}));
const state = {threadId: 'A', title: 'A', workspace: root, model: 'gpt-6.1-sol', provider: 'codex',
  status: 'ready', busy: false, messages: [], tools: [], questions: [], artifacts: [], workers: [],
  queuedMessages: [], conversationActivity: [], capabilities: {}, usage: {}};
const service = () => ({status: async () => ({available: false}), progress: () => ({}), close: async () => {}});
const app = await startDesktop({root, port: 0,
  controllerFactory: () => ({state, sessions: async () => ({sessions}), models: async () => ({models: []}),
    usage: async () => ({}), close: async () => {}}),
  claudeLoginFactory: service, codexLoginFactory: service, geminiLoginFactory: service,
  localDictationFactory: service});
const proxy = https.createServer(await probeTlsCertificate(), (req, res) => {
  const upstream = http.request({host: '127.0.0.1', port: remotePort, path: req.url, method: req.method,
    headers: {...req.headers, 'tailscale-user-login': 'sidebar@example.invalid'}}, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
  upstream.on('error', () => {if (!res.headersSent) res.writeHead(502); res.end();});
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
await new Promise(resolve => proxy.listen(httpsPort, '127.0.0.1', resolve));
let browser;
const errors = [];
const orderIs = (page, ids) => page.waitForFunction(ids =>
  JSON.stringify([...document.querySelectorAll('.session-title>span')].map(n => n.textContent)) === JSON.stringify(ids), ids);
const moveUp = async (page, id) => {
  await page.getByRole('button', {name: `管理對話 ${id}`, exact: true}).click();
  await page.locator(':popover-open').getByRole('button', {name: '上移對話', exact: true}).click();
};
try {
  browser = await launchProbeBrowser({args: ['--host-resolver-rules=MAP sidebar.test.ts.net 127.0.0.1', '--no-proxy-server']});
  const desktop = await browser.newContext({viewport: {width: 1440, height: 900}});
  const phone = await browser.newContext({viewport: {width: 412, height: 915}, ignoreHTTPSErrors: true});
  const pc = await desktop.newPage(), mobile = await phone.newPage();
  for (const page of [pc, mobile]) {page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));}
  // Phone opens first with stale local order; it must not initialize the shared setting.
  await mobile.addInitScript(() => {
    localStorage.setItem('k-sidebar-manual-order', JSON.stringify(['A', 'B', 'C']));
    localStorage.setItem('k-sidebar-sort', 'recent');
  });
  await mobile.goto(origin);
  await mobile.getByLabel('K 存取金鑰').fill(key);
  await mobile.getByRole('button', {name: '連接 K', exact: true}).click();
  await orderIs(mobile, ['A', 'B', 'C']);
  assert.equal(await mobile.evaluate(() => fetch('/api/state').then(r => r.json()).then(s => s.sidebarPreferences)), null);
  await pc.addInitScript(() => {
    localStorage.setItem('k-sidebar-manual-order', JSON.stringify(['C', 'A', 'B']));
    localStorage.setItem('k-sidebar-sort', 'manual');
  });
  await pc.goto(app.createLaunchUrl());
  await orderIs(pc, ['C', 'A', 'B']);
  await orderIs(mobile, ['C', 'A', 'B']);
  await pc.waitForFunction(() => localStorage.getItem('k-sidebar-manual-order') === '["C","A","B"]');
  await mobile.getByRole('button', {name: '展開側欄', exact: true}).click();
  await moveUp(mobile, 'B');
  await orderIs(mobile, ['C', 'B', 'A']);
  await orderIs(pc, ['C', 'B', 'A']);
  await moveUp(pc, 'B');
  await orderIs(pc, ['B', 'C', 'A']);
  await orderIs(mobile, ['B', 'C', 'A']);
  // A reload reruns stale local initialization scripts but must still obey K's saved state.
  await mobile.reload();
  await orderIs(mobile, ['B', 'C', 'A']);
  await pc.getByRole('button', {name: '檢視選項：手動排序', exact: true}).click();
  await pc.locator(':popover-open').getByRole('button', {name: '單一清單', exact: true}).click();
  await mobile.locator('.flat-projects').waitFor({state: 'attached'});
  sessions[2].sortAt = '2026-11-01T00:00:00Z';
  sessions.push({threadId: 'D', title: 'D', workspace: root, model: state.model, sortAt: '2026-12-01T00:00:00Z'});
  await pc.reload();
  await orderIs(pc, ['B', 'C', 'A', 'D']);
  await mobile.reload();
  await orderIs(mobile, ['B', 'C', 'A', 'D']);
  const saved = JSON.parse(await readFile(path.join(root, '.runtime/sidebar-preferences.json'), 'utf8'));
  assert.deepEqual(saved, {layout: 'flat', sort: 'manual', order: ['B', 'C', 'A', 'D']});
  await mobile.getByRole('button', {name: '展開側欄', exact: true}).click();
  await mobile.screenshot({path: path.join(output, 'phone.png')});
  await pc.screenshot({path: path.join(output, 'desktop.png')});
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({passed: true, saved, errors, actualAndroid: false}));
  console.log('Sidebar shared-state migration, phone/desktop bidirectional SSE, reload, layout and new-room tail passed.');
} finally {
  await browser?.close();
  await app.close();
  await new Promise(resolve => proxy.close(resolve));
}
