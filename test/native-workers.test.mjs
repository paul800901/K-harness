import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNativeWorkerIds,checkNativeWorkers} from '../src/native-workers.mjs';

test('native child IDs come only from observed collaboration items',()=>{
 assert.deepEqual(collectNativeWorkerIds([{type:'mcpToolCall',receiverThreadIds:['other']},{type:'collabAgentToolCall',receiverThreadIds:['a','a','b']}]),['a','b']);
 assert.deepEqual(collectNativeWorkerIds([{type:'subAgentActivity',kind:'started',agentThreadId:'native-v2'},{type:'subAgentActivity',kind:'completed',agentThreadId:'native-v2'},{type:'collabAgentToolCall',tool:'wait',receiverThreadIds:[]}]),['native-v2']);
});
test('native worker stop checks parent ownership and interrupts the exact active child turn',async()=>{
 const calls=[];let stopped=false;
 const host={async request(method,p){calls.push({method,p});if(method==='thread/backgroundTerminals/list')return {data:[]};if(method==='turn/interrupt'){stopped=true;return {};}
  return {thread:{id:p.threadId,parentThreadId:'parent',status:{type:stopped?'idle':'active'},turns:[{id:'child-turn',status:stopped?'interrupted':'inProgress'}]}};}};
 const result=await checkNativeWorkers(host,'parent',['child'],{stop:true});
 assert.equal(result[0].status,'cancelled');assert.equal(result[0].settled,true);
 assert.deepEqual(calls.find(c=>c.method==='turn/interrupt').p,{threadId:'child',turnId:'child-turn'});
});
test('foreign or unreadable children remain unresolved and are never interrupted',async()=>{
 let interrupts=0;
 const host={async request(method,p){if(method==='turn/interrupt')interrupts++;if(p.threadId==='missing')throw Error('offline');return {thread:{parentThreadId:'foreign',status:{type:'active'},turns:[{id:'x',status:'inProgress'}]}};}};
 const results=await checkNativeWorkers(host,'parent',['foreign','missing'],{stop:true});
 assert.equal(interrupts,0);assert.ok(results.every(r=>!r.settled&&r.status==='unresolved'));
});
test('an interrupt acknowledgement does not falsely claim a child has stopped',async()=>{
 const host={async request(method){if(method==='thread/backgroundTerminals/list')return {data:[]};return {thread:{parentThreadId:'parent',status:{type:'active'},turns:[{id:'child-turn',status:'inProgress'}]}};}};
 const [result]=await checkNativeWorkers(host,'parent',['child'],{stop:true});
 assert.equal(result.status,'running');assert.equal(result.settled,false);
});
