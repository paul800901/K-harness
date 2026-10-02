import React,{useEffect,useRef,useState,useId} from 'react';
import {Check,ChevronDown,RefreshCw} from 'lucide-react';
import {WORKER_MODELS,normalizeWorkerPolicy} from '../src/worker-policy.mjs';
import {PermissionPicker} from './permission-picker.jsx';
import {AccountConnections} from './account-connections.jsx';

export const effortName={none:'無',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'極高',max:'最高',ultra:'超高（Ultra）'};
const displayModel=model=>model?.displayName||model?.model||'選擇模型';
const modelProvider=model=>model?.provider==='claude'||model?.model?.startsWith('claude-')?'claude':'codex';
const providerLabel=provider=>provider==='claude'?'Claude':'GPT';
const providerDefaultPermission=provider=>provider==='claude'?'claude-manual':'workspace-write';
const billingNote=model=>/requires (?:extra )?usage credits|requires extra usage|extra usage required/i.test(model?.description??'')?'需額外用量點數':'';

function ModelMenu({models,selected,disabled,isAvailable,onChange}){
 const trigger=useRef(null),menu=useRef(null),id=useId(),[open,setOpen]=useState(false);
 const families=modelProvider(selected)==='claude'?['Opus','Sonnet','Haiku','Fable']:['Sol','Astra','Luna','Terra'];
 const grouped=new Map([...families,'其他'].map(name=>[name,[]]));
 for(const item of models){const family=families.find(name=>new RegExp(`\\b${name}\\b`,'i').test(`${item.model} ${displayModel(item)}`))??'其他';grouped.get(family).push(item);}
 const version=item=>(displayModel(item).match(/\d+(?:[.-]\d+)*/)?.[0]??'').split(/[.-]/).map(Number);
 const byVersion=(a,b)=>{const av=version(a),bv=version(b);for(let i=0;i<Math.max(av.length,bv.length);i++){const difference=(bv[i]??0)-(av[i]??0);if(difference)return difference;}return 0;};
 const position=()=>{
  const rect=trigger.current.getBoundingClientRect(),scale=rect.width/trigger.current.offsetWidth||1,popup=menu.current;
  const width=window.innerWidth/scale,height=window.innerHeight/scale,below=height-rect.bottom/scale-12,above=rect.top/scale-12;
  popup.style.width=`${Math.min(rect.width/scale,width-24)}px`;
  popup.style.maxHeight=`${Math.max(80,Math.min(380,Math.max(below,above)))}px`;
  popup.style.left=`${Math.max(12,Math.min(rect.left/scale,width-popup.offsetWidth-12))}px`;
  popup.style.top=`${below>=popup.offsetHeight?rect.bottom/scale+5:Math.max(12,rect.top/scale-popup.offsetHeight-5)}px`;
 };
 const close=()=>{menu.current.hidePopover();trigger.current.focus();};
 const show=()=>{menu.current.showPopover();position();(menu.current.querySelector('[aria-checked="true"]:not(:disabled)')??menu.current.querySelector('button:not(:disabled)'))?.focus();};
 useEffect(()=>{if(!open)return;window.addEventListener('resize',position);return()=>window.removeEventListener('resize',position);},[open]);
 useEffect(()=>{if(disabled)menu.current?.hidePopover();},[disabled]);
 const navigate=event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key==='Tab'){close();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const items=[...menu.current.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;
  items[next]?.focus();
 };
 return <div className="model-select">
  <button type="button" className="model-select-trigger" ref={trigger} aria-label="主代理模型" aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={disabled||!models.length} onClick={()=>open?close():show()} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show();}}}><span>{displayModel(selected)}</span><ChevronDown size={15}/></button>
  <div ref={menu} id={id} popover="auto" className="model-menu" role="menu" aria-label="主代理模型選單" onToggle={event=>setOpen(event.newState==='open')} onKeyDown={navigate}>
   {[...grouped].filter(([,items])=>items.length).map(([family,items])=><div role="group" aria-label={family} key={family}><div className="model-menu-heading" aria-hidden="true">{family}</div>{items.sort(byVersion).map(item=><button type="button" role="menuitemradio" tabIndex={-1} aria-label={displayModel(item)} aria-checked={item.model===selected?.model} disabled={!isAvailable(item)} key={item.model} onClick={()=>{onChange(item);close();}}><span>{displayModel(item)}</span>{billingNote(item)&&<small>{billingNote(item)}</small>}{!isAvailable(item)&&<small>目前不可用</small>}<Check size={15} className={item.model===selected?.model?'':'model-check-hidden'}/></button>)}</div>)}
  </div>
 </div>;
}

export function ModelPicker({currentModel,currentEffort,currentWorkerPolicy,mode='create',hasHistory=false,disabled,loadModels,onCatalog,onClose,onCreate}){
 const [models,setModels]=useState([]),[provider,setProvider]=useState(mode==='switch'?modelProvider({model:currentModel}):'codex'),[model,setModel]=useState(''),[effort,setEffort]=useState(undefined),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [accountStatus,setAccountStatus]=useState({});
 const [workerPolicy,setWorkerPolicy]=useState(()=>normalizeWorkerPolicy(currentWorkerPolicy));
 const [accessMode,setAccessMode]=useState('workspace-write'),[permissionConfirmed,setPermissionConfirmed]=useState(false);
 const initializedProvider=useRef(mode==='switch'?modelProvider({model:currentModel}):'codex');

 const refreshModels=async kind=>{
  try{
   const catalog=await loadModels(),list=catalog.models??[];
   setModels(list);onCatalog(list,catalog.warnings??[]);setError('');setLoading(false);
   if(kind==='codex'){
    const currentProvider=modelProvider({model:currentModel}),choices=mode==='switch'?list.filter(item=>modelProvider(item)===currentProvider):list;
    const initial=choices.find(item=>item.model===currentModel)?.model??choices.find(item=>item.isDefault&&item.available!==false)?.model??choices.find(item=>item.available!==false&&modelProvider(item)==='codex')?.model??choices[0]?.model??'';
    if(!model||!list.some(item=>item.model===model)){setModel(initial);if(initial)setProvider(modelProvider({model:initial}));setEffort(undefined);}
   }
  }catch{}
 };
 useEffect(()=>{
  let cancelled=false;setLoading(true);setError('');
  loadModels().then(({models:list,warnings=[]})=>{
   if(cancelled)return;
   const supported=list;
   setModels(supported);onCatalog(list,warnings);
   const currentProvider=modelProvider({model:currentModel});
   const choices=mode==='switch'?supported.filter(item=>modelProvider(item)===currentProvider):supported;
   const initial=choices.find(item=>item.model===currentModel)?.model??choices.find(item=>item.isDefault&&item.available!==false)?.model??choices.find(item=>item.available!==false&&modelProvider(item)==='codex')?.model??choices[0]?.model??'';
   setModel(initial);
   const initialItem=choices.find(item=>item.model===initial);
   setEffort(mode==='switch'&&initial===currentModel&&initialItem&&currentEffort!=null&&initialItem.supportedReasoningEfforts?.some(item=>item.reasoningEffort===currentEffort)?currentEffort:mode==='switch'&&initial===currentModel&&currentEffort==null?null:undefined);
   if(initialItem)setProvider(modelProvider(initialItem));
  }).catch(cause=>{if(!cancelled)setError(cause.message);}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[revision]);

 const selected=models.find(item=>item.model===model);
 const claudeStatus=accountStatus.claude,auth=claudeStatus?.auth;
 const claudeVerified=claudeStatus?.available===true&&auth?.loggedIn===true&&auth?.authMethod==='claude.ai'&&auth?.apiProvider==='firstParty'&&['pro','max','team','enterprise'].includes(auth?.subscriptionType);
 const isAvailable=item=>item?.available!==false&&(modelProvider(item)!=='claude'||claudeVerified);
 const supportedEfforts=selected?.supportedReasoningEfforts??[];
 const workerModels=models.filter(item=>WORKER_MODELS.includes(item.model));
 const workerEfforts=workerModels.find(item=>item.model===workerPolicy.model)?.supportedReasoningEfforts??[];
 const inheritedEffort=mode==='switch'&&supportedEfforts.some(item=>item.reasoningEffort===currentEffort)?currentEffort:selected?.defaultReasoningEffort;
 const visibleModels=models.filter(item=>modelProvider(item)===provider);

 useEffect(()=>{
  if(!model)return;
  const nextProvider=modelProvider({model});
  setProvider(current=>current===nextProvider?current:nextProvider);
  if(initializedProvider.current!==nextProvider){
   initializedProvider.current=nextProvider;
   setAccessMode(providerDefaultPermission(nextProvider));setPermissionConfirmed(false);
  }
 },[model]);

 const chooseProvider=next=>{
  if(mode==='switch'&&next!==modelProvider({model:currentModel}))return;
  setProvider(next);
  const first=models.find(item=>modelProvider(item)===next);
  if(next!==provider){setAccessMode(providerDefaultPermission(next));setPermissionConfirmed(false);initializedProvider.current=next;}
  if(first){setModel(first.model);setEffort(undefined);}else{setModel('');setEffort(undefined);}
 };
 const chooseModel=next=>{
  if(!next||!isAvailable(next))return;
  const nextProvider=modelProvider(next);
  if(mode==='switch'&&nextProvider!==modelProvider({model:currentModel}))return;
  if(nextProvider!==provider){setProvider(nextProvider);setAccessMode(providerDefaultPermission(nextProvider));setPermissionConfirmed(false);initializedProvider.current=nextProvider;}
  setModel(next.model);setEffort(undefined);
 };
 const chooseEffort=next=>setEffort(next);
 const selectedProvider=modelProvider(selected);
 const switchProvider=modelProvider({model:currentModel});
 const hasReasoningOptions=supportedEfforts.length>0;

 const permissionValue=selectedProvider==='claude'?(accessMode==='workspace-write'?'claude-manual':accessMode==='read-only'?'claude-plan':accessMode):accessMode;
 const permissionForSubmit=selectedProvider==='claude'?(accessMode==='workspace-write'?'claude-manual':accessMode==='read-only'?'claude-plan':accessMode):accessMode;
 return <div className="model-picker">
  <AccountConnections disabled={disabled} provider={provider} hidden={mode!=='create'} onStatus={setAccountStatus} onRefresh={refreshModels}/>
  {loading?<p className="modal-description" role="status">正在載入模型…</p>:error?<div role="alert" className="model-load-error"><p>{error}</p><button type="button" onClick={()=>setRevision(value=>value+1)}><RefreshCw size={15}/>重新載入</button></div>:<>
   <section className="main-agent-setting" aria-label="主代理設定">
    <div className="model-picker-flow">
     <div className="model-setting-row"><span>提供者</span>{mode==='switch'?<span className="model-provider-fixed">{providerLabel(provider)}<small>既有對話維持同一提供者</small></span>:<div className="model-provider-tabs" role="group" aria-label="選擇主代理提供者">{['codex','claude'].map(item=><button type="button" key={item} aria-pressed={provider===item} disabled={disabled} onClick={()=>chooseProvider(item)}>{providerLabel(item)}</button>)}</div>}</div>
     <div className="model-setting-row"><span>模型</span><div><ModelMenu key={provider} models={visibleModels} selected={selected} disabled={disabled} isAvailable={isAvailable} onChange={chooseModel}/>{billingNote(selected)&&<p className="model-billing-note" role="note">{billingNote(selected)}</p>}{!visibleModels.length&&<p className="step-hint">目前帳號未提供可用模型。</p>}</div></div>
     <label className="model-setting-row"><span>推理程度</span><select aria-label="主代理推理程度" value={effort??''} disabled={disabled||!hasReasoningOptions} onChange={event=>chooseEffort(event.target.value||null)}><option value="">模型預設{inheritedEffort?`（${effortName[inheritedEffort]??inheritedEffort}）`:''}</option>{supportedEfforts.map(item=><option key={item.reasoningEffort} value={item.reasoningEffort}>{effortName[item.reasoningEffort]??item.reasoningEffort}</option>)}</select></label>
     {mode==='create'&&<div className="model-setting-row"><span>操作權限</span><PermissionPicker label="新對話操作權限" value={permissionValue} provider={selectedProvider==='claude'?'claude':'codex'} disabled={disabled} onChange={(value,confirmed)=>{setAccessMode(value);setPermissionConfirmed(confirmed);}}/></div>}
    </div>
   </section>
   {!models.length&&<p className="modal-description">目前沒有可用模型。</p>}
   {mode==='switch'?<>
    {hasHistory&&model!==currentModel?<p className="model-switch-warning" role="note">中途切換模型可能影響接續品質，上下文也可能自動壓縮。原對話與檔案保留，但不保證所有細節都能無損接續。需要完全獨立的工作時，可另開新對話。</p>:<p className="model-routing-note">從下一則訊息開始使用；不會立即執行工作。</p>}
   </>:<details className="worker-settings">
    <summary aria-label="子代理設定"><span>子代理</span><span>{workerPolicy.model==='auto'?'AI 自動選擇':`${displayModel(workerModels.find(item=>item.model===workerPolicy.model)??{model:workerPolicy.model})} · ${effortName[workerPolicy.effort]??workerPolicy.effort}`}<ChevronDown size={14}/></span></summary><div className="worker-settings-body">
    <label><span>預設模型</span><select aria-label="子代理模型" value={workerPolicy.model} disabled={disabled} onChange={event=>{const model=workerModels.find(item=>item.model===event.target.value);setWorkerPolicy(model?{model:model.model,effort:model.defaultReasoningEffort??'high'}:{model:'auto',effort:'auto'});}}>
     <option value="auto">AI 自動選擇（依任務難度）</option>{workerPolicy.model!=='auto'&&!workerModels.some(item=>item.model===workerPolicy.model)&&<option value={workerPolicy.model}>{workerPolicy.model}（目錄暫不可用）</option>}{workerModels.map(item=><option key={item.model} value={item.model}>{displayModel(item)}</option>)}
    </select></label>
    {workerPolicy.model!=='auto'&&<label><span>預設推理程度</span><select aria-label="子代理推理程度" value={workerPolicy.effort} disabled={disabled||!workerEfforts.length} onChange={event=>setWorkerPolicy(current=>({...current,effort:event.target.value}))}>
     {!workerEfforts.some(item=>item.reasoningEffort===workerPolicy.effort)&&<option value={workerPolicy.effort}>{effortName[workerPolicy.effort]??workerPolicy.effort}（目錄未提供）</option>}{workerEfforts.map(item=><option key={item.reasoningEffort} value={item.reasoningEffort}>{effortName[item.reasoningEffort]??item.reasoningEffort}</option>)}
    </select></label>}<p className="step-hint">{workerPolicy.model==='auto'?'需要派工時，由 AI 依任務難度選擇 Sol 或 Luna，以及推理程度。':'作為派工預設；你也可以在訊息中指定模型與推理程度。'}</p></div></details>}
  </>}
  <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={disabled||loading||!!error||!selected||!isAvailable(selected)||(mode==='switch'&&modelProvider(selected)!==switchProvider)} onClick={()=>onCreate({model,...(mode==='switch'?{confirmed:hasHistory&&model!==currentModel}:{accessMode:permissionForSubmit,permissionConfirmed,workerPolicy}),...(effort===undefined?{}:{effort:effort===null&&provider==='codex'?(selected.defaultReasoningEffort??null):effort})})}>{mode==='switch'?(hasHistory&&model!==currentModel?'確認切換':'套用模型'):'建立對話'}</button></div>
 </div>;
}
