import path from 'node:path';
import {inspectJob,namedJobDirectory,readTranscript} from './worker.mjs';

export function codexQuota(result,checkedAt=new Date().toISOString()) {
 const bucket=result?.rateLimitsByLimitId?result.rateLimitsByLimitId.codex:result?.rateLimits;
 const windows=['primary','secondary'].map(key=>{
  const w=bucket?.[key];
  return {key,remainingPercent:Number.isFinite(w?.usedPercent)?Math.min(100,Math.max(0,100-w.usedPercent)):null,
   minutes:Number.isFinite(w?.windowDurationMins)?w.windowDurationMins:null,resetsAt:Number.isFinite(w?.resetsAt)?w.resetsAt:null};
 });
 return {status:windows.some(w=>w.remainingPercent!==null)?'available':'unavailable',windows,checkedAt};
}

// Each JSONL assistant message is one provider response. Cached input and
// reasoning are already included in totalTokens; never add them again.
export function transcriptTokens(records) {
 let totalTokens=0,responses=0,missing=0;const seen=new Set();
 for(const record of records){
  if(record.type!=='message'||record.message?.role!=='assistant')continue;
  if(record.id&&seen.has(record.id))continue;if(record.id)seen.add(record.id);
  const m=record.message;
  if(m.provider!=='deepseek')continue;
  const n=m.usage?.totalTokens;
  // Pi's error/abort placeholders can have synthetic zero usage, not a
  // provider confirmation that the interrupted call was free.
  if(!Number.isSafeInteger(n)||n<0||(n===0&&['error','aborted'].includes(m.stopReason))){missing++;continue;}
  totalTokens+=n;responses++;
 }
 return {totalTokens,responses,missing};
}

export async function flashUsage(appRoot,workspace,ids) {
 let totalTokens=0,responses=0,unconfirmed=0,pending=0;
 for(const id of new Set(ids)){
  try{
   const directory=namedJobDirectory(path.join(appRoot,'.runtime/jobs'),id);
   const job=await inspectJob(directory);
   if(job.provider!=='deepseek'||path.relative(workspace,job.workspace)!=='')throw Error('Wrong workspace/provider');
   const usage=transcriptTokens(await readTranscript(directory));
   totalTokens+=usage.totalTokens;responses+=usage.responses;
   if(usage.missing||(!usage.responses&&job.modelTurns>0))unconfirmed++;
   if(['running','unresolved'].includes(job.status))pending++;
  }catch{unconfirmed++;}
 }
 return {totalTokens,responses,unconfirmed,pending,checkedAt:new Date().toISOString()};
}
