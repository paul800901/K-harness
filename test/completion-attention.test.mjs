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
test('unowned history does not block main completion, while owned unresolved work still does',()=>{
 const historical=[
  {status:'unresolved',settled:false,executionUnowned:true},
  {status:'unresolved',settled:false,executionUnowned:true,reconciliation:{summary:'checked',evidence:'still unknown',reviewedAt:'2026-10-07T01:02:03.000Z'}},
 ];
 const onlyHistory=createCompletionAttention();onlyHistory.observe(working());onlyHistory.observe(completed('a',{workers:historical}));
 assert.equal(onlyHistory.state.sequence,1,'annotated and unannotated unowned history does not block the main completion notice');
 assert.equal(historical[0].settled,false);assert.equal(historical[0].status,'unresolved');
 assert.equal(historical[1].settled,false);assert.equal(historical[1].status,'unresolved','a reconciliation note is not native settlement');

 const mixed=createCompletionAttention(),owned={status:'unresolved',settled:false};
 mixed.observe(working());mixed.observe(completed('a',{workers:[...historical,owned]}));
 assert.equal(mixed.state.sequence,0,'owned unresolved work remains a blocker alongside old rows');
 mixed.observe(working());mixed.observe(completed('a',{workers:historical}));
 assert.equal(mixed.state.sequence,1,'after the owned work no longer blocks, the remaining history does not suppress completion');
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
test('interruption, stopping and offline disarm a run without notifying',()=>{
 for(const status of ['interrupted','stopping','offline']){
  const a=createCompletionAttention();a.observe(working());a.observe({threadId:'a',status,busy:false});a.observe(completed());assert.equal(a.state.sequence,0,status);
 }
});

test('native goal continuation and unknown outcomes do not publish completion between turns',()=>{
 for(const status of ['active','starting','unknown']){const a=createCompletionAttention();a.observe(working());a.observe(completed('a',{goal:{status}}));assert.equal(a.state.sequence,0,status);a.observe(completed('a',{goal:{status:'complete'}}));assert.equal(a.state.sequence,1);}
});

test('retained ended and paused goal records do not suppress later ordinary completion',()=>{
 for(const status of ['paused','blocked','ended','failed','interrupted','budgetLimited','usageLimited']){const a=createCompletionAttention();a.observe(working());a.observe(completed('a',{goal:{status}}));assert.equal(a.state.sequence,1,status);}
});

for(const status of ['failed','error','uncertain'])test(`live idle ${status} is attention, not successful completion or historical failure`,()=>{
 const a=createCompletionAttention();a.observe({threadId:'history',status,busy:false});assert.equal(a.state.sequence,0);
 a.observe(working());a.observe({threadId:'a',status,busy:true});assert.equal(a.state.sequence,0,'still running is not a terminal warning');
 a.observe({threadId:'a',status,busy:false,completionPending:true,workers:[{status:'running',settled:false}],error:'PRIVATE_FAKE_ERROR'});
 assert.deepEqual(a.state,{sequence:1,unread:[{threadId:'a',sequence:1,kind:'attention'}]});
 a.observe({threadId:'a',status,busy:false});a.observe(completed());assert.equal(a.state.sequence,1,'same failed run cannot turn into a successful completion');
 assert.equal(JSON.stringify(a.state).includes('PRIVATE_FAKE_ERROR'),false);
});

test('native retry remains running; later failure attention is cleared by new work and exact source ACK',()=>{
 const a=createCompletionAttention();a.observe(working());a.observe(working('a',{error:'native retry',turnError:{willRetry:true}}));assert.equal(a.state.sequence,0);
 a.observe({threadId:'a',status:'failed',busy:false});a.observe(working('b'));a.observe({threadId:'b',status:'uncertain',busy:false});
 assert.equal(a.markViewed({threadId:'a',sequence:2}),false);assert.equal(a.markViewed({threadId:'b',sequence:2}),true);
 a.observe(working());assert.deepEqual(a.state.unread,[]);a.observe(completed());
 assert.equal(a.markViewed({threadId:'a',sequence:1}),false);assert.deepEqual(a.state.unread,[{threadId:'a',sequence:3}]);
});

test('explicit stopping suppresses later stop uncertainty and interruption; a new genuine failure still notifies',()=>{
 for(const status of ['uncertain','interrupted','failed']){
  const a=createCompletionAttention();a.observe(working());a.observe({threadId:'a',status:'stopping',busy:true});a.observe({threadId:'a',status,busy:false});assert.equal(a.state.sequence,0,status);
  a.observe(working());a.observe({threadId:'a',status:'failed',busy:false});assert.equal(a.state.sequence,1);
 }
});