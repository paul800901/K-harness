import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';

const MODEL='gpt-6-astra';
const ROOT_TESTS=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
const catalog=[
 {model:MODEL,displayName:'GPT-6 Astra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image']},
 {model:'gpt-5.6-terra',displayName:'GPT-5.6 Terra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']},
];

const history=text=>({turns:[{items:[{type:'userMessage',id:`u-${text}`,content:[{type:'text',text:`要求 ${text}`}]},{type:'agentMessage',id:`a-${text}`,text:`回答 ${text}`}]}]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture({sessions=[{threadId:'thread-a',title:'A',accessMode:'read-only'},{threadId:'thread-b',title:'B',accessMode:'workspace-write'}],turnListUnsupportedFor=[],archivedResumeFor=[]}={}){
 await mkdir(ROOT_TESTS,{recursive:true});
 const root=await mkdtemp(path.join(ROOT_TESTS,'desktop-switch-'));
 const workspaceB=path.join(root,'workspace-b');await mkdir(workspaceB);
 const histories=new Map([['thread-a',history('A')],['thread-b',history('B')]]);
 const unsupportedTurnReads=new Set(turnListUnsupportedFor),emptySummaries=new Set(),archivedResumes=new Set(archivedResumeFor);
 for(const session of sessions)await saveMainSession(root,{threadId:session.threadId,model:session.model??MODEL,title:session.title??session.threadId,accessMode:session.accessMode??'workspace-write',workspace:session.workspace??(session.threadId==='thread-b'?workspaceB:root)});

 const hosts=[],allCalls=[];let activeHost,activeHooks,newThread=0;
 const hostFactory=options=>{
  const calls=[],waiters=[];let closeHost;
  const host={closed:new Promise(resolve=>{closeHost=resolve;}),calls,waiters,closeCount:0,
   notify(message){calls.push({method:'$notify',p:message});},
   waitForMcp(threadId,name){return new Promise((resolve,reject)=>waiters.push({threadId,name,resolve,reject}));},
   async close(){this.closeCount++;closeHost();},
   async request(method,p={}){
    const call={method,p};calls.push(call);allCalls.push({host:this,...call});
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='model/list')return {data:catalog,nextCursor:null};
    if(method==='config/read')return {config:{}};
    if(method==='thread/read'){
     if(p.includeTurns===true&&unsupportedTurnReads.has(p.threadId)){
      const error=new Error("Codex request thread/read failed (code -32601).");error.protocolMessage='list_turns is not supported yet';throw error;
     }
     if(p.includeTurns===false&&emptySummaries.has(p.threadId))return {thread:{id:p.threadId,status:{type:'idle'},preview:''}};
     return {thread:{id:p.threadId,...(histories.get(p.threadId)??{turns:[]})}};
    }
    if(method==='thread/resume'){
     if(archivedResumes.has(p.threadId)){const error=new Error('archived');error.protocolMessage=`session ${p.threadId} is archived. Run \`codex unarchive ${p.threadId}\` to unarchive it first.`;throw error;}
     return {thread:{id:p.threadId}};
    }
    if(method==='thread/unarchive'){archivedResumes.delete(p.threadId);return {thread:{id:p.threadId}};}
    if(method==='thread/start'){
     const id=`thread-new-${++newThread}`;unsupportedTurnReads.add(id);emptySummaries.add(id);
     return {thread:{id}};
    }
    if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
    if(method==='mcpServer/tool/call')return {structuredContent:{status:'completed',outputFiles:[]}};
    if(method==='turn/start'){
     const turn={id:`turn-${p.threadId}`};
     options.onEvent?.({method:'turn/started',params:{threadId:p.threadId,turn}});
     return {turn};
    }
    if(method==='turn/interrupt'){
     options.onEvent?.({method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}}});
     return {};
    }
    return {};
   },
  };
  hosts.push(host);
  if(options.onEvent){activeHost=host;activeHooks=options;}
  return host;
 };
 const c=createDesktopController({root,executable:'fixture',hostFactory});
 const settle=(threadId,index,ok,error=new Error('fixture readiness failed'))=>{
  const matching=activeHost.waiters.filter(waiter=>waiter.threadId===threadId);
  const waiter=matching[index];assert.ok(waiter,`missing readiness waiter ${threadId}[${index}]`);
  if(ok)waiter.resolve({status:'ready'});else waiter.reject(error);
 };
 const openSaved=threadId=>c.open({model:MODEL,threadId});
 return {c,root,workspaceB,hosts,allCalls,histories,get activeHost(){return activeHost;},get hooks(){return activeHooks;},settle,openSaved};
}

test('reopening the same ready conversation is a no-op',async()=>{
 const f=await fixture({sessions:[]});
 try{
  const opened=await f.c.open({model:MODEL});
  const beforeCalls=f.activeHost.calls.length,beforeHosts=f.hosts.length;
  const priorMessages=structuredClone(f.c.state.messages);
  assert.equal(f.c.state.status,'ready');
  assert.equal(f.c.state.threadId,opened.threadId);

  await f.c.open({model:MODEL,threadId:opened.threadId});

  assert.equal(f.activeHost.calls.length,beforeCalls);
  assert.equal(f.hosts.length,beforeHosts);
  assert.equal(f.activeHost.closeCount,0);
  assert.deepEqual(f.c.state.messages,priorMessages);
 }finally{await f.c.close();}
});

test('saved conversations share one initialized host and read each history before resume',async()=>{
 const f=await fixture();
 try{
  await f.openSaved('thread-a');
  const afterA=f.activeHost.calls.length;
  await f.openSaved('thread-b');

  const desktopHosts=f.hosts.filter(host=>host.calls.some(call=>call.method==='initialize'&&call.p.clientInfo?.name==='k_harness_desktop'));
  assert.equal(desktopHosts.length,1);
  assert.equal(desktopHosts[0],f.activeHost);
  assert.equal(f.activeHost.closeCount,0);
  assert.equal(f.activeHost.calls.filter(call=>call.method==='initialize'&&call.p.clientInfo?.name==='k_harness_desktop').length,1);
  assert.deepEqual(f.activeHost.calls.filter(call=>call.method==='thread/resume').map(call=>call.p.threadId),['thread-a','thread-b']);
  const callsA=f.activeHost.calls.slice(0,afterA);
  const callsB=f.activeHost.calls.slice(afterA);
  assert.ok(callsA.findIndex(call=>call.method==='thread/read'&&call.p.threadId==='thread-a')<callsA.findIndex(call=>call.method==='thread/resume'));
  assert.ok(callsB.findIndex(call=>call.method==='thread/read'&&call.p.threadId==='thread-b')<callsB.findIndex(call=>call.method==='thread/resume'));
  assert.deepEqual(f.c.state.messages.map(message=>message.text),['要求 B','回答 B']);
 }finally{await f.c.close();}
});

test('restored history and direct work remain available while optional Flash is connecting or failed',async()=>{
 const f=await fixture();
 try{
  await f.openSaved('thread-a');
  assert.equal(f.c.state.workerConnection,'connecting');
  assert.deepEqual(f.c.state.messages.map(message=>message.text),['要求 A','回答 A']);
  await f.c.send({text:'尚未連線但可直接工作'});
  f.hooks.onEvent({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'turn-thread-a',status:'completed'}}});

  f.settle('thread-a',0,false);
  await flush();
  assert.equal(f.c.state.workerConnection,'failed');
  assert.deepEqual(f.c.state.messages.map(message=>message.text),['要求 A','回答 A','尚未連線但可直接工作']);
  await f.c.send({text:'Flash 失敗但可直接工作'});
 }finally{await f.c.close();}
});

test('an exact native archived precondition is unarchived once before resume without replaying a turn',async()=>{
 const f=await fixture({archivedResumeFor:['thread-a']});
 try{
  await f.openSaved('thread-a');
  assert.deepEqual(f.activeHost.calls.filter(call=>['thread/resume','thread/unarchive'].includes(call.method)).map(call=>call.method),['thread/resume','thread/unarchive','thread/resume']);
  assert.equal(f.activeHost.calls.some(call=>call.method==='turn/start'),false);
 }finally{await f.c.close();}
});

test('events from the previous thread do not alter the active thread view or turn',async()=>{
 const f=await fixture();
 try{
  await f.openSaved('thread-a');f.settle('thread-a',0,true);await flush();
  await f.openSaved('thread-b');f.settle('thread-b',0,true);await flush();
  const before=structuredClone(f.c.state.messages);
  f.hooks.onEvent({method:'item/agentMessage/delta',params:{threadId:'thread-a',itemId:'late-a',delta:'舊內容'}});
  assert.deepEqual(f.c.state.messages,before);

  await f.c.send({text:'B 的目前回合'});
  assert.equal(f.c.state.busy,true);
  f.hooks.onEvent({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'turn-thread-a',status:'completed'}}});
  assert.equal(f.c.state.busy,true);
  assert.equal(f.c.state.status,'working');
  f.hooks.onEvent({method:'item/agentMessage/delta',params:{threadId:'thread-b',itemId:'live-b',delta:'新內容'}});
  assert.equal(f.c.state.messages.find(message=>message.id==='live-b').text,'新內容');
 }finally{await f.c.close();}
});

test('permissions, approval decisions, and stop remain scoped to the selected conversation',async()=>{
 const f=await fixture();
 try{
  await f.openSaved('thread-a');f.settle('thread-a',0,true);await flush();
  assert.equal(f.activeHost.calls.find(call=>call.method==='thread/resume'&&call.p.threadId==='thread-a').p.sandbox,'read-only');

  await f.openSaved('thread-b');f.settle('thread-b',0,true);await flush();
  const resumeB=f.activeHost.calls.find(call=>call.method==='thread/resume'&&call.p.threadId==='thread-b');
  assert.equal(resumeB.p.sandbox,'workspace-write');
  assert.deepEqual(resumeB.p.config.sandbox_workspace_write.writable_roots,[f.workspaceB]);
  await f.c.send({text:'B 可在自己的工作區修改'});
  const turn=f.activeHost.calls.findLast(call=>call.method==='turn/start');
  assert.equal(turn.p.threadId,'thread-b');
  assert.equal(turn.p.sandboxPolicy.type,'workspaceWrite');
  assert.deepEqual(turn.p.sandboxPolicy.writableRoots,[f.workspaceB]);
  assert.equal(turn.p.sandboxPolicy.networkAccess,false);

  const oldApproval=f.hooks.onRequest({id:71,method:'item/commandExecution/requestApproval',params:{threadId:'thread-a',turnId:'turn-thread-a',itemId:'old',command:'node old.js',cwd:f.root}});
  assert.equal(oldApproval,undefined);
  const currentApproval=f.hooks.onRequest({id:72,method:'item/commandExecution/requestApproval',params:{threadId:'thread-b',turnId:'turn-thread-b',itemId:'current',command:'node current.js',cwd:f.workspaceB}});
  await flush();
  const question=f.c.state.questions[0];assert.equal(question.threadId,'thread-b');
  f.c.answer({id:question.id,accept:true});
  assert.deepEqual(await currentApproval,{decision:'accept'});

  const pending=f.hooks.onRequest({id:73,method:'item/commandExecution/requestApproval',params:{threadId:'thread-b',turnId:'turn-thread-b',itemId:'pending',command:'node pending.js',cwd:f.workspaceB}});
  await flush();
  const stop=await f.c.stop();
  assert.deepEqual(stop,{stopRequested:true});
  assert.deepEqual(await pending,{decision:'cancel'});
  assert.equal(f.activeHost.calls.filter(call=>call.method==='turn/interrupt').length,1);
  assert.equal(f.activeHost.calls.find(call=>call.method==='turn/interrupt').p.threadId,'thread-b');
  assert.equal(f.c.state.questions.length,0);
 }finally{await f.c.close();}
});

test('A to B to A ignores stale MCP success and failure settlements from older views',async()=>{
 const f=await fixture();
 try{
  await f.openSaved('thread-a');
  await f.openSaved('thread-b');
  await f.openSaved('thread-a');
  f.settle('thread-a',0,true);await flush();
  assert.equal(f.c.state.threadId,'thread-a');
  assert.equal(f.c.state.workerConnection,'connecting');
  f.settle('thread-a',1,true);await flush();
  assert.equal(f.c.state.workerConnection,'ready');
  f.settle('thread-b',0,false);await flush();
  assert.equal(f.c.state.threadId,'thread-a');
  assert.equal(f.c.state.workerConnection,'ready');
  assert.equal(f.c.state.workerError,null);

  await f.openSaved('thread-b');
  await f.openSaved('thread-a');
  await f.openSaved('thread-b');
  await f.openSaved('thread-a');
  f.settle('thread-a',2,false);await flush();
  assert.equal(f.c.state.threadId,'thread-a');
  assert.equal(f.c.state.workerConnection,'connecting');
  assert.equal(f.c.state.workerError,null);
  f.settle('thread-b',2,true);await flush();
  assert.equal(f.c.state.workerConnection,'connecting');
  f.settle('thread-a',3,true);await flush();
  assert.equal(f.c.state.workerConnection,'ready');
  assert.equal(f.c.state.workerError,null);
 }finally{await f.c.close();}
});

test('an unsent new conversation can leave and return on the same host without resuming',async()=>{
 const f=await fixture();
 try{
  const created=await f.c.open({model:MODEL});
  const blankId=created.threadId;
  f.settle(blankId,0,true);await flush();
  await f.openSaved('thread-a');
  f.settle('thread-a',0,true);await flush();

  await f.openSaved(blankId);
  assert.equal(f.c.state.threadId,blankId);
  assert.equal(f.c.state.status,'ready');
  assert.deepEqual(f.c.state.messages,[]);
  const blankReads=f.activeHost.calls.filter(call=>call.method==='thread/read'&&call.p.threadId===blankId);
  assert.deepEqual(blankReads.map(call=>call.p.includeTurns),[true,false]);
  assert.equal(f.activeHost.calls.filter(call=>call.method==='thread/resume'&&call.p.threadId===blankId).length,0);
  assert.equal(f.activeHost.calls.filter(call=>call.method==='thread/start').length,1);

  f.settle(blankId,1,true);await flush();
  await f.c.send({text:'回到空白對話後送出'});
  assert.equal(f.activeHost.calls.findLast(call=>call.method==='turn/start').p.threadId,blankId);
 }finally{await f.c.close();}
});

test('the same missing-turns protocol error does not make an arbitrary saved conversation blank',async()=>{
 const f=await fixture({turnListUnsupportedFor:['thread-a']});
 try{
  await assert.rejects(f.openSaved('thread-a'));
  assert.equal(f.activeHost.calls.filter(call=>call.method==='thread/read'&&call.p.threadId==='thread-a'&&call.p.includeTurns===true).length,1);
  assert.equal(f.activeHost.calls.filter(call=>call.method==='thread/read'&&call.p.threadId==='thread-a'&&call.p.includeTurns===false).length,0);
  assert.equal(f.activeHost.calls.filter(call=>call.method==='thread/resume'&&call.p.threadId==='thread-a').length,0);
  assert.deepEqual(f.c.state.messages,[]);
  assert.equal(f.c.state.status,'error');
 }finally{await f.c.close();}
});
