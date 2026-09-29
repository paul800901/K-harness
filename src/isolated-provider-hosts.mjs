import {openCodexHost} from './codex-host.mjs';
import {openClaudeHost} from './claude-host.mjs';
import {permissionMode,threadPermissions,turnPermissions} from './desktop-permissions.mjs';

// Used only when the owner explicitly creates the Sandboxie-backed candidate.
// Read-only stays native read-only (and is rejected here because the isolated
// candidate's native Codex sandbox is not configured). Never pretend that the
// outer Sandboxie box is an application-level read-only grant.
export function isolatedCodexSandboxPolicy(mode){
  const access=permissionMode(mode);
  if(access==='read-only')throw new Error('隔離 Codex 尚未具備可驗證的唯讀執行政策；未建立或送出工作。');
  // The configured Sandboxie candidate allows general network access. Do not
  // describe it to Codex as restricted merely to mirror an older native mode.
  return {type:'externalSandbox',networkAccess:'enabled'};
}

export function isolatedCodexPermissions(mode,workspace,{thread=false}={}){
  const access=permissionMode(mode);
  const sandboxPolicy=isolatedCodexSandboxPolicy(access);
  const permissions=thread?threadPermissions(access,workspace):turnPermissions(access,workspace);
  if(!thread)permissions.sandboxPolicy=sandboxPolicy;
  return permissions;
}

// Both subscription inspection and the long-lived native host use the SAME
// runner/home. This factory never selects a host-side or API fallback.
export function createIsolatedProviderHosts({spawnImpl, env, runnerIdentity} = {}) {
  if (typeof spawnImpl !== 'function' || !env || typeof env !== 'object' || !runnerIdentity || runnerIdentity === 'host') {
    throw new Error('An explicit isolated runner, environment and identity are required.');
  }
  const environment=Object.freeze({...env});
  async function captureImpl(spec,args,{cwd,env:captureEnv=environment,timeout=10000}={}) {
    const child=spawnImpl(spec.command,[...spec.argsPrefix,...args],{cwd,env:captureEnv,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    const stdout=[],stderr=[];let total=0,failed=null,stopping=null,settled=false,timer;
    return new Promise((resolve,reject)=>{
      const finish=(error,result)=>{
        if(settled)return;
        settled=true;clearTimeout(timer);
        error?reject(error):resolve(result);
      };
      const beginStop=error=>{
        if(settled)return;
        failed??=error;
        if(stopping)return;
        if(typeof child.terminate!=='function'){
          finish(new AggregateError([failed,new Error('Isolated runner has no confirmed termination operation.')],'Isolated subscription inspection failed; process stop cannot be confirmed.'));
          return;
        }
        stopping=Promise.resolve().then(()=>child.terminate()).then(result=>{
          if(result!==true&&result?.confirmed!==true)throw new Error('Isolated runner did not confirm process termination.');
          finish(failed);
        }).catch(stopError=>finish(new AggregateError([failed,stopError],'Isolated subscription inspection failed and runner termination was not confirmed.')));
      };
      const collect=target=>chunk=>{
        if(settled)return;
        const bytes=Buffer.from(chunk);total+=bytes.length;
        if(total>256*1024){beginStop(new Error('Isolated subscription inspection exceeded output limit.'));return;}
        target.push(bytes);
      };
      child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));
      child.stdout.once('error',error=>beginStop(error));child.stderr.once('error',error=>beginStop(error));
      child.once('error',error=>beginStop(error));
      child.stdin.once('error',error=>beginStop(error));
      child.once('close',(code,signal)=>{
        if(failed){
          if(stopping)void stopping.then(()=>finish(failed),stopError=>finish(new AggregateError([failed,stopError],'Isolated subscription inspection failed and runner termination was not confirmed.')));
          else finish(new AggregateError([failed,new Error('Isolated runner closed without a termination confirmation.')],'Isolated subscription inspection failed; process stop cannot be confirmed.'));
          return;
        }
        finish(null,{code:Number.isInteger(code)?code:1,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')});
      });
      timer=setTimeout(()=>beginStop(new Error('Isolated subscription inspection timed out.')),timeout);
      try{child.stdin.end();}catch(error){beginStop(error);}
    });
  }
  return {
    captureImpl,
    codex:options=>openCodexHost({...options,spawnImpl,env:environment}),
    claude:options=>openClaudeHost({...options,spawnImpl,env:environment,captureImpl,runnerIdentity}),
  };
}
