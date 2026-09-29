import {spawn} from 'node:child_process';
import {inspectClaude,invalidateClaudeInspection,resolveClaudeCommand} from './claude-host.mjs';
import {officialClaudeLoginUrl} from '../shared/claude-login-url.mjs';

const AUTH_ENV=/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_USE_|CLAUDE_CODE_API_KEY|CLAUDE_CODE_BEDROCK|CLAUDE_CODE_VERTEX|CLAUDE_CODE_FOUNDRY|AWS_|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_CLOUD_|CLOUD_ML_|AZURE_)/i;
const STOP_TIMEOUT_MS=10000;

function loginEnvironment(source){
 const result={...source};
 for(const key of Object.keys(result))if(AUTH_ENV.test(key))delete result[key];
 return result;
}

function waitClosed(child,timeout=STOP_TIMEOUT_MS){
 let cancelWait;
 const promise=new Promise((resolve,reject)=>{
  let timer;
  const cleanup=()=>{clearTimeout(timer);child.off('close',onClose);child.off('error',onError);};
  const onClose=(code,signal)=>{cleanup();resolve({code,signal});};
  // ChildProcess emits error when signaling/starting fails, but only its close
  // event confirms that stdio and process execution have settled.
  const onError=()=>{};
  child.once('close',onClose);child.once('error',onError);
  timer=setTimeout(()=>{cleanup();reject(new Error('Claude login process did not confirm termination.'));},timeout);
  cancelWait=()=>{cleanup();resolve(null);};
 });
 promise.catch(()=>{});
 return {promise,cancel:()=>cancelWait?.()};
}

// Authentication remains entirely in the official CLI. Never expose raw output.
export function createClaudeLogin({cwd,env:providedEnvironment,inspect=inspectClaude,resolve=resolveClaudeCommand,spawnImpl=spawn,invalidate=invalidateClaudeInspection}={}){
 const envProvided=providedEnvironment!==undefined;
 const sourceEnvironment=providedEnvironment??process.env;
 const env=loginEnvironment(sourceEnvironment);
 let child=null,starting=false,canceling=null,cancelPromise=null,login={status:'idle'};
 return {
  progress(){return {login:{...login}};},
  async status(){return {...await inspect(envProvided?{cwd,env}:{cwd}),login:{...login}};},
  async start(){
   if(child||starting)return {login:{...login}};
   invalidate();starting=true;login={status:'running'};
   let spec;
   try{spec=await resolve({env});}catch{invalidate();starting=false;login={status:'error',error:'找不到官方 Claude Code，請確認安裝。'};return {login:{...login}};}
   if(!starting)return {login:{...login}};
   let current;
   try{current=spawnImpl(spec.command,[...spec.argsPrefix,'--setting-sources','','auth','login','--claudeai'],{cwd,env:{...env},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}
   catch{invalidate();starting=false;login={status:'error',error:'無法啟動官方 Claude 登入，請重新嘗試。'};return {login:{...login}};}
   child=current;starting=false;login={status:'running'};
   let buffer='';
   const consume=chunk=>{
    if(child!==current||canceling===current)return;
    buffer=(buffer+chunk.toString()).slice(-16384);
    // Wait for a delimiter, including OSC hyperlink BEL, rather than exposing
    // an incomplete URL when a stdout chunk splits in the middle of its query.
    for(const match of buffer.matchAll(/https:\/\/[^\s<>"\x00-\x20\x7f]+(?=[\s<>"\x00-\x20\x7f])/g)){
     const url=officialClaudeLoginUrl(match[0]);if(url)login.url=url;
    }
   };
   current.stdout.on('data',consume);current.stderr.on('data',consume);
   current.once('error',()=>{if(child===current){invalidate();login={status:'error',error:'無法啟動官方 Claude 登入，請重新嘗試。'};}});
   current.once('close',code=>{
    if(child!==current)return;
    invalidate();child=null;
    if(canceling===current){canceling=null;cancelPromise=null;login={status:'idle'};return;}
    login={status:code===0?'complete':'error',...(code===0?{}:{error:'登入尚未完成，請重新嘗試。'})};
   });
   return {login:{...login}};
  },
  async submitCode({code}={}){
   const current=child;
   if(!current||canceling||login.status!=='running'||!login.url||login.codeSubmitted)
    throw new Error('沒有等待授權碼的登入程序，請重新開始登入。');
   // The official CLI consumes one code#state line. Never retain or echo it,
   // put it in argv/environment, or send it through a model conversation.
   if(typeof code!=='string'||code.length>4096||/[\x00-\x1f\x7f]/.test(code))
    throw new Error('請貼上官方提供的完整單行授權碼。');
   const value=code.trim(),parts=value.split('#');
   if(parts.length!==2||parts.some(part=>!part||/\s/.test(part))||parts[1]!==new URL(login.url).searchParams.get('state'))
    throw new Error('授權碼不符合這次登入，請從目前的登入連結完成授權。');
   if(!current.stdin?.writable||current.stdin.destroyed)throw new Error('登入程序已中斷，請重新開始登入。');
   login={...login,codeSubmitted:true};
   try{await new Promise((resolve,reject)=>current.stdin.write(value+'\n',error=>error?reject(error):resolve()));}
   catch{if(child===current)login={...login,codeSubmitted:false};throw new Error('無法交付授權碼，請停止後重新登入。');}
   return {login:{...login}};
  },
  async cancel(){
   starting=false;
   const current=child;
   if(!current){invalidate();login={status:'idle'};return {login:{...login}};}
   if(canceling===current&&cancelPromise)return cancelPromise;
   invalidate();canceling=current;login={status:'running',error:'正在確認登入程序已停止。'};
   const closed=waitClosed(current);
   cancelPromise=(async()=>{
    try{
     if(typeof current.terminate==='function'){
      const result=await current.terminate('cancelled');
      if(result!==true&&result?.confirmed!==true)throw new Error('Runner did not confirm process termination.');
     }else if(typeof current.kill==='function')current.kill();
     else throw new Error('Claude login process has no stop operation.');
      const closedResult=await closed.promise;
      if(!closedResult)throw new Error('Claude login process close was not observed.');
     if(child===current)throw new Error('Claude login process close was not recorded.');
     return {login:{...login}};
    }catch{
     // Keep the child reference and the running state so a later cancel can
     // retry. A kill/terminate request is not evidence that the process ended.
     closed.cancel();
     canceling=null;cancelPromise=null;
     if(child===current)login={status:'running',error:'無法確認登入程序已停止；程序仍保留，請稍後重試停止。'};
     return {login:{...login}};
    }
   })();
   return cancelPromise;
  },
  async close(){
   const result=await this.cancel();
   if(result.login.status==='running')throw new Error('Claude login process could not be confirmed stopped; shutdown is incomplete.');
   return result;
  }
 };
}
