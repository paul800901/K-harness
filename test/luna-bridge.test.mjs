import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLunaBridge, lunaResult} from '../src/luna-bridge.mjs';
import {approvalRequest} from '../src/desktop-permissions.mjs';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createGeminiAccounts} from '../src/gemini-accounts.mjs';
import {createGeminiWorker} from '../src/gemini-worker.mjs';
import {mergeGeminiHandoff, geminiAccountWait} from '../src/gemini-handoff.mjs';
import {scratchBase} from './scratch.mjs';
import {settleAfterRelease} from './fixtures/gemini-accounts-settle.mjs';

const root = path.join(scratchBase, 'luna-bridge-tests', randomUUID());
const workspace = path.join(root, 'workspace');
await mkdir(workspace, {recursive: true});
const catalog = [{model: 'gpt-6-luna', supportedReasoningEfforts: [{reasoningEffort: 'high'}]}];
function fakeHost({
  accountType = 'chatgpt',
  models = catalog,
  onStart,
  threadRead,
  parentId = 'parent',
  terminalData = [],
  terminalStuck = false
} = {}) {
  const calls = [];
  const events = [];
  let count = 0;
  let status = 'inProgress';
  const items = [];
  let terminals = terminalData;
  let closedCount = 0;
  const host = {
    calls,
    events,
    notify: m => calls.push({method: 'notify', p: m}),
    close: async () => {
      closedCount++;
    },
    async request(method, p = {}) {
      calls.push({method, p});
      if (method === 'initialize') return {};
      if (method === 'account/read') return {account: {type: accountType}};
      if (method === 'model/list') return {data: models};
      if (method === 'thread/start') {
        count++;
        await onStart?.(host, p);
        return {thread: {id: `thread-${count}`}};
      }
      if (method === 'turn/start') {
        const id = `turn-${count}`;
        events.push(id);
        return {turn: {id}};
      }
      if (method === 'turn/interrupt') {
        status = 'interrupted';
        host.emit({
          method: 'turn/completed',
          params: {threadId: p.threadId, turn: {id: p.turnId, status: 'interrupted'}}
        });
        return {};
      }
      if (method === 'thread/backgroundTerminals/list') return {data: terminals};
      if (method === 'thread/backgroundTerminals/clean') {
        if (!terminalStuck) terminals = [];
        return {};
      }
      if (method === 'thread/read')
        return (
          threadRead?.(p, status) ?? {
            thread: {
              id: p.threadId,
              cwd: workspace,
              parentThreadId: parentId,
              status: {type: status === 'inProgress' ? 'active' : 'idle'},
              turns: [{id: 'turn-1', status, items}]
            }
          }
        );
      throw Error(`unexpected ${method}`);
    },
    emit(m) {
      /* assigned by bridge via factory options */ options.onEvent(m);
    },
    requestHandler(m) {
      return options.onRequest(m);
    }
  };
  let options = {};
  return {
    host,
    calls,
    closeCount: () => closedCount,
    setOptions: o => (options = o),
    finish(threadId = 'thread-1', turnId = 'turn-1') {
      status = 'completed';
      host.emit({method: 'turn/completed', params: {threadId, turn: {id: turnId, status: 'completed'}}});
    },
    item(threadId, item) {
      items.push(item);
      host.emit({method: 'item/completed', params: {threadId, item}});
    },
    releaseTerminals() {
      terminals = [];
    }
  };
}
async function make({
  accountType,
  models,
  onStart,
  threadRead,
  onChange = () => {},
  onRequest,
  terminalData,
  terminalStuck,
  watchOptions,
  accessMode = 'workspace-write',
  workerPolicy = {model: 'gpt-6-luna', effort: 'high'},
  ...extra
} = {}) {
  let fixture;
  const parentId = randomUUID();
  const bridge = await createLunaBridge({
    root,
    workspace,
    parentId,
    executable: 'codex',
    onChange,
    onRequest,
    accessMode,
    workerPolicy,
    watchOptions,
    ...extra,
    hostFactory: options => {
      fixture = fakeHost({accountType, models, onStart, threadRead, parentId, terminalData, terminalStuck});
      fixture.setOptions(options);
      return fixture.host;
    }
  });
  return {bridge, fixture};
}
const noWrite = () => ({status: 'not-written'});

test('Gemini wait wakes on quiet attention with current observation, then preserves the same late completion', async () => {
  let finish, started;
  const ready = new Promise(r => (started = r));
  let runs = 0;
  const bridge = await createLunaBridge({
    root,
    workspace,
    parentId: randomUUID(),
    geminiOnly: true,
    watchOptions: {quietMs: 100},
    geminiFactory: () => ({
      models: async () => [{model: 'gemini-3.8-flash', supportedReasoningEfforts: [{reasoningEffort: 'high'}]}],
      run: async ({onStart, onActivity}) => {
        runs++;
        onStart(123);
        onActivity({startedAt: Date.now(), lastEventAt: Date.now(), phase: 'tool', lastToolName: 'run_command'});
        started();
        return new Promise(r => (finish = r));
      }
    })
  });
  try {
    await bridge.start({
      requestId: 'quiet-gemini',
      task: 'fake delayed task',
      model: 'gemini-3.8-flash',
      effort: 'high'
    });
    await ready;
    const waiting = await lunaResult(await bridge.wait({requestId: 'quiet-gemini', timeoutMs: 3000}));
    assert.equal(waiting.status, 'running');
    assert.equal(waiting.settled, false);
    assert.ok(waiting.inspection);
    assert.equal(waiting.observation.execution, 'owned-pending');
    assert.equal(waiting.observation.activity, 'quiet');
    assert.ok(waiting.observation.quietForMs >= 100);
    finish({status: 'completed', settled: true, output: 'original final output', outputFiles: []});
    const done = await bridge.wait({requestId: 'quiet-gemini', timeoutMs: 3000});
    // An already-known quiet result may return before the final promise settles.
    if (!done.settled) await new Promise(r => setTimeout(r, 50));
    const final = await bridge.inspect({requestId: 'quiet-gemini'});
    assert.equal(final.status, 'completed');
    assert.equal(final.output, 'original final output');
    assert.equal(final.inspection, undefined);
    assert.equal(final.observation.execution, 'settled');
    assert.equal(runs, 1);
  } finally {
    finish?.({status: 'completed', settled: true, output: 'cleanup'});
    await bridge.close();
  }
});

test('rejects non-subscription account and validates the requested worker against the catalog before a turn', async () => {
  let f;
  const unavailable = await createLunaBridge({
    root,
    workspace,
    parentId: randomUUID(),
    executable: 'codex',
    hostFactory: o => {
      f = fakeHost({accountType: 'apiKey'});
      f.setOptions(o);
      return f.host;
    }
  });
  await assert.rejects(
    unavailable.start({requestId: 'no-subscription', task: 'fake', model: 'gpt-6-luna', effort: 'high'}),
    /訂閱登入/
  );
  await unavailable.close();
  assert.equal(
    f.calls.some(c => c.method === 'thread/start' || c.method === 'turn/start'),
    false
  );
  const {bridge, fixture} = await make({
    models: [{model: 'gpt-6-sol', supportedReasoningEfforts: [{reasoningEffort: 'high'}]}]
  });
  try {
    await assert.rejects(
      bridge.start({requestId: 'unavailable', task: 'fake task', model: 'gpt-6-luna', effort: 'high'}),
      /未自動換模/
    );
    assert.equal(
      fixture.calls.some(c => c.method === 'thread/start' || c.method === 'turn/start'),
      false
    );
  } finally {
    await bridge.close();
  }
});

test('defaults to Luna/high, deduplicates stable request IDs, and persists native completion/output/files', async () => {
  const changes = [];
  const {bridge, fixture} = await make({onChange: r => changes.push(r)});
  const requestId = 'dedup';
  const first = await bridge.start({requestId, task: '請檢查並修復問題'});
  const again = await bridge.start({requestId, task: '請檢查並修復問題'});
  assert.equal(first.threadId, again.threadId);
  await assert.rejects(bridge.start({requestId, task: '不同工作'}), /不同 task/);
  const turn = fixture.calls.find(c => c.method === 'turn/start').p;
  assert.equal(turn.model, 'gpt-6-luna');
  assert.equal(turn.effort, 'high');
  assert.equal(turn.sandboxPolicy.type, 'workspaceWrite');
  assert.deepEqual(turn.input[0].text.includes('不得再委派子代理'), true);
  const start = fixture.calls.find(c => c.method === 'thread/start').p;
  assert.equal(start.config.model_reasoning_effort, 'high');
  assert.deepEqual(start.config.mcp_servers, {
    k_flash: {enabled: false, command: process.execPath, args: ['--version']}
  });
  assert.deepEqual(start.config.agents, {enabled: false});
  assert.deepEqual(start.config.sandbox_workspace_write.writable_roots, [workspace]);
  fixture.item(first.threadId, {type: 'agentMessage', text: '已完成'});
  fixture.item(first.threadId, {type: 'fileChange', changes: [{path: 'result.txt', kind: {type: 'add'}}]});
  fixture.finish(first.threadId, first.turnId ?? 'turn-1');
  const result = await bridge.wait({requestId, timeoutMs: 1000});
  assert.equal(result.status, 'completed');
  assert.equal(result.settled, true);
  assert.equal(result.acceptance, 'not-reviewed');
  assert.match(result.output, /已完成/);
  assert.deepEqual(result.outputFiles, ['result.txt']);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(changes.some(change => change.status === 'completed'));
  const persisted = JSON.parse(
    await readFile(path.join(root, '.runtime', 'luna-bridge', result.parentId, `${requestId}.json`), 'utf8')
  );
  assert.equal(persisted.provider, 'codex');
  assert.equal(persisted.status, 'completed');
  await bridge.close();
});

test('restart inspection reads native thread and never resends a turn', async () => {
  const {bridge, fixture} = await make();
  const started = await bridge.start({requestId: 'restart', task: '原工作'});
  const before = fixture.calls.filter(c => c.method === 'turn/start').length;
  fixture.host.request = async (method, p) =>
    method === 'thread/read'
      ? {
          thread: {
            id: p.threadId,
            cwd: workspace,
            status: {type: 'idle'},
            turns: [{id: 'old', status: 'completed', items: [{type: 'agentMessage', text: 'native readback'}]}]
          }
        }
      : method === 'thread/backgroundTerminals/list'
        ? {data: []}
        : Promise.reject(Error(method));
  const result = await bridge.inspect({requestId: 'restart'});
  assert.equal(result.status, 'completed');
  assert.match(result.output, /native readback/);
  assert.equal(fixture.calls.filter(c => c.method === 'turn/start').length, before);
  await bridge.close();
});

test('idle and unloaded inspections require an explicit terminal latest turn', async () => {
  for (const variant of [
    {threadStatus: 'idle', turns: []},
    {threadStatus: 'notLoaded', turns: []},
    {threadStatus: 'idle', turns: [{id: 'turn-1', status: 'queued', items: []}]},
    {threadStatus: 'notLoaded', turns: [{id: 'turn-1', status: 'unknown', items: []}]}
  ]) {
    const {bridge, fixture} = await make();
    try {
      const started = await bridge.start({requestId: `inspect-${randomUUID()}`, task: 'synthetic task'});
      const original = fixture.host.request;
      fixture.host.request = async (method, p) =>
        method === 'thread/read'
          ? {
              thread: {
                id: p.threadId,
                parentThreadId: started.parentId,
                cwd: workspace,
                status: {type: variant.threadStatus},
                turns: variant.turns
              }
            }
          : original(method, p);
      const record = await bridge.inspect({requestId: started.requestId});
      assert.equal(record.status, 'unresolved', JSON.stringify(variant));
      assert.equal(record.settled, false, JSON.stringify(variant));
      assert.equal(record.error, undefined, 'an incomplete but correctly scoped read is unknown, not a read failure');
      assert.equal(
        fixture.calls.filter(call => call.method === 'turn/start').length,
        1,
        'inspection never starts another turn'
      );
      fixture.host.request = original;
    } finally {
      await bridge.close();
    }
  }
});

test('idle and unloaded inspections preserve explicit terminal latest-turn states', async () => {
  for (const [threadStatus, turnStatus, expected] of [
    ['idle', 'completed', 'completed'],
    ['notLoaded', 'completed', 'completed'],
    ['idle', 'failed', 'failed'],
    ['notLoaded', 'interrupted', 'cancelled']
  ]) {
    const {bridge, fixture} = await make();
    try {
      const started = await bridge.start({requestId: `terminal-${randomUUID()}`, task: 'synthetic task'});
      const original = fixture.host.request;
      fixture.host.request = async (method, p) =>
        method === 'thread/read'
          ? {
              thread: {
                id: p.threadId,
                parentThreadId: started.parentId,
                cwd: workspace,
                status: {type: threadStatus},
                turns: [{id: started.turnId, status: turnStatus, items: []}]
              }
            }
          : original(method, p);
      const record = await bridge.inspect({requestId: started.requestId});
      assert.equal(record.status, expected);
      assert.equal(record.settled, true);
      assert.equal(
        fixture.calls.filter(call => call.method === 'turn/start').length,
        1,
        'inspection never starts another turn'
      );
      fixture.host.request = original;
    } finally {
      await bridge.close();
    }
  }
});

test('start/cancel race does not start a turn after cancellation is requested', async () => {
  let release;
  const gate = new Promise(resolve => (release = resolve));
  let entered;
  const enteredPromise = new Promise(resolve => (entered = resolve));
  const {bridge, fixture} = await make({
    onStart: async () => {
      entered();
      await gate;
    }
  });
  const starting = bridge.start({requestId: 'race', task: '工作'});
  await enteredPromise;
  const cancellation = bridge.cancel({requestId: 'race'});
  release();
  await starting;
  const result = await cancellation;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.settled, true);
  assert.equal(
    fixture.calls.some(c => c.method === 'turn/start'),
    false
  );
  await bridge.close();
});

test('cancel while turn/start is in flight waits for it and interrupts the turn before reporting cancelled', async () => {
  let turnBegun = false,
    releaseTurn,
    enteredTurn;
  const turnGate = new Promise(resolve => (releaseTurn = resolve)),
    turnEntered = new Promise(resolve => (enteredTurn = resolve));
  const {bridge, fixture} = await make({
    // Before the turn starts the native thread is idle with no turns.
    threadRead: p =>
      turnBegun ? undefined : {thread: {id: p.threadId, cwd: workspace, status: {type: 'idle'}, turns: []}}
  });
  const request = fixture.host.request;
  fixture.host.request = async (method, p) => {
    if (method === 'turn/start') {
      enteredTurn();
      await turnGate;
      turnBegun = true;
    }
    return request.call(fixture.host, method, p);
  };
  const starting = bridge.start({requestId: 'turn-race', task: '工作'});
  await turnEntered;
  let reported = false;
  const cancellation = bridge.cancel({requestId: 'turn-race'}).finally(() => (reported = true));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(reported, false, 'cancel must not report while the native turn may still start');
  releaseTurn();
  await starting;
  const result = await cancellation;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.settled, true);
  assert.ok(fixture.calls.some(call => call.method === 'turn/interrupt' && call.p.turnId === 'turn-1'));
  await bridge.close();
});

test('concurrent starts reserve requestId before asynchronous work and reject a conflicting task', async () => {
  let release;
  const gate = new Promise(resolve => (release = resolve));
  let entered;
  const enteredPromise = new Promise(resolve => (entered = resolve));
  const {bridge, fixture} = await make({
    onStart: async () => {
      entered();
      await gate;
    }
  });
  const same = bridge.start({requestId: 'concurrent', task: 'identical'});
  const changed = bridge.start({requestId: 'concurrent', task: 'different'});
  const resultsPromise = Promise.allSettled([same, changed]);
  await enteredPromise;
  release();
  const results = await resultsPromise;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(fixture.calls.filter(call => call.method === 'thread/start').length, 1);
  assert.equal(fixture.calls.filter(call => call.method === 'turn/start').length, 1);
  await bridge.close();
});

test('simultaneous identical starts launch exactly one native thread and turn', async () => {
  let release;
  const gate = new Promise(resolve => (release = resolve));
  let entered;
  const enteredPromise = new Promise(resolve => (entered = resolve));
  const {bridge, fixture} = await make({
    onStart: async () => {
      entered();
      await gate;
    }
  });
  const first = bridge.start({requestId: 'concurrent-identical', task: 'same task'});
  const second = bridge.start({requestId: 'concurrent-identical', task: 'same task'});
  const resultsPromise = Promise.all([first, second]);
  await enteredPromise;
  release();
  await resultsPromise;
  assert.equal(fixture.calls.filter(call => call.method === 'thread/start').length, 1);
  assert.equal(fixture.calls.filter(call => call.method === 'turn/start').length, 1);
  await bridge.close();
});

test('uncertain turn-start outcome is not retried; cancellation interrupts an active native turn', async () => {
  const {bridge, fixture} = await make();
  const started = await bridge.start({requestId: 'cancel', task: '工作'});
  const cancelled = await bridge.cancel({requestId: 'cancel'});
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(fixture.calls.filter(c => c.method === 'turn/interrupt').length, 1);
  await bridge.close();

  const second = await make();
  second.fixture.host.request = async (method, p) => {
    if (method === 'initialize') return {};
    if (method === 'account/read') return {account: {type: 'chatgpt'}};
    if (method === 'model/list') return {data: catalog};
    if (method === 'thread/start') return {thread: {id: 'uncertain-thread'}};
    if (method === 'turn/start') throw Error('Codex turn/start timed out; do not replay automatically.');
    if (method === 'thread/read') throw Error('offline');
  };
  await assert.rejects(second.bridge.start({requestId: 'uncertain', task: '工作'}));
  const calls = second.fixture.calls.filter(c => c.method === 'turn/start').length;
  const result = await second.bridge.start({requestId: 'uncertain', task: '工作'});
  assert.equal(result.status, 'unresolved');
  assert.equal(second.fixture.calls.filter(c => c.method === 'turn/start').length, calls);
  await assert.rejects(second.bridge.close());
});

test('cancel and close stop native background terminals before reporting settled or closing the host', async () => {
  const {bridge, fixture} = await make({terminalData: [{id: 'terminal'}], terminalStuck: true});
  await bridge.start({requestId: 'terminal-stop', task: 'bounded'});
  await assert.rejects(bridge.cancel({requestId: 'terminal-stop'}), /背景命令尚未確認停止/);
  assert.equal(
    fixture.calls.some(c => c.method === 'turn/interrupt'),
    true
  );
  assert.equal(
    fixture.calls.some(c => c.method === 'thread/backgroundTerminals/clean'),
    true
  );
  assert.equal(fixture.closeCount(), 0);
  fixture.releaseTerminals();
  const result = await bridge.cancel({requestId: 'terminal-stop'});
  assert.equal(result.settled, true);
  await bridge.close();
  assert.equal(fixture.closeCount(), 1);
});

test('close still stops backgrounds after the native turn is already completed', async () => {
  const {bridge, fixture} = await make({terminalData: [{id: 'terminal'}]});
  const started = await bridge.start({requestId: 'completed-with-terminal', task: 'bounded'});
  fixture.finish(started.threadId, started.turnId);
  const completed = await bridge.inspect({requestId: 'completed-with-terminal'});
  assert.equal(completed.status, 'completed');
  assert.equal(completed.settled, true);
  await bridge.close();
  assert.ok(fixture.calls.some(call => call.method === 'thread/backgroundTerminals/clean'));
  assert.equal(fixture.closeCount(), 1);
});

test('close reads completed unloaded history without calling loaded-only terminal APIs', async () => {
  const {bridge, fixture} = await make();
  const started = await bridge.start({requestId: 'unloaded-completed', task: 'bounded'});
  const request = fixture.host.request;
  fixture.host.request = async (method, p) => {
    if (method === 'thread/read')
      return {
        thread: {
          id: p.threadId,
          cwd: workspace,
          status: {type: 'notLoaded'},
          turns: [{id: started.turnId, status: 'completed', items: []}]
        }
      };
    if (method.startsWith('thread/backgroundTerminals/')) throw Error('thread not found');
    return request(method, p);
  };
  await bridge.close();
  assert.equal(fixture.closeCount(), 1);
  const result = JSON.parse(
    await readFile(path.join(root, '.runtime', 'luna-bridge', started.parentId, 'unloaded-completed.json'), 'utf8')
  );
  assert.equal(result.status, 'completed');
  assert.equal(result.settled, true);
});

test('unloaded history without the matching terminal turn cannot authorize close', async () => {
  for (const variant of ['active', 'missing', 'wrong-turn', 'wrong-workspace']) {
    const {bridge, fixture} = await make();
    const started = await bridge.start({requestId: 'unloaded-unknown', task: 'bounded'});
    fixture.host.request = async (method, p) => {
      if (method === 'thread/read')
        return {
          thread: {
            id: p.threadId,
            cwd: variant === 'wrong-workspace' ? path.join(workspace, 'other') : workspace,
            status: {type: 'notLoaded'},
            turns:
              variant === 'missing'
                ? []
                : [
                    {
                      id: variant === 'wrong-turn' ? 'different' : started.turnId,
                      status: variant === 'active' ? 'inProgress' : 'completed',
                      items: []
                    }
                  ]
          }
        };
      throw Error(`Unexpected mutation: ${method}`);
    };
    await assert.rejects(bridge.close());
    assert.equal(fixture.closeCount(), 0);
  }
});

test('loaded terminal-list failure blocks close but preserves the completed result', async () => {
  const {bridge, fixture} = await make();
  const started = await bridge.start({requestId: 'cleanup-failed', task: 'bounded'});
  fixture.finish(started.threadId, started.turnId);
  const request = fixture.host.request;
  fixture.host.request = async (method, p) => {
    if (method === 'thread/backgroundTerminals/list') throw Error('thread not found');
    return request(method, p);
  };
  await assert.rejects(bridge.close(), /cleanup-failed.*背景命令清理未確認/);
  assert.equal(fixture.closeCount(), 0);
  const record = JSON.parse(
    await readFile(path.join(root, '.runtime', 'luna-bridge', started.parentId, 'cleanup-failed.json'), 'utf8')
  );
  assert.equal(record.status, 'completed');
  assert.equal(record.settled, true);
  assert.match(record.cleanupError, /thread not found/);
  fixture.host.request = request;
  await bridge.close();
  assert.equal(fixture.closeCount(), 1);
});

test('approval requests pass through only for the bridge-owned native thread and turn', async () => {
  const seen = [];
  const guarded = await make({
    onRequest: message => {
      seen.push(message);
      return {decision: 'decline'};
    }
  });
  // The request callback is deliberately surfaced only after exact ownership checks.
  const startedGuarded = await guarded.bridge.start({requestId: 'approval-guard', task: 'bounded'});
  const raw = {
    method: 'item/commandExecution/requestApproval',
    params: {threadId: startedGuarded.threadId, turnId: 'turn-1'}
  };
  assert.deepEqual(await guarded.fixture.host.requestHandler(raw), {decision: 'decline'});
  assert.equal(
    await guarded.fixture.host.requestHandler({...raw, params: {...raw.params, threadId: 'foreign'}}),
    undefined
  );
  assert.equal(
    await guarded.fixture.host.requestHandler({...raw, params: {...raw.params, turnId: 'foreign-turn'}}),
    undefined
  );
  assert.deepEqual(seen, [raw]);
  await guarded.bridge.close();
});

test('file change approval reads the matching native turn item and keeps missing changes unapprovable', async () => {
  const seen = [];
  const {bridge, fixture} = await make({
    onRequest: (message, item) => {
      seen.push(item);
      return approvalRequest(message, item);
    }
  });
  try {
    const record = await bridge.start({requestId: 'file-approval', task: 'bounded'});
    const item = {
      id: 'file-item',
      type: 'fileChange',
      changes: [{path: 'result.txt', kind: {type: 'add'}, diff: '+fixture'}]
    };
    fixture.item(record.threadId, item);
    const request = {
      method: 'item/fileChange/requestApproval',
      params: {threadId: record.threadId, turnId: record.turnId, itemId: item.id}
    };
    const approval = await fixture.host.requestHandler(request);
    assert.equal(seen[0], item);
    assert.equal(approval.canAccept, true);
    assert.deepEqual(approval.reply(true), {decision: 'accept'});
    assert.deepEqual(fixture.calls.filter(c => c.method === 'thread/read').at(-1).p, {
      threadId: record.threadId,
      includeTurns: true
    });
    const missing = await fixture.host.requestHandler({...request, params: {...request.params, itemId: 'missing'}});
    assert.equal(missing.canAccept, false);
    assert.throws(() => missing.reply(true), /核准/);
    assert.deepEqual(missing.reply(false), {decision: 'decline'});
    const read = fixture.host.request;
    fixture.host.request = async (method, p) => {
      if (method === 'thread/read') throw Error('unavailable');
      return read(method, p);
    };
    assert.equal((await fixture.host.requestHandler(request)).canAccept, false);
    fixture.host.request = read;
  } finally {
    await bridge.close();
  }
});

test('pending native file change events supply changes before thread/read contains the item', async () => {
  const {bridge, fixture} = await make({onRequest: (message, item) => approvalRequest(message, item)});
  try {
    const record = await bridge.start({requestId: 'pending-file-item', task: 'bounded'});
    const item = {
      id: 'pending-item',
      type: 'fileChange',
      status: 'inProgress',
      changes: [{path: 'native.txt', kind: {type: 'add'}, diff: 'native contents'}]
    };
    const params = {threadId: record.threadId, turnId: record.turnId, item};
    fixture.host.emit({method: 'item/started', params});
    fixture.host.emit({
      method: 'item/started',
      params: {...params, threadId: 'foreign', item: {...item, changes: [{path: 'foreign.txt'}]}}
    });
    fixture.host.emit({
      method: 'item/started',
      params: {...params, turnId: 'foreign-turn', item: {...item, changes: [{path: 'old.txt'}]}}
    });
    const request = {
      method: 'item/fileChange/requestApproval',
      params: {threadId: record.threadId, turnId: record.turnId, itemId: item.id}
    };
    const approval = await fixture.host.requestHandler(request);
    assert.equal(approval.canAccept, true);
    assert.deepEqual(approval.details.changes, item.changes);
    assert.deepEqual(approval.reply(true), {decision: 'accept'});
    fixture.host.emit({method: 'item/completed', params});
    assert.equal((await fixture.host.requestHandler(request)).canAccept, false);
  } finally {
    await bridge.close();
  }
});

test('approval cannot use an item from another turn or appear after the worker finishes during read', async () => {
  let finishRead;
  let reading;
  const {bridge, fixture} = await make({onRequest: (message, item) => approvalRequest(message, item)});
  try {
    const record = await bridge.start({requestId: 'approval-read', task: 'bounded'});
    const request = {
      method: 'item/fileChange/requestApproval',
      params: {threadId: record.threadId, turnId: record.turnId, itemId: 'same-id'}
    };
    const read = fixture.host.request;
    fixture.host.request = async (method, p) =>
      method === 'thread/read'
        ? {thread: {turns: [{id: 'older-turn', items: [{id: 'same-id', changes: [{path: 'old.txt'}]}]}]}}
        : read(method, p);
    assert.equal((await fixture.host.requestHandler(request)).canAccept, false);
    fixture.host.request = async (method, p) =>
      method === 'thread/read'
        ? new Promise(resolve => {
            finishRead = resolve;
          })
        : read(method, p);
    reading = fixture.host.requestHandler(request);
    fixture.finish(record.threadId, record.turnId);
    finishRead({thread: {turns: [{id: record.turnId, items: [{id: 'same-id', changes: [{path: 'new.txt'}]}]}]}});
    assert.equal(await reading, undefined);
    fixture.host.request = read;
  } finally {
    await bridge.close();
  }
});

test('fully trusted workers send never approval and danger-full-access to the native core', async () => {
  const {bridge, fixture} = await make({accessMode: 'danger-full-access'});
  try {
    await bridge.start({requestId: 'trusted', task: 'bounded'});
    const thread = fixture.calls.find(c => c.method === 'thread/start').p,
      turn = fixture.calls.find(c => c.method === 'turn/start').p;
    assert.equal(thread.sandbox, 'danger-full-access');
    assert.equal(thread.approvalPolicy, 'never');
    assert.equal(turn.sandboxPolicy.type, 'dangerFullAccess');
    assert.equal(turn.approvalPolicy, 'never');
    assert.match(turn.input[0].text, /不得超過主代理的授權/);
  } finally {
    await bridge.close();
  }
});

// Inspection has a bounded partial preview; complete long output stays local.
test('Luna result bounds unfinished output and saves full completed output inside workspace', async () => {
  const {lunaResult} = await import('../src/luna-bridge.mjs');
  const text = 'result\n'.repeat(4000),
    r = {workspace, parentId: randomUUID(), requestId: 'long', settled: false, status: 'running', output: text};
  const running = await lunaResult(r);
  assert.equal(running.output, undefined);
  assert.equal(running.outputPreview, text.slice(-1000));
  assert.equal(running.outputLength, text.length);
  const final = await lunaResult({...r, settled: true, status: 'completed'});
  assert.equal(final.output, undefined);
  assert.equal(final.outputPreview.length, 1000);
  assert.ok(final.outputPath.startsWith(workspace + path.sep));
  assert.equal(await readFile(final.outputPath, 'utf8'), text);
  assert.equal(path.basename(final.outputPath), 'long.output.md');
  assert.deepEqual(await lunaResult({...r, settled: true, status: 'completed'}), final);
  await assert.rejects(lunaResult({...r, settled: true, parentId: '../escape'}));
  const changedText = text + 'changed';
  const changed = await lunaResult({...r, settled: true, output: changedText});
  assert.notEqual(changed.outputPath, final.outputPath);
  assert.equal(await readFile(final.outputPath, 'utf8'), text);
  assert.equal(await readFile(changed.outputPath, 'utf8'), changedText);
  assert.deepEqual(await lunaResult({...r, settled: true, output: changedText}), changed);
  await writeFile(changed.outputPath, 'later unrelated content');
  const recovered = await lunaResult({...r, settled: true, output: changedText});
  assert.notEqual(recovered.outputPath, changed.outputPath);
  assert.equal(await readFile(changed.outputPath, 'utf8'), 'later unrelated content');
  assert.equal(await readFile(recovered.outputPath, 'utf8'), changedText);
  assert.deepEqual(await lunaResult({...r, settled: true, output: changedText}), recovered);
});
test('long result refuses a workspace junction pointing outside', async () => {
  const {lunaResult} = await import('../src/luna-bridge.mjs');
  const {symlink} = await import('node:fs/promises');
  const w = path.join(root, randomUUID()),
    outside = path.join(root, randomUUID());
  await mkdir(w);
  await mkdir(outside);
  await symlink(outside, path.join(w, '.runtime'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    lunaResult({workspace: w, parentId: 'parent', requestId: 'escape', settled: true, output: 'x'.repeat(4001)}),
    /Unsafe/
  );
});

test('closing ignores settled historical records even when their thread is unavailable', async () => {
  const {bridge, fixture} = await make();
  const record = await bridge.start({requestId: 'closed-history', task: 'Fake history'});
  fixture.finish();
  await bridge.inspect({requestId: 'closed-history'});
  await bridge.close();
  const next = fakeHost();
  let reads = 0;
  const original = next.host.request;
  next.host.request = (method, p) => {
    if (method.startsWith('thread/')) {
      reads++;
      throw Error('historical thread unavailable');
    }
    return original(method, p);
  };
  const reopened = await createLunaBridge({
    root,
    workspace,
    parentId: record.parentId,
    executable: 'codex',
    hostFactory: o => {
      next.setOptions(o);
      return next.host;
    }
  });
  await reopened.close();
  assert.equal(next.closeCount(), 1);
  assert.equal(reads, 0);
});

test('human defaults and AI per-task model/effort choices reach native worker requests unchanged', async () => {
  const models = [
    ...catalog,
    {model: 'gpt-6.1-sol', supportedReasoningEfforts: ['low', 'ultra'].map(reasoningEffort => ({reasoningEffort}))}
  ];
  const {bridge, fixture} = await make({models, workerPolicy: {model: 'gpt-6.1-sol', effort: 'ultra'}});
  try {
    const first = await bridge.start({requestId: 'sol', task: 'fake default task'});
    assert.equal(first.model, 'gpt-6.1-sol');
    assert.equal(first.effort, 'ultra');
    const firstStart = fixture.calls.find(c => c.method === 'thread/start').p,
      firstTurn = fixture.calls.find(c => c.method === 'turn/start').p;
    assert.equal(firstStart.model, 'gpt-6.1-sol');
    assert.equal(firstStart.config.model_reasoning_effort, 'ultra');
    assert.equal(firstTurn.model, 'gpt-6.1-sol');
    assert.equal(firstTurn.effort, 'ultra');
    const second = await bridge.start({
      requestId: 'luna',
      task: 'fake selected task',
      model: 'gpt-6-luna',
      effort: 'high'
    });
    assert.equal(second.model, 'gpt-6-luna');
    assert.equal(fixture.calls.findLast(c => c.method === 'turn/start').p.effort, 'high');
    const before = fixture.calls.filter(c => c.method === 'turn/start').length;
    await assert.rejects(
      bridge.start({requestId: 'sol', task: 'fake default task', model: 'gpt-6-luna', effort: 'high'}),
      /模型設定/
    );
    await assert.rejects(
      bridge.start({requestId: 'unsupported', task: 'fake', model: 'gpt-6-luna', effort: 'ultra'}),
      /不支援/
    );
    assert.equal(fixture.calls.filter(c => c.method === 'turn/start').length, before);
    const persisted = JSON.parse(
      await readFile(path.join(root, '.runtime', 'luna-bridge', first.parentId, 'sol.json'))
    );
    assert.equal(persisted.model, 'gpt-6.1-sol');
    assert.equal(persisted.effort, 'ultra');
  } finally {
    await bridge.close();
  }
});

test('AI-auto bridge requires explicit concrete model and effort, then forwards choices unchanged', async () => {
  const models = [
    ...catalog,
    {model: 'gpt-6.1-sol', supportedReasoningEfforts: ['low', 'ultra'].map(reasoningEffort => ({reasoningEffort}))}
  ];
  const {bridge, fixture} = await make({models, workerPolicy: {model: 'auto', effort: 'auto'}});
  try {
    assert.deepEqual(bridge.workerPolicy, {model: 'auto', effort: 'auto'});
    await assert.rejects(bridge.start({requestId: 'missing', task: 'fake'}), /明確指定原生目錄/);
    await assert.rejects(bridge.start({requestId: 'partial', task: 'fake', model: 'gpt-6-luna'}), /AI 自動選擇/);
    await assert.rejects(
      bridge.start({requestId: 'auto-model', task: 'fake', model: 'auto', effort: 'auto'}),
      /明確指定原生目錄/
    );
    assert.equal(
      fixture.calls.some(c => c.method === 'thread/start' || c.method === 'turn/start'),
      false
    );
    for (const [requestId, model, effort] of [
      ['sol-auto', 'gpt-6.1-sol', 'ultra'],
      ['luna-auto', 'gpt-6-luna', 'high']
    ]) {
      const record = await bridge.start({requestId, task: 'choose for this task', model, effort});
      assert.equal(record.model, model);
      assert.equal(record.effort, effort);
      const start = fixture.calls.filter(c => c.method === 'thread/start').at(-1).p;
      const turn = fixture.calls.filter(c => c.method === 'turn/start').at(-1).p;
      assert.equal(start.model, model);
      assert.equal(start.config.model_reasoning_effort, effort);
      assert.equal(turn.model, model);
      assert.equal(turn.effort, effort);
    }
  } finally {
    await bridge.close();
  }
});

test('wait deadline ends only the wait; event completion wakes all listeners without polling', async () => {
  const {bridge, fixture} = await make();
  try {
    const started = await bridge.start({requestId: 'event-wait', task: 'long synthetic work'});
    const timed = await bridge.wait({requestId: started.requestId, timeoutMs: 15});
    assert.equal(timed.settled, false);
    const before = fixture.calls.filter(c => c.method === 'thread/read').length;
    const waiting = bridge.wait({requestId: started.requestId, timeoutMs: 3000});
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(
      fixture.calls.filter(c => c.method === 'thread/read').length,
      before + 1,
      'only initial inspect, no one-second poll'
    );
    const second = bridge.wait({requestId: started.requestId, timeoutMs: 3000});
    fixture.finish();
    assert((await waiting).settled);
    assert((await second).settled);
    assert.equal(fixture.calls.filter(c => c.method === 'turn/start').length, 1);
    assert.equal(fixture.calls.filter(c => c.method === 'turn/interrupt').length, 0);
  } finally {
    await bridge.close();
  }
});

test('runtime quiet check exposes genuine activity without changing or restarting the native work', async () => {
  let wake;
  const attention = new Promise(r => {
    wake = r;
  });
  const {bridge, fixture} = await make({
    watchOptions: {quietMs: 30},
    onChange: r => {
      if (
        r.inspection &&
        r.activity?.lastToolName === 'commandExecution' &&
        r.inspection.lastActivityAt === r.activity.lastEventAt
      )
        wake(r);
    }
  });
  try {
    const started = await bridge.start({requestId: 'quiet-bridge', task: 'synthetic long work'});
    fixture.host.emit({
      method: 'item/started',
      params: {threadId: started.threadId, item: {id: 'tool-live', type: 'commandExecution'}}
    });
    const keepAlive = setTimeout(() => wake(null), 3000);
    const observed = await attention;
    clearTimeout(keepAlive);
    assert(observed);
    const result = await lunaResult(await bridge.inspect({requestId: started.requestId}));
    assert.equal(result.inspection.statusObserved, 'running');
    assert.equal(result.activity.lastToolName, 'commandExecution');
    assert(result.lastReadAt);
    assert.equal(result.settled, false);
    assert.equal(fixture.calls.filter(c => c.method === 'turn/start').length, 1);
    assert.equal(fixture.calls.filter(c => c.method === 'turn/interrupt').length, 0);
    fixture.finish();
  } finally {
    await bridge.close();
  }
});

test('delayed inspection cannot replace a newer terminal event with an old running readback', async () => {
  let release;
  const gate = new Promise(r => {
    release = r;
  });
  let delayed = false;
  const {bridge, fixture} = await make({threadRead: p => (delayed ? gate : undefined)});
  try {
    const started = await bridge.start({requestId: 'late-read', task: 'fake task'});
    delayed = true;
    const reading = bridge.inspect({requestId: started.requestId});
    await new Promise(r => setImmediate(r));
    fixture.finish();
    release({
      thread: {
        id: started.threadId,
        cwd: workspace,
        status: {type: 'active'},
        turns: [{id: started.turnId, status: 'inProgress', items: []}]
      }
    });
    assert.equal((await reading).status, 'completed');
    delayed = false;
  } finally {
    release?.({});
    await bridge.close();
  }
});

test('unfinished result includes bounded partial output references and approval state', async () => {
  const result = await lunaResult({
    requestId: 'partial',
    status: 'running',
    settled: false,
    output: 'x'.repeat(9000),
    outputFiles: ['part.txt'],
    waitingForApproval: true,
    lastActivityAt: 100,
    activity: {phase: 'tool', lastEventAt: 100}
  });
  assert.equal(result.outputLength, 9000);
  assert.equal(result.outputPreview.length, 1000);
  assert.deepEqual(result.outputFiles, ['part.txt']);
  assert.equal(result.waitingForApproval, true);
  assert.equal(result.lastActivityAt, 100);
});

test('new same-turn native activity clears transient unresolved inspection without another read', async () => {
  let fail = false;
  const {bridge, fixture} = await make({
    threadRead: () => {
      if (fail) throw Error('temporary read failure');
    }
  });
  try {
    const started = await bridge.start({requestId: 'recover-read', task: 'fake'});
    fail = true;
    assert.equal((await bridge.inspect({requestId: started.requestId})).status, 'unresolved');
    fixture.host.emit({
      method: 'item/agentMessage/delta',
      params: {threadId: started.threadId, turnId: started.turnId, delta: 'new'}
    });
    assert.equal((await bridge.list(false))[0].status, 'running');
  } finally {
    fail = false;
    await bridge.close();
  }
});

test('overlapping approvals remain suspended until the final decision and restart the quiet clock', async () => {
  const resolve = [];
  const {bridge, fixture} = await make({
    watchOptions: {quietMs: 100},
    onRequest: () => new Promise(r => resolve.push(r))
  });
  try {
    const started = await bridge.start({requestId: 'approval-watch', task: 'fake'});
    fixture.host.emit({
      method: 'item/started',
      params: {
        threadId: started.threadId,
        turnId: started.turnId,
        item: {id: 'approval-command', type: 'commandExecution'}
      }
    });
    const message = {
      method: 'item/commandExecution/requestApproval',
      params: {threadId: started.threadId, turnId: started.turnId}
    };
    const a = fixture.host.requestHandler(message),
      b = fixture.host.requestHandler(message);
    await new Promise(r => setTimeout(r, 130));
    let record = (await bridge.list(false))[0];
    assert(record.waitingForApproval);
    assert.equal(record.inspection, undefined);
    resolve[0]({decision: 'accept'});
    await a;
    assert((await bridge.list(false))[0].waitingForApproval);
    const decided = Date.now();
    resolve[1]({decision: 'accept'});
    await b;
    record = (await bridge.list(false))[0];
    assert.equal(record.waitingForApproval, undefined);
    assert(record.lastActivityAt >= decided);
    fixture.host.emit({
      method: 'thread/tokenUsage/updated',
      params: {threadId: started.threadId, turnId: started.turnId}
    });
    fixture.host.emit({
      method: 'item/started',
      params: {
        threadId: started.threadId,
        turnId: started.turnId,
        item: {id: 'approval-command', type: 'commandExecution'}
      }
    });
    assert.equal(
      (await bridge.list(false))[0].lastActivityAt,
      record.lastActivityAt,
      'non-progress and duplicate events cannot undo the approval decision clock'
    );
    await new Promise(r => setTimeout(r, 10));
    assert.equal((await bridge.list(false))[0].inspection, undefined);
  } finally {
    for (const r of resolve) r({decision: 'decline'});
    await bridge.close();
  }
});

test('main-agent account observation registers one owned wait without all-account refresh', async () => {
  const calls = [],
    events = [];
  let cancelled = 0;
  const bridge = await createLunaBridge({
    root,
    workspace,
    parentId: 'quota-query-parent',
    geminiOptions: {
      accounts: {
        refreshAll: () => {
          throw Error('must not refresh all');
        },
        observe: async options => {
          calls.push(options);
          return {scheduling: {status: 'waiting', notificationRegistered: true}, accounts: []};
        },
        cancelWorkerHandoff: () => {
          cancelled++;
        }
      }
    },
    onGeminiHandoff: event => events.push(event)
  });
  try {
    for (let i = 0; i < 18; i++) assert.equal((await bridge.accounts()).scheduling.status, 'waiting');
    assert.equal(new Set(calls.map(c => c.requestId)).size, 1);
    assert(calls.every(c => c.parentId === 'quota-query-parent'));
    const callback = calls[0].onHandoff;
    callback({parentId: 'quota-query-parent', requestIds: [], queryIds: [calls[0].requestId], status: 'ready'});
    assert.equal(events.length, 1);
    bridge.cancelGeminiHandoff();
    assert.equal(cancelled, 1);
    callback({parentId: 'quota-query-parent', requestIds: [], queryIds: [calls[0].requestId], status: 'ready'});
    assert.equal(events.length, 1);
  } finally {
    await bridge.close();
  }
});

test(
  'real manager query IDs remain independent while an earlier room receipt awaits its worker durable write',
  {timeout: 7000},
  async t => {
    const base = scratchBase;
    await mkdir(base, {recursive: true});
    const testRoot = await mkdtemp(path.join(base, 'bridge-query-durable-'));
    const A = 'a'.repeat(32),
      B = 'b'.repeat(32),
      parentId = 'query-durable-parent',
      now = Date.parse('2026-10-13T00:00:00Z');
    let identity = {accountId: A, email: 'a@example.test'},
      zero = false,
      finishProcess,
      lease,
      releaseWrite,
      resolveWrite,
      writeMock,
      receiptState;
    const writeGate = new Promise(resolve => {
        releaseWrite = resolve;
      }),
      writeEntered = new Promise(resolve => {
        resolveWrite = resolve;
      }),
      events = [],
      queries = [],
      activations = [];
    const vault = {
      current: async () => ({...identity}),
      capture: async () => ({...identity}),
      assertIdle: async () => {},
      activate: async id => {
        activations.push(id);
        identity = {accountId: id, email: `${id[0]}@example.test`};
        return {...identity};
      }
    };
    vault.queryQuota = async id => {
      queries.push(id);
      return {
        accountId: id,
        auth: {status: 'authenticated', checkedAt: new Date(now).toISOString()},
        quota: {
          status: 'ready',
          checkedAt: new Date(now).toISOString(),
          windows: [{key: 'five_hour', remainingPercent: zero && id === A ? 0 : 80, resetsAt: (now + 3600000) / 1000}]
        }
      };
    };
    const accounts = settleAfterRelease(
      createGeminiAccounts({root: testRoot, enabled: true, clock: () => now, vault, login: {}})
    );
    await accounts.capture();
    identity = {accountId: B, email: 'b@example.test'};
    await accounts.capture();
    await accounts.activate({accountId: A});
    activations.length = 0;
    const spawnImpl = (_exe, args) => {
      const child = new EventEmitter();
      Object.assign(child, {pid: 23000, stdout: new PassThrough(), stderr: new PassThrough()});
      if (args[0] === 'models')
        queueMicrotask(() => {
          child.stdout.write('gemini-3.8-flash-high\tFlash\n');
          child.emit('close', 0);
        });
      else
        finishProcess = () => {
          child.stdout.write(
            JSON.stringify({
              event: 'result',
              result: {status: 'ERROR', error: 'RESOURCE_EXHAUSTED quota', response: 'saved original quota output'}
            }) + '\n'
          );
          child.emit('close', 1);
        };
      return child;
    };
    const bridge = await createLunaBridge({
      root: testRoot,
      workspace: testRoot,
      parentId,
      geminiOnly: true,
      geminiOptions: {accounts},
      geminiFactory: options =>
        createGeminiWorker({
          ...options,
          executable: 'fake-never-run-agy',
          env: {SystemRoot: 'C:/Windows'},
          spawnImpl,
          killTree: async () => {
            throw Error('No process kill expected');
          },
          gitStatus: async () => null
        }),
      onGeminiHandoff: event => {
        events.push(structuredClone(event));
        receiptState = mergeGeminiHandoff(receiptState, {...event, epoch: 0});
      }
    });
    const job = (requestId, accountId) => ({
      requestId,
      task: 'bounded fake work',
      model: 'gemini-3.8-flash',
      effort: 'high',
      ...(accountId ? {accountId} : {})
    });
    const waitFor = async predicate => {
      const deadline = Date.now() + 2500;
      while (!predicate()) {
        if (Date.now() > deadline) throw Error('expected fixture event not reached');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    try {
      await bridge.start(job('quota-owned'));
      await waitFor(() => !!finishProcess);
      await bridge.start(job('old-expectation', B));
      assert.equal((await bridge.wait({requestId: 'old-expectation', timeoutMs: 1000})).dispatch, 'not-started');
      const first = await bridge.accounts();
      assert.equal(first.scheduling.status, 'waiting');
      assert.equal(first.scheduling.notificationRegistered, true);
      const target = path.join(testRoot, '.runtime/luna-bridge', parentId, 'quota-owned.json'),
        rename = fs.rename;
      let held = false;
      writeMock = t.mock.method(fs, 'rename', async (from, to) => {
        if (
          !held &&
          path.resolve(to) === path.resolve(target) &&
          JSON.parse(await readFile(from, 'utf8')).status === 'failed'
        ) {
          held = true;
          resolveWrite();
          await writeGate;
        }
        return rename(from, to);
      });
      syncBuiltinESMExports();
      zero = true;
      finishProcess();
      await writeEntered;
      assert.deepEqual(activations, [B]);
      assert.equal(
        events.some(event => event.status === 'ready'),
        false
      );
      assert.equal(JSON.parse(await readFile(target, 'utf8')).settled, false);
      const count = queries.length,
        current = await bridge.accounts();
      assert.equal(current.scheduling.status, 'ready');
      assert.equal(current.scheduling.notificationRegistered, false);
      assert.equal(queries.length, count, 'unchanged ready manager creates no second waiting receipt or quota query');
      // A real new episode, not a ghost injected into the first worker's callback.
      lease = await accounts.acquire();
      await bridge.start(job('new-expectation', A));
      assert.equal((await bridge.wait({requestId: 'new-expectation', timeoutMs: 1000})).dispatch, 'not-started');
      const second = await bridge.accounts();
      assert.equal(second.scheduling.status, 'waiting');
      assert.notEqual(second.scheduling.waitId, first.scheduling.waitId);
      assert.deepEqual(
        geminiAccountWait(receiptState).queryIds,
        [first.scheduling.waitId, second.scheduling.waitId],
        'both legitimate live query IDs are retained, not overwritten'
      );
      await lease.release();
      assert.equal(
        events.some(event => event.status === 'ready' && event.requestIds.includes('quota-owned')),
        false,
        'a later legal terminal receipt must not flush the earlier worker before its durable write finishes'
      );
      releaseWrite();
      assert.equal((await bridge.wait({requestId: 'quota-owned', timeoutMs: 2000})).settled, true);
      const ready = events.filter(event => event.status === 'ready');
      assert.equal(ready.length, 2);
      assert.deepEqual(
        new Set(geminiAccountWait(receiptState).queryIds),
        new Set([first.scheduling.waitId, second.scheduling.waitId])
      );
      for (const event of ready)
        for (const id of event.requestIds) {
          const row = JSON.parse(
            await readFile(path.join(testRoot, '.runtime/luna-bridge', parentId, `${id}.json`), 'utf8')
          );
          assert.equal(row.settled, true);
        }
      assert.deepEqual(activations, [B]);
      assert.equal(finishProcess !== undefined, true);
    } finally {
      releaseWrite?.();
      await lease?.release();
      writeMock?.mock.restore();
      syncBuiltinESMExports();
      await bridge.close();
    }
  }
);

test('non-Claude workers (Codex) do not call nested, while Claude workers do', async () => {
  let nestedCalls = 0;
  const {bridge, fixture} = await make({
    nested: async () => {
      nestedCalls++;
      return {mcpConfig: {mcpServers: {}}, async close() {}, list: async () => []};
    },
    claudeFactory: () => ({
      run: async () => ({status: 'completed', settled: true, output: 'claude output', outputFiles: []})
    })
  });
  try {
    // Codex worker should NOT call nested
    const started = await bridge.start({requestId: 'codex-job', task: 'do codex'});
    fixture.finish(started.threadId, started.turnId);
    const codexRes = await bridge.wait({requestId: 'codex-job', timeoutMs: 1000});
    assert.equal(codexRes.status, 'completed');
    assert.equal(nestedCalls, 0, 'Codex worker does not call nested');

    // Claude worker DOES call nested
    await bridge.start({requestId: 'claude-job', task: 'do claude', model: 'claude-opus-5-5', effort: 'high'});
    const claudeRes = await bridge.wait({requestId: 'claude-job', timeoutMs: 1000});
    assert.equal(claudeRes.status, 'completed');
    assert.equal(nestedCalls, 1, 'Claude worker calls nested');
  } finally {
    await bridge.close();
  }
});

test('lunaResult includes subWorkers array when present on record', async () => {
  const withSub = await lunaResult({
    requestId: 'parent-with-sub',
    status: 'completed',
    settled: true,
    subWorkers: [{requestId: 'sub-1', model: 'gemini-3.8-flash', status: 'completed', settled: true}]
  });
  assert.ok(Array.isArray(withSub.subWorkers));
  assert.equal(withSub.subWorkers.length, 1);
  assert.equal(withSub.subWorkers[0].requestId, 'sub-1');

  const withoutSub = await lunaResult({
    requestId: 'no-sub',
    status: 'completed',
    settled: true
  });
  assert.equal(withoutSub.subWorkers, undefined);
});

test('a K GPT worker turn carries the private common memory as native context, not inside the delegated task', async () => {
  const file = path.join(root, 'agent-home', 'shared', 'common-memory.md');
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, '- GPT 工人假偏好');
  try {
    const {bridge, fixture} = await make();
    await bridge.start({requestId: 'common-memory', task: '合成任務'});
    const turn = fixture.calls.find(c => c.method === 'turn/start').p;
    assert.equal(turn.additionalContext.k_common_memory.kind, 'application');
    assert.match(turn.additionalContext.k_common_memory.value, /GPT 工人假偏好/);
    assert.doesNotMatch(turn.input[0].text, /GPT 工人假偏好/);
    assert.match(turn.input[0].text, /不得再委派子代理/);
    await bridge.close?.();
  } finally {
    await fs.rm(file);
  }
});
