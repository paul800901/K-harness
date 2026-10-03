import path from 'node:path';
import {access,mkdir,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {geminiExecutable,geminiEnvironment,geminiSettings,geminiProcess,geminiOutcome} from './gemini-worker.mjs';

const exec=promisify(execFile);
export function geminiQuotaWindows(text=''){
 const periods={'Weekly Limit Remaining':{key:'seven_day',label:'每週',minutes:10080},'Five Hour Limit Remaining':{key:'five_hour',label:'5 小時',minutes:300}};
 return text.split(/\r?\n/u).flatMap(line=>{
  const [group,label,remaining,reset]=line.split('\t'),period=periods[label];
  const percent=typeof remaining==='string'&&/^\d+(?:\.\d+)?%$/u.test(remaining)?Number(remaining.slice(0,-1)):NaN,resetsAt=Date.parse(reset)/1000;
  return group==='Gemini Models'&&period&&Number.isFinite(percent)&&percent>=0&&percent<=100&&Number.isFinite(resetsAt)?[{...period,remainingPercent:percent,resetsAt}]:[];
 });
}
// Authentication belongs to agy and Windows. A model catalog is not proof of login.
export function createGeminiLogin({cwd,env=process.env,executable,run=geminiProcess,execImpl=exec,exists=access}={}){
 const binary=geminiExecutable(env,executable),home=path.join(cwd,'agent-home','gemini','account');
 const childEnv=geminiEnvironment(env,home);
 async function prepare(){
  if(!binary)throw Error('找不到 agy，請安裝 Antigravity CLI 並登入。');
  try{await exists(binary);}catch(error){if(error.code==='ENOENT')throw Error('找不到 agy，請安裝 Antigravity CLI 並登入。');throw error;}
  const settings=path.join(home,'.gemini','antigravity-cli','settings.json');
  await mkdir(path.dirname(settings),{recursive:true});
  // Only initialize a new profile. Refreshing must preserve native onboarding,
  // theme and data-sharing choices made by the user in the official program.
  try{await writeFile(settings,JSON.stringify(geminiSettings(home,'read-only')),{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST')throw error;}
 }
 return {
  async status({checkAuth=true}={}){
   let installed=false;
   try{
    await prepare();installed=true;
    const options={cwd:home,env:childEnv,timeoutMs:30000};
    const version=await run(binary,['--version'],options);
    if(version.code!==0||version.reason||version.cleanupError)throw Error('無法確認 Antigravity CLI 版本。');
    const catalog=await run(binary,['models'],options);
    if(catalog.code!==0||catalog.reason||catalog.cleanupError)throw Error(geminiOutcome({}, {...catalog,stderr:`${catalog.stdout}\n${catalog.stderr}`}).error);
    const models=[...new Set(catalog.stdout.split(/\r?\n/u).map(line=>line.trim().split(/\s/u)[0]).filter(name=>/^gemini-[\w.-]+$/u.test(name)))];
    const base={installed:true,available:true,version:version.stdout.trim(),models};
    if(!checkAuth)return base;
    // /usage is answered by the CLI, without a model turn. A successful account
    // quota report proves authentication; the public model catalog does not.
    let report;
    try{report=await run(binary,['-p','/usage'],options);}
    catch{return {...base,auth:{status:'unknown'},reason:'無法確認登入狀態，請稍後刷新。'};}
    const checkedAt=new Date().toISOString();
    const windows=geminiQuotaWindows(report.stdout);
    const confirmed=report.code===0&&!report.reason&&!report.cleanupError&&windows.length>0;
    if(confirmed)return {...base,auth:{status:'authenticated',loggedIn:true,checkedAt},quota:{status:'ready',checkedAt,windows},reason:'已登入 Antigravity 訂閱，官方帳號查詢成功。'};
    const signedOut=/authentication required|not (?:logged|signed) in|unauthenticated|login required|please (?:log|sign) in/iu.test(`${report.stdout}\n${report.stderr}`);
    return {...base,auth:{status:signedOut?'signed-out':'unknown',...(signedOut?{loggedIn:false}:{}),checkedAt},reason:signedOut?'尚未登入 Gemini，請完成官方登入。':'無法確認登入狀態，請稍後刷新或開啟官方程式確認。'};
   }catch(error){return {installed,available:false,models:[],...(/未登入/u.test(error.message)?{auth:{status:'signed-out',loggedIn:false}}:{}),reason:error.message};}
  },
  async start(){
   await prepare();
   // Human-requested interactive console. agy itself opens the official browser
   // OAuth flow when needed; never copy Chrome cookies or capture tokens/codes.
   await execImpl(path.join(env.SystemRoot??env.WINDIR,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Start-Process -FilePath $env:K_AGY_LOGIN_EXECUTABLE -WorkingDirectory $env:HOME -WindowStyle Normal | Out-Null"],
    {cwd:home,env:{...childEnv,K_AGY_LOGIN_EXECUTABLE:binary},windowsHide:true,timeout:10000,maxBuffer:4096});
   return {login:{status:'opened'},reason:'已開啟官方 Antigravity；首次啟動請先完成初始設定。需要登入時會開啟外部瀏覽器；完成後回 K 刷新狀態。'};
  },
 };
}
