import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkerPolicy,validateWorkerPolicy,workerPolicyConfig} from '../src/worker-policy.mjs';
const models=[{model:'gpt-6.1-sol',supportedReasoningEfforts:['low','medium','high','xhigh','max','ultra'].map(reasoningEffort=>({reasoningEffort}))},{model:'gpt-6-luna',supportedReasoningEfforts:['low','medium','high','xhigh','max'].map(reasoningEffort=>({reasoningEffort}))}];

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
 assert.throws(()=>workerPolicyConfig({model:'gpt-6-astra',effort:'high'}),/未自動換模/);
});

test('Sol and Luna accept every advertised effort; unsupported selections are rejected',()=>{
 for(const row of models)for(const {reasoningEffort:effort} of row.supportedReasoningEfforts){
  const policy=validateWorkerPolicy({model:row.model,effort},models),config=workerPolicyConfig(policy,{models});
  assert.equal(config.agents.default_subagent_model,row.model);assert.equal(config.agents.default_subagent_reasoning_effort,effort);
 }
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6-luna',effort:'ultra'},models),/不支援/);
 assert.throws(()=>validateWorkerPolicy({model:'gpt-6.1-sol',effort:'imaginary'},models),/不支援/);
});
