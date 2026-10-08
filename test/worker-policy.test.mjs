import test from 'node:test';
import assert from 'node:assert/strict';
import {availableWorkerModels,MODEL_ROLE_GUIDANCE,normalizeWorkerPolicy,validateWorkerPolicy,workerPolicyConfig} from '../src/worker-policy.mjs';
const gptModels=[{model:'gpt-6.1-sol',supportedReasoningEfforts:['low','medium','high','xhigh','max','ultra'].map(reasoningEffort=>({reasoningEffort}))},{model:'gpt-6-luna',supportedReasoningEfforts:['low','medium','high','xhigh','max'].map(reasoningEffort=>({reasoningEffort}))}];
const models=[...gptModels,{model:'gemini-3.8-flash',supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))},{model:'claude-opus-5-5',supportedReasoningEfforts:[{reasoningEffort:'high'}]},{model:'claude-haiku-4-5',supportedReasoningEfforts:[]}];

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


test('new worker policy defaults to AI auto and preserves explicit and null native settings',()=>{
 assert.deepEqual(normalizeWorkerPolicy(),{model:'auto',effort:'auto'});
 assert.deepEqual(normalizeWorkerPolicy({model:'gpt-6-luna',effort:'high'}),{model:'gpt-6-luna',effort:'high'});
 assert.deepEqual(normalizeWorkerPolicy({model:'claude-haiku-4-5',effort:null}),{model:'claude-haiku-4-5',effort:null});
 assert.equal(normalizeWorkerPolicy({model:'new-model'}).effort,null);
 assert.deepEqual(validateWorkerPolicy(undefined,[]),{model:'auto',effort:'auto'});
 assert.throws(()=>validateWorkerPolicy({model:'retired',effort:'high'},[]),/未自動換模/);
 assert.throws(()=>validateWorkerPolicy({model:'auto',effort:'high'},models),/必須同時/);
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6-luna',effort:'auto'},models),/必須同時/);
});
test('worker choices follow every native catalog model, route and effort rather than a fixed list',()=>{
 const rows=[...models,{model:'gpt-future-native',supportedReasoningEfforts:[{reasoningEffort:'new-effort'}]},{model:'claude-future-native',supportedReasoningEfforts:[]},{model:'gemini-future',supportedReasoningEfforts:[{reasoningEffort:'max'}]},{model:'gpt-hidden',hidden:true},{model:'claude-fable-5-1'},{model:'gpt-unavailable',available:false},{model:'alpaca-5-5'}];
 assert.deepEqual(availableWorkerModels(rows).map(row=>row.model),['gpt-6.1-sol','gpt-6-luna','gpt-future-native']);
 const routes={geminiGateway:true,claudeGateway:true};
 assert.deepEqual(availableWorkerModels(rows,{...routes,provider:'gemini'}),[]);
 assert.equal(availableWorkerModels(rows,routes).length,8);
 for(const policy of [{model:'gpt-future-native',effort:'new-effort'},{model:'claude-future-native',effort:null},{model:'gemini-future',effort:'max'}])assert.deepEqual(validateWorkerPolicy(policy,rows,routes),policy);
 for(const model of ['gpt-hidden','claude-fable-5-1','gpt-unavailable','alpaca-5-5'])assert.throws(()=>validateWorkerPolicy({model,effort:null},rows,routes),/未自動換模/);
});
test('auto leaves native GPT defaults unset and supplies the complete routed model/effort catalog',()=>{
 const config=workerPolicyConfig(undefined,{baseInstructions:'Keep authority.',models,geminiGateway:true,claudeGateway:true});
 assert.deepEqual(config.agents,{enabled:true});assert.match(config.developer_instructions,/^Keep authority/);
 for(const row of models)assert(config.developer_instructions.includes(row.model));
 assert.match(config.developer_instructions,/not a K heuristic, failure fallback, or automatic retry/);
 assert.match(config.developer_instructions,/native default \(null\)/);
 assert.match(config.developer_instructions,/k_gemini \/ gemini_start/);
 assert.match(config.developer_instructions,/主代理／子代理是工作角色/);
 assert.match(config.developer_instructions,/不保證總 Token/);
});
test('manual priority keeps GPT native defaults and never advertises discretionary overrides',()=>{
 const policy={model:'gpt-6.1-sol',effort:'ultra'},config=workerPolicyConfig(policy,{models});
 assert.deepEqual(config.agents,{enabled:true,default_subagent_model:policy.model,default_subagent_reasoning_effort:policy.effort});
 assert.match(config.developer_instructions,/Honor this manual choice/);
 assert.doesNotMatch(config.developer_instructions,/You may choose|more appropriate;/);
 for(const row of gptModels)for(const {reasoningEffort:effort} of row.supportedReasoningEfforts)assert.equal(workerPolicyConfig({model:row.model,effort},{models}).agents.default_subagent_reasoning_effort,effort);
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6-luna',effort:'ultra'},models),/不支援/);
});
test('non-GPT workers require routes and never become native GPT defaults',()=>{
 for(const policy of [{model:'gemini-3.8-flash',effort:'low'},{model:'claude-opus-5-5',effort:'high'},{model:'claude-haiku-4-5',effort:null}]){
  assert.throws(()=>validateWorkerPolicy(policy,models),/gateway/);
  assert.deepEqual(workerPolicyConfig(policy,{models,geminiGateway:true,claudeGateway:true}).agents,{enabled:true});
 }
 assert.throws(()=>validateWorkerPolicy({model:'gemini-3.8-flash',effort:'xhigh'},models,{geminiGateway:true}),/不支援/);
 assert.throws(()=>validateWorkerPolicy({model:'claude-haiku-4-5',effort:'high'},models,{claudeGateway:true}),/不支援/);
 assert.throws(()=>validateWorkerPolicy({model:'claude-opus-5-5',effort:null},models,{claudeGateway:true}),/不支援/);
});
test('Claude uses the same manual selection through its existing K gateway',()=>{
 const config=workerPolicyConfig({model:'claude-opus-5-5',effort:'high'},{models,provider:'claude',claudeGateway:true,geminiGateway:true});
 assert.match(config.developer_instructions,/k_luna \/ luna_start/);
 assert.match(config.developer_instructions,/native Claude Agent remains available for explicitly requested native work/);
 assert.match(config.developer_instructions,/Honor this manual choice/);
});
