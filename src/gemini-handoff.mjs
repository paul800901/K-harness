// Retain independent ready and waiting receipts until their own notification is
// consumed. A later observation must not erase another job's ready event.
const keys=['requestIds','queryIds'];
function combine(events){
 if(!events.length)return null;
 const status=events.some(e=>e.status==='ready')?'ready':events.some(e=>e.status==='waiting')?'waiting':'blocked';
 const selected=events.filter(e=>e.status===status),last=selected.at(-1);
 return {...last,...Object.fromEntries(keys.map(key=>[key,[...new Set(selected.flatMap(e=>e[key]??[]))]])),events};
}
export function mergeGeminiHandoff(previous,event){
 const {events:ignored,...next}=event;
 const events=[];
 if(previous?.epoch===event.epoch)for(const old of previous.events??[previous]){
  const retained={...old};
  for(const key of keys)retained[key]=(old[key]??[]).filter(id=>!(event[key]??[]).includes(id));
  if(keys.some(key=>retained[key].length))events.push(retained);
 }
 events.push(next);return combine(events);
}
export function consumeGeminiHandoff(value,delivered=value){
 const status=delivered?.status;
 const sent=Object.fromEntries(keys.map(key=>[key,new Set((delivered?.events??[]).filter(e=>e.status===status).flatMap(e=>e[key]??[]))]));
 return combine((value?.events??[]).flatMap(e=>{
  if(!['ready','blocked'].includes(status)||e.status!==status)return [e];
  const remaining={...e,...Object.fromEntries(keys.map(key=>[key,(e[key]??[]).filter(id=>!sent[key].has(id))]))};
  return keys.some(key=>remaining[key].length)?[remaining]:[];
 }));
}
// A successful wait result already delivered this exact scheduling receipt to
// the main agent. Do not wake it again for the same ID; retain other rooms/jobs.
export function consumeGeminiWaitResult(value,requestId,result){
 const scheduling=result?.scheduling;
 if(!['ready','blocked'].includes(scheduling?.status))return value;
 const events=(value?.events??[]).filter(e=>e.status===scheduling.status&&e.accountId===scheduling.accountId)
  .map(e=>({...e,requestIds:(e.requestIds??[]).filter(id=>id===requestId),queryIds:(e.queryIds??[]).filter(id=>id===requestId)}));
 return consumeGeminiHandoff(value,{status:scheduling.status,events});
}
export function geminiWaitingJobs(value){return new Set((value?.events??(value?[value]:[])).filter(e=>e.status==='waiting').flatMap(e=>e.requestIds??[]));}
export function geminiAccountWait(value){
 const events=(value?.events??(value?[value]:[])).filter(e=>['waiting','ready'].includes(e.status));
 return events.length?Object.fromEntries(keys.map(key=>[key,[...new Set(events.flatMap(e=>e[key]??[]))]])):null;
}

export function geminiHandoffText(event){
 if(event.status==='blocked')return 'K 帳號排程已結束，但接續條件未就緒。這是新的排程結果通知，不是重送工單、就緒或恢復原生目標的授權。'+
  '請核對下列原因與已保存成果，保留受阻狀態；需要本人登入或決定時清楚回報。不要重複查詢相同狀態，不得將未知當額度耗盡，也不自行換模型、重派或重播工作。queryIds 不是工作 ID。\n'+JSON.stringify(event)+'\n';
 const receipts=(event.events??[event]).filter(e=>e.status==='ready'),mixed=receipts.some(e=>e.switched!==event.switched);
 return 'K 已核對目前共用 Gemini 帳號，排程條件已就緒。'+
  (mixed?'這次合併多筆就緒事件，切帳與可接手範圍各依下列原始事件，不把不同事件當成同一次切帳。':event.switched===true?'官方額度確認歸零，帳號已查核切換就緒。':'本次通知未切換帳號；不表示之前沒有其他聊天室換過帳號。')+
  '這不是原工單重播。queryIds 是帳號觀察，不是工作 ID，不可拿來 handoffFrom。'+
  (!mixed&&event.switched===false?'本次就緒只涵蓋 event.requestIds 中先前未送出的工作，以及 queryIds 的帳號觀察；其他已執行後失敗工單不因本次通知自動重啟。':'本次就緒只涵蓋 event.requestIds 與 queryIds，其他失敗不在範圍內。')+
  '先核對最新本人意圖與已保存成果；工單接手僅限通知 requestIds 的剩餘工作。'+
  '剩餘工作使用新的 requestId，已存在工單用 handoffFrom；新工單通常省略 accountId，由 K 核對目前共用帳號。'+
  '不得重播未知結果、改模型、預算或權限；本人暫停／停止／改目標優先。有新的實質變化時 K 可再次通知；不要為不變的狀態輪詢帳號或只因等待就宣告受阻。\n'+JSON.stringify(event)+'\n';
}
