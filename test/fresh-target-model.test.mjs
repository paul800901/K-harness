import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationController} from '../src/conversation-controller.mjs';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {scratchBase} from './scratch.mjs';

const base = scratchBase;
const sourceModel = 'gpt-source',
  targetModel = 'gpt-native-target';
const entry = (model, efforts, defaultReasoningEffort) => ({
  model,
  supportedReasoningEfforts: efforts.map(reasoningEffort => ({reasoningEffort})),
  defaultReasoningEffort
});
async function fixture() {
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'fresh-target-'));
  const rows = [],
    calls = [];
  let sequence = 0,
    catalog = [entry(sourceModel, ['medium', 'ultra'], 'medium'), entry(targetModel, ['low', 'high'], 'low')],
    catalogGate;
  const c = createConversationController({
    root,
    sessionFactory: options => {
      const row = {id: null, hooks: null, gateway: null, turns: [], continue: options.onContinueConversation};
      rows.push(row);
      let ended;
      const host = {
        closed: new Promise(r => (ended = r)),
        notify() {},
        close: async () => ended(),
        async request(method, data) {
          calls.push([method, data]);
          if (method === 'model/list') {
            if (catalogGate) {
              catalogGate.enter();
              await catalogGate.promise;
            }
            return {data: catalog};
          }
          if (method === 'account/read') return {account: {type: 'chatgpt'}};
          if (method === 'config/read') return {config: {}};
          if (method === 'thread/start') {
            row.id = `native-${++sequence}`;
            return {thread: {id: row.id, turns: []}};
          }
          if (method === 'thread/goal/get') return {goal: null};
          if (method === 'thread/backgroundTerminals/list') return {data: []};
          if (method === 'thread/read') {
            const source = rows.find(r => r.id === data.threadId);
            return {thread: {id: data.threadId, turns: source?.turns ?? []}};
          }
          if (method === 'turn/start') {
            const id = `turn-${row.id}`;
            row.hooks.onEvent({method: 'turn/started', params: {threadId: row.id, turn: {id, status: 'inProgress'}}});
            return {turn: {id}};
          }
          return {};
        }
      };
      row.owner = createDesktopController({
        ...options,
        hostFactory: hooks => {
          if (!hooks.onEvent) return {...host, close: async () => {}};
          row.hooks = hooks;
          return host;
        },
        gatewayFactory: async gateway => {
          row.gateway = gateway;
          return {
            mcpConfig: {mcpServers: {k_gemini: {url: 'http://fake/mcp', headers: {Authorization: 'fake'}}}},
            close: async () => {}
          };
        }
      });
      row.owner.state.provider = 'codex';
      return row.owner;
    }
  });
  const opened = await c.open({model: sourceModel, workspace: root, effort: 'ultra', accessMode: 'read-only'});
  await c.send({threadId: opened.threadId, text: 'blank new room; only remaining work'});
  const source = rows.find(row => row.id === opened.threadId),
    turnId = `turn-${source.id}`;
  const request = args =>
    source.gateway.continueConversation(
      {mode: 'fresh', nextInstruction: 'remaining only', ...args},
      {'x-codex-turn-metadata': JSON.stringify({thread_id: source.id, turn_id: turnId})}
    );
  const receipt = () =>
    readFile(path.join(root, '.runtime/chat-continuations', `${source.id}.json`), 'utf8').then(JSON.parse);
  const finish = async (status = 'completed') => {
    source.turns = [
      {
        id: turnId,
        status,
        ...(status === 'failed' ? {error: {message: 'stream failed', codexErrorInfo: 'serverOverloaded'}} : {}),
        items: []
      }
    ];
    source.hooks.onEvent({method: 'turn/completed', params: {threadId: source.id, turn: source.turns[0]}});
    await wait(async () => ['sent', 'cancelled', 'uncertain'].includes((await receipt()).status));
  };
  return {
    root,
    c,
    rows,
    calls,
    source,
    request,
    receipt,
    finish,
    setCatalog: value => (catalog = value),
    blockCatalog: value => (catalogGate = value)
  };
}
async function wait(check) {
  const until = Date.now() + 2500;
  while (!(await check())) {
    if (Date.now() > until) throw Error('target handoff timed out');
    await new Promise(r => setTimeout(r, 10));
  }
}

for (const scenario of [
  {name: 'explicit target high', args: {model: targetModel, effort: 'high'}, model: targetModel, effort: 'high'},
  {
    name: 'different model uses native default not unsupported source effort',
    args: {model: targetModel},
    model: targetModel,
    effort: 'low'
  },
  {
    name: 'different model without native default omits effort',
    args: {model: targetModel},
    model: targetModel,
    effort: null,
    noDefault: true
  },
  {name: 'omitted selection inherits', args: {}, model: sourceModel, effort: 'ultra'},
  {name: 'effort only changes child', args: {effort: 'medium'}, model: sourceModel, effort: 'medium'},
  {name: 'explicit null omits effort', args: {model: targetModel, effort: null}, model: targetModel, effort: null}
])
  test('fresh native selection: ' + scenario.name, async () => {
    const f = await fixture();
    try {
      if (scenario.noDefault)
        f.setCatalog([entry(sourceModel, ['medium', 'ultra'], 'medium'), entry(targetModel, ['low', 'high'])]);
      const accepted = await f.request(scenario.args);
      assert.equal(accepted.targetModel, scenario.model);
      assert.equal(accepted.targetEffort, scenario.effort);
      await f.finish(scenario.name === 'explicit target high' ? 'failed' : 'completed');
      const receipt = await f.receipt();
      assert.equal(receipt.status, 'sent');
      assert.equal(receipt.targetModel, scenario.model);
      assert.equal(receipt.targetEffort, scenario.effort);
      const starts = f.calls.filter(([m]) => m === 'thread/start'),
        turns = f.calls.filter(([m]) => m === 'turn/start');
      assert.equal(starts.length, 2);
      assert.equal(turns.length, 2);
      assert.equal(starts[1][1].model, scenario.model);
      assert.equal(starts[1][1].config.model_reasoning_effort, scenario.effort ?? undefined);
      assert.equal(turns[1][1].model, scenario.model);
      assert.equal(turns[1][1].effort, scenario.effort ?? undefined);
      const child = f.rows.find(r => r.id === receipt.newThreadId);
      assert.equal(child.owner.state.model, scenario.model);
      assert.equal(child.owner.state.effort, scenario.effort);
      assert.equal(f.source.owner.state.model, sourceModel);
      assert.equal(f.source.owner.state.effort, 'ultra');
      assert.equal(child.owner.state.accessMode, 'read-only');
      assert.equal(child.owner.state.serviceTier, 'default');
    } finally {
      await f.c.close();
    }
  });

for (const args of [
  {model: 'missing'},
  {model: 'claude-other'},
  {model: targetModel, effort: 'ultra'},
  {model: targetModel, effort: ''},
  {model: ''}
])
  test('invalid native target is not accepted ' + JSON.stringify(args), async () => {
    const f = await fixture();
    try {
      await assert.rejects(f.request(args));
      assert.equal(f.calls.filter(([m]) => m === 'thread/start').length, 1);
      await assert.rejects(f.receipt(), {code: 'ENOENT'});
    } finally {
      await f.c.close();
    }
  });

test('same-turn target receipt is immutable and repeats never re-resolve or dispatch twice', async () => {
  const f = await fixture();
  try {
    await f.request({model: targetModel, effort: 'high'});
    const reads = f.calls.filter(([m]) => m === 'model/list').length;
    f.setCatalog([]);
    const repeat = await f.request({model: targetModel, effort: 'high'});
    assert.equal(repeat.targetModel, targetModel);
    assert.equal(repeat.targetEffort, 'high');
    assert.equal(f.calls.filter(([m]) => m === 'model/list').length, reads);
    for (const args of [
      {model: targetModel, effort: 'low'},
      {model: sourceModel, effort: 'high'},
      {model: targetModel},
      {model: targetModel, effort: 'high', nextInstruction: 'changed work'}
    ])
      await assert.rejects(f.request(args), /參數衝突/);
    f.setCatalog([entry(sourceModel, ['medium', 'ultra'], 'medium'), entry(targetModel, ['low', 'high'], 'low')]);
    await f.finish();
    assert.equal((await f.receipt()).status, 'sent');
    await f.source.continue({
      mode: 'fresh',
      threadId: f.source.id,
      turnId: `turn-${f.source.id}`,
      nextInstruction: 'remaining only',
      model: targetModel,
      effort: 'high'
    });
    assert.equal(f.calls.filter(([m]) => m === 'thread/start').length, 2);
    assert.equal(f.calls.filter(([m]) => m === 'turn/start').length, 2);
  } finally {
    await f.c.close();
  }
});

test('source stop while native target catalog resolves cannot accept or create', async () => {
  const f = await fixture();
  let enter, release;
  const entered = new Promise(r => (enter = r)),
    promise = new Promise(r => (release = r));
  try {
    f.blockCatalog({enter, promise});
    const accepted = f.request({model: targetModel, effort: 'high'});
    const rejection = assert.rejects(accepted, /變更|停止|目前主對話/);
    await entered;
    await f.source.owner.stop();
    release();
    await rejection;
    assert.equal(f.calls.filter(([m]) => m === 'thread/start').length, 1);
  } finally {
    release();
    await f.c.close();
  }
});

for (const action of ['stop', 'send'])
  test('targeted accepted handoff remains cancellable before dispatch: ' + action, async () => {
    const f = await fixture();
    try {
      await f.request({model: targetModel, effort: 'high'});
      const operation = f.c[action]({threadId: f.source.id, text: 'changed human intent'});
      if (action === 'send') await assert.rejects(operation, error => error.notSent === true);
      else await operation;
      assert.equal((await f.receipt()).status, 'cancelled');
      assert.equal((await f.receipt()).targetModel, targetModel);
      assert.equal(f.calls.filter(([m]) => m === 'thread/start').length, 1);
    } finally {
      await f.c.close();
    }
  });

test('native catalog loss after acceptance cancels without choosing another model or replaying', async () => {
  const f = await fixture();
  try {
    await f.request({model: targetModel, effort: 'high'});
    f.setCatalog([entry(sourceModel, ['medium', 'ultra'], 'medium')]);
    await f.finish();
    const receipt = await f.receipt();
    assert.equal(receipt.status, 'cancelled');
    assert.equal(receipt.targetModel, targetModel);
    assert.equal(receipt.targetEffort, 'high');
    assert.equal(f.calls.filter(([m]) => m === 'thread/start').length, 1);
    assert.equal(f.calls.filter(([m]) => m === 'turn/start').length, 1);
  } finally {
    await f.c.close();
  }
});

test('hidden native target and incompatible inherited service tier never accept', async () => {
  const f = await fixture();
  try {
    f.setCatalog([
      entry(sourceModel, ['medium', 'ultra'], 'medium'),
      {...entry(targetModel, ['low', 'high'], 'low'), hidden: true}
    ]);
    await assert.rejects(f.request({model: targetModel, effort: 'high'}), /原生目錄/);
    f.setCatalog([entry(sourceModel, ['medium', 'ultra'], 'medium'), entry(targetModel, ['low', 'high'], 'low')]);
    f.source.owner.state.serviceTier = 'fast';
    await assert.rejects(f.request({model: targetModel, effort: 'high'}), /服務等級/);
    assert.equal(f.calls.filter(([m]) => m === 'thread/start').length, 1);
    await assert.rejects(f.receipt(), {code: 'ENOENT'});
  } finally {
    await f.c.close();
  }
});
