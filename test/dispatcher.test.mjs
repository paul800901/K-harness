import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createModelRuntime } from '../src/runtime.mjs';
import { createDispatcher } from '../src/dispatcher.mjs';
import { createFileTools } from '../src/files.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(project, '.runtime', 'tests');
await mkdir(testRoot, { recursive: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No network in offline tests.'); };
test.after(() => { globalThis.fetch = originalFetch; });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t, responses) {
  const directory = await mkdtemp(path.join(testRoot, 'dispatch-'));
  const workspace = path.join(directory, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'input.txt'), '原文不可變更。', { flag: 'wx' });
  const modelRuntime = await createModelRuntime();
  const faux = fauxProvider({ provider: 'k-dispatch-test', models: [{ id: 'scripted', reasoning: false }] });
  faux.setResponses(responses ?? [fauxAssistantMessage('離線完成。')]);
  modelRuntime.registerNativeProvider(faux.provider);
  const config = { workspace, modelRuntime, model: faux.getModel(), stateDir: path.join(directory, 'jobs') };
  const host = await createDispatcher(config);
  t.after(() => host.close());
  return { host, config, faux, workspace, request: { requestId: 'request-1', task: '測試工作。', readFiles: ['input.txt'], outputFiles: ['output.txt'] } };
}

test('history grants cannot be added to an existing request ID', async (t) => {
  const f = await fixture(t);
  await f.host.start(f.request); await f.host.wait(f.request.requestId);
  await assert.rejects(() => f.host.start({ ...f.request, historyIds: ['other'] }), /different request/);
});

test('dispatch returns before completion; concurrent duplicate starts run once; wait wakes on completion', async (t) => {
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, [async () => { entered.resolve(); await release.promise; return fauxAssistantMessage('完成。'); }]);
  const starts = await Promise.all([f.host.start(f.request), f.host.start(f.request)]);
  assert.equal(starts[0].directory, starts[1].directory);
  assert.equal(starts[0].status, 'running');
  await entered.promise;
  const timeout = await f.host.wait(f.request.requestId, { timeoutMs: 5 });
  assert.equal(timeout.status, 'running');
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.cancelRequested, false);
  assert.equal(f.faux.state.callCount, 1);
  const waits = [f.host.wait(f.request.requestId), f.host.wait(f.request.requestId)];
  release.resolve();
  for (const result of await Promise.all(waits)) {
    assert.equal(result.status, 'completed');
    assert.equal(result.timedOut, false);
    assert.equal(result.acceptance, 'not-reviewed');
    assert.equal(result.output, '完成。');
  }
  assert.equal((await f.host.start(f.request)).status, 'completed');
  assert.equal(f.faux.state.callCount, 1);
});

test('cancellation after output preserves the file and returns a terminal cancellation', async (t) => {
  const entered = deferred();
  const f = await fixture(t, [
    fauxAssistantMessage(fauxToolCall('write_output', { path: 'output.txt', text: '取消前已寫入。' })),
    async (_context, options) => {
      entered.resolve();
      await new Promise((resolve) => {
        if (options.signal.aborted) resolve();
        else options.signal.addEventListener('abort', resolve, { once: true });
      });
      return fauxAssistantMessage('', { stopReason: 'aborted' });
    },
  ]);
  await f.host.start(f.request);
  await entered.promise;
  assert.equal((await f.host.cancel(f.request.requestId)).cancelRequested, true);
  const result = await f.host.wait(f.request.requestId);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.output, '');
  assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), '取消前已寫入。');
  assert.equal((await f.host.cancel(f.request.requestId)).status, 'cancelled');
  assert.equal(f.faux.state.callCount, 2);
});

test('aborting the wait does not cancel its worker', async (t) => {
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, [async () => { entered.resolve(); await release.promise; return fauxAssistantMessage('完成。'); }]);
  await f.host.start(f.request);
  await entered.promise;
  const controller = new AbortController();
  const waiting = f.host.wait(f.request.requestId, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal((await f.host.inspect(f.request.requestId)).cancelRequested, false);
  release.resolve();
  assert.equal((await f.host.wait(f.request.requestId)).status, 'completed');
});

test('a fresh host reads completed IDs without rerunning or rejecting their existing outputs', async (t) => {
  const f = await fixture(t, [
    fauxAssistantMessage(fauxToolCall('write_output', { path: 'output.txt', text: '既有成果。' })),
    fauxAssistantMessage('完成。'),
  ]);
  await f.host.start(f.request);
  await f.host.wait(f.request.requestId);
  await f.host.close();
  const restored = await createDispatcher(f.config);
  t.after(() => restored.close());
  assert.equal((await restored.start(f.request)).status, 'completed');
  assert.equal(f.faux.state.callCount, 2);
  await assert.rejects(restored.start({ ...f.request, task: '不同工作' }), /different request/u);
  assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), '既有成果。');
});

test('a different host does not adopt, cancel or replay an unresolved persisted ID', async (t) => {
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, [async () => { entered.resolve(); await release.promise; return fauxAssistantMessage('完成。'); }]);
  await f.host.start(f.request);
  await entered.promise;
  const other = await createDispatcher(f.config);
  t.after(() => other.close());
  assert.equal((await other.start(f.request)).status, 'unresolved');
  assert.equal((await other.wait(f.request.requestId)).status, 'unresolved');
  assert.equal((await other.cancel(f.request.requestId)).cancelRequested, false);
  assert.equal(f.faux.state.callCount, 1);
  release.resolve();
  await f.host.wait(f.request.requestId);
  assert.equal((await other.inspect(f.request.requestId)).status, 'completed');
});

test('conflicting persisted IDs and empty reservations never invoke a model', async (t) => {
  const f = await fixture(t);
  await f.host.start(f.request);
  await f.host.wait(f.request.requestId);
  const other = await createDispatcher(f.config);
  t.after(() => other.close());
  const conflict = { ...f.request, task: '另一份任務' };
  await assert.rejects(other.start(conflict), /different request/u);
  await assert.rejects(other.start(conflict), /different request/u);
  assert.equal((await other.inspect(f.request.requestId)).status, 'completed');
  assert.equal((await other.start(f.request)).status, 'completed');
  await mkdir(path.join(f.config.stateDir, 'reserved'));
  assert.equal((await other.start({ ...f.request, requestId: 'reserved' })).status, 'unresolved');
  assert.equal(f.faux.state.callCount, 1);
});

test('invalid IDs, unauthorized files, provider failures and closed dispatchers do not retry', async (t) => {
  const f = await fixture(t, [fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Simulated error' })]);
  await assert.rejects(f.host.start({ ...f.request, requestId: '../outside' }), /jobId/u);
  await assert.rejects(f.host.wait('unknown', { timeoutMs: -1 }), /timeoutMs/u);
  await assert.rejects(f.host.inspect('unknown'), /Unknown/u);
  const denied = { ...f.request, requestId: 'denied', readFiles: ['../private.txt'] };
  assert.equal((await f.host.start(denied)).status, 'failed');
  assert.equal((await f.host.start(denied)).status, 'failed');
  assert.equal(f.faux.state.callCount, 0);
  await f.host.start(f.request);
  assert.equal((await f.host.wait(f.request.requestId)).status, 'failed');
  assert.equal((await f.host.start(f.request)).status, 'failed');
  assert.equal(f.faux.state.callCount, 1);
  await f.host.close();
  await assert.rejects(f.host.start({ ...f.request, requestId: 'another' }), /closing/u);
});

test('the project credential cannot be delegated as an input or output', async () => {
  await assert.rejects(createFileTools(project, ['.env.local']), /credential file/u);
  await assert.rejects(createFileTools(project, [], ['.env.local']), /credential file/u);
});

async function codingRequest(f) {
  await writeFile(path.join(f.workspace, 'code.mjs'), 'export const value = 1;\n', { flag: 'wx' });
  await writeFile(path.join(f.workspace, 'checks.mjs'), "import assert from 'node:assert/strict'; import { value } from './code.mjs'; assert.equal(value, 1);\n", { flag: 'wx' });
  return { requestId: 'code-request', task: 'Only check the approved code.', readFiles: ['code.mjs', 'checks.mjs'],
    coding: { editFiles: ['code.mjs'] } };
}

test('coding grants survive dispatch/restart, are part of request identity, and never expand an old file job', async (t) => {
  const f = await fixture(t);
  const request = await codingRequest(f);
  await f.host.start(request);
  const result = await f.host.wait(request.requestId);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.coding, request.coding);
  await assert.rejects(f.host.start({ ...request, coding: { editFiles: ['checks.mjs'] } }), /different request/);
  await assert.rejects(f.host.start({ ...request, coding: undefined }), /different request/);
  await f.host.close();
  const restored = await createDispatcher(f.config);
  t.after(() => restored.close());
  await assert.rejects(restored.start({ ...request, coding: { editFiles: ['checks.mjs'] } }), /different request/);
  assert.equal((await restored.start({ ...request, coding: request.coding })).status, 'completed');
  assert.equal(f.faux.state.callCount, 1);
  await restored.start(f.request); await restored.wait(f.request.requestId);
  await assert.rejects(restored.start({ ...f.request, coding: { editFiles: ['checks.mjs'] } }), /approved input/);
  await assert.rejects(restored.start({ ...request, requestId: f.request.requestId }), /different request/);
});

test('old test-runner grants stay readable but the same ID cannot be adopted or replayed',async t=>{
 const f=await fixture(t),request=await codingRequest(f);await f.host.start(request);await f.host.wait(request.requestId);await f.host.close();
 const file=path.join(f.config.stateDir,request.requestId,'job.json'),record=JSON.parse(await readFile(file,'utf8'));
 record.coding={...record.coding,testFiles:['checks.mjs'],timeoutMs:1000};const before=JSON.stringify(record);await writeFile(file,before);
 const restored=await createDispatcher(f.config);t.after(()=>restored.close());
 assert.deepEqual((await restored.inspect(request.requestId)).coding,record.coding);
 await assert.rejects(restored.start(request),/different request/);assert.equal(f.faux.state.callCount,1);assert.equal(await readFile(file,'utf8'),before);
});

test('active coding files reject overlapping reads/writes but independent work and same-ID inspection remain available', async (t) => {
  const entered = deferred(); const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, [async () => { entered.resolve(); await release.promise; return fauxAssistantMessage('完成。'); }, fauxAssistantMessage('獨立工作完成。'), fauxAssistantMessage('讀取工作完成。')]);
  const request = await codingRequest(f);
  await f.host.start(request); await entered.promise;
  assert.equal((await f.host.start(request)).status, 'running');
  const alias = process.platform === 'win32' ? 'CODE.mjs' : 'code.mjs';
  const overlap = { requestId: 'overlap', task: 'Read code.', readFiles: [alias] };
  await assert.rejects(f.host.start(overlap), /overlapping file access/);
  await assert.rejects(f.host.start({ ...request, requestId: 'other-code' }), /overlapping file access/);
  await assert.rejects(f.host.inspect(overlap.requestId), /Unknown/);
  await f.host.start(f.request);
  assert.equal((await f.host.wait(f.request.requestId)).status, 'completed');
  release.resolve(); await f.host.wait(request.requestId);
  await f.host.start(overlap);
  assert.equal((await f.host.wait(overlap.requestId)).status, 'completed');
});

test('coding cannot start while an existing document task reads its editable file', async (t) => {
  const entered = deferred(); const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, [async () => { entered.resolve(); await release.promise; return fauxAssistantMessage('完成。'); }]);
  const request = await codingRequest(f);
  await f.host.start({ requestId: 'reader', task: 'Read code.', readFiles: ['code.mjs'] });
  await entered.promise;
  await assert.rejects(f.host.start(request), /overlapping file access/);
  release.resolve(); await f.host.wait('reader');
});
