import test from 'node:test';
import assert from 'node:assert/strict';
import {connectState} from '../frontend/state-connection.mjs';
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
