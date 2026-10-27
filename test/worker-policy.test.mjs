import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableWorkerModels,
  MODEL_PROTOCOL_GUIDANCE,
  normalizeWorkerPolicy,
  validateWorkerPolicy,
  workerPolicyConfig
} from '../src/worker-policy.mjs';
test('Gemma routes selected GPT workers through the subscription gateway, never native Gemma defaults', () => {
  const config = workerPolicyConfig(
    {model: 'gpt-6-luna', effort: 'high'},
    {
      provider: 'gemma',
      geminiGateway: true,
      models: [{model: 'gpt-6-luna', supportedReasoningEfforts: [{reasoningEffort: 'high'}]}]
    }
  );
  assert.deepEqual(config.agents, {enabled: true});
  assert.match(config.developer_instructions, /every provider use k_gemini \/ gemini_start/);
  assert.doesNotMatch(config.developer_instructions, /For GPT use native delegation/);
});
test('Gemini main entry delegates every provider through k_luna and may use native agy subagents in-turn', () => {
  const config = workerPolicyConfig(undefined, {
    provider: 'gemini',
    geminiGateway: true,
    claudeGateway: true,
    models: [
      {model: 'gpt-6.1-sol', supportedReasoningEfforts: [{reasoningEffort: 'high'}]},
      {model: 'claude-opus-5-5', supportedReasoningEfforts: [{reasoningEffort: 'high'}]},
      {model: 'gemini-3.8-flash', supportedReasoningEfforts: [{reasoningEffort: 'low'}]}
    ]
  });
  assert.ok(config.developer_instructions.includes(MODEL_PROTOCOL_GUIDANCE));
  assert.match(config.developer_instructions, /any provider use k_luna \/ luna_start/);
  assert.match(config.developer_instructions, /define_subagent \/ invoke_subagent\) run inside the current turn/);
  assert.match(config.developer_instructions, /finish the turn instead of polling/);
  assert.match(config.developer_instructions, /luna_list/);
  assert.match(config.developer_instructions, /gpt-6\.1-sol: high; claude-opus-5-5: high; gemini-3\.8-flash: low/);
  assert.doesNotMatch(config.developer_instructions, /k_gemini|native delegation/);
});
const gptModels = [
  {
    model: 'gpt-6.1-sol',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(reasoningEffort => ({
      reasoningEffort
    }))
  },
  {
    model: 'gpt-6-luna',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'].map(reasoningEffort => ({reasoningEffort}))
  }
];
const models = [
  ...gptModels,
  {
    model: 'gemini-3.8-flash',
    supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({reasoningEffort}))
  },
  {model: 'claude-opus-5-5', supportedReasoningEfforts: [{reasoningEffort: 'high'}]},
  {model: 'claude-haiku-4-5', supportedReasoningEfforts: []}
];

test('model protocol reaches Codex instructions while private role preferences stay out of code', () => {
  for (const policy of [
    undefined,
    {model: 'gpt-6.1-sol', effort: 'high'},
    {model: 'gemini-3.8-flash', effort: 'low'}
  ]) {
    const config = workerPolicyConfig(policy, {models, geminiGateway: true});
    assert.ok(config.developer_instructions.includes(MODEL_PROTOCOL_GUIDANCE));
  }
  // 2026-10-27: who leads, executes or reviews is the owner's private K common memory, not code.
  for (const preference of [
    /Opus 5\.5：通才/,
    /一般工作優先交給 Flash/,
    /取代 Astra 的日常技術主腦/,
    /Flash → Sol → Opus/,
    /Fable 討論 → Opus 統籌/,
    /GPT 額度優先留給病例討論/,
    /多數開發由 Opus 統籌、Flash 執行/,
    /GPT-6 Luna：/,
    /最後必須由真正的 Opus 5\.5 審核/
  ])
    assert.doesNotMatch(MODEL_PROTOCOL_GUIDANCE, preference);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /由 K 共同記憶集中維護/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /共同記憶標示無法讀取時，本人分工偏好視為未知，不以舊版內建分工/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /不持續輪詢|不做短間隔輪詢/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /Claude 主對話派出的 Claude 工人可再派一層/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /其他工人仍不能再派/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /上層工人須等到小工人 settled 並自行檢查成果/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /先確認原工作停止並檢查已有成果，只交接剩餘工作/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /沒有審查管道時如實標示待審/);
  assert.doesNotMatch(MODEL_PROTOCOL_GUIDANCE, /不需要 Gemini 主代理自動派 GPT／Claude|反向派工/);
  // Every rule stays on its own line (a removed line once glued two together).
  assert.match(MODEL_PROTOCOL_GUIDANCE, /不宣稱已完成。\n- Gemini 帳號採逐一使用/);
  assert.equal(MODEL_PROTOCOL_GUIDANCE.match(/。- /gu), null);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /角色不代表已有跨供應商派工能力/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /已保存的手動模型／推理設定優先/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /不增加工具、資料、登入、部署或發布授權/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /持續使用目前帳號，不平均分散、不每項工作輪換/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /5 小時或每週額度已耗盡時，從目前帳號的下一個已保存位置往後循環查詢/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /5 小時用完即可換，不必等週額度耗盡/);
  assert.match(MODEL_PROTOCOL_GUIDANCE, /不同帳號不並行/);
});

test('scheduling waits preserve active goals and use each provider gateway', () => {
  for (const [provider, waitTool] of [['codex', 'gemini_wait'], ['claude', 'luna_wait'], ['gemini', 'luna_wait']]) {
    const config = workerPolicyConfig(undefined, {models, geminiGateway: true, provider});
    assert.ok(config.developer_instructions.includes(`native goal is active and no independent work remains, use ${waitTool} on the returned waitId with timeoutMs omitted`), provider);
    assert.match(config.developer_instructions, /without an active goal, finish the turn and rely on the registered completion event/);
    assert.doesNotMatch(config.developer_instructions, /End the turn on scheduling.waiting;/);
  }
  assert.match(MODEL_PROTOCOL_GUIDANCE, /派工前備齊定稿正文與來源/);
});

test('new worker policy defaults to AI auto and preserves explicit and null native settings', () => {
  assert.deepEqual(normalizeWorkerPolicy(), {model: 'auto', effort: 'auto'});
  assert.deepEqual(normalizeWorkerPolicy({model: 'gpt-6-luna', effort: 'high'}), {model: 'gpt-6-luna', effort: 'high'});
  assert.deepEqual(normalizeWorkerPolicy({model: 'claude-haiku-4-5', effort: null}), {
    model: 'claude-haiku-4-5',
    effort: null
  });
  assert.equal(normalizeWorkerPolicy({model: 'new-model'}).effort, null);
  assert.deepEqual(validateWorkerPolicy(undefined, []), {model: 'auto', effort: 'auto'});
  assert.throws(() => validateWorkerPolicy({model: 'retired', effort: 'high'}, []), /未自動換模/);
  assert.throws(() => validateWorkerPolicy({model: 'auto', effort: 'high'}, models), /必須同時/);
  assert.throws(() => validateWorkerPolicy({model: 'gpt-6-luna', effort: 'auto'}, models), /必須同時/);
});
test('worker choices follow every native catalog model, route and effort rather than a fixed list', () => {
  const rows = [
    ...models,
    {model: 'gpt-future-native', supportedReasoningEfforts: [{reasoningEffort: 'new-effort'}]},
    {model: 'claude-future-native', supportedReasoningEfforts: []},
    {model: 'gemini-future', supportedReasoningEfforts: [{reasoningEffort: 'max'}]},
    {model: 'gpt-hidden', hidden: true},
    {model: 'claude-fable-5-1'},
    {model: 'gpt-unavailable', available: false},
    {model: 'alpaca-5-5'}
  ];
  assert.deepEqual(
    availableWorkerModels(rows).map(row => row.model),
    ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-future-native']
  );
  const routes = {geminiGateway: true, claudeGateway: true};
  // The Gemini main entry reaches every provider through k_luna, like the Claude entry.
  assert.deepEqual(availableWorkerModels(rows, {provider: 'gemini'}), availableWorkerModels(rows, routes));
  assert.equal(availableWorkerModels(rows, routes).length, 9);
  for (const policy of [
    {model: 'gpt-future-native', effort: 'new-effort'},
    {model: 'claude-future-native', effort: null},
    {model: 'claude-fable-5-1', effort: null},
    {model: 'gemini-future', effort: 'max'}
  ])
    assert.deepEqual(validateWorkerPolicy(policy, rows, routes), policy);
  for (const model of ['gpt-hidden', 'gpt-unavailable', 'alpaca-5-5'])
    assert.throws(() => validateWorkerPolicy({model, effort: null}, rows, routes), /未自動換模/);
});
test('auto leaves native GPT defaults unset and supplies the complete routed model/effort catalog', () => {
  const config = workerPolicyConfig(undefined, {
    baseInstructions: 'Keep authority.',
    models,
    geminiGateway: true,
    claudeGateway: true
  });
  assert.deepEqual(config.agents, {enabled: true});
  assert.match(config.developer_instructions, /^Keep authority/);
  for (const row of models) assert(config.developer_instructions.includes(row.model));
  assert.match(config.developer_instructions, /not a K heuristic, failure fallback, or automatic retry/);
  assert.match(config.developer_instructions, /native default \(null\)/);
  assert.match(config.developer_instructions, /k_gemini \/ gemini_start/);
  assert.match(config.developer_instructions, /主代理／子代理是工作角色/);
  assert.match(config.developer_instructions, /不保證總 Token/);
});
test('manual priority keeps GPT native defaults and never advertises discretionary overrides', () => {
  const policy = {model: 'gpt-6.1-sol', effort: 'ultra'},
    config = workerPolicyConfig(policy, {models});
  assert.deepEqual(config.agents, {
    enabled: true,
    default_subagent_model: policy.model,
    default_subagent_reasoning_effort: policy.effort
  });
  assert.match(config.developer_instructions, /Honor this manual choice/);
  assert.doesNotMatch(config.developer_instructions, /You may choose|more appropriate;/);
  for (const row of gptModels)
    for (const {reasoningEffort: effort} of row.supportedReasoningEfforts)
      assert.equal(
        workerPolicyConfig({model: row.model, effort}, {models}).agents.default_subagent_reasoning_effort,
        effort
      );
  assert.throws(() => validateWorkerPolicy({model: 'gpt-6-luna', effort: 'ultra'}, models), /不支援/);
});
test('non-GPT workers require routes and never become native GPT defaults', () => {
  for (const policy of [
    {model: 'gemini-3.8-flash', effort: 'low'},
    {model: 'claude-opus-5-5', effort: 'high'},
    {model: 'claude-haiku-4-5', effort: null}
  ]) {
    assert.throws(() => validateWorkerPolicy(policy, models), /gateway/);
    assert.deepEqual(workerPolicyConfig(policy, {models, geminiGateway: true, claudeGateway: true}).agents, {
      enabled: true
    });
  }
  assert.throws(
    () => validateWorkerPolicy({model: 'gemini-3.8-flash', effort: 'xhigh'}, models, {geminiGateway: true}),
    /不支援/
  );
  assert.throws(
    () => validateWorkerPolicy({model: 'claude-haiku-4-5', effort: 'high'}, models, {claudeGateway: true}),
    /不支援/
  );
  assert.throws(
    () => validateWorkerPolicy({model: 'claude-opus-5-5', effort: null}, models, {claudeGateway: true}),
    /不支援/
  );
});
test('Claude uses the same manual selection through its existing K gateway', () => {
  const config = workerPolicyConfig(
    {model: 'claude-opus-5-5', effort: 'high'},
    {models, provider: 'claude', claudeGateway: true, geminiGateway: true}
  );
  assert.match(config.developer_instructions, /k_luna \/ luna_start/);
  assert.match(
    config.developer_instructions,
    /native Claude Agent remains available for explicitly requested native work/
  );
  assert.match(config.developer_instructions, /Honor this manual choice/);
});
