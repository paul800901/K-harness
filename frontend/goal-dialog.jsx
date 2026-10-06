import React,{useEffect,useState} from 'react';

export const goalStatusLabel=goal=>({starting:'正在啟動',active:'進行中',paused:'已暫停',complete:'已完成',blocked:'受阻',usageLimited:'額度暫停',budgetLimited:'預算用完',interrupted:'已停止',failed:'失敗',ended:'已結束，結果待確認',unknown:'狀態待確認'})[goal?.status]??(goal?'狀態待確認':'未設定');

export function GoalDialog({state,Modal,request,onClose}){
 const [objective,setObjective]=useState(state.goal?.objective??''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const [baseObjective,setBaseObjective]=useState(state.goal?.objective??'');
 const provider=state.provider??'codex',supported=state.capabilities?.goal!==false;
 const canEdit=state.capabilities?.goalEdit===true&&!!state.goal;
 const locked=pending||state.goalPending,working=state.busy||state.goal?.status==='active';
 // Follow external edits only while the editor is clean; preserve a user's
 // unsaved text and let the server reject a stale save instead of overwriting it.
 useEffect(()=>{if(objective===baseObjective){const next=state.goal?.objective??'';setObjective(next);setBaseObjective(next);}},[state.goal?.objective]);
 const run=async(route,data)=>{setPending(true);setError('');try{await request(route,{...data,threadId:state.threadId});if(data.objective){setBaseObjective(data.objective.trim());setObjective(data.objective.trim());}}catch(e){setError(e.message);}finally{setPending(false);}};
 return <Modal title="目標模式" onClose={onClose}>
  <p className="modal-description">此聊天室使用 {({codex:'Codex',claude:'Claude',gemini:'Gemini'})[provider]??provider} 原生目標模式，沿用目前模型與操作權限。你可直接設定，不必先請 AI 設定。</p>
  {!supported?<p role="status">目前核心未回報可用的原生目標指令。</p>:<>
   <label className="goal-editor">要完成的目標<textarea aria-label="要完成的目標" value={objective} maxLength={provider==='gemini'?32000:4000} onChange={e=>setObjective(e.target.value)} disabled={locked||(state.busy&&!canEdit)}/></label>
   {canEdit&&<p className="modal-description">你與 AI 都能直接修改目標，不需再次確認。「儲存目標」只改文字，保留目前狀態與預算；暫停中不會自動繼續。</p>}
   {provider!=='codex'&&<p className="modal-description">目前原生核心不提供只改文字的操作；「更新並執行」會重新啟動目標，不是單純儲存。</p>}
   <p className="goal-state" role="status">{state.goalError?'狀態待確認':goalStatusLabel(state.goal)}</p>
   {provider==='claude'&&state.goal?.status==='ended'&&<p className="modal-description">原生 /goal 已不再啟用；此串流介面未回報達標或無法完成的區別，請查看工作結果。</p>}
   {provider==='gemini'&&<p className="modal-description">停止會結束本次原生目標執行；重開 K 不會自行重跑。再次執行須由你明確啟動。</p>}
   {state.goal?.reason&&<p className="modal-description">{state.goal.reason}</p>}
   {(error||state.goalError)&&<p role="alert">{error||state.goalError}</p>}
   <div className="modal-actions goal-actions">
    {provider!=='gemini'&&<button disabled={locked||state.busy} onClick={()=>run('goal',{refresh:true})}>刷新狀態</button>}
    {state.goal&&<button disabled={locked||state.busy} onClick={()=>run('goal',{clear:true})}>{provider==='gemini'?'清除目標紀錄':'清除目標'}</button>}
    {working&&<button disabled={locked} onClick={()=>run('stop',{})}>{provider==='codex'?'停止並暫停目標':'停止目標工作'}</button>}
    {provider==='codex'&&state.goal&&['paused','blocked'].includes(state.goal.status)&&<button disabled={locked} onClick={()=>run('goal',{status:'active',resumeOnly:true})}>繼續目標</button>}
    {canEdit&&<button className="primary" disabled={locked||!objective.trim()||objective.trim()===baseObjective} onClick={()=>run('goal',{objective,editOnly:true,expectedObjective:baseObjective})}>儲存目標</button>}
    <button className={canEdit?undefined:'primary'} disabled={locked||state.busy||!objective.trim()} onClick={()=>run('goal',{objective,status:'active'})}>{state.goal?'更新並執行':'設定並執行'}</button>
   </div>
  </>}
 </Modal>;
}
