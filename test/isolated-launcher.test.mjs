import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolatedLauncherPaths,startIsolatedOwner,runIsolatedLauncherProtocol,ISOLATED_CANDIDATE_ROOT,ISOLATED_FORMAL_PORT} from '../src/isolated-launcher.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {startIsolatedDesktop} from '../src/isolated-desktop.mjs';
import {listProjects} from '../src/projects.mjs';
import {startElectronIsolatedLauncher} from '../src/electron-isolated-launcher.mjs';

async function fixture(){
 const testRoot=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(testRoot,{recursive:true});
 const base=await mkdtemp(path.join(testRoot,'isolated-launcher-'));
 const p=isolatedLauncherPaths(path.join(base,'candidate'));
 for(const dir of [p.root,p.vault,p.trustedRuntime,p.workspace,p.agentHome,p.browserProfiles,p.browserOutput,
   path.dirname(p.executable),path.dirname(p.claudeCommand)])await mkdir(dir,{recursive:true});
 for(const file of [p.executable,p.claudeCommand])await writeFile(file,'fixture');
 return {base,p};
}

test('formal isolation paths use a new vault state child and the existing private workspace',()=>{
 const p=isolatedLauncherPaths('D:\\K-harness\\.runtime\\isolation-pilot\\sandboxie-candidate-3b6c43ee');
 assert.equal(p.stateRoot,path.join(p.vault,'private-state'));
 assert.equal(p.workspace,path.join(p.root,'workspace'));
 assert.equal(p.agentHome,path.join(p.root,'agent-home'));
 assert.equal(p.browserProfiles,path.join(p.vault,'profiles'));
 assert.equal(p.electronExecutable,path.join(p.trustedRuntime,'node_modules','electron','dist','electron.exe'));
 assert.equal(ISOLATED_FORMAL_PORT,47831);
 assert.throws(()=>isolatedLauncherPaths('relative-path'),/absolute/);
});

test('launcher defaults to the module candidate and honors K_CANDIDATE_ROOT',()=>{
 const sourceRoot=fileURLToPath(new URL('..',import.meta.url));
 const previous=process.env.K_CANDIDATE_ROOT;
 try{
  delete process.env.K_CANDIDATE_ROOT;
  assert.equal(ISOLATED_CANDIDATE_ROOT,path.resolve(sourceRoot));
  assert.equal(isolatedLauncherPaths().root,path.resolve(sourceRoot));
  process.env.K_CANDIDATE_ROOT=path.join(sourceRoot,'.runtime','portable-candidate');
  assert.equal(isolatedLauncherPaths().root,path.resolve(process.env.K_CANDIDATE_ROOT));
 }finally{
  if(previous===undefined)delete process.env.K_CANDIDATE_ROOT;else process.env.K_CANDIDATE_ROOT=previous;
 }
});

test('native supervisor events omit the bootstrap capability and await native open',async()=>{
 const input=new PassThrough();let text='',shown=0,closed=0;
 const output=new Writable({write(chunk,_encoding,callback){text+=chunk.toString();callback();}});
 const app={origin:'http://127.0.0.1:47831',controller:{state:{status:'ready'}},async close(){closed++;}};
 const protocol=runIsolatedLauncherProtocol({app,input,output,presentation:'native',onOpen:async()=>{shown++;}});
 input.write('open\n');await new Promise(resolve=>setImmediate(resolve));
 input.write('close\n');assert.deepEqual(await protocol.done,{closed:true});
 const events=text.trim().split('\n').map(JSON.parse);
 assert.deepEqual(events.map(event=>event.type),['ready','open','closed']);
 for(const event of events.slice(0,2)){assert.equal(event.presentation,'native');assert.equal(event.origin,app.origin);assert.equal(event.pid,process.pid);assert.equal('launchUrl' in event,false);}
 assert.equal(shown,1);assert.equal(closed,1);input.destroy();output.end();
});

test('missing trusted provider fails before pool creation and never falls back',async()=>{
 const {base,p}=await fixture();let called=false;
  const missing={...p,executable:path.join(p.trustedProviders,'missing-provider.exe')};
  await assert.rejects(startIsolatedOwner({paths:missing,poolFactory:async()=>{called=true;throw Error('must not run');},browserFactory:()=>{throw Error('must not run');}}),/Required trusted file/);
  assert.equal(called,false);
 assert.equal(base,path.dirname(p.root));
});

test('isolated desktop marks deployment and labels only the selected private workspace',async()=>{
 const {base,p}=await fixture();await mkdir(p.stateRoot,{recursive:true});let received,selected;
 const browsers={session(){return {async close(){}};},async request(){return {};},async close(){}};
 const app=await startIsolatedDesktop({root:p.stateRoot,workspace:p.workspace,port:47831,executable:p.executable,
   commandSpec:{command:p.claudeCommand,argsPrefix:[]},pool:{spawnImpl(){},async close(){}},env:{HOME:p.agentHome},
   runnerIdentity:'sandboxie-private-workspace',browsers,allowLogin:true,workspaceLabel:'私人工作區',
   startDesktopImpl:async options=>{received=options;return {controller:{async selectWorkspace(args){selected=args.path;}},async close(){}};}});
 assert.equal(selected,p.workspace);
 const projects=await listProjects(p.stateRoot);assert.equal(projects.projects.find(item=>item.path===p.workspace).name,'私人工作區');
 await app.close();assert.equal(base,path.dirname(p.root));
});

test('invalid bootstrap URL is not emitted and unconfirmed close can be retried',async()=>{
 const input=new PassThrough();let text='',exitCode=null,closeCount=0;
 const output=new Writable({write(chunk,_encoding,callback){text+=chunk.toString();callback();}});
 const app={origin:'http://127.0.0.1:47831',createLaunchUrl(){return 'http://127.0.0.1:47831/?token=secret';},async close(){if(++closeCount===1)throw Error('unconfirmed');}};
 const protocol=runIsolatedLauncherProtocol({app,input,output,onExit:code=>{exitCode=code;}});
 input.write('close\n');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(text.includes('secret'),false);assert.deepEqual(text.trim().split('\n').map(JSON.parse).map(e=>e.type),['ready','closed']);
 assert.equal(JSON.parse(text.trim().split('\n').at(-1)).confirmed,false);assert.equal(exitCode,null);
 app.createLaunchUrl=()=>`${app.origin}/bootstrap?token=${'d'.repeat(64)}`;
 input.write('open\n');await new Promise(resolve=>setImmediate(resolve));input.write('close\n');
 assert.deepEqual(await protocol.done,{closed:true});assert.equal(closeCount,2);assert.equal(exitCode,0);
 input.destroy();output.end();
});

test('explicit stop delegates busy work and pending questions to owner cleanup',async()=>{
 const input=new PassThrough();let text='',closed=0;
 const output=new Writable({write(chunk,_encoding,callback){text+=chunk.toString();callback();}});
 const app={origin:'http://127.0.0.1:47831',controller:{state:{status:'ready',conversationActivity:[{threadId:'hidden',status:'working',busy:true,pendingQuestions:1}]}},
   createLaunchUrl(){return `${this.origin}/bootstrap?token=${'c'.repeat(64)}`;},async close(){closed++;}};
 const protocol=runIsolatedLauncherProtocol({app,input,output,onExit(){}});
 input.write('close\n');assert.deepEqual(await protocol.done,{closed:true});
 assert.equal(closed,1);assert.equal(JSON.parse(text.trim().split('\n').at(-1)).confirmed,true);
 input.destroy();output.end();
});

test('idle uncertain status closes for both the active and hidden conversation',async()=>{
 const input=new PassThrough();let text='',closed=0;
 const output=new Writable({write(chunk,_encoding,callback){text+=chunk.toString();callback();}});
 const app={origin:'http://127.0.0.1:47831',controller:{state:{status:'uncertain',busy:false,pendingQuestions:0,
   conversationActivity:[{threadId:'hidden',status:'uncertain',busy:false,pendingQuestions:0,queuedMessages:[]}] }},
   createLaunchUrl(){return `${this.origin}/bootstrap?token=${'e'.repeat(64)}`;},async close(){closed++;}};
 const protocol=runIsolatedLauncherProtocol({app,input,output,onExit(){}});
 input.write('close\n');assert.deepEqual(await protocol.done,{closed:true});
 assert.equal(closed,1);assert.equal(JSON.parse(text.trim().split('\n').at(-1)).confirmed,true);
 input.destroy();output.end();
});

test('idle uncertain close failure can be retried through normal owner cleanup',async()=>{
 const input=new PassThrough();let text='',closed=0;
 const output=new Writable({write(chunk,_encoding,callback){text+=chunk.toString();callback();}});
 const app={origin:'http://127.0.0.1:47831',controller:{state:{status:'uncertain',busy:false}},
   createLaunchUrl(){return `${this.origin}/bootstrap?token=${'f'.repeat(64)}`;},async close(){if(++closed===1)throw Error('cleanup not confirmed');}};
 const protocol=runIsolatedLauncherProtocol({app,input,output,onExit(){}});
 input.write('close\n');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(closed,1);assert.equal(JSON.parse(text.trim().split('\n').at(-1)).confirmed,false);
 input.write('close\n');assert.deepEqual(await protocol.done,{closed:true});
 assert.equal(closed,2);assert.equal(JSON.parse(text.trim().split('\n').at(-1)).confirmed,true);
 input.destroy();output.end();
});

test('explicit stop delegates queued messages and unsettled workers to owner cleanup',async()=>{
 const input=new PassThrough();let text='',closed=0;
 const output=new Writable({write(chunk,_encoding,callback){text+=chunk.toString();callback();}});
 const app={origin:'http://127.0.0.1:47831',controller:{state:{status:'uncertain',busy:false,queuedMessages:[{id:'queued'}],
   workers:[{settled:false,status:'unresolved'}],conversationActivity:[{threadId:'hidden',busy:false,status:'ready',queuedMessages:[{id:'hidden-queued'}],workers:[{settled:false,status:'running'}]}]}},
   createLaunchUrl(){return `${this.origin}/bootstrap?token=${'a'.repeat(64)}`;},async close(){closed++;}};
 const protocol=runIsolatedLauncherProtocol({app,input,output,onExit(){}});
 input.write('close\n');assert.deepEqual(await protocol.done,{closed:true});assert.equal(closed,1);
 assert.equal(JSON.parse(text.trim().split('\n').at(-1)).confirmed,true);
 input.destroy();output.end();
});

test('isolated health is distinguishable and protected root requires bootstrap cookie',async()=>{
 const controller={state:{status:'idle'},async close(){},async sessions(){return {sessions:[]};}};
 const login=()=>({async close(){}});
 const app=await startDesktop({root:path.resolve('.runtime/tests/isolated-health-fixture'),executable:'fixture',port:0,
  requireLaunchToken:true,deployment:'isolated',controllerFactory:()=>controller,claudeLoginFactory:login,codexLoginFactory:login});
 try{
  const health=await fetch(`${app.origin}/health`).then(r=>r.json());
  assert.equal(health.deployment,'native');
  assert.equal(health.workspace,path.resolve('.runtime/tests/isolated-health-fixture'));
  assert.equal((await fetch(`${app.origin}/`)).status,403);
 }finally{await app.close();}
});

test('formal owner defaults to native providers without Sandboxie or workspace ACL setup',async()=>{
 const {p}=await fixture();let received;
 // Nonexistent Sandboxie paths must not matter on the native production route.
 p.startExe=path.join(p.root,'not-installed.exe');p.bridgePath=path.join(p.trustedRuntime,'missing-bridge.mjs');
 const sourceEnv={USERPROFILE:'C:\\Users\\Fixture',LOCALAPPDATA:'C:\\Users\\Fixture\\AppData\\Local',PATH:'C:\\Windows',COMSPEC:'C:\\Windows\\System32\\cmd.exe',PATHEXT:'.COM;.EXE;.CMD',ProgramData:'C:\\ProgramData',ALLUSERSPROFILE:'C:\\ProgramData',COMPUTERNAME:'fixture',NUMBER_OF_PROCESSORS:'8',PROCESSOR_ARCHITECTURE:'AMD64',PSModulePath:'C:\\Modules',TOOL_CUSTOM_OPTION:'keep',openai_api_key:'fake-billing-key',ANTHROPIC_API_KEY:'fake-billing-key',DEEPSEEK_API_KEY:'fake-worker-key'};
 await startIsolatedOwner({paths:p,sourceEnv,
  poolFactory:()=>{throw Error('must not initialize Sandboxie');},workspaceAccessFactory:()=>{throw Error('must not change ACL');},
  browserFactory:()=>({close:async()=>{}}),desktopFactory:async options=>{received=options;return {close:async()=>{}};}});
 assert.equal(received.pool,undefined);assert.equal(received.workspaceAccess,undefined);
 assert.equal(received.env.USERPROFILE,'C:\\Users\\Fixture');assert.equal(received.env.LOCALAPPDATA,'C:\\Users\\Fixture\\AppData\\Local');
 assert.equal(received.env.CODEX_HOME,path.join(p.agentHome,'.codex'));assert.equal(received.env.CLAUDE_CONFIG_DIR,path.join(p.agentHome,'.claude'));
 for(const key of Object.keys(sourceEnv).filter(key=>!key.toUpperCase().endsWith('API_KEY')))assert.equal(received.env[key],sourceEnv[key],key);
 for(const key of ['openai_api_key','ANTHROPIC_API_KEY','DEEPSEEK_API_KEY'])assert.equal(received.env[key],undefined);
});

test('Electron supervisor preserves OS and tool environment before native owner startup',async()=>{
 const {p}=await fixture(),input=new PassThrough(),output=new PassThrough();
 await mkdir(path.dirname(p.electronExecutable),{recursive:true});await writeFile(p.electronExecutable,'fixture');
 const mainPath=path.join(p.trustedRuntime,'src','electron-isolated-main.cjs');await mkdir(path.dirname(mainPath),{recursive:true});await writeFile(mainPath,'fixture');
 const env={ComSpec:'C:\\Windows\\System32\\cmd.exe',PATHEXT:'.EXE;.CMD',ProgramData:'C:\\ProgramData',PSModulePath:'C:\\Modules',TOOL_CUSTOM_OPTION:'keep',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require fake-hook.cjs'};
 const child=Object.assign(new EventEmitter(),{connected:true,send(message,callback){callback?.();if(message.type==='owner-request')queueMicrotask(()=>child.emit('message',{type:'owner-response',id:message.id,ok:true,value:{closed:true}}));}});
 let launched,args;
 const owner=await startElectronIsolatedLauncher({paths:p,mainPath,input,output,processObject:{env,execPath:process.execPath},
  spawnImpl:(_exe,_args,options)=>{launched=options;args=_args;queueMicrotask(()=>child.emit('message',{type:'owner-ready',origin:'http://127.0.0.1:47831'}));return child;}});
 try{
  for(const key of ['ComSpec','PATHEXT','ProgramData','PSModulePath','TOOL_CUSTOM_OPTION'])assert.equal(launched.env[key],env[key]);
  assert.equal(launched.env.ELECTRON_RUN_AS_NODE,undefined);
  assert.equal(launched.env.NODE_OPTIONS,undefined);assert.equal(env.NODE_OPTIONS,'--require fake-hook.cjs');
  assert.equal(launched.windowsHide,true);assert.deepEqual(args,[mainPath]);assert.deepEqual(launched.stdio,['ignore','ignore','ignore','ipc']);
 }finally{await owner.protocol.close();input.destroy();output.destroy();}
});

test('native desktop keeps selected project rules but not an extra isolated workspace boundary',async()=>{
 const {p}=await fixture();await mkdir(p.stateRoot,{recursive:true});let received;
 const browsers={session:()=>({close:async()=>{}}),request:async()=>({}),close:async()=>{}};
 const app=await startIsolatedDesktop({root:p.stateRoot,workspace:p.workspace,port:47832,executable:p.executable,
  commandSpec:{command:p.claudeCommand,argsPrefix:[]},native:true,runnerIdentity:'host',env:{},browsers,
  startDesktopImpl:async options=>{received=options;return {controller:{selectWorkspace:async()=>{}},close:async()=>{}};}});
 assert.equal(await received.validateProjectWorkspace(p.agentHome),p.agentHome);
 await app.close();
});
