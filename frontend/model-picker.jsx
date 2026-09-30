import React,{useEffect,useRef,useState,useId} from 'react';
import {Check,ChevronDown,RefreshCw} from 'lucide-react';
import {WORKER_MODELS,normalizeWorkerPolicy} from '../src/worker-policy.mjs';
import {PermissionPicker} from './permission-picker.jsx';
import {officialClaudeLoginUrl as officialLoginUrl} from '../shared/claude-login-url.mjs';

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
 const [claudeStatus,setClaudeStatus]=useState(null),[claudeLoading,setClaudeLoading]=useState(true),[claudeAction,setClaudeAction]=useState(false);
 const [claudeCode,setClaudeCode]=useState(''),[claudeLoginNotice,setClaudeLoginNotice]=useState('');
 const [codexStatus,setCodexStatus]=useState(null),[codexLoading,setCodexLoading]=useState(true),[codexAction,setCodexAction]=useState(false);
 const [workerPolicy,setWorkerPolicy]=useState(()=>normalizeWorkerPolicy(currentWorkerPolicy));
 const [accessMode,setAccessMode]=useState('workspace-write'),[permissionConfirmed,setPermissionConfirmed]=useState(false);
 const [accountsOpen,setAccountsOpen]=useState(false);
 const initializedProvider=useRef(mode==='switch'?modelProvider({model:currentModel}):'codex');

 const refreshClaudeStatus=async({refreshModels=false}={})=>{
  setClaudeLoading(true);
  try{
   const response=await fetch('/api/claude/auth',{cache:'no-store'});
   if(!response.ok)throw new Error();
   const next=await response.json();setClaudeStatus(next);
   if(refreshModels&&next.available===true){try{const catalog=await loadModels(),list=catalog.models??[];setModels(list);onCatalog(list,catalog.warnings??[]);}catch{}}
  }catch{setClaudeStatus({available:false,reason:'無法讀取 Claude 登入狀態。',login:{status:'idle'}});}
  finally{setClaudeLoading(false);}
 };
 const refreshCodexStatus=async({refreshModels=false}={})=>{
  setCodexLoading(true);
  try{
   const response=await fetch('/api/codex/auth',{cache:'no-store'});
   if(!response.ok)throw new Error();
   const next=await response.json();setCodexStatus(next);
   if(refreshModels&&next.available===true){try{
    const catalog=await loadModels(),list=catalog.models??[],supported=list;
    setModels(supported);onCatalog(list,catalog.warnings??[]);setError('');setLoading(false);
    const currentProvider=modelProvider({model:currentModel}),choices=mode==='switch'?supported.filter(item=>modelProvider(item)===currentProvider):supported;
    const initial=choices.find(item=>item.model===currentModel)?.model??choices.find(item=>item.isDefault&&item.available!==false)?.model??choices.find(item=>item.available!==false&&modelProvider(item)==='codex')?.model??choices[0]?.model??'';
    if(!model||!supported.some(item=>item.model===model)){setModel(initial);if(initial)setProvider(modelProvider({model:initial}));setEffort(undefined);}
   }catch{}}
  }catch{setCodexStatus({available:false,reason:'無法讀取 Codex 登入狀態。',login:{status:'idle'}});}
  finally{setCodexLoading(false);}
 };
 useEffect(()=>{refreshClaudeStatus();refreshCodexStatus();},[]);
 const updateClaudeLogin=async(route,data={})=>{
  setClaudeAction(true);setClaudeLoginNotice('');setClaudeCode('');
  try{
   const response=await fetch(`/api/claude/${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify(data)});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'無法更新登入，請刷新狀態。');
   setClaudeStatus(current=>({...current,...result}));
  }catch(cause){setClaudeLoginNotice(cause.message||'無法更新登入，請刷新狀態。');}
  finally{setClaudeAction(false);}
 };
 const copyClaudeLogin=async()=>{
  const url=officialLoginUrl(claudeStatus?.login?.url);if(!url)return;
  try{await navigator.clipboard.writeText(url);setClaudeLoginNotice('已複製登入連結，請貼到你原本的 Chrome 網址列。');}
  catch{setClaudeLoginNotice('未能複製，請右鍵「開啟官方登入頁」並複製連結網址。');}
 };
 useEffect(()=>{
  if(claudeStatus?.login?.status!=='running')return;
  let disposed=false,timer;
  const poll=async()=>{
   try{
    const response=await fetch('/api/claude/login',{cache:'no-store'});if(!response.ok)throw new Error();
    const next=await response.json();if(disposed)return;
    setClaudeStatus(current=>({...current,...next}));
    if(next.login?.status!=='running'){setClaudeCode('');await refreshClaudeStatus({refreshModels:true});return;}
   }catch{if(!disposed)setClaudeLoginNotice('暫時無法更新登入進度，請按刷新狀態確認。');}
   if(!disposed)timer=setTimeout(poll,2000);
  };
  void poll();return()=>{disposed=true;clearTimeout(timer);};
 },[claudeStatus?.login?.status]);
 const updateCodexLogin=async route=>{
  setCodexAction(true);
  try{
   const response=await fetch(`/api/codex/${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:'{}'});
   if(!response.ok)throw new Error();setCodexStatus(await response.json());
  }catch{setCodexStatus(current=>current?{...current,login:{status:'error'}}:{available:false,reason:'無法讀取 Codex 登入狀態。',login:{status:'error'}});}
  finally{setCodexAction(false);}
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
 const auth=claudeStatus?.auth;
 const codexAuth=codexStatus?.auth;
 const codexVerified=codexStatus?.available===true&&codexAuth?.loggedIn===true&&codexAuth?.authMethod==='chatgpt';
 const claudeVerified=claudeStatus?.available===true&&auth?.loggedIn===true&&auth?.authMethod==='claude.ai'&&auth?.apiProvider==='firstParty'&&['pro','max','team','enterprise'].includes(auth?.subscriptionType);
 const isAvailable=item=>item?.available!==false&&(modelProvider(item)!=='claude'||claudeVerified);
 const claudeUnavailableReason='尚未登入 Claude 訂閱，請先完成官方登入。';
 const claudeStatusText=()=>claudeLoading?'正在讀取登入狀態…':claudeVerified?`已確認 Claude.ai ${auth.subscriptionType} 訂閱${claudeStatus.version?` · Claude Code ${claudeStatus.version}`:''}`:auth?.loggedIn===false?claudeUnavailableReason:claudeStatus?.reason||claudeUnavailableReason;
 const codexStatusText=()=>codexLoading?'正在讀取登入狀態…':codexVerified?`已確認 ChatGPT${codexAuth.planType?` ${codexAuth.planType} 訂閱`: ' 訂閱'}`:codexAuth?.loggedIn===false?'尚未登入 ChatGPT 訂閱，請先完成官方登入。':codexStatus?.reason||'尚未確認 Codex 訂閱狀態。';
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
 const claudeLogin=claudeStatus?.login;
 const codexLogin=codexStatus?.login;
 const needsLogin=provider==='claude'?!claudeLoading&&!claudeVerified:!codexLoading&&!codexVerified;
 useEffect(()=>{if(needsLogin)setAccountsOpen(true);},[needsLogin]);

 const permissionValue=selectedProvider==='claude'?(accessMode==='workspace-write'?'claude-manual':accessMode==='read-only'?'claude-plan':accessMode):accessMode;
 const permissionForSubmit=selectedProvider==='claude'?(accessMode==='workspace-write'?'claude-manual':accessMode==='read-only'?'claude-plan':accessMode):accessMode;
 return <div className="model-picker">
  {(mode==='create')&&<details className="provider-auth-status" open={accountsOpen} onToggle={event=>setAccountsOpen(event.newState==='open')}>
   <summary aria-label="帳號連線"><span>帳號連線</span><span className="account-summary"><span className={codexVerified?'connected':''}>GPT {codexLoading?'讀取中':codexVerified?'已連線':'未連線'}</span><span className={claudeVerified?'connected':''}>Claude {claudeLoading?'讀取中':claudeVerified?'已連線':'未連線'}</span><ChevronDown size={14}/></span></summary>
   <div className="provider-auth-row"><div className="provider-auth-copy"><strong>GPT / Codex 訂閱</strong><span>{codexStatusText()}</span></div><div className="provider-auth-actions">
    {codexLogin?.status==='running'?<><span role="status">等待完成官方登入。</span>{officialCodexLoginUrl(codexLogin.url)&&<a href={officialCodexLoginUrl(codexLogin.url)} target="_blank" rel="noreferrer">開啟官方登入頁</a>}<button type="button" disabled={codexAction} onClick={()=>updateCodexLogin('login/cancel')}>停止登入</button></>:<button type="button" disabled={disabled||codexAction||codexLoading||codexVerified} onClick={()=>updateCodexLogin('login')}>登入 GPT / Codex</button>}
    <button type="button" disabled={codexAction||codexLoading} onClick={()=>refreshCodexStatus({refreshModels:true})}><RefreshCw size={14}/>刷新狀態</button>{codexLogin?.status==='error'&&<small role="status">登入未成功；刷新狀態後可再試一次。</small>}{codexLogin?.status==='complete'&&!codexVerified&&<small role="status">登入流程已結束，但目前尚未確認可用的 ChatGPT 訂閱。</small>}
   </div></div>
   <div className="provider-auth-row"><div className="provider-auth-copy"><strong>Claude 訂閱</strong><span>{claudeStatusText()}</span></div><div className="provider-auth-actions">
    {claudeLogin?.status==='running'?<><span role="status">{claudeLogin.codeSubmitted?'已交付官方驗證，尚未確認登入完成。':'等待你完成官方登入。'}</span>{officialLoginUrl(claudeLogin.url)?<>
     <a href={officialLoginUrl(claudeLogin.url)} target="_blank" rel="noreferrer">開啟官方登入頁</a><button type="button" onClick={copyClaudeLogin}>複製登入連結</button>
     <small>要沿用原本的 Chrome，請從這裡複製連結再貼到 Chrome；不必從隔離視窗複製。官方顯示授權碼後，貼到下方，不要貼進聊天。</small>
     {!claudeLogin.codeSubmitted&&<div className="claude-code-entry"><label>Claude 官方授權碼<input type="password" autoComplete="off" spellCheck={false} value={claudeCode} maxLength={4096} onChange={event=>setClaudeCode(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} placeholder="貼上這次登入的完整授權碼"/></label><button type="button" disabled={claudeAction||!claudeCode.trim()} onClick={()=>updateClaudeLogin('login/code',{code:claudeCode})}>交付官方驗證</button></div>}
    </>:<small>正在等候官方登入連結…</small>}<button type="button" disabled={claudeAction} onClick={()=>updateClaudeLogin('login/cancel')}>停止登入</button></>:<button type="button" disabled={disabled||claudeAction||claudeLoading||claudeVerified} onClick={()=>updateClaudeLogin('login')}>登入 Claude 訂閱</button>}
    {claudeLoginNotice&&<small role="status">{claudeLoginNotice}</small>}
    <button type="button" disabled={claudeAction||claudeLoading} onClick={()=>refreshClaudeStatus({refreshModels:true})}><RefreshCw size={14}/>刷新狀態</button>{claudeLogin?.status==='error'&&<small role="status">登入未成功；刷新狀態後可再試一次。</small>}{claudeLogin?.status==='complete'&&!claudeVerified&&<small role="status">登入流程已結束，但目前尚未確認可用的 Claude 訂閱。</small>}
   </div></div>
  </details>}
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

function officialCodexLoginUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='auth.openai.com'?url.href:null;}catch{return null;}}
