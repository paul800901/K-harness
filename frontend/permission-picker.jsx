import React,{useEffect,useLayoutEffect,useRef,useState,useId} from 'react';
import {Hand,ShieldCheck,ShieldAlert,LockKeyhole,Check,ChevronDown,ArrowLeft} from 'lucide-react';
import './permission-picker.css';

export const permissionModes={
 'workspace-write':{name:'要求核准',Icon:Hand,description:'工作區內可直接操作；額外檔案與網路存取先詢問你。',summary:'額外存取由你核准'},
 'auto-review':{name:'代我核准',Icon:ShieldCheck,description:'額外存取由 Codex 自動審查，不安全或不明確的要求可能遭拒。',summary:'額外存取由 Codex 自動審查'},
 'danger-full-access':{name:'完整存取權',Icon:ShieldAlert,description:'不受工作區沙箱限制，可存取電腦檔案與網路。',summary:'一般檔案與網路操作不再逐項核准'},
 'read-only':{name:'唯讀',Icon:LockKeyhole,description:'先以唯讀開始；寫入或其他額外存取仍需你核准。',summary:'寫入與額外存取由你核准'},
};

export function PermissionPicker({value,onChange,disabled=false,label='操作權限'}){
 const trigger=useRef(null),menu=useRef(null),id=useId();
 const [open,setOpen]=useState(false),[advanced,setAdvanced]=useState(value==='read-only'),[pending,setPending]=useState(null);
 const current=permissionModes[value]??permissionModes['workspace-write'];
 const position=()=>{
  if(!trigger.current||!menu.current)return;
  const rect=trigger.current.getBoundingClientRect(),scale=rect.width/trigger.current.offsetWidth||1;
  const popup=menu.current,viewportWidth=window.innerWidth/scale,viewportHeight=window.innerHeight/scale;
  popup.style.maxWidth=`${viewportWidth-16}px`;popup.style.maxHeight=`${viewportHeight-16}px`;
  const left=Math.max(8,Math.min(rect.left/scale,viewportWidth-popup.offsetWidth-8));
  const above=rect.top/scale-popup.offsetHeight-8,below=rect.bottom/scale+8;
  popup.style.left=`${left}px`;
  popup.style.top=`${Math.max(8,above>=8?above:Math.min(below,viewportHeight-popup.offsetHeight-8))}px`;
 };
 useLayoutEffect(()=>{if(open)position();},[open,pending,advanced]);
 useEffect(()=>{if(!open)return;window.addEventListener('resize',position);return()=>window.removeEventListener('resize',position);},[open]);
 useEffect(()=>{if(disabled&&menu.current?.matches(':popover-open'))menu.current.hidePopover();},[disabled]);
 const close=()=>{menu.current.hidePopover();trigger.current.focus();};
 const choose=(mode,confirmed=false)=>{
  if(mode!==value&&!confirmed&&['auto-review','danger-full-access'].includes(mode)){setPending(mode);return;}
  onChange(mode,confirmed);close();
 };
 const row=mode=>{const option=permissionModes[mode],Icon=option.Icon;return <button type="button" role="menuitemradio" aria-checked={value===mode} className={`permission-option ${mode==='danger-full-access'?'permission-danger':''}`} key={mode} onClick={()=>choose(mode)}><Icon size={19}/><span><strong>{option.name}</strong><small>{option.description}</small></span><Check className={value===mode?'':'permission-check-hidden'} size={17}/></button>;};
 const navigate=e=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||pending)return;
  const items=[...menu.current.querySelectorAll('[role="menuitemradio"]')],index=items.indexOf(document.activeElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;
  e.preventDefault();items[next]?.focus();
 };
 return <div className="permission-picker">
  <button ref={trigger} type="button" className={`permission-trigger ${value==='danger-full-access'?'permission-danger':''}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={()=>{menu.current.togglePopover();position();}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();menu.current.showPopover();position();queueMicrotask(()=>menu.current.querySelector('[role="menuitemradio"]')?.focus());}}}><current.Icon size={17}/><span>{current.name}</span><ChevronDown size={12}/></button>
  <div ref={menu} id={id} popover="auto" className="permission-popover" role={pending?'group':'menu'} aria-label={pending?'確認操作權限':'操作權限選單'} onKeyDown={navigate} onToggle={e=>{const shown=e.newState==='open';setOpen(shown);if(shown){setPending(null);setAdvanced(value==='read-only');}else setPending(null);}}>
   {pending?<div className="permission-confirm">
    <button className="permission-back" type="button" onClick={()=>setPending(null)}><ArrowLeft size={15}/>返回選單</button>
    <strong>{pending==='danger-full-access'?'啟用完整存取權？':'改由 Codex 代你核准？'}</strong>
    <p>{pending==='danger-full-access'?'此對話將不受工作區沙箱限制，一般檔案與網路操作不再逐項詢問你，可能影響工作區以外的檔案。':'主代理仍在沙箱內工作；需要額外存取時，由 Codex 自動審查並決定是否放行。自動審查仍可能判斷錯誤。'}</p>
    <p className="permission-confirm-note">僅套用到這個對話，建立或下一次送出時生效；不會變更其他對話或另外授權的工具範圍。</p>
    <div className="permission-confirm-actions"><button type="button" onClick={close}>取消</button><button type="button" className={pending==='danger-full-access'?'permission-enable-danger':'primary'} onClick={()=>choose(pending,true)}>確認選用</button></div>
   </div>:<>
    <div className="permission-menu-heading"><span>如何核准操作？</span><a href="https://learn.chatgpt.com/docs/permission-modes" target="_blank" rel="noreferrer">了解更多</a></div>
    {['workspace-write','auto-review','danger-full-access'].map(row)}
    <div className="permission-advanced"><button type="button" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}>進階選項<ChevronDown size={13}/></button>{advanced&&row('read-only')}</div>
   </>}
  </div>
 </div>;
}
