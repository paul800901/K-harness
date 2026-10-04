import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {listMainSessions,saveMainSession} from '../src/main-sessions.mjs';

const MODEL='gpt-6.1-sol',policy={model:'gpt-6-luna',effort:'high'};
async function fixture(){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'durable-empty-')),workspace=path.join(root,'workspace');await mkdir(workspace);
 const durable=new Map(),hosts=[],calls=[];let seq=0,failSend=false;
 const hostFactory=hooks=>{
  const loaded=new Map();let end;
  const host={closed:new Promise(r=>{end=r;}),closedCount:0,hooks,notify(){},
   async close(){host.closedCount++;loaded.clear();end();},
   async waitForMcp(id){assert.ok(loaded.has(id),'MCP readiness uses the current native id');},
   async request(method,p={}){
    calls.push({method,p,host});
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='model/list')return {data:[MODEL,'gpt-6-luna'].map(model=>({model,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image']}))};
    if(method==='config/read')return {config:{}};
    if(method==='thread/start'){
     const thread={id:`native-${++seq}`,status:{type:'idle'},turns:[]};loaded.set(thread.id,thread);return {thread};
    }
    if(method==='thread/read'||method==='thread/resume'){
     const thread=durable.get(p.threadId);
     if(!thread){const e=Error('no native history');e.protocolMessage=`no rollout found for thread id ${p.threadId}`;throw e;}
     if(method==='thread/resume')loaded.set(thread.id,thread);
     return {thread:structuredClone(thread)};
    }
    if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
    if(method==='turn/start'||method==='review/start'){
     assert.ok(loaded.has(p.threadId));
     const row=(await listMainSessions(root)).sessions.find(r=>r.codexSession?.nativeThreadId===p.threadId);
     assert.equal(row?.codexSession.hasSubmitted,true,'submission marker is durable BEFORE calling native');
     if(failSend)throw failSend;
     const turn={id:`turn-${seq}`,status:'completed',items:method==='turn/start'?[{id:`u-${seq}`,type:'userMessage',content:p.input},{id:`a-${seq}`,type:'agentMessage',text:'first reply'}]:[]};
     const thread={...loaded.get(p.threadId),turns:[turn]};durable.set(p.threadId,thread);
     hooks.onEvent?.({method:'turn/started',params:{threadId:p.threadId,turn:{...turn,status:'inProgress'}}});
     for(const item of turn.items)hooks.onEvent?.({method:'item/completed',params:{threadId:p.threadId,turnId:turn.id,item}});
     return {turn};
    }
    if(method==='thread/fork'){
     assert.ok(durable.has(p.threadId));const thread={...structuredClone(durable.get(p.threadId)),id:`native-${++seq}`,parentThreadId:p.threadId};durable.set(thread.id,thread);return {thread};
    }
    if(method==='turn/interrupt')hooks.onEvent?.({method:'turn/completed',params:{threadId:p.threadId,turn:{id:'interrupted',status:'interrupted'}}});
    return {};
   },
  };hosts.push(host);return host;
 };
 const options={root,executable:'fake',hostFactory};
 return {root,workspace,hosts,calls,durable,options,create:()=>createDesktopController(options),failSend:(error=Error('transport outcome unknown'))=>{failSend=error;}};
}

for(const renamed of [false,true])test(`empty Codex room survives full controller restarts, keeps settings and attachments (renamed ${renamed})`,async()=>{
 const f=await fixture();let c=f.create();
 try{
  await c.selectWorkspace({path:f.workspace});
  const {threadId}=await c.open({model:MODEL,workerPolicy:policy,effort:'high',accessMode:'read-only'});
  if(renamed)await c.metadata({threadId,title:'等有空再回來',pinned:true});
  const attachment=await c.upload({threadId,name:'prepared.txt',base64:Buffer.from('saved before first message').toString('base64')});
  for(let restart=0;restart<3;restart++){
   await c.close();c=f.create();await c.open({model:MODEL,threadId});
   assert.equal(c.state.threadId,threadId);assert.equal(c.state.status,'ready');assert.deepEqual(c.state.messages,[]);
   assert.equal(c.state.title,renamed?'等有空再回來':'');assert.equal(c.state.workspace,f.workspace);assert.equal(c.state.accessMode,'read-only');assert.equal(c.state.effort,'high');assert.deepEqual(c.state.workerPolicy,policy);
   assert.equal((await c.attachmentFile(attachment.id)).bytes.toString(),'saved before first message');
   const rows=(await c.sessions()).sessions;assert.equal(rows.length,1);assert.equal(rows[0].threadId,threadId);assert.equal(rows[0].pinned,renamed);assert.equal(rows[0].codexSession.hasSubmitted,false);
  }
  assert.equal(f.calls.filter(x=>x.method==='turn/start'||x.method==='thread/resume').length,0);
  await c.send({text:'now begin',attachmentIds:[attachment.id]});const sent=f.calls.findLast(x=>x.method==='turn/start');
  assert.notEqual(sent.p.threadId,threadId);assert.equal(c.state.threadId,threadId);assert.equal(c.state.messages.find(m=>m.role==='assistant').text,'first reply');
  await c.stop();await c.close();c=f.create();await c.open({model:MODEL,threadId});
  assert.equal(c.state.messages.at(-1).text,'first reply');assert.equal(c.state.messages[0].attachments[0].id,attachment.id);
  assert.equal(f.calls.findLast(x=>x.method==='thread/resume').p.threadId,sent.p.threadId);
  assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1,'restart never replays the first message');
 }finally{await c.close();}
});

test('idle room release plus complete workbench restart retains unnamed rooms and sidebar metadata',{timeout:10000},async()=>{
 const f=await fixture();let c=createConversationController(f.options);const ids=[];
 try{
  for(let n=0;n<7;n++)ids.push((await c.open({model:MODEL,workspace:f.workspace,effort:'high',workerPolicy:policy})).threadId);
  const firstHost=f.calls.find(x=>x.method==='thread/goal/get'&&x.p.threadId===ids[0]).host;
  await firstHost.closed;assert.ok(firstHost.closedCount>0,'idle pool released the original empty native host');
  await c.open({model:MODEL,threadId:ids[0]});assert.equal(c.state.threadId,ids[0]);assert.deepEqual(c.state.messages,[]);
  await c.close();assert.ok(f.hosts.every(h=>h.closedCount>0));
  c=createConversationController(f.options);
  for(const threadId of ids){await c.open({model:MODEL,threadId});assert.equal(c.state.threadId,threadId);assert.deepEqual(c.state.messages,[]);assert.deepEqual(c.state.workerPolicy,policy);}
  assert.equal((await c.sessions()).sessions.length,7);assert.equal(f.calls.some(x=>x.method==='turn/start'),false);
 }finally{await c.close();}
});

test('native identity binding routes approval, child readback, stop and fork without rewriting content',async()=>{
 const f=await fixture();let c=f.create();
 try{
  const {threadId}=await c.open({model:MODEL});await c.close();c=f.create();await c.open({model:MODEL,threadId});
  const row=(await c.sessions()).sessions[0],native=row.codexSession.nativeThreadId,host=f.hosts.at(-1);
  await c.send({text:'start'});
  const approval=host.hooks.onRequest({id:99,method:'item/commandExecution/requestApproval',params:{threadId:native,turnId:c.state.messages.find(m=>m.role==='assistant').turnId,itemId:'command',command:'test'}});
  assert.equal(c.state.questions[0].threadId,threadId);c.answer({id:c.state.questions[0].id,accept:false});assert.ok(await approval);
  f.durable.set('child',{id:'child',parentThreadId:native,status:{type:'idle'},turns:[{id:'child-turn',status:'completed',items:[]}]});
  host.hooks.onEvent({method:'item/completed',params:{threadId:native,item:{id:'spawn',type:'collabAgentToolCall',receiverThreadIds:['child'],status:'completed'}}});
  assert.equal((await c.workers()).find(w=>w.threadId==='child').settled,true);
  host.hooks.onEvent({method:'item/agentMessage/delta',params:{threadId:native,itemId:'verbatim',delta:`literal ${native}`}});
  assert.equal(c.state.messages.at(-1).text,`literal ${native}`);
  await c.stop();assert.equal(f.calls.findLast(x=>x.method==='turn/interrupt').p.threadId,native);
  await c.close();c=f.create();await c.open({model:MODEL,threadId});
  const point=c.state.messages.find(m=>m.text==='first reply');const fork=await c.fork({messageId:point.id});
  assert.notEqual(fork.threadId,threadId);assert.equal((await c.sessions()).sessions.find(r=>r.threadId===fork.threadId).parentThreadId,threadId);
  assert.equal(f.calls.findLast(x=>x.method==='thread/fork').p.threadId,native);
 }finally{await c.close();}
});

for(const review of [false,true])test(`rejected first ${review?'review':'send'} preserves the prepared room without replay`,async()=>{
 const f=await fixture();let c=f.create();
 try{
  const {threadId}=await c.open({model:MODEL,workerPolicy:policy,effort:'high'});
  await c.metadata({threadId,title:'已準備但送出被拒絕'});
  const attachment=await c.upload({threadId,name:'prepared.txt',base64:Buffer.from('keep').toString('base64')});
  f.failSend(Object.assign(Error('native request rejected'),{protocolMessage:'Invalid request'}));
  await assert.rejects(review?c.review({confirmed:true}):c.send({text:'once',attachmentIds:[attachment.id]}));
  assert.equal(c.state.status,'failed');assert.equal(c.state.busy,false);
  assert.equal((await c.sessions()).sessions[0].codexSession.hasSubmitted,false);
  await c.close();c=f.create();await c.open({model:MODEL,threadId});
  assert.equal(c.state.threadId,threadId);assert.equal(c.state.title,'已準備但送出被拒絕');assert.deepEqual(c.state.messages,[]);
  assert.deepEqual(c.state.workerPolicy,policy);assert.equal((await c.attachmentFile(attachment.id)).bytes.toString(),'keep');
  assert.equal(f.calls.filter(x=>x.method==='turn/start'||x.method==='review/start').length,1);
 }finally{await c.close();}
});

for(const review of [false,true])test(`unknown first ${review?'review':'send'} outcome is never recreated as an empty room`,async()=>{
 const f=await fixture();let c=f.create();
 try{
  const {threadId}=await c.open({model:MODEL});await c.close();c=f.create();await c.open({model:MODEL,threadId});
  f.failSend();await assert.rejects(review?c.review({confirmed:true}):c.send({text:'once'}));
  assert.equal((await c.sessions()).sessions[0].codexSession.hasSubmitted,true);await c.close();c=f.create();
  const starts=f.calls.filter(x=>x.method==='thread/start').length;
  await assert.rejects(c.open({model:MODEL,threadId}),/歷史檔/);
  assert.equal(f.calls.filter(x=>x.method==='thread/start').length,starts);assert.equal((await c.sessions()).sessions.length,1);
 }finally{await c.close();}
});

test('stale metadata cannot erase submitted identity; legacy metadata is not evidence of an empty room',async()=>{
 const f=await fixture(),record={threadId:'stable',model:MODEL,codexSession:{nativeThreadId:'native-real',hasSubmitted:false}};
 await saveMainSession(f.root,record);const stale=(await listMainSessions(f.root)).sessions[0];
 await saveMainSession(f.root,{...stale,codexSession:{nativeThreadId:'native-real',hasSubmitted:true}});
 await saveMainSession(f.root,{...stale,title:'rename'});
 assert.deepEqual((await listMainSessions(f.root)).sessions[0].codexSession,{nativeThreadId:'native-real',hasSubmitted:true});
 const legacy=path.join(f.root,'.runtime/main-sessions/legacy-current.json');
 await writeFile(legacy,JSON.stringify({threadId:'legacy',model:MODEL,title:'never assume empty from title',workspace:f.root,lastUsedModel:null}));
 const c=f.create();try{await assert.rejects(c.open({model:MODEL,threadId:'legacy'}));assert.equal(f.calls.some(x=>x.method==='thread/start'),false);}finally{await c.close();}
});
