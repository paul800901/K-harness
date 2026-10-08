import React,{useEffect,useState} from 'react';
import {currentWorkers,workerHealth,workerEnded} from './work-status.mjs';
import './worker-activity-popover.css';
import {useAnchoredPopover} from './anchored-popover.jsx';

function WorkerRow({row,online,now}){
 const health=workerHealth(row,online,now),label=row.agentNickname||row.requestId||'子代理識別碼未知';
 return <li className="worker-activity-row"><strong>{label}</strong><span data-status={health.kind}>{health.text}</span></li>;
}

export function WorkerActivityPopover({state,online=true,onViewDetails}){
 const menu=useAnchoredPopover({width:380});
 const rows=currentWorkers(state).filter(row=>!workerEnded(row)&&row.executionUnowned!==true);
 const connected=online&&!['offline','error','uncertain','connecting'].includes(state.status)&&state.workerConnection!=='failed';
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(!rows.length)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[rows.length]);
 const clock=Math.max(now,Date.now()),health=rows.map(row=>workerHealth(row,connected,clock));
 const knownZero=connected&&!rows.length;
 useEffect(()=>{if(knownZero&&menu.open)menu.close(false);},[knownZero,menu.open,menu.close]);
 const label=!connected?'子代理 · 狀態待確認':knownZero?'無未結束的子代理':health.every(item=>item.kind==='running')?`子代理仍在工作 · ${rows.length}`:`子代理未結束 · ${rows.length}`;
 return <div className="worker-activity-popover-anchor">
  {knownZero?<span className="worker-activity-zero" role="status">{label}</span>:<button type="button" className={`status worker-activity ${!connected||health.some(item=>item.unknown||item.quiet)?'warning':''}`} aria-haspopup="dialog" ref={menu.trigger} aria-expanded={menu.open} aria-controls={menu.id} popoverTarget={menu.id} title="查看本聊天室尚未結束的子代理">{label}</button>}
  <section className="worker-activity-popover anchored-popover" ref={menu.popup} id={menu.id} popover="auto" onToggle={menu.onToggle} role="dialog" aria-label="子代理狀態">
   <div className="worker-activity-popover-heading"><strong>本聊天室的子代理</strong><button type="button" aria-label="關閉子代理狀態" onClick={()=>menu.close()}>×</button></div>
   {!connected&&<p className="worker-popover-note">連線未確認；以下是最後保留的狀態，不能據此判定目前是否仍在工作。</p>}
   {!!health.some(item=>item.quiet)&&<p className="worker-popover-note">久未回報不等於已卡死；活動回報也不代表有實質進度。</p>}
   {!!rows.length?<ul className="worker-activity-list">{rows.map((row,index)=><WorkerRow key={row.requestId??index} row={row} online={connected} now={clock}/>)}</ul>:<p className="worker-popover-note">{connected?'本聊天室目前沒有尚未結束的子代理。':'目前沒有可讀回的子代理列；狀態仍待確認。'}</p>}
   <button type="button" className="worker-details-link" onClick={()=>{menu.close(false);onViewDetails?.();}}>查看詳細</button>
  </section>
 </div>;
}
