// Built selectors and real Chromium; synthetic catalog and requests, no inference.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {preview} from 'vite';
import {geminiModelsFrom} from '../src/gemini-controller.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = probeEvidenceDir('antigravity-model-picker');
await mkdir(out, {recursive: true});
const agy = geminiModelsFrom([
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium'
]);
const models = [
  {model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', provider: 'codex', supportedReasoningEfforts: []},
  {model: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', provider: 'claude', supportedReasoningEfforts: []},
  ...agy
];
const state = {
  threadId: null,
  workspace: root,
  status: 'idle',
  busy: false,
  messages: [],
  tools: [],
  questions: [],
  artifacts: [],
  provider: 'codex',
  model: 'gpt-6.1-sol',
  accessMode: 'danger-full-access',
  capabilities: {},
  conversationActivity: []
};
const server = await preview({preview: {host: '127.0.0.1', port: 5219, strictPort: true}});
let browser;
try {
  browser = await launchProbeBrowser();
  for (const [width, height, label] of [
    [1440, 1000, 'desktop'],
    [390, 844, 'mobile']
  ]) {
    const page = await browser.newPage({viewport: {width, height}}),
      posts = [],
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(state => {
      window.EventSource = class {
        constructor() {
          setTimeout(() => this.onmessage?.({data: JSON.stringify({type: 'snapshot', state})}), 0);
        }
        close() {}
      };
    }, state);
    await page.route('**/api/**', async route => {
      const req = route.request(),
        p = new URL(req.url()).pathname;
      let body = {};
      if (req.method() === 'POST') {
        const data = req.postDataJSON();
        posts.push({path: p, data});
        body =
          p === '/api/open'
            ? {...state, ...data, threadId: `agy-${label}`, provider: 'gemini', status: 'ready'}
            : {ok: true};
      } else if (p === '/api/state') body = state;
      else if (p === '/api/models') body = {models, claudeGateway: true, geminiGateway: true};
      else if (p === '/api/projects') body = {projects: [{path: root, name: '合成工作區'}]};
      else if (p === '/api/sessions') body = {sessions: []};
      else if (p === '/api/claude/auth')
        body = {
          available: true,
          auth: {loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro'}
        };
      else if (p === '/api/gemini/accounts') body = {enabled: false, accounts: []};
      else if (p.endsWith('/auth'))
        body = {available: true, installed: true, auth: {loggedIn: true, authMethod: 'chatgpt'}};
      await route.fulfill({json: body});
    });
    await page.goto('http://127.0.0.1:5219');
    if (!(await page.getByRole('button', {name: '新對話', exact: true}).count()))
      await page.getByRole('button', {name: '展開側欄'}).click();
    await page.getByRole('button', {name: '新對話', exact: true}).click();
    const providers = page.getByRole('group', {name: '選擇主代理提供者', exact: true});
    const details = page.locator('.worker-settings');
    await details.locator('summary').click();
    const worker = page.getByLabel('子代理模型', {exact: true}),
      efforts = page.getByLabel('子代理推理程度', {exact: true});
    for (const provider of ['GPT', 'Claude', 'Gemini']) {
      await providers.getByRole('button', {name: provider, exact: true}).click();
      if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
      const rows = await worker
        .locator('option')
        .evaluateAll(nodes => nodes.map(n => ({id: n.value, group: n.parentElement.label})));
      for (const model of agy) assert(rows.some(r => r.id === model.model && r.group === 'Gemini'));
    }
    await worker.selectOption('antigravity:claude-sonnet-4-6');
    assert.equal(await efforts.isDisabled(), true);
    assert.equal(await efforts.inputValue(), '');
    await worker.selectOption('antigravity:gpt-oss-120b');
    assert.deepEqual(await efforts.locator('option').evaluateAll(ns => ns.map(n => n.value)), ['medium']);
    await worker.selectOption('antigravity:claude-sonnet-4-6');
    await page.getByRole('button', {name: '主代理模型', exact: true}).click();
    const menu = page.getByRole('menu', {name: '主代理模型選單', exact: true});
    assert.equal(await menu.getByRole('menuitemradio').count(), 4);
    for (const model of agy)
      assert.equal(await menu.getByRole('menuitemradio', {name: model.displayName, exact: true}).count(), 1);
    await page.screenshot({path: path.join(out, `${label}.png`), fullPage: true});
    await menu.getByRole('menuitemradio', {name: agy.at(-1).displayName, exact: true}).click();
    await page.getByLabel('主代理推理程度', {exact: true}).selectOption('medium');
    await page.getByRole('button', {name: '建立對話', exact: true}).click();
    await page.getByRole('button', {name: '建立對話', exact: true}).waitFor({state: 'detached'});
    const opens = posts.filter(p => p.path === '/api/open');
    assert.equal(opens.length, 1);
    assert.equal(opens[0].data.model, 'antigravity:gpt-oss-120b');
    assert.equal(opens[0].data.effort, 'medium');
    assert.deepEqual(opens[0].data.workerPolicy, {model: 'antigravity:claude-sonnet-4-6', effort: null});
    assert.deepEqual(errors, []);
    await page.close();
  }
  const result = {
    passed: true,
    syntheticCatalog: true,
    inference: false,
    viewports: ['desktop', 'mobile'],
    models: agy.map(m => m.model)
  };
  await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
