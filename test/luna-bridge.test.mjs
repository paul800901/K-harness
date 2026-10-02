import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLunaBridge} from '../src/luna-bridge.mjs';
import {approvalRequest} from '../src/desktop-permissions.mjs';

const root = path.resolve('.runtime','luna-bridge-tests',randomUUID());
const workspace = path.join(root,'workspace');
await mkdir(workspace,{recursive:true});
const catalog = [{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'high'}]}];
function fakeHost({accountType='chatgpt', models=catalog, onStart, threadRead, parentId='parent',terminalData=[],terminalStuck=false}={}) {
  const calls=[]; const events=[]; let count=0; let status='inProgress'; const items=[];let terminals=terminalData;let closedCount=0;
  const host={
    calls, events,
    notify:m=>calls.push({method:'notify',p:m}), close:async()=>{closedCount++;},
    async request(method,p={}) {
      calls.push({method,p});
      if(method==='initialize') return {};
      if(method==='account/read')return {account:{type:accountType}};
      if(method==='model/list')return {data:models};
      if(method==='thread/start') { count++; await onStart?.(host,p); return {thread:{id:`thread-${count}`}}; }
      if(method==='turn/start') { const id=`turn-${count}`; events.push(id); return {turn:{id}}; }
      if(method==='turn/interrupt') { status='interrupted'; host.emit({method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}}}); return {}; }
      if(method==='thread/backgroundTerminals/list')return {data:terminals};
      if(method==='thread/backgroundTerminals/clean'){if(!terminalStuck)terminals=[];return {};}
      if(method==='thread/read')return threadRead?.(p, status) ?? {thread:{id:p.threadId,cwd:workspace,parentThreadId:parentId,status:{type:status==='inProgress'?'active':'idle'},turns:[{id:'turn-1',status,items} ]}};
      throw Error(`unexpected ${method}`);
    },
    emit(m){ /* assigned by bridge via factory options */ options.onEvent(m); },
    requestHandler(m){return options.onRequest(m);},
  };
  let options={};
  return {host, calls, closeCount:()=>closedCount, setOptions:o=>options=o, finish(threadId='thread-1',turnId='turn-1') {status='completed';host.emit({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});},
    item(threadId,item) {items.push(item);host.emit({method:'item/completed',params:{threadId,item}});},releaseTerminals(){terminals=[];}};
}
async function make({accountType,models,onStart,threadRead,onChange=()=>{},onRequest,terminalData,terminalStuck,accessMode='workspace-write',workerPolicy={model:'gpt-6-luna',effort:'high'}}={}) {
  let fixture; const parentId=randomUUID();
  const bridge=await createLunaBridge({root,workspace,parentId,executable:'codex',onChange,onRequest,accessMode,workerPolicy,
    hostFactory:options=>{fixture=fakeHost({accountType,models,onStart,threadRead,parentId,terminalData,terminalStuck});fixture.setOptions(options);return fixture.host;}});
  return {bridge,fixture};
}
const noWrite = () => ({status:'not-written'});

test('rejects non-subscription account and validates the requested worker against the catalog before a turn',async()=>{
 let f;
 const unavailable=await createLunaBridge({root,workspace,parentId:randomUUID(),executable:'codex',hostFactory:o=>{f=fakeHost({accountType:'apiKey'});f.setOptions(o);return f.host;}});
 await assert.rejects(unavailable.start({requestId:'no-subscription',task:'fake',model:'gpt-6-luna',effort:'high'}),/訂閱登入/);
 await unavailable.close();
 assert.equal(f.calls.some(c=>c.method==='thread/start'||c.method==='turn/start'),false);
 const {bridge,fixture}=await make({models:[{model:'gpt-6-sol',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]});
 try{await assert.rejects(bridge.start({requestId:'unavailable',task:'fake task',model:'gpt-6-luna',effort:'high'}),/未自動換模/);assert.equal(fixture.calls.some(c=>c.method==='thread/start'||c.method==='turn/start'),false);}finally{await bridge.close();}
});

test('defaults to Luna/high, deduplicates stable request IDs, and persists native completion/output/files',async()=>{
  const changes=[];const {bridge,fixture}=await make({onChange:r=>changes.push(r)});
  const requestId='dedup';
  const first=await bridge.start({requestId,task:'請檢查並修復問題'});
  const again=await bridge.start({requestId,task:'請檢查並修復問題'});
  assert.equal(first.threadId,again.threadId);
  await assert.rejects(bridge.start({requestId,task:'不同工作'}),/不同 task/);
  const turn=fixture.calls.find(c=>c.method==='turn/start').p;
  assert.equal(turn.model,'gpt-6-luna');assert.equal(turn.effort,'high');
  assert.equal(turn.sandboxPolicy.type,'workspaceWrite');assert.deepEqual(turn.input[0].text.includes('不得再委派子代理'),true);
  const start=fixture.calls.find(c=>c.method==='thread/start').p;
  assert.equal(start.config.model_reasoning_effort,'high');assert.deepEqual(start.config.mcp_servers,{k_flash:{enabled:false,command:process.execPath,args:['--version']}});assert.deepEqual(start.config.agents,{enabled:false});
  assert.deepEqual(start.config.sandbox_workspace_write.writable_roots,[workspace]);
  fixture.item(first.threadId,{type:'agentMessage',text:'已完成'});
  fixture.item(first.threadId,{type:'fileChange',changes:[{path:'result.txt',kind:{type:'add'}}]});
  fixture.finish(first.threadId,first.turnId??'turn-1');
  const result=await bridge.wait({requestId,timeoutMs:1000});
  assert.equal(result.status,'completed');assert.equal(result.settled,true);assert.equal(result.acceptance,'not-reviewed');
  assert.match(result.output,/已完成/);assert.deepEqual(result.outputFiles,['result.txt']);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(changes.some(change=>change.status==='completed'));
  const persisted=JSON.parse(await readFile(path.join(root,'.runtime','luna-bridge',result.parentId,`${requestId}.json`),'utf8'));
  assert.equal(persisted.provider,'codex');assert.equal(persisted.status,'completed');
  await bridge.close();
});

test('restart inspection reads native thread and never resends a turn',async()=>{
  const {bridge,fixture}=await make();const started=await bridge.start({requestId:'restart',task:'原工作'});
  const before=fixture.calls.filter(c=>c.method==='turn/start').length;
  fixture.host.request=async(method,p)=>method==='thread/read'?{thread:{id:p.threadId,cwd:workspace,status:{type:'idle'},turns:[{id:'old',status:'completed',items:[{type:'agentMessage',text:'native readback'}]}]}}:method==='thread/backgroundTerminals/list'?{data:[]}:Promise.reject(Error(method));
  const result=await bridge.inspect({requestId:'restart'});
  assert.equal(result.status,'completed');assert.match(result.output,/native readback/);
  assert.equal(fixture.calls.filter(c=>c.method==='turn/start').length,before);
  await bridge.close();
});

test('start/cancel race does not start a turn after cancellation is requested',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let entered;
  const enteredPromise=new Promise(resolve=>entered=resolve);
  const {bridge,fixture}=await make({onStart:async()=>{entered();await gate;}});
  const starting=bridge.start({requestId:'race',task:'工作'});await enteredPromise;
  const cancellation=bridge.cancel({requestId:'race'});release();
  await starting;const result=await cancellation;
  assert.equal(result.status,'cancelled');assert.equal(result.settled,true);
  assert.equal(fixture.calls.some(c=>c.method==='turn/start'),false);
  await bridge.close();
});

test('concurrent starts reserve requestId before asynchronous work and reject a conflicting task',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let entered;const enteredPromise=new Promise(resolve=>entered=resolve);
  const {bridge,fixture}=await make({onStart:async()=>{entered();await gate;}});
  const same=bridge.start({requestId:'concurrent',task:'identical'});
  const changed=bridge.start({requestId:'concurrent',task:'different'});
  const resultsPromise=Promise.allSettled([same,changed]);
  await enteredPromise;
  release();
  const results=await resultsPromise;
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.equal(fixture.calls.filter(call=>call.method==='thread/start').length,1);
  assert.equal(fixture.calls.filter(call=>call.method==='turn/start').length,1);
  await bridge.close();
});

test('simultaneous identical starts launch exactly one native thread and turn',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let entered;const enteredPromise=new Promise(resolve=>entered=resolve);
  const {bridge,fixture}=await make({onStart:async()=>{entered();await gate;}});
  const first=bridge.start({requestId:'concurrent-identical',task:'same task'});
  const second=bridge.start({requestId:'concurrent-identical',task:'same task'});
  const resultsPromise=Promise.all([first,second]);
  await enteredPromise;release();
  await resultsPromise;
  assert.equal(fixture.calls.filter(call=>call.method==='thread/start').length,1);
  assert.equal(fixture.calls.filter(call=>call.method==='turn/start').length,1);
  await bridge.close();
});

test('uncertain turn-start outcome is not retried; cancellation interrupts an active native turn',async()=>{
  const {bridge,fixture}=await make();const started=await bridge.start({requestId:'cancel',task:'工作'});
  const cancelled=await bridge.cancel({requestId:'cancel'});
  assert.equal(cancelled.status,'cancelled');
  assert.equal(fixture.calls.filter(c=>c.method==='turn/interrupt').length,1);
  await bridge.close();

  const second=await make();
  second.fixture.host.request=async(method,p)=>{
    if(method==='initialize')return {};if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='model/list')return {data:catalog};
    if(method==='thread/start')return {thread:{id:'uncertain-thread'}};
    if(method==='turn/start')throw Error('Codex turn/start timed out; do not replay automatically.');
    if(method==='thread/read')throw Error('offline');
  };
  await assert.rejects(second.bridge.start({requestId:'uncertain',task:'工作'}));
  const calls=second.fixture.calls.filter(c=>c.method==='turn/start').length;
  const result=await second.bridge.start({requestId:'uncertain',task:'工作'});
  assert.equal(result.status,'unresolved');
  assert.equal(second.fixture.calls.filter(c=>c.method==='turn/start').length,calls);
  await assert.rejects(second.bridge.close());
});

test('cancel and close stop native background terminals before reporting settled or closing the host',async()=>{
  const {bridge,fixture}=await make({terminalData:[{id:'terminal'}],terminalStuck:true});
  await bridge.start({requestId:'terminal-stop',task:'bounded'});
  await assert.rejects(bridge.cancel({requestId:'terminal-stop'}),/背景命令尚未確認停止/);
  assert.equal(fixture.calls.some(c=>c.method==='turn/interrupt'),true);
  assert.equal(fixture.calls.some(c=>c.method==='thread/backgroundTerminals/clean'),true);
  assert.equal(fixture.closeCount(),0);
  fixture.releaseTerminals();
  const result=await bridge.cancel({requestId:'terminal-stop'});
  assert.equal(result.settled,true);
  await bridge.close();
  assert.equal(fixture.closeCount(),1);
});

test('close still stops backgrounds after the native turn is already completed',async()=>{
  const {bridge,fixture}=await make({terminalData:[{id:'terminal'}]});
  const started=await bridge.start({requestId:'completed-with-terminal',task:'bounded'});
  fixture.finish(started.threadId,started.turnId);
  const completed=await bridge.inspect({requestId:'completed-with-terminal'});
  assert.equal(completed.status,'completed');assert.equal(completed.settled,true);
  await bridge.close();
  assert.ok(fixture.calls.some(call=>call.method==='thread/backgroundTerminals/clean'));
  assert.equal(fixture.closeCount(),1);
});

test('close reads completed unloaded history without calling loaded-only terminal APIs',async()=>{
  const {bridge,fixture}=await make();
  const started=await bridge.start({requestId:'unloaded-completed',task:'bounded'});
  const request=fixture.host.request;
  fixture.host.request=async(method,p)=>{
    if(method==='thread/read')return {thread:{id:p.threadId,cwd:workspace,status:{type:'notLoaded'},turns:[{id:started.turnId,status:'completed',items:[]}]}};
    if(method.startsWith('thread/backgroundTerminals/'))throw Error('thread not found');
    return request(method,p);
  };
  await bridge.close();
  assert.equal(fixture.closeCount(),1);
  const result=JSON.parse(await readFile(path.join(root,'.runtime','luna-bridge',started.parentId,'unloaded-completed.json'),'utf8'));
  assert.equal(result.status,'completed');assert.equal(result.settled,true);
});

test('unloaded history without the matching terminal turn cannot authorize close',async()=>{
  for(const variant of ['active','missing','wrong-turn','wrong-workspace']){
    const {bridge,fixture}=await make();
    const started=await bridge.start({requestId:'unloaded-unknown',task:'bounded'});
    fixture.host.request=async(method,p)=>{
      if(method==='thread/read')return {thread:{id:p.threadId,cwd:variant==='wrong-workspace'?path.join(workspace,'other'):workspace,status:{type:'notLoaded'},turns:variant==='missing'?[]:[{id:variant==='wrong-turn'?'different':started.turnId,status:variant==='active'?'inProgress':'completed',items:[]}]}};
      throw Error(`Unexpected mutation: ${method}`);
    };
    await assert.rejects(bridge.close());assert.equal(fixture.closeCount(),0);
  }
});

test('loaded terminal-list failure blocks close but preserves the completed result',async()=>{
  const {bridge,fixture}=await make();
  const started=await bridge.start({requestId:'cleanup-failed',task:'bounded'});
  fixture.finish(started.threadId,started.turnId);
  const request=fixture.host.request;
  fixture.host.request=async(method,p)=>{
    if(method==='thread/backgroundTerminals/list')throw Error('thread not found');
    return request(method,p);
  };
  await assert.rejects(bridge.close(),/cleanup-failed.*背景命令清理未確認/);
  assert.equal(fixture.closeCount(),0);
  const record=JSON.parse(await readFile(path.join(root,'.runtime','luna-bridge',started.parentId,'cleanup-failed.json'),'utf8'));
  assert.equal(record.status,'completed');assert.equal(record.settled,true);assert.match(record.cleanupError,/thread not found/);
  fixture.host.request=request;
  await bridge.close();assert.equal(fixture.closeCount(),1);
});

test('approval requests pass through only for the bridge-owned native thread and turn',async()=>{
  const seen=[];const guarded=await make({onRequest:message=>{seen.push(message);return {decision:'decline'};}});
  // The request callback is deliberately surfaced only after exact ownership checks.
  const startedGuarded=await guarded.bridge.start({requestId:'approval-guard',task:'bounded'});
  const raw={method:'item/commandExecution/requestApproval',params:{threadId:startedGuarded.threadId,turnId:'turn-1'}};
  assert.deepEqual(await guarded.fixture.host.requestHandler(raw),{decision:'decline'});
  assert.equal(await guarded.fixture.host.requestHandler({...raw,params:{...raw.params,threadId:'foreign'}}),undefined);
  assert.equal(await guarded.fixture.host.requestHandler({...raw,params:{...raw.params,turnId:'foreign-turn'}}),undefined);
  assert.deepEqual(seen,[raw]);
  await guarded.bridge.close();
});

test('file change approval reads the matching native turn item and keeps missing changes unapprovable',async()=>{
 const seen=[];const {bridge,fixture}=await make({onRequest:(message,item)=>{seen.push(item);return approvalRequest(message,item);}});
 try{
  const record=await bridge.start({requestId:'file-approval',task:'bounded'});
  const item={id:'file-item',type:'fileChange',changes:[{path:'result.txt',kind:{type:'add'},diff:'+fixture'}]};
  fixture.item(record.threadId,item);
  const request={method:'item/fileChange/requestApproval',params:{threadId:record.threadId,turnId:record.turnId,itemId:item.id}};
  const approval=await fixture.host.requestHandler(request);
  assert.equal(seen[0],item);assert.equal(approval.canAccept,true);
  assert.deepEqual(approval.reply(true),{decision:'accept'});
  assert.deepEqual(fixture.calls.filter(c=>c.method==='thread/read').at(-1).p,{threadId:record.threadId,includeTurns:true});
  const missing=await fixture.host.requestHandler({...request,params:{...request.params,itemId:'missing'}});
  assert.equal(missing.canAccept,false);assert.throws(()=>missing.reply(true),/核准/);
  assert.deepEqual(missing.reply(false),{decision:'decline'});
  const read=fixture.host.request;
  fixture.host.request=async(method,p)=>{if(method==='thread/read')throw Error('unavailable');return read(method,p);};
  assert.equal((await fixture.host.requestHandler(request)).canAccept,false);
  fixture.host.request=read;
 }finally{await bridge.close();}
});

test('pending native file change events supply changes before thread/read contains the item',async()=>{
 const {bridge,fixture}=await make({onRequest:(message,item)=>approvalRequest(message,item)});
 try{
  const record=await bridge.start({requestId:'pending-file-item',task:'bounded'});
  const item={id:'pending-item',type:'fileChange',status:'inProgress',changes:[{path:'native.txt',kind:{type:'add'},diff:'native contents'}]};
  const params={threadId:record.threadId,turnId:record.turnId,item};
  fixture.host.emit({method:'item/started',params});
  fixture.host.emit({method:'item/started',params:{...params,threadId:'foreign',item:{...item,changes:[{path:'foreign.txt'}]}}});
  fixture.host.emit({method:'item/started',params:{...params,turnId:'foreign-turn',item:{...item,changes:[{path:'old.txt'}]}}});
  const request={method:'item/fileChange/requestApproval',params:{threadId:record.threadId,turnId:record.turnId,itemId:item.id}};
  const approval=await fixture.host.requestHandler(request);
  assert.equal(approval.canAccept,true);assert.deepEqual(approval.details.changes,item.changes);
  assert.deepEqual(approval.reply(true),{decision:'accept'});
  fixture.host.emit({method:'item/completed',params});
  assert.equal((await fixture.host.requestHandler(request)).canAccept,false);
 }finally{await bridge.close();}
});

test('approval cannot use an item from another turn or appear after the worker finishes during read',async()=>{
 let finishRead;let reading;
 const {bridge,fixture}=await make({onRequest:(message,item)=>approvalRequest(message,item)});
 try{
  const record=await bridge.start({requestId:'approval-read',task:'bounded'});
  const request={method:'item/fileChange/requestApproval',params:{threadId:record.threadId,turnId:record.turnId,itemId:'same-id'}};
  const read=fixture.host.request;
  fixture.host.request=async(method,p)=>method==='thread/read'?{thread:{turns:[{id:'older-turn',items:[{id:'same-id',changes:[{path:'old.txt'}]}]}]}}:read(method,p);
  assert.equal((await fixture.host.requestHandler(request)).canAccept,false);
  fixture.host.request=async(method,p)=>method==='thread/read'?new Promise(resolve=>{finishRead=resolve;}):read(method,p);
  reading=fixture.host.requestHandler(request);
  fixture.finish(record.threadId,record.turnId);
  finishRead({thread:{turns:[{id:record.turnId,items:[{id:'same-id',changes:[{path:'new.txt'}]}]}]}});
  assert.equal(await reading,undefined);
  fixture.host.request=read;
 }finally{await bridge.close();}
});

test('fully trusted workers send never approval and danger-full-access to the native core',async()=>{
 const {bridge,fixture}=await make({accessMode:'danger-full-access'});
 try{
  await bridge.start({requestId:'trusted',task:'bounded'});
  const thread=fixture.calls.find(c=>c.method==='thread/start').p,turn=fixture.calls.find(c=>c.method==='turn/start').p;
  assert.equal(thread.sandbox,'danger-full-access');assert.equal(thread.approvalPolicy,'never');
  assert.equal(turn.sandboxPolicy.type,'dangerFullAccess');assert.equal(turn.approvalPolicy,'never');
  assert.match(turn.input[0].text,/不得超過主代理的授權/);
 }finally{await bridge.close();}
});

// Model-facing outputs never repeat in-flight text, and long results remain locally readable.
test('Luna result hides unfinished output and saves full completed output inside workspace',async()=>{
 const {lunaResult}=await import('../src/luna-bridge.mjs');
 const text='result\n'.repeat(4000),r={workspace,parentId:randomUUID(),requestId:'long',settled:false,status:'running',output:text};
 const running=await lunaResult(r);assert.equal(running.output,undefined);assert.equal(running.outputPreview,undefined);assert.equal(running.outputLength,text.length);
 const final=await lunaResult({...r,settled:true,status:'completed'});
 assert.equal(final.output,undefined);assert.equal(final.outputPreview.length,1000);assert.ok(final.outputPath.startsWith(workspace+path.sep));assert.equal(await readFile(final.outputPath,'utf8'),text);
 assert.equal(path.basename(final.outputPath),'long.output.md');
 assert.deepEqual(await lunaResult({...r,settled:true,status:'completed'}),final);
 await assert.rejects(lunaResult({...r,settled:true,parentId:'../escape'}));
 const changedText=text+'changed';
 const changed=await lunaResult({...r,settled:true,output:changedText});
 assert.notEqual(changed.outputPath,final.outputPath);assert.equal(await readFile(final.outputPath,'utf8'),text);assert.equal(await readFile(changed.outputPath,'utf8'),changedText);
 assert.deepEqual(await lunaResult({...r,settled:true,output:changedText}),changed);
 await writeFile(changed.outputPath,'later unrelated content');
 const recovered=await lunaResult({...r,settled:true,output:changedText});
 assert.notEqual(recovered.outputPath,changed.outputPath);assert.equal(await readFile(changed.outputPath,'utf8'),'later unrelated content');assert.equal(await readFile(recovered.outputPath,'utf8'),changedText);
 assert.deepEqual(await lunaResult({...r,settled:true,output:changedText}),recovered);
});
test('long result refuses a workspace junction pointing outside',async()=>{
 const {lunaResult}=await import('../src/luna-bridge.mjs');const {symlink}=await import('node:fs/promises');
 const w=path.join(root,randomUUID()),outside=path.join(root,randomUUID());await mkdir(w);await mkdir(outside);
 await symlink(outside,path.join(w,'.runtime'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(lunaResult({workspace:w,parentId:'parent',requestId:'escape',settled:true,output:'x'.repeat(4001)}),/Unsafe/);
});

test('closing ignores settled historical records even when their thread is unavailable',async()=>{
 const {bridge,fixture}=await make();
 const record=await bridge.start({requestId:'closed-history',task:'Fake history'});fixture.finish();
 await bridge.inspect({requestId:'closed-history'});await bridge.close();
 const next=fakeHost();let reads=0;
 const original=next.host.request;next.host.request=(method,p)=>{if(method.startsWith('thread/')){reads++;throw Error('historical thread unavailable');}return original(method,p);};
 const reopened=await createLunaBridge({root,workspace,parentId:record.parentId,executable:'codex',hostFactory:o=>{next.setOptions(o);return next.host;}});
 await reopened.close();assert.equal(next.closeCount(),1);assert.equal(reads,0);
});

test('human defaults and AI per-task model/effort choices reach native worker requests unchanged',async()=>{
 const models=[...catalog,{model:'gpt-6.1-sol',supportedReasoningEfforts:['low','ultra'].map(reasoningEffort=>({reasoningEffort}))}];
 const {bridge,fixture}=await make({models,workerPolicy:{model:'gpt-6.1-sol',effort:'ultra'}});
 try{
  const first=await bridge.start({requestId:'sol',task:'fake default task'});
  assert.equal(first.model,'gpt-6.1-sol');assert.equal(first.effort,'ultra');
  const firstStart=fixture.calls.find(c=>c.method==='thread/start').p,firstTurn=fixture.calls.find(c=>c.method==='turn/start').p;
  assert.equal(firstStart.model,'gpt-6.1-sol');assert.equal(firstStart.config.model_reasoning_effort,'ultra');assert.equal(firstTurn.model,'gpt-6.1-sol');assert.equal(firstTurn.effort,'ultra');
  const second=await bridge.start({requestId:'luna',task:'fake selected task',model:'gpt-6-luna',effort:'high'});
  assert.equal(second.model,'gpt-6-luna');assert.equal(fixture.calls.findLast(c=>c.method==='turn/start').p.effort,'high');
  const before=fixture.calls.filter(c=>c.method==='turn/start').length;
  await assert.rejects(bridge.start({requestId:'sol',task:'fake default task',model:'gpt-6-luna',effort:'high'}),/模型設定/);
  await assert.rejects(bridge.start({requestId:'unsupported',task:'fake',model:'gpt-6-luna',effort:'ultra'}),/不支援/);
  assert.equal(fixture.calls.filter(c=>c.method==='turn/start').length,before);
  const persisted=JSON.parse(await readFile(path.join(root,'.runtime','luna-bridge',first.parentId,'sol.json')));
  assert.equal(persisted.model,'gpt-6.1-sol');assert.equal(persisted.effort,'ultra');
 }finally{await bridge.close();}
});

test('AI-auto bridge requires explicit concrete model and effort, then forwards choices unchanged',async()=>{
 const models=[...catalog,{model:'gpt-6.1-sol',supportedReasoningEfforts:['low','ultra'].map(reasoningEffort=>({reasoningEffort}))}];
 const {bridge,fixture}=await make({models,workerPolicy:{model:'auto',effort:'auto'}});
 try{
  assert.deepEqual(bridge.workerPolicy,{model:'auto',effort:'auto'});
  await assert.rejects(bridge.start({requestId:'missing',task:'fake'}),/明確指定 GPT-6.1 Sol 或 GPT-6 Luna/);
  await assert.rejects(bridge.start({requestId:'partial',task:'fake',model:'gpt-6-luna'}),/AI 自動選擇/);
  await assert.rejects(bridge.start({requestId:'auto-model',task:'fake',model:'auto',effort:'auto'}),/明確指定 GPT-6.1 Sol 或 GPT-6 Luna/);
  assert.equal(fixture.calls.some(c=>c.method==='thread/start'||c.method==='turn/start'),false);
  for(const [requestId,model,effort] of [['sol-auto','gpt-6.1-sol','ultra'],['luna-auto','gpt-6-luna','high']]){
   const record=await bridge.start({requestId,task:'choose for this task',model,effort});
   assert.equal(record.model,model);assert.equal(record.effort,effort);
   const start=fixture.calls.filter(c=>c.method==='thread/start').at(-1).p;
   const turn=fixture.calls.filter(c=>c.method==='turn/start').at(-1).p;
   assert.equal(start.model,model);assert.equal(start.config.model_reasoning_effort,effort);
   assert.equal(turn.model,model);assert.equal(turn.effort,effort);
  }
 }finally{await bridge.close();}
});
