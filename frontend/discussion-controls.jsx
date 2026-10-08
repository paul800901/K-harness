import React,{useState,useEffect} from 'react';
import {discussionModes,discussionStatus} from '../shared/discussion.mjs';
import {effortName} from './model-picker.jsx';
import {modelProvider} from '../shared/model-provider.mjs';
import './discussion.css';

export function useDiscussionConfig(threadId){
 const key=`k-discussion:${threadId}`;
 const read=()=>{try{return JSON.parse(sessionStorage.getItem(key))??{mode:'normal',participants:[],includeContext:true};}catch{return {mode:'normal',participants:[],includeContext:true};}};
 const [config,setConfig]=useState(read);
 useEffect(()=>setConfig(read()),[threadId]);
 const update=next=>{setConfig(next);sessionStorage.setItem(key,JSON.stringify(next));};
 return [config,update];
}

export function DiscussionControls({state,models=[],config,onChange,loadModels,onCatalog,disabled}){
 const [expanded,setExpanded]=useState(false);
 const [catalogError,setCatalogError]=useState('');
 const d=state.discussion,running=d?.busy;
 useEffect(()=>{if(running)setExpanded(false);},[running]);
 const available=models.filter(m=>m.available!==false&&m.hidden!==true);
 const defaults=[{model:state.model,effort:state.effort??''},{model:available.find(m=>modelProvider(m.model)!==modelProvider(state.model))?.model??available.find(m=>m.model!==state.model)?.model??'',effort:''}];
 const participants=config.participants?.length?config.participants:defaults;
 const change=fields=>onChange({...config,...fields});
 const changeParticipant=(index,fields)=>change({participants:participants.map((p,i)=>i===index?{...p,...fields}:p)});
 useEffect(()=>{if(config.mode==='normal'||models.length||!loadModels)return;let present=true;loadModels().then(result=>{if(present)onCatalog(result.models);}).catch(error=>{if(present)setCatalogError(error.message);});return()=>{present=false;};},[config.mode,models.length]);
 useEffect(()=>{if(config.mode!=='normal'&&!config.participants?.length&&available.length&&defaults[1].model)change({participants:defaults});},[models,state.model,config.mode]);
 return <section className="discussion-controls" aria-label="多模型討論">
  <div className="discussion-toolbar">
   <label><span className="sr-only">對話模式</span><select aria-label="對話模式" value={running?d.mode:config.mode} disabled={disabled||running} onChange={e=>{change({mode:e.target.value,participants:available.length?participants:[]});setExpanded(e.target.value!=='normal');}}>
    <option value="normal">一般對話</option>{Object.entries(discussionModes).map(([value,label])=><option value={value} key={value}>{label}</option>)}
   </select></label>
   {!running&&config.mode!=='normal'&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>參與者與背景</button>}
   {running&&<label><span>補充給</span><select aria-label="補充給" value={config.target??''} onChange={e=>change({target:e.target.value})} disabled={d.status==='stopping'||d.status==='finishing'}><option value="">AI 安排</option><option value="all">全體</option>{d.participants.map(p=><option key={p.id} value={p.id}>{p.displayName??p.model}{p.effort?`／${effortName[p.effort]??p.effort}`:''}</option>)}</select></label>}
   {d&&<small role="status">{discussionModes[d.mode]} · {discussionStatus[d.status]??d.status}</small>}
  </div>
  {!running&&config.mode!=='normal'&&expanded&&<div className="discussion-settings">
   <p>由目前主模型主持，AI 自動安排與整理，保留不同意見。只討論，不自動執行工作。</p>
   {participants.map((p,index)=>{const selected=available.find(m=>m.model===p.model),efforts=selected?.supportedReasoningEfforts??[];return <div className="discussion-participant" key={index}>
    <select aria-label={`參與模型 ${index+1}`} value={p.model} onChange={e=>changeParticipant(index,{model:e.target.value,effort:''})}><option value="">選擇模型</option>{available.map(m=><option key={m.model} value={m.model}>{m.displayName??m.model}</option>)}</select>
    {!!efforts.length&&<select aria-label={`參與模型 ${index+1} 推理程度`} value={p.effort??''} onChange={e=>changeParticipant(index,{effort:e.target.value})}><option value="">模型預設</option>{efforts.map(level=>{const value=typeof level==='string'?level:level.reasoningEffort;return <option key={value} value={value}>{effortName[value]??value}</option>;})}</select>}
    {participants.length>2&&<button type="button" aria-label={`移除參與模型 ${index+1}`} onClick={()=>change({participants:participants.filter((_,i)=>i!==index)})}>移除</button>}
   </div>;})}
   <button type="button" onClick={()=>change({participants:[...participants,{model:'',effort:''}]})}>加入參與者</button>
   <label className="discussion-context"><input type="checkbox" checked={config.includeContext!==false} onChange={e=>change({includeContext:e.target.checked})}/>帶入前面對話，由 AI 整理背景</label>
   {config.mode==='parallel'&&<small>首答互不可見。不帶入前面對話時，只依新問題與本次文字附件獨立回答。</small>}
   {config.mode==='review'&&<label className="discussion-review"><span>被審查內容（留白時用最近完整回覆）</span><textarea aria-label="被審查內容" value={config.reviewTarget??''} onChange={e=>change({reviewTarget:e.target.value})} maxLength={16000}/></label>}
   <small>可提供文字／已擷取文字的文件；圖片與影音仍在一般原生對話處理。討論模型不直接讀工作區檔案。</small>
  </div>}
  {d?.error&&<p className="discussion-error" role="alert">{d.error}</p>}
  {catalogError&&<p className="discussion-error" role="alert">{catalogError}</p>}
 </section>;
}
