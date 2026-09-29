import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Download,Maximize2,Minimize2,Plus,RotateCw,ArrowUp,X} from 'lucide-react';
import './browser-panel.css';

const requestHeaders={'X-K-Request':'1'};

export function NativeBrowserPanel({threadId,enabled=false,visible=true,suspended=false,pageId=null,onPageCreated,onPageClosed,onState,newPageRequest=0,refreshKey=0}){
 const [snapshot,setSnapshot]=useState(null),[localError,setLocalError]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[downloadsOpen,setDownloadsOpen]=useState(false),[url,setUrl]=useState('');
 const viewportRef=useRef(null),urlInputRef=useRef(null),urlDirty=useRef(false),viewId=useRef(globalThis.crypto?.randomUUID?.()||`native-browser-${Date.now()}-${Math.random().toString(36).slice(2)}`),snapshotRef=useRef(null),threadRef=useRef(threadId),pageRef=useRef(pageId),generation=useRef(0),actionBusy=useRef(false),activePage=useRef(pageId),lastNewPageRequest=useRef(newPageRequest),presentChain=useRef(Promise.resolve()),lastRect=useRef(''),presentGeneration=useRef(0);
 const callbacks=useRef({onState,onPageCreated,onPageClosed});callbacks.current={onState,onPageCreated,onPageClosed};
 const canUse=typeof window!=='undefined'&&typeof window.kBrowser?.present==='function';
 const viewVisible=visible&&!suspended,viewVisibleRef=useRef(viewVisible);viewVisibleRef.current=viewVisible;
 const pages=Array.isArray(snapshot?.pages)?snapshot.pages:[];
 const currentPage=pages.find(item=>item.id===(pageId||activePage.current))||pages.find(item=>item.id===snapshot?.selectedPageId);
 const currentPageId=pageId||activePage.current||snapshot?.selectedPageId||null;
 const human=snapshot?.mode==='human';
 const available=snapshot?.available===true;
 const isBusy=busy||snapshot?.busy===true;
 useEffect(()=>{lastRect.current='';},[refreshKey]);
 const syncUrl=useCallback(value=>{
  const focused=typeof document!=='undefined'&&document.activeElement===urlInputRef.current;
  if(!urlDirty.current&&!focused)setUrl(value||'');
 },[]);

 useEffect(()=>{threadRef.current=threadId;pageRef.current=pageId;activePage.current=pageId;generation.current++;actionBusy.current=false;setBusy(false);setSnapshot(null);snapshotRef.current=null;setLocalError('');setUrl('');urlDirty.current=false;setExpanded(false);setDownloadsOpen(false);lastRect.current='';presentGeneration.current++;},[threadId,pageId]);

 const hide=useCallback((id)=>{
  if(!canUse||!id)return;
  const token=++presentGeneration.current;lastRect.current='';
  presentChain.current=presentChain.current.catch(()=>{}).then(()=>{
   return window.kBrowser?.hide?.({threadId:id,viewId:viewId.current});
  }).catch(error=>{if(id===threadRef.current)setLocalError(error?.message||'無法隱藏原生瀏覽器。');});
 },[canUse]);

 useEffect(()=>{
  if(!viewVisible||!enabled||!threadId){hide(threadId);return ()=>{};}
  let alive=true,timer,sequence=0;
  const refresh=async()=>{
   const current=++sequence;
   try{
    const response=await fetch(`/api/browser/state?threadId=${encodeURIComponent(threadId)}`,{headers:requestHeaders});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'無法讀取瀏覽器狀態。');
    if(!alive||current!==sequence||threadRef.current!==threadId)return;
    snapshotRef.current=body;setSnapshot(body);callbacks.current.onState?.(body);setLocalError('');
    const selected=body.pages?.find(item=>item.id===pageRef.current)||body.pages?.find(item=>item.id===activePage.current)||body.pages?.find(item=>item.id===body.selectedPageId);
    if(selected){activePage.current=selected.id;syncUrl(selected.url||'');}
    else if(body.url)syncUrl(body.url);
   }catch(error){if(!alive||current!==sequence)return;setLocalError(error?.message||'瀏覽器狀態讀取失敗。');}
  };
  const loop=async()=>{await refresh();if(alive)timer=setTimeout(loop,1000);};
  loop();return()=>{alive=false;sequence++;clearTimeout(timer);hide(threadId);};
 },[viewVisible,enabled,threadId,hide]);

 useEffect(()=>{
  if(!canUse||!viewVisible||!enabled||!threadId||!snapshot||snapshot.external)return;
  let alive=true,raf=0;
  const schedule=()=>{if(alive&&!raf)raf=requestAnimationFrame(present);};
  const present=()=>{
   raf=0;if(!alive)return;
   const element=viewportRef.current;
   if(element){
    const r=element.getBoundingClientRect();
    const rect={x:r.left,y:r.top,width:r.width,height:r.height};
    if(rect.width>0&&rect.height>0){
     const key=[rect.x,rect.y,rect.width,rect.height,currentPageId||''].map(n=>typeof n==='number'?Math.round(n*2)/2:n).join(':');
     if(key!==lastRect.current){
      lastRect.current=key;const epoch=presentGeneration.current;
      presentChain.current=presentChain.current.catch(()=>{}).then(async()=>{
       if(!alive||epoch!==presentGeneration.current||threadRef.current!==threadId)return;
       await window.kBrowser.present({threadId,pageId:currentPageId,rect,viewId:viewId.current});
       if(!alive||epoch!==presentGeneration.current||threadRef.current!==threadId){await window.kBrowser?.hide?.({threadId,viewId:viewId.current});return;}
       setLocalError(current=>current==='無法顯示原生瀏覽器。'?'':current);
      }).catch(error=>{if(alive&&threadRef.current===threadId)setLocalError(error?.message||'無法顯示原生瀏覽器。');});
     }
    }
   }
   schedule();
  };
  const observer=viewportRef.current&&typeof ResizeObserver!=='undefined'?new ResizeObserver(schedule):null;
  if(viewportRef.current)observer?.observe(viewportRef.current);
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);schedule();
  return()=>{alive=false;cancelAnimationFrame(raf);observer?.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);hide(threadId);};
 },[canUse,viewVisible,enabled,threadId,currentPageId,hide,!!snapshot,snapshot?.external]);

 const perform=useCallback(async(payload,{takeover=true}={})=>{
  const expectedThread=threadRef.current,epoch=generation.current;
  if(!expectedThread||!enabled||actionBusy.current)return null;
  const actionPageId=activePage.current;
  actionBusy.current=true;setBusy(true);setLocalError('');
  const post=async action=>{
   const response=await fetch('/api/browser/action',{method:'POST',headers:{...requestHeaders,'Content-Type':'application/json'},body:JSON.stringify({threadId:expectedThread,...(activePage.current?{pageId:activePage.current}:{}),...action})});
   const body=await response.json();if(!response.ok)throw new Error(body.error||'瀏覽器操作未完成。');return body;
  };
  try{
   let body=snapshotRef.current;
   if(takeover&&body?.mode!=='human')body=await post({type:'takeover'});
   if(payload)body=await post(payload);
   if(threadRef.current!==expectedThread||generation.current!==epoch)return null;
   if(body){snapshotRef.current=body;setSnapshot(body);callbacks.current.onState?.(body);const selected=body.pages?.find(item=>item.id===body.selectedPageId);if(selected){activePage.current=selected.id;if(payload?.type==='navigate')urlDirty.current=false;syncUrl(selected.url||'');}}
   if(payload?.type==='newPage'&&body?.selectedPageId){const selected=body.pages?.find(item=>item.id===body.selectedPageId);activePage.current=body.selectedPageId;callbacks.current.onPageCreated?.({pageId:body.selectedPageId,title:selected?.title,url:selected?.url});}
   if(payload?.type==='closePage')callbacks.current.onPageClosed?.(actionPageId);
   return body;
  }catch(error){if(threadRef.current===expectedThread&&generation.current===epoch)setLocalError(error?.message||'瀏覽器操作未完成。');return null;}
  finally{if(threadRef.current===expectedThread&&generation.current===epoch){actionBusy.current=false;setBusy(false);}}
 },[enabled,syncUrl]);

 // An unqualified browser panel is a request for the selected page. Create the
 // initial native blank page automatically rather than leaving a dead viewport.
 const initializedFor=useRef('');
 useEffect(()=>{
  if(!viewVisible||!enabled||!threadId||pageId||!snapshot||snapshot.external)return;
  const key=`${threadId}:${generation.current}`;
  if(initializedFor.current===key||snapshot.available||snapshot.pages?.length)return;
  initializedFor.current=key;perform(null);
 },[viewVisible,enabled,threadId,pageId,snapshot,perform]);

 useEffect(()=>{
  if(newPageRequest===lastNewPageRequest.current)return;
  lastNewPageRequest.current=newPageRequest;
  if(viewVisible&&enabled&&threadId&&!snapshot?.external)perform({type:'newPage'});
 },[newPageRequest,viewVisible,enabled,threadId,perform]);

 const navigate=event=>{event.preventDefault();const value=url.trim();if(value)perform({type:'navigate',url:/^https?:\/\//i.test(value)?value:`https://${value}`});};
 const viewportLabel=!available?'瀏覽器頁面尚未連線':human?'原生瀏覽器頁面，可直接操作':'原生瀏覽器頁面，由 AI 操作中';
 if(snapshot?.external)return <section className="browser-panel-content browser-native-panel" aria-label="K 瀏覽器助手">
  <div className="browser-empty"><strong>K 瀏覽器助手</strong><p>網頁在外部 Chrome 視窗中操作，不在此重複顯示。</p>
   <p>{snapshot.browserMode==='incognito'?'無痕視窗':snapshot.browserMode==='regular'?'一般視窗':'請交代 AI 使用一般或無痕視窗。'}</p>
   {isBusy&&<p>AI 正在操作 Chrome。</p>}
   {snapshot.error&&<p role="status">{snapshot.error}</p>}{localError&&<p role="alert">{localError}</p>}
  </div></section>;
 const body=<>
  <div className="browser-toolbar"><span className={`browser-mode ${human?'human':'ai'}`}>{human?'由你操作':'由 AI 操作'}</span><button type="button" onClick={()=>setExpanded(value=>!value)} aria-label={expanded?'縮小瀏覽器面板':'展開瀏覽器面板'} title={expanded?'縮小':'展開'}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button></div>
  <form className="browser-navigate browser-native-navigate" onSubmit={navigate}>
   <button type="button" aria-label="上一頁" title="上一頁" disabled={!currentPage?.canGoBack||isBusy} onClick={()=>perform({type:'back'})}><ArrowLeft size={17}/></button>
   <button type="button" aria-label="下一頁" title="下一頁" disabled={!currentPage?.canGoForward||isBusy} onClick={()=>perform({type:'forward'})}><ArrowRight size={17}/></button>
   <button type="button" aria-label="重新載入頁面" title="重新載入頁面" disabled={!available||isBusy} onClick={()=>perform({type:'reload'})}><RotateCw size={17}/></button>
   <input ref={urlInputRef} aria-label="瀏覽器網址" value={url} onChange={event=>{urlDirty.current=true;setUrl(event.target.value);}} placeholder="輸入網址" autoComplete="off" disabled={!enabled||!available||isBusy}/>
   <button type="submit" aria-label="前往網址" title="前往網址" disabled={!enabled||isBusy||!url.trim()}><ArrowUp size={17}/></button>
   <button type="button" aria-label="新增網頁" title="新增網頁" disabled={!enabled||isBusy} onClick={()=>perform({type:'newPage'})}><Plus size={17}/></button>
   {currentPageId&&<button type="button" aria-label="關閉此網頁" title="關閉此網頁" disabled={!human||isBusy} onClick={()=>perform({type:'closePage'},{takeover:false})}><X size={17}/></button>}
   <button type="button" aria-label="下載清單" title="下載清單" aria-expanded={downloadsOpen} onClick={()=>setDownloadsOpen(value=>!value)}><Download size={17}/>{snapshot?.downloads?.length>0&&<small>{snapshot.downloads.length}</small>}</button>
  </form>
  {downloadsOpen&&<section className="browser-downloads browser-native-downloads" aria-label="下載清單"><strong>下載</strong>{!snapshot?.downloads?.length?<p>尚無下載檔案。</p>:<><p>檔案保存在此對話專屬的 downloads 資料夾，不會自動開啟。儲存副本上限 64 MiB；副本不保證保留 Windows 網路來源標記，請勿略過安全檢查。</p><ul>{snapshot.downloads.map(item=><li key={item.id}><span>{item.name}</span>{item.sourceUrl&&<small className="browser-download-source">來源：{item.sourceUrl}</small>}{item.dangerous&&<strong className="browser-download-warning">此類檔案可能執行程式，開啟前請確認來源。</strong>}<small>{item.status==='completed'?'已完成':item.status==='failed'?'下載失敗':'下載中…'}</small>{item.error&&<small>{item.error}</small>}{item.status==='completed'&&item.copyAvailable===false&&<small>檔案超過副本大小上限（64 MiB）。</small>}{item.status==='completed'&&item.copyAvailable!==false&&<a href={`/api/browser/download?threadId=${encodeURIComponent(threadId)}&id=${encodeURIComponent(item.id)}`} download={item.name} onClick={event=>{if(item.dangerous&&!window.confirm('這個檔案可能執行程式，且另存副本不保證保留 Windows 網路來源標記。確認要下載副本嗎？'))event.preventDefault();}}>儲存副本</a>}</li>)}</ul></>}</section>}
  <div ref={viewportRef} className="native-browser-viewport" data-native-browser-viewport="" role="region" aria-label={viewportLabel}>
   {!available&&<div className="browser-empty"><strong>{snapshot?.error?'瀏覽器目前不可用':'正在連線到瀏覽器…'}</strong><p>{snapshot?.error||localError||'連線建立後會在此顯示可直接操作的網頁。'}</p></div>}
  </div>
  {isBusy&&<p className="browser-status" role="status">正在完成上一個瀏覽器操作。</p>}
  {snapshot?.error&&<p className="browser-status" role="status">{snapshot.error}</p>}
  {localError&&<p className="browser-error" role="alert">{localError}</p>}
  {human&&<button type="button" className="browser-release" disabled={isBusy} onClick={()=>perform({type:'release'},{takeover:false})}>交回 AI</button>}
 </>;
 return <div className={`browser-panel-content browser-native-panel ${expanded?'browser-expanded':''}`}>
  {expanded&&<div className="browser-expanded-head"><strong>瀏覽器</strong><button type="button" onClick={()=>setExpanded(false)} aria-label="關閉展開檢視">關閉</button></div>}
  {!enabled?<div className="browser-empty"><strong>瀏覽器尚未啟用</strong><p>此工作目前沒有可顯示的瀏覽器連線。</p></div>:!threadId?<div className="browser-empty"><strong>請先開啟對話</strong><p>瀏覽器畫面會依目前工作連線顯示。</p></div>:body}
 </div>;
}
