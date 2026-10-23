// Built UI, fake self-update API, disposable headless browser. Nothing is updated or restarted.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {preview} from 'vite';
import path from 'node:path';

const output = probeEvidenceDir('self-update-probe');
await mkdir(output, {recursive: true});
const server = await preview({preview: {host: '127.0.0.1', port: 5195, strictPort: true}});
const state = {
  threadId: null,
  workspace: process.cwd(),
  status: 'idle',
  busy: false,
  messages: [],
  tools: [],
  questions: [],
  artifacts: [],
  accessMode: 'workspace-write',
  provider: 'codex',
  capabilities: {},
  conversationActivity: []
};
let browser,
  update = {available: false, updating: false, failed: null},
  answer = {status: 409, json: {error: '還有工作在跑，等結束再按。', busy: ['聊天室：小說 工作中']}};
const posts = [],
  errors = [];
async function open(viewport) {
  const page = await browser.newPage({viewport});
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(initial => {
    window.EventSource = class {
      constructor() {
        setTimeout(() => this.onmessage?.({data: JSON.stringify({type: 'snapshot', state: initial})}), 0);
      }
      close() {}
    };
  }, state);
  await page.route('**/api/**', async route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/self-update' && request.method() === 'POST') {
      posts.push(request.postDataJSON());
      return route.fulfill({status: answer.status, json: answer.json});
    }
    let body = {};
    if (url.pathname === '/api/self-update') body = update;
    else if (url.pathname === '/api/state') body = state;
    else if (url.pathname === '/api/projects') body = {projects: [{path: process.cwd(), name: '假工作區'}]};
    else if (url.pathname === '/api/sessions') body = {sessions: []};
    else if (url.pathname === '/api/models') body = {models: []};
    await route.fulfill({json: body});
  });
  await page.goto('http://127.0.0.1:5195');
  // The phone keeps the sidebar folded until it is opened.
  await page.getByRole('button', {name: viewport.width < 700 ? '展開側欄' : '設定', exact: true}).waitFor();
  return page;
}
const updateButton = page => page.locator('.sidebar-settings-row').getByRole('button', {name: '更新', exact: true});
try {
  browser = await launchProbeBrowser();
  const page = await open({width: 1440, height: 1000});
  assert.equal(await updateButton(page).count(), 0, 'no button while nothing is ready');

  update = {available: true, updating: false, failed: null};
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await updateButton(page).waitFor();
  const settingsBox = await page.getByRole('button', {name: '設定', exact: true}).boundingBox(),
    updateBox = await updateButton(page).boundingBox();
  assert.ok(updateBox.x > settingsBox.x + settingsBox.width - 1, 'update sits to the right of settings');
  assert.ok(Math.abs(updateBox.y + updateBox.height / 2 - (settingsBox.y + settingsBox.height / 2)) < 4, 'same row');
  await page.screenshot({path: path.join(output, 'desktop-ready.png')});

  await updateButton(page).click();
  await page.locator('.self-update-notice').getByText('還有工作在跑，等結束再按。').waitFor();
  assert.deepEqual(posts, [{}], 'one request with an empty body; the version is chosen by K');

  answer = {status: 200, json: {started: true}};
  await updateButton(page).click();
  await page.locator('.self-update-notice').getByText('K 更新中…').waitFor();
  assert.equal(await updateButton(page).isDisabled(), true, 'no second press while updating');
  assert.ok(await page.evaluate(() => Number(sessionStorage.getItem('k-self-update-at')) > 0));
  await page.close();

  update = {available: true, updating: false, failed: {reason: '測試未通過', finishedAt: '2026-10-24T00:00:00.000Z'}};
  const phone = await open({width: 390, height: 844});
  await phone.getByRole('button', {name: '展開側欄', exact: true}).click();
  await updateButton(phone).waitFor();
  await phone.locator('.self-update-failed').getByText('上次更新沒成功：測試未通過').waitFor();
  await phone.screenshot({path: path.join(output, 'phone-failed.png')});
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      hiddenWhenNotReady: true,
      besideSettings: true,
      busyRefusal: true,
      phone: true,
      output
    })
  );
} finally {
  await browser?.close();
  await server.httpServer.close();
}
