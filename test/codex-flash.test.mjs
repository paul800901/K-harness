import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {listMainSessions,saveMainSession} from '../src/main-sessions.mjs';
import {MODEL_ROLE_GUIDANCE} from '../src/worker-policy.mjs';

async function fixture({accessMode='workspace-write',savedSession,root:existingRoot,workerPolicy={model:'gpt-6-luna',effort:'high'},cancelSettles=true,delayToolOutput=false,rejectToolOutput=false}={}){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=existingRoot??await mkdtemp(path.join(base,'codex-flash-'));
 if(savedSession)await saveMainSession(root,{threadId:'codex-parent',model:'gpt-6-astra',workspace:root,accessMode,workerPolicy,workerNotifications:{},...savedSession});
 const calls=[],hostOptions=[],hosts=[],gatewayOptions=[],bridgeOptions=[],workerRecords=new Map();let hostCloseCount=0,gatewayCloseCount=0,bridgeCloseCount=0,resolveToolOutput,releaseToolOutput;const toolOutputSent=new Promise(resolve=>{resolveToolOutput=resolve;}),toolOutputGate=new Promise(resolve=>{releaseToolOutput=resolve;});
 const newHost=options=>{let onHostClose,droppedTurn=false,recoveredInterrupted=false;const host={closed:new Promise(resolve=>{onHostClose=resolve;}),notify(){},waitForMcp:async()=>{},close:async()=>{if(options.onEvent)hostCloseCount++;onHostClose();},request:async(method,params)=>{
  calls.push({method,params});
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='model/list')return {data:[
   {model:'gpt-6-astra',displayName:'GPT-6 Astra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text']},
   {model:'gpt-6-luna',displayName:'GPT-6 Luna',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text']},
  ],nextCursor:null};
  if(method==='thread/start'||method==='thread/resume')return {thread:{id:params.threadId??'codex-parent'}};
  if(method==='thread/read'&&droppedTurn&&!recoveredInterrupted)return {thread:{id:params.threadId,status:{type:'active'},turns:[{id:'unconfirmed-completion-turn',status:'inProgress',items:[]}]}};
  if(method==='thread/read')return params.threadId==='child-gpt'?{thread:{id:'child-gpt',parentThreadId:'codex-parent',cwd:root,status:{type:'idle'},turns:[{id:'child-turn',status:'completed',items:[]}]}}:{thread:{id:params.threadId,cwd:root,status:{type:'idle'},turns:[]}};
  if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
  if(method==='windowsSandbox/readiness')return {status:'ready'};
  if(method==='turn/start'&&params.toolOutput){resolveToolOutput(params);if(delayToolOutput)await toolOutputGate;if(rejectToolOutput){droppedTurn=true;throw new Error('fixture transport dropped after send');}return {turn:{id:`turn-${calls.filter(x=>x.method==='turn/start').length}`}};}
  if(method==='turn/start')return {turn:{id:`turn-${calls.filter(x=>x.method==='turn/start').length}`}};
  if(method==='turn/interrupt'){recoveredInterrupted=true;return {};}
  if(method==='account/rateLimits/read')return {};
  return {};
 }};hosts.push(host);hostOptions.push(options);return host;};
 const c=createDesktopController({root,executable:'fixture-codex',hostFactory:newHost,workerPolicy,
  bridgeFactory:async options=>{bridgeOptions.push(options);return {
   start:async args=>{const record={requestId:args.requestId,provider:'gemini',parentId:options.parentId,workspace:options.workspace,status:'running',settled:false,output:'',...args};workerRecords.set(args.requestId,record);options.onChange(record);return structuredClone(record);},
   list:async()=>[...workerRecords.values()].map(record=>structuredClone(record)),inspect:async({requestId})=>workerRecords.has(requestId)?structuredClone(workerRecords.get(requestId)):null,
   wait:async({requestId})=>workerRecords.has(requestId)?structuredClone(workerRecords.get(requestId)):null,
   cancel:async({requestId})=>{const record=workerRecords.get(requestId);if(record&&cancelSettles){record.status='cancelled';record.settled=true;options.onChange(record);}return record?structuredClone(record):null;},
   accounts:async()=>({enabled:true,accounts:[{accountId:'fixture-account',checkedAt:'2026-10-03T00:00:00Z'}]}),
   close:async()=>{bridgeCloseCount++;}
  };},
  gatewayFactory:async options=>{gatewayOptions.push(options);return {mcpConfig:{mcpServers:{k_gemini:{type:'http',url:`http://127.0.0.1:${43209+gatewayOptions.length}/mcp`,headers:{Authorization:'Bearer fixture-token'}}}},close:async()=>{gatewayCloseCount++;await options.bridge.close?.();}};}
 });
 return {c,root,calls,get host(){return hosts.at(-1);},hostOptions,gatewayOptions,bridgeOptions,workerRecords,toolOutputSent,releaseToolOutput,get hostCloseCount(){return hostCloseCount;},get gatewayCloseCount(){return gatewayCloseCount;},get bridgeCloseCount(){return bridgeCloseCount;}};
}

test('Codex thread gets only the Flash HTTP gateway; native GPT agents remain unchanged',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra',workerPolicy:{model:'gpt-6-luna',effort:'high'}});
  const config=f.calls.find(x=>x.method==='thread/start').params.config;
  assert.ok(f.calls.find(x=>x.method==='thread/start').params.developerInstructions.includes(MODEL_ROLE_GUIDANCE));
  assert.deepEqual(config.mcp_servers.k_gemini,{url:'http://127.0.0.1:43210/mcp',http_headers:{Authorization:'Bearer fixture-token'}});
  assert.equal(config.mcp_servers.k_luna,undefined);assert.equal(config.mcp_servers.k_flash.enabled,false);
  assert.equal(config.agents.default_subagent_model,'gpt-6-luna');assert.equal(config.agents.default_subagent_reasoning_effort,'high');
  assert.equal(f.gatewayOptions[0].geminiOnly,true);assert.equal(f.bridgeOptions.length,0,'bridge is lazy until a Flash tool is called');
 }finally{await f.c.close();}
});

test('Flash dispatch retains account and handoff fields and is owned by its native parent thread',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});const gateway=f.gatewayOptions[0],bridge=gateway.bridge;
  const args={requestId:'flash-request-1',model:'gemini-3.8-flash',effort:'medium',accountId:'a'.repeat(32),handoffFrom:'flash-request-previous',task:'只完成剩餘核對'};
  const started=await bridge.start(args);
  assert.equal(started.parentId,'codex-parent');assert.equal(started.accountId,args.accountId);assert.equal(started.handoffFrom,args.handoffFrom);
  assert.equal(f.bridgeOptions[0].workspace,f.root);assert.equal(f.bridgeOptions[0].accessMode,'workspace-write');
  assert.equal(f.bridgeOptions[0].parentId,'codex-parent');
  assert.equal(f.bridgeOptions[0].geminiOnly,true);
  assert.deepEqual(await bridge.accounts(),{enabled:true,accounts:[{accountId:'fixture-account',checkedAt:'2026-10-03T00:00:00Z'}]});
 }finally{await f.c.close();}
});

test('stopping closes the thread-bound Flash bridge while retaining the host gateway for the next send',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});const first=f.calls.find(call=>call.method==='thread/start').params.config.mcp_servers.k_gemini.url;
  await f.c.send({text:'先做一回合'});const bridge=f.gatewayOptions[0].bridge;await bridge.start({requestId:'stop-close-bridge',model:'gemini-3.8-flash',effort:'low',task:'停止前工人'});
  await f.c.stop();assert.equal(f.gatewayCloseCount,0);assert.equal(f.bridgeCloseCount,1);assert.equal(f.workerRecords.get('stop-close-bridge').settled,true);
  await f.c.send({text:'停止後接續'});
  assert.equal(f.gatewayOptions.length,1);assert.equal(f.calls.find(call=>call.method==='thread/start').params.config.mcp_servers.k_gemini.url,first);assert.ok(f.c.state.threadId);
 }finally{await f.c.close();}
});

test('Flash rows coexist with native GPT rows; permission changes confirm stop and recreate bridge in bounded mode',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra',accessMode:'auto-review',permissionConfirmed:true});
  const bridge=f.gatewayOptions[0].bridge;await bridge.start({requestId:'permission-switch-flash',model:'gemini-3.8-flash',effort:'medium',task:'小任務'});
  f.hostOptions.at(-1).onEvent({method:'item/started',params:{threadId:'codex-parent',turnId:'turn-parent',item:{id:'native-child',type:'subAgentActivity',kind:'started',agentThreadId:'child-gpt'}}});
  const rows=await f.c.workers();assert.deepEqual(new Set(rows.map(row=>row.provider)),new Set(['codex','gemini']));
  assert.equal(f.bridgeOptions[0].accessMode,'workspace-write','auto-review must not become elevated Flash access');
  await f.c.send({text:'以唯讀模式接續',accessMode:'read-only'});
  assert.equal(f.gatewayCloseCount,0);assert.equal(f.bridgeCloseCount,1);assert.equal(f.workerRecords.get('permission-switch-flash').settled,true);
  assert.equal(f.c.state.accessMode,'read-only');
  const config=f.calls.findLast(call=>call.method==='thread/start').params;
  assert.equal(config.sandbox,'read-only');
 }finally{await f.c.close();}
});

test('Flash result is delivered once as a native tool output only after Codex turn ends',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'處理一個 Flash 子任務'});
  const gateway=f.gatewayOptions[0],bridge=gateway.bridge;
  await bridge.start({requestId:'flash-in-turn',model:'gemini-3.8-flash',effort:'low',task:'完成'});
  let record=f.workerRecords.get('flash-in-turn');record.status='completed';record.settled=true;record.output='已完成';bridgeOptionsCallback(f,record);
  bridge.resultReady({requestId:'flash-in-turn'},{settled:false});
  f.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
  await f.toolOutputSent;
  await new Promise(resolve=>setImmediate(resolve));
  const output=f.calls.find(x=>x.method==='turn/start'&&x.params.toolOutput);
  assert.ok(output);assert.equal(output.params.threadId,'codex-parent');assert.deepEqual(output.params.input,[]);
  assert.equal(output.params.toolOutput.name,'gemini_start');assert.equal(output.params.toolOutput.namespace,null);assert.match(output.params.toolOutput.output,/已完成/);
  assert.deepEqual(output.params.sandboxPolicy,{type:'workspaceWrite',writableRoots:[f.root],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true});
  assert.equal(f.c.state.notices.at(-1).kind,'worker-completion');
  const saved=(await listMainSessions(f.root)).sessions.find(item=>item.threadId==='codex-parent');
  assert.deepEqual(saved.workerNotifications,{'flash-in-turn':'delivery-attempted'});
  await f.c.close();
  const reopened=await fixture({root:f.root});try{
   await reopened.c.open({model:'gpt-6-astra',threadId:'codex-parent'});await reopened.c.send({text:'繼續原任務'});
   const reopenedBridge=reopened.gatewayOptions[0].bridge;await reopenedBridge.start({requestId:'flash-in-turn',model:'gemini-3.8-flash',effort:'low',task:'既有完成工作'});
   const oldRecord=reopened.workerRecords.get('flash-in-turn');oldRecord.status='completed';oldRecord.settled=true;reopened.bridgeOptions[0].onChange(oldRecord);
   reopenedBridge.resultReady({requestId:'flash-in-turn'},{settled:false});
   reopened.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
   await reopened.c.workers();await new Promise(resolve=>setImmediate(resolve));
   assert.equal(reopened.calls.some(call=>call.method==='turn/start'&&call.params.toolOutput),false,'reopening must not replay an attempted notification');
  }finally{await reopened.c.close();}
 }finally{await f.c.close();}
});

test('settled Flash result returned to the model is disarmed and not re-notified',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'派一個 Flash 工作'});
  const bridge=f.gatewayOptions[0].bridge;const result=await bridge.start({requestId:'already-returned',model:'gemini-3.8-flash',effort:'high',task:'完成'});
  result.status='completed';result.settled=true;result.output='模型已取得的結果';f.workerRecords.set(result.requestId,result);
  bridge.resultReady({requestId:result.requestId},{settled:true});
  f.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.some(x=>x.method==='turn/start'&&x.params.toolOutput),false);
 }finally{await f.c.close();}
});

test('stop waits for an in-flight completion toolOutput, then interrupts its confirmed native turn',async()=>{
 const f=await fixture({delayToolOutput:true});try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'先做一回合'});
  const bridge=f.gatewayOptions[0].bridge;await bridge.start({requestId:'delayed-output',model:'gemini-3.8-flash',effort:'low',task:'完成'});
  const record=f.workerRecords.get('delayed-output');record.status='completed';record.settled=true;record.output='done';f.bridgeOptions[0].onChange(record);
  f.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
  await f.toolOutputSent;let stopped=false;const stopping=f.c.stop().then(()=>{stopped=true;},()=>{stopped=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false,'stop must wait instead of assuming no completion turn exists');
  f.releaseToolOutput();await stopping;
  assert.ok(f.calls.some(call=>call.method==='turn/interrupt'&&call.params.turnId==='turn-2'));
  assert.equal(f.c.state.status,'interrupted');
 }finally{f.releaseToolOutput();await f.c.close();}
});

test('uncertain completion is never replayed and does not permanently lock the native host',async()=>{
 const f=await fixture({rejectToolOutput:true});try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'完成後需查明原生回合'});
  const bridge=f.gatewayOptions[0].bridge;await bridge.start({requestId:'uncertain-delivery',model:'gemini-3.8-flash',effort:'low',task:'完成'});
  const record=f.workerRecords.get('uncertain-delivery');record.status='completed';record.settled=true;record.output='done';f.bridgeOptions[0].onChange(record);
  f.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
  await f.toolOutputSent;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.c.state.status,'uncertain');
  await assert.rejects(f.c.open({model:'gpt-6-astra',threadId:'codex-parent'}),/先按停止/);
  await f.c.stop();
  assert.ok(f.calls.some(call=>call.method==='thread/read'&&call.params.threadId==='codex-parent'));
  assert.equal(f.c.state.status,'interrupted');
  await f.c.close();
  const reopened=await fixture({root:f.root});try{
   await reopened.c.open({model:'gpt-6-astra',threadId:'codex-parent'});await reopened.c.send({text:'原工作查明後可恢復'});
   assert.equal(reopened.calls.some(call=>call.method==='turn/start'&&call.params.toolOutput),false);
  }finally{await reopened.c.close();}
 }finally{await f.c.close();}
});

test('Flash stop must be confirmed before gateway or host closes',async()=>{
 const f=await fixture({cancelSettles:false});await f.c.open({model:'gpt-6-astra'});
 const bridge=f.gatewayOptions[0].bridge;await bridge.start({requestId:'uncertain-flash',model:'gemini-3.8-flash',effort:'low',task:'長工作'});
 await assert.rejects(f.c.close(),/停止狀態未確認/);assert.equal(f.gatewayCloseCount,0);assert.equal(f.hostCloseCount,0);
});

test('Codex native approval still uses the original one-shot approval handler',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'原生核准測試'});
  const pending=f.hostOptions.at(-1).onRequest({id:44,method:'item/commandExecution/requestApproval',params:{threadId:'codex-parent',turnId:'turn-1',command:'node fixture.js',cwd:f.root}});
  const question=f.c.state.questions.at(-1);assert.equal(question.kind,'approval');assert.equal(question.details.command,'node fixture.js');
  f.c.answer({id:question.id,accept:true});assert.deepEqual(await pending,{decision:'accept'});
 }finally{await f.c.close();}
});

function bridgeOptionsCallback(f,record){f.bridgeOptions[0].onChange(record);}





test('failed completion submission during stop is read back before a second stop can succeed',async()=>{
 const f=await fixture({delayToolOutput:true,rejectToolOutput:true});try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'停止時查明結果'});
  const bridge=f.gatewayOptions[0].bridge;await bridge.start({requestId:'stop-unknown',model:'gemini-3.8-flash',effort:'low',task:'完成'});
  const record=f.workerRecords.get('stop-unknown');record.status='completed';record.settled=true;record.output='done';f.bridgeOptions[0].onChange(record);
  f.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
  await f.toolOutputSent;
  const firstStop=assert.rejects(f.c.stop(),/fixture transport dropped/);f.releaseToolOutput();await firstStop;
  await f.c.stop();
  assert.ok(f.calls.some(call=>call.method==='turn/interrupt'&&call.params.turnId==='unconfirmed-completion-turn'),'stop must inspect and interrupt the original uncertain turn, not assume it stopped');
  assert.equal(f.calls.filter(call=>call.method==='turn/start'&&call.params.toolOutput).length,1);
  assert.equal(f.c.state.status,'interrupted');
 }finally{f.releaseToolOutput();await f.c.close();}
});

test('native goal turn winning a Flash notification race preserves rejected results for the next completion',async()=>{
 const f=await fixture();try{await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'fake goal work'});const emit=f.hostOptions.at(-1).onEvent;f.c.state.goal={status:'active'};
 const original=f.host.request;let attempts=0;f.host.request=async(method,p,...rest)=>{if(method==='turn/start'&&p.toolOutput&&++attempts===1){emit({method:'turn/started',params:{threadId:'codex-parent',turn:{id:'native-goal-turn'}}});throw Object.assign(Error('native turn already active'),{protocolMessage:{code:-32600}});}return original(method,p,...rest);};
 await f.gatewayOptions[0].bridge.start({requestId:'goal-worker',model:'gemini-3.8-flash',effort:'low',task:'fake'});const record=f.workerRecords.get('goal-worker');Object.assign(record,{status:'completed',settled:true,output:'done'});f.bridgeOptions[0].onChange(record);
 emit({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
 for(let i=0;i<100&&attempts<1;i++)await new Promise(r=>setTimeout(r,10));await new Promise(r=>setTimeout(r,30));assert.equal(f.c.state.status,'working');assert.equal(f.c.state.error,null);
 emit({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'native-goal-turn',status:'completed'}}});await f.toolOutputSent;await new Promise(r=>setTimeout(r,30));assert.equal(attempts,2);assert.equal(f.c.state.status,'working');assert.equal(f.workerRecords.size,1);
 }finally{f.c.state.goal=null;await f.c.close();}
});

test('quiet Flash notification is delivered once, leaves completion armed, and does not start another worker',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'long work'});
  const bridge=f.gatewayOptions[0].bridge;await bridge.start({requestId:'quiet-notice',model:'gemini-3.8-flash',effort:'low',task:'fake'});
  const record=f.workerRecords.get('quiet-notice');record.inspection={noticeId:'quiet-fixture',checkedAt:1000,lastActivityAt:0,statusObserved:'running',reason:'quiet'};
  f.bridgeOptions[0].onChange(record);
  f.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
  await f.toolOutputSent;await new Promise(r=>setTimeout(r,30));
  assert.match(f.calls.find(x=>x.params?.toolOutput)?.params.toolOutput.output,/久無活動不等於卡死/);
  f.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-2',status:'completed'}}});
  for(let i=0;i<3;i++)f.bridgeOptions[0].onChange(record);
  await new Promise(r=>setTimeout(r,30));
  assert.equal(f.calls.filter(x=>x.params?.toolOutput).length,1);
  delete record.inspection;record.lastActivityAt=5000;f.bridgeOptions[0].onChange(record);
  record.inspection={noticeId:'quiet-fixture',checkedAt:9000,lastActivityAt:5000,statusObserved:'running',reason:'next long command'};f.bridgeOptions[0].onChange(record);
  await new Promise(r=>setTimeout(r,20));assert.equal(f.calls.filter(x=>x.params?.toolOutput).length,1,'same job does not wake again just for another quiet command');
  const saved=(await listMainSessions(f.root)).sessions.find(s=>s.threadId==='codex-parent');assert.equal(saved.workerNotifications['quiet-fixture'],'delivery-attempted');assert.equal(saved.workerNotifications['quiet-notice'],undefined);
  record.status='completed';record.settled=true;delete record.inspection;f.bridgeOptions[0].onChange(record);
  for(let i=0;i<30&&!f.calls.some(x=>x.params?.toolOutput?.output.includes('工人完成通知'));i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.calls.filter(x=>x.params?.toolOutput).length,2);assert.equal(f.workerRecords.size,1);
 }finally{await f.c.close();}
});

test('fresh Flash activity removes a queued quiet warning before the parent is idle',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'long work'});
  const bridge=f.gatewayOptions[0].bridge;await bridge.start({requestId:'fresh-before-idle',model:'gemini-3.8-flash',effort:'low',task:'fake'});
  const record=f.workerRecords.get('fresh-before-idle');record.inspection={noticeId:'quiet-expired'};f.bridgeOptions[0].onChange(record);
  delete record.inspection;record.lastActivityAt=Date.now();f.bridgeOptions[0].onChange(record);
  f.hostOptions.at(-1).onEvent({method:'turn/completed',params:{threadId:'codex-parent',turn:{id:'turn-1',status:'completed'}}});
  await new Promise(r=>setTimeout(r,40));assert.equal(f.calls.filter(x=>x.params?.toolOutput).length,0);
 }finally{await f.c.close();}
});
