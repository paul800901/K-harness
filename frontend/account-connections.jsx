import React,{useEffect,useState} from 'react';
import {ChevronDown,RefreshCw} from 'lucide-react';
import {officialClaudeLoginUrl as officialLoginUrl} from '../shared/claude-login-url.mjs';
import {officialCodexLoginUrl} from '../shared/codex-login-url.mjs';

export function AccountConnections({disabled=false,provider='codex',defaultOpen=false,hidden=false,onStatus,onRefresh}){
 const [claudeStatus,setClaudeStatus]=useState(null),[claudeLoading,setClaudeLoading]=useState(true),[claudeAction,setClaudeAction]=useState(false);
 const [claudeCode,setClaudeCode]=useState(''),[claudeLoginNotice,setClaudeLoginNotice]=useState('');
 const [codexStatus,setCodexStatus]=useState(null),[codexLoading,setCodexLoading]=useState(true),[codexAction,setCodexAction]=useState(false);
 const [geminiStatus,setGeminiStatus]=useState(null),[geminiLoading,setGeminiLoading]=useState(true),[geminiAction,setGeminiAction]=useState(false),[geminiNotice,setGeminiNotice]=useState('');
 const [accountsOpen,setAccountsOpen]=useState(defaultOpen);
 const refreshClaudeStatus=async({refreshModels=false}={})=>{
  setClaudeLoading(true);
  try{
   const response=await fetch('/api/claude/auth',{cache:'no-store'});if(!response.ok)throw new Error();
   const next=await response.json();setClaudeStatus(next);
   if(refreshModels&&next.available===true)await onRefresh?.('claude');
  }catch{setClaudeStatus({available:false,reason:'無法讀取 Claude 登入狀態。',login:{status:'idle'}});}
  finally{setClaudeLoading(false);}
 };
 const refreshCodexStatus=async({refreshModels=false}={})=>{
  setCodexLoading(true);
  try{
   const response=await fetch('/api/codex/auth',{cache:'no-store'});if(!response.ok)throw new Error();
   const next=await response.json();setCodexStatus(next);
   if(refreshModels&&next.available===true)await onRefresh?.('codex');
  }catch{setCodexStatus({available:false,reason:'無法讀取 Codex 登入狀態。',login:{status:'idle'}});}
  finally{setCodexLoading(false);}
 };
 const refreshGeminiStatus=async({refreshModels=false}={})=>{
  setGeminiLoading(true);
  try{const response=await fetch('/api/gemini/auth',{cache:'no-store'});if(!response.ok)throw Error();const next=await response.json();setGeminiStatus(next);if(refreshModels&&next.available)await onRefresh?.('gemini');}
  catch{setGeminiStatus({available:false,reason:'無法確認 Antigravity 狀態。'});}
  finally{setGeminiLoading(false);}
 };
 const startGeminiLogin=async()=>{
  setGeminiAction(true);setGeminiNotice('');
  try{const response=await fetch('/api/gemini/login',{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:'{}'});const result=await response.json();if(!response.ok)throw Error(result.error);setGeminiNotice(result.reason);}
  catch(error){setGeminiNotice(error.message||'無法開啟 Antigravity 官方登入。');}
  finally{setGeminiAction(false);}
 };
 useEffect(()=>{refreshClaudeStatus();refreshCodexStatus();refreshGeminiStatus();},[]);
 useEffect(()=>{onStatus?.({claude:claudeStatus,codex:codexStatus,gemini:geminiStatus});},[claudeStatus,codexStatus,geminiStatus,onStatus]);
 const updateClaudeLogin=async(route,data={})=>{
  setClaudeAction(true);setClaudeLoginNotice('');setClaudeCode('');
  try{
   const response=await fetch(`/api/claude/${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify(data)});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'無法更新登入，請刷新狀態。');
   setClaudeStatus(current=>({...current,...result}));
  }catch(cause){setClaudeLoginNotice(cause.message||'無法更新登入，請刷新狀態。');}
  finally{setClaudeAction(false);}
 };
 const copyClaudeLogin=async()=>{
  const url=officialLoginUrl(claudeStatus?.login?.url);if(!url)return;
  try{await navigator.clipboard.writeText(url);setClaudeLoginNotice('已複製登入連結，請貼到 Chrome 網址列。');}
  catch{setClaudeLoginNotice('未能複製，請右鍵「開啟官方登入頁」並複製連結網址。');}
 };
 useEffect(()=>{
  if(claudeStatus?.login?.status!=='running')return;
  let disposed=false,timer;
  const poll=async()=>{
   try{
    const response=await fetch('/api/claude/login',{cache:'no-store'});if(!response.ok)throw new Error();
    const next=await response.json();if(disposed)return;
    setClaudeStatus(current=>({...current,...next}));
    if(next.login?.status!=='running'){setClaudeCode('');await refreshClaudeStatus({refreshModels:true});return;}
   }catch{if(!disposed)setClaudeLoginNotice('暫時無法更新登入進度，請按刷新狀態確認。');}
   if(!disposed)timer=setTimeout(poll,2000);
  };
  void poll();return()=>{disposed=true;clearTimeout(timer);};
 },[claudeStatus?.login?.status]);
 const updateCodexLogin=async route=>{
  setCodexAction(true);
  try{
   const response=await fetch(`/api/codex/${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:'{}'});
   if(!response.ok)throw new Error();setCodexStatus(await response.json());
  }catch{setCodexStatus(current=>({...current,available:false,reason:'無法更新 Codex 登入，請刷新狀態。',login:{status:'error'}}));}
  finally{setCodexAction(false);}
 };
 useEffect(()=>{
  if(codexStatus?.login?.status!=='running')return;
  let disposed=false,timer;
  const poll=async()=>{
   try{
    const response=await fetch('/api/codex/auth',{cache:'no-store'});if(!response.ok)throw new Error();
    const next=await response.json();if(disposed)return;
    setCodexStatus(next);
    if(next.login?.status!=='running'){if(next.available===true)await onRefresh?.('codex');return;}
   }catch{}
   if(!disposed)timer=setTimeout(poll,2000);
  };
  void poll();return()=>{disposed=true;clearTimeout(timer);};
 },[codexStatus?.login?.status]);
 const auth=claudeStatus?.auth,codexAuth=codexStatus?.auth;
 const codexVerified=codexStatus?.available===true&&codexAuth?.loggedIn===true&&codexAuth?.authMethod==='chatgpt';
 const claudeVerified=claudeStatus?.available===true&&auth?.loggedIn===true&&auth?.authMethod==='claude.ai'&&auth?.apiProvider==='firstParty'&&['pro','max','team','enterprise'].includes(auth?.subscriptionType);
 const needsLogin=provider==='claude'?!claudeLoading&&!claudeVerified:provider==='gemini'?!geminiLoading&&!geminiStatus?.available:!codexLoading&&!codexVerified;
 useEffect(()=>{if(needsLogin)setAccountsOpen(true);},[needsLogin]);
 const claudeStatusText=claudeLoading?'正在讀取登入狀態…':claudeVerified?`已確認 Claude.ai ${auth.subscriptionType} 訂閱${claudeStatus.version?` · Claude Code ${claudeStatus.version}`:''}`:auth?.loggedIn===false?'尚未登入 Claude 訂閱，請先完成官方登入。':claudeStatus?.reason||'尚未確認 Claude 訂閱狀態。';
 const codexStatusText=codexLoading?'正在讀取登入狀態…':codexVerified?`已確認 ChatGPT${codexAuth.planType?` ${codexAuth.planType} 訂閱`:' 訂閱'}`:codexAuth?.loggedIn===false?'尚未登入 ChatGPT 訂閱，請先完成官方登入。':codexStatus?.reason||'尚未確認 Codex 訂閱狀態。';
 const claudeLogin=claudeStatus?.login,codexLogin=codexStatus?.login;
 if(hidden)return null;
 return <details className="provider-auth-status" open={accountsOpen} onToggle={event=>setAccountsOpen(event.newState==='open')}>
  <summary aria-label="帳號連線"><span>帳號連線</span><span className="account-summary"><span className={codexVerified?'connected':''}>GPT {codexLoading?'讀取中':codexVerified?'已連線':'未連線'}</span><span className={claudeVerified?'connected':''}>Claude {claudeLoading?'讀取中':claudeVerified?'已連線':'未連線'}</span><span>Gemini {geminiLoading?'讀取中':geminiStatus?.available?'由官方管理':'未安裝／不可用'}</span><ChevronDown size={14}/></span></summary>
  <div className="provider-auth-row"><div className="provider-auth-copy"><strong>GPT / Codex 訂閱</strong><span>{codexStatusText}</span></div><div className="provider-auth-actions">
   {codexLogin?.status==='running'?<><span role="status">等待完成官方登入。</span>{officialCodexLoginUrl(codexLogin.url)&&<a href={officialCodexLoginUrl(codexLogin.url)} target="_blank" rel="noreferrer">開啟官方登入頁</a>}<button type="button" disabled={codexAction} onClick={()=>updateCodexLogin('login/cancel')}>停止登入</button></>:<button type="button" disabled={disabled||codexAction||codexLoading||codexVerified} onClick={()=>updateCodexLogin('login')}>登入 GPT / Codex</button>}
   <button type="button" disabled={codexAction||codexLoading} onClick={()=>refreshCodexStatus({refreshModels:true})}><RefreshCw size={14}/>刷新狀態</button>{codexLogin?.status==='error'&&<small role="status">登入未成功；刷新狀態後可再試一次。</small>}{codexLogin?.status==='complete'&&!codexVerified&&<small role="status">登入流程已結束，但目前尚未確認可用的 ChatGPT 訂閱。</small>}
  </div></div>
  <div className="provider-auth-row"><div className="provider-auth-copy"><strong>Claude 訂閱</strong><span>{claudeStatusText}</span></div><div className="provider-auth-actions">
   {claudeLogin?.status==='running'?<><span role="status">{claudeLogin.codeSubmitted?'已交付官方驗證，尚未確認登入完成。':'等待你完成官方登入。'}</span>{officialLoginUrl(claudeLogin.url)?<>
    <a href={officialLoginUrl(claudeLogin.url)} target="_blank" rel="noreferrer">開啟官方登入頁</a><button type="button" onClick={copyClaudeLogin}>複製登入連結</button>
    <small>官方顯示授權碼後，貼到下方，不要貼進聊天。</small>
    {!claudeLogin.codeSubmitted&&<div className="claude-code-entry"><label>Claude 官方授權碼<input type="password" autoComplete="off" spellCheck={false} value={claudeCode} maxLength={4096} onChange={event=>setClaudeCode(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} placeholder="貼上這次登入的完整授權碼"/></label><button type="button" disabled={claudeAction||!claudeCode.trim()} onClick={()=>updateClaudeLogin('login/code',{code:claudeCode})}>交付官方驗證</button></div>}
   </>:<small>正在等候官方登入連結…</small>}<button type="button" disabled={claudeAction} onClick={()=>updateClaudeLogin('login/cancel')}>停止登入</button></>:<button type="button" disabled={disabled||claudeAction||claudeLoading||claudeVerified} onClick={()=>updateClaudeLogin('login')}>登入 Claude 訂閱</button>}
   {claudeLoginNotice&&<small role="status">{claudeLoginNotice}</small>}
   <button type="button" disabled={claudeAction||claudeLoading} onClick={()=>refreshClaudeStatus({refreshModels:true})}><RefreshCw size={14}/>刷新狀態</button>{claudeLogin?.status==='error'&&<small role="status">登入未成功；刷新狀態後可再試一次。</small>}{claudeLogin?.status==='complete'&&!claudeVerified&&<small role="status">登入流程已結束，但目前尚未確認可用的 Claude 訂閱。</small>}
  </div></div>
  <div className="provider-auth-row"><div className="provider-auth-copy"><strong>Gemini / Antigravity 訂閱</strong><span>{geminiLoading?'正在讀取 Antigravity…':geminiStatus?.reason}</span>{geminiStatus?.version&&<small>{geminiStatus.version}</small>}</div><div className="provider-auth-actions">
   <button type="button" disabled={disabled||geminiAction||geminiLoading||!geminiStatus?.installed} onClick={startGeminiLogin}>開啟 Gemini 官方登入</button><button type="button" disabled={geminiAction||geminiLoading} onClick={()=>refreshGeminiStatus({refreshModels:true})}><RefreshCw size={14}/>刷新狀態</button>
   <small>登入由本人在官方程式開啟的外部瀏覽器完成。K 不接收 Google 密碼或授權碼；若 Chrome 是預設瀏覽器，就會在 Chrome 開啟。</small>{geminiNotice&&<small role="status">{geminiNotice}</small>}
  </div></div>
 </details>;
}
