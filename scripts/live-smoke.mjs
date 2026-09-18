import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

async function main() {
  const { values } = parseArgs({ options: { live: { type: 'boolean' }, dispatch: { type: 'boolean' }, 'key-file': { type: 'string' } } });
  if (!values.live) throw new Error('Explicit --live authorization is required.');
  // The caller chooses the source explicitly. Never copy the credential to the project.
  let apiKey = values['key-file']
    ? parseEnv((await readFile(path.resolve(values['key-file']), 'utf8')).replace(/^\uFEFF/u, '')).DEEPSEEK_API_KEY
    : process.env.DEEPSEEK_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('The chosen source does not supply DEEPSEEK_API_KEY.');
  apiKey = apiKey.trim();
  const base = fileURLToPath(new URL('../.runtime/live-tests/', import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'smoke-'));
  const workspace = path.join(directory, 'workspace');
  await mkdir(workspace);
  const input = {
    marker: randomUUID(),
    items: [
      { id: 'A01', category: '文件', minutes: 12, status: 'done', owner: '測試甲' },
      { id: 'A02', category: '文件', minutes: 12, status: 'done', owner: null },
      { id: 'A03', category: '程式', minutes: 7, status: 'pending', owner: '測試乙' },
      { id: 'A04', category: '文件', minutes: 5, status: 'done', owner: null },
    ],
  };
  const inputText = `${JSON.stringify(input, null, 2)}\n`;
  await writeFile(path.join(workspace, 'input.json'), inputText, { flag: 'wx' });
  const task = [
    '這是人工製作、非敏感的資料整理測試，不是真實營運資料。',
    '請用 read_input 讀取 input.json，以 write_output 建立 result.json，保留原文不變。',
    'result.json 必須是純 JSON 物件，不含 Markdown；只包含以下欄位：',
    'marker：原樣保留輸入 marker；itemCount：列數；totalMinutes：所有 minutes 加總；',
    'byCategory：各 category 對應 minutes 加總的物件；',
    'pendingIds：status 為 pending 的 id 陣列；unknownOwnerIds：owner 為 null 的 id 陣列；',
    'ids：所有 id，維持輸入順序。陣列均維持輸入順序；重複數值是不同資料，不得去重，不得猜測 owner。',
    '最後用正體中文簡短回報建立的檔案。',
  ].join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Smoke test exceeded 90 seconds.')), 90_000);
  const cancel = () => controller.abort(new Error('User cancelled the smoke test.'));
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  const report = {
    version: 1, directory, workspace, startedAt: new Date().toISOString(),
    requestedModel: 'deepseek-v4-flash', returnedModels: [],
    scope: 'One synthetic nonclinical file task. At most six official DeepSeek HTTP requests and 90 seconds.',
    requests: [], rawUsage: [], checks: {}, accepted: false,
    cost: 'Not calculated: the pinned Pi catalog may contain prices for a retired model alias.',
    entrypoint: values.dispatch ? 'dispatcher' : 'worker',
  };
  let dispatcher;
  let cancelDispatch;
  const fetchOriginal = globalThis.fetch;
  const responseReaders = [];
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
    if (url.origin !== 'https://api.deepseek.com' || url.pathname !== '/chat/completions') {
      throw new Error('The smoke test permits only the official DeepSeek chat completion endpoint.');
    }
    if (report.requests.length >= 6) throw new Error('Smoke test request limit reached.');
    const request = { path: url.pathname, status: null };
    report.requests.push(request);
    const response = await fetchOriginal(resource, {
      ...options, redirect: 'error',
      signal: options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
    });
    request.status = response.status;
    // Pi records the requested alias. Inspect only model/usage fields from the
    // actual response; never persist headers, request bodies or the raw SSE text.
    responseReaders.push(response.clone().text().then((body) => {
      for (const line of body.split('\n')) {
        if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(line.slice(6)); } catch { continue; }
        if (typeof chunk.model === 'string' && !report.returnedModels.includes(chunk.model)) report.returnedModels.push(chunk.model);
        if (chunk.usage) report.rawUsage.push(chunk.usage);
      }
    }).catch(() => { report.responseMetadataIncomplete = true; }));
    return response;
  };
  try {
    const { createDeepSeekRuntime } = await import('../src/runtime.mjs');
    const { runWorker, inspectJob, readTranscript } = await import('../src/worker.mjs');
    const runtime = await createDeepSeekRuntime(report.requestedModel, apiKey);
    const workStart = performance.now();
    const workOptions = {
      task, workspace, readFiles: ['input.json'], outputFiles: ['result.json'], ...runtime,
      signal: controller.signal,
      onEvent(event) {
        if (event.type === 'job_started') {
          report.jobDirectory = event.directory;
          process.stderr.write(`Job record: ${event.directory}\n`);
        }
      },
    };
    let result;
    if (values.dispatch) {
      const { createDispatcher } = await import('../src/dispatcher.mjs');
      dispatcher = await createDispatcher({ workspace, ...runtime });
      const request = { requestId: `smoke-${randomUUID()}`, task, readFiles: ['input.json'], outputFiles: ['result.json'] };
      cancelDispatch = () => { void dispatcher.cancel(request.requestId).catch(() => {}); };
      controller.signal.addEventListener('abort', cancelDispatch, { once: true });
      controller.signal.throwIfAborted();
      const started = await dispatcher.start(request);
      report.jobDirectory = started.directory;
      report.dispatch = { requestId: request.requestId, startStatus: started.status, acknowledgmentMs: Math.round(performance.now() - workStart), waitCalls: 0 };
      process.stderr.write(`Job record: ${started.directory}\n`);
      const repeated = await dispatcher.start(request);
      report.checks.dispatchSameId = repeated.directory === started.directory;
      result = await dispatcher.wait(request.requestId);
      report.dispatch.waitCalls += 1;
      if (result.status === 'running') {
        // One event wait for the remaining bounded smoke window, not polling.
        result = await dispatcher.wait(request.requestId, { timeoutMs: 30_000 });
        report.dispatch.waitCalls += 1;
      }
      const count = report.requests.length;
      const readback = await dispatcher.start(request);
      report.checks.dispatchNoReplay = readback.directory === started.directory && readback.status === result.status && report.requests.length === count;
      report.checks.dispatchTerminalWait = result.status === 'completed' && !result.timedOut;
    } else {
      result = await runWorker(workOptions);
    }
    report.workerWallMs = Math.round(performance.now() - workStart);
    report.workerStatus = result.status;
    report.thinkingLevel = result.thinkingLevel;
    report.modelTurns = result.modelTurns;
    report.toolCalls = result.toolCalls;
    report.toolErrors = result.toolErrors;
    const state = await inspectJob(result.directory);
    const transcript = await readTranscript(result.directory);
    const messages = transcript.filter((entry) => entry.type === 'message').map((entry) => entry.message);
    report.checks.completed = result.status === 'completed';
    report.checks.inputUnchanged = await readFile(path.join(workspace, 'input.json'), 'utf8') === inputText;
    report.checks.jobReadback = state.status === result.status && state.output === result.output;
    report.checks.noToolErrors = result.toolErrors === 0;
    report.checks.actualReadAndWrite = ['read_input', 'write_output'].every((name) => messages.some((message) => message.role === 'toolResult' && message.toolName === name && !message.isError));
    const expected = {
      marker: input.marker, itemCount: 4, totalMinutes: 36,
      byCategory: { '文件': 29, '程式': 7 }, pendingIds: ['A03'], unknownOwnerIds: ['A02', 'A04'],
      ids: ['A01', 'A02', 'A03', 'A04'],
    };
    try {
      assert.deepEqual(JSON.parse(await readFile(path.join(workspace, 'result.json'), 'utf8')), expected);
      report.checks.outputExact = true;
    } catch {
      report.checks.outputExact = false;
    }
    const names = (await readdir(workspace)).sort();
    report.checks.workspaceFiles = names.length === 2 && names[0] === 'input.json' && names[1] === 'result.json';
    report.checks.credentialNotInJob = !JSON.stringify({ state, transcript }).includes(apiKey);
    report.accepted = Object.values(report.checks).every((value) => value === true);
  } catch (error) {
    report.errorType = error?.name ?? 'Error';
    report.accepted = false;
  } finally {
    if (cancelDispatch) controller.signal.removeEventListener('abort', cancelDispatch);
    await dispatcher?.close();
    await Promise.all(responseReaders);
    clearTimeout(timer);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    globalThis.fetch = fetchOriginal;
    report.finishedAt = new Date().toISOString();
    report.processElapsedMs = Math.round(performance.now());
    // API metadata or a provider diagnostic must not cause credential disclosure.
    let serialized = JSON.stringify(report, null, 2);
    if (serialized.includes(apiKey)) {
      report.accepted = false;
      report.checks.credentialNotInReport = false;
      serialized = JSON.stringify(report, null, 2).split(apiKey).join('[REDACTED]');
    }
    await writeFile(path.join(directory, 'report.json'), `${serialized}\n`, { flag: 'wx' });
    process.stdout.write(`${serialized}\n`);
    apiKey = undefined;
    if (!report.accepted) process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`Live test did not start (${error?.name ?? 'Error'}). No credential values are displayed.\n`);
  process.exitCode = 1;
});
