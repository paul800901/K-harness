import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchProbeBrowser, probeEvidenceDir} from './ui-probe.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';
import {startDesktop} from '../src/desktop-server.mjs';

const base = probeEvidenceDir('room-lock-ui');
await mkdir(base, {recursive: true});
const results = [];
for (const viewport of [
  {width: 1440, height: 960},
  {width: 390, height: 844}
]) {
  const root = await mkdtemp(path.join(base, 'fixture-')),
    owners = [],
    model = 'gpt-6-astra',
    entered = Promise.withResolvers(),
    read = Promise.withResolvers();
  let notify,
    sequence = 0,
    app,
    browser;
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
      usage: {},
      accessMode: 'workspace-write'
    };
    const owner = {
      state,
      closed: 0,
      sent: 0,
      async models() {
        return {
          models: [
            {model, displayName: '測試模型', provider: 'codex', supportedReasoningEfforts: [{reasoningEffort: 'high'}]}
          ]
        };
      },
      async usage() {
        return {};
      },
      async selectWorkspace({path}) {
        state.workspace = path;
      },
      async open(data) {
        state.threadId = data.threadId ?? `fixture-${++sequence}`;
        state.title = state.threadId === 'fixture-1' ? 'Pick Me Up' : `假聊天室 ${sequence}`;
        state.status = 'ready';
        state.messages = [{id: 'fake-answer', role: 'assistant', text: '這是獨立假資料；沒有模型工作。'}];
        await saveMainSession(root, {...state});
        onChange();
        return {threadId: state.threadId};
      },
      async workers() {
        return [];
      },
      async close() {
        owner.closed++;
        state.status = 'offline';
        onChange();
      },
      async send() {
        owner.sent++;
        throw Error('No real submission allowed');
      }
    };
    owners.push(owner);
    return owner;
  };
  const controller = createConversationController({root, sessionFactory: factory, onChange: () => notify?.()});
  try {
    const rooms = [];
    for (let i = 0; i < 4; i++) rooms.push(await controller.open({model}));
    const oldest = owners.find(o => o.state.threadId === rooms[0].threadId);
    oldest.workers = async () => {
      entered.resolve();
      return read.promise;
    };
    await controller.open({model});
    await entered.promise;
    app = await startDesktop({
      root,
      executable: 'fixture-only',
      port: 0,
      controllerFactory: options => {
        notify = options.onChange;
        return controller;
      }
    });
    browser = await launchProbeBrowser();
    const page = await browser.newPage({viewport}),
      errors = [],
      posts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.method() === 'POST') posts.push(new URL(request.url()).pathname);
    });
    await page.goto(app.createLaunchUrl());
    if (viewport.width < 500) await page.getByRole('button', {name: '展開側欄', exact: true}).click();
    await page.locator('.session-open').filter({hasText: 'Pick Me Up'}).click();
    await page.locator('.header-title h1').filter({hasText: 'Pick Me Up'}).waitFor();
    read.resolve([]);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.header-title h1').textContent(), 'Pick Me Up');
    assert.equal(await page.getByText('此聊天室正在更新，請稍候。', {exact: true}).count(), 0);
    assert.equal(controller.state.threadId, rooms[0].threadId);
    assert.equal(oldest.closed, 0);
    assert.ok(owners.every(owner => owner.sent === 0));
    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.filter(p => p !== '/api/open'),
      []
    );
    await page.screenshot({path: path.join(base, `navigation-${viewport.width}.png`)});
    results.push({
      viewport,
      pickSelected: true,
      noBounce: true,
      lateProbeDidNotClose: true,
      noNativeSubmission: true,
      posts,
      errors
    });
  } finally {
    read.resolve([]);
    await browser?.close();
    if (app) await app.close();
    else await controller.close();
  }
}
await writeFile(
  path.join(base, 'result.json'),
  JSON.stringify({fakeProviders: true, realBackendAndBuiltUI: true, results}, null, 2)
);
console.log(JSON.stringify({passed: results.length, evidence: base}));
