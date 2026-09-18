import {stopThreadTerminals} from './background-terminals.mjs';

export function collectNativeWorkerIds(items){
 return [...new Set(items.flatMap(i=>i.type==='collabAgentToolCall'?i.receiverThreadIds??[]:i.type==='subAgentActivity'&&i.agentThreadId?[i.agentThreadId]:[]))];
}

export async function checkNativeWorkers(host,parentThreadId,ids,{stop=false}={}){
 return Promise.all(ids.map(async threadId=>{
  const result={requestId:`codex:${threadId}`,threadId,provider:'codex',status:'unresolved',settled:false,outputFiles:[]};
  try{
   let {thread}=await host.request('thread/read',{threadId,includeTurns:true});
   if(thread.parentThreadId!==parentThreadId)return result;
   const active=thread.turns?.findLast(t=>t.status==='inProgress');
   if(stop&&active){
    await host.request('turn/interrupt',{threadId,turnId:active.id});
    ({thread}=await host.request('thread/read',{threadId,includeTurns:true}));
    if(thread.parentThreadId!==parentThreadId)return result;
   }
   if(stop&&thread.status?.type!=='notLoaded')await stopThreadTerminals(host,threadId);
   const last=thread.turns?.at(-1);
   if(thread.status?.type==='active'||last?.status==='inProgress')return {...result,status:'running'};
   if(['idle','notLoaded'].includes(thread.status?.type))return {...result,status:last?.status==='interrupted'?'cancelled':last?.status==='failed'?'failed':'completed',settled:true};
   return result;
  }catch{return result;}
 }));
}
