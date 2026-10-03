import path from 'node:path';
import {access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicWrite} from './atomic-write.mjs';
import {geminiExecutable,geminiEnvironment,geminiSettings,geminiProcess,geminiOutcome} from './gemini-worker.mjs';

const exec=promisify(execFile);
// Authentication belongs to agy and Windows. A model catalog is not proof of login.
export function createGeminiLogin({cwd,env=process.env,executable,run=geminiProcess,execImpl=exec,exists=access}={}){
 const binary=geminiExecutable(env,executable),home=path.join(cwd,'agent-home','gemini','account');
 const childEnv=geminiEnvironment(env,home);
 async function prepare(){
  if(!binary)throw Error('找不到 agy，請安裝 Antigravity CLI 並登入。');
  try{await exists(binary);}catch(error){if(error.code==='ENOENT')throw Error('找不到 agy，請安裝 Antigravity CLI 並登入。');throw error;}
  await atomicWrite(path.join(home,'.gemini','antigravity-cli','settings.json'),JSON.stringify(geminiSettings(home,'read-only')));
 }
 return {
  async status(){
   let installed=false;
   try{
    await prepare();installed=true;
    const options={cwd:home,env:childEnv,timeoutMs:30000};
    const version=await run(binary,['--version'],options);
    if(version.code!==0||version.reason||version.cleanupError)throw Error('無法確認 Antigravity CLI 版本。');
    const catalog=await run(binary,['models'],options);
    if(catalog.code!==0||catalog.reason||catalog.cleanupError)throw Error(geminiOutcome({}, {...catalog,stderr:`${catalog.stdout}\n${catalog.stderr}`}).error);
    const models=[...new Set(catalog.stdout.split(/\r?\n/u).map(line=>line.trim().split(/\s/u)[0]).filter(name=>/^gemini-[\w.-]+$/u.test(name)))];
    return {installed:true,available:true,version:version.stdout.trim(),models,auth:{status:'managed-by-cli'},reason:'已安裝 Antigravity；登入由官方程式管理。'};
   }catch(error){return {installed,available:false,models:[],reason:error.message};}
  },
  async start(){
   await prepare();
   // Human-requested interactive console. agy itself opens the official browser
   // OAuth flow when needed; never copy Chrome cookies or capture tokens/codes.
   await execImpl(path.join(env.SystemRoot??env.WINDIR,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Start-Process -FilePath $env:K_AGY_LOGIN_EXECUTABLE -WorkingDirectory $env:HOME -WindowStyle Normal | Out-Null"],
    {cwd:home,env:{...childEnv,K_AGY_LOGIN_EXECUTABLE:binary},windowsHide:true,timeout:10000,maxBuffer:4096});
   return {login:{status:'opened'},reason:'已開啟官方 Antigravity。若需要登入，請在它開啟的外部瀏覽器完成；結束後可關閉官方程式。'};
  },
 };
}
