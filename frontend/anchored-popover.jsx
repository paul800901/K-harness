import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import './anchored-popover.css';

// Sidebar and panel menus must escape their scrolling/clipping ancestors.
// The browser owns dismissal/exclusivity; this hook only places the top layer.
export function useAnchoredPopover({width=205}={}){
 const trigger=useRef(null),popup=useRef(null),id=useId(),[open,setOpen]=useState(false);
 const close=useCallback((restoreFocus=true)=>{
  if(popup.current?.matches(':popover-open'))popup.current.hidePopover();else setOpen(false);
  if(restoreFocus)trigger.current?.focus({preventScroll:true});
 },[]);
 const position=useCallback(()=>{
  const button=trigger.current,menu=popup.current;
  if(!button||!menu?.matches(':popover-open'))return;
  const rect=button.getBoundingClientRect();
  const measuredScale=button.currentCSSZoom??(rect.width/button.offsetWidth);
  const scale=Number.isFinite(measuredScale)&&measuredScale>0?measuredScale:1;
  const viewport=window.visualViewport, left=(viewport?.offsetLeft??0)/scale,top=(viewport?.offsetTop??0)/scale;
  const right=left+(viewport?.width??window.innerWidth)/scale,bottom=top+(viewport?.height??window.innerHeight)/scale;
  menu.style.width=`${Math.max(0,Math.min(width,right-left-16))}px`;
  menu.style.maxHeight=`${Math.max(0,bottom-top-16)}px`;
  menu.style.left=`${Math.max(left+8,Math.min(rect.right/scale-menu.offsetWidth,right-menu.offsetWidth-8))}px`;
  const below=rect.bottom/scale+6,above=rect.top/scale-menu.offsetHeight-6;
  menu.style.top=`${Math.max(top+8,Math.min(below+menu.offsetHeight<=bottom-8?below:above,bottom-menu.offsetHeight-8))}px`;
 },[width]);
 useLayoutEffect(()=>{if(open)position();},[open,position]);
 useEffect(()=>{
  if(!open)return;
  const scroll=event=>{if(!popup.current?.contains(event.target))position();};
  const key=event=>{if(event.key==='Escape'&&popup.current?.matches(':popover-open')){event.preventDefault();event.stopPropagation();close();}};
  const focus=event=>{if(!popup.current?.contains(event.target)&&!trigger.current?.contains(event.target))close(false);};
  const observer=new ResizeObserver(position);observer.observe(popup.current);
  window.addEventListener('resize',position);document.addEventListener('scroll',scroll,true);
  window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
  document.addEventListener('keydown',key,true);document.addEventListener('focusin',focus);
  return()=>{observer.disconnect();window.removeEventListener('resize',position);document.removeEventListener('scroll',scroll,true);
   window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);
   document.removeEventListener('keydown',key,true);document.removeEventListener('focusin',focus);};
 },[open,position,close]);
 return {trigger,popup,id,open,close,onToggle:event=>setOpen(event.newState==='open')};
}
