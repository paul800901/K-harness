import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInputQueue} from '../src/input-queue.mjs';

async function root(){
  const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});return mkdtemp(path.join(base,'input-queue-'));
}
function controller({busy=false,status=busy?'working':'ready',send,steer}={}){
  const state={threadId:'queue-session',status,busy,questions:[],workers:[]},calls=[];
  return {state,calls,send:async input=>{calls.push(['send',input.text]);return send?send(input):{sent:true};},steer:async input=>{calls.push(['steer',input.text]);return steer?steer(input):{steered:true};}};
}
const queueFor=(root,active,onChange=()=>{})=>createInputQueue({root,getController:()=>active,onChange});
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
    assert.equal(queue.state.queueWaitingReason,'等待 Luna 完成');
    active.state.workers[0].settled=true;active.state.workers[0].status='completed';active.state.status='completed';queue.schedule();
    await until(()=>active.calls.length===1);
    assert.equal(queue.state.queueWaitingReason,null);
  }finally{await queue.close();}
});
