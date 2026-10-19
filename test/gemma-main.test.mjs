import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {scratchBase} from './scratch.mjs';
import {loadGemmaConnections} from '../src/gemma-main.mjs';
import {modelProvider, gemmaConnection, usesCodexCore} from '../shared/model-provider.mjs';
import {availableWorkerModels} from '../src/worker-policy.mjs';

test('two main Gemma endpoints have distinct native homes, honest availability and no fabricated GPT capabilities', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'gemma-'));
  const urls = [];
  const connections = await loadGemmaConnections(root, {
    fetchImpl: async url => {
      urls.push(url);
      if (url.includes('18080')) throw new Error('no rented server');
      return {ok: true, json: async () => ({data: [{id: 'gemma-4-12b-it-qat'}]})};
    }
  });
  const [local, cloud] = connections;
  assert.notEqual(local.home, cloud.home);
  const localRow = (await local.models()).models[0];
  assert.equal(localRow.available, true);
  assert.equal((await cloud.models()).models[0].available, false);
  assert.deepEqual(localRow.supportedReasoningEfforts, []);
  assert.deepEqual(localRow.serviceTiers, []);
  assert.equal(modelProvider(local.model), 'gemma');
  assert.equal(gemmaConnection(cloud.model), 'cloud');
  assert.equal(usesCodexCore('gemma'), true);
  assert.equal(modelProvider('gemini-3.8-flash'), 'gemini');
  assert.throws(() => local.nativeModel(cloud.model), /不符/);
  assert.equal(availableWorkerModels([localRow]).length, 0);
  assert.throws(() => local.configOverrides(), /尚未準備完成/);
  await local.prepare();
  const entry = JSON.parse(await readFile(path.join(local.home, 'model-catalog.json'), 'utf8')).models[0];
  assert.equal(entry.slug, 'gemma-4-12b-it-qat');
  assert.equal(entry.context_window, 32768);
  assert.equal(entry.use_responses_lite, false);
  assert.equal(
    local.configOverrides().some(x => x.includes('requires_openai_auth=false')),
    true
  );
  assert.deepEqual(urls, ['http://127.0.0.1:1234/v1/models', 'http://127.0.0.1:18080/v1/models']);
  await local.close();
  assert.throws(() => local.configOverrides(), /尚未準備完成/);
  await local.prepare();
  assert(local.configOverrides().some(value => value.includes('http_headers={Authorization=')));
  await local.close();
});

test('Gemma missing model is unavailable; cloud ID may include a namespace and cancellation is not swallowed', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'gemma-config-'));
  await mkdir(path.join(root, '.runtime'));
  await writeFile(path.join(root, '.runtime/gemma-main.json'), JSON.stringify({cloud: {model: 'google/gemma-custom'}}));
  const connections = await loadGemmaConnections(root, {
    fetchImpl: async () => ({ok: true, json: async () => ({data: []})})
  });
  assert.equal(connections[1].nativeModel('gemma-cloud/google/gemma-custom'), 'google/gemma-custom');
  assert.match((await connections[0].models()).models[0].description, /未提供模型/);
  const cancelled = await loadGemmaConnections(root, {
    fetchImpl: async () => {
      throw new Error('aborted');
    }
  });
  await assert.rejects(cancelled[0].models({signal: AbortSignal.abort()}), /abort/i);
});

test('self-hosted community models get stable IDs, own homes and real names while Gemma defaults stay unchanged', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'selfhost-'));
  await mkdir(path.join(root, '.runtime'));
  await writeFile(
    path.join(root, '.runtime/gemma-main.json'),
    JSON.stringify({
      selfHosted: [
        {id: 'qwen-a', label: 'Qwen3.8 27B Abliterated', location: 'local', model: 'qwen3.8-27b-abliterated'},
        {id: 'mistral-b', label: 'Dolphin Mistral 24B', location: 'local', model: 'dolphin', contextWindow: 16384}
      ]
    })
  );
  const connections = await loadGemmaConnections(root, {
    fetchImpl: async () => ({ok: true, json: async () => ({data: [{id: 'qwen3.8-27b-abliterated'}]})})
  });
  const [local, cloud, qwen, mistral] = connections;
  assert.equal(local.model, 'gemma-local/gemma-4-12b-it-qat');
  assert.equal(local.home, path.join(root, '.runtime', 'gemma-local-home'));
  assert.equal(cloud.model, 'gemma-cloud/gemma-4-12b-qat-bf16');
  assert.equal(qwen.model, 'selfhost-qwen-a/qwen3.8-27b-abliterated');
  assert.equal(qwen.home, path.join(root, '.runtime', 'selfhost-qwen-a-home'));
  assert.equal(new Set(connections.map(c => c.home)).size, 4);
  assert.equal(new Set(connections.map(c => c.slot)).size, 4);
  assert.deepEqual(
    connections.map(c => gemmaConnection(c.model)),
    connections.map(c => c.slot)
  );
  assert.equal(modelProvider(qwen.model), 'gemma');
  assert.throws(() => qwen.nativeModel(mistral.model), /不符/);
  assert.equal(qwen.nativeModel(qwen.model), 'qwen3.8-27b-abliterated');
  const qwenRow = (await qwen.models()).models[0];
  assert.equal(qwenRow.displayName, 'Qwen3.8 27B Abliterated · 本機');
  assert.equal(qwenRow.available, true);
  assert.doesNotMatch(qwenRow.displayName, /Gemma/);
  assert.equal((await mistral.models()).models[0].available, false);
  assert.equal(availableWorkerModels([qwenRow]).length, 0);
  await Promise.all([qwen.prepare(), mistral.prepare()]);
  const entry = JSON.parse(await readFile(path.join(mistral.home, 'model-catalog.json'), 'utf8')).models[0];
  assert.equal(entry.slug, 'dolphin');
  assert.equal(entry.display_name, 'Dolphin Mistral 24B · 本機');
  assert.equal(entry.context_window, 16384);
  const route = c => c.configOverrides().find(x => x.startsWith('model_providers.k_gemma='));
  assert.notEqual(route(qwen), route(mistral));
  assert(qwen.configOverrides().includes('model="qwen3.8-27b-abliterated"'));
  await Promise.all([qwen.close(), mistral.close()]);
  for (const selfHosted of [
    [
      {id: 'dup', label: 'A', location: 'local', model: 'a'},
      {id: 'dup', label: 'B', location: 'local', model: 'b'}
    ],
    [{id: 'x', label: 'X', location: 'mars', model: 'x'}],
    [{id: 'Bad ID', label: 'X', location: 'local', model: 'x'}],
    [{id: 'x', label: 'X', location: 'cloud', model: 'x', baseUrl: 'https://example.com/v1'}],
    [{id: 'x', location: 'local', model: 'x'}],
    [{id: 'x'.repeat(64), label: 'X', location: 'local', model: 'm'.repeat(190)}]
  ]) {
    await writeFile(path.join(root, '.runtime/gemma-main.json'), JSON.stringify({selfHosted}));
    const fallback = await loadGemmaConnections(root, {fetchImpl: async () => assert.fail('no request')});
    assert.deepEqual(
      fallback.map(c => c.slot),
      ['local', 'cloud']
    );
    assert.equal((await fallback[0].models()).models[0].available, false);
  }
});
