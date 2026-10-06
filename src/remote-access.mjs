import {readFile} from 'node:fs/promises';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export const remoteKeyHash=key=>createHash('sha256').update(key).digest('hex');
export async function readRemoteConfig(file){
 let config;
 try{config=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 return validateRemoteConfig(config);
}
export function validateRemoteConfig(config){
 if(config.enabled===false)return null;
 const url=new URL(config.origin);
 if(url.protocol!=='https:'||url.origin!==config.origin||url.username||url.password||!url.hostname.endsWith('.ts.net'))throw Error('遠端入口須使用完整且無路徑的 Tailscale HTTPS origin。');
 if(typeof config.login!=='string'||!config.login.trim()||config.login!==config.login.trim()||/[\r\n]/u.test(config.login))throw Error('須指定獲准的 Tailscale Login。');
 if(!/^[a-f0-9]{64}$/u.test(config.keyHash??''))throw Error('遠端存取金鑰雜湊無效。');
 if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw Error('遠端 loopback 連接埠無效。');
 return config;
}

// Separate loopback listener, served ONLY by Tailscale Serve (never Funnel).
// Serve removes client-supplied identity headers. Local OS processes remain trusted,
// just as they do for the existing desktop launch capability; this is not an OS sandbox.
export function createRemoteAccess(file,initial){
 const sessions=new Map(),lifetime=7*24*60*60*1000;
 const cookieName='__Host-k_remote';
 const cookieToken=req=>req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 async function config(){
  try{const value=await readRemoteConfig(file);return value&&value.origin===initial.origin&&value.port===initial.port?value:null;}catch{return null;}
 }
 async function identity(req){
  const value=await config();
  if(!value||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||
    req.headers.host!==new URL(value.origin).host||req.headers['tailscale-user-login']!==value.login||
    req.headers['tailscale-funnel-request']||req.headers.origin&&req.headers.origin!==value.origin)return null;
  return value;
 }
 async function authorized(req,value){
  if(value===undefined)value=await identity(req);
  const session=sessions.get(cookieToken(req));
  return !!(value&&session&&session.expires>Date.now()&&session.keyHash===value.keyHash&&session.login===value.login);
 }
 function login(key,value){
  if(typeof key!=='string'||key.length>256)return null;
  if(!timingSafeEqual(Buffer.from(remoteKeyHash(key),'hex'),Buffer.from(value.keyHash,'hex')))return null;
  for(const [token,session]of sessions)if(session.expires<=Date.now()||session.keyHash!==value.keyHash)sessions.delete(token);
  const token=randomBytes(32).toString('hex');sessions.set(token,{keyHash:value.keyHash,login:value.login,expires:Date.now()+lifetime,commands:new Set()});
  return `${cookieName}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${lifetime/1000}`;
 }
 function logout(req){sessions.delete(cookieToken(req));return `${cookieName}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;}
 // Chrome can resend a POST after a reused socket closes before response headers.
 // Remember only IDs within this authenticated session; never replay a result or work.
 function acceptCommand(req){
  const id=req.headers['x-k-command'],session=sessions.get(cookieToken(req));
  if(typeof id!=='string'||!id.trim()||id.length>128)throw Object.assign(Error('遠端操作缺少有效的請求識別。'),{statusCode:400});
  if(session.commands.has(id))throw Object.assign(Error('操作結果未確認；沒有自動重送。請重新連線讀回後再決定。'),{statusCode:409});
  session.commands.add(id);
 }
 return {identity,authorized,login,logout,acceptCommand};
}

// Human remote controls reuse the existing routes. OS login, core updates,
// shutdown, directory picking and Chrome manual control stay at the desktop.
const reads=new Set(['/api/claude/auth','/api/events','/api/state','/api/sessions','/api/projects','/api/models','/api/usage','/api/artifact','/api/attachment','/api/browser/state','/api/browser/download']);
const writes=new Set(['/api/open','/api/send','/api/steer','/api/queue','/api/stop','/api/answer','/api/upload','/api/workers','/api/goal','/api/model','/api/metadata','/api/projects/metadata','/api/workspace','/api/workspace/move','/api/archives/delete','/api/attention/read','/api/compact','/api/fork','/api/native/files/search','/api/native/review']);
export const remoteRouteAllowed=(method,pathname)=>method==='GET'?reads.has(pathname):method==='POST'&&writes.has(pathname);

export const remoteLoginHtml=`<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><meta name="theme-color" content="#f2ece2"><link rel="manifest" href="/manifest.webmanifest"><title>K 遠端存取</title><link rel="stylesheet" href="/remote-login.css"></head><body><main><h1>K 執行中樞</h1><p>私人遠端入口。工作仍在電腦執行。</p><form><label for="key">K 存取金鑰</label><input id="key" name="key" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" required><small>只貼上金鑰本身，不含引號或設定檔其他內容。</small><button>連接 K</button><p role="alert"></p></form><p>金鑰由電腦端產生；不是模型帳號密碼。</p></main><script src="/remote-login.js"></script></body></html>`;
export const remoteLoginJs=`document.querySelector('form').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.target.querySelector('button'),error=e.target.querySelector('[role=alert]');button.disabled=true;error.textContent='';
 try{
  const response=await fetch('/api/remote/login',{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify({key:document.querySelector('#key').value.trim()})});
  if(!response.ok){
   const detail=await response.json().catch(()=>null);
   const messages={'Remote access denied':'存取金鑰不正確。請只貼上金鑰本身，不含引號或設定檔其他內容。','Invalid remote identity or host':'這部裝置的私人網路身分或網址未獲允許，或電腦端遠端設定已變更。請確認 Tailscale 帳號、完整網址及電腦端設定。','Explicit same-origin request required':'登入請求遭拒，請重新開啟完整的 K 私人網址後再試。'};
   error.textContent=messages[detail?.error]||'電腦未能完成登入，請稍後再試。';button.disabled=false;return;
  }
  location.replace('/');
 }catch{error.textContent='連線中斷，尚未確認登入結果。請確認手機與電腦的 Tailscale 連線後再試。';button.disabled=false;}
});`;
export const remoteLoginCss=`body{margin:0;background:#f2ece2;color:#302e29;font:17px system-ui}main{max-width:420px;margin:10vh auto;padding:24px}form{display:grid;gap:12px}input,button{font:inherit;min-height:48px;border:1px solid #807666;border-radius:8px;padding:8px}button{background:#534a3d;color:white}p{line-height:1.6;overflow-wrap:anywhere}`;
