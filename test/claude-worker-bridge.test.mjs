import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createLunaBridge} from '../src/luna-bridge.mjs';
import {availableWorkerModels,validateWorkerPolicy} from '../src/worker-policy.mjs';

const workspaceModels=[
 {model:'gpt-6.1-sol',supportedReasoningEfforts:[{reasoningEffort:'high'}]},
 {model:'claude-opus-5-5',supportedReasoningEfforts:[{reasoningEffort:'high'}]},
];
async function fixture({claudeFactory,accessMode='workspace-write',onChange=()=>{},onRequest,workerPolicy={model:'claude-opus-5-5',effort:null}}={}){
 const root=path.resolve('.runtime','claude-bridge-tests',randomUUID());
 const workspace=path.join(root,'workspace');await mkdir(workspace,{recursive:true});
 const bridge=await createLunaBridge({root,workspace,parentId:'parent',geminiOnly:true,accessMode,claudeFactory,onChange,onRequest,workerPolicy});
 return {root,workspace,bridge};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('GPT native catalog accepts GPT and rejects Claude unless its gateway is explicitly enabled',()=>{
 assert.deepEqual(availableWorkerModels(workspaceModels).map(row=>row.model),['gpt-6.1-sol']);
 assert.deepEqual(availableWorkerModels(workspaceModels,{claudeGateway:true}).map(row=>row.model),['gpt-6.1-sol','claude-opus-5-5']);
 assert.doesNotThrow(()=>validateWorkerPolicy({model:'gpt-6.1-sol',effort:'high'},workspaceModels));
 assert.throws(()=>validateWorkerPolicy({model:'claude-opus-5-5',effort:'high'},workspaceModels),/gateway/);
 assert.doesNotThrow(()=>validateWorkerPolicy({model:'claude-opus-5-5',effort:'high'},workspaceModels,{claudeGateway:true}));
});

test('Claude request is durably recorded before run, same requestId deduplicates, and wait wakes on completion',async()=>{
 const entered=deferred(),finish=deferred();let runs=0,observed=[];
 const f=await fixture({onChange:record=>observed.push(record),claudeFactory:()=>({async run({sessionId}){runs++;const saved=JSON.parse(await readFile(path.join(f.root,'.runtime','luna-bridge','parent','job.json'),'utf8'));assert.equal(saved.provider,'claude');assert.match(saved.threadId,/^[0-9a-f-]{36}$/i);assert.equal(sessionId,saved.threadId);entered.resolve();return finish.promise;}})});
  const start=await f.bridge.start({requestId:'job',task:'bounded',model:'claude-opus-5-5',effort:'high'});assert.equal(start.provider,'claude');
  await entered.promise;
  const dup=await f.bridge.start({requestId:'job',task:'bounded',model:'claude-opus-5-5',effort:'high'});assert.equal(dup.requestId,'job');assert.equal(runs,1);
  await assert.rejects(f.bridge.start({requestId:'job',task:'different',model:'claude-opus-5-5',effort:'high'}),/拒絕重送/);
  const waiting=f.bridge.wait({requestId:'job',timeoutMs:2000});finish.resolve({status:'completed',settled:true,output:'done',outputFiles:[],acceptance:'not-reviewed'});
  const result=await waiting;assert.equal(result.status,'completed');assert.equal(result.output,'done');assert.ok(observed.some(record=>record.requestId==='job'&&record.settled));
  const persisted=JSON.parse(await readFile(path.join(f.root,'.runtime','luna-bridge','parent','job.json'),'utf8'));assert.equal(persisted.output,'done');
  await f.bridge.close();
});

test('recovered unowned Claude work remains unresolved and is never replayed',async()=>{
 let runs=0;const f=await fixture({claudeFactory:()=>({run:async()=>{runs++;return {status:'completed',settled:true};}})});
  const directory=path.join(f.root,'.runtime','luna-bridge','parent');await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'old.json'),JSON.stringify({requestId:'old',parentId:'parent',provider:'claude',model:'claude-opus-5-5',effort:'high',status:'running',settled:false,task:'original',workspace:f.workspace,output:'',outputFiles:[]}));
  const record=await f.bridge.inspect({requestId:'old'});assert.equal(record.status,'unresolved');assert.equal(record.executionUnowned,true);
  assert.match(record.error,/未重播/);
  const duplicate=await f.bridge.start({requestId:'old',task:'original',model:'claude-opus-5-5',effort:'high'});assert.equal(duplicate.executionUnowned,true);assert.equal(runs,0);
});

test('omitted manual effort defaults to null for a no-effort native model',async()=>{
 let requested;
 const f=await fixture({workerPolicy:{model:'claude-haiku-4-5-20251001'},claudeFactory:()=>({async run(input){requested=input;return {status:'completed',settled:true,output:'ok',outputFiles:[],acceptance:'not-reviewed'};}})});
 await f.bridge.start({requestId:'manual-null',task:'bounded'});const result=await f.bridge.wait({requestId:'manual-null',timeoutMs:1000});
 assert.equal(result.model,'claude-haiku-4-5-20251001');assert.equal(result.effort,null);assert.equal(requested.effort,null);
 await f.bridge.close();
});

test('explicit null effort overrides both auto and a manual high default without substitution',async()=>{
 for(const workerPolicy of [{model:'auto',effort:'auto'},{model:'claude-opus-5-5',effort:'high'}]){
  let requested;
  const f=await fixture({workerPolicy,claudeFactory:()=>({async run(input){requested=input;return {status:'completed',settled:true,output:'ok',outputFiles:[]};}})});
  const args={requestId:'explicit-null',model:'claude-haiku-4-5-20251001',effort:null,task:'bounded'};
  await f.bridge.start(args);const result=await f.bridge.wait({requestId:args.requestId,timeoutMs:1000});
  assert.equal(requested.effort,null);assert.equal(result.effort,null);
  assert.equal((await f.bridge.start(args)).effort,null);
  await f.bridge.close();
 }
});

test('approval request is recorded while waiting and cleared after an explicit response',async()=>{
 const approval=deferred(),entered=deferred(),observed=[];
 const f=await fixture({onChange:record=>observed.push(record),onRequest:()=>approval.promise,claudeFactory:()=>({async run({onPermission}){entered.resolve();const decision=await onPermission({toolName:'Write',input:{file_path:'note.txt'}});assert.deepEqual(decision,{behavior:'allow'});return {status:'completed',settled:true,output:'ok',outputFiles:[],acceptance:'not-reviewed'};}})});
 await f.bridge.start({requestId:'approval',task:'bounded',model:'claude-opus-5-5',effort:'high'});await entered.promise;
 const running=await f.bridge.inspect({requestId:'approval'});assert.equal(running.waitingForApproval,1);
 assert.ok(observed.some(record=>record.requestId==='approval'&&record.waitingForApproval===1));
 approval.resolve({behavior:'allow'});
 const result=await f.bridge.wait({requestId:'approval',timeoutMs:1000});assert.equal(result.settled,true);assert.equal(result.waitingForApproval,undefined);
 await f.bridge.close();
});

test('cancel confirms settled cancellation; failed close remains unsettled and unknown',async()=>{
 let entered=deferred();
 const f=await fixture({claudeFactory:()=>({run:({signal})=>new Promise(resolve=>{entered.resolve();signal.addEventListener('abort',()=>resolve({status:'cancelled',settled:true,output:'',outputFiles:[],acceptance:'not-reviewed'}),{once:true});})})});
 await f.bridge.start({requestId:'cancel',task:'bounded',model:'claude-opus-5-5',effort:'high'});await entered.promise;const result=await f.bridge.cancel({requestId:'cancel'});assert.equal(result.status,'cancelled');assert.equal(result.settled,true);
 entered=deferred();
 const uncertain=await fixture({claudeFactory:()=>({run:({signal})=>new Promise((resolve,reject)=>{entered.resolve();signal.addEventListener('abort',()=>reject(Object.assign(Error('Claude close failed; do not replay'),{settled:false})),{once:true});})})});
 await uncertain.bridge.start({requestId:'uncertain',task:'bounded',model:'claude-opus-5-5',effort:'high'});await entered.promise;const uncertainResult=await uncertain.bridge.cancel({requestId:'uncertain'});assert.equal(uncertainResult.settled,false);assert.equal(uncertainResult.status,'unresolved');assert.match(uncertainResult.error,/do not replay/);
 await assert.rejects(uncertain.bridge.close(),/尚未確認停止/);
});
