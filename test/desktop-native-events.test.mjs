import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {visibleNativeNotices} from '../frontend/native-notices.mjs';

async function fixture({readiness='ready'}={}){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'desktop-native-events-')),calls=[],connections=[];
 const host={closed:new Promise(()=>{}),notify(){},waitForMcp:async()=>{},close:async()=>{},request:async(method,params,timeoutMs)=>{
  calls.push({method,params,timeoutMs});
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='model/list')return {data:[{model:'gpt-6-astra',displayName:'Astra',hidden:false,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'},{model:'gpt-6-luna',displayName:'Luna',hidden:false,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'}]};
  if(method==='thread/start'||method==='thread/resume')return {thread:{id:params?.threadId??'native-events-thread'}};
  if(method==='thread/read')return {thread:{turns:[]}};
  if(method==='windowsSandbox/readiness')return {status:readiness};
  if(method==='thread/goal/get')return {goal:null};
  if(method==='config/read')return {config:{}};
  if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
  if(method==='account/rateLimits/read')return {};
  return {};
 }};
 const c=createDesktopController({root,executable:'fixture',hostFactory:options=>{connections.push(options);return host;}});
 return {c,calls,connections,root,host};
}

test('main completion waits for the actual final native worker readback',async()=>{
 const f=await fixture(),original=f.host.request;let release,hold=false;
 try{
  await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>x.onEvent).onEvent;
  const result={thread:{parentThreadId:'native-events-thread',status:{type:'idle'},turns:[{status:'completed'}]}};
  f.host.request=async(method,p,...rest)=>method==='thread/read'&&p.threadId==='child'?(hold?new Promise(resolve=>{release=()=>resolve(result);}):result):original(method,p,...rest);
  emit({method:'turn/started',params:{threadId:'native-events-thread',turn:{id:'parent-turn'}}});
  emit({method:'item/completed',params:{threadId:'native-events-thread',item:{id:'spawn-child',type:'collabAgentToolCall',receiverThreadIds:['child']}}});
  await new Promise(r=>setTimeout(r,20));hold=true;
  emit({method:'turn/completed',params:{threadId:'native-events-thread',turn:{id:'parent-turn',status:'completed'}}});
  assert.equal(f.c.state.completionPending,true);
  assert.equal(typeof release,'function');
  hold=false;release();
  const end=Date.now()+1500;while(f.c.state.completionPending&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
  assert.equal(f.c.state.completionPending,false);assert.equal(f.c.state.status,'completed');
 }finally{hold=false;release?.();await f.c.close();}
});

test('native worker start and child completion refresh the count while the parent remains busy',async()=>{
 const f=await fixture(),original=f.host.request;let childStatus='inProgress';
 f.host.request=async(method,p,...rest)=>method==='thread/read'&&p.threadId==='child'
  ?{thread:{id:'child',parentThreadId:'native-events-thread',status:{type:childStatus==='inProgress'?'active':'idle'},turns:[{id:'child-turn',status:childStatus}]}}
  :original(method,p,...rest);
 const settle=()=>new Promise(r=>setTimeout(r,20));
 try{
  await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>x.onEvent).onEvent;
  emit({method:'turn/started',params:{threadId:'native-events-thread',turn:{id:'parent-turn'}}});
  emit({method:'item/completed',params:{threadId:'native-events-thread',item:{id:'spawn-child',type:'collabAgentToolCall',receiverThreadIds:['child']}}});
  await settle();assert.equal(f.c.state.workers[0].status,'running');
  childStatus='completed';emit({method:'turn/completed',params:{threadId:'child',turn:{id:'child-turn',status:'completed'}}});
  await settle();assert.equal(f.c.state.workers[0].status,'completed');assert.equal(f.c.state.busy,true);
  childStatus='inProgress';emit({method:'turn/started',params:{threadId:'child',turn:{id:'child-turn'}}});
  await settle();assert.equal(f.c.state.workers[0].status,'running');
  childStatus='failed';emit({method:'thread/status/changed',params:{threadId:'child',status:{type:'idle'}}});
  await settle();assert.equal(f.c.state.workers[0].status,'failed');
  const reads=f.calls.length;emit({method:'turn/started',params:{threadId:'foreign',turn:{id:'foreign-turn'}}});
  await settle();assert.equal(f.calls.length,reads,'No reads of unrelated conversations');
 }finally{await f.c.close();}
});

test('a slow worker read cannot resurrect a worker after a newer completed read',async()=>{
 const f=await fixture(),original=f.host.request;let slow,started=false;
 const child=status=>({thread:{id:'child',parentThreadId:'native-events-thread',status:{type:status==='inProgress'?'active':'idle'},turns:[{id:'child-turn',status}]}});
 f.host.request=async(method,p,...rest)=>{
  if(method==='thread/read'&&p.threadId==='child'){
   if(!started){started=true;return new Promise(resolve=>{slow=resolve;});}
   return child('completed');
  }return original(method,p,...rest);
 };
 try{
  await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>x.onEvent).onEvent;
  emit({method:'item/completed',params:{threadId:'native-events-thread',item:{id:'spawn-child',type:'collabAgentToolCall',receiverThreadIds:['child']}}});
  await f.c.workers();assert.equal(f.c.state.workers[0].status,'completed');
  slow(child('inProgress'));await new Promise(r=>setTimeout(r,20));
  assert.equal(f.c.state.workers[0].status,'completed');
 }finally{await f.c.close();}
});

test('native notifications are normalized, thread-scoped, and never change the selected model on reroute',async()=>{
 const f=await fixture();
 try{
  await f.c.open({model:'gpt-6-astra'});
  assert.equal(f.c.state.sandboxReadiness,'ready');
  assert.equal(f.calls.filter(x=>x.method==='windowsSandbox/readiness').length,1);
  const emit=f.connections.findLast(x=>typeof x.onEvent==='function').onEvent;
  emit({method:'warning',params:{message:'Global warning',threadId:null}});
  emit({method:'warning',params:{message:'Other thread',threadId:'elsewhere'}});
  emit({method:'guardianWarning',params:{message:'Wrong thread guardian',threadId:'elsewhere'}});
  emit({method:'model/rerouted',params:{threadId:'native-events-thread',turnId:'turn-1',fromModel:'gpt-6-astra',toModel:'gpt-6-luna',reason:'highRiskCyberActivity'}});
  assert.equal(f.c.state.notices.length,2);
  assert.deepEqual(f.c.state.notices.map(n=>n.kind),['warning','modelRerouted']);
  assert.match(f.c.state.notices[1].message,/gpt-6-astra → gpt-6-luna/);
  assert.equal(f.c.state.notices[1].turnId,'turn-1');
  assert.equal(f.c.state.model,'gpt-6-astra');
  emit({method:'guardianWarning',params:{message:'Targeted warning',threadId:'native-events-thread'}});
  assert.equal(f.c.state.notices.at(-1).kind,'guardianWarning');
  const beforeErrorState={busy:f.c.state.busy,status:f.c.state.status};
  emit({method:'error',params:{threadId:'elsewhere',turnId:'ignored',willRetry:true,error:{message:'wrong thread'}}});
  assert.equal(f.c.state.notices.some(n=>n.kind==='nativeError'),false);
  emit({method:'error',params:{threadId:'native-events-thread',turnId:'turn-1',willRetry:true,error:{message:'transient upstream failure'}}});
  assert.equal(f.c.state.notices.at(-1).level,'error');
  assert.equal(f.c.state.notices.at(-1).message,'transient upstream failure');
  assert.deepEqual({busy:f.c.state.busy,status:f.c.state.status},beforeErrorState);
 }finally{await f.c.close();}
});

test('Codex rate-limit and completion events present the original error once without K boilerplate',async()=>{
 const f=await fixture();
 try{
  await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>typeof x.onEvent==='function').onEvent;
  emit({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:100}}}});
  await f.c.usage();assert.deepEqual(f.c.state.notices,[]);
  const message='Native quota limit reached';
  emit({method:'error',params:{threadId:'native-events-thread',turnId:'turn-1',willRetry:false,error:{message}}});
  assert.equal(f.c.state.notices.at(-1).message,message);
  assert.equal(visibleNativeNotices(f.c.state.notices,f.c.state.error).length,1);
  emit({method:'turn/completed',params:{threadId:'native-events-thread',turn:{id:'turn-1',status:'failed',error:{message}}}});
  assert.equal(f.c.state.error,message);
  assert.equal(visibleNativeNotices(f.c.state.notices,f.c.state.error).length,0);
  assert.equal(f.calls.some(c=>c.method==='turn/start'),false);
 }finally{await f.c.close();}
});

test('native summaries, turn diff, and patch updates are retained without accepting raw reasoning text',async()=>{
 const f=await fixture();
 try{
  await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>typeof x.onEvent==='function').onEvent;
  emit({method:'item/reasoning/summaryPartAdded',params:{threadId:'native-events-thread',turnId:'turn-1',itemId:'reasoning-1',summaryIndex:0}});
  emit({method:'item/reasoning/summaryTextDelta',params:{threadId:'native-events-thread',turnId:'turn-1',itemId:'reasoning-1',summaryIndex:0,delta:'Native summary'}});
  emit({method:'item/reasoning/textDelta',params:{threadId:'native-events-thread',turnId:'turn-1',itemId:'reasoning-1',delta:'raw chain of thought'}});
  assert.deepEqual(f.c.state.reasoning,[{id:'reasoning-1:0',turnId:'turn-1',groupId:'turn:turn-1',text:'Native summary'}]);
  emit({method:'turn/diff/updated',params:{threadId:'native-events-thread',turnId:'turn-1',diff:'diff one'}});
  emit({method:'turn/diff/updated',params:{threadId:'native-events-thread',turnId:'turn-1',diff:'diff two'}});
  emit({method:'item/fileChange/patchUpdated',params:{threadId:'native-events-thread',turnId:'turn-1',itemId:'patch-1',changes:[{path:'result.txt',kind:{type:'update'},diff:'-old\n+new'}]}});
  const updated={id:'patch-1',type:'fileChange',status:'completed',changes:[{path:'result.txt',kind:{type:'update'},diff:'stale snapshot'}]};
  emit({method:'item/completed',params:{threadId:'native-events-thread',turnId:'turn-1',item:updated}});
  assert.deepEqual(f.c.state.turnDiffs,[{turnId:'turn-1',diff:'diff two'}]);
  assert.deepEqual(f.c.state.tools.find(t=>t.id==='patch-1').patchChanges,[{path:'result.txt',kind:{type:'update'},diff:'-old\n+new'}]);
  assert.deepEqual(f.c.state.tools.find(t=>t.id==='patch-1').details,[{path:'result.txt',kind:{type:'update'},diff:'-old\n+new'}]);
 }finally{await f.c.close();}
});

test('sandbox readiness notices are read-only and native view data resets when opening another conversation',async()=>{
 const f=await fixture({readiness:'updateRequired'});
 try{
  await f.c.open({model:'gpt-6-astra'});
  assert.equal(f.c.state.sandboxReadiness,'updateRequired');
  assert.ok(f.c.state.notices.some(n=>n.kind==='windowsSandboxReadiness'));
  assert.equal(f.calls.find(x=>x.method==='windowsSandbox/readiness').timeoutMs,5000);
  assert.equal(f.calls.some(x=>x.method==='windowsSandbox/setupStart'),false);
  const oldEvent=f.connections.findLast(x=>typeof x.onEvent==='function').onEvent;
  oldEvent({method:'turn/diff/updated',params:{threadId:'native-events-thread',turnId:'old-turn',diff:'old diff'}});
  assert.equal(f.c.state.turnDiffs.length,1);
  await f.c.selectWorkspace({path:f.root});
  await f.c.open({model:'gpt-6-astra'});
  assert.deepEqual(f.c.state.turnDiffs,[]);
  assert.deepEqual(f.c.state.reasoning,[]);
  const afterReopen=f.c.state.notices.map(n=>n.kind);
  oldEvent({method:'warning',params:{message:'stale',threadId:null}});
  assert.deepEqual(f.c.state.notices.map(n=>n.kind),afterReopen);
 }finally{await f.c.close();}
});

test('a streamed native reasoning summary is bounded and visibly marked when truncated',async()=>{
 const f=await fixture();
 try{
  await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>typeof x.onEvent==='function').onEvent;
  emit({method:'item/reasoning/summaryTextDelta',params:{threadId:'native-events-thread',turnId:'turn-1',itemId:'long-summary',summaryIndex:0,delta:'x'.repeat(17000)}});
  const summary=f.c.state.reasoning[0].text;
  assert.ok(summary.length<17000);
  assert.ok(summary.endsWith('[摘要已截斷；僅顯示部分內容]'));
  emit({method:'item/reasoning/summaryTextDelta',params:{threadId:'native-events-thread',turnId:'turn-1',itemId:'long-summary',summaryIndex:0,delta:'extra'}});
  assert.equal(f.c.state.reasoning[0].text,summary);
 }finally{await f.c.close();}
});
