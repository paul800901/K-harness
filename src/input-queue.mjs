import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';
// K owns only unsent input. Once delivery is attempted the native core owns execution.
export function createInputQueue({root,getController,onChange=()=>{}}){
 let threadId=null,rows=[],paused=false,chain=Promise.resolve(),draining=false,closed=false,timer,stopEpoch=0;
 const editingWrites=new Map();
 const file=id=>{if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id??''))throw Error('Invalid queue conversation.');return path.join(root,'.runtime/input-queues',id+'.json');};
 const save=()=>{const id=threadId,data=JSON.stringify({rows,paused});if(!id)return Promise.resolve();const next=chain.catch(()=>{}).then(async()=>{await atomicWrite(file(id),data);});chain=next;return next;};
 const notify=()=>onChange();
 const hasWorkers=s=>(s.workers??[]).some(w=>w.executionUnowned!==true&&(w.settled===false||['running','starting','pending','unresolved'].includes(w.status)));
 const readyState=(s,id)=>s.threadId===id&&!s.busy&&!s.goalPending&&!(s.capabilities?.goalContinuesWhileIdle&&s.goal?.status==='active')&&!(s.questions??[]).length&&!hasWorkers(s)&&['ready','completed','failed','interrupted'].includes(s.status);
 const ready=()=>{const s=getController().state;return !closed&&!draining&&!paused&&readyState(s,threadId)&&rows[0]?.status==='queued'&&!editingWrites.has(rows[0]);};
 async function deliver(row,immediate=false){
  const c=getController(),id=threadId,epoch=stopEpoch;if(c.state.threadId!==id)throw Error('對話已切換。');
  if(draining)throw Error('已有訊息正在送出。');
  if(editingWrites.has(row)||row.status==='editing')throw Error('請先完成這則訊息的編輯。');
  if(row.status!=='queued')throw Error('送出狀態未確認，請先查明；不自動重送。');
  if(immediate&&c.state.busy&&c.state.capabilities?.steer===false)throw Error('此核心目前不支援執行中立即送入；訊息與附件保留排隊。');
  draining=true;row.status='sending';notify();
  let attempted=false;
  try{
   await save();
   const current=getController(),s=c.state;
   if(closed||current!==c||threadId!==id||epoch!==stopEpoch||s.threadId!==id)throw Error('送出前對話已切換或停止。');
   if(s.goalPending||(!immediate&&!readyState(s,id))||(immediate&&s.busy&&s.capabilities?.steer===false))throw Error('送出前對話狀態已改變；訊息保留排隊。');
   attempted=true;
   const result=immediate&&s.busy?await c.steer({text:row.text,attachmentIds:row.attachmentIds??[]}):await c.send({text:row.text,attachmentIds:row.attachmentIds??[]});
    if(result?.sent===false){const error=Error('訊息未送出，請查明停止狀態。');error.notSent=true;throw error;}
   rows=rows.filter(x=>x.id!==row.id);await save();return result;
  }catch(error){
    if(rows.includes(row))row.status=attempted&&error.notSent!==true?'uncertain':'queued';paused=true;row.error=error.message;await save().catch(()=>{});throw error;
  }finally{draining=false;notify();api.schedule();}
 }
 const api={
  get state(){const s=getController().state;return {queuedMessages:rows.map(r=>({...r,...editingWrites.get(r)})),queuePaused:paused,queueWaitingReason:rows.length&&hasWorkers(s)?'等待子代理完成':null};},
  async load(id){clearTimeout(timer);await chain;threadId=id;rows=[];paused=false;if(id){try{const saved=JSON.parse(await readFile(file(id),'utf8'));rows=(saved.rows??[]).map(r=>({...r,status:r.status==='sending'?'uncertain':r.status}));paused=rows.length>0;}catch(e){if(e.code!=='ENOENT')throw e;}}notify();},
  async enqueue({text='',attachmentIds=[]}){if(typeof text!=='string'||text.length>32000||(!text.trim()&&(!Array.isArray(attachmentIds)||!attachmentIds.length)))throw Error('請輸入 1–32000 字元的訊息。');if(!threadId||getController().state.threadId!==threadId)throw Error('請先開啟對話。');if(!Array.isArray(attachmentIds)||attachmentIds.some(x=>typeof x!=='string'))throw Error('附件格式無效。');const row={id:randomUUID(),text,attachmentIds,createdAt:new Date().toISOString(),status:'queued'};rows.push(row);try{await save();}catch(e){rows=rows.filter(r=>r!==row);throw e;}notify();api.schedule();return {queued:true,id:row.id};},
  schedule(){if(closed||timer)return;timer=setTimeout(()=>{timer=null;if(ready())void deliver(rows[0]).catch(()=>{});},100);},
  async action({id,action,text}){
   if(action==='resume'){if(rows.some(r=>r.status==='uncertain'))throw Error('有送出未確認的訊息，請先查明並移除該筆。');const s=getController().state;if(!['ready','completed','working','failed','interrupted'].includes(s.status))throw Error(`目前對話狀態「${s.status}」無法繼續排隊。`);paused=false;await save();notify();api.schedule();return {resumed:true};}
   const row=rows.find(r=>r.id===id);if(!row)throw Error('找不到待送訊息，可能已經送出；未修改或重送。');
   if(editingWrites.has(row))throw Error('這則訊息正在儲存，請稍候。');
   if(['edit-start','edit-save','edit-cancel'].includes(action)){
    if(row.status!==(action==='edit-start'?'queued':'editing'))throw Error('只能編輯尚未送出的待送訊息。');
    if(action==='edit-save'&&(typeof text!=='string'||text.length>32000||(!text.trim()&&!row.attachmentIds?.length)))throw Error('請輸入 1–32000 字元的訊息。');
    const before={text:row.text,status:row.status};editingWrites.set(row,before);
    row.status=action==='edit-start'?'editing':'queued';if(action==='edit-save')row.text=text;
    try{await save();}catch(error){Object.assign(row,before);throw error;}finally{editingWrites.delete(row);}
    notify();api.schedule();return {edited:true};
   }
   if(action==='remove'){if(row.status==='sending')throw Error('訊息正在送出，不能撤回。');rows=rows.filter(r=>r!==row);await save();notify();return {removed:true};}
   if(action==='send-now')return deliver(row,true);throw Error('未知的佇列操作。');
  },
  async pause(){stopEpoch++;paused=true;clearTimeout(timer);timer=null;await save();notify();},
  async close(){closed=true;await api.pause();await chain;},
  get sending(){return draining||editingWrites.size>0;}
 };return api;
}
