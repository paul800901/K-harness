import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createGeminiAccounts} from '../src/gemini-accounts.mjs';
import {createGeminiWorker} from '../src/gemini-worker.mjs';
import {createLunaBridge} from '../src/luna-bridge.mjs';
import {createDesktopController} from '../src/desktop-controller.mjs';

const A='a'.repeat(32),B='b'.repeat(32),now=Date.parse('2026-10-13T00:00:00Z');
const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
async function until(predicate,label){
 const deadline=Date.now()+5000;
 while(!predicate()){if(Date.now()>deadline)throw Error(`observable not reached: ${label}`);await new Promise(resolve=>setTimeout(resolve,20));}
}
const job=(requestId,extra={})=>({requestId,task:`FAKE_TASK:${requestId}`,model:'gemini-3.8-flash',effort:'high',...extra});

// Production accounts + controller + bridge + worker. Only the native provider
// boundaries are fake: no credentials, network, installed agy, or formal K state.
async function fixture(){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'gemini-scheduler-rooms-'));
 let identity={accountId:A,email:'a@example.test'},exhausted=false;
 const calls={activate:[],query:[],spawn:[],kill:[],timer:[]},events=[],children=new Map(),rooms=[];
 const providerCalls=calls;
 const vault={current:async()=>({...identity}),capture:async()=>({...identity}),assertIdle:async()=>{},activate:async id=>{
  assert.equal(children.size,0,'never switch while another room owns an agy process');
  calls.activate.push(id);identity={accountId:id,email:`${id[0]}@example.test`};return {...identity};
 }};
 vault.queryQuota=async id=>{
  calls.query.push(id);return {accountId:id,auth:{status:'authenticated',checkedAt:new Date(now).toISOString()},quota:{status:'ready',checkedAt:new Date(now).toISOString(),windows:[{key:'five_hour',remainingPercent:id===A&&exhausted?0:80,resetsAt:(now+3600000)/1000}]}};
 };
 const accounts=createGeminiAccounts({root,vault,enabled:true,clock:()=>now,setTimer:(...args)=>{calls.timer.push(args[1]);return setTimeout(...args);},login:{}});
 await accounts.capture();identity={accountId:B,email:'b@example.test'};await accounts.capture();await accounts.activate({accountId:A});calls.activate.length=0;calls.query.length=0;
 const spawnImpl=(_executable,args,options)=>{
  const child=new EventEmitter();Object.assign(child,{pid:24000+calls.spawn.length,stdout:new PassThrough(),stderr:new PassThrough()});
  const requestId=args[0]==='models'?null:args[1].match(/FAKE_TASK:([\w-]+)/u)?.[1];
  assert.ok(args[0]==='models'||requestId,'only bounded fixture tasks may spawn');
  calls.spawn.push({requestId,accountId:identity.accountId,args,options});
  const finish=(quota=false)=>{
   if(requestId&&!children.has(requestId))return;
   if(requestId)children.delete(requestId);
   child.stdout.write(args[0]==='models'?'gemini-3.8-flash-high\tFlash\n':JSON.stringify({event:'result',result:{status:quota?'ERROR':'SUCCESS',...(quota?{error:'RESOURCE_EXHAUSTED quota'}:{}),response:`saved output ${requestId}`}})+'\n');
   child.stdout.end();child.stderr.end();child.emit('close',quota?1:0);
  };
  if(requestId)children.set(requestId,{child,finish});else queueMicrotask(()=>finish());return child;
 };
 for(let i=0;i<4;i++){
  const id=`room-${i+1}`,calls=[];let hooks,gateway,bridge,close,seq=0;
  const goal={threadId:id,objective:`Complete remaining fake work in ${id}`,status:'active',tokenBudget:null,tokensUsed:12,timeUsedSeconds:1,createdAt:101+i,updatedAt:102+i};
  const parent={id,status:{type:'idle'},historyMode:'paginated',turns:[]};
  const emit=(method,params={})=>hooks.onEvent({method,params:{threadId:id,...params}});
  const end=()=>{const turn=parent.turns.at(-1);assert.ok(turn);turn.status='completed';parent.status={type:'idle'};emit('turn/completed',{turn:structuredClone(turn)});};
  const host={closed:new Promise(resolve=>close=resolve),notify(){},waitForMcp:async()=>{},close:async()=>close(),async request(method,p){
   calls.push({method,p:structuredClone(p)});
   if(method==='account/read')return {account:{type:'chatgpt'}};
   if(method==='model/list')return {data:[{model:'gpt-6-astra',supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'}]};
   if(method==='thread/start'||method==='thread/resume')return {thread:{id}};
   if(method==='thread/goal/get')return {goal:structuredClone(goal)};
   if(method==='thread/goal/set'){for(const k of ['status','objective','tokenBudget'])if(Object.hasOwn(p,k))goal[k]=p[k];emit('thread/goal/updated',{goal:structuredClone(goal)});return {goal:structuredClone(goal)};}
   if(method==='thread/read'){assert.equal(p.threadId,id);return {thread:structuredClone(parent)};}
   if(method==='thread/turns/list')return {data:structuredClone(parent.turns.slice(-1)),nextCursor:null};
   if(method==='thread/loaded/list')return {data:[id],nextCursor:null};
   if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
   if(method==='turn/start'){const turn={id:`${id}-turn-${++seq}`,status:'inProgress',items:[]};parent.turns.push(turn);parent.status={type:'active'};emit('turn/started',{turn:structuredClone(turn)});return {turn:structuredClone(turn)};}
   if(method==='turn/interrupt'){const turn=parent.turns.find(t=>t.id===p.turnId);assert.ok(turn);turn.status='interrupted';parent.status={type:'idle'};emit('turn/completed',{turn:structuredClone(turn)});return {};}
   return {};
  }};
  const c=createDesktopController({root,executable:'fixture-never-spawn-codex',geminiOptions:{accounts},hostFactory:o=>{hooks=o;host.closed=new Promise(resolve=>close=resolve);return host;},
   bridgeFactory:async o=>{
    bridge=await createLunaBridge({...o,geminiFactory:options=>createGeminiWorker({...options,executable:'fixture-never-spawn-agy',env:{SystemRoot:'C:/Windows'},spawnImpl,killTree:async pid=>{providerCalls.kill.push(pid);calls.push({method:'unexpected-kill',p:{pid}});throw Error('fixture work must finish naturally');},gitStatus:async()=>null}),
     onGeminiHandoff:event=>{events.push(structuredClone(event));o.onGeminiHandoff(event);}});return bridge;
   },gatewayFactory:async o=>{gateway=o;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://127.0.0.1:1/fixture-not-opened',headers:{Authorization:'Bearer fixture-not-a-secret'}}}},close:async()=>{}};}});
  await c.open({model:'gpt-6-astra',effort:'high'});await c.send({text:`New bounded fake work in ${id}`});
  rooms.push({id,c,calls,goal,end,block(){goal.status='blocked';emit('thread/goal/updated',{goal:structuredClone(goal)});},get gateway(){return gateway;},get bridge(){return bridge;},get turnId(){return parent.turns.at(-1)?.id;},deliveries:()=>calls.filter(call=>call.method==='turn/start'&&call.p.toolOutput),meta:()=>({'x-codex-turn-metadata':{thread_id:id,turn_id:parent.turns.at(-1)?.id}})});
 }
 return {root,accounts,calls,events,rooms,children,set exhausted(value){exhausted=value;},get identity(){return identity;},
  async started(id){await until(()=>children.has(id),`agy starts ${id}`);},
  async finish(id,quota=false){assert.ok(children.has(id),`live fake process ${id}`);children.get(id).finish(quota);},
  async record(room,id){const record=await room.gateway.bridge.wait({requestId:id,timeoutMs:2000});assert.equal(record.settled,true);return record;},
  async persisted(room,id){return JSON.parse(await readFile(path.join(root,'.runtime/luna-bridge',room.id,`${id}.json`),'utf8'));},
  async close(){for(const {finish} of [...children.values()])finish();for(const room of rooms){await room.c.stop();await room.c.close();}}
 };
}

function assertNoUnexpectedStops(f){
 assert.deepEqual(f.calls.kill,[]);
 for(const room of f.rooms)assert.equal(room.calls.some(call=>['unexpected-kill','thread/backgroundTerminals/clean'].includes(call.method)),false);
}

// A and B run on A; quota failure in A drains the shared account, C dispatch is
// refused without a process, and D observes only (no worker ID to poll).
test('four real DesktopControllers drain one shared account; query-only blocked goal gets one trusted recovery after other-room work ends',async()=>{
 const f=await fixture(),[a,b,c,d]=f.rooms;let secondLease;
 try{
  await a.gateway.bridge.start(job('a-quota'));await f.started('a-quota');
  await b.gateway.bridge.start(job('b-natural'));await f.started('b-natural');
  f.exhausted=true;await f.finish('a-quota',true);const failed=await f.record(a,'a-quota');
  assert.equal(failed.status,'failed');assert.equal(failed.accountId,A);assert.equal(failed.output,'saved output a-quota');
  assert.deepEqual(f.calls.activate,[]);assert.ok(f.children.has('b-natural'));assert.equal(f.events.some(event=>event.status==='ready'),false);
  const spawns=f.calls.spawn.length;
  await c.gateway.bridge.start(job('c-not-started',{accountId:A}));const unsent=await f.record(c,'c-not-started');
  assert.equal(unsent.dispatch,'not-started');assert.equal(unsent.scheduling.notificationRegistered,true);assert.equal(f.calls.spawn.length,spawns);
  const queryCount=f.calls.query.length,observation=await d.gateway.bridge.accounts();
  assert.equal(observation.scheduling.status,'waiting');assert.equal(observation.scheduling.notificationRegistered,true);assert.match(observation.scheduling.reason,/不要輪詢/);assert.equal(f.calls.query.length,queryCount);
  assert.deepEqual(await d.gateway.bridge.list(),[],'query-only room has no invented worker');
  for(const room of [a,c,d]){room.block();room.end();}
  await new Promise(resolve=>setTimeout(resolve,1100));assert.equal([a,c,d].reduce((n,room)=>n+room.deliveries().length,0),0,'no model polling while the other room runs');
  assert.equal(f.calls.query.length,queryCount,'query-only room does not poll official usage while waiting');
  assert.deepEqual(f.calls.activate,[]);assert.deepEqual(f.calls.timer,[]);
  await f.finish('b-natural');const natural=await f.record(b,'b-natural');assert.equal(natural.status,'completed');assert.equal(natural.output,'saved output b-natural');b.end();
  await until(()=>[a,c,d].every(room=>room.deliveries().length===1)&&b.deliveries().length===1,'all original-room deliveries');
  assert.deepEqual(f.calls.activate,[B]);assert.equal(f.identity.accountId,B);assert.equal(f.calls.spawn.length,spawns,'ready never replays any worker');
  const ready=f.events.filter(event=>event.status==='ready');assert.equal(ready.length,3);assert.deepEqual(ready.map(event=>event.parentId).sort(),[a.id,c.id,d.id].sort());
  assert.deepEqual(ready.find(event=>event.parentId===d.id).requestIds,[]);assert.deepEqual(ready.find(event=>event.parentId===d.id).queryIds,[observation.scheduling.waitId]);
  for(const room of [a,c,d]){
   const delivery=room.deliveries()[0];assert.equal(delivery.p.threadId,room.id);assert.equal(delivery.p.toolOutput.name,'k_native_goal_recovery');assert.match(delivery.p.toolOutput.output,/其他阻礙/);assert.match(delivery.p.toolOutput.output,/先核對/);
   assert.equal(room.goal.status,'blocked','account readiness is not goal resume');assert.equal(room.calls.some(call=>call.method==='thread/goal/set'),false);
   await room.gateway.resumeGoal({},room.meta());assert.equal(room.goal.status,'active');assert.equal(room.goal.tokensUsed,12);
   room.end();
  }
  b.end();await tick();
  assert.ok(d.deliveries()[0].p.toolOutput.output.includes(observation.scheduling.waitId));
  assert.match(a.deliveries()[0].p.toolOutput.output,/saved output a-quota/);
  assert.equal((await f.persisted(a,'a-quota')).status,'failed');assert.equal((await f.persisted(c,'c-not-started')).dispatch,'not-started');
  for(const room of f.rooms){assert.equal(room.deliveries().length,1);assert.equal(room.c.state.notices.some(notice=>notice.kind==='gemini-handoff'&&!notice.resolved),false);}
  assertNoUnexpectedStops(f);
  // A genuinely new scheduling episode must wake the same original room again;
  // the first once-only receipt is not a lifetime notification lock.
  secondLease=await f.accounts.acquire();
  await a.c.send({text:'A new bounded account expectation to review, not a replay of the quota-failed job'});
  await a.gateway.bridge.start(job('a-second-unsent',{accountId:A}));assert.equal((await f.record(a,'a-second-unsent')).dispatch,'not-started');a.end();
  await d.c.send({text:'Observe readiness for this new remaining-work episode'});
  const secondQuery=await d.gateway.bridge.accounts(),repeatQuery=await d.gateway.bridge.accounts();
  assert.equal(secondQuery.scheduling.status,'waiting');assert.notEqual(secondQuery.scheduling.waitId,observation.scheduling.waitId);assert.equal(repeatQuery.scheduling.waitId,secondQuery.scheduling.waitId);
  d.block();d.end();await tick();assert.equal(a.deliveries().length,1);assert.equal(d.deliveries().length,1);
  await secondLease.release();
  await until(()=>a.deliveries().length===2&&d.deliveries().length===2,'new material scheduling episode wakes its own rooms again');
  assert.equal(f.events.filter(event=>event.status==='ready'&&event.parentId===d.id).length,2);
  assert.equal(d.deliveries()[1].p.toolOutput.name,'k_native_goal_recovery');assert.ok(d.deliveries()[1].p.toolOutput.output.includes(secondQuery.scheduling.waitId));assert.equal(d.goal.status,'blocked');
  await d.gateway.resumeGoal({},d.meta());assert.equal(d.goal.status,'active');a.end();d.end();await tick();
  assert.equal(a.deliveries().length,2);assert.equal(d.deliveries().length,2);assert.equal(b.deliveries().length,1);assert.equal(c.deliveries().length,1);
  assert.equal(f.calls.spawn.length,spawns,'new account observation and stale expectation still do not replay worker jobs');assert.deepEqual(f.calls.activate,[B]);assertNoUnexpectedStops(f);
 }finally{await secondLease?.release();await f.close();}
});

test('four real DesktopControllers turn stale explicit account IDs into owned waits without silently running or switching backwards',async()=>{
 const f=await fixture();let lease;
 try{
  for(const room of f.rooms)room.end();
  await f.accounts.activate({accountId:B});f.calls.activate.length=0;
  // Keep one account lease live while all four stale requests register their room.
  lease=await f.accounts.acquire();
  for(let i=0;i<f.rooms.length;i++){
   const room=f.rooms[i];await room.c.send({text:'Review stale account expectation before remaining work'});
   await room.gateway.bridge.start(job(`stale-${i+1}`,{accountId:A}));const old=await f.record(room,`stale-${i+1}`);
   assert.equal(old.status,'failed');assert.equal(old.dispatch,'not-started');assert.equal(old.requestedAccountId,A);assert.equal(old.scheduling.status,'waiting');assert.equal(old.scheduling.notificationRegistered,true);
   room.end();
  }
  assert.equal(f.calls.spawn.length,0);assert.equal(f.rooms.every(room=>room.deliveries().length===0),true,'unstarted waits do not create provider polling turns');
  await lease.release();
  await until(()=>f.rooms.every(room=>room.deliveries().length===1),'four stale-account original-room ready notifications');
  const ready=f.events.filter(event=>event.status==='ready');assert.equal(ready.length,4);assert.deepEqual(f.calls.activate,[]);assert.equal(f.identity.accountId,B);
  for(let i=0;i<f.rooms.length;i++){
   const room=f.rooms[i],event=ready.find(event=>event.parentId===room.id);assert.equal(event.accountId,B);assert.equal(event.switched,false);assert.deepEqual(event.requestIds,[`stale-${i+1}`]);
   assert.equal((await f.persisted(room,`stale-${i+1}`)).dispatch,'not-started');assert.match(room.deliveries()[0].p.toolOutput.output,/本次通知未切換帳號/);room.end();
  }
  await new Promise(resolve=>setTimeout(resolve,1250));assert.equal(f.rooms.every(room=>room.deliveries().length===1),true);
  // Only explicit new work, after original-room review, may execute on B.
  const first=f.rooms[0];await first.c.send({text:'Reviewed original unsent result; perform only remaining fake work with a new ID'});
  await first.gateway.bridge.start(job('reviewed-new',{handoffFrom:'stale-1'}));await f.started('reviewed-new');
  assert.equal(f.calls.spawn.find(call=>call.requestId==='reviewed-new').accountId,B);await f.finish('reviewed-new');const result=await f.record(first,'reviewed-new');
  assert.equal(result.status,'completed');assert.equal(result.handoffFrom,'stale-1');assert.equal(result.accountId,B);assert.equal((await f.persisted(first,'stale-1')).dispatch,'not-started');
  assert.equal(f.calls.spawn.filter(call=>call.requestId).length,1);assert.deepEqual(f.calls.activate,[]);assertNoUnexpectedStops(f);
 }finally{await lease?.release();await f.close();}
});

test('stopping two of four real DesktopControllers cancels only their wait; shared worker finishes naturally and no stopped room is woken',async()=>{
 const f=await fixture(),[a,b,c,d]=f.rooms;
 try{
  await a.gateway.bridge.start(job('stop-a-quota'));await f.started('stop-a-quota');await b.gateway.bridge.start(job('stop-b-natural'));await f.started('stop-b-natural');
  f.exhausted=true;await f.finish('stop-a-quota',true);await f.record(a,'stop-a-quota');
  await c.gateway.bridge.start(job('stop-c-unsent',{accountId:A}));assert.equal((await f.record(c,'stop-c-unsent')).dispatch,'not-started');
  const query=await d.gateway.bridge.accounts();assert.equal(query.scheduling.status,'waiting');
  for(const room of [a,c,d]){room.block();room.end();}
  await c.c.stop();await d.c.stop();
  assert.equal(c.c.state.status,'interrupted');assert.equal(d.c.state.status,'interrupted');assert.ok(f.children.has('stop-b-natural'));assert.deepEqual(f.calls.activate,[]);assertNoUnexpectedStops(f);
  await f.finish('stop-b-natural');await f.record(b,'stop-b-natural');b.end();
  await until(()=>a.deliveries().length===1&&b.deliveries().length===1,'unstopped original rooms recover');await tick();
  const ready=f.events.filter(event=>event.status==='ready');assert.equal(ready.length,1);assert.equal(ready[0].parentId,a.id);assert.deepEqual(f.calls.activate,[B]);
  assert.equal(c.deliveries().length,0);assert.equal(d.deliveries().length,0);assert.equal(c.goal.status,'blocked');assert.equal(d.goal.status,'blocked');
  assert.equal(c.calls.some(call=>call.method==='thread/goal/set'),false);assert.equal(d.calls.some(call=>call.method==='thread/goal/set'),false);
  a.end();b.end();await new Promise(resolve=>setTimeout(resolve,1250));assert.equal(a.deliveries().length,1);assert.equal(b.deliveries().length,1);assert.equal(f.calls.spawn.filter(call=>call.requestId).length,2);assertNoUnexpectedStops(f);
 }finally{await f.close();}
});







test('four active rooms use pending tool waits through a shared drain; delivered results do not trigger duplicate goal turns',async()=>{
 const f=await fixture(),[a,b,c,d]=f.rooms;
 try{
  await a.gateway.bridge.start(job('a-event'));await f.started('a-event');await b.gateway.bridge.start(job('b-event'));await f.started('b-event');
  f.exhausted=true;await f.finish('a-event',true);
  await until(()=>a.c.state.workers.some(w=>w.requestId==='a-event'&&w.settled),'failed original settled');
  await c.gateway.bridge.start(job('c-event'));
  await until(()=>c.c.state.workers.some(w=>w.requestId==='c-event'&&w.settled),'unstarted settled');
  const info=await d.gateway.bridge.accounts();assert.equal(info.scheduling.status,'waiting');
  const ids=['a-event','c-event',info.scheduling.waitId],rooms=[a,c,d];let completed=0;
  const pending=rooms.map((room,i)=>room.gateway.bridge.wait({requestId:ids[i]}).then(result=>{completed++;room.gateway.bridge.resultReady({requestId:ids[i]},result);return result;}));
  await tick();assert.equal(completed,0);assert.deepEqual(f.calls.activate,[]);
  await f.finish('b-event');const results=await Promise.all(pending);
  assert.equal(completed,3);assert(results.every(r=>r.scheduling.status==='ready'&&r.scheduling.accountId===B));
  assert.equal(results[1].dispatch,'not-started');assert.equal(results[2].dispatch,'not-started');
  assert.deepEqual(f.calls.activate,[B]);assert.equal(f.calls.spawn.filter(r=>r.requestId).length,2);
  for(const room of rooms)room.end();await tick();
  assert(rooms.every(room=>room.goal.status==='active'&&room.deliveries().length===0),'one still-active native turn receives the result, not a second notification turn');
  assert(rooms.every(room=>room.c.state.notices.every(n=>n.kind!=='gemini-handoff'||n.resolved)),'already read ready notice is cleared');
  assertNoUnexpectedStops(f);
 }finally{await f.close();}
});
