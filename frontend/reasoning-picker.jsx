import React,{useEffect,useLayoutEffect,useRef,useState,useId} from 'react';
import {ChevronDown,Zap} from 'lucide-react';
import './reasoning-picker.css';

export const effortName={none:'無',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'極高',max:'最高',ultra:'超高（Ultra）'};

// Codex-only: speed and reasoning are independent native settings.
export function ReasoningPicker({value,currentEffort,efforts=[],onChange,fastTier,serviceTier='default',effectiveServiceTier='default',busy=false,onTierChange,disabled=false,creating=false}){
 const trigger=useRef(null),popup=useRef(null),id=useId(),[open,setOpen]=useState(false);
 const accelerated=!!fastTier&&serviceTier===fastTier.id;
 const displayedFast=!!fastTier&&(busy?effectiveServiceTier:serviceTier)===fastTier.id;
 const unknown=effectiveServiceTier===null,pending=!unknown&&serviceTier!==effectiveServiceTier;
 const defaultLabel=`${creating?'模型預設':'沿用設定'}${currentEffort?`（${effortName[currentEffort]??currentEffort}）`:''}`;
 const label=value?(effortName[value]??value):defaultLabel;
 const position=()=>{
  if(!trigger.current||!popup.current)return;
  const rect=trigger.current.getBoundingClientRect(),scale=rect.width/trigger.current.offsetWidth||1,menu=popup.current;
  const width=window.innerWidth/scale,height=window.innerHeight/scale;
  menu.style.maxWidth=`${width-16}px`;menu.style.maxHeight=`${height-16}px`;
  menu.style.left=`${Math.max(8,Math.min(rect.left/scale,width-menu.offsetWidth-8))}px`;
  const above=rect.top/scale-menu.offsetHeight-8;
  menu.style.top=`${Math.max(8,above>=8?above:Math.min(rect.bottom/scale+8,height-menu.offsetHeight-8))}px`;
 };
 useLayoutEffect(()=>{if(open)position();},[open,fastTier]);
 useEffect(()=>{if(!open)return;window.addEventListener('resize',position);return()=>window.removeEventListener('resize',position);},[open]);
 useEffect(()=>{if(disabled&&popup.current?.matches(':popover-open'))popup.current.hidePopover();},[disabled]);
 const close=()=>{popup.current.hidePopover();trigger.current.focus();};
 return <div className="composer-effort reasoning-picker">
  <button ref={trigger} type="button" className="reasoning-trigger" aria-label="推理程度與速度" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id} disabled={disabled}>
   <span>{label}</span>{displayedFast&&<span className="reasoning-fast-label"><Zap size={13} aria-hidden="true"/>加速</span>}{(pending||unknown)&&<small className="reasoning-tier-pending">{unknown?'核心速度待確認':'下次送出套用'}</small>}<ChevronDown size={12} aria-hidden="true"/>
  </button>
  <div ref={popup} id={id} popover="auto" role="dialog" aria-label="推理程度與速度設定" className="reasoning-popover" onToggle={e=>setOpen(e.newState==='open')}>
   <label className="reasoning-effort-option"><span>推理程度</span><select aria-label={creating?'主代理推理程度':'推理程度'} value={value} disabled={disabled||(creating&&!efforts.length)} onChange={e=>{onChange(e.target.value);close();}}>
    <option value="">{defaultLabel}</option>
    {efforts.map(e=><option key={e} value={e}>{effortName[e]??e}</option>)}
   </select></label>
   {fastTier&&<div className="reasoning-speed-section">
    <label className="reasoning-speed-option"><span><Zap size={16} aria-hidden="true"/>原生加速</span><input type="checkbox" role="switch" aria-label="原生加速" checked={accelerated} disabled={disabled} onChange={e=>onTierChange(e.target.checked?fastTier.id:'default')}/></label>
    <p>會消耗更多額度。只套用此聊天室，不改變推理程度。{creating?'建立後從第一則訊息開始使用。':'下次送出訊息起套用，不更改執行中的工作。'}</p>
    {(pending||unknown)&&<p role="status">下次送出：{accelerated?'加速':'標準'}；目前核心：{unknown?'待確認':effectiveServiceTier===fastTier.id?'加速':'標準'}。</p>}
   </div>}
  </div>
 </div>;
}
