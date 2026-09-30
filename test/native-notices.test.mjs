import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleNativeNotices} from '../frontend/native-notices.mjs';
import * as nativeNotices from '../frontend/native-notices.mjs';

test('hides the obsolete external-sandbox explainer without suppressing actionable warnings or errors',()=>{
 const notices=[
  {id:'network',kind:'externalSandboxNetwork',level:'warning'},
  {id:'reroute',kind:'modelRerouted',level:'warning'},
  {id:'error',kind:'nativeError',level:'error'},
 ];
 assert.deepEqual(visibleNativeNotices(notices).map(notice=>notice.id),['reroute','error']);
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
