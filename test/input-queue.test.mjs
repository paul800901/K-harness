import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInputQueue} from '../src/input-queue.mjs';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';

async function root(){
  const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});return mkdtemp(path.join(base,'input-queue-'));
}
function controller({busy=false,status=busy?'working':'ready',send,steer}={}){
  const state={threadId:'queue-session',status,busy,questions:[],workers:[]},calls=[];
  return {state,calls,send:async input=>{calls.push(['send',input.text]);return send?send(input):{sent:true};},steer:async input=>{calls.push(['steer',input.text]);return steer?steer(input):{steered:true};}};
}
const queueFor=(root,active,onChange=()=>{})=>createInputQueue({root,getController:()=>active,onChange});

for(const busy of [true,false])test(`send-now preserves more than eight attachments while ${busy?'busy':'idle'}`,async()=>{
 const base=await root(),sent=[],active=controller({busy,steer:async input=>{sent.push(input);return {steered:true};},send:async input=>{sent.push(input);return {sent:true};}}),queue=queueFor(base,active);await queue.load('queue-session');
 try{
  await queue.pause();const attachmentIds=Array.from({length:12},(_,i)=>`file-${i}`),row=await queue.enqueue({text:'files',attachmentIds});
  await queue.action({id:row.id,action:'send-now'});
  assert.deepEqual(sent,[{text:'files',attachmentIds}]);assert.deepEqual(active.calls,[[busy?'steer':'send','files']]);assert.deepEqual(queue.state.queuedMessages,[]);
 }finally{await queue.close();}
});

test('unsupported native steering leaves attachments queued and never dispatches or replays',async()=>{
 const base=await root(),active=controller({busy:true}),queue=queueFor(base,active);active.state.capabilities={steer:false};await queue.load('queue-session');
 try{
  const row=await queue.enqueue({text:'preserve',attachmentIds:['fake-a']});await assert.rejects(queue.action({id:row.id,action:'send-now'}),/不支援/);
  assert.equal(queue.state.queuedMessages[0].status,'queued');assert.deepEqual(queue.state.queuedMessages[0].attachmentIds,['fake-a']);assert.deepEqual(active.calls,[]);
 }finally{await queue.close();}
});
async function until(predicate,timeout=2000){
  const start=Date.now();while(Date.now()-start<timeout){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out waiting for queue behavior');
}

test('sending arbitrary C during a busy turn preserves queued B and D order',async()=>{
  const base=await root(),active=controller({busy:true}),queue=queueFor(base,active);await queue.load('queue-session');
  try{
    await queue.enqueue({text:'B'});await queue.enqueue({text:'D'});const c=await queue.enqueue({text:'C'});
    assert.deepEqual(queue.state.queuedMessages.map(row=>row.text),['B','D','C']);
    await queue.action({id:c.id,action:'send-now'});
    assert.deepEqual(active.calls,[['steer','C']]);
    assert.deepEqual(queue.state.queuedMessages.map(row=>row.text),['B','D']);
  }finally{await queue.close();}
});

test('completed work drains the queue automatically in FIFO order',async()=>{
  const base=await root();let queue;const active=controller({status:'completed',send:async({text})=>{
    active.state.busy=true;active.state.status='working';
    setTimeout(()=>{active.state.busy=false;active.state.status='completed';queue.schedule();},25);
    return {sent:true};
  }});queue=queueFor(base,active);await queue.load('queue-session');
  try{
    await queue.enqueue({text:'B'});await queue.enqueue({text:'D'});
    await until(()=>active.calls.length===2);
    assert.deepEqual(active.calls,[['send','B'],['send','D']]);
    assert.deepEqual(queue.state.queuedMessages,[]);
  }finally{await queue.close();}
});

test('pause during stop retains FIFO items until explicitly resumed',async()=>{
  const base=await root(),active=controller({busy:true}),queue=queueFor(base,active);await queue.load('queue-session');
  try{
    await queue.enqueue({text:'B'});await queue.enqueue({text:'D'});await queue.pause();
    active.state.busy=false;active.state.status='completed';queue.schedule();
    await new Promise(resolve=>setTimeout(resolve,250));assert.deepEqual(active.calls,[]);
    await queue.action({action:'resume'});await until(()=>active.calls.length===2);
    assert.deepEqual(active.calls,[['send','B'],['send','D']]);
  }finally{await queue.close();}
});

test('reopening a persisted sending row makes it uncertain and never resends it',async()=>{
  const base=await root();let finishSend;const active=controller({status:'completed',send:()=>new Promise(resolve=>{finishSend=resolve;})});
  const first=queueFor(base,active);await first.load('queue-session');
  await first.enqueue({text:'do not resend'});await until(()=>first.state.queuedMessages[0]?.status==='sending');await until(()=>active.calls.length===1);
  assert.equal(active.calls.length,1);
  await first.close();
  const reopenedController=controller({status:'completed'}),reopened=queueFor(base,reopenedController);await reopened.load('queue-session');
  try{
    assert.equal(reopened.state.queuedMessages[0].status,'uncertain');assert.equal(reopened.state.queuePaused,true);
    await new Promise(resolve=>setTimeout(resolve,250));assert.deepEqual(reopenedController.calls,[]);
    await assert.rejects(reopened.action({action:'resume'}),/未確認/);
  }finally{await reopened.close();finishSend?.({sent:true});await new Promise(resolve=>setTimeout(resolve,30));}
});

test('a persistence failure removes the row and never calls the controller',async()=>{
  const base=await root(),active=controller(),queue=queueFor(base,active);await queue.load('queue-session');
  await mkdir(path.join(base,'.runtime','input-queues'),{recursive:true});
  await mkdir(path.join(base,'.runtime','input-queues','queue-session.json'));
  await assert.rejects(queue.enqueue({text:'must not send'}));
  assert.deepEqual(active.calls,[]);assert.deepEqual(queue.state.queuedMessages,[]);
});

for(const status of ['failed','interrupted'])test(`resumed queue delivers from ${status} controller state`,async()=>{
  const base=await root(),active=controller({status}),queue=queueFor(base,active);await queue.load('queue-session');
  try{
    await queue.enqueue({text:'continue'});await until(()=>active.calls.length===1);
    assert.deepEqual(active.calls,[['send','continue']]);
    assert.deepEqual(queue.state.queuedMessages,[]);
  }finally{await queue.close();}
});

test('queue exposes Luna as the reason pending messages cannot drain',async()=>{
  const base=await root(),active=controller({status:'completed'}),queue=queueFor(base,active);await queue.load('queue-session');
  active.state.workers=[{settled:false,status:'running'}];
  try{
    await queue.enqueue({text:'wait for worker'});
    assert.equal(queue.state.queueWaitingReason,'等待子代理完成');
    active.state.workers[0].settled=true;active.state.workers[0].status='completed';active.state.status='completed';queue.schedule();
    await until(()=>active.calls.length===1);
    assert.equal(queue.state.queueWaitingReason,null);
  }finally{await queue.close();}
});

test('historical unowned Gemini records do not block queued work, while owned unresolved workers still do',async()=>{
 const base=await root(),active=controller({status:'completed'}),queue=queueFor(base,active);await queue.load('queue-session');
 active.state.workers=[{requestId:'old-gemini',provider:'gemini',executionUnowned:true,settled:false,status:'unresolved'}];
 try{
  await queue.enqueue({text:'new work despite historical unknown'});
  await until(()=>active.calls.length===1);
  assert.deepEqual(active.calls,[['send','new work despite historical unknown']]);
  assert.equal(queue.state.queueWaitingReason,null);

  active.state.workers.push({requestId:'current-worker',provider:'gemini',executionUnowned:false,settled:false,status:'unresolved'});
  await queue.enqueue({text:'wait for owned worker'});
  assert.equal(queue.state.queueWaitingReason,'等待子代理完成');
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(active.calls.length,1,'an owned unresolved worker still holds the queue');
  active.state.workers[1].settled=true;active.state.workers[1].status='completed';queue.schedule();
  await until(()=>active.calls.length===2);
  assert.deepEqual(active.calls,[['send','new work despite historical unknown'],['send','wait for owned worker']]);
 }finally{await queue.close();}
});

test('editing holds a queued message and keeps FIFO, identity and attachments on save',async()=>{
 const base=await root(),sent=[],active=controller({busy:true,send:async input=>{sent.push(input);return {sent:true};}}),queue=queueFor(base,active);await queue.load('queue-session');
 try{
  const first=await queue.enqueue({text:'original',attachmentIds:['file-a']}),second=await queue.enqueue({text:'later'});
  await queue.action({id:first.id,action:'edit-start'});
  active.state.busy=false;active.state.status='completed';queue.schedule();
  await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(active.calls,[]);
  await assert.rejects(queue.action({id:first.id,action:'send-now'}),/完成.*編輯/);
  await queue.action({id:first.id,action:'edit-save',text:'corrected'});
  assert.deepEqual(queue.state.queuedMessages.map(row=>row.id),[first.id,second.id]);
  assert.deepEqual(queue.state.queuedMessages[0].attachmentIds,['file-a']);
  await until(()=>sent.length===2);
  assert.deepEqual(sent,[{text:'corrected',attachmentIds:['file-a']},{text:'later',attachmentIds:[]}]);
  await assert.rejects(queue.action({id:first.id,action:'edit-start'}),/可能已經送出/);
 }finally{await queue.close();}
});

test('cancel editing keeps original message, attachments and existing pause',async()=>{
 const base=await root(),active=controller({busy:true}),queue=queueFor(base,active);await queue.load('queue-session');
 try{
  const row=await queue.enqueue({text:'original',attachmentIds:['file-b']});await queue.action({id:row.id,action:'edit-start'});await queue.pause();
  active.state.busy=false;active.state.status='completed';
  await queue.action({id:row.id,action:'edit-cancel'});
  assert.equal(queue.state.queuePaused,true);assert.equal(queue.state.queuedMessages[0].text,'original');assert.deepEqual(queue.state.queuedMessages[0].attachmentIds,['file-b']);
  await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(active.calls,[]);
 }finally{await queue.close();}
});

test('editing survives queue restart without sending until explicitly saved or cancelled',async()=>{
 const base=await root(),active=controller({busy:true}),first=queueFor(base,active);await first.load('queue-session');
 const row=await first.enqueue({text:'original'});await first.action({id:row.id,action:'edit-start'});await first.close();
 active.state.busy=false;active.state.status='completed';const reopened=queueFor(base,active);await reopened.load('queue-session');
 try{
  assert.equal(reopened.state.queuedMessages[0].status,'editing');await reopened.action({action:'resume'});
  await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(active.calls,[]);
  await reopened.action({id:row.id,action:'edit-save',text:'after restart'});await until(()=>active.calls.length===1);
  assert.deepEqual(active.calls,[['send','after restart']]);
 }finally{await reopened.close();}
});

test('sending and uncertain inputs cannot be edited or replayed',async()=>{
 const base=await root();let rejectSend;const active=controller({busy:true,steer:()=>new Promise((_,reject)=>{rejectSend=reject;})}),queue=queueFor(base,active);await queue.load('queue-session');
 try{
  const row=await queue.enqueue({text:'once'}),delivery=queue.action({id:row.id,action:'send-now'});await until(()=>!!rejectSend);
  await assert.rejects(queue.action({id:row.id,action:'edit-start'}),/只能編輯/);
  const rejected=assert.rejects(delivery,/unknown/);rejectSend(Error('unknown'));await rejected;
  for(const action of ['edit-start','edit-save','edit-cancel'])await assert.rejects(queue.action({id:row.id,action,text:'replacement'}),/只能編輯/);
  assert.equal(queue.state.queuedMessages[0].text,'once');assert.equal(queue.state.queuedMessages[0].status,'uncertain');assert.deepEqual(active.calls,[['steer','once']]);
 }finally{await queue.close();}
});

test('a controller-confirmed not-sent result stays queued while ordinary send errors remain uncertain',async()=>{
 const base=await root(),active=controller({status:'completed',send:async()=>({sent:false})}),queue=queueFor(base,active);let uncertainQueue;await queue.load('queue-session');
 try{
  const stopped=await queue.enqueue({text:'confirmed not sent'});await until(()=>queue.state.queuedMessages[0]?.status==='queued'&&queue.state.queuePaused);
  assert.equal(queue.state.queuedMessages[0].id,stopped.id);
  assert.equal(queue.state.queuedMessages[0].status,'queued');
  assert.equal(queue.state.queuePaused,true);

  const uncertainController=controller({status:'completed',send:async()=>{throw Error('transport unknown');}});uncertainController.state.threadId='second-session';uncertainQueue=queueFor(base,uncertainController);await uncertainQueue.load('second-session');
  const unknown=await uncertainQueue.enqueue({text:'unknown outcome'});await until(()=>uncertainQueue.state.queuedMessages[0]?.status==='uncertain'&&uncertainQueue.state.queuePaused);
  assert.equal(uncertainQueue.state.queuedMessages[0].id,unknown.id);
  assert.equal(uncertainQueue.state.queuedMessages[0].status,'uncertain');
  assert.equal(uncertainQueue.state.queuePaused,true);
 }finally{await queue.close();await uncertainQueue?.close();}
});

test('edit validation does not lose the original or bypass the editing step',async()=>{
 const base=await root(),active=controller({busy:true}),queue=queueFor(base,active);await queue.load('queue-session');
 try{
  const row=await queue.enqueue({text:'original'});await assert.rejects(queue.action({id:row.id,action:'edit-save',text:'bypass'}),/只能編輯/);
  await queue.action({id:row.id,action:'edit-start'});
  for(const text of ['',null,'  ','x'.repeat(32001)])await assert.rejects(queue.action({id:row.id,action:'edit-save',text}),/1–32000/);
  assert.equal(queue.state.queuedMessages[0].text,'original');assert.equal(queue.state.queuedMessages[0].status,'editing');assert.deepEqual(active.calls,[]);
 }finally{await queue.close();}
});

test('an edit must finish persisting before automatic or immediate delivery',async t=>{
 const base=await root(),active=controller({busy:true}),queue=queueFor(base,active);await queue.load('queue-session');
 const row=await queue.enqueue({text:'original'});await queue.action({id:row.id,action:'edit-start'});
 const target=path.join(base,'.runtime/input-queues/queue-session.json'),rename=fs.rename;let release,entered;
 const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const mock=t.mock.method(fs,'rename',async(from,to)=>{if(to===target){entered();await held;}return rename(from,to);});syncBuiltinESMExports();
 try{
  const save=queue.action({id:row.id,action:'edit-save',text:'durable'});await started;
  assert.equal(queue.state.queuedMessages[0].status,'editing');assert.equal(queue.state.queuedMessages[0].text,'original','Uncommitted state must not clear a UI draft through an unrelated stream event');
  active.state.busy=false;active.state.status='completed';queue.schedule();
  await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(active.calls,[]);
  await assert.rejects(queue.action({id:row.id,action:'send-now'}),/正在儲存/);
  const next=queue.enqueue({text:'later'});release();await Promise.all([save,next]);await until(()=>active.calls.length===2);
  assert.deepEqual(active.calls,[['send','durable'],['send','later']]);
 }finally{release();mock.mock.restore();syncBuiltinESMExports();await queue.close();}
});

test('failed edit persistence restores the held original and never dispatches it',async t=>{
 const base=await root(),active=controller({busy:true}),queue=queueFor(base,active);await queue.load('queue-session');
 const row=await queue.enqueue({text:'original'});await queue.action({id:row.id,action:'edit-start'});
 const target=path.join(base,'.runtime/input-queues/queue-session.json'),rename=fs.rename;
 const mock=t.mock.method(fs,'rename',async(from,to)=>{if(to===target)throw Object.assign(Error('edit write failed'),{code:'EIO'});return rename(from,to);});syncBuiltinESMExports();
 try{
  await assert.rejects(queue.action({id:row.id,action:'edit-save',text:'not saved'}),/edit write failed/);
  assert.equal(queue.state.queuedMessages[0].text,'original');assert.equal(queue.state.queuedMessages[0].status,'editing');
  active.state.busy=false;active.state.status='completed';queue.schedule();await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(active.calls,[]);
 }finally{mock.mock.restore();syncBuiltinESMExports();await queue.close();}
});

test('queue waits for native goal continuation and pending goal commands',async()=>{
 const base=await root(),active=controller(),queue=queueFor(base,active);await queue.load('queue-session');
 try{active.state.capabilities={goalContinuesWhileIdle:true};active.state.goal={status:'active'};await queue.enqueue({text:'after goal'});await new Promise(r=>setTimeout(r,150));assert.equal(active.calls.length,0);active.state.goal=null;active.state.goalPending=true;queue.schedule();await new Promise(r=>setTimeout(r,150));assert.equal(active.calls.length,0);active.state.goalPending=false;queue.schedule();await until(()=>active.calls.length===1);}finally{await queue.close();}
});

for(const change of ['goalPending','busy'])test(`queue rechecks ${change} after persisting sending state and keeps pre-dispatch row queued`,async t=>{
 const base=await root(),active=controller({status:'completed'}),queue=queueFor(base,active);await queue.load('queue-session');
 const target=path.join(base,'.runtime/input-queues/queue-session.json'),rename=fs.rename;let release,entered,writes=0;
 const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const mock=t.mock.method(fs,'rename',async(from,to)=>{if(to===target&&++writes===2){entered();await held;}return rename(from,to);});syncBuiltinESMExports();
 try{
  await queue.enqueue({text:'must remain queued'});await started;
  if(change==='goalPending')active.state.goalPending=true;
  else{active.state.busy=true;active.state.status='working';}
  release();
  await until(()=>queue.state.queuedMessages[0]?.status==='queued'&&queue.state.queuePaused);
  assert.deepEqual(active.calls,[],'the core must not be called after readiness changes');
  assert.equal(queue.state.queuedMessages[0].status,'queued','pre-dispatch failure is not uncertain');
  assert.equal(queue.state.queuePaused,true,'resume remains an explicit user action');
  if(change==='goalPending')active.state.goalPending=false;
  else{active.state.busy=false;active.state.status='completed';}
  await queue.action({action:'resume'});await until(()=>active.calls.length===1);
  assert.deepEqual(active.calls,[['send','must remain queued']]);
 }finally{release();mock.mock.restore();syncBuiltinESMExports();await queue.close();}
});

test('idle native Claude goal allows the next explicit queued input to continue',async()=>{
 const base=await root(),active=controller(),queue=queueFor(base,active);await queue.load('queue-session');
 try{active.state.goal={status:'active'};await queue.enqueue({text:'continue native goal'});await until(()=>active.calls.length===1);}finally{await queue.close();}
});
