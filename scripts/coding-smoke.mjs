import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createDeepSeekRuntime } from '../src/runtime.mjs';
import { runWorker, readTranscript } from '../src/worker.mjs';
import { createCodingTools, normalizeCoding } from '../src/coding.mjs';

const broken = `export function summarize(rows) {
  const done = rows.filter(row => row.status === 'done');
  return {
    count: new Set(done.map(row => row.minutes)).size,
    total: done.reduce((sum, row) => sum + row.minutes, 1),
    ids: done.map(row => row.id).sort(),
    unknownOwnerIds: done.filter(row => !row.owner).map(row => row.id),
  };
}
`;
const tests = `import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './summary.mjs';
test('duplicates remain distinct', () => {
  const result = summarize([{ id: 'B', minutes: 12, status: 'done', owner: 'X' }, { id: 'A', minutes: 12, status: 'done', owner: null }]);
  assert.equal(result.count, 2); assert.equal(result.total, 24);
});
test('input order, pending exclusion and unknown owner', () => {
  assert.deepEqual(summarize([{ id: 'Z', minutes: 0, status: 'done', owner: '' }, { id: 'X', minutes: 4, status: 'pending', owner: null }, { id: 'A', minutes: 3, status: 'done', owner: null }]),
    { count: 2, total: 3, ids: ['Z', 'A'], unknownOwnerIds: ['A'] });
});
test('empty input', () => assert.deepEqual(summarize([]), { count: 0, total: 0, ids: [], unknownOwnerIds: [] }));
test('no input mutation', () => {
  const rows = Object.freeze([Object.freeze({ id: 'Z', minutes: 5, status: 'done', owner: null }), Object.freeze({ id: 'A', minutes: 2, status: 'done', owner: 'X' })]);
  assert.deepEqual(summarize(rows), { count: 2, total: 7, ids: ['Z', 'A'], unknownOwnerIds: ['Z'] });
});
`;

async function main() {
  const { values } = parseArgs({ options: { live: { type: 'boolean' }, 'key-file': { type: 'string' } } });
  if (!values.live || !values['key-file']) throw new Error('Requires --live and an explicit --key-file.');
  const apiKey = parseEnv((await readFile(path.resolve(values['key-file']), 'utf8')).replace(/^\uFEFF/u, '')).DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error('The explicit key source is empty.');
  const base = fileURLToPath(new URL('../.runtime/coding-tests/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'live-'));
  const workspace = path.join(directory, 'workspace');
  const parentEvidence = path.join(directory, 'parent-evidence');
  await mkdir(workspace); await mkdir(parentEvidence);
  await writeFile(path.join(workspace, 'summary.mjs'), broken, { flag: 'wx' });
  await writeFile(path.join(workspace, 'checks.mjs'), tests, { flag: 'wx' });
  const readFiles = ['summary.mjs', 'checks.mjs'];
  const coding = normalizeCoding({ editFiles: ['summary.mjs'], testFiles: ['checks.mjs'] }, readFiles, []);
  const parentTools = await createCodingTools(workspace, coding, readFiles, parentEvidence);
  const baseline = (await parentTools[1].execute('baseline', {})).details;
  assert.equal(baseline.status, 'failed');
  const report = { directory, workspace, startedAt: new Date().toISOString(), requestedModel: 'deepseek-v4-flash',
    entrypoint: 'runWorker; existing App MCP coding permissions remain disabled', requests: 0,
    scope: 'One synthetic JavaScript repair; existing source and fixed tests only. No clinical or business data.',
    baseline, checks: {}, accepted: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
    if (url.origin !== 'https://api.deepseek.com' || url.pathname !== '/chat/completions' || report.requests >= 12) {
      throw new Error('Only twelve official DeepSeek completion requests are allowed.');
    }
    report.requests += 1;
    return originalFetch(resource, { ...options, redirect: 'error',
      signal: options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal });
  };
  try {
    const runtime = await createDeepSeekRuntime(report.requestedModel, apiKey);
    const result = await runWorker({ workspace, readFiles, coding, ...runtime, signal: controller.signal,
      task: [
        '這是獨立的人工 JavaScript 修復案例。先讀兩個批准檔案並執行一次 run_tests 重現失敗，再用 replace_code 修復 summary.mjs，最後再跑測試。',
        'summarize(rows) 僅納入 status 嚴格等於 done 的列；count 為列數，重複分鐘仍是不同列；total 從 0 加總 minutes（有限非負數字）。',
        'ids 和 unknownOwnerIds 都保持輸入顺序；unknownOwnerIds 只收 owner 嚴格等於 null，不把空字串算成 null。空輸入各陣列為空、數字為 0。不可修改輸入 rows 或 row 物件。',
        '只改 summary.mjs；不得改測試、加入外部依賴、用網路、另啟程序或繞過權限。不要硬編碼測試資料。只做滿足需求的最小修正。',
        '最後簡短回報根因、實際測試結果及未完成事項。',
      ].join('\n'),
      onEvent(event) { if (event.type === 'job_started') { report.jobDirectory = event.directory; process.stdout.write(`Coding job: ${event.directory}\n`); } },
    });
    report.worker = { status: result.status, startedAt: result.startedAt, finishedAt: result.finishedAt, thinkingLevel: result.thinkingLevel,
      modelTurns: result.modelTurns, toolCalls: result.toolCalls, toolErrors: result.toolErrors, output: result.output };
    const transcript = await readTranscript(result.directory);
    const toolResults = transcript.filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult').map((entry) => entry.message);
    const testResults = toolResults.filter((message) => message.toolName === 'run_tests' && !message.isError).map((message) => JSON.parse(message.content[0].text));
    report.checks.completed = result.status === 'completed';
    report.checks.failureThenPass = testResults[0]?.status === 'failed' && testResults.at(-1)?.status === 'passed';
    report.checks.actualEdit = toolResults.some((message) => message.toolName === 'replace_code' && !message.isError);
    report.checks.testsUnchanged = await readFile(path.join(workspace, 'checks.mjs'), 'utf8') === tests;
    report.checks.onlyExpectedFiles = JSON.stringify((await readdir(workspace)).sort()) === JSON.stringify(['checks.mjs', 'summary.mjs']);
    report.checks.noCredentialInEvidence = !JSON.stringify({ result, transcript }).includes(apiKey);
    // Recoverable tool errors are reported in worker.toolErrors, not confused
    // with a failed final artifact. Parent review remains required.
    // Independent rerun, with the same fixed runner and a separate durable record.
    report.parentRerun = (await parentTools[1].execute('acceptance', {})).details;
    report.checks.parentRerunPassed = report.parentRerun.status === 'passed';
    // Additional checks are appended to a NEW trusted test input, never imported
    // into this credential-holding parent process.
    const extra = tests + `\ntest('additional parent cases', () => {
      assert.deepEqual(summarize([{ id: 'same', minutes: 0.5, status: 'done', owner: null }, { id: 'same', minutes: 0.5, status: 'done', owner: null }]),
        { count: 2, total: 1, ids: ['same', 'same'], unknownOwnerIds: ['same', 'same'] });
      assert.deepEqual(summarize([{ id: 'ignored', minutes: 999, status: 'pending', owner: null }]), { count: 0, total: 0, ids: [], unknownOwnerIds: [] });
    });\n`;
    await writeFile(path.join(workspace, 'parent-checks.mjs'), extra, { flag: 'wx' });
    const extraReads = ['summary.mjs', 'parent-checks.mjs'];
    const extraPolicy = normalizeCoding({ editFiles: ['summary.mjs'], testFiles: ['parent-checks.mjs'] }, extraReads, []);
    const extraTools = await createCodingTools(workspace, extraPolicy, extraReads, parentEvidence);
    report.parentExtra = (await extraTools[1].execute('additional', {})).details;
    report.checks.additionalPassed = report.parentExtra.status === 'passed';
    const [backup] = await readdir(path.join(result.directory, 'edits'));
    report.checks.originalBackup = await readFile(path.join(result.directory, 'edits', backup, 'before.txt'), 'utf8') === broken;
    report.usage = transcript.filter((entry) => entry.type === 'message' && entry.message.role === 'assistant').map((entry) => {
      const { input, output, cacheRead, cacheWrite, totalTokens } = entry.message.usage ?? {};
      return { input, output, cacheRead, cacheWrite, totalTokens };
    });
    report.accepted = Object.values(report.checks).every((value) => value === true);
  } catch (error) {
    report.errorType = error?.name ?? 'Error';
  } finally {
    globalThis.fetch = originalFetch;
    clearTimeout(timer); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    report.finishedAt = new Date().toISOString();
    const serialized = JSON.stringify(report, null, 2).split(apiKey).join('[REDACTED]');
    await writeFile(path.join(directory, 'report.json'), `${serialized}\n`, { flag: 'wx' });
    process.stdout.write(`${serialized}\n`);
    if (!report.accepted) process.exitCode = 1;
  }
}

main().catch((error) => { process.stderr.write(`Coding test did not start (${error?.name ?? 'Error'}). No secrets displayed.\n`); process.exitCode = 1; });
