import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaIsHistorical,quotaPercent,quotaReset,weeklyQuotaNote} from '../frontend/quota-display.mjs';
test('quota display separates history and unknown from a current zero balance',()=>{
 assert.equal(quotaIsHistorical({status:'ready'}),false);
 assert.equal(quotaIsHistorical({status:'available'}),false);
 assert.equal(quotaIsHistorical({status:'stale'}),true);
 assert.equal(quotaIsHistorical({status:'ready'},false),true);
 assert.equal(quotaIsHistorical(),true);
 assert.equal(quotaPercent({remainingPercent:0}),'0%');
 assert.equal(quotaPercent({remainingPercent:100}),'100%');
 assert.equal(quotaPercent({remainingPercent:null}),'—');
});
test('expired reset stays historical, never rolls forward or invents replenishment',()=>{
 const w={remainingPercent:0,resetsAt:1791237484},now=w.resetsAt*1000+1;
 assert.match(quotaReset(w,now),/（已過）$/u);
 assert.doesNotMatch(quotaReset(w,now-2),/已過/u);
 assert.equal(w.remainingPercent,0);assert.equal(w.resetsAt,1791237484);
 assert.equal(quotaReset({}),'官方未提供');
 // A fresh official quota remains usable even if its reported reset is in the past.
 assert.equal(quotaIsHistorical({status:'ready',checkedAt:new Date(now).toISOString(),windows:[w]},true,now),false);
});
test('display follows the official reset, not a 60-second or five-minute expiry',()=>{
 const checked=Date.parse('2026-10-07T00:00:00Z'),reset=checked+7*86400000;
 const quota={status:'ready',checkedAt:new Date(checked).toISOString(),windows:[{remainingPercent:0,resetsAt:reset/1000}]};
 for(const elapsed of [60000,300000,86400000])assert.equal(quotaIsHistorical(quota,true,checked+elapsed),false);
 assert.equal(quotaIsHistorical(quota,true,reset),true);
 assert.equal(quotaIsHistorical({...quota,checkedAt:new Date(reset+1).toISOString()},true,reset+1),false);
 assert.equal(quota.windows[0].remainingPercent,0,'never infer replenishment');
});

test('weekly exhaustion is dated evidence and never rewrites the independent five-hour balance',()=>{
 const now=Date.parse('2026-10-09T05:30:00+08:00'),quota={status:'ready',checkedAt:'2026-10-09T04:56:00+08:00',windows:[{key:'seven_day',remainingPercent:0,resetsAt:now/1000+3600},{key:'five_hour',remainingPercent:100,resetsAt:null}]};const original=structuredClone(quota);assert.equal(weeklyQuotaNote(quota,true,now),'上次實查：每週額度已用完');assert.equal(quotaPercent(quota.windows[1]),'100%');assert.equal(quotaReset(quota.windows[1]),'官方未提供');assert.deepEqual(quota,original);
 for(const status of ['stale','unavailable'])assert.equal(weeklyQuotaNote({...quota,status},true,now),null);assert.equal(weeklyQuotaNote(quota,false,now),null);assert.equal(weeklyQuotaNote({...quota,checkedAt:null},true,now),null);assert.equal(weeklyQuotaNote({...quota,windows:[{key:'seven_day',remainingPercent:0,resetsAt:now/1000-1}]},true,now),null);assert.equal(weeklyQuotaNote({...quota,windows:[{key:'seven_day',remainingPercent:50}]},true,now),null);
});
