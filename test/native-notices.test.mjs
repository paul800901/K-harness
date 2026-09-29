import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleNativeNotices} from '../frontend/native-notices.mjs';

test('hides the obsolete external-sandbox explainer without suppressing actionable warnings or errors',()=>{
 const notices=[
  {id:'network',kind:'externalSandboxNetwork',level:'warning'},
  {id:'reroute',kind:'modelRerouted',level:'warning'},
  {id:'error',kind:'nativeError',level:'error'},
 ];
 assert.deepEqual(visibleNativeNotices(notices).map(notice=>notice.id),['reroute','error']);
});
