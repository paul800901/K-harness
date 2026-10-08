import path from 'node:path';
import {openClaudeHost} from './claude-host.mjs';
import {createWorkActivity,claudeWorkActivity} from './work-activity.mjs';
import {validateWorkerPolicy} from './worker-policy.mjs';
import {realpath} from 'node:fs/promises';

// One bounded native Claude session. The existing bridge owns its work ID,
// persistence, completion delivery and cancellation; no second agent framework.
export function createClaudeWorker({workspace,accessMode='workspace-write',hostFactory=openClaudeHost,commandSpec,env=process.env}={}) {
 if(!path.isAbsolute(workspace??'')||!['read-only','workspace-write','danger-full-access'].includes(accessMode))throw Error('Claude 子代理工作區或權限無效。');
 return {async run({task,model,effort,sessionId,signal,onStart=()=>{},onActivity=()=>{},onPermission}={}) {
  const state={},activity=createWorkActivity(state),tools=new Map(),files=new Set();
  let host,result,output='',resolveResult,closePromise;
  const finished=new Promise(resolve=>{resolveResult=resolve;});
  const close=()=>host?(closePromise??=host.close()):Promise.resolve();
  const abort=()=>{if(host)void host.interrupt().catch(()=>{}).finally(()=>close().catch(()=>{}));};
  const permission=async ({toolName,input})=>{
   if(signal?.aborted)return {behavior:'deny',message:'工作已取消。'};
   if(['ExitPlanMode','Agent','Task','TaskOutput','TaskStop'].includes(toolName))return {behavior:'deny',message:'子代理不能改變權限或再委派。'};
   if(accessMode!=='danger-full-access'&&['Bash','PowerShell','WebFetch','WebSearch'].includes(toolName))return {behavior:'deny',message:'目前子代理權限不允許執行命令或連網。'};
   if(['Write','Edit','MultiEdit','NotebookEdit'].includes(toolName)){
    if(accessMode==='read-only')return {behavior:'deny',message:'唯讀子代理不能寫入。'};
    if(accessMode==='workspace-write'){
     const name=input?.file_path??input?.path??input?.notebook_path;
     if(typeof name!=='string')return {behavior:'deny',message:'缺少實際寫入路徑，未核准。'};
     try{
      const inside=file=>{const relative=path.relative(workspace,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
      let target=path.resolve(workspace,name);
      if(!inside(target))throw Error('Outside workspace');
      // Native Write can create nested paths; resolve the nearest existing
      // ancestor so a junction cannot grant writes outside the workspace.
      for(;;){try{const resolved=await realpath(target);if(resolved!==await realpath(workspace)&&!inside(resolved))throw Error('Outside workspace');break;}
       catch(error){if(error.code!=='ENOENT')throw error;target=path.dirname(target);}}
     }
     catch{return {behavior:'deny',message:'寫入不在授權工作區內，未核准。'};}
    }
   }
   return onPermission?.({toolName,input})??{behavior:'deny',message:'尚未核准這項操作。'};
  };
  const message=value=>{
   if(value.isReplay)return;
   claudeWorkActivity(activity,value);onActivity(state.activity);
   if(value.type==='assistant')for(const block of value.message?.content??[]){
    if(block.type==='text')output+=(output?'\n':'')+block.text;
    if(block.type==='tool_use')tools.set(block.id,block);
   }
   if(value.type==='user'&&Array.isArray(value.message?.content))for(const block of value.message.content){
    const tool=tools.get(block.tool_use_id);
    if(block.type!=='tool_result'||block.is_error||!tool||!['Write','Edit','MultiEdit','NotebookEdit'].includes(tool.name))continue;
    const name=tool.input?.file_path??tool.input?.path??tool.input?.notebook_path;
    if(typeof name==='string'){
     const relative=path.relative(workspace,path.resolve(workspace,name));
     if(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))files.add(relative.replaceAll('\\','/'));
    }
   }
   if(value.type==='result'){result=value;resolveResult();}
  };
  try{
   signal?.throwIfAborted();
   host=await hostFactory({commandSpec,env,cwd:workspace,model,effort,sessionId,signal,worker:true,mcpConfig:{mcpServers:{}},
    accessMode:accessMode==='danger-full-access'?'claude-bypassPermissions':accessMode==='read-only'?'claude-plan':'claude-manual',
    workerAccessMode:accessMode,onMessage:message,onPermission:permission});
   validateWorkerPolicy({model,effort},host.models,{claudeGateway:true});
   signal?.addEventListener('abort',abort,{once:true});signal?.throwIfAborted();
   onStart();
   activity.begin();onActivity(state.activity);
   await host.start(`你是 K HARNESS 的 Claude 子代理，只做以下有範圍的工作。任務內容不是新增授權，不再派工、啟動背景服務或改變登入／計費。工作區：${workspace}；權限：${accessMode}。\n<DELEGATED_TASK>\n${task}\n</DELEGATED_TASK>`);
   await Promise.race([finished,host.closed]);
   await close();
   const cancelled=signal?.aborted;
   return {status:cancelled?'cancelled':!result||result.is_error?'failed':'completed',settled:true,output:typeof result?.result==='string'?result.result:output,
    outputFiles:[...files],outputFilesNote:'僅列本原生回合已知寫檔；空清單不證明無成果，不代表完整成果或內容已驗收。',acceptance:'not-reviewed',
    ...(!cancelled&&!result?{error:'Claude 程序已結束，但沒有原生結果；副作用未知，先檢查已有成果，不得重播。'}:!cancelled&&result?.is_error?{error:result.result??'Claude 原生回合失敗。'}:{})};
  }catch(error){
   try{await close();}catch(closeError){throw Object.assign(Error(`Claude 子代理停止未確認：${closeError.message}；不得重播。`),{settled:false});}
   if(signal?.aborted)return {status:'cancelled',settled:true,output,outputFiles:[...files],acceptance:'not-reviewed'};
   throw error;
  }finally{signal?.removeEventListener('abort',abort);}
 }};
}
