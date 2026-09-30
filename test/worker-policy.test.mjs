import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkerPolicy,validateWorkerPolicy,workerPolicyConfig} from '../src/worker-policy.mjs';
test('normal workers default to GPT-6 Luna; legacy metadata can be read but not executed',()=>{
 assert.deepEqual(normalizeWorkerPolicy(),{model:'gpt-6-luna',effort:'high'});
 assert.equal(normalizeWorkerPolicy({model:'retired-model'}).model,'retired-model');
 assert.throws(()=>validateWorkerPolicy({model:'retired-model'},[]),/未自動換模/);
 assert.throws(()=>validateWorkerPolicy(undefined,[]),/未自動換模/);
 assert.equal(validateWorkerPolicy(undefined,[{model:'gpt-6-luna'}]).model,'gpt-6-luna');
});
test('worker config preserves authority and fixes native subscription delegation',()=>{
 const config=workerPolicyConfig(undefined,{baseInstructions:'Keep existing authority.'});
 assert.equal(config.agents.default_subagent_model,'gpt-6-luna');
 assert.match(config.developer_instructions,/^Keep existing authority\./);
 assert.match(config.developer_instructions,/Delegation is optional/);
 assert.match(config.developer_instructions,/reasoning effort high/);
 assert.match(config.developer_instructions,/Never switch credentials, models, providers or billing routes/);
 assert.throws(()=>workerPolicyConfig({model:'gpt-6-astra'}),/未自動換模/);
 assert.equal(config.model_provider,undefined);
});

test('Sol and Luna accept every advertised effort without fixing workers to high',()=>{
 const models=[{model:'gpt-6.1-sol',supportedReasoningEfforts:['low','medium','high','xhigh','max','ultra'].map(reasoningEffort=>({reasoningEffort}))},{model:'gpt-6-luna',supportedReasoningEfforts:['low','medium','high','xhigh','max'].map(reasoningEffort=>({reasoningEffort}))}];
 for(const row of models)for(const {reasoningEffort:effort} of row.supportedReasoningEfforts){
  const policy=validateWorkerPolicy({model:row.model,effort},models),config=workerPolicyConfig(policy,{models});
  assert.equal(config.agents.default_subagent_model,row.model);assert.equal(config.agents.default_subagent_reasoning_effort,effort);
  assert.match(config.developer_instructions,/You may choose gpt-6.1-sol or gpt-6-luna/);
 }
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6-luna',effort:'ultra'},models),/不支援/);
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6.1-sol',effort:'imaginary'},models),/不支援/);
});
