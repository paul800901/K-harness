import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {createConversationController} from '../src/conversation-controller.mjs';
import {openCodexHost} from '../src/codex-host.mjs';
import {createDesktopController} from '../src/desktop-controller.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});
test('opening room is cancellable without stopping a busy selected room and can reopen',async()=>{
 const root=await mkdtemp(path.join(base,'cancel-room-')),entered=deferred();let calls=0,stops=0;const owners=[];
 const c=createConversationController({root,sessionFactory:()=>{const owner={state:{workspace:root,status:'ready',threadId:null},
  selectWorkspace:async()=>{},async open(data,{signal}={}){calls++;if(calls===2){entered.resolve();await new Promise((_,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));}this.state.threadId=`room-${calls}`;return {threadId:this.state.threadId};},stop:async()=>{stops++;},close:async()=>{owner.closed=true;},workers:async()=>[]};owners.push(owner);return owner;}});
 await c.open({model:'gpt-fake'});const busy=owners[1];busy.state.busy=true;busy.state.status='working';
 const pending=c.open({model:'gpt-fake'});const rejected=assert.rejects(pending,/取消|abort/i);await entered.promise;
 assert.equal(c.state.connectionOpening,true);
 await c.stop({cancelOpening:true});await rejected;assert.equal(stops,0);assert.equal(c.state.connectionOpening,false);
 assert.equal(c.state.threadId,'room-1');assert.equal(busy.state.busy,true);assert.equal(busy.closed,undefined);
 await c.open({model:'gpt-fake'});assert.equal(c.state.threadId,'room-3');await c.close();
});
test('cancel through the room and desktop controllers stops a never-initializing real Codex child within one second',async()=>{
 const root=await mkdtemp(path.join(base,'cancel-native-'));const file=path.join(root,'wait.mjs');await writeFile(file,'process.stdin.resume();setInterval(()=>{},1000);');
 let child;const entered=deferred();
 const c=createConversationController({root,sessionFactory:options=>createDesktopController({...options,hostFactory:options=>openCodexHost({...options,executable:process.execPath,spawnImpl:(_c,_a,o)=>{child=spawn(process.execPath,[file],o);child.once('spawn',entered.resolve);return child;}})})});
 const rejected=assert.rejects(c.open({model:'gpt-fake'}));await entered.promise;
 let timer;const begin=Date.now();try{await Promise.race([c.stop({cancelOpening:true}),new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('abort did not close child'));},950);})]);}
 finally{clearTimeout(timer);await c.close();}
 await rejected;assert.ok(Date.now()-begin<1000);assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(c.state.connectionOpening,false);
});
