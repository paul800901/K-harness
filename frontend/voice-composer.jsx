import React,{useEffect,useRef,useState} from 'react';
import {WebSpeechDictationAdapter} from '@assistant-ui/react';
import {createDictationSession} from './dictation-session.mjs';
import {createNativeDictationSession} from './native-dictation.mjs';

// Only stopped, in-flight main-composer transcripts outlive their room's view.
// Audio stays in the existing request; this is not a retry or a recording queue.
const backgroundTranscriptions=new Map(),backgroundNotices=new Map();
function cancelBackgroundTranscriptions(){
 for(const [key,entry] of backgroundTranscriptions){
  if(entry.view)entry.view.cancel();
  else{backgroundTranscriptions.delete(key);entry.session.cancel();backgroundNotices.set(key,'已取消這段聽寫，原草稿保留。');}
 }
}

// Capture stays in memory. Native audio is sent only to K's local transcription endpoint.
function paintWaveform(canvas,levels){
 if(!canvas)return;
 const width=canvas.clientWidth,height=32,ratio=window.devicePixelRatio||1;
 if(!width)return;
 canvas.width=width*ratio;canvas.height=height*ratio;
 const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle=getComputedStyle(canvas).color;
 levels.forEach((level,i)=>{const h=Math.max(2,level*height);ctx.fillRect(i*width/levels.length,(height-h)/2,2,h);});
}

export function useVoiceComposer({onResult,onBackgroundResult,disabled,onActiveChange=()=>{},sessionKey}){
 const [phase,setPhaseState]=useState('idle'),[notice,setNotice]=useState(''),[consent,setConsent]=useState(false);
 const canvas=useRef(null),job=useRef(null),callback=useRef(onResult),activity=useRef(onActiveChange),scope=useRef(sessionKey);callback.current=onResult;activity.current=onActiveChange;scope.current=sessionKey;
 const remote=typeof document!=='undefined'&&document.documentElement.dataset.kRemote==='true';
 const desktop=typeof window!=='undefined'&&typeof window.kBrowser?.onWindowHidden==='function';
 const native=desktop||remote; // Both capture this device and use the computer's local recognizer, never Web Speech.
 const consentKey='k-browser-dictation-consent';
 const setPhase=next=>{setPhaseState(next);activity.current?.(next!=='idle');};
 const release=entry=>{cancelAnimationFrame(entry.frame);entry.stream?.getTracks().forEach(track=>track.stop());entry.context?.close().catch(()=>{});entry.stream=null;entry.context=null;};
 const cancel=()=>{const entry=job.current;if(!entry)return;job.current=null;entry.view=null;if(backgroundTranscriptions.get(entry.scope)===entry)backgroundTranscriptions.delete(entry.scope);entry.session?.cancel();release(entry);setPhase('idle');setNotice('已取消這段聽寫，原草稿保留。');};
 const attach=entry=>{entry.view={cancel,
  state:next=>{if(job.current===entry&&entry.scope===scope.current)setPhase(next);},
  notice:message=>{entry.notice=message;if(job.current===entry&&entry.scope===scope.current)setNotice(message);},
  finish:(result,error)=>{
   if(job.current!==entry||entry.scope!==scope.current)return false;
   job.current=null;setPhase('idle');
   if(error)setNotice(`${error} 未送出；原草稿保留。`);
   else if(!result.text.trim())setNotice('沒有辨識到文字，未送出訊息。');
   else{callback.current(remote||entry.wasDetached?{...result,send:false}:result);if(entry.hitLimit)setNotice('已達 5 分鐘上限；辨識已完成。');}
   return true;
  },
 };};
 const finishNative=(entry,result,error)=>{
  if(backgroundTranscriptions.get(entry.scope)===entry)backgroundTranscriptions.delete(entry.scope);
  const view=entry.view;entry.view=null;release(entry);
  if(view?.finish(result,error))return;
  if(!entry.backgroundResult)return;
  if(error)backgroundNotices.set(entry.scope,`${error} 未送出；原草稿保留。`);
  else if(!result.text.trim())backgroundNotices.set(entry.scope,'沒有辨識到文字，未送出訊息。');
  else entry.backgroundResult({...result,send:false});
 };
 const cancelRef=useRef(cancel);cancelRef.current=cancel;
 useEffect(()=>{
  if(!desktop)return;
  return window.kBrowser.onWindowHidden(()=>{cancelBackgroundTranscriptions();cancelRef.current();});
 },[desktop]);
 useEffect(()=>{
  if(!remote)return;
  const hidden=()=>{if(document.hidden){cancelBackgroundTranscriptions();cancelRef.current();}};
  document.addEventListener('visibilitychange',hidden);
  return()=>document.removeEventListener('visibilitychange',hidden);
 },[remote]);
 useEffect(()=>{
  const pending=onBackgroundResult?backgroundTranscriptions.get(sessionKey):null;
  if(pending){job.current=pending;attach(pending);setPhase(pending.session.getState());setNotice(pending.notice??'轉錄完成後會留在此聊天室草稿，不會自動送出。');}
  if(onBackgroundResult&&backgroundNotices.has(sessionKey)){setNotice(backgroundNotices.get(sessionKey));backgroundNotices.delete(sessionKey);}
  return()=>{
   const entry=job.current;job.current=null;
   if(entry){
    entry.view=null;
    if(entry.backgroundResult&&entry.session?.getState()==='transcribing'){
     entry.wasDetached=true;backgroundTranscriptions.set(entry.scope,entry);
    }else{entry.session?.cancel();release(entry);}
   }
   activity.current?.(false);
  };
 },[sessionKey]);
 const start=async()=>{
  if(disabled||job.current)return;
  if(!native&&sessionStorage.getItem(consentKey)!=='yes'){
   setConsent(true);activity.current?.(false);return;
  }
  if(native){
   if(typeof navigator==='undefined'||typeof navigator.mediaDevices?.getUserMedia!=='function'){
    setNotice('目前無法存取此裝置的麥克風；原草稿保留。');activity.current?.(false);return;
   }
   const entry={scope:scope.current,levels:Array(70).fill(0),backgroundResult:onBackgroundResult};job.current=entry;attach(entry);setPhase('starting');setNotice('');
   const current=()=>job.current===entry&&entry.scope===scope.current;
   entry.session=createNativeDictationSession({
     ...(remote?{createAudioContext:()=>new AudioContext()}:{ }),
    requestTranscription:async(audioBase64,signal)=>{
     const response=await fetch('/api/dictation/transcribe',{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1',...(remote?{'X-K-Command':crypto.randomUUID()}:{})},body:JSON.stringify({audioBase64}),signal});
     const payload=await response.json();
     if(!response.ok)throw new Error(payload?.error||'本機語音辨識失敗。');
     return payload;
    },
    onState:state=>entry.view?.state(state),
    onLevel:level=>{if(current()){entry.levels.shift();entry.levels.push(Math.min(1,level*5));}},
    onLimit:()=>{entry.hitLimit=true;entry.view?.notice('已達 5 分鐘上限，正在轉錄；完成後不會自動送出。');},
    onResult:result=>finishNative(entry,result),
    onError:message=>finishNative(entry,null,message),
   });
   void entry.session.start().then(()=>{
    const draw=()=>{if(job.current!==entry||entry.session.getState()!=='recording')return;paintWaveform(canvas.current,entry.levels);entry.frame=requestAnimationFrame(draw);};
    draw();
   });
   return;
  }
  if(!WebSpeechDictationAdapter.isSupported()||!navigator.mediaDevices?.getUserMedia){setNotice('目前瀏覽器不支援內建聽寫。請使用支援語音辨識的瀏覽器；仍可手動按 Win+H 輸入。');activity.current?.(false);return;}
  const entry={scope:scope.current};job.current=entry;setPhase('starting');setNotice('');
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   if(job.current!==entry){stream.getTracks().forEach(track=>track.stop());return;}
   entry.stream=stream;const context=new AudioContext();entry.context=context;await context.resume();
   if(job.current!==entry)return;
   const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(stream).connect(analyser);
   const data=new Uint8Array(analyser.fftSize),levels=Array(70).fill(0);
   const draw=()=>{
    if(job.current!==entry||!entry.stream)return;
    analyser.getByteTimeDomainData(data);const rms=Math.sqrt(data.reduce((sum,v)=>sum+((v-128)/128)**2,0)/data.length);
    levels.shift();levels.push(Math.min(1,rms*5));
    paintWaveform(canvas.current,levels);
    entry.frame=requestAnimationFrame(draw);
   };
   const finish=()=>{if(job.current!==entry)return false;const sameScope=entry.scope===scope.current;job.current=null;release(entry);setPhase('idle');return sameScope;};
   entry.session=createDictationSession({adapter:new WebSpeechDictationAdapter({language:'zh-TW',continuous:true,interimResults:true}),
    onState:state=>{if(job.current===entry&&entry.scope===scope.current){setPhase(state);if(state==='transcribing')release(entry);}},
    onResult:result=>{if(!finish())return;if(!result.text.trim()){setNotice('沒有辨識到文字，未送出訊息。');return;}callback.current(result);},
    onError:(message,text)=>{if(!finish())return;if(text?.trim())callback.current({text,send:false});setNotice(`${message} 未自動送出；原草稿保留。`);}
   });
   entry.session.start();draw();
  }catch{if(job.current===entry){job.current=null;entry.session?.cancel();release(entry);setPhase('idle');setNotice('無法啟動收音或辨識。請檢查麥克風權限、裝置與瀏覽器支援；原草稿保留。');}}
 };
 const stop=send=>job.current?.session?.stop(send);
 return {phase,notice,canvas,start,stop,cancel,consent,native,consentKey,canSendOnCompletion:!job.current?.wasDetached,decline:()=>setConsent(false),accept:()=>{sessionStorage.setItem(consentKey,'yes');setConsent(false);void start();},active:phase!=='idle'};
}

export function VoiceWaveform({voice}){
 return <div className="voice-waveform" role="status" aria-live="polite">
  {voice.phase==='recording'?<><canvas ref={voice.canvas} aria-hidden="true"/><span className="sr-only">正在聽寫</span></>:<span>{voice.phase==='starting'?'正在啟動麥克風…':'轉錄中…'}</span>}
 </div>;
}
