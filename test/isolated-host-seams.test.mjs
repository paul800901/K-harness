import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectClaude,invalidateClaudeInspection,openClaudeHost} from '../src/claude-host.mjs';
import {openCodexHost} from '../src/codex-host.mjs';

const testRoot=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
await mkdir(testRoot,{recursive:true});

function fakeClaudeCapture(calls) {
  return async (_spec,args,{env,runnerIdentity})=>{
    calls.push({args:[...args],env:{...env},runnerIdentity});
    if(args.includes('--version'))return {code:0,stdout:'2.1.280 (Claude Code)',stderr:''};
    if(args.includes('--help')&&args.includes('auth'))return {code:0,stdout:'login logout status',stderr:''};
    if(args.includes('status'))return {code:0,stdout:JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'}),stderr:''};
    return {code:1,stdout:'',stderr:''};
  };
}

function fakeChild({exitOnEnd=false,onTerminate}={}) {
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.exitCode=null;child.signalCode=null;child.pid=4321;
  const emitExit=(code=0,signal=null)=>{if(child.exitCode!==null||child.signalCode!==null)return;child.exitCode=code;child.signalCode=signal;child.emit('exit',code,signal);};
  child.emitExit=emitExit;
  child.stdin=new Writable({
    write(chunk,_encoding,callback){
      const line=String(chunk).trim();
      try{
        const message=JSON.parse(line);
        if(message.type==='control_request'&&message.request?.subtype==='initialize'){
          child.stdout.write(`${JSON.stringify({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{tools:[]}}})}\n`);
        }
      }catch{}
      callback();
    },
    final(callback){callback();if(exitOnEnd)setImmediate(()=>emitExit());},
  });
  child.kill=()=>{setImmediate(()=>emitExit(null,'SIGTERM'));return true;};
  child.terminate=async()=>{await onTerminate?.();};
  child.launch=()=>setImmediate(()=>child.emit('spawn'));
  return child;
}

test('Codex host exposes the process runner seam and forwards only the supplied env',async()=>{
  const child=fakeChild({exitOnEnd:true});let captured;
  const env={PATH:'sandbox-path',USERPROFILE:'sandbox-home'};
  const host=openCodexHost({executable:'codex-runner',cwd:'C:\\sandbox',env,spawnImpl:(...args)=>{captured=args;return child;}});
  assert.equal(captured[0],'codex-runner');
  assert.deepEqual(captured[1],['app-server','--stdio']);
  assert.deepEqual(captured[2],{cwd:'C:\\sandbox',env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  await host.close();
  assert.deepEqual(await host.closed,{code:0,signal:null});
});

test('Codex host uses runner termination and keeps closed pending until the runner reports process exit',async()=>{
  let terminateCalled=false;
  const child=fakeChild({onTerminate:async()=>{terminateCalled=true;setTimeout(()=>child.emitExit(null,'SIGTERM'),25);}});
  const host=openCodexHost({executable:'codex-runner',cwd:'C:\\sandbox',spawnImpl:()=>child});
  let closed=false;void host.closed.then(()=>{closed=true;});
  await host.close();
  assert.equal(terminateCalled,true);assert.equal(closed,true);
  assert.deepEqual(await host.closed,{code:null,signal:'SIGTERM'});
});

test('Codex spawn errors stay visible, do not claim closed, and do not kill a nonexistent process',async()=>{
  const child=fakeChild();let killCalled=false;
  child.terminate=undefined;
  child.kill=()=>{killCalled=true;return true;};
  const host=openCodexHost({executable:'missing-codex',cwd:'C:\\sandbox',spawnImpl:()=>{setImmediate(()=>{child.emit('error',new Error('spawn failed'));setImmediate(()=>child.emitExit(null,'ENOENT'));});return child;}});
  let closed=false;void host.closed.then(()=>{closed=true;});
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(host.close(),/could not start or continue/);
  await host.closed;
  assert.equal(killCalled,false);assert.equal(closed,true);
});

test('Claude preflight and long-lived process use the same explicit runner and env without skipping subscription checks',async()=>{
  invalidateClaudeInspection();
  const dir=await mkdtemp(path.join(testRoot,'isolated-claude-'));
  const config=path.join(dir,'claude-config');await mkdir(config,{recursive:true});
  const calls=[],captureImpl=fakeClaudeCapture(calls),child=fakeChild({exitOnEnd:true});let spawnArgs;
  const env={...process.env,USERPROFILE:path.join(dir,'home'),CLAUDE_CONFIG_DIR:config,ANTHROPIC_API_KEY:'must-be-stripped'};
  const host=await openClaudeHost({commandSpec:{command:'claude-runner',argsPrefix:['claude.js']},cwd:dir,env,captureImpl,runnerIdentity:'sandboxie:claude-box-a',spawnImpl:(...args)=>{spawnArgs=args;child.launch();return child;}});
  assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.runnerIdentity==='sandboxie:claude-box-a'));
  assert.ok(calls.every(call=>call.env.USERPROFILE===env.USERPROFILE&&call.env.CLAUDE_CONFIG_DIR===config));
  assert.ok(calls.every(call=>!Object.hasOwn(call.env,'ANTHROPIC_API_KEY')));
  assert.equal(spawnArgs[0],'claude-runner');assert.equal(spawnArgs[2].env.USERPROFILE,env.USERPROFILE);
  assert.ok(!Object.hasOwn(spawnArgs[2].env,'ANTHROPIC_API_KEY'));
  await host.close();assert.deepEqual(await host.closed,{code:0,signal:null});
  invalidateClaudeInspection();
});

test('Claude inspection cache is partitioned by environment identity and runner identity',async()=>{
  invalidateClaudeInspection();
  const dir=await mkdtemp(path.join(testRoot,'isolated-claude-cache-'));
  const calls=[],captureImpl=fakeClaudeCapture(calls),env={...process.env,USERPROFILE:path.join(dir,'home-a'),CLAUDE_CONFIG_DIR:path.join(dir,'config-a')};
  const input={commandSpec:{command:'claude-runner',argsPrefix:[]},cwd:dir,env,captureImpl};
  try{
    assert.equal((await inspectClaude({...input,runnerIdentity:'box-a'})).available,true);
    assert.equal((await inspectClaude({...input,runnerIdentity:'box-a'})).available,true);
    assert.equal(calls.length,3);
    assert.equal((await inspectClaude({...input,runnerIdentity:'box-b'})).available,true);
    assert.equal(calls.length,6);
    assert.equal((await inspectClaude({...input,env:{...env,CLAUDE_CONFIG_DIR:path.join(dir,'config-b')},runnerIdentity:'box-a'})).available,true);
    assert.equal(calls.length,9);
  }finally{invalidateClaudeInspection();}
});

test('Claude runner preflight still rejects non-subscription auth before spawning the session',async()=>{
  invalidateClaudeInspection();
  let spawned=false;
  const captureImpl=async(_spec,args)=>args.includes('--version')?{code:0,stdout:'2.1.280',stderr:''}:args.includes('--help')?{code:0,stdout:'status',stderr:''}:{code:0,stdout:JSON.stringify({loggedIn:true,authMethod:'console',apiProvider:'firstParty',subscriptionType:'pro'}),stderr:''};
  await assert.rejects(openClaudeHost({commandSpec:{command:'claude-runner',argsPrefix:[]},captureImpl,runnerIdentity:'box-nonsubscription',spawnImpl:()=>{spawned=true;throw new Error('must not spawn');}}),/not verified as using a supported Claude.ai subscription/);
  assert.equal(spawned,false);
  invalidateClaudeInspection();
});

test('Claude refuses to pair host auth capture with an isolated session spawn',async()=>{
  let spawned=false;
  await assert.rejects(openClaudeHost({commandSpec:{command:'claude-runner',argsPrefix:[]},runnerIdentity:'sandboxie:box-a',spawnImpl:()=>{spawned=true;}}),/same explicit runner/);
  assert.equal(spawned,false);
});

test('Claude termination uses runner terminate promise and closed waits for observed exit',async()=>{
  invalidateClaudeInspection();
  const dir=await mkdtemp(path.join(testRoot,'isolated-claude-stop-'));
  const child=fakeChild({onTerminate:async()=>{setTimeout(()=>child.emitExit(null,'SIGTERM'),25);}});
  const host=await openClaudeHost({commandSpec:{command:'claude-runner',argsPrefix:[]},cwd:dir,captureImpl:fakeClaudeCapture([]),runnerIdentity:'box-stop',spawnImpl:()=>{child.launch();return child;}});
  let closed=false;void host.closed.then(()=>{closed=true;});
  await host.close();
  assert.equal(closed,true);
  assert.equal(child.exitCode,null);assert.equal(child.signalCode,'SIGTERM');
  invalidateClaudeInspection();
});

test('Claude termination errors are surfaced and do not resolve closed before exit',async()=>{
  invalidateClaudeInspection();
  const dir=await mkdtemp(path.join(testRoot,'isolated-claude-stop-error-'));
  const child=fakeChild({onTerminate:async()=>{throw new Error('runner termination failed');}});
  const host=await openClaudeHost({commandSpec:{command:'claude-runner',argsPrefix:[]},cwd:dir,captureImpl:fakeClaudeCapture([]),runnerIdentity:'box-stop-error',spawnImpl:()=>{child.launch();return child;}});
  let closed=false;void host.closed.then(()=>{closed=true;});
  await assert.rejects(host.close(),/runner termination failed/);
  assert.equal(closed,false);
  child.emitExit(0,null);await host.closed;assert.equal(closed,true);
  invalidateClaudeInspection();
});
