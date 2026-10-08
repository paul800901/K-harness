import React,{useEffect,useState} from 'react';
import {workStatus,currentWorkers,workerEnded,workerHealth} from './work-status.mjs';

export function WorkStatus({state,online,connecting=false,loginRequired=false,footer=false}) {
 const [now,setNow]=useState(Date.now);
 const pending=currentWorkers(state).some(w=>!workerEnded(w));
 useEffect(()=>{
  if(!state.busy&&state.status!=='working'&&!pending)return;
  const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[state.threadId,state.busy,state.status,pending]);
 const status=loginRequired&&!connecting?{kind:'waiting',text:'手機登入已失效 · 工作狀態待確認'}:connecting?{kind:'waiting',text:'正在同步電腦狀態 · 尚未確認工作狀態'}:workStatus(state,online,Math.max(now,Date.now()));
 if(!status||footer&&!state.busy&&state.status!=='working'&&!pending&&!state.completionPending)return null;
 return <span className={`status work-status ${footer?'working-indicator':''} ${status.kind}`} role="status" aria-live="off" title="活動時間來自原生事件，不是狀態查詢、心跳或工作成果保證。等待中的畫面計時不會喚醒模型。久未回報不等於已卡死；K 不會因此停止或重送工作。"><i/><span>{status.text}</span></span>;
}

export function WorkerHealthLabel({worker,online}) {
 const [now,setNow]=useState(Date.now),pending=!workerEnded(worker);
 useEffect(()=>{if(!pending)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[pending]);
 return <strong>{workerHealth(worker,online,Math.max(now,Date.now())).text}</strong>;
}

const timestamp=value=>{const time=typeof value==='number'?value:Date.parse(value??'');return Number.isFinite(time)?new Intl.DateTimeFormat('zh-TW',{dateStyle:'short',timeStyle:'medium'}).format(time):'尚無時間';};
export function WorkerDetails({worker}) {
 const details=[];
 if(worker.requestId)details.push(['工人識別碼',worker.requestId]);
 if(worker.provider||worker.model)details.push(['原生來源／型號',[worker.provider,worker.model].filter(Boolean).join(' · ')]);
 if(worker.confirmationReason)details.push(['等待確認原因',worker.confirmationReason]);
 if(worker.error)details.push(['錯誤',worker.error]);
 if(worker.lastToolName)details.push(['最近工具',worker.lastToolName]);
 if(worker.lastActivityAt||worker.activity?.lastEventAt)details.push(['最後活動',timestamp(worker.lastActivityAt??worker.activity?.lastEventAt)]);
 if(worker.lastReadAt)details.push(['最後讀回',timestamp(worker.lastReadAt)]);
 if(worker.inspection)details.push(['久無活動檢查',`${timestamp(worker.inspection.checkedAt)} · ${worker.inspection.reason??'原因未提供'}`]);
 if(worker.reconciliation?.summary)details.push(['歷史查核摘要',worker.reconciliation.summary]);
 if(worker.reconciliation?.evidence)details.push(['歷史查核依據',worker.reconciliation.evidence]);
 if(worker.reconciliation?.reviewedAt)details.push(['歷史查核時間',timestamp(worker.reconciliation.reviewedAt)]);
 if(worker.workerConnection==='failed')details.push(['連線','子代理狀態讀回失敗']);
 if(!details.length)return null;
 return <details className="worker-diagnostics"><summary>狀態與查核詳細資料</summary><dl>{details.map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl></details>;
}
