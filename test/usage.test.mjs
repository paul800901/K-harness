import test from 'node:test';
import assert from 'node:assert/strict';
import {codexQuota} from '../src/usage.mjs';
test('Codex quota prefers core multi-bucket, clamps remaining and never guesses unknown as zero',()=>{
 const result=codexQuota({rateLimits:{primary:{usedPercent:1}},rateLimitsByLimitId:{codex:{primary:{usedPercent:34,windowDurationMins:300,resetsAt:123},secondary:null},other:{primary:{usedPercent:90}}}},'fixed');
 assert.equal(result.windows[0].remainingPercent,66);assert.equal(result.windows[1].remainingPercent,null);assert.equal(result.checkedAt,'fixed');
 assert.equal(codexQuota({rateLimits:{primary:{usedPercent:120},secondary:{usedPercent:-1}}}).windows[0].remainingPercent,0);
 assert.equal(codexQuota({rateLimitsByLimitId:{other:{primary:{usedPercent:2}}},rateLimits:{primary:{usedPercent:4}}}).status,'unavailable');
 assert.equal(codexQuota({}).status,'unavailable');
});
