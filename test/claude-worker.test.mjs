import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createClaudeWorker} from '../src/claude-worker.mjs';
import {scratchBase} from './scratch.mjs';

const rows = [
  {model: 'claude-fable-5', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']},
  {model: 'claude-fable-5-1', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']},
  {model: 'claude-opus-5-5', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']},
  {model: 'claude-sonnet-5-5', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']},
  {model: 'claude-haiku-5-5', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']},
  {model: 'claude-haiku-4-5-20251001', supportedReasoningEfforts: []}
].map(row => ({
  ...row,
  supportedReasoningEfforts: row.supportedReasoningEfforts.map(reasoningEffort => ({reasoningEffort}))
}));
async function fixture({models = rows, closeError = false} = {}) {
  const root = path.join(scratchBase, 'claude-worker-tests', randomUUID());
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace, {recursive: true});
  let handlers,
    starts = 0,
    interrupts = 0,
    closes = 0;
  let resolveClosed;
  const closed = new Promise(resolve => (resolveClosed = resolve));
  const hostFactory = async options => {
    handlers = options;
    return {
      models,
      closed,
      pid: 4242,
      async start(prompt) {
        starts++;
        handlers.prompt = prompt;
        this.prompt = prompt;
      },
      async interrupt() {
        interrupts++;
        resolveClosed();
      },
      async close() {
        closes++;
        if (closeError) throw Error('close failed');
        resolveClosed();
      }
    };
  };
  return {
    root,
    workspace,
    handlers: () => handlers,
    finishClosed: () => resolveClosed(),
    stats: () => ({starts, interrupts, closes}),
    worker: options => createClaudeWorker({workspace, ...options, hostFactory})
  };
}

test('native Fable and 5.5 models validate supported efforts; legacy no-effort model accepts explicit null', async () => {
  for (const [model, effort] of [
    ['claude-fable-5', 'high'],
    ['claude-fable-5-1', 'max'],
    ['claude-opus-5-5', 'xhigh'],
    ['claude-sonnet-5-5', 'high'],
    ['claude-haiku-5-5', 'max'],
    ['claude-haiku-4-5-20251001', null]
  ]) {
    const f = await fixture();
    const pending = f.worker().run({task: 'bounded', model, effort});
    await new Promise(resolve => setImmediate(resolve));
    f.handlers().onMessage({type: 'result', result: 'done'});
    const result = await pending;
    assert.equal(result.status, 'completed');
    assert.equal(result.output, 'done');
    assert.equal(f.stats().starts, 1);
  }
});

test('unsupported model or effort is rejected before a native turn starts', async () => {
  const f = await fixture();
  await assert.rejects(f.worker().run({task: 'bounded', model: 'claude-sonnet-5-5', effort: 'ultra'}), /不支援/);
  await assert.rejects(f.worker().run({task: 'bounded', model: 'claude-unknown-5-5', effort: null}), /目前不可用/);
  assert.equal(f.stats().starts, 0);
});

test('native result and process-close-without-result remain distinct outcomes', async () => {
  const success = await fixture();
  {
    const p = success.worker().run({task: 'bounded', model: 'claude-opus-5-5', effort: 'low'});
    await new Promise(r => setImmediate(r));
    success.handlers().onMessage({type: 'result', result: 'native result'});
    assert.equal((await p).status, 'completed');
  }
  const noResult = await fixture();
  {
    const p = noResult.worker().run({task: 'bounded', model: 'claude-opus-5-5', effort: 'low'});
    await new Promise(r => setImmediate(r));
    noResult.handlers().onMessage({type: 'assistant', message: {content: [{type: 'text', text: 'partial'}]}});
    noResult.handlers().onMessage({type: 'result', isReplay: true, result: 'stale'});
    // Closing the process without a result resolves the host.closed race.
    // The fake host exposes the resolver indirectly through close().
    noResult.finishClosed();
    const result = await p;
    assert.equal(result.status, 'failed');
    assert.match(result.error, /沒有原生結果/);
    assert.match(result.output, /partial/);
  }
});

test('cancellation waits for interrupt and close; close failure stays explicitly unsettled', async () => {
  const cancelled = await fixture();
  {
    const controller = new AbortController(),
      p = cancelled.worker().run({task: 'bounded', model: 'claude-opus-5-5', effort: 'low', signal: controller.signal});
    await new Promise(r => setImmediate(r));
    controller.abort();
    const result = await p;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.settled, true);
    assert.equal(cancelled.stats().interrupts, 1);
    assert.equal(cancelled.stats().closes, 1);
  }
  const uncertain = await fixture({closeError: true});
  {
    const controller = new AbortController(),
      p = uncertain.worker().run({task: 'bounded', model: 'claude-opus-5-5', effort: 'low', signal: controller.signal});
    await new Promise(r => setImmediate(r));
    controller.abort();
    await assert.rejects(p, error => error.settled === false && /不得重播/.test(error.message));
  }
});

test('read-only and workspace-write enforce tool and path boundaries', async () => {
  const f = await fixture();
  const ro = f.worker({accessMode: 'read-only'}).run({task: 'read', model: 'claude-opus-5-5', effort: 'low'});
  await new Promise(r => setImmediate(r));
  for (const toolName of ['Write', 'Edit', 'Bash', 'PowerShell', 'ExitPlanMode', 'WebFetch', 'WebSearch'])
    assert.equal(
      (await f.handlers().onPermission({toolName, input: {file_path: path.join(f.workspace, 'a.txt')}})).behavior,
      'deny'
    );
  f.handlers().onMessage({type: 'result', result: 'ok'});
  await ro;
  const nested = path.join(f.workspace, 'new', 'nested');
  const allowed = [];
  const rw = f.worker({accessMode: 'workspace-write'});
  const run = rw.run({
    task: 'write',
    model: 'claude-opus-5-5',
    effort: 'low',
    onPermission: value => {
      allowed.push(value.toolName);
      return {behavior: 'allow'};
    }
  });
  await new Promise(r => setImmediate(r));
  await mkdir(path.join(f.workspace, 'existing'), {recursive: true});
  await writeFile(path.join(f.workspace, 'existing', 'file.txt'), 'x');
  for (const file_path of [path.join(f.workspace, 'existing', 'file.txt'), path.join(nested, 'new.txt')])
    assert.equal((await f.handlers().onPermission({toolName: 'Write', input: {file_path}})).behavior, 'allow');
  assert.equal(
    (await f.handlers().onPermission({toolName: 'Write', input: {file_path: path.join(f.root, 'outside.txt')}}))
      .behavior,
    'deny'
  );
  for (const toolName of ['ExitPlanMode', 'Bash', 'PowerShell'])
    assert.equal((await f.handlers().onPermission({toolName, input: {}})).behavior, 'deny');
  assert.equal(allowed.length, 2);
  f.handlers().onMessage({type: 'result', result: 'ok'});
  await run;
});

test('the worker reports the Claude Code process id when it starts', async () => {
  const f = await fixture(),
    started = [];
  const run = f
    .worker()
    .run({task: 'bounded', model: 'claude-opus-5-5', effort: 'low', onStart: pid => started.push(pid)});
  await new Promise(r => setImmediate(r));
  f.handlers().onMessage({type: 'result', result: 'done'});
  await run;
  assert.deepEqual(started, [4242]);
});

test('without mcpConfig, Claude worker has empty MCP servers, default instructions, and denies re-delegation', async () => {
  const f = await fixture();
  const run = f.worker().run({task: 'bounded task', model: 'claude-opus-5-5', effort: 'low'});
  await new Promise(r => setImmediate(r));
  const options = f.handlers();
  assert.deepEqual(options.mcpConfig, {mcpServers: {}});
  assert.equal(options.nestedWorker, false);
  assert.match(options.prompt, /不再派工/);
  assert.doesNotMatch(options.prompt, /k_luna/);
  assert.equal((await options.onPermission({toolName: 'mcp__k_luna__luna_start', input: {}})).behavior, 'deny');
  for (const toolName of ['ExitPlanMode', 'Agent', 'Task', 'TaskOutput', 'TaskStop']) {
    assert.equal((await options.onPermission({toolName, input: {}})).behavior, 'deny');
  }
  options.onMessage({type: 'result', result: 'done'});
  await run;
});

test('with mcpConfig, Claude worker receives gateway MCP, allows mcp__k_luna__*, and denies native Agent/Task', async () => {
  const f = await fixture();
  const fakeGatewayMcp = {mcpServers: {k_luna: {command: 'node', args: ['gateway']}}};
  const run = f.worker().run({
    task: 'nested task',
    model: 'claude-opus-5-5',
    effort: 'high',
    mcpConfig: fakeGatewayMcp
  });
  await new Promise(r => setImmediate(r));
  const options = f.handlers();
  assert.deepEqual(options.mcpConfig, fakeGatewayMcp);
  assert.equal(options.nestedWorker, true);
  assert.match(options.prompt, /統籌工人/);
  assert.match(options.prompt, /k_luna/);
  assert.match(options.prompt, /luna_wait/);
  assert.match(options.prompt, /小工人不能再派工/);
  assert.equal(
    (await options.onPermission({toolName: 'mcp__k_luna__luna_start', input: {task: 'sub'}})).behavior,
    'allow'
  );
  assert.equal(
    (await options.onPermission({toolName: 'mcp__k_luna__luna_wait', input: {requestId: 'sub-1'}})).behavior,
    'allow'
  );
  for (const toolName of ['ExitPlanMode', 'Agent', 'Task', 'TaskOutput', 'TaskStop']) {
    assert.equal((await options.onPermission({toolName, input: {}})).behavior, 'deny');
  }
  options.onMessage({type: 'result', result: 'nested done'});
  const res = await run;
  assert.equal(res.status, 'completed');
  assert.equal(res.output, 'nested done');
});
