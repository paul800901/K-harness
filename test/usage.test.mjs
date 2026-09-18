import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {codexQuota,transcriptTokens,flashUsage} from '../src/usage.mjs';
test('Codex quota prefers core multi-bucket, clamps remaining and never guesses unknown as zero',()=>{
 const result=codexQuota({rateLimits:{primary:{usedPercent:1}},rateLimitsByLimitId:{codex:{primary:{usedPercent:34,windowDurationMins:300,resetsAt:123},secondary:null},other:{primary:{usedPercent:90}}}},'fixed');
 assert.equal(result.windows[0].remainingPercent,66);assert.equal(result.windows[1].remainingPercent,null);assert.equal(result.checkedAt,'fixed');
 assert.equal(codexQuota({rateLimits:{primary:{usedPercent:120},secondary:{usedPercent:-1}}}).windows[0].remainingPercent,0);
 assert.equal(codexQuota({rateLimitsByLimitId:{other:{primary:{usedPercent:2}}},rateLimits:{primary:{usedPercent:4}}}).status,'unavailable');
 assert.equal(codexQuota({}).status,'unavailable');
});
const entry=(id,tokens,extra={})=>({id,type:'message',message:{role:'assistant',provider:'deepseek',usage:{totalTokens:tokens,cacheRead:1024,reasoning:73},...extra}});
test('Flash totals count each response once, including cache/reasoning without adding them twice',()=>{
 assert.deepEqual(transcriptTokens([entry('a',895),entry('b',1232),entry('c',1598),entry('c',1598),entry('x',10,{provider:'other'}),entry('unknown',0,{stopReason:'aborted'})]),{totalTokens:3725,responses:3,missing:1});
});
test('Flash history is read-only, scoped by exact job ID and workspace, and not accumulated on repeated refresh',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'usage-'));
 const dir=path.join(root,'.runtime/jobs/one');await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'job.json'),JSON.stringify({version:1,workspace:root,provider:'deepseek',sessionFile:'session.jsonl',status:'completed',modelTurns:1}));
 await writeFile(path.join(dir,'session.jsonl'),JSON.stringify(entry('a',1232))+'\n');
 const first=await flashUsage(root,root,['one','one']);const next=await flashUsage(root,root,['one']);
 assert.equal(first.totalTokens,1232);assert.equal(next.totalTokens,1232);assert.equal(first.unconfirmed,0);
 assert.equal((await flashUsage(root,path.join(root,'other'),['one'])).unconfirmed,1);
 assert.equal((await flashUsage(root,root,['missing'])).unconfirmed,1);
});
