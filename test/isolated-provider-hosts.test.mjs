import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createIsolatedProviderHosts,isolatedCodexPermissions} from '../src/isolated-provider-hosts.mjs';

function fakeProcess({terminateResult={confirmed:true},terminateError,autoClose=false}={}){
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(_chunk,_encoding,callback){callback();},final(callback){callback();}});
  child.exitCode=null;child.signalCode=null;child.terminateCalls=0;child.kill=()=>{throw new Error('capture must not use kill instead of runner terminate');};
  child.terminate=async()=>{child.terminateCalls++;if(terminateError)throw terminateError;if(autoClose)setImmediate(()=>child.emit('close',null,'SIGTERM'));return terminateResult;};
  return child;
}

function providerHosts(spawnImpl){
  return createIsolatedProviderHosts({spawnImpl,env:{USERPROFILE:'C:\\isolated-home',PATH:'C:\\isolated-bin'},runnerIdentity:'sandboxie:test-box'});
}

const spec={command:'claude-cli',argsPrefix:['claude.js']};

test('isolated Codex policy carries native approval and explicit network fields without faking readonly',()=>{
  const write=isolatedCodexPermissions('workspace-write','C:\\workspace');
  assert.equal(write.approvalPolicy,'on-request');assert.equal(write.approvalsReviewer,'user');
  assert.deepEqual(write.sandboxPolicy,{type:'externalSandbox',networkAccess:'enabled'});
  const review=isolatedCodexPermissions('auto-review','C:\\workspace');
  assert.equal(review.approvalPolicy,'on-request');assert.equal(review.approvalsReviewer,'auto_review');
  assert.deepEqual(review.sandboxPolicy,{type:'externalSandbox',networkAccess:'enabled'});
  const full=isolatedCodexPermissions('danger-full-access','C:\\workspace');
  assert.equal(full.approvalPolicy,'never');assert.deepEqual(full.sandboxPolicy,{type:'externalSandbox',networkAccess:'enabled'});
  const thread=isolatedCodexPermissions('workspace-write','C:\\workspace',{thread:true});
  assert.equal(thread.sandbox,'workspace-write');assert.equal(thread.config.sandbox_workspace_write.network_access,false);
  assert.throws(()=>isolatedCodexPermissions('read-only','C:\\workspace'),/未具備可驗證的唯讀/u);
});

test('isolated capture returns data only after a normal close and forwards the exact runner environment',async()=>{
  const child=fakeProcess();let called;
  const hosts=providerHosts((...args)=>{called=args;setImmediate(()=>{child.stdout.write('2.1.280\\n');child.stderr.write('safe\\n');child.emit('exit',0,null);child.emit('close',0,null);});return child;});
  const result=await hosts.captureImpl(spec,['--version'],{cwd:'C:\\workspace'});
  assert.deepEqual(result,{code:0,stdout:'2.1.280\\n',stderr:'safe\\n'});
  assert.equal(called[0],spec.command);assert.deepEqual(called[1],['claude.js','--version']);
  assert.deepEqual(called[2].env,{USERPROFILE:'C:\\isolated-home',PATH:'C:\\isolated-bin'});
  assert.equal(child.terminateCalls,0);
});

test('timeout fails closed once the runner confirms termination',async()=>{
  const child=fakeProcess({autoClose:true});
  const hosts=providerHosts(()=>child);const started=Date.now();
  await assert.rejects(hosts.captureImpl(spec,['auth','status'],{timeout:60}),/timed out/);
  assert.equal(child.terminateCalls,1);assert.ok(Date.now()-started<500);
});

test('child errors cannot pass auth preflight and require confirmed runner termination',async()=>{
  const child=fakeProcess({autoClose:true});
  const hosts=providerHosts(()=>{setImmediate(()=>child.emit('error',new Error('fake process failure')));return child;});
  await assert.rejects(hosts.captureImpl(spec,['auth','status'],{timeout:5000}),/fake process failure/);
  assert.equal(child.terminateCalls,1);
});

test('output overflow stops promptly without waiting for the inspection deadline',async()=>{
  const child=fakeProcess({autoClose:true});
  const hosts=providerHosts(()=>{setImmediate(()=>child.stdout.write(Buffer.alloc(256*1024+1)));return child;});
  const started=Date.now();
  await assert.rejects(hosts.captureImpl(spec,['--version'],{timeout:5000}),/output limit/);
  assert.equal(child.terminateCalls,1);assert.ok(Date.now()-started<4000);
});

test('stopBox rejection is surfaced immediately and never returned as a successful capture',async()=>{
  const child=fakeProcess({terminateError:new Error('fake stopBox unconfirmed')});
  const hosts=providerHosts(()=>{setImmediate(()=>child.stdout.write(Buffer.alloc(256*1024+1)));return child;});
  const started=Date.now();
  await assert.rejects(hosts.captureImpl(spec,['--version'],{timeout:5000}),error=>{
    assert.ok(error instanceof AggregateError);assert.match(error.message,/termination was not confirmed/);
    assert.ok(error.errors.some(item=>/output limit/.test(item.message)));
    assert.ok(error.errors.some(item=>/stopBox unconfirmed/.test(item.message)));
    return true;
  });
  assert.equal(child.terminateCalls,1);assert.ok(Date.now()-started<4000);
});

test('an unconfirmed terminate result is not accepted as a stopped process',async()=>{
  const child=fakeProcess({terminateResult:{confirmed:false}});
  const hosts=providerHosts(()=>{setImmediate(()=>child.emit('error',new Error('fake failure')));return child;});
  await assert.rejects(hosts.captureImpl(spec,['auth','status'],{timeout:5000}),/termination was not confirmed/);
});

test('Claude preflight and host use one factory runner and Codex host receives that runner environment',async()=>{
  const calls=[],env={USERPROFILE:'C:\\same-runner-home',PATH:'C:\\same-runner-bin'};
  const spawnImpl=(command,args,options)=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;
    child.stdin=new Writable({
      write(chunk,_encoding,callback){
        const message=JSON.parse(String(chunk));
        if(message.type==='control_request'&&message.request?.subtype==='initialize')child.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{tools:[]}}})+String.fromCharCode(10));
        callback();
      },
      final(callback){callback();setImmediate(()=>{child.exitCode=0;child.emit('exit',0,null);child.emit('close',0,null);});},
    });
    child.terminate=async()=>({confirmed:true});child.kill=()=>true;
    calls.push({command,args,options,child});
    if(args.includes('--version'))setImmediate(()=>{child.stdout.write('2.1.280 (Claude Code)\\n');child.exitCode=0;child.emit('close',0,null);});
    else if(args.includes('--help')&&args.includes('auth'))setImmediate(()=>{child.stdout.write('login logout status\\n');child.exitCode=0;child.emit('close',0,null);});
    else if(args.includes('status'))setImmediate(()=>{child.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'}));child.exitCode=0;child.emit('close',0,null);});
    else setImmediate(()=>child.emit('spawn'));
    return child;
  };
  const hosts=createIsolatedProviderHosts({spawnImpl,env,runnerIdentity:'sandboxie:shared-box'});
  const claude=await hosts.claude({commandSpec:{command:'claude.exe',argsPrefix:[]},cwd:'C:\\workspace'});
  assert.equal(calls.length,4);
  assert.ok(calls.every(call=>call.command==='claude.exe'&&JSON.stringify(call.options.env)===JSON.stringify(calls[0].options.env)));
  assert.deepEqual(calls[0].options.env,env);
  assert.deepEqual(calls.slice(0,3).map(call=>call.args.at(-1)),['--version','--help','status']);
  await claude.close();
  assert.deepEqual(await claude.closed,{code:0,signal:null});
  const claudeEnvRef=calls[0].options.env;
  calls.length=0;
  const codex=hosts.codex({executable:'codex.exe',cwd:'C:\\workspace'});
  assert.equal(calls.length,1);assert.equal(calls[0].command,'codex.exe');assert.deepEqual(calls[0].options.env,claudeEnvRef);
  calls[0].child.exitCode=0;calls[0].child.emit('exit',0,null);calls[0].child.emit('close',0,null);
  await codex.close();assert.deepEqual(await codex.closed,{code:0,signal:null});
});
