import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationController} from '../src/conversation-controller.mjs';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {scratchBase} from './scratch.mjs';

const base=scratchBase;
const sourceModel='gpt-source',targetModel='gpt-native-target';
const entry=(model,efforts,defaultReasoningEffort)=>({model,supportedReasoningEfforts:efforts.map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort});
async function fixture(){
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'fresh-target-'));
 const rows=[],calls=[];let nativeGoal=null,workerGate,workerFailure;let sequence=0,catalog=[entry(sourceModel,['medium','ultra'],'medium'),entry(targetModel,['low','high'],'low')],catalogGate;
 const c=createConversationController({root,sessionFactory:options=>{
  const row={id:null,hooks:null,gateway:null,turns:[],continue:options.onContinueConversation,settledEvents:[]};rows.push(row);let ended;
  const host={closed:new Promise(r=>ended=r),notify(){},close:async()=>ended(),async request(method,data){
   calls.push([method,data]);
   if(method==='model/list'){if(catalogGate){catalogGate.enter();await catalogGate.promise;}return {data:catalog};}
   if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='config/read')return {config:{}};
   if(method==='thread/start'){row.id=`native-${++sequence}`;return {thread:{id:row.id,turns:[]}};}
   if(method==='thread/goal/get')return {goal:nativeGoal};if(method==='thread/backgroundTerminals/list')return {data:[]};
   if(method==='thread/read'&&data.threadId==='settled-worker'){if(workerGate){workerGate.enter();await workerGate.promise;}if(workerFailure)throw workerFailure;return {thread:{id:'settled-worker',parentThreadId:rows.find(r=>r.id)?.id,status:{type:'idle'},turns:[{id:'settled-turn',status:'completed',items:[]}]}};}
   if(method==='thread/read'){const source=rows.find(r=>r.id===data.threadId);return {thread:{id:data.threadId,turns:source?.turns??[]}};}
   if(method==='turn/start'){const id=`turn-${row.id}`;row.hooks.onEvent({method:'turn/started',params:{threadId:row.id,turn:{id,status:'inProgress'}}});return {turn:{id}};}
   return {};
  }};
  row.owner=createDesktopController({...options,onConversationSettled:data=>{row.settledEvents.push(data);options.onConversationSettled?.(data);},hostFactory:hooks=>{if(!hooks.onEvent)return {...host,close:async()=>{}};row.hooks=hooks;return host;},gatewayFactory:async gateway=>{row.gateway=gateway;return {mcpConfig:{mcpServers:{k_gemini:{url:'http://fake/mcp',headers:{Authorization:'fake'}}}},close:async()=>{}};}});row.owner.state.provider='codex';return row.owner;
 }});
 const opened=await c.open({model:sourceModel,workspace:root,effort:'ultra',accessMode:'read-only'});await c.send({threadId:opened.threadId,text:'blank new room; only remaining work'});
 const source=rows.find(row=>row.id===opened.threadId),turnId=`turn-${source.id}`;
 const request=args=>source.gateway.continueConversation({mode:'fresh',nextInstruction:'remaining only',...args},{'x-codex-turn-metadata':JSON.stringify({thread_id:source.id,turn_id:turnId})});
 const receipt=()=>readFile(path.join(root,'.runtime/chat-continuations',`${source.id}.json`),'utf8').then(JSON.parse);
 const finish=async(status='completed')=>{source.turns=[{id:turnId,status,...(status==='failed'?{error:{message:'stream failed',codexErrorInfo:'serverOverloaded'}}:{}),items:[]}];source.hooks.onEvent({method:'turn/completed',params:{threadId:source.id,turn:source.turns[0]}});await wait(async()=>['sent','cancelled','uncertain'].includes((await receipt()).status));};
 return {root,c,rows,calls,source,request,receipt,finish,setCatalog:value=>catalog=value,blockCatalog:value=>catalogGate=value,setGoal:value=>nativeGoal=value,setWorkerGate:value=>workerGate=value,setWorkerFailure:value=>workerFailure=value};
}
async function wait(check){const until=Date.now()+2500;while(!await check()){if(Date.now()>until)throw Error('target handoff timed out');await new Promise(r=>setTimeout(r,10));}}

const projection=state=>({
 human:state.messages.filter(m=>m.role==='user').map(m=>[m.turnId,m.text]),
 tools:state.tools.filter(t=>!['conversation_create','conversation_continue'].includes(t.name)).map(t=>t.id).sort(),
 goal:state.goal?[state.goal.threadId,state.goal.createdAt,state.goal.objective,state.goal.status,state.goal.tokenBudget]:null,
 workers:state.workers.map(w=>[w.provider,w.requestId,w.threadId,w.turnId]).sort(),
 completionPending:state.completionPending,busy:state.busy,questions:state.questions.length,queued:state.queuedMessages?.length??0,
});
const toolEvent=(f,tool)=>{for(const method of ['item/started','item/completed'])f.source.hooks.onEvent({method,params:{threadId:f.source.id,turnId:`turn-${f.source.id}`,item:{id:'own-create',type:'mcpToolCall',server:'k_gemini',tool,status:method==='item/completed'?'completed':'inProgress',arguments:{nextInstruction:'remaining only'}}}});};
for(const scenario of [
 {name:'bare-own-tool',change:f=>toolEvent(f,'conversation_create'),status:'sent'},
 {name:'unrelated-command',change:f=>f.source.hooks.onEvent({method:'item/started',params:{threadId:f.source.id,turnId:`turn-${f.source.id}`,item:{id:'new-command',type:'commandExecution',command:'not executed synthetic event',status:'completed'}}}),status:'cancelled'},
 {name:'same-human-input-echo',change:f=>{for(const method of ['item/started','item/completed'])f.source.hooks.onEvent({method,params:{threadId:f.source.id,turnId:`turn-${f.source.id}`,item:{id:'native-human-echo',type:'userMessage',content:[{type:'text',text:'blank new room; only remaining work'}]}}});},status:'sent'},
 {name:'changed-human-input',change:f=>f.source.hooks.onEvent({method:'item/completed',params:{threadId:f.source.id,turnId:`turn-${f.source.id}`,item:{id:'another-human',type:'userMessage',content:[{type:'text',text:'different human instruction'}]}}}),status:'cancelled'},
 {name:'paused-goal-usage-only',goal:true,change:f=>{const goal={...f.source.owner.state.goal,tokensUsed:20,updatedAt:2};f.setGoal(goal);f.source.hooks.onEvent({method:'thread/goal/updated',params:{threadId:f.source.id,goal}});},status:'sent'},
 {name:'paused-goal-objective-change',goal:true,change:f=>{const goal={...f.source.owner.state.goal,objective:'new objective'};f.setGoal(goal);f.source.hooks.onEvent({method:'thread/goal/updated',params:{threadId:f.source.id,goal}});},status:'cancelled'},
])test('source guard normal-settlement probe '+scenario.name,async()=>{
 const f=await fixture();try{
  if(scenario.goal)f.setGoal({threadId:f.source.id,createdAt:1,objective:'remaining',status:'paused',tokenBudget:null,tokensUsed:10});
  const accepted=await f.request({});const before=projection(f.source.owner.state);scenario.change(f);const after=projection(f.source.owner.state);
  assert.equal(accepted.accepted,true);assert.equal(JSON.stringify(before)===JSON.stringify(after),scenario.status==='sent');
  await f.finish();const receipt=await f.receipt();
  assert.equal(receipt.status,scenario.status);assert.equal(f.calls.filter(([m])=>m==='thread/start').length,scenario.status==='sent'?2:1);
 }finally{await f.c.close();}
});

for(const slow of [false,true])test('unchanged settled historical worker readback '+(slow?'delayed':'immediate')+' does not revoke accepted handoff',async()=>{
 const f=await fixture();let enter,release;const entered=new Promise(r=>enter=r),promise=new Promise(r=>release=r);
 try{
  f.source.hooks.onEvent({method:'item/completed',params:{threadId:f.source.id,turnId:`turn-${f.source.id}`,item:{id:'old-dispatch',type:'collabAgentToolCall',tool:'spawn_agent',receiverThreadIds:['settled-worker'],status:'completed'}}});
  await f.source.owner.workers();const accepted=await f.request({});toolEvent(f,'conversation_create');const before=projection(f.source.owner.state);
  if(slow)f.setWorkerGate({enter,promise});const finishing=f.finish();
  if(slow){await entered;await new Promise(setImmediate);assert.equal(f.source.settledEvents.length,0);assert.equal(f.source.owner.state.completionPending,true);assert.equal((await f.receipt()).status,'pending');release();}
  await finishing;const terminal=projection(f.source.owner.state),receipt=await f.receipt();release();await new Promise(r=>setTimeout(r,20));
  assert.equal(accepted.accepted,true);assert.equal(f.source.settledEvents.length,1);assert.equal(f.calls.filter(([m])=>m==='thread/start').length,2);
  assert.deepEqual(terminal.human,before.human);assert.deepEqual(terminal.tools,before.tools);assert.deepEqual(terminal.workers,before.workers);assert.deepEqual(terminal.goal,before.goal);assert.equal(receipt.status,'sent');
 }finally{release();f.setWorkerFailure(null);await f.c.close();}
});

for(const action of ['worker-failure','stop','new-human','new-native-turn','new-native-turn-completed'])test('delayed completion readback does not hand off after '+action,async()=>{
 const f=await fixture();let enter,release;const entered=new Promise(r=>enter=r),promise=new Promise(r=>release=r);
 try{
  f.source.hooks.onEvent({method:'item/completed',params:{threadId:f.source.id,turnId:`turn-${f.source.id}`,item:{id:'old-dispatch',type:'collabAgentToolCall',tool:'spawn_agent',receiverThreadIds:['settled-worker'],status:'completed'}}});
  await f.source.owner.workers();await f.request({});f.setWorkerGate({enter,promise});const finishing=f.finish();await entered;
  let operation;
  if(action==='worker-failure')f.setWorkerFailure(Error('synthetic worker read unavailable'));
  if(action==='stop')operation=f.c.stop({threadId:f.source.id});
  if(action==='new-human')f.source.hooks.onEvent({method:'item/completed',params:{threadId:f.source.id,turnId:'new-native-turn',item:{id:'new-human',type:'userMessage',content:[{type:'text',text:'new instruction while old worker refresh waits'}]}}});
  if(action.startsWith('new-native-turn'))f.source.hooks.onEvent({method:'turn/started',params:{threadId:f.source.id,turn:{id:'new-native-turn',status:'inProgress'}}});
  if(action==='new-native-turn-completed'){const next={id:'new-native-turn',status:'completed',items:[]};f.source.turns.push(next);f.source.hooks.onEvent({method:'turn/completed',params:{threadId:f.source.id,turn:next}});}
  // The blocked read is a real gate, not a timeout: release only after the invalidating event.
  release();if(operation)await operation;await finishing;
  if(action==='stop')assert.equal(f.source.settledEvents.find(e=>e.turnId===`turn-${f.source.id}`)?.status,'completed');
  const receipt=await f.receipt();assert.equal(receipt.status,'cancelled');assert.equal(receipt.newThreadId,undefined);assert.equal(f.calls.filter(([m])=>m==='thread/start').length,1);
 }finally{release();f.setWorkerFailure(null);await f.c.close();}
});
