export function codexQuota(result,checkedAt=new Date().toISOString()) {
 const bucket=result?.rateLimitsByLimitId?result.rateLimitsByLimitId.codex:result?.rateLimits;
 const windows=['primary','secondary'].map(key=>{
  const w=bucket?.[key];
  return {key,remainingPercent:Number.isFinite(w?.usedPercent)?Math.min(100,Math.max(0,100-w.usedPercent)):null,
   minutes:Number.isFinite(w?.windowDurationMins)?w.windowDurationMins:null,resetsAt:Number.isFinite(w?.resetsAt)?w.resetsAt:null};
 });
 return {status:windows.some(w=>w.remainingPercent!==null)?'available':'unavailable',windows,checkedAt};
}
