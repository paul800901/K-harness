import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {listMainSessions,saveMainSession} from '../src/main-sessions.mjs';

const ASTRA='gpt-6-astra';
const TERRA='gpt-5.6-terra';
const LUNA='gpt-6-luna';
const SOL='gpt-6.1-sol';
const LEGACY_SOL='gpt-6-sol';
const ROOT_TESTS=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
const catalog=[
 {model:ASTRA,displayName:'GPT-6 Astra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image'],serviceTiers:[{id:'priority',name:'Fast',description:'Fast service'}]},
 {model:TERRA,displayName:'GPT-5.6 Terra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']},
 {model:LUNA,displayName:'GPT-6 Luna',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text']},
 ...[SOL,LEGACY_SOL].map(model=>({model,displayName:model,hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']})),
];

const existingHistory=(threadId,text='既有要求')=>({turns:[{id:`prior-${threadId}`,items:[{type:'userMessage',id:`user-${threadId}`,content:[{type:'text',text}]},{type:'agentMessage',id:`assistant-${threadId}`,text:'既有回答'}]}]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture({sessions=[],completeTurns=true,controllerOptions={},failAt=null,models=catalog}={}){
 await mkdir(ROOT_TESTS,{recursive:true});
 const root=await mkdtemp(path.join(ROOT_TESTS,'desktop-model-switch-'));
 const histories=new Map(),nativeTiers=new Map(),unsupportedTurnReads=new Set(),calls=[],hosts=[];
 let nextThread=0,nextTurn=0,turnStartOverride=null;
 for(const session of sessions){
  histories.set(session.threadId,session.history??existingHistory(session.threadId));
  await saveMainSession(root,{threadId:session.threadId,model:session.model??ASTRA,workspace:session.workspace??root,accessMode:session.accessMode??'workspace-write',effort:session.effort??'high',workerPolicy:session.workerPolicy});
 }
 const hostFactory=options=>{
  const waiters=[];let resolveClosed;
  const host={closed:new Promise(resolve=>{resolveClosed=resolve;}),calls,waiters,closeCount:0,
   notify(message){calls.push({method:'$notify',p:message});},
   emit(event){options.onEvent?.(event);},
   waitForMcp(threadId,name){return Promise.resolve({threadId,name,status:'ready'});},
   async close(){this.closeCount++;resolveClosed();},
   async request(method,p={}){
    const call={host:this,method,p};calls.push(call);
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='model/list')return {data:models,nextCursor:null};
    if(method==='config/read')return {config:{}};
    if(method==='thread/read'){
     if(p.includeTurns===true&&unsupportedTurnReads.has(p.threadId)){
      const error=new Error('turn history is not available for an unsent thread');error.protocolMessage='list_turns is not supported yet';throw error;
     }
     if(p.includeTurns===false)return {thread:{id:p.threadId,status:{type:'idle'},preview:''}};
     return {thread:{id:p.threadId,status:{type:'idle'},...(histories.get(p.threadId)??{turns:[]})}};
    }
    if(method==='thread/start'){
     if(failAt==='thread/start')throw new Error('fixture thread start failure');
     const id=`model-switch-new-${++nextThread}`;
     histories.set(id,{turns:[]});unsupportedTurnReads.add(id);
     nativeTiers.set(id,p.serviceTier??'default');return {thread:{id},serviceTier:nativeTiers.get(id)};
    }
    if(method==='thread/resume')return {thread:{id:p.threadId},serviceTier:nativeTiers.get(p.threadId)??'default'};
    if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
    if(method==='thread/backgroundTerminals/clean')return {};
    if(method==='turn/start'){
     if(turnStartOverride)return turnStartOverride({params:p,emit:event=>options.onEvent?.(event)});
     const id=`model-switch-turn-${++nextTurn}`;
     nativeTiers.set(p.threadId,p.serviceTier??nativeTiers.get(p.threadId)??'default');
     unsupportedTurnReads.delete(p.threadId);
     const text=p.input?.find(item=>item.type==='text')?.text??'';
     const prior=histories.get(p.threadId)??{turns:[]};
     prior.turns.push({id,items:[{type:'userMessage',id:`user-${id}`,content:[{type:'text',text}]},{type:'agentMessage',id:`assistant-${id}`,text:`回答 ${id}`} ]});
     histories.set(p.threadId,prior);
     options.onEvent?.({method:'turn/started',params:{threadId:p.threadId,turn:{id}}});
     options.onEvent?.({method:'item/completed',params:{threadId:p.threadId,turnId:id,item:{type:'agentMessage',id:`assistant-${id}`,text:`回答 ${id}`}}});
     if(completeTurns)options.onEvent?.({method:'turn/completed',params:{threadId:p.threadId,turn:{id,status:'completed'}}});
     return {turn:{id}};
    }
    if(method==='turn/interrupt'){
     options.onEvent?.({method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}}});
     return {};
    }
    if(method==='mcpServer/tool/call')return {structuredContent:{status:'completed',outputFiles:[]}};
    return {};
   },
  };
  hosts.push(host);return host;
 };
 const makeController=()=>createDesktopController({root,executable:'fixture',hostFactory,...controllerOptions});
 return {root,c:makeController(),makeController,hosts,calls,histories,nativeTiers,unsupportedTurnReads,setTurnStartOverride(fn){turnStartOverride=fn;}};
}

test('failed open closes the injected owner browser gateway',async()=>{
 let browserCloseCount=0;
 const f=await fixture({failAt:'thread/start',controllerOptions:{browserConfig:async()=>({command:'fixture',args:['browser-session','unused','owner-open-failure']}),closeBrowser:async()=>{browserCloseCount++;}}});
 try{
  await assert.rejects(f.c.open({model:ASTRA}),/fixture thread start failure/);
  assert.equal(browserCloseCount,1);
  assert.equal(f.c.state.browserAccess.enabled,false);
 }finally{await f.c.close();}
});

test('Sol 6.1 is sent to the native host only after explicit selection, with old Sol history preserved',async()=>{
 const f=await fixture({sessions:[{threadId:'legacy-sol',model:LEGACY_SOL,accessMode:'read-only'}]});
 try{
  await f.c.open({threadId:'legacy-sol',model:LEGACY_SOL});
  assert.equal(f.c.state.model,LEGACY_SOL);
  await f.c.selectModel({threadId:'legacy-sol',model:SOL,effort:'high',confirmed:true});
  assert.equal(f.calls.some(call=>call.method==='turn/start'),false);
  assert.ok(f.c.state.messages.some(message=>message.text==='既有要求'));
  await f.c.send({text:'新模型驗證'});
  const turn=f.calls.find(call=>call.method==='turn/start');
  assert.equal(turn.p.model,SOL);
  assert.equal(turn.p.effort,'high');
  assert.equal(turn.p.threadId,'legacy-sol');
  assert.equal(turn.p.sandboxPolicy.type,'readOnly');
  await f.c.close();
  const reopened=f.makeController();
  try{
   await reopened.open({threadId:'legacy-sol',model:SOL});
   assert.equal(reopened.state.model,SOL);
   assert.equal(reopened.state.accessMode,'read-only');
   assert.ok(reopened.state.messages.some(message=>message.text==='既有要求'));
  }finally{await reopened.close();}
 }finally{await f.c.close();}
});

test('switch confirmation can be declined, is required for existing history, and invalid choices leave settings unchanged',async()=>{
 const f=await fixture({sessions:[{threadId:'existing',accessMode:'read-only'}]});
 try{
  await f.c.open({model:ASTRA,threadId:'existing'});
  const before={model:f.c.state.model,effort:f.c.state.effort,modelChanges:structuredClone(f.c.state.modelChanges)};
  await assert.rejects(f.c.selectModel({threadId:'existing',model:TERRA}),/先確認/);
  const cancelled=await f.c.selectModel({threadId:'existing',model:TERRA,confirmed:false});
  assert.deepEqual(cancelled,{cancelled:true,threadId:'existing',model:ASTRA,effort:'high',serviceTier:'default',effectiveServiceTier:'default'});
  await assert.rejects(f.c.selectModel({threadId:'existing',model:'not-in-picker',confirmed:true}),/未提供指定模型/);
  await assert.rejects(f.c.selectModel({threadId:'existing',model:TERRA,effort:'ultra',confirmed:true}),/推理程度目前不可用/);
  await assert.rejects(f.c.selectModel({threadId:'existing',model:TERRA,serviceTier:'priority',confirmed:true}),/指定服務速度目前不可用/);
  assert.deepEqual({model:f.c.state.model,effort:f.c.state.effort,modelChanges:f.c.state.modelChanges},before);
  assert.equal((await f.c.sessions()).sessions.find(item=>item.threadId==='existing').model,ASTRA);
  await f.c.selectModel({threadId:'existing',model:TERRA,confirmed:true});
  const activeHost=f.hosts.at(-1);
  await assert.rejects(f.c.open({model:ASTRA,threadId:'existing'}),/設定已更新/);
  assert.equal(f.c.state.model,TERRA);
  assert.equal(f.c.state.status,'ready');
  assert.equal(activeHost.closeCount,0);
 }finally{await f.c.close();}
});

test('two model selections affect only the next turn, preserve effort policy and permissions, then persist turn attribution across reopen',async()=>{
 const f=await fixture({models:catalog.map(model=>model.model===LUNA?{...model,supportedReasoningEfforts:[{reasoningEffort:'low'}]}:model)});
 try{
  const opened=await f.c.open({model:ASTRA,effort:'high',accessMode:'read-only',workerPolicy:{model:LUNA,effort:'low'}});
  await flush();
  const threadId=opened.threadId;
  const originalWorkerPolicy=structuredClone(f.c.state.workerPolicy);
  await f.c.send({text:'第一輪'});
  assert.equal(f.c.state.modelChanges.length,0);
  assert.equal(f.c.state.lastUsedModel,ASTRA);
  const firstTurn=f.calls.find(call=>call.method==='turn/start');
  assert.equal(firstTurn.p.model,ASTRA);
  assert.equal(firstTurn.p.effort,'high');

  const beforeSelections=f.calls.filter(call=>call.method==='turn/start'||call.method==='thread/start').length;
  const terra=await f.c.selectModel({threadId,model:TERRA,confirmed:true});
  assert.deepEqual(terra,{cancelled:false,threadId,model:TERRA,effort:'high',serviceTier:'default',effectiveServiceTier:'default'});
  const luna=await f.c.selectModel({threadId,model:LUNA,confirmed:true});
  assert.deepEqual(luna,{cancelled:false,threadId,model:LUNA,effort:'low',serviceTier:'default',effectiveServiceTier:'default'});
  assert.equal(f.calls.filter(call=>call.method==='turn/start'||call.method==='thread/start').length,beforeSelections);
  assert.equal(f.c.state.modelChanges.length,0);
  assert.equal(f.c.state.accessMode,'read-only');
  assert.deepEqual(f.c.state.workerPolicy,originalWorkerPolicy);

  const selected=(await f.c.sessions()).sessions.find(item=>item.threadId===threadId);
  assert.equal(selected.model,LUNA);
  assert.equal(selected.accessMode,'read-only');
  assert.deepEqual(selected.workerPolicy,originalWorkerPolicy);
  assert.equal(selected.lastUsedModel,ASTRA);
  assert.deepEqual(selected.modelChanges,[]);

  await f.c.send({text:'第二輪'});
  const secondTurn=f.calls.filter(call=>call.method==='turn/start').at(-1);
  assert.equal(secondTurn.p.model,LUNA);
  assert.equal(secondTurn.p.effort,'low');
  assert.equal(secondTurn.p.sandboxPolicy.type,'readOnly');
  assert.equal(f.c.state.lastUsedModel,LUNA);
  assert.equal(f.c.state.modelChanges.length,1);
  assert.deepEqual(Object.keys(f.c.state.modelChanges[0]),['turnId','fromModel','toModel','at']);
  const secondUser=f.c.state.messages.find(message=>message.role==='user'&&message.text==='第二輪');
  assert.equal(f.c.state.modelChanges[0].turnId,secondUser.turnId);
  assert.equal(f.c.state.modelChanges[0].fromModel,ASTRA);
  assert.equal(f.c.state.modelChanges[0].toModel,LUNA);
  assert.ok(Number.isFinite(Date.parse(f.c.state.modelChanges[0].at)));
  assert.ok(f.c.state.messages.every(message=>typeof message.turnId==='string'&&message.turnId.length>0));

  await f.c.metadata({threadId,title:'已切換模型'});
  const persisted=(await f.c.sessions()).sessions.find(item=>item.threadId===threadId);
  assert.equal(persisted.lastUsedModel,LUNA);
  assert.deepEqual(persisted.modelChanges,f.c.state.modelChanges);
  assert.equal(persisted.model,LUNA);
  await f.c.close();

  const reopened=f.makeController();
  try{
   await reopened.open({model:LUNA,threadId});
   assert.equal(reopened.state.lastUsedModel,LUNA);
   assert.deepEqual(reopened.state.modelChanges,f.c.state.modelChanges);
   assert.equal(reopened.state.messages.find(message=>message.text==='第一輪').turnId,'model-switch-turn-1');
   assert.equal(reopened.state.messages.find(message=>message.text==='第二輪').turnId,'model-switch-turn-2');
   await reopened.metadata({threadId,pinned:true});
   const afterMetadata=(await reopened.sessions()).sessions.find(item=>item.threadId===threadId);
   assert.equal(afterMetadata.lastUsedModel,LUNA);
   assert.deepEqual(afterMetadata.modelChanges,f.c.state.modelChanges);
   assert.equal(afterMetadata.pinned,true);
   assert.equal(afterMetadata.accessMode,'read-only');
   assert.deepEqual(afterMetadata.workerPolicy,originalWorkerPolicy);
  }finally{await reopened.close();}
 }finally{if(f.c.state.status!=='offline')await f.c.close();}
});

test('session readback accepts a long model change history well above the former 16 KiB cap',async()=>{
 const f=await fixture();
 try{
  const modelChanges=Array.from({length:240},(_,index)=>({turnId:`long-turn-${index}`,fromModel:ASTRA,toModel:TERRA,at:new Date(Date.UTC(2026,0,1,0,0,index)).toISOString()}));
  const file=await saveMainSession(f.root,{threadId:'long-history',model:TERRA,lastUsedModel:TERRA,modelChanges});
  assert.ok((await stat(file)).size>16*1024);
  const result=await listMainSessions(f.root);
  assert.equal(result.unreadable,0);
  assert.deepEqual(result.sessions.find(item=>item.threadId==='long-history').modelChanges,modelChanges);
 }finally{await f.c.close();}
});

test('blank unsent conversation keeps its restoration cache after selecting another model',async()=>{
 const f=await fixture({sessions:[{threadId:'other',model:ASTRA,history:existingHistory('other')}]});
 try{
  const opened=await f.c.open({model:ASTRA,effort:'high',accessMode:'read-only'});
  const blankId=opened.threadId;
  const selected=await f.c.selectModel({threadId:blankId,model:TERRA});
  assert.deepEqual(selected,{cancelled:false,threadId:blankId,model:TERRA,effort:'high',serviceTier:'default',effectiveServiceTier:'default'});
  await f.c.open({model:ASTRA,threadId:'other'});
  await f.c.open({model:TERRA,threadId:blankId});
  assert.equal(f.c.state.threadId,blankId);
  assert.deepEqual(f.c.state.messages,[]);
  assert.equal(f.calls.filter(call=>call.method==='thread/start').length,1);
  assert.equal(f.calls.filter(call=>call.method==='thread/resume'&&call.p.threadId===blankId).length,0);
  assert.equal(f.c.state.model,TERRA);
  assert.equal(f.c.state.effort,'high');
  await flush();
  await f.c.send({text:'空白對話第一輪'});
  const turn=f.calls.filter(call=>call.method==='turn/start').at(-1);
  assert.equal(turn.p.model,TERRA);
  assert.equal(turn.p.effort,'high');
  assert.equal(f.c.state.modelChanges.length,0);
  const saved=(await f.c.sessions()).sessions.find(item=>item.threadId===blankId);
  assert.equal(saved.lastUsedModel,TERRA);
 }finally{await f.c.close();}
});

test('Fast remains a saved next-turn choice for an unsent room and is applied only by its first native turn',async()=>{
 const f=await fixture();
 try{
  const opened=await f.c.open({model:ASTRA}),threadId=opened.threadId;
  const started=f.calls.find(call=>call.method==='thread/start');assert.equal(started.p.serviceTier,'default');
  assert.deepEqual(f.c.state.fastTier,{id:'priority',name:'Fast',description:'Fast service'});assert.equal(f.c.state.serviceTier,'default');assert.equal(f.c.state.effectiveServiceTier,'default');
  await f.c.selectModel({threadId,model:ASTRA,serviceTier:'priority'});
  assert.equal(f.calls.some(call=>call.method==='thread/resume'&&call.p.threadId===threadId),false,'an unsent prepared thread has no native rollout to resume');
  assert.equal(f.c.state.serviceTier,'priority');assert.equal(f.c.state.effectiveServiceTier,'default');
  assert.equal((await listMainSessions(f.root)).sessions.find(row=>row.threadId===threadId).serviceTier,'priority');
  await f.c.send({text:'Fast is applied on first send'});
  const turn=f.calls.filter(call=>call.method==='turn/start').at(-1);assert.equal(turn.p.serviceTier,'priority');assert.equal(turn.p.serviceTierForTurn,undefined);assert.equal(f.c.state.effectiveServiceTier,'priority');
  await f.c.close();const reopened=f.makeController();
  try{await reopened.open({threadId,model:ASTRA});assert.equal(reopened.state.serviceTier,'priority');assert.equal(reopened.state.effectiveServiceTier,'priority');}
  finally{await reopened.close();}
 }finally{if(f.c.state.status!=='offline')await f.c.close();}
});

test('selecting a model without Fast schedules Standard without rewriting the native effective tier early',async()=>{
 const f=await fixture();
 try{
  const opened=await f.c.open({model:ASTRA,serviceTier:'priority'}),threadId=opened.threadId;
  assert.equal(f.c.state.effectiveServiceTier,'priority');
  await f.c.send({text:'Fast turn'});
  await f.c.selectModel({threadId,model:TERRA,serviceTier:'default',confirmed:true});
  assert.equal(f.c.state.fastTier,null);assert.equal(f.c.state.serviceTier,'default');assert.equal(f.c.state.effectiveServiceTier,'priority');
  assert.equal(f.calls.filter(call=>call.method==='thread/resume'&&call.p.threadId===threadId).length,0,'model and tier selection do not reopen or restart a submitted native thread');
  await f.c.send({text:'Standard next turn'});
  const turn=f.calls.filter(call=>call.method==='turn/start').at(-1);assert.equal(turn.p.serviceTier,'default');assert.equal(f.c.state.effectiveServiceTier,'default');
 }finally{await f.c.close();}
});

test('a native turn-start event does not apply the requested tier when its request is rejected',async()=>{
 const f=await fixture({sessions:[{threadId:'existing'}]});
 try{
  await f.c.open({model:ASTRA,threadId:'existing'});
  await f.c.selectModel({threadId:'existing',model:ASTRA,serviceTier:'priority'});
  f.setTurnStartOverride(({params,emit})=>{
   emit({method:'turn/started',params:{threadId:params.threadId,turn:{id:'native-goal-turn'}}});
   throw Object.assign(new Error('native turn already active'),{protocolMessage:{code:-32600}});
  });
  await assert.rejects(f.c.send({text:'do not infer this turn tier'}));
  assert.equal(f.c.state.serviceTier,'priority');
  assert.equal(f.c.state.effectiveServiceTier,'default','the event may belong to a native goal, not the rejected K turn');
 }finally{await f.c.close();}
});

test('a turn-start transport failure makes the effective tier unknown until native readback',async()=>{
 const f=await fixture();
 try{
  const {threadId}=await f.c.open({model:ASTRA,serviceTier:'priority'});
  await f.c.selectModel({threadId,model:ASTRA,serviceTier:'default'});
  f.setTurnStartOverride(()=>Promise.reject(new Error('fixture transport timeout')));
  await assert.rejects(f.c.send({text:'delivery unknown'}),/fixture transport timeout/);
  assert.equal(f.c.state.serviceTier,'default');
  assert.equal(f.c.state.effectiveServiceTier,null);
 }finally{await f.c.close();}
});
