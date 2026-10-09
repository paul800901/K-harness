import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createGeminiController,geminiModelsFrom} from '../src/gemini-controller.mjs';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {listMainSessions} from '../src/main-sessions.mjs';
import {GEMINI_MEDIA_GUIDANCE} from '../src/gemini-worker.mjs';
import {MODEL_ROLE_GUIDANCE} from '../src/worker-policy.mjs';

const names=['gemini-3.8-flash-low','gemini-3.8-flash-medium','gemini-3.8-flash-high','gemini-3.1-pro-high','gemini-3.1-pro-low','gemini-new-native'];
const loginFactory=()=>({status:async()=>({available:true,models:names,version:'fixture'})});
async function fixture(options={}){
 const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'gemini-controller-'));const calls=[];
 const run=async(binary,args,params)=>{
  calls.push({binary,args,params});params.onStart(12345);
  const previous=args.indexOf('--conversation'),id=previous>=0?args[previous+1]:randomUUID();
  for(const event of [{event:'init',conversation_id:id,init:{model:args[args.indexOf('--model')+1]}},{event:'step_update',step_update:{step_type:'agent_response',step_index:1,text_delta:'native reply',state:'DONE'}},{event:'result',result:{conversation_id:id,status:'SUCCESS',response:'native reply',usage:{total_tokens:23}}}])params.onChunk(Buffer.from(JSON.stringify(event)+'\n'));
  return {code:0,stderr:''};
 };
 const opts={root,env:{LOCALAPPDATA:path.join(root,'local-app-data'),SystemRoot:process.env.SystemRoot??root,TEMP:path.join(root,'fake-temp'),API_KEY:'must-not-inherit',GEMINI_API_KEY:'must-not-inherit'},run,loginFactory,...options};
 return {root,calls,opts,controller:createGeminiController(opts)};
}
const finish=async c=>{for(let i=0;c.state.busy&&i<200;i++)await new Promise(r=>setTimeout(r,5));assert.equal(c.state.busy,false);};

test('ordinary Gemini main turns wait for native completion without duration or stdout-copy limits',async()=>{
 const f=await fixture();try{
  await f.controller.open({model:'gemini-3.8-flash',effort:'low'});
  await f.controller.send({text:'long task'});await finish(f.controller);
  assert.equal(f.calls.length,1);
  const {args,params}=f.calls[0];
  assert.equal(args[args.indexOf('--print-timeout')+1],'0s');
  assert.equal(params.timeoutMs,0);assert.equal(params.captureOutput,false);
  assert.equal(f.controller.state.status,'completed');
 }finally{await f.controller.close();}
});

test('Gemini work telemetry follows actual stream steps rather than process start or quota reads',async()=>{
 let emit,done;const f=await fixture({run:async(binary,args,params)=>{params.onStart(12345);emit=e=>params.onChunk(Buffer.from(JSON.stringify(e)+'\n'));return new Promise(resolve=>{done=()=>{emit({event:'result',result:{conversation_id:'123e4567-e89b-42d3-a456-426614174000',status:'SUCCESS',response:'fake'}});resolve({code:0,stderr:''});};});}});
 try{
  await f.controller.open({model:'gemini-3.8-flash',effort:'low'});await f.controller.send({text:'fake'});
  assert.equal(f.controller.state.activity.lastEventAt,null);
  emit({event:'step_update',step_update:{step_index:1,tool_info:{name:'read_file'},state:'RUNNING'}});assert.equal(f.controller.state.activity.phase,'tool');
  const before=structuredClone(f.controller.state.activity);await f.controller.usage();assert.deepEqual(f.controller.state.activity,before);
  emit({event:'step_update',step_update:{step_index:1,tool_info:{name:'read_file'},state:'DONE'}});assert.equal(f.controller.state.activity.phase,'active');
  done();await finish(f.controller);
 }finally{done?.();await f.controller.close();}
});

test('Gemini does not invent a zero compaction count when native telemetry is unavailable',async()=>{
 const f=await fixture();try{
  await f.controller.open({model:'gemini-3.8-flash',effort:'low'});
  assert.equal(f.controller.state.progress.compactions,null);assert.equal(f.controller.state.progress.compactionsComplete,false);
 }finally{await f.controller.close();}
});

test('Gemini accepts more than eight attachments while keeping unsupported mid-turn steering explicit',async()=>{
 const f=await fixture();try{
  const {threadId}=await f.controller.open({model:'gemini-3.8-flash',effort:'low'}),attachments=[];
  for(let n=0;n<12;n++)attachments.push(await f.controller.upload({threadId,name:`fake-${n}.txt`,base64:Buffer.from(`fake body ${n}`).toString('base64')}));
  await f.controller.send({text:'twelve files',attachmentIds:attachments.map(a=>a.id)});await finish(f.controller);
  assert.equal(f.calls.length,1);assert.equal(f.controller.state.messages[0].text,'twelve files');assert.equal(f.controller.state.messages[0].attachments.length,12);
  assert.equal(f.controller.state.capabilities.steer,false);await assert.rejects(f.controller.steer({text:'do not replay',attachmentIds:attachments.map(a=>a.id)}),/不支援/);assert.equal(f.calls.length,1);
 }finally{await f.controller.close();}
});

test('Gemini native conversation persists its account binding and releases the lease after actual completion',async()=>{
 const acquired=[],released=[],accountId='a'.repeat(32);
 const accounts={inspect:fn=>fn(),acquire:async data=>{acquired.push(data);return {accountId,release:async result=>released.push(result)};}};
 const f=await fixture({accounts});
 try{
  const {threadId}=await f.controller.open({model:'gemini-3.8-flash',effort:'low'});
  await f.controller.send({text:'first'});await finish(f.controller);
  const saved=JSON.parse(await readFile(path.join(f.root,'.runtime/gemini-sessions',threadId+'.json'),'utf8'));assert.equal(saved.accountId,accountId);
  await f.controller.send({text:'second'});await finish(f.controller);
  assert.equal(acquired[1].accountId,accountId);assert.equal(acquired[1].unboundHistory,false);assert.equal(released.length,2);assert.equal(released[0].settled,true);
 }finally{await f.controller.close();}
});

test('Gemini catalog preserves every native model and only supplied effort variants',()=>{
 const catalog=geminiModelsFrom(names);assert.deepEqual(catalog.map(x=>x.model),['gemini-3.8-flash','gemini-3.1-pro','gemini-new-native']);
 assert.deepEqual(catalog[1].supportedReasoningEfforts.map(e=>e.reasoningEffort),['high','low']);assert.equal(catalog[1].nativeModels.medium,undefined);
 assert.equal(catalog[2].nativeModels.default,'gemini-new-native');assert.equal(catalog.some(x=>/4-pro/u.test(x.model)),false);
 assert.deepEqual(catalog[0].inputModalities,['text','image','pdf','audio','video']);assert.deepEqual(catalog[1].inputModalities,catalog[0].inputModalities);assert.deepEqual(catalog[2].inputModalities,['text']);
});

test('Gemini quota polling coalesces and preserves dated stale values after a failed refresh',async()=>{
 let calls=0,complete;const native={status:'ready',checkedAt:'2026-10-03T05:00:00Z',windows:[{key:'seven_day',minutes:10080,remainingPercent:97,resetsAt:1791555046}]};
 const f=await fixture({loginFactory:()=>({status:()=>{calls++;return new Promise(resolve=>{complete=resolve;});}})});
 const first=f.controller.usage(),overlap=f.controller.usage();assert.equal(calls,1);complete({quota:native});assert.deepEqual((await first).gemini,native);await overlap;
 await f.controller.usage();assert.equal(calls,1);
 const failed=f.controller.usage(true);assert.equal(calls,2);complete({reason:'network unavailable'});const stale=(await failed).gemini;assert.equal(stale.status,'stale');assert.equal(stale.checkedAt,native.checkedAt);assert.deepEqual(stale.windows,native.windows);assert.equal(stale.note,'network unavailable');await f.controller.close();
});

test('Gemini sends only new input, reopens native history and retains provider metadata',async()=>{
 const f=await fixture();let c=f.controller;
 try{
  const {threadId}=await c.open({model:'gemini-3.8-flash',effort:'medium'});await c.send({text:'first private context'});await finish(c);
  const native=JSON.parse(await readFile(path.join(f.root,'.runtime/gemini-sessions',threadId+'.json'),'utf8')).nativeSessionId;
  assert.match(native,/^[0-9a-f-]{36}$/u);assert.equal(c.state.messages.at(-1).text,'native reply');assert.equal(c.state.progress.tokenUsage.last.totalTokens,23);
  await c.close();c=createGeminiController(f.opts);await c.open({threadId,model:'gemini-3.8-flash'});await c.send({text:'second input'});await finish(c);
  const last=f.calls.at(-1);assert.equal(last.args[last.args.indexOf('--conversation')+1],native);
  const prompt=last.args[last.args.indexOf('-p')+1];assert.equal(prompt,'second input');assert.doesNotMatch(prompt,/first private context/);
  const rules=path.join(last.params.env.HOME,'.gemini/config/rules/k-model-roles.md');
  assert.equal(await readFile(rules,'utf8'),`---\ntrigger: always_on\n---\n${MODEL_ROLE_GUIDANCE}\n${GEMINI_MEDIA_GUIDANCE}\n`);
  assert.equal(c.state.messages.filter(m=>m.role==='user').at(-1).text,'second input');
  assert.equal(last.args[last.args.indexOf('--model')+1],'gemini-3.8-flash-medium');assert.equal(last.params.env.GEMINI_API_KEY,undefined);assert.equal(last.params.env.API_KEY,undefined);assert.equal(last.params.env.HOME,last.params.env.USERPROFILE);assert.ok(last.params.env.HOME.startsWith(path.join(f.root,'agent-home','gemini','main')));
  const saved=(await listMainSessions(f.root)).sessions[0];assert.equal(saved.provider,'gemini');assert.equal(saved.model,'gemini-3.8-flash');assert.equal(c.state.messages.length,4);
 }finally{await c.close();}
});

test('an unsent Gemini room survives close and a new controller, with or without a rename',async()=>{
 for(const title of ['', 'named before first message']){
  const f=await fixture(),workspace=path.join(f.root,'chosen-workspace');await mkdir(workspace);let c=f.controller;
  try{
   await c.selectWorkspace({path:workspace});
   const {threadId}=await c.open({model:'gemini-3.8-flash',effort:'high',accessMode:'read-only'});
   if(title)await c.metadata({threadId,title});
   assert.equal(c.state.messages.length,0);assert.equal(f.calls.length,0);
   const before=JSON.parse(await readFile(path.join(f.root,'.runtime/gemini-sessions',threadId+'.json'),'utf8'));
   assert.equal(before.nativeSessionId,null);assert.equal(before.nativeStarted,false);
   await c.close();c=createGeminiController(f.opts);
   await c.open({threadId,model:'gemini-3.8-flash'});
   assert.equal(c.state.title,title);assert.equal(c.state.model,'gemini-3.8-flash');assert.equal(c.state.effort,'high');assert.equal(c.state.accessMode,'read-only');
   assert.equal(c.state.workspace,workspace);assert.deepEqual((await listMainSessions(f.root)).sessions[0].workerPolicy,{model:'auto',effort:'auto'});
   await c.send({text:'first turn after reopen'});await finish(c);
   assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.includes('--conversation'),false);
   assert.equal(f.calls[0].args[f.calls[0].args.indexOf('-p')+1],'first turn after reopen');
  }finally{await c.close();}
 }
});

test('Gemini full access requires confirmation, never maps auto-review and uses isolated native settings',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  await assert.rejects(c.open({model:'gemini-3.8-flash',accessMode:'danger-full-access'}),/明確確認/);assert.equal(f.calls.length,0);
  await assert.rejects(c.open({model:'gemini-3.8-flash',accessMode:'auto-review'}),/未提供/);
  await c.open({model:'gemini-3.8-flash'});await assert.rejects(c.send({text:'work',accessMode:'danger-full-access'}),/明確確認/);
  await c.send({text:'work'});await finish(c);let call=f.calls.at(-1);assert.equal(call.args.includes('--dangerously-skip-permissions'),false);
  let settings=JSON.parse(await readFile(path.join(call.params.env.HOME,'.gemini/antigravity-cli/settings.json'),'utf8'));assert.deepEqual(settings.permissions.allow,['read_url(*)',`write_file(${f.root})`]);assert.equal(settings.toolPermission,undefined);assert.ok(settings.permissions.deny.includes('command(*)'));
  await c.send({text:'explicit full access',accessMode:'danger-full-access',permissionConfirmed:true});await finish(c);call=f.calls.at(-1);assert.ok(call.args.includes('--dangerously-skip-permissions'));
 }finally{await c.close();}
});

test('Gemini model changes keep native history and reject unavailable models or efforts without fallback',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  const {threadId}=await c.open({model:'gemini-3.8-flash'});await c.send({text:'begin'});await finish(c);
  await assert.rejects(c.selectModel({threadId,model:'gemini-4-pro'}),/未換模/);await assert.rejects(c.selectModel({threadId,model:'gemini-3.1-pro',effort:'medium'}),/未換模/);assert.equal(c.state.model,'gemini-3.8-flash');
  await c.selectModel({threadId,model:'gemini-3.1-pro',effort:'low'});await c.send({text:'continue'});await finish(c);
  assert.ok(f.calls.at(-1).args.includes('--conversation'));assert.ok(f.calls.at(-1).args.includes('gemini-3.1-pro-low'));assert.equal(c.state.modelChanges.length,1);
 }finally{await c.close();}
});

test('Gemini cancellation waits for native termination and never replays the stopped message',async()=>{
 let started,release;const seen=new Promise(r=>{started=r;});let calls=0;
 const f=await fixture({run:async(_binary,_args,p)=>{calls++;p.onStart(1234);p.onChunk(Buffer.from(JSON.stringify({event:'init',conversation_id:randomUUID()})+'\n'));started(p);await new Promise(resolve=>{release=resolve;});return {code:null,reason:'cancelled'};}}),c=f.controller;
 try{
  await c.open({model:'gemini-3.8-flash'});await c.send({text:'slow work'});const p=await seen;
  let stopped=false;const stopping=c.stop().then(()=>{stopped=true;});assert.equal(p.signal.aborted,true);await new Promise(r=>setTimeout(r,10));assert.equal(stopped,false);
  release();await stopping;assert.equal(c.state.status,'interrupted');assert.equal(c.state.busy,false);assert.equal(calls,1);assert.equal(c.state.messages.filter(m=>m.role==='user').length,1);
 }finally{release?.();await c.close();}
});

test('Gemini login failure remains on Gemini and does not replay a turn with unknown native identity',async()=>{
 let calls=0;const f=await fixture({run:async(_b,_a,p)=>{calls++;p.onStart(1234);return {code:1,stderr:'Authentication required'};}}),c=f.controller;
 try{await c.open({model:'gemini-3.8-flash'});await c.send({text:'hello'});await finish(c);assert.equal(c.state.status,'failed');assert.match(c.state.error,/未登入/);assert.equal(c.state.provider,'gemini');await assert.rejects(c.send({text:'again'}),/原生對話 ID/);assert.equal(calls,1);}finally{await c.close();}
});

test('Gemini hands scoped image paths to native tools without guessing unknown model capability',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  const {threadId}=await c.open({model:'gemini-3.8-flash'});
  assert.deepEqual(c.state.inputModalities,['text','image','pdf','audio','video']);
  const images=[];
  for(const name of ['test.png','test.jpg','test.webp'])images.push(await c.upload({threadId,name,base64:Buffer.from(`synthetic ${name} private image payload`).toString('base64')}));
  const doc=await c.upload({threadId,name:'example.txt',base64:Buffer.from('fake document').toString('base64')});
  await c.send({text:'read attachments',attachmentIds:[...images.map(x=>x.id),doc.id]});await finish(c);
  const call=f.calls[0],prompt=call.args[call.args.indexOf('-p')+1];
  for(const image of images)assert.ok(prompt.includes(path.resolve(f.root,image.path).replaceAll('\\','\\\\')));
  assert.ok(prompt.includes(path.resolve(f.root,doc.textPath).replaceAll('\\','\\\\')));assert.ok(!prompt.includes('private image payload'));
  for(const image of images)assert.ok(!prompt.includes(Buffer.from(`synthetic ${image.name} private image payload`).toString('base64')));
  assert.ok(!call.args.join(' ').includes('must-not-inherit'));
  assert.equal(call.params.env.GEMINI_API_KEY,undefined);assert.equal(call.params.env.API_KEY,undefined);
  assert.deepEqual(c.state.messages.find(m=>m.role==='user').attachments.map(x=>x.name),['test.png','test.jpg','test.webp','example.txt']);
  await c.close();const next=await c.open({model:'gemini-new-native'});assert.deepEqual(c.state.inputModalities,['text']);
  assert.ok(!(await readFile(path.join(f.root,'agent-home/gemini/main',next.threadId,'.gemini/config/rules/k-model-roles.md'),'utf8')).includes(GEMINI_MEDIA_GUIDANCE));
  await assert.rejects(c.send({text:'wrong thread',attachmentIds:[images[0].id]}),/其他對話/);assert.equal(f.calls.length,1);
  const unsupported=await c.upload({threadId:next.threadId,name:'test.webp',base64:Buffer.from('another synthetic image').toString('base64')});
  await c.send({text:'let native tools determine support',attachmentIds:[unsupported.id]});await finish(c);assert.equal(f.calls.length,2);
  const unknownPrompt=f.calls[1].args[f.calls[1].args.indexOf('-p')+1];
  assert.ok(unknownPrompt.includes(path.resolve(f.root,unsupported.path).replaceAll('\\','\\\\')));
  assert.ok(unknownPrompt.includes('不代表模型已驗證可直接處理此模態'));
 }finally{await c.close();}
});

test('Gemini records in-workspace native output files and excludes outside files',async()=>{
 const f=await fixture({run:async(_b,_a,p)=>{p.onStart(1234);const emit=e=>p.onChunk(Buffer.from(JSON.stringify(e)+'\n'));emit({event:'init',conversation_id:randomUUID()});for(const [i,target] of [path.join(p.cwd,'answer.md'),path.resolve(p.cwd,'../outside.md')].entries())emit({event:'step_update',step_update:{step_index:i,state:'DONE',tool_info:{name:'write_to_file',parameters:{TargetFile:target}}}});emit({event:'result',result:{status:'SUCCESS',response:'done'}});return {code:0};}}),c=f.controller;
 try{await c.open({model:'gemini-3.8-flash'});await c.send({text:'create output'});await finish(c);assert.deepEqual(c.state.artifacts,['answer.md']);await assert.rejects(c.artifact('../outside.md'),/已記錄/);}finally{await c.close();}
});

test('Gemini absence does not remove GPT/Claude models or route a Gemini request to another core',async()=>{
 const f=await fixture(),calls=[];
 const peer=provider=>({state:{provider,workspace:f.root,status:'idle',busy:false,questions:[],messages:[]},models:async()=>({models:[{model:provider==='codex'?'gpt-6.1-sol':'claude-opus-5-5'}]}),usage:async()=>({}),workers:async()=>[],selectWorkspace:async()=>{},open:async data=>{calls.push({provider,data});return {};},close:async()=>{}});
 const c=createUnifiedController({root:f.root,codexFactory:()=>peer('codex'),claudeFactory:()=>peer('claude'),geminiFactory:options=>createGeminiController({...options,loginFactory:()=>({status:async()=>({available:false,models:[],reason:'找不到 agy，請安裝 Antigravity CLI 並登入。'})})})});
 try{const catalog=await c.models();assert.deepEqual(catalog.models.map(m=>m.provider),['codex','claude']);assert.match(catalog.warnings[0],/找不到 agy/);await assert.rejects(c.open({model:'gemini-3.8-flash'}),/找不到 agy/);assert.equal(c.state.provider,'codex');assert.deepEqual(calls,[]);}finally{await c.close();}
});

test('Gemini relocation keeps native identity and old attachments, and rebuilds workspace rules',async()=>{
 const f=await fixture();try{
  const c=f.controller,{threadId}=await c.open({model:'gemini-3.8-flash',effort:'low'});
  const upload=await c.upload({threadId,name:'before.txt',base64:Buffer.from('old upload').toString('base64')});
  await c.send({text:'remember'});await finish(c);
  const file=path.join(f.root,'.runtime/gemini-sessions',threadId+'.json'),before=JSON.parse(await readFile(file,'utf8'));
  const destination=path.join(f.root,'destination');await mkdir(destination);
  await c.open({threadId,model:'gemini-3.8-flash'},{relocation:{workspace:destination,previousWorkspaces:[f.root],previousArtifacts:[]}});
  assert.equal(c.state.threadId,threadId);assert.equal((await c.attachmentFile(upload.id)).bytes.toString(),'old upload');
  const rules=await readFile(path.join(f.root,'agent-home/gemini/main',threadId,'.gemini/config/rules/k-model-roles.md'),'utf8');assert.ok(rules.includes(JSON.stringify(destination)));
  await c.send({text:'continue',attachmentIds:[upload.id]});await finish(c);
  const last=f.calls.at(-1);assert.equal(last.params.cwd,destination);assert.equal(last.args[last.args.indexOf('--conversation')+1],before.nativeSessionId);
  const after=JSON.parse(await readFile(file,'utf8'));assert.equal(after.nativeSessionId,before.nativeSessionId);assert.equal(after.accountId,before.accountId);assert.equal(after.messages.length,4);
  await c.close();await c.open({threadId,model:'gemini-3.8-flash'});assert.equal(c.state.workspace,destination);assert.equal((await c.attachmentFile(upload.id)).bytes.toString(),'old upload');
 }finally{await f.controller.close();}
});

test('failed Gemini workspace preparation cannot send at the uncommitted destination',async()=>{
 let fail=false;const f=await fixture({browserConfig:async()=>{if(fail)throw Error('fixture browser configuration failed');return null;}}),c=f.controller;
 try{
  const {threadId}=await c.open({model:'gemini-3.8-flash'}),dest=path.join(f.root,'B');await mkdir(dest);
  fail=true;await assert.rejects(c.open({threadId,model:'gemini-3.8-flash'},{relocation:{workspace:dest,previousWorkspaces:[f.root],previousArtifacts:[]}}),/fixture browser/);
  assert.equal(c.state.status,'error');await assert.rejects(c.send({text:'do not run at B'}),/先開啟/);assert.equal(f.calls.length,0);
  await c.metadata({threadId,title:'renamed after failed move',pinned:true});
  const saved=JSON.parse(await readFile(path.join(f.root,'.runtime/main-sessions',threadId+'-current.json'),'utf8'));
  assert.equal(saved.workspace,f.root);assert.deepEqual(saved.previousWorkspaces,[]);assert.deepEqual(saved.previousArtifacts,[]);
  assert.equal(c.state.workspace,f.root);assert.deepEqual(c.state.artifacts,[]);
  await c.selectModel({threadId,model:'gemini-3.8-flash',effort:'low'});
  const upload=await c.upload({threadId,name:'after-failed-move.txt',base64:Buffer.from('still A').toString('base64')});
  assert.equal((await readFile(path.join(f.root,upload.path),'utf8')),'still A');
  fail=false;await c.open({threadId,model:'gemini-3.8-flash'});assert.equal(c.state.workspace,f.root);
 }finally{await c.close();}
});

for(const confirmed of [true,false])test(`Gemini goal completion requires native expansion (${confirmed}) and keeps normal chat literal`,async()=>{
 const calls=[];let finishTurn;
 const f=await fixture({run:async(binary,args,params)=>{calls.push({args,params});params.onStart(321);for(const e of [{event:'init',conversation_id:'11111111-1111-1111-1111-111111111111',init:{expanded_commands:confirmed?[{name:'goal',type:'system'}]:[]}},{event:'result',result:{status:'SUCCESS',response:'FAKE_DONE\n<!-- GOAL_COMPLETE -->'}}])params.onChunk(Buffer.from(JSON.stringify(e)+'\n'));return {code:0};}});
 try{
  const {threadId}=await f.controller.open({model:'gemini-3.8-flash'});await f.controller.goal({objective:'fake objective'});await finish(f.controller);
  assert.equal(f.controller.state.goal.status,confirmed?'complete':'ended');assert.equal(calls[0].args[1],'/goal fake objective');assert(!calls[0].args.includes('--disable-slash-commands'));assert.equal(calls[0].params.timeoutMs,0);assert.equal(calls[0].params.captureOutput,false);
  await f.controller.close();await f.controller.open({model:'gemini-3.8-flash',threadId});assert.equal(calls.length,1);assert.equal(f.controller.state.goal.status,confirmed?'complete':'ended');
  await f.controller.goal({clear:true});assert.equal(f.controller.state.goal,null);await f.controller.send({text:'/goal not a control'});await finish(f.controller);assert(calls[1].args.includes('--disable-slash-commands'));assert.equal(f.controller.state.goal,null);
 }finally{await f.controller.close();}
});

test('Gemini cannot silently turn an edit-only request into new work',async()=>{
 const f=await fixture();try{await f.controller.open({model:'gemini-3.8-flash'});await assert.rejects(f.controller.goal({objective:'not a new run',editOnly:true}),/不支援只修改/);assert.equal(f.calls.length,0);}finally{await f.controller.close();}
});


test('Gemini confirms pre-dispatch rejection without replaying an attempted native turn',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.controller.send({text:'fake'}),e=>e.notSent===true);
  await f.controller.open({model:'gemini-3.8-flash',effort:'low'});
  await assert.rejects(f.controller.send({text:''}),e=>e.notSent===true);
  await assert.rejects(f.controller.send({text:'fake',attachmentIds:['missing']}),e=>e.notSent===true);
  assert.equal(f.calls.length,0);
  assert.deepEqual(await f.controller.send({text:'fake'}),{sent:true});await finish(f.controller);
  assert.equal(f.calls.length,1);
 }finally{await f.controller.close();}
});


test('cold Gemini history is exposed before prepare and open preserves activity order',async()=>{
 const f=await fixture();try{
  await f.controller.open({model:'gemini-3.8-flash',effort:'low'});await f.controller.send({text:'fake request'});await finish(f.controller);
  const id=f.controller.state.threadId;await f.controller.close();const before=(await listMainSessions(f.root)).sessions[0].sortAt;
  const reopened=createGeminiController(f.opts);let previews=0;try{
   await reopened.open({threadId:id,model:'gemini-3.8-flash'},{onHistory:async state=>{previews++;assert.ok(state.messages.some(m=>m.text==='native reply'));assert.equal(f.calls.length,1);}});
   assert.equal(previews,1);assert.equal((await listMainSessions(f.root)).sessions[0].sortAt,before);assert.equal(f.calls.length,1);
  }finally{await reopened.close();}
 }finally{await f.controller.close();}
});


test('Gemini accepts attachment-only input through native file references',async()=>{
 const f=await fixture();try{
  const {threadId}=await f.controller.open({model:'gemini-3.8-flash',effort:'low'});
  for(const input of [{text:''},{text:'   '},{text:null,attachmentIds:['fake']},{text:'x'.repeat(32001),attachmentIds:['fake']}])await assert.rejects(f.controller.send(input),/訊息/);
  const image=await f.controller.upload({threadId,name:'pixel.png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII='});
  await assert.rejects(f.controller.send({text:'',attachmentIds:['missing']}));assert.equal(f.calls.length,0);
  await f.controller.send({attachmentIds:[image.id]});await finish(f.controller);
  assert.equal(f.calls.length,1);const prompt=f.calls[0].args[1];assert.ok(prompt.startsWith('\n\n附件'));assert.match(prompt,/pixel\.png/);
  const user=f.controller.state.messages.find(m=>m.role==='user');assert.equal(user.text,'');assert.equal(user.attachments.length,1);assert.equal(f.controller.state.title,'pixel.png');
 }finally{await f.controller.close();}
});
