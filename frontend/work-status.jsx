import React,{useEffect,useState} from 'react';
import {workStatus} from './work-status.mjs';

export function WorkStatus({state,online,footer=false}) {
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{
  if(!state.busy&&state.status!=='working')return;
  const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[state.threadId,state.busy,state.status]);
 const status=workStatus(state,online,Math.max(now,Date.now()));
 if(!status)return null;
 return <span className={`status work-status ${footer?'working-indicator':''} ${status.kind}`} role="status" aria-live="off" title="活動時間來自目前主代理的原生事件，不是心跳、總耗時或工作成果保證。久未回報不等於已卡死；K 不會因此停止或重送工作。"><i/>{status.text}</span>;
}
