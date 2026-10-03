import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createGeminiWorker,geminiSettings,geminiEnvironment,geminiProfile,geminiStream,geminiOutcome,geminiProcess,geminiOutputFiles,killGeminiTree} from '../src/gemini-worker.mjs';
import {createLunaBridge,lunaResult} from '../src/luna-bridge.mjs';
import {workerPolicyConfig,GEMINI_WORKER_MODELS,WORKER_MODELS} from '../src/worker-policy.mjs';

const root=path.resolve('.runtime','gemini-tests',randomUUID()),workspace=path.join(root,'workspace');await mkdir(workspace,{recursive:true});
const modelList=['low','medium','high'].map(e=>`gemini-3.8-flash-${e}\tFlash`).join('\n');
const success=response=>JSON.stringify({event:'result',result:{status:'SUCCESS',response}})+'\n';
function fakeSpawn(answer=success('done'),models=modelList) {
 const calls=[],children=[];
 const spawnImpl=(exe,args,options)=>{
  const child=new EventEmitter();Object.assign(child,{pid:43210+calls.length,stdout:new PassThrough(),stderr:new PassThrough()});
  calls.push({exe,args,options});children.push(child);
  queueMicrotask(()=>{if(args[0]==='models'){child.stdout.write(models);child.emit('close',0);}else if(answer!==null){child.stdout.write(answer);child.emit('close',0);}});
  return child;
 };
 return {spawnImpl,calls,children};
}
const make=(fake,options={})=>createGeminiWorker({root,workspace,accessMode:'read-only',env:{LOCALAPPDATA:path.join(root,'original-local'),Path:'fake-path',SystemRoot:'C:/Windows',OPENAI_API_KEY:'do-not-forward',NODE_OPTIONS:'do-not-forward'},spawnImpl:fake.spawnImpl,gitStatus:async()=>null,...options});

test('Gemini profile hashes canonical workspace and access mode; settings keep each mode separate',()=>{
 const p=geminiProfile(workspace,'read-only');assert.match(p,/^[a-f0-9]{16}$/);
 assert.equal(p,geminiProfile(workspace+path.sep,'read-only'));assert.notEqual(p,geminiProfile(workspace,'danger-full-access'));assert.notEqual(p,geminiProfile(root,'read-only'));
 if(process.platform==='win32')assert.equal(p,geminiProfile(workspace.toUpperCase(),'read-only'));
 // Default mode + deny: strict would turn reads into headless Ask and ignores allow.
 assert.deepEqual(geminiSettings(workspace,'read-only'),{permissions:{allow:[],deny:['write_file(*)','command(*)','unsandboxed(*)','mcp(*)'],ask:[]}});
 // Native-path allow (drive-stripped did not match live); %TEMP% denied unless it holds the workspace.
 const temp=path.join(root,'temp'),write=geminiSettings(workspace,'workspace-write',[temp,temp,'']);
 assert.equal(write.toolPermission,undefined);assert.deepEqual(write.permissions.allow,[`write_file(${path.resolve(workspace)})`]);
 assert.deepEqual(write.permissions.deny,['command(*)','unsandboxed(*)','mcp(*)',`write_file(${path.resolve(temp)})`]);
 assert.deepEqual(geminiSettings(workspace,'workspace-write',[root]).permissions.deny,['command(*)','unsandboxed(*)','mcp(*)']);
 assert.deepEqual(geminiSettings(workspace,'danger-full-access').permissions,{allow:[],deny:['mcp(*)'],ask:[]});
 assert.throws(()=>geminiProfile('relative','read-only'));assert.throws(()=>geminiSettings(workspace,'unknown'));
});
test('Gemini environment forwards only OS basics and the private home; removes every credential and K variable',()=>{
 const source=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','Path','GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_GENAI_USE_VERTEXAI','GOOGLE_APPLICATION_CREDENTIALS','ANTHROPIC_API_KEY','OPENAI_API_KEY','CODEX_HOME','CLAUDE_CONFIG_DIR','K_MCP_TOKEN','MCP_SERVER','APPDATA','LOCALAPPDATA','NODE_OPTIONS','USERPROFILE','HOME'].map(k=>[k,'private']));
 assert.deepEqual(geminiEnvironment(source,'k-home'),{SystemRoot:'private',WINDIR:'private',TEMP:'private',TMP:'private',Path:'private',USERPROFILE:'k-home',HOME:'k-home'});
});
for(const effort of ['low','medium','high'])test(`Gemini ${effort} resolves executable before overrides, caches catalog, isolates settings/logs and closes stdin`,async()=>{
 const fake=fakeSpawn(),worker=make(fake);const result=await worker.run({task:'bounded',effort});
 assert.equal(result.status,'completed');assert.equal(result.acceptance,'not-reviewed');assert.deepEqual(result.outputFiles,[]);assert.match(result.outputFilesNote,/無法取得/);
 const launch=fake.calls[1];assert.equal(launch.exe,path.resolve(root,'original-local','agy/bin/agy.exe'));assert.equal(launch.options.cwd,workspace);assert.equal(launch.options.shell,false);assert.equal(launch.options.windowsHide,true);assert.equal(launch.options.stdio[0],'ignore');
 assert.equal(launch.args[launch.args.indexOf('--model')+1],`gemini-3.8-flash-${effort}`);assert.equal(launch.args[launch.args.indexOf('--output-format')+1],'stream-json');assert.equal(launch.args[launch.args.indexOf('--print-timeout')+1],'600s');assert.equal(launch.args.includes('--dangerously-skip-permissions'),false);
 assert.match(launch.args[1],/不得超過主代理的授權/);assert.match(launch.args[1],/不得再委派子代理、啟動背景服務/);assert.match(launch.args[1],/不能跑指令/);assert.match(launch.args[1],/<DELEGATED_TASK>\nbounded\n<\/DELEGATED_TASK>/);
 assert.equal(launch.options.env.USERPROFILE,worker.home);assert.equal(launch.options.env.HOME,worker.home);assert.equal(launch.options.env.LOCALAPPDATA,undefined);assert.ok(launch.args[launch.args.indexOf('--log-file')+1].startsWith(worker.home+path.sep));
 assert.deepEqual(JSON.parse(await readFile(path.join(worker.home,'.gemini/antigravity-cli/settings.json'))),geminiSettings(workspace,'read-only'));
 await worker.run({task:'different',effort});assert.equal(fake.calls.filter(c=>c.args[0]==='models').length,1);
});
test('Gemini danger mode alone passes skip; workspace-write runs without skip under its own settings',async()=>{
 const fake=fakeSpawn(),result=await make(fake,{accessMode:'danger-full-access',executable:path.join(root,'agy.exe')}).run({task:'fake',effort:'low'});
 assert.equal(result.status,'completed');assert.ok(fake.calls[1].args.includes('--dangerously-skip-permissions'));assert.doesNotMatch(fake.calls[1].args[1],/不能跑指令/);
 const write=fakeSpawn(),worker=make(write,{accessMode:'workspace-write'});assert.equal((await worker.run({task:'fake',effort:'low'})).status,'completed');
 assert.equal(write.calls[1].args.includes('--dangerously-skip-permissions'),false);assert.match(write.calls[1].args[1],/只能寫入指定工作區/);
 assert.deepEqual(JSON.parse(await readFile(path.join(worker.home,'.gemini/antigravity-cli/settings.json'))),geminiSettings(workspace,'workspace-write'));
});
test('Gemini rejects absent native model and invalid effort without a model turn or substitute',async()=>{
 const fake=fakeSpawn(undefined,'gemini-3.8-flash-high\tFlash');
 await assert.rejects(make(fake).run({task:'fake',effort:'low'}),/目前不可用/);assert.equal(fake.calls.length,1);
 for(const effort of ['auto','ultra',undefined])await assert.rejects(make(fake).run({task:'fake',effort}),/low\|medium\|high/);
});
test('NDJSON handles UTF-8 chunks, last result, bounded unique denied tools and unrelated tool errors',()=>{
 const parser=geminiStream();const events=[];
 for(let i=0;i<25;i++)events.push({event:'step_update',step_update:{state:'ERROR',tool_info:{name:'write_to_file',parameters:{TargetFile:`file-${i}`},error:{message:'Permission denied for write_file(file). Matches user-configured deny rule.'}}}});
 events.push(events[0]);events.push({event:'step_update',step_update:{tool_info:{name:'view_file',error:{message:'File not found'}}}});
 const buffer=Buffer.from('invalid\n'+success('old')+events.map(e=>JSON.stringify(e)).join('\n')+'\n'+success('完成 😀').trim());
 for(let i=0;i<buffer.length;i+=7)parser.write(buffer.subarray(i,i+7));
 const parsed=parser.end(),outcome=geminiOutcome(parsed,{code:0});assert.equal(parsed.result.response,'完成 😀');assert.equal(parsed.deniedTools.length,20);assert.equal(parsed.toolErrors.length,20);assert.equal(outcome.status,'completed');assert.deepEqual(outcome.deniedTools[0],{tool:'write_to_file',target:'file-0'});
 const second=geminiStream();second.write(Buffer.from(JSON.stringify({event:'step_update',step_update:{tool_info:{name:'view_file',error:{message:'File not found'}}}})));assert.deepEqual(second.end().deniedTools,[]);
});
for(const [name,parsed,processResult,pattern] of [
 ['nonzero',{status:'SUCCESS',response:'done'},{code:1},/退出碼/],
 ['result failure',{status:'ERROR',error:{message:'failure'}},{code:0},/failure/],
 ['not logged in',{status:'ERROR',error:'authentication required'},{code:0},/未登入/],
 ['quota',{status:'ERROR',error:'RESOURCE_EXHAUSTED quota'},{code:0},/額度/],
 ['headless empty',{status:'SUCCESS',response:''},{code:0,stderr:'jetski: no output produced'},/no output/],
 ['missing result',undefined,{code:0},/missing/],
 ['empty success',{status:'SUCCESS',response:''},{code:0},/no output/],
])test(`Gemini outcome marks ${name} failed`,()=>{const r=geminiOutcome({result:parsed},processResult);assert.equal(r.status,'failed');assert.match(r.error,pattern);});
for(const kind of ['timeout','cancel','stdout','stderr'])test(`Gemini ${kind} terminates whole tree and waits for kill completion`,async()=>{
 const fake=fakeSpawn(null),controller=new AbortController();let release;const killed=new Promise(r=>release=r);const kills=[];
 const run=geminiProcess('agy',['-p'],{cwd:workspace,env:{},spawnImpl:fake.spawnImpl,signal:controller.signal,timeoutMs:kind==='timeout'?5:1000,maxStdout:10,maxStderr:10,killTree:async pid=>{kills.push(pid);fake.children[0].emit('close',1);await killed;}});
 if(kind==='cancel')controller.abort();if(kind==='stdout')fake.children[0].stdout.write('x'.repeat(11));if(kind==='stderr')fake.children[0].stderr.write('x'.repeat(11));
 let settled=false;run.then(()=>settled=true);await new Promise(r=>setTimeout(r,15));assert.equal(settled,false);assert.deepEqual(kills,[43210]);release();const result=await run;
 assert.equal(result.reason,kind==='cancel'?'cancelled':kind==='timeout'?'timeout':`${kind} limit exceeded`);
});
test('unconfirmed tree termination yields unresolved; pre-aborted signal spawns nothing',async()=>{
 const fake=fakeSpawn(null),controller=new AbortController();const run=geminiProcess('agy',[],{cwd:workspace,env:{},spawnImpl:fake.spawnImpl,signal:controller.signal,killTree:async()=>{fake.children[0].emit('close',1);throw Error('kill failed');}});controller.abort();
 const result=geminiOutcome({},await run);assert.equal(result.status,'unresolved');assert.equal(result.settled,false);
 const before=fake.calls.length;assert.equal((await geminiProcess('agy',[],{spawnImpl:fake.spawnImpl,signal:controller.signal})).reason,'cancelled');assert.equal(fake.calls.length,before);
});
test('git status diff keeps filenames, changed statuses and workspace boundaries; warns about attribution limits',()=>{
 const result=geminiOutputFiles(new Map([['already.txt',' M']]),new Map([['already.txt',' M'],['space name.txt','??'],['deleted.txt',' D'],['../outside.txt','??']]),workspace);
 assert.deepEqual(result.outputFiles,['space name.txt','deleted.txt']);assert.match(result.outputFilesNote,/dirty/);assert.deepEqual(geminiOutputFiles(null,null,workspace).outputFiles,[]);
});
test('Windows tree termination uses only owned PID with taskkill /T /F and hidden bounded exec',async()=>{
 const calls=[];await killGeminiTree(1234,{platform:'win32',env:{SystemRoot:'C:/Windows'},execImpl:async(...args)=>calls.push(args)});
 assert.deepEqual(calls[0][1],['/PID','1234','/T','/F']);assert.equal(calls[0][2].windowsHide,true);assert.equal(calls[0][2].timeout,10000);
 await assert.rejects(killGeminiTree(0),/無效/);
});
test('headless denied_actions can annotate a DONE tool without error, preserving its target',()=>{
 const parser=geminiStream();parser.write(Buffer.from(JSON.stringify({event:'step_update',step_update:{state:'DONE',tool_info:{name:'run_command',parameters:{CommandLine:'echo fake'}}}})+'\n'));
 parser.write(Buffer.from(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'denied',denied_actions:[{action:'command',display_name:'RunCommand'}]}})));
 assert.deepEqual(geminiOutcome(parser.end(),{code:0}).deniedTools,[{tool:'run_command',target:'echo fake'}]);
});
test('concurrent runs share catalog and atomic profile writes; cancelling one never cancels the other',async()=>{
 const fake=fakeSpawn(),worker=make(fake),ac=new AbortController();
 const first=worker.run({task:'first',effort:'low',signal:ac.signal});const second=worker.run({task:'second',effort:'low'});ac.abort();
 const [a,b]=await Promise.all([first,second]);assert.equal(a.status,'cancelled');assert.equal(b.status,'completed');assert.equal(fake.calls.filter(c=>c.args[0]==='models').length,1);assert.equal(fake.calls.filter(c=>c.args[0]==='-p').length,1);
 assert.deepEqual(JSON.parse(await readFile(path.join(worker.home,'.gemini/antigravity-cli/settings.json'))),geminiSettings(workspace,'read-only'));
});

async function geminiBridge({parentId=randomUUID(),factory,onChange=()=>{},hostFactory=()=>{throw Error('Codex unavailable');},accessMode='read-only'}={}) {
 return createLunaBridge({root,workspace,parentId,executable:'codex',hostFactory,geminiFactory:factory,onChange,accessMode});
}
const args={requestId:'flash',task:'bounded',model:'gemini-3.8-flash',effort:'low'};
test('Gemini works when Codex init fails; concurrent requestId dedup, final persistence, deniedTools and notification',async()=>{
 let runs=0,finish;const gate=new Promise(r=>finish=r),changes=[];
 const bridge=await geminiBridge({onChange:r=>changes.push(r),factory:()=>({run:async o=>{runs++;o.onStart(123);await gate;return {status:'completed',settled:true,output:'done',deniedTools:[{tool:'write_to_file',target:'outside'}],outputFiles:[]};}})});
 const [a,b]=await Promise.all([bridge.start(args),bridge.start(args)]);assert.equal(a.provider,'gemini');assert.equal(b.requestId,'flash');assert.equal(runs,1);
 await assert.rejects(bridge.start({...args,task:'different'}),/不同 task/);await assert.rejects(bridge.start({...args,model:'gpt-6-luna',effort:'high'}),/Codex.*初始化失敗/);
 finish();const final=await bridge.wait({requestId:'flash',timeoutMs:2000});assert.equal(final.status,'completed');assert.equal(final.acceptance,'not-reviewed');assert.deepEqual((await lunaResult(final)).deniedTools,[{tool:'write_to_file',target:'outside'}]);
 const saved=JSON.parse(await readFile(path.join(root,'.runtime/luna-bridge',a.parentId,'flash.json')));assert.equal(saved.status,'completed');assert.ok(changes.some(r=>r.settled));assert.equal((await bridge.start(args)).status,'completed');assert.equal(runs,1);await bridge.close();
});
test('restart turns persisted running Gemini into unresolved and never adopts PID or replays',async()=>{
 const parentId=randomUUID();await mkdir(path.join(root,'.runtime/luna-bridge',parentId),{recursive:true});
 await writeFile(path.join(root,'.runtime/luna-bridge',parentId,'flash.json'),JSON.stringify({...args,parentId,provider:'gemini',workspace,status:'running',pid:2147483647,settled:false,acceptance:'not-reviewed'}));
 let runs=0;const bridge=await geminiBridge({parentId,factory:()=>({run:async()=>runs++})});assert.equal((await bridge.inspect({requestId:'flash'})).status,'unresolved');assert.equal((await bridge.start(args)).status,'unresolved');assert.equal(runs,0);
 await assert.rejects(bridge.close(),/尚未確認停止/);
});
test('Gemini bridge cancel aborts the owned run and persists cancellation before close',async()=>{
 let aborted=false;const bridge=await geminiBridge({factory:()=>({run:o=>new Promise(r=>{o.onStart(123);o.signal.addEventListener('abort',()=>{aborted=true;r({status:'cancelled',settled:true,output:''});},{once:true});})})});
 await bridge.start(args);assert.equal((await bridge.cancel({requestId:'flash'})).status,'cancelled');assert.equal(aborted,true);await bridge.close();
});
test('Gemini init failure does not disable Codex; no fallback call',async()=>{
 let turns=0;const bridge=await geminiBridge({factory:()=>{throw Error('Gemini unavailable');},hostFactory:()=>({notify(){},async close(){},async request(method){if(method==='account/read')return {account:{type:'chatgpt'}};if(method==='model/list')return {data:[{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]};if(method==='thread/start')return {thread:{id:'native'}};if(method==='turn/start'){turns++;return {turn:{id:'turn'}};}if(method==='thread/read')return {thread:{id:'native',cwd:workspace,status:{type:'idle'},turns:[{id:'turn',status:'completed',items:[]}]}};if(method==='thread/backgroundTerminals/list')return {data:[]};return {};}})});
 await bridge.start(args);const failed=await bridge.wait({requestId:'flash',timeoutMs:2000});assert.equal(failed.status,'failed');assert.match(failed.error,/Gemini unavailable/);assert.equal(turns,0);
 await bridge.start({requestId:'codex',task:'bounded',model:'gpt-6-luna',effort:'high'});assert.equal(turns,1);
 const file=path.join(root,'.runtime/luna-bridge',failed.parentId,'codex.json');assert.equal(JSON.parse(await readFile(file)).provider,'codex');
 await bridge.close();
});
test('Codex native agents config excludes Gemini even if the catalog advertises it',()=>{
 assert.deepEqual(GEMINI_WORKER_MODELS,['gemini-3.8-flash']);assert.equal(WORKER_MODELS.includes('gemini-3.8-flash'),false);
 const models=[{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'high'}]},{model:'gemini-3.8-flash'}];assert.equal(JSON.stringify(workerPolicyConfig(undefined,{models}).agents).includes('gemini'),false);
 assert.throws(()=>workerPolicyConfig({model:'gemini-3.8-flash',effort:'low'},{models}),/未自動換模/);
});

test('missing agy executable fails only Flash; bridge starts and both GPT workers still complete',async()=>{
 const models=['gpt-6.1-sol','gpt-6-luna'];let turns=0;
 const bridge=await createLunaBridge({root,workspace,parentId:randomUUID(),executable:'codex',
  geminiOptions:{executable:path.join(root,'does-not-exist','agy.exe')},
  hostFactory:()=>({notify(){},async close(){},async request(method,p){
   if(method==='account/read')return {account:{type:'chatgpt'}};
   if(method==='model/list')return {data:models.map(model=>({model,supportedReasoningEfforts:[{reasoningEffort:'high'}]}))};
   if(method==='thread/start')return {thread:{id:`native-${++turns}`}};
   if(method==='turn/start')return {turn:{id:`turn-${turns}`}};
   if(method==='thread/read')return {thread:{id:p.threadId,cwd:workspace,status:{type:'idle'},turns:[{id:`turn-${p.threadId.split('-')[1]}`,status:'completed',items:[]}]}};
   if(method==='thread/backgroundTerminals/list')return {data:[]};return {};
  }})});
 try{
  assert.equal(turns,0);await bridge.start(args);
  const failed=await bridge.wait({requestId:'flash',timeoutMs:2000});
  assert.equal(failed.status,'failed');assert.equal(failed.settled,true);assert.match(failed.error,/找不到 agy.*安裝 Antigravity CLI 並登入/);assert.equal(turns,0);
  for(const model of models){await bridge.start({requestId:model,task:'bounded',model,effort:'high'});assert.equal((await bridge.wait({requestId:model,timeoutMs:2000})).status,'completed');}
  assert.equal(turns,2);
 }finally{await bridge.close();}
});

test('agy models authentication failure explains login without launching a model turn',async()=>{
 let calls=0;const spawnImpl=()=>{
  calls++;const child=new EventEmitter();Object.assign(child,{pid:43210,stdout:new PassThrough(),stderr:new PassThrough()});
  queueMicrotask(()=>{child.stderr.write('authentication required');child.emit('close',1);});
  return child;
 };
 const worker=make({spawnImpl});
 await assert.rejects(worker.run({task:'bounded',effort:'low'}),/agy 未登入/);
 assert.equal(calls,1);
});

test('managed Flash binds account metadata without changing permissions or replaying; catalog refreshes for each account',async()=>{
 const fake=fakeSpawn(),seen=[];let id='a'.repeat(32);
 const accounts={run:async(options,fn)=>{seen.push(options);return {...await fn({accountId:id,accountEmail:`${id[0]}@example.test`}),accountId:id};}};
 const worker=make(fake,{accounts});
 const first=await worker.run({task:'remaining A',effort:'low'});id='b'.repeat(32);
 const second=await worker.run({task:'remaining B',effort:'low',accountId:id});
 assert.equal(first.accountId,'a'.repeat(32));assert.equal(second.accountId,id);
 assert.deepEqual(seen,[{worker:true,accountId:undefined},{worker:true,accountId:id}]);
 assert.equal(fake.calls.filter(c=>c.args[0]==='models').length,2);
 assert.equal(fake.calls.filter(c=>c.args[0]==='-p').length,2);
 assert.ok(fake.calls.every(c=>c.options.env.HOME===worker.home));
 assert.deepEqual(JSON.parse(await readFile(path.join(worker.home,'.gemini/antigravity-cli/settings.json'))),geminiSettings(workspace,'read-only'));
});

test('Flash handoff requires a settled predecessor, new request id, and retains account identity in persisted results',async()=>{
 let done;const calls=[];const bridge=await geminiBridge({factory:()=>({run:async options=>{
  calls.push(options);options.onAccount({accountId:options.accountId,accountEmail:'fixture@example.test'});options.onStart(123);
  if(options.task==='first')await new Promise(resolve=>{done=resolve;});
  return {status:'completed',settled:true,output:options.task,accountId:options.accountId};
 }})});
 try{
  const first={...args,requestId:'first',task:'first',accountId:'a'.repeat(32)};await bridge.start(first);
  await assert.rejects(bridge.start({...args,requestId:'next',handoffFrom:'first'}),/尚未確認停止/);
  done();await bridge.wait({requestId:'first',timeoutMs:2000});
  const next={...args,requestId:'next',task:'only remaining',accountId:'b'.repeat(32),handoffFrom:'first'};
  await Promise.all([bridge.start(next),bridge.start(next)]);
  const final=await bridge.wait({requestId:'next',timeoutMs:2000});assert.equal(final.handoffFrom,'first');assert.equal(final.accountId,next.accountId);
  assert.equal((await lunaResult(final)).accountId,next.accountId);assert.equal(calls.length,2);assert.equal(calls[1].task,'only remaining');
  await assert.rejects(bridge.start({...next,accountId:first.accountId}),/不同 task、帳號/);
  await assert.rejects(bridge.start({...args,requestId:'self',handoffFrom:'self'}),/新的工作 ID/);
 }finally{await bridge.close();}
});

test('Flash-only bridge never opens a Codex worker host and refuses GPT dispatch',async()=>{
 let hosts=0,runs=0;
 const bridge=await createLunaBridge({root,workspace,parentId:randomUUID(),geminiOnly:true,
  hostFactory:()=>{hosts++;throw Error('must not open GPT runtime');},
  geminiFactory:()=>({run:async()=>{runs++;return {provider:'gemini',status:'completed',settled:true,output:'done'};}})});
 try{
  assert.equal(hosts,0);
  await assert.rejects(bridge.start({requestId:'gpt',task:'bounded',model:'gpt-6-luna',effort:'high'}),/只提供 Gemini Flash/);
  await bridge.start({...args,requestId:'flash-only'});
  const result=await bridge.wait({requestId:'flash-only',timeoutMs:2000});assert.equal(result.status,'completed');
  assert.equal(hosts,0);assert.equal(runs,1);
 }finally{await bridge.close();}
});
