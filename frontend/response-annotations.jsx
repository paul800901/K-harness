import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Mic,Square,X} from 'lucide-react';
import {useVoiceComposer,VoiceWaveform} from './voice-composer.jsx';
import {insertAtSelection,insertTranscriptForQuote,responsePopoverPosition,responseQuoteCountLabel} from './response-annotations.mjs';
import './response-annotations.css';
import {useAnchoredPopover} from './anchored-popover.jsx';

export function ResponseQuotes({quotes,onChange,threadId,collapse=false,disabled=false,onVoiceActive,claimVoice,voiceOwner}){
 const menu=useAnchoredPopover({width:360}),expanded=menu.open;
 useEffect(()=>menu.close(false),[threadId]);
 useEffect(()=>{if(!quotes?.length||collapse)menu.close(false);},[quotes?.length,collapse]);
 if(!quotes?.length)return null;
 return <section className="response-quotes" aria-label="已加入的回覆註解">
  <button ref={menu.trigger} className="response-quotes-chip" type="button" aria-label={responseQuoteCountLabel(quotes.length)} aria-expanded={expanded} popoverTarget={menu.id}>
   {responseQuoteCountLabel(quotes.length)}
  </button>
  <div ref={menu.popup} id={menu.id} popover="auto" onToggle={menu.onToggle} className="response-quotes-list anchored-popover" role="region" aria-label="檢視與編輯註解">
   {expanded&&quotes.map((quote,index)=><QuoteDraft key={quote.id} quote={quote} index={index} total={quotes.length} onChange={onChange} threadId={threadId} disabled={disabled} onVoiceActive={onVoiceActive} claimVoice={claimVoice} voiceOwner={voiceOwner}/>) }
  </div>
 </section>;
}

export function ResponseSelectionPopover({selection,quote,threadId,onChange,onClose,onVoiceActive,claimVoice,voiceOwner,disabled=false}){
 const element=useRef(null),closeRef=useRef(onClose);closeRef.current=onClose;
 const [position,setPosition]=useState(null);
 useLayoutEffect(()=>{
  if(!selection)return;
  let frame=0;
  const place=()=>{
   frame=0;
   const range=selection.range;
   if(range&&!range.startContainer.isConnected){closeRef.current?.();return;}
   const anchor=range?.getBoundingClientRect?.()??selection.rect;
   const popup=element.current;
   if(!anchor||!popup)return;
   const next=responsePopoverPosition(anchor,{width:popup.offsetWidth||112,height:popup.offsetHeight||42},{width:window.innerWidth,height:window.innerHeight});
   setPosition(next);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};
  place();
  window.addEventListener('resize',schedule);
  window.addEventListener('scroll',schedule,true);
  window.visualViewport?.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('scroll',schedule);
  const observer=typeof ResizeObserver==='function'&&element.current?new ResizeObserver(schedule):null;
  observer?.observe(element.current);
  return()=>{if(frame)cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);observer?.disconnect();};
 },[selection?.mode,selection?.quoteId,selection?.range]);
 useEffect(()=>{
  if(!selection)return;
  const outside=event=>{if(!element.current?.contains(event.target))closeRef.current?.();};
  const escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeRef.current?.();}};
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('keydown',escape,true);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
 },[selection?.mode,selection?.quoteId]);
 if(!selection||typeof document==='undefined')return null;
 const style=position?{left:`${position.left}px`,top:`${position.top}px`}:{left:'-10000px',top:'-10000px'};
 return createPortal(<div ref={element} className="response-selection-popover" style={style} data-response-comment-popover="true">
  {quote&&<QuoteAnnotationEditor quote={quote} threadId={threadId} onChange={onChange} disabled={disabled} onVoiceActive={onVoiceActive} claimVoice={claimVoice} voiceOwner={voiceOwner} placeholder="新增選填留言…" autoFocus popover/>}
 </div>,document.body);
}

function QuoteDraft({quote,index,total,onChange,threadId,disabled,onVoiceActive,claimVoice,voiceOwner}){
 const update=patch=>onChange(quote.id,current=>current.map(item=>item.id===quote.id?{...item,...patch}:item));
 return <article className="response-quote-draft" data-response-quote-id={quote.id}>
  <div className="response-quote-draft-head"><strong>引用 {index+1}{total>1?`／${total}`:''}</strong><button type="button" aria-label={`移除第 ${index+1} 則註解`} title="移除這則註解" disabled={disabled} onClick={()=>onChange(quote.id,current=>current.filter(item=>item.id!==quote.id))}><X size={15}/></button></div>
  <blockquote>{quote.text}</blockquote>
  <QuoteAnnotationEditor quote={quote} threadId={threadId} onChange={onChange} disabled={disabled} onVoiceActive={onVoiceActive} claimVoice={claimVoice} voiceOwner={voiceOwner} placeholder="新增選填留言…"/>
 </article>;
}

function QuoteAnnotationEditor({quote,threadId,onChange,disabled,onVoiceActive,claimVoice,voiceOwner,placeholder,autoFocus=false,popover=false}){
 const textarea=useRef(null),selection=useRef({start:quote.annotation.length,end:quote.annotation.length}),[consent,setConsent]=useState(false),[busyNotice,setBusyNotice]=useState('');
 const voiceKey=`quote:${threadId}:${quote.id}`;
 const update=value=>onChange(quote.id,current=>current.map(item=>item.id===quote.id?{...item,annotation:value}:item));
 const voice=useVoiceComposer({disabled,sessionKey:threadId,onActiveChange:active=>onVoiceActive?.(voiceKey,active),onResult:({text})=>{
  const {start,end}=selection.current,inserted=insertAtSelection(quote.annotation??'',start,end,text);
  onChange(quote.id,current=>insertTranscriptForQuote(current,{threadId,activeThreadId:threadId,quoteId:quote.id,transcript:text,start,end}));
  requestAnimationFrame(()=>{if(textarea.current){textarea.current.focus();textarea.current.setSelectionRange(inserted.caret,inserted.caret);selection.current={start:inserted.caret,end:inserted.caret};}});
 }});
 const reserveVoice=()=>{
  if(voiceOwner&&voiceOwner!==voiceKey){setBusyNotice('另一段聽寫仍在進行，請先停止或完成。');return false;}
  if(claimVoice&&!claimVoice(voiceKey)){setBusyNotice('另一段聽寫仍在進行，請先停止或完成。');return false;}
  setBusyNotice('');return true;
 };
 const startVoice=()=>{if(!voice.native&&sessionStorage.getItem(voice.consentKey)!=='yes'){setConsent(true);return;}if(reserveVoice())void voice.start();};
 const acceptVoice=()=>{if(reserveVoice()){sessionStorage.setItem(voice.consentKey,'yes');setConsent(false);voice.accept();}};
 useEffect(()=>{if(autoFocus)textarea.current?.focus();},[autoFocus]);
 return <div className={`quote-annotation-editor${popover?' quote-annotation-editor-popover':''}`}>
  <textarea ref={textarea} aria-label={popover?'新增選填留言':`註解：${quote.text.slice(0,40)}`} value={quote.annotation} maxLength={12000} disabled={disabled} readOnly={voice.active} onChange={event=>update(event.currentTarget.value)} onSelect={event=>selection.current={start:event.currentTarget.selectionStart,end:event.currentTarget.selectionEnd}} onBlur={event=>selection.current={start:event.currentTarget.selectionStart,end:event.currentTarget.selectionEnd}} placeholder={placeholder}/>
  <div className="quote-voice-controls">
   {voice.active?<><button type="button" aria-label="取消此段聽寫" title="取消聽寫" onMouseDown={event=>event.preventDefault()} onClick={voice.cancel}><X size={15}/></button><VoiceWaveform voice={voice}/><button type="button" aria-label="停止並填入留言" title="停止並填入留言" disabled={voice.phase!=='recording'} onMouseDown={event=>event.preventDefault()} onClick={()=>voice.stop(false)}><Square size={14}/></button></>:<button type="button" data-quote-mic aria-label="聽寫到此段註解" title="聽寫到此段註解" disabled={disabled||(voiceOwner&&voiceOwner!==voiceKey)} onMouseDown={event=>event.preventDefault()} onClick={startVoice}><Mic size={15}/></button>}
   {(voice.notice||busyNotice)&&<span role="status">{voice.notice||busyNotice}</span>}
  </div>
  {consent&&<section className="quote-voice-consent" aria-label="啟用聽寫"><strong>啟用現有聽寫？</strong><p>沿用 K 現有聽寫功能，音訊處理方式依瀏覽器供應商而定；不會把聽寫音訊送給主代理模型。</p><div><button type="button" onClick={()=>setConsent(false)}>取消</button><button type="button" onClick={acceptVoice}>同意並開始聽寫</button></div></section>}
 </div>;
}
