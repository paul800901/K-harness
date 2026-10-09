import React,{useEffect,useState} from 'react';
import {currentWorkers,workerHealth,workerEnded} from './work-status.mjs';
import './worker-activity-popover.css';
import {useAnchoredPopover} from './anchored-popover.jsx';

function workerPreviewStatus(row,online,now){
 const health=workerHealth(row,online,now);
 if(health.unknown||health.quiet||health.kind==='confirmation')return '待確認';
 if(['pending','starting'].includes(row.status)||['tool','worker'].includes(row.activity?.phase))return '等待';
 return row.status==='running'?'執行中':'待確認';
}

function WorkerRow({row,models,online,now}){
 const model=models.find(item=>item.model===row.model);
 const modelLabel=model?.displayName||row.modelDisplayName||row.model||'模型待確認';
 const status=workerPreviewStatus(row,online,now);
 return <li className="worker-activity-row"><strong>{modelLabel}</strong><span data-status={status==='執行中'?'running':status==='等待'?'waiting':'unresolved'}>{status}</span></li>;
}

export function WorkerActivityPopover({state,models=[],loadModels,onCatalog,online=true,onViewDetails}){
 const menu=useAnchoredPopover({width:380});
 const rows=currentWorkers(state).filter(row=>!workerEnded(row)&&row.executionUnowned!==true);
 const connected=online&&!['offline','error','uncertain','connecting'].includes(state.status)&&state.workerConnection!=='failed';
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(!rows.length)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[rows.length]);
 const clock=Math.max(now,Date.now()),health=rows.map(row=>workerHealth(row,connected,clock));
 const knownZero=connected&&!rows.length;
 useEffect(()=>{if(knownZero&&menu.open)menu.close(false);},[knownZero,menu.open,menu.close]);
 const statuses=rows.map(row=>workerPreviewStatus(row,connected,clock));
 const label=!connected?'子代理 · 狀態待確認':knownZero?'無未結束的子代理':statuses.every(status=>status==='執行中')?`子代理仍在工作 · ${rows.length}`:`子代理未結束 · ${rows.length}`;
 return <div className="worker-activity-popover-anchor">
  {knownZero?<span className="worker-activity-zero" role="status">{label}</span>:<button type="button" className={`status worker-activity ${!connected||health.some(item=>item.unknown||item.quiet)?'warning':''}`} aria-haspopup="dialog" ref={menu.trigger} aria-expanded={menu.open} aria-controls={menu.id} popoverTarget={menu.id} onClick={()=>{if(!models.length&&loadModels)void loadModels().then(result=>onCatalog?.(result.models??[])).catch(()=>{});}}>{label}</button>}
  <section className="worker-activity-popover anchored-popover" ref={menu.popup} id={menu.id} popover="auto" onToggle={menu.onToggle} role="dialog" aria-label="子代理狀態">
   <div className="worker-activity-popover-heading"><strong>本聊天室的子代理</strong><button type="button" aria-label="關閉子代理狀態" onClick={()=>menu.close()}>×</button></div>
   {!!rows.length&&<ul className="worker-activity-list">{rows.map((row,index)=><WorkerRow key={row.requestId??index} row={row} models={models} online={connected} now={clock}/>)}</ul>}
   <button type="button" className="worker-details-link" onClick={()=>{menu.close(false);onViewDetails?.();}}>查看詳細</button>
  </section>
 </div>;
}
