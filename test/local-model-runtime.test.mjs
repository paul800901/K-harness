import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalModelRuntime} from '../src/local-model-runtime.mjs';

test('normal idle K shutdown releases only its own instance once; active or uncertain work is never stopped', async () => {
  const idle = setup();
  const lease = await idle.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  lease.finish();
  await Promise.all([idle.runtime.close(), idle.runtime.close()]);
  assert.equal(idle.calls.filter(c => c.url?.endsWith('/unload')).length, 1);
  assert.equal(idle.models[0].loaded_instances.length, 0);
  for (const settled of [undefined, false]) {
    const active = setup();
    const lease = await active.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
    if (settled === false) lease.finish({settled});
    await active.runtime.close();
    assert.equal(active.calls.filter(c => c.url?.endsWith('/unload')).length, 0);
    lease.finish();
  }
});

const modelKey = 'publisher/model.gguf';
const instanceId = 'k-local-main';
const row = (key = modelKey, extra = {}) => ({
  key,
  type: 'llm',
  format: 'gguf',
  max_context_length: 65536,
  loaded_instances: [],
  ...extra
});
const loaded = (id, context_length = 32768, parallel = 1) => ({id, config: {context_length, parallel}});
const response = data => ({ok: true, status: 200, json: async () => data});
const requestUrl = 'http://127.0.0.1:1234/api/v1/models';
const modelResponse = models => response({models});

test('a close skipped while busy does not prevent a later idle connection from releasing the model', async () => {
  const env = setup();
  const lease = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await env.runtime.close();
  await lease.finish();
  await Promise.all([env.runtime.close(), env.runtime.close()]);
  assert.equal(env.calls.filter(c => c.url?.endsWith('/unload')).length, 1);
});

test('idle shutdown releases its own instance without touching another externally loaded model', async () => {
  const env = setup();
  const lease = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await lease.finish();
  env.models = [...env.models, row('external', {loaded_instances: [loaded('external-id')]})];
  await env.runtime.close();
  assert.equal(env.models[0].loaded_instances.length, 0);
  assert.equal(env.models[1].loaded_instances[0].id, 'external-id');
});

test('cancelling our sole inference explicitly unloads its instance and verifies before allowing another request', async () => {
  const env = setup();
  const lease = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await lease.finish({settled: false, cancelled: true});
  assert.equal(env.models[0].loaded_instances.length, 0);
  assert.equal(env.calls.filter(c => c.url?.endsWith('/unload')).length, 1);
  const next = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await next.finish();
});

test('an unknown cancellation unload result is not retried or treated as completed', async () => {
  let reads = 0;
  const uncertainRuntime = createLocalModelRuntime({
    executable: 'lms.exe',
    runImpl: async () => {},
    fetchImpl: async url => {
      if (url.endsWith('/unload')) throw Error('lost response');
      return modelResponse([row(modelKey, {loaded_instances: ++reads > 1 ? [loaded(instanceId)] : []})]);
    }
  });
  const active = await uncertainRuntime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await assert.rejects(active.finish({settled: false, cancelled: true}), /卸載結果不明/);
  await assert.rejects(uncertainRuntime.acquire({model: modelKey, instanceId, contextWindow: 32768}), /狀態不明/);
});

function setup({models = [row()], fetchImpl, runImpl} = {}) {
  let current = models;
  const calls = [];
  const fetch =
    fetchImpl ??
    (async (url, options = {}) => {
      calls.push({kind: 'http', url, options});
      if (url === requestUrl) return modelResponse(current);
      if (url.endsWith('/unload')) {
        const {instance_id} = JSON.parse(options.body);
        current = current.map(item => ({
          ...item,
          loaded_instances: item.loaded_instances.filter(instance => instance.id !== instance_id)
        }));
        return response({});
      }
      throw new Error(`unexpected URL ${url}`);
    });
  const run =
    runImpl ??
    (async (args, options) => {
      calls.push({kind: 'cli', args, options});
      if (args[0] === 'load') {
        const id = args[args.indexOf('--identifier') + 1];
        const context = Number(args[args.indexOf('--context-length') + 1]);
        current = current.map(item =>
          item.key === args[1]
            ? {
                ...item,
                loaded_instances: [...item.loaded_instances, loaded(id, context, 1)]
              }
            : item
        );
      }
      return {stdout: ''};
    });
  return {
    runtime: createLocalModelRuntime({executable: 'lms.exe', fetchImpl: fetch, runImpl: run}),
    calls,
    get models() {
      return current;
    },
    set models(value) {
      current = value;
    }
  };
}

test('catalog is read-only and offline catalog uses lms ls --json without loading a model', async () => {
  const calls = [];
  const runtime = createLocalModelRuntime({
    executable: 'lms.exe',
    fetchImpl: async () => {
      throw new TypeError('offline');
    },
    runImpl: async (args, options) => {
      calls.push({args, options});
      return {stdout: JSON.stringify([{type: 'llm', modelKey, format: 'gguf', maxContextLength: 65536}])};
    }
  });
  assert.deepEqual(await runtime.catalog(), {
    models: [{type: 'llm', modelKey, format: 'gguf', maxContextLength: 65536, key: modelKey, max_context_length: 65536}]
  });
  assert.deepEqual(
    calls.map(call => call.args),
    [['ls', '--json']]
  );
});

test('first acquire lazily starts localhost service, loads with exact conservative CLI options and verifies readback', async () => {
  let online = false;
  const calls = [];
  let models = [row()];
  const runtime = createLocalModelRuntime({
    executable: 'lms.exe',
    runImpl: async (args, options) => {
      calls.push({args, options});
      if (args[0] === 'server') online = true;
      if (args[0] === 'load') models = [row(modelKey, {loaded_instances: [loaded(instanceId, 32768, 1)]})];
    },
    fetchImpl: async url => {
      if (!online) throw new TypeError('offline');
      assert.equal(url, requestUrl);
      return modelResponse(models);
    }
  });
  const lease = await runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  assert.equal(lease.model, instanceId);
  assert.deepEqual(
    calls.map(call => call.args),
    [
      ['daemon', 'up'],
      ['server', 'start', '--port', '1234', '--bind', '127.0.0.1'],
      [
        'load',
        modelKey,
        '--port',
        '1234',
        '--identifier',
        instanceId,
        '--context-length',
        '32768',
        '--parallel',
        '1',
        '--no-engine-config-file',
        '--no-speculative-draft-mtp',
        '--yes'
      ]
    ]
  );
  assert.ok(calls.every(call => !call.args.includes('--gpu') && !call.args.includes('--auto')));
  await lease.finish();
});

test('reuses its matching loaded instance and retains busy until finish', async () => {
  const env = setup({models: [row(modelKey, {loaded_instances: [loaded(instanceId)]})]});
  // Mark the instance as manager-owned through one successful acquisition first.
  env.models = [row()];
  const first = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await assert.rejects(env.runtime.acquire({model: modelKey, instanceId: 'other', contextWindow: 32768}), /忙碌/);
  await first.finish();
  const again = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  assert.equal(env.calls.filter(call => call.kind === 'cli' && call.args[0] === 'load').length, 1);
  await again.finish();
});

test('switching model unloads only the manager-owned idle instance before loading the next', async () => {
  const secondKey = 'publisher/second.gguf';
  const env = setup({models: [row(), row(secondKey)]});
  const first = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await first.finish();
  const second = await env.runtime.acquire({model: secondKey, instanceId: 'k-second', contextWindow: 16384});
  const unload = env.calls.find(call => call.kind === 'http' && call.url.endsWith('/unload'));
  assert.deepEqual(JSON.parse(unload.options.body), {instance_id: instanceId});
  assert.deepEqual(
    env.calls.filter(call => call.kind === 'cli' && call.args[0] === 'load').map(call => call.args[1]),
    [modelKey, secondKey]
  );
  await second.finish();
});

test('API-confirmed external unload removes stale ownership without posting unload for missing instance', async () => {
  const env = setup();
  const first = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await first.finish();
  env.models = [row()];
  const second = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  assert.equal(env.calls.filter(call => call.kind === 'cli' && call.args[0] === 'load').length, 2);
  assert.equal(
    env.calls.some(call => call.url?.endsWith('/unload')),
    false
  );
  await second.finish();
});

test('same owned instance id appearing under another model is treated as external replacement', async () => {
  const secondKey = 'publisher/second.gguf';
  const env = setup({models: [row(), row(secondKey)]});
  const first = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await first.finish();
  env.models = [row(modelKey), row(secondKey, {loaded_instances: [loaded(instanceId)]})];
  const priorLoads = env.calls.filter(call => call.kind === 'cli' && call.args[0] === 'load').length;
  await assert.rejects(env.runtime.acquire({model: secondKey, instanceId, contextWindow: 32768}), /非本管理器載入/);
  assert.equal(env.calls.filter(call => call.kind === 'cli' && call.args[0] === 'load').length, priorLoads);
  assert.equal(
    env.calls.some(call => call.url?.endsWith('/unload')),
    false
  );
});

test('foreign loaded LLM blocks acquisition without unload or CLI load', async () => {
  const env = setup({models: [row(modelKey, {loaded_instances: [loaded('someone-else', 8192)]})]});
  await assert.rejects(env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768}), /非本管理器載入/);
  assert.equal(
    env.calls.some(call => call.url?.endsWith('/unload') || call.args?.[0] === 'load'),
    false
  );
});

test('external embedding instances do not block LLM acquisition', async () => {
  const env = setup({models: [row(), {key: 'embed', type: 'embedding', loaded_instances: [loaded('external-embed')]}]});
  const lease = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await lease.finish();
});

test('unsettled inference blocks later acquire and does not replay work', async () => {
  const env = setup();
  const lease = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await lease.finish({settled: false});
  const loadCount = env.calls.filter(call => call.args?.[0] === 'load').length;
  await assert.rejects(env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768}), /狀態不明/);
  assert.equal(env.calls.filter(call => call.args?.[0] === 'load').length, loadCount);
});

test('ambiguous load command failure blocks future attempts and is never retried', async () => {
  let count = 0;
  const env = setup({
    runImpl: async (args, options) => {
      if (args[0] === 'load') {
        count++;
        throw new Error('connection lost');
      }
      return {stdout: ''};
    }
  });
  await assert.rejects(env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768}), /結果不明/);
  await assert.rejects(env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768}), /狀態不明/);
  assert.equal(count, 1);
});

test('cancellation before acquisition has no side effects and releases busy', async () => {
  const env = setup();
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(
    env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768, signal: controller.signal}),
    /cancelled/
  );
  assert.equal(env.calls.length, 0);
  const lease = await env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  await lease.finish();
});

test('stopping during load waits for the one native result; confirmed idle ownership remains usable', async () => {
  const controller = new AbortController();
  let models = [row()],
    loads = 0;
  const runtime = createLocalModelRuntime({
    executable: 'lms.exe',
    fetchImpl: async (_url, options) => {
      assert.equal(options.signal.aborted, false);
      return modelResponse(models);
    },
    runImpl: async (args, options) => {
      assert.equal(options?.signal, undefined);
      if (args[0] === 'load') {
        loads++;
        controller.abort();
        models = [row(modelKey, {loaded_instances: [loaded(instanceId)]})];
      }
    }
  });
  const lease = await runtime.acquire({model: modelKey, instanceId, contextWindow: 32768, signal: controller.signal});
  assert.equal(controller.signal.aborted, true);
  await lease.finish();
  const next = await runtime.acquire({model: modelKey, instanceId, contextWindow: 32768});
  assert.equal(loads, 1);
  await next.finish();
});

test('rejects absent key, non-GGUF/non-LLM metadata and context above model maximum', async t => {
  for (const [models, context, expected] of [
    [[row('publisher/different.gguf')], 32768, /找不到確切模型 key/],
    [[row(modelKey, {format: 'mlx'})], 32768, /不是 GGUF LLM/],
    [[row(modelKey, {type: 'embedding'})], 32768, /不是 GGUF LLM/],
    [[row(modelKey, {max_context_length: 16384})], 32768, /最大 context/]
  ]) {
    await t.test(expected.source, async () => {
      const env = setup({models});
      const key = modelKey;
      await assert.rejects(env.runtime.acquire({model: key, instanceId, contextWindow: context}), expected);
      assert.equal(
        env.calls.some(call => call.args?.[0] === 'load'),
        false
      );
    });
  }
});

test('readback mismatch marks manager uncertain and prevents unload/load replay', async () => {
  let loadCount = 0;
  const env = setup({
    runImpl: async args => {
      if (args[0] === 'load') {
        loadCount++;
        env.models = [row(modelKey, {loaded_instances: [loaded(instanceId, 1000, 1)]})];
      }
    }
  });
  await assert.rejects(env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768}), /讀回.*不符/);
  assert.equal(loadCount, 1);
  await assert.rejects(env.runtime.acquire({model: modelKey, instanceId, contextWindow: 32768}), /狀態不明/);
  assert.equal(loadCount, 1);
  assert.equal(
    env.calls.some(call => call.url?.endsWith('/unload')),
    false
  );
});

test('HTTP service errors do not trigger CLI fallback or service startup', async () => {
  const calls = [];
  const runtime = createLocalModelRuntime({
    executable: 'lms.exe',
    fetchImpl: async () => ({ok: false, status: 500}),
    runImpl: async args => {
      calls.push(args);
    }
  });
  await assert.rejects(runtime.catalog(), /HTTP 500/);
  await assert.rejects(runtime.acquire({model: modelKey, instanceId, contextWindow: 32768}), /HTTP 500/);
  assert.deepEqual(calls, []);
});
