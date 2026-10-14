// Built UI with simulated native focus; no real accounts or provider calls.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {preview} from 'vite';
const output = process.env.K_ATTENTION_PROBE_OUTPUT
  ? path.resolve(process.env.K_ATTENTION_PROBE_OUTPUT)
  : probeEvidenceDir('taskbar-attention-20261004/ui');
await mkdir(output, {recursive: true});
const server = await preview({preview: {host: '127.0.0.1', port: 5197, strictPort: true}});
const workspace = process.cwd(),
  errors = [],
  results = [];
let browser;
try {
  browser = await launchProbeBrowser();
  for (const [width, height, scale, theme] of [
    [1920, 1080, 100, 'warm'],
    [1100, 760, 125, 'light'],
    [900, 700, 150, 'dark'],
    [1440, 900, 100, 'warm'],
    [393, 852, 100, 'light']
  ]) {
    let state = {
      threadId: 'a',
      workspace,
      status: 'completed',
      busy: false,
      title: '測試 A',
      model: 'gpt-6.1-sol',
      provider: 'codex',
      messages: [{id: 'answer', role: 'assistant', text: '測試完成。'}],
      tools: [],
      questions: [],
      artifacts: [],
      workers: [],
      workerActivity: {running: 0, uncertain: false},
      conversationActivity: [],
      accessMode: 'workspace-write',
      capabilities: {},
      completionAttention: {
        sequence: 3,
        unread: ['a', 'b', 'c'].map((threadId, i) => ({
          threadId,
          sequence: i + 1,
          ...(threadId === 'b' ? {kind: 'attention'} : {})
        }))
      }
    };
    const reads = [],
      page = await browser.newPage({viewport: {width, height}});
    page.setDefaultTimeout(7000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(
      ({state, scale, theme}) => {
        localStorage.setItem('k-appearance', JSON.stringify({interfaceScale: scale, dialogueFontSize: 18}));
        localStorage.setItem('k-color-theme', theme);
        window.EventSource = class {
          constructor() {
            window.testStream = this;
            setTimeout(() => this.onmessage?.({data: JSON.stringify({type: 'snapshot', state})}), 0);
          }
          close() {}
        };
        window.kBrowser = {
          onWindowFocusChanged(callback) {
            window.testFocus = callback;
            callback({focused: false});
            return () => {};
          }
        };
      },
      {state, scale, theme}
    );
    const update = async changes => {
      state = {...state, ...changes};
      await page.evaluate(
        changes => window.testStream.onmessage({data: JSON.stringify({type: 'patch', changes})}),
        changes
      );
    };
    await page.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') {
        assert.equal(endpoint, '/api/attention/read');
        const data = route.request().postDataJSON();
        reads.push(data);
        state.completionAttention = {
          ...state.completionAttention,
          unread: state.completionAttention.unread.filter(
            x => !(x.threadId === data.threadId && x.sequence === data.sequence)
          )
        };
        await route.fulfill({json: {viewed: true}});
        await update({completionAttention: state.completionAttention});
        return;
      }
      const json =
        endpoint === '/api/state'
          ? state
          : endpoint === '/api/projects'
            ? {projects: [{path: workspace, name: '測試工作區'}]}
            : endpoint === '/api/sessions'
              ? {
                  sessions: ['a', 'b', 'c'].map(threadId => ({
                    threadId,
                    workspace,
                    title: '測試 ' + threadId.toUpperCase(),
                    model: state.model
                  }))
                }
              : endpoint === '/api/models'
                ? {
                    models: [
                      {
                        model: state.model,
                        displayName: 'GPT-6.1 Sol',
                        provider: 'codex',
                        supportedReasoningEfforts: [{reasoningEffort: 'high'}]
                      }
                    ]
                  }
                : {};
      await route.fulfill({json});
    });
    await page.goto('http://127.0.0.1:5197');
    await page.waitForFunction(() => document.querySelectorAll('.completed-unread').length === 3);
    assert.equal(reads.length, 0, 'selected room stays unread while native window is unfocused');
    assert.equal(await page.getByLabel('工作需注意', {exact: true}).count(), 1);
    await page.evaluate(() => window.testFocus({focused: true}));
    await page.waitForFunction(() => document.querySelectorAll('.completed-unread').length === 2);
    assert.deepEqual(reads, [{threadId: 'a', sequence: 1}], 'focusing K reads only A, not all rooms');
    await page.evaluate(() => window.testFocus({focused: false}));
    await update({
      threadId: 'b',
      title: '測試 B',
      status: 'failed',
      error: '假資料：原生 compact/stream 已最終失敗',
      messages: [{id: 'partial', role: 'assistant', text: '假資料：已保存的部分結果。', partial: true}]
    });
    if (width < 600) await page.getByRole('button', {name: '展開側欄', exact: true}).click();
    await page.getByRole('button', {name: '設定', exact: true}).click();
    await page.evaluate(() => window.testFocus({focused: true}));
    await page.waitForTimeout(150);
    assert.equal(reads.length, 1, 'settings covering the chat does not read it');
    await page.getByRole('dialog').getByRole('button', {name: '關閉', exact: true}).click();
    if (width < 600) await page.getByRole('button', {name: '收合側欄', exact: true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.completed-unread').length === 1);
    assert.deepEqual(reads.at(-1), {threadId: 'b', sequence: 2, kind: 'attention'});
    await page.evaluate(() => window.testFocus({focused: false}));
    await update({
      completionAttention: {
        sequence: 4,
        unread: [
          {threadId: 'b', sequence: 4, kind: 'attention'},
          {threadId: 'c', sequence: 3}
        ]
      }
    });
    await page.waitForFunction(() => document.querySelectorAll('.completed-unread').length === 2);
    assert.equal(reads.length, 2, 'new background completion stays unread');
    assert.ok(
      await page.getByText('假資料：原生 compact/stream 已最終失敗', {exact: false}).count(),
      'main failure remains visible'
    );
    assert.equal(await page.locator('.app.inspector-hidden').count(), 1, 'no forced panel');
    await page.screenshot({path: path.join(output, width + '-' + scale + '-' + theme + '.png')});
    await page.evaluate(() => window.testStream.onerror());
    await page.evaluate(() => window.testFocus({focused: true}));
    await page.waitForTimeout(100);
    assert.equal(reads.length, 2, 'disconnection does not acknowledge stale content');
    await page.evaluate(state => window.testStream.onmessage({data: JSON.stringify({type: 'snapshot', state})}), state);
    await page.waitForFunction(() => document.querySelectorAll('.completed-unread').length === 1);
    assert.deepEqual(reads.at(-1), {threadId: 'b', sequence: 4, kind: 'attention'});
    results.push({width, height, scale, theme, reads});
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({results, errors}, null, 2));
  console.log(JSON.stringify({passed: results.length, errors}));
} finally {
  await browser?.close();
  await server.httpServer.close();
}
