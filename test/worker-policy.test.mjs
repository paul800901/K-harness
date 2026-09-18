import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkerPolicy,validateWorkerPolicy,workerPolicyConfig} from '../src/worker-policy.mjs';

test('worker choice defaults to Flash independently of the main model; delegated vision is fixed to Luna',()=>{
 assert.deepEqual(normalizeWorkerPolicy(),{model:'deepseek-v4-flash',imageModel:'gpt-5.6-luna'});
 const policy=normalizeWorkerPolicy({model:'gpt-5.6-terra',imageModel:'deepseek-v4-flash'});
 assert.equal(policy.imageModel,'gpt-5.6-luna');
 assert.equal(validateWorkerPolicy(policy,[{model:'gpt-5.6-terra'}]).model,'gpt-5.6-terra');
 assert.throws(()=>validateWorkerPolicy(policy,[]),/未自動換模/);
});

test('native workers retain subscription routing and instructions without giving DeepSeek to Codex',()=>{
 const flash=workerPolicyConfig(undefined,{baseInstructions:'Keep existing authority.'});
 assert.equal(flash.agents.default_subagent_model,'gpt-5.6-luna');
 assert.match(flash.developer_instructions,/^Keep existing authority\./);
 assert.match(flash.developer_instructions,/Delegation is optional/);
 assert.match(flash.developer_instructions,/Never delegate image interpretation to Flash/);
 assert.equal(workerPolicyConfig({model:'gpt-6-astra'}).agents.default_subagent_model,'gpt-6-astra');
 assert.equal(flash.sandbox,undefined);
 assert.equal(flash.model_provider,undefined);
});
