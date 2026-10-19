// Built UI with fake API/snapshot data only: no formal K, LM Studio, model load,
// inference or provider call. Observes the self-hosted model-picker note,
// permission copy, Chinese failure notice with raw details, and the
// preparation wording of the work status.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {preview} from 'vite';

const root = process.cwd(),
  origin = 'http://127.0.0.1:5237',
  out = probeEvidenceDir('selfhost-ui-probe');
await mkdir(out, {recursive: true});
const server = await preview({preview: {host: '127.0.0.1', port: 5237, strictPort: true}});
const selfHostModel = 'selfhost-dolphin-mistral-24b/dolphin-mistral-24b-venice-edition';
const models = [
  {
    model: 'gpt-6.1-sol',
    displayName: 'GPT-6.1-Sol',
    provider: 'codex',
    supportedReasoningEfforts: [{reasoningEffort: 'high'}],
    defaultReasoningEffort: 'high',
    inputModalities: ['text']
  },
  {
    model: selfHostModel,
    displayName: 'Dolphin Mistral 24B Venice Edition Q4_K_M · 本機',
    provider: 'gemma',
    available: true,
    supportedReasoningEfforts: [],
    inputModalities: ['text']
  }
];
// Exact turn error observed from installed Codex 0.163.0 against a loopback HTTP 400
// (mock native endpoint; no model engine invoked): one call, no retry, turn failed.
const observed = {
  message:
    '{"error":{"message":"本機模型載入失敗；未送出推論。","code":"k_selfhost_load_failed","diagnostic":{"stderr":"Synthetic native load error; no model engine invoked."}}}',
  codexErrorInfo: 'other',
  additionalDetails: null
};
const results = [],
  errors = [],
  posts = [];

async function openPage(browser, state) {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  page.setDefaultTimeout(7000);
  page.on('pageerror', e => errors.push(e.message));
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
    const request = route.request(),
      name = new URL(request.url()).pathname;
    if (request.method() === 'POST') posts.push(name);
    await route.fulfill({
      json:
        name === '/api/state'
          ? state
          : name === '/api/projects'
            ? {projects: [{path: root, name: '假工作區'}]}
            : name === '/api/sessions'
              ? {sessions: []}
              : name === '/api/models'
                ? {models}
                : name.endsWith('/auth')
                  ? {available: false}
                  : {}
    });
  });
  await page.goto(origin);
  return page;
}

let browser;
try {
  browser = await launchProbeBrowser();

  // 1. New-conversation dialog: self-host note and permission copy.
  {
    const page = await openPage(browser, {
      threadId: null,
      workspace: root,
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
    });
    await page.getByRole('button', {name: '新對話', exact: true}).click();
    const providers = page.getByRole('group', {name: '選擇主代理提供者', exact: true});
    const note = '選取不會載入模型；本機模型在送出工作後才由 K 在背景載入。';
    await providers.getByRole('button', {name: 'GPT', exact: true}).click();
    assert.equal(await page.getByText(note, {exact: true}).count(), 0, 'note is self-host only');
    const trigger = page.getByRole('button', {name: '新對話操作權限', exact: true}),
      menu = page.getByRole('menu', {name: '操作權限選單', exact: true});
    await trigger.click();
    await menu.waitFor({state: 'visible'});
    const gptFull = await menu.getByRole('menuitemradio', {name: /^完整存取權/}).textContent();
    assert.match(gptFull, /K 沒有另外的隔離層/);
    assert.doesNotMatch(gptFull, /外部隔離/);
    assert.match(await menu.getByRole('menuitemradio', {name: /^代我核准/}).textContent(), /額外存取由 Codex 自動審查/);
    await page.keyboard.press('Escape');
    await menu.waitFor({state: 'hidden'});

    await providers.getByRole('button', {name: '自架', exact: true}).click();
    await page.getByText(note, {exact: true}).waitFor();
    await trigger.click();
    await menu.waitFor({state: 'visible'});
    const autoReview = await menu.getByRole('menuitemradio', {name: /^代我核准/}).textContent(),
      full = await menu.getByRole('menuitemradio', {name: /^完整存取權/}).textContent();
    assert.match(autoReview, /沿用 Codex 原生自動審查設定/);
    assert.match(autoReview, /尚未驗證/);
    assert.match(full, /K 沒有另外的隔離層/);
    for (const text of [autoReview, full]) assert.doesNotMatch(text, /外部隔離|Dolphin|GPT|已驗證/);
    await page.screenshot({path: path.join(out, 'selfhost-permission-menu.png')});
    await menu.getByRole('menuitemradio', {name: /^代我核准/}).click();
    const confirm = page.getByRole('group', {name: '確認操作權限', exact: true});
    await confirm.getByText('改用 Codex 原生自動審查？', {exact: true}).waitFor();
    assert.match(await confirm.textContent(), /尚未驗證.*K 不會替你改成其他權限模式/s);
    await page.screenshot({path: path.join(out, 'selfhost-auto-review-confirm.png')});
    await confirm.getByRole('button', {name: '取消', exact: true}).click();
    // Cancelling keeps the default; nothing was chosen or sent for the owner.
    assert.equal((await trigger.textContent()).trim(), '要求核准');
    assert.equal(posts.includes('/api/open'), false);
    results.push({part: 'new-dialog', passed: true});
    await page.close();
  }

  // 2. Self-hosted room: Chinese failure first, raw native record expandable.
  {
    const state = {
      threadId: 'fake-selfhost-room',
      title: '假資料：自架模型載入失敗',
      workspace: root,
      provider: 'gemma',
      model: selfHostModel,
      accessMode: 'workspace-write',
      status: 'failed',
      busy: false,
      error: observed.message,
      turnError: {threadId: 'fake-selfhost-room', turnId: 'fake-turn', status: 'failed', error: observed},
      messages: [
        {id: 'fake-user', role: 'user', turnId: 'fake-turn', text: '你好 你中文如何?', createdAt: '2026-10-19T12:01:00Z'}
      ],
      tools: [],
      questions: [],
      notices: [{id: 'failure', kind: 'nativeError', level: 'error', message: observed.message, error: observed}],
      artifacts: [],
      capabilities: {},
      conversationActivity: [],
      workerActivity: {running: 0, unconfirmed: 0, uncertain: false}
    };
    const page = await openPage(browser, state);
    await page.getByRole('heading', {name: state.title}).waitFor();
    const alert = page.locator('main > [role="alert"]');
    await alert.getByText('本機模型載入失敗；未送出推論。', {exact: true}).waitFor();
    assert.equal(await page.locator('[role="alert"]').count(), 1, 'failure is shown once');
    let details = alert.locator('details');
    // The untranslated native diagnostic stays collapsed until asked for.
    assert.equal(await details.locator('pre').isVisible(), false);
    assert.equal(await details.locator('summary').textContent(), '查看原生錯誤詳細內容');
    await page.screenshot({path: path.join(out, 'selfhost-failure-summary.png')});
    await details.locator('summary').click();
    assert.deepEqual(JSON.parse(await details.locator('pre').textContent()), state.turnError);
    await page.screenshot({path: path.join(out, 'selfhost-failure-raw.png')});

    // Permission menu inside the self-hosted room uses the same honest copy.
    await page.locator('.composer-options .permission-trigger').click();
    const menu = page.getByRole('menu', {name: '操作權限選單', exact: true});
    await menu.waitFor({state: 'visible'});
    assert.match(await menu.getByRole('menuitemradio', {name: /^代我核准/}).textContent(), /尚未驗證/);
    await page.keyboard.press('Escape');

    // A K error string without a native record still offers its original text.
    await page.evaluate(s => window.testState({...s, turnError: null, notices: []}), state);
    await alert.getByText('本機模型載入失敗；未送出推論。', {exact: true}).waitFor();
    details = alert.locator('details');
    await details.getByText('查看原始內容', {exact: true}).waitFor();
    await details.locator('summary').click();
    assert.equal(await details.locator('pre').textContent(), observed.message);

    // 3. Busy self-hosted turn before model output: honest preparation wording only.
    const now = await page.evaluate(() => Date.now());
    await page.evaluate(
      s => window.testState(s),
      {
        ...state,
        status: 'working',
        busy: true,
        error: null,
        turnError: null,
        notices: [],
        activity: {startedAt: now, lastEventAt: now, phase: 'starting', phaseSince: now}
      }
    );
    const status = page.locator('.work-status').first();
    await status.getByText(/^正在準備自架模型或等待回覆 · /).waitFor();
    assert.doesNotMatch(await status.textContent(), /已載入|正在載入|執行中/);
    await page.screenshot({path: path.join(out, 'selfhost-preparing-status.png')});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(posts.length, 0, 'viewing never submits, loads or replays work');
    results.push({part: 'selfhost-room', passed: true});
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'result.json'), JSON.stringify({results, errors, posts}, null, 2));
  console.log(JSON.stringify({results, errors}));
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
