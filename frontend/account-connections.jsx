import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ChevronDown,RefreshCw} from 'lucide-react';
import {officialClaudeLoginUrl as officialLoginUrl} from '../shared/claude-login-url.mjs';
import {officialCodexLoginUrl} from '../shared/codex-login-url.mjs';

const NO_GEMINI_ACCOUNTS=[];
export function AccountConnections({disabled=false,provider='codex',defaultOpen=false,hidden=false,onStatus,onRefresh}){
 const [claudeStatus,setClaudeStatus]=useState(null),[claudeLoading,setClaudeLoading]=useState(true),[claudeAction,setClaudeAction]=useState(false);
 const [claudeCode,setClaudeCode]=useState(''),[claudeLoginNotice,setClaudeLoginNotice]=useState('');
 const [codexStatus,setCodexStatus]=useState(null),[codexLoading,setCodexLoading]=useState(true),[codexAction,setCodexAction]=useState(false);
 const [geminiStatus,setGeminiStatus]=useState(null),[geminiLoading,setGeminiLoading]=useState(true),[geminiAction,setGeminiAction]=useState(false),[geminiNotice,setGeminiNotice]=useState('');
 const [geminiAccounts,setGeminiAccounts]=useState(null),[geminiAccountsLoading,setGeminiAccountsLoading]=useState(true);
 const geminiGeneration=useRef(0);
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
 const refreshGeminiAccounts=async()=>{
  const generation=++geminiGeneration.current;setGeminiAccountsLoading(true);
  try{
   const response=await fetch('/api/gemini/accounts',{cache:'no-store'});if(!response.ok)throw Error();
   const next=await response.json();if(generation===geminiGeneration.current)setGeminiAccounts(next);return next;
  }catch{const unavailable={enabled:false,activeAccountId:null,busy:false,loginPending:false,accounts:[],reason:'目前無法讀取 Gemini 帳號清單。'};if(generation===geminiGeneration.current)setGeminiAccounts(unavailable);return unavailable;}
  finally{if(generation===geminiGeneration.current)setGeminiAccountsLoading(false);}
 };
 const geminiAccountAction=async(action,data={})=>{
  ++geminiGeneration.current;
  setGeminiAction(true);setGeminiNotice('');
  try{
   const response=await fetch(`/api/gemini/accounts/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify(data)});
   const result=await response.json();if(!response.ok)throw Error(result.error||'無法更新 Gemini 帳號狀態。');
   setGeminiAccounts(result);const current=await refreshGeminiAccounts();
   if(['capture','finish','cancel','activate','refresh'].includes(action)&&current?.activeAccountId&&!current.loginPending){
    const active=current.accounts?.find(account=>account.id===current.activeAccountId);
    if(active?.auth?.status==='authenticated')await onRefresh?.('gemini');
   }
   window.dispatchEvent(new Event('k-gemini-usage-refresh'));
  }catch(error){setGeminiNotice(error.message||'無法更新 Gemini 帳號狀態。');await refreshGeminiAccounts();}
  finally{setGeminiAction(false);}
 };
 const startGeminiLogin=async()=>{
  setGeminiAction(true);setGeminiNotice('');
  try{const response=await fetch('/api/gemini/login',{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:'{}'});const result=await response.json();if(!response.ok)throw Error(result.error);setGeminiNotice(result.reason);}
  catch(error){setGeminiNotice(error.message||'無法開啟 Antigravity 官方登入。');}
  finally{setGeminiAction(false);}
 };
 useEffect(()=>{refreshClaudeStatus();refreshCodexStatus();refreshGeminiStatus();refreshGeminiAccounts();},[]);
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
 const geminiLegacyVerified=geminiStatus?.available===true&&geminiStatus?.auth?.loggedIn===true;
 const geminiAccountRows=geminiAccounts?.accounts??NO_GEMINI_ACCOUNTS;
 const geminiAccountActive=geminiAccountRows.find(item=>item.id===geminiAccounts?.activeAccountId);
 const geminiAccountsEnabled=geminiAccounts?.enabled===true;
 const geminiLoginPending=geminiAccounts?.loginPending===true;
 const geminiBusy=geminiAccounts?.busy===true;
 const geminiRegistered=geminiAccountRows.length>0;
 const geminiActiveVerified=geminiRegistered?!!geminiAccountActive&&geminiAccountActive.auth?.status==='authenticated'&&!geminiLoginPending:geminiLegacyVerified&&!geminiLoginPending;
 const geminiUncertain=geminiAccounts?.uncertain===true;
 const geminiStatusForConsumers=useMemo(()=>geminiRegistered?{...geminiStatus,available:geminiActiveVerified,auth:{...(geminiStatus?.auth??{}),status:geminiLoginPending?'unknown':geminiAccountActive?.auth?.status??'signed-out',loggedIn:geminiActiveVerified,checkedAt:geminiAccountActive?.auth?.checkedAt},accounts:geminiAccountRows,activeAccountId:geminiAccounts?.activeAccountId}:geminiLoginPending?{...geminiStatus,available:false,auth:{...(geminiStatus?.auth??{}),status:'unknown',loggedIn:false}}:geminiStatus,[geminiStatus,geminiRegistered,geminiActiveVerified,geminiLoginPending,geminiAccountActive,geminiAccountRows,geminiAccounts?.activeAccountId]);
 const codexVerified=codexStatus?.available===true&&codexAuth?.loggedIn===true&&codexAuth?.authMethod==='chatgpt';
 const claudeVerified=claudeStatus?.available===true&&auth?.loggedIn===true&&auth?.authMethod==='claude.ai'&&auth?.apiProvider==='firstParty'&&['pro','max','team','enterprise'].includes(auth?.subscriptionType);
 const needsLogin=provider==='claude'?!claudeLoading&&!claudeVerified:provider==='gemini'?!geminiAccountsLoading&&!geminiActiveVerified:!codexLoading&&!codexVerified;
 useEffect(()=>{if(needsLogin)setAccountsOpen(true);},[needsLogin]);
 const claudeStatusText=claudeLoading?'正在讀取登入狀態…':claudeVerified?`已確認 Claude.ai ${auth.subscriptionType} 訂閱${claudeStatus.version?` · Claude Code ${claudeStatus.version}`:''}`:auth?.loggedIn===false?'尚未登入 Claude 訂閱，請先完成官方登入。':claudeStatus?.reason||'尚未確認 Claude 訂閱狀態。';
 const codexStatusText=codexLoading?'正在讀取登入狀態…':codexVerified?`已確認 ChatGPT${codexAuth.planType?` ${codexAuth.planType} 訂閱`:' 訂閱'}`:codexAuth?.loggedIn===false?'尚未登入 ChatGPT 訂閱，請先完成官方登入。':codexStatus?.reason||'尚未確認 Codex 訂閱狀態。';
 const claudeLogin=claudeStatus?.login,codexLogin=codexStatus?.login;
 useEffect(()=>{onStatus?.({claude:claudeStatus,codex:codexStatus,gemini:geminiStatusForConsumers});},[claudeStatus,codexStatus,geminiStatusForConsumers,onStatus]);
 if(hidden)return null;
 return <details className="provider-auth-status" open={accountsOpen} onToggle={event=>setAccountsOpen(event.newState==='open')}>
  <summary aria-label="帳號連線"><span>帳號連線</span><span className="account-summary"><span className={codexVerified?'connected':''}>GPT {codexLoading?'讀取中':codexVerified?'已連線':'未連線'}</span><span className={claudeVerified?'connected':''}>Claude {claudeLoading?'讀取中':claudeVerified?'已連線':'未連線'}</span><span className={geminiActiveVerified?'connected':''}>Gemini {geminiAccountsLoading||geminiLoading?'確認中':geminiActiveVerified?'已登入':geminiAccountActive?.auth?.status==='signed-out'||geminiStatus?.auth?.loggedIn===false?'未登入':geminiStatus?.installed===false?'未安裝':'尚未確認'}</span><ChevronDown size={14}/></span></summary>
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
   <div className="provider-auth-row gemini-account-row"><div className="provider-auth-copy"><strong>Gemini / Antigravity 訂閱</strong><span>{geminiAccountsLoading?'正在讀取帳號狀態…':geminiAccountActive?`目前使用：${geminiAccountActive.email}`:geminiRegistered?'尚未選擇目前使用的帳號。':geminiLoading?'正在確認 Gemini 登入狀態…':geminiStatus?.reason}</span>{geminiStatus?.auth?.checkedAt&&!geminiAccountRows.length&&<small>上次確認：{new Date(geminiStatus.auth.checkedAt).toLocaleTimeString('zh-TW')}</small>}</div><div className="provider-auth-actions">
    {geminiAccountsLoading?<span role="status">正在讀取 Gemini 帳號…</span>:<>
     {geminiAccountRows.map(account=>{
      const active=account.id===geminiAccounts.activeAccountId,authenticated=account.auth?.status==='authenticated',quota=account.quota;
      const value=key=>quota?.windows?.find(w=>w.key===key)?.remainingPercent;
      return <div className="gemini-account-card" key={account.id} data-account-id={account.id}>
       <div className="gemini-account-card-head"><strong>{account.email||'未確認帳號'}</strong><span>{active?'目前使用 · ':''}{authenticated?'已驗證':account.auth?.status==='signed-out'?'待重新登入':'尚未確認'}</span></div>
       {account.auth?.checkedAt&&<small>登入確認：{new Date(account.auth.checkedAt).toLocaleString('zh-TW')}</small>}
       <div className="gemini-account-quota"><span>每週：{value('seven_day')==null?'—':`${value('seven_day')}%`}</span><span>5 小時：{value('five_hour')==null?'—':`${value('five_hour')}%`}</span></div>
       {quota?.checkedAt&&<small>額度查詢：{new Date(quota.checkedAt).toLocaleString('zh-TW')}{quota.status==='stale'?' · 舊資料':''}</small>}
       {quota?.windows?.filter(w=>w.resetsAt).map(w=><small key={w.key}>{w.label|| (w.key==='seven_day'?'每週':'5 小時')}重設：{new Date(w.resetsAt*1000).toLocaleString('zh-TW')}</small>)}
       {quota?.status==='stale'&&<small>目前顯示上次查詢的額度，尚未更新。</small>}
       {!active&&<button type="button" disabled={disabled||geminiAction||geminiBusy||!geminiAccountsEnabled||geminiLoginPending} onClick={()=>geminiAccountAction('activate',{accountId:account.id})}>切換使用</button>}
      </div>;
     })}
     {!geminiAccountRows.length&&<div className="gemini-account-empty"><span>{geminiLoading?'正在確認登入狀態…':geminiLegacyVerified?'目前 Antigravity 登入已驗證，可保存為帳號。':geminiStatus?.auth?.loggedIn===false?'目前尚未登入 Gemini。':'尚未確認目前登入狀態。'}</span>
      <div className="provider-auth-actions"><button type="button" disabled={disabled||geminiAction||geminiBusy||geminiLoginPending||!geminiAccountsEnabled||!geminiLegacyVerified} onClick={()=>geminiAccountAction('capture')}>保存目前登入</button><button type="button" disabled={disabled||geminiAction||geminiLoading||geminiBusy||geminiLoginPending||geminiLegacyVerified||!geminiStatus?.installed||!geminiAccountsEnabled} onClick={startGeminiLogin}>登入 Gemini 訂閱</button><button type="button" disabled={geminiAction||geminiLoading||geminiLoginPending||(geminiUncertain&&!geminiAccountsEnabled)} onClick={async()=>{if(geminiUncertain)await geminiAccountAction('refresh');void refreshGeminiStatus();void refreshGeminiAccounts();}}><RefreshCw size={14}/>刷新狀態</button></div>
     </div>}
     {geminiLoginPending&&<div className="gemini-login-pending" role="status"><strong>正在加入 Gemini 帳號</strong><span>K 已保留原本帳號。請在官方登入程式改用另一個帳號並完成登入；登入程式關閉後回 K 選「完成登入」。取消會回到原本使用的帳號。</span><div className="provider-auth-actions"><button type="button" disabled={disabled||geminiAction||!geminiAccountsEnabled} onClick={()=>geminiAccountAction('finish')}>完成登入</button><button type="button" disabled={geminiAction||!geminiAccountsEnabled} onClick={()=>geminiAccountAction('cancel')}>取消並回原帳號</button></div></div>}
     {geminiAccountRows.length>0&&<div className="provider-auth-actions"><button type="button" disabled={disabled||geminiAction||geminiBusy||!geminiAccountsEnabled||geminiLoginPending} onClick={()=>geminiAccountAction('login')}>加入另一個帳號</button><button type="button" disabled={disabled||geminiAction||(geminiBusy&&!geminiUncertain)||!geminiAccountsEnabled||geminiLoginPending} onClick={()=>geminiAccountAction('refresh')}>刷新目前帳號額度</button></div>}
     {geminiBusy&&!geminiUncertain&&<small role="status">Gemini 正在工作，請等目前工作結束後再切換或登入其他帳號。</small>}
     {!geminiAccountsEnabled&&<small role="status">此版本尚未開放帳號保存、登入或切換；不會更動目前登入。</small>}
     {geminiAccounts?.reason&&<small>{geminiAccounts.reason}</small>}
    </>}
    {!geminiAccountRows.length&&!geminiAccountsLoading&&<small>目前 Antigravity 登入只供本機使用；保存前仍須確認登入狀態。首次需完成官方初始設定。</small>}{geminiNotice&&<small role="status">{geminiNotice}</small>}
   </div></div>
 </details>;
}
