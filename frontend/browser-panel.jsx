import React,{useEffect,useRef,useState} from 'react';
import './browser-panel.css';

export function BrowserPanel({threadId,enabled=false,visible=true,onState,refreshKey=0}){
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState('');
 const callback=useRef(onState);callback.current=onState;
 useEffect(()=>{setSnapshot(null);setError('');},[threadId]);
 useEffect(()=>{
  if(!visible||!enabled||!threadId)return;
  let active=true,timer;
  const refresh=async()=>{
   try{
    const response=await fetch('/api/browser/state?threadId='+encodeURIComponent(threadId),{headers:{'X-K-Request':'1'}});
    const body=await response.json();if(!response.ok)throw Error(body.error||'無法讀取瀏覽器狀態。');
    if(active){setSnapshot(body);setError('');callback.current?.(body);}
   }catch(error){if(active)setError(error.message||'瀏覽器狀態讀取失敗。');}
   if(active)timer=setTimeout(refresh,1000);
  };
  refresh();return()=>{active=false;clearTimeout(timer);};
 },[visible,enabled,threadId,refreshKey]);
 return <section className="browser-panel-content" aria-label="K 瀏覽器助手">
  <div className="browser-empty"><strong>K 瀏覽器助手</strong>
   {!enabled?<p>瀏覽器尚未啟用。</p>:!threadId?<p>請先開啟對話。</p>:<>
    <p>網頁在外部 Chrome 視窗中操作，不在此重複顯示。</p>
    <p>{snapshot?.browserMode==='incognito'?'無痕視窗':snapshot?.browserMode==='regular'?'一般視窗':'請交代 AI 使用一般或無痕視窗。'}</p>
    {snapshot?.busy&&<p>AI 正在操作 Chrome。</p>}
    {snapshot?.error&&<p role="status">{snapshot.error}</p>}{error&&<p role="alert">{error}</p>}
   </>}
  </div>
 </section>;
}
