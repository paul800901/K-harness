// Real HTTP/SSE + built UI + conversation controller; only native providers are fake.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const {createConversationController} = await import(
  process.env.K_PROBE_CONTROLLER_MODULE ?? '../src/conversation-controller.mjs'
);
import {saveMainSession} from '../src/main-sessions.mjs';
import {startDesktop} from '../src/desktop-server.mjs';

const out = fileURLToPath(new URL('../.runtime/independent-load-handoff-20261012/ui/', import.meta.url));
await mkdir(out, {recursive: true});
const until = async predicate => {
  const end = Date.now() + 7000;
  while (!(await predicate())) {
    if (Date.now() > end) throw Error('observable state not reached');
    await new Promise(r => setTimeout(r, 20));
  }
};
const results = [];
for (const viewport of [
  {width: 1440, height: 960},
  {width: 390, height: 844}
]) {
  const root = await mkdtemp(path.join(out, 'fixture-')),
    model = 'gpt-6.1-sol';
  const owners = [],
    calls = [],
    gates = new Map();
  let notify, app, browser, page;
  const errors = [],
    httpErrors = [],
    responseChecks = [],
    consoleErrors = [];
  for (const threadId of ['A', 'B', 'C', 'D', 'E'])
    await saveMainSession(root, {threadId, model, title: `假聊天室 ${threadId}`, workspace: root});
  const factory = ({onChange}) => {
    const state = {
      provider: 'codex',
      workspace: root,
      status: 'idle',
      threadId: null,
      title: '',
      model,
      busy: false,
      messages: [],
      questions: [],
      workers: [],
      tools: [],
      artifacts: [],
      notices: [],
      reasoning: [],
      turnDiffs: [],
      efforts: [],
      effort: null,
      inputModalities: [],
      modelChanges: [],
      progress: {plan: [], compaction: 'idle'},
      goal: null,
      usage: {},
      accessMode: 'workspace-write',
      capabilities: {}
    };
    const owner = {
      state,
      closed: 0,
      async models() {
        return {
          models: [
            {
              model,
              displayName: '假資料測試模型',
              provider: 'codex',
              supportedReasoningEfforts: [{reasoningEffort: 'medium'}]
            }
          ]
        };
      },
      async usage() {
        return {};
      },
      async workers() {
        return state.workers;
      },
      async selectWorkspace({path}) {
        state.workspace = path;
      },
      async open({threadId}, {signal, onHistory} = {}) {
        calls.push({method: 'open', threadId});
        Object.assign(state, {
          threadId,
          title: `假聊天室 ${threadId}`,
          status: 'connecting',
          messages: [{id: `history-${threadId}`, role: 'assistant', text: `${threadId} 房限定的假歷史，沒有模型工作。`}]
        });
        await onHistory?.(state);
        onChange();
        const gate = gates.get(threadId);
        if (gate)
          await Promise.race([
            gate.promise,
            new Promise((_, reject) => {
              if (signal?.aborted) reject(signal.reason);
              else signal?.addEventListener('abort', () => reject(signal.reason), {once: true});
            })
          ]);
        signal?.throwIfAborted();
        if (gate?.fail) throw Error(`假 ${threadId} 載入失敗`);
        state.status = 'ready';
        onChange();
        return {threadId};
      },
      async send(data) {
        calls.push({method: 'send', threadId: data.threadId, text: data.text});
        state.messages.push({id: `sent-${state.messages.length}`, role: 'user', text: data.text});
        onChange();
        return {sent: true};
      },
      async close() {
        owner.closed++;
        state.status = 'offline';
        onChange();
      }
    };
    owners.push(owner);
    return owner;
  };
  const controller = createConversationController({root, sessionFactory: factory, onChange: () => notify?.()});
  try {
    await controller.open({threadId: 'A', model});
    const a = owners.find(x => x.state.threadId === 'A');
    // A represents an existing background worker; selecting/loading must not interrupt it.
    a.state.busy = true;
    a.state.status = 'working';
    gates.set('B', Promise.withResolvers());
    gates.set('D', Promise.withResolvers());
    gates.set('E', Promise.withResolvers());
    const absent = () => ({close: async () => {}});
    app = await startDesktop({
      root,
      executable: 'fixture-only',
      port: 0,
      controllerFactory: options => {
        notify = options.onChange;
        return controller;
      },
      claudeLoginFactory: absent,
      codexLoginFactory: absent,
      geminiLoginFactory: absent,
      localDictationFactory: absent
    });
    browser = await chromium.launch({
      headless: true,
      executablePath: 'D:/K-harness/.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe'
    });
    page = await browser.newPage({viewport});
    const posts = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('request', r => {
      if (r.method() === 'POST') posts.push({path: new URL(r.url()).pathname, data: r.postDataJSON()});
    });
    page.on('response', r => {
      if (r.status() >= 400)
        responseChecks.push(
          (async () =>
            httpErrors.push({
              path: new URL(r.url()).pathname,
              status: r.status(),
              request: r.request().postDataJSON(),
              body: await r.text()
            }))()
        );
    });
    await page.goto(app.createLaunchUrl());
    const select = async id => {
      const sidebar = page.getByRole('button', {name: '展開側欄', exact: true});
      if (await sidebar.isVisible()) await sidebar.click();
      await page
        .locator('.session-open')
        .filter({hasText: `假聊天室 ${id}`})
        .click();
      await page.waitForFunction(id => document.querySelector('main header h1')?.textContent === `假聊天室 ${id}`, id);
    };
    const composer = page.locator('textarea[aria-label="工作訊息"]');
    await select('B');
    await page.getByText('B 房限定的假歷史，沒有模型工作。', {exact: true}).waitFor();
    assert.equal(await composer.isDisabled(), true);
    await select('C');
    await until(async () => !(await composer.isDisabled()));
    assert.equal(controller.state.threadId, 'C');
    assert.equal(owners.find(x => x.state.threadId === 'B').state.status, 'connecting');
    await composer.fill('只送 C 的假訊息');
    await page.getByRole('button', {name: '送出訊息', exact: true}).click();
    await until(() => calls.some(x => x.method === 'send'));
    assert.deepEqual(
      calls.filter(x => x.method === 'send'),
      [{method: 'send', threadId: 'C', text: '只送 C 的假訊息'}]
    );
    await page.locator('.user-message .user-bubble').filter({hasText: '只送 C 的假訊息'}).waitFor();
    assert.equal(a.closed, 0);
    assert.equal(a.state.busy, true);
    await page.screenshot({path: path.join(out, `c-ready-while-b-loading-${viewport.width}.png`)});
    gates.get('B').resolve();
    await until(() => owners.find(x => x.state.threadId === 'B').state.status === 'ready');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('main header h1').textContent(), '假聊天室 C');
    await select('B');
    await until(async () => !(await composer.isDisabled()));
    assert.equal(calls.filter(x => x.method === 'open' && x.threadId === 'B').length, 1);
    await select('D');
    await page.getByText('D 房限定的假歷史，沒有模型工作。', {exact: true}).waitFor();
    await select('E');
    await page.getByText('E 房限定的假歷史，沒有模型工作。', {exact: true}).waitFor();
    await page.getByRole('button', {name: '取消連線', exact: true}).click();
    await until(() => controller.state.connectionOpening === false);
    assert.equal(controller.state.threadId, 'B');
    assert.equal(owners.find(x => x.state.threadId === 'D').closed, 0);
    gates.get('D').resolve();
    await until(() => owners.find(x => x.state.threadId === 'D').state.status === 'ready');
    await page.waitForTimeout(150);
    assert.equal(controller.state.threadId, 'B');
    assert.equal(owners.find(x => x.state.threadId === 'E').closed, 1);
    assert.equal(a.closed, 0);
    assert.equal(a.state.busy, true);
    await Promise.all(responseChecks);
    assert.deepEqual(errors, []);
    assert.ok(
      httpErrors.length === 1 &&
        httpErrors[0].path === '/api/open' &&
        httpErrors[0].status === 400 &&
        httpErrors[0].request.threadId === 'E' &&
        /已取消連線/.test(httpErrors[0].body),
      JSON.stringify(httpErrors)
    );
    assert.ok(
      consoleErrors.every(
        e => e === 'Failed to load resource: the server responded with a status of 400 (Bad Request)'
      ),
      JSON.stringify(consoleErrors)
    );
    assert.ok(
      posts.every(p => ['/api/open', '/api/send', '/api/stop', '/api/viewed'].includes(p.path)),
      JSON.stringify(posts)
    );
    assert.equal(posts.filter(p => p.path === '/api/stop' && p.data.cancelOpening !== true).length, 0);
    results.push({
      viewport,
      backgroundLoadDoesNotBlockSelected: true,
      lateCompletionDoesNotStealFocus: true,
      reselectionHasOneOwner: true,
      cancelOnlySelectedLoad: true,
      backgroundWorkUnchanged: true,
      realBackendAndBuiltUI: true,
      fakeProviders: true,
      calls,
      errors,
      expectedCancellation: httpErrors
    });
  } catch (error) {
    if (page) {
      await writeFile(
        path.join(out, `failure-${viewport.width}.txt`),
        JSON.stringify(
          {
            error: String(error),
            page: await page.locator('body').innerText(),
            errors,
            consoleErrors,
            httpErrors,
            calls
          },
          null,
          2
        )
      );
      await page.screenshot({path: path.join(out, `failure-${viewport.width}.png`)});
    }
    throw error;
  } finally {
    for (const gate of gates.values()) gate.resolve();
    await browser?.close();
    if (app) await app.close();
    else await controller.close();
  }
}
await writeFile(path.join(out, 'result.json'), JSON.stringify({passed: results.length, results}, null, 2));
console.log(JSON.stringify({passed: results.length, out}));
