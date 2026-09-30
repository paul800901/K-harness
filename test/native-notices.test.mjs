import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleNativeNotices} from '../frontend/native-notices.mjs';
import * as nativeNotices from '../frontend/native-notices.mjs';

test('hides engineering notices without mutating the native records',()=>{
 const notices=['status','deprecationNotice','configWarning','windowsWorldWritableWarning','windowsSandboxReadiness','windowsSandboxSetupCompleted']
  .map((kind,index)=>({id:`hidden-${index}`,kind,level:'warning',message:`${kind} detail`}));
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),[]);
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
