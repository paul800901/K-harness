import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleNativeNotices} from '../frontend/native-notices.mjs';
import * as nativeNotices from '../frontend/native-notices.mjs';

test('retry projection keeps the latest incident update, terminal errors, and raw records',()=>{
 const notices=[
  {id:'a',kind:'nativeError',level:'error',turnId:'t',willRetry:true,retryKey:'incident',message:'Reconnecting... 1/5'},
  {id:'b',kind:'nativeError',level:'error',turnId:'t',willRetry:true,retryKey:'incident',message:'Reconnecting... 2/5'},
  {id:'old',kind:'nativeError',willRetry:true,resolved:true,retryKey:'old',message:'resolved'},
  {id:'fatal',kind:'nativeError',willRetry:false,message:'Native request failed'},
  {id:'transport',kind:'warning',message:'Falling back from WebSockets to HTTPS transport. stream disconnected before completion'},
  {id:'different',kind:'guardianWarning',message:'WebSockets permission denied'},
 ];
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices).map(n=>n.id),['b','fatal','different']);
 assert.deepEqual(notices,before);
 assert.equal(nativeNotices.nativeNoticeText(notices[1]),'正在重新連線（2/5）');
 assert.equal(nativeNotices.nativeNoticeText({...notices[1],message:'Reconnecting... waiting for network'}),'等待網路恢復…');
 assert.equal(nativeNotices.nativeNoticeText({...notices[1],message:'Unknown retry reason'}),'原生核心正在重試…');
 const long={message:'原生錯誤'.repeat(100)};
 assert.equal(nativeNotices.nativeNoticeText(long),long.message.slice(0,160)+'…');
 assert.equal(long.message.length,400);
});

test('hides engineering notices without mutating the native records',()=>{
 const notices=['status','deprecationNotice','configWarning','windowsWorldWritableWarning','windowsSandboxReadiness','windowsSandboxSetupCompleted']
  .map((kind,index)=>({id:`hidden-${index}`,kind,level:'warning',message:`${kind} detail`}));
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),[]);
 assert.deepEqual(notices,before);
});

test('routine worker handoff is not a user notice; failures and original records remain',()=>{
 const notices=[
  {id:'handoff',kind:'worker-completion',level:'info',message:'Flash 子代理結果已交給 Codex 主代理驗收。'},
  {id:'failure',kind:'worker-completion',level:'error',message:'交付結果失敗'},
 ];
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),[notices[1]]);
 assert.deepEqual(notices,before);
});

test('retains unknown warnings, guardian warnings, model routing, and native errors',()=>{
 const notices=[
  {id:'warning',kind:'warning',level:'warning'},
  {id:'guardian',kind:'guardianWarning',level:'warning'},
  {id:'reroute',kind:'modelRerouted',level:'warning'},
  {id:'error',kind:'nativeError',level:'error'},
 ];
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),notices);
 assert.deepEqual(notices,before);
});

test('a native Codex error already shown in the main alert is not shown again',()=>{
 const message='Native quota limit reached';
 const notices=[{id:'quota',kind:'nativeError',message},{id:'other',kind:'nativeError',message:'Different error'},{id:'warning',kind:'warning',message:'Important warning'}];
 assert.deepEqual(visibleNativeNotices(notices,message).map(n=>n.id),['other','warning']);
 assert.deepEqual(visibleNativeNotices(notices).map(n=>n.id),['quota','other','warning']);
});

test('Claude native quota text is localized without changing its reset time or timezone',()=>{
 const text=nativeNotices.localizeNativeNotice;
 assert.equal(text("You've hit your session limit · resets 5:30pm (Asia/Taipei)",'claude'),'本時段額度已用完；17:30（臺灣時間）恢復。');
 assert.equal(text("You've hit your session limit · resets 12am (Asia/Taipei)",'claude'),'本時段額度已用完；00:00（臺灣時間）恢復。');
 assert.equal(text("You've hit your session limit · resets 12pm (America/New_York)",'claude'),'本時段額度已用完；12:00（America/New_York）恢復。');
 assert.equal(text("You've hit your session limit",'claude'),'本時段額度已用完。');
});

test('unknown native notices and other providers retain their complete original details',()=>{
 for(const message of ['Unknown failure: request abc123',"You've hit your session limit · resets Oct 1, 2026 at 5pm (Asia/Taipei)",'已經是正體中文',null])assert.equal(nativeNotices.localizeNativeNotice(message,'claude'),message);
 const message="You've hit your session limit · resets 5:30pm (Asia/Taipei)";
 assert.equal(nativeNotices.localizeNativeNotice(message,'codex'),message);
});


test('diagnostic SQLite warning stays in raw records, not the everyday notice banner',()=>{
 const record={id:'logs',kind:'warning',message:"Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics."};
 const failure={id:'task',kind:'warning',message:'Could not save conversation history'};
 const notices=[record,failure],before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),[failure]);
 assert.deepEqual(notices,before);
});
