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
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};
 },[online,state.threadId]);
 const stale=!online||quota?.status==='stale';
 const windows=(quota?.windows??[]).filter(w=>Number.isFinite(w.remainingPercent));
 return <section className="usage-compact" aria-label="額度與用量">
  <button type="button" className="usage-summary" title="查看額度與用量詳情" aria-label="查看額度與用量詳情" aria-haspopup="dialog" onClick={onDetails}>
   <span className="usage-label">剩餘額度</span>
   <span className="usage-row"><span className="usage-provider">Codex</span><span className="usage-values">{windows.length?[...windows].sort((a,b)=>b.minutes-a.minutes).map((w,i)=><React.Fragment key={w.key}>{i>0?' · ':''}<span className={w.remainingPercent<20?'warning':undefined}>{w.minutes===10080?'本週':w.minutes===300?'5 小時':windowName(w)} {w.remainingPercent}%</span></React.Fragment>):'—'}</span>{stale&&<em>舊</em>}</span>
   <span className="usage-row"><span className="usage-provider">Claude</span><span className="usage-values">{state.usage?.claude?.windows?.some(w=>w.remainingPercent!=null)?state.usage.claude.windows.filter(w=>['five_hour','seven_day'].includes(w.key)).sort((a,b)=>a.key==='seven_day'?-1:b.key==='seven_day'?1:0).map((w,i)=><React.Fragment key={w.key}>{i>0?' · ':''}<span className={Number.isFinite(w.remainingPercent)&&w.remainingPercent<20?'warning':undefined}>{w.key==='five_hour'?'5 小時':'本週'} {w.remainingPercent??'—'}{w.remainingPercent==null?'':'%'}</span></React.Fragment>):'—'}</span>{(!online||state.usage?.claude?.status==='stale')&&<em>舊</em>}</span>
  </button>
 </section>;
}

export function UsageDetails({state,online}){
 const [refreshing,setRefreshing]=useState(false);
 const quota=state.usage?.codex;
 const stale=!online||quota?.status==='stale';
 async function refresh(){
  setRefreshing(true);try{await refreshUsage(true);}catch{}finally{setRefreshing(false);}
 }
 return <section className="usage-details" aria-label="額度與用量詳細資訊">
  <div className="usage-heading"><strong>Codex 訂閱剩餘額度</strong><button type="button" title="更新額度與用量" aria-label="更新額度與用量" disabled={refreshing||!online} onClick={refresh}><RefreshCw size={15}/></button></div>
  <div className="quota-line">{quota?.windows?.some(w=>Number.isFinite(w.remainingPercent))?quota.windows.filter(w=>Number.isFinite(w.remainingPercent)||w.minutes).map(w=><span key={w.key}>{windowName(w)} <b>{w.remainingPercent==null?'—':`${w.remainingPercent}%`}</b></span>):<span>額度暫時無法取得</span>}</div>
  <p className="usage-note">{stale?'舊資料，等待更新。':'約每分鐘更新。'}帳號共用訂閱額度，不是此對話獨享。</p>
  <div className="usage-timestamps"><span>{quota?.checkedAt?`上次取得：${new Date(quota.checkedAt).toLocaleString('zh-TW')}`:'尚未取得官方額度。'}</span>{(quota?.windows??[]).filter(w=>w.resetsAt).map(w=><span key={w.key}>{windowName(w)}重設：{new Date(w.resetsAt*1000).toLocaleString('zh-TW')}</span>)}</div>
  <div className="usage-heading"><strong>Claude 訂閱剩餘額度</strong></div>
  <div className="quota-line">{state.usage?.claude?.windows?.length?state.usage.claude.windows.map(w=><span key={w.key}>{w.label} <b>{w.remainingPercent==null?'—':`${w.remainingPercent}%`}</b></span>):<span>官方額度暫時無法取得；可用 Claude Code /usage 核對。</span>}</div>
  {state.usage?.claude?.extraUsageDisabled===true&&<p className="usage-note">依目前觀察到的 Claude CLI 狀態，額外用量：未啟用（額度用完即停止，不會加價計費）。</p>}
  <p className="usage-note">{!online||state.usage?.claude?.status==='stale'?'舊資料，等待更新。':'Claude 連線中約每分鐘更新；無連線時約每 5 分鐘更新。'}直接讀取官方訂閱額度，不以 Token 推算。帳號共用，非此對話獨享。</p>
  <div className="usage-timestamps"><span>{state.usage?.claude?.checkedAt?`上次取得：${new Date(state.usage.claude.checkedAt).toLocaleString('zh-TW')}`:'尚未取得官方額度。'}</span>{(state.usage?.claude?.windows??[]).map(w=><span key={w.key}>{w.label}重設：{w.resetsAt?new Date(w.resetsAt*1000).toLocaleString('zh-TW'):'官方未提供'}</span>)}</div>
 </section>;
}
