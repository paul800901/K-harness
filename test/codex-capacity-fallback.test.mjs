import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';
const LUNA='gpt-6-luna',SOL='gpt-6.1-sol';
const catalog=[LUNA,SOL].map(model=>({model,displayName:model,hidden:false,supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image'],serviceTiers:[{id:'priority',name:'Fast',description:'Fast service'}]}));
const overload={message:'Selected model is at capacity.',codexErrorInfo:'serverOverloaded'};
async function fixture({goal=null,model=LUNA,serviceTier='default',immediateFailure=false,startAck=null,flash=false}={}){
 await mkdir('.runtime/tests',{recursive:true});const root=await mkdtemp(path.resolve('.runtime/tests/capacity-'));
 await saveMainSession(root,{threadId:'parent',model,effort:'high',serviceTier,accessMode:'read-only',workspace:root});
 const calls=[],turns=[];let nativeGoal=goal,opts,closed,turnNumber=0,gateway,bridgeOptions,flashRecord;
 const emit=(method,params={})=>opts.onEvent({method,params:{threadId:'parent',...params}});
 const finish=(error=overload,id=turns.at(-1)?.id)=>{const t=turns.find(t=>t.id===id);if(t){t.status=error?'failed':'completed';t.error=error;}emit('turn/completed',{turn:{id,status:error?'failed':'completed',error}});};
 const hostFactory=o=>{opts=o;return{closed:new Promise(r=>closed=r),close:async()=>closed(),notify(){},waitForMcp:async()=>{},request:async(method,p={})=>{
  calls.push({method,p});
  if(method==='model/list')return{data:catalog,nextCursor:null};
  if(method==='account/read')return{account:{type:'chatgpt'}};
  if(method==='thread/read')return{thread:{id:p.threadId,status:{type:turns.at(-1)?.status==='inProgress'?'active':'idle'},turns:structuredClone(turns)}};
  if(method==='thread/start'||method==='thread/resume')return{thread:{id:'parent'}};
  if(method==='thread/goal/get')return{goal:structuredClone(nativeGoal)};
  if(method==='thread/goal/set'){nativeGoal={...nativeGoal,...p};emit('thread/goal/updated',{goal:nativeGoal});return{goal:nativeGoal};}
  if(method==='thread/backgroundTerminals/list')return{data:[],nextCursor:null};
  if(method==='turn/start'){
   if(p.toolOutput)await new Promise(r=>setImmediate(r));
   const id=`turn-${++turnNumber}`,item={type:'userMessage',id:`u-${id}`,content:p.input};turns.push({id,status:'inProgress',items:[item]});
   emit('turn/started',{turn:{id}});emit('item/completed',{turnId:id,item});
   if(immediateFailure||flash&&p.toolOutput)finish(overload,id);
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
 return{c,root,calls,turns,emit,finish,make,get bridge(){return gateway.bridge;},finishFlash:()=>{flashRecord={...flashRecord,status:'completed',settled:true,output:'fake worker result'};bridgeOptions.onChange(flashRecord);},setGoal:g=>{nativeGoal=g;emit('thread/goal/updated',{goal:g});}};
}
async function settle(c){for(let i=0;i<300&&c.state.completionPending;i++)await new Promise(r=>setTimeout(r,5));assert.equal(c.state.completionPending,false);}


for(const model of [LUNA,SOL])test(model+' capacity failure remains native: no model change, goal revival or extra submission',async()=>{
 const goal={objective:'fake unfinished task',status:'active',createdAt:1,tokenBudget:999,tokensUsed:17};const f=await fixture({model,goal,serviceTier:'priority'});
 try{await f.c.send({text:'original task'});const before=f.calls.length;f.setGoal({...goal,status:'blocked'});f.finish();await settle(f.c);assert.equal(f.c.state.status,'failed');assert.equal(f.c.state.model,model);assert.equal(f.c.state.effort,'high');assert.equal(f.c.state.serviceTier,'priority');assert.equal(f.c.state.modelChanges.length,0);assert.equal(f.c.state.goal.status,'blocked');assert(!f.calls.some(x=>x.method==='thread/goal/set'));assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert(!f.calls.slice(before).some(x=>x.method==='model/list'));const saved=(await listMainSessions(f.root)).sessions[0];assert.equal(saved.model,model);assert.equal(saved.modelChanges.length,0);}finally{await f.c.close();}
});
for(const code of ['usageLimitExceeded','rateLimitExceeded','unauthorized',{responseStreamDisconnected:{httpStatusCode:null}},'other'])test('terminal '+JSON.stringify(code)+' never causes a K retry',async()=>{
 const f=await fixture();try{await f.c.send({text:'x'});const error={...overload,codexErrorInfo:code};f.finish(error);await settle(f.c);assert.deepEqual(f.c.state.turnError.error,error);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.c.state.model,LUNA);}finally{await f.c.close();}
});
for(const model of [LUNA,SOL])test(model+' forwards native repeated retry events and waits for native completion',async()=>{
 const f=await fixture({model});try{await f.c.send({text:'x'});for(let i=1;i<=5;i++)f.emit('error',{turnId:'turn-1',willRetry:true,error:{message:'Reconnecting... '+i+'/5',codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:null}}}});assert.equal(f.c.state.busy,true);assert.equal(f.c.state.status,'working');assert.equal(f.c.state.turnError,null);assert.equal(f.c.state.notices.at(-1).message,'Reconnecting... 5/5');assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);f.finish(null);await settle(f.c);assert.equal(f.c.state.status,'completed');assert(f.c.state.notices.filter(n=>n.willRetry).every(n=>n.resolved));assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);}finally{await f.c.close();}
});
test('native capacity metadata and partial tool results survive; only explicit goal resume changes status',async()=>{
 const goal={objective:'fake goal',status:'active',createdAt:1,tokenBudget:999,tokensUsed:17,timeUsedSeconds:30};const f=await fixture({goal});
 try{await f.c.send({text:'remaining work'});f.emit('item/completed',{turnId:'turn-1',item:{id:'partial-tool',type:'commandExecution',command:'fake action',status:'completed',aggregatedOutput:'saved result'}});const error={...overload,additionalDetails:'opaque details',requestId:'fake-request-id'};f.emit('error',{turnId:'turn-1',willRetry:false,error});f.setGoal({...goal,status:'blocked'});f.finish(error);await settle(f.c);assert.deepEqual(f.c.state.turnError,{threadId:'parent',turnId:'turn-1',status:'failed',error});assert.deepEqual(f.c.state.notices.at(-1).error,error);assert(f.c.state.tools.some(t=>t.id==='partial-tool'&&t.output==='saved result'));assert(!f.calls.some(x=>x.method==='thread/goal/set'));await f.c.goal({status:'active',resumeOnly:true});assert.deepEqual(f.calls.find(x=>x.method==='thread/goal/set').p,{threadId:'parent',status:'active'});assert.equal(f.c.state.goal.tokensUsed,17);assert.equal(f.c.state.goal.tokenBudget,999);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);}finally{await f.c.close();}
});
for(const status of ['paused','complete','budgetLimited','usageLimited'])test('capacity leaves native goal '+status+' untouched',async()=>{
 const f=await fixture({goal:{objective:'x',createdAt:1,status}});try{await f.c.send({text:'x'});f.finish();await settle(f.c);assert.equal(f.c.state.goal.status,status);assert(!f.calls.some(x=>x.method==='thread/goal/set'));assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);}finally{await f.c.close();}
});
test('native terminal failure before start acknowledgement never starts another turn',async()=>{
 const f=await fixture({immediateFailure:true});try{await f.c.send({text:'x'});await settle(f.c);assert.equal(f.c.state.status,'failed');assert.equal(f.c.state.busy,false);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.c.state.model,LUNA);}finally{await f.c.close();}
});
test('stop before send acknowledgement does not interrupt the already failed turn or revive it',async()=>{
 let release;const f=await fixture({immediateFailure:true,startAck:new Promise(r=>release=r)});try{const sending=f.c.send({text:'x'});await new Promise(r=>setTimeout(r,20));const stopping=f.c.stop();release();await sending;await stopping;await settle(f.c);assert.equal(f.c.state.status,'interrupted');assert.equal(f.c.state.turnError,null);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.calls.filter(x=>x.method==='turn/interrupt').length,0);}finally{await f.c.close();}
});
test('manual continuation after reopen adds exactly one user turn, with no automatic historical failure alert',async()=>{
 const f=await fixture();try{await f.c.send({text:'x'});f.finish();await settle(f.c);await f.c.close();const reopened=f.make();try{await reopened.open({threadId:'parent',model:LUNA});assert.equal(reopened.state.status,'ready');assert.equal(reopened.state.turnError,null);assert.equal(reopened.state.error,null);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);await reopened.send({text:'inspect existing results and continue'});assert.equal(f.calls.filter(x=>x.method==='turn/start').length,2);f.finish(null);await settle(reopened);}finally{await reopened.close();}}finally{await f.c.close();}
});
test('failed delivery of a worker completion is not replayed or escalated',async()=>{
 const f=await fixture({flash:true});try{await f.c.send({text:'original'});await f.bridge.start({requestId:'fake-flash',model:'gemini-3.8-flash',effort:'low',task:'fake worker'});f.finishFlash();f.finish(null);await settle(f.c);const starts=f.calls.filter(x=>x.method==='turn/start');assert.equal(starts.length,2);assert.equal(starts.filter(x=>x.p.toolOutput).length,1);assert.equal(f.c.state.status,'failed');assert.equal(f.c.state.model,LUNA);assert.equal(f.c.state.modelChanges.length,0);}finally{await f.c.close();}
});
