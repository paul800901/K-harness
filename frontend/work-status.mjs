import {formatElapsed} from '../shared/conversation-groups.mjs';

export const QUIET_WORK_MS=5*60*1000;
const age=(at,now)=>Number.isFinite(at)?Math.max(0,now-at):null;
export function workStatus(state,online=true,now=Date.now()) {
 if(!online)return {kind:'danger',text:'後端斷線 · 無法確認工作狀態'};
 const terminal={offline:'核心已斷線',error:'連線失敗',failed:'工作失敗',uncertain:'工作狀態待確認',connecting:'正在載入對話…',stopping:'正在停止背景工作…',interrupted:'已停止'};
 if(terminal[state.status])return {kind:['connecting','stopping','interrupted'].includes(state.status)?'muted':state.status==='uncertain'?'warning':'danger',text:terminal[state.status]};
 if(state.questions?.length)return {kind:'confirmation',text:'等待你的確認'};
 if(!state.busy&&state.status!=='working')return null;
 const a=state.activity,recent=age(a?.lastEventAt,now),waiting=age(a?.phaseSince,now);
 const freshness=recent===null?'尚無核心活動回報':`最近活動 ${formatElapsed(recent)}前`;
 const retry=(state.notices??[]).findLast(n=>n.willRetry&&!n.resolved);
 if(retry)return {kind:'warning',text:`原生核心重連中 · ${freshness}`};
 const quiet=recent??age(a?.startedAt,now);
 const stale=quiet!==null&&quiet>=QUIET_WORK_MS;
 const phase=!a?'工作狀態待確認':{starting:'等待核心回報',tool:'等待工具回報',worker:'等待子代理回報',compacting:'正在壓縮工作脈絡'}[a.phase]??(stale?'工作尚未結束':'執行中');
 const wait=!stale&&['tool','worker'].includes(a?.phase)&&waiting!==null?` ${formatElapsed(waiting)}`:'';
 const detail=stale?`已 ${formatElapsed(quiet)}無新活動回報`:freshness;
 return {kind:stale||!a?'warning':'running',text:`${phase}${wait} · ${detail}`};
}

export function workerStatus(activity,online=true) {
 if(!online||!activity)return '子代理：狀態待確認';
 if(!activity.uncertain)return `子代理執行中：${activity.running}`;
 return `子代理已確認執行中：${activity.running} · ${activity.unconfirmed?`待確認：${activity.unconfirmed}`:'部分連線待確認'}`;
}
