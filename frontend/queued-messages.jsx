import React,{useEffect,useState} from 'react';

function QueuedMessage({item,threadId,busy,canSteer,action,request}){
 const editing=item.status==='editing',draftKey=`k-queue-edit:${threadId}:${item.id}`;
 const [text,setText]=useState(()=>{try{return editing?(sessionStorage.getItem(draftKey)??item.text):item.text;}catch{return item.text;}});
 const [pending,setPending]=useState(false);
 useEffect(()=>{if(!editing){setText(item.text);try{sessionStorage.removeItem(draftKey);}catch{}}},[editing,item.text,draftKey]);
 const perform=(operation,value)=>action(async()=>{setPending(true);try{return await request('queue',{id:item.id,action:operation,...(value===undefined?{}:{text:value})});}finally{setPending(false);}});
 return <div className={`queued-message${editing?' queued-message-editing':''}`}>
  {editing?<><textarea aria-label="編輯待送訊息" value={text} maxLength={32000} rows={3} onChange={e=>{setText(e.target.value);try{sessionStorage.setItem(draftKey,e.target.value);}catch{}}}/><small>編輯中，尚未送出{item.attachmentIds?.length?` · 保留 ${item.attachmentIds.length} 個附件`:''}</small><div className="queued-message-actions"><button type="button" disabled={pending} onClick={()=>perform('edit-cancel')}>取消編輯</button><button type="button" disabled={pending||!text.trim()} onClick={()=>perform('edit-save',text)}>儲存</button></div></>
  :<><span>{item.text}{item.attachmentIds?.length?` · ${item.attachmentIds.length} 個附件`:''}</span><small>{item.status==='sending'?'正在送入':item.status==='uncertain'?'狀態待確認':'排隊中'}</small><div className="queued-message-actions"><button type="button" disabled={pending||item.status!=='queued'} onClick={()=>perform('edit-start')}>編輯</button><button type="button" disabled={pending||item.status!=='queued'||(busy&&!canSteer)} title={busy&&!canSteer?'此核心目前不支援執行中立即送入；訊息與附件保留排隊':undefined} onClick={()=>perform('send-now')}>立即送入</button><button type="button" disabled={pending||item.status==='sending'} title={item.status==='uncertain'?'只移除本機待送紀錄，不撤回可能已送出的訊息。':undefined} onClick={()=>perform('remove')}>{item.status==='uncertain'?'移除紀錄':'取消'}</button></div></>}
 </div>;
}

export function QueuedMessages({state,action,request}){
 if(!state.queuedMessages?.length)return null;
 return <section className="queued-messages" aria-label="待送訊息"><strong>待送訊息{state.queuePaused?' · 佇列暫停':''}</strong>{state.queuePaused&&<button onClick={()=>action(()=>request('queue',{action:'resume'}))}>繼續排隊</button>}{state.queueWaitingReason&&<small role="status">{state.queueWaitingReason}</small>}{state.queuedMessages.map(item=><QueuedMessage key={item.id} item={item} threadId={state.threadId} busy={state.busy} canSteer={state.capabilities?.steer!==false} action={action} request={request}/>)}</section>;
}
