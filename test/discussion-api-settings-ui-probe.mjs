// Playwright coverage for the discussion API settings UI using only fake request/fetch responses.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build, preview} from 'vite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {scratchBase} from './scratch.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = path.join(root, 'test/fixtures');
const output = path.join(scratchBase, 'discussion-api-settings-ui-probe');
await build({
  configFile: false,
  root: fixtureRoot,
  build: {
    outDir: output,
    emptyOutDir: false,
    rollupOptions: {input: path.join(fixtureRoot, 'discussion-api-settings-ui.html')}
  }
});
const server = await preview({
  configFile: false,
  root: output,
  build: {outDir: '.'},
  preview: {host: '127.0.0.1', port: 0, strictPort: false}
});
let browser;
try {
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}/discussion-api-settings-ui.html`;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.K_UI_CHROMIUM ??
      path.resolve('D:/K-harness/.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe')
  });
  const page = await browser.newPage({viewport: {width: 1200, height: 900}}),
    errors = [];
  await page.route('**/favicon.ico', route => route.fulfill({status: 204, body: ''}));
  const requested = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => requested.push(request.url()));
  page.on('requestfailed', request => errors.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));
  await page.goto(origin, {waitUntil: 'commit', timeout: 15000});
  try {
    await page.getByText('尚未設定討論用 API 連線。').waitFor({timeout: 15000});
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      body: document.body.innerHTML,
      scripts: [...document.scripts].map(s => s.src)
    }));
    throw Error(
      `${error.message}\nBrowser errors: ${errors.join(' | ')}\nRequests: ${requested.join(' | ')}\nPage: ${JSON.stringify(diagnostic)}`
    );
  }
  const settingCalls = () => page.evaluate(() => window.testRequestLog);
  assert.deepEqual(
    (await settingCalls()).map(call => call.route),
    ['discussion/connections']
  );

  await page.getByRole('button', {name: '新增 API 連線', exact: true}).click();
  const provider = page.locator('.discussion-api-form select'),
    name = page.locator('.discussion-api-form input').nth(0),
    baseUrl = page.locator('.discussion-api-form input').nth(1),
    apiKey = page.locator('.discussion-api-form input[type="password"]'),
    models = page.locator('.discussion-api-form textarea');
  assert.deepEqual(await provider.locator('option').evaluateAll(options => options.map(option => option.value)), [
    'deepseek',
    'glm',
    'kimi',
    'custom'
  ]);
  await provider.selectOption('custom');
  await baseUrl.fill('https://custom.example/v1');
  await provider.selectOption('deepseek');
  assert.equal(await baseUrl.inputValue(), 'https://api.deepseek.com');
  assert.equal(await name.inputValue(), 'DeepSeek');
  await provider.selectOption('custom');
  await name.fill('Custom connection');
  await baseUrl.fill('https://custom.example/v1');
  await apiKey.fill('FAKE-KEY-never-persist');
  assert.equal(await apiKey.getAttribute('type'), 'password');
  assert.equal(await models.evaluate(element => element.required), false);
  const stored = await page.evaluate(() => JSON.stringify({local: localStorage, session: sessionStorage}));
  assert.equal(stored.includes('FAKE-KEY-never-persist'), false);
  await page.getByRole('button', {name: '保存連線', exact: true}).click();
  await page.getByText('討論用 API 連線已保存。', {exact: true}).waitFor();
  let calls = await settingCalls();
  const saved = calls.find(call => call.route === 'discussion/connections/save');
  assert.deepEqual(saved.data.models, []);
  assert.equal(saved.data.apiKey, 'FAKE-KEY-never-persist');
  assert.equal(
    await page.locator('.discussion-api-form input[type="password"]').count(),
    0,
    'successful save closes and clears the key field'
  );
  await page.getByRole('button', {name: '編輯', exact: true}).click();
  assert.equal(await apiKey.inputValue(), '');
  await page.getByRole('button', {name: '查詢模型', exact: true}).click();
  await page.waitForFunction(() => window.testRequestLog.some(call => call.route === 'discussion/connections/models'));
  await page.locator('.discussion-api-card').getByText('模型：Catalog model', {exact: true}).waitFor();
  assert.deepEqual((await settingCalls()).filter(call => call.route === 'discussion/connections/models').at(-1).data, {
    id: 'connection-1'
  });

  const mode = page.getByLabel('對話模式', {exact: true});
  await mode.selectOption('parallel');
  const participant = page.getByLabel('參與模型 1', {exact: true});
  await page.waitForFunction(() => window.testFetchLog?.includes('/api/discussion/models'));
  const options = await participant.locator('option').evaluateAll(elements =>
    elements.map(option => ({
      value: option.value,
      label: option.textContent,
      group: option.parentElement.label ?? ''
    }))
  );
  assert(options.some(option => option.group.includes('OpenAI／Codex（訂閱）')));
  assert(options.some(option => option.group.includes('API · DeepSeek')));
  const native = options.find(option => option.label === 'Native shared model'),
    api = options.find(option => option.label === 'API shared model');
  assert(native && api);
  assert.notEqual(native.value, api.value, 'same model ID has distinct native/API selection values');
  await participant.selectOption(native.value);
  assert.deepEqual(JSON.parse(await page.locator('#saved-config').textContent()).participants[0], {
    model: 'shared-id',
    effort: ''
  });
  await participant.selectOption(api.value);
  assert.deepEqual(JSON.parse(await page.locator('#saved-config').textContent()).participants[0], {
    route: 'api',
    connectionId: 'connection-1',
    model: 'shared-id',
    effort: ''
  });
  await participant.selectOption(native.value);
  const nativeConfig = JSON.parse(await page.locator('#saved-config').textContent()).participants[0];
  assert.equal(nativeConfig.route, undefined, 'switching back to native does not retain the old API route');
  const catalogReads = await page.evaluate(() => window.testFetchLog.length);
  await name.fill('Updated connection');
  await page.getByRole('button', {name: '保存連線', exact: true}).click();
  await page.waitForFunction(count => window.testFetchLog.length > count, catalogReads);
  assert.equal(await participant.count(), 1, 'settings save refreshes an already open participant catalog');
  assert.deepEqual(errors, []);

  for (const preset of [
    {id: 'glm', name: 'GLM', url: 'https://api.z.ai/api/paas/v4'},
    {id: 'kimi', name: 'Kimi', url: 'https://api.moonshot.cn/v1'}
  ]) {
    const presetPage = await browser.newPage();
    await presetPage.route('**/favicon.ico', route => route.fulfill({status: 204, body: ''}));
    await presetPage.goto(origin);
    await presetPage.getByText('尚未設定討論用 API 連線。').waitFor();
    await presetPage.getByRole('button', {name: '新增 API 連線', exact: true}).click();
    const form = presetPage.locator('.discussion-api-form'),
      providerField = form.locator('select'),
      nameField = form.locator('input').nth(0),
      urlField = form.locator('input').nth(1),
      keyField = form.locator('input[type="password"]'),
      modelField = form.locator('textarea');
    await providerField.selectOption('deepseek');
    await keyField.fill('FAKE-OTHER-PROVIDER-KEY');
    await modelField.fill('old-provider-model');
    await providerField.selectOption(preset.id);
    assert.equal(await nameField.inputValue(), preset.name);
    assert.equal(await urlField.inputValue(), preset.url);
    assert.equal(await keyField.inputValue(), '', 'provider switch does not carry a typed key to another service');
    assert.equal(await modelField.inputValue(), '', 'provider switch does not carry the old model IDs');
    assert.deepEqual(
      (await presetPage.evaluate(() => window.testRequestLog)).map(call => call.route),
      ['discussion/connections'],
      'selecting a preset neither saves nor queries a real provider'
    );
    await keyField.fill('FAKE-PRESET-KEY');
    await urlField.fill(`${preset.url}/`);
    await presetPage.getByRole('button', {name: '保存連線', exact: true}).click();
    await presetPage.getByText('討論用 API 連線已保存。', {exact: true}).waitFor();
    const presetSave = (await presetPage.evaluate(() => window.testRequestLog)).find(
      call => call.route === 'discussion/connections/save'
    );
    assert.deepEqual(presetSave.data, {
      name: preset.name,
      baseUrl: `${preset.url}/`,
      apiKey: 'FAKE-PRESET-KEY',
      models: []
    });
    await presetPage.getByRole('button', {name: '編輯', exact: true}).click();
    assert.equal(
      await providerField.inputValue(),
      preset.id,
      'editing recognizes the preset, including a trailing slash'
    );
    assert.equal(await keyField.inputValue(), '', 'editing never reads a saved key into the form');
    await presetPage.getByRole('button', {name: '查詢模型', exact: true}).click();
    await presetPage.locator('.discussion-api-card').getByText('模型：Catalog model', {exact: true}).waitFor();
    await nameField.fill('我的討論連線');
    await providerField.selectOption('deepseek');
    assert.equal(await nameField.inputValue(), '我的討論連線', 'preset selection preserves a custom connection name');
    assert.equal(await modelField.inputValue(), '');
    await providerField.selectOption('custom');
    assert.equal(
      await urlField.inputValue(),
      '',
      'custom choice clears a preset URL rather than keeping the wrong service'
    );
    await presetPage.close();
  }

  const remote = await browser.newPage();
  await remote.route('**/favicon.ico', route => route.fulfill({status: 204, body: ''}));
  await remote.goto(`${origin}?remote=1`);
  await remote.getByText('討論用 API 連線請在電腦端設定。', {exact: true}).waitFor();
  assert.deepEqual(
    await remote.evaluate(() => window.testRequestLog),
    [],
    'remote-disabled settings do not GET connection data'
  );
  assert.deepEqual(
    await remote.evaluate(() => window.testFetchLog ?? []),
    [],
    'remote view does not open the API participant catalog itself'
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'blank model save and later catalog query',
        'DeepSeek preset overrides custom URL',
        'GLM and Kimi presets, save, edit and explicit model query',
        'provider switch clears typed keys and model IDs but preserves custom names',
        'password input and no browser storage',
        'save clears key',
        'remote disabled makes no GET',
        'subscription/API grouping',
        'same ID route collision avoided',
        'API/native route switching',
        'settings mutation refreshes open catalog'
      ]
    })
  );
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
