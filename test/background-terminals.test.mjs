import test from 'node:test';
import assert from 'node:assert/strict';
import {stopThreadTerminals} from '../src/background-terminals.mjs';

test('stopping cleans only the selected thread and independently confirms no terminals remain',async()=>{
 const calls=[];let cleaned=false;
 const terminal={processId:'12',itemId:'cmd',cwd:'D:/test',command:'node test.mjs'};
 const host={async request(method,params){calls.push({method,params});if(method==='thread/backgroundTerminals/clean'){cleaned=true;return {};}
  return {data:cleaned?[]:[terminal],nextCursor:null};}};
 assert.deepEqual(await stopThreadTerminals(host,'parent'),[terminal]);
 assert.ok(calls.every(c=>c.params.threadId==='parent'));assert.equal(calls.length,3);
});
test('a cleanup acknowledgement with a remaining process fails instead of reporting stopped',async()=>{
 const host={async request(){return {data:[{processId:'still-running'}]};}};
 await assert.rejects(stopThreadTerminals(host,'parent'),/尚未確認停止/);
});
test('cleanup waits for asynchronous process exit and does not resend cleanup',async()=>{
 let cleans=0,reads=0;
 const terminal={processId:'exiting'};
 const host={async request(method){if(method==='thread/backgroundTerminals/clean'){cleans++;return {};}
  return {data:++reads<4?[terminal]:[]};}};
 assert.deepEqual(await stopThreadTerminals(host,'parent'),[terminal]);assert.equal(cleans,1);assert.equal(reads,4);
});
