import {useEffect,useState} from 'react';

// Read only the displayed chat, and only when its window is actually in front.
// The native signal distinguishes an unfocused Electron window from a focused
// WebContents that retains DOM focus while the user works in another app.
export function useCompletionAttention(state,{online,covered,api}){
 const [focused,setFocused]=useState(()=>window.kBrowser?.onWindowFocusChanged?false:document.hasFocus());
 useEffect(()=>{
  if(window.kBrowser?.onWindowFocusChanged)return window.kBrowser.onWindowFocusChanged(({focused})=>setFocused(focused===true));
  const update=()=>setFocused(document.hasFocus()&&document.visibilityState==='visible');
  window.addEventListener('focus',update);window.addEventListener('blur',update);document.addEventListener('visibilitychange',update);
  update();
  return()=>{window.removeEventListener('focus',update);window.removeEventListener('blur',update);document.removeEventListener('visibilitychange',update);};
 },[]);
 const completion=state.completionAttention?.unread?.find(item=>item.threadId===state.threadId);
 useEffect(()=>{
  if(!online||!focused||covered||!completion||['connecting','offline'].includes(state.status))return;
  // Send the generation that was rendered, never an unqualified clear-all.
  void api('attention/read',completion).catch(()=>{});
 },[online,focused,covered,state.status,completion?.threadId,completion?.sequence,api]);
}
