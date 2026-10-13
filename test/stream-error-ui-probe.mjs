// Built UI with fake snapshots only; no formal K or provider calls.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const root = process.cwd(),
  out = path.resolve('.runtime/stream-error-ui-probe');
await mkdir(out, {recursive: true});
const server = await preview({preview: {host: '127.0.0.1', port: 5199, strictPort: true}}),
  results = [],
  errors = [];
const samples = [
  [
    'response',
    'stream disconnected before completion: An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID fake-request-id in your message.',
    'Codex 回覆在完成前中斷；本輪未完成。接續前先核對已保存成果，K 不會自動重送。'
  ],
  [
    'remote-compact',
    'Error running remote compact task: stream disconnected before completion: An error occurred while processing your request. Please include the request ID fake-compact-request-id in your message.',
    'Codex 原生壓縮在完成前中斷；本輪未完成。接續前先核對已保存成果，K 不會自動重送。'
  ]
];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.K_TEST_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });
  for (const [sample, raw, expected] of samples)
    for (const [width, height, remote] of [
      [1440, 900, false],
      [393, 852, true]
    ]) {
      const error = {message: raw, codexErrorInfo: 'other', additionalDetails: null};
      const page = await browser.newPage({viewport: {width, height}}),
        requests = [];
      page.setDefaultTimeout(7000);
      page.on('pageerror', e => errors.push(e.message));
      const state = {
        threadId: 'fake-room',
        title: '假資料：原生串流失敗',
        workspace: root,
        provider: 'codex',
        model: 'gpt-6.1-sol',
        status: 'failed',
        busy: false,
        error: raw,
        turnError: {threadId: 'fake-room', turnId: 'fake-turn', status: 'failed', error},
        goal: {objective: '假工作', status: 'blocked'},
        messages: [
          {
            id: 'fake-answer',
            role: 'assistant',
            turnId: 'fake-turn',
            text: '這是已保存的部分進度。',
            partial: true,
            createdAt: '2026-10-10T00:00:00Z',
            completedAt: '2026-10-10T00:01:00Z'
          }
        ],
        tools: [],
        questions: [],
        notices: [{id: 'failure', kind: 'nativeError', level: 'error', message: raw, error}],
        artifacts: [],
        capabilities: {},
        conversationActivity: [],
        workerActivity: {running: 0, unconfirmed: 0, uncertain: false}
      };
      if (remote)
        await page.route('http://127.0.0.1:5199/', async route => {
          const response = await route.fetch();
          await route.fulfill({response, body: (await response.text()).replace('<html', '<html data-k-remote="true"')});
        });
      await page.addInitScript(state => {
        window.EventSource = class {
          constructor() {
            window.testState = s => this.onmessage?.({data: JSON.stringify({type: 'snapshot', state: s})});
            setTimeout(() => {
              this.onopen?.();
              window.testState(state);
            }, 0);
          }
          close() {}
        };
      }, state);
      await page.route('**/api/**', async route => {
        requests.push(route.request().method());
        const name = new URL(route.request().url()).pathname;
        await route.fulfill({
          json:
            name === '/api/state'
              ? state
              : name === '/api/projects'
                ? {projects: [{path: root, name: '假工作區'}]}
                : name === '/api/sessions'
                  ? {sessions: []}
                  : name === '/api/models'
                    ? {models: []}
                    : name.endsWith('/auth')
                      ? {available: false}
                      : {}
        });
      });
      await page.goto('http://127.0.0.1:5199');
      await page.getByRole('heading', {name: state.title}).waitFor();
      await page.getByText(expected, {exact: true}).waitFor();
      assert.equal(await page.locator('[role="alert"]').count(), 1, 'failure is shown once');
      assert.equal(await page.getByText('這是已保存的部分進度。', {exact: true}).count(), 1);
      if (!remote) await page.getByText('工作失敗', {exact: true}).first().waitFor();
      await page.getByText('目標 · 受阻', {exact: true}).waitFor();
      assert.equal(
        await page.locator('.remote-reconnect').count(),
        0,
        'native failure does not become phone reconnect/login'
      );
      if (remote) await page.getByText('已連線', {exact: true}).waitFor();
      const details = page.locator('main > [role="alert"] details');
      assert.equal(await details.locator('pre').isVisible(), false);
      await page.screenshot({path: path.join(out, `${sample}-${width}-summary.png`)});
      await details.locator('summary').click();
      assert.deepEqual(JSON.parse(await details.locator('pre').textContent()), state.turnError);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({path: path.join(out, `${sample}-${width}-raw-details.png`)});
      const retry = {
        id: 'retry',
        kind: 'nativeError',
        level: 'error',
        turnId: 'new-turn',
        retryKey: 'episode',
        message: raw,
        error,
        willRetry: true
      };
      await page.evaluate(
        state =>
          window.testState({
            ...state,
            status: 'working',
            busy: true,
            error: null,
            turnError: null,
            notices: [state.retry]
          }),
        {...state, retry}
      );
      await page.getByText('原生核心正在重試…', {exact: true}).waitFor();
      assert.equal(await page.getByText(expected, {exact: true}).count(), 0);
      assert.equal(requests.includes('POST'), false, 'display and details must not submit or replay work');
      results.push({
        sample,
        width,
        height,
        remote,
        passed: true,
        checks: [
          'single localized failure',
          'partial reply retained',
          'raw error and request ID retained',
          'mobile connected',
          'no reconnect/login confusion',
          'native retry distinct',
          'no horizontal overflow',
          'no POST'
        ]
      });
      await page.close();
    }
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'result.json'), JSON.stringify({results, errors}, null, 2));
  console.log(JSON.stringify({results, errors}));
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
