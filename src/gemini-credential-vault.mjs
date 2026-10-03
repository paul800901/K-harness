import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
const helperPath=fileURLToPath(new URL('../scripts/gemini-credentials.ps1',import.meta.url));
function accountIdFor(email){return createHash('sha256').update(email.toLowerCase(),'utf8').digest('hex').slice(0,32);}
function safeAccountId(value){if(typeof value!=='string'||!/^[a-f0-9]{32}$/iu.test(value))throw Error('Gemini 帳號識別碼格式無效。');return value.toLowerCase();}
function parseOutput(stdout,operation){
 let value;
 try{value=JSON.parse(stdout);}catch{throw Error('Windows 憑證 helper 回傳格式無效。');}
 if(operation==='assertIdle')return value;
 if(value===null)return null;
 if(!value||typeof value!=='object'||typeof value.email!=='string'||typeof value.accountId!=='string'||safeAccountId(value.accountId)!==value.accountId||accountIdFor(value.email)!==value.accountId)throw Error('Windows 憑證 helper 回傳安全中繼資料無效。');
 return {accountId:value.accountId,email:value.email};
}
function safeFailureMessage(error){
 let code;
 try{code=JSON.parse(String(error?.stdout??'')).errorCode;}catch{}
 if(code==='busy')return 'Antigravity 正在執行，不能切換帳號。';
 if(code==='identity')return '憑證身分缺失或不唯一，拒絕操作。';
 if(code==='credential')return 'Windows 憑證操作失敗；未輸出憑證內容。';
 return 'Windows 憑證 helper 執行失敗；未輸出憑證內容。';
}

/** Credentials stay in the Windows helper process; Node receives identity only. */
export function createGeminiCredentialVault({root,env=process.env,execImpl=execFileAsync,enabled=false}={}){
 if(typeof root!=='string'||!/^[a-f0-9]{32,64}$/iu.test(root))throw Error('Gemini 憑證命名空間必須是外部提供的十六進位 root hash。');
 const namespace=root.toLowerCase();
 const powershell=path.join(env.SystemRoot??env.WINDIR??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 async function invoke(operation,accountId,{preserveCurrent=true}={}){
  if(!enabled)throw Error('Gemini 多帳號憑證功能尚未啟用。');
  if(!['current','capture','activate','prepareLogin','assertIdle'].includes(operation))throw Error('Gemini 憑證操作無效。');
  if(typeof preserveCurrent!=='boolean')throw Error('Gemini 憑證切換選項無效。');
  const args=['-NoLogo','-NoProfile','-NonInteractive','-File',helperPath,'-Operation',operation,'-Namespace',namespace];
  if(accountId!==undefined)args.push('-AccountId',safeAccountId(accountId));
  if(operation==='activate'&&!preserveCurrent)args.push('-SkipCaptureCurrent');
  let result;
  try{result=await execImpl(powershell,args,{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:4096});}
  catch(error){throw Error(safeFailureMessage(error));}
  const payload=parseOutput(result?.stdout??'',operation);
  if(operation==='assertIdle'){
   if(payload?.idle!==true)throw Error('Antigravity 正在執行，不能切換帳號。');
   return {idle:true};
  }
  if(operation==='prepareLogin'){
   if(payload===null)return {previousAccountId:null};
   return {previousAccountId:payload.accountId};
  }
  return payload;
 }
 return Object.freeze({
  async current(){return invoke('current');},
  async assertIdle(){return invoke('assertIdle');},
  async capture(){await invoke('assertIdle');const account=await invoke('capture');if(!account)throw Error('目前沒有可保存的 Antigravity 帳號憑證。');return account;},
  async activate(accountId,{preserveCurrent=true}={}){await invoke('assertIdle');const account=await invoke('activate',accountId,{preserveCurrent});if(!account)throw Error('找不到指定的已保存 Antigravity 帳號。');return account;},
  async prepareLogin(){await invoke('assertIdle');return invoke('prepareLogin');},
 });
}
