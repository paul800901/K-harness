import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkActivity,codexWorkActivity,claudeWorkActivity,geminiWorkActivity} from '../src/work-activity.mjs';
import {workStatus,workerHealth,workerEnded,pendingWorkerSummary,QUIET_WORK_MS} from '../frontend/work-status.mjs';

function fixture(){let now=1000;const state={busy:true,status:'working'},activity=createWorkActivity(state,()=>now);activity.begin();return {state,activity,tick(ms=1000){now+=ms;return now;},get now(){return now;}};}
test('time passing and status reads never masquerade as fresh native activity',()=>{
 const f=fixture();assert.equal(f.state.activity.lastEventAt,null);
 assert.match(workStatus(f.state,true,f.now).text,/等待核心回報/);
 codexWorkActivity(f.activity,{method:'item/reasoning/textDelta',params:{delta:'thinking'}});
 const last=f.state.activity.lastEventAt;f.tick(QUIET_WORK_MS);
 const warning=workStatus(f.state,true,f.now);assert.equal(warning.kind,'warning');assert.match(warning.text,/5 分 0 秒無新活動回報/);assert.doesNotMatch(warning.text,/執行中|已卡死/);
 for(const method of ['thread/status/changed','thread/tokenUsage/updated','account/rateLimits/updated','ping'])codexWorkActivity(f.activity,{method});
 assert.equal(f.state.activity.lastEventAt,last);
 f.tick(86400000);assert.match(workStatus(f.state,true,f.now).text,/1 天/);
 codexWorkActivity(f.activity,{method:'item/agentMessage/delta',params:{delta:'fresh'}});
 assert.equal(workStatus(f.state,true,f.now).kind,'running');assert.match(workStatus(f.state,true,f.now).text,/最近活動 0 秒前/);
 f.activity.clear();assert.match(workStatus(f.state,true,f.now).text,/工作狀態待確認/);
});
test('overlapping tools retain the original wait until all pending tools finish',()=>{
 const f=fixture(),emit=(id,done,kind)=>{f.tick();f.activity.tool(id,done,kind);};
 emit('a',false,'worker');const first=f.state.activity.phaseSince;
 emit('b',false,'worker');emit('a',false,'worker');assert.equal(f.state.activity.phaseSince,first);
 assert.match(workStatus(f.state,true,f.now).text,/等待子代理回報/);
 emit('a',true);assert.equal(f.state.activity.phase,'worker');
 emit('b',true);assert.equal(f.state.activity.phase,'active');
 f.activity.begin();assert.equal(f.state.activity.lastEventAt,null);
});
test('native adapters distinguish model output, tools, compaction, and non-work pulses',()=>{
 const f=fixture();
 codexWorkActivity(f.activity,{method:'item/started',params:{item:{id:'w',type:'mcpToolCall',tool:'gemini_wait'}}});assert.equal(f.state.activity.phase,'worker');
 f.tick();codexWorkActivity(f.activity,{method:'item/completed',params:{item:{id:'w',type:'mcpToolCall',tool:'gemini_wait'}}});assert.equal(f.state.activity.phase,'active');
 f.tick();claudeWorkActivity(f.activity,{type:'assistant',message:{content:[{type:'tool_use',id:'t',name:'Read'}]}});assert.equal(f.state.activity.phase,'tool');
 const last=f.state.activity.lastEventAt;f.tick();
 for(const message of [{type:'tool_progress',elapsed_time_seconds:99},{type:'assistant',isReplay:true},{type:'assistant',parent_tool_use_id:'child'},{type:'system',subtype:'status',status:'requesting'}])claudeWorkActivity(f.activity,message);
 assert.equal(f.state.activity.lastEventAt,last);
 claudeWorkActivity(f.activity,{type:'user',message:{content:[{type:'tool_result',tool_use_id:'t'}]}});assert.equal(f.state.activity.phase,'active');
 f.tick();claudeWorkActivity(f.activity,{type:'system',subtype:'status',status:'compacting'});assert.equal(f.state.activity.phase,'compacting');
 f.tick();geminiWorkActivity(f.activity,{step_update:{step_index:2,tool_info:{name:'read_file'},state:'RUNNING'}});assert.equal(f.state.activity.phase,'tool');
 f.tick();geminiWorkActivity(f.activity,{step_update:{step_index:2,tool_info:{name:'read_file'},state:'DONE'}});assert.equal(f.state.activity.phase,'active');
});
test('connection, retry, user confirmation and terminal states override a generic running indicator',()=>{
 const f=fixture();f.activity.record();
 assert.match(workStatus(f.state,false,f.now).text,/後端斷線/);
 assert.match(workStatus({...f.state,notices:[{willRetry:true}]},true,f.now).text,/重連中/);
 assert.equal(workStatus({...f.state,notices:[{willRetry:true,resolved:true}]},true,f.now).kind,'running');
 assert.match(workStatus({...f.state,questions:[{}]},true,f.now).text,/等待你的確認/);
 assert.match(workStatus({...f.state,status:'offline'},true,f.now).text,/核心已斷線/);
 assert.equal(workStatus({...f.state,busy:false,status:'completed'},true,f.now),null);
 assert.match(workStatus({...f.state,busy:false,status:'failed'},true,f.now).text,/工作失敗/);
});

test('unowned Gemini history is visible but never counted as current work or reported stopped',()=>{
 const old={conversationId:'a',provider:'gemini',status:'unresolved',settled:false,executionUnowned:true};
 const live={conversationId:'a',provider:'codex',status:'running',settled:false};
 const note={summary:'人工查核註記：原結果仍未知。',evidence:'假資料依據；不證明完成或停止。',reviewedAt:'2026-10-07T01:02:03.000Z'};
 const reviewed={...old,reconciliation:note};
 const ownedWithNote={conversationId:'a',provider:'codex',status:'unresolved',settled:false,executionUnowned:false,reconciliation:note};
 assert.equal(workerEnded(reviewed),false);
 assert.equal(reviewed.status,'unresolved');
 assert.deepEqual(reviewed.reconciliation,note);
 assert.equal(workerHealth(reviewed,true,1000).text,'已留查核註記 · 原執行結果仍未知');
 assert.equal(pendingWorkerSummary([reviewed],true,1000).historicalUnconfirmed,0,'noted unowned history leaves historical confirmation count');
 assert.deepEqual(pendingWorkerSummary([reviewed,ownedWithNote],true,1000),{count:1,unknown:1,quiet:0,confirmation:0,healthy:0,historicalUnconfirmed:0},'a note does not hide or settle a worker that is still owned');
 const oldHealth=workerHealth(old,true,1000);
 assert.equal(oldHealth.historicalUnconfirmed,true);
 assert.match(oldHealth.text,/舊工單結果待確認/);
 assert.match(oldHealth.text,/重啟後無法確認執行結果/);
 assert.doesNotMatch(oldHealth.text,/已停止|已結束/);
 assert.deepEqual(pendingWorkerSummary([old],true,1000),{count:0,unknown:0,quiet:0,confirmation:0,healthy:0,historicalUnconfirmed:1});
 const idle={threadId:'a',status:'completed',busy:false,workerDetails:[old]};
 const idleStatus=workStatus(idle,true,1000);
 assert.equal(idleStatus.kind,'warning');
 assert.match(idleStatus.text,/主代理待命/);
 assert.match(idleStatus.text,/舊工單結果待確認：1 個/);
 assert.doesNotMatch(idleStatus.text,/等待子代理/);
 const mixed=workStatus({...idle,workerDetails:[old,live]},true,1000);
 assert.match(mixed.text,/子代理仍在工作：1 個/);
 assert.match(mixed.text,/舊工單結果待確認：1 個/);
 assert.doesNotMatch(mixed.text,/子代理未結束：2/);
 assert.equal(pendingWorkerSummary([{...old,settled:true}],true,1000).historicalUnconfirmed,0);
 assert.equal(workerEnded({...old,status:'completed',settled:true}),true);
});

test('an idle main waits visibly for its own children without changing native busy or inferring a dead worker',()=>{
 const state={threadId:'a',status:'completed',busy:false,workerDetails:[
  {conversationId:'a',status:'running',settled:false,activity:{lastEventAt:1000}},
  {conversationId:'a',status:'unresolved',settled:false},
  {conversationId:'a',status:'failed',settled:false},
  {conversationId:'a',status:'completed',settled:true},
  {conversationId:'b',status:'running',settled:false}
 ]},before=structuredClone(state);
 assert.match(workStatus(state,true,1000).text,/主代理待命 · 子代理未結束：3 個 · 待確認：2/);
 const quiet=workStatus(state,true,1000+QUIET_WORK_MS);
 assert.match(quiet.text,/久未回報：1（是否卡住待確認）/);assert.equal(quiet.kind,'warning');
 assert.deepEqual(state,before,'display clock cannot launch a turn, settle, stop or retry');
 assert.match(workStatus({...state,status:'interrupted'},true).text,/已停止 · 子代理未結束：3/);
 assert.match(workerHealth({status:'failed',settled:false}).text,/停止尚待確認/);
 assert.equal(workerEnded({status:'failed',settled:false}),false);
 assert.match(workerHealth({status:'failed',settled:true}).text,/失敗/);
 assert.match(workerHealth({status:'running',lastReadAt:new Date().toISOString()}).text,/尚無活動時間/);
 assert.match(workerHealth({status:'running',activity:{lastEventAt:1000}},false,1001).text,/待確認/);
 assert.match(workerHealth({status:'running',confirmationReason:'核准'},true,1001).text,/等待核准/);
 assert.equal(workStatus({...state,workerDetails:[]}),null);
 assert.equal(workStatus({...state,workerDetails:[],completionPending:true,goalPending:true}).text,'等待結果交接');
});

test('idle healthy children are not confused with approval, unknown, or quiet work',()=>{
 const healthy={threadId:'a',status:'completed',busy:false,workerDetails:[{conversationId:'a',status:'running',settled:false,lastActivityAt:1000}]};
 assert.equal(workStatus(healthy,true,1001).text,'子代理仍在工作 · 主代理待命');
 const mixed={...healthy,workerDetails:[...healthy.workerDetails,{conversationId:'a',status:'running',settled:false,confirmationReason:'原生核准'},{conversationId:'a',status:'unresolved',settled:false}]};
 const mixedStatus=workStatus(mixed,true,1001);
 assert.match(mixedStatus.text,/子代理未結束：3 個/);assert.match(mixedStatus.text,/等待核准：1/);assert.match(mixedStatus.text,/待確認：1/);assert.doesNotMatch(mixedStatus.text,/子代理仍在工作/);
 const quiet=workStatus({...healthy,workerDetails:[{conversationId:'a',status:'running',settled:false,lastActivityAt:1000}]},true,1000+QUIET_WORK_MS);
 assert.match(quiet.text,/久未回報：1/);assert.doesNotMatch(quiet.text,/子代理仍在工作/);
});

test('unchanged Gemini tool status pulses never refresh worker activity',()=>{
 const f=fixture(),pulse={step_update:{step_index:3,tool_info:{name:'read_file'},state:'RUNNING'}};
 geminiWorkActivity(f.activity,pulse);const first=f.state.activity.lastEventAt;
 f.tick(QUIET_WORK_MS);geminiWorkActivity(f.activity,pulse);
 assert.equal(f.state.activity.lastEventAt,first);
 assert.equal(workerHealth({status:'running',activity:f.state.activity},true,f.now).quiet,true);
 geminiWorkActivity(f.activity,{step_update:{step_index:3,tool_info:{name:'read_file'},state:'DONE'}});
 assert.equal(workerHealth({status:'running',activity:f.state.activity},true,f.now).quiet,undefined);
});
