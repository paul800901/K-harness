import {readFile} from 'node:fs/promises';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';

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
export async function clearRemoteSessions(file){
 const sessionFile=path.join(path.dirname(file),'remote-sessions.json');
 try{await readFile(sessionFile);}catch(error){if(error.code==='ENOENT')return;throw error;}
 await atomicWrite(sessionFile,JSON.stringify({version:1,sessions:[]}));
}
export function createRemoteAccess(file,initial){
 const lifetime=365*24*60*60*1000,renewAfter=24*60*60*1000;
 const sessionFile=path.join(path.dirname(file),'remote-sessions.json');
 const cookieName='__Host-k_remote';
 const cookieToken=req=>req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 const sessionKey=req=>{const token=cookieToken(req);return /^[a-f0-9]{64}$/u.test(token??'')?remoteKeyHash(token):null;};
 const cookie=(token,expires)=>`${cookieName}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0,Math.floor((expires-Date.now())/1000))}`;
 let sessions=new Map(),pending=Promise.resolve();
 const storageError=(message,error)=>{console.error('[remote sessions]',error);return Object.assign(Error(message),{statusCode:503});};
 const save=async next=>{try{await atomicWrite(sessionFile,JSON.stringify({version:1,sessions:[...next.values()].map(s=>({...s,commands:[...s.commands]}))}));}catch(error){throw storageError('電腦無法保存手機登入或操作紀錄；本次操作未執行，請檢查電腦。',error);}};
 // Only hashes are persisted. A copied file cannot be used as a browser cookie.
 const loaded=(async()=>{
  let data;try{data=JSON.parse(await readFile(sessionFile,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw storageError('手機登入紀錄無法讀取，未放行遠端存取；修正後請重啟 K。',error);}
  if(data.version!==1||!Array.isArray(data.sessions)||data.sessions.some(s=>!s||!/^[a-f0-9]{64}$/u.test(s.tokenHash??'')||!/^[a-f0-9]{64}$/u.test(s.keyHash??'')||typeof s.login!=='string'||!Number.isFinite(s.expires)||!Array.isArray(s.commands)||s.commands.some(id=>typeof id!=='string'||!id.trim()||id.length>128)))throw storageError('手機登入紀錄格式無效，未放行遠端存取；修正後請重啟 K。',Error('Invalid remote session format'));
  const valid=data.sessions.filter(s=>s.keyHash===initial.keyHash&&s.login===initial.login&&s.expires>Date.now());
  sessions=new Map(valid.map(s=>[s.tokenHash,{...s,commands:new Set(s.commands)}]));
  if(valid.length!==data.sessions.length)await save(sessions);
 })();
 loaded.catch(()=>{}); // Surface storage errors to requests, not as an unhandled rejection.
 function change(update){
  const operation=pending.then(async()=>{
   await loaded;
   const next=new Map([...sessions].map(([key,s])=>[key,{...s,commands:new Set(s.commands)}]));
   const result=update(next);
   await save(next);
   sessions=next;return result;
  });
  pending=operation.catch(()=>{});return operation;
 }
 async function config(){
  let value;try{value=await readRemoteConfig(file);}catch{value=null;}
  await loaded;await pending;
  const matches=s=>value&&value.origin===initial.origin&&value.port===initial.port&&s.keyHash===value.keyHash&&s.login===value.login;
  if([...sessions.values()].some(s=>!matches(s)))await change(next=>{for(const [hash,s]of next)if(!matches(s))next.delete(hash);});
  return value&&value.origin===initial.origin&&value.port===initial.port?value:null;
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
  if(!value)return false;
  await loaded;await pending;
  const session=sessions.get(sessionKey(req));
  return !!(session&&session.expires>Date.now()&&session.keyHash===value.keyHash&&session.login===value.login);
 }
 async function login(key,value){
  if(typeof key!=='string'||key.length>256)return null;
  if(!timingSafeEqual(Buffer.from(remoteKeyHash(key),'hex'),Buffer.from(value.keyHash,'hex')))return null;
  return change(next=>{
   for(const [hash,session]of next)if(session.expires<=Date.now()||session.keyHash!==value.keyHash||session.login!==value.login)next.delete(hash);
   const token=randomBytes(32).toString('hex'),hash=remoteKeyHash(token),expires=Date.now()+lifetime;
   next.set(hash,{tokenHash:hash,keyHash:value.keyHash,login:value.login,expires,commands:new Set()});
   return cookie(token,expires);
  });
 }
 async function refresh(req){
  const hash=sessionKey(req),session=sessions.get(hash);
  if(!session||session.expires>Date.now()+lifetime-renewAfter)return null;
  return change(next=>{const s=next.get(hash);if(!s||s.expires>Date.now()+lifetime-renewAfter)return null;s.expires=Date.now()+lifetime;return cookie(cookieToken(req),s.expires);});
 }
 async function logout(req){
  await change(next=>next.delete(sessionKey(req)));
  return `${cookieName}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
 }
 // Persist the command ID BEFORE dispatch, including across a crash/restart.
 // Never replay a stored result or forget old IDs while this session is valid.
 async function acceptCommand(req){
  const id=req.headers['x-k-command'];
  if(typeof id!=='string'||!id.trim()||id.length>128)throw Object.assign(Error('遠端操作缺少有效的請求識別。'),{statusCode:400});
  const value=await identity(req);
  await change(next=>{
   const session=next.get(sessionKey(req));
   if(!value||!session||session.expires<=Date.now()||session.keyHash!==value.keyHash||session.login!==value.login)throw Object.assign(Error('Remote access denied'),{statusCode:403});
   if(session.commands.has(id))throw Object.assign(Error('操作結果未確認；沒有自動重送。請重新連線讀回後再決定。'),{statusCode:409});
   session.commands.add(id);
  });
 }
 return {identity,authorized,login,logout,acceptCommand,refresh};
}

// Human remote controls reuse the existing routes. OS login, core updates,
// shutdown, directory picking and Chrome manual control stay at the desktop.
const reads=new Set(['/api/tool','/api/turn-diff','/api/claude/auth','/api/events','/api/state','/api/sessions','/api/projects','/api/models','/api/usage','/api/artifact','/api/attachment','/api/browser/state','/api/browser/download']);
const writes=new Set(['/api/discussion/start','/api/discussion/message','/api/gemini/accounts/refresh-all','/api/dictation/transcribe','/api/open','/api/send','/api/steer','/api/queue','/api/stop','/api/answer','/api/upload','/api/workers','/api/goal','/api/model','/api/metadata','/api/projects/metadata','/api/workspace','/api/workspace/move','/api/archives/delete','/api/attention/read','/api/compact','/api/fork','/api/native/files/search','/api/native/review']);
export const remoteRouteAllowed=(method,pathname)=>method==='GET'?reads.has(pathname):method==='POST'&&writes.has(pathname);

export const remoteLoginHtml=`<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><meta name="theme-color" content="#f2ece2"><link rel="manifest" href="/manifest.webmanifest"><title>K 遠端存取</title><link rel="stylesheet" href="/remote-login.css"></head><body><main><h1>K 執行中樞</h1><p>私人遠端入口。工作仍在電腦執行。</p><form><label for="key">K 存取金鑰</label><input id="key" name="key" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" required><small>只貼上金鑰本身，不含引號或設定檔其他內容。</small><button>連接 K</button><p role="alert"></p></form><p>只需配對一次。此裝置會記住登入；持續使用可延續，登出或電腦端撤銷後失效。</p></main><script src="/remote-login.js"></script></body></html>`;
export const remoteLoginJs=`// External entry can omit a Strict cookie on the first navigation even when
// pairing remains valid. Only a successful same-origin read restores the page.
window.addEventListener('pageshow',()=>{
 fetch('/api/sessions',{cache:'no-store'}).then(response=>{if(response.ok)location.replace('/');}).catch(()=>{});
});
document.querySelector('form').addEventListener('submit',async e=>{
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
export const remoteLoginCss=`*{box-sizing:border-box}body{margin:0;background:#fbf7f0;color:#2b241d;font:16px system-ui;min-height:100dvh;display:grid;align-items:center}main{width:min(100%,420px);margin:auto;padding:32px 24px}h1{font-size:28px;letter-spacing:-.03em;margin:0 0 12px}main>p{color:#71665a;font-size:14px}form{display:grid;gap:12px;margin:32px 0}label{font-size:14px;font-weight:600}input,button{font:inherit;min-height:52px;border:1px solid #d4ccbf;border-radius:14px;padding:12px 14px;width:100%;min-width:0}input{background:#fffdf9}button{background:#2b241d;color:#fffdf9;border-color:#2b241d;font-weight:600}button:disabled{opacity:.6}small{font-size:12px;color:#71665a;line-height:1.5}p{line-height:1.65;overflow-wrap:anywhere}[role=alert]:empty{display:none}[role=alert]{margin:0;color:#a4432f;font-size:14px}:focus-visible{outline:2px solid #9a7630;outline-offset:3px}`;
