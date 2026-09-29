import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createModelRuntime } from '../src/runtime.mjs';
import { createFileTools, MAX_TEXT_BYTES } from '../src/files.mjs';
import { runWorker, inspectJob, readTranscript } from '../src/worker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(root, '.runtime', 'tests');
await mkdir(testRoot, { recursive: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network calls are forbidden in offline tests.'); };
test.after(() => { globalThis.fetch = originalFetch; });

async function fixture(responses = [fauxAssistantMessage('離線完成。')]) {
  const directory = await mkdtemp(path.join(testRoot, 'case-'));
  const workspace = path.join(directory, 'workspace');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'input.txt'), '原始資料，不可變更。\n', { flag: 'wx' });
  const modelRuntime = await createModelRuntime();
  const faux = fauxProvider({ provider: 'k-test', models: [{ id: 'scripted-test', reasoning: false }] });
  faux.setResponses(responses);
  modelRuntime.registerNativeProvider(faux.provider);
  return {
    directory, workspace, faux,
    options: {
      task: '僅執行測試指定的工作。', workspace, readFiles: ['input.txt'], outputFiles: ['output.txt'],
      stateDir: path.join(directory, 'jobs'), modelRuntime, model: faux.getModel(),
    },
  };
}

test('real Pi loop reads, writes, returns a result, and restores its transcript', async () => {
  const f = await fixture([
    fauxAssistantMessage(fauxToolCall('read_input', { path: 'input.txt' })),
    (context) => {
      assert.deepEqual(context.tools.map((tool) => tool.name).sort(), ['read_input', 'write_output']);
      const input = context.messages.findLast((message) => message.role === 'toolResult');
      assert.equal(input.content[0].text, '原始資料，不可變更。\n');
      return fauxAssistantMessage(fauxToolCall('write_output', { path: 'output.txt', text: '整理完成。\n' }));
    },
    fauxAssistantMessage('已建立 output.txt，原文未變更。'),
  ]);
  const events = [];
  const result = await runWorker({ ...f.options, onEvent: (event) => events.push(event.type) });
  assert.equal(result.status, 'completed');
  assert.equal(result.toolCalls, 2);
  assert.equal(result.modelTurns, 3);
  assert.equal(result.toolErrors, 0);
  assert.equal(f.faux.state.callCount, 3);
  assert.equal(await readFile(path.join(f.workspace, 'input.txt'), 'utf8'), '原始資料，不可變更。\n');
  assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), '整理完成。\n');
  assert.ok(events.includes('job_started') && events.includes('job_finished'));
  assert.deepEqual(await inspectJob(result.directory), result);
  const transcript = await readTranscript(result.directory);
  assert.equal(transcript.filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult').length, 2);
  const restored = SessionManager.open(path.join(result.directory, result.sessionFile)).buildSessionContext();
  assert.ok(restored.messages.some((message) => message.role === 'assistant' && message.content.some((block) => block.text === result.output)));
});

test('unlisted tools and paths cannot gain additional file access', async () => {
  const f = await fixture([
    fauxAssistantMessage(fauxToolCall('read_input', { path: '../private.txt' })),
    fauxAssistantMessage(fauxToolCall('bash', { command: 'echo should-not-run' })),
    fauxAssistantMessage('權限不足，未完成要求。'),
  ]);
  const result = await runWorker(f.options);
  assert.equal(result.toolErrors, 2);
  assert.equal(await readFile(path.join(f.workspace, 'input.txt'), 'utf8'), '原始資料，不可變更。\n');
  await assert.rejects(readFile(path.join(f.workspace, 'output.txt')), { code: 'ENOENT' });
});

test('existing output is rejected before the model is invoked', async () => {
  const f = await fixture();
  await writeFile(path.join(f.workspace, 'output.txt'), '使用者原有成果');
  await assert.rejects(runWorker(f.options), /never overwrites/u);
  assert.equal(f.faux.state.callCount, 0);
  assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), '使用者原有成果');
});

test('repeated writes cannot overwrite the first successful output', async () => {
  const f = await fixture([
    fauxAssistantMessage(fauxToolCall('write_output', { path: 'output.txt', text: '第一次' })),
    fauxAssistantMessage(fauxToolCall('write_output', { path: 'output.txt', text: '第二次' })),
    fauxAssistantMessage('第二次寫入被拒絕。'),
  ]);
  const result = await runWorker(f.options);
  assert.equal(result.toolErrors, 1);
  assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), '第一次');
});

test('path traversal, junctions, and oversized inputs are rejected', async () => {
  const f = await fixture();
  await assert.rejects(createFileTools(f.workspace, ['../private.txt']), /dot segments/u);
  await assert.rejects(createFileTools(f.workspace, [path.join(f.workspace, 'input.txt')]), /workspace-relative/u);
  const outside = path.join(f.directory, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'outside');
  await symlink(outside, path.join(f.workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createFileTools(f.workspace, ['escape/secret.txt']), /junctions/u);
  await writeFile(path.join(f.workspace, 'big.txt'), Buffer.alloc(MAX_TEXT_BYTES + 1));
  const { tools } = await createFileTools(f.workspace, ['big.txt']);
  await assert.rejects(tools[0].execute('test', { path: 'big.txt' }), /size limit/u);
});

test('cancellation before setup does not invoke the model', async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runWorker({ ...f.options, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.faux.state.callCount, 0);
});

test('cancellation during generation settles and saves a cancelled record', async () => {
  const controller = new AbortController();
  const f = await fixture([
    async (_context, options) => {
      setTimeout(() => controller.abort(), 20);
      await new Promise((resolve) => {
        if (options.signal.aborted) resolve();
        else options.signal.addEventListener('abort', resolve, { once: true });
      });
      return fauxAssistantMessage('未完成的回答', { stopReason: 'aborted' });
    },
  ]);
  const result = await runWorker({ ...f.options, signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.output, '');
  assert.equal((await inspectJob(result.directory)).status, 'cancelled');
  assert.equal(f.faux.state.callCount, 1);
});

test('provider failure is not retried or reported as success', async () => {
  const f = await fixture([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Simulated failure' })]);
  const result = await runWorker(f.options);
  assert.equal(result.status, 'failed');
  assert.equal(result.output, '');
  assert.equal(f.faux.state.callCount, 1);
});

test('observer errors do not abandon the run', async () => {
  const f = await fixture();
  const result = await runWorker({ ...f.options, onEvent: () => { throw new Error('UI failed'); } });
  assert.equal(result.status, 'completed');
  assert.ok(result.observerErrorCount > 0);
  assert.equal((await inspectJob(result.directory)).status, 'completed');
});

test('provider failure reason survives job persistence without replay',async()=>{
 const f=await fixture([()=>{throw new Error('429 Rate limit reached (offline fixture)');}]);
 const result=await runWorker(f.options);
 assert.equal(result.status,'failed');
 assert.match(result.error,/429 Rate limit reached/);
 assert.equal((await inspectJob(result.directory)).error,result.error);
 assert.equal(f.faux.state.callCount,1);
});

test('unfinished persisted jobs remain unresolved and are never replayed by inspection', async () => {
  const f = await fixture();
  await writeFile(path.join(f.directory, 'job.json'), JSON.stringify({ version: 1, status: 'running', task: 'pending', sessionFile: null }));
  const result = await inspectJob(f.directory);
  assert.equal(result.status, 'unresolved');
  assert.deepEqual(await readTranscript(f.directory), []);
  assert.equal(f.faux.state.callCount, 0);
});

test('workspace extensions and context files are not automatically loaded', async () => {
  const f = await fixture([(context) => {
    assert.ok(!context.systemPrompt.includes('UNTRUSTED_CONTEXT_MARKER'));
    return fauxAssistantMessage('Only the assigned task.');
  }]);
  await writeFile(path.join(f.workspace, 'AGENTS.md'), 'UNTRUSTED_CONTEXT_MARKER');
  await mkdir(path.join(f.workspace, '.pi', 'extensions'), { recursive: true });
  await writeFile(path.join(f.workspace, '.pi', 'extensions', 'untrusted.mjs'), 'throw new Error("Extension should not load");');
  assert.equal((await runWorker(f.options)).status, 'completed');
});

test('CLI refuses live execution without the explicit flag, before reading credentials', () => {
  const result = spawnSync(process.execPath, ['src/cli.mjs', 'run', 'missing.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /require.*--live/u);
});

for (const mode of ['before-first', 'after-write']) {
  test(`a real process exit ${mode} preserves an unresolved task without replay`, async () => {
    const f = await fixture();
    const result = spawnSync(process.execPath, ['test/fixtures/crash-worker.mjs', f.workspace, f.options.stateDir, mode], {
      cwd: root, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 23, result.stderr);
    const jobs = await readdir(f.options.stateDir);
    assert.equal(jobs.length, 1);
    const directory = path.join(f.options.stateDir, jobs[0]);
    const record = await inspectJob(directory);
    assert.equal(record.status, 'unresolved');
    assert.equal(record.task, 'Crash recovery test.');
    const transcript = await readTranscript(directory);
    if (mode === 'before-first') {
      assert.deepEqual(transcript, []);
      await assert.rejects(readFile(path.join(f.workspace, 'output.txt')), { code: 'ENOENT' });
    } else {
      assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), '程序中斷前已寫入。');
      assert.ok(transcript.some((entry) => entry.type === 'message' && entry.message.role === 'toolResult'));
    }
    const inspected = spawnSync(process.execPath, ['src/cli.mjs', 'inspect', directory], { cwd: root, encoding: 'utf8' });
    assert.equal(inspected.status, 1);
    assert.equal(JSON.parse(inspected.stdout).status, 'unresolved');
  });
}
