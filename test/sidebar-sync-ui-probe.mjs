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
import {projectKey} from '../frontend/project-groups.mjs';
const root = await mkdtemp(path.join(scratchBase, 'sidebar-sync-'));
const output = probeEvidenceDir('sidebar-sync-20261027');
await mkdir(output, {recursive: true});
const remotePort = 54858,
  httpsPort = 54859,
  origin = `https://sidebar.test.ts.net:${httpsPort}`;
const key = 'synthetic-sidebar-key';
const projectPaths = [root, path.join(root, 'B'), path.join(root, 'C')];
await mkdir(path.join(root, '.runtime'));
for (const folder of projectPaths.slice(1)) await mkdir(folder);
await writeFile(
  path.join(root, '.runtime/projects.json'),
  JSON.stringify(projectPaths.map((folder, i) => ({path: folder, name: `工作區${'ABC'[i]}`})))
);
await mkdir(path.join(root, '.local'));
await writeFile(
  path.join(root, '.local/remote-access.json'),
  JSON.stringify({origin, login: 'sidebar@example.invalid', keyHash: remoteKeyHash(key), port: remotePort})
);
const sessions = ['A', 'B', 'C'].map((id, i) => ({
  threadId: id,
  title: id,
  workspace: root,
  model: 'gpt-6.1-sol',
  sortAt: `2026-01-0${3 - i}T00:00:00Z`
}));
const state = {
  threadId: 'A',
  title: 'A',
  workspace: root,
  model: 'gpt-6.1-sol',
  provider: 'codex',
  status: 'ready',
  busy: false,
  messages: [],
  tools: [],
  questions: [],
  artifacts: [],
  workers: [],
  queuedMessages: [],
  conversationActivity: [],
  capabilities: {},
  usage: {}
};
const service = () => ({status: async () => ({available: false}), progress: () => ({}), close: async () => {}});
const start = () =>
  startDesktop({
    root,
    port: 0,
    controllerFactory: () => ({
      state,
      sessions: async () => ({sessions}),
      models: async () => ({models: []}),
      usage: async () => ({}),
      close: async () => {}
    }),
    claudeLoginFactory: service,
    codexLoginFactory: service,
    geminiLoginFactory: service,
    localDictationFactory: service
  });
let app = await start();
const proxy = https.createServer(await probeTlsCertificate(), (req, res) => {
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: remotePort,
      path: req.url,
      method: req.method,
      headers: {...req.headers, 'tailscale-user-login': 'sidebar@example.invalid'}
    },
    response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
await new Promise(resolve => proxy.listen(httpsPort, '127.0.0.1', resolve));
let browser;
const errors = [];
const orderIs = (page, ids) =>
  page.waitForFunction(
    ids =>
      JSON.stringify([...document.querySelectorAll('.session-title>span')].map(n => n.textContent)) ===
      JSON.stringify(ids),
    ids
  );
const moveUp = async (page, id) => {
  await page.getByRole('button', {name: `管理對話 ${id}`, exact: true}).click();
  await page.locator(':popover-open').getByRole('button', {name: '上移對話', exact: true}).click();
};
const projectsAre = (page, names) =>
  page.waitForFunction(
    names =>
      JSON.stringify(
        [...document.querySelectorAll('.project-toggle>span:last-child, .project-label>span:last-child')].map(
          n => n.textContent
        )
      ) === JSON.stringify(names),
    names
  );
const moveProject = async (page, name, direction) => {
  await page.getByRole('button', {name: `管理工作區 ${name}`, exact: true}).click();
  await page
    .locator(':popover-open')
    .getByRole('button', {name: `${direction}移工作區`, exact: true})
    .click();
};
try {
  browser = await launchProbeBrowser({
    args: ['--host-resolver-rules=MAP sidebar.test.ts.net 127.0.0.1', '--no-proxy-server']
  });
  const desktop = await browser.newContext({viewport: {width: 1440, height: 900}});
  const phone = await browser.newContext({viewport: {width: 412, height: 915}, ignoreHTTPSErrors: true});
  const pc = await desktop.newPage(),
    mobile = await phone.newPage();
  for (const page of [pc, mobile]) {
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
  }
  // Phone opens first with stale local order; it must not initialize the shared setting.
  await mobile.addInitScript(() => {
    localStorage.setItem('k-sidebar-manual-order', JSON.stringify(['A', 'B', 'C']));
    localStorage.setItem('k-sidebar-sort', 'recent');
  });
  await mobile.goto(origin);
  await mobile.getByLabel('K 存取金鑰').fill(key);
  await mobile.getByRole('button', {name: '連接 K', exact: true}).click();
  await orderIs(mobile, ['A', 'B', 'C']);
  assert.equal(
    await mobile.evaluate(() =>
      fetch('/api/state')
        .then(r => r.json())
        .then(s => s.sidebarPreferences)
    ),
    null
  );
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
  // Workspace moves use the same authenticated shared state, in both directions without reloading.
  await projectsAre(pc, ['工作區A', '工作區B', '工作區C']);
  await moveProject(pc, '工作區C', '上');
  await projectsAre(pc, ['工作區A', '工作區C', '工作區B']);
  await projectsAre(mobile, ['工作區A', '工作區C', '工作區B']);
  await moveProject(mobile, '工作區A', '下');
  await projectsAre(pc, ['工作區C', '工作區A', '工作區B']);
  await projectsAre(mobile, ['工作區C', '工作區A', '工作區B']);
  await orderIs(pc, ['B', 'C', 'A']);
  // A reload reruns stale local initialization scripts but must still obey K's saved state.
  await mobile.reload();
  await orderIs(mobile, ['B', 'C', 'A']);
  await projectsAre(mobile, ['工作區C', '工作區A', '工作區B']);
  await pc.getByRole('button', {name: '檢視選項：手動排序', exact: true}).click();
  await pc.locator(':popover-open').getByRole('button', {name: '單一清單', exact: true}).click();
  await mobile.locator('.flat-projects').waitFor({state: 'attached'});
  await moveProject(pc, '工作區B', '上');
  await projectsAre(pc, ['工作區C', '工作區B', '工作區A']);
  await projectsAre(mobile, ['工作區C', '工作區B', '工作區A']);
  sessions[2].sortAt = '2026-11-01T00:00:00Z';
  sessions.push({threadId: 'D', title: 'D', workspace: root, model: state.model, sortAt: '2026-12-01T00:00:00Z'});
  await pc.reload();
  await orderIs(pc, ['B', 'C', 'A', 'D']);
  await mobile.reload();
  await orderIs(mobile, ['B', 'C', 'A', 'D']);
  const saved = JSON.parse(await readFile(path.join(root, '.runtime/sidebar-preferences.json'), 'utf8'));
  assert.deepEqual(saved, {
    layout: 'flat',
    sort: 'manual',
    order: ['B', 'C', 'A', 'D'],
    projectOrder: [projectPaths[2], projectPaths[1], root].map(projectKey)
  });
  // Stop and reopen the actual isolated server. Both independent clients retain the saved order.
  await app.close();
  app = await start();
  await pc.goto(app.createLaunchUrl());
  await mobile.reload();
  for (const page of [pc, mobile]) {
    await projectsAre(page, ['工作區C', '工作區B', '工作區A']);
    await orderIs(page, ['B', 'C', 'A', 'D']);
  }
  const newProject = path.join(root, '新工作區');
  await mkdir(newProject);
  const added = await pc.evaluate(async folder => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-K-Request': '1'},
      body: JSON.stringify({path: folder})
    });
    return response.status;
  }, newProject);
  assert.equal(added, 200);
  await pc.reload();
  await mobile.reload();
  for (const page of [pc, mobile]) await projectsAre(page, ['工作區C', '工作區B', '工作區A', '新工作區']);
  await mobile.getByRole('button', {name: '展開側欄', exact: true}).click();
  await moveProject(mobile, '新工作區', '上');
  await projectsAre(pc, ['工作區C', '工作區B', '新工作區', '工作區A']);
  await projectsAre(mobile, ['工作區C', '工作區B', '新工作區', '工作區A']);
  await mobile.getByRole('button', {name: '管理工作區 工作區C', exact: true}).click();
  assert.equal(
    await mobile.locator(':popover-open').getByRole('button', {name: '上移工作區', exact: true}).isDisabled(),
    true
  );
  await mobile.screenshot({path: path.join(output, 'phone.png')});
  await pc.screenshot({path: path.join(output, 'desktop.png')});
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify({
      passed: true,
      savedBeforeRestart: saved,
      saved: JSON.parse(await readFile(path.join(root, '.runtime/sidebar-preferences.json'), 'utf8')),
      errors,
      actualAndroid: false
    })
  );
  console.log(
    'Sidebar shared-state migration, phone/desktop bidirectional conversation and workspace moves, reload, server restart, both layouts and new-item tail passed.'
  );
} finally {
  await browser?.close();
  await app.close();
  await new Promise(resolve => proxy.close(resolve));
}
