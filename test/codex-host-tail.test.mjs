import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {openCodexHost} from '../src/codex-host.mjs';
import {scratchBase} from './scratch.mjs';
const base=scratchBase;
const tick=()=>new Promise(r=>setImmediate(r));

test('real Codex host transport drains final/error notifications after process exit before resolving closed',async t=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'codex-tail-'));
 const error={message:'synthetic stream error',codexErrorInfo:'other',additionalDetails:null};
 const expected=[{method:'item/completed',params:{threadId:'fake',turnId:'turn',item:{id:'answer',type:'agentMessage',text:'FINAL'}}},{method:'error',params:{threadId:'fake',turnId:'turn',willRetry:false,error}},{method:'turn/completed',params:{threadId:'fake',turn:{id:'turn',status:'failed',error}}}];
 const file=path.join(root,'child.mjs');await writeFile(file,`setTimeout(()=>process.stdout.write(${JSON.stringify(expected.map(e=>JSON.stringify(e)+'\n').join(''))}),30);`);
 const events=[];let child;
 const host=openCodexHost({executable:process.execPath,cwd:root,env:{...process.env,CODEX_HOME:root},spawnImpl:(_e,_a,o)=>(child=spawn(process.execPath,[file],o)),onEvent:e=>events.push(e)});
 t.after(async()=>{child.stdout.resume();await host.close();});
 child.stdout.pause();let closed=false;void host.closed.then(()=>closed=true);
 await new Promise(r=>child.once('exit',r));await tick();
 assert.equal(closed,false,'process exit does not establish output drain');
 child.stdout.resume();await host.closed;
 assert.deepEqual(events,expected);await host.close();
});

function fixture(){
 const child=new EventEmitter(),writes=[],events=[],requests=[];child.pid=4321;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kills=0;
 child.stdin=new Writable({write(chunk,_e,cb){writes.push(JSON.parse(String(chunk)));cb();}});
 child.kill=()=>{child.kills++;return true;};
 const host=openCodexHost({executable:'fake',cwd:base,spawnImpl:()=>child,onEvent:e=>events.push(e),onRequest:async m=>{requests.push(m);return {decision:'accept'};}});
 return {child,host,writes,events,requests};
}
test('exited host rejects new requests/approvals but drains existing reply, then rejects unfinished requests without replay',async()=>{
 const f=fixture();const replied=f.host.request('thread/read',{threadId:'one'},10000),unfinished=f.host.request('thread/read',{threadId:'two'},10000).catch(e=>e.message);
 void replied.catch(()=>{});
 f.child.emit('exit',0,null);
 await assert.rejects(f.host.request('turn/start',{threadId:'new'}),/closed|exited/);
 f.child.stdout.write(JSON.stringify({method:'item/commandExecution/requestApproval',id:91,params:{threadId:'one'}})+'\n');
 f.child.stdout.write(JSON.stringify({id:f.writes[0].id,result:{thread:{id:'one'}}})+'\n');
 await tick();assert.deepEqual(await replied,{thread:{id:'one'}});assert.equal(f.writes.length,2);
 f.child.stdout.end();f.child.stderr.end();f.child.emit('close',0,null);await f.host.closed;
 assert.match(await unfinished,/stopped/);assert.equal(f.child.kills,0);await f.host.close();
});
test('inherited output pipe cannot hold exited host forever or trigger killing an exited pid',async()=>{
 const f=fixture();f.child.emit('exit',0,null);
 const start=Date.now();await f.host.closed;
 assert(Date.now()-start<5000);assert.equal(f.child.kills,0);
 await assert.rejects(f.host.close(),/output|排空/);
});

test('stdin/process error forbids new work and approvals without discarding buffered terminal output',async()=>{
 for(const target of ['stdin','process'])for(const afterExit of [false,true]){
  const f=fixture(),pending=f.host.request('thread/read',{threadId:'one'}).catch(e=>e.message);
  f.child.emit('spawn');
  if(afterExit)f.child.emit('exit',0,null);
  f.child.stdout.write(JSON.stringify({method:'item/commandExecution/requestApproval',id:90,params:{}})+'\n');
  (target==='stdin'?f.child.stdin:f.child).emit('error',Object.assign(Error('fixture EPIPE'),{code:'EPIPE'}));
  await assert.rejects(f.host.request('turn/start',{threadId:'new'}),/closed/);
  await assert.rejects(f.host.waitForMcp('one','fake'),/closed/);assert.throws(()=>f.host.notify({method:'initialized'}),/closed/);
  f.child.stdout.write(JSON.stringify({method:'item/commandExecution/requestApproval',id:92,params:{}})+'\n');
  const expected=[{method:'item/completed',params:{item:{id:'answer',type:'agentMessage',text:'FINAL'}}},{method:'error',params:{willRetry:false,error:{message:'native primary error'}}},{method:'turn/completed',params:{turn:{id:'turn',status:'failed',error:{message:'native primary error'}}}}];
  for(const e of expected)f.child.stdout.write(JSON.stringify(e)+'\n');
  await tick();assert.deepEqual(f.events,expected,`${target} afterExit=${afterExit}`);assert.equal(f.writes.length,1);assert.deepEqual(f.requests,[],'queued and new approvals cannot invoke permission handler');
  assert.match(await pending,/stopped/);
  if(!afterExit)f.child.emit('exit',0,null);
  f.child.stdout.end();f.child.stderr.end();f.child.emit('close',0,null);await f.host.closed;
  await assert.rejects(f.host.close(),/process|input|EPIPE/);assert.equal(f.child.kills,0);
 }
});
