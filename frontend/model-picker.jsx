import React,{useEffect,useState} from 'react';
import {Check,RefreshCw} from 'lucide-react';
import {PermissionPicker,permissionModes} from './permission-picker.jsx';

export const effortName={none:'無',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'極高',max:'最高',ultra:'超高（Ultra）'};

export function ModelPicker({currentModel,currentWorkerModel,currentEffort,mode='create',hasHistory=false,disabled,loadModels,onCatalog,onClose,onCreate}){
 const [models,setModels]=useState([]),[model,setModel]=useState(''),[effort,setEffort]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [workerModel,setWorkerModel]=useState(currentWorkerModel||'deepseek-v4-flash');
 const [accessMode,setAccessMode]=useState('workspace-write');
 const [permissionConfirmed,setPermissionConfirmed]=useState(false);
 useEffect(()=>{
  let cancelled=false;setLoading(true);setError('');
  loadModels().then(({models:list})=>{
   if(cancelled)return;
   setModels(list);onCatalog(list);
   setModel(list.some(m=>m.model===currentModel)?currentModel:list.find(m=>m.isDefault)?.model??list[0]?.model??'');
  }).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[revision]);
 const selected=models.find(m=>m.model===model);
 return <>
  {loading?<p className="modal-description" role="status">正在載入模型…</p>:error?<div role="alert" className="model-load-error"><p>{error}</p><button onClick={()=>setRevision(n=>n+1)}><RefreshCw size={15}/>重新載入</button></div>:<>
   <div className="model-picker-list" role="group" aria-label="主代理模型">{models.map(m=><button key={m.model} type="button" aria-pressed={model===m.model} className={model===m.model?'chosen':''} onClick={()=>{setModel(m.model);setEffort('');}}><span>{m.displayName||m.model}</span>{model===m.model&&<Check size={18}/>}</button>)}</div>
   {!models.length&&<p className="modal-description">目前沒有可用模型。</p>}
   {selected&&<label className="setting-row"><span>推理程度</span><select aria-label={mode==='switch'?'切換後推理程度':'新對話推理程度'} value={effort} onChange={e=>setEffort(e.target.value)}><option value="">{mode==='switch'?`沿用／模型預設（${effortName[selected.supportedReasoningEfforts?.some(e=>e.reasoningEffort===currentEffort)?currentEffort:selected.defaultReasoningEffort]??'預設'}）`:'沿用設定'}</option>{selected.supportedReasoningEfforts?.map(e=><option key={e.reasoningEffort} value={e.reasoningEffort}>{effortName[e.reasoningEffort]??e.reasoningEffort}</option>)}</select></label>}
   {mode==='switch'?<>
    {hasHistory&&model!==currentModel?<p className="model-switch-warning" role="note">中途切換模型可能影響接續品質，上下文也可能自動壓縮。原對話與檔案保留，但不保證所有細節都能無損接續。需要完全獨立的工作時，可另開新對話。</p>:<p className="model-routing-note">從下一則訊息開始使用；不會立即執行工作。</p>}
    <p className="model-routing-note">只變更主代理與推理程度；工作區、子代理與操作權限不變。</p>
   </>:<>
   <label className="setting-row"><span>預設子代理</span><select aria-label="預設子代理" value={workerModel} onChange={e=>setWorkerModel(e.target.value)}><option value="deepseek-v4-flash">DeepSeek Flash</option>{!models.some(m=>m.model===workerModel)&&workerModel!=='deepseek-v4-flash'&&<option value={workerModel} disabled>{workerModel}（目前不可用）</option>}{models.map(m=><option key={m.model} value={m.model}>{m.displayName||m.model}</option>)}</select></label>
   <p className="model-routing-note">需要時才委派；圖像子代理使用 Luna。</p>
   <div className="setting-row"><span>操作權限</span><PermissionPicker label="新對話操作權限" value={accessMode} disabled={disabled} onChange={(value,confirmed)=>{setAccessMode(value);setPermissionConfirmed(confirmed);}}/></div>
   <p className="model-routing-note">{permissionModes[accessMode].description}</p>
   </>}
  </>}
  <div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={disabled||loading||!!error||!selected||(mode==='create'&&workerModel!=='deepseek-v4-flash'&&!models.some(m=>m.model===workerModel))} onClick={()=>onCreate({model,...(mode==='switch'?{confirmed:hasHistory&&model!==currentModel}:{accessMode,permissionConfirmed,workerPolicy:{model:workerModel}}),...effort?{effort}:{}})}>{mode==='switch'?(hasHistory&&model!==currentModel?'確認切換':'套用模型'):'建立對話'}</button></div>
 </>;
}
