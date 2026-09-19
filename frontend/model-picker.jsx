import React,{useEffect,useRef,useState} from 'react';
import {Bot,Check,ChevronDown,RefreshCw,Search} from 'lucide-react';
import {PermissionPicker,permissionModes} from './permission-picker.jsx';

export const effortName={none:'無',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'極高',max:'最高',ultra:'超高（Ultra）'};
const displayModel=model=>model?.displayName||model?.model||'選擇模型';

export function ModelPicker({currentModel,currentWorkerModel,currentEffort,mode='create',hasHistory=false,disabled,loadModels,onCatalog,onClose,onCreate}){
 const [models,setModels]=useState([]),[model,setModel]=useState(''),[effort,setEffort]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [workerModel,setWorkerModel]=useState(currentWorkerModel||'deepseek-v4-flash');
 const [accessMode,setAccessMode]=useState('workspace-write');
 const [permissionConfirmed,setPermissionConfirmed]=useState(false);
 const [pickerOpen,setPickerOpen]=useState(false),[query,setQuery]=useState('');
 const pickerRef=useRef(null),triggerRef=useRef(null),searchRef=useRef(null);
 useEffect(()=>{
  let cancelled=false;setLoading(true);setError('');
  loadModels().then(({models:list})=>{
   if(cancelled)return;
   setModels(list);onCatalog(list);
   setModel(list.some(item=>item.model===currentModel)?currentModel:list.find(item=>item.isDefault)?.model??list[0]?.model??'');
  }).catch(cause=>{if(!cancelled)setError(cause.message);}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[revision]);
 useEffect(()=>{
  if(!pickerOpen)return;
  const close=event=>{if(!pickerRef.current?.contains(event.target)&&!triggerRef.current?.contains(event.target))setPickerOpen(false);};
  const escape=event=>{if(event.key==='Escape'){setPickerOpen(false);triggerRef.current?.focus();}};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
  requestAnimationFrame(()=>searchRef.current?.focus());
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
 },[pickerOpen]);
 const selected=models.find(item=>item.model===model);
 const supportedEfforts=selected?.supportedReasoningEfforts??[];
 const inheritedEffort=mode==='switch'&&supportedEfforts.some(item=>item.reasoningEffort===currentEffort)?currentEffort:selected?.defaultReasoningEffort;
 const shownEffort=effort||inheritedEffort;
 const filtered=models.filter(item=>displayModel(item).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const workerEntry=models.find(item=>item.model===workerModel);
 const workerLabel=workerModel==='deepseek-v4-flash'?'DeepSeek Flash':workerEntry?displayModel(workerEntry):workerModel||'未設定';
 const chooseModel=next=>{setModel(next.model);setEffort('');setQuery('');};
 const chooseEffort=next=>{setEffort(next);setPickerOpen(false);triggerRef.current?.focus();};
 return <>
  {loading?<p className="modal-description" role="status">正在載入模型…</p>:error?<div role="alert" className="model-load-error"><p>{error}</p><button onClick={()=>setRevision(value=>value+1)}><RefreshCw size={15}/>重新載入</button></div>:<>
   {selected&&<section className="main-agent-setting" aria-labelledby="main-agent-label">
    <div className="model-setting-copy"><strong id="main-agent-label">主代理</strong><span>模型和推理程度在同一處設定。</span></div>
    <div className="model-selector">
     <button ref={triggerRef} type="button" className="model-selector-trigger" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={()=>setPickerOpen(open=>!open)}>
      <span className="model-mark"><Bot size={19}/></span><span className="model-selector-copy"><strong>{displayModel(selected)}</strong><small>負責目前對話的理解、判斷與整合</small></span><span className="model-badges"><b>主代理</b><b>推理：{effortName[shownEffort]??shownEffort??'模型預設'}</b></span><ChevronDown className={pickerOpen?'open':''} size={16}/>
     </button>
     {pickerOpen&&<div ref={pickerRef} className="model-selector-popover" role="dialog" aria-label="選擇主代理模型與推理程度">
      <label className="model-search"><Search size={15}/><input ref={searchRef} value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜尋主代理模型" aria-label="搜尋主代理模型"/></label>
      <div className="model-selector-columns">
       <div className="model-option-group"><strong>選擇模型</strong><div className="model-options">{filtered.map(item=><button key={item.model} type="button" className={item.model===model?'selected':''} aria-pressed={item.model===model} onClick={()=>chooseModel(item)}><span>{displayModel(item)}<small>{item.inputModalities?.includes('image')?'支援文字與圖片':'支援文字'} · {item.supportedReasoningEfforts?.length??0} 種推理程度</small></span>{item.model===model&&<Check size={16}/>}</button>)}{!filtered.length&&<p>沒有符合的模型。</p>}</div></div>
       <div className="model-option-group"><strong>這個主代理的推理程度</strong><div className="effort-options"><button type="button" className={!effort?'selected':''} aria-pressed={!effort} onClick={()=>chooseEffort('')}><span>模型預設<small>{inheritedEffort?`目前為${effortName[inheritedEffort]??inheritedEffort}`:'由執行環境決定'}</small></span>{!effort&&<Check size={16}/>}</button>{supportedEfforts.map(item=><button key={item.reasoningEffort} type="button" className={effort===item.reasoningEffort?'selected':''} aria-pressed={effort===item.reasoningEffort} onClick={()=>chooseEffort(item.reasoningEffort)}><span>{effortName[item.reasoningEffort]??item.reasoningEffort}</span>{effort===item.reasoningEffort&&<Check size={16}/>}</button>)}</div><p>只影響主代理，不會套用到子代理。</p></div>
      </div>
     </div>}
    </div>
    <p className="model-selection-summary">目前：<strong>{displayModel(selected)} · 推理 {effortName[shownEffort]??shownEffort??'模型預設'}</strong></p>
   </section>}
   {!models.length&&<p className="modal-description">目前沒有可用模型。</p>}
   {mode==='switch'?<>
    {hasHistory&&model!==currentModel?<p className="model-switch-warning" role="note">中途切換模型可能影響接續品質，上下文也可能自動壓縮。原對話與檔案保留，但不保證所有細節都能無損接續。需要完全獨立的工作時，可另開新對話。</p>:<p className="model-routing-note">從下一則訊息開始使用；不會立即執行工作。</p>}
    <p className="model-routing-note">只變更主代理與推理程度；工作區、子代理與操作權限不變。</p>
   </>:<>
   <section className="setting-section" aria-labelledby="worker-setting-label">
    <div className="model-setting-copy"><strong id="worker-setting-label">子代理</strong><span>需要派工時才使用，不是每個對話都要調整。</span></div>
    <details className="worker-settings"><summary><span><strong>派工設定（進階）</strong><small>一般：{workerLabel} · 圖像：GPT-5.6 Luna</small></span><ChevronDown size={16}/></summary><div className="worker-settings-body">
     <label><span>預設一般工人</span><select aria-label="預設一般子代理" value={workerModel} onChange={event=>setWorkerModel(event.target.value)}><option value="deepseek-v4-flash">DeepSeek Flash</option>{!models.some(item=>item.model===workerModel)&&workerModel!=='deepseek-v4-flash'&&<option value={workerModel} disabled>{workerModel}（目前不可用）</option>}{models.map(item=><option key={item.model} value={item.model}>{displayModel(item)}</option>)}</select></label>
     <div className="worker-setting-readonly"><span>圖像判讀工人</span><strong>GPT-5.6 Luna</strong></div>
     <div className="worker-effort-note"><span>子代理推理程度</span><p>不在新對話畫面固定。原生 GPT 子代理由主代理派工時依任務指定；DeepSeek Flash 沿用自己的工作路徑與設定。</p></div>
    </div></details>
   </section>
   <section className="setting-section permission-section" aria-labelledby="permission-setting-label"><div className="model-setting-copy"><strong id="permission-setting-label">操作權限</strong><span>權限與模型選擇分開。</span></div><div><PermissionPicker label="新對話操作權限" value={accessMode} disabled={disabled} onChange={(value,confirmed)=>{setAccessMode(value);setPermissionConfirmed(confirmed);}}/><p className="model-routing-note">{permissionModes[accessMode].description}</p></div></section>
   </>}
  </>}
  <div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={disabled||loading||!!error||!selected||(mode==='create'&&workerModel!=='deepseek-v4-flash'&&!models.some(item=>item.model===workerModel))} onClick={()=>onCreate({model,...(mode==='switch'?{confirmed:hasHistory&&model!==currentModel}:{accessMode,permissionConfirmed,workerPolicy:{model:workerModel}}),...effort?{effort}:{}})}>{mode==='switch'?(hasHistory&&model!==currentModel?'確認切換':'套用模型'):'建立對話'}</button></div>
 </>;
}
