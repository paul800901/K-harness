import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createLunaBridge} from '../src/luna-bridge.mjs';
import {availableWorkerModels, validateWorkerPolicy} from '../src/worker-policy.mjs';
import {scratchBase} from './scratch.mjs';

const workspaceModels = [
  {model: 'gpt-6.1-sol', supportedReasoningEfforts: [{reasoningEffort: 'high'}]},
  {model: 'claude-opus-5-5', supportedReasoningEfforts: [{reasoningEffort: 'high'}]}
];
async function fixture({
  claudeFactory,
  accessMode = 'workspace-write',
  onChange = () => {},
  onRequest,
  nested,
  workerPolicy = {model: 'claude-opus-5-5', effort: null}
} = {}) {
  const root = path.join(scratchBase, 'claude-bridge-tests', randomUUID());
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace, {recursive: true});
  const bridge = await createLunaBridge({
    root,
    workspace,
    parentId: 'parent',
    geminiOnly: true,
    accessMode,
    claudeFactory,
    onChange,
    onRequest,
    nested,
    workerPolicy
  });
  return {root, workspace, bridge};
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return {promise, resolve, reject};
}

test('GPT native catalog accepts GPT and rejects Claude unless its gateway is explicitly enabled', () => {
  assert.deepEqual(
    availableWorkerModels(workspaceModels).map(row => row.model),
    ['gpt-6.1-sol']
  );
  assert.deepEqual(
    availableWorkerModels(workspaceModels, {claudeGateway: true}).map(row => row.model),
    ['gpt-6.1-sol', 'claude-opus-5-5']
  );
  assert.doesNotThrow(() => validateWorkerPolicy({model: 'gpt-6.1-sol', effort: 'high'}, workspaceModels));
  assert.throws(() => validateWorkerPolicy({model: 'claude-opus-5-5', effort: 'high'}, workspaceModels), /gateway/);
  assert.doesNotThrow(() =>
    validateWorkerPolicy({model: 'claude-opus-5-5', effort: 'high'}, workspaceModels, {claudeGateway: true})
  );
});

test('Claude request is durably recorded before run, same requestId deduplicates, and wait wakes on completion', async () => {
  const entered = deferred(),
    finish = deferred();
  let runs = 0,
    observed = [];
  const f = await fixture({
    onChange: record => observed.push(record),
    claudeFactory: () => ({
      async run({sessionId}) {
        runs++;
        const saved = JSON.parse(
          await readFile(path.join(f.root, '.runtime', 'luna-bridge', 'parent', 'job.json'), 'utf8')
        );
        assert.equal(saved.provider, 'claude');
        assert.match(saved.threadId, /^[0-9a-f-]{36}$/i);
        assert.equal(sessionId, saved.threadId);
        entered.resolve();
        return finish.promise;
      }
    })
  });
  const start = await f.bridge.start({requestId: 'job', task: 'bounded', model: 'claude-opus-5-5', effort: 'high'});
  assert.equal(start.provider, 'claude');
  await entered.promise;
  const dup = await f.bridge.start({requestId: 'job', task: 'bounded', model: 'claude-opus-5-5', effort: 'high'});
  assert.equal(dup.requestId, 'job');
  assert.equal(runs, 1);
  await assert.rejects(
    f.bridge.start({requestId: 'job', task: 'different', model: 'claude-opus-5-5', effort: 'high'}),
    /拒絕重送/
  );
  const waiting = f.bridge.wait({requestId: 'job', timeoutMs: 2000});
  finish.resolve({status: 'completed', settled: true, output: 'done', outputFiles: [], acceptance: 'not-reviewed'});
  const result = await waiting;
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'done');
  assert.ok(observed.some(record => record.requestId === 'job' && record.settled));
  const persisted = JSON.parse(
    await readFile(path.join(f.root, '.runtime', 'luna-bridge', 'parent', 'job.json'), 'utf8')
  );
  assert.equal(persisted.output, 'done');
  await f.bridge.close();
});

test('Fable delegation uses the existing Claude route with the exact model and effort', async () => {
  for (const model of ['claude-fable-5', 'claude-fable-5-1']) {
    const calls = [];
    const f = await fixture({
      claudeFactory: () => ({
        async run(input) {
          calls.push(input);
          return {status: 'completed', settled: true, output: 'ok', outputFiles: []};
        }
      })
    });
    try {
      await f.bridge.start({requestId: 'fable', task: 'bounded', model, effort: 'high'});
      const result = await f.bridge.wait({requestId: 'fable', timeoutMs: 1000});
      assert.equal(result.status, 'completed');
      assert.equal(result.provider, 'claude');
      assert.equal(result.model, model);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, model);
      assert.equal(calls[0].effort, 'high');
    } finally {
      await f.bridge.close();
    }
  }
});

test('recovered unowned Claude work remains unresolved and is never replayed', async () => {
  let runs = 0;
  const f = await fixture({
    claudeFactory: () => ({
      run: async () => {
        runs++;
        return {status: 'completed', settled: true};
      }
    })
  });
  const directory = path.join(f.root, '.runtime', 'luna-bridge', 'parent');
  await mkdir(directory, {recursive: true});
  await writeFile(
    path.join(directory, 'old.json'),
    JSON.stringify({
      requestId: 'old',
      parentId: 'parent',
      provider: 'claude',
      model: 'claude-opus-5-5',
      effort: 'high',
      status: 'running',
      settled: false,
      task: 'original',
      workspace: f.workspace,
      output: '',
      outputFiles: []
    })
  );
  const record = await f.bridge.inspect({requestId: 'old'});
  assert.equal(record.status, 'unresolved');
  assert.equal(record.executionUnowned, true);
  assert.match(record.error, /未重播/);
  const duplicate = await f.bridge.start({
    requestId: 'old',
    task: 'original',
    model: 'claude-opus-5-5',
    effort: 'high'
  });
  assert.equal(duplicate.executionUnowned, true);
  assert.equal(runs, 0);
});

test('omitted manual effort defaults to null for a no-effort native model', async () => {
  let requested;
  const f = await fixture({
    workerPolicy: {model: 'claude-haiku-4-5-20251001'},
    claudeFactory: () => ({
      async run(input) {
        requested = input;
        return {status: 'completed', settled: true, output: 'ok', outputFiles: [], acceptance: 'not-reviewed'};
      }
    })
  });
  await f.bridge.start({requestId: 'manual-null', task: 'bounded'});
  const result = await f.bridge.wait({requestId: 'manual-null', timeoutMs: 1000});
  assert.equal(result.model, 'claude-haiku-4-5-20251001');
  assert.equal(result.effort, null);
  assert.equal(requested.effort, null);
  await f.bridge.close();
});

test('explicit null effort overrides both auto and a manual high default without substitution', async () => {
  for (const workerPolicy of [
    {model: 'auto', effort: 'auto'},
    {model: 'claude-opus-5-5', effort: 'high'}
  ]) {
    let requested;
    const f = await fixture({
      workerPolicy,
      claudeFactory: () => ({
        async run(input) {
          requested = input;
          return {status: 'completed', settled: true, output: 'ok', outputFiles: []};
        }
      })
    });
    const args = {requestId: 'explicit-null', model: 'claude-haiku-4-5-20251001', effort: null, task: 'bounded'};
    await f.bridge.start(args);
    const result = await f.bridge.wait({requestId: args.requestId, timeoutMs: 1000});
    assert.equal(requested.effort, null);
    assert.equal(result.effort, null);
    assert.equal((await f.bridge.start(args)).effort, null);
    await f.bridge.close();
  }
});

test('approval request is recorded while waiting and cleared after an explicit response', async () => {
  const approval = deferred(),
    entered = deferred(),
    observed = [];
  const f = await fixture({
    onChange: record => observed.push(record),
    onRequest: () => approval.promise,
    claudeFactory: () => ({
      async run({onPermission}) {
        entered.resolve();
        const decision = await onPermission({toolName: 'Write', input: {file_path: 'note.txt'}});
        assert.deepEqual(decision, {behavior: 'allow'});
        return {status: 'completed', settled: true, output: 'ok', outputFiles: [], acceptance: 'not-reviewed'};
      }
    })
  });
  await f.bridge.start({requestId: 'approval', task: 'bounded', model: 'claude-opus-5-5', effort: 'high'});
  await entered.promise;
  const running = await f.bridge.inspect({requestId: 'approval'});
  assert.equal(running.waitingForApproval, 1);
  assert.ok(observed.some(record => record.requestId === 'approval' && record.waitingForApproval === 1));
  approval.resolve({behavior: 'allow'});
  const result = await f.bridge.wait({requestId: 'approval', timeoutMs: 1000});
  assert.equal(result.settled, true);
  assert.equal(result.waitingForApproval, undefined);
  await f.bridge.close();
});

test('cancel confirms settled cancellation; failed close remains unsettled and unknown', async () => {
  let entered = deferred();
  const f = await fixture({
    claudeFactory: () => ({
      run: ({signal}) =>
        new Promise(resolve => {
          entered.resolve();
          signal.addEventListener(
            'abort',
            () =>
              resolve({status: 'cancelled', settled: true, output: '', outputFiles: [], acceptance: 'not-reviewed'}),
            {once: true}
          );
        })
    })
  });
  await f.bridge.start({requestId: 'cancel', task: 'bounded', model: 'claude-opus-5-5', effort: 'high'});
  await entered.promise;
  const result = await f.bridge.cancel({requestId: 'cancel'});
  assert.equal(result.status, 'cancelled');
  assert.equal(result.settled, true);
  entered = deferred();
  const uncertain = await fixture({
    claudeFactory: () => ({
      run: ({signal}) =>
        new Promise((resolve, reject) => {
          entered.resolve();
          signal.addEventListener(
            'abort',
            () => reject(Object.assign(Error('Claude close failed; do not replay'), {settled: false})),
            {once: true}
          );
        })
    })
  });
  await uncertain.bridge.start({requestId: 'uncertain', task: 'bounded', model: 'claude-opus-5-5', effort: 'high'});
  await entered.promise;
  const uncertainResult = await uncertain.bridge.cancel({requestId: 'uncertain'});
  assert.equal(uncertainResult.settled, false);
  assert.equal(uncertainResult.status, 'unresolved');
  assert.match(uncertainResult.error, /do not replay/);
  await assert.rejects(uncertain.bridge.close(), /尚未確認停止/);
});

test('cancel releases an unconfirmed Claude stop only after its root process is gone, never replaying it', async () => {
  for (const rootAlive of [true, false]) {
    // A finished child gives a PID with no live process; this process is certainly alive.
    const pid = rootAlive ? process.pid : spawnSync(process.execPath, ['-e', '']).pid;
    let runs = 0;
    const f = await fixture({
      claudeFactory: () => ({
        run: async ({onStart}) => {
          runs++;
          onStart(pid);
          throw Object.assign(Error('Claude 子代理停止未確認：close failed；不得重播。'), {settled: false});
        }
      })
    });
    await f.bridge.start({requestId: 'claude-stop', task: 'bounded', model: 'claude-opus-5-5', effort: 'high'});
    // A later, separate cancel: wait until the run has fully ended and no longer owns the process.
    while ((await f.bridge.inspect({requestId: 'claude-stop'})).observation?.execution !== 'unconfirmed')
      await new Promise(resolve => setTimeout(resolve, 10));
    const result = await f.bridge.cancel({requestId: 'claude-stop'});
    assert.equal(result.status, 'unresolved');
    assert.equal(result.settled, false);
    assert.equal(runs, 1);
    if (rootAlive) {
      assert.notEqual(result.executionUnowned, true);
      await assert.rejects(f.bridge.close(), /尚未確認停止/);
    } else {
      assert.equal(result.executionUnowned, true);
      assert.match(result.error, /子代理主程序已確認結束/);
      await f.bridge.close();
    }
  }
});

test('when nested is passed, Claude worker gets mcpConfig, updates subWorkers, and closes second layer before settling', async () => {
  let nestedCalledWith = null;
  let subChangeCallback = null;
  let closedCalled = 0;
  let receivedMcp = null,
    receivedInstructions = null;
  const fakeGatewayMcp = {mcpServers: {k_luna: {command: 'test'}}};
  const f = await fixture({
    nested: async options => {
      nestedCalledWith = options;
      subChangeCallback = options.onChange;
      return {
        mcpConfig: fakeGatewayMcp,
        instructions: 'worker catalog',
        async close() {
          closedCalled++;
        }
      };
    },
    claudeFactory: () => ({
      async run(args) {
        receivedMcp = args.mcpConfig;
        receivedInstructions = args.instructions;
        subChangeCallback?.({
          requestId: 'sub-1',
          provider: 'codex',
          model: 'gpt-6.1-sol',
          effort: 'high',
          status: 'running',
          settled: false,
          task: 'do not include this secret task text',
          startedAt: '2026-10-24T00:00:00Z'
        });
        return {status: 'completed', settled: true, output: 'parent done', outputFiles: []};
      }
    })
  });
  try {
    const start = await f.bridge.start({
      requestId: 'parent-job',
      task: 'orchestrate',
      model: 'claude-opus-5-5',
      effort: 'high'
    });
    assert.equal(start.requestId, 'parent-job');
    const result = await f.bridge.wait({requestId: 'parent-job', timeoutMs: 2000});
    assert.equal(result.status, 'completed');
    assert.equal(result.settled, true);
    assert.equal(closedCalled, 1);
    assert.deepEqual(receivedMcp, fakeGatewayMcp);
    assert.equal(receivedInstructions, 'worker catalog');
    assert.equal(nestedCalledWith.requestId, 'parent-job');
    assert.equal(nestedCalledWith.accessMode, 'workspace-write');
    assert.ok(Array.isArray(result.subWorkers));
    assert.equal(result.subWorkers.length, 1);
    assert.equal(result.subWorkers[0].requestId, 'sub-1');
    assert.equal(result.subWorkers[0].model, 'gpt-6.1-sol');
    assert.equal(result.subWorkers[0].task, undefined);
  } finally {
    await f.bridge.close();
  }
});

test('when second-layer close fails, parent worker settles as unresolved with settled false', async () => {
  let closeAttempts = 0;
  const f = await fixture({
    nested: async () => ({
      mcpConfig: {mcpServers: {}},
      async close() {
        if (++closeAttempts === 1) throw new Error('sub-worker stop unconfirmed');
      }
    }),
    claudeFactory: () => ({
      async run() {
        return {status: 'completed', settled: true, output: 'done', outputFiles: []};
      }
    })
  });
  try {
    await f.bridge.start({requestId: 'failing-close', task: 'parent', model: 'claude-opus-5-5', effort: 'high'});
    const result = await f.bridge.wait({requestId: 'failing-close', timeoutMs: 2000});
    assert.equal(result.status, 'unresolved');
    assert.equal(result.settled, false);
    assert.match(result.error, /小工人停止狀態未確認/);
    // A later cancel retries only the second layer's stop and then publishes the worker's own outcome.
    const retried = await f.bridge.cancel({requestId: 'failing-close'});
    assert.equal(closeAttempts, 2);
    assert.equal(retried.status, 'completed');
    assert.equal(retried.settled, true);
    assert.match(retried.error, /重試時確認/);
  } finally {
    await f.bridge.close();
  }
});

test('a Claude worker is not settled until its second layer has closed', async () => {
  const closing = deferred();
  let closeStarted = false;
  const f = await fixture({
    nested: async () => ({
      mcpConfig: {mcpServers: {}},
      async close() {
        closeStarted = true;
        await closing.promise;
      }
    }),
    claudeFactory: () => ({
      run: async () => ({status: 'completed', settled: true, output: 'done', outputFiles: []})
    })
  });
  try {
    await f.bridge.start({requestId: 'slow-close', task: 'parent', model: 'claude-opus-5-5', effort: 'high'});
    for (let i = 0; i < 50 && !closeStarted; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(closeStarted, true);
    const during = await f.bridge.inspect({requestId: 'slow-close'});
    assert.equal(during.settled, false, 'sub-workers are still being stopped');
    closing.resolve();
    const after = await f.bridge.wait({requestId: 'slow-close', timeoutMs: 2000});
    assert.equal(after.status, 'completed');
    assert.equal(after.settled, true);
  } finally {
    await f.bridge.close();
  }
});

test('after a restart an unsettled sub-worker snapshot is shown as unresolved, not running', async () => {
  const root = path.join(scratchBase, 'claude-bridge-tests', randomUUID());
  const workspace = path.join(root, 'workspace');
  const directory = path.join(root, '.runtime', 'luna-bridge', 'parent');
  await mkdir(workspace, {recursive: true});
  await mkdir(directory, {recursive: true});
  await writeFile(
    path.join(directory, 'old-parent.json'),
    JSON.stringify({
      requestId: 'old-parent',
      parentId: 'parent',
      provider: 'claude',
      model: 'claude-opus-5-5',
      status: 'running',
      settled: false,
      task: 'orchestrate',
      workspace,
      subWorkers: [
        {requestId: 'sub-running', model: 'gemini-3.8-flash', status: 'running', settled: false},
        {requestId: 'sub-done', model: 'gemini-3.8-flash', status: 'completed', settled: true}
      ]
    })
  );
  const bridge = await createLunaBridge({root, workspace, parentId: 'parent', geminiOnly: true});
  try {
    const record = await bridge.inspect({requestId: 'old-parent'});
    assert.equal(record.status, 'unresolved');
    assert.deepEqual(
      record.subWorkers.map(sub => sub.status),
      ['unresolved', 'completed']
    );
  } finally {
    await bridge.close();
  }
});
