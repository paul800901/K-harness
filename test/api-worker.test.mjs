import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createApiWorker, apiWorkerRows, API_OUTPUT_FILES_NOTE} from '../src/api-worker.mjs';
import {createLunaBridge} from '../src/luna-bridge.mjs';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {
  availableWorkerModels,
  MODEL_PROTOCOL_GUIDANCE,
  validateWorkerPolicy,
  workerPolicyConfig
} from '../src/worker-policy.mjs';
import {discussionSearchInstructions} from '../shared/discussion.mjs';
import {scratchBase} from './scratch.mjs';

const CONNECTION = 'a'.repeat(32);
const API_MODEL = `api:${CONNECTION}/deepseek-v4-pro`;
const PLAIN_MODEL = `api:${CONNECTION}/deepseek-plain`;
const connectionRows = [
  {
    route: 'api',
    connectionId: CONNECTION,
    model: 'deepseek-v4-pro',
    displayName: 'DeepSeek-V4-Pro',
    providerLabel: 'DeepSeek',
    available: true,
    supportedReasoningEfforts: ['high', 'max'],
    defaultReasoningEffort: 'high'
  },
  {
    route: 'api',
    connectionId: CONNECTION,
    model: 'deepseek-plain',
    displayName: 'DeepSeek-Plain',
    providerLabel: 'DeepSeek',
    available: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null
  }
];
let leases = 0;
const fakeConnections = () => ({
  lease() {
    leases++;
    return () => leases--;
  },
  async models() {
    return {models: connectionRows};
  },
  async credentials(id) {
    assert.equal(id, CONNECTION);
    return {baseUrl: 'https://fake.test/v1', key: 'FAKE-KEY'};
  }
});
const sse = deltas =>
  new Response(
    [
      ...deltas.map(delta => `data: ${JSON.stringify({choices: [{index: 0, delta}]})}\n\n`),
      `data: ${JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: 'stop'}]})}\n\n`,
      'data: [DONE]\n\n'
    ].join(''),
    {headers: {'Content-Type': 'text/event-stream'}}
  );
const workerRows = await apiWorkerRows(fakeConnections());
const nativeModels = [
  {model: 'gpt-6.1-sol', supportedReasoningEfforts: [{reasoningEffort: 'high'}]},
  {model: 'claude-opus-5-5', supportedReasoningEfforts: [{reasoningEffort: 'high'}]},
  {model: 'gemini-3.8-flash', supportedReasoningEfforts: []}
];
async function fixture(options = {}) {
  const root = path.join(scratchBase, 'api-worker-tests', randomUUID());
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace, {recursive: true});
  const changes = [];
  const bridge = await createLunaBridge({
    root,
    workspace,
    parentId: 'parent',
    geminiOnly: true,
    onChange: record => changes.push(record),
    workerPolicy: {model: API_MODEL, effort: 'high'},
    ...options
  });
  return {root, workspace, bridge, changes};
}

test('catalog rows use the api: id, native effort shape and the connection name', () => {
  assert.deepEqual(
    workerRows.map(row => [row.model, row.provider, row.displayName]),
    [
      [API_MODEL, 'api', 'DeepSeek · DeepSeek-V4-Pro'],
      [PLAIN_MODEL, 'api', 'DeepSeek · DeepSeek-Plain']
    ]
  );
  assert.deepEqual(workerRows[0].supportedReasoningEfforts, [{reasoningEffort: 'high'}, {reasoningEffort: 'max'}]);
  assert.deepEqual(workerRows[1].supportedReasoningEfforts, []);
});

test('worker policy accepts a saved manual API choice and still rejects an unlisted one', () => {
  const models = [...nativeModels, ...workerRows];
  assert.deepEqual(
    availableWorkerModels(models, {geminiGateway: true, claudeGateway: true}).map(row => row.model),
    ['gpt-6.1-sol', 'claude-opus-5-5', 'gemini-3.8-flash', API_MODEL, PLAIN_MODEL]
  );
  assert.deepEqual(validateWorkerPolicy({model: API_MODEL, effort: 'max'}, models), {model: API_MODEL, effort: 'max'});
  assert.deepEqual(validateWorkerPolicy({model: PLAIN_MODEL, effort: null}, models), {
    model: PLAIN_MODEL,
    effort: null
  });
  assert.throws(() => validateWorkerPolicy({model: API_MODEL, effort: 'low'}, models), /不支援 low/);
  assert.throws(() => validateWorkerPolicy({model: `api:${'b'.repeat(32)}/x`, effort: null}, models), /不可用/);
  assert.throws(() => validateWorkerPolicy({model: API_MODEL, effort: 'high'}, nativeModels), /不可用/);
});

test('API models are listed last with the connection and API billing, and are never an auto choice', () => {
  const config = workerPolicyConfig(undefined, {
    models: [...workerRows.slice(0, 1), ...nativeModels],
    geminiGateway: true,
    claudeGateway: true,
    provider: 'claude'
  });
  const text = config.developer_instructions;
  assert.match(text, /choose gpt-6\.1-sol or claude-opus-5-5 or gemini-3\.8-flash based on that task/);
  assert.doesNotMatch(text, /choose [^.]*api:/);
  const listed = text.split('\n').find(line => line.startsWith('目前官方可派模型與推理程度'));
  assert.match(
    listed,
    new RegExp(
      `gemini-3\\.8-flash: native default \\(null\\); ${API_MODEL}（DeepSeek · DeepSeek-V4-Pro，API 計費）: high, max。$`
    )
  );
  assert.match(
    text,
    /prefix api:\) are billed per use through an API key the user owns and are read-only consult workers/
  );
  assert.match(
    text,
    /ONLY when the user explicitly asks in this conversation to consult that model or provider; never as an ordinary AI-auto choice, failure fallback or substitute/
  );
  const without = workerPolicyConfig(undefined, {models: nativeModels, geminiGateway: true, provider: 'gemini'});
  assert.doesNotMatch(without.developer_instructions, /API models (prefix api:)/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /DeepSeek 等 API 模型（api: 開頭）：只在本人明確要求諮詢該模型/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /API 計費、唯讀[^\n]*排最後，不作一般選項或失敗備援/);
});

test('a saved API choice is a consult model, never an ordinary default or a native GPT default', () => {
  const config = workerPolicyConfig(
    {model: API_MODEL, effort: 'max'},
    {models: [...nativeModels, ...workerRows], geminiGateway: true, provider: 'gemini'}
  );
  assert.deepEqual(config.agents, {enabled: true});
  assert.match(
    config.developer_instructions,
    new RegExp(`User-saved API consult model: ${API_MODEL}, reasoning effort max`)
  );
  assert.match(config.developer_instructions, /not a default for ordinary delegation/);
  assert.doesNotMatch(config.developer_instructions, /User-selected default worker/);
});

test('the API worker asks once with the worker role prompt, effort and read-only tools, and returns the answer', async () => {
  const bodies = [];
  const workspace = path.join(scratchBase, 'api-worker-tests', randomUUID());
  await mkdir(workspace, {recursive: true});
  const worker = createApiWorker({
    workspace,
    connections: fakeConnections(),
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://fake.test/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer FAKE-KEY');
      bodies.push(JSON.parse(init.body));
      return sse([{content: '我的獨立看法'}]);
    }
  });
  const activities = [];
  let started = 0;
  const result = await worker.run({
    task: '請評論這個策略',
    model: API_MODEL,
    effort: 'max',
    signal: new AbortController().signal,
    onStart: () => started++,
    onActivity: value => activities.push(value)
  });
  assert.deepEqual(result, {
    status: 'completed',
    settled: true,
    output: '我的獨立看法',
    outputFiles: [],
    outputFilesNote: API_OUTPUT_FILES_NOTE,
    acceptance: 'not-reviewed'
  });
  assert.equal(started, 1);
  assert.ok(activities.length >= 1);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, 'deepseek-v4-pro');
  assert.equal(bodies[0].reasoning_effort, 'max');
  assert.deepEqual(bodies[0].tools.map(tool => tool.function.name).sort(), [
    'list_files',
    'read_file',
    'read_webpage',
    'search_files',
    'web_search'
  ]);
  const [system, user] = bodies[0].messages;
  assert.match(system.content, /^你是 K 主代理派出的唯讀諮詢工人/);
  assert.match(system.content, /不可改檔、執行指令或派工/);
  assert.match(system.content, /不是新的操作授權/);
  assert.ok(system.content.includes(discussionSearchInstructions));
  assert.match(system.content, /本次開始時間（UTC）：\d{4}-/);
  assert.doesNotMatch(system.content, /獨立 API 參與者/);
  assert.deepEqual(user, {role: 'user', content: '請評論這個策略'});
});

test('the API worker rejects an unknown model, unsupported effort or bad id before any request', async () => {
  let fetched = 0;
  const worker = createApiWorker({
    workspace: path.join(scratchBase, 'api-worker-tests', 'reject'),
    connections: fakeConnections(),
    fetchImpl: async () => {
      fetched++;
      return sse([{content: 'x'}]);
    }
  });
  const run = (model, effort) => worker.run({task: 't', model, effort});
  await assert.rejects(run('api:notvalid', null), /型號無效/);
  await assert.rejects(run(`api:${CONNECTION}/missing`, null), /不在目前 API 連線的可用模型清單；未換模/);
  await assert.rejects(run(`api:${'b'.repeat(32)}/deepseek-v4-pro`, 'high'), /不在目前 API 連線/);
  await assert.rejects(run(API_MODEL, 'low'), /不支援 low 推理程度/);
  await assert.rejects(run(API_MODEL, null), /不支援 未指定 推理程度/);
  await assert.rejects(run(PLAIN_MODEL, 'high'), /不支援 high 推理程度/);
  assert.equal(fetched, 0);
});

test('a geminiOnly bridge starts an api: worker, delivers the completion and keeps GPT rejected', async () => {
  const runs = [];
  const f = await fixture({
    apiFactory: options => {
      assert.equal(options.workspace, f.workspace);
      return {
        async run(input) {
          runs.push(input);
          return {
            status: 'completed',
            settled: true,
            output: 'DeepSeek 的看法',
            outputFiles: [],
            outputFilesNote: API_OUTPUT_FILES_NOTE,
            acceptance: 'not-reviewed'
          };
        }
      };
    }
  });
  try {
    const started = await f.bridge.start({requestId: 'ask1', task: '請諮詢', model: API_MODEL, effort: 'high'});
    assert.equal(started.provider, 'api');
    const done = await f.bridge.wait({requestId: 'ask1', timeoutMs: 2000});
    assert.equal(done.status, 'completed');
    assert.equal(done.settled, true);
    assert.equal(done.output, 'DeepSeek 的看法');
    assert.deepEqual(done.outputFiles, []);
    assert.equal(done.outputFilesNote, API_OUTPUT_FILES_NOTE);
    assert.equal(done.provider, 'api');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].model, API_MODEL);
    assert.equal(runs[0].effort, 'high');
    assert.equal(runs[0].task, '請諮詢');
    assert.ok(f.changes.some(record => record.requestId === 'ask1' && record.provider === 'api' && record.settled));
    const persisted = JSON.parse(
      await readFile(path.join(f.root, '.runtime', 'luna-bridge', 'parent', 'ask1.json'), 'utf8')
    );
    assert.equal(persisted.provider, 'api');
    assert.equal(persisted.output, 'DeepSeek 的看法');
    // Same id, same job: no second run. Different job under the same id is refused.
    await f.bridge.start({requestId: 'ask1', task: '請諮詢', model: API_MODEL, effort: 'high'});
    assert.equal(runs.length, 1);
    await assert.rejects(
      f.bridge.start({requestId: 'ask1', task: '別的', model: API_MODEL, effort: 'high'}),
      /拒絕重送/
    );
    await assert.rejects(
      f.bridge.start({requestId: 'gpt', task: 't', model: 'gpt-6.1-sol', effort: 'high'}),
      /只提供 Gemini 或 Claude（及 API 諮詢模型）/
    );
    await assert.rejects(
      f.bridge.start({requestId: 'acct', task: 't', model: API_MODEL, effort: 'high', accountId: 'c'.repeat(32)}),
      /只適用 Gemini/
    );
    await assert.rejects(
      f.bridge.start({requestId: 'hand', task: 't', model: API_MODEL, effort: 'high', handoffFrom: 'ask1'}),
      /只適用 Gemini/
    );
  } finally {
    await f.bridge.close();
  }
});

test('an API worker failure settles as failed with the read-only note and is never retried', async () => {
  let fetched = 0;
  const f = await fixture({
    apiFactory: options =>
      createApiWorker({
        ...options,
        connections: fakeConnections(),
        fetchImpl: async () => {
          fetched++;
          return new Response(JSON.stringify({error: {message: 'quota exceeded'}}), {status: 429});
        }
      })
  });
  try {
    await f.bridge.start({requestId: 'bad', task: 't', model: API_MODEL, effort: 'high'});
    const done = await f.bridge.wait({requestId: 'bad', timeoutMs: 2000});
    assert.equal(done.status, 'failed');
    assert.equal(done.settled, true);
    assert.match(done.error, /HTTP 429.*quota exceeded.*未重送或換模型/);
    assert.equal(done.outputFilesNote, API_OUTPUT_FILES_NOTE);
    assert.equal(fetched, 1);
  } finally {
    await f.bridge.close();
  }
});

test('a model that is not in the connection list fails the work without a substitute', async () => {
  const f = await fixture({
    apiFactory: options => createApiWorker({...options, connections: fakeConnections()})
  });
  try {
    await f.bridge.start({requestId: 'gone', task: 't', model: `api:${CONNECTION}/gone`, effort: null});
    const done = await f.bridge.wait({requestId: 'gone', timeoutMs: 2000});
    assert.equal(done.status, 'failed');
    assert.match(done.error, /未換模/);
  } finally {
    await f.bridge.close();
  }
});

test('cancel aborts the in-flight HTTP stream and settles as cancelled', async () => {
  let sawAbort = false;
  const entered = Promise.withResolvers();
  const f = await fixture({
    apiFactory: options =>
      createApiWorker({
        ...options,
        connections: fakeConnections(),
        fetchImpl: (url, init) =>
          new Promise((resolve, reject) => {
            entered.resolve();
            init.signal.addEventListener(
              'abort',
              () => {
                sawAbort = true;
                reject(Object.assign(Error('aborted'), {name: 'AbortError'}));
              },
              {once: true}
            );
          })
      })
  });
  try {
    await f.bridge.start({requestId: 'stop', task: 't', model: API_MODEL, effort: 'high'});
    await entered.promise;
    const result = await f.bridge.cancel({requestId: 'stop'});
    assert.equal(sawAbort, true);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.settled, true);
    assert.deepEqual(result.outputFiles, []);
  } finally {
    await f.bridge.close();
  }
});

test('an unsettled API record after restart is unowned, unresolved and never replayed', async () => {
  let runs = 0;
  const f = await fixture({
    apiFactory: () => ({
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
      provider: 'api',
      model: API_MODEL,
      effort: 'high',
      status: 'running',
      settled: false,
      task: 'original',
      workspace: f.workspace,
      output: '',
      outputFiles: []
    })
  );
  try {
    const record = await f.bridge.inspect({requestId: 'old'});
    assert.equal(record.status, 'unresolved');
    assert.equal(record.executionUnowned, true);
    assert.match(record.error, /未重播/);
    const duplicate = await f.bridge.start({requestId: 'old', task: 'original', model: API_MODEL, effort: 'high'});
    assert.equal(duplicate.executionUnowned, true);
    assert.equal(runs, 0);
    const listed = await f.bridge.list(false);
    assert.ok(listed.some(row => row.requestId === 'old' && row.provider === 'api'));
  } finally {
    await f.bridge.close();
  }
});

test('unified catalog adds API connections beside the worker catalog but never to the main models', async () => {
  const root = path.join(scratchBase, 'api-worker-catalog', randomUUID());
  await mkdir(root, {recursive: true});
  let workerCatalog;
  const fake = models => ({state: {}, models: async () => ({models}), usage: async () => ({}), close: async () => {}});
  const controller = createUnifiedController({
    root,
    workerApi: fakeConnections(),
    codexFactory: options => {
      workerCatalog = options.workerCatalog;
      return fake([{model: 'gpt-6.1-sol'}]);
    },
    claudeFactory: () => fake([{model: 'claude-opus-5-5'}]),
    geminiFactory: () => fake([{model: 'gemini-3.8-flash'}])
  });
  try {
    const catalog = await controller.models();
    assert.deepEqual(
      catalog.models.map(row => row.model),
      ['gpt-6.1-sol', 'claude-opus-5-5', 'gemini-3.8-flash']
    );
    assert.ok(!catalog.models.some(row => row.route === 'api' || row.provider === 'api'));
    assert.deepEqual(
      catalog.apiModels.map(row => row.model),
      [API_MODEL, PLAIN_MODEL]
    );
    const forWorkers = await workerCatalog();
    assert.deepEqual(
      forWorkers.models.map(row => row.model),
      ['gpt-6.1-sol', 'claude-opus-5-5', 'gemini-3.8-flash', API_MODEL, PLAIN_MODEL]
    );
  } finally {
    await controller.close();
  }
});

test('an unreadable API connection list only drops the API rows with a warning', async () => {
  const root = path.join(scratchBase, 'api-worker-catalog-broken', randomUUID());
  await mkdir(root, {recursive: true});
  const fake = models => ({state: {}, models: async () => ({models}), usage: async () => ({}), close: async () => {}});
  const controller = createUnifiedController({
    root,
    workerApi: {
      async models() {
        throw Error('API 連線設定格式無效。');
      }
    },
    codexFactory: () => fake([{model: 'gpt-6.1-sol'}]),
    claudeFactory: () => fake([{model: 'claude-opus-5-5'}]),
    geminiFactory: () => fake([])
  });
  try {
    const catalog = await controller.models();
    assert.equal(catalog.models.length, 2);
    assert.deepEqual(catalog.apiModels, []);
    assert.match(catalog.warnings.join('\n'), /api 目錄暫時不可用：API 連線設定格式無效/);
  } finally {
    await controller.close();
  }
});

test('a consult holds the API connections while it runs and releases them on success or failure', async () => {
  leases = 0;
  let during;
  const worker = createApiWorker({
    workspace: path.resolve('.'),
    connections: fakeConnections(),
    sessionFactory: async () => ({
      async ask() {
        during = leases;
        return '看法';
      },
      async close() {}
    })
  });
  await worker.run({task: 'x', model: API_MODEL, effort: 'high'});
  assert.equal(during, 1);
  assert.equal(leases, 0);
  await assert.rejects(worker.run({task: 'x', model: API_MODEL, effort: 'low'}), /不支援/);
  assert.equal(leases, 0);
});

test('omitting the model never falls back to a saved API consult model', async () => {
  const runs = [];
  const f = await fixture({apiFactory: () => ({run: async input => runs.push(input)})});
  try {
    await assert.rejects(f.bridge.start({requestId: 'implicit', task: '一般工作'}), /明確指定 model 與 effort/);
    assert.equal(runs.length, 0);
  } finally {
    await f.bridge.close();
  }
});

test('an API consult must name its effort too, so a saved effort is never reused silently', async () => {
  const runs = [];
  const f = await fixture({apiFactory: () => ({run: async input => runs.push(input)})});
  try {
    await assert.rejects(f.bridge.start({requestId: 'no-effort', task: '請諮詢', model: API_MODEL}), /明確指定 effort/);
    assert.equal(runs.length, 0);
  } finally {
    await f.bridge.close();
  }
});

test('a failed consult keeps the partial answer it already received and is not resent', async () => {
  const worker = createApiWorker({
    workspace: path.resolve('.'),
    connections: fakeConnections(),
    sessionFactory: async () => ({
      async ask(task, {onText}) {
        onText('已收到的部分看法');
        throw Error('串流中斷');
      },
      async close() {}
    })
  });
  const error = await worker.run({task: 'x', model: API_MODEL, effort: 'high'}).catch(e => e);
  assert.equal(error.message, '串流中斷');
  assert.equal(error.workerResult.output, '已收到的部分看法');
});
