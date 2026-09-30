import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';
// K owns only unsent input. Once delivery is attempted the native core owns execution.
export function createInputQueue({root,getController,onChange=()=>{}}){
 let threadId=null,rows=[],paused=false,chain=Promise.resolve(),draining=false,closed=false,timer,stopEpoch=0;
 const file=id=>{if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id??''))throw Error('Invalid queue conversation.');return path.join(root,'.runtime/input-queues',id+'.json');};
 const save=()=>{const id=threadId,data=JSON.stringify({rows,paused});if(!id)return Promise.resolve();const next=chain.catch(()=>{}).then(async()=>{await atomicWrite(file(id),data);});chain=next;return next;};
 const notify=()=>onChange();
 const hasWorkers=s=>(s.workers??[]).some(w=>w.settled===false||['running','starting','pending','unresolved'].includes(w.status));
 const ready=()=>{const s=getController().state;return !closed&&!draining&&!paused&&s.threadId===threadId&&!s.busy&&!(s.questions??[]).length&&!hasWorkers(s)&&['ready','completed','failed','interrupted'].includes(s.status)&&rows[0]?.status==='queued';};
 async function deliver(row,immediate=false){
  const c=getController(),id=threadId,epoch=stopEpoch;if(c.state.threadId!==id)throw Error('對話已切換。');
  if(draining)throw Error('已有訊息正在送出。');
  if(row.status!=='queued')throw Error('送出狀態未確認，請先查明；不自動重送。');
  if(immediate&&c.state.busy&&row.attachmentIds?.length)throw Error('執行中立即送入目前只支援文字；附件保留排隊。');
  draining=true;row.status='sending';notify();
  let attempted=false;
  try{
   await save();
   if(closed||getController()!==c||threadId!==id||epoch!==stopEpoch)throw Error('送出前對話已切換或停止。');
   attempted=true;
   const result=immediate&&c.state.busy?await c.steer({text:row.text}):await c.send({text:row.text,attachmentIds:row.attachmentIds??[]});
   if(result?.sent===false)throw Error('訊息未送出，請查明停止狀態。');
   rows=rows.filter(x=>x.id!==row.id);await save();return result;
  }catch(error){
   if(rows.includes(row))row.status=attempted?'uncertain':'queued';paused=true;row.error=error.message;await save().catch(()=>{});throw error;
  }finally{draining=false;notify();api.schedule();}
 }
 const api={
  get state(){const s=getController().state;return {queuedMessages:rows.map(r=>({...r})),queuePaused:paused,queueWaitingReason:rows.length&&hasWorkers(s)?'等待 Luna 完成':null};},
  async load(id){clearTimeout(timer);await chain;threadId=id;rows=[];paused=false;if(id){try{const saved=JSON.parse(await readFile(file(id),'utf8'));rows=(saved.rows??[]).map(r=>({...r,status:r.status==='sending'?'uncertain':r.status}));paused=rows.length>0;}catch(e){if(e.code!=='ENOENT')throw e;}}notify();},
  async enqueue({text,attachmentIds=[]}){if(typeof text!=='string'||!text.trim()||text.length>32000)throw Error('請輸入 1–32000 字元的訊息。');if(!threadId||getController().state.threadId!==threadId)throw Error('請先開啟對話。');if(!Array.isArray(attachmentIds)||attachmentIds.length>8||attachmentIds.some(x=>typeof x!=='string'))throw Error('附件格式無效。');const row={id:randomUUID(),text,attachmentIds,createdAt:new Date().toISOString(),status:'queued'};rows.push(row);try{await save();}catch(e){rows=rows.filter(r=>r!==row);throw e;}notify();api.schedule();return {queued:true,id:row.id};},
  schedule(){if(closed||timer)return;timer=setTimeout(()=>{timer=null;if(ready())void deliver(rows[0]).catch(()=>{});},100);},
  async action({id,action}){if(action==='resume'){if(rows.some(r=>r.status==='uncertain'))throw Error('有送出未確認的訊息，請先查明並移除該筆。');const s=getController().state;if(!['ready','completed','working','failed','interrupted'].includes(s.status))throw Error(`目前對話狀態「${s.status}」無法繼續排隊。`);paused=false;await save();notify();api.schedule();return {resumed:true};}const row=rows.find(r=>r.id===id);if(!row)throw Error('找不到待送訊息。');if(action==='remove'){if(row.status==='sending')throw Error('訊息正在送出，不能撤回。');rows=rows.filter(r=>r!==row);await save();notify();return {removed:true};}if(action==='send-now')return deliver(row,true);throw Error('未知的佇列操作。');},
  async pause(){stopEpoch++;paused=true;clearTimeout(timer);timer=null;await save();notify();},
  async close(){closed=true;await api.pause();await chain;},
  get sending(){return draining;}
 };return api;
}
