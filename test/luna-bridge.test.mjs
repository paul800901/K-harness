import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLunaBridge} from '../src/luna-bridge.mjs';
import {isolatedCodexSandboxPolicy} from '../src/isolated-provider-hosts.mjs';

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
async function make({accountType,models,onStart,threadRead,onChange=()=>{},onRequest,terminalData,terminalStuck,sandboxPolicyForMode,accessMode='workspace-write'}={}) {
  let fixture; const parentId=randomUUID();
  const bridge=await createLunaBridge({root,workspace,parentId,executable:'codex',onChange,onRequest,sandboxPolicyForMode,accessMode,
    hostFactory:options=>{fixture=fakeHost({accountType,models,onStart,threadRead,parentId,terminalData,terminalStuck});fixture.setOptions(options);return fixture.host;}});
  return {bridge,fixture};
}
const noWrite = () => ({status:'not-written'});

test('rejects non-subscription account and catalog without Luna/high before any turn',async()=>{
  for(const options of [{accountType:'apiKey'},{models:[{model:'gpt-6-sol',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]}]) {
    let f;
    await assert.rejects(createLunaBridge({root,workspace,parentId:randomUUID(),executable:'codex',hostFactory:o=>{f=fakeHost(options);f.setOptions(o);return f.host;}}));
    assert.equal(f.calls.some(c=>c.method==='thread/start'||c.method==='turn/start'),false);
  }
});

test('uses fixed Luna/high, deduplicates stable request IDs, and persists native completion/output/files',async()=>{
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

test('isolated Luna uses the same externalSandbox policy as main Codex and refuses readonly',async()=>{
  const {bridge,fixture}=await make({sandboxPolicyForMode:isolatedCodexSandboxPolicy});
  const started=await bridge.start({requestId:'external-sandbox',task:'fake policy check'});
  const thread=fixture.calls.find(call=>call.method==='thread/start').p;
  const turn=fixture.calls.find(call=>call.method==='turn/start').p;
  assert.equal(thread.approvalPolicy,'on-request');assert.equal(thread.approvalsReviewer,'user');
  assert.equal(turn.approvalPolicy,'on-request');assert.equal(turn.approvalsReviewer,'user');
  assert.deepEqual(turn.sandboxPolicy,{type:'externalSandbox',networkAccess:'enabled'});
  assert.equal(thread.config.sandbox_mode,'workspace-write');
  await bridge.close();

  const refused=await make({sandboxPolicyForMode:isolatedCodexSandboxPolicy,accessMode:'read-only'});
  await assert.rejects(refused.bridge.start({requestId:'readonly-refused',task:'fake readonly check'}),/未具備可驗證的唯讀/u);
  assert.equal(refused.fixture.calls.some(call=>call.method==='thread/start'||call.method==='turn/start'),false);
  await refused.bridge.close();
  assert.ok(started.threadId);
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
