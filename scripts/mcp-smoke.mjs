import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { inspectJob, readTranscript } from '../src/worker.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live') throw new Error('Explicit --live authorization is required.');
const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, '.runtime', 'live-tests');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'mcp-'));
const input = { marker: randomUUID(), rows: [{ id: 'A', value: 7, owner: null }, { id: 'B', value: 7, owner: '測試甲' }, { id: 'C', value: 5, owner: null }] };
const inputText = `${JSON.stringify(input)}\n`;
await writeFile(path.join(directory, 'input.json'), inputText, { flag: 'wx' });
const inputName = path.relative(root, path.join(directory, 'input.json')).split(path.sep).join('/');
const outputName = path.relative(root, path.join(directory, 'result.json')).split(path.sep).join('/');
const requestId = `mcp-${randomUUID()}`;
const request = { requestId, task: [
  '這是人工非敏感資料測試。只讀取指定輸入，建立指定輸出。',
  `讀取 ${inputName}，建立 ${outputName} 為純 JSON。`,
  '只包含 marker（原樣保留）、count（列數）、total（value 加總）、ids（原順序所有 id）、unknownOwners（owner 為 null 的 id，原順序）。',
  '不得去重或猜測未知值，保留原文。完成後用正體中文簡短交接。',
].join('\n'), readFiles: [inputName], outputFiles: [outputName] };
const report = { version: 1, directory, requestId, startedAt: new Date().toISOString(),
  entrypoint: 'official MCP client -> real stdio server -> Pi -> DeepSeek',
  requestedModel: 'deepseek-v4-flash', apiResponseModel: 'not captured by this MCP test',
  checks: {}, accepted: false };
const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.join(root, 'src', 'mcp-stdio.mjs'), '--live', '--workspace', root, '--model', report.requestedModel, '--key-file', path.join(root, '.env.local')],
  cwd: root, stderr: 'pipe' });
// Report only whether stderr occurred, not raw external diagnostics.
transport.stderr.on('data', () => { report.serverStderrSeen = true; });
const client = new Client({ name: 'k-live-mcp-check', version: '0.1.0' });
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 90_000);
const cancel = () => controller.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
const call = (name, args) => client.callTool({ name, arguments: args }, { timeout: 70_000, signal: controller.signal });
try {
  await client.connect(transport, { timeout: 30_000, signal: controller.signal });
  report.server = client.getServerVersion();
  report.tools = (await client.listTools()).tools.map((tool) => tool.name);
  report.checks.discovery = report.tools.length === 4 && report.tools.includes('k_worker_start');
  const started = await call('k_worker_start', request);
  assert.equal(started.isError, undefined);
  report.jobDirectory = started.structuredContent.jobDirectory;
  report.startStatus = started.structuredContent.status;
  const duplicate = await call('k_worker_start', request);
  report.checks.sameJob = duplicate.structuredContent.jobDirectory === report.jobDirectory;
  const waited = await call('k_worker_wait', { requestId });
  const result = waited.structuredContent;
  report.workerStatus = result.status;
  report.checks.completed = result.status === 'completed' && !result.timedOut;
  report.checks.parentAcceptanceRequired = result.acceptance === 'not-reviewed';
  report.checks.inputUnchanged = await readFile(path.join(directory, 'input.json'), 'utf8') === inputText;
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')), { marker: input.marker, count: 3, total: 19, ids: ['A', 'B', 'C'], unknownOwners: ['A', 'C'] });
  report.checks.outputExact = true;
  const state = await inspectJob(report.jobDirectory);
  const readback = await call('k_worker_inspect', { requestId });
  report.checks.durableReadback = state.status === result.status && state.output === result.output && readback.structuredContent.output === result.output;
  report.modelTurns = state.modelTurns;
  report.toolCalls = state.toolCalls;
  report.toolErrors = state.toolErrors;
  report.checks.noToolErrors = state.toolErrors === 0;
  const transcript = await readTranscript(report.jobDirectory);
  report.checks.actualReadWrite = ['read_input', 'write_output'].every((name) => transcript.some((entry) => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === name && !entry.message.isError));
  const finalDuplicate = await call('k_worker_start', request);
  report.checks.noReplay = finalDuplicate.structuredContent.modelTurns === state.modelTurns && finalDuplicate.structuredContent.jobDirectory === report.jobDirectory;
  report.accepted = Object.values(report.checks).every((value) => value === true);
} catch {
  report.accepted = false;
  report.error = 'MCP live acceptance did not complete. Inspect this job; no automatic retry.';
} finally {
  // EOF requests worker cancellation before the SDK reaps this child process.
  await client.close();
  clearTimeout(timer);
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
  report.finishedAt = new Date().toISOString();
  report.processElapsedMs = Math.round(performance.now());
  await writeFile(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.accepted) process.exitCode = 1;
}
