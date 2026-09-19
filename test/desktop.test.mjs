import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
async function fixture({catalog,modelPages}={}){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'desktop-'));
 const calls=[];let hooks;let close;let modelPageIndex=0;
 const host={closed:new Promise(r=>{close=r;}),notify(){},waitForMcp:async()=>{},close:async()=>close(),request:async(method,p)=>{
  calls.push({method,p});
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='model/list'&&modelPages)return modelPages[modelPageIndex++]??{data:[],nextCursor:null};
  if(method==='model/list')return {data:(catalog??[]).length?catalog:[
   {model:'gpt-6-astra',displayName:'GPT-6 Astra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image']},
   {model:'gpt-5.6-sol',displayName:'GPT-5.6 Sol',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',inputModalities:['text','image']},
   {model:'gpt-5.6-terra',displayName:'GPT-5.6 Terra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']},
   {model:'gpt-5.6-luna',displayName:'GPT-5.6 Luna',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'minimal'},{reasoningEffort:'high'}],defaultReasoningEffort:'minimal',inputModalities:['text','image']},
   {model:'gpt-5.5',displayName:'GPT-5.5',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',inputModalities:['text','image']},
   {model:'gpt-5.3-codex-spark',displayName:'GPT-5.3 Codex Spark',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text']},
  ]};
  if(method==='thread/start'||method==='thread/resume')return {thread:{id:'test-thread'}};
  if(method==='thread/read')return {thread:{turns:[{items:[{type:'userMessage',id:'u-old',content:[{type:'text',text:'原始要求'}]},{type:'agentMessage',id:'a-old',text:'原回答'}]}]}};
  if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
  if(method==='turn/start'){hooks.onEvent({method:'turn/started',params:{threadId:'test-thread',turn:{id:'turn-1'}}});return {turn:{id:'turn-1'}};}
  if(method==='turn/interrupt')hooks.onEvent({method:'turn/completed',params:{threadId:'test-thread',turn:{id:'turn-1',status:'interrupted'}}});
  if(method==='mcpServer/tool/call')return {structuredContent:{status:'unresolved',outputFiles:[]}};
  return {};
 }};
 const c=createDesktopController({root,executable:'fixture',hostFactory:options=>{hooks=options;host.closed=new Promise(r=>{close=r;});return host;}});
 return {c,calls,root,host,get hooks(){return hooks;}};
}

test('direct work permissions are workspace-scoped, persisted, and may switch back to readonly',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});
  const start=f.calls.find(x=>x.method==='thread/start').p;
  assert.equal(start.config.approvals_reviewer,'user');assert.deepEqual(start.config.sandbox_workspace_write.writable_roots,[f.root]);assert.equal(start.config.sandbox_workspace_write.network_access,false);
  await assert.rejects(f.c.send({text:'bad',accessMode:'danger-full-access'}));
  await f.c.send({text:'read',accessMode:'read-only'});
  assert.deepEqual(f.calls.findLast(x=>x.method==='turn/start').p.sandboxPolicy,{type:'readOnly'});
  await f.c.stop();await f.c.open({model:'gpt-6-astra',threadId:'test-thread'});assert.equal(f.c.state.accessMode,'read-only');
  await f.c.send({text:'edit',accessMode:'workspace-write'});
  const turn=f.calls.findLast(x=>x.method==='turn/start').p;
  assert.equal(turn.sandboxPolicy.type,'workspaceWrite');assert.deepEqual(turn.sandboxPolicy.writableRoots,[f.root]);assert.equal(turn.sandboxPolicy.networkAccess,false);
  assert.equal((await f.c.sessions()).sessions[0].accessMode,'workspace-write');
 }finally{await f.c.close();}
});

test('native approvals show exact operations, resolve once, cancel on stop and reject stale requests',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'test'});
  const params={threadId:'test-thread',turnId:'turn-1',itemId:'cmd',command:'node task.mjs',cwd:f.root};
  let result=f.hooks.onRequest({id:1,method:'item/commandExecution/requestApproval',params});
  assert.equal(f.c.state.questions[0].details.command,params.command);
  const id=f.c.state.questions[0].id;f.c.answer({id,accept:true});assert.deepEqual(await result,{decision:'accept'});assert.throws(()=>f.c.answer({id,accept:true}));
  result=f.hooks.onRequest({id:2,method:'item/commandExecution/requestApproval',params});
  f.c.answer({id:f.c.state.questions[0].id,accept:false});assert.deepEqual(await result,{decision:'decline'});
  const file={id:'patch',type:'fileChange',status:'inProgress',changes:[{path:'result.txt',kind:{type:'add'},diff:'+hello'}]};
  f.hooks.onEvent({method:'item/started',params:{threadId:'test-thread',item:file}});
  result=f.hooks.onRequest({id:3,method:'item/fileChange/requestApproval',params:{...params,itemId:'patch'}});
  assert.deepEqual(f.c.state.questions[0].details.changes,file.changes);f.c.answer({id:f.c.state.questions[0].id,accept:true});assert.deepEqual(await result,{decision:'accept'});
  result=f.hooks.onRequest({id:4,method:'item/permissions/requestApproval',params:{...params,permissions:{network:{enabled:true}}}});
  f.c.answer({id:f.c.state.questions[0].id,accept:true});assert.deepEqual(await result,{permissions:{network:{enabled:true}},scope:'turn'});
  result=f.hooks.onRequest({id:5,method:'item/commandExecution/requestApproval',params});
  f.hooks.onEvent({method:'serverRequest/resolved',params:{threadId:'test-thread',requestId:5}});assert.deepEqual(await result,{decision:'cancel'});assert.equal(f.c.state.questions.length,0);
  result=f.hooks.onRequest({id:6,method:'item/commandExecution/requestApproval',params});await f.c.stop();assert.deepEqual(await result,{decision:'cancel'});assert.equal(f.c.state.questions.length,0);
  assert.equal(f.hooks.onRequest({method:'item/commandExecution/requestApproval',params}),undefined);
 }finally{await f.c.close();}
});

test('child approval is routed only after checking its parent and live turn',async()=>{
 const f=await fixture();const original=f.host.request;let parent='foreign',childStatus='inProgress';
 f.host.request=async(method,p)=>p?.threadId==='child'&&method==='thread/read'?{thread:{parentThreadId:parent,status:{type:childStatus==='inProgress'?'active':'idle'},turns:[{id:'child-turn',status:childStatus}]}}:original(method,p);
 try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'delegated'});
  f.hooks.onEvent({method:'item/started',params:{threadId:'test-thread',item:{id:'child-activity',type:'subAgentActivity',agentThreadId:'child',kind:'started'}}});
  const message={id:11,method:'item/commandExecution/requestApproval',params:{threadId:'child',turnId:'child-turn',itemId:'child-cmd',command:'node test.mjs'}};
  assert.equal(await f.hooks.onRequest(message),undefined);assert.equal(f.c.state.questions.length,0);
  parent='test-thread';const result=f.hooks.onRequest(message);await new Promise(setImmediate);
  assert.equal(f.c.state.questions[0].isSubagent,true);
  f.c.answer({id:f.c.state.questions[0].id,accept:false});assert.deepEqual(await result,{decision:'decline'});
  childStatus='completed';assert.equal(await f.hooks.onRequest(message),undefined);
 }finally{childStatus='completed';await f.c.close();}
});

test('completed main file changes join artifacts, survive worker refresh and reopen, exclude declined/outside files',async()=>{
 const f=await fixture();const changes=[{id:'good',type:'fileChange',status:'completed',changes:[{path:path.join(f.root,'result.txt'),kind:{type:'add'},diff:'+hello'}]},{id:'denied',type:'fileChange',status:'declined',changes:[{path:'denied.txt',kind:{type:'add'}}]},{id:'outside',type:'fileChange',status:'completed',changes:[{path:'../outside.txt',kind:{type:'add'}}]}];
 try{
  await f.c.open({model:'gpt-6-astra'});await writeFile(path.join(f.root,'result.txt'),'hello');
  for(const item of changes)f.hooks.onEvent({method:'item/completed',params:{threadId:'test-thread',item}});
  await f.c.workers();assert.deepEqual(f.c.state.artifacts,['result.txt']);assert.equal((await f.c.artifact('result.txt')).bytes.toString(),'hello');
  const original=f.host.request;f.host.request=async(method,p)=>method==='thread/read'?{thread:{turns:[{items:changes}]}}:original(method,p);
  await f.c.selectWorkspace({path:f.root});await f.c.open({model:'gpt-6-astra',threadId:'test-thread'});assert.deepEqual(f.c.state.artifacts,['result.txt']);
 }finally{await f.c.close();}
});
test('desktop scopes runtime to subscription and K; stream, approval, interruption never silently grant or replay',async()=>{
 const f=await fixture();const {c}=f;
 try{
  await c.open({model:'gpt-6-astra'});assert.equal(c.state.status,'ready');
  assert.equal(f.calls.find(x=>x.method==='thread/start').p.sandbox,'workspace-write');
  await c.send({text:'test'});await assert.rejects(c.send({text:'duplicate'}));
  f.hooks.onEvent({method:'item/agentMessage/delta',params:{threadId:'test-thread',itemId:'a',delta:'回答'}});assert.equal(c.state.messages.at(-1).text,'回答');
  const p={threadId:'test-thread',turnId:'turn-1',mode:'form',serverName:'k_flash',message:'Create output',requestedSchema:{properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{requestId:'once'}}};
  const result=f.hooks.onRequest({method:'mcpServer/elicitation/request',params:p});assert.equal(c.state.questions.length,1);
  assert.throws(()=>c.answer({id:c.state.questions[0].id}));
  const id=c.state.questions[0].id;c.answer({id,accept:false});assert.equal((await result).action,'decline');assert.throws(()=>c.answer({id,accept:true}));
  const approve=f.hooks.onRequest({method:'mcpServer/elicitation/request',params:p});c.answer({id:c.state.questions[0].id,accept:true});assert.equal((await approve).action,'accept');
  assert.equal(f.hooks.onRequest({method:'mcpServer/elicitation/request',params:{...p,threadId:'other'}}),undefined);
  await c.stop();assert.equal(c.state.status,'interrupted');assert.equal(c.state.busy,false);assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);
 }finally{await c.close();}
});

test('native goal, plan, steering, token usage and compaction stay on the first-party thread',async()=>{
 const f=await fixture();const original=f.host.request;
 f.host.request=async(method,p)=>{
  if(method==='turn/steer'){f.calls.push({method,p});return {turnId:p.expectedTurnId};}
  if(method==='thread/goal/set'){f.calls.push({method,p});return {goal:{threadId:p.threadId,objective:p.objective,status:p.status??'active',tokensUsed:7,timeUsedSeconds:2,createdAt:1,updatedAt:2}};}
  if(method==='thread/goal/clear'||method==='thread/compact/start'){f.calls.push({method,p});return {};}
  return original(method,p);
 };
 try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'long task'});
  assert.deepEqual(await f.c.steer({text:'use the newer constraint'}),{steered:true,turnId:'turn-1'});
  const steer=f.calls.findLast(call=>call.method==='turn/steer');assert.equal(steer.p.expectedTurnId,'turn-1');assert.equal(steer.p.input[0].text,'use the newer constraint');
  f.hooks.onEvent({method:'turn/plan/updated',params:{threadId:'test-thread',turnId:'turn-1',explanation:'current',plan:[{step:'verify',status:'inProgress'}]}});
  f.hooks.onEvent({method:'thread/tokenUsage/updated',params:{threadId:'test-thread',turnId:'turn-1',tokenUsage:{total:{totalTokens:123},last:{totalTokens:23},modelContextWindow:1000}}});
  assert.equal(f.c.state.progress.plan[0].step,'verify');assert.equal(f.c.state.progress.tokenUsage.total.totalTokens,123);
  const set=await f.c.goal({objective:'deliver verified result'});assert.equal(set.goal.objective,'deliver verified result');assert.equal(f.c.state.goal.status,'active');
  f.hooks.onEvent({method:'item/started',params:{threadId:'test-thread',turnId:'turn-1',item:{id:'compact-1',type:'contextCompaction'}}});assert.equal(f.c.state.progress.compaction,'compacting');
  f.hooks.onEvent({method:'item/completed',params:{threadId:'test-thread',turnId:'turn-1',item:{id:'compact-1',type:'contextCompaction'}}});assert.equal(f.c.state.progress.compaction,'completed');
  f.hooks.onEvent({method:'turn/completed',params:{threadId:'test-thread',turn:{id:'turn-1',status:'completed'}}});
  assert.deepEqual(await f.c.compact(),{requested:true});assert.equal(f.calls.findLast(call=>call.method==='thread/compact/start').p.threadId,'test-thread');
  await f.c.goal({clear:true});assert.equal(f.c.state.goal,null);
 }finally{await f.c.close();}
});

test('quota refresh is a coalesced read, accepts account events without thread ID, and preserves stale values on failure',async()=>{
 const f=await fixture();let reads=0,failed=false;
 const original=f.host.request;
 f.host.request=async(method,p)=>{
  if(method==='account/rateLimits/read'){reads++;if(failed)throw Error('offline');return {rateLimits:{primary:{usedPercent:34,windowDurationMins:10080}}};}
  return original(method,p);
 };
 try{
  await f.c.open({model:'gpt-6-astra'});await f.c.usage();
  assert.equal(f.c.state.usage.codex.windows[0].remainingPercent,66);
  const previous=reads;await Promise.all([f.c.usage(),f.c.usage()]);assert.equal(reads,previous);
  f.hooks.onEvent({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:35}}}});await f.c.usage();assert.equal(reads,previous+1);
  failed=true;await f.c.usage(true);assert.equal(f.c.state.usage.codex.status,'stale');assert.equal(f.c.state.usage.codex.windows[0].remainingPercent,66);
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
 }finally{await f.c.close();}
});

test('desktop attachment scope and restored display survive reopen without exposing generated context',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});
  await assert.rejects(f.c.upload({threadId:'other',name:'test.txt',base64:'YQ=='}));
  const a=await f.c.upload({threadId:'test-thread',name:'測試.txt',base64:Buffer.from('合計 19').toString('base64')});
  await f.c.send({text:'請整理附件',attachmentIds:[a.id]});
  const input=f.calls.find(x=>x.method==='turn/start').p.input;
  assert.match(input[0].text,/K_ATTACHMENT_CONTEXT/);assert.equal(f.c.state.messages[0].attachments[0].id,a.id);
  await f.c.stop();const original=f.host.request;
  f.host.request=async(method,p)=>method==='thread/read'?{thread:{turns:[{items:[{type:'userMessage',id:'restored',content:input}]}]}}:original(method,p);
  await f.c.open({model:'gpt-6-astra',threadId:'test-thread'});
  assert.equal(f.c.state.messages[0].text,'請整理附件');assert.equal(f.c.state.messages[0].attachments[0].name,'測試.txt');
  assert.equal((await f.c.attachmentFile(a.id)).bytes.toString(),'合計 19');
  await assert.rejects(f.c.artifact('README.md'));
 }finally{await f.c.close();}
});

test('stop during turn submission interrupts that same turn once instead of losing the stop',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});const original=f.host.request;let release,entered;
  const enteredPromise=new Promise(r=>{entered=r;});const gate=new Promise(r=>{release=r;});
  f.host.request=async(method,p)=>{if(method==='turn/start'){entered();await gate;}return original(method,p);};
  const sending=f.c.send({text:'開始測試'});await enteredPromise;
  const stopping=f.c.stop();release();await Promise.all([sending,stopping]);
  assert.equal(f.calls.filter(x=>x.method==='turn/start').length,1);assert.equal(f.calls.filter(x=>x.method==='turn/interrupt').length,1);
  assert.equal(f.c.state.status,'interrupted');assert.equal(f.c.state.busy,false);
 }finally{await f.c.close();}
});

test('stop keeps the desktop busy until its background command is confirmed terminated',async()=>{
 const f=await fixture();const original=f.host.request;let cleaned=false,release,entered;
 const enteredPromise=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 f.host.request=async(method,p)=>{
  if(method==='thread/backgroundTerminals/list')return {data:cleaned?[]:[{processId:'12',itemId:'command'}]};
  if(method==='thread/backgroundTerminals/clean'){assert.equal(p.threadId,'test-thread');entered();await gate;cleaned=true;return {};}
  return original(method,p);
 };
 try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'test stop'});
  f.hooks.onEvent({method:'item/started',params:{threadId:'test-thread',item:{id:'command',type:'commandExecution',status:'inProgress',command:'node test.mjs'}}});
  const stopping=f.c.stop();await enteredPromise;
  assert.equal(f.c.state.busy,true);assert.equal(f.c.state.status,'stopping');
  release();await stopping;
  assert.equal(f.c.state.status,'interrupted');assert.equal(f.c.state.busy,false);
  assert.equal(f.c.state.tools.find(t=>t.id==='command').status,'interrupted');
  assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,1);
 }finally{release();await f.c.close();}
});
test('desktop resumes only saved K conversations and displays original history',async()=>{
 const {c,root}=await fixture();try{
  await assert.rejects(c.open({model:'gpt-6-astra',threadId:'foreign'}));
  await c.open({model:'gpt-6-astra'});await c.selectWorkspace({path:root});await c.open({model:'gpt-6-astra',threadId:'test-thread'});
  assert.deepEqual(c.state.messages.map(m=>m.text),['原始要求','原回答']);
 }finally{await c.close();}
});

test('workspace switching binds Codex, Flash, attachments and saved history to the same folder',async()=>{
 const f=await fixture();const selected=path.join(f.root,'selected');await mkdir(selected);
 try{
  await f.c.selectWorkspace({path:selected});await f.c.open({model:'gpt-6-astra'});
  const start=f.calls.find(c=>c.method==='thread/start').p;
  assert.equal(start.cwd,selected);const args=start.config.mcp_servers.k_flash.args;assert.equal(args[args.indexOf('--workspace')+1],selected);
  const a=await f.c.upload({threadId:'test-thread',name:'中文.txt',base64:Buffer.from('人工資料').toString('base64')});
  assert.equal((await f.c.attachmentFile(a.id)).bytes.toString(),'人工資料');
  await f.c.send({text:'人工驗收'});await assert.rejects(f.c.selectWorkspace({path:f.root}));await f.c.stop();
  await f.c.selectWorkspace({path:f.root});assert.equal(f.c.state.threadId,null);assert.equal(f.c.state.messages.length,0);
  await assert.rejects(f.c.attachmentFile(a.id));
  await f.c.open({model:'gpt-6-astra',threadId:'test-thread'});assert.equal(f.c.state.workspace,selected);
  assert.equal((await f.c.sessions()).sessions[0].workspace,selected);
 }finally{await f.c.close();}
});

test('workspace selection rejects invalid locations without losing the current conversation',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await assert.rejects(f.c.selectWorkspace({path:path.parse(f.root).root}));
  assert.equal(f.c.state.threadId,'test-thread');assert.equal(f.c.state.status,'ready');
 }finally{await f.c.close();}
});
test('desktop HTTP denies foreign origins, unauthenticated API and implicit writes; serves UI and worker query without cancellation',async()=>{
 let stopArgument='not-called';
 const app=await startDesktop({root:'test',executable:'test',port:0,controllerFactory:()=>({state:{status:'idle'},sessions:async()=>({sessions:[]}),workers:async arg=>{stopArgument=arg;return [];},close:async()=>{}})});
 try{
  assert.equal((await fetch(app.origin+'/api/state')).status,403);
  const page=await fetch(app.origin);assert.match(await page.text(),/K 執行中樞/);const cookie=page.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(app.origin+'/api/state',{headers:{cookie}})).status,200);
  assert.equal((await fetch(app.origin+'/api/state',{headers:{cookie,origin:'https://foreign.example'}})).status,403);
  assert.equal((await fetch(app.origin+'/api/workers',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(app.origin+'/api/workers',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-K-Request':'1'},body:'{}'})).status,200);assert.equal(stopArgument,undefined);
  assert.equal((await fetch(app.origin+'/dsh/design-platform.css')).status,200);
 }finally{await app.close();}
});

test('HTTP attachment upload and artifact preview/download preserve bytes and reject unlisted paths',async()=>{
 const f=await fixture();await f.c.open({model:'gpt-6-astra'});
 const app=await startDesktop({root:f.root,executable:'test',port:0,controllerFactory:()=>f.c});
 try{
  const page=await fetch(app.origin);const cookie=page.headers.get('set-cookie').split(';')[0];
  const r=await fetch(app.origin+'/api/upload',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify({threadId:'test-thread',name:'結果.csv',base64:Buffer.from('name,total\r\nsynthetic,19\r\n').toString('base64')})});
  assert.equal(r.status,200);const a=await r.json();f.c.state.artifacts=[a.path];
  const preview=await fetch(app.origin+'/api/artifact?path='+encodeURIComponent(a.path),{headers:{cookie}});assert.equal((await preview.json()).text,'name,total\r\nsynthetic,19\r\n');
  const download=await fetch(app.origin+'/api/artifact?path='+encodeURIComponent(a.path)+'&download=1',{headers:{cookie}});
  assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.equal(await download.text(),'name,total\r\nsynthetic,19\r\n');
  assert.equal((await fetch(app.origin+'/api/artifact?path=README.md',{headers:{cookie}})).status,400);
  assert.equal((await fetch(app.origin+'/api/attachment?id='+a.id+'&download=1',{headers:{cookie}})).status,200);
  const stopped=await fetch(app.origin+'/api/stop',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-K-Request':'1'},body:'{}'});assert.deepEqual(await stopped.json(),{stopRequested:true});
 }finally{await app.close();}
});

test('model catalog reads every page, filters hidden entries, and does not start a thread',async()=>{
 const f=await fixture({modelPages:[
  {data:[{model:'gpt-5.6-terra',displayName:'Terra',hidden:false,inputModalities:['text'],supportedReasoningEfforts:[]},{model:'internal-hidden',displayName:'Hidden',hidden:true}],nextCursor:'page-2'},
  {data:[{model:'gpt-5.6-luna',displayName:'Luna',hidden:false,inputModalities:['text','image'],supportedReasoningEfforts:[]}],nextCursor:null},
 ]});
 try{
  const result=await f.c.models();
  assert.deepEqual(result.models.map(item=>item.model),['gpt-5.6-terra','gpt-5.6-luna']);
  assert.equal(result.models[0].displayName,'Terra');
  assert.equal(f.calls.filter(call=>call.method==='model/list').length,2);
  assert.equal(f.calls.some(call=>call.method==='thread/start'||call.method==='thread/resume'||call.method==='turn/start'),false);
 }finally{await f.c.close();}
});

test('Terra and Luna can be created with official display metadata and selected effort',async()=>{
 const f=await fixture();
 try{
  await f.c.open({model:'gpt-5.6-terra',effort:'high'});
  assert.equal(f.c.state.model,'gpt-5.6-terra');assert.equal(f.c.state.modelDisplayName,'GPT-5.6 Terra');
  assert.deepEqual(f.c.state.inputModalities,['text','image']);assert.deepEqual(f.c.state.efforts,['low','high']);
  const terraStart=f.calls.find(call=>call.method==='thread/start');assert.equal(terraStart.p.config.model_reasoning_effort,'high');assert.equal(terraStart.p.model_reasoning_effort,undefined);
  await f.c.open({model:'gpt-5.6-luna'});
  assert.equal(f.c.state.model,'gpt-5.6-luna');assert.equal(f.c.state.modelDisplayName,'GPT-5.6 Luna');
 }finally{await f.c.close();}
});

test('unknown model and unsupported effort are rejected before changing the current conversation',async()=>{
 const f=await fixture();
 try{
  await f.c.open({model:'gpt-6-astra'});const before={threadId:f.c.state.threadId,model:f.c.state.model,status:f.c.state.status};
  await assert.rejects(f.c.open({model:'not-in-picker'}),/未提供指定模型/);
  assert.deepEqual({threadId:f.c.state.threadId,model:f.c.state.model,status:f.c.state.status},before);
  await assert.rejects(f.c.open({model:'gpt-6-astra',effort:'ultra'}),/推理程度目前不可用/);
  assert.deepEqual({threadId:f.c.state.threadId,model:f.c.state.model,status:f.c.state.status},before);
 }finally{await f.c.close();}
});

test('text-only model refuses image input without sending an unsupported image part',async()=>{
 const f=await fixture();
 try{
  await f.c.open({model:'gpt-5.3-codex-spark'});
  const image=await f.c.upload({threadId:'test-thread',name:'pixel.png',base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')});
  await assert.rejects(f.c.send({text:'讀圖',attachmentIds:[image.id]}),/不支援圖片附件/);
  assert.equal(f.calls.filter(call=>call.method==='turn/start').length,0);
 }finally{await f.c.close();}
});

test('selected GPT worker persists independently of the main model and native configuration preserves authority',async()=>{
 const f=await fixture();const original=f.host.request;
 f.host.request=async(method,p)=>method==='config/read'?{config:{developer_instructions:'Existing user boundary.'}}:original(method,p);
 try{
  await f.c.open({model:'gpt-5.6-terra',effort:'high',workerPolicy:{model:'gpt-6-astra'}});
  const start=f.calls.find(c=>c.method==='thread/start').p;
  assert.equal(start.model,'gpt-5.6-terra');assert.equal(start.config.agents.default_subagent_model,'gpt-6-astra');
  assert.equal(start.sandbox,'workspace-write');assert.match(start.developerInstructions,/^Existing user boundary\./);
  assert.match(start.developerInstructions,/Delegation is optional/);
  assert.match(start.developerInstructions,/gpt-5.6-luna/);
  assert.equal((await f.c.sessions()).sessions[0].workerPolicy.model,'gpt-6-astra');
  assert.equal((await f.c.sessions()).sessions[0].effort,'high');
  await f.c.selectModel({threadId:'test-thread',model:'gpt-5.6-luna'});
  await f.c.open({model:'gpt-5.6-luna',threadId:'test-thread'});
  assert.equal(f.c.state.workerPolicy.model,'gpt-6-astra');
  assert.equal(f.calls.filter(c=>c.method==='thread/resume'&&c.p.threadId==='test-thread').length,0);
  assert.equal(f.calls.find(c=>c.method==='thread/start').p.config.model_reasoning_effort,'high');
  const before=f.c.state.threadId;
  await assert.rejects(f.c.open({model:'gpt-5.6-terra',workerPolicy:{model:'not-available'}}),/未自動換模/);
  assert.equal(f.c.state.threadId,before);
 }finally{await f.c.close();}
});

test('native subagent activity is tracked and a stop reaches the owned child',async()=>{
 const f=await fixture();const original=f.host.request;let childStopped=false;
 f.host.request=async(method,p)=>{
  if(p?.threadId==='native-child'){
   if(method==='turn/interrupt'){childStopped=true;return {};}
   if(method==='thread/read')return {thread:{parentThreadId:'test-thread',status:{type:childStopped?'idle':'active'},turns:[{id:'native-turn',status:childStopped?'interrupted':'inProgress'}]}};
  }
  return original(method,p);
 };
 try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'fixture'});
  f.hooks.onEvent({method:'item/completed',params:{threadId:'test-thread',item:{type:'collabAgentToolCall',id:'spawn',tool:'spawnAgent',status:'completed',senderThreadId:'test-thread',receiverThreadIds:['native-child'],agentsStates:{},model:'gpt-5.6-luna'}}});
  assert.equal(f.c.state.tools.at(-1).name,'spawnAgent');
  await f.c.stop();assert.equal(childStopped,true);
  assert.equal(f.c.state.workers.find(w=>w.threadId==='native-child').status,'cancelled');
 }finally{await f.c.close();}
});
