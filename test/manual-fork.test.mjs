import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';
import {isVisibleMainSession} from '../frontend/project-groups.mjs';
import {scratchBase} from './scratch.mjs';

async function fixture({failure,accessMode='read-only',sourceWorker=false,backgroundCommand=false}={}){
 const base=scratchBase;await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'manual-fork-')),model='gpt-6.1-sol',calls=[],visibleAtReadiness=[];
 const policy={model:'gpt-6-luna',effort:'high'};
 await saveMainSession(root,{threadId:'parent',model,title:'來源',workspace:root,accessMode,workerPolicy:policy});
 const turns=[{id:'point',status:'completed',items:[{id:'answer',type:'agentMessage',text:'完成結論'},...(sourceWorker?[{id:'old-dispatch',type:'collabAgentToolCall',receiverThreadIds:['old-worker']}]:[])]},
  {id:'later',status:'failed',items:[{id:'later-answer',type:'agentMessage',text:'不要複製後續'}]}];
 let configured=false;
 const hostFactory=()=>{let end;return {closed:new Promise(r=>end=r),notify(){},close:async()=>end(),
  async waitForMcp(id){if(id==='child'){
   visibleAtReadiness.push((await listMainSessions(root,{threadId:id})).sessions[0]);
   if(failure==='mcp')throw Error('startup failed');
   assert.equal(configured,true,'native fork must receive MCP config before it is loaded');
  }},
  async request(method,p){calls.push({method,p});
   if(method==='model/list')return {data:[{model,supportedReasoningEfforts:[{reasoningEffort:'medium'}]},{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]};
   if(method==='account/read')return {account:{type:'chatgpt'}};
   if(method==='config/read')return {config:{}};
   if(method==='thread/read'){
    if(p.threadId==='old-worker')return {thread:{id:'old-worker',parentThreadId:'parent',status:{type:'idle'},turns:[{id:'worker-done',status:'completed'}]}};
    if(p.threadId==='own-worker')return {thread:{id:'own-worker',parentThreadId:'child',status:{type:'idle'},turns:[{id:'own-done',status:'completed'}]}};
    if(p.threadId==='child')return {thread:{id:'child',forkedFromId:'parent',turns:[structuredClone(turns[0]),{id:'child-turn',status:'completed',items:[{id:'own-dispatch',type:'collabAgentToolCall',receiverThreadIds:['own-worker']}]}]}};
    return {thread:{id:'parent',turns:structuredClone(turns)}};
   }
   if(method==='thread/backgroundTerminals/list')return {data:backgroundCommand?[{id:'command',threadId:'parent',status:'running'}]:[],nextCursor:null};
   if(method==='thread/resume')return {thread:{id:p.threadId}};
   if(method==='thread/fork'){
    if(failure==='fork')throw Error('fork result unknown');
    configured=!!p.config?.mcp_servers?.k_gemini?.url&&!!p.developerInstructions;
    return {thread:{id:'child'},reasoningEffort:'medium'};
   }
   return {};
  }};};
 const c=createDesktopController({root,hostFactory,gatewayFactory:async()=>({mcpConfig:{mcpServers:{k_gemini:{url:'http://fixture/mcp',headers:{Authorization:'fixture'}}}},close:async()=>{}})});
 await c.open({threadId:'parent',model});
 return {c,root,calls,model,policy,visibleAtReadiness,finishBackground:()=>{backgroundCommand=false;}};
}

test('manual fork configures native MCP at creation and projects only the chosen completed point',async()=>{
 const f=await fixture({accessMode:'danger-full-access'});try{
  const result=await f.c.fork({messageId:'answer'});
  assert.equal(result.threadId,'child');assert.equal(f.c.state.status,'ready');
  const forks=f.calls.filter(x=>x.method==='thread/fork');assert.equal(forks.length,1);
  assert.equal(forks[0].p.lastTurnId,'point');assert.equal(forks[0].p.config.mcp_servers.k_gemini.url,'http://fixture/mcp');
  assert.equal(f.calls.some(x=>x.method==='thread/resume'&&x.p.threadId==='child'),false);
  assert.equal(f.calls.some(x=>x.method==='turn/start'),false);
  assert.deepEqual(f.c.state.messages.map(x=>x.text),['完成結論']);
  assert.equal(f.c.state.workerPolicy.model,f.policy.model);assert.equal(f.c.state.accessMode,'danger-full-access');
  const saved=(await listMainSessions(f.root,{threadId:'child'})).sessions[0];
  assert.equal(isVisibleMainSession(saved),true);assert.equal(saved.codexSession.hasSubmitted,true);
  assert.equal(saved.forkThroughTurnId,'point');
  assert.equal(isVisibleMainSession(f.visibleAtReadiness[0]),true);
 }finally{await f.c.close();}
});

test('MCP startup failure preserves a visible native branch and reports its known identity without replay',async()=>{
 const f=await fixture({failure:'mcp'});try{
  await assert.rejects(f.c.fork({messageId:'answer'}),e=>e.createdThreadId==='child'&&/startup failed/.test(e.message));
  const saved=(await listMainSessions(f.root,{threadId:'child'})).sessions[0];
  assert.equal(isVisibleMainSession(saved),true);assert.equal(saved.parentThreadId,'parent');assert.equal(saved.title,'來源 · 分支');
  assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,1);
  assert.equal(f.calls.some(x=>x.method==='turn/start'),false);
 }finally{await f.c.close();}
});

test('unknown native fork outcome never manufactures a child identity or retries',async()=>{
 const f=await fixture({failure:'fork'});try{
  await assert.rejects(f.c.fork({messageId:'answer'}),e=>!e.createdThreadId&&/fork result unknown/.test(e.message));
  assert.equal(f.calls.filter(x=>x.method==='thread/fork').length,1);
  assert.equal((await listMainSessions(f.root)).sessions.length,1);
 }finally{await f.c.close();}
});

test('inherited source workers remain historical tools, not child-owned workers, including after reopen',async()=>{
 const f=await fixture({sourceWorker:true});try{
  await f.c.fork({messageId:'answer'});
  assert.deepEqual(await f.c.workers(),[]);
  assert.ok(f.c.state.tools.some(t=>t.id==='old-dispatch'));
  f.c.state.status='completed'; // Exercise history reload rather than ready no-op.
  await f.c.open({threadId:'child',model:f.model});
  const workers=await f.c.workers();assert.deepEqual(workers.map(w=>w.threadId),['own-worker']);
  assert.equal(workers[0].settled,true);
  assert.ok(f.c.state.tools.some(t=>t.id==='old-dispatch'));
  assert.equal(f.calls.some(x=>x.method==='turn/interrupt'),false);
  assert.equal(f.calls.filter(x=>x.method==='thread/read'&&x.p.threadId==='parent'&&x.p.includeTurns===true).length,2,'one source open, one fork preparation; reopening child never reads parent history');
 }finally{await f.c.close();}
});

test('manual fork rejects a live background command without terminating it or creating a branch',async()=>{
 const f=await fixture({backgroundCommand:true});try{
  await assert.rejects(f.c.fork({messageId:'answer'}),/背景命令尚未結束/);
  assert.equal(f.calls.some(x=>x.method==='thread/fork'||x.method==='thread/backgroundTerminals/terminate'),false);
 }finally{f.finishBackground();await f.c.close();}
});

test('cancelled history navigation restores inherited worker ownership and historical tools',async()=>{
 const f=await fixture({sourceWorker:true});try{
  await f.c.fork({messageId:'answer'});const beforeTools=structuredClone(f.c.state.tools),abort=new AbortController();
  await assert.rejects(f.c.open({threadId:'parent',model:f.model},{signal:abort.signal,onHistory:()=>abort.abort(new DOMException('cancel','AbortError'))}),/cancel/);
  assert.equal(f.c.state.threadId,'child');assert.deepEqual(f.c.state.tools,beforeTools);assert.deepEqual(await f.c.workers(),[]);
  assert.equal(f.calls.some(x=>x.method==='turn/interrupt'),false);
 }finally{await f.c.close();}
});

test('manual fork cannot use inherited high privilege to raise a lower-privilege source',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.c.fork({messageId:'answer',accessMode:'danger-full-access'}),/permissionConfirmed/);
  assert.equal(f.calls.some(x=>x.method==='thread/fork'),false);
 }finally{await f.c.close();}
});

test('unified manual fork reports an already-created child even when adapter readiness throws',async()=>{
 const f=await fixture({failure:'mcp'});
 const absent=()=>({state:{usage:{}},models:async()=>({models:[]}),close:async()=>{}});
 const c=createUnifiedController({root:f.root,codexFactory:()=>f.c,claudeFactory:absent,geminiFactory:absent});
 try{
  await c.open({threadId:'parent',model:f.model});
  await assert.rejects(c.fork({messageId:'answer'}),/分支 child 已建立，接續指令尚未送出.*不要重複建立分支/);
  assert.equal(f.calls.some(x=>x.method==='turn/start'),false);
 }finally{await c.close();}
});
