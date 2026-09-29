import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkerPolicy,validateWorkerPolicy,workerPolicyConfig} from '../src/worker-policy.mjs';
test('normal workers default to GPT-6 Luna; legacy metadata can be read but not executed',()=>{
 assert.deepEqual(normalizeWorkerPolicy(),{model:'gpt-6-luna',imageModel:'gpt-6-luna'});
 assert.equal(normalizeWorkerPolicy({model:'deepseek-v4-flash'}).model,'deepseek-v4-flash');
 assert.throws(()=>validateWorkerPolicy({model:'deepseek-v4-flash'},[]),/未自動換模/);
 assert.throws(()=>validateWorkerPolicy(undefined,[]),/未自動換模/);
 assert.equal(validateWorkerPolicy(undefined,[{model:'gpt-6-luna'}]).model,'gpt-6-luna');
});
test('worker config preserves authority and fixes native subscription delegation',()=>{
 const config=workerPolicyConfig(undefined,{baseInstructions:'Keep existing authority.'});
 assert.equal(config.agents.default_subagent_model,'gpt-6-luna');
 assert.match(config.developer_instructions,/^Keep existing authority\./);
 assert.match(config.developer_instructions,/Delegation is optional/);
 assert.match(config.developer_instructions,/reasoning effort high/);
 assert.match(config.developer_instructions,/not a normal worker or automatic fallback/);
 assert.throws(()=>workerPolicyConfig({model:'gpt-6-astra'}),/未自動換模/);
 assert.equal(config.model_provider,undefined);
});
