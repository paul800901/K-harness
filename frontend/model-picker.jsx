import React,{useEffect,useRef,useState} from 'react';
import {Check,RefreshCw} from 'lucide-react';
import {WORKER_MODELS,normalizeWorkerPolicy} from '../src/worker-policy.mjs';
import {PermissionPicker} from './permission-picker.jsx';
import {officialClaudeLoginUrl as officialLoginUrl} from '../shared/claude-login-url.mjs';

export const effortName={none:'無',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'極高',max:'最高',ultra:'超高（Ultra）'};
const displayModel=model=>model?.displayName||model?.model||'選擇模型';
const modelProvider=model=>model?.provider==='claude'||model?.model?.startsWith('claude-')?'claude':'codex';
const providerLabel=provider=>provider==='claude'?'Claude':'GPT';
const providerSubscription=provider=>provider==='claude'?'Claude 訂閱':'Codex 訂閱';
const providerDefaultPermission=provider=>provider==='claude'?'claude-manual':'workspace-write';

export function ModelPicker({currentModel,currentEffort,currentWorkerPolicy,mode='create',hasHistory=false,disabled,loadModels,onCatalog,onClose,onCreate}){
 const [models,setModels]=useState([]),[provider,setProvider]=useState(mode==='switch'?modelProvider({model:currentModel}):'codex'),[model,setModel]=useState(''),[effort,setEffort]=useState(undefined),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [claudeStatus,setClaudeStatus]=useState(null),[claudeLoading,setClaudeLoading]=useState(true),[claudeAction,setClaudeAction]=useState(false);
 const [claudeCode,setClaudeCode]=useState(''),[claudeLoginNotice,setClaudeLoginNotice]=useState('');
 const [codexStatus,setCodexStatus]=useState(null),[codexLoading,setCodexLoading]=useState(true),[codexAction,setCodexAction]=useState(false);
 const [workerPolicy,setWorkerPolicy]=useState(()=>normalizeWorkerPolicy(currentWorkerPolicy));
 const [accessMode,setAccessMode]=useState('workspace-write'),[permissionConfirmed,setPermissionConfirmed]=useState(false);
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

 const permissionValue=selectedProvider==='claude'?(accessMode==='workspace-write'?'claude-manual':accessMode==='read-only'?'claude-plan':accessMode):accessMode;
 const permissionForSubmit=selectedProvider==='claude'?(accessMode==='workspace-write'?'claude-manual':accessMode==='read-only'?'claude-plan':accessMode):accessMode;
 return <>
  {(mode==='create')&&<section className="provider-auth-status" aria-label="提供者登入狀態">
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
  </section>}
  {loading?<p className="modal-description" role="status">正在載入模型…</p>:error?<div role="alert" className="model-load-error"><p>{error}</p><button type="button" onClick={()=>setRevision(value=>value+1)}><RefreshCw size={15}/>重新載入</button></div>:<>
   <section className="main-agent-setting" aria-labelledby="main-agent-label">
    <div className="model-setting-copy"><strong id="main-agent-label">主代理</strong><span>依序選提供者、模型與推理程度。</span></div>
    <div className="model-picker-flow">
     <fieldset className="model-picker-step provider-step"><legend><span>1</span>提供者</legend><div className="model-choice-row" role="group" aria-label="選擇主代理提供者">
      {['codex','claude'].map(item=><button type="button" key={item} className={`model-choice ${provider===item?'selected':''}`} aria-pressed={provider===item} disabled={disabled||(mode==='switch'&&item!==switchProvider)} onClick={()=>chooseProvider(item)}>{providerLabel(item)}{provider===item&&<Check size={15}/>}</button>)}
     </div>{mode==='switch'&&<small className="step-hint">既有對話只能切換相同提供者的模型；更換提供者請建立新對話。</small>}</fieldset>

     <fieldset className="model-picker-step"><legend><span>2</span>模型</legend><div className="model-choice-row model-choice-models" role="group" aria-label="選擇主代理模型">
      {visibleModels.map(item=><button key={item.model} type="button" className={`model-choice ${item.model===model?'selected':''}`} disabled={disabled||!isAvailable(item)} aria-pressed={item.model===model} title={!isAvailable(item)?(modelProvider(item)==='claude'?claudeUnavailableReason:item.unavailableReason||'目前不可用'):undefined} onClick={()=>chooseModel(item)}><span>{displayModel(item)}{item.model===model&&<small>{providerSubscription(provider)}</small>}</span>{item.model===model&&<Check size={15}/>}</button>)}
      {!visibleModels.length&&<p className="step-hint">目前帳號未提供此提供者的支援模型。</p>}
     </div>{selected?.description&&<p className="step-hint">{selected.description}</p>}</fieldset>

     <fieldset className="model-picker-step effort-step"><legend><span>3</span>推理程度</legend>{hasReasoningOptions?<div className="model-choice-row effort-choice-row" role="group" aria-label="選擇主代理推理程度">
      <button type="button" className={`model-choice ${effort===undefined||effort===null?'selected':''}`} aria-pressed={effort===undefined||effort===null} disabled={disabled} onClick={()=>chooseEffort(null)}><span>模型預設{inheritedEffort&&<small>目前預設：{effortName[inheritedEffort]??inheritedEffort}</small>}</span>{(effort===undefined||effort===null)&&<Check size={15}/>}</button>
      {supportedEfforts.map(item=><button key={item.reasoningEffort} type="button" className={`model-choice ${effort===item.reasoningEffort?'selected':''}`} aria-pressed={effort===item.reasoningEffort} disabled={disabled} onClick={()=>chooseEffort(item.reasoningEffort)}>{effortName[item.reasoningEffort]??item.reasoningEffort}{effort===item.reasoningEffort&&<Check size={15}/>}</button>)}
     </div>:<p className="step-hint">此模型目前未提供推理程度選項，將使用模型預設。</p>}</fieldset>

     {mode==='create'&&<section className="setting-section permission-section" aria-labelledby="permission-setting-label"><div className="model-setting-copy"><strong id="permission-setting-label">操作權限</strong><span>權限與模型選擇分開。</span></div><div><PermissionPicker label="新對話操作權限" value={permissionValue} provider={selectedProvider==='claude'?'claude':'codex'} disabled={disabled} onChange={(value,confirmed)=>{setAccessMode(value);setPermissionConfirmed(confirmed);}}/><p className="model-routing-note">{selectedProvider==='claude'?'選用 Claude Code 原生模式；各模式行為由 Claude Code 決定。':'由 Codex 訂閱執行；不改變工作區與子代理權限。'}</p></div></section>}
    </div>
   </section>
   {!models.length&&<p className="modal-description">目前沒有可用模型。</p>}
   {mode==='switch'?<>
    {hasHistory&&model!==currentModel?<p className="model-switch-warning" role="note">中途切換模型可能影響接續品質，上下文也可能自動壓縮。原對話與檔案保留，但不保證所有細節都能無損接續。需要完全獨立的工作時，可另開新對話。</p>:<p className="model-routing-note">從下一則訊息開始使用；不會立即執行工作。</p>}
    <p className="model-routing-note">只變更主代理與推理程度；工作區、子代理與操作權限不變。</p>
   </>:<section className="setting-section worker-section" aria-labelledby="worker-setting-label"><div className="model-setting-copy"><strong id="worker-setting-label">子代理</strong><span>需要派工時才使用；AI 可依任務改選。</span></div><div className="worker-settings-body">
    <label><span>預設模型</span><select aria-label="子代理模型" value={workerPolicy.model} disabled={disabled} onChange={event=>{const model=workerModels.find(item=>item.model===event.target.value);setWorkerPolicy({model:model.model,effort:model.defaultReasoningEffort??'high'});}}>
     {!workerModels.some(item=>item.model===workerPolicy.model)&&<option value={workerPolicy.model}>{workerPolicy.model}（目錄暫不可用）</option>}{workerModels.map(item=><option key={item.model} value={item.model}>{displayModel(item)}</option>)}
    </select></label>
    <label><span>預設推理程度</span><select aria-label="子代理推理程度" value={workerPolicy.effort} disabled={disabled||!workerEfforts.length} onChange={event=>setWorkerPolicy(current=>({...current,effort:event.target.value}))}>
     {!workerEfforts.some(item=>item.reasoningEffort===workerPolicy.effort)&&<option value={workerPolicy.effort}>{effortName[workerPolicy.effort]??workerPolicy.effort}（目錄未提供）</option>}{workerEfforts.map(item=><option key={item.reasoningEffort} value={item.reasoningEffort}>{effortName[item.reasoningEffort]??item.reasoningEffort}</option>)}
    </select></label><p className="step-hint">沿用 Codex 訂閱；也可直接在訊息中指定子代理模型與推理程度。</p></div></section>}
  </>}
  <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={disabled||loading||!!error||!selected||!isAvailable(selected)||(mode==='switch'&&modelProvider(selected)!==switchProvider)} onClick={()=>onCreate({model,...(mode==='switch'?{confirmed:hasHistory&&model!==currentModel}:{accessMode:permissionForSubmit,permissionConfirmed,workerPolicy}),...(effort===undefined?{}:{effort:effort===null&&provider==='codex'?(selected.defaultReasoningEffort??null):effort})})}>{mode==='switch'?(hasHistory&&model!==currentModel?'確認切換':'套用模型'):'建立對話'}</button></div>
 </>;
}

function officialCodexLoginUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='auth.openai.com'?url.href:null;}catch{return null;}}
