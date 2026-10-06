import React,{useEffect,useState} from 'react';
import {workerStatus,workerHealth,workerEnded,pendingWorkerSummary} from './work-status.mjs';
import './worker-activity-popover.css';
import {useAnchoredPopover} from './anchored-popover.jsx';

const statusLabel={running:'執行中',starting:'準備中',pending:'等待中',unresolved:'狀態待確認',unavailable:'無法查明',completed:'已完成',failed:'失敗',cancelled:'已取消',canceled:'已取消',stopped:'已停止',interrupted:'已中斷',ended:'已結束，結果未知'};
const providerLabel={codex:'Codex 原生子代理','claude-native':'Claude Code 原生子代理',gemini:'Gemini Flash 工人'};
function timestamp(value){
 const time=typeof value==='number'?value:Date.parse(value??'');
 return Number.isFinite(time)?new Intl.DateTimeFormat('zh-TW',{dateStyle:'short',timeStyle:'medium'}).format(time):'尚無活動時間';
}
function WorkerRow({row,online,now}){const health=workerHealth(row,online,now);const label=row.task||row.agentNickname||row.name||(row.requestId?`子代理 ${String(row.requestId).slice(-8)}`:'子代理識別碼未知');return <article className="worker-popover-row">
 <div className="worker-popover-row-title"><strong>{label}</strong><span data-status={health.kind}>{health.text}</span></div>
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

export function WorkerActivityPopover({activity,details,online=true,compact=false}){
 const menu=useAnchoredPopover({width:380});
 const rows=Array.isArray(details)?details:[],hasPending=rows.some(row=>!workerEnded(row));
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(!hasPending)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[hasPending]);
 const clock=Math.max(now,Date.now()),summary=pendingWorkerSummary(rows,online,clock);
 const groups=[...rows.reduce((map,row)=>{
  const key=row.conversationId??'unknown';
  if(!map.has(key))map.set(key,{id:key,title:row.conversationTitle??'聊天室名稱未知',rows:[]});
  map.get(key).rows.push(row);return map;
 },new Map()).values()];
 const compactText=!online||!activity||activity.uncertain?'子代理 · 待確認':summary.quiet?'子代理 · 久未回報':`子代理 ${activity.running??0}`;
 return <div className="worker-activity-popover-anchor">
  <button type="button" className={`status worker-activity ${!online||!activity||activity.uncertain||summary.quiet||summary.historicalUnconfirmed?'warning':''}`} aria-haspopup="dialog" ref={menu.trigger} aria-expanded={menu.open} aria-controls={menu.id} popoverTarget={menu.id} title="查看目前所有聊天室的子代理狀態">{compact?<>{compactText}{summary.historicalUnconfirmed?` · 舊工單結果待確認：${summary.historicalUnconfirmed}`:''}</>:<>{workerStatus(activity,online)}{summary.quiet?` · 久未回報：${summary.quiet}`:''}</>}</button>
  <section className="worker-activity-popover anchored-popover" ref={menu.popup} id={menu.id} popover="auto" onToggle={menu.onToggle} role="dialog" aria-label="子代理狀態">
   <div className="worker-activity-popover-heading"><strong>子代理狀態</strong><button type="button" aria-label="關閉子代理狀態" onClick={()=>menu.close()}>×</button></div>
   {!online&&<p className="worker-popover-note">後端斷線，以下僅為最後保留的狀態；目前執行狀態未知。</p>}
   {!!summary.quiet&&<p className="worker-popover-note">久未回報不等於已卡死；展開明細可看最後活動。狀態查詢不會刷新活動時間，也不會自動重派。</p>}
   {groups.map(group=><section className="worker-popover-room" key={group.id}>
    <h3>{group.title}</h3>
    {group.rows.filter(row=>!workerEnded(row)).map((row,index)=><WorkerRow key={row.requestId??`${group.id}-active-${index}`} row={row} online={online} now={clock}/>)}
    {!!group.rows.filter(row=>workerEnded(row)).length&&<details className="worker-popover-ended"><summary>已結束 {group.rows.filter(row=>workerEnded(row)).length} 個</summary>{group.rows.filter(row=>workerEnded(row)).map((row,index)=><WorkerRow key={row.requestId??`${group.id}-ended-${index}`} row={row} online={online} now={clock}/>)}</details>}
   </section>)}
   {!groups.length&&<p className="worker-popover-note">目前沒有可列出的子代理明細；計數仍依原生狀態顯示，不推定為已停止。</p>}
  </section>
 </div>;
}
