import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {createClaudeController} from '../src/claude-controller.mjs';
import {observeSharedKnowledge,sharedKnowledgeFile} from '../src/shared-knowledge.mjs';

const catalog=[{model:'gpt-6-luna',displayName:'GPT-6 Luna',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text']}];
async function root(){await mkdir(path.join(process.cwd(),'.runtime/tests'),{recursive:true});const dir=await mkdtemp(path.join(process.cwd(),'.runtime/tests/k-shared-controller-'));return dir;}

test('Codex send injects project background before turn/start and awaits native completion observation write',async()=>{
 const dir=await root();let hooks,turn=0;const calls=[];const factory=options=>{let resolveClosed;const value={closed:new Promise(resolve=>resolveClosed=resolve),notify(){},close:async()=>resolveClosed(),waitForMcp:async()=>{},request:async(method,p)=>{calls.push({method,p});if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='model/list')return {data:catalog};if(method==='thread/start')return {thread:{id:'codex-shared-thread'}};if(method==='thread/goal/get')return {goal:null};if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};if(method==='turn/start'){turn++;await hooks.onEvent({method:'turn/started',params:{threadId:'codex-shared-thread',turn:{id:`codex-turn-${turn}`}}});return {turn:{id:`codex-turn-${turn}`}};}return {};}};hooks=options;return value;};
 const controller=createDesktopController({root:dir,executable:'test',hostFactory:factory,sharedKnowledgeEnabled:true});
 try{
  await observeSharedKnowledge({root:dir,workspace:dir,provider:'claude',threadId:'claude-source',turnId:'turn-source',messageId:'message-source',text:'決定 紙鶴發布通道是單一維護分支；只在簽章驗證完成後發布。'});
  await controller.open({model:'gpt-6-luna'});await controller.send({text:'更正 紙鶴發布通道改為完成雙平台驗證後才發布；任一平台失敗都否決。'});
  const sent=calls.findLast(x=>x.method==='turn/start').p;await hooks.onEvent({method:'item/completed',params:{threadId:'codex-shared-thread',turnId:'codex-turn-1',item:{id:'echo-user',type:'userMessage',content:sent.input}}});assert.doesNotMatch(controller.state.messages.findLast(row=>row.role==='user').text,/<K_SHARED_KNOWLEDGE/);assert.match(sent.input[0].text,/<K_SHARED_KNOWLEDGE/);assert.match(sent.input[0].text,/單一維護分支/);assert.match(sent.input[0].text,/來源 claude\/claude-source\/turn-source\/message-source/);
  await hooks.onEvent({method:'item/started',params:{threadId:'codex-shared-thread',turnId:'codex-turn-1',item:{id:'answer-1',type:'agentMessage',text:'更正 紙鶴發布通道改為完成雙平台驗證後才發布；任一平台失敗都否決。'}}});
  await hooks.onEvent({method:'turn/completed',params:{threadId:'codex-shared-thread',turn:{id:'codex-turn-1',status:'completed'}}});
  const data=JSON.parse(await readFile(sharedKnowledgeFile(dir,dir),'utf8'));assert.equal(data.records.length,2);assert.equal(data.records[0].active,false);assert.equal(data.records[1].relation.type,'supersedes');assert.equal(controller.state.status,'completed');
 }finally{await controller.close();}
});

test('Claude native send receives the same store and result completion is not settled before observation persists',async()=>{
 const dir=await root();let options,started,resolveClosed;const host={nativeCapabilities:{tools:[],commands:[],models:[],agents:[],skills:[],mcpServers:[],permissionModes:['default']},closed:new Promise(resolve=>resolveClosed=resolve),async start(content){started=content;},async close(){resolveClosed();},async interrupt(){}};
 const bridge={async list(){return [];},async close(){},async cancel(){return {settled:true};},async wait(){return {settled:true};},async inspect(){return {settled:true};}};
 const gateway={mcpConfig:{mcpServers:{}},async close(){}};
 const controller=createClaudeController({root:dir,executable:'test',commandSpec:{command:'claude-test',argsPrefix:[]},hostFactory:async value=>(options=value,host),bridgeFactory:async()=>bridge,gatewayFactory:async()=>gateway,sharedKnowledgeEnabled:true});
 try{
  await observeSharedKnowledge({root:dir,workspace:dir,provider:'codex',threadId:'codex-source',turnId:'turn-source',messageId:'message-source',text:'決定 紙鶴發布通道是單一維護分支；只在簽章驗證完成後發布。'});
  await controller.open({});await controller.send({text:'更正 紙鶴發布通道改為完成雙平台驗證後才發布；任一平台失敗都否決。'});
  assert.equal(started[0].text,'更正 紙鶴發布通道改為完成雙平台驗證後才發布；任一平台失敗都否決。');assert.match(started[1].text,/<K_SHARED_KNOWLEDGE/);assert.match(started[1].text,/來源 codex\/codex-source\/turn-source\/message-source/);
  const user=controller.state.messages.findLast(row=>row.role==='user');
  await options.onMessage({type:'assistant',uuid:'claude-answer',message:{id:'claude-answer',content:[{type:'text',text:'更正 紙鶴發布通道改為完成雙平台驗證後才發布；任一平台失敗都否決。'}]}});
  await options.onMessage({type:'result',user_message_uuid:user.id,is_error:false});
  const data=JSON.parse(await readFile(sharedKnowledgeFile(dir,dir),'utf8'));assert.equal(data.records.length,2);assert.equal(data.records[0].active,false);assert.equal(data.records[1].relation.type,'supersedes');assert.equal(controller.state.status,'completed');
 }finally{await controller.close();}
});

test('shared knowledge can be disabled on the Codex native controller without changing the input text',async()=>{
 const dir=await root();const factory=()=>{let resolveClosed;const host={closed:new Promise(resolve=>resolveClosed=resolve),notify(){},close:async()=>resolveClosed(),waitForMcp:async()=>{},request:async(method)=>{if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='model/list')return {data:catalog};if(method==='thread/start')return {thread:{id:'thread-disabled'}};if(method==='thread/goal/get')return {goal:null};if(method==='turn/start')return {turn:{id:'t'}};if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};return {};}};return host;};
 const controller=createDesktopController({root:dir,executable:'test',hostFactory:factory,sharedKnowledgeEnabled:false});
 try{
  await observeSharedKnowledge({root:dir,workspace:dir,provider:'claude',threadId:'s',turnId:'t',messageId:'m',text:'決定 紙鶴發布通道是候選。'});await controller.open({model:'gpt-6-luna'});await controller.send({text:'original input'});
  const payload=controller.state.messages.findLast(row=>row.role==='user').text;assert.equal(payload,'original input');assert.equal(controller.state.sharedKnowledge.injectedCount,0);assert.equal(controller.state.sharedKnowledge.mode,'disabled');
 }finally{await controller.close();}
});

test('stop during Jev preflight cancels both native sends without replay or lingering work',async()=>{
 const enabled=process.env.K_JEV_ENABLED,key=process.env.TYPESAFE_API_KEY;process.env.K_JEV_ENABLED='true';process.env.TYPESAFE_API_KEY='synthetic-test-key';
 try{for(const provider of ['codex','claude']){
  const dir=await root();await observeSharedKnowledge({root:dir,workspace:dir,provider:'claude',threadId:'source',turnId:'t',text:'決定 發布通道使用青銅。'});
  let requested,resolveClosed,sends=0;const started=new Promise(resolve=>requested=resolve);
  const sharedKnowledgeFetch=(_url,init)=>{requested();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));};
  const host={closed:new Promise(resolve=>resolveClosed=resolve),notify(){},waitForMcp:async()=>{},close:async()=>resolveClosed(),interrupt:async()=>{},start:async()=>{sends++;},request:async method=>{
   if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='model/list')return {data:catalog};if(method==='thread/start')return {thread:{id:'cancel-thread'}};if(method==='thread/goal/get')return {goal:null};if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};if(method==='turn/start'){sends++;return {turn:{id:'should-not-send'}};}return {};
  }};
  const options={root:dir,executable:'fixture',hostFactory:()=>{host.closed=new Promise(resolve=>resolveClosed=resolve);return host;},sharedKnowledgeFetch,browserConfig:async()=>null};
  const controller=provider==='codex'?createDesktopController(options):createClaudeController({...options,commandSpec:{command:'fixture',argsPrefix:[]},gatewayFactory:async()=>({mcpConfig:{mcpServers:{}},close:async()=>{}})});
  try{
   await controller.open(provider==='codex'?{model:'gpt-6-luna'}:{});const sent=controller.send({text:'發布通道是什麼？'}).then(()=>null,error=>error);await started;await controller.stop();const error=await sent;assert.equal(error.name,'AbortError');assert.equal(sends,0);assert.equal(controller.state.busy,false);
  }finally{await controller.close();}
 }}finally{if(enabled===undefined)delete process.env.K_JEV_ENABLED;else process.env.K_JEV_ENABLED=enabled;if(key===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=key;}
});
