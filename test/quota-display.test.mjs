import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaIsHistorical,quotaPercent,quotaReset} from '../frontend/quota-display.mjs';
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
 assert.equal(quotaIsHistorical({status:'ready',windows:[w]}),false);
});
