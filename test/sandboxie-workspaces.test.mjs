import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,symlink,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createSandboxieWorkspaces,createSandboxieWorkspaceAccess} from '../src/sandboxie-workspaces.mjs';

async function fixture(){
 const temporaryRoot=path.resolve('.runtime');await mkdir(temporaryRoot,{recursive:true});
 const root=await mkdtemp(path.join(temporaryRoot,'k-sbie-workspace-'));
 const workspace=path.join(root,'workspace'),next=path.join(root,'next'),vault=path.join(root,'vault'),home=path.join(root,'home');
 for(const dir of [workspace,next,vault,home])await mkdir(dir);
 const baseline=[`${home}\\*`],box='KCandidate1';
 let fileRules=[`${workspace}\\*`,...baseline],effective=[...fileRules];const calls=[];
 const manager=createSandboxieWorkspaces({boxes:[box],baselineOpenFilePaths:{[box]:baseline},protectedPaths:[vault,home],
  listRegisteredWorkspaces:async()=>[workspace,next],assertIdle:async name=>calls.push(['idle',name]),
  queryOpenFilePaths:async name=>{assert.equal(name,box);return [...fileRules];},
  appendOpenFilePath:async(name,value)=>{calls.push(['append',name,value]);fileRules.push(value);},
  deleteOpenFilePath:async(name,value)=>{calls.push(['delete',name,value]);fileRules=fileRules.filter(row=>row!==value);},
  reloadConfiguration:async()=>{calls.push(['reload']);effective=[...fileRules];},
  queryEffectiveOpenFilePaths:async name=>{assert.equal(name,box);return [...effective];},
 });
 return {root,workspace,next,vault,home,box,baseline,calls,manager,get fileRules(){return fileRules;},cleanup:async()=>{}};
}

test('prepare replaces only a registered stale workspace rule and verifies file plus effective config',async()=>{
 const f=await fixture();try{
  const stale=`${f.workspace}\\*`,result=await f.manager.prepareWorkspace({boxName:f.box,cwd:f.next});
  assert.equal(result.workspace,await realpath(f.next));
  assert.deepEqual(f.calls,[['idle',f.box],['delete',f.box,`${f.workspace}\\*`],['append',f.box,`${await realpath(f.next)}\\*`],['reload']]);
  assert.deepEqual(f.fileRules,[...f.baseline,`${await realpath(f.next)}\\*`]);
  assert.ok(!f.fileRules.includes(stale));
 }finally{await f.cleanup();}
});

test('prepare rejects protected paths, unknown boxes, unknown dynamic rules, and non-idle slots before edits',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.manager.validateWorkspacePath(f.vault),/受保護/u);
  await assert.rejects(f.manager.prepareWorkspace({boxName:'unknown',cwd:f.next}),/專用 Sandboxie/u);
  f.fileRules.splice(0,1,`${f.root}\\*`);
  await assert.rejects(f.manager.prepareWorkspace({boxName:f.box,cwd:f.next}),/已登錄工作區/u);
  assert.deepEqual(f.calls,[['idle',f.box]]);
 }finally{await f.cleanup();}
});

test('prepare aborts before touching configuration when box is busy or active readback mismatches',async()=>{
 const f=await fixture();try{
  const original=f.manager;
  // A separate manager represents the reservation check owned by the slot.
  const busy=createSandboxieWorkspaces({boxes:[f.box],baselineOpenFilePaths:{[f.box]:f.baseline},protectedPaths:[f.vault],listRegisteredWorkspaces:async()=>[f.workspace,f.next],
   assertIdle:async()=>{throw Error('busy');},queryOpenFilePaths:async()=>f.fileRules,appendOpenFilePath:async()=>assert.fail('must not edit'),deleteOpenFilePath:async()=>{},reloadConfiguration:async()=>{},queryEffectiveOpenFilePaths:async()=>f.fileRules});
  await assert.rejects(busy.prepareWorkspace({boxName:f.box,cwd:f.next}),/busy/u);
  let config=[`${f.workspace}\\*`,...f.baseline],live=[...config];
  const staleReadback=createSandboxieWorkspaces({boxes:[f.box],baselineOpenFilePaths:{[f.box]:f.baseline},protectedPaths:[f.vault],listRegisteredWorkspaces:async()=>[f.workspace,f.next],
   assertIdle:async()=>{},queryOpenFilePaths:async()=>config,
   appendOpenFilePath:async(_box,value)=>config.push(value),deleteOpenFilePath:async(_box,value)=>{config=config.filter(row=>row!==value);},
   reloadConfiguration:async()=>{},queryEffectiveOpenFilePaths:async()=>live});
  await assert.rejects(staleReadback.prepareWorkspace({boxName:f.box,cwd:f.next}),/有效 OpenFilePath/u);
  assert.ok(f.fileRules.some(row=>row.endsWith('\\*')));
 }finally{await f.cleanup();}
});

test('workspace path rejects junction ancestors',async t=>{
 const f=await fixture();try{
  const target=path.join(f.root,'target');await mkdir(target);
  const junction=path.join(f.root,'junction');
  try{await symlink(target,junction,'junction');}catch(error){t.skip(`junction creation unavailable: ${error.code??error.message}`);return;}
  await assert.rejects(f.manager.validateWorkspacePath(path.join(junction,'child')),/symlink\/junction/u);
 }finally{await f.cleanup();}
});

test('workspace validation rejects injection, unregistered paths, protected descendants, and candidate contents',async()=>{
 const f=await fixture();try{
  const candidateRoot=path.join(f.root,'candidate');await mkdir(candidateRoot);const defaultWorkspace=path.join(candidateRoot,'default');await mkdir(defaultWorkspace);
  const manager=createSandboxieWorkspaces({boxes:[f.box],baselineOpenFilePaths:{[f.box]:f.baseline},protectedPaths:[f.vault,f.home],candidateRoot,defaultWorkspace,
   listRegisteredWorkspaces:async()=>[f.workspace,f.next,defaultWorkspace],assertIdle:async()=>{},queryOpenFilePaths:async()=>f.fileRules,
   appendOpenFilePath:async()=>{},deleteOpenFilePath:async()=>{},reloadConfiguration:async()=>{},queryEffectiveOpenFilePaths:async()=>f.fileRules});
  await assert.rejects(manager.validateWorkspacePath(`${f.next}?x`),/萬用字元/u);
  assert.equal(await manager.validateWorkspacePath(f.root),await realpath(f.root));
  await assert.rejects(manager.prepareWorkspace({boxName:f.box,cwd:f.root}),/尚未登錄/u);
  await assert.rejects(manager.validateWorkspacePath(candidateRoot),/候選執行環境/u);
  await assert.rejects(manager.validateWorkspacePath(f.vault),/受保護/u);
  assert.equal(await manager.validateWorkspacePath(defaultWorkspace),await realpath(defaultWorkspace));
 }finally{await f.cleanup();}
});

test('owner adapter updates only one box, preserves surrounding INI bytes, backs up once, and uses stubbed Sandboxie commands',async()=>{
 const base=path.join(path.resolve('.runtime'),`k-sbie-adapter-${process.pid}-${Date.now()}`);
 const portable=path.join(base,'portable'),vault=path.join(base,'vault'),stateRoot=path.join(vault,'private-state'),workspace=path.join(base,'workspace'),external=path.join(`${base}-outside`,'新工作區'),next=external;
 await mkdir(portable,{recursive:true});await mkdir(vault);await mkdir(stateRoot,{recursive:true});await mkdir(workspace);await mkdir(path.dirname(next),{recursive:true});await mkdir(next);
 const paths={root:base,vault,trustedRuntime:path.join(base,'trusted-runtime'),trustedProviders:path.join(base,'trusted-providers'),stateRoot,workspace,agentHome:path.join(base,'agent-home'),browserProfiles:path.join(base,'browser'),browserOutput:path.join(base,'browser-output'),startExe:path.join(portable,'Start.exe')};
 for(const dir of [paths.agentHome,paths.trustedRuntime,paths.trustedProviders,paths.browserProfiles,paths.browserOutput])await mkdir(dir);
 await writeFile(paths.startExe,'stub');await writeFile(path.join(portable,'SbieDll.dll'),'stub');
 await writeFile(path.join(stateRoot,'.runtime','projects.json'),'[]').catch(async()=>{await mkdir(path.join(stateRoot,'.runtime'));await writeFile(path.join(stateRoot,'.runtime','projects.json'),'[]');});
 // Registration is persisted by the same project list consumed by the owner adapter.
 await writeFile(path.join(stateRoot,'.runtime','projects.json'),JSON.stringify([workspace,next]));
 const iniPath=path.join(portable,'Sandboxie.ini');
 const original=`\uFEFF; retain comment with 中文\r\n[GlobalSettings]\r\nKeep=原樣\r\n\r\n[KCandidate1]\r\nOpenFilePath=${workspace}\\*\r\nOpenFilePath=${paths.agentHome}\\*\r\nOpenFilePath=${paths.browserOutput}\\*\r\nOther=不變\r\n\r\n[KCandidate2]\r\nOpenFilePath=D:\\other\\*\r\n`;
 await writeFile(iniPath,original,'utf16le');
 let effective1=[`${workspace}\\*`,`${paths.agentHome}\\*`,`${paths.browserOutput}\\*`];const calls=[];
 const execFileImpl=async(exe,args)=>{
  calls.push([path.basename(exe),args]);
  if(args.includes('-DllPath'))return {stdout:Buffer.from(JSON.stringify(effective1),'utf8')};
  if(args[0]==='/reload'){
   const text=await readFile(iniPath,'utf16le');
   effective1=[...text.matchAll(/^OpenFilePath=(.*)$/gmu)].slice(0,3).map(match=>match[1]);
   return {stdout:Buffer.alloc(0)};
  }
  assert.fail('unexpected Sandboxie command');
 };
 try{
  const access=await createSandboxieWorkspaceAccess({paths,boxNames:['KCandidate1','KCandidate2'],execFileImpl,assertIdleImpl:async()=>calls.push(['idle'])});
  await access.prepareWorkspace({boxName:'KCandidate1',cwd:next});
  const after=await readFile(iniPath,'utf16le');
  assert.ok(after.startsWith('\uFEFF; retain comment with 中文\r\n[GlobalSettings]\r\nKeep=原樣\r\n\r\n'));
  assert.ok(after.includes('[KCandidate2]\r\nOpenFilePath=D:\\other\\*\r\n'));
  assert.ok(after.includes(`OpenFilePath=${next}\\*`));
  assert.ok(!after.includes(`OpenFilePath=${workspace}\\*`));
  assert.deepEqual(await readFile(path.join(vault,'Sandboxie.ini.pre-workspace-access.bak'),'utf16le'),original);
  assert.deepEqual(calls.filter(call=>call[0]==='Start.exe'),[['Start.exe',['/reload']]]);
  assert.equal(calls.filter(call=>call[0]==='powershell.exe').length,1);
  assert.equal((await readFile(iniPath))[0],0xff);
 }finally{/* Retain isolated fake fixtures for review; no permanent deletion. */}
});

test('prepare serializes different boxes across configuration reloads',async()=>{
 const f=await fixture();try{
  const box2='KCandidate2';let active=0,maxActive=0;const files={KCandidate1:[`${f.workspace}\\*`,...f.baseline],KCandidate2:[`${f.workspace}\\*`,...f.baseline]};
  const manager=createSandboxieWorkspaces({boxes:[f.box,box2],baselineOpenFilePaths:{[f.box]:f.baseline,[box2]:f.baseline},protectedPaths:[f.vault,f.home],listRegisteredWorkspaces:async()=>[f.workspace,f.next],
   assertIdle:async()=>{},queryOpenFilePaths:async box=>files[box],appendOpenFilePath:async(box,value)=>files[box].push(value),deleteOpenFilePath:async(box,value)=>{files[box]=files[box].filter(item=>item!==value);},
   reloadConfiguration:async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,15));active--;},queryEffectiveOpenFilePaths:async box=>files[box]});
  await Promise.all([manager.prepareWorkspace({boxName:f.box,cwd:f.next}),manager.prepareWorkspace({boxName:box2,cwd:f.next})]);
  assert.equal(maxActive,1);
 }finally{await f.cleanup();}
});
