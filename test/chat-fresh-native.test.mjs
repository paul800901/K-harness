import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {listMainSessions} from '../src/main-sessions.mjs';
import {scratchBase} from './scratch.mjs';

const base = scratchBase,
  model = 'gpt-6.1-sol';
async function fixture(phase) {
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'fresh-native-')),
    calls = [];
  let ended, hooks, persistedAtMcp;
  const abort = new AbortController();
  const host = {
    closed: new Promise(r => (ended = r)),
    notify() {},
    close: async () => ended(),
    waitForMcp: async id => {
      persistedAtMcp = (await listMainSessions(root)).sessions.find(s => s.threadId === id);
      if (phase === 'abort') {
        abort.abort(Error('cancel fresh open'));
        throw abort.signal.reason;
      }
      if (phase === 'mcp') throw Error('MCP unavailable');
    },
    request: async (method, data) => {
      calls.push([method, data]);
      if (method === 'model/list') {
        if (phase === 'catalog') throw Error('catalog unavailable');
        return {data: [{model, supportedReasoningEfforts: [{reasoningEffort: 'medium'}]}]};
      }
      if (method === 'account/read') return {account: {type: 'chatgpt'}};
      if (method === 'config/read') {
        if (phase === 'config') throw Error('config unavailable');
        return {config: {}};
      }
      if (method === 'thread/fork' || (method === 'thread/read' && data.threadId !== 'fresh-child'))
        throw Error('fresh must not read or fork source history');
      if (method === 'thread/read') return {thread: {id: 'fresh-child', turns: []}};
      if (method === 'thread/start') {
        if (phase === 'start') throw Error('start response unknown');
        return {thread: {id: 'fresh-child', turns: []}};
      }
      if (method === 'thread/goal/get') {
        if (phase === 'goal') throw Error('goal unreadable');
        return {goal: null};
      }
      if (method === 'thread/backgroundTerminals/list') return {data: []};
      if (method === 'turn/start') {
        hooks.onEvent({
          method: 'turn/started',
          params: {threadId: 'fresh-child', turn: {id: 'handoff-turn', status: 'inProgress'}}
        });
        if (phase === 'send') throw Error('submission outcome unknown');
        return {turn: {id: 'handoff-turn'}};
      }
      return {};
    }
  };
  const c = createDesktopController({
    root,
    hostFactory: h => {
      if (h.onEvent) {
        hooks = h;
        return host;
      }
      return {...host, close: async () => {}};
    },
    gatewayFactory: async () => ({
      mcpConfig: {mcpServers: {k_gemini: {url: 'http://fake/mcp', headers: {Authorization: 'fake'}}}},
      close: async () => {}
    })
  });
  const data = {
    model,
    effort: 'medium',
    accessMode: 'read-only',
    serviceTier: 'default',
    workerPolicy: {model: 'auto', effort: 'auto'}
  };
  const continuation = {mode: 'fresh', parentTitle: '來源工作', ...data};
  return {root, c, calls, data, continuation, abort, persisted: () => persistedAtMcp};
}

test('native fresh uses one thread/start, no history or compaction inheritance, and persists identity before readiness', async () => {
  const f = await fixture();
  let created;
  try {
    await f.c.open(f.data, {
      continuation: f.continuation,
      onCreated: async ({threadId}) => {
        created = (await listMainSessions(f.root)).sessions.find(s => s.threadId === threadId);
      }
    });
    assert.equal(f.calls.filter(c => c[0] === 'thread/start').length, 1);
    assert.equal(f.calls.filter(c => ['thread/fork', 'thread/read', 'thread/resume'].includes(c[0])).length, 0);
    const config = f.calls.find(c => c[0] === 'thread/start')[1];
    assert.equal(config.cwd, f.root);
    assert.equal(config.model, model);
    assert.equal(config.serviceTier, 'default');
    assert.equal(config.config.model_reasoning_effort, 'medium');
    assert.equal(config.approvalPolicy, 'on-request');
    for (const key of ['threadId', 'lastTurnId', 'history', 'items', 'compactions', 'artifacts', 'parentThreadId'])
      assert.equal(config[key], undefined);
    assert.equal(created.codexSession.nativeThreadId, 'fresh-child');
    assert.equal(created.codexSession.hasSubmitted, false);
    assert.deepEqual(f.persisted(), created);
    assert.match(created.title, /^新對話/);
    assert.equal(created.parentThreadId, null);
    assert.equal(created.parentTitle, null);
    assert.equal(created.branchType, null);
    assert.equal(created.forkThroughTurnId, null);
    assert.equal(created.inheritedAttachments, null);
    assert.equal(f.c.state.parentThreadId, null);
    assert.equal(f.c.state.progress.compactions, 0);
    assert.deepEqual(f.c.state.messages, []);
    assert.deepEqual(f.c.state.artifacts, []);
    assert.deepEqual(f.c.state.workers, []);
    await f.c.send({text: '明確第一交接訊息，讀本專案交接檔後只做剩餘工作', source: 'continuation'});
    const turns = f.calls.filter(c => c[0] === 'turn/start');
    assert.equal(turns.length, 1);
    assert.deepEqual(turns[0][1].input, [{type: 'text', text: '明確第一交接訊息，讀本專案交接檔後只做剩餘工作'}]);
    assert.equal(f.c.state.messages.filter(m => m.role === 'user').length, 1);
    assert.equal(f.c.state.messages.find(m => m.role === 'user').source, 'continuation');
    assert.equal((await listMainSessions(f.root)).sessions[0].codexSession.hasSubmitted, true);
  } finally {
    await f.c.close();
  }
});

test('native fresh creation failures distinguish pre-start from unknown; MCP and cancellation retain the new ID', async () => {
  for (const phase of ['catalog', 'config', 'start', 'mcp', 'abort']) {
    const f = await fixture(phase);
    try {
      await assert.rejects(f.c.open(f.data, {signal: f.abort.signal, continuation: f.continuation}), error => {
        assert.equal(error.notCreated === true, ['catalog', 'config'].includes(phase));
        if (['mcp', 'abort'].includes(phase)) assert.equal(error.createdThreadId, 'fresh-child');
        return true;
      });
      assert.equal(
        f.calls.filter(c => c[0] === 'thread/start').length,
        ['start', 'mcp', 'abort'].includes(phase) ? 1 : 0
      );
      assert.equal(f.calls.filter(c => ['thread/fork', 'turn/start'].includes(c[0])).length, 0);
      if (['mcp', 'abort'].includes(phase)) {
        assert.equal(f.c.state.threadId, 'fresh-child');
        assert.equal((await listMainSessions(f.root)).sessions[0].threadId, 'fresh-child');
        assert.equal(f.persisted().codexSession.hasSubmitted, false);
      }
    } finally {
      await f.c.close();
    }
  }
});

test('native fresh unknown send is recorded as attempted, not an unsent room to replay', async () => {
  const f = await fixture('send');
  try {
    await f.c.open(f.data, {continuation: f.continuation});
    await assert.rejects(f.c.send({text: 'first handoff', source: 'continuation'}), /unknown/);
    assert.equal(f.calls.filter(c => c[0] === 'turn/start').length, 1);
    assert.equal((await listMainSessions(f.root)).sessions[0].codexSession.hasSubmitted, true);
  } finally {
    await f.c.close();
  }
});
