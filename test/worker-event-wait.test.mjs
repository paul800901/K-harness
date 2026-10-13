import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createLunaBridge,lunaResult} from '../src/luna-bridge.mjs';
import {consumeGeminiWaitResult,mergeGeminiHandoff} from '../src/gemini-handoff.mjs';
import {createLunaGateway} from '../src/luna-gateway.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(extra={}){
 await mkdir('.runtime/tests',{recursive:true});const root=await mkdtemp(path.resolve('.runtime/tests/event-wait-'));
 return createLunaBridge({root,workspace:root,parentId:'wait-room',geminiOnly:true,...extra});
}
test('default event wait ignores unchanged quiet reports; caller abort does not cancel or replay worker',{timeout:5000},async()=>{
 let finish,activity,runs=0;const started=Promise.withResolvers();
 const bridge=await setup({watchOptions:{quietMs:30},geminiFactory:()=>({models:async()=>[{model:'gemini-3.8-flash',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],run:async({onStart,onActivity})=>{runs++;onStart(123);activity=onActivity;onActivity({startedAt:Date.now(),lastEventAt:Date.now()});started.resolve();return new Promise(r=>finish=r);}})});
 try{
  await bridge.start({requestId:'job',task:'fake',model:'gemini-3.8-flash',effort:'high'});await started.promise;
  const first=await bridge.wait({requestId:'job'});assert.ok(first.inspection);assert.equal(first.settled,false);
  const abort=new AbortController();let returned=false;
  const waiting=bridge.wait({requestId:'job',signal:abort.signal}).finally(()=>returned=true);const rejection=assert.rejects(waiting,/wait cancelled/);
  await sleep(120);assert.equal(returned,false,'same quiet notice cannot drive a model loop');
  abort.abort(Error('wait cancelled'));await rejection;
  assert.equal((await bridge.inspect({requestId:'job'})).settled,false);assert.equal(runs,1);
  const next=bridge.wait({requestId:'job'});activity({lastEventAt:Date.now(),phase:'tool'});finish({status:'completed',settled:true,output:'late original output'});
  assert.equal((await next).output,'late original output');assert.equal(runs,1);
 }finally{finish?.({status:'completed',settled:true});await bridge.close();}
});

test('account query wait stays inside one tool call until a material result, and source cancellation revokes it',{timeout:5000},async()=>{
 let observer;const bridge=await setup({geminiOptions:{accounts:{observe:async options=>{
  observer=options;options.onHandoff({parentId:options.parentId,requestIds:[],queryIds:[options.requestId],status:'waiting',accountId:'A'});
  return {scheduling:{status:'waiting',notificationRegistered:true,waitId:options.requestId}};
 },cancelWorkerHandoff(){}}}});
 try{
  const info=await bridge.accounts(),id=info.scheduling.waitId;let returned=false;
  const waiting=bridge.wait({requestId:id}).then(r=>{returned=true;return r;});await sleep(40);assert.equal(returned,false);
  observer.onHandoff({parentId:'wait-room',requestIds:[],queryIds:[id],status:'ready',accountId:'B'});
  const result=await lunaResult(await waiting);assert.equal(result.dispatch,'not-started');assert.equal(result.scheduling.status,'ready');assert.equal(result.scheduling.accountId,'B');assert.match(result.instruction,/沒有執行/);
  const next=await bridge.accounts();const abandoned=bridge.wait({requestId:next.scheduling.waitId});const rejection=assert.rejects(abandoned,/來源意圖/);await sleep(10);bridge.cancelGeminiHandoff();await rejection;
  observer.onHandoff({parentId:'wait-room',requestIds:[],queryIds:[next.scheduling.waitId],status:'ready'});
  assert.equal(await bridge.wait({requestId:next.scheduling.waitId,timeoutMs:0}),null,'late event cannot resurrect cancelled wait');
 }finally{await bridge.close();}
});

test('consuming a wait result removes only its matching ready receipt, not independent IDs or later accounts',()=>{
 let value=mergeGeminiHandoff(null,{epoch:0,status:'ready',accountId:'B',requestIds:['a','b'],queryIds:['q']});
 value=mergeGeminiHandoff(value,{epoch:0,status:'waiting',accountId:'B',requestIds:['c'],queryIds:[]});
 assert.deepEqual(consumeGeminiWaitResult(value,'a',{scheduling:{status:'ready',accountId:'old'}}),value);
 value=consumeGeminiWaitResult(value,'a',{scheduling:{status:'ready',accountId:'B'}});assert.deepEqual(value.requestIds,['b']);assert.deepEqual(value.queryIds,['q']);assert(value.events.some(e=>e.requestIds.includes('c')));
});

test('MCP wait default remains pending over HTTP until event; timeout parameter zero stays explicit readback',{timeout:5000},async()=>{
 const gate=Promise.withResolvers(),seen=[];const gateway=await createLunaGateway({geminiOnly:true,bridge:{workerPolicy:{model:'auto'},start:async()=>null,inspect:async()=>null,cancel:async()=>null,wait:async args=>{seen.push(args);return args.timeoutMs===0?{requestId:args.requestId,status:'running',settled:false}:gate.promise;}}});
 const server=gateway.mcpConfig.mcpServers.k_gemini;
 const call=async args=>{const response=await fetch(server.url,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'gemini_wait',arguments:args}})});const text=await response.text();return JSON.parse(text.split('\n').find(line=>line.startsWith('data: ')).slice(6));};
 try{
  let returned=false;const pending=call({requestId:'job'}).then(r=>{returned=true;return r;});await sleep(80);assert.equal(returned,false);assert.equal(seen[0].timeoutMs,null);assert.ok(seen[0].signal instanceof AbortSignal);
  gate.resolve({requestId:'job',status:'completed',settled:true,output:'done'});assert.equal((await pending).result.structuredContent.output,'done');
  assert.equal((await call({requestId:'job',timeoutMs:0})).result.structuredContent.settled,false);
 }finally{gate.resolve(null);await gateway.close();}
});


test('account read cancelled during its async observation cannot return stale wait authorization',async()=>{
 const begun=Promise.withResolvers(),finish=Promise.withResolvers();
 const bridge=await setup({geminiOptions:{accounts:{observe:async options=>{begun.resolve(options);return finish.promise;},cancelWorkerHandoff(){}}}});
 try{
  const query=bridge.accounts(),rejected=assert.rejects(query,/來源已變更/);const observer=await begun.promise;bridge.cancelGeminiHandoff();
  observer.onHandoff({parentId:observer.parentId,requestIds:[],queryIds:[observer.requestId],status:'waiting'});
  finish.resolve({scheduling:{status:'waiting',notificationRegistered:true,waitId:observer.requestId}});await rejected;
  assert.equal(await bridge.wait({requestId:observer.requestId,timeoutMs:0}),null);
 }finally{finish.resolve({});await bridge.close();}
});

test('unchanged approval does not spin event waits; a new concurrent approval and completion still wake',{timeout:5000},async()=>{
 const started=Promise.withResolvers(),finished=Promise.withResolvers(),decisions=[];let ask,runs=0;
 const bridge=await setup({onRequest:()=>{const gate=Promise.withResolvers();decisions.push(gate);return gate.promise;},claudeFactory:()=>({run:async({onStart,onPermission})=>{runs++;onStart(123);ask=()=>onPermission({toolName:'Read',input:{file_path:'fake'}});started.resolve();return finished.promise;}})});
 try{
  await bridge.start({requestId:'approval-job',task:'fake',model:'claude-opus-5-5',effort:null});await started.promise;
  const first=bridge.wait({requestId:'approval-job'});await sleep(20);const permission1=ask();assert.equal((await first).waitingForApproval,1);
  let returned=false;const second=bridge.wait({requestId:'approval-job'}).then(value=>{returned=true;return value;});await sleep(60);assert.equal(returned,false,'unchanged approval must stay in one pending tool call');
  const permission2=ask();assert.equal((await second).waitingForApproval,2,'a second actual request is new information');
  let finalReturned=false;const last=bridge.wait({requestId:'approval-job'}).then(value=>{finalReturned=true;return value;});await sleep(40);assert.equal(finalReturned,false);
  decisions[0].resolve({behavior:'deny'});await permission1;decisions[1].resolve({behavior:'deny'});await permission2;await sleep(30);assert.equal(finalReturned,false,'approval resolution alone is not job completion');
  finished.resolve({status:'completed',settled:true,output:'original result'});assert.equal((await last).output,'original result');assert.equal(runs,1);
 }finally{for(const gate of decisions)gate.resolve({behavior:'deny'});finished.resolve({status:'completed',settled:true});await bridge.close();}
});
