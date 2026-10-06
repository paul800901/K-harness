import React,{useEffect,useState} from 'react';

// No background history cache or replay. The detail belongs to the exact room
// and record, and closing/switching it discards an unfinished read.
export function RemoteRecord({threadId,kind,id,summary,children}){
 const [open,setOpen]=useState(false),[result,setResult]=useState(null);
 useEffect(()=>{
  setResult(null);if(!open)return;
  const abort=new AbortController();
  fetch(`/api/${kind}?threadId=${encodeURIComponent(threadId)}&id=${encodeURIComponent(id)}`,{signal:abort.signal})
   .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error??'無法讀取紀錄。');return data;})
   .then(data=>{if(!abort.signal.aborted)setResult({data});})
   .catch(error=>{if(!abort.signal.aborted)setResult({error:error.message});});
  return()=>abort.abort();
 },[open,threadId,kind,id]);
 return <details open={open} onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}}><summary>{summary}</summary>{open&&<>
  {!result?<p role="status">正在讀取這筆紀錄…</p>:result.error?<p role="alert">{result.error}</p>:children(result.data)}
  <small>展開時的紀錄；收合再展開可重新讀取。不會執行或重送工作。</small>
 </>}</details>;
}
