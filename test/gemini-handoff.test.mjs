import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createGeminiAccounts} from '../src/gemini-accounts.mjs';
import {createGeminiWorker} from '../src/gemini-worker.mjs';
import {createLunaBridge} from '../src/luna-bridge.mjs';

const A='a'.repeat(32),B='b'.repeat(32),now=Date.parse('2026-10-12T00:00:00Z');
async function fixture(){
 const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'gemini-handoff-')),workspace=path.join(root,'workspace');await mkdir(workspace);
 let identity={accountId:A,email:'a@example.test'},exhausted=false;
 const calls={activate:[],spawn:[],kill:[]};
 const vault={current:async()=>({...identity}),capture:async()=>({...identity}),assertIdle:async()=>{},activate:async id=>{calls.activate.push(id);identity={accountId:id,email:`${id[0]}@example.test`};return {...identity};}};
 const accounts=createGeminiAccounts({root,vault,enabled:true,clock:()=>now,login:{status:async()=>({auth:{status:'authenticated',checkedAt:new Date(now).toISOString()},quota:{status:'ready',checkedAt:new Date(now).toISOString(),windows:[{key:'five_hour',remainingPercent:identity.accountId===A&&exhausted?0:80,resetsAt:(now+3600000)/1000}]}})}});
 await accounts.capture();identity={accountId:B,email:'b@example.test'};await accounts.capture();await accounts.activate({accountId:A});calls.activate.length=0;
 const spawnImpl=(exe,args)=>{
  calls.spawn.push(args);const child=new EventEmitter();Object.assign(child,{pid:12300+calls.spawn.length,stdout:new PassThrough(),stderr:new PassThrough()});
  queueMicrotask(()=>{
   child.stdout.write(args[0]==='models'?'gemini-3.8-flash-high\tFlash\n':JSON.stringify({event:'result',result:{status:'ERROR',error:'RESOURCE_EXHAUSTED quota',response:'partial saved text'}})+'\n');child.emit('close',args[0]==='models'?0:1);
  });return child;
 };
 const events=[],bridges=[];
 const make=async(parentId,onHandoff=()=>{})=>{
  const bridge=await createLunaBridge({root,workspace,parentId,geminiOnly:true,geminiOptions:{accounts},
   geminiFactory:options=>createGeminiWorker({...options,executable:'fake-agy',env:{SystemRoot:'C:/Windows'},spawnImpl,killTree:async pid=>calls.kill.push(pid),gitStatus:async()=>null}),
   onGeminiHandoff:event=>{events.push(event);onHandoff(event);}});bridges.push(bridge);return bridge;
 };
 return {root,accounts,events,calls,make,get identity(){return identity;},set exhausted(value){exhausted=value;},async close(){for(const bridge of bridges)await bridge.close();}};
}
const job=requestId=>({requestId,task:'bounded fake task',model:'gemini-3.8-flash',effort:'high'});

test('two native bridges share one drain; ready is delivered once per room after failed records persist, never replaying a worker',async()=>{
 const f=await fixture();const first=await f.make('room-gpt'),second=await f.make('room-claude'),main=await f.accounts.acquire();
 try{
  await first.start(job('failed-first'));const old=await first.wait({requestId:'failed-first',timeoutMs:1000});assert.equal(old.status,'failed');assert.equal(old.settled,true);
  assert.equal(f.events.some(event=>event.status==='ready'),false);const spawnCount=f.calls.spawn.length;
  await second.start(job('not-started-second'));const refused=await second.wait({requestId:'not-started-second',timeoutMs:1000});assert.equal(refused.status,'failed');assert.equal(refused.settled,true);assert.equal(f.calls.spawn.length,spawnCount);
  f.exhausted=true;await main.release();
  const ready=f.events.filter(event=>event.status==='ready');assert.equal(ready.length,2);assert.deepEqual(f.calls.activate,[B]);assert.deepEqual(f.calls.kill,[]);
  for(const event of ready){
   assert.equal(event.accountId,B);assert.equal(event.switched,true);
   for(const requestId of event.requestIds){const stored=JSON.parse(await readFile(path.join(f.root,'.runtime/luna-bridge',event.parentId,`${requestId}.json`),'utf8'));assert.equal(stored.settled,true);assert.equal(stored.status,'failed');}
  }
  assert.equal(f.calls.spawn.length,spawnCount);assert.equal((await first.inspect({requestId:'failed-first'})).output,'partial saved text');
 }finally{await main.release();await f.close();}
});

test('same-room failed and rejected requests aggregate one ready event, including immediate last-release completion',async()=>{
 const f=await fixture(),bridge=await f.make('aggregate'),main=await f.accounts.acquire();
 try{
  await bridge.start(job('failed'));await bridge.wait({requestId:'failed',timeoutMs:1000});await bridge.start(job('refused'));await bridge.wait({requestId:'refused',timeoutMs:1000});
  f.exhausted=true;await main.release();const ready=f.events.filter(event=>event.status==='ready');assert.equal(ready.length,1);assert.deepEqual(ready[0].requestIds,['failed','refused']);
 }finally{await main.release();await f.close();}
 const immediate=await fixture(),single=await immediate.make('single');
 try{
  // Startup authenticates while positive; exhaustion is confirmed at release.
  const acquire=immediate.accounts.acquire;immediate.accounts.acquire=async options=>{const lease=await acquire(options);immediate.exhausted=true;return lease;};
  await single.start(job('single-failed'));const record=await single.wait({requestId:'single-failed',timeoutMs:1000});assert.equal(record.settled,true);
  assert.equal(immediate.events.filter(event=>event.status==='ready').length,1);assert.deepEqual(immediate.calls.activate,[B]);
 }finally{await immediate.close();}
});

test('bridge cancellation, explicit pause hook and close remove waiters without aborting other-room work or stale callbacks',async t=>{
 for(const mode of ['cancel-job','pause-hook','close'])await t.test(mode,async()=>{
  const f=await fixture(),bridge=await f.make(`room-${mode}`),main=await f.accounts.acquire();
  try{
   await bridge.start(job('failed'));await bridge.wait({requestId:'failed',timeoutMs:1000});
   if(mode==='cancel-job')await bridge.cancel({requestId:'failed'});else if(mode==='pause-hook')bridge.cancelGeminiHandoff();else await bridge.close();
   f.exhausted=true;await main.release();assert.deepEqual(f.calls.activate,[]);assert.deepEqual(f.calls.kill,[]);assert.equal(f.events.some(event=>event.status!=='waiting'),false);
  }finally{await main.release();await f.close();}
 });
});

test('bridge ignores old-epoch handoff events and never recreates waiters from persisted failed records',async()=>{
 const f=await fixture(),bridge=await f.make('epoch');
 try{
  const main=await f.accounts.acquire();await bridge.start(job('failed'));await bridge.wait({requestId:'failed',timeoutMs:1000});bridge.cancelGeminiHandoff();await bridge.close();f.exhausted=true;await main.release();
  const restarted=await f.make('epoch');const old=await restarted.inspect({requestId:'failed'});assert.equal(old.status,'failed');
  assert.equal(f.events.some(event=>event.status!=='waiting'),false);assert.deepEqual(f.calls.activate,[]);
 }finally{await f.close();}
});

test('real worker bridges release unstarted work on official positive quota without waking the rate-failed source',async()=>{
 const f=await fixture(),rate=await f.make('rate-room'),unstarted=await f.make('unstarted-room'),main=await f.accounts.acquire();
 try{
  await rate.start(job('rate-failed'));await rate.wait({requestId:'rate-failed',timeoutMs:1000});const count=f.calls.spawn.length;
  await unstarted.start(job('not-started'));await unstarted.wait({requestId:'not-started',timeoutMs:1000});await main.release();
  const ready=f.events.filter(event=>event.status==='ready');assert.equal(ready.length,1);assert.equal(ready[0].parentId,'unstarted-room');assert.deepEqual(ready[0].requestIds,['not-started']);assert.equal(ready[0].switched,false);assert.equal(ready[0].accountId,A);
  assert.equal(f.events.some(event=>event.parentId==='rate-room'&&event.status==='ready'),false);assert.equal(f.calls.spawn.length,count);assert.deepEqual(f.calls.activate,[]);assert.deepEqual(f.calls.kill,[]);
 }finally{await main.release();await f.close();}
});

test('same-room positive ready contains only unstarted IDs and excludes its rate-failed work',async()=>{
 const f=await fixture(),bridge=await f.make('mixed-room'),main=await f.accounts.acquire();
 try{
  await bridge.start(job('rate-failed'));await bridge.wait({requestId:'rate-failed',timeoutMs:1000});await bridge.start(job('not-started'));await bridge.wait({requestId:'not-started',timeoutMs:1000});
  await main.release();const terminal=f.events.filter(event=>event.status!=='waiting');assert.equal(terminal.length,1);assert.equal(terminal[0].status,'ready');assert.equal(terminal[0].switched,false);assert.deepEqual(terminal[0].requestIds,['not-started']);assert.equal((await bridge.inspect({requestId:'rate-failed'})).status,'failed');assert.deepEqual(f.calls.activate,[]);
 }finally{await main.release();await f.close();}
});

test('a real rejected bridge catches after the prior drain and still receives one settled ready on the new account',{timeout:1000},async()=>{
 let resolveReady;const ready=new Promise(resolve=>{resolveReady=resolve;});
 const f=await fixture(),first=await f.make('old-room'),late=await f.make('late-room',event=>{if(event.status==='ready')resolveReady(event);}),main=await f.accounts.acquire();
 try{
  await first.start(job('failed'));await first.wait({requestId:'failed',timeoutMs:1000});f.exhausted=true;
  const acquire=f.accounts.acquire;f.accounts.acquire=async options=>{try{return await acquire(options);}catch(error){if(error.code==='GEMINI_HANDOFF_WAIT'){await main.release();await Promise.resolve();}throw error;}};
  const count=f.calls.spawn.length;await late.start(job('not-started'));await late.wait({requestId:'not-started',timeoutMs:1000});
  // drain is event-driven and may finish after wait() sees the refused record.
  const event=await ready;
  assert.equal(event.accountId,B);assert.equal(event.switched,false);assert.deepEqual(event.requestIds,['not-started']);assert.equal((await late.inspect({requestId:'not-started'})).settled,true);assert.deepEqual(f.calls.activate,[B]);assert.equal(f.calls.spawn.length,count);
 }finally{await main.release();await f.close();}
});
