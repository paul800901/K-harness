import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClaudeController} from '../src/claude-controller.mjs';
import {saveAttachment} from '../src/desktop-files.mjs';
import {listMainSessions} from '../src/main-sessions.mjs';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {observeAtomicWrite} from './fixtures/observe-atomic-write.mjs';

async function fixture({models,waitForHost}={}) {
  const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
  await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'claude-controller-'));
  await writeFile(path.join(root,'README.md'),'fixture read target');
  await writeFile(path.join(root,'result.txt'),'fixture write target');
  const uuid='123e4567-e89b-42d3-a456-426614174000';
  let hostOptions,bridgeOptions,gatewayOptions,closeHost;
  const makeHost=()=>{let resolveClosed;return {startCalls:[],closed:new Promise(resolve=>{resolveClosed=resolve;}),async start(content){this.startCalls.push(content);},async interrupt(){this.interrupted=true;},async close(){resolveClosed();}};};let host;
  const bridge={closed:false,async list(){return this.records??[];},async start(args){this.records??=[];return args;},async cancel(){return {settled:true};},async wait(){return {settled:true};},async inspect(){return {settled:true};},async close(){this.closed=true;}};
  const gateway={mcpConfig:{mcpServers:{k_luna:{type:'http',url:'http://127.0.0.1:4567/mcp',headers:{Authorization:'Bearer test-token'}}}},async close(){this.closed=true;await gatewayOptions.bridge.close();}};
  const controller=createClaudeController({root,executable:'codex-test',commandSpec:{command:'claude-test',argsPrefix:[]},
    hostFactory:async options=>{hostOptions=options;host=makeHost();host.models=models;await waitForHost?.(options,host);return host;},
    bridgeFactory:async options=>{bridgeOptions=options;return bridge;},
    gatewayFactory:async options=>{gatewayOptions=options;return gateway;}});
  return {root,uuid,controller,get host(){return host;},bridge,gateway,get hostOptions(){return hostOptions;},get bridgeOptions(){return bridgeOptions;},get gatewayOptions(){return gatewayOptions;}};
}

test('saving one Claude conversation does not read other conversation projections',async()=>{
 const f=await fixture();const original=fs.readFile;let otherReads=0;
 try{
  const {threadId}=await f.controller.open({});
  const projection=JSON.parse(await readFile(path.join(f.root,'.runtime/claude-sessions',`${threadId}.json`),'utf8'));
  const id='claude-123e4567-e89b-42d3-a456-426614174099';
  const other=path.join(f.root,'.runtime/claude-sessions',`${id}.json`);
  await writeFile(other,JSON.stringify({...projection,threadId:id,nativeSessionId:id.slice(7),messages:[{role:'user',text:'unrelated'.repeat(10000)}]}));
  fs.readFile=(file,...args)=>{if(String(file)===other)otherReads++;return original(file,...args);};syncBuiltinESMExports();
  await f.controller.send({text:'only this conversation'});
  await f.controller.close();
  assert.equal(otherReads,0);
  assert.equal(JSON.parse(await original(other,'utf8')).threadId,id);
 }finally{fs.readFile=original;syncBuiltinESMExports();await f.controller.close();}
});

test('owned Luna artifacts are shown without accepting work or allowing foreign paths',async()=>{
 const f=await fixture();
 try{
  await f.controller.open({});await f.gatewayOptions.bridge.start({requestId:'one',task:'bounded'});
  f.bridgeOptions.onChange({requestId:'one',parentId:f.controller.state.threadId,outputFiles:['result.txt','../outside.txt'],acceptance:'not-reviewed',settled:true,status:'completed'});
  assert.deepEqual(f.controller.state.artifacts,['result.txt']);
  assert.equal(f.controller.state.workers[0].acceptance,'not-reviewed');
  assert.equal((await f.controller.artifact('result.txt')).bytes.toString(),'fixture write target');
  f.bridgeOptions.onChange({requestId:'other',parentId:'another-session',outputFiles:['README.md']});
  assert.deepEqual(f.controller.state.artifacts,['result.txt']);
 }finally{await f.controller.close();}
});

test('opens subscription host with native UUID and K Luna gateway, saves only a UI projection',async()=>{
  const f=await fixture();
  try {
    const opened=await f.controller.open({});
    assert.match(opened.threadId,/^claude-[0-9a-f-]{36}$/i);
    assert.equal(f.hostOptions.sessionId,opened.threadId.slice(7));
    assert.equal(f.hostOptions.resume,false);
    assert.equal(typeof f.gatewayOptions.bridge.start,'function');
    assert.equal(f.bridgeOptions,undefined,'opening Claude must not require or preflight Codex subscription');
    assert.deepEqual(f.hostOptions.mcpConfig,f.gateway.mcpConfig);
    assert.equal(f.controller.state.capabilities.steer,true);
    assert.equal(f.controller.state.capabilities.goal,false);
    assert.equal(f.controller.state.capabilities.compact,true);
    const projection=JSON.parse(await readFile(path.join(f.root,'.runtime','claude-sessions',`${opened.threadId}.json`),'utf8'));
    assert.equal(projection.nativeSessionId,f.uuid === projection.nativeSessionId ? f.uuid : f.hostOptions.sessionId);
    assert.equal(projection.messages.length,0);
    assert.equal((await f.controller.sessions()).sessions.length,1);
    const common=await listMainSessions(f.root);assert.equal(common.sessions[0].provider,'claude');
    assert.equal(common.sessions[0].workerPolicy.model,'gpt-6-luna');
  } finally { await f.controller.close(); }
});

test('project browser opt-in adds a dedicated MCP profile beside Luna for the Claude conversation',async()=>{
 const f=await fixture();
 try{
  await mkdir(path.join(f.root,'.runtime'),{recursive:true});
  await writeFile(path.join(f.root,'.runtime','browser-mcp.json'),'{"enabled":true}');
  const opened=await f.controller.open({});
  const servers=f.hostOptions.mcpConfig.mcpServers;
  assert.deepEqual(Object.keys(servers).sort(),['k_browser','k_luna']);
  assert.equal(servers.k_luna,f.gateway.mcpConfig.mcpServers.k_luna);
  assert.deepEqual(servers.k_browser.args,[path.join(f.root,'src','browser-mcp-stdio.mjs'),path.join(f.root,'.runtime','browser-output',opened.threadId.slice(7)),path.join(f.root,'.runtime','browser-profiles',opened.threadId.slice(7))]);
  assert.deepEqual(Object.keys(servers.k_browser).sort(),['args','command']);
  await f.controller.send({text:'以新的推理設定重開同一對話。',effort:'high'});
  assert.deepEqual(f.hostOptions.mcpConfig.mcpServers.k_browser.args,servers.k_browser.args);
  assert.equal(f.hostOptions.sessionId,opened.threadId.slice(7));
 }finally{await f.controller.close();}
});

test('Claude browser MCP is absent in plan mode and changes with native mode restarts',async()=>{
 const f=await fixture();
 try{
  await mkdir(path.join(f.root,'.runtime'),{recursive:true});
  await writeFile(path.join(f.root,'.runtime','browser-mcp.json'),' {"enabled":true}');
  await f.controller.open({accessMode:'claude-plan'});
  assert.equal(f.controller.state.browserAccess.enabled,false);
  assert.equal(f.hostOptions.mcpConfig.mcpServers.k_browser,undefined);
  const {threadId}=await f.controller.open({accessMode:'claude-manual'});
  assert.equal(f.controller.state.browserAccess.enabled,true);
  assert.ok(f.hostOptions.mcpConfig.mcpServers.k_browser);
  await f.controller.send({text:'以計畫模式重新接續',accessMode:'claude-plan'});
  assert.equal(f.controller.state.threadId,threadId);
  assert.equal(f.controller.state.browserAccess.enabled,false);
  assert.equal(f.hostOptions.mcpConfig.mcpServers.k_browser,undefined);
  assert.equal(f.hostOptions.sessionId,threadId.slice(7));
 }finally{await f.controller.close();}
});

test('sends one prompt, requires per-tool UI approval and persists resulting projection',async t=>{
  const f=await fixture();
  try {
    await f.controller.open({});
    await f.controller.send({text:'請檢查這個工作區'});
    assert.equal(f.host.startCalls.length,1);
    assert.equal(f.host.startCalls[0][0].text,'請檢查這個工作區');
    const permission=f.hostOptions.onPermission({toolName:'Read',input:{file_path:'README.md'}});
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(f.controller.state.questions.length,1);
    const question=f.controller.state.questions[0];
    assert.equal(question.details.toolName,'Read');
    await f.controller.answer({id:question.id,accept:true});
    assert.deepEqual(await permission,{behavior:'allow',updatedInput:{file_path:'README.md'}});
    const file=path.join(f.root,'.runtime','claude-sessions',`${f.controller.state.threadId}.json`);
    const persisted=observeAtomicWrite(t,file,record=>record.messages.length===2);
    f.hostOptions.onMessage({type:'assistant',uuid:'assistant-1',message:{content:[{type:'text',text:'已檢查。'}]}});
    f.hostOptions.onMessage({type:'result',is_error:false});
    assert.equal(f.controller.state.status,'completed');
    assert.equal(f.controller.state.messages.at(-1).text,'已檢查。');
    await persisted;
    assert.equal(f.controller.state.error,null);
    const projection=JSON.parse(await readFile(file,'utf8'));
    assert.equal(projection.messages.length,2);
    await f.controller.send({text:'下一個正常回合'});
    assert.equal(f.host.startCalls.length,2);
  } finally { await f.controller.close(); }
});

test('Claude exposes only native public status and actual context usage, never thinking blocks or inferred totals',async()=>{
 const f=await fixture();
 try{
  await f.controller.open({});
  const sent=await f.controller.send({text:'Check native visibility'});
  const turnId=f.controller.state.messages.at(-1).id;
  f.hostOptions.onMessage({type:'system',subtype:'status',status:'requesting',uuid:'status-1'});
  f.hostOptions.onMessage({type:'assistant',uuid:'assistant-1',message:{content:[{type:'thinking',thinking:'private hidden reasoning must not enter UI'},{type:'text',text:'visible answer'}]}});
  f.hostOptions.onMessage({type:'stream_event',event:{type:'message_start',message:{model:'claude-opus-5-5',usage:{input_tokens:4,cache_read_input_tokens:12,cache_creation_input_tokens:3,output_tokens:2}}}});
   f.hostOptions.onMessage({type:'rate_limit_event',uuid:'rate-limit-1',rate_limit_info:{status:'allowed',rateLimitType:'five_hour',overageStatus:'rejected',overageDisabledReason:'org_level_disabled'}});
   f.hostOptions.onMessage({type:'rate_limit_event',uuid:'rate-limit-2',rate_limit_info:{status:'allowed',rateLimitType:'five_hour',overageStatus:'rejected',overageDisabledReason:'org_level_disabled'}});
  f.hostOptions.onMessage({type:'result',is_error:false,user_message_uuid:turnId,usage:{input_tokens:4,cache_read_input_tokens:12,cache_creation_input_tokens:3,output_tokens:2},modelUsage:{'claude-opus-5-5':{inputTokens:140,cacheReadInputTokens:120,cacheCreationInputTokens:30,outputTokens:200,contextWindow:1000000}}});
  const state=f.controller.state;
  assert.equal(sent.sent,true);
  assert.deepEqual(state.notices,[]);
   assert.equal(state.usage.claude.rateLimitStatus,'allowed');
   assert.equal(state.usage.claude.extraUsageDisabled,true);
  for(const notice of state.notices)assert.ok(!Number.isNaN(Date.parse(notice.createdAt)));
  assert.equal(state.messages.at(-1).text,'visible answer');
  assert.deepEqual(state.reasoning,[]);
  assert.deepEqual(state.turnDiffs,[]);
  assert.equal(state.capabilities.reasoningSummary,false);
  assert.equal(state.capabilities.fileSearch,false);
  assert.equal(state.capabilities.review,false);
  assert.equal(state.capabilities.turnDiffs,false);
  assert.deepEqual(state.progress.tokenUsage,{last:{totalTokens:19,inputTokens:4,cacheReadInputTokens:12,cacheCreationInputTokens:3,measurement:'latest-native-request-input',source:'Claude Code stream-json message_start usage'},modelContextWindow:1000000});
  assert.equal(state.progress.tokenUsage.last.totalTokens,19,'context figure excludes output and is not result/modelUsage turn aggregate');
  assert.equal(state.progress.tokenUsage.total,undefined,'Claude emits per-result usage, not cumulative session token totals');
  assert.equal(JSON.stringify(state).includes('private hidden reasoning'),false);
 }finally{await f.controller.close();}
});

test('forwards Luna Codex approvals to the same UI queue and stop cancels pending approval',async()=>{
  const f=await fixture();
  try {
    await f.controller.open({});
    await f.gatewayOptions.bridge.start({requestId:'req-one',task:'檢查'});
    const approval=f.bridgeOptions.onRequest({id:1,method:'item/commandExecution/requestApproval',params:{command:'node test.mjs',cwd:f.root,reason:'執行測試'}});
    assert.equal(f.controller.state.questions.length,1);
    const q=f.controller.state.questions[0];assert.equal(q.provider,'codex-luna');assert.equal(q.details.command,'node test.mjs');
    await f.controller.answer({id:q.id,accept:false});
    assert.deepEqual(await approval,{decision:'decline'});
    const pending=f.hostOptions.onPermission({toolName:'Write',input:{file_path:'result.txt',content:'x'}});
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(f.controller.state.questions.length,1);
    await f.controller.stop();
    assert.deepEqual(await pending,{behavior:'deny',message:'使用者未核准或工作已停止。'});
    assert.equal(f.controller.state.status,'interrupted');
    assert.equal(f.gateway.closed,true);
    assert.equal(f.bridge.closed,true);
  } finally { await f.controller.close(); }
});

test('resumes only a saved Claude projection and forwards native UUID, never a Codex id',async()=>{
  const f=await fixture();
  try {
    const created=await f.controller.open({});
    await f.controller.send({text:'首個原生回合'});
    await f.controller.close();
    const reopened=await f.controller.open({threadId:created.threadId});
    assert.equal(reopened.threadId,created.threadId);
    assert.equal(f.hostOptions.sessionId,created.threadId.slice(7));
    assert.equal(f.hostOptions.resume,true);
  } finally { await f.controller.close(); }
});

test('native plan and manual modes defer all decisions to Claude Code and the UI',async()=>{
 const f=await fixture();
 try {
  await f.controller.open({accessMode:'read-only'});
    assert.equal(f.hostOptions.accessMode,'claude-plan');
    const planTool=f.hostOptions.onPermission({toolName:'Write',input:{file_path:'result.txt'}});
    await new Promise(resolve=>setImmediate(resolve));
    await f.controller.answer({id:f.controller.state.questions[0].id,accept:false});
    assert.equal((await planTool).behavior,'deny');
    await f.controller.stop();
    await f.controller.open({accessMode:'workspace-write'});
    const command=f.hostOptions.onPermission({toolName:'Bash',input:{command:'echo unsafe'}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.controller.state.questions[0].details.toolName,'Bash');
    await f.controller.answer({id:f.controller.state.questions[0].id,accept:false});
    assert.equal((await command).behavior,'deny');
  } finally { await f.controller.close(); }
});

test('native AskUserQuestion is presented and returned with native question-text keys',async()=>{
 const f=await fixture();
 try{
  await f.controller.open({});
  const pending=f.hostOptions.onPermission({toolName:'AskUserQuestion',input:{questions:[{question:'Which?',options:[{label:'A',description:'first'},{label:'B',description:'second'}]}]}});
  await new Promise(resolve=>setImmediate(resolve));
  const q=f.controller.state.questions[0];assert.equal(q.kind,'question');assert.equal(q.questions[0].id,'Which?');
  await f.controller.answer({id:q.id,answers:{'Which?':'A'}});
  assert.deepEqual(await pending,{behavior:'allow',updatedInput:{questions:[{question:'Which?',options:[{label:'A',description:'first'},{label:'B',description:'second'}]}],answers:{'Which?':'A'}}});
  const multiple=f.hostOptions.onPermission({toolName:'AskUserQuestion',input:{questions:[{question:'Choose several',multiSelect:true,options:[{label:'A'},{label:'B'}]}]}});
  await new Promise(resolve=>setImmediate(resolve));
  await f.controller.answer({id:f.controller.state.questions[0].id,answers:{'Choose several':['A','Other: custom']}});
  assert.equal((await multiple).updatedInput.answers['Choose several'],'A, Other: custom');
 }finally{await f.controller.close();}
});

test('changes native permission mode by reopening the same session before sending',async()=>{
 const f=await fixture();
 try{
  const opened=await f.controller.open({});
  await f.controller.send({text:'first'});
  f.hostOptions.onMessage({type:'result',is_error:false});
  const old=f.host;
  await f.controller.send({text:'second',accessMode:'claude-acceptEdits'});
  assert.equal(old.closed!==undefined,true);
  assert.equal(f.hostOptions.accessMode,'claude-acceptEdits');
  const saved=JSON.parse(await readFile(path.join(f.root,'.runtime','claude-sessions',`${opened.threadId}.json`),'utf8'));
  assert.equal(saved.accessMode,'claude-acceptEdits');
 }finally{await f.controller.close();}
});

test('compact uses Claude Code native slash command in the same session',async()=>{
 const f=await fixture();
 try{
  await f.controller.open({});
  await f.controller.compact();
  assert.equal(f.host.startCalls[0],'/compact');
  assert.equal(f.controller.state.progress.compaction,'compacting');
  assert.equal(f.controller.state.progress.compactions,0);
  const saved=JSON.parse(await readFile(path.join(f.root,'.runtime','claude-sessions',`${f.controller.state.threadId}.json`),'utf8'));
  assert.equal(saved.nativeStarted,true);
  f.hostOptions.onMessage({type:'result',is_error:false});
  assert.equal(f.controller.state.progress.compactions,1);
 }finally{await f.controller.close();}
});

test('choosing Claude effort updates persisted selection and restarts actual host on next send',async()=>{
 const f=await fixture();
 try{
  const {threadId}=await f.controller.open({effort:'low'});
  await f.controller.selectModel({threadId,model:'claude-opus-5-5',effort:'high'});
  assert.equal((await listMainSessions(f.root)).sessions[0].effort,'high');
  assert.equal(f.hostOptions.effort,'low');
  await f.controller.send({text:'Use selected effort'});
  assert.equal(f.hostOptions.effort,'high');
  assert.equal(f.controller.state.status,'working');
  assert.equal(f.controller.state.busy,true);
  f.hostOptions.onMessage({type:'stream_event',event:{type:'message_start',message:{id:'restarted-answer'}}});
  f.hostOptions.onMessage({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'text',text:''}}});
  f.hostOptions.onMessage({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Reply from replacement host'}}});
  assert.equal(f.controller.state.messages.at(-1).text,'Reply from replacement host');
  f.hostOptions.onMessage({type:'result',is_error:false});
  assert.equal(f.controller.state.status,'completed');
  await f.controller.selectModel({threadId,model:'claude-opus-5-5',effort:null});
  await f.controller.send({text:'Use native default'});
  assert.equal(f.hostOptions.effort,null);
 }finally{await f.controller.close();}
});

test('unexpected Claude host exit still transitions the conversation offline',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'active turn'});
  await f.host.close();await tick();
  assert.equal(f.controller.state.status,'offline');
  assert.equal(f.controller.state.busy,false);
 }finally{await f.controller.close();}
});

test('failed settings restart close remains uncertain and retains the existing host',async()=>{
 const f=await fixture();let restoreClose;try{
  const {threadId}=await f.controller.open({effort:'low'});
  await f.controller.selectModel({threadId,model:'claude-opus-5-5',effort:'high'});
  const retained=f.host;restoreClose=retained.close.bind(retained);
  retained.close=async()=>{throw new Error('settings close unconfirmed');};
  await assert.rejects(f.controller.send({text:'do not restart without confirmed close'}),/settings close unconfirmed/);
  assert.equal(f.host,retained);
  assert.equal(f.controller.state.status,'uncertain');
  assert.match(f.controller.state.error,/settings close unconfirmed/);
 }finally{if(f.host&&restoreClose)f.host.close=restoreClose;await f.controller.close();}
});

const tick=()=>new Promise(resolve=>setTimeout(resolve,40));
async function waitFor(predicate){
 const deadline=Date.now()+5000;
 while(!predicate()){
  assert.ok(Date.now()<deadline,'Expected asynchronous controller result was not observed.');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
}

test('Claude preserves a saved native model and rejects removed catalog IDs without replay',async()=>{
 const models=[{model:'claude-future',displayName:'Future',supportedReasoningEfforts:[{reasoningEffort:'ultra'}]},{model:'claude-second',displayName:'Second',supportedReasoningEfforts:[]}];
 const f=await fixture({models});
 try{
  const {threadId}=await f.controller.open({model:'claude-future',effort:'ultra'});
  await f.controller.open({threadId,model:'claude-future'});assert.equal(f.hostOptions.model,'claude-future');assert.equal(f.hostOptions.effort,'ultra');
  await f.controller.selectModel({threadId,model:'claude-second'});assert.equal(f.hostOptions.model,'claude-second');assert.equal((await listMainSessions(f.root)).sessions[0].model,'claude-second');assert.equal(f.host.startCalls.length,0);
  models.splice(1,1);await assert.rejects(f.controller.open({threadId,model:'claude-second'}),/未提供/);
  assert.equal((await listMainSessions(f.root)).sessions[0].model,'claude-second');
 }finally{await f.controller.close();}
});

test('cancelled Claude initialization closes a late host and does not turn ready; next open succeeds',async()=>{
 let entered,release,calls=0;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 const f=await fixture({waitForHost:async()=>{if(++calls===1){entered();await gate;}}});
 const pending=f.controller.open({});const rejected=assert.rejects(pending,/取消/);await started;
 const late=f.host;let closed=false;void late.closed.then(()=>{closed=true;});const stop=f.controller.stop();release();await stop;await rejected;
 assert.equal(closed,true);assert.notEqual(f.controller.state.status,'ready');assert.equal(f.controller.state.threadId,null);
 await f.controller.open({});assert.equal(f.controller.state.status,'ready');await f.controller.close();
});
test('Luna completion wakes the original Claude once after the current turn; no wait or inspect',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'delegate bounded work'});
  await f.gatewayOptions.bridge.start({requestId:'notify',task:'bounded'});
  const record={parentId:f.controller.state.threadId,requestId:'notify',settled:true,status:'completed',output:'done',outputFiles:[]};
  f.bridgeOptions.onChange(record);await tick();assert.equal(f.host.startCalls.length,1);
  f.hostOptions.onMessage({type:'result',is_error:false});await waitFor(()=>f.host.startCalls.length===2);
  assert.equal(f.host.startCalls.length,2);assert.match(f.host.startCalls[1][0].text,/K 工人完成通知/);
  f.bridgeOptions.onChange(record);f.hostOptions.onMessage({type:'result',is_error:false});await tick();
  assert.equal(f.host.startCalls.length,2);
  const saved=JSON.parse(await readFile(path.join(f.root,'.runtime/claude-sessions',`${f.controller.state.threadId}.json`),'utf8'));
  assert.equal(saved.workerNotifications.notify,'delivery-attempted');
 }finally{await f.controller.close();}
});
test('stopping clears queued notifications and late completion cannot wake Claude',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'work'});await f.gatewayOptions.bridge.start({requestId:'stop',task:'bounded'});
  const old=f.host,callback=f.bridgeOptions.onChange;
  callback({parentId:f.controller.state.threadId,requestId:'stop',settled:true,status:'completed',output:'done'});
  await f.controller.stop();callback({parentId:f.controller.state.threadId,requestId:'stop',settled:true,status:'completed',output:'done'});await tick();
  assert.equal(old.startCalls.length,1);assert.equal(old.interrupted,true);assert.equal(f.controller.state.status,'interrupted');
 }finally{await f.controller.close();}
});
test('uncertain completion delivery is not automatically retried',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'work'});await f.gatewayOptions.bridge.start({requestId:'uncertain',task:'bounded'});
  f.host.start=async()=>{throw Error('pipe uncertain');};
  const r={parentId:f.controller.state.threadId,requestId:'uncertain',settled:true,status:'completed',output:'done'};
  f.bridgeOptions.onChange(r);f.hostOptions.onMessage({type:'result',is_error:false});await waitFor(()=>f.controller.state.status==='uncertain');
  assert.equal(f.controller.state.status,'uncertain');assert.match(f.controller.state.error,/未重送/);
  f.bridgeOptions.onChange(r);await tick();assert.equal(f.controller.state.status,'uncertain');
 }finally{await f.controller.close();}
});
test('text attachments use UTF-8 byte threshold and workspace Read paths in plan mode',async()=>{
 const f=await fixture();try{
  await f.controller.open({accessMode:'claude-plan'});
  for(const text of ['a'.repeat(8192),'a'.repeat(8193),'中'.repeat(2800)]){
   const a=await f.controller.upload({threadId:f.controller.state.threadId,name:'input.txt',base64:Buffer.from(text).toString('base64')});
   await f.controller.send({text:'read the full attachment',attachmentIds:[a.id]});
   const sent=f.host.startCalls.at(-1)[1].text;
   const large=Buffer.byteLength(text)>8192;
   assert.equal(sent.includes('preview="true"'),large);
   assert.equal(sent.includes(text),!large);
   assert.ok(sent.includes(`bytes="${Buffer.byteLength(text)}"`));
   assert.ok(sent.includes(path.resolve(f.root,a.textPath)));
   assert.equal(await readFile(path.join(f.root,a.textPath),'utf8'),text);
   assert.equal(f.hostOptions.accessMode,'claude-plan');
   f.hostOptions.onMessage({type:'result',is_error:false});
  }
 }finally{await f.controller.close();}
});
test('Claude image and text attachment metadata survives native replay and projection reopen',async()=>{
 const f=await fixture();try{
  const {threadId}=await f.controller.open({});
  const pngBytes=Buffer.from([137,80,78,71,13,10,26,10]);
  const image=await f.controller.upload({threadId,name:'screen.png',base64:pngBytes.toString('base64')});
  const text=await f.controller.upload({threadId,name:'notes.txt',base64:Buffer.from('fixture notes').toString('base64')});
  await f.controller.send({text:'看看？',attachmentIds:[image.id,text.id]});

  const sent=f.host.startCalls.at(-1);
  assert.deepEqual(sent.find(part=>part.type==='image')?.source,{type:'base64',media_type:'image/png',data:pngBytes.toString('base64')});
  assert.ok(sent.some(part=>part.type==='text'&&part.text.includes('fixture notes')));
  const user=f.controller.state.messages.find(message=>message.role==='user'&&message.text==='看看？');
  const expected=[image,text].map(({id,name,size,kind})=>({id,name,size,kind}));
  assert.deepEqual(user.attachments.map(({id,name,size,kind})=>({id,name,size,kind})),expected);

  f.hostOptions.onMessage({type:'user',uuid:user.id,isReplay:true,message:{content:[{type:'image'}]}});
  assert.equal(user.delivery,'received');
  assert.deepEqual(user.attachments.map(({id,name,size,kind})=>({id,name,size,kind})),expected);
  f.hostOptions.onMessage({type:'result',is_error:false});
  await f.controller.close();

  await f.controller.open({threadId});
  const reopened=f.controller.state.messages.find(message=>message.id===user.id);
  assert.deepEqual(reopened.attachments.map(({id,name,size,kind})=>({id,name,size,kind})),expected);
 }finally{await f.controller.close();}
});
test('Claude rejects a foreign-thread attachment before starting a native turn',async()=>{
 const f=await fixture();try{
  const {threadId}=await f.controller.open({});
  const foreign=await saveAttachment(f.root,'foreign-thread',{name:'foreign.txt',base64:Buffer.from('foreign').toString('base64')});
  await assert.rejects(f.controller.send({text:'不可送出',attachmentIds:[foreign.id]}),/不能把其他對話的附件帶入/);
  assert.equal(f.host.startCalls.length,0);
  assert.notEqual(f.controller.state.status,'working');
 }finally{await f.controller.close();}
});
test('quota reads official control without model turns, throttles, preserves stale values',async()=>{
 const f=await fixture();try{
  await f.controller.open({});let calls=0;
  f.host.usage=async()=>{calls++;return {rate_limits_available:true,subscription_type:'pro',rate_limits:{five_hour:{utilization:4,resets_at:'2026-09-24T09:00:00Z'},seven_day:{utilization:1,resets_at:null}}};};
  const first=await f.controller.usage();assert.equal(first.claude.windows[0].remainingPercent,96);
  await f.controller.usage();assert.equal(calls,1);assert.equal(f.host.startCalls.length,0);
  f.host.usage=async()=>{throw Error('offline');};
  const stale=await f.controller.usage(true);assert.equal(stale.claude.status,'stale');assert.equal(stale.claude.windows[0].remainingPercent,96);
  f.hostOptions.onMessage({type:'rate_limit_event',uuid:'rate-limit-usage',rate_limit_info:{status:'allowed',overageStatus:'rejected',overageDisabledReason:'org_level_disabled'}});
  const refreshed=await f.controller.usage(true);assert.equal(refreshed.claude.rateLimitStatus,'allowed');assert.equal(refreshed.claude.extraUsageDisabled,true);
 }finally{await f.controller.close();}
});

for(const method of ['start','wait','inspect','cancel'])test(`manual ${method} settled result suppresses subsequent completion notification`,async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'work'});
  await f.gatewayOptions.bridge.start({requestId:'manual',task:'bounded'});
  const r={parentId:f.controller.state.threadId,requestId:'manual',settled:true,status:'completed',output:'done'};
  f.bridgeOptions.onChange(r);f.bridge[method]=async()=>r;
  const result=await f.gatewayOptions.bridge[method]({requestId:'manual',task:'bounded'});
  f.gatewayOptions.bridge.resultReady({requestId:'manual'},result);
  f.hostOptions.onMessage({type:'result',is_error:false});await tick();
  f.bridgeOptions.onChange(r);await tick();assert.equal(f.host.startCalls.length,1);
 }finally{await f.controller.close();}
});
test('unresolved observation does not consume final completion notification',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'work'});await f.gatewayOptions.bridge.start({requestId:'later',task:'bounded'});
  const r={parentId:f.controller.state.threadId,requestId:'later',settled:false,status:'unresolved'};
  f.bridgeOptions.onChange(r);f.hostOptions.onMessage({type:'result',is_error:false});await tick();assert.equal(f.host.startCalls.length,1);
  f.bridgeOptions.onChange({...r,settled:true,status:'completed',output:'done'});await waitFor(()=>f.host.startCalls.length===2);assert.equal(f.host.startCalls.length,2);
  assert.equal(f.controller.state.messages.at(-1).kind,'worker-completion');
 }finally{await f.controller.close();}
});
test('pre-send result preparation failure keeps conversation usable without replay',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'work'});await f.gatewayOptions.bridge.start({requestId:'bad',task:'bounded'});
  const r={parentId:f.controller.state.threadId,requestId:'bad',settled:true,status:'completed',output:'x'.repeat(5000),workspace:'relative-invalid'};
  f.bridgeOptions.onChange(r);f.hostOptions.onMessage({type:'result',is_error:false});await waitFor(()=>f.controller.state.error?.includes('luna_inspect'));
  assert.equal(f.controller.state.status,'completed');assert.equal(f.controller.state.busy,false);assert.match(f.controller.state.error,/luna_inspect/);
  assert.equal(f.host.startCalls.length,1);f.bridgeOptions.onChange(r);await tick();assert.equal(f.host.startCalls.length,1);
  await f.controller.send({text:'continue normally'});assert.equal(f.host.startCalls.length,2);
 }finally{await f.controller.close();}
});
test('switching workspace suppresses cancellation and late completion events',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'work'});await f.gatewayOptions.bridge.start({requestId:'switch',task:'bounded'});
  f.hostOptions.onMessage({type:'result',is_error:false});await tick();
  const old=f.host,r={parentId:f.controller.state.threadId,requestId:'switch',settled:false,status:'running'};
  f.bridge.records=[r];f.bridge.cancel=async()=>{f.bridgeOptions.onChange({...r,settled:true,status:'cancelled'});await tick();return {settled:true};};
  await f.controller.selectWorkspace({path:f.root});f.bridgeOptions.onChange({...r,settled:true,status:'completed'});await tick();
  assert.equal(old.startCalls.length,1);assert.equal(f.controller.state.status,'idle');
 }finally{await f.controller.close();}
});
test('idle quota refresh uses five-minute interval and manual refresh bypasses it',async()=>{
 const f=await fixture();const now=Date.now;let time=now();Date.now=()=>time;
 try{
  await f.controller.usage();const first=f.host;
  time+=61000;await f.controller.usage();assert.equal(f.host,first);
  time+=240000;await f.controller.usage();assert.notEqual(f.host,first);
  const second=f.host;await f.controller.usage(true);assert.notEqual(f.host,second);
 }finally{Date.now=now;await f.controller.close();}
});

test('manual unfinished inspection keeps automatic completion armed',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'work'});await f.gatewayOptions.bridge.start({requestId:'running',task:'bounded'});
  f.gatewayOptions.bridge.resultReady({requestId:'running'},{settled:false,status:'running'});
  f.bridgeOptions.onChange({parentId:f.controller.state.threadId,requestId:'running',settled:true,status:'completed',output:'done'});
  f.hostOptions.onMessage({type:'result',is_error:false});await waitFor(()=>f.host.startCalls.length===2);assert.equal(f.host.startCalls.length,2);
 }finally{await f.controller.close();}
});
test('manual cancel disarms before an uncertain cancellation result',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'work'});await f.gatewayOptions.bridge.start({requestId:'cancel-uncertain',task:'bounded'});
  f.bridge.cancel=async()=>{throw Error('cancel unconfirmed');};
  await assert.rejects(f.gatewayOptions.bridge.cancel({requestId:'cancel-uncertain'}),/unconfirmed/);
  f.bridgeOptions.onChange({parentId:f.controller.state.threadId,requestId:'cancel-uncertain',settled:true,status:'completed',output:'late'});
  f.hostOptions.onMessage({type:'result',is_error:false});await tick();assert.equal(f.host.startCalls.length,1);
 }finally{await f.controller.close();}
});

test('native Claude input acknowledges UUID and does not finish before deferred input result',async()=>{
 const f=await fixture();try{
 await f.controller.open({});await f.controller.send({text:'A'});
 await f.controller.steer({text:'C'});const c=f.controller.state.messages.at(-1);
 assert.equal(c.source,'steer');assert.equal(c.groupId,f.controller.state.messages[0].groupId);
 f.hostOptions.onMessage({type:'result',is_error:false});assert.equal(f.controller.state.busy,true);
 f.hostOptions.onMessage({type:'user',uuid:c.id,isReplay:true,message:{content:'C'}});assert.equal(c.delivery,'received');
 f.hostOptions.onMessage({type:'result',is_error:false});assert.equal(f.controller.state.busy,false);
 }finally{await f.controller.close();}
});

test('native Claude fork requests new session with source history and preserves original projection',async()=>{
 const f=await fixture();try{
 await f.controller.open({});await f.controller.send({text:'ORIGINAL'});
 f.hostOptions.onMessage({type:'assistant',uuid:'answer',message:{content:[{type:'text',text:'conclusion'}]}});
 f.hostOptions.onMessage({type:'result',is_error:false});
 assert.equal(f.controller.state.messages.at(-1).partial,undefined);
 const parent=f.controller.state.threadId;
 const r=await f.controller.fork({messageId:'answer',accessMode:'claude-auto'});
 assert.notEqual(r.threadId,parent);assert.equal(f.hostOptions.forkFrom,parent.slice(7));assert.equal(f.hostOptions.accessMode,'claude-auto');
 assert.equal(f.controller.state.messages[0].text,'ORIGINAL');
 const original=JSON.parse(await readFile(path.join(f.root,'.runtime/claude-sessions',parent+'.json'),'utf8'));
 assert.equal(original.messages.at(-1).text,'conclusion');
 }finally{await f.controller.close();}
});

test('Claude fork requires explicit confirmation when escalating to bypass permissions',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'ORIGINAL'});
  f.hostOptions.onMessage({type:'assistant',uuid:'answer',message:{content:[{type:'text',text:'conclusion'}]}});
  f.hostOptions.onMessage({type:'result',is_error:false});
  await assert.rejects(f.controller.fork({messageId:'answer',accessMode:'claude-bypassPermissions'}),/permissionConfirmed:true/);
  await f.controller.fork({messageId:'answer',accessMode:'claude-bypassPermissions',permissionConfirmed:true});
  assert.equal(f.hostOptions.accessMode,'claude-bypassPermissions');
 }finally{await f.controller.close();}
});

test('stopped Claude partial answer is persisted and cannot be forked',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'ORIGINAL'});
  f.hostOptions.onMessage({type:'assistant',uuid:'answer-partial',message:{content:[{type:'text',text:'unfinished'}]}});
  assert.equal(f.controller.state.messages.at(-1).partial,true);
  await f.controller.stop();
  assert.equal(f.controller.state.messages.at(-1).partial,true);
  await assert.rejects(f.controller.fork({messageId:'answer-partial'}),/尚未完成/);
  const saved=JSON.parse(await readFile(path.join(f.root,'.runtime/claude-sessions',f.controller.state.threadId+'.json'),'utf8'));
  assert.equal(saved.messages.at(-1).partial,true);
 }finally{await f.controller.close();}
});

test('replay does not restart Claude while fresh assistant and tool-result events start the next native turn',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'first'});
  f.hostOptions.onMessage({type:'result',is_error:false});
  assert.equal(f.controller.state.busy,false);assert.equal(f.controller.state.status,'completed');
  f.hostOptions.onMessage({type:'assistant',isReplay:true,uuid:'old-assistant',message:{content:[{type:'text',text:'old answer'}]}});
  assert.equal(f.controller.state.busy,false);assert.equal(f.controller.state.status,'completed');
  f.hostOptions.onMessage({type:'assistant',uuid:'tool-call',message:{content:[{type:'tool_use',id:'tool-1',name:'Read',input:{file_path:'README.md'}}]}});
  assert.equal(f.controller.state.busy,true);assert.equal(f.controller.state.status,'working');
  f.hostOptions.onMessage({type:'result',is_error:false});
  assert.equal(f.controller.state.busy,false);assert.equal(f.controller.state.status,'completed');
  f.hostOptions.onMessage({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'read'}]}});
  assert.equal(f.controller.state.busy,true);assert.equal(f.controller.state.status,'working');
  await f.controller.stop();
  f.hostOptions.onMessage({type:'assistant',uuid:'late-answer',message:{content:[{type:'text',text:'late'}]}});
  f.hostOptions.onMessage({type:'result',is_error:false});
  assert.equal(f.controller.state.busy,false);assert.equal(f.controller.state.status,'interrupted');
 }finally{await f.controller.close();}
});

test('native partial text merges with final envelopes despite intervening thinking and child events',async()=>{
 const f=await fixture();try{
  await f.controller.open({});await f.controller.send({text:'stream test'});const emit=f.hostOptions.onMessage;
  const stream=event=>emit({type:'stream_event',event,parent_tool_use_id:null});
  stream({type:'message_start',message:{id:'native-msg',usage:{input_tokens:12,cache_read_input_tokens:3,cache_creation_input_tokens:0}}});
  emit({type:'assistant',uuid:'thinking-envelope',message:{id:'native-msg',content:[{type:'thinking',thinking:'not displayed'}]}});
  stream({type:'content_block_start',index:1,content_block:{type:'text',text:''}});
  stream({type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Hello'}});
  assert.equal(f.controller.state.messages.at(-1).text,'Hello');
  assert.equal(f.controller.state.messages.at(-1).streaming,true);
  emit({type:'stream_event',parent_tool_use_id:'child-tool',event:{type:'message_start',message:{id:'child-msg'}}});
  stream({type:'content_block_delta',index:1,delta:{type:'text_delta',text:' world'}});
  emit({type:'assistant',uuid:'final-envelope',message:{id:'native-msg',content:[{type:'text',text:'Hello world'}]}});
  stream({type:'message_stop'});
  const rows=f.controller.state.messages.filter(m=>m.role==='assistant');assert.equal(rows.length,1);assert.equal(rows[0].text,'Hello world');assert.equal(rows[0].streaming,undefined);
  assert.equal(f.controller.state.progress.tokenUsage.last.totalTokens,15);
  emit({type:'result',is_error:false});assert.equal(f.controller.state.messages.at(-1).partial,undefined);
  stream({type:'content_block_delta',index:1,delta:{type:'text_delta',text:'orphan'}});assert.equal(f.controller.state.busy,false);
  // Native next turn can begin after the preceding result, while replay cannot wake it.
  emit({type:'stream_event',isReplay:true,event:{type:'message_start',message:{id:'replay'}}});assert.equal(f.controller.state.busy,false);
  stream({type:'message_start',message:{id:'next'}});assert.equal(f.controller.state.busy,true);
  await f.controller.stop();stream({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'late'}});assert.equal(f.controller.state.busy,false);assert.equal(f.controller.state.messages.at(-1).text,'Hello world');
 }finally{await f.controller.close();}
});


test('busy Claude accepts draft attachments without sending or interrupting the active turn',async()=>{
 const f=await fixture();try{await f.controller.open({});await f.controller.send({text:'A'});
 for(let i=0;i<3;i++)f.hostOptions.onMessage({type:'system',subtype:'status',status:'requesting',uuid:`status-${i}`});
 assert.deepEqual(f.controller.state.notices,[]);
 const a=await f.controller.upload({threadId:f.controller.state.threadId,name:'queued.txt',base64:Buffer.from('B fixture').toString('base64')});
 assert.ok(a.id);assert.equal(f.controller.state.busy,true);assert.equal(f.host.startCalls.length,1);
 await assert.rejects(f.controller.upload({threadId:'foreign',name:'x.txt',base64:'WA=='}),/對話已切換/);
 }finally{await f.controller.close();}
});

test('native Claude child events belong to workers and do not enter the main conclusion',async()=>{
 const f=await fixture();try{
  await f.controller.open({});
  const emit=f.hostOptions.onMessage;
  emit({type:'assistant',uuid:'agent-call',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'agent-1',name:'Agent',input:{description:'Inspect the tests',prompt:'Find relevant tests'}}]}});
  emit({type:'user',uuid:'child-prompt',parent_tool_use_id:'agent-1',message:{content:'Find relevant tests'}});
  emit({type:'assistant',uuid:'child-answer',parent_tool_use_id:'agent-1',message:{content:[{type:'text',text:'Found two focused tests.'}]}});
  assert.equal(f.controller.state.workers.length,1);
  assert.equal(f.controller.state.workers[0].provider,'claude-native');
  assert.equal(f.controller.state.workers[0].requestId,'agent-1');
  assert.equal(f.controller.state.workers[0].task,'Inspect the tests');
  assert.equal(f.controller.state.workers[0].prompt,'Find relevant tests');
  assert.equal(f.controller.state.workers[0].output,'Found two focused tests.');
  assert.equal(f.controller.state.messages.some(item=>item.text?.includes('Found two focused tests.')),false);
  emit({type:'user',uuid:'tool-return',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'agent-1',content:'completed'}]}});
  assert.equal(f.controller.state.workers[0].status,'unresolved','a result block alone cannot distinguish completed from async_launched');
  emit({type:'user',uuid:'tool-return-authoritative',parent_tool_use_id:null,tool_use_result:{status:'completed',agentId:'native-agent-1',content:[],totalToolUseCount:2,totalDurationMs:40,totalTokens:12,usage:{input_tokens:8,output_tokens:4}},message:{content:[{type:'tool_result',tool_use_id:'agent-1',content:'completed'}]}});
  assert.equal(f.controller.state.workers[0].status,'completed','explicit SDK AgentOutput metadata establishes synchronous completion');
  assert.equal(f.controller.state.workers[0].settled,true);
  emit({type:'assistant',uuid:'child-answer-late-new-id',parent_tool_use_id:'agent-1',message:{content:[{type:'text',text:'late child event'}]}});
  assert.equal(f.controller.state.workers[0].status,'completed','late child events cannot revive a settled worker');
  assert.equal(f.controller.state.messages.some(item=>item.text?.includes('Find relevant tests')),false);
 }finally{await f.controller.close();}
});

test('native AgentOutput async and ambiguous results never claim synchronous completion',async()=>{
 const f=await fixture();try{
  await f.controller.open({});const emit=f.hostOptions.onMessage;
  emit({type:'assistant',uuid:'agent-async-call',message:{content:[{type:'tool_use',id:'agent-async',name:'Agent',input:{description:'Async child',prompt:'Continue later'}}]}});
  emit({type:'assistant',uuid:'child-async',parent_tool_use_id:'agent-async',message:{content:[{type:'text',text:'started'}]}});
  emit({type:'user',uuid:'async-result',toolUseResult:{status:'async_launched',agentId:'native-agent-async'},message:{content:[{type:'tool_result',tool_use_id:'agent-async',content:'running'}]}});
  assert.equal(f.controller.state.workers[0].status,'unresolved');
  emit({type:'assistant',uuid:'agent-other-call',message:{content:[{type:'tool_use',id:'agent-other',name:'Agent',input:{description:'Other child',prompt:'Continue'}}]}});
  emit({type:'assistant',uuid:'child-other',parent_tool_use_id:'agent-other',message:{content:[{type:'text',text:'started'}]}});
  emit({type:'user',uuid:'ambiguous-result',tool_use_result:{status:'completed',agentId:'wrong-association'},message:{content:[{type:'tool_result',tool_use_id:'agent-other',content:'done'},{type:'tool_result',tool_use_id:'agent-async',content:'done'}]}});
  assert.equal(f.controller.state.workers.find(item=>item.requestId==='agent-other').status,'unresolved');
 }finally{await f.controller.close();}
});

test('late native child events after stop cannot recreate or revive workers',async()=>{
 const f=await fixture();try{
  await f.controller.open({});const emit=f.hostOptions.onMessage;
  emit({type:'assistant',uuid:'agent-live-call',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'agent-live',name:'Agent',input:{description:'Live child',prompt:'Probe only'}}]}});
  emit({type:'assistant',uuid:'child-live',parent_tool_use_id:'agent-live',message:{content:[{type:'text',text:'Working'}]}});
  await f.controller.stop();
  emit({type:'assistant',uuid:'child-late',parent_tool_use_id:'late-agent',message:{content:[{type:'text',text:'late'}]}});
  emit({type:'assistant',uuid:'child-live',parent_tool_use_id:'agent-live',message:{content:[{type:'text',text:'Working'}]}});
  assert.equal(f.controller.state.workers.length,1);
  assert.equal(f.controller.state.workers[0].status,'interrupted');
  assert.equal(f.controller.state.workers[0].settled,true);
  assert.equal(f.controller.state.workers[0].output,'Working');
 }finally{await f.controller.close();}
});

test('native child is not settled by interrupt request until host closure is confirmed',async()=>{
 const f=await fixture();try{
  await f.controller.open({});
  f.hostOptions.onMessage({type:'assistant',uuid:'agent-stop-call',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'agent-stop',name:'Agent',input:{description:'Pending child',prompt:'Wait'}}]}});
  f.hostOptions.onMessage({type:'assistant',uuid:'child-stop',parent_tool_use_id:'agent-stop',message:{content:[{type:'text',text:'Still working'}]}});
  let confirmClose;
  f.host.close=()=>new Promise(resolve=>{confirmClose=resolve;});
  const stopping=f.controller.stop();
  await tick();
  assert.equal(f.host.interrupted,true);
  assert.notEqual(f.controller.state.workers[0].settled,true,'interrupt request alone is not proof of termination');
  confirmClose();await stopping;
  assert.equal(f.controller.state.workers[0].status,'interrupted');
  assert.equal(f.controller.state.workers[0].settled,true);
 }finally{await f.controller.close();}
});

test('failed Claude close retains host for retries and never reports a second failed close as success',async()=>{
 const f=await fixture();try{
  await f.controller.open({});
  const retained=f.host,original=retained.close.bind(retained);let closes=0;
  retained.close=async()=>{closes++;if(closes<3)throw new Error(`close attempt ${closes} unconfirmed`);return original();};
  await assert.rejects(f.controller.close(),/close attempt 1 unconfirmed/);
  assert.equal(f.controller.state.status,'uncertain');assert.equal(f.host,retained);
  await assert.rejects(f.controller.close(),/close attempt 2 unconfirmed/);
  assert.equal(f.controller.state.status,'uncertain');assert.equal(f.host,retained);assert.equal(closes,2);
  await f.controller.close();
  assert.equal(closes,3);assert.equal(f.controller.state.status,'offline');
 }finally{await f.controller.close();}
});

test('failed Claude stop retains host and a later confirmed stop can retry it',async()=>{
 const f=await fixture();try{
  await f.controller.open({});
  const retained=f.host,original=retained.close.bind(retained);let closes=0;
  retained.close=async()=>{closes++;if(closes===1)throw new Error('stop close unconfirmed');return original();};
  await assert.rejects(f.controller.stop(),/stop close unconfirmed/);
  assert.equal(f.controller.state.status,'uncertain');assert.equal(f.host,retained);assert.equal(closes,1);
  await f.controller.stop();
  assert.equal(closes,2);assert.equal(f.controller.state.status,'interrupted');
 }finally{await f.controller.close();}
});

test('Claude TodoWrite replaces the progress plan using the official schema',async()=>{
 const f=await fixture();try{
  await f.controller.open({});const emit=f.hostOptions.onMessage;
  emit({type:'assistant',uuid:'todos',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'todo-1',name:'TodoWrite',input:{todos:[{content:'Inspect events',status:'in_progress',activeForm:'Inspecting events'},{content:'Add tests',status:'pending',activeForm:'Adding tests'}]}}]}});
  assert.deepEqual(f.controller.state.progress.plan,[{step:'Inspect events',status:'in_progress',activeForm:'Inspecting events'},{step:'Add tests',status:'pending',activeForm:'Adding tests'}]);
  emit({type:'assistant',uuid:'bad-todos',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'todo-2',name:'TodoWrite',input:{todos:[{content:'Bad',status:'unknown',activeForm:'Bad'}]}}]}});
  assert.equal(f.controller.state.progress.plan.length,2);
 }finally{await f.controller.close();}
});

test('Claude ExitPlanMode presents existing plan at the native approval entry point',async()=>{
 const f=await fixture();try{
  await f.controller.open({});const emit=f.hostOptions.onMessage;
  emit({type:'assistant',uuid:'todos-for-plan',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'todo-plan',name:'TodoWrite',input:{todos:[{content:'Review scope',status:'completed',activeForm:'Reviewing scope'}]}}]}});
  const pending=f.hostOptions.onPermission({toolName:'ExitPlanMode',input:{plan:'# 驗收計畫\n1. 檢查回歸測試',planFilePath:'C:/unread-plan.md'}});
  await new Promise(resolve=>setImmediate(resolve));
  const question=f.controller.state.questions[0];
  assert.equal(question.kind,'approval');assert.equal(question.title,'Claude Code 提出計畫');
  assert.match(question.text,/檢視工作計畫/);assert.match(question.text,/# 驗收計畫/);assert.equal(question.details.plan,'# 驗收計畫\n1. 檢查回歸測試');
  await f.controller.answer({id:question.id,accept:false});
  assert.equal((await pending).behavior,'deny');
 }finally{await f.controller.close();}
});
