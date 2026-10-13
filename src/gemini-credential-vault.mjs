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
 if(value===null){if(operation==='queryQuota')throw Error('Gemini 額度回傳缺失。');return null;}
 if(!value||typeof value!=='object'||typeof value.email!=='string'||typeof value.accountId!=='string'||safeAccountId(value.accountId)!==value.accountId||accountIdFor(value.email)!==value.accountId)throw Error('Windows 憑證 helper 回傳安全中繼資料無效。');
 const account={accountId:value.accountId,email:value.email};
 if(operation!=='queryQuota')return account;
 const checkedAt=typeof value.checkedAt==='string'&&Number.isFinite(Date.parse(value.checkedAt))?value.checkedAt:null;
 if(!checkedAt||!Array.isArray(value.windows))throw Error('Gemini 官方額度回傳格式無效。');
 const windows=['five_hour','seven_day'].map(key=>{
  const rows=value.windows.filter(w=>w?.key===key);if(rows.length!==1)throw Error('Gemini 官方額度窗口缺失或重複。');
  const w=rows[0],disabled=w.disabled===true;
  if(!disabled&&(!Number.isFinite(w.remainingPercent)||w.remainingPercent<0||w.remainingPercent>100))throw Error('Gemini 官方額度數值無效。');
  return {key,label:key==='five_hour'?'5 小時':'每週',minutes:key==='five_hour'?300:10080,disabled,remainingPercent:disabled?null:w.remainingPercent,resetsAt:Number.isFinite(w.resetsAt)?w.resetsAt:null};
 });
 return {...account,auth:{status:'authenticated',checkedAt,requiresActivation:value.requiresActivation===true},quota:{status:'ready',checkedAt,windows},refreshed:value.refreshed===true};
}
function safeFailureMessage(error){
 let code;
 try{code=JSON.parse(String(error?.stdout??'')).errorCode;}catch{}
 if(code==='busy')return 'Antigravity 正在執行；請先關閉官方視窗並等工作停止，再新增、保存、取消或切換帳號。';
 if(code==='identity')return '憑證身分缺失或不唯一，拒絕操作。';
 if(code==='credential')return 'Windows 憑證操作失敗；未輸出憑證內容。';
 return 'Windows 憑證 helper 執行失敗；未輸出憑證內容。';
}

/** Credentials stay in the Windows helper process; Node receives safe identity/quota only. */
export function createGeminiCredentialVault({root,env=process.env,execImpl=execFileAsync,enabled=false}={}){
 if(typeof root!=='string'||!/^[a-f0-9]{32,64}$/iu.test(root))throw Error('Gemini 憑證命名空間必須是外部提供的十六進位 root hash。');
 const namespace=root.toLowerCase();
 const powershell=path.join(env.SystemRoot??env.WINDIR??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 // Serialize helper reads/refreshes with capture/activation. A quota refresh
 // writes only its existing managed target, never the native live credential.
 let pending=Promise.resolve();
 function invoke(...args){const operation=pending.then(()=>invokeHelper(...args));pending=operation.catch(()=>{});return operation;}
 async function invokeHelper(operation,accountId,{preserveCurrent=true}={}){
  if(!enabled)throw Error('Gemini 多帳號憑證功能尚未啟用。');
  if(!['current','capture','activate','prepareLogin','assertIdle','queryQuota'].includes(operation))throw Error('Gemini 憑證操作無效。');
  if(typeof preserveCurrent!=='boolean')throw Error('Gemini 憑證切換選項無效。');
  const args=['-NoLogo','-NoProfile','-NonInteractive','-File',helperPath,'-Operation',operation,'-Namespace',namespace];
  if(accountId!==undefined)args.push('-AccountId',safeAccountId(accountId));
  if(operation==='activate'&&!preserveCurrent)args.push('-SkipCaptureCurrent');
  if(operation==='queryQuota'){
   const executable=env.K_GEMINI_EXECUTABLE??(env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,'agy','bin','agy.exe'):null);
   if(!executable)throw Error('找不到官方 Antigravity 執行檔，未查詢帳號。');
   args.push('-Executable',executable);
  }
  let result;
  try{result=await execImpl(powershell,args,{windowsHide:true,encoding:'utf8',timeout:operation==='queryQuota'?60000:15000,maxBuffer:4096});}
  catch(error){
   if(operation==='queryQuota'){
    let code;try{code=JSON.parse(error.stdout).errorCode;}catch{}
    const signedOut=code==='quota_auth';
    return {accountId,auth:{status:signedOut?'signed-out':'unknown'},failureCode:code??'quota_temporary',temporaryFailure:['quota_temporary','credential',undefined].includes(code),reason:signedOut?'此帳號需重新確認官方登入。':code==='quota_client'?'官方額度介面、權限或登入參數無法使用；需要檢查接頭，未切換帳號。':code==='identity'?'帳號身分未確認；未接受額度資料。':code==='quota_schema'?'官方額度回傳格式改變或缺失；需要檢查接頭，未派工。':code==='credential'?'本機憑證讀寫尚未確認；K 保留等待，未派工。':'官方額度暫時無法確認；不是額度耗盡。'};
   }
   throw Error(safeFailureMessage(error));
  }
  let payload;
  try{payload=parseOutput(result?.stdout??'',operation);}catch(error){
   if(operation!=='queryQuota')throw error;
   return {accountId,auth:{status:'unknown'},failureCode:'quota_schema',temporaryFailure:false,reason:'官方額度回傳格式改變或缺失；需要檢查接頭，未派工。'};
  }
  if(operation==='assertIdle'){
   if(payload?.idle!==true)throw Error('Antigravity 正在執行；請先關閉官方視窗並等工作停止，再新增、保存、取消或切換帳號。');
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
  async queryQuota(accountId){return invoke('queryQuota',safeAccountId(accountId));},
  async assertIdle(){return invoke('assertIdle');},
  async capture(){await invoke('assertIdle');const account=await invoke('capture');if(!account)throw Error('目前沒有可保存的 Antigravity 帳號憑證。');return account;},
  async activate(accountId,{preserveCurrent=true}={}){await invoke('assertIdle');const account=await invoke('activate',accountId,{preserveCurrent});if(!account)throw Error('找不到指定的已保存 Antigravity 帳號。');return account;},
  async prepareLogin(){await invoke('assertIdle');return invoke('prepareLogin');},
 });
}
