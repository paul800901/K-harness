import React,{useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import './usage.css';

const windowName=w=>w.minutes===10080?'每週':w.minutes===300?'5 小時':w.minutes?`${w.minutes} 分鐘`:w.key==='primary'?'短期額度':'長期額度';
const tokenCount=value=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value);
const refreshUsage=force=>fetch(`/api/usage${force?'?refresh=1':''}`);

export function Usage({state,online,onDetails}){
 const quota=state.usage?.codex,flash=state.usage?.flash;
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
   <span className="usage-codex">Codex 剩餘 <b>{windows.length?windows.map(w=>`${w.minutes===10080?'週':w.minutes===300?'5h':windowName(w)} ${w.remainingPercent}%`).join(' / '):'—'}</b>{stale&&<em>舊</em>}</span>
   <span className="usage-flash">Flash <b>{flash?.unconfirmed?'≥ ':''}{tokenCount(flash?.totalTokens??0)}</b> tok{(flash?.pending>0||flash?.unconfirmed>0)&&<em>…</em>}</span>
  </button>
 </section>;
}

export function UsageDetails({state,online}){
 const [refreshing,setRefreshing]=useState(false);
 const quota=state.usage?.codex,flash=state.usage?.flash;
 const stale=!online||quota?.status==='stale';
 async function refresh(){
  setRefreshing(true);try{await refreshUsage(true);}catch{}finally{setRefreshing(false);}
 }
 return <section className="usage-details" aria-label="額度與用量詳細資訊">
  <div className="usage-heading"><strong>Codex 訂閱剩餘額度</strong><button type="button" title="更新額度與用量" aria-label="更新額度與用量" disabled={refreshing||!online} onClick={refresh}><RefreshCw size={15}/></button></div>
  <div className="quota-line">{quota?.windows?.some(w=>Number.isFinite(w.remainingPercent))?quota.windows.filter(w=>Number.isFinite(w.remainingPercent)||w.minutes).map(w=><span key={w.key}>{windowName(w)} <b>{w.remainingPercent==null?'—':`${w.remainingPercent}%`}</b></span>):<span>額度暫時無法取得</span>}</div>
  <p className="usage-note">{stale?'舊資料，等待更新。':'約每分鐘更新。'}帳號共用訂閱額度，不是此對話獨享。</p>
  <div className="usage-timestamps"><span>{quota?.checkedAt?`上次取得：${new Date(quota.checkedAt).toLocaleString('zh-TW')}`:'尚未取得官方額度。'}</span>{(quota?.windows??[]).filter(w=>w.resetsAt).map(w=><span key={w.key}>{windowName(w)}重設：{new Date(w.resetsAt*1000).toLocaleString('zh-TW')}</span>)}</div>
  <div className="flash-line"><span>Flash · 本對話</span><strong>{flash?.unconfirmed?'至少 ':''}{(flash?.totalTokens??0).toLocaleString('zh-TW')} <small>Token</small></strong></div>
  <p className="usage-note">輸入（含快取）與輸出 Token 合計；只計已收到的用量回報，不是 DeepSeek 帳號總消費，也不代表精確帳單。</p>
  {(state.busy||flash?.pending>0||flash?.unconfirmed>0)&&<p className="usage-note">{flash?.unconfirmed?'部分用量尚未確認':'執行中；每次模型回覆後更新'}</p>}
 </section>;
}
