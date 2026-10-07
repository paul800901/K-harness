import {stopThreadTerminals} from './background-terminals.mjs';

export function collectNativeWorkerIds(items){
 return [...new Set(items.flatMap(i=>i.type==='collabAgentToolCall'?i.receiverThreadIds??[]:i.type==='subAgentActivity'&&i.agentThreadId?[i.agentThreadId]:[]))];
}

export async function checkNativeWorkers(host,parentThreadId,ids,{stop=false}={}){
 return Promise.all(ids.map(async threadId=>{
  const result={requestId:`codex:${threadId}`,threadId,provider:'codex',status:'unresolved',settled:false,outputFiles:[]};let lastReadAt;
  try{
   let thread=(await host.request('thread/read',{threadId,includeTurns:true}))?.thread;
   if(!thread||typeof thread!=='object')return {...result,error:'原生子代理狀態讀回資料不完整。'};
   lastReadAt=new Date().toISOString();
   if(thread.parentThreadId!==parentThreadId)return {...result,lastReadAt,error:'原生子代理來源無法確認。'};
   const active=thread.turns?.findLast(t=>t.status==='inProgress');
   if(stop&&active){
    await host.request('turn/interrupt',{threadId,turnId:active.id});
    thread=(await host.request('thread/read',{threadId,includeTurns:true}))?.thread;
    if(!thread||typeof thread!=='object')throw Error('native thread readback was incomplete');
    lastReadAt=new Date().toISOString();
    if(thread.parentThreadId!==parentThreadId)return {...result,lastReadAt,error:'原生子代理來源無法確認。'};
   }
   if(stop&&thread.status?.type!=='notLoaded')await stopThreadTerminals(host,threadId);
   const metadata={lastReadAt,...(typeof thread.model==='string'?{model:thread.model}:{}),...(typeof thread.agentNickname==='string'?{agentNickname:thread.agentNickname}:{}),...(typeof thread.name==='string'?{name:thread.name}:{})};
   const last=thread.turns?.at(-1);
   if(typeof last?.id==='string')metadata.turnId=last.id;
   if(thread.status?.type==='active'||last?.status==='inProgress')return {...result,...metadata,lastReadAt,status:'running'};
   if(['idle','notLoaded'].includes(thread.status?.type)){
    if(['completed','interrupted','failed'].includes(last?.status))return {...result,...metadata,lastReadAt,status:last.status==='interrupted'?'cancelled':last.status,settled:true};
    return {...result,...metadata,lastReadAt,error:'原生子代理最後回合狀態未確認。'};
   }
   return {...result,...metadata,lastReadAt};
  }catch{return {...result,...(lastReadAt?{lastReadAt}:{}),error:'原生子代理狀態讀回失敗。'};}
 }));
}
