import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerWatch,workerNeedsAttention,workerNoticeCurrent,workerNoticeKey,workerNoticeText} from '../src/worker-watch.mjs';

const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('unsettled failure and unresolved records use status-notice identity, not completion identity',()=>{
 for(const status of ['failed','unresolved']){
  const queued={requestId:'job',status,settled:false};
  assert.equal(workerNeedsAttention(queued),true);
  assert.equal(workerNoticeKey(queued),'unconfirmed:job');
  assert.match(workerNoticeText([queued]),/不是完成通知/);
  assert.equal(workerNoticeKey({...queued,status:'completed',settled:true}),'job');
  assert.equal(workerNoticeText([{...queued,status:'completed',settled:true}]).includes('狀態通知'),false);
 }
});
test('stale unknown notices are suppressed when the current record settled, became unowned, or disappeared',()=>{
 const queued={requestId:'job',status:'unresolved',settled:false};
 assert.equal(workerNoticeCurrent(queued,{...queued}),true);
 assert.equal(workerNoticeCurrent(queued,{...queued,status:'completed',settled:true}),false);
 assert.equal(workerNoticeCurrent(queued,{...queued,executionUnowned:true}),false);
 assert.equal(workerNoticeCurrent(queued,undefined),false);
});
function setup(t){
 t.mock.timers.enable({apis:['setTimeout']});
 let now=0,reads=0;const notices=[],records=new Map();
 const watch=createWorkerWatch({now:()=>now,quietMs:300000,inspect:async({requestId})=>{reads++;return records.get(requestId);},publish:(id,inspection)=>{records.get(id).inspection=inspection;notices.push(structuredClone(records.get(id)));}});
 const add=(id='job')=>{const record={requestId:id,parentId:'parent',provider:'gemini',status:'running',settled:false,startedAt:0};records.set(id,record);watch.observe(record);return record;};
 const tick=async(ms)=>{now+=ms;t.mock.timers.tick(ms);await flush();};
 t.after(()=>watch.clear());return {watch,records,notices,add,tick,reads:()=>reads};
}
test('runtime checks only after genuine silence and keeps one quiet notice across long commands',async t=>{
 const f=setup(t),record=f.add();await f.tick(299999);assert.equal(f.reads(),0);
 await f.tick(1);assert.equal(f.reads(),1);const first=f.notices[0];
 await f.tick(300000);assert.equal(f.reads(),2);assert.equal(f.notices.at(-1).inspection.noticeId,first.inspection.noticeId);
 record.lastReadAt=600000;f.watch.observe(record);await f.tick(300000);assert.equal(f.reads(),3,'status/readback clocks are not progress');
 record.lastActivityAt=900000;f.watch.observe(record);assert.equal(record.inspection,undefined);assert.equal(workerNoticeCurrent(first,record),false);
 await f.tick(300000);assert.equal(f.notices.at(-1).inspection.noticeId,first.inspection.noticeId,'new quiet command must not repeatedly wake the LLM');
 assert.equal(workerNoticeCurrent(first,record),false,'old episode queue is invalid even with the same durable notice id');
 record.status='unresolved';await f.tick(300000);assert.notEqual(record.inspection.noticeId,first.inspection.noticeId);
 record.status='running';record.toolErrors=['tool failed'];await f.tick(300000);assert.notEqual(record.inspection.noticeId,first.inspection.noticeId,'new diagnostic warrants attention');
 record.settled=true;f.watch.observe(record);assert.equal(workerNoticeCurrent(first,record),false);assert.equal(workerNoticeKey(record),'job');
 const reads=f.reads();await f.tick(86400000);assert.equal(f.reads(),reads);
});
test('worker clocks are independent and approvals suspend observation',async t=>{
 const f=setup(t),one=f.add('one');await f.tick(100000);const two=f.add('two');two.lastActivityAt=100000;f.watch.observe(two);
 one.waitingForApproval=true;f.watch.observe(one);await f.tick(300000);
 assert.deepEqual(f.notices.map(x=>x.requestId),['two']);
 delete one.waitingForApproval;one.lastActivityAt=400000;f.watch.observe(one);await f.tick(299999);assert.equal(f.notices.some(x=>x.requestId==='one'),false);
 await f.tick(1);assert.equal(f.notices.some(x=>x.requestId==='one'),true);
});
test('late inspection after forget or clear never publishes, and failed reads stay unknown',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let resolve;const notices=[];
 let record={requestId:'job',parentId:'p',provider:'codex',startedAt:0,status:'running'};
 const watch=createWorkerWatch({now:()=>0,quietMs:10,inspect:()=>new Promise(r=>resolve=r),publish:(_,inspection)=>notices.push(inspection)});
 t.after(()=>watch.clear());watch.observe(record);t.mock.timers.tick(10);watch.forget('job');resolve(record);await flush();assert.equal(notices.length,0);
 watch.observe(record);t.mock.timers.tick(10);watch.clear();resolve(record);await flush();assert.equal(notices.length,0);
 const failed=createWorkerWatch({now:()=>0,quietMs:10,inspect:async()=>{throw Error('offline');},publish:(_,inspection)=>notices.push(inspection)});t.after(()=>failed.clear());
 failed.observe(record);t.mock.timers.tick(10);await flush();assert.equal(notices.at(-1).statusObserved,'unresolved');assert.match(notices.at(-1).reason,/未停止或重送/);
});
