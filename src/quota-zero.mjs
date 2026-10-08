// Only a dated official zero with a future reset suppresses automatic queries.
// Stale results can retain that evidence; failures never create a new zero.
export function quotaZeroUntil(quota,now=Date.now()) {
 if(!['ready','available','stale'].includes(quota?.status))return null;
 const resets=(quota.windows??[]).filter(w=>w.remainingPercent===0&&Number.isFinite(w.resetsAt)&&w.resetsAt*1000>now).map(w=>w.resetsAt*1000);
 return resets.length?Math.max(...resets):null;
}

export function quotaZeroRecheckDue(quota,now=Date.now()) {
 if(!['ready','available'].includes(quota?.status))return false;
 const observed=Date.parse(quota.checkedAt??'');
 const until=Number.isFinite(observed)?quotaZeroUntil(quota,observed):null;
 return until!==null&&until<=now;
}
