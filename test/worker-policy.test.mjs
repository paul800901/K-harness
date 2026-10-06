import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_ROLE_GUIDANCE,normalizeWorkerPolicy,validateWorkerPolicy,workerPolicyConfig} from '../src/worker-policy.mjs';
const models=[{model:'gpt-6.1-sol',supportedReasoningEfforts:['low','medium','high','xhigh','max','ultra'].map(reasoningEffort=>({reasoningEffort}))},{model:'gpt-6-luna',supportedReasoningEfforts:['low','medium','high','xhigh','max'].map(reasoningEffort=>({reasoningEffort}))}];

test('user model roles reach Codex instructions without changing manual defaults or granting new capabilities',()=>{
 for(const policy of [undefined,{model:'gpt-6.1-sol',effort:'high'},{model:'gemini-3.8-flash',effort:'low'}]){
  const config=workerPolicyConfig(policy,{models,geminiGateway:true});
  assert.ok(config.developer_instructions.includes(MODEL_ROLE_GUIDANCE));
 }
 assert.match(MODEL_ROLE_GUIDANCE,/Astra：非日常必要步驟；只有使用者明確選用且實際可用/);
 assert.match(MODEL_ROLE_GUIDANCE,/Opus 5\.5：通才、平常的大腦/);
 assert.match(MODEL_ROLE_GUIDANCE,/一般工作優先交給 Flash/);
 assert.match(MODEL_ROLE_GUIDANCE,/Google 商家/);
 assert.match(MODEL_ROLE_GUIDANCE,/GPT-6\.1 Sol：取代 Astra 的日常技術主腦/);
 assert.match(MODEL_ROLE_GUIDANCE,/不持續輪詢進度/);
 assert.match(MODEL_ROLE_GUIDANCE,/仍有實質進展就可繼續；不設固定失敗次數/);
 assert.match(MODEL_ROLE_GUIDANCE,/Flash → Sol → Opus/);
 assert.match(MODEL_ROLE_GUIDANCE,/Claude 派出的 Sol 子代理目前不能再派 Flash/);
 assert.match(MODEL_ROLE_GUIDANCE,/Luna：除非使用者明確指定，僅在小任務對規則遵守有極高要求/);
 assert.match(MODEL_ROLE_GUIDANCE,/Sol 寫的程式碼，最後必須由真正的 Opus 5\.5 審核/);
 assert.match(MODEL_ROLE_GUIDANCE,/待 Opus 5\.5 審核/);
 assert.match(MODEL_ROLE_GUIDANCE,/不是它說了算/);
 assert.match(MODEL_ROLE_GUIDANCE,/不必要架構、重複檢查/);
 assert.match(MODEL_ROLE_GUIDANCE,/不需要 Gemini 主代理自動派 GPT／Claude/);
 assert.match(MODEL_ROLE_GUIDANCE,/角色不代表已有跨供應商派工能力/);
 assert.match(MODEL_ROLE_GUIDANCE,/已保存的手動模型／推理設定優先/);
 assert.match(MODEL_ROLE_GUIDANCE,/不增加工具、資料、登入、部署或發布授權/);
 assert.match(MODEL_ROLE_GUIDANCE,/持續使用目前帳號，不平均分散、不每項工作輪換/);
 assert.match(MODEL_ROLE_GUIDANCE,/5 小時或每週額度已耗盡時，從目前帳號的下一個已保存位置往後循環查詢/);
 assert.match(MODEL_ROLE_GUIDANCE,/5 小時用完即可換，不必等週額度耗盡/);
 assert.match(MODEL_ROLE_GUIDANCE,/不同帳號不並行/);
});

test('new worker policy defaults to AI auto while saved explicit preferences remain intact',()=>{
 assert.deepEqual(normalizeWorkerPolicy(),{model:'auto',effort:'auto'});
 assert.deepEqual(normalizeWorkerPolicy({model:'gpt-6-luna',effort:'high'}),{model:'gpt-6-luna',effort:'high'});
 assert.deepEqual(normalizeWorkerPolicy({model:'gpt-6.1-sol'}),{model:'gpt-6.1-sol',effort:'high'});
 assert.equal(normalizeWorkerPolicy({model:'retired-model'}).model,'retired-model');
 assert.deepEqual(validateWorkerPolicy(undefined,[]),{model:'auto',effort:'auto'});
 assert.throws(()=>validateWorkerPolicy({model:'retired-model',effort:'high'},[]),/未自動換模/);
 assert.throws(()=>validateWorkerPolicy({model:'auto',effort:'high'},models),/必須同時/);
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6-luna',effort:'auto'},models),/必須同時/);
});

test('Codex auto policy delegates model and effort selection to the main AI, without native fixed defaults',()=>{
 const config=workerPolicyConfig(undefined,{baseInstructions:'Keep existing authority.',models});
 assert.deepEqual(config.agents,{enabled:true});
 assert.match(config.developer_instructions,/^Keep existing authority\./);
 assert.match(config.developer_instructions,/choose gpt-6\.1-sol or gpt-6-luna/);
 assert.match(config.developer_instructions,/Pass both choices explicitly/);
 assert.match(config.developer_instructions,/not a K heuristic, failure fallback, or automatic retry/);
 assert.match(config.developer_instructions,/gpt-6-luna: low, medium, high, xhigh, max/);
 assert.match(config.developer_instructions,/Never switch credentials, models, providers or billing routes/);
 assert.equal(config.agents.default_subagent_model,undefined);
 assert.equal(config.agents.default_subagent_reasoning_effort,undefined);
});

test('explicit manual defaults remain configured and can still be overridden task by task',()=>{
 const config=workerPolicyConfig({model:'gpt-6.1-sol',effort:'ultra'},{models});
 assert.deepEqual(config.agents,{enabled:true,default_subagent_model:'gpt-6.1-sol',default_subagent_reasoning_effort:'ultra'});
 assert.match(config.developer_instructions,/Default native subagent: gpt-6\.1-sol, reasoning effort ultra/);
 assert.throws(()=>workerPolicyConfig({model:'gpt-6-astra',effort:'high'},{models}),/未自動換模/);
});

test('Sol and Luna accept every advertised effort; unsupported selections are rejected',()=>{
 for(const row of models)for(const {reasoningEffort:effort} of row.supportedReasoningEfforts){
  const policy=validateWorkerPolicy({model:row.model,effort},models),config=workerPolicyConfig(policy,{models});
  assert.equal(config.agents.default_subagent_model,row.model);assert.equal(config.agents.default_subagent_reasoning_effort,effort);
 }
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6-luna',effort:'ultra'},models),/不支援/);
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6.1-sol',effort:'imaginary'},models),/不支援/);
});

test('Gemini Flash is accepted only with an explicitly enabled gateway and never becomes a native GPT default',()=>{
 for(const effort of ['low','medium','high']){
  const policy={model:'gemini-3.8-flash',effort};
  assert.throws(()=>validateWorkerPolicy(policy,models),/gateway/);
  assert.deepEqual(validateWorkerPolicy(policy,models,{geminiGateway:true}),policy);
  const config=workerPolicyConfig(policy,{models,geminiGateway:true});
  assert.deepEqual(config.agents,{enabled:true});
  assert.equal(config.agents.default_subagent_model,undefined);
  assert.match(config.developer_instructions,/k_gemini/);
  assert.match(config.developer_instructions,/gemini_start、gemini_list、gemini_inspect、gemini_wait、gemini_cancel、gemini_accounts/);
  assert.match(config.developer_instructions,/accountId\/handoffFrom/);
  assert.match(config.developer_instructions,/inspect the original result first/);
  assert.match(config.developer_instructions,/Do not replay unknown failures/);
  assert.match(config.developer_instructions,/do not change GPT accounts or subscription/);
  assert.throws(()=>validateWorkerPolicy(policy,models),/gateway/);
 }
 assert.throws(()=>validateWorkerPolicy({model:'gemini-3.8-flash',effort:'xhigh'},models,{geminiGateway:true}),/low、medium 或 high/);
});

test('Codex auto policy exposes Flash only when its Gemini gateway is enabled',()=>{
 const config=workerPolicyConfig(undefined,{models,geminiGateway:true});
 assert.match(config.developer_instructions,/gpt-6\.1-sol or gpt-6-luna or gemini-3\.8-flash/);
 assert.match(config.developer_instructions,/For Flash, use low, medium, or high/);
 assert.match(config.developer_instructions,/k_gemini/);
 const legacy=workerPolicyConfig(undefined,{models});
 assert.doesNotMatch(legacy.developer_instructions,/gemini-3\.8-flash/);
 assert.doesNotMatch(legacy.developer_instructions,/k_gemini|For Flash/u);
 assert.throws(()=>workerPolicyConfig({model:'gemini-3.8-flash',effort:'high'},{models}),/gateway/);
});
