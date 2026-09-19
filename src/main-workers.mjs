import {lstat,realpath} from 'node:fs/promises';
import {checkedPath} from './files.mjs';
import path from 'node:path';
const terminal = new Set(['completed','cancelled','failed']);
export function collectWorkerIds(items) {
  return [...new Set(items.filter(item=>item.type==='mcpToolCall'&&item.server==='k_flash'&&['k_worker_start','k_worker_run'].includes(item.tool))
    .map(item=>item.arguments?.requestId).filter(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/u.test(id)))];
}

// Scope comes from this conversation's original tool items, never from guessed
// job names or an unrestricted scan of other conversations.
export async function checkMainWorkers(host, threadId, ids, {stop=false,workspace}={}) {
  const call=async(tool,requestId,extra={})=>{
    const result=await host.request('mcpServer/tool/call',{threadId,server:'k_flash',tool,arguments:{requestId,...extra}},tool==='k_worker_wait'?65000:30000);
    if(result.isError||!result.structuredContent?.status)throw new Error('Worker status unavailable.');
    return result.structuredContent;
  };
  return Promise.all(ids.map(async requestId=>{
    try {
      let result=await call('k_worker_inspect',requestId);
      if(workspace&&result.workspace&&path.relative(workspace,result.workspace)!=='')throw new Error('Worker belongs to another workspace.');
      if(stop&&result.status==='running') {
        await call('k_worker_cancel',requestId);
        result=await call('k_worker_wait',requestId,{timeoutMs:60000});
      }
      let recovery=null;
      if(['unresolved','cancelled','failed'].includes(result.status)){
        try{recovery=await call('k_worker_recover',requestId);}catch{/* Inspect status remains authoritative even if detailed recovery is unavailable. */}
      }
      const artifacts=[];
      if(workspace)for(const name of result.outputFiles??[]){
        let observation='unavailable';
        try{const target=await checkedPath(await realpath(workspace),name,false);await lstat(target);observation='present';}
        catch(error){if(error.code==='ENOENT')observation='missing';}
        artifacts.push({path:name,observation});
      }
      return {requestId,status:result.status,settled:terminal.has(result.status),outputFiles:result.outputFiles??[],artifacts,recovery,acceptance:'not-reviewed'};
    } catch {
      return {requestId,status:'unavailable',settled:false,acceptance:'not-reviewed'};
    }
  }));
}
