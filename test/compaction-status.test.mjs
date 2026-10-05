import test from 'node:test';
import assert from 'node:assert/strict';
import {compactionLabel} from '../frontend/compaction-status.mjs';
test('compaction label distinguishes certain zero, totals and incomplete native history',()=>{
 assert.equal(compactionLabel({compactions:0,compactionsComplete:true}),'已壓縮 0 次');
 assert.equal(compactionLabel({compactions:3,compactionsComplete:true}),'已壓縮 3 次');
 assert.equal(compactionLabel({compactions:3,compactionsComplete:false}),'壓縮次數未知（已記錄 3 次）');
 for(const progress of [undefined,{}, {compactions:0}, {compactions:null,compactionsComplete:false}])assert.equal(compactionLabel(progress),'壓縮次數未知');
});
