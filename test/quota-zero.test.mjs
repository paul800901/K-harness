import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaZeroUntil} from '../src/quota-zero.mjs';
const now=Date.parse('2026-10-08T08:00:00Z');
const window=(remainingPercent,delay)=>({remainingPercent,resetsAt:(now+delay)/1000});
test('either zero window suppresses until its official reset, not a new five hours',()=>{
 for(const key of ['five_hour','seven_day','primary','secondary'])assert.equal(quotaZeroUntil({status:'available',windows:[{key,...window(0,42000)},window(20,5000)]},now),now+42000);
});
test('multiple zero windows use the later reset and stop suppression at equality',()=>{
 const quota={status:'ready',windows:[window(0,10000),window(0,90000)]};
 assert.equal(quotaZeroUntil(quota,now),now+90000);assert.equal(quotaZeroUntil(quota,now+90000),null);
});
test('positive, unknown, failed or undated reset is not a blocking zero',()=>{
 for(const quota of [undefined,{status:'unavailable',windows:[window(0,10000)]},{status:'unknown',windows:[window(0,10000)]},{status:'ready',windows:[window(null,10000),window(0,0),{remainingPercent:0,resetsAt:null},{remainingPercent:0,resetsAt:NaN},{remainingPercent:0,resetsAt:'12345678999'}]},{status:'ready',windows:[window(.1,10000)]}])assert.equal(quotaZeroUntil(quota,now),null);
});
test('a failed later lookup can retain last-success zero without inventing a reset',()=>{
 assert.equal(quotaZeroUntil({status:'stale',checkedAt:new Date(now-60000).toISOString(),windows:[window(0,60000)]},now),now+60000);
});
