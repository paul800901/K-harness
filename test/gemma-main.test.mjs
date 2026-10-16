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
