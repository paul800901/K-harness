import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';

// Real K controller, fake native transport: no native process, login or model.
async function fixture(initialGoal=null){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'goal-provenance-')),calls=[];
 let connection,gateway,nativeGoal=initialGoal?structuredClone(initialGoal):null;
 const host={closed:new Promise(()=>{}),notify(){},waitForMcp:async()=>{},close:async()=>{},async request(method,params){
  calls.push({method,params:structuredClone(params)});
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='model/list')return {data:[{model:'gpt-6-astra',displayName:'Astra',hidden:false,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'}]};
  if(method==='thread/start')return {thread:{id:'goal-provenance-thread'}};
  if(method==='thread/read')return {thread:{turns:[]}};
  if(method==='thread/goal/get')return {goal:structuredClone(nativeGoal)};
  if(method==='thread/goal/set'){
   nativeGoal??={id:'same-goal',objective:'',status:'active',tokenBudget:null,tokensUsed:0,timeUsedSeconds:0};
   for(const key of ['objective','status','tokenBudget'])if(Object.hasOwn(params,key))nativeGoal[key]=params[key];
   return {goal:structuredClone(nativeGoal)};
  }
  if(method==='thread/goal/clear'){nativeGoal=null;return {cleared:true};}
  if(method==='config/read')return {config:{}};
  if(method==='windowsSandbox/readiness')return {status:'ready'};
  if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
  if(method==='account/rateLimits/read')return {};
  return {};
 }};
 const c=createDesktopController({root,executable:'never-spawn',hostFactory:options=>{connection=options;return host;},gatewayFactory:async options=>{
  gateway=options;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://127.0.0.1:1/never-connect',headers:{Authorization:'Bearer fake'}}}},close:async()=>{}};
 }});
 await c.open({model:'gpt-6-astra'});calls.length=0;
 return {c,calls,get gateway(){return gateway;},get nativeGoal(){return nativeGoal;},
  emit:(method,params)=>connection.onEvent({method,params:{threadId:c.state.threadId,...params}})};
}
const existing=status=>({id:'same-goal',objective:'existing objective',status,tokenBudget:500,tokensUsed:42,timeUsedSeconds:60});
const writes=f=>f.calls.filter(x=>['thread/goal/set','thread/goal/clear'].includes(x.method));
function noReplay(f){assert(!f.calls.some(x=>['turn/start','turn/steer','thread/compact/start','thread/fork'].includes(x.method)));}

test('human public goal set records user origin regardless of body origin',async()=>{
 const f=await fixture();try{
  await f.c.goal({objective:' first objective ',status:'paused',tokenBudget:500,origin:'automatic'});
  assert.deepEqual(writes(f),[{method:'thread/goal/set',params:{threadId:f.c.state.threadId,origin:'user',objective:'first objective',status:'paused',tokenBudget:500}}]);
  noReplay(f);
 }finally{await f.c.close();}
});

test('human public edit records user origin without changing goal state or accounting',async()=>{
 const f=await fixture(existing('paused'));try{
  await f.c.goal({objective:'edited objective',editOnly:true,expectedObjective:'existing objective'});
  assert.deepEqual(writes(f),[{method:'thread/goal/set',params:{threadId:f.c.state.threadId,origin:'user',objective:'edited objective'}}]);
  assert.deepEqual(f.nativeGoal,{...existing('paused'),objective:'edited objective'});noReplay(f);
 }finally{await f.c.close();}
});

for(const status of ['paused','blocked'])test(`human explicit resume of ${status} records user origin on the same goal`,async()=>{
 const f=await fixture(existing(status));try{
  await f.c.goal({status:'active',resumeOnly:true});
  assert.deepEqual(f.calls.map(x=>x.method),['thread/goal/get','thread/goal/set']);
  assert.deepEqual(writes(f)[0].params,{threadId:f.c.state.threadId,origin:'user',status:'active'});
  assert.deepEqual(f.nativeGoal,existing('active'));noReplay(f);
 }finally{await f.c.close();}
});

test('active resume is a read-only no-op; refresh sends no origin',async()=>{
 const f=await fixture(existing('active'));try{
  await f.c.goal({status:'active',resumeOnly:true,origin:'user'});await f.c.goal({refresh:true,origin:'user'});
  assert.deepEqual(f.calls,[{method:'thread/goal/get',params:{threadId:f.c.state.threadId}},{method:'thread/goal/get',params:{threadId:f.c.state.threadId}}]);
  assert.deepEqual(f.nativeGoal,existing('active'));noReplay(f);
 }finally{await f.c.close();}
});

test('human clear carries user origin without replay',async()=>{
 const f=await fixture(existing('paused'));try{
  await f.c.goal({clear:true});
  assert.deepEqual(writes(f),[{method:'thread/goal/clear',params:{threadId:f.c.state.threadId,origin:'user'}}]);
  assert.equal(f.nativeGoal,null);noReplay(f);
 }finally{await f.c.close();}
});

test('AI goal tools cannot claim user provenance and keep trusted main-turn checks',async()=>{
 const f=await fixture(existing('paused'));try{
  f.emit('turn/started',{turn:{id:'main-turn'}});
  const meta={'x-codex-turn-metadata':{thread_id:f.c.state.threadId,turn_id:'main-turn'}};
  await f.gateway.editGoal({objective:'AI edit',origin:'user'},meta);
  await f.gateway.resumeGoal({origin:'user'},meta);
  assert.deepEqual(writes(f).map(x=>x.params),[{threadId:f.c.state.threadId,origin:'automatic',objective:'AI edit'},{threadId:f.c.state.threadId,origin:'automatic',status:'active'}]);
  assert.deepEqual(f.nativeGoal,{...existing('active'),objective:'AI edit'});
  const before=f.calls.length;
  for(const bad of [{},{'x-codex-turn-metadata':{thread_id:'child',turn_id:'main-turn'}},{'x-codex-turn-metadata':{thread_id:f.c.state.threadId,turn_id:'old-turn'}}]){
   await assert.rejects(f.gateway.editGoal({objective:'forged',origin:'user'},bad),/目前主對話/);
   await assert.rejects(f.gateway.resumeGoal({origin:'user'},bad),/目前主對話/);
  }
  assert.equal(f.calls.length,before);noReplay(f);
  f.emit('turn/completed',{turn:{id:'main-turn',status:'completed'}});
 }finally{await f.c.close();}
});

for(const action of ['stop','close'])test(`existing ${action} pause remains lifecycle-only, not user authorization`,async()=>{
 const f=await fixture(existing('active'));try{
  await f.c[action]();
  const mutations=writes(f);assert.equal(mutations.length,1);
  assert.equal(mutations[0].params.status,'paused');
  assert.notEqual(mutations[0].params.origin,'user');
  assert([undefined,'automatic'].includes(mutations[0].params.origin));noReplay(f);
 }finally{await f.c.close();}
});

test('native failed/blocked notifications never initiate a K resume',async()=>{
 const f=await fixture(existing('blocked'));try{
  f.emit('turn/started',{turn:{id:'failed-turn'}});
  f.emit('turn/completed',{turn:{id:'failed-turn',status:'failed',error:{message:'fixture compact failed',codexErrorInfo:'other'}}});
  f.emit('thread/goal/updated',{goal:existing('blocked')});await new Promise(r=>setImmediate(r));
  assert.equal(f.c.state.status,'failed');assert.equal(f.c.state.error,'fixture compact failed');
  assert.equal(writes(f).length,0);noReplay(f);
 }finally{await f.c.close();}
});
