import {RemoteRecord} from './remote-record.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {Copy,Check,X} from 'lucide-react';
import {visibleNativeNotices,nativeNoticeText} from './native-notices.mjs';
export function CopyFeedback({text}){
 const [status,setStatus]=useState('idle');const timer=useRef(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);};},[]);
 const copy=async()=>{clearTimeout(timer.current);setStatus('pending');try{await navigator.clipboard.writeText(text??'');if(!mounted.current)return;setStatus('copied');timer.current=setTimeout(()=>setStatus('idle'),2000);}catch{if(mounted.current)setStatus('failed');}};
 const label=status==='copied'?'已複製':status==='failed'?'複製失敗，請重試':status==='pending'?'複製中':'複製';
 return <button type="button" title={label} aria-label={label} disabled={status==='pending'} onClick={copy}>{status==='copied'?<Check size={15}/>:<Copy size={15}/>} <span aria-live="polite">{label}</span></button>;
}
export function NativeNotices({state,error=state.error}){
 const [dismissed,setDismissed]=useState({}),scope=JSON.stringify([state.provider,state.workspace,state.threadId]);
 return <div className="native-notices">{visibleNativeNotices(state.notices,error).filter(n=>!(dismissed[scope]??[]).includes(n.retryKey??n.id)).map(n=>{
  const key=n.retryKey??n.id,text=nativeNoticeText(n),isError=n.level==='error'&&!n.willRetry;
  return <div key={key} className={isError?'alert':'notice'} role={isError?'alert':'status'}><div className="native-notice-content"><span>{text}</span>{text!==n.message&&<details><summary>查看詳細內容</summary><pre>{n.message}</pre></details>}</div><button type="button" className="native-notice-dismiss" title="關閉此通知" aria-label="關閉此通知" onClick={()=>setDismissed(d=>({...d,[scope]:[...(d[scope]??[]),key]}))}><X size={15}/></button></div>;
 })}</div>;
}
export function NativeReasoning({state,group}){
 if(state.capabilities?.reasoningSummary===false)return <small>此供應商尚未接入可顯示的原生推理摘要。</small>;
 const rows=(state.reasoning??[]).filter(r=>r.groupId===group.id||group.messages.some(m=>m.turnId&&m.turnId===r.turnId));
 return rows.map(r=><section key={r.id}><strong>原生推理摘要</strong><pre>{r.text}</pre></section>);
}
function patchStatusLabel(status){
 switch(status){
  case 'inProgress':case 'running':return '進行中';
  case 'completed':return '已完成';
  case 'failed':return '失敗';
  case 'declined':return '已拒絕';
  default:return '狀態未知';
 }
}
export function NativeDiffs({state}){
 const turns=state.turnDiffs??[],patches=(state.tools??[]).filter(tool=>tool.patchChanges?.length||tool.hasPatchChanges);
 return <section className="native-diffs"><h3>檔案差異</h3>
  {!turns.length&&!patches.length&&<p>{state.capabilities?.turnDiffs===false?'此供應商尚無已接入的原生差異來源。':'尚未收到原生檔案差異；不代表檔案沒有改動。'}</p>}
  {turns.map(diff=>diff.diffDeferred?<RemoteRecord key={diff.turnId} threadId={state.threadId} kind="turn-diff" id={diff.turnId} summary={`回合 ${diff.turnId}`}>{({diff})=><pre>{diff.diff}</pre>}</RemoteRecord>:<details key={diff.turnId}><summary>回合 {diff.turnId}</summary><pre>{diff.diff}</pre></details>)}
  {patches.map(tool=>tool.detailsDeferred?<RemoteRecord key={tool.id} threadId={state.threadId} kind="tool" id={tool.id} summary={`檔案變更 · ${patchStatusLabel(tool.status)}`}>{({tool})=>(tool.patchChanges??[]).map((change,index)=><section key={index}><strong>{change.path}</strong><pre>{change.diff}</pre></section>)}</RemoteRecord>:<details key={tool.id}><summary>檔案變更 · {patchStatusLabel(tool.status)}</summary>{tool.patchChanges.map((change,index)=><section key={index}><strong>{change.path}</strong><pre>{change.diff}</pre></section>)}</details>)}
  <small>狀態依原生紀錄顯示，不代表目前檔案內容；唯讀檢視，不會還原檔案或回溯對話。</small>
 </section>;
}

export function NativeFilePicker({state,draft,onSelect,request}){
 const match=/(?:^|\s)@([^\s]*)$/.exec(draft),query=match?.[1];const [result,setResult]=useState({}),[dismissed,setDismissed]=useState(null);
 useEffect(()=>{let alive=true;if(query===undefined||!query.trim()||state.capabilities?.fileSearch===false||state.provider==='claude'){setResult({});return()=>{alive=false;};}setResult({loading:true});const timer=setTimeout(()=>{request('native/files/search',{query}).then(r=>{if(alive)setResult({files:r.files??[]});}).catch(e=>{if(alive)setResult({error:e.message});});},200);return()=>{alive=false;clearTimeout(timer);};},[query,state.threadId,state.workspace,state.capabilities?.fileSearch]);
 if(query===undefined||dismissed===draft)return null;
 return <section className="native-file-picker" aria-label="工作區檔案搜尋"><header><strong>工作區檔案</strong><button type="button" onClick={()=>setDismissed(draft)}>關閉</button></header>{state.provider==='claude'||state.capabilities?.fileSearch===false?<p>此供應商尚未接入原生檔案搜尋。</p>:!query.trim()?<p>請在 @ 後輸入檔名。</p>:result.loading?<p>搜尋中…</p>:result.error?<p role="alert">{result.error}</p>:<>{!(result.files??[]).length&&<p>沒有符合的檔案。</p>}{(result.files??[]).map(f=><button type="button" key={f.path} onClick={()=>{onSelect(draft.slice(0,draft.lastIndexOf('@'))+JSON.stringify(f.path)+' ');setDismissed(null);}}>{f.path}</button>)}</>}<small>只插入檔案路徑，不自動讀取內容或送出。</small></section>;
}
export function NativeReview({state,request,action}){
 const [confirm,setConfirm]=useState(false);useEffect(()=>setConfirm(false),[state.threadId]);
 if(state.provider==='claude'||state.capabilities?.review===false)return <p>此供應商尚未接入等價的原生程式碼審查。</p>;
 return <section><h3>原生程式碼審查</h3><p>審查目前工作區尚未提交的改動；會啟動新的原生回合並使用訂閱額度。</p>{confirm?<><button onClick={()=>setConfirm(false)}>取消</button><button disabled={state.busy} onClick={()=>action(async()=>{await request('native/review',{confirmed:true});setConfirm(false);})}>確認開始審查</button></>:<button disabled={!state.threadId||state.busy} onClick={()=>setConfirm(true)}>審查未提交改動</button>}</section>;
}
