const electron = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {mkdir, readFile, writeFile} = require('node:fs/promises');
const root = process.env.K_SIDEBAR_PROBE_ROOT;
const mode = process.env.K_SIDEBAR_PROBE_MODE;
const repo = path.resolve(__dirname, '../..');
electron.app.setPath('userData', path.join(root, 'shell'));
electron.app.on('window-all-closed', () => {});
let workbench, server;
const wait = async check => {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Sidebar persistence condition timed out');
};
(async () => {
  await electron.app.whenReady();
  await mkdir(root, {recursive: true});
  const {startDesktop} = await import(pathToFileURL(path.join(repo, 'src/desktop-server.mjs')));
  const {createElectronWorkbench} = await import(
    pathToFileURL(process.env.K_SIDEBAR_PROBE_MODULE || path.join(repo, 'src/electron-workbench.mjs'))
  );
  const state = {
    threadId: 'A',
    workspace: root,
    title: 'A',
    provider: 'codex',
    model: 'gpt-6.1-sol',
    accessMode: 'workspace-write',
    status: 'ready',
    busy: false,
    messages: [],
    tools: [],
    workers: [],
    questions: [],
    artifacts: [],
    notices: [],
    queuedMessages: [],
    capabilities: {},
    usage: {}
  };
  let sessions = ['A', 'B', 'C'].map((id, i) => ({
    threadId: id,
    title: id,
    workspace: root,
    model: state.model,
    sortAt: `2026-01-0${3 - i}T00:00:00Z`
  }));
  const login = () => ({
    async close() {},
    async status() {
      return {available: false};
    },
    progress() {
      return {status: 'idle'};
    }
  });
  const port = mode === 'write' ? 0 : Number(await readFile(path.join(root, 'port.txt'), 'utf8'));
  server = await startDesktop({
    root,
    port,
    controllerFactory: () => ({
      state,
      async sessions() {
        return {sessions};
      },
      async models() {
        return {models: []};
      },
      async usage() {
        return {};
      },
      async close() {}
    }),
    claudeLoginFactory: login,
    codexLoginFactory: login,
    geminiLoginFactory: login,
    localDictationFactory: () => ({async close() {}})
  });
  const origin = server.origin;
  await writeFile(path.join(root, 'port.txt'), new URL(origin).port);
  let staleCookieStatus = null;
  if (mode !== 'write') {
    const oldCookie = await readFile(path.join(root, 'synthetic-cookie.txt'), 'utf8');
    staleCookieStatus = (await fetch(`${origin}/api/state`, {headers: {cookie: oldCookie}})).status;
    assert.equal(staleCookieStatus, 403, 'old cookie must not authorize a new server');
  }
  let permissionSession, requestHandler, checkHandler, displayHandler;
  class HiddenWindow extends electron.BaseWindow {
    constructor(options) {
      super({...options, show: false});
    }
    show() {}
  }
  class TrackedView extends electron.WebContentsView {
    constructor(options) {
      super(options);
      const session = this.webContents.session;
      for (const [name, capture] of [
        [
          'setPermissionRequestHandler',
          fn => {
            requestHandler = fn;
          }
        ],
        [
          'setPermissionCheckHandler',
          fn => {
            checkHandler = fn;
          }
        ],
        [
          'setDisplayMediaRequestHandler',
          fn => {
            displayHandler = fn;
          }
        ]
      ]) {
        const original = session[name].bind(session);
        session[name] = handler => {
          permissionSession = session;
          capture(handler);
          original(handler);
        };
      }
    }
  }
  workbench = await createElectronWorkbench({
    electron: {...electron, BaseWindow: HiddenWindow, WebContentsView: TrackedView},
    servicesFactory: async () => ({app: server})
  });
  const wc = workbench.owner.webContents;
  const run = code => wc.executeJavaScript(code);
  await wait(() => run('document.querySelectorAll(".session-title>span").length===3'));
  const order = () => run('[...document.querySelectorAll(".session-title>span")].map(e=>e.textContent)');
  const click = label =>
    run(
      `(()=>{const b=[...document.querySelectorAll(':popover-open button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Open menu button missing');b.click()})()`
    );
  const restoredOrder = await order();
  const restoredSort = await run('localStorage.getItem("k-sidebar-sort")');
  assert.equal(permissionSession, wc.session, 'permission hooks must be on the actual owner session');
  assert.ok(requestHandler && checkHandler && displayHandler);
  const details = {
    isMainFrame: true,
    mediaType: 'audio',
    mediaTypes: ['audio'],
    requestingUrl: origin,
    securityOrigin: origin
  };
  assert.equal(checkHandler(wc, 'media', origin, details), true);
  assert.equal(checkHandler(wc, 'media', origin, {...details, mediaType: 'video'}), false);
  assert.equal(checkHandler(wc, 'geolocation', origin, details), false);
  assert.equal(await run('navigator.permissions.query({name:"geolocation"}).then(p=>p.state)'), 'denied');
  assert.equal(checkHandler(wc, 'media', 'https://outside.invalid', details), false);
  let cameraAllowed;
  requestHandler(
    wc,
    'media',
    answer => {
      cameraAllowed = answer;
    },
    {...details, mediaTypes: ['video']}
  );
  assert.equal(cameraAllowed, false);
  if (mode === 'write') {
    assert.deepEqual(await order(), ['A', 'B', 'C']);
    for (let i = 0; i < 2; i++) {
      await run(`document.querySelector('button[aria-label="管理對話 C"]').click()`);
      await wait(() =>
        run('[...document.querySelectorAll(":popover-open button")].some(e=>e.textContent.trim()==="上移對話")')
      );
      await click('上移對話');
      await wait(async () => (await order()).indexOf('C') === 1 - i);
    }
    await wait(() => run('localStorage.getItem("k-sidebar-manual-order")===JSON.stringify(["C","A","B"])'));
  } else if (mode === 'read') {
    assert.deepEqual(await order(), ['C', 'A', 'B'], 'manual order must survive a full native restart');
    assert.equal(await run('localStorage.getItem("k-sidebar-sort")'), 'manual');
    sessions[1].sortAt = '2026-02-01T00:00:00Z';
    sessions.push({threadId: 'D', title: 'D', workspace: root, model: state.model, sortAt: '2026-03-01T00:00:00Z'});
    await wc.loadURL(origin);
    await wait(() => run('document.querySelectorAll(".session-title>span").length===4'));
    assert.deepEqual(await order(), ['C', 'A', 'B', 'D'], 'activity cannot move old rooms; new rooms append');
    await run(`document.querySelector('button[title="檢視選項：手動排序"]').click()`);
    await wait(() =>
      run('[...document.querySelectorAll(":popover-open button")].some(e=>e.textContent.trim()==="最近訊息")')
    );
    await click('最近訊息');
    await wait(() => run('localStorage.getItem("k-sidebar-sort")==="recent"'));
    assert.deepEqual(await order(), ['D', 'B', 'A', 'C']);
  } else {
    assert.equal(await run('localStorage.getItem("k-sidebar-sort")'), 'recent');
    assert.deepEqual(await order(), ['A', 'B', 'C']);
  }
  const response = await run('fetch("/").then(r=>({status:r.status,cache:r.headers.get("cache-control")}))');
  assert.deepEqual(response, {status: 200, cache: 'no-store'});
  const cookies = await wc.session.cookies.get({url: origin, name: 'k_session'});
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].httpOnly, true);
  await writeFile(path.join(root, 'synthetic-cookie.txt'), `k_session=${cookies[0].value}`);
  const result = {
    mode,
    restoredOrder,
    restoredSort,
    order: await order(),
    sort: await run('localStorage.getItem("k-sidebar-sort")'),
    persistent: wc.session.isPersistent(),
    hidden: !workbench.window.isVisible(),
    sameSessionPermissionHandlers: permissionSession === wc.session,
    staleCookieStatus,
    htmlNoStore: response.cache === 'no-store'
  };
  await writeFile(path.join(root, `${mode}.json`), JSON.stringify(result));
  await workbench.close();
  workbench = null;
  server = null;
})()
  .then(() => electron.app.quit())
  .catch(async error => {
    console.error(error.stack);
    await workbench?.close();
    if (!workbench) await server?.close();
    electron.app.exit(1);
  });
