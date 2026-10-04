import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompletionAttention} from '../src/completion-attention.mjs';
const working=(threadId='a',extra={})=>({threadId,status:'working',busy:true,...extra});
const completed=(threadId='a',extra={})=>({threadId,status:'completed',busy:false,...extra});
test('only freshly executed main turns become unread; history and duplicate events do not count',()=>{
 const a=createCompletionAttention();a.observe(completed());assert.equal(a.state.sequence,0);
 a.observe(working());a.observe(completed());a.observe(completed());
 assert.deepEqual(a.state,{sequence:1,unread:[{threadId:'a',sequence:1}]});
});
test('three completed rooms count three, and reading one clears only its exact generation',()=>{
 const a=createCompletionAttention();
 for(const id of ['a','b','c']){a.observe(working(id));a.observe(completed(id));}
 assert.equal(a.state.unread.length,3);
 assert.equal(a.markViewed({threadId:'b',sequence:2}),true);
 assert.deepEqual(a.state.unread.map(x=>x.threadId),['a','c']);
 a.observe(working('a'));assert.equal(a.state.unread.length,1);a.observe(completed('a'));
 assert.equal(a.markViewed({threadId:'a',sequence:1}),false);
 assert.equal(a.markViewed({threadId:'a',sequence:4}),true);
 a.forget('c');assert.deepEqual(a.state.unread,[]);
});
test('child settling alone never completes the earlier waiting main message',()=>{
 const a=createCompletionAttention();a.observe(working());
 a.observe(completed('a',{workers:[{status:'running',settled:false}]}));
 a.observe(completed('a',{workers:[{status:'completed',settled:true}]}));
 assert.equal(a.state.sequence,0);
 a.observe(working());a.observe(completed('a',{workers:[{status:'completed',settled:true}]}));
 assert.equal(a.state.sequence,1);
});
test('deferred final worker check cannot publish stale worker state or premature completion',()=>{
 const a=createCompletionAttention();a.observe(working());
 a.observe(completed('a',{completionPending:true,workers:[{status:'running',settled:false}]}));
 assert.equal(a.state.sequence,0);
 a.observe(completed('a',{completionPending:false,workers:[{status:'completed',settled:true}]}));
 assert.equal(a.state.sequence,1);
});
test('queued work, delivery, questions, unknown children and errors are not successful completion',()=>{
 for(const extra of [{completionPending:true},{queuedMessages:[{id:'queued'}]},{questions:[{id:'q'}]},{workers:[{status:'unavailable'}]},{workerConnection:'failed'},{error:'failed'}]){
  const a=createCompletionAttention();a.observe(working());a.observe(completed('a',extra));assert.equal(a.state.sequence,0,JSON.stringify(extra));
 }
});
test('failure, interruption and stopping disarm a run instead of creating a completion notification',()=>{
 for(const status of ['failed','interrupted','stopping','offline','error','uncertain']){
  const a=createCompletionAttention();a.observe(working());a.observe({threadId:'a',status,busy:false});a.observe(completed());assert.equal(a.state.sequence,0,status);
 }
});
