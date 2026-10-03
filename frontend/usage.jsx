import React,{useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import './usage.css';

const windowName=w=>w.minutes===10080?'每週':w.minutes===300?'5 小時':w.minutes?`${w.minutes} 分鐘`:w.key==='primary'?'短期額度':'長期額度';
const refreshUsage=force=>fetch(`/api/usage${force?'?refresh=1':''}`);

export function Usage({state,online,onDetails}){
 const quota=state.usage?.codex;
 useEffect(()=>{
  let inFlight=false;
  const update=async()=>{if(document.hidden||inFlight||!online)return;inFlight=true;try{await refreshUsage(false);}catch{}finally{inFlight=false;}};
  void update();const timer=setInterval(update,10000);document.addEventListener('visibilitychange',update);
  const refreshOnAccountChange=()=>{void refreshUsage(true).catch(()=>{});};
  window.addEventListener('k-gemini-usage-refresh',refreshOnAccountChange);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);window.removeEventListener('k-gemini-usage-refresh',refreshOnAccountChange);};
 },[online,state.threadId]);
 const stale=!online||quota?.status==='stale';
 const windows=(quota?.windows??[]).filter(w=>Number.isFinite(w.remainingPercent));
 return <section className="usage-compact" aria-label="額度與用量">
  <button type="button" className="usage-summary" title="查看額度與用量詳情" aria-label="查看額度與用量詳情" aria-haspopup="dialog" onClick={onDetails}>
   <span className="usage-label">剩餘額度</span>
   <span className="usage-row"><span className="usage-provider">Codex</span><span className="usage-values">{windows.length?[...windows].sort((a,b)=>b.minutes-a.minutes).map((w,i)=><React.Fragment key={w.key}>{i>0?' · ':''}<span className={w.remainingPercent<20?'warning':undefined}>{w.minutes===10080?'本週':w.minutes===300?'5 小時':windowName(w)} {w.remainingPercent}%</span></React.Fragment>):'—'}</span>{stale&&<em>舊</em>}</span>
   <span className="usage-row"><span className="usage-provider">Claude</span><span className="usage-values">{state.usage?.claude?.windows?.some(w=>w.remainingPercent!=null)?state.usage.claude.windows.filter(w=>['five_hour','seven_day'].includes(w.key)).sort((a,b)=>a.key==='seven_day'?-1:b.key==='seven_day'?1:0).map((w,i)=><React.Fragment key={w.key}>{i>0?' · ':''}<span className={Number.isFinite(w.remainingPercent)&&w.remainingPercent<20?'warning':undefined}>{w.key==='five_hour'?'5 小時':'本週'} {w.remainingPercent??'—'}{w.remainingPercent==null?'':'%'}</span></React.Fragment>):'—'}</span>{(!online||state.usage?.claude?.status==='stale')&&<em>舊</em>}</span>
   <span className="usage-row"><span className="usage-provider">Gemini</span><span className="usage-values" title={state.usage?.gemini?.accountEmail||undefined}>{state.usage?.gemini?.accountEmail&&<span className="usage-account-email">{state.usage.gemini.accountEmail}</span>}{state.usage?.gemini?.windows?.length?[...state.usage.gemini.windows].sort((a,b)=>b.minutes-a.minutes).map((w,i)=><React.Fragment key={w.key}>{i>0?' · ':''}<span className={w.remainingPercent<20?'warning':undefined}>{w.minutes===10080?'本週':windowName(w)} {w.remainingPercent}%</span></React.Fragment>):'—'}{state.usage?.gemini?.accounts?.length>0&&<small className="usage-account-count">{state.usage.gemini.accounts.length} 個帳號</small>}</span>{(!online||state.usage?.gemini?.status==='stale')&&<em>舊</em>}</span>
  </button>
 </section>;
}

export function UsageDetails({state,online}){
 const [refreshing,setRefreshing]=useState(false);
 const quota=state.usage?.codex,claude=state.usage?.claude;
 async function refresh(){
  setRefreshing(true);try{await refreshUsage(true);}catch{}finally{setRefreshing(false);}
 }
 const gemini=state.usage?.gemini,geminiAccounts=gemini?.accounts??[];
 const quotaLine=(windows,key)=>{const item=windows?.find(w=>w.key===key);return item?.remainingPercent==null?'—':`${item.remainingPercent}%`;};
 const resetLine=(windows,key)=>{const item=windows?.find(w=>w.key===key);return item?.resetsAt?new Date(item.resetsAt*1000).toLocaleString('zh-TW'):'—';};
 return <section className="usage-details" aria-label="額度與用量詳細資訊">
  <div className="usage-toolbar"><span>剩餘額度 · 各帳號共用，非此對話獨享</span><button type="button" title="更新額度與用量" aria-label="更新額度與用量" disabled={refreshing||!online} onClick={refresh}><RefreshCw size={15}/></button></div>
  <section className="usage-provider-section" aria-label="Claude 訂閱剩餘額度">
   <div className="usage-heading"><strong>Claude 訂閱剩餘額度</strong></div>
   <div className="quota-line">{claude?.windows?.length?claude.windows.map(w=><span key={w.key}>{w.label} <b>{w.remainingPercent==null?'—':`${w.remainingPercent}%`}</b></span>):<span>官方額度暫時無法取得；可用 Claude Code /usage 核對。</span>}</div>
   {(!online||claude?.status==='stale')&&<p className="usage-note">舊資料，等待更新。</p>}
   <details className="usage-more"><summary>查詢與重設時間</summary>
    <div className="usage-timestamps"><span>{claude?.checkedAt?`上次取得：${new Date(claude.checkedAt).toLocaleString('zh-TW')}`:'尚未取得官方額度。'}</span>{(claude?.windows??[]).map(w=><span key={w.key}>{w.label}重設：{w.resetsAt?new Date(w.resetsAt*1000).toLocaleString('zh-TW'):'官方未提供'}</span>)}</div>
    {claude?.extraUsageDisabled===true&&<p className="usage-note">依目前觀察到的 Claude CLI 狀態，額外用量：未啟用（額度用完即停止，不會加價計費）。</p>}
    <p className="usage-note">Claude 連線中約每分鐘更新；無連線時約每 5 分鐘更新。直接讀取官方訂閱額度，不以 Token 推算。</p>
   </details>
  </section>
  <section className="usage-provider-section" aria-label="GPT / Codex 訂閱剩餘額度">
   <div className="usage-heading"><strong>GPT / Codex 訂閱剩餘額度</strong></div>
   <div className="quota-line">{quota?.windows?.some(w=>Number.isFinite(w.remainingPercent))?quota.windows.filter(w=>Number.isFinite(w.remainingPercent)||w.minutes).map(w=><span key={w.key}>{windowName(w)} <b>{w.remainingPercent==null?'—':`${w.remainingPercent}%`}</b></span>):<span>額度暫時無法取得</span>}</div>
   {(!online||quota?.status==='stale')&&<p className="usage-note">舊資料，等待更新。</p>}
   <details className="usage-more"><summary>查詢與重設時間</summary>
    <div className="usage-timestamps"><span>{quota?.checkedAt?`上次取得：${new Date(quota.checkedAt).toLocaleString('zh-TW')}`:'尚未取得官方額度。'}</span>{(quota?.windows??[]).filter(w=>w.resetsAt).map(w=><span key={w.key}>{windowName(w)}重設：{new Date(w.resetsAt*1000).toLocaleString('zh-TW')}</span>)}</div>
    <p className="usage-note">約每分鐘更新。</p>
   </details>
  </section>
  <section className="usage-provider-section" aria-label="Gemini / Antigravity 訂閱剩餘額度">
   <div className="usage-heading"><strong>Gemini / Antigravity 訂閱剩餘額度</strong>{geminiAccounts.length>0&&<span>{geminiAccounts.length} 個帳號</span>}</div>
   {geminiAccounts.length?<>
    <div className="gemini-usage-accounts">{geminiAccounts.map(account=><details className="gemini-usage-account" key={account.id} data-account-id={account.id}>
     <summary>
      <span className="gemini-usage-identity"><strong>{account.email||'未確認帳號'}</strong><span className="gemini-usage-status">{account.id===gemini.accountId&&<span className="usage-current">目前使用</span>}<span>{account.auth?.status==='authenticated'?'已驗證登入':account.auth?.status==='signed-out'?'未登入':'尚未確認'}{!online||account.quota?.status==='stale'?' · 顯示上次查詢額度':''}{account.quota?.status==='unavailable'?' · 尚無可用額度資料':''}</span></span></span>
      <span className="gemini-usage-value">每週 <b>{quotaLine(account.quota?.windows,'seven_day')}</b></span>
      <span className="gemini-usage-value">5 小時 <b>{quotaLine(account.quota?.windows,'five_hour')}</b></span>
      <span className="usage-expand" aria-hidden="true">⌄</span>
     </summary>
     <div className="usage-timestamps"><span>{account.quota?.checkedAt?`上次查詢：${new Date(account.quota.checkedAt).toLocaleString('zh-TW')}`:'尚未查詢額度。'}</span><span>每週重設：{resetLine(account.quota?.windows,'seven_day')}</span><span>5 小時重設：{resetLine(account.quota?.windows,'five_hour')}</span></div>
    </details>)}</div>
    <p className="usage-note">點帳號列查看時間明細。更新只查目前使用的 Gemini 帳號，其他帳號保留上次查詢結果。</p>
   </>:<>
    <div className="quota-line">{gemini?.windows?.length?gemini.windows.map(w=><span key={w.key}>{windowName(w)} <b>{w.remainingPercent==null?'—':`${w.remainingPercent}%`}</b></span>):<span>{gemini?.note??'尚未取得官方額度。'}</span>}</div>
    <p className="usage-note">{!online||gemini?.status==='stale'?'舊資料，等待更新。':'約每分鐘更新。'}直接查詢 Antigravity 官方額度，不以 Token 推算。</p>
    <details className="usage-more"><summary>查詢與重設時間</summary><div className="usage-timestamps"><span>{gemini?.checkedAt?`上次取得：${new Date(gemini.checkedAt).toLocaleString('zh-TW')}`:'尚未取得官方額度。'}</span>{(gemini?.windows??[]).map(w=><span key={w.key}>{windowName(w)}重設：{w.resetsAt?new Date(w.resetsAt*1000).toLocaleString('zh-TW'):'官方未提供'}</span>)}</div></details>
   </>}
  </section>
 </section>;
}
