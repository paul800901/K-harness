import path from 'node:path';
import {mkdir,realpath,stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createSandboxiePool} from './sandboxie-pool.mjs';
import {isolatedAgentEnvironment} from './sandboxie-control.mjs';
import {createOwnerBrowserRegistry} from './owner-browser-registry.mjs';
import {startIsolatedDesktop} from './isolated-desktop.mjs';
import {createSandboxieWorkspaceAccess} from './sandboxie-workspaces.mjs';

export const ISOLATED_CANDIDATE_ROOT=String.raw`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee`;
export const ISOLATED_FORMAL_PORT=47831;

export function isolatedLauncherPaths(candidateRoot=ISOLATED_CANDIDATE_ROOT){
  if(!path.isAbsolute(candidateRoot))throw Error('Candidate root must be absolute.');
  const root=path.resolve(candidateRoot),vault=path.join(root,'vault'),trustedRuntime=path.join(root,'trusted-runtime');
  const trustedProviders=path.join(root,'trusted-providers');
  return {root,vault,trustedRuntime,trustedProviders,stateRoot:path.join(vault,'private-state'),workspace:path.join(root,'workspace'),
    agentHome:path.join(root,'agent-home'),browserProfiles:path.join(vault,'profiles'),browserOutput:path.join(root,'browser-output'),
    electronExecutable:path.join(trustedRuntime,'node_modules','electron','dist','electron.exe'),
    startExe:path.join(root,'portable','Start.exe'),bridgePath:path.join(trustedRuntime,'src','sandboxie-stdio-bridge.mjs'),
    executable:path.join(root,'trusted-providers','codex','codex.exe'),claudeCommand:path.join(root,'trusted-providers','claude.exe')};
}

async function requiredFile(file){try{if(!(await stat(file)).isFile())throw Error(`Required trusted file is missing: ${file}`);}catch(error){if(error.code==='ENOENT')throw Error(`Required trusted file is missing: ${file}`);throw error;}}
async function requiredDirectory(directory){if(!(await stat(directory)).isDirectory())throw Error(`Required isolated directory is missing: ${directory}`);}
async function checkUnder(parent,target){
  const base=await realpath(parent),actual=await realpath(target),relative=path.relative(base,actual);
  if(relative===''||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw Error('Isolated path escaped its owner root.');
  return actual;
}

/** Starts the approved isolated production runtime with owner-selected workspaces. */
export async function startIsolatedOwner({
  paths=isolatedLauncherPaths(),sourceEnv=process.env,nodeExecutable=process.execPath,gatewayFactory,
  execution='native',
  poolFactory=createSandboxiePool,browserFactory=createOwnerBrowserRegistry,desktopFactory=startIsolatedDesktop,
  workspaceAccessFactory=createSandboxieWorkspaceAccess,
}={}){
  const p=paths;
  if(!['native','sandboxie'].includes(execution))throw Error('Unknown execution mode.');
  const native=execution==='native';
  if(!path.isAbsolute(nodeExecutable??''))throw Error('A trusted absolute Node executable is required.');
  await requiredFile(nodeExecutable);
  for(const key of ['root','vault','trustedRuntime','trustedProviders','stateRoot','workspace','agentHome','browserProfiles','browserOutput','startExe','bridgePath','executable','claudeCommand']){
    if(!path.isAbsolute(p?.[key]??''))throw Error(`Missing absolute isolated launch path: ${key}`);
  }
  await requiredDirectory(p.root);await requiredDirectory(p.vault);await requiredDirectory(p.trustedRuntime);await requiredDirectory(p.trustedProviders);
  await requiredDirectory(p.workspace);await requiredDirectory(p.agentHome);await requiredDirectory(p.browserProfiles);
  await requiredDirectory(p.browserOutput);
  if(!native){await requiredFile(p.startExe);await requiredFile(p.bridgePath);}
  await requiredFile(p.executable);await requiredFile(p.claudeCommand);
  await checkUnder(p.root,p.trustedRuntime);await checkUnder(p.root,p.trustedProviders);
  if(!native)await checkUnder(p.trustedRuntime,p.bridgePath);
  await checkUnder(p.trustedProviders,p.executable);await checkUnder(p.trustedProviders,p.claudeCommand);
  if(!native)await checkUnder(p.root,p.startExe);
  await checkUnder(p.root,p.workspace);await checkUnder(p.root,p.agentHome);
  await checkUnder(p.vault,p.browserProfiles);await checkUnder(p.root,p.browserOutput);
  await checkUnder(p.vault,p.stateRoot).catch(async error=>{
    if(error.code!=='ENOENT')throw error;
    await mkdir(p.stateRoot,{recursive:false});
    await checkUnder(p.vault,p.stateRoot);
  });
  // State is created by the trusted owner under the candidate vault. Existing candidate state remains untouched.
  const env=native?{...sourceEnv,CODEX_HOME:path.join(p.agentHome,'.codex'),CLAUDE_CONFIG_DIR:path.join(p.agentHome,'.claude')}
    :isolatedAgentEnvironment({home:p.agentHome,source:sourceEnv});
  // Keep provider subscription homes and prevent inherited API billing credentials.
  if(native)for(const key of Object.keys(env)){
    if(/^(OPENAI_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|DEEPSEEK_API_KEY)$/i.test(key))delete env[key];
  }
  let pool,browsers,app;
  try{
    const boxNames=Array.from({length:8},(_,i)=>`KCandidate${i+1}`);
    const workspaceAccess=native?undefined:await workspaceAccessFactory({paths:p,boxNames});
    if(!native)pool=await poolFactory({startExe:p.startExe,nodeExecutable,bridgePath:p.bridgePath,
      boxNames,env,prepareLaunch:workspaceAccess.prepareWorkspace});
    browsers=browserFactory({vault:p.browserProfiles,outputRoot:p.browserOutput,testOnly:false,gatewayFactory});
    app=await desktopFactory({root:p.stateRoot,workspace:p.workspace,port:ISOLATED_FORMAL_PORT,
      executable:p.executable,commandSpec:{command:p.claudeCommand,argsPrefix:[]},pool,env,
      native,runnerIdentity:native?'host':'sandboxie-private-workspace',browsers,allowLogin:true,workspaceLabel:'私人工作區',workspaceAccess});
    return {app,pool,browsers};
  }catch(error){
    await app?.close().catch(()=>{});await browsers?.close().catch(()=>{});await pool?.close().catch(()=>{});
    throw error;
  }
}

function launchUrl(app){
  const value=app.createLaunchUrl(),actual=new URL(value),origin=new URL(app.origin);
  if(actual.origin!==origin.origin||actual.pathname!=='/bootstrap'||!/^[a-f0-9]{64}$/i.test(actual.searchParams.get('token')??''))
    throw Error('Isolated desktop did not provide a valid one-use bootstrap URL.');
  return value;
}

/** Private stdio protocol: caller must keep launchUrl in memory and never log it. */
export function runIsolatedLauncherProtocol({app,input=process.stdin,output=process.stdout,onExit=code=>{process.exitCode=code;},
  presentation='legacy',onOpen,autoReady=true}={}){
  if(!app||typeof app.close!=='function'||(presentation!=='native'&&typeof app.createLaunchUrl!=='function'))throw Error('A running isolated desktop is required.');
  const lines=createInterface({input,crlfDelay:Infinity});let closing=false,closePromise=null,resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const emit=event=>output.write(`${JSON.stringify(event)}\n`);
  const issue=type=>{try{emit(presentation==='native'?{type,presentation:'native',origin:app.origin,pid:process.pid}:{type,origin:app.origin,pid:process.pid,launchUrl:launchUrl(app)});}catch{emit({type:'error',code:'launch-url-unavailable'});}};
  const ready=()=>issue('ready');
  const close=()=>{
    if(closePromise)return closePromise;
    closePromise=(async()=>{
    closing=true;
      try{await app.close();emit({type:'closed',confirmed:true,pid:process.pid});onExit(0);resolveDone({closed:true});lines.close();return {closed:true};}
      catch{emit({type:'closed',confirmed:false,pid:process.pid});closing=false;closePromise=null;return {closed:false};}
    })().catch(()=>{emit({type:'closed',confirmed:false,pid:process.pid});closing=false;closePromise=null;return {closed:false};});return closePromise;
  };
  lines.on('line',line=>{if(line==='open'&&!closing){Promise.resolve(onOpen?.()).then(()=>issue('open')).catch(()=>emit({type:'error',code:'native-open-failed'}));}else if(line==='close')void close();else emit({event:'error',code:'unknown-command'});});
  lines.once('close',()=>{if(!closing)void close();});
  if(autoReady)ready();
  return {done,close,ready};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const run=async()=>{
    let services;
    try{
      services=await startIsolatedOwner();
      const protocol=runIsolatedLauncherProtocol({app:services.app});
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void protocol.close());
    }
    catch{process.stderr.write('Isolated K startup failed closed. No standard-host fallback was attempted.\n');process.exitCode=1;await services?.app?.close().catch(()=>{});await services?.browsers?.close().catch(()=>{});await services?.pool?.close().catch(()=>{});}
  };
  await run();
}
