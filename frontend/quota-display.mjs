// Presentation only: never infer replenishment or change provider quota records.
export const quotaIsHistorical=(quota,online=true)=>!online||!['ready','available'].includes(quota?.status);
export const quotaPercent=window=>Number.isFinite(window?.remainingPercent)?`${window.remainingPercent}%`:'—';
export function quotaReset(window,now=Date.now()){
 if(!Number.isFinite(window?.resetsAt)||window.resetsAt<=0)return '官方未提供';
 const at=window.resetsAt*1000;
 return `${new Date(at).toLocaleString('zh-TW')}${at<=now?'（已過）':''}`;
}
