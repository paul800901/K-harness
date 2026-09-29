import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {isolatedLauncherPaths,runIsolatedLauncherProtocol} from './isolated-launcher.mjs';
import {stat,realpath} from 'node:fs/promises';

const ORIGIN='http://127.0.0.1:47831';

async function trustedFile(file,root){
  if(!path.isAbsolute(file)||!(await stat(file)).isFile())throw Error('Required trusted Electron file is missing.');
  const base=await realpath(root),actual=await realpath(file),relative=path.relative(base,actual);
  if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw Error('Electron runtime escaped the trusted candidate.');
  return actual;
}
function electronEnvironment(source){
  const env={...source};
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Node parent: private Electron CDP pipe + private launcher stdin protocol. */
export async function startElectronIsolatedLauncher({paths=isolatedLauncherPaths(),input=process.stdin,output=process.stdout,
  electronPath=paths.electronExecutable,mainPath=path.join(paths.trustedRuntime,'src','electron-isolated-main.cjs'),spawnImpl=spawn,processObject=process}={}){
  const executable=await trustedFile(electronPath,paths.trustedRuntime);
  const main=await trustedFile(mainPath,paths.trustedRuntime);
  const child=spawnImpl(executable,[main,'--remote-debugging-pipe'],{
    cwd:paths.trustedRuntime,env:{...electronEnvironment(processObject.env),K_ISOLATED_PARENT_NODE_EXECUTABLE:processObject.execPath},
    windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe','ipc'],
  });
  let protocol=null,readyResolve,readyReject,failed=false,exited=false,normalCloseRequested=false;
  const readyPromise=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const startupTimer=setTimeout(()=>{
    readyReject(Error('Native Electron workbench startup timed out.'));
    if(child.connected)child.send({type:'owner-request',id:0,method:'close'},()=>{});
  },120000);
  const pending=new Map();let nextId=1;
  const rpc=(method,timeout=15000)=>new Promise((resolve,reject)=>{
    if(exited||!child.connected)return reject(Error('Native workbench child is disconnected.'));
    const id=nextId++,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Native workbench ${method} request timed out.`));},timeout);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    child.send({type:'owner-request',id,method},error=>{if(error){pending.delete(id);clearTimeout(timer);reject(error);}});
  });
  const fail=()=>{
    if(failed)return;failed=true;readyReject(Error('Native Electron workbench disconnected before ready.'));
    for(const request of pending.values())request.reject(Error('Native Electron workbench disconnected.'));pending.clear();
    if(protocol&&!exited)void protocol.close();
  };
  let cdpBuffer=Buffer.alloc(0);
  child.stdio[4]?.on('data',chunk=>{
    cdpBuffer=Buffer.concat([cdpBuffer,chunk]);let offset;
    while((offset=cdpBuffer.indexOf(0))>=0){const message=cdpBuffer.subarray(0,offset).toString('utf8');cdpBuffer=cdpBuffer.subarray(offset+1);if(!message)continue;
      let decoded;try{decoded=JSON.parse(message);}catch{fail();return;}
      if(!child.connected){fail();return;}child.send({type:'cdp-receive',message:decoded},error=>{if(error)fail();});
    }
    if(cdpBuffer.length>32*1024*1024)fail();
  });
  child.stdio[3]?.on('error',fail);child.stdio[4]?.on('error',fail);
  child.on('message',message=>{
    if(message?.type==='cdp-send'&&message.message&&typeof message.message==='object'){
      if(!child.stdio[3]?.write(`${JSON.stringify(message.message)}\0`))child.stdio[3].once('drain',()=>{});
      return;
    }
    if(message?.type==='owner-ready'&&message.origin===ORIGIN){readyResolve();return;}
    if(message?.type==='owner-response'&&Number.isSafeInteger(message.id)){
      const request=pending.get(message.id);if(!request)return;pending.delete(message.id);
      message.ok?request.resolve(message.value):request.reject(Error('Native workbench request failed.'));return;
    }
    if(message?.type==='owner-close-request'){void protocol?.close();return;}
    if(message?.type==='owner-error')fail();
  });
  child.once('error',fail);
  child.once('disconnect',fail);
  child.once('exit',()=>{exited=true;if(!normalCloseRequested){if(!failed)fail();processObject.exitCode=1;input.destroy?.();} });
  try{
    await readyPromise;
    clearTimeout(startupTimer);
    if(failed||exited||!child.connected)throw Error('Native workbench exited before supervisor setup.');
    let snapshot={};
    const app={origin:ORIGIN,controller:{get state(){return snapshot;}},async close(){normalCloseRequested=true;try{await rpc('close');}catch(error){normalCloseRequested=false;if(exited){processObject.exitCode=1;input.destroy?.();}throw error;}}};
    protocol=runIsolatedLauncherProtocol({app,input,output,presentation:'native',autoReady:false,
      getState:async()=>{snapshot=await rpc('state');return snapshot;},
      onOpen:()=>rpc('show'),
    });
    protocol.ready();
    return {child,protocol};
  }catch(error){clearTimeout(startupTimer);fail();processObject.exitCode=1;input.destroy?.();throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  startElectronIsolatedLauncher().catch(()=>{process.stderr.write('Isolated native K startup failed closed. No standard-host fallback was attempted.\n');process.exitCode=1;});
}

