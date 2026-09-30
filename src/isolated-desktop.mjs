import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {startDesktop} from './desktop-server.mjs';
import {createConversationController} from './conversation-controller.mjs';
import {createUnifiedController} from './unified-controller.mjs';
import {createDesktopController} from './desktop-controller.mjs';
import {createClaudeController} from './claude-controller.mjs';
import {createLunaBridge} from './luna-bridge.mjs';
import {inspectClaude} from './claude-host.mjs';
import {openClaudeHost} from './claude-host.mjs';
import {openCodexHost} from './codex-host.mjs';
import {createClaudeLogin} from './claude-login.mjs';
import {createCodexLogin} from './codex-login.mjs';
import {createIsolatedProviderHosts,isolatedCodexSandboxPolicy} from './isolated-provider-hosts.mjs';
import {createDispatcher} from './dispatcher.mjs';
import {addProject,listProjects,updateProject} from './projects.mjs';
import {pickWorkspaceDirectory} from './workspace-picker.mjs';
import {validateWorkspace} from './workspaces.mjs';

/** Explicit isolated candidate only. Installation/policy verification belong
 * to the owner launcher, not to a model-writable project configuration. */
export async function startIsolatedDesktop({root,workspace,port,executable,commandSpec,
  pool,env,runnerIdentity,browsers,allowLogin=false,workspaceLabel='隔離測試工作區',startDesktopImpl=startDesktop,pickWorkspace=pickWorkspaceDirectory,
  workspaceAccess,native=false}={}){
  if((!native&&(!pool?.spawnImpl||!pool?.close))||!browsers?.session||!browsers?.request||!browsers?.close)throw Error('Execution and owner browser services are required.');
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('A fixed, network-protected desktop port is required.');
  if(!path.isAbsolute(executable??'')||!path.isAbsolute(commandSpec?.command??''))throw Error('Explicit trusted provider executables are required.');
  const stateRoot=await realpath(root);
  const validateWorkspacePath=workspaceAccess?.validateWorkspacePath;
  if(workspaceAccess!==undefined&&typeof validateWorkspacePath!=='function')throw Error('workspaceAccess.validateWorkspacePath must be an async workspace validator.');
  const validateSelectableWorkspace=async requested=>{
    const canonical=await validateWorkspace(requested);
    const validated=validateWorkspacePath?await validateWorkspacePath(canonical):canonical;
    const resolved=await validateWorkspace(validated);
    if(resolved.toLowerCase()===stateRoot.toLowerCase())throw Error('Candidate state and agent workspace must be separate.');
    return resolved;
  };
  const selected=await validateSelectableWorkspace(workspace);
  const validateRegisteredWorkspace=async requested=>{
    const canonical=await validateWorkspace(requested);
    const validated=validateWorkspacePath?await validateWorkspacePath(canonical):canonical;
    const resolved=await validateWorkspace(validated);
    if(resolved.toLowerCase()===stateRoot.toLowerCase())throw Error('此隔離環境僅允許指定的工作區。');
    if(!native&&!workspaceAccess&&resolved.toLowerCase()!==selected.toLowerCase())throw Error('此隔離環境僅允許指定的工作區。');
    const registered=(await listProjects(stateRoot)).projects.some(project=>project.path.toLowerCase()===resolved.toLowerCase());
    if(!registered)throw Error('此隔離環境僅允許指定的工作區。');
    return resolved;
  };
  const hosts=native?{codex:options=>openCodexHost({...options,env}),claude:options=>openClaudeHost({...options,env})}:createIsolatedProviderHosts({spawnImpl:pool.spawnImpl,env,runnerIdentity});
  const sandboxPolicyForMode=native?undefined:isolatedCodexSandboxPolicy;
  const inspect=({signal}={})=>inspectClaude({commandSpec,cwd:selected,env,signal,captureImpl:hosts.captureImpl,runnerIdentity});
  const codexHost=(options,workspace=selected)=>hosts.codex({...options,executable,cwd:workspace});
  const claudeHost=(options,workspace=selected)=>hosts.claude({...options,commandSpec,cwd:workspace});
  function restrictWorkspace(controller){
    const change=controller.selectWorkspace.bind(controller);
    controller.selectWorkspace=async data=>{
      const canonical=await validateRegisteredWorkspace(data?.path);
      return change({path:canonical});
    };
    return controller;
  }
  const controllerFactory=options=>restrictWorkspace(createConversationController({...options,browserRequest:browsers.request,
    sessionFactory:settings=>restrictWorkspace(createUnifiedController({...settings,inspect,
      codexFactory:opts=>{const browser=browsers.session();let current;const hostFactory=hostOptions=>{const candidate=current?.state.workspace??selected;return codexHost(hostOptions,candidate.toLowerCase()===stateRoot.toLowerCase()?selected:candidate);};current=createDesktopController({...opts,hostFactory,browserConfig:browser.config,closeBrowser:browser.close,browserRequest:browsers.request,sandboxPolicyForMode});return current;},
      claudeFactory:opts=>{const browser=browsers.session();let current;const selectedHostWorkspace=()=>{const candidate=current?.state.workspace??selected;return candidate.toLowerCase()===stateRoot.toLowerCase()?selected:candidate;};const hostFactory=hostOptions=>claudeHost(hostOptions,selectedHostWorkspace());const lunaHostFactory=hostOptions=>codexHost(hostOptions,selectedHostWorkspace());current=createClaudeController({...opts,commandSpec,hostFactory,browserConfig:browser.config,closeBrowser:browser.close,bridgeFactory:params=>createLunaBridge({...params,executable,hostFactory:lunaHostFactory,sandboxPolicyForMode})});return current;},
    })),
  }));
  const loginGate=login=>allowLogin?login:{...login,async start(){throw Error('本候選僅供假資料驗證；尚未允許真實帳號登入。');}};
  let app;
  try{
    // The state vault is an implementation directory, never an agent workspace.
    // Keep the existing UI's project list usable without changing global UI.
    const knownWorkspace=(await listProjects(stateRoot)).projects.some(project=>project.path.toLowerCase()===selected.toLowerCase());
    await addProject(stateRoot,selected);
    await updateProject(stateRoot,{path:stateRoot,archived:true});
    if(!knownWorkspace)await updateProject(stateRoot,{path:selected,name:workspaceLabel,archived:false});
    app=await startDesktopImpl({root:stateRoot,executable,port,requireLaunchToken:true,controllerFactory,browserRequest:browsers.request,deployment:native?'native':'isolated',
      claudeLoginFactory:()=>loginGate(createClaudeLogin({cwd:selected,env,inspect,resolve:async()=>commandSpec,spawnImpl:pool?.spawnImpl})),
      codexLoginFactory:()=>loginGate(createCodexLogin({cwd:selected,executable,hostFactory:codexHost})),
      pickWorkspace,validateProjectWorkspace:validateSelectableWorkspace,
    });
    await app.controller.selectWorkspace({path:selected});
  }catch(error){await app?.close().catch(()=>{});await browsers.close().catch(()=>{});await pool?.close().catch(()=>{});throw error;}
  return {...app,
    // Pi remains a bounded tool host; executable test code must use the same
    // isolated runner. No provider key is forwarded into the child environment.
    createWorkerDispatcher:async options=>{
      const workerWorkspace=await validateRegisteredWorkspace(options?.workspace??app.controller.state.workspace??selected);
      return createDispatcher({...options,workspace:workerWorkspace});
    },
    async close(){await app.close();await browsers.close();await pool?.close();},
  };
}
