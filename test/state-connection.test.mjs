import test from 'node:test';
import assert from 'node:assert/strict';
import {connectState,remoteLoginRequired} from '../frontend/state-connection.mjs';

test('remote access diagnosis is read-only and requires explicit expired-session evidence',async()=>{
 const replies=[{status:403,code:'K_REMOTE_AUTH_REQUIRED'}, {status:403,code:undefined}, {status:200}];
 for(const reply of replies){
  const result=await remoteLoginRequired(async(url,options)=>{
   assert.equal(url,'/api/sessions');assert.equal(options.method,undefined);assert(options.signal);
   return {status:reply.status,json:async()=>reply};
  });
  assert.equal(result,reply.code==='K_REMOTE_AUTH_REQUIRED');
 }
 assert.equal(await remoteLoginRequired(async()=>{throw Error('network down');}),false);
});

test('expired login is reported without redirecting, restoring online, or replaying work; stale probes are ignored',async()=>{
 const doc=new EventTarget(),win=new EventTarget(),sources=[],online=[],required=[],pending=[];
 doc.visibilityState='visible';
 class Source{constructor(){sources.push(this);}close(){this.closed=true;}}
 const dispose=connectState({pauseWhenHidden:true,documentImpl:doc,windowImpl:win,EventSourceImpl:Source,
  onEvent:()=>{},onOnline:v=>online.push(v),onLoginRequired:v=>required.push(v),
  checkAccess:()=>new Promise(resolve=>pending.push(resolve))});
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 const first=sources[0];first.onerror();await tick();pending.shift()(true);await tick();
 assert.equal(required.at(-1),true);assert.equal(online.at(-1),false);assert.equal(sources.length,1);
 first.onerror();await tick();first.onmessage({data:JSON.stringify({type:'snapshot',state:{busy:true}})});
 pending.shift()(true);await tick();assert.equal(required.at(-1),false);assert.equal(online.at(-1),true);
 first.onerror();await tick();doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));
 pending.shift()(true);await tick();assert.equal(required.at(-1),false);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));
 sources.at(-1).onerror();await tick();dispose();pending.shift()(true);await tick();
 assert.equal(required.at(-1),false);assert.equal(online.at(-1),false);
});
test('background/restore replaces only the read stream; snapshot is mandatory and old callbacks are ignored',()=>{
 const doc=new EventTarget(),win=new EventTarget(),sources=[],events=[],online=[];
 doc.visibilityState='visible';
 class Source{constructor(url){assert.equal(url,'/api/events');sources.push(this);}close(){this.closed=true;}}
 const dispose=connectState({pauseWhenHidden:true,documentImpl:doc,windowImpl:win,EventSourceImpl:Source,onEvent:e=>events.push(e),onOnline:v=>online.push(v)});
 const first=sources[0],emit=(s,event)=>s.onmessage?.({data:JSON.stringify(event)});
 emit(first,{type:'patch'});assert.equal(events.length,0);
 emit(first,{type:'snapshot',state:{busy:true}});assert.equal(online.at(-1),true);
 const late=first.onmessage;doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));assert(first.closed);assert.equal(online.at(-1),false);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));
 late({data:JSON.stringify({type:'snapshot',state:{stale:true}})});assert.equal(events.length,1);
 emit(sources.at(-1),{type:'snapshot',state:{busy:false,messages:['completed while hidden']}});assert.equal(events.at(-1).state.busy,false);
 win.dispatchEvent(new Event('online'));assert.equal(sources.length,3);assert.equal(online.at(-1),false);
 emit(sources.at(-1),{type:'patch'});assert.equal(events.length,2);
 dispose();assert(sources.at(-1).closed);win.dispatchEvent(new Event('online'));assert.equal(sources.length,3);
});

test('desktop keeps its background stream and normal pageshow does not double-connect',()=>{
 const doc=new EventTarget(),win=new EventTarget(),sources=[];doc.visibilityState='visible';
 class Source{constructor(){sources.push(this);}close(){this.closed=true;}}
 const dispose=connectState({documentImpl:doc,windowImpl:win,EventSourceImpl:Source,onEvent:()=>{},onOnline:()=>{}});
 win.dispatchEvent(new Event('pageshow'));assert.equal(sources.length,1);
 doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));assert(!sources[0].closed);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));assert.equal(sources.length,1);
 const restored=new Event('pageshow');restored.persisted=true;win.dispatchEvent(restored);assert.equal(sources.length,2);assert(sources[0].closed);dispose();
});

test('open read stream is synchronizing, not disconnected or online, until its snapshot arrives',()=>{
 const doc=new EventTarget(),win=new EventTarget(),sources=[],connecting=[],online=[];
 class Source{constructor(){sources.push(this);}close(){}}
 const dispose=connectState({documentImpl:doc,windowImpl:win,EventSourceImpl:Source,onEvent:()=>{},onOnline:v=>online.push(v),onConnecting:v=>connecting.push(v)});
 assert.equal(connecting.at(-1),true);assert.equal(online.at(-1),false);
 sources[0].onopen();assert.equal(connecting.at(-1),true);assert.equal(online.at(-1),false);
 sources[0].onmessage({data:JSON.stringify({type:'snapshot',state:{}})});assert.equal(connecting.at(-1),false);assert.equal(online.at(-1),true);
 sources[0].onerror();assert.equal(connecting.at(-1),false);assert.equal(online.at(-1),false);dispose();
});
