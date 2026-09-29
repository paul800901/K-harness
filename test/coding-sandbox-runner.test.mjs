import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createModelRuntime } from '../src/runtime.mjs';
import { createDispatcher } from '../src/dispatcher.mjs';
import { createCodingTools, normalizeCoding } from '../src/coding.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(root, '.runtime', 'tests');

function fakeChild({ terminate = async () => ({ confirmed: true }), close = true } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.terminate = terminate;
  if (close) queueMicrotask(() => {
    child.stdout.end('TAP version 13\n'); child.stderr.end(); child.emit('close', 0, null);
  });
  return child;
}

async function fixture({ timeoutMs = 100 } = {}) {
  const directory = await mkdtemp(path.join(testRoot, 'sandbox-coding-'));
  const workspace = path.join(directory, 'workspace'); const jobDirectory = path.join(directory, 'job');
  await mkdir(workspace); await mkdir(jobDirectory);
  await writeFile(path.join(workspace, 'code.mjs'), 'export const value = 1;\n');
  await writeFile(path.join(workspace, 'checks.mjs'), 'assert.ok(true);\n');
  const readFiles = ['code.mjs', 'checks.mjs'];
  const policy = normalizeCoding({ editFiles: ['code.mjs'], testFiles: ['checks.mjs'], timeoutMs }, readFiles, []);
  const tools = await createCodingTools(workspace, policy, readFiles, jobDirectory);
  return { directory, workspace, jobDirectory, policy, readFiles, run: tools[1] };
}

test('run_tests fails closed without an injected isolated runner', async () => {
  const f = await fixture();
  const result = await f.run.execute('id', {}, undefined);
  assert.equal(result.details.status, 'runner-not-configured');
  assert.match(result.details.output, /host execution is disabled/u);
});

test('run_tests invokes only the injected runner and strips credentials from its child env', async () => {
  const f = await fixture();
  let invocation;
  const runner = {
    env: { SystemRoot: 'C:\\Windows', DEEPSEEK_API_KEY: 'must-not-pass', SESSION_TOKEN: 'also-no' },
    spawnImpl(command, args, options) {
      invocation = { command, args, options };
      return fakeChild();
    },
  };
  const tools = await createCodingTools(f.workspace, f.policy, f.readFiles, f.jobDirectory, runner);
  const result = await tools[1].execute('id', {}, undefined);
  assert.equal(result.details.status, 'passed');
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.options.env, { SystemRoot: 'C:\\Windows' });
  assert.equal(invocation.options.shell, false);
  assert.ok(invocation.args.includes('--permission'));
  assert.ok(invocation.args.some((arg) => arg.startsWith('file:')));
});

test('an unconfirmed isolated stop is reported promptly as failure, never passed', async () => {
  const f = await fixture({ timeoutMs: 100 });
  const runner = {
    env: {},
    spawnImpl() { return fakeChild({ close: false, terminate: async () => { throw new Error('box stop failed'); } }); },
  };
  const tools = await createCodingTools(f.workspace, f.policy, f.readFiles, f.jobDirectory, runner);
  const started = Date.now();
  const result = await tools[1].execute('id', {}, undefined);
  assert.equal(result.details.status, 'termination-unconfirmed');
  assert.equal(result.details.exitCode, null);
  assert.ok(Date.now() - started < 1000, 'stop failure should not wait for a second timeout');
});

test('dispatcher passes its explicit runner through the Pi worker to run_tests', async (t) => {
  const f = await fixture();
  let calls = 0;
  const modelRuntime = await createModelRuntime();
  const faux = fauxProvider({ provider: 'k-runner-injection-test', models: [{ id: 'scripted', reasoning: false }] });
  faux.setResponses([fauxAssistantMessage(fauxToolCall('run_tests', {})), fauxAssistantMessage('測試已執行。')]);
  modelRuntime.registerNativeProvider(faux.provider);
  const testRunner = { env: {}, spawnImpl() { calls += 1; return fakeChild(); } };
  const dispatcher = await createDispatcher({ workspace: f.workspace, modelRuntime, model: faux.getModel(),
    stateDir: path.join(f.directory, 'jobs'), testRunner });
  t.after(() => dispatcher.close());
  const request = { requestId: 'runner-wire', task: 'Run fixed checks.', readFiles: f.readFiles, coding: f.policy };
  await dispatcher.start(request);
  const result = await dispatcher.wait(request.requestId);
  assert.equal(result.status, 'completed', result.error);
  assert.equal(calls, 1, 'the runner injected into the dispatcher should handle the model-requested test run');
});
