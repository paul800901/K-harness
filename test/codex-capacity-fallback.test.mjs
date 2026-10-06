import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';
const LUNA='gpt-6-luna',SOL='gpt-6.1-sol';
const catalog=[LUNA,SOL].map(model=>({model,displayName:model,hidden:false,supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image']}));
const overload={message:'Selected model is at capacity.',codexErrorInfo:'serverOverloaded'};
async function fixture({goal=null,models=catalog,model=LUNA,failStart=false,immediateFailure=false,replyLost=false,solError=null,startAck=null,flash=false}={}){
 await mkdir('.runtime/tests',{recursive:true});const root=await mkdtemp(path.resolve('.runtime/tests/capacity-'));
 await saveMainSession(root,{threadId:'parent',model,effort:'high',accessMode:'read-only',workspace:root});
 const calls=[],turns=[];let nativeGoal=goal,opts,gate=null,closed,turnNumber=0,gateway,bridgeOptions,flashRecord;
 const emit=(method,params={})=>opts.onEvent({method,params:{threadId:'parent',...params}});
 const finish=(error=overload,id=turns.at(-1)?.id)=>{const t=turns.find(t=>t.id===id);if(t){t.status=error?'failed':'completed';t.error=error;}emit('turn/completed',{turn:{id,status:error?'failed':'completed',error}});};
 const hostFactory=o=>{opts=o;return{closed:new Promise(r=>closed=r),close:async()=>closed(),notify(){},waitForMcp:async()=>{},request:async(method,p={})=>{
  calls.push({method,p});
  if(method==='model/list'){if(gate)await gate;return{data:models,nextCursor:null};}
  if(method==='account/read')return{account:{type:'chatgpt'}};
  if(method==='thread/read')return{thread:{id:p.threadId,status:{type:turns.at(-1)?.status==='inProgress'?'active':'idle'},turns:structuredClone(turns)}};
  if(method==='thread/start'||method==='thread/resume')return{thread:{id:'parent'}};
  if(method==='thread/goal/get')return{goal:structuredClone(nativeGoal)};
  if(method==='thread/goal/set'){nativeGoal={...nativeGoal,...p};emit('thread/goal/updated',{goal:nativeGoal});return{goal:nativeGoal};}
  if(method==='thread/backgroundTerminals/list')return{data:[],nextCursor:null};
  if(method==='turn/start'){
   if(failStart&&p.model===SOL)throw Error('transport lost; unknown');
   if(p.toolOutput)await new Promise(r=>setImmediate(r));
   const id=`turn-${++turnNumber}`,item={type:'userMessage',id:`u-${id}`,content:p.input};turns.push({id,status:'inProgress',items:[item]});
   emit('turn/started',{turn:{id}});emit('item/completed',{turnId:id,item});
   if(immediateFailure||p.model===SOL||flash&&p.toolOutput)finish(p.model===SOL?solError:overload,id);
   if(replyLost&&p.model===SOL)throw Error('reply lost after native event');
   if(startAck&&p.model===LUNA)await startAck;
   return{turn:{id}};
  }
  if(method==='turn/interrupt'&&turns.find(t=>t.id===p.turnId)?.status!=='inProgress')throw Error('cannot interrupt a finished turn');
  return{};
 }};};
 const make=()=>createDesktopController({root,hostFactory,executable:'fake',bridgeFactory:async o=>{bridgeOptions=o;return{
  start:async args=>{flashRecord={...args,provider:'gemini',parentId:o.parentId,status:'running',settled:false,output:''};o.onChange(flashRecord);return flashRecord;},
  list:async()=>flashRecord?[structuredClone(flashRecord)]:[],close:async()=>{},
 };},gatewayFactory:async o=>{gateway=o;return{mcpConfig:{mcpServers:{k_gemini:{url:'http://127.0.0.1:1/fake',headers:{Authorization:'fake'}}}},close:async()=>{}};}});
 const c=make();await c.open({threadId:'parent',model});
 return{c,root,calls,turns,emit,finish,make,get bridge(){return gateway.bridge;},finishFlash:()=>{flashRecord={...flashRecord,status:'completed',settled:true,output:'fake worker result'};bridgeOptions.onChange(flashRecord);},setGoal:g=>{nativeGoal=g;emit('thread/goal/updated',{goal:g});},gate:p=>gate=p};
}
async function settle(c){for(let i=0;i<300&&c.state.completionPending;i++)await new Promise(r=>setTimeout(r,5));assert.equal(c.state.completionPending,false);}

test('capacity switches same native thread to Sol medium once; no prompt replay, permissions and model history survive reopen',async()=>{
 const f=await fixture();try{
  await f.c.send({text:'original unique task'});f.finish();await settle(f.c);
  const starts=f.calls.filter(x=>x.method==='turn/start');assert.equal(starts.length,2);const p=starts[1].p;
  assert.equal(p.model,SOL);assert.equal(p.effort,'medium');assert.equal(p.threadId,'parent');assert.equal(p.sandboxPolicy.type,'readOnly');assert(!JSON.stringify(p.input).includes('original unique task'));assert.match(p.input[0].text,/不可重送/);
  assert.equal(f.c.state.model,SOL);assert.equal(f.c.state.effort,'medium');assert.equal(f.c.state.busy,false);assert.equal(f.c.state.modelChanges.length,1);
  f.finish(overload,'turn-1');await settle(f.c);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,2);
  const saved=(await listMainSessions(f.root)).sessions[0];assert.equal(saved.modelChanges[0].reason,'capacity');assert.equal(saved.modelChanges[0].toEffort,'medium');
  await f.c.close();const reopened=f.make();try{await reopened.open({threadId:'parent',model:SOL});assert.equal(reopened.state.modelChanges[0].reason,'capacity');assert.equal(reopened.state.effort,'medium');assert.equal(reopened.state.messages.length,2);}finally{await reopened.close();}
 }finally{await f.c.close();}
});

test('goal overload resumes only prior active native goal, status-only after Sol override',async()=>{
 const goal={objective:'fake test goal',status:'active',createdAt:1,tokenBudget:999,tokensUsed:17};const f=await fixture({goal});
 try{await f.c.send({text:'x'});f.setGoal({...goal,status:'blocked'});f.finish();await settle(f.c);
 const resume=f.calls.findIndex(x=>x.method==='thread/goal/set');assert(resume>f.calls.findLastIndex(x=>x.method==='turn/start'));assert.deepEqual(f.calls[resume].p,{threadId:'parent',status:'active'});assert.equal(f.c.state.goal.tokensUsed,17);assert.equal(f.c.state.goal.tokenBudget,999);
 }finally{await f.c.close();}
});

for(const error of ['usageLimitExceeded','rateLimitExceeded','unauthorized','responseStreamDisconnected','other'])test(`does not fallback on ${error}`,async()=>{
 const f=await fixture();try{await f.c.send({text:'x'});f.finish({...overload,codexErrorInfo:error});await settle(f.c);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.c.state.model,LUNA);}finally{await f.c.close();}
});
for(const status of ['paused','complete','budgetLimited','usageLimited'])test(`does not resume goal changed to ${status}`,async()=>{
 const goal={objective:'x',createdAt:1,status:'active'};const f=await fixture({goal});try{await f.c.send({text:'x'});f.setGoal({...goal,status});f.finish();await settle(f.c);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.c.state.busy,false);}finally{await f.c.close();}
});
test('missing official Sol medium never escalates; transient retry error alone never triggers fallback',async()=>{
 const f=await fixture({models:[catalog[0]]});try{await f.c.send({text:'x'});f.emit('error',{turnId:'turn-1',willRetry:true,error:overload});assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);f.finish();await settle(f.c);assert.match(f.c.state.error,/未提供/);assert.equal(f.c.state.model,LUNA);assert.equal(f.c.state.busy,false);}finally{await f.c.close();}
});
test('unknown Sol delivery does not retry or claim a switch',async()=>{
 const f=await fixture({failStart:true});try{await f.c.send({text:'x'});f.finish();await settle(f.c);assert.equal(f.c.state.status,'uncertain');assert.equal(f.c.state.model,LUNA);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,2);}finally{await f.c.close();}
});
test('stop during fallback preparation cancels handoff',async()=>{
 const f=await fixture();try{await f.c.send({text:'x'});let release;f.gate(new Promise(r=>release=r));f.finish();await new Promise(r=>setTimeout(r,15));const stopped=f.c.stop();release();await stopped;await settle(f.c);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.c.state.status,'interrupted');}finally{await f.c.close();}
});
test('terminal failure before original send ack still switches exactly once',async()=>{
 const f=await fixture({immediateFailure:true});try{await f.c.send({text:'x'});await settle(f.c);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,2);assert.equal(f.c.state.model,SOL);assert.equal(f.c.state.effort,'medium');assert.equal(f.c.state.status,'completed');}finally{await f.c.close();}
});
test('other primary model and child failures never start fallback',async()=>{
 const f=await fixture({model:SOL});try{await f.c.send({text:'x'});f.emit('turn/completed',{threadId:'child',turn:{id:'child-turn',status:'failed',error:overload}});f.finish();await settle(f.c);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);}finally{await f.c.close();}
});

test('Sol native failure is not cleared by its start acknowledgement and never climbs further',async()=>{
 const f=await fixture({solError:overload});try{await f.c.send({text:'x'});f.finish();await settle(f.c);assert.equal(f.c.state.model,SOL);assert.equal(f.c.state.status,'failed');assert.equal(f.c.state.error,overload.message);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,2);}finally{await f.c.close();}
});
test('native start proof persists Sol even if RPC reply is lost; never resends',async()=>{
 const f=await fixture({replyLost:true});try{await f.c.send({text:'x'});f.finish();await settle(f.c);assert.equal(f.c.state.model,SOL);const saved=(await listMainSessions(f.root)).sessions[0];assert.equal(saved.model,SOL);assert.equal(saved.effort,'medium');assert.equal(f.calls.filter(x=>x.method==='turn/start').length,2);}finally{await f.c.close();}
});
test('stop before original send ack cannot resurrect or interrupt an already completed capacity turn',async()=>{
 let release;const startAck=new Promise(r=>release=r);const f=await fixture({immediateFailure:true,startAck});try{
  const send=f.c.send({text:'x'});while(!f.turns.length)await new Promise(r=>setImmediate(r));
  const stopped=f.c.stop();release();await Promise.all([send,stopped]);await settle(f.c);
  assert.equal(f.c.state.status,'interrupted');assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.calls.filter(x=>x.method==='turn/interrupt').length,0);
 }finally{await f.c.close();}
});
test('overload event arriving after acknowledged stop never restarts the main agent',async()=>{
 const f=await fixture();try{await f.c.send({text:'x'});await f.c.stop();f.finish();await settle(f.c);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.c.state.model,LUNA);}finally{await f.c.close();}
});

test('capacity failure during Flash completion delivery continues once without replaying worker or its result',async()=>{
 const f=await fixture({flash:true});try{
  await f.c.send({text:'fake original task'});
  await f.bridge.start({requestId:'fake-flash',model:'gemini-3.8-flash',effort:'low',task:'fake worker'});
  f.finishFlash();f.finish(null);await settle(f.c);
  const starts=f.calls.filter(x=>x.method==='turn/start');assert.equal(starts.length,3);
  assert.equal(starts.filter(x=>x.p.toolOutput).length,1);assert.equal(starts[2].p.model,SOL);assert.equal(starts[2].p.effort,'medium');
  assert.equal(starts[2].p.toolOutput,undefined);assert(!JSON.stringify(starts[2].p.input).includes('fake worker result'));
  assert.equal(f.c.state.status,'completed');assert.equal(f.c.state.model,SOL);
  const saved=(await listMainSessions(f.root)).sessions[0];assert.equal(saved.model,SOL);assert.equal(saved.workerNotifications['fake-flash'],'delivery-attempted');
 }finally{await f.c.close();}
});
