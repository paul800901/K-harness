// Presentation only: never infer replenishment or change provider quota records.
export function quotaIsHistorical(quota,online=true,now=Date.now()){
 if(!online||!['ready','available'].includes(quota?.status))return true;
 const queried=Date.parse(quota.checkedAt??'');
 // Only a reset crossed after this official query invalidates its window.
 // Providers can legitimately report a past reset in a new successful query.
 return quota.windows?.some(w=>Number.isFinite(w.resetsAt)&&w.resetsAt>0&&w.resetsAt*1000<=now&&(!Number.isFinite(queried)||w.resetsAt*1000>queried))??false;
}
export const quotaPercent=window=>window?.disabled===true?'未啟用':Number.isFinite(window?.remainingPercent)?`${window.remainingPercent}%`:'—';
export function quotaReset(window,now=Date.now()){
 if(window?.disabled===true)return '不適用（官方未啟用）';
 if(!Number.isFinite(window?.resetsAt)||window.resetsAt<=0)return '官方未提供';
 const at=window.resetsAt*1000;
 return `${new Date(at).toLocaleString('zh-TW')}${at<=now?'（已過）':''}`;
}

// Dated presentation only; never computes effective availability or changes quota.
export function weeklyQuotaNote(quota,online=true,now=Date.now()){
 if(quotaIsHistorical(quota,online,now)||!Number.isFinite(Date.parse(quota?.checkedAt??'')))return null;
 return quota.windows?.some(w=>w.key==='seven_day'&&w.remainingPercent===0)?'上次實查：每週額度已用完':null;
}
