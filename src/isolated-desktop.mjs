import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {startDesktop} from './desktop-server.mjs';
import {createConversationController} from './conversation-controller.mjs';
import {createUnifiedController} from './unified-controller.mjs';
import {createDesktopController} from './desktop-controller.mjs';
import {createClaudeController} from './claude-controller.mjs';
import {createGeminiController} from './gemini-controller.mjs';
import {createLunaBridge} from './luna-bridge.mjs';
import {inspectClaude} from './claude-host.mjs';
import {openClaudeHost} from './claude-host.mjs';
import {openCodexHost} from './codex-host.mjs';
import {createClaudeLogin} from './claude-login.mjs';
import {createCodexLogin} from './codex-login.mjs';
import {createGeminiLogin} from './gemini-login.mjs';
import {createHash} from 'node:crypto';
import {createGeminiAccounts} from './gemini-accounts.mjs';
import {createGeminiCredentialVault} from './gemini-credential-vault.mjs';
import {addProject,listProjects,updateProject} from './projects.mjs';
import {pickWorkspaceDirectory} from './workspace-picker.mjs';
import {validateWorkspace} from './workspaces.mjs';

/** Native desktop composition. Provider permissions remain provider-owned. */
export async function startIsolatedDesktop({root,workspace,port,executable,commandSpec,
  env,browsers,coreUpdates,allowLogin=false,workspaceLabel='隔離測試工作區',startDesktopImpl=startDesktop,pickWorkspace=pickWorkspaceDirectory}={}){
  if(!browsers?.session||!browsers?.request||!browsers?.close)throw Error('Execution and owner browser services are required.');
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('A fixed, network-protected desktop port is required.');
  if(!path.isAbsolute(executable??'')||!path.isAbsolute(commandSpec?.command??''))throw Error('Explicit trusted provider executables are required.');
  const stateRoot=await realpath(root);
  const validateSelectableWorkspace=async requested=>{
    const resolved=await validateWorkspace(requested);
    if(resolved.toLowerCase()===stateRoot.toLowerCase())throw Error('Candidate state and agent workspace must be separate.');
    return resolved;
  };
  const selected=await validateSelectableWorkspace(workspace);
  const validateRegisteredWorkspace=async requested=>{
    const resolved=await validateWorkspace(requested);
    if(resolved.toLowerCase()===stateRoot.toLowerCase())throw Error('此隔離環境僅允許指定的工作區。');
    const registered=(await listProjects(stateRoot)).projects.some(project=>project.path.toLowerCase()===resolved.toLowerCase());
    if(!registered)throw Error('此隔離環境僅允許指定的工作區。');
    return resolved;
  };
  const hosts={codex:options=>openCodexHost({...options,env}),claude:options=>openClaudeHost({...options,env})};
  const inspect=({signal}={})=>inspectClaude({commandSpec,cwd:selected,env,signal});
  const codexHost=(options,workspace=selected)=>hosts.codex({...options,executable,cwd:workspace});
  const claudeHost=(options,workspace=selected)=>hosts.claude({...options,commandSpec,cwd:workspace});
  const geminiLogin=createGeminiLogin({cwd:stateRoot,env});
  const geminiAccounts=createGeminiAccounts({root:stateRoot,login:geminiLogin,enabled:allowLogin,
    vault:createGeminiCredentialVault({root:createHash('sha256').update(stateRoot.toLowerCase()).digest('hex'),env,enabled:allowLogin})});
  function restrictWorkspace(controller){
    const change=controller.selectWorkspace.bind(controller);
    controller.selectWorkspace=async data=>{
      const canonical=await validateRegisteredWorkspace(data?.path);
      return change({path:canonical});
    };
    if(controller.moveWorkspace){const move=controller.moveWorkspace.bind(controller);controller.moveWorkspace=async data=>move({...data,workspace:await validateRegisteredWorkspace(data?.workspace)});}
    return controller;
  }
  const controllerFactory=options=>restrictWorkspace(createConversationController({...options,browserRequest:browsers.request,
    sessionFactory:settings=>restrictWorkspace(createUnifiedController({...settings,inspect,
      geminiFactory:opts=>{const browser=browsers.session();return createGeminiController({...opts,env,accounts:geminiAccounts,browserConfig:browser.config,closeBrowser:browser.close});},
      codexFactory:opts=>{const browser=browsers.session();let current;const hostFactory=hostOptions=>{const candidate=current?.state.workspace??selected;return codexHost(hostOptions,candidate.toLowerCase()===stateRoot.toLowerCase()?selected:candidate);};current=createDesktopController({...opts,hostFactory,bridgeFactory:params=>createLunaBridge({...params,geminiOptions:{env,accounts:geminiAccounts,browserSession:browsers.session}}),browserConfig:browser.config,closeBrowser:browser.close,browserRequest:browsers.request});return current;},
      claudeFactory:opts=>{const browser=browsers.session();let current;const selectedHostWorkspace=()=>{const candidate=current?.state.workspace??selected;return candidate.toLowerCase()===stateRoot.toLowerCase()?selected:candidate;};const hostFactory=hostOptions=>claudeHost(hostOptions,selectedHostWorkspace());const lunaHostFactory=hostOptions=>codexHost(hostOptions,selectedHostWorkspace());current=createClaudeController({...opts,commandSpec,hostFactory,browserConfig:browser.config,closeBrowser:browser.close,bridgeFactory:params=>createLunaBridge({...params,executable,hostFactory:lunaHostFactory,geminiOptions:{env,accounts:geminiAccounts,browserSession:browsers.session}})});return current;},
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
    app=await startDesktopImpl({root:stateRoot,executable,port,controllerFactory,browserRequest:browsers.request,coreUpdates,
      claudeLoginFactory:()=>loginGate(createClaudeLogin({cwd:selected,env,inspect,resolve:async()=>commandSpec})),
      codexLoginFactory:()=>loginGate(createCodexLogin({cwd:selected,executable,hostFactory:codexHost})),
      geminiLoginFactory:()=>loginGate(geminiLogin),geminiAccounts,
      pickWorkspace,validateProjectWorkspace:validateSelectableWorkspace,
    });
    await app.controller.selectWorkspace({path:selected});
  }catch(error){await app?.close().catch(()=>{});await browsers.close().catch(()=>{});throw error;}
  return {...app,
    async close(){await app.close();await browsers.close();},
  };
}
