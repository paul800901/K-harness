import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteStateEvent} from '../shared/remote-state.mjs';
import {createStateStream,applyStateEvent} from '../shared/state-stream.mjs';

test('remote reconnect excludes heavy tool payloads but preserves controls/messages and exact desktop state',()=>{
 const state={threadId:'a',busy:true,questions:[{id:'q'}],messages:[{id:'m',text:'live'}],goal:{status:'active'},workers:[{status:'running'}],
  tools:Array.from({length:5000},(_,i)=>({id:`t${i}`,groupId:'g',name:'shell',status:'completed',output:'x'.repeat(6000),details:{text:'y'.repeat(1000)},patchChanges:[{path:'fake.txt',diff:'z'.repeat(1000)}]})),turnDiffs:[{turnId:'turn',diff:'d'.repeat(10000)}]};
 const stream=createStateStream(),desktop=stream.snapshot(state),remote=remoteStateEvent(desktop);
 assert.deepEqual(desktop.state,state);assert.equal(state.tools[0].output.length,6000);
 assert.deepEqual(remote.state.messages,state.messages);assert.deepEqual(remote.state.questions,state.questions);
 assert.deepEqual(remote.state.goal,state.goal);assert.deepEqual(remote.state.workers,state.workers);
 assert.equal(remote.state.tools.length,5000);assert.equal(remote.state.tools[0].hasPatchChanges,true);
 assert(!('output' in remote.state.tools[0]));assert(!('details' in remote.state.tools[0]));assert(!('patchChanges' in remote.state.tools[0]));
 assert.equal(remote.state.turnDiffs[0].diff,undefined);
 assert(Buffer.byteLength(JSON.stringify(remote))<1000000);
});

test('remote append, metadata change, reordering, removal and room switch stay consistent with a fresh summary',()=>{
 const stream=createStateStream(),state={threadId:'a',messages:[{id:'m',text:'start'}],tools:[{id:'t',name:'shell',status:'running',output:'a',details:{text:'original'}}],turnDiffs:[]};
 let client=applyStateEvent(null,remoteStateEvent(stream.snapshot(state)));
 const verify=()=>{const update=stream.update(state);if(update)client=applyStateEvent(client,remoteStateEvent(update));assert.deepEqual(JSON.parse(JSON.stringify(client)),JSON.parse(JSON.stringify(remoteStateEvent({type:'snapshot',state}).state)));};
 state.tools[0].output+=' invisible bulk';verify();
 state.messages[0].text+=' live';state.tools[0].status='completed';state.tools[0].patchChanges=[{path:'a',diff:'exact'}];verify();
 state.tools.unshift({id:'second',output:'new'});state.turnDiffs=[{turnId:'turn',diff:'new diff'}];verify();
 state.tools[1].output='changed';state.tools[1].details={text:'changed'};verify();
 state.tools.splice(0,1);verify();
 state.threadId='b';state.messages=[];state.tools=[];state.turnDiffs=[];verify();
});
