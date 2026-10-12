import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationController} from '../src/conversation-controller.mjs';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';

const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url)),model='gpt-6.1-sol';
async function fixture(){
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'chat-continuation-'));
 const owners=[],calls=[];let sequence=0,forkFailure,sendFailure,childOpenGate,childSendGate;
 const sessionFactory=hooks=>{
  const state={provider:'codex',threadId:null,model,workspace:root,accessMode:'read-only',effort:'medium',serviceTier:'default',busy:false,status:'ready',questions:[],queuedMessages:[],messages:[],workers:[],goal:null};
  const owner={state,hooks,
   async models(){return {models:[]};},async selectWorkspace({path}){state.workspace=path;},
   async open(data,{continuation,onCreated}={}){if(continuation){calls.push([continuation.mode==='fresh'?'start':'fork',{turnId:continuation.throughTurnId},continuation.forkFrom]);if(forkFailure)throw forkFailure;if(childOpenGate){childOpenGate.enter();await childOpenGate.promise;}}Object.assign(state,data);state.threadId??=`room-${++sequence}`;await saveMainSession(root,{...state,...(continuation?.mode==='fresh'?{title:'新對話 · 測試'}:continuation?{parentThreadId:continuation.forkFrom}:{})});if(continuation)await onCreated({threadId:state.threadId});return {threadId:state.threadId};},
   async goal(){return {goal:state.goal};},async workers(){return state.workers;},
   async prepareContinuation(data){return {...(data.mode==='fresh'?{mode:'fresh'}:{forkFrom:state.threadId,nativeSourceId:state.threadId,throughTurnId:data.turnId}),model,workspace:state.workspace,accessMode:state.accessMode,effort:state.effort,serviceTier:state.serviceTier,workerPolicy:state.workerPolicy};},
   async send(data){calls.push(['send',data,state.threadId]);if(data.source==='continuation'&&childSendGate){childSendGate.enter();await childSendGate.promise;}if(sendFailure)throw sendFailure;state.busy=true;state.status='working';state.messages.push({id:'next-user',role:'user',turnId:`turn-${sequence}`,text:data.text,source:data.source??'local'});return {sent:true};},
   async steer(data){calls.push(['steer',data]);},async queue(data){calls.push(['queue',data]);},
   async stop(){state.busy=false;state.status='interrupted';calls.push(['stop',state.threadId]);},async close(){state.busy=false;state.status='offline';},
  };owners.push(owner);return owner;
 };
 const c=createConversationController({root,sessionFactory});
 const opened=await c.open({model,workspace:root}),source=owners.find(o=>o.state.threadId===opened.threadId);
 source.state.busy=true;source.state.status='working';source.state.messages=[{id:'human',role:'user',turnId:'transfer-turn',text:'換一間接著做',source:'local'}];
 const request=(mode='fork')=>source.hooks.onContinueConversation({mode,threadId:source.state.threadId,turnId:'transfer-turn',nextInstruction:'第2階段尚未完成；先核對已保存結果。'});
 const finish=async(status='completed')=>{source.state.busy=false;source.state.status=status;source.hooks.onConversationSettled({threadId:source.state.threadId,turnId:'transfer-turn',status});await wait(()=>c.state.continuation?.status!=='pending'&&calls.some(x=>['fork','start'].includes(x[0]))||c.state.continuation?.status==='cancelled');await new Promise(r=>setTimeout(r,30));};
 const receipt=id=>readFile(path.join(root,'.runtime/chat-continuations',`${id??opened.threadId}.json`),'utf8').then(JSON.parse);
 return {root,c,source,owners,calls,opened,request,finish,receipt,failFork:error=>{forkFailure=error;},failSend:error=>{sendFailure=error;},blockChildOpen:gate=>{childOpenGate=gate;},blockChildSend:gate=>{childSendGate=gate;}};
}
async function wait(check){const deadline=Date.now()+2000;while(!await check()){if(Date.now()>deadline)throw Error('test wait timed out');await new Promise(r=>setTimeout(r,10));}}

test('fresh handoff creates once, preserves settings without parent history, and is not recursive human authority',async()=>{
 const f=await fixture();try{
  f.source.state.workerPolicy={model:'auto',effort:'auto'};
  f.source.state.messages.unshift({role:'assistant',turnId:'old',text:'old context'});
  assert.equal((await f.request('fresh')).mode,'fresh');await f.request('fresh');
  await assert.rejects(f.request('fork'),/模式衝突/);
  await f.finish();await wait(()=>(f.calls.filter(c=>c[0]==='send').length===1));
  assert.equal(f.calls.filter(c=>c[0]==='start').length,1);assert.equal(f.calls.filter(c=>c[0]==='fork').length,0);
  const child=f.owners.find(o=>o.state.threadId===f.c.state.threadId),saved=(await f.c.sessions()).sessions.find(s=>s.threadId===child.state.threadId);
  for(const key of ['model','workspace','accessMode','effort','serviceTier','workerPolicy'])assert.deepEqual(child.state[key],f.source.state[key]);
  assert.equal(saved.parentThreadId,null);assert.equal(saved.branchType,null);assert.equal(saved.inheritedAttachments,null);assert.match(saved.title,/新對話/);
  assert.equal(child.state.messages.length,1);const sent=f.calls.find(c=>c[0]==='send')[1];
  assert.match(sent.text,/未帶入舊歷史、壓縮/);assert.doesNotMatch(sent.text,/原生歷史已保留/);assert.match(sent.text,/只有本次本人明確要求建立新目標/);
  assert.equal((await f.receipt()).status,'sent');assert.equal((await f.receipt(child.state.threadId)).parentThreadId,undefined);
  await assert.rejects(child.hooks.onContinueConversation({mode:'fresh',threadId:child.state.threadId,turnId:child.state.messages[0].turnId,nextInstruction:'recursive'}),/真人訊息/);
  f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});await new Promise(r=>setTimeout(r,20));assert.equal(f.calls.filter(c=>c[0]==='start').length,1);
 }finally{await f.c.close();}
});

test('same-turn fork then fresh conflicts without creating a second room',async()=>{
 const f=await fixture();try{await f.request();await assert.rejects(f.request('fresh'),/模式衝突/);await f.finish();assert.equal(f.calls.filter(c=>c[0]==='fork').length,1);assert.equal(f.calls.filter(c=>c[0]==='start').length,0);}finally{await f.c.close();}
});

test('fresh pending handoffs cancel on new human input, stop, or shutdown',async()=>{
 for(const action of ['send','steer','queue','stop','close']){
  const f=await fixture();try{
   await f.request('fresh');if(action==='failed')await f.finish('failed');else if(action==='close')await f.c.close();else await f.c[action]({threadId:f.opened.threadId,text:'new human intent'});
   f.source.state.busy=false;f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});await new Promise(r=>setTimeout(r,20));
   assert.equal((await f.receipt()).status,'cancelled');assert.equal(f.calls.filter(c=>c[0]==='start').length,0);
  }finally{await f.c.close();}
 }
});

test('fresh unknown creation or send outcomes do not replay; known children remain discoverable',async()=>{
 for(const phase of ['create','send']){
  const f=await fixture();try{
   if(phase==='create')f.failFork(Error('start response unknown'));else f.failSend(Error('submission unknown'));
   await f.request('fresh');await f.finish();await wait(async()=>(await f.receipt()).status==='uncertain');
   await f.request('fresh');f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});await new Promise(r=>setTimeout(r,20));
   assert.equal(f.calls.filter(c=>c[0]==='start').length,1);assert.equal(f.calls.filter(c=>c[0]==='send').length,phase==='send'?1:0);
   if(phase==='send'){const id=(await f.receipt()).newThreadId;assert.ok((await f.c.sessions()).sessions.some(s=>s.threadId===id));}
  }finally{await f.c.close();}
 }
});

test('fresh handoff does not select its child over another room being viewed',async()=>{
 const f=await fixture();try{await f.request('fresh');const other=await f.c.open({model,workspace:f.root});await f.finish();assert.equal(f.c.state.threadId,other.threadId);assert.equal(f.calls.filter(c=>c[0]==='start').length,1);assert.equal(f.calls.filter(c=>c[0]==='send').length,1);}finally{await f.c.close();}
});

test('a continuation accepted during an idle probe cannot be closed by its late read',async()=>{
 const f=await fixture();let resolveRead,reading=false,closes=0,reads=0;
 const pending=new Promise(resolve=>{resolveRead=resolve;});
 const close=f.source.close;f.source.close=async()=>{closes++;return close();};
 f.source.workers=async()=>{if(++reads===1){reading=true;return pending;}return [];};
 try{
  f.source.state.busy=false;f.source.state.status='completed';
  for(let i=0;i<4;i++)await f.c.open({model,workspace:f.root});
  await wait(()=>reading);
  f.source.state.busy=true;f.source.state.status='working';
  assert.equal((await f.request()).accepted,true);
  // Completion may precede delivery of its callback; pending ownership still protects the room.
  f.source.state.busy=false;f.source.state.status='completed';resolveRead([]);
  await wait(()=>reads>=3);await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(closes,0);assert.equal((await f.receipt()).status,'pending');
  await f.c.open({threadId:f.opened.threadId,model});assert.equal(f.c.state.threadId,f.opened.threadId);
  await f.finish();assert.equal(f.calls.filter(c=>c[0]==='fork').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
 }finally{resolveRead([]);await f.c.close();}
});

test('AI move uses no message button, branches once after its turn and leaves the source owner intact',async()=>{
 const f=await fixture();try{
  const accepted=await f.request();assert.equal(accepted.accepted,true);assert.equal(accepted.created,false);assert.equal(f.calls.length,0);
  await f.request();assert.equal(f.calls.length,0);
  await f.finish();await wait(()=>f.c.state.threadId!==f.opened.threadId);
  assert.equal(f.calls.filter(c=>c[0]==='fork').length,1);assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
  assert.equal(f.source.state.threadId,f.opened.threadId);assert.equal(f.source.state.status,'completed');
  assert.equal(f.c.state.workspace,f.source.state.workspace);assert.equal((await f.c.sessions()).sessions.length,2);
  const sent=f.calls.find(c=>c[0]==='send')[1];assert.equal(sent.source,'continuation');assert.match(sent.text,/先讀回目前成果檔案/);assert.match(sent.text,/第2階段尚未完成/);
  f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});await new Promise(r=>setTimeout(r,20));assert.equal(f.calls.filter(c=>c[0]==='fork').length,1);
  const child=f.owners.find(o=>o.state.threadId===f.c.state.threadId);
  await assert.rejects(child.hooks.onContinueConversation({threadId:child.state.threadId,turnId:child.state.messages.at(-1).turnId,nextInstruction:'again'}),/真人訊息/);
 }finally{await f.c.close();}
});
for(const status of ['failed','interrupted'])test(`the transfer-request turn ending ${status} cancels without creating or replaying`,async()=>{
 const f=await fixture();try{await f.request();await f.finish(status);assert.equal(f.calls.length,0);assert.equal((await f.receipt()).status,'cancelled');}finally{await f.c.close();}
});
test('active goals, budgeted goals, live and unconfirmed workers refuse acceptance',async()=>{
 const f=await fixture();try{
  for(const goal of [{status:'active'},{status:'paused',tokenBudget:100}]){f.source.state.goal=goal;for(const mode of ['fork','fresh'])await assert.rejects(f.request(mode),/原生目標/);}
  f.source.state.goal=null;
  for(const worker of [{status:'running',settled:false},{status:'unresolved',executionUnowned:true,settled:false}]){f.source.state.workers=[worker];for(const mode of ['fork','fresh'])await assert.rejects(f.request(mode),/子代理/);}
  assert.equal(f.calls.length,0);
 }finally{f.source.state.workers=[];await f.c.close();}
});
test('new human input or an explicit stop cancels a pending move',async()=>{
 for(const stop of [false,true]){const f=await fixture();try{await f.request();if(stop)await f.c.stop({threadId:f.opened.threadId});else await f.c.send({threadId:f.opened.threadId,text:'別換了'});f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});await new Promise(r=>setTimeout(r,20));assert.equal(f.calls.filter(c=>c[0]==='fork').length,0);assert.equal((await f.receipt()).status,'cancelled');}finally{await f.c.close();}}
});
test('an uncertain fork or new-room send never creates or sends a second time',async()=>{
 for(const phase of ['fork','send']){const f=await fixture();try{
  if(phase==='fork')f.failFork(Error('native outcome unknown'));else f.failSend(Error('send outcome unknown'));
  await f.request();f.source.state.busy=false;f.source.state.status='completed';f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});
  await wait(async()=>(await f.receipt()).status==='uncertain');const saved=await f.receipt();assert.equal(saved.status,'uncertain');
  await f.request();f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});await new Promise(r=>setTimeout(r,20));
  assert.equal(f.calls.filter(c=>c[0]==='fork').length,1);assert.equal(f.calls.filter(c=>c[0]==='send').length,phase==='send'?1:0);
 }finally{await f.c.close();}}
});
test('shutdown cancels pending creation',async()=>{
 const f=await fixture();await f.request();await f.c.close();assert.equal((await f.receipt()).status,'cancelled');assert.equal(f.calls.length,0);
});

test('native continuation captures stored history including old failed turns without opening or closing the source',async()=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'native-continuation-'));const calls=[];let hooks,gateway,ended,goal=null,terminals=[];
 const history=[{id:'old-failure',status:'failed',items:[{id:'partial',type:'agentMessage',text:'unfinished'}]},{id:'transfer-turn',status:'completed',items:[]}];
 const host={closed:new Promise(r=>ended=r),notify(){},async close(){calls.push(['close']);ended();},async request(method,p){calls.push([method,p]);
  if(method==='model/list')return {data:[{model,supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}]};
  if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='config/read')return {config:{}};
  if(method==='thread/start')return {thread:{id:'parent',turns:[]}};
  if(method==='thread/goal/get')return {goal};if(method==='thread/backgroundTerminals/list')return {data:terminals};
  if(method==='thread/read')return {thread:{id:'parent',turns:history}};
  if(method==='thread/fork')return {thread:{id:'child',turns:structuredClone(history)}};
  if(method==='turn/start'){hooks.onEvent({method:'turn/started',params:{threadId:'parent',turn:{id:'transfer-turn',status:'inProgress'}}});return {turn:{id:'transfer-turn'}};}
  return {};
 }};
 const c=createDesktopController({root,hostFactory:h=>{if(!h.onEvent)return {...host,close:async()=>{}};hooks=h;return host;},gatewayFactory:async g=>{gateway=g;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://fake/mcp',headers:{Authorization:'fake'}}}},close:async()=>{}};},onContinueConversation:async data=>({accepted:true,...data})});
 try{
  await c.open({model,effort:'medium',accessMode:'read-only'});await c.send({text:'move'});
  await assert.rejects(gateway.continueConversation({nextInstruction:'continue'},{'x-codex-turn-metadata':JSON.stringify({thread_id:'worker',turn_id:'transfer-turn'})}),/目前主對話/);
  const accepted=await gateway.continueConversation({nextInstruction:'continue'},{'x-codex-turn-metadata':JSON.stringify({thread_id:'parent',turn_id:'transfer-turn'})});assert.equal(accepted.turnId,'transfer-turn');
  assert.doesNotThrow(accepted.stillCurrent);
  hooks.onEvent({method:'item/completed',params:{threadId:'parent',turnId:'transfer-turn',item:{id:'native-human',type:'userMessage',content:[{type:'text',text:'move'}]}}});
  assert.equal(c.state.messages.filter(m=>m.role==='user').length,1);assert.equal(c.state.messages.find(m=>m.role==='user').source,'native');
  hooks.onEvent({method:'turn/completed',params:{threadId:'parent',turn:{id:'transfer-turn',status:'completed'}}});
  assert.throws(accepted.stillCurrent,/目前主對話/);
  goal={status:'active'};await assert.rejects(c.prepareContinuation({turnId:'transfer-turn'}),/原生目標/);goal=null;
  for(const value of [{status:'active'},{status:'paused',tokenBudget:100}]){goal=value;await assert.rejects(c.prepareContinuation({turnId:'transfer-turn',mode:'fresh'}),/原生目標/);}goal=null;
  terminals=[{id:'live-command'}];await assert.rejects(c.prepareContinuation({turnId:'transfer-turn',mode:'fresh'}),/未確認結束/);terminals=null;await assert.rejects(c.prepareContinuation({turnId:'transfer-turn',mode:'fresh'}),/無法確認背景命令/);terminals=[];
  const fresh=await c.prepareContinuation({turnId:'transfer-turn',mode:'fresh'});assert.equal(fresh.mode,'fresh');assert.equal(fresh.forkFrom,undefined);assert.equal(fresh.nativeSourceId,undefined);assert.equal(fresh.throughTurnId,undefined);assert.equal(fresh.workspace,root);
  const prepared=await c.prepareContinuation({turnId:'transfer-turn'});assert.equal(prepared.forkFrom,'parent');assert.equal(prepared.throughTurnId,'transfer-turn');assert.equal(c.state.threadId,'parent');
  assert.equal(calls.some(c=>['thread/fork','thread/resume','close'].includes(c[0])),false);assert.equal((await listMainSessions(root)).sessions.length,1);
  await c.send({text:'program continuation',source:'continuation'});
  for(const method of ['item/started','item/completed'])hooks.onEvent({method,params:{threadId:'parent',turnId:'transfer-turn',item:{id:'native-control',type:'userMessage',content:[{type:'text',text:'program continuation'}]}}});
  assert.equal(c.state.messages.filter(m=>m.text==='program continuation').length,1);assert.equal(c.state.messages.find(m=>m.text==='program continuation').source,'continuation');
 }finally{await c.close();}
});

test('acceptance uses a fresh snapshot after awaited checks and revalidates native metadata after persistence',async()=>{
 for(const phase of ['goal','receipt']){
  const f=await fixture();try{
   const mutable=f.source.state;
   Object.defineProperty(f.source,'state',{get:()=>({...mutable})});
   if(phase==='goal')f.source.goal=async()=>{mutable.busy=false;return {goal:null};};
   await assert.rejects(f.source.hooks.onContinueConversation({threadId:f.opened.threadId,turnId:'transfer-turn',nextInstruction:'remaining',stillCurrent:()=>{if(phase==='receipt')throw Error('native turn ended');}}),phase==='goal'?/來源已變更/:/native turn ended/);
   if(phase==='receipt')assert.equal((await f.receipt()).status,'cancelled');
   f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});
   await new Promise(r=>setTimeout(r,20));assert.equal(f.calls.length,0);
  }finally{await f.c.close();}
 }
});

test('a later real human native echo may request another move, not the program continuation',async()=>{
 const f=await fixture();try{
  f.source.state.accessMode='danger-full-access';await f.request();await f.finish();await wait(()=>f.c.state.threadId!==f.opened.threadId);
  const child=f.owners.find(o=>o.state.threadId===f.c.state.threadId);assert.equal(child.state.accessMode,'danger-full-access');assert.equal(child.state.permissionConfirmed,true);
  child.state.messages.push({id:'human-2',role:'user',turnId:'human-turn-2',text:'再次換房',source:'native'});
  const accepted=await child.hooks.onContinueConversation({threadId:child.state.threadId,turnId:'human-turn-2',nextInstruction:'another explicit move'});assert.equal(accepted.accepted,true);
 }finally{await f.c.close();}
});

test('steering or queueing real input cancels the pending move; native error takes precedence',async()=>{
 for(const method of ['steer','queue']){
  const f=await fixture();try{await f.request();await f.c[method]({threadId:f.opened.threadId,text:'new instruction'});assert.equal((await f.receipt()).status,'cancelled');assert.equal(f.calls.filter(c=>c[0]==='fork').length,0);}finally{await f.c.close();}
 }
 const f=await fixture();try{await f.request();await f.finish('failed');f.source.state.error='actual native failure';assert.equal(f.c.state.error,'actual native failure');}finally{await f.c.close();}
});

test('reopening an incomplete receipt persists cancellation or uncertainty and never dispatches',async()=>{
 for(const status of ['pending','creating','created']){
  const f=await fixture();await f.c.close();
  const file=path.join(f.root,'.runtime/chat-continuations',`${f.opened.threadId}.json`);await mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,JSON.stringify({sourceThreadId:f.opened.threadId,turnId:'old-turn',status,nextInstruction:'never replay'}));
  const c=createConversationController({root:f.root,sessionFactory:hooks=>({...f.source,hooks,state:{...f.source.state,status:'ready',busy:false},close:async()=>{}})});
  try{await c.open({threadId:f.opened.threadId,model});assert.equal((await f.receipt()).status,status==='pending'?'cancelled':'uncertain');assert.equal(f.calls.length,0);}finally{await c.close();}
 }
});

test('background notification turns cannot authorize a move',async()=>{
 const f=await fixture();try{f.source.state.messages=[];await assert.rejects(f.request(),/真人訊息/);assert.equal(f.calls.length,0);}finally{await f.c.close();}
});

test('known pre-fork failures cancel but uncertain fork attempts remain blocked without retry',async()=>{
 for(const notCreated of [true,false]){
  const f=await fixture();try{
   f.failFork(Object.assign(Error('open failed'),{notCreated}));await f.request();
   f.source.state.busy=false;f.source.state.status='completed';f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'completed'});
   await wait(async()=>(await f.receipt()).status===(notCreated?'cancelled':'uncertain'));
   f.source.state.busy=true;f.source.state.messages.push({role:'user',turnId:'next-human',source:'native',text:'explicit new move'});
   const request=()=>f.source.hooks.onContinueConversation({threadId:f.opened.threadId,turnId:'next-human',nextInstruction:'remaining'});
   if(notCreated)assert.equal((await request()).accepted,true);else await assert.rejects(request(),/前次換房結果尚未確認/);
   assert.equal(f.calls.filter(c=>c[0]==='fork').length,1);
  }finally{await f.c.close();}
 }
});

test('the real adapter preserves known pre-fork rejection and never marks a sent fork as not created',async()=>{
 for(const phase of ['catalog','history','config','fork','mcp']){
  await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'continuation-open-failure-'));let ended;const calls=[];
  const host={closed:new Promise(r=>ended=r),notify(){},close:async()=>{ended();},waitForMcp:async()=>{if(phase==='mcp')throw Error('MCP wait failed');},request:async(method,p)=>{
   calls.push(method);
   if(method==='model/list'){if(phase==='catalog')throw Error('catalog failed');return {data:[{model,supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};}
   if(method==='account/read')return {account:{type:'chatgpt'}};
   if(method==='thread/read')return {thread:{id:'parent',turns:[{id:phase==='history'?'changed-turn':'last-turn',status:'completed',items:[]}]}};
   if(method==='config/read'){if(phase==='config')throw Error('config read failed');return {config:{}};}
   if(method==='thread/fork'){if(phase==='fork')throw Error('fork response unknown');return {thread:{id:'new-child',turns:[]}};}
   return {};
  }};
  const c=createDesktopController({root,hostFactory:h=>h.onEvent?host:{...host,close:async()=>{}},gatewayFactory:async()=>({mcpConfig:{mcpServers:{k_gemini:{url:'http://fake/mcp',headers:{Authorization:'fake'}}}},close:async()=>{}})});
  try{
   await assert.rejects(c.open({model,effort:'medium',accessMode:'danger-full-access',permissionConfirmed:true},{continuation:{forkFrom:'parent',nativeSourceId:'parent',throughTurnId:'last-turn'}}),error=>{assert.equal(error.notCreated===true,['catalog','history','config'].includes(phase));return true;});
   assert.equal(calls.filter(c=>c==='thread/fork').length,['fork','mcp'].includes(phase)?1:0);
   if(phase==='mcp')assert.equal(c.state.threadId,'new-child');
  }finally{await c.close();}
 }
});

 test('accepted fresh handoff survives an exact failed native turn and still creates and sends only once',async()=>{
 const f=await fixture();try{
  await f.request('fresh');await f.finish('failed');
  assert.equal((await f.receipt()).status,'sent');assert.equal(f.calls.filter(c=>c[0]==='start').length,1);
  f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'failed'});
  await new Promise(r=>setTimeout(r,20));assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
 }finally{await f.c.close();}
 });

for(const change of ['busy','unknown','goal','newHuman','worker','command','question','queued'])test(`fresh accepted handoff refuses changed ${change} state before creation`,async()=>{
 const f=await fixture();try{
  await f.request('fresh');f.source.state.busy=false;f.source.state.status='failed';
  if(change==='busy')f.source.state.busy=true;
  if(change==='goal')f.source.state.goal={status:'paused',objective:'changed'};
  if(change==='newHuman')f.source.state.messages.push({role:'user',turnId:'new',text:'stop changing rooms'});
  if(change==='worker')f.source.state.workers=[{threadId:'new-worker',settled:true,status:'completed'}];
  if(change==='command')f.source.state.tools=[{id:'new-command',kind:'commandExecution',status:'completed'}];
  if(change==='question')f.source.state.questions=[{id:'approval'}];
  if(change==='queued')f.source.state.queuedMessages=[{text:'new'}];
  f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:change==='unknown'?'unknown':'failed'});
  await wait(async()=>(await f.receipt()).status==='cancelled');assert.equal(f.calls.length,0);
 }finally{await f.c.close();}
});

for(const action of ['stop','send','steer','queue'])test(`human ${action} cancels a fresh handoff during awaited preparation`,async()=>{
 const f=await fixture();let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 const prepare=f.source.prepareContinuation;f.source.prepareContinuation=async data=>{enter();await gate;return prepare(data);};
 try{
  await f.request('fresh');f.source.state.busy=false;f.source.state.status='failed';f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'failed'});
  await entered;
  if(action==='stop')assert.equal((await f.c.stop({threadId:f.opened.threadId})).continuationCancelled,true);
  else await assert.rejects(f.c[action]({threadId:f.opened.threadId,text:'new intent'}),/正在重新連線/);
  release();await wait(async()=>(await f.receipt()).status==='cancelled');assert.equal(f.calls.length,0);
 }finally{release();await f.c.close();}
});

async function failedNativeFixture(){
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'failed-native-handoff-'));let hooks,gateway,accepted,ended,goal=null,terminals=[];
 const history=[];
 const host={closed:new Promise(r=>ended=r),notify(){},async close(){ended();},async request(method){
  if(method==='model/list')return {data:[{model,supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}]};
  if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='config/read')return {config:{}};
  if(method==='thread/start')return {thread:{id:'parent',turns:[]}};
  if(method==='thread/goal/get')return {goal};if(method==='thread/backgroundTerminals/list')return {data:terminals};
  if(method==='thread/read')return {thread:{id:'parent',turns:history}};
  if(method==='turn/start'){hooks.onEvent({method:'turn/started',params:{threadId:'parent',turn:{id:'transfer-turn',status:'inProgress'}}});return {turn:{id:'transfer-turn'}};}return {};
 }};
 const c=createDesktopController({root,hostFactory:h=>{if(!h.onEvent)return {...host,close:async()=>{}};hooks=h;return host;},gatewayFactory:async g=>{gateway=g;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://fake/mcp',headers:{Authorization:'fake'}}}},close:async()=>{}};},onContinueConversation:async data=>{accepted=data;return {accepted:true};}});
 await c.open({model,effort:'medium',accessMode:'read-only'});await c.send({text:'fresh move'});
 await gateway.continueConversation({mode:'fresh',nextInstruction:'remaining'},{'x-codex-turn-metadata':JSON.stringify({thread_id:'parent',turn_id:'transfer-turn'})});
 const finish=(status,error)=>{history.splice(0,history.length,{id:'transfer-turn',status,error,items:[]});hooks.onEvent({method:'turn/completed',params:{threadId:'parent',turn:history[0]}});};
 return {c,history,finish,prepare:()=>c.prepareContinuation({turnId:'transfer-turn',mode:'fresh',sourceCurrent:accepted.afterTurnCurrent}),setTerminals:value=>terminals=value};
}

for(const code of ['serverOverloaded','streamFailure'])test(`native fresh preparation permits accepted exact failed ${code} but never failed fork`,async()=>{
 const f=await failedNativeFixture();try{
  f.finish('failed',{message:'exact native failure',codexErrorInfo:code});assert.equal((await f.prepare()).mode,'fresh');
  await assert.rejects(f.c.prepareContinuation({turnId:'transfer-turn',mode:'fresh'}),/正常結束/);
  await assert.rejects(f.c.prepareContinuation({turnId:'transfer-turn'}),/正常結束/);
  f.history[0].error={message:'different failure',codexErrorInfo:code};await assert.rejects(f.prepare(),/來源不符/);
 }finally{await f.c.close();}
});

for(const code of ['usageLimitExceeded','unauthorized','sandboxError','contextWindowExceeded','sessionBudgetExceeded','cyberPolicy'])test(`native fresh preparation refuses hard limit ${code}`,async()=>{
 const f=await failedNativeFixture();try{f.finish('failed',{message:'hard native failure',codexErrorInfo:code});await assert.rejects(f.prepare(),/正常結束/);}finally{await f.c.close();}
});

test('native fresh failed preparation rejects unknown terminal, missing error and live or unknown background command',async()=>{
 const f=await failedNativeFixture();try{
  f.finish('failed',{message:'native stream',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:503}}});
  f.history[0].status='completed';await assert.rejects(f.prepare(),/來源不符/);
  f.history[0].status='inProgress';await assert.rejects(f.prepare(),/來源不符/);
  f.history[0].status='failed';delete f.history[0].error;await assert.rejects(f.prepare(),/來源不符/);
  f.history[0].error=f.c.state.turnError.error;f.setTerminals([{id:'command'}]);await assert.rejects(f.prepare(),/未確認結束/);
  f.setTerminals(null);await assert.rejects(f.prepare(),/無法確認背景命令/);f.setTerminals([]);
  f.finish('interrupted',null);await assert.rejects(f.prepare(),/正常結束/);
 }finally{f.setTerminals([]);await f.c.close();}
});

for(const action of ['stop','newHuman','goal','worker','command'])test(`fresh handoff cancels ${action} during child opening and preserves a known child without sending`,async()=>{
 const f=await fixture();let entered,release;const opening=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 f.blockChildOpen({enter:entered,promise:gate});
 try{
  await f.request('fresh');f.source.state.busy=false;f.source.state.status='failed';f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'failed'});
  await opening;
  if(action==='stop')assert.equal((await f.c.stop({threadId:f.opened.threadId})).continuationCancelled,true);
  if(action==='newHuman')f.source.state.messages.push({role:'user',turnId:'new',text:'cancel'});
  if(action==='goal')f.source.state.goal={status:'paused',objective:'different'};
  if(action==='worker')f.source.state.workers=[{threadId:'new',settled:true,status:'completed'}];
  if(action==='command')f.source.state.tools=[{id:'new-command',status:'completed'}];
  release();await wait(async()=>(await f.receipt()).status==='uncertain');
  const receipt=await f.receipt();assert.ok(receipt.newThreadId);assert.equal(f.calls.filter(c=>c[0]==='start').length,1);assert.equal(f.calls.filter(c=>c[0]==='send').length,0);
  assert.ok((await f.c.sessions()).sessions.some(s=>s.threadId===receipt.newThreadId));
 }finally{release();await f.c.close();}
});

for(const [mode,status] of [['fresh','failed'],['fresh','completed'],['fork','completed']])test(`real controllers retain ${mode} ${status} accepted before its own late stdout tool events`,async()=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'accepted-native-integration-'));
 const native=[],calls=[];let sequence=0;
 const c=createConversationController({root,sessionFactory:options=>{
  const row={id:null,hooks:null,gateway:null,turns:[]};native.push(row);let ended;
  const host={closed:new Promise(r=>ended=r),notify(){},close:async()=>ended(),async request(method,params){
   calls.push([method,params]);
   if(method==='model/list')return {data:[{model,supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}]};
   if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='config/read')return {config:{}};
   if(method==='thread/fork'){row.id=`native-${++sequence}`;return {thread:{id:row.id,turns:structuredClone(native.find(source=>source.id===params.threadId)?.turns??[])}};}
   if(method==='thread/start'){row.id=`native-${++sequence}`;return {thread:{id:row.id,turns:[]}};}
   if(method==='thread/goal/get')return {goal:null};if(method==='thread/backgroundTerminals/list')return {data:[]};
   if(method==='thread/read'){const stored=native.find(source=>source.id===params.threadId)??row;return {thread:{id:params.threadId,turns:stored.turns}};}
   if(method==='turn/start'){const id=`turn-${row.id}`;row.hooks.onEvent({method:'turn/started',params:{threadId:row.id,turn:{id,status:'inProgress'}}});return {turn:{id}};}return {};
  }};
  const owner=createDesktopController({...options,hostFactory:hooks=>{if(!hooks.onEvent)return {...host,close:async()=>{}};row.hooks=hooks;return host;},gatewayFactory:async gateway=>{row.gateway=gateway;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://fake/mcp',headers:{Authorization:'fake'}}}},close:async()=>{}};}});owner.state.provider='codex';return owner;
 }});
 try{
  const opened=await c.open({model,workspace:root,effort:'medium',accessMode:'read-only'});await c.send({threadId:opened.threadId,text:'new blank room with remaining work'});
  const source=native.find(row=>row.id===opened.threadId),turnId=`turn-${source.id}`;
  const tool={id:'accepted-move',type:'mcpToolCall',server:'k_gemini',tool:mode==='fresh'?'conversation_create':'conversation_continue',arguments:{nextInstruction:'remaining only'}};
  const accepted=await source.gateway.continueConversation({mode,nextInstruction:'remaining only'},{'x-codex-turn-metadata':JSON.stringify({thread_id:source.id,turn_id:turnId})});assert.equal(accepted.accepted,true);
  source.hooks.onEvent({method:'item/started',params:{threadId:source.id,turnId,item:tool}});
  source.hooks.onEvent({method:'item/completed',params:{threadId:source.id,turnId,item:{...tool,status:'completed',result:accepted}}});
  const error={message:'stream failed after acceptance',codexErrorInfo:'serverOverloaded'};
  source.turns.push({id:turnId,status,...(status==='failed'?{error}:{}),items:[]});source.hooks.onEvent({method:'turn/completed',params:{threadId:source.id,turn:source.turns[0]}});
  const receipt=()=>readFile(path.join(root,'.runtime/chat-continuations',`${source.id}.json`),'utf8').then(JSON.parse);
  await wait(async()=>(await receipt()).status==='sent');assert.equal(calls.filter(([method])=>method==='thread/start').length,mode==='fresh'?2:1);assert.equal(calls.filter(([method])=>method==='thread/fork').length,mode==='fork'?1:0);assert.equal(calls.filter(([method])=>method==='turn/start').length,2);
  source.hooks.onEvent({method:'turn/completed',params:{threadId:source.id,turn:source.turns[0]}});await new Promise(r=>setTimeout(r,20));assert.equal(calls.filter(([method])=>['thread/start','thread/fork'].includes(method)).length,2);
 }finally{await c.close();}
});

test('unchanged paused goal identity and reordered ended workers permit fresh handoff despite updated usage',async()=>{
 const f=await fixture();try{
  f.source.state.goal={threadId:f.opened.threadId,createdAt:1,objective:'remaining',status:'paused',tokenBudget:null,tokensUsed:10};
  f.source.state.workers=[{threadId:'one',settled:true,status:'completed'},{threadId:'two',settled:true,status:'completed'}];
  await f.request('fresh');f.source.state.goal.tokensUsed=20;f.source.state.workers.reverse();await f.finish('failed');
  assert.equal((await f.receipt()).status,'sent');assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
 }finally{await f.c.close();}
});

for(const action of ['stop','send','steer','queue'])for(const outcome of ['sent','uncertain'])test(`dispatch boundary refuses source ${action} without false cancellation when child send ends ${outcome}`,async()=>{
 const f=await fixture();let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 f.blockChildSend({enter,promise:gate});if(outcome==='uncertain')f.failSend(Error('native submission outcome unknown'));
 try{
  await f.request('fresh');f.source.state.busy=false;f.source.state.status='failed';f.source.hooks.onConversationSettled({threadId:f.opened.threadId,turnId:'transfer-turn',status:'failed'});
  await entered;const before=await f.receipt();assert.ok(before.newThreadId);
  await assert.rejects(f.c[action]({threadId:f.opened.threadId,text:'new human intent'}),error=>{
   assert.match(error.message,/交接已送出或結果待查/);assert.match(error.message,new RegExp(before.newThreadId));return true;
  });
  assert.equal((await f.receipt()).status,'created');
  release();await wait(async()=>(await f.receipt()).status===outcome);
  assert.equal(f.calls.filter(c=>c[0]==='start').length,1);assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
  assert.equal(f.calls.some(c=>['stop','steer','queue'].includes(c[0])),false);
 }finally{release();await f.c.close();}
});

test('late unrelated tool names still cancel an accepted handoff without treating them as its own receipt',async()=>{
 const f=await fixture();try{
  await f.request('fresh');f.source.state.tools=[{id:'late-other',name:'conversation_create_extra',status:'completed'}];await f.finish('failed');
  assert.equal((await f.receipt()).status,'cancelled');assert.equal(f.calls.length,0);
 }finally{await f.c.close();}
});
