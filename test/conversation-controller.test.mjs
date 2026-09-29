import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';
import {startDesktop} from '../src/desktop-server.mjs';

const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
const codexModel='gpt-6-astra',claudeModel='claude-opus-5-5';
async function fixture({beforeOpen=async()=>{},browserRequest=async()=>({available:true,mode:'ai',busy:false}),closeFailure=()=>false}={}){
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'concurrent-conversations-'));
 let seq=0,notifications=0;const native=[],saved=new Map();
 const factory=provider=>({onChange})=>{
  const state={provider,status:'idle',workspace:root,threadId:null,title:'',model:null,busy:false,messages:[],questions:[],workers:[],artifacts:[],usage:{},accessMode:provider==='claude'?'claude-manual':'workspace-write'};
  const calls=[];const notify=()=>onChange(state);
  const persist=async()=>{saved.set(state.threadId,structuredClone(state));await saveMainSession(root,{...state,model:state.model??codexModel});};
  const c={state,calls,closed:0,failOpen:false,
   async models(){return {models:[{model:codexModel,supportedReasoningEfforts:[{reasoningEffort:'high'}]}]};},
   async usage(){return state.usage;},
   async selectWorkspace({path}){calls.push(['workspace',path]);assert.equal(state.busy,false);state.workspace=path;return {workspace:path};},
   async open(data){await beforeOpen(data);calls.push(['open',data]);if(data.threadId==='will-fail')throw Error('fixture connection failure');assert.equal(state.busy,false);const threadId=data.threadId??`${provider}-${++seq}`;Object.assign(state,saved.get(threadId)??{messages:[],title:''},{model:data.model,threadId,status:'ready',busy:false,questions:[]});await persist();notify();return {threadId};},
   async send(data){calls.push(['send',data]);assert.equal(state.busy,false);state.busy=true;state.status='working';state.messages.push({id:`user-${seq}-${state.messages.length}`,role:'user',text:data.text});await persist();notify();return {sent:true};},
   async finish(text='finished'){state.messages.push({id:`assistant-${seq}-${state.messages.length}`,role:'assistant',text});state.busy=false;state.status='completed';await persist();notify();},
   async stop(){calls.push(['stop']);state.busy=false;state.status='interrupted';state.questions=[];notify();return {stopped:true};},
   async workers(){calls.push(['workers']);return state.workers;},
   async answer(data){calls.push(['answer',data]);if(!state.questions.find(q=>q.id===data.id))throw Error('stale approval');state.questions=state.questions.filter(q=>q.id!==data.id);notify();return {answered:true};},
   async upload(data){calls.push(['upload',data]);return {id:data.name};},
   async artifact(name){return {name,bytes:Buffer.from(state.threadId),contentType:'text/plain',isText:true};},
   async attachmentFile(id){return this.artifact(id);},
   async selectModel(data){state.model=data.model;await persist();notify();return {model:data.model};},
   async metadata(data){const row=(await listMainSessions(root)).sessions.find(row=>row.threadId===data.threadId);await saveMainSession(root,{...row,...data});if(state.threadId===data.threadId)Object.assign(state,data);notify();return data;},
   async fork(data){calls.push(['fork',data]);state.threadId=`${provider}-${++seq}`;await persist();return {threadId:state.threadId};},
   async close(){calls.push(['close']);if(closeFailure(state))throw Error('close failure');c.closed++;state.busy=false;state.status='offline';notify();},
   notify,
  };
  for(const method of ['compact','goal','steer','review','fuzzyFileSearch','directories'])c[method]=async data=>{calls.push([method,data]);return {};};
  native.push(c);return c;
 };
 const controller=createConversationController({root,codexFactory:factory('codex'),claudeFactory:factory('claude'),inspect:async()=>({available:true}),browserRequest,onChange:()=>notifications++});
 return {root,controller,native,get notifications(){return notifications;},room:id=>native.find(c=>c.state.threadId===id)};
}
const eventually=async check=>{const end=Date.now()+2500;while(!check()){if(Date.now()>end)throw Error('condition timed out');await new Promise(r=>setTimeout(r,20));}};

for(const [first,second] of [[claudeModel,claudeModel],[codexModel,codexModel],[claudeModel,codexModel],[codexModel,claudeModel]]){
 test(`working ${first} remains live while opening and sending to ${second}`,async()=>{
  const f=await fixture(),c=f.controller;try{
   const a=await c.open({model:first});await c.send({...a,text:'work A'});const nativeA=f.room(a.threadId),closeBefore=nativeA.closed;
   const b=await c.open({model:second});await c.send({...b,text:'work B'});const nativeB=f.room(b.threadId);
   assert.notEqual(a.threadId,b.threadId);assert.notEqual(nativeA,nativeB);assert.equal(nativeA.closed,closeBefore);assert.equal(nativeA.state.busy,true);assert.equal(nativeB.state.busy,true);
   assert.deepEqual(c.state.messages.map(m=>m.text),['work B']);assert.equal(c.state.conversationActivity.filter(row=>row.busy).length,2);
   const opens=nativeA.calls.filter(([method])=>method==='open').length;
   await c.open({...a,model:first});assert.equal(nativeA.calls.filter(([method])=>method==='open').length,opens);assert.equal(c.state.busy,true);assert.deepEqual(c.state.messages.map(m=>m.text),['work A']);
   await nativeB.finish('B answer while hidden');assert.deepEqual(c.state.messages.map(m=>m.text),['work A']);
   await c.open({...b,model:second});assert.deepEqual(c.state.messages.map(m=>m.text),['work B','B answer while hidden']);assert.equal(c.state.busy,false);
   await c.stop(a);assert.equal(nativeA.state.status,'interrupted');assert.equal(nativeB.calls.some(([m])=>m==='stop'),false);
  }finally{await c.close();}
 });
}

test('background queues continue on their original native controller; stop only pauses the requested queue',async()=>{
 const f=await fixture(),c=f.controller;try{
  const a=await c.open({model:claudeModel});await c.send({...a,text:'A first'});await c.send({...a,text:'A queued'});
  const b=await c.open({model:claudeModel});await c.send({...b,text:'B first'});await c.send({...b,text:'B queued'});
  await c.stop(b);await f.room(a.threadId).finish();
  await eventually(()=>f.room(a.threadId).calls.filter(([m])=>m==='send').length===2);
  assert.deepEqual(f.room(a.threadId).calls.filter(([m])=>m==='send').map(([,d])=>d.text),['A first','A queued']);
  assert.equal(f.room(b.threadId).calls.filter(([m])=>m==='send').length,1);assert.equal(c.state.queuePaused,true);assert.equal(c.state.queuedMessages[0].text,'B queued');
  await c.open({...a,model:claudeModel});assert.equal(c.state.queuePaused,false);
  // The native call was entered above; retain its sending row until that call's
  // asynchronous persistence/acknowledgement has actually returned to the queue.
  await eventually(()=>c.state.queuedMessages.length===0);
 }finally{await c.close();}
});

test('pending approvals and workers stay in their original room and surface only a sidebar summary',async()=>{
 const f=await fixture(),c=f.controller;try{
  const a=await c.open({model:claudeModel});await c.send({...a,text:'A'});
  const source=f.room(a.threadId);source.state.questions=[{id:'approval-A',text:'private operation'}];source.state.workers=[{status:'running',settled:false}];source.notify();
  const b=await c.open({model:codexModel});assert.equal(c.state.questions.length,0);assert.equal(c.state.workers.length,0);
  assert.equal(c.state.conversationActivity.find(row=>row.threadId===a.threadId).pendingQuestions,1);
  const rows=(await c.sessions()).sessions;assert.equal(rows.find(row=>row.threadId===a.threadId).busy,true);
  assert.equal(JSON.stringify(c.state.conversationActivity).includes('private operation'),false);
  await assert.rejects(async()=>c.answer({...b,id:'approval-A',accept:true}),/stale approval/);
  await c.answer({...a,id:'approval-A',accept:false});assert.equal(source.state.questions.length,0);assert.equal(source.closed,0);
 }finally{await c.close();}
});

test('new workspace and failed opens leave background work intact; unscoped actions never fall through to selected room',async()=>{
 const f=await fixture(),c=f.controller;try{
  const a=await c.open({model:codexModel});await c.send({...a,text:'keep running'});const source=f.room(a.threadId);
  const workspace=path.join(f.root,'second-workspace');await mkdir(workspace);
  const b=await c.open({model:claudeModel,workspace});assert.equal(c.state.workspace,workspace);assert.equal(source.state.workspace,f.root);
  await saveMainSession(f.root,{threadId:'will-fail',model:codexModel,workspace});
  await assert.rejects(c.open({threadId:'will-fail',model:codexModel}),/fixture connection failure/);assert.equal(c.state.threadId,b.threadId);assert.equal(source.state.busy,true);
  for(const method of ['send','stop','answer','compact','queue','workers'])await assert.rejects(async()=>c[method]({text:'missing context'}),/請指定/);
  await assert.rejects(async()=>c.send({threadId:'foreign',text:'wrong'}),/請指定/);
  await c.selectWorkspace({path:f.root});assert.equal(c.state.threadId,null);assert.equal(source.closed,0);assert.equal(source.state.busy,true);
  await c.open({...a,model:codexModel});assert.equal(c.state.busy,true);
 }finally{await c.close();}
});

test('late scoped file reads and mutations still target their named conversation; fork reindexes the native slot',async()=>{
 const f=await fixture(),c=f.controller;try{
  const a=await c.open({model:codexModel});await c.send({...a,text:'A'});await f.room(a.threadId).finish('A conclusion');
  const b=await c.open({model:claudeModel});
  assert.equal((await c.artifact('result.txt',a)).bytes.toString(),a.threadId);assert.equal((await c.attachmentFile('attachment',b)).bytes.toString(),b.threadId);
  await assert.rejects(async()=>c.artifact('result.txt',{}),/請指定/);
  await c.open({...a,model:codexModel});const source=f.room(a.threadId);const messageId=source.state.messages.at(-1).id;
  const fork=await c.fork({...a,messageId});assert.notEqual(fork.threadId,a.threadId);assert.equal(c.state.threadId,fork.threadId);
  assert.equal(c.state.conversationActivity.some(row=>row.threadId===a.threadId),false);assert.equal(c.state.conversationActivity.some(row=>row.threadId===b.threadId),true);
  await c.open({...a,model:codexModel});assert.equal(c.state.threadId,a.threadId);assert.equal(source.state.busy,true,'fork continues while viewing the original');
 }finally{await c.close();}
});

test('archive deletion refuses busy hidden rooms, and shutdown closes every owned native runtime',async()=>{
 const f=await fixture(),c=f.controller;
 const a=await c.open({model:claudeModel});await c.send({...a,text:'A'});await c.metadata({...a,archived:true});
 await c.open({model:codexModel});
 await assert.rejects(c.deleteArchived({threadIds:[a.threadId],confirmed:true}),/背景聊天室/);
 assert.equal(f.room(a.threadId).state.busy,true);await c.close();assert.ok(f.native.every(controller=>controller.closed>0));
});

test('shutdown waits for an already opening room, then closes its newly created native runtime',async()=>{
 let releaseOpen,enteredOpen;
 const gate=new Promise(resolve=>{releaseOpen=resolve;}),entered=new Promise(resolve=>{enteredOpen=resolve;});
 const f=await fixture({beforeOpen:async()=>{enteredOpen();await gate;}}),c=f.controller;
 const opening=c.open({model:codexModel});await entered;
 const shutdown=c.close();
 try{
  await assert.rejects(c.open({model:claudeModel}),/切換聊天室/);
  assert.equal(f.native.some(controller=>controller.closed>0),false,'do not close a host before accepted open finishes');
 }finally{releaseOpen();await opening;await shutdown;}
 assert.ok(f.native.every(controller=>controller.closed>0));
 assert.equal(c.state.conversationActivity.length,0);
});

test('opening an idle room can still reconnect its failed worker connection without touching a busy neighbour',async()=>{
 const f=await fixture(),c=f.controller;try{
  const a=await c.open({model:codexModel}),nativeA=f.room(a.threadId);
  nativeA.state.workerConnection='failed';nativeA.notify();
  const b=await c.open({model:claudeModel});await c.send({...b,text:'B continues'});
  const before=nativeA.calls.filter(([method])=>method==='open').length;
  await c.open({...a,model:codexModel});
  assert.equal(nativeA.calls.filter(([method])=>method==='open').length,before+1);
  assert.equal(f.room(b.threadId).state.busy,true);assert.equal(f.room(b.threadId).closed,0);
  assert.equal(nativeA.calls.filter(([method])=>method==='send').length,0,'reconnect never replays input');
 }finally{await c.close();}
});

test('idle room release keeps four recent rooms and reopens older history on its original thread',async()=>{
 const f=await fixture(),c=f.controller;try{
  const opened=[];
  for(let i=0;i<7;i++){const room=await c.open({model:codexModel});opened.push({room,native:f.room(room.threadId)});}
  await eventually(()=>opened.slice(0,3).every(({native})=>native.closed===1));
  assert.equal(c.state.conversationActivity.length,4);
  const reopened=await c.open({...opened[0].room,model:codexModel});
  assert.equal(reopened.threadId,opened[0].room.threadId);
  assert.notEqual(f.native.filter(controller=>controller.state.threadId===reopened.threadId).at(-1),opened[0].native,'released controller is replaced by a native resume of the same thread');
  assert.equal(c.state.threadId,opened[0].room.threadId);
 }finally{await c.close();}
});

test('idle release refuses rooms with pending approvals, queues, unfinished workers, or human browser control',async()=>{
 const probed=[];const f=await fixture({browserRequest:async(_root,state)=>{probed.push(state.threadId);return state.browserAccess?.mode==='human'?{available:true,mode:'human',busy:false}:{available:true,mode:'ai',busy:false};}}),c=f.controller;try{
  const opened=[];for(let i=0;i<7;i++){
   const room=await c.open({model:codexModel});opened.push(room);const native=f.room(room.threadId);
   if(i===0)native.state.browserAccess={enabled:true,mode:'human'};
   if(i===1)native.state.questions=[{id:'approval'}];
   if(i===2)native.state.queuedMessages=[{text:'pending'}];
   if(i===3)native.state.workers=[{status:'running',settled:false}];
   if(i<4)native.notify();
  }
  const [browser,approval,queued,worker]=opened.slice(0,4).map(room=>f.room(room.threadId));
  await eventually(()=>probed.includes(opened[0].threadId));
  assert.deepEqual([approval,queued,worker,browser].map(controller=>controller.closed),[0,0,0,0]);
  assert.ok(c.state.conversationActivity.some(row=>row.threadId===opened[0].threadId));
 }finally{await c.close();}
});

test('failed idle teardown remains registered and can be retried by a later cleanup pass',async()=>{
 let fail=true;const f=await fixture({closeFailure:state=>fail&&state.threadId==='codex-1'}),c=f.controller;try{
  const opened=[];for(let i=0;i<7;i++)opened.push(await c.open({model:codexModel}));
  const oldest=f.room(opened[0].threadId);
  await eventually(()=>oldest.calls.some(([method])=>method==='close')&&c.state.conversationActivity.some(row=>row.threadId===opened[0].threadId));
  assert.equal(oldest.closed,0);
  fail=false;await c.open({...opened[6],model:codexModel});
  await eventually(()=>oldest.closed===1);
 }finally{await c.close();}
});

test('HTTP desktop routes preserve thread context for stop, approvals, files and switching',async()=>{
 const f=await fixture();const app=await startDesktop({root:f.root,executable:'fixture',port:0,controllerFactory:()=>f.controller});
 try{
  const home=await fetch(app.origin),cookie=home.headers.get('set-cookie').split(';')[0];await home.text();
  const post=async(route,data)=>{const response=await fetch(`${app.origin}/api/${route}`,{method:'POST',headers:{cookie,Origin:app.origin,'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify(data)});return {status:response.status,body:await response.json()};};
  const a=(await post('open',{model:claudeModel})).body;assert.equal((await post('send',{...a,text:'A'})).status,200);
  const b=(await post('open',{model:codexModel})).body;await post('send',{...b,text:'B'});
  assert.equal((await post('stop',{})).status,400);assert.equal((await post('stop',a)).status,200);
  assert.equal(f.room(a.threadId).state.busy,false);assert.equal(f.room(b.threadId).state.busy,true);
  const artifact=await fetch(`${app.origin}/api/artifact?path=result.txt&threadId=${a.threadId}`,{headers:{cookie}});assert.equal((await artifact.json()).text,a.threadId);
  const state=await fetch(`${app.origin}/api/state`,{headers:{cookie}}).then(r=>r.json());assert.equal(state.conversationActivity.length,2);
 }finally{await app.close();}
});
