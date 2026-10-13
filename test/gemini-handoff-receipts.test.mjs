import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeGeminiHandoff,consumeGeminiHandoff,geminiWaitingJobs,geminiAccountWait,geminiHandoffText} from '../src/gemini-handoff.mjs';

test('not-started metadata follows its exact request IDs through merge, replacement and consumption',()=>{
 const first={epoch:0,status:'ready',requestIds:['failed-a','unsent-a'],notStartedIds:['unsent-a'],queryIds:[]};
 const second={epoch:0,status:'ready',requestIds:['unsent-b'],notStartedIds:['unsent-b'],queryIds:[]};
 const merged=mergeGeminiHandoff(mergeGeminiHandoff(null,first),second);
 assert.deepEqual(merged.notStartedIds,['unsent-a','unsent-b']);
 const consumed=consumeGeminiHandoff(merged,mergeGeminiHandoff(null,second));
 assert.deepEqual(consumed.requestIds,first.requestIds);assert.deepEqual(consumed.notStartedIds,['unsent-a']);
 const replaced=mergeGeminiHandoff(merged,{epoch:0,status:'blocked',requestIds:['unsent-a'],notStartedIds:['unsent-a'],queryIds:[]});
 assert.deepEqual(replaced.notStartedIds,['unsent-b']);assert.deepEqual(replaced.events[0].notStartedIds,[]);
 const delivered=consumeGeminiHandoff(merged,{status:'ready',events:[{status:'ready',requestIds:['unsent-a'],queryIds:[]}]});
 assert.deepEqual(delivered.notStartedIds,['unsent-b']);assert.deepEqual(delivered.events[0].notStartedIds,[]);
});
const event=(status,requestIds=[],queryIds=[],extra={})=>({parentId:'room',epoch:1,status,requestIds,queryIds,...extra});
test('consuming an in-flight receipt leaves later ready and waiting events without replaying delivered IDs',()=>{
 const sent=mergeGeminiHandoff(null,event('ready',['job-a'],['query-a']));
 let value=mergeGeminiHandoff(sent,event('ready',['job-b'],['query-b']));
 value=mergeGeminiHandoff(value,event('waiting',['job-c']));
 value=consumeGeminiHandoff(value,sent);
 assert.deepEqual(value.requestIds,['job-b']);assert.deepEqual(value.queryIds,['query-b']);assert.deepEqual([...geminiWaitingJobs(value)],['job-c']);
 assert.equal(consumeGeminiHandoff(value).status,'waiting');
});
test('independent waiting, ready, blocked and late receipts cannot erase each other or invent ready work',()=>{
 let value=mergeGeminiHandoff(null,event('ready',['first'],[],{switched:true}));
 value=mergeGeminiHandoff(value,event('waiting',['second'],['query']));
 assert.equal(value.status,'ready');assert.deepEqual(value.requestIds,['first']);assert.deepEqual([...geminiWaitingJobs(value)],['second']);assert.deepEqual(geminiAccountWait(value),{requestIds:['first','second'],queryIds:['query']});
 value=consumeGeminiHandoff(value);assert.equal(value.status,'waiting');assert.deepEqual(value.requestIds,['second']);
 value=mergeGeminiHandoff(value,event('blocked',['second']));assert.equal(value.status,'waiting');assert.deepEqual(value.requestIds,[]);assert.deepEqual(value.queryIds,['query']);
 value=mergeGeminiHandoff(value,event('ready',[],['query'],{switched:false}));assert.equal(value.status,'ready');assert.deepEqual(value.requestIds,[]);
 assert.equal(consumeGeminiHandoff(value).status,'blocked');
});
test('multiple independent ready receipts preserve each scope and do not mislabel all as unstarted or newly switched',()=>{
 let value=mergeGeminiHandoff(null,event('ready',['quota-failed'],[],{switched:true}));
 value=mergeGeminiHandoff(value,event('ready',['unsent'],['query'],{switched:false}));
 assert.deepEqual(value.requestIds,['quota-failed','unsent']);assert.match(geminiHandoffText(value),/合併多筆就緒事件/);assert.doesNotMatch(geminiHandoffText(value),/本次就緒只涵蓋 event.requestIds 中先前未送出的工作/);assert.equal(consumeGeminiHandoff(value),null);
 value=mergeGeminiHandoff(value,event('waiting',[],['next-query'],{epoch:2}));assert.equal(value.status,'waiting');assert.deepEqual(value.requestIds,[]);assert.deepEqual(value.queryIds,['next-query']);
});
