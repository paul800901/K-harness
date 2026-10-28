import test from 'node:test';
import assert from 'node:assert/strict';
import {antigravityModelNames} from '../shared/antigravity-models.mjs';
import {modelProvider} from '../shared/model-provider.mjs';
import {geminiModelsFrom} from '../src/gemini-controller.mjs';
import {availableWorkerModels, workerPolicyConfig} from '../src/worker-policy.mjs';

test('agy catalogs preserve every core model without colliding with other subscriptions', () => {
  const names = antigravityModelNames(
    'Fetching available models...\n' +
      [
        'gemini-3.8-flash-high\tFlash',
        'claude-sonnet-4-6\tSonnet (Thinking)',
        'claude-opus-4-6-thinking\tOpus (Thinking)',
        'gpt-oss-120b-medium\tGPT-OSS (Medium)',
        'future-native-ultra  Future',
        'gpt-oss-120b-medium\tDuplicate'
      ].join('\n')
  );
  const catalog = geminiModelsFrom(names);
  const ids = [
    'gemini-3.8-flash',
    'antigravity:claude-sonnet-4-6',
    'antigravity:claude-opus-4-6-thinking',
    'antigravity:gpt-oss-120b',
    'antigravity:future-native-ultra'
  ];
  assert.deepEqual(
    catalog.map(m => m.model),
    ids
  );
  assert.deepEqual(catalog[1].supportedReasoningEfforts, []);
  assert.equal(catalog[1].nativeModels.default, 'claude-sonnet-4-6');
  assert.equal(catalog[1].displayName, 'Claude Sonnet 4.6（Antigravity）');
  assert.equal(catalog[3].displayName, 'GPT-OSS 120B（Antigravity）');
  assert.equal(catalog[3].nativeModels.medium, 'gpt-oss-120b-medium');
  assert.equal(catalog[4].nativeModels.default, 'future-native-ultra');
  assert.deepEqual(catalog[4].supportedReasoningEfforts, []);
  for (const row of catalog) assert.equal(modelProvider(row.model), 'gemini');
  assert.equal(modelProvider('claude-sonnet-4-6'), 'claude');
  assert.equal(modelProvider('gpt-6.1-sol'), 'codex');
  for (const provider of ['codex', 'claude', 'gemini']) {
    assert.deepEqual(
      availableWorkerModels(catalog, {provider, geminiGateway: true}).map(m => m.model),
      ids
    );
    for (const row of catalog) {
      const config = workerPolicyConfig(
        {model: row.model, effort: row.defaultReasoningEffort},
        {provider, models: catalog, geminiGateway: true}
      );
      assert.equal(config.agents.default_subagent_model, undefined);
    }
  }
  assert.deepEqual(availableWorkerModels(catalog), []);
});
