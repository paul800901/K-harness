import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createGeminiController,geminiModelsFrom} from '../src/gemini-controller.mjs';
import {createUnifiedController} from '../src/unified-controller.mjs';
import {listMainSessions} from '../src/main-sessions.mjs';

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

test('Gemini catalog preserves every native model and only supplied effort variants',()=>{
 const catalog=geminiModelsFrom(names);assert.deepEqual(catalog.map(x=>x.model),['gemini-3.8-flash','gemini-3.1-pro','gemini-new-native']);
 assert.deepEqual(catalog[1].supportedReasoningEfforts.map(e=>e.reasoningEffort),['high','low']);assert.equal(catalog[1].nativeModels.medium,undefined);
 assert.equal(catalog[2].nativeModels.default,'gemini-new-native');assert.equal(catalog.some(x=>/4-pro/u.test(x.model)),false);
 assert.deepEqual(catalog[0].inputModalities,['text']);
});

test('Gemini sends only new input, reopens native history and retains provider metadata',async()=>{
 const f=await fixture();let c=f.controller;
 try{
  const {threadId}=await c.open({model:'gemini-3.8-flash',effort:'medium'});await c.send({text:'first private context'});await finish(c);
  const native=JSON.parse(await readFile(path.join(f.root,'.runtime/gemini-sessions',threadId+'.json'),'utf8')).nativeSessionId;
  assert.match(native,/^[0-9a-f-]{36}$/u);assert.equal(c.state.messages.at(-1).text,'native reply');assert.equal(c.state.progress.tokenUsage.last.totalTokens,23);
  await c.close();c=createGeminiController(f.opts);await c.open({threadId,model:'gemini-3.8-flash'});await c.send({text:'second input'});await finish(c);
  const last=f.calls.at(-1);assert.equal(last.args[last.args.indexOf('--conversation')+1],native);assert.equal(last.args[last.args.indexOf('-p')+1],'second input');assert.equal(last.args.includes('first private context'),false);
  assert.equal(last.args[last.args.indexOf('--model')+1],'gemini-3.8-flash-medium');assert.equal(last.params.env.GEMINI_API_KEY,undefined);assert.equal(last.params.env.API_KEY,undefined);assert.equal(last.params.env.HOME,last.params.env.USERPROFILE);assert.ok(last.params.env.HOME.startsWith(path.join(f.root,'agent-home','gemini','main')));
  const saved=(await listMainSessions(f.root)).sessions[0];assert.equal(saved.provider,'gemini');assert.equal(saved.model,'gemini-3.8-flash');assert.equal(c.state.messages.length,4);
 }finally{await c.close();}
});

test('Gemini full access requires confirmation, never maps auto-review and uses isolated native settings',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  await assert.rejects(c.open({model:'gemini-3.8-flash',accessMode:'danger-full-access'}),/明確確認/);assert.equal(f.calls.length,0);
  await assert.rejects(c.open({model:'gemini-3.8-flash',accessMode:'auto-review'}),/未提供/);
  await c.open({model:'gemini-3.8-flash'});await assert.rejects(c.send({text:'work',accessMode:'danger-full-access'}),/明確確認/);
  await c.send({text:'work'});await finish(c);let call=f.calls.at(-1);assert.equal(call.args.includes('--dangerously-skip-permissions'),false);
  let settings=JSON.parse(await readFile(path.join(call.params.env.HOME,'.gemini/antigravity-cli/settings.json'),'utf8'));assert.deepEqual(settings.permissions.allow,[`write_file(${f.root})`]);assert.equal(settings.toolPermission,undefined);assert.ok(settings.permissions.deny.includes('command(*)'));
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

test('Gemini document attachments use validated workspace paths; images are not claimed as supported',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  const {threadId}=await c.open({model:'gemini-3.8-flash'});
  await assert.rejects(c.upload({threadId,name:'image.png',base64:'AAAA'}),/文字與文件/);
  const a=await c.upload({threadId,name:'example.txt',base64:Buffer.from('fake document').toString('base64')});await c.send({text:'read attachment',attachmentIds:[a.id]});await finish(c);assert.ok(f.calls[0].args[1].includes(path.resolve(f.root,a.textPath).replaceAll('\\','\\\\')));
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
