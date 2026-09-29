import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, '.runtime', 'tests');
await mkdir(base, { recursive: true });

async function fixture(t, mode = 'complete') {
  const directory = await mkdtemp(path.join(base, 'mcp-'));
  const workspace = path.join(directory, 'workspace');
  const stateDir = path.join(directory, 'jobs');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'input.txt'), '原文與未知欄位均保留。\n', { flag: 'wx' });
  if (mode.startsWith('coding')) {
    await writeFile(path.join(workspace, 'code.mjs'), 'export const add = (a, b) => a - b;\n', { flag: 'wx' });
    await writeFile(path.join(workspace, 'checks.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { add } from './code.mjs'; test('addition', () => assert.equal(add(2, 3), 5));\n", { flag: 'wx' });
  }
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(root, 'test', 'fixtures', 'mcp-worker.mjs'), workspace, stateDir, mode], cwd: root, stderr: 'pipe' });
  let log = '';
  let ready;
  const waitingAfterWrite = new Promise((resolve) => { ready = resolve; });
  transport.stderr.on('data', (chunk) => {
    log += chunk.toString();
    if (log.includes('FIXTURE_WAITING_AFTER_WRITE')) ready();
  });
  const client = new Client({ name: 'k-offline-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport, { timeout: 30_000 });
  const call = (name, args, options) => client.callTool({ name, arguments: args }, { timeout: 70_000, ...options });
  const request = { requestId: 'test-request', task: '複製 input.txt 成新檔 output.txt；保留原文。', readFiles: ['input.txt'], outputFiles: ['output.txt'] };
  return { directory, workspace, stateDir, client, call, request, waitingAfterWrite, log: () => log };
}

test('real stdio discovery, scoped dispatch, wait, result and duplicate readback', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  assert.equal(f.client.getServerVersion().name, 'k-flash-worker');
  assert.match(f.client.getInstructions(), /The parent owns judgment/u);
  const { tools } = await f.client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['k_worker_cancel', 'k_worker_inspect', 'k_worker_recover', 'k_worker_run', 'k_worker_start', 'k_worker_wait']);
  assert.equal(tools.find((tool) => tool.name === 'k_worker_wait').annotations.readOnlyHint, true);
  const started = await f.call('k_worker_start', f.request);
  assert.equal(started.isError, undefined);
  assert.equal(started.structuredContent.status, 'running');
  assert.equal(started.structuredContent.task, undefined);
  const result = await f.call('k_worker_wait', { requestId: f.request.requestId });
  assert.equal(result.structuredContent.status, 'completed');
  assert.equal(result.structuredContent.acceptance, 'not-reviewed');
  assert.equal(result.structuredContent.toolCalls, 2);
  assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), await readFile(path.join(f.workspace, 'input.txt'), 'utf8'));
  const again = await f.call('k_worker_start', f.request);
  assert.equal(again.structuredContent.jobDirectory, started.structuredContent.jobDirectory);
  assert.equal(again.structuredContent.modelTurns, 3);
  assert.equal((await f.call('k_worker_inspect', { requestId: f.request.requestId })).structuredContent.status, 'completed');
  const recovery = (await f.call('k_worker_recover', { requestId: f.request.requestId })).structuredContent;
  assert.equal(recovery.jobDirectory, started.structuredContent.jobDirectory);
  assert.equal(recovery.sourceJobDirectory, started.structuredContent.jobDirectory);
  assert.equal(recovery.originalTask, f.request.task);
  assert.equal(recovery.priorOutput, result.structuredContent.output);
  assert.match(recovery.instructions.join('\n'), /missing tool result does not prove no write occurred/i);
  assert.equal(recovery.recovery, 'inspection-only');
  const invalid = await f.call('k_worker_start', { ...f.request, workspace: path.dirname(f.workspace) });
  assert.equal(invalid.isError, true);
  const conflict = await f.call('k_worker_start', { ...f.request, task: 'Different task' });
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text,/already belongs to a different request/);
  assert.equal((await f.call('k_worker_inspect', { requestId: f.request.requestId })).structuredContent.status, 'completed');
  assert.equal(f.log(), '');
});

test('one-call worker run starts once, waits, and remains unaccepted', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const result = await f.call('k_worker_run', { ...f.request, requestId: 'run-once' });
  assert.equal(result.structuredContent.status, 'completed');
  assert.equal(result.structuredContent.acceptance, 'not-reviewed');
  assert.equal(result.structuredContent.timedOut, false);
  const again = await f.call('k_worker_run', { ...f.request, requestId: 'run-once' });
  assert.equal(again.structuredContent.jobDirectory, result.structuredContent.jobDirectory);
  assert.equal(again.structuredContent.modelTurns, 3);
});

test('real MCP history grant reaches Pi and remains scoped and immutable for its request ID', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, 'history');
  await mkdir(path.join(f.stateDir, 'prior'), { recursive: true });
  await writeFile(path.join(f.stateDir, 'prior/job.json'), JSON.stringify({version:1,workspace:f.workspace,task:'preserve duplicate rows',sessionFile:null}));
  const { tools } = await f.client.listTools();
  assert.ok(tools.find(tool => tool.name === 'k_worker_start').inputSchema.properties.historyIds);
  const request = {requestId:'recall',task:'Retrieve original constraint.',historyIds:['prior']};
  await f.call('k_worker_start',request);
  const result = (await f.call('k_worker_wait',{requestId:'recall'})).structuredContent;
  assert.equal(result.status,'completed');assert.deepEqual(result.historyIds,['prior']);
  assert.equal(result.toolCalls,1);assert.equal(result.toolErrors,0);
  assert.equal(JSON.parse(result.output).results[0].excerpt,'preserve duplicate rows');
  assert.equal((await f.call('k_worker_start',{...request,historyIds:[]})).isError,true);
});

test('MCP wait cancellation is distinct from worker cancellation; written output survives', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, 'hold');
  await f.call('k_worker_start', f.request);
  await f.waitingAfterWrite;
  const timed = await f.call('k_worker_wait', { requestId: f.request.requestId, timeoutMs: 10 });
  assert.equal(timed.structuredContent.timedOut, true);
  assert.equal(timed.structuredContent.status, 'running');
  const controller = new AbortController();
  const waiting = f.call('k_worker_wait', { requestId: f.request.requestId }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting);
  assert.equal((await f.call('k_worker_inspect', { requestId: f.request.requestId })).structuredContent.cancelRequested, false);
  assert.equal((await f.call('k_worker_cancel', { requestId: f.request.requestId })).structuredContent.cancelRequested, true);
  assert.equal((await f.call('k_worker_wait', { requestId: f.request.requestId })).structuredContent.status, 'cancelled');
  assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), '原文與未知欄位均保留。\n');
});

test('closing the real MCP client stops its worker and preserves the job/output', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, 'hold');
  await f.call('k_worker_start', f.request);
  await f.waitingAfterWrite;
  await f.client.close();
  const record = JSON.parse(await readFile(path.join(f.stateDir, f.request.requestId, 'job.json'), 'utf8'));
  assert.equal(record.status, 'cancelled');
  assert.equal(await readFile(path.join(f.workspace, 'output.txt'), 'utf8'), '原文與未知欄位均保留。\n');
});

test('production stdio refuses implicit live operation before loading a credential', () => {
  const child = spawnSync(process.execPath, ['src/mcp-stdio.mjs', '--workspace', root, '--model', 'deepseek-v4-flash', '--key-file', 'missing.env'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /explicit --live/iu);
});

test('real MCP coding dispatch exposes explicit grants, edits code, runs tests and rejects changed scopes/commands', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, 'coding');
  const { tools } = await f.client.listTools();
  const start = tools.find((tool) => tool.name === 'k_worker_start');
  assert.ok(start.inputSchema.properties.coding);
  assert.equal(start.annotations.destructiveHint, true);
  const request = { requestId: 'code-1', task: 'Fix approved addition.', readFiles: ['code.mjs', 'checks.mjs'],
    coding: { editFiles: ['code.mjs'], testFiles: ['checks.mjs'] } };
  const originalTests = await readFile(path.join(f.workspace, 'checks.mjs'), 'utf8');
  assert.equal((await f.call('k_worker_start', { ...request, coding: { ...request.coding, command: 'anything' } })).isError, true);
  const begun = await f.call('k_worker_start', request);
  assert.equal(begun.structuredContent.status, 'running');
  assert.deepEqual(begun.structuredContent.coding, { ...request.coding, timeoutMs: 10000 });
  const result = (await f.call('k_worker_wait', { requestId: request.requestId })).structuredContent;
  assert.equal(result.status, 'completed');
  assert.equal(result.toolCalls, 3); assert.equal(result.toolErrors, 0);
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), 'export const add = (a, b) => a + b;\n');
  assert.equal(await readFile(path.join(f.workspace, 'checks.mjs'), 'utf8'), originalTests);
  const tests = (await readdir(result.jobDirectory)).filter((name) => name.startsWith('test-'));
  const statuses = await Promise.all(tests.map(async (name) => JSON.parse(await readFile(path.join(result.jobDirectory, name, 'result.json'), 'utf8')).status));
  assert.deepEqual(statuses.sort(), ['failed', 'passed']);
  assert.equal((await f.call('k_worker_start', request)).structuredContent.modelTurns, 4);
  assert.equal((await f.call('k_worker_start', { ...request, coding: { ...request.coding, timeoutMs: 2000 } })).isError, true);
  assert.equal((await f.call('k_worker_start', { ...request, coding: undefined })).isError, true);
  assert.equal((await f.call('k_worker_inspect', { requestId: request.requestId })).structuredContent.status, 'completed');
});

test('MCP coding cancellation preserves the completed edit and original backup', { timeout: 30_000 }, async (t) => {
  const f = await fixture(t, 'coding-hold');
  const request = { requestId: 'code-cancel', task: 'Fix approved addition.', readFiles: ['code.mjs', 'checks.mjs'],
    coding: { editFiles: ['code.mjs'], testFiles: ['checks.mjs'] } };
  await f.call('k_worker_start', request); await f.waitingAfterWrite;
  await f.call('k_worker_cancel', { requestId: request.requestId });
  const result = (await f.call('k_worker_wait', { requestId: request.requestId })).structuredContent;
  assert.equal(result.status, 'cancelled');
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), 'export const add = (a, b) => a + b;\n');
  const [backup] = await readdir(path.join(result.jobDirectory, 'edits'));
  assert.equal(await readFile(path.join(result.jobDirectory, 'edits', backup, 'before.txt'), 'utf8'), 'export const add = (a, b) => a - b;\n');
});
