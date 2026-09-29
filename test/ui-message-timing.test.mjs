import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {loadUiMessageTiming,turnGroupId} from '../src/ui-message-timing.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';

async function fixture(root,{historyTurnStatus}={}){
  let hook,hostFactoryCalls=0;const calls=[];
  const hostFactory=options=>{
    hook=options;hostFactoryCalls++;let closeHost;
    const host={closed:new Promise(resolve=>{closeHost=resolve;}),notify(){},waitForMcp:async()=>{},close:async()=>closeHost(),request:async(method,p)=>{
      calls.push({method,p});
      if(method==='account/read')return {account:{type:'chatgpt'}};
      if(method==='model/list')return {data:[{model:'gpt-6-astra',displayName:'GPT-6 Astra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text']},{model:'gpt-6-luna',displayName:'GPT-6 Luna',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text']}]};
      if(method==='thread/start'||method==='thread/resume')return {thread:{id:'timing-thread'}};
      if(method==='thread/read')return {thread:{turns:[{id:'turn-a',...(historyTurnStatus===undefined?{}:{status:historyTurnStatus}),items:[
        {type:'userMessage',id:'native-user',content:[{type:'text',text:'hello'}]},
        {type:'agentMessage',id:'assistant-final',text:'done'},
        {type:'commandExecution',id:'tool-a',command:'test',aggregatedOutput:'ok',status:'completed'}
      ]}]}};
      if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
      if(method==='thread/goal/get')return {goal:null};
      if(method==='account/rateLimits/read')return {rateLimits:{}};
      if(method==='turn/start'){
        options.onEvent({method:'turn/started',params:{threadId:'timing-thread',turn:{id:'turn-live'}}});
        return {turn:{id:'turn-live'}};
      }
      if(method==='turn/steer')return {turnId:p.expectedTurnId};
      if(method==='config/read')return {config:{}};
      return {};
    }};
    return host;
  };
  const controller=createDesktopController({root,executable:'fixture',hostFactory});
  return {controller,calls,get hook(){return hook;},get hostFactoryCalls(){return hostFactoryCalls;}};
}

test('live timestamps and groups survive native ID reconciliation and reload without inventing old times',async()=>{
  const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'ui-timing-'));
  const f=await fixture(root);
  try{
    await f.controller.open({model:'gpt-6-astra'});
    await f.controller.send({text:'hello'});
    const user=f.controller.state.messages.find(m=>m.text==='hello');
    assert.ok(user.createdAt);assert.ok(user.groupId);assert.equal(user.turnId,'turn-live');
    f.hook.onEvent({method:'item/started',params:{threadId:'timing-thread',turnId:'turn-live',item:{id:'native-user',type:'userMessage',content:[{type:'text',text:'hello'}]}}});
    f.hook.onEvent({method:'item/completed',params:{threadId:'timing-thread',turnId:'turn-live',item:{id:'native-user',type:'userMessage',content:[{type:'text',text:'hello'}]}}});
    assert.equal(f.controller.state.messages.filter(m=>m.text==='hello').length,1);
    assert.equal(f.controller.state.messages[0].id,'native-user');
    assert.equal(f.controller.state.messages[0].createdAt,user.createdAt);
    await f.controller.steer({text:'continue'});
    const steer=f.controller.state.messages.find(m=>m.text==='continue');
    assert.equal(steer.groupId,user.groupId);assert.ok(steer.createdAt);
    f.hook.onEvent({method:'item/started',params:{threadId:'timing-thread',turnId:'turn-live',item:{id:'tool-live',type:'commandExecution',command:'test'}}});
    const tool=f.controller.state.tools.find(t=>t.id==='tool-live');
    assert.ok(tool.createdAt);assert.equal(tool.groupId,user.groupId);assert.equal(tool.turnId,'turn-live');
    f.hook.onEvent({method:'item/agentMessage/delta',params:{threadId:'timing-thread',turnId:'turn-live',itemId:'answer-live',delta:'result'}});
    f.hook.onEvent({method:'turn/completed',params:{threadId:'timing-thread',turn:{id:'turn-live',status:'completed'}}});
    const answer=f.controller.state.messages.find(m=>m.id==='answer-live');assert.ok(answer.completedAt);assert.equal(answer.partial,undefined);
    const deadline=Date.now()+5000;let saved;
    while(!(saved=await loadUiMessageTiming(root,'timing-thread')).messages['answer-live']?.completedAt){
      assert.ok(Date.now()<deadline,'Completed message timing was not persisted.');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(saved.messages['native-user'].createdAt,user.createdAt);
    assert.ok(saved.messages['answer-live'].completedAt);
    assert.ok(saved.tools['tool-live'].createdAt);
    await f.controller.close();

    const reopened=await fixture(root);await reopened.controller.open({model:'gpt-6-astra',threadId:'timing-thread'});
    const restored=reopened.controller.state.messages;
    assert.equal(restored.find(m=>m.id==='native-user').createdAt,user.createdAt);
    assert.equal(restored.find(m=>m.id==='assistant-final').createdAt,undefined);
    assert.equal(restored.find(m=>m.id==='assistant-final').partial,undefined);
    assert.equal(restored.find(m=>m.id==='native-user').groupId,user.groupId);
    assert.equal(reopened.controller.state.tools.find(t=>t.id==='tool-a').createdAt,undefined);
    await reopened.controller.close();
  }finally{await f.controller.close().catch(()=>{});}
});

test('interrupted live answer persists partial without marking an earlier completed answer',async()=>{
  const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'ui-partial-'));
  const f=await fixture(root);
  try{
    await f.controller.open({model:'gpt-6-astra'});await f.controller.send({text:'new turn'});
    f.controller.state.messages.unshift({id:'old-final',role:'assistant',text:'old final',turnId:'turn-old',completedAt:new Date().toISOString()});
    f.hook.onEvent({method:'item/agentMessage/delta',params:{threadId:'timing-thread',turnId:'turn-live',itemId:'assistant-partial',delta:'unfinished'}});
    const partial=f.controller.state.messages.find(m=>m.id==='assistant-partial');assert.equal(partial.partial,true);
    await f.controller.stop();
    assert.equal(partial.partial,true);
    assert.equal(f.controller.state.messages.find(m=>m.id==='old-final').partial,undefined);
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal((await loadUiMessageTiming(root,'timing-thread')).messages['assistant-partial'].partial,true);
  }finally{await f.controller.close().catch(()=>{});}
});

test('historical assistant is partial only when native turn status proves it',async()=>{
  const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'ui-history-partial-'));
  const f=await fixture(root,{historyTurnStatus:'interrupted'});
  try{await saveMainSession(root,{threadId:'timing-thread',model:'gpt-6-astra',workspace:root,accessMode:'workspace-write'});await f.controller.open({model:'gpt-6-astra',threadId:'timing-thread'});assert.equal(f.controller.state.messages.find(m=>m.id==='assistant-final').partial,true);}
  finally{await f.controller.close().catch(()=>{});}
});

test('turn fallback group is deterministic and does not imply a timestamp',()=>{
  assert.equal(turnGroupId('old-turn'),'turn:old-turn');
  assert.equal(turnGroupId(undefined),undefined);
});

test('quota reads without an active host are throttled for five minutes',async()=>{
  const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'ui-quota-'));
  const f=await fixture(root),realNow=Date.now;
  try{
    await f.controller.open({model:'gpt-6-astra'});await f.controller.usage(true);
    await f.controller.close();
    const before=f.calls.filter(call=>call.method==='account/rateLimits/read').length;
    Date.now=()=>realNow()+300000;
    await f.controller.usage();const afterFirst=f.calls.filter(call=>call.method==='account/rateLimits/read').length;
    await f.controller.usage();const afterSecond=f.calls.filter(call=>call.method==='account/rateLimits/read').length;
    assert.equal(afterFirst,before+1);assert.equal(afterSecond,afterFirst);
  }finally{Date.now=realNow;await f.controller.close().catch(()=>{});}
});

test('fresh native completed turn overrides stale partial UI projection',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'ui-native-completed-'));
 const {saveUiMessageTiming}=await import('../src/ui-message-timing.mjs');await saveUiMessageTiming(root,'timing-thread',{messages:{'assistant-final':{partial:true}},tools:{}});
 await saveMainSession(root,{threadId:'timing-thread',model:'gpt-6-astra',workspace:root});const f=await fixture(root,{historyTurnStatus:'completed'});
 try{await f.controller.open({model:'gpt-6-astra',threadId:'timing-thread'});assert.equal(f.controller.state.messages.find(m=>m.id==='assistant-final').partial,undefined);}finally{await f.controller.close();}
});
