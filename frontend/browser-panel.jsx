import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Maximize2,Minimize2,MousePointer2,ArrowUp,ArrowDown,ArrowLeft,ArrowRight,RotateCw,Download} from 'lucide-react';
import './browser-panel.css';
import {browserFramePoint} from './browser-frame.mjs';
import {NativeBrowserPanel} from './native-browser-panel.jsx';

function LegacyBrowserPanel({threadId,enabled=false,visible=true,pageId=null,onPageCreated,onPageClosed,onState,newPageRequest=0}){
 const [downloadsOpen,setDownloadsOpen]=useState(false),[snapshot,setSnapshot]=useState(null),[frame,setFrame]=useState(''),[input,setInput]=useState(''),[expanded,setExpanded]=useState(false),[localError,setLocalError]=useState(''),[sending,setSending]=useState(false);
 const frameUrl=useRef(''),imageRef=useRef(null),inputRef=useRef(null),sequence=useRef(0),threadGeneration=useRef(0),threadRef=useRef(threadId),sendingRef=useRef(false);
 const lastNewPageRequest=useRef(newPageRequest);
 const clearFrame=useCallback(()=>{if(frameUrl.current)URL.revokeObjectURL(frameUrl.current);frameUrl.current='';setFrame('');},[]);
 useEffect(()=>()=>{if(frameUrl.current)URL.revokeObjectURL(frameUrl.current);},[]);
 useEffect(()=>{threadRef.current=threadId;threadGeneration.current++;sendingRef.current=false;setSending(false);setSnapshot(null);setLocalError('');setInput('');clearFrame();},[threadId,pageId,clearFrame]);
 useEffect(()=>{if(!visible){setInput('');setExpanded(false);}},[visible]);
 useEffect(()=>{
  if(!visible||!enabled||!threadId)return;
  let active=true;
  const refresh=async()=>{
   const id=++sequence.current;
   try{
    const response=await fetch(`/api/browser/state?threadId=${encodeURIComponent(threadId)}`,{headers:{'X-K-Request':'1'}});
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||'無法讀取瀏覽器狀態。');
    if(!active||id!==sequence.current)return;
    setSnapshot(body);onState?.(body);setLocalError('');
    if(!body.available){clearFrame();return;}
    const pageParam=pageId?`&pageId=${encodeURIComponent(pageId)}`:'';
    const image=await fetch(`/api/browser/frame?threadId=${encodeURIComponent(threadId)}${pageParam}`,{headers:{'X-K-Request':'1'}});
    if(!image.ok)throw new Error((await image.json().catch(()=>({}))).error||'目前無法更新瀏覽器畫面。');
    const type=image.headers.get('content-type')||'';
    if(!type.toLowerCase().includes('image/jpeg'))throw new Error('瀏覽器畫面格式無法辨識。');
    const url=URL.createObjectURL(await image.blob());
    if(!active||id!==sequence.current){URL.revokeObjectURL(url);return;}
    if(frameUrl.current)URL.revokeObjectURL(frameUrl.current);
    frameUrl.current=url;setFrame(url);
   }catch(error){if(!active||id!==sequence.current)return;clearFrame();setLocalError(error.message||'瀏覽器連線發生問題。');}
  };
  let timer;
  const loop=async()=>{await refresh();if(active)timer=setTimeout(loop,1000);};
  loop();return()=>{active=false;clearTimeout(timer);sequence.current++;clearFrame();};
 },[visible,enabled,threadId,pageId,clearFrame]);
 useEffect(()=>{if(!expanded)return;const onKey=event=>{if(event.key==='Escape'){event.preventDefault();setExpanded(false);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[expanded]);

 const send=async payload=>{
  if(!threadId||!enabled||sendingRef.current)return false;
  sendingRef.current=true;setSending(true);
  if(payload.type==='release')setInput('');
  const expectedThread=threadId,generation=threadGeneration.current;
  setLocalError('');
  try{
   const response=await fetch('/api/browser/action',{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify({threadId,...(pageId?{pageId}:{}),...payload})});
   const body=await response.json();if(threadRef.current!==expectedThread||threadGeneration.current!==generation)return false;if(!response.ok)throw new Error(body.error||'瀏覽器操作未完成。');
   setSnapshot(body);onState?.(body);
   if(payload.type==='newPage'&&body.selectedPageId)onPageCreated?.({pageId:body.selectedPageId,title:body.pages?.find(page=>page.id===body.selectedPageId)?.title,url:body.pages?.find(page=>page.id===body.selectedPageId)?.url});
   if(payload.type==='closePage')onPageClosed?.(pageId);
   return true;
  }catch(error){if(threadRef.current!==expectedThread||threadGeneration.current!==generation)return false;setLocalError(error.message||'瀏覽器操作未完成。');return false;}
  finally{if(threadRef.current===expectedThread&&threadGeneration.current===generation){sendingRef.current=false;setSending(false);}}
 };
 useEffect(()=>{if(newPageRequest===lastNewPageRequest.current)return;lastNewPageRequest.current=newPageRequest;if(!visible)return;if(!human||busy){setLocalError('請先接手瀏覽器，並等目前操作完成，再新增網頁。');return;}send({type:'newPage'});},[newPageRequest,visible]);
 const busy=snapshot?.busy===true||sending,available=snapshot?.available===true,human=snapshot?.mode==='human',pages=Array.isArray(snapshot?.pages)?snapshot.pages:[];
 const currentPage=pages.find(page=>page.id===pageId)??pages.find(page=>page.id===snapshot?.selectedPageId),currentUrl=currentPage?.url??snapshot?.url??'';
 const clickFrame=event=>{
  if(!human||busy||!available)return;
  const rect=event.currentTarget.getBoundingClientRect();
  const point=browserFramePoint({rect,width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight,clientX:event.clientX,clientY:event.clientY});
  if(point)send({type:'click',...point});
 };
 const sendText=async event=>{event.preventDefault();const value=input;if(!value)return;const sent=await send({type:'text',text:value});if(sent)setInput(current=>current===value?'':current);};
 const key=key=>send({type:'key',key});
 const scroll=deltaY=>send({type:'scroll',deltaY});
 const body=<>
  {snapshot?.testOnly!==false?<p className="browser-error" role="note">瀏覽器驗證階段：目前只用假資料，尚未開放真實網站登入。請勿輸入密碼、驗證碼或敏感資料。</p>:<p className="browser-status" role="note">這是 K 的獨立瀏覽器。登入或需要本人操作時，請先按「我來操作」；完成後再交回 AI。</p>}
  {!enabled?<div className="browser-empty"><MousePointer2 size={22}/><strong>瀏覽器尚未啟用</strong><p>此工作目前沒有可顯示的瀏覽器連線。</p></div>:!threadId?<div className="browser-empty"><MousePointer2 size={22}/><strong>請先開啟對話</strong><p>瀏覽器畫面會依目前工作連線顯示。</p></div>:<>
   <div className="browser-toolbar"><span className={`browser-mode ${human?'human':'ai'}`}>{human?'由你操作':'由 AI 操作'}</span><button type="button" onClick={()=>setExpanded(value=>!value)} aria-label={expanded?'縮小瀏覽器面板':'展開瀏覽器面板'} title={expanded?'縮小':'展開'}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button></div>
   <form className="browser-navigate" onSubmit={event=>{event.preventDefault();const url=event.currentTarget.elements.url.value.trim();if(url)send({type:'navigate',url});}}>
    <button type="button" aria-label="上一頁" title="上一頁" disabled={!human||busy||!currentPage?.canGoBack} onClick={()=>send({type:'back'})}><ArrowLeft size={17}/></button>
    <button type="button" aria-label="下一頁" title="下一頁" disabled={!human||busy||!currentPage?.canGoForward} onClick={()=>send({type:'forward'})}><ArrowRight size={17}/></button>
    <button type="button" aria-label="重新載入頁面" title="重新載入頁面" disabled={!human||busy||!available} onClick={()=>send({type:'reload'})}><RotateCw size={17}/></button>
    <input key={`${threadId}-${pageId||'selected'}-${currentUrl}`} name="url" aria-label="瀏覽器網址" defaultValue={currentUrl} placeholder="輸入網址" autoComplete="off" disabled={!human||busy}/>
    <button type="submit" aria-label="前往網址" title="前往網址" disabled={!human||busy}><ArrowUp size={17}/></button>
    <button type="button" aria-label="下載清單" title="下載清單" aria-expanded={downloadsOpen} onClick={()=>setDownloadsOpen(value=>!value)}><Download size={17}/>{snapshot?.downloads?.length>0&&<small>{snapshot.downloads.length}</small>}</button>
   </form>
   {downloadsOpen&&<section className="browser-downloads" aria-label="下載清單"><strong>下載</strong>{!snapshot?.downloads?.length?<p>尚無下載檔案。</p>:<><p>檔案保存在此對話專屬的 downloads 資料夾，不會自動開啟。儲存副本上限 64 MiB；副本不保證保留 Windows 網路來源標記，請勿略過安全檢查。</p><ul>{snapshot.downloads.map(item=><li key={item.id}><span>{item.name}</span>{item.sourceUrl&&<small className="browser-download-source">來源：{item.sourceUrl}</small>}{item.dangerous&&<strong className="browser-download-warning">此類檔案可能執行程式，開啟前請確認來源。</strong>}<small>{item.status==='completed'?'已完成':item.status==='failed'?'下載失敗':'下載中…'}</small>{item.error&&<small>{item.error}</small>}{item.status==='completed'&&item.copyAvailable===false&&<small>檔案超過副本大小上限（64 MiB）。</small>}{item.status==='completed'&&item.copyAvailable!==false&&<a href={`/api/browser/download?threadId=${encodeURIComponent(threadId)}&id=${encodeURIComponent(item.id)}`} download={item.name} onClick={event=>{if(item.dangerous&&!window.confirm("這個檔案可能執行程式，且另存副本不保證保留 Windows 網路來源標記。確認要下載副本嗎？"))event.preventDefault();}}>儲存副本</a>}</li>)}</ul></>}</section>}

   {pageId&&<button type="button" className="browser-close-page" disabled={!human||busy} title="關閉此網頁會結束目前網頁；關閉右側分頁只會關閉檢視。" onClick={()=>send({type:'closePage'})}>關閉此網頁</button>}
   {busy&&<p className="browser-status" role="status">正在完成上一個瀏覽器操作；完成前無法切換操作權。</p>}
   {snapshot?.error&&<p className="browser-status" role="status">{snapshot.error}</p>}
   {localError&&<p className="browser-error" role="alert">{localError}</p>}
   {available&&frame?<div className={`browser-frame-wrap ${human&&!busy?'can-operate':''}`}><div className="browser-frame-stage"><img ref={imageRef} className="browser-frame" src={frame} alt="目前瀏覽器頁面快照；每秒更新一次" tabIndex={0} onClick={clickFrame} onKeyDown={event=>{if(!human||busy)return;if(['Enter','Tab','Backspace','Escape'].includes(event.key)){event.preventDefault();send({type:'key',key:event.key});}}}/></div><small>此為每秒更新的頁面快照，非即時影片。</small></div>:<div className="browser-empty"><MousePointer2 size={22}/><strong>{snapshot?.available===false?(snapshot?.error?'瀏覽器目前不可用':'瀏覽器尚未開啟'):'正在連線到瀏覽器…'}</strong><p>{snapshot?.available===false?(snapshot?.error||'可選擇「開啟並接手」開始操作。'):'取得頁面狀態中。'}</p></div>}
   {(available||(enabled&&threadId&&snapshot&&!snapshot.error))&&<div className="browser-controls">
    <div className="browser-takeover"><button type="button" disabled={!enabled||!threadId||human||sending||!!snapshot?.error} onClick={()=>send({type:'takeover'})}>{available?'我來操作':'開啟並接手'}</button><button type="button" disabled={!human||busy} onClick={()=>send({type:'release'})}>交回 AI</button>{pages.length>0&&<button type="button" disabled={!human||busy} onClick={()=>send({type:'newPage'})}>新增網頁</button>}</div>
    {human&&<><form className="browser-text-form" onSubmit={sendText}><input ref={inputRef} aria-label="輸入文字到目前網頁欄位" autoComplete="off" spellCheck={false} value={input} onChange={event=>setInput(event.target.value)} placeholder="輸入文字到目前焦點欄位"/><button type="submit" disabled={!input||busy}>送出文字</button></form><div className="browser-key-controls" aria-label="瀏覽器按鍵"><span>按鍵</span>{['Enter','Tab','Backspace','Escape'].map(value=><button type="button" key={value} disabled={busy} onClick={()=>key(value)}>{value}</button>)}</div><div className="browser-scroll-controls"><span>捲動</span><button type="button" aria-label="向上捲動" disabled={busy} onClick={()=>scroll(-480)}><ArrowUp size={15}/></button><button type="button" aria-label="向下捲動" disabled={busy} onClick={()=>scroll(480)}><ArrowDown size={15}/></button></div><p className="browser-privacy-note">輸入內容會進入網頁，並可能出現在畫面、網站儲存或模型工具回應中。{snapshot?.testOnly!==false?'僅使用假資料；':'請勿把密碼貼到聊天中；'}此介面不會呼叫原生密碼管理器。</p></>}
   </div>}
  </>}
 </>;
 return <div className={`browser-panel-content ${expanded?'browser-expanded':''}`}>
  {expanded&&<div className="browser-expanded-head"><strong>瀏覽器</strong><button type="button" onClick={()=>setExpanded(false)} aria-label="關閉展開檢視">關閉</button></div>}
  {body}
 </div>;
}

export function BrowserPanel(props){
 const nativeAvailable=typeof window!=='undefined'&&typeof window.kBrowser?.present==='function';
 return nativeAvailable?<NativeBrowserPanel {...props}/>:<LegacyBrowserPanel {...props}/>;
}
