import React,{useEffect,useState} from 'react';
import {workStatus,currentWorkers,workerEnded,workerHealth} from './work-status.mjs';

export function WorkStatus({state,online,footer=false}) {
 const [now,setNow]=useState(Date.now);
 const pending=currentWorkers(state).some(w=>!workerEnded(w));
 useEffect(()=>{
  if(!state.busy&&state.status!=='working'&&!pending)return;
  const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[state.threadId,state.busy,state.status,pending]);
 const status=workStatus(state,online,Math.max(now,Date.now()));
 if(!status||footer&&!state.busy&&state.status!=='working'&&!pending&&!state.completionPending)return null;
 return <span className={`status work-status ${footer?'working-indicator':''} ${status.kind}`} role="status" aria-live="off" title="活動時間來自原生事件，不是狀態查詢、心跳或工作成果保證。等待中的畫面計時不會喚醒模型。久未回報不等於已卡死；K 不會因此停止或重送工作。"><i/>{status.text}</span>;
}

export function WorkerHealthLabel({worker,online}) {
 const [now,setNow]=useState(Date.now),pending=!workerEnded(worker);
 useEffect(()=>{if(!pending)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[pending]);
 return <strong>{workerHealth(worker,online,Math.max(now,Date.now())).text}</strong>;
}
