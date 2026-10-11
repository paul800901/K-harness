import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {visibleNativeNotices} from '../frontend/native-notices.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';

async function fixture({readiness='ready',gatewayFactory,bridgeFactory}={}){
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
 const c=createDesktopController({root,executable:'fixture',gatewayFactory,bridgeFactory,hostFactory:options=>{connections.push(options);return host;}});
 return {c,calls,connections,root,host};
}

test('context hook reads only its own main room and hook metadata cannot mutate goals',async()=>{
 let api;const f=await fixture({gatewayFactory:async options=>{api=options;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://127.0.0.1:9999/mcp',headers:{Authorization:'Bearer fake'}}}},close:async()=>{}};}});
 const original=f.host.request;
 const accepted={type:'userMessage',id:'original',content:[{type:'text',text:'latest accepted correction'}]};
 f.host.request=async(method,p,...rest)=>method==='thread/items/list'?{data:[{turnId:'accepted',item:accepted}],nextCursor:null}:method==='thread/turns/list'?{data:[{id:'accepted',items:[accepted]}],nextCursor:null}:original(method,p,...rest);
 try{
  await f.c.open({model:'gpt-6-astra'});const before=f.calls.length;
  for(const [sessionId,meta] of [['other',{threadId:'other'}],['child',{threadId:'child'}],['native-events-thread',{threadId:'child'}],['native-events-thread',{}]])await assert.rejects(api.readContext({hook:true,sessionId},meta),/own main/);
  assert.equal(f.calls.length,before);
  const wire=await api.readContext({hook:true,sessionId:'native-events-thread'},{threadId:'native-events-thread'});
  assert.equal(wire.hookSpecificOutput.hookEventName,'SessionStart');assert.match(wire.hookSpecificOutput.additionalContext,/latest accepted correction/);
  await assert.rejects(api.readContext({hook:true,sessionId:'native-events-thread',original:{messageId:'original',turnId:'accepted',offset:0}},{threadId:'native-events-thread'}),/own main/);
  await assert.rejects(api.editGoal({objective:'override'},{threadId:'native-events-thread'}),/只能/);
  await assert.rejects(api.resumeGoal({},{threadId:'native-events-thread'}),/只能/);
  f.connections.at(-1).onEvent({method:'turn/started',params:{threadId:'native-events-thread',turn:{id:'live'}}});
  const context=await api.readContext({}, {'x-codex-turn-metadata':{thread_id:'native-events-thread',turn_id:'live'}});
  assert.equal(context.userMessages[0].id,'original');assert.equal(context.goal,null);
  const full=await api.readContext({original:{messageId:'original',turnId:'accepted',offset:7}}, {'x-codex-turn-metadata':{thread_id:'native-events-thread',turn_id:'live'}});
  assert.equal(full.original.text,'accepted correction');assert.equal(full.original.charCount,26);assert.equal(full.original.nextOffset,null);
  await assert.rejects(api.readContext({original:{messageId:'original',turnId:'accepted',offset:0}}, {'x-codex-turn-metadata':{thread_id:'child',turn_id:'live'}}),/只能/);
  await assert.rejects(api.readContext({}, {'x-codex-turn-metadata':{thread_id:'child',turn_id:'live'}}),/只能/);
 }finally{await f.c.close();}
});

test('context RPC failure stays UNKNOWN and a switched room discards a pending snapshot',async()=>{
 let api;const f=await fixture({gatewayFactory:async options=>{api=options;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://127.0.0.1:9999/mcp',headers:{Authorization:'Bearer fake'}}}},close:async()=>{}};}});
 try{
  await f.c.open({model:'gpt-6-astra'});const original=f.host.request;
  f.host.request=async(method,p,...rest)=>method==='thread/turns/list'?Promise.reject(Error('native timeout')):original(method,p,...rest);
  const wire=await api.readContext({hook:true,sessionId:'native-events-thread'},{threadId:'native-events-thread'});
  assert.match(wire.hookSpecificOutput.additionalContext,/UNKNOWN/);assert.match(wire.hookSpecificOutput.additionalContext,/native timeout/);
  let release;f.host.request=async(method,p,...rest)=>method==='thread/turns/list'?new Promise(r=>release=r):original(method,p,...rest);
  const pending=api.readContext({hook:true,sessionId:'native-events-thread'},{threadId:'native-events-thread'});
  await new Promise(r=>setImmediate(r));f.c.state.threadId='changed';release({data:[],nextCursor:null});
  await assert.rejects(pending,/changed/);f.c.state.threadId='native-events-thread';
 }finally{await f.c.close();}
});

test('Codex work telemetry follows current native turn events, not other rooms, usage, or reads',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});assert.equal(f.c.state.activity,null);
  const emit=f.connections.findLast(x=>x.onEvent).onEvent;
  emit({method:'turn/started',params:{threadId:'native-events-thread',turn:{id:'live'}}});
  assert.ok(f.c.state.activity.lastEventAt);
  const before=structuredClone(f.c.state.activity);
  for(const [threadId,turnId] of [['child','live'],['native-events-thread','old']])emit({method:'item/agentMessage/delta',params:{threadId,turnId,itemId:'ignored',delta:'not current work'}});
  await f.c.usage();assert.deepEqual(f.c.state.activity,before);
  emit({method:'item/started',params:{threadId:'native-events-thread',turnId:'live',item:{id:'wait',type:'mcpToolCall',tool:'gemini_wait'}}});assert.equal(f.c.state.activity.phase,'worker');
  emit({method:'item/completed',params:{threadId:'native-events-thread',turnId:'live',item:{id:'wait',type:'mcpToolCall',tool:'gemini_wait'}}});assert.equal(f.c.state.activity.phase,'active');
 }finally{await f.c.close();}
});

test('Codex counts unique main-thread completed compactions, not starts or legacy echoes',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});assert.equal(f.c.state.progress.compactions,0);assert.equal(f.c.state.progress.compactionsComplete,true);
  const emit=f.connections.findLast(x=>x.onEvent).onEvent;
  const event=(method,id,threadId='native-events-thread')=>emit({method,params:{threadId,turnId:'t',item:{id,type:'contextCompaction'}}});
  event('item/started','first');assert.equal(f.c.state.progress.compactions,0);
  event('item/completed','child','child-thread');assert.equal(f.c.state.progress.compactions,0);
  event('item/completed','first');event('thread/compacted','first');event('item/completed','first');
  assert.equal(f.c.state.progress.compactions,1);
  event('item/started','failed');emit({method:'turn/completed',params:{threadId:'native-events-thread',turn:{id:'t',status:'failed'}}});assert.equal(f.c.state.progress.compactions,1);
  event('item/completed','second');assert.equal(f.c.state.progress.compactions,2);
 }finally{await f.c.close();}
});

test('Codex reconstructs counts from native history on reopen and isolates chats',async()=>{
 const f=await fixture(),original=f.host.request;let history=[{id:'t',status:'failed',items:[{type:'contextCompaction',id:'history-1'},{type:'contextCompaction',id:'history-1'},{type:'contextCompaction',id:'history-2'}]}];
 f.host.request=async(method,p,...rest)=>method==='thread/read'?{thread:{turns:history}}:original(method,p,...rest);
 try{
  await saveMainSession(f.root,{threadId:'native-events-thread',model:'gpt-6-astra',workspace:f.root});
  await f.c.open({model:'gpt-6-astra',threadId:'native-events-thread'});
  assert.equal(f.c.state.progress.compactions,2);assert.equal(f.c.state.progress.compactionsComplete,true);
  f.connections.findLast(x=>x.onEvent).onEvent({method:'item/completed',params:{threadId:'native-events-thread',item:{type:'contextCompaction',id:'history-2'}}});assert.equal(f.c.state.progress.compactions,2);
  await f.c.close();await f.c.open({model:'gpt-6-astra',threadId:'native-events-thread'});assert.equal(f.c.state.progress.compactions,2);
  await saveMainSession(f.root,{threadId:'other-room',model:'gpt-6-astra',workspace:f.root});history=undefined;
  await f.c.open({model:'gpt-6-astra',threadId:'other-room'});assert.equal(f.c.state.progress.compactions,null);assert.equal(f.c.state.progress.compactionsComplete,false);
 }finally{await f.c.close();}
});

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

test('reopening native file-change history restores patch status without a turn diff or new work',async()=>{
 const f=await fixture(),original=f.host.request;
 // Required fileChange fields and statuses from the installed Codex ThreadReadResponse schema.
 const changes=['completed','inProgress','declined','failed'].map(status=>({id:`patch-${status}`,type:'fileChange',status,changes:[{path:`${status}.txt`,kind:{type:'update',move_path:null},diff:`-old ${status}\n+new ${status}`}]}));
 const history=[{id:'history-turn',status:'completed',error:null,items:[{id:'history-answer',type:'agentMessage',text:'Recorded answer'},...changes]}];
 f.host.request=async(method,p,...rest)=>method==='thread/read'?{thread:{turns:structuredClone(history)}}:original(method,p,...rest);
 try{
  await saveMainSession(f.root,{threadId:'native-events-thread',model:'gpt-6-astra',workspace:f.root});
  for(let attempt=0;attempt<2;attempt++){
   await f.c.open({model:'gpt-6-astra',threadId:'native-events-thread'});
   assert.deepEqual(f.c.state.turnDiffs,[]);
   assert.deepEqual(f.c.state.tools.map(tool=>({id:tool.id,status:tool.status,patchChanges:tool.patchChanges})),changes.map(item=>({id:item.id,status:item.status,patchChanges:item.changes})));
   assert.equal(f.c.state.messages.filter(message=>message.text==='Recorded answer').length,1);
   assert.equal(f.calls.some(call=>call.method==='turn/start'||call.method==='turn/steer'),false);
   await f.c.close();
  }
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

test('retry notices update one episode, recover on model progress, and retain raw diagnostics without replay',async()=>{
 const f=await fixture();
 try{
  await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>x.onEvent).onEvent;
  const threadId='native-events-thread',turnId='retry-turn';
  emit({method:'turn/started',params:{threadId,turn:{id:turnId}}});
  const retry=message=>emit({method:'error',params:{threadId,turnId,willRetry:true,error:{message}}});
  retry('Reconnecting... 1/5');retry('Reconnecting... 2/5');retry('Reconnecting... waiting for network');
  const records=structuredClone(f.c.state.notices);
  assert.equal(records.length,3);assert.ok(records.every(n=>n.willRetry===true));
  assert.equal(new Set(records.map(n=>n.retryKey)).size,1);assert.ok(records[0].retryKey);
  assert.equal(visibleNativeNotices(f.c.state.notices).length,1);
  assert.equal(visibleNativeNotices(f.c.state.notices)[0].message,'Reconnecting... waiting for network');
  emit({method:'item/agentMessage/delta',params:{threadId:'other',turnId,itemId:'wrong',delta:'unrelated'}});
  emit({method:'item/commandExecution/outputDelta',params:{threadId,turnId,itemId:'tool',delta:'background output'}});
  assert.equal(visibleNativeNotices(f.c.state.notices).length,1,'unrelated/background output is not a recovered model stream');
  emit({method:'item/agentMessage/delta',params:{threadId,turnId,itemId:'reply',delta:'recovered'}});
  assert.equal(visibleNativeNotices(f.c.state.notices).length,0);
  assert.deepEqual(f.c.state.notices.map(n=>n.message),records.map(n=>n.message));
  retry('Reconnecting... 1/5');assert.notEqual(f.c.state.notices.at(-1).retryKey,records[0].retryKey,'new incident must not inherit dismissal');
  emit({method:'error',params:{threadId,turnId,willRetry:false,error:{message:'Native connection failed'}}});
  assert.deepEqual(visibleNativeNotices(f.c.state.notices).map(n=>n.message),['Native connection failed']);
  emit({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'failed',error:{message:'Native connection failed'}}}});
  assert.equal(visibleNativeNotices(f.c.state.notices,f.c.state.error).length,0,'terminal error stays in main alert, not duplicated');
  assert.equal(f.calls.some(c=>['turn/start','turn/steer','turn/interrupt'].includes(c.method)),false);
 }finally{await f.c.close();}
});

test('Codex goals preserve empty native history and stopping pauses continuation before interrupt',async()=>{
 const f=await fixture(),original=f.host.request;let goal=null;
 f.host.request=async(method,params)=>{if(method.startsWith('thread/goal/')){f.calls.push({method,params});if(method.endsWith('/set'))goal={...goal,...params};if(method.endsWith('/clear'))goal=null;return {goal};}return original(method,params);};
 try{
  const {threadId}=await f.c.open({model:'gpt-6-astra'});await f.c.goal({objective:'test goal',status:'active'});
  const {listMainSessions}=await import('../src/main-sessions.mjs');assert.equal((await listMainSessions(f.root)).sessions[0].codexSession.hasSubmitted,true);
  const emit=f.connections.findLast(x=>x.onEvent).onEvent;emit({method:'turn/started',params:{threadId,turn:{id:'goal-turn'}}});await f.c.stop();assert.equal(f.c.state.goal.status,'paused');
  const pause=f.calls.findIndex(c=>c.method==='thread/goal/set'&&c.params.status==='paused'),stop=f.calls.findIndex(c=>c.method==='turn/interrupt');assert(pause>=0&&stop>pause);
  await f.c.goal({clear:true});assert.equal(f.c.state.goal,null);
  f.host.request=async(method,params)=>method==='thread/goal/get'?Promise.reject(Error('cannot read goal')):original(method,params);await assert.rejects(f.c.goal({refresh:true}),/cannot read/);assert.match(f.c.state.goalError,/cannot read/);
 }finally{await f.c.close();}
});

test('Codex pause failure does not skip turn interruption or closing the host',async()=>{
 const f=await fixture(),original=f.host.request;let closed=false;f.host.close=async()=>{closed=true;};
 f.host.request=async(method,p,...rest)=>{if(method==='thread/goal/set')throw Error('pause unavailable');return original(method,p,...rest);};
 try{await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>x.onEvent).onEvent;
 emit({method:'thread/goal/updated',params:{threadId:f.c.state.threadId,goal:{objective:'fake',status:'active'}}});emit({method:'turn/started',params:{threadId:f.c.state.threadId,turn:{id:'goal-turn'}}});
 await assert.rejects(f.c.stop(),/暫停未確認/);assert.equal(f.c.state.status,'uncertain');assert(f.calls.some(x=>x.method==='turn/interrupt'&&x.params.turnId==='goal-turn'));
 f.host.request=async(method,p,...rest)=>{if(method==='thread/goal/get')throw Error('read unavailable');return original(method,p,...rest);};
 await f.c.close();assert(closed);assert.match(f.c.state.goalError,/暫停未確認/);
 }finally{await f.c.close();}
});

test('Codex AI and human edit the same native goal without resume, replay or cross-thread access',async()=>{
 let gateway;const f=await fixture({gatewayFactory:async o=>{gateway=o;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://127.0.0.1:1/mcp',headers:{Authorization:'Bearer fixture'}}}},close:async()=>{}};}}),original=f.host.request;
 let nativeGoal=null;
 f.host.request=async(method,params)=>{if(method.startsWith('thread/goal/')){f.calls.push({method,params});if(method.endsWith('/set'))nativeGoal={...nativeGoal,...params};if(method.endsWith('/clear'))nativeGoal=null;return{goal:structuredClone(nativeGoal)};}return original(method,params);};
 try{
  const {threadId}=await f.c.open({model:'gpt-6-astra'});await f.c.goal({objective:'original',status:'paused',tokenBudget:500});nativeGoal.tokensUsed=42;nativeGoal.timeUsedSeconds=60;
  const emit=f.connections.at(-1).onEvent;emit({method:'turn/started',params:{threadId,turn:{id:'edit-turn'}}});
  const meta={'x-codex-turn-metadata':{thread_id:threadId,turn_id:'edit-turn'}};
  const result=await gateway.editGoal({objective:'AI edited'},meta);assert.equal(result.goal.status,'paused');assert.equal(result.goal.tokenBudget,500);assert.equal(result.goal.tokensUsed,42);assert.equal(result.goal.timeUsedSeconds,60);assert.equal(f.c.state.questions.length,0);
  await f.c.goal({objective:'human edited',editOnly:true,expectedObjective:'AI edited'});assert.equal(nativeGoal.objective,'human edited');assert.equal(f.c.state.busy,true);
  await assert.rejects(f.c.goal({objective:'stale human',editOnly:true,expectedObjective:'original'}),/另一方更新/);assert.equal(nativeGoal.objective,'human edited');
  const count=f.calls.filter(c=>c.method==='thread/goal/set').length;
  for(const bad of [undefined,{}, {'x-codex-turn-metadata':'bad'},{'x-codex-turn-metadata':{thread_id:'child',turn_id:'edit-turn'}},{'x-codex-turn-metadata':{thread_id:threadId,turn_id:'old'}}])await assert.rejects(gateway.editGoal({objective:'not applied'},bad),/目前主對話/);
  await assert.rejects(f.c.goal({objective:'bad',editOnly:true,status:'active'}),/只修改文字/);
  assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,count);
  assert.deepEqual(f.calls.filter(c=>c.method==='thread/goal/set').slice(1).map(c=>c.params),[{threadId,objective:'AI edited'},{threadId,objective:'human edited'}]);
  assert(!f.calls.some(c=>c.method==='turn/start'||c.method==='turn/steer'));
  nativeGoal=null;await assert.rejects(gateway.editGoal({objective:'not new'},meta),/沒有可修改/);
  emit({method:'turn/completed',params:{threadId,turn:{id:'edit-turn',status:'completed'}}});await assert.rejects(gateway.editGoal({objective:'late'},meta),/目前主對話/);
 }finally{await f.c.close();}
});

test('stopping during a goal edit read does not apply the pending objective',async()=>{
 const f=await fixture(),original=f.host.request;let release,reading;const started=new Promise(r=>reading=r);
 try{
  await f.c.open({model:'gpt-6-astra'});f.host.request=async(method,p)=>{if(method==='thread/goal/get'&&!release){reading();return new Promise(r=>release=r);}return original(method,p);};
  const edit=f.c.goal({objective:'not applied',editOnly:true});const rejected=assert.rejects(edit,/停止或切換/);await started;await f.c.stop();release({goal:{objective:'old',status:'paused'}});await rejected;
  assert(!f.calls.some(c=>c.method==='thread/goal/set'));assert.equal(f.c.state.goalPending,false);
 }finally{await f.c.close();}
});

test('Codex main AI resumes an existing paused or blocked goal during its turn without replay or limit bypass',async()=>{
 let gateway;const f=await fixture({gatewayFactory:async o=>{gateway=o;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://127.0.0.1:1/mcp',headers:{Authorization:'Bearer fixture'}}}},close:async()=>{}};}}),original=f.host.request;
 let nativeGoal=null;
 f.host.request=async(method,params)=>{if(method.startsWith('thread/goal/')){f.calls.push({method,params});if(method.endsWith('/set'))nativeGoal={...nativeGoal,...params};return {goal:structuredClone(nativeGoal)};}return original(method,params);};
 try{
  const {threadId}=await f.c.open({model:'gpt-6-astra'});await f.c.goal({objective:'discussed goal',status:'paused',tokenBudget:500});Object.assign(nativeGoal,{tokensUsed:42,timeUsedSeconds:60,createdAt:123});
  const emit=f.connections.at(-1).onEvent;emit({method:'turn/started',params:{threadId,turn:{id:'resume-turn'}}});
  const meta={'x-codex-turn-metadata':{thread_id:threadId,turn_id:'resume-turn'}};
  for(const bad of [undefined,{}, {'x-codex-turn-metadata':'bad'},{'x-codex-turn-metadata':{thread_id:'child',turn_id:'resume-turn'}},{'x-codex-turn-metadata':{thread_id:threadId,turn_id:'old'}}])await assert.rejects(gateway.resumeGoal({},bad),/目前主對話/);
  const before=structuredClone(nativeGoal),result=await gateway.resumeGoal({},meta);assert.deepEqual(result.goal,{...before,status:'active'});assert.equal(f.c.state.busy,true);assert.equal(f.c.state.questions.length,0);
  const count=f.calls.filter(c=>c.method==='thread/goal/set').length;
  assert.deepEqual((await gateway.resumeGoal({},meta)).goal,result.goal);assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,count,'already active is a readback, not another set');
  assert.deepEqual(f.calls.filter(c=>c.method==='thread/goal/set').slice(1).map(c=>c.params),[{threadId,status:'active'}]);
  nativeGoal.status='blocked';const blockedBefore=structuredClone(nativeGoal),blockedResult=await gateway.resumeGoal({},meta);assert.deepEqual(blockedResult.goal,{...blockedBefore,status:'active'});assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,count+1);
  for(const status of ['complete','usageLimited','budgetLimited','unknown']){nativeGoal.status=status;await assert.rejects(gateway.resumeGoal({},meta),/並非已暫停或受阻/);assert.equal(nativeGoal.status,status);}
  for(const extra of [{objective:'changed'},{tokenBudget:999},{editOnly:true},{refresh:true},{clear:true},{status:'paused'}])await assert.rejects(f.c.goal({status:'active',resumeOnly:true,...extra}));
  assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,count+1);
  nativeGoal=null;await assert.rejects(gateway.resumeGoal({},meta),/沒有可繼續/);
  emit({method:'turn/completed',params:{threadId,turn:{id:'resume-turn',status:'completed'}}});await assert.rejects(gateway.resumeGoal({},meta),/目前主對話/);
  assert(!f.calls.some(c=>['turn/start','turn/steer','turn/interrupt'].includes(c.method)));
 }finally{await f.c.close();}
});

test('human resume is allowed during a turn; stop wins over a pending resume read or write',async()=>{
 for(const phase of ['get','set']){
  const f=await fixture(),original=f.host.request;let nativeGoal={objective:'same',status:'paused'},release,reading;const started=new Promise(r=>reading=r);
  try{
   const {threadId}=await f.c.open({model:'gpt-6-astra'});const emit=f.connections.at(-1).onEvent;emit({method:'turn/started',params:{threadId,turn:{id:'human-turn'}}});
   f.host.request=async(method,p)=>{
    if(method.startsWith('thread/goal/')){
     f.calls.push({method,params:p});
     if(method===`thread/goal/${phase}`&&!release){reading();await new Promise(r=>release=r);}
     if(method==='thread/goal/set')nativeGoal={...nativeGoal,...p};return {goal:structuredClone(nativeGoal)};
    }return original(method,p);
   };
   const resume=f.c.goal({status:'active',resumeOnly:true});
   const checked=phase==='get'?assert.rejects(resume,/停止或切換/):resume;
   await started;const stop=f.c.stop();if(phase==='get')await stop;release();await checked;await stop;
   assert.notEqual(nativeGoal.status,'active');assert.equal(f.c.state.goalPending,false);
   const writes=f.calls.filter(c=>c.method==='thread/goal/set').map(c=>c.params.status);assert.deepEqual(writes,phase==='get'?[]:['active','paused']);
   assert(!f.calls.some(c=>c.method==='turn/start'||c.method==='turn/steer'));
  }finally{await f.c.close();}
 }
});

test('a cancelled goal read cannot poison stop while native interruption is still pending',async()=>{
 for(const change of [{status:'active',resumeOnly:true},{objective:'not applied',editOnly:true}]){
  const f=await fixture(),original=f.host.request;let releaseRead,releaseInterrupt,readStarted,interruptStarted;
  const reading=new Promise(r=>readStarted=r),interrupting=new Promise(r=>interruptStarted=r);
  try{
   const {threadId}=await f.c.open({model:'gpt-6-astra'});const emit=f.connections.at(-1).onEvent;
   emit({method:'thread/goal/updated',params:{threadId,goal:{objective:'same',status:'paused'}}});emit({method:'turn/started',params:{threadId,turn:{id:'stopping-turn'}}});
   f.host.request=async(method,p)=>{
    if(method==='thread/goal/get'&&!releaseRead){readStarted();await new Promise(r=>releaseRead=r);return {goal:{objective:'same',status:'paused'}};}
    if(method==='turn/interrupt'&&!releaseInterrupt){interruptStarted();await new Promise(r=>releaseInterrupt=r);}
    return original(method,p);
   };
   const rejected=assert.rejects(f.c.goal(change),/停止或切換/);await reading;
   const stopped=f.c.stop().then(value=>({value}),error=>({error}));await interrupting;
   releaseRead();await rejected;releaseInterrupt();const result=await stopped;
   assert.equal(result.error,undefined);assert.equal(f.c.state.goalError,null);assert.equal(f.c.state.status,'interrupted');assert.equal(f.c.state.goal.status,'paused');
   assert(!f.calls.some(c=>c.method==='thread/goal/set'));
  }finally{releaseRead?.();releaseInterrupt?.();await f.c.close();}
 }
});

const streamError={message:'stream disconnected before completion: synthetic request ID',codexErrorInfo:'other',additionalDetails:null};
async function streamFixture(bridgeFactory){
 let gateway;const f=await fixture({bridgeFactory,gatewayFactory:async o=>{gateway=o;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://127.0.0.1:1/fake',headers:{Authorization:'Bearer fixture'}}}},close:async()=>{}};}});
 let close;f.host.closed=new Promise(r=>close=r);
 await f.c.open({model:'gpt-6-astra'});
 const emit=(method,params={})=>f.connections.at(-1).onEvent({method,params:{threadId:f.c.state.threadId,...params}});
 const finish=(id='stream-turn',error=streamError)=>{emit('turn/started',{turn:{id}});emit('item/agentMessage/delta',{turnId:id,itemId:'answer-'+id,delta:'saved partial'});emit('error',{turnId:id,willRetry:false,error});emit('turn/completed',{turn:{id,status:error?'failed':'completed',error}});};
 return {...f,gateway,emit,finish,close};
}
const nextTick=()=>new Promise(r=>setImmediate(r));
test('terminal native error stays primary when worker settlement lookup fails and secondary failure remains visible',async()=>{
 let rejectList=false;const f=await streamFixture(async()=>({list:async()=>{if(rejectList)throw Error('fixture-worker-read-failed');return [];},close:async()=>{}}));
 try{await f.gateway.bridge.list();rejectList=true;f.finish();for(let i=0;i<5;i++)await nextTick();
  assert.equal(f.c.state.error,streamError.message);assert.deepEqual(f.c.state.turnError.error,streamError);
  assert(f.c.state.messages.some(m=>m.text==='saved partial'&&m.partial));
  assert(visibleNativeNotices(f.c.state.notices,f.c.state.error).some(n=>/fixture-worker-read-failed/.test(n.message)));
  assert(!f.calls.some(c=>c.method==='turn/interrupt'||c.method==='turn/start'));
 }finally{rejectList=false;await f.c.close();}
});
test('activity save failure cannot overwrite terminal native error',async()=>{
 const f=await streamFixture();
 try{const file=path.join(f.root,'.runtime/main-sessions',f.c.state.threadId+'-current.json');await rename(file,file.replace('-current.json','-prior.json'));await mkdir(file);
  f.finish();for(let i=0;i<100&&!f.c.state.notices.some(n=>/活動時間保存失敗/.test(n.message));i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(f.c.state.error,streamError.message);assert.deepEqual(f.c.state.turnError.error,streamError);
  assert(visibleNativeNotices(f.c.state.notices,f.c.state.error).some(n=>/活動時間保存失敗/.test(n.message)));
 }finally{await f.c.close();}
});
test('late worker settlement failure from old native turn cannot contaminate newer completed turn',async()=>{
 let held=false,rejectOld;const f=await streamFixture(async()=>({list:async()=>held?new Promise((_r,j)=>rejectOld=j):[],close:async()=>{}}));
 try{await f.gateway.bridge.list();held=true;f.finish('old-turn');for(let i=0;i<3;i++)await nextTick();assert(rejectOld);
  held=false;f.emit('turn/started',{turn:{id:'new-turn'}});f.emit('turn/completed',{turn:{id:'new-turn',status:'completed',error:null}});
  rejectOld(Error('old-turn-read-failed'));for(let i=0;i<5;i++)await nextTick();
  assert.equal(f.c.state.error,null);assert.equal(f.c.state.status,'completed');assert(!f.c.state.notices.some(n=>/old-turn-read-failed/.test(n.message)));
 }finally{held=false;await f.c.close();}
});
test('host loss after drained terminal error preserves native primary; newer active or completed turn still reports loss',async()=>{
 for(const newer of [null,'active','completed']){
  const f=await streamFixture();try{f.finish();for(let i=0;i<3;i++)await nextTick();
   if(newer){f.emit('turn/started',{turn:{id:'new-turn'}});if(newer==='completed')f.emit('turn/completed',{turn:{id:'new-turn',status:'completed',error:null}});}
   f.close();for(let i=0;i<3;i++)await nextTick();
   assert.equal(f.c.state.status,'offline');assert.equal(f.c.state.busy,false);
   if(!newer){assert.equal(f.c.state.error,streamError.message);assert.deepEqual(f.c.state.turnError.error,streamError);}
   else{assert.match(f.c.state.error,/斷線/);assert.equal(f.c.state.turnError,null);}
  }finally{await f.c.close();}
 }
});

for(const stopped of [false,true])test(`native terminal uncertainty resolves after exact readback with stopRequested=${stopped} without dispatch`,async()=>{
  const f=await fixture(),original=f.host.request;let missing=false;
  f.host.request=async(method,p,...rest)=>method==='thread/read'&&p.threadId==='child'
   ?{thread:{id:'child',parentThreadId:'native-events-thread',status:{type:'idle'},turns:missing?[]:[{id:'child-turn',status:'completed'}]}}
   :original(method,p,...rest);
  try{
   await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>x.onEvent).onEvent;
   emit({method:'turn/started',params:{threadId:'native-events-thread',turn:{id:'parent-turn'}}});
   emit({method:'item/completed',params:{threadId:'native-events-thread',item:{id:'spawn-child',type:'collabAgentToolCall',receiverThreadIds:['child']}}});await f.c.workers();
   emit({method:'turn/started',params:{threadId:'child',turn:{id:'child-turn'}}});await f.c.workers();missing=true;
   emit({method:'turn/completed',params:{threadId:'child',turn:{id:'child-turn',status:'completed'}}});await f.c.workers();
   assert.equal(f.c.state.notices.filter(n=>n.nativeTerminal&&!n.resolved).length,1);
   emit({method:'turn/completed',params:{threadId:'native-events-thread',turn:{id:'parent-turn',status:'failed'}}});await f.c.workers();
   f.c.state.goal={status:'paused'};missing=false;
   if(stopped)await f.c.stop();await f.c.workers();
   const raw=f.c.state.notices.find(n=>n.nativeTerminal);assert.equal(raw.resolved,true,'Verified display facts resolve independently of paused/stop dispatch guard');
   assert.equal(visibleNativeNotices(f.c.state.notices).filter(n=>n.nativeTerminal).length,0);
   assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
  }finally{missing=false;await f.c.close();}
});

async function terminalNoticeFixture(ids=['child-a']){
 const f=await fixture(),original=f.host.request,rows=new Map(ids.map(id=>[id,{mode:'running',turnId:id+'-turn',status:'completed'}]));
 let release;
 f.host.request=async(method,p,...rest)=>{
  const row=rows.get(p?.threadId);
  if(method==='thread/read'&&row){if(row.mode==='throw')throw Error('synthetic transient read failure');return {thread:{id:p.threadId,parentThreadId:row.parent??'native-events-thread',historyMode:'paginated',status:{type:row.mode==='running'?'active':'idle'}}};}
  if(method==='thread/turns/list'&&row){const page={data:row.mode==='missing'?[]:[{id:row.readTurn??row.turnId,status:row.mode==='running'?'inProgress':row.readStatus??row.status,items:[]}],nextCursor:null};if(row.mode==='hold'){row.mode='confirmed';return new Promise(r=>release=()=>r(page));}return page;}
  return original(method,p,...rest);
 };
 await f.c.open({model:'gpt-6-astra'});const emit=f.connections.findLast(x=>x.onEvent).onEvent;
 emit({method:'turn/started',params:{threadId:'native-events-thread',turn:{id:'parent-turn'}}});
 emit({method:'item/completed',params:{threadId:'native-events-thread',turnId:'parent-turn',item:{id:'spawn',type:'collabAgentToolCall',receiverThreadIds:ids}}});await f.c.workers();
 for(const id of ids){emit({method:'turn/started',params:{threadId:id,turn:{id:rows.get(id).turnId}}});await f.c.workers();}
 const complete=async id=>{const row=rows.get(id);emit({method:'turn/completed',params:{threadId:id,turn:{id:row.turnId,status:row.status}}});await f.c.workers();};
 const close=async()=>{for(const row of rows.values()){row.mode='confirmed';delete row.parent;delete row.readTurn;delete row.readStatus;}emit({method:'turn/completed',params:{threadId:'native-events-thread',turn:{id:'parent-turn',status:'failed'}}});await f.c.workers();await f.c.close();};
 return {...f,rows,emit,complete,close,release:()=>release?.()};
}

for(const mode of ['missing','throw'])test(`native terminal ${mode} warning resolves after exact later read while preserving raw and primary failure`,async()=>{
 const f=await terminalNoticeFixture();try{
  f.rows.get('child-a').mode=mode;await f.complete('child-a');const raw=f.c.state.notices.find(n=>n.nativeTerminal);
  assert.deepEqual(raw.nativeTerminal,{threadId:'child-a',turnId:'child-a-turn',status:'completed'});assert.equal(raw.turnId,'child-a-turn');
  assert.equal(visibleNativeNotices(f.c.state.notices).filter(n=>n.nativeTerminal).length,1);
  f.emit({method:'turn/completed',params:{threadId:'native-events-thread',turn:{id:'parent-turn',status:'failed',error:{message:'synthetic primary failure',codexErrorInfo:'other'}}}});await f.c.workers();
  f.rows.get('child-a').mode='confirmed';await f.c.workers();
  assert.equal(f.c.state.workers[0].settled,true);assert.equal(f.c.state.status,'failed');assert.equal(f.c.state.error,'synthetic primary failure');
  assert.equal(raw.resolved,true);assert.equal(f.c.state.notices.includes(raw),true);assert.equal(visibleNativeNotices(f.c.state.notices).filter(n=>n.nativeTerminal).length,0);
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
 }finally{await f.close();}
});

test('native terminal notices deduplicate only exact child turn status and never globally collapse distinct uncertainty',async()=>{
 const f=await terminalNoticeFixture(['child-a','child-b']);try{
  for(const id of f.rows.keys()){f.rows.get(id).mode='missing';await f.complete(id);}
  await f.complete('child-a');assert.equal(f.c.state.notices.filter(n=>n.nativeTerminal).length,2);
  const a=f.rows.get('child-a');a.turnId='child-a-new';a.status='failed';
  f.emit({method:'turn/started',params:{threadId:'child-a',turn:{id:a.turnId}}});await f.c.workers();await f.complete('child-a');
  a.status='completed';await f.complete('child-a');assert.equal(f.c.state.notices.filter(n=>n.nativeTerminal).length,4);
  a.mode='confirmed';await f.c.workers();const raw=f.c.state.notices.filter(n=>n.nativeTerminal);
  assert.equal(raw.filter(n=>n.resolved).length,1);assert.equal(visibleNativeNotices(raw).length,3);
  assert.equal(raw.find(n=>n.nativeTerminal.threadId==='child-b').resolved,undefined);
  assert.equal(raw.find(n=>n.nativeTerminal.turnId==='child-a-turn').resolved,undefined);
  assert.equal(raw.find(n=>n.nativeTerminal.turnId==='child-a-new'&&n.nativeTerminal.status==='failed').resolved,undefined);
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
 }finally{await f.close();}
});

test('unverified owner or different final turn/status and stale matching reads cannot resolve terminal warning',async()=>{
 const f=await terminalNoticeFixture();try{
  const a=f.rows.get('child-a');a.mode='missing';await f.complete('child-a');const raw=f.c.state.notices.find(n=>n.nativeTerminal);
  a.mode='confirmed';a.parent='foreign-parent';await f.c.workers();assert.equal(raw.resolved,undefined);delete a.parent;
  a.readTurn='other-turn';await f.c.workers();assert.equal(raw.resolved,undefined);delete a.readTurn;
  a.readStatus='failed';await f.c.workers();assert.equal(raw.resolved,undefined);delete a.readStatus;
  a.mode='hold';const old=f.c.workers();await new Promise(r=>setImmediate(r));a.mode='missing';await f.c.workers();f.release();await old;
  assert.equal(raw.resolved,undefined);assert.equal(f.c.state.workers[0].settled,false);
  a.mode='confirmed';await f.c.workers();assert.equal(raw.resolved,true);
 }finally{await f.close();}
});
