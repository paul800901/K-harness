import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {listMainSessions} from '../src/main-sessions.mjs';

async function fixture({reject,history=[]}={}){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'native-wakeup-')),calls=[],children=new Map();let hooks,close,turn=0,readGate,rejection=reject,sendGate,readMode;
 const host={closed:new Promise(r=>close=r),notify(){},waitForMcp:async()=>{},close:async()=>close(),async request(method,p){
  calls.push({method,p});
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='model/list')return {data:[{model:'gpt-6-astra',supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'}]};
  if(method==='thread/start'||method==='thread/resume')return {thread:{id:p.threadId??'parent'}};
  if(method==='thread/backgroundTerminals/list')return {data:[]};
  if(method==='thread/turns/list'&&children.has(p.threadId))return {data:readMode==='missing'?[]:readMode==='older'?[{id:'older-turn',status:'completed'}]:structuredClone(children.get(p.threadId).turns),nextCursor:null};
  if(method==='thread/read'){
   if(readGate&&children.has(p.threadId))await readGate;
   if(children.get(p.threadId)?.error||readMode==='throw'&&children.has(p.threadId))throw Error('read failed');
   if(readMode&&children.has(p.threadId))return {thread:{...structuredClone(children.get(p.threadId)),turns:undefined,historyMode:'paginated'}};
   return {thread:structuredClone(children.get(p.threadId)??{id:p.threadId,cwd:root,status:{type:'idle'},turns:history})};
  }
  if(method==='turn/start'){
   if(p.toolOutput&&rejection)throw rejection;
   const id=`parent-turn-${++turn}`;emit('turn/started','parent',{turn:{id}});if(!p.toolOutput&&sendGate)await sendGate;return {turn:{id}};
  }
  if(method==='turn/interrupt'){
   if(p.threadId==='parent')emit('turn/completed','parent',{turn:{id:p.turnId,status:'interrupted'}});
   else {const child=children.get(p.threadId);child.status={type:'idle'};child.turns.at(-1).status='interrupted';emit('turn/completed',p.threadId,{turn:{id:p.turnId,status:'interrupted'}});}
  }
  return {};
 }};
 const c=createDesktopController({root,executable:'fixture',hostFactory:o=>{hooks=o;host.closed=new Promise(r=>close=r);return host;}});
 const emit=(method,threadId,params)=>hooks.onEvent({method,params:{threadId,...params}});
 const child=(id='child',turnId='child-turn')=>{
  children.set(id,{id,parentThreadId:'parent',status:{type:'active'},turns:[{id:turnId,status:'inProgress',items:[]}]});
  emit('item/started','parent',{item:{type:'subAgentActivity',id:`spawn-${id}`,kind:'started',agentThreadId:id}});
  emit('turn/started',id,{turn:{id:turnId}});return id;
 };
 const terminal=(id='child',status='completed')=>{
  const row=children.get(id),last=row.turns.at(-1);row.status={type:'idle'};last.status=status;
  last.items=[{type:'agentMessage',text:'PRIVATE_REFUSAL_BODY',phase:'final_answer'}];
  emit('turn/completed',id,{turn:{id:last.id,status}});
 };
 const finish=()=>emit('turn/completed','parent',{turn:{id:`parent-turn-${turn}`,status:'completed'}});
 const tick=async()=>{await new Promise(r=>setTimeout(r,40));};
 const delivered=()=>calls.filter(call=>call.method==='turn/start'&&call.p.toolOutput);
 await c.open({model:'gpt-6-astra',effort:'high'});await c.send({text:'fake delegated work'});
 return {c,root,calls,children,emit,child,terminal,finish,tick,delivered,loseHost:()=>close(),setReadMode:value=>readMode=value,setReadGate:value=>readGate=value,setReject:value=>rejection=value,setSendGate:value=>sendGate=value};
}

test('idle native refusal/completed wakes once, using IDs not body and unchanged model/permissions',async()=>{
 const f=await fixture();try{
  f.child();f.finish();await f.tick();f.terminal();await f.tick();
  const [call]=f.delivered();assert.equal(f.delivered().length,1);assert.equal(call.p.threadId,'parent');
  assert.equal(call.p.toolOutput.name,'k_native_subagent_terminal');assert.equal(call.p.turnTrigger,'subagent');assert.deepEqual(call.p.input,[]);
  assert.match(call.p.toolOutput.output,/child-turn/);assert.match(call.p.toolOutput.output,/終止不等於交付成功/);assert.doesNotMatch(call.p.toolOutput.output,/PRIVATE_REFUSAL_BODY/);
  assert.equal(call.p.model,'gpt-6-astra');assert.equal(call.p.effort,'high');assert.equal(call.p.sandboxPolicy.type,'workspaceWrite');
  f.terminal();f.emit('item/completed','parent',{item:{id:'subagent-completed-child-turn',type:'subAgentActivity',agentThreadId:'child',kind:'completed'}});
  await f.c.workers();await f.tick();assert.equal(f.delivered().length,1);
  assert.equal((await listMainSessions(f.root)).sessions[0].workerNotifications['codex.child.child-turn'],'delivery-attempted');
  assert.equal(f.calls.some(x=>x.method==='turn/start'&&x.p.threadId==='child'),false);
 }finally{await f.c.close();}
});

for(const [status,expected] of [['failed','failed'],['interrupted','cancelled']])test(`native ${status} signals termination, never success`,async()=>{
 const f=await fixture();try{f.child();f.finish();await f.tick();f.terminal('child',status);await f.tick();
  assert.equal(f.delivered().length,1);assert.match(f.delivered()[0].p.toolOutput.output,new RegExp(`"status":"${expected}"`));
 }finally{await f.c.close();}
});

test('busy parent queues and merges two child terminals, irrespective of final-answer timing',async()=>{
 const f=await fixture();try{
  f.child('first','one');f.child('second','two');await f.tick();f.terminal('first');f.terminal('second');await f.tick();
  assert.equal(f.delivered().length,0);assert.equal(f.c.state.completionPending,true);
  f.finish();await f.tick();assert.equal(f.delivered().length,1);assert.match(f.delivered()[0].p.toolOutput.output,/one/);assert.match(f.delivered()[0].p.toolOutput.output,/two/);
 }finally{await f.c.close();}
});

test('partial output is preserved and terminal notification never claims task success',async()=>{
 const f=await fixture();try{const file=path.join(f.root,'partial.txt');await writeFile(file,'only a partial synthetic result');
  f.child();f.finish();await f.tick();f.terminal();await f.tick();assert.equal(f.delivered().length,1);
  assert.match(f.delivered()[0].p.toolOutput.output,/實際成果獨立核對/);assert.doesNotMatch(f.delivered()[0].p.toolOutput.output,/only a partial synthetic result/);
  assert.equal(await readFile(file,'utf8'),'only a partial synthetic result');
 }finally{await f.c.close();}
});

test('another room terminal cannot queue or wake this parent',async()=>{
 const f=await fixture();try{f.child();f.finish();await f.tick();
  f.emit('turn/completed','other-room',{turn:{id:'foreign-turn',status:'completed'}});await f.tick();assert.equal(f.delivered().length,0);
 }finally{await f.c.close();}
});

test('same child followup is a new terminal key, with one acceptance per turn',async()=>{
 const f=await fixture();try{f.child();f.finish();await f.tick();f.terminal();await f.tick();f.finish();await f.tick();
  f.child('child','followup-turn');await f.tick();f.terminal();await f.tick();assert.equal(f.delivered().length,2);
  assert.match(f.delivered()[1].p.toolOutput.output,/followup-turn/);
 }finally{await f.c.close();}
});

test('parent completion activity read winning the child-read race still wakes once',async()=>{
 const f=await fixture();try{f.child();f.finish();await f.tick();f.terminal();
  f.emit('item/started','parent',{item:{id:'subagent-completed-child-turn',type:'subAgentActivity',kind:'completed',agentThreadId:'child'}});
  f.emit('item/completed','parent',{item:{id:'subagent-completed-child-turn',type:'subAgentActivity',kind:'completed',agentThreadId:'child'}});
  await f.tick();assert.equal(f.delivered().length,1);
 }finally{await f.c.close();}
});

test('explicit stop suppresses child terminal even after the next user turn',async()=>{
 const f=await fixture();try{f.child();await f.tick();await f.c.stop();await f.tick();assert.equal(f.delivered().length,0);
  await f.c.send({text:'new work'});f.terminal();f.finish();await f.tick();assert.equal(f.delivered().length,0);
 }finally{await f.c.close();}
});

test('paused goal drops queued terminals; resuming does not revive old completion',async()=>{
 const f=await fixture();try{f.child();await f.tick();f.terminal();await f.tick();
  f.emit('thread/goal/updated','parent',{goal:{status:'paused'}});f.finish();await f.tick();assert.equal(f.delivered().length,0);
  f.emit('thread/goal/updated','parent',{goal:{status:'active'}});await f.c.send({text:'resume manually'});f.terminal();f.finish();await f.tick();assert.equal(f.delivered().length,0);
 }finally{await f.c.close();}
});

test('history and unarmed terminal replay never start an acceptance turn',async()=>{
 const f=await fixture({history:[{id:'old-parent',status:'completed',items:[{type:'subAgentActivity',id:'old',kind:'completed',agentThreadId:'old-child'}]}]});try{
  f.children.set('old-child',{parentThreadId:'parent',status:{type:'idle'},turns:[{id:'old-child-turn',status:'completed'}]});
  f.finish();await f.c.open({model:'gpt-6-astra',threadId:'parent'});
  f.emit('turn/completed','old-child',{turn:{id:'old-child-turn',status:'completed'}});await f.c.workers();await f.tick();assert.equal(f.delivered().length,0);
 }finally{await f.c.close();}
});

for(const reason of ['foreign','unreadable','wrong-turn'])test(`unverified ${reason} terminal does not wake parent`,async()=>{
 const f=await fixture();try{f.child();await f.tick();f.finish();await f.tick();
  if(reason==='foreign')f.children.get('child').parentThreadId='other-parent';
  if(reason==='unreadable')f.children.get('child').error=true;
  if(reason==='wrong-turn'){
   const row=f.children.get('child');row.status={type:'idle'};row.turns=[{id:'different-turn',status:'completed'}];
   f.emit('turn/completed','child',{turn:{id:'child-turn',status:'completed'}});
  }else f.terminal();
  await f.tick();assert.equal(f.delivered().length,0);assert.ok(f.c.state.notices.some(n=>n.kind==='worker-attention'));
 }finally{f.children.get('child').error=false;f.children.get('child').parentThreadId='parent';await f.c.close();}
});

test('transport uncertainty is not retried and stop reconciles own parent',async()=>{
 const f=await fixture({reject:Error('transport lost')});try{f.child();f.finish();await f.tick();f.terminal();await f.tick();
  assert.equal(f.c.state.status,'uncertain');f.terminal();await f.c.workers();await f.tick();assert.equal(f.delivered().length,1);
  await f.c.stop();assert.equal(f.c.state.status,'interrupted');
 }finally{await f.c.close();}
});

test('confirmed protocol rejection from an active goal queues until that turn ends',async()=>{
 const error=Error('active turn won');error.protocolMessage='turn already active';
 const f=await fixture({reject:error});try{f.child();f.finish();await f.tick();f.emit('thread/goal/updated','parent',{goal:{status:'active'}});f.terminal();await f.tick();
  assert.equal(f.delivered().length,1);assert.equal(f.c.state.status,'completed');
  f.setReject(null);f.emit('turn/started','parent',{turn:{id:'goal-turn'}});await f.tick();assert.equal(f.delivered().length,1);
  f.emit('turn/completed','parent',{turn:{id:'goal-turn',status:'completed'}});await f.tick();assert.equal(f.delivered().length,2);
 }finally{await f.c.close();}
});

test('terminal queued before a user send acknowledgement drains after submission clears',async()=>{
 const f=await fixture();let release;try{f.finish();await f.tick();f.setSendGate(new Promise(r=>release=r));const send=f.c.send({text:'next delegated work'});
  await f.tick();f.child();f.terminal();f.finish();await f.tick();assert.equal(f.delivered().length,0);
  release();await send;await f.tick();assert.equal(f.delivered().length,1);
 }finally{release?.();await f.c.close();}
});

test('delayed read cannot revive a stopped terminal on reopening the room',async()=>{
 const f=await fixture();let release;try{f.child();await f.tick();f.finish();await f.tick();
  f.setReadGate(new Promise(r=>release=r));f.terminal();await new Promise(setImmediate);
  const stop=f.c.stop();release();await stop;await f.tick();
  await f.c.open({model:'gpt-6-astra',threadId:'parent'});await f.tick();assert.equal(f.delivered().length,0);
 }finally{release?.();await f.c.close();}
});

for(const mode of ['missing','throw'])test('later exact native settlement recovers a consumed '+mode+' terminal once',async()=>{const f=await fixture();try{f.child();await f.tick();f.finish();await f.tick();f.setReadMode(mode);f.terminal();await f.c.workers();await f.tick();assert.equal(f.delivered().length,0);assert.equal(f.c.state.completionPending,false,'Unknown terminal is attention, not running work');f.setReadMode('ready');await f.c.workers();await f.tick();assert.equal(f.c.state.workers[0].settled,true);assert.equal(f.delivered().length,1);f.terminal();await f.c.workers();await f.tick();assert.equal(f.delivered().length,1);}finally{f.setReadMode('ready');await f.c.close();}});

for(const action of ['pause','stop','new-child-turn'])test('unconfirmed native terminal is invalidated by '+action,async()=>{const f=await fixture();try{f.child();await f.tick();f.finish();await f.tick();f.setReadMode('missing');f.terminal();await f.c.workers();await f.tick();if(action==='pause')f.emit('thread/goal/updated','parent',{goal:{status:'paused'}});if(action==='new-child-turn')f.emit('turn/started','child',{turn:{id:'new-child-turn'}});f.setReadMode('ready');if(action==='stop')await f.c.stop();await f.c.workers();await f.tick();assert.equal(f.delivered().length,0);assert.equal(f.c.state.completionPending,false);}finally{f.setReadMode('ready');await f.c.close();}});

test('recovered terminal stays queued while native goal is busy and delivers once after that turn',async()=>{const f=await fixture();try{f.child();await f.tick();f.finish();await f.tick();f.setReadMode('missing');f.terminal();await f.c.workers();await f.tick();f.emit('thread/goal/updated','parent',{goal:{status:'active'}});f.emit('turn/started','parent',{turn:{id:'goal-turn'}});f.setReadMode('ready');await f.c.workers();await f.tick();assert.equal(f.delivered().length,0);assert.equal(f.c.state.completionPending,true);f.emit('turn/completed','parent',{turn:{id:'goal-turn',status:'completed'}});await f.c.workers();await f.tick();assert.equal(f.delivered().length,1);}finally{f.setReadMode('ready');await f.c.close();}});

test('recovered terminal after failed parent never restarts the failed parent',async()=>{const f=await fixture();try{f.child();await f.tick();f.setReadMode('missing');f.terminal();await f.c.workers();await f.tick();f.emit('turn/completed','parent',{turn:{id:'parent-turn-1',status:'failed',error:{message:'synthetic terminal failure'}}});f.setReadMode('ready');await f.c.workers();await f.tick();assert.equal(f.c.state.status,'failed');assert.equal(f.delivered().length,0);}finally{f.setReadMode('ready');await f.c.close();}});

const realTestTimeout=globalThis.setTimeout;
const flushRecheck=async()=>{await new Promise(r=>realTestTimeout(r,40));};
const waitRecheck=async predicate=>{for(let i=0;i<100&&!predicate();i++)await flushRecheck();assert(predicate(),'Expected observable completion did not arrive');};
for(const mode of ['missing','throw','older'])test('autonomous exact native reconciliation after '+mode+' needs no event or manual read',async t=>{
 const f=await fixture();try{
  f.child();await f.tick();f.finish();await f.tick();t.mock.timers.enable({apis:['setTimeout']});
  f.setReadMode(mode);f.terminal();await flushRecheck();assert.equal(f.delivered().length,0);assert.equal(f.c.state.completionPending,false);
  for(const ms of [1000,2000]){t.mock.timers.tick(ms);await flushRecheck();assert.equal(f.delivered().length,0);}
  f.setReadMode('ready');t.mock.timers.tick(4000);await flushRecheck();assert.equal(f.delivered().length,1,JSON.stringify({status:f.c.state.status,busy:f.c.state.busy,pending:f.c.state.completionPending,workers:f.c.state.workers.map(w=>({id:w.threadId,settled:w.settled,turn:w.turnId})),calls:f.calls.slice(-10).map(x=>({method:x.method,thread:x.p.threadId}))}));
  t.mock.timers.tick(120000);await flushRecheck();assert.equal(f.delivered().length,1);assert.equal(f.calls.some(x=>x.method==='turn/start'&&x.p.threadId==='child'),false);
 }finally{t.mock.timers.reset();f.setReadMode('ready');await f.c.close();}
});
for(const action of ['pause','stop','new-child-turn','close','host-loss','reopen'])test('autonomous terminal recheck cancels on '+action,async t=>{
 const f=await fixture();try{
  f.child();await f.tick();f.finish();await f.tick();t.mock.timers.enable({apis:['setTimeout']});f.setReadMode('missing');f.terminal();await flushRecheck();
  f.setReadMode('ready');
  if(action==='pause')f.emit('thread/goal/updated','parent',{goal:{status:'paused'}});
  if(action==='stop')await f.c.stop();
  if(action==='new-child-turn')f.emit('turn/started','child',{turn:{id:'new-child-turn'}});
  if(action==='close')await f.c.close();
  if(action==='host-loss'){f.loseHost();await flushRecheck();}
  if(action==='reopen')await f.c.open({model:'gpt-6-astra',threadId:'parent'});
  await flushRecheck();const reads=f.calls.filter(x=>x.method==='thread/read').length;t.mock.timers.tick(120000);await flushRecheck();
  assert.equal(f.calls.filter(x=>x.method==='thread/read').length,reads);assert.equal(f.delivered().length,0);
 }finally{t.mock.timers.reset();f.setReadMode('ready');await f.c.close();}
});
test('autonomous terminal probe never overlaps itself or scans historical children while UNKNOWN',async t=>{
 const f=await fixture();let release;try{
  for(let i=0;i<205;i++){const id='historical-'+i;f.children.set(id,{id,parentThreadId:'parent',status:{type:'idle'},turns:[{id:id+'-turn',status:'completed'}]});f.emit('item/completed','parent',{item:{id:'old-'+id,type:'subAgentActivity',kind:'completed',agentThreadId:id}});}
  f.child();await f.tick();f.finish();await f.tick();t.mock.timers.enable({apis:['setTimeout']});f.setReadMode('missing');f.terminal();await flushRecheck();
  const start=f.calls.length;f.setReadGate(new Promise(r=>release=r));t.mock.timers.tick(1000);await flushRecheck();t.mock.timers.tick(120000);await flushRecheck();
  const probes=f.calls.slice(start).filter(x=>x.method==='thread/read');assert.equal(probes.length,1);assert.equal(probes[0].p.threadId,'child');
  f.setReadMode('ready');f.setReadGate(null);release();await flushRecheck();assert.equal(f.delivered().length,1);
 }finally{release?.();t.mock.timers.reset();f.setReadMode('ready');f.setReadGate(null);await f.c.close();}
});
test('autonomous terminal confirmation never restarts a failed parent or retries attempted uncertain delivery',async t=>{
 for(const failed of [true,false]){
  const f=await fixture({reject:failed?undefined:Error('synthetic transport lost')});try{
   f.child();await f.tick();if(failed)f.emit('turn/completed','parent',{turn:{id:'parent-turn-1',status:'failed',error:{message:'synthetic terminal failure'}}});else f.finish();await f.tick();
   t.mock.timers.enable({apis:['setTimeout']});f.setReadMode('missing');f.terminal();await flushRecheck();f.setReadMode('ready');t.mock.timers.tick(1000);await flushRecheck();
   await waitRecheck(()=>f.c.state.status===(failed?'failed':'uncertain'));assert.equal(f.delivered().length,failed?0:1);assert.equal(f.c.state.status,failed?'failed':'uncertain');
   t.mock.timers.tick(120000);await flushRecheck();assert.equal(f.delivered().length,failed?0:1);
  }finally{t.mock.timers.reset();f.setReadMode('ready');if(f.c.state.status==='uncertain')await f.c.stop();await f.c.close();}
 }
});

test('UNKNOWN terminal rechecks back off to 30s without an attempt cutoff or running claim',async t=>{
 const f=await fixture();try{
  f.child();await f.tick();f.finish();await f.tick();t.mock.timers.enable({apis:['setTimeout']});f.setReadMode('missing');f.terminal();await flushRecheck();
  let count=f.calls.filter(x=>x.method==='thread/read'&&x.p.threadId==='child').length;
  for(const ms of [1000,2000,4000,8000,16000,30000,30000]){t.mock.timers.tick(ms-1);await flushRecheck();assert.equal(f.calls.filter(x=>x.method==='thread/read'&&x.p.threadId==='child').length,count);t.mock.timers.tick(1);await flushRecheck();assert.equal(f.calls.filter(x=>x.method==='thread/read'&&x.p.threadId==='child').length,++count);assert.equal(f.c.state.completionPending,false);assert.equal(f.delivered().length,0);}
  f.setReadMode('ready');t.mock.timers.tick(30000);await flushRecheck();await waitRecheck(()=>f.delivered().length===1);
 }finally{t.mock.timers.reset();f.setReadMode('ready');await f.c.close();}
});
test('normal worker read wins an in-flight terminal probe without double acceptance',async t=>{
 const f=await fixture();let release;try{
  f.child();await f.tick();f.finish();await f.tick();t.mock.timers.enable({apis:['setTimeout']});f.setReadMode('missing');f.terminal();await flushRecheck();
  f.setReadGate(new Promise(r=>release=r));t.mock.timers.tick(1000);await flushRecheck();f.setReadGate(null);f.setReadMode('ready');await f.c.workers();await flushRecheck();await waitRecheck(()=>f.delivered().length===1);
  release();await flushRecheck();t.mock.timers.tick(120000);await flushRecheck();assert.equal(f.delivered().length,1);
 }finally{release?.();t.mock.timers.reset();f.setReadGate(null);f.setReadMode('ready');await f.c.close();}
});

test('UNKNOWN pending terminal cannot revive after pause then resume through timer or ordinary read',async t=>{
 const f=await fixture();try{
  f.child();await f.tick();f.finish();await f.tick();t.mock.timers.enable({apis:['setTimeout']});f.setReadMode('missing');f.terminal();await flushRecheck();
  assert.equal(f.delivered().length,0);assert(f.c.state.notices.some(n=>n.nativeTerminal));
  f.emit('thread/goal/updated','parent',{goal:{status:'paused'}});f.emit('thread/goal/updated','parent',{goal:{status:'active'}});f.setReadMode('ready');
  t.mock.timers.tick(120000);await flushRecheck();assert.equal(f.delivered().length,0);
  await f.c.workers();await flushRecheck();assert.equal(f.c.state.workers[0].settled,true);assert.equal(f.delivered().length,0);assert.equal(f.c.state.completionPending,false);
 }finally{t.mock.timers.reset();f.setReadMode('ready');await f.c.close();}
});
