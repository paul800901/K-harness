import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {listMainSessions,saveMainSession} from '../src/main-sessions.mjs';

const CODEX_MODEL='gpt-6-astra';
const CODEX_OTHER='gpt-6-luna';
const CLAUDE_MODEL='claude-opus-5-5';
const TEST_ROOT=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));

test('picker catalog contains the complete official GPT catalog and Claude with native effort choices',async()=>{
 const sol={model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']};
 const f=await fixture({codexModels:[{model:'gpt-6-astra'},sol,...['gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.5'].map(model=>({model}))]});
 try{
  const {models}=await f.controller.models();
  assert.deepEqual(models.map(item=>item.model),['gpt-6-astra','gpt-6.1-sol','gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.5','claude-opus-5-5']);
  assert.deepEqual(models[1],{...sol,provider:'codex'});
  assert.deepEqual(models.at(-1).supportedReasoningEfforts.map(item=>item.reasoningEffort),['low','medium','high','xhigh','max']);
  await saveMainSession(f.root,{threadId:'old-gpt',model:'gpt-5.6-sol'});
  assert.equal((await f.controller.sessions()).sessions[0].model,'gpt-5.6-sol');
 }finally{await f.controller.close();}
});

test('an older native catalog does not invent Sol 6.1 or relabel Sol 6',async()=>{
 const f=await fixture({codexModels:['gpt-6-astra','gpt-6-sol','gpt-6-luna'].map(model=>({model}))});
 try{
  assert.deepEqual((await f.controller.models()).models.map(item=>item.model),['gpt-6-astra','gpt-6-sol','gpt-6-luna','claude-opus-5-5']);
 }finally{await f.controller.close();}
});

test('a saved Sol 6 conversation still opens with its original model after the picker upgrade',async()=>{
 const f=await fixture({codexModels:['gpt-6-astra','gpt-6.1-sol','gpt-6-sol','gpt-6-luna'].map(model=>({model}))});
 try{
  await saveMainSession(f.root,{threadId:'legacy-sol',model:'gpt-6-sol',workspace:f.root});
  await f.controller.models();
  await f.controller.open({threadId:'legacy-sol',model:'gpt-6-sol'});
  assert.deepEqual(f.codex.calls.find(call=>call.method==='open').data,{threadId:'legacy-sol',model:'gpt-6-sol'});
  assert.equal(f.controller.state.model,'gpt-6-sol');
  assert.equal((await f.controller.sessions()).sessions.find(item=>item.threadId==='legacy-sol').model,'gpt-6-sol');
  assert.equal(f.codex.calls.some(call=>call.method==='selectModel'),false);
 }finally{await f.controller.close();}
});

async function fixture({codexModels,inspect=async()=>({available:true,reason:null,version:'2.1.0',auth:{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'}})}={}){
 await mkdir(TEST_ROOT,{recursive:true});
 const root=await mkdtemp(path.join(TEST_ROOT,'unified-controller-'));
 const codex=createFake('codex',root,{models:codexModels??[{model:CODEX_MODEL,displayName:'GPT-6 Astra'}]});
 let claude;
 const controller=createUnifiedController({geminiFactory:()=>({state:{},models:async()=>({models:[]}),usage:async()=>({}),close:async()=>{}}),root,codexFactory:()=>codex,claudeFactory:()=>{claude=createFake('claude',root);return claude;},inspect});
 return {root,controller,codex,get claude(){return claude;}};
}

function createFake(provider,root,{models=[{model:CLAUDE_MODEL,displayName:'Claude Opus 5.5',supportedReasoningEfforts:['low','medium','high','xhigh','max'].map(reasoningEffort=>({reasoningEffort}))}]}={}){
 const defaultModel=provider==='claude'?CLAUDE_MODEL:CODEX_MODEL;
 const fake={
  calls:[],closeCount:0,
  state:{status:'idle',threadId:null,model:defaultModel,messages:[],questions:[],workers:[],busy:false,workspace:root,accessMode:'workspace-write'},
  async models(){this.calls.push({method:'models'});return {models};},
  async open(data){this.calls.push({method:'open',data:structuredClone(data)});const threadId=data.threadId??`${provider}-new`;this.state={...this.state,status:'ready',threadId,model:data.model??defaultModel,busy:false,questions:[],messages:[]};return {threadId};},
  async selectWorkspace(data){this.calls.push({method:'selectWorkspace',data:structuredClone(data)});this.state.workspace=data.path;},
  async workers(){this.calls.push({method:'workers'});return [];},
  async selectModel(data){this.calls.push({method:'selectModel',data:structuredClone(data)});this.state.model=data.model;return {threadId:data.threadId,model:data.model};},
  async close(){this.calls.push({method:'close'});this.closeCount++;this.state.status='idle';},
  async sessions(){this.calls.push({method:'sessions'});return {sessions:[]};},
  async metadata(data){this.calls.push({method:'metadata',data});return data;},
 };
 for(const method of ['stop','usage','directories','upload','attachmentFile','artifact','send','steer','goal','compact','answer'])fake[method]=async(...args)=>{fake.calls.push({method,args});return {};};
 fake.review=async(...args)=>{fake.calls.push({method:'review',args});return {started:true};};
 fake.fuzzyFileSearch=async({query})=>{fake.calls.push({method:'fuzzyFileSearch',query});return {files:[{root,path:'src/main.mjs',file_name:'main.mjs',match_type:'file',score:4}]};};
 return fake;
}

async function savePair(root){
 await saveMainSession(root,{threadId:'codex-saved',model:CODEX_MODEL,workspace:root});
 await saveMainSession(root,{threadId:'claude-saved',model:CLAUDE_MODEL,workspace:root});
 return listMainSessions(root);
}

test('native Codex actions require confirmation, keep search inside the selected workspace, and reject Claude',async()=>{
 const f=await fixture();
 try{
  await f.controller.open({model:CODEX_MODEL});
  await assert.rejects(f.controller.review({confirmed:false}),/明確確認/);
  assert.equal(f.codex.calls.some(call=>call.method==='review'),false);
  assert.deepEqual(await f.controller.review({confirmed:true}),{started:true});
  assert.deepEqual(f.codex.calls.find(call=>call.method==='review').args,[{confirmed:true,target:{type:'uncommittedChanges'},delivery:'inline'}]);
  assert.deepEqual(await f.controller.fuzzyFileSearch({query:' main '}),{files:[{path:'src/main.mjs',fileName:'main.mjs',matchType:'file',score:4}]});
  assert.deepEqual(f.codex.calls.find(call=>call.method==='fuzzyFileSearch'),{method:'fuzzyFileSearch',query:'main'});
  await f.controller.open({model:CLAUDE_MODEL});
  await assert.rejects(f.controller.review({confirmed:true}),/不支援 Claude/);
  await assert.rejects(f.controller.fuzzyFileSearch({query:'main'}),/不支援 Claude/);
 }finally{await f.controller.close();}
});

test('model catalog merges providers independently when either provider fails',async()=>{
 const f=await fixture();try{
  await f.controller.models();f.claude.models=async()=>{throw Error('Claude unavailable');};
  let result=await f.controller.models();assert.deepEqual(result.models.map(row=>row.provider),['codex']);assert.match(result.warnings[0],/Claude unavailable/);
  const codexDown=createFake('codex',f.root);codexDown.models=async()=>{throw Error('Codex unavailable');};
  const other=createUnifiedController({geminiFactory:()=>({state:{},models:async()=>({models:[]}),usage:async()=>({}),close:async()=>{}}),root:f.root,codexFactory:()=>codexDown,claudeFactory:()=>createFake('claude',f.root)});
  result=await other.models();assert.deepEqual(result.models.map(row=>row.provider),['claude']);assert.match(result.warnings[0],/Codex unavailable/);await other.close();
 }finally{await f.controller.close();}
});

test('provider-specific sessions open without forwarding the other provider history',async()=>{
 const f=await fixture();
 try{
  await savePair(f.root);
  await f.controller.open({threadId:'codex-saved',model:CODEX_MODEL});
  f.codex.state.messages=[{role:'user',text:'private Codex history'}];
  await f.controller.open({threadId:'claude-saved',model:CLAUDE_MODEL});
  assert.deepEqual(f.claude.calls.find(call=>call.method==='open').data,{threadId:'claude-saved',model:CLAUDE_MODEL});
  assert.equal(JSON.stringify(f.claude.calls).includes('private Codex history'),false);
  assert.equal(f.controller.state.provider,'claude');
 }finally{await f.controller.close();}
});

test('busy work or pending approvals prevent switching provider',async()=>{
 const f=await fixture();
 try{
  await savePair(f.root);
  await f.controller.open({threadId:'codex-saved',model:CODEX_MODEL});
  f.codex.state.busy=true;
  await assert.rejects(f.controller.open({threadId:'claude-saved',model:CLAUDE_MODEL}),/結束目前工作與核准/);
  assert.equal(f.claude,undefined);
  f.codex.state.busy=false;f.codex.state.questions=[{id:'approval-1'}];
  await assert.rejects(f.controller.open({threadId:'claude-saved',model:CLAUDE_MODEL}),/結束目前工作與核准/);
  assert.equal(f.claude,undefined);
  assert.equal(f.controller.state.provider,'codex');
 }finally{await f.controller.close();}
});

test('same-provider model selection delegates, while cross-provider selection never transfers history',async()=>{
 const f=await fixture();
 try{
  await f.controller.open({model:CODEX_MODEL});
  await f.controller.selectModel({threadId:'codex-new',model:CODEX_OTHER});
  assert.deepEqual(f.codex.calls.find(call=>call.method==='selectModel').data,{threadId:'codex-new',model:CODEX_OTHER});
  const before=f.codex.calls.filter(call=>call.method==='selectModel').length;
  await assert.rejects(f.controller.selectModel({threadId:'codex-new',model:CLAUDE_MODEL}),/跨供應商/);
  assert.equal(f.codex.calls.filter(call=>call.method==='selectModel').length,before);
  assert.equal(f.claude,undefined);
 }finally{await f.controller.close();}
});

test('switching back to Codex reopens its saved thread after the host was closed',async()=>{
 const f=await fixture();
 try{
  await savePair(f.root);
  await f.controller.open({threadId:'codex-saved',model:CODEX_MODEL});
  await f.controller.open({threadId:'claude-saved',model:CLAUDE_MODEL});
  assert.equal(f.codex.closeCount,1);
  await f.controller.open({threadId:'codex-saved',model:CODEX_MODEL});
  assert.equal(f.controller.state.provider,'codex');
  assert.equal(f.codex.calls.filter(call=>call.method==='open').length,2);
  assert.deepEqual(f.codex.calls.filter(call=>call.method==='open').at(-1).data,{threadId:'codex-saved',model:CODEX_MODEL});
 }finally{await f.controller.close();}
});

test('missing Claude subscription auth blocks opening without damaging the active Codex state',async()=>{
 const f=await fixture({inspect:async()=>({available:false,reason:'not authenticated',version:'2.1.0',auth:{loggedIn:false,authMethod:'none',apiProvider:'unknown',subscriptionType:'unknown'}})});
 try{
  await savePair(f.root);
  await f.controller.open({threadId:'codex-saved',model:CODEX_MODEL});
  const prior=structuredClone(f.controller.state);
  await assert.rejects(f.controller.open({threadId:'claude-saved',model:CLAUDE_MODEL}),/請先在 K 登入 Claude 訂閱/);
  assert.deepEqual(f.controller.state,prior);
  assert.equal(f.codex.closeCount,0);
  assert.equal(f.claude,undefined);
 }finally{await f.controller.close();}
});

test('fork inherits same-provider permissions, continues by default, and records lineage',async()=>{
 const f=await fixture();try{
 await f.controller.open({model:CODEX_MODEL});
 f.codex.state.messages=[{id:'u',role:'user',text:'finish work'},{id:'a',role:'assistant',text:'still todo'}];
 f.codex.state.accessMode='danger-full-access';
 f.codex.fork=async data=>{f.codex.calls.push({method:'fork',data});f.codex.state.threadId='codex-child';return {threadId:'codex-child'};};
 const r=await f.controller.fork({messageId:'a'});
 assert.equal(r.started,true);assert.equal(f.codex.calls.find(x=>x.method==='fork').data.accessMode,'danger-full-access');
 assert.match(f.codex.calls.find(x=>x.method==='send').args[0].text,/尚未完成/);
 assert.equal((await f.controller.sessions()).sessions.find(x=>x.threadId==='codex-child').parentThreadId,'codex-new');
 }finally{await f.controller.close();}
});

test('cross-provider fork requires explicit native permissions and hands off only through chosen conclusion',async()=>{
 const f=await fixture();try{
 await f.controller.open({model:CODEX_MODEL});f.codex.state.messages=[{id:'u',role:'user',text:'BEFORE'},{id:'a',role:'assistant',text:'FIRST'},{id:'u2',role:'user',text:'SECRET_LATER'},{id:'a2',role:'assistant',text:'LATER'}];
 await assert.rejects(f.controller.fork({messageId:'a',model:CLAUDE_MODEL}),/明確選擇/);
 await assert.rejects(f.controller.fork({messageId:'a',model:CLAUDE_MODEL,accessMode:'claude-bypassPermissions'}),/permissionConfirmed:true/);
 assert.equal(f.codex.closeCount,0);
 const r=await f.controller.fork({messageId:'a',model:CLAUDE_MODEL,accessMode:'claude-manual',permissionConfirmed:false,nextInstruction:'next instruction'});
 assert.equal(f.claude.calls.find(call=>call.method==='open').data.permissionConfirmed,false,'forwards the caller value');
 assert.equal(r.started,true);assert.equal(f.controller.state.provider,'claude');
 const {readFile}=await import('node:fs/promises');const body=await readFile(r.handoffPath,'utf8');
 assert.match(body,/BEFORE/);assert.match(body,/FIRST/);assert.doesNotMatch(body,/SECRET_LATER/);
 const prompt=f.claude.calls.find(x=>x.method==='send').args[0].text;assert.match(prompt,/next instruction/);assert.match(prompt,/交接檔/);
 assert.doesNotMatch(JSON.stringify(f.claude.calls.find(x=>x.method==='open')),/BEFORE/);
 }finally{await f.controller.close();}
});

test('fork forwards the caller permission confirmation instead of manufacturing it',async()=>{
 const f=await fixture();try{
  await f.controller.open({model:CODEX_MODEL});
  f.codex.state.messages=[{id:'u',role:'user',text:'work'},{id:'a',role:'assistant',text:'done'}];
  f.codex.fork=async data=>{f.codex.calls.push({method:'fork',data});f.codex.state.threadId='codex-child';return {threadId:'codex-child'};};
  await f.controller.fork({messageId:'a',permissionConfirmed:false});
  assert.equal(f.codex.calls.find(call=>call.method==='fork').data.permissionConfirmed,false);
 }finally{await f.controller.close();}
});

test('fork validates before creating and rejects running workers and queued input',async()=>{
 const f=await fixture();try{
 await f.controller.open({model:CODEX_MODEL});f.codex.state.messages=[{id:'u',role:'user',text:'work'},{id:'a',role:'assistant',text:'done'}];
 await assert.rejects(f.controller.fork({messageId:'u'}),/結論/);
 await assert.rejects(f.controller.fork({messageId:'a',model:'not-a-model'}),/不可用/);
 f.codex.workers=async()=>[{status:'unresolved'}];await assert.rejects(f.controller.fork({messageId:'a'}),/子代理/);
 f.codex.state.busy=true;await f.controller.send({text:'queued'});f.codex.state.busy=false;
 await assert.rejects(f.controller.fork({messageId:'a'}),/待送訊息/);
 }finally{await f.controller.close();}
});

test('fork rejects uncertain source status and a selected incomplete assistant while allowing an earlier completed point',async()=>{
 const f=await fixture();try{
  await f.controller.open({model:CODEX_MODEL});
  f.codex.state.messages=[{id:'u',role:'user',text:'first'},{id:'a',role:'assistant',text:'complete'},{id:'u2',role:'user',text:'second'},{id:'partial',role:'assistant',text:'unfinished',partial:true}];
  await assert.rejects(f.controller.fork({messageId:'partial'}),/結論/);
  f.codex.state.status='uncertain';
  await assert.rejects(f.controller.fork({messageId:'a'}),/狀態尚未確認/);
 }finally{await f.controller.close();}
});

test('archive deletion cannot race asynchronous metadata update',async()=>{
 const f=await fixture();let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 await saveMainSession(f.root,{threadId:'archived-test',model:CODEX_MODEL,archived:true});
 f.codex.metadata=async()=>{entered();await gate;return {};};
 try{
  const updating=f.controller.metadata({threadId:'archived-test',archived:false});
  await started;
  await assert.rejects(f.controller.deleteArchived({threadIds:['archived-test'],confirmed:true}),/不能刪除/);
  release();await updating;
 }finally{release();await f.controller.close();}
});
