import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {listMainSessions,saveMainSession} from '../src/main-sessions.mjs';

const ASTRA='gpt-6-astra';
const TERRA='gpt-5.6-terra';
const LUNA='gpt-5.6-luna';
const ROOT_TESTS=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
const catalog=[
 {model:ASTRA,displayName:'GPT-6 Astra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image']},
 {model:TERRA,displayName:'GPT-5.6 Terra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']},
 {model:LUNA,displayName:'GPT-5.6 Luna',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'low',inputModalities:['text']},
];

const existingHistory=(threadId,text='既有要求')=>({turns:[{id:`prior-${threadId}`,items:[{type:'userMessage',id:`user-${threadId}`,content:[{type:'text',text}]},{type:'agentMessage',id:`assistant-${threadId}`,text:'既有回答'}]}]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture({sessions=[],completeTurns=true}={}){
 await mkdir(ROOT_TESTS,{recursive:true});
 const root=await mkdtemp(path.join(ROOT_TESTS,'desktop-model-switch-'));
 const histories=new Map(),unsupportedTurnReads=new Set(),calls=[],hosts=[];
 let nextThread=0,nextTurn=0;
 for(const session of sessions){
  histories.set(session.threadId,session.history??existingHistory(session.threadId));
  await saveMainSession(root,{threadId:session.threadId,model:session.model??ASTRA,workspace:session.workspace??root,accessMode:session.accessMode??'workspace-write',effort:session.effort??'high',workerPolicy:session.workerPolicy});
 }
 const hostFactory=options=>{
  const waiters=[];let resolveClosed;
  const host={closed:new Promise(resolve=>{resolveClosed=resolve;}),calls,waiters,closeCount:0,
   notify(message){calls.push({method:'$notify',p:message});},
   waitForMcp(threadId,name){return Promise.resolve({threadId,name,status:'ready'});},
   async close(){this.closeCount++;resolveClosed();},
   async request(method,p={}){
    const call={host:this,method,p};calls.push(call);
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='model/list')return {data:catalog,nextCursor:null};
    if(method==='config/read')return {config:{}};
    if(method==='thread/read'){
     if(p.includeTurns===true&&unsupportedTurnReads.has(p.threadId)){
      const error=new Error('turn history is not available for an unsent thread');error.protocolMessage='list_turns is not supported yet';throw error;
     }
     if(p.includeTurns===false)return {thread:{id:p.threadId,status:{type:'idle'},preview:''}};
     return {thread:{id:p.threadId,status:{type:'idle'},...(histories.get(p.threadId)??{turns:[]})}};
    }
    if(method==='thread/start'){
     const id=`model-switch-new-${++nextThread}`;
     histories.set(id,{turns:[]});unsupportedTurnReads.add(id);
     return {thread:{id}};
    }
    if(method==='thread/resume')return {thread:{id:p.threadId}};
    if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
    if(method==='thread/backgroundTerminals/clean')return {};
    if(method==='turn/start'){
     const id=`model-switch-turn-${++nextTurn}`;
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
 const makeController=()=>createDesktopController({root,executable:'fixture',hostFactory});
 return {root,c:makeController(),makeController,hosts,calls,histories,unsupportedTurnReads};
}

test('switch confirmation can be declined, is required for existing history, and invalid choices leave settings unchanged',async()=>{
 const f=await fixture({sessions:[{threadId:'existing',accessMode:'read-only'}]});
 try{
  await f.c.open({model:ASTRA,threadId:'existing'});
  const before={model:f.c.state.model,effort:f.c.state.effort,modelChanges:structuredClone(f.c.state.modelChanges)};
  await assert.rejects(f.c.selectModel({threadId:'existing',model:TERRA}),/先確認/);
  const cancelled=await f.c.selectModel({threadId:'existing',model:TERRA,confirmed:false});
  assert.deepEqual(cancelled,{cancelled:true,threadId:'existing',model:ASTRA,effort:'high'});
  await assert.rejects(f.c.selectModel({threadId:'existing',model:'not-in-picker',confirmed:true}),/未提供指定模型/);
  await assert.rejects(f.c.selectModel({threadId:'existing',model:TERRA,effort:'ultra',confirmed:true}),/推理程度目前不可用/);
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
 const f=await fixture();
 try{
  const opened=await f.c.open({model:ASTRA,effort:'high',accessMode:'read-only',workerPolicy:{model:TERRA}});
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
  assert.deepEqual(terra,{cancelled:false,threadId,model:TERRA,effort:'high'});
  const luna=await f.c.selectModel({threadId,model:LUNA,confirmed:true});
  assert.deepEqual(luna,{cancelled:false,threadId,model:LUNA,effort:'low'});
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
  assert.deepEqual(selected,{cancelled:false,threadId:blankId,model:TERRA,effort:'high'});
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
