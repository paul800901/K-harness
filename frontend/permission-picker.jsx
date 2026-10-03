import React,{useEffect,useLayoutEffect,useRef,useState,useId} from 'react';
import {Hand,ShieldCheck,ShieldAlert,LockKeyhole,Check,ChevronDown,ArrowLeft} from 'lucide-react';
import './permission-picker.css';

export const permissionModes={
 'workspace-write':{name:'要求核准',Icon:Hand,description:'工作區內可直接操作；其他操作依 Codex 原生規則核准。網路權限依執行環境。',summary:'額外存取由你核准'},
 'auto-review':{name:'代我核准',Icon:ShieldCheck,description:'額外存取由 Codex 自動審查，不安全或不明確的要求可能遭拒。',summary:'額外存取由 Codex 自動審查'},
 'danger-full-access':{name:'完整存取權',Icon:ShieldAlert,description:'略過 Codex 權限提示；K 的外部隔離限制仍保留。',summary:'一般檔案與網路操作不再逐項核准'},
 'read-only':{name:'唯讀',Icon:LockKeyhole,description:'先以唯讀開始；寫入或其他額外存取仍需你核准。',summary:'寫入與額外存取由你核准'},
};

export const claudePermissionModes={
 'claude-manual':{name:'手動核准',Icon:Hand,description:'依 Claude Code 原生規則，只在操作需要核准時詢問。',summary:'使用 Claude Code 原生預設核准流程'},
 'claude-acceptEdits':{name:'自動接受編輯',Icon:ShieldCheck,description:'自動接受檔案編輯；其他需要權限的操作仍依 Claude Code 規則詢問。',summary:'檔案編輯自動接受，其他權限依原生規則'},
 'claude-auto':{name:'自動判斷',Icon:ShieldCheck,description:'使用 Claude Code 原生 Auto 權限模式；由 Claude Code 自行依模式規則處理權限。',summary:'由 Claude Code 原生 Auto 模式處理權限'},
 'claude-bypassPermissions':{name:'略過權限提示',Icon:ShieldAlert,description:'Claude Code 原生 bypassPermissions 模式；略過權限提示，僅應在安全環境使用。',summary:'略過 Claude Code 權限提示'},
 'claude-dontAsk':{name:'僅限已允許（其餘自動拒絕）',Icon:LockKeyhole,description:'需要核准的操作直接拒絕；原本不需核准或已允許的操作仍可執行。',summary:'未預先允許的操作直接拒絕'},
 'claude-plan':{name:'計畫模式',Icon:LockKeyhole,description:'Claude Code 原生唯讀計畫模式；用於分析與規劃，不執行修改。',summary:'Claude Code 原生計畫／唯讀模式'},
};

export const geminiPermissionModes={
 'workspace-write':{name:'工作區編輯',Icon:Hand,description:'允許工作區內寫檔；命令與工作區外寫入直接拒絕，不會跳出核准。',summary:'僅允許工作區內寫檔'},
 'danger-full-access':{name:'完整存取權',Icon:ShieldAlert,description:'使用 Antigravity 原生略過權限提示模式。',summary:'略過 Antigravity 權限提示'},
 'read-only':{name:'唯讀',Icon:LockKeyhole,description:'寫檔與命令直接拒絕。',summary:'唯讀操作'},
};

export function PermissionPicker({value,onChange,disabled=false,label='操作權限',allowedModes=Object.keys(permissionModes),note,provider='codex',browserEnabled=false}){
 const trigger=useRef(null),menu=useRef(null),id=useId();
 const modes=provider==='claude'?claudePermissionModes:provider==='gemini'?geminiPermissionModes:permissionModes;
 allowedModes=allowedModes.filter(mode=>modes[mode]);
 const currentValue=provider==='claude'?(value==='workspace-write'?'claude-manual':value==='read-only'?'claude-plan':value):value;
 const [open,setOpen]=useState(false),[advanced,setAdvanced]=useState(value==='read-only'&&allowedModes.includes('read-only')),[pending,setPending]=useState(null);
 const current=modes[currentValue]??modes[provider==='claude'?'claude-manual':'workspace-write'];
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
  if(mode!==currentValue&&!confirmed&&(provider==='claude'?['claude-acceptEdits','claude-auto','claude-bypassPermissions'].includes(mode):['auto-review','danger-full-access'].includes(mode))){setPending(mode);return;}
  onChange(mode,confirmed);close();
 };
 const row=mode=>{const option=modes[mode],Icon=option.Icon;if(!option)return null;return <button type="button" role="menuitemradio" aria-checked={currentValue===mode} className={`permission-option ${mode==='danger-full-access'||mode==='claude-bypassPermissions'?'permission-danger':''}`} key={mode} onClick={()=>choose(mode)}><Icon size={19}/><span><strong>{option.name}</strong><small>{option.description}</small></span><Check className={currentValue===mode?'':'permission-check-hidden'} size={17}/></button>;};
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
    <strong>{provider==='claude'?({ 'claude-acceptEdits':'啟用自動接受編輯？','claude-auto':'切換至 Claude Code Auto 模式？','claude-bypassPermissions':'略過 Claude Code 權限提示？'}[pending]):pending==='danger-full-access'?'啟用完整存取權？':'改由 Codex 代你核准？'}</strong>
    <p>{provider==='claude'?({ 'claude-acceptEdits':'Claude Code 將自動接受檔案編輯；其他權限仍依 Claude Code 原生規則處理。','claude-auto':'將直接使用 Claude Code 原生 Auto 權限模式。此模式的行為由 Claude Code 決定，不是 K 的額外沙箱。','claude-bypassPermissions':'Claude Code 將略過權限提示。這可能允許高影響操作；請只在你信任的安全環境中使用。'}[pending]):provider==='gemini'?'Antigravity 將略過權限提示，可能執行工作區外的寫入與命令。請確認這是你要授予的權限。':pending==='danger-full-access'?'此對話將略過 Codex 權限提示，一般操作不再逐項詢問你。K 的外部隔離限制不會因此解除。':'主代理仍在沙箱內工作；需要額外存取時，由 Codex 自動審查並決定是否放行。自動審查仍可能判斷錯誤。'}</p>
    <div className="permission-confirm-actions"><button type="button" onClick={close}>取消</button><button type="button" className={pending==='danger-full-access'||pending==='claude-bypassPermissions'?'permission-enable-danger':'primary'} onClick={()=>choose(pending,true)}>確認選用</button></div>
   </div>:<>
    <div className="permission-menu-heading"><span>{provider==='claude'?'Claude Code 原生權限模式':provider==='gemini'?'Antigravity 操作範圍':'如何核准操作？'}</span>{provider==='codex'&&<a href="https://learn.chatgpt.com/docs/permission-modes" target="_blank" rel="noreferrer">了解更多</a>}</div>
    {provider==='claude'?Object.keys(claudePermissionModes).map(row):<>{allowedModes.filter(mode=>mode!=='read-only').map(row)}{allowedModes.includes('read-only')&&<div className="permission-advanced"><button type="button" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}>進階選項<ChevronDown size={13}/></button>{advanced&&row('read-only')}</div>}</>}
    {browserEnabled&&<p className="permission-confirm-note">瀏覽器已啟用：可存取網路與網站；不受命令沙箱網路限制，核准依原生工具政策。自動審查或略過權限提示時，瀏覽器操作可能不經你核准；手動模式也不代表每次操作都會詢問。</p>}
    {note&&<p className="permission-confirm-note">{note}</p>}
   </>}
  </div>{note&&<small className="permission-inline-note">{note}</small>}
 </div>;
}
