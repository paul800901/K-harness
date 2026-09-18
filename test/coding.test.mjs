import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, link } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createModelRuntime } from '../src/runtime.mjs';
import { createCodingTools, normalizeCoding, MAX_TEST_OUTPUT_BYTES } from '../src/coding.mjs';
import { MAX_TEXT_BYTES } from '../src/files.mjs';
import { runWorker, readTranscript } from '../src/worker.mjs';

const testRoot = fileURLToPath(new URL('../.runtime/tests/', import.meta.url));
await mkdir(testRoot, { recursive: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No network in offline coding tests.'); };
test.after(() => { globalThis.fetch = originalFetch; });
const broken = 'export const add = (a, b) => a - b;\n';
const fixed = 'export const add = (a, b) => a + b;\n';
const assertions = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './code.mjs';\ntest('addition', () => assert.equal(add(2, 3), 5));\n";

async function fixture({ code = broken, tests = assertions, timeoutMs = 10_000 } = {}) {
  const directory = await mkdtemp(path.join(testRoot, 'coding-'));
  const workspace = path.join(directory, 'workspace');
  const jobDirectory = path.join(directory, 'evidence');
  await mkdir(workspace); await mkdir(jobDirectory);
  await writeFile(path.join(workspace, 'code.mjs'), code, { flag: 'wx' });
  await writeFile(path.join(workspace, 'checks.mjs'), tests, { flag: 'wx' });
  const readFiles = ['code.mjs', 'checks.mjs'];
  const coding = normalizeCoding({ editFiles: ['code.mjs'], testFiles: ['checks.mjs'], timeoutMs }, readFiles, []);
  const tools = await createCodingTools(workspace, coding, readFiles, jobDirectory);
  return { directory, workspace, jobDirectory, readFiles, coding, tools, patch: tools[0], run: tools[1] };
}

test('actual Pi coding loop reproduces failure, edits only approved code, passes fixed tests and retains preimage', async () => {
  const f = await fixture();
  const runtime = await createModelRuntime();
  const faux = fauxProvider({ provider: 'k-code-offline', models: [{ id: 'scripted', reasoning: false }] });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('run_tests', {})),
    (context) => {
      assert.equal(JSON.parse(context.messages.at(-1).content[0].text).status, 'failed');
      return fauxAssistantMessage(fauxToolCall('read_input', { path: 'code.mjs' }));
    },
    fauxAssistantMessage(fauxToolCall('replace_code', { path: 'code.mjs', expectedText: broken, newText: fixed })),
    fauxAssistantMessage(fauxToolCall('run_tests', {})),
    (context) => {
      const result = JSON.parse(context.messages.at(-1).content[0].text);
      assert.equal(result.status, 'passed', result.output);
      return fauxAssistantMessage('程式已修正，指定測試通過，待主代理驗收。');
    },
  ]);
  runtime.registerNativeProvider(faux.provider);
  const options = { task: 'Fix addition.', workspace: f.workspace, readFiles: f.readFiles, coding: f.coding,
    modelRuntime: runtime, model: faux.getModel(), stateDir: path.join(f.directory, 'jobs'), jobId: 'one-code-job' };
  const result = await runWorker(options);
  assert.equal(result.status, 'completed', result.error);
  assert.equal(result.acceptance, 'not-reviewed');
  assert.equal(result.toolCalls, 4); assert.equal(result.toolErrors, 0);
  assert.deepEqual(result.coding, f.coding);
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), fixed);
  assert.equal(await readFile(path.join(f.workspace, 'checks.mjs'), 'utf8'), assertions);
  const [backup] = await readdir(path.join(result.directory, 'edits'));
  assert.equal(await readFile(path.join(result.directory, 'edits', backup, 'before.txt'), 'utf8'), broken);
  assert.equal((await readTranscript(result.directory)).filter((e) => e.type === 'message' && e.message.toolName === 'run_tests').length, 2);
  await assert.rejects(runWorker(options), { code: 'EEXIST' });
  assert.equal(faux.state.callCount, 5);
});

test('edits reject unlisted files, stale preimages, no-ops and oversized code without changing originals', async () => {
  const f = await fixture();
  for (const [args, pattern] of [
    [{ path: 'checks.mjs', expectedText: assertions, newText: '' }, /not authorized/],
    [{ path: '../code.mjs', expectedText: broken, newText: fixed }, /not authorized/],
    [{ path: 'code.mjs', expectedText: 'old content', newText: fixed }, /stale/],
    [{ path: 'code.mjs', expectedText: broken, newText: broken }, /No code change/],
    [{ path: 'code.mjs', expectedText: broken, newText: 'x'.repeat(MAX_TEXT_BYTES + 1) }, /size limit/],
  ]) await assert.rejects(f.patch.execute('test', args), pattern);
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), broken);
  assert.equal(await readFile(path.join(f.workspace, 'checks.mjs'), 'utf8'), assertions);
  assert.deepEqual(await readdir(f.jobDirectory), []);
});

test('UTF-8/CRLF preimages are exact and shortening writes truncate correctly', async () => {
  const before = '// 正體中文\r\nexport const text = "long value";\r\n';
  const after = '// 臺灣\n';
  const f = await fixture({ code: before });
  await assert.rejects(f.patch.execute('test', { path: 'code.mjs', expectedText: before.replaceAll('\r\n', '\n'), newText: after }), /stale/);
  const result = await f.patch.execute('test', { path: 'code.mjs', expectedText: before, newText: after });
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), after);
  assert.equal(await readFile(path.join(f.jobDirectory, result.details.backup, 'before.txt'), 'utf8'), before);
});

test('a unique fragment preserves unmatched text and trailing newline; ambiguous fragments are rejected', async () => {
  const f = await fixture();
  await f.patch.execute('test', { path: 'code.mjs', expectedText: broken.trimEnd(), newText: fixed.trimEnd() });
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), fixed);
  await assert.rejects(f.patch.execute('test', { path: 'code.mjs', expectedText: 'a', newText: 'other' }), /ambiguous/);
  await assert.rejects(f.patch.execute('test', { path: 'code.mjs', expectedText: '', newText: 'other' }), /No code change/);
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), fixed);
});

test('policy rejects missing read grants, editable test aliases and hard links', async () => {
  const f = await fixture();
  assert.throws(() => normalizeCoding(f.coding, ['code.mjs'], []), /approved input/);
  assert.throws(() => normalizeCoding({ ...f.coding, timeoutMs: 0 }, f.readFiles, []), /timeout/);
  assert.throws(() => normalizeCoding({ ...f.coding, testFiles: [] }, f.readFiles, []), /non-empty/);
  const testAlias = process.platform === 'win32' ? 'CHECKS.mjs' : 'checks.mjs';
  await assert.rejects(createCodingTools(f.workspace, { ...f.coding, editFiles: [testAlias] }, [...f.readFiles, testAlias], f.jobDirectory), /read-only/);
  await link(path.join(f.workspace, 'code.mjs'), path.join(f.directory, 'hardlink.mjs'));
  await assert.rejects(createCodingTools(f.workspace, f.coding, f.readFiles, f.jobDirectory), /hard-linked/);
});

test('fixed test process excludes inherited secrets/options and denies ordinary outside reads, writes and child spawning', async () => {
  const f = await fixture({ code: fixed, tests: `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
test('execution guardrails', () => {
  assert.equal(process.env.K_TEST_SECRET, undefined);
  assert.equal(process.env.NODE_OPTIONS, undefined);
  assert.throws(() => readFileSync('../outside.txt'), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => writeFileSync('code.mjs', 'overwrite'), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => spawnSync(process.execPath, ['--version']), { code: 'ERR_ACCESS_DENIED' });
});
` });
  await writeFile(path.join(f.directory, 'outside.txt'), 'outside marker', { flag: 'wx' });
  const previousSecret = process.env.K_TEST_SECRET;
  const previousOptions = process.env.NODE_OPTIONS;
  process.env.K_TEST_SECRET = 'synthetic-secret-never-forward';
  process.env.NODE_OPTIONS = '--invalid-inherited-option';
  try {
    const result = await f.run.execute('test', {});
    assert.equal(result.details.status, 'passed', result.details.output);
    assert.ok(!result.details.output.includes(process.env.K_TEST_SECRET));
    assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), fixed);
    await assert.rejects(f.run.execute('test', { command: 'anything' }), /no model-selectable/);
  } finally {
    if (previousSecret === undefined) delete process.env.K_TEST_SECRET; else process.env.K_TEST_SECRET = previousSecret;
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousOptions;
  }
});

for (const mode of ['timeout', 'cancelled', 'output-limit']) {
  test(`fixed test process terminates on ${mode} and saves its actual result`, async () => {
    const f = await fixture({ timeoutMs: mode === 'timeout' ? 300 : 5000,
      tests: mode === 'output-limit' ? "process.stdout.write('x'.repeat(100000));\n" : 'while (true) {}\n' });
    const controller = new AbortController();
    const timer = mode === 'cancelled' ? setTimeout(() => controller.abort(), 300) : null;
    try {
      const result = await f.run.execute('test', {}, controller.signal);
      assert.equal(result.details.status, mode);
      assert.ok(Buffer.byteLength(result.details.output) <= MAX_TEST_OUTPUT_BYTES);
      const saved = JSON.parse(await readFile(path.join(f.jobDirectory, result.details.evidence, 'result.json'), 'utf8'));
      assert.equal(saved.status, mode);
      assert.equal(saved.exitCode, result.details.exitCode);
    } finally { clearTimeout(timer); }
  });
}

test('cancellation before a patch leaves code unchanged and creates no backup', async () => {
  const f = await fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.patch.execute('test', { path: 'code.mjs', expectedText: broken, newText: fixed }, controller.signal), { name: 'AbortError' });
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), broken);
  assert.deepEqual(await readdir(f.jobDirectory), []);
});
