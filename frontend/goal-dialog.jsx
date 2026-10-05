import React,{useState} from 'react';

export const goalStatusLabel=goal=>({starting:'正在啟動',active:'進行中',paused:'已暫停',complete:'已完成',blocked:'受阻',usageLimited:'額度暫停',budgetLimited:'預算用完',interrupted:'已停止',failed:'失敗',ended:'已結束，結果待確認',unknown:'狀態待確認'})[goal?.status]??(goal?'狀態待確認':'未設定');

export function GoalDialog({state,Modal,request,onClose}){
 const [objective,setObjective]=useState(state.goal?.objective??''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const provider=state.provider??'codex',supported=state.capabilities?.goal!==false;
 const locked=pending||state.goalPending,working=state.busy||state.goal?.status==='active';
 const run=async(route,data)=>{setPending(true);setError('');try{await request(route,{...data,threadId:state.threadId});}catch(e){setError(e.message);}finally{setPending(false);}};
 return <Modal title="目標模式" onClose={onClose}>
  <p className="modal-description">由原生核心持續執行，沿用這個聊天室的模型與操作權限。你可直接設定，不必先請 AI 設定。</p>
  {!supported?<p role="status">目前核心未回報可用的原生目標指令。</p>:<>
   <label className="goal-editor">要完成的目標<textarea aria-label="要完成的目標" value={objective} maxLength={provider==='gemini'?32000:4000} onChange={e=>setObjective(e.target.value)} disabled={locked||state.busy}/></label>
   <p className="goal-state" role="status">{state.goalError?'狀態待確認':goalStatusLabel(state.goal)}</p>
   {provider==='claude'&&state.goal?.status==='ended'&&<p className="modal-description">原生 /goal 已不再啟用；此串流介面未回報達標或無法完成的區別，請查看工作結果。</p>}
   {provider==='gemini'&&<p className="modal-description">停止會結束本次原生目標執行；重開 K 不會自行重跑。再次執行須由你明確啟動。</p>}
   {state.goal?.reason&&<p className="modal-description">{state.goal.reason}</p>}
   {(error||state.goalError)&&<p role="alert">{error||state.goalError}</p>}
   <div className="modal-actions goal-actions">
    {provider!=='gemini'&&<button disabled={locked||state.busy} onClick={()=>run('goal',{refresh:true})}>刷新狀態</button>}
    {state.goal&&<button disabled={locked||state.busy} onClick={()=>run('goal',{clear:true})}>{provider==='gemini'?'清除目標紀錄':'清除目標'}</button>}
    {working&&<button disabled={locked} onClick={()=>run('stop',{})}>{provider==='codex'?'停止並暫停目標':'停止目標工作'}</button>}
    {provider==='codex'&&state.goal&&['paused','blocked','usageLimited','budgetLimited'].includes(state.goal.status)&&<button disabled={locked||state.busy} onClick={()=>run('goal',{status:'active'})}>繼續目標</button>}
    <button className="primary" disabled={locked||state.busy||!objective.trim()} onClick={()=>run('goal',{objective,status:'active'})}>{state.goal?'更新並執行':'設定並執行'}</button>
   </div>
  </>}
 </Modal>;
}
