import React,{useEffect,useState} from 'react';
import {currentWorkers,workerHealth,workerEnded,pendingWorkerSummary} from './work-status.mjs';
import './worker-activity-popover.css';
import {formatElapsed} from '../shared/conversation-groups.mjs';
import {useAnchoredPopover} from './anchored-popover.jsx';

const statusLabel={running:'執行中',starting:'準備中',pending:'等待中',unresolved:'狀態待確認',unavailable:'無法查明',completed:'已完成',failed:'失敗',cancelled:'已取消',canceled:'已取消',stopped:'已停止',interrupted:'已中斷',ended:'已結束，結果未知'};
const providerLabel={codex:'Codex 原生子代理','claude-native':'Claude Code 原生子代理',gemini:'Gemini Flash 工人'};
function timestamp(value){
 const time=typeof value==='number'?value:Date.parse(value??'');
 return Number.isFinite(time)?new Intl.DateTimeFormat('zh-TW',{dateStyle:'short',timeStyle:'medium'}).format(time):'尚無活動時間';
}
function WorkerRow({row,online,now}){const health=workerHealth(row,online,now),started=row.startedAt??row.activity?.startedAt,start=typeof started==='number'?started:Date.parse(started??'');const label=row.agentNickname||row.name||row.task||(row.requestId?`子代理 ${String(row.requestId).slice(-8)}`:'子代理識別碼未知');return <article className="worker-popover-row">
 <div className="worker-popover-row-title"><strong title={label}>{label.length>80?label.slice(0,80)+'…':label}</strong><span data-status={health.kind}>{health.text}</span></div>
 {Number.isFinite(start)&&<small>已耗時 {formatElapsed(Math.max(0,now-start))}</small>}
 {row.lastToolName&&<small>最近工具：{row.lastToolName}</small>}
 <small>{providerLabel[row.provider]??row.provider??'工人類型未知'}{row.model?` · ${row.model}`:' · 原生型號未知'}</small>
 <details><summary>查看狀態細節</summary><dl>
  <dt>{online?'原生狀態':'上次原生狀態'}</dt><dd>{statusLabel[row.status]??row.status??'未知'}</dd>
  <dt>工人識別碼</dt><dd>{row.requestId??'未知'}</dd>
  <dt>最後活動</dt><dd>{timestamp(row.lastActivityAt??row.activity?.lastEventAt)}</dd>
  {row.lastToolName&&<><dt>最近工具</dt><dd>{row.lastToolName}</dd></>}
  <dt>最後讀回</dt><dd>{row.lastReadAt?timestamp(row.lastReadAt):'尚無讀回時間'}</dd>
  {row.inspection&&<><dt>久無活動檢查</dt><dd>{timestamp(row.inspection.checkedAt)} · {row.inspection.reason}</dd></>}
  {row.confirmationReason&&<><dt>待確認原因</dt><dd>{row.confirmationReason}</dd></>}
  {row.status==='unresolved'&&!row.confirmationReason&&!row.error&&<><dt>待確認原因</dt><dd>原生狀態未提供原因</dd></>}
  {row.error&&<><dt>錯誤</dt><dd>{row.error}</dd></>}
  {row.workerConnection==='failed'&&<><dt>連線</dt><dd>子代理狀態讀回失敗</dd></>}
 </dl></details>
</article>;}

export function WorkerActivityPopover({state,online=true,compact=false}){
 const menu=useAnchoredPopover({width:380});
 const rows=currentWorkers(state).filter(row=>!workerEnded(row)&&row.executionUnowned!==true);
 const hasPending=rows.length>0,[now,setNow]=useState(Date.now);
 useEffect(()=>{if(!hasPending)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[hasPending]);
 const connected=online&&!['offline','error','uncertain'].includes(state.status)&&state.workerConnection!=='failed';
 const clock=Math.max(now,Date.now()),summary=pendingWorkerSummary(rows,connected,clock);
 const text=!connected?'子代理：狀態待確認':`子代理：${summary.count}${summary.unknown?` · 待確認：${summary.unknown}`:''}${summary.quiet?` · 久未回報：${summary.quiet}`:''}`;
 return <div className="worker-activity-popover-anchor">
  <button type="button" className={`status worker-activity ${!connected||summary.unknown||summary.quiet?'warning':''}`} aria-haspopup="dialog" ref={menu.trigger} aria-expanded={menu.open} aria-controls={menu.id} popoverTarget={menu.id} title="查看本聊天室尚未結束的子代理">{compact&&!connected?'子代理 · 待確認':text}</button>
  <section className="worker-activity-popover anchored-popover" ref={menu.popup} id={menu.id} popover="auto" onToggle={menu.onToggle} role="dialog" aria-label="子代理狀態">
   <div className="worker-activity-popover-heading"><strong>本聊天室的子代理</strong><button type="button" aria-label="關閉子代理狀態" onClick={()=>menu.close()}>×</button></div>
   {!connected&&<p className="worker-popover-note">連線未確認，以下僅為最後保留的狀態；目前執行狀態未知。</p>}
   {!!summary.quiet&&<p className="worker-popover-note">久未回報不等於已卡死；活動回報不代表有實質進度，也不能證明沒有空燒用量。不會因此自動重派。</p>}
   {rows.map((row,index)=><WorkerRow key={row.requestId??index} row={row} online={connected} now={clock}/>)}
   {!rows.length&&connected&&<p className="worker-popover-note">本聊天室目前沒有尚未結束的子代理。</p>}
  </section>
 </div>;
}
