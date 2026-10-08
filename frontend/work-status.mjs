import {formatElapsed} from '../shared/conversation-groups.mjs';

export const QUIET_WORK_MS=5*60*1000;
const age=(at,now)=>Number.isFinite(at)?Math.max(0,now-at):null;
const terminalWorkers=['completed','failed','cancelled','canceled','stopped','interrupted','ended'];
const statusLabel={running:'執行中',starting:'準備中',pending:'等待中',completed:'已完成',failed:'失敗',cancelled:'已取消',canceled:'已取消',stopped:'已停止',interrupted:'已中斷',ended:'已結束，結果未知'};
export const workerEnded=worker=>worker.settled===true||worker.settled!==false&&terminalWorkers.includes(worker.status);
// A main-agent handling note is separate from native execution settlement.
export const workerReconciled=worker=>!workerEnded(worker)&&worker.executionUnowned===true&&!!worker.reconciliation?.reviewedAt;
export const currentWorkers=state=>Array.isArray(state.workerDetails)?state.workerDetails.filter(w=>w.conversationId===state.threadId):(state.workers??[]).filter(w=>w.kind!=='command');
const eventTime=value=>typeof value==='number'?value:Date.parse(value??'');
export function workerHealth(worker,online=true,now=Date.now()){
 if(workerEnded(worker))return {kind:worker.status==='failed'?'danger':'muted',text:statusLabel[worker.status]??'已結束，結果未知'};
 if(workerReconciled(worker))return {kind:'muted',unknown:true,text:'已留查核註記 · 原執行結果仍未知'};
 if(worker.executionUnowned===true)return {kind:'warning',unknown:true,historicalUnconfirmed:true,text:'舊工單結果待確認 · 重啟後無法確認執行結果'};
 if(!online||worker.workerConnection==='failed'||!['running','starting','pending'].includes(worker.status))return {kind:'warning',unknown:true,text:worker.status==='failed'?'失敗 · 停止尚待確認':'狀態待確認'};
 if(worker.confirmationReason)return {kind:'confirmation',text:'等待核准／回答'};
 const last=eventTime(worker.lastActivityAt??worker.activity?.lastEventAt),start=eventTime(worker.activity?.startedAt??worker.startedAt);
 const quiet=age(last,now)??age(start,now);
 if(quiet!==null&&quiet>=QUIET_WORK_MS)return {kind:'warning',quiet:true,text:`已 ${formatElapsed(quiet)}無新活動回報 · 是否卡住待確認`};
 const phase={tool:'等待工具回報',worker:'等待其子代理回報',compacting:'正在壓縮脈絡'}[worker.activity?.phase];
 return {kind:'running',text:`${phase??statusLabel[worker.status]} · ${Number.isFinite(last)?`最近活動 ${formatElapsed(age(last,now))}前`:'尚無活動時間回報'}`};
}
export function pendingWorkerSummary(rows,online=true,now=Date.now()){
 const pending=rows.filter(w=>!workerEnded(w)&&w.executionUnowned!==true),historicalUnconfirmed=rows.filter(w=>!workerEnded(w)&&w.executionUnowned===true&&!workerReconciled(w)),health=pending.map(w=>workerHealth(w,online,now));
 return {count:pending.length,unknown:health.filter(h=>h.unknown).length,quiet:health.filter(h=>h.quiet).length,confirmation:health.filter(h=>h.kind==='confirmation').length,healthy:health.filter(h=>h.kind==='running').length,historicalUnconfirmed:historicalUnconfirmed.length};
}
export function workStatus(state,online=true,now=Date.now()) {
 if(!online)return {kind:'danger',text:'後端斷線 · 無法確認工作狀態'};
 const children=pendingWorkerSummary(currentWorkers(state),online,now);
 const pendingText=[children.count?children.healthy===children.count?`子代理仍在工作：${children.count} 個`:`子代理未結束：${children.count} 個${children.confirmation?` · 等待核准：${children.confirmation}`:''}${children.unknown?` · 待確認：${children.unknown}`:''}${children.quiet?` · 久未回報：${children.quiet}（是否卡住待確認）`:''}`:'',children.historicalUnconfirmed?`舊工單結果待確認：${children.historicalUnconfirmed} 個`:''].filter(Boolean).join(' · ');
 const terminal={offline:'核心已斷線',error:'連線失敗',failed:'工作失敗',uncertain:'工作狀態待確認',connecting:'正在載入對話…',stopping:'正在停止背景工作…',interrupted:'已停止'};
 if(terminal[state.status])return {kind:['connecting','stopping','interrupted'].includes(state.status)?'muted':state.status==='uncertain'?'warning':'danger',text:terminal[state.status]+(pendingText?` · ${pendingText}`:'')};
 if(state.questions?.length)return {kind:'confirmation',text:'等待你的確認'};
 if(!state.busy&&state.status!=='working')return pendingText?{kind:children.unknown||children.quiet||children.confirmation||children.historicalUnconfirmed?'warning':'waiting',text:children.count===1&&children.healthy===1&&!children.historicalUnconfirmed?'子代理仍在工作 · 主代理待命':`主代理待命 · ${pendingText}`} : state.completionPending?{kind:'waiting',text:'等待結果交接'}:null;
 const a=state.activity,recent=age(a?.lastEventAt,now),waiting=age(a?.phaseSince,now);
 const freshness=recent===null?'尚無核心活動回報':`最近活動 ${formatElapsed(recent)}前`;
 const retry=(state.notices??[]).findLast(n=>n.willRetry&&!n.resolved);
 if(retry)return {kind:'warning',text:`原生核心重連中 · ${freshness}`};
 const quiet=recent??age(a?.startedAt,now);
 const stale=quiet!==null&&quiet>=QUIET_WORK_MS;
 const phase=!a?'工作狀態待確認':{starting:'等待核心回報',tool:'等待工具回報',worker:'等待子代理回報',compacting:'正在壓縮工作脈絡'}[a.phase]??(stale?'工作尚未結束':'執行中');
 const wait=!stale&&['tool','worker'].includes(a?.phase)&&waiting!==null?` ${formatElapsed(waiting)}`:'';
 const detail=stale?`已 ${formatElapsed(quiet)}無新活動回報`:freshness;
 return {kind:stale||!a?'warning':'running',text:`${phase}${wait} · ${detail}${a?.phase==='worker'&&pendingText?` · ${pendingText}`:''}`};
}
