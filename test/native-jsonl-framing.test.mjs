import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {openCodexHost} from '../src/codex-host.mjs';
import {openClaudeHost} from '../src/claude-host.mjs';
import {scratchBase} from './scratch.mjs';

const base=scratchBase;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// These are literal Unicode characters on the wire, not JSON \u escapes.
const text='first\u2028second\u2029繁體😀last';

function childFixture(){
 const child=new EventEmitter(),writes=[];
 child.pid=4321;child.stdout=new PassThrough();child.stderr=new PassThrough();
 child.stdin=new Writable({write(chunk,_encoding,done){
  const message=JSON.parse(String(chunk));writes.push(message);
  if(message.type==='control_request'&&message.request?.subtype==='initialize')child.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{tools:[]}}})+'\n');
  done();
 }});
 child.kill=()=>{child.emit('exit',0,null);child.stdout.end();child.stderr.end();setImmediate(()=>child.emit('close',0,null));return true;};
 return {child,writes};
}
function codexFixture(t,options={}){
 const f=childFixture(),events=[];
 const host=openCodexHost({executable:'fake',cwd:base,spawnImpl:()=>f.child,onEvent:e=>events.push(e),...options});
 t.after(async()=>{f.child.kill();await host.close();});
 return {...f,host,events};
}

test('Codex JSONL preserves literal U+2028/U+2029 in replies and notifications',async t=>{
 const f=codexFixture(t),pending=f.host.request('thread/read',{threadId:'synthetic'},250);
 const expected={thread:{id:'synthetic',text}};
 const event={method:'item/completed',params:{item:{text}}};
 f.child.stdout.write(JSON.stringify({id:f.writes[0].id,result:expected})+'\n'+JSON.stringify(event)+'\n');
 assert.deepEqual(await pending,expected);assert.deepEqual(f.events,[event]);assert.equal(f.writes.length,1,'no timeout replay');
});

test('Codex JSONL decodes UTF-8 across every byte split and CRLF across chunks',async t=>{
 const f=codexFixture(t),pending=f.host.request('thread/read',{},250);
 const bytes=Buffer.from(JSON.stringify({id:f.writes[0].id,result:{text}})+'\r\n');
 for(const byte of bytes)f.child.stdout.write(Buffer.from([byte]));
 assert.deepEqual(await pending,{text});
});

test('Codex JSONL reads a synthetic 25MB history reply as one frame',async t=>{
 const f=codexFixture(t),pending=f.host.request('thread/read',{},2000);
 const content='x'.repeat(12500000)+'\u2028'+'y'.repeat(12500000)+'\u2029';
 const bytes=Buffer.from(JSON.stringify({id:f.writes[0].id,result:{content}})+'\n');
 for(let offset=0;offset<bytes.length;offset+=65521)f.child.stdout.write(bytes.subarray(offset,offset+65521));
 const result=await pending;assert.equal(result.content.length,content.length);assert.equal(result.content,content);assert.equal(f.writes.length,1);
});

test('Codex JSONL drains an unterminated final reply and event at EOF after process exit',async t=>{
 const f=codexFixture(t),pending=f.host.request('thread/read',{},250);
 const event={method:'turn/completed',params:{turn:{id:'tail',status:'failed',error:{message:text}}}};
 f.child.emit('exit',0,null);
 f.child.stdout.end(JSON.stringify({id:f.writes[0].id,result:{text}})+'\n'+JSON.stringify(event));
 f.child.stderr.end();await tick();f.child.emit('close',0,null);
 assert.deepEqual(await pending,{text});await f.host.closed;assert.deepEqual(f.events,[event]);
});

test('real Node exit retains Unicode JSONL tail including its final EOF frame',async t=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'native-jsonl-tail-'));
 const expected=[{method:'item/completed',params:{text}},{method:'turn/completed',params:{turn:{id:'tail',status:'failed',error:{message:text}}}}];
 const file=path.join(root,'child.mjs');await writeFile(file,`setTimeout(()=>process.stdout.write(${JSON.stringify(expected.map(e=>JSON.stringify(e)).join('\n'))}),30);`);
 let child;const events=[];
 const host=openCodexHost({executable:process.execPath,cwd:root,env:{...process.env,CODEX_HOME:root},spawnImpl:(_e,_a,options)=>(child=spawn(process.execPath,[file],options)),onEvent:e=>events.push(e)});
 t.after(async()=>{child.stdout.resume();await host.close();});
 child.stdout.pause();let closed=false;void host.closed.then(()=>closed=true);
 await new Promise(resolve=>child.once('exit',resolve));await tick();assert.equal(closed,false);
 child.stdout.resume();await host.closed;assert.deepEqual(events,expected);
});

test('an explicit Codex abort does not dispatch a buffered EOF frame',async t=>{
 const controller=new AbortController(),f=codexFixture(t,{signal:controller.signal});
 f.child.stdout.write(JSON.stringify({method:'item/completed',params:{text}}));
 controller.abort();await f.host.closed;assert.deepEqual(f.events,[]);
});

test('Claude stream-json preserves literal Unicode separators in native messages and control replies',async t=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'claude-jsonl-'));
 const f=childFixture(),messages=[];
 const captureImpl=async(_spec,args)=>({code:0,stderr:'',stdout:args.includes('--version')?'2.1.285':args.includes('--help')?'status':JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'})});
 const host=await openClaudeHost({commandSpec:{command:'fake-claude'},cwd:root,env:{PATH:process.env.PATH,USERPROFILE:root,CLAUDE_CONFIG_DIR:root},captureImpl,spawnImpl:()=>{setImmediate(()=>f.child.emit('spawn'));return f.child;},onMessage:m=>messages.push(m)});
 t.after(()=>host.close());
 const event={type:'assistant',message:{content:[{type:'text',text}]}};
 f.child.stdout.write(JSON.stringify(event)+'\n');await tick();assert.deepEqual(messages,[event]);
 const pending=host.usage(),request=f.writes.at(-1);
 f.child.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:request.request_id,response:{text}}})+'\r\n');
 // Bound the RED assertion without waiting for the unchanged 15s control deadline.
 const outcome=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('missing'),100))]);
 assert.deepEqual(outcome,{text});
});
