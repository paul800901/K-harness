import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Writable} from 'node:stream';
import {createClaudeLogin} from '../src/claude-login.mjs';
import {officialClaudeLoginUrl} from '../shared/claude-login-url.mjs';

test('Claude authorization URL permits the observed official domain, not lookalikes or credentials',()=>{
 for(const host of ['claude.com','claude.ai','platform.claude.com','console.anthropic.com'])assert.ok(officialClaudeLoginUrl(`https://${host}/cai/oauth/authorize?state=fake`));
 for(const url of ['https://claude.com.attacker.test/oauth/authorize','https://claude.com@attacker.test/oauth','https://name:secret@claude.com/oauth','http://claude.com/oauth','https://claude.com:123/oauth','https://claude.com/not-oauth','https://claude.com/oauth\x07https://evil.test'])assert.equal(officialClaudeLoginUrl(url),null);
});

test('login exposes complete chunked plain or OSC URLs and ignores output from an old child',async()=>{
 const children=[];
 const login=createClaudeLogin({inspect:async()=>({available:false}),resolve:async()=>({command:'fake',argsPrefix:[]}),spawnImpl:()=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);children.push(child);return child;
 },invalidate:()=>{}});
 await login.start();const url='https://claude.com/cai/oauth/authorize?state=fake-state';
 children[0].stdout.emit('data','If browser failed: '+url.slice(0,40));assert.equal(login.progress().login.url,undefined);
 children[0].stdout.emit('data',url.slice(40)+'\n');assert.equal(login.progress().login.url,url);
 const oscUrl='https://claude.ai/oauth/authorize?state=osc-fake';
 children[0].stdout.emit('data',`\x1b]8;;${oscUrl}\x07${oscUrl}\x1b]8;;\x07\n`);assert.equal(login.progress().login.url,oscUrl);
 await login.cancel();await login.start();children[0].stdout.emit('data',url+'\n');assert.equal(login.progress().login.url,undefined);await login.cancel();
});

test('manual code goes only to current official stdin, matches state, and is never returned',async()=>{
 const writes=[];const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);
 child.stdin=new Writable({write(chunk,encoding,callback){writes.push(chunk.toString());callback();}});
 const login=createClaudeLogin({inspect:async()=>({available:false}),resolve:async()=>({command:'fake',argsPrefix:[]}),spawnImpl:()=>child,invalidate:()=>{}});
 await assert.rejects(login.submitCode({code:'fake#state'}),/沒有等待/);
 await login.start();child.stdout.emit('data','https://claude.com/cai/oauth/authorize?state=FAKE_STATE\n');
 for(const code of ['secret#wrong','missing-state','secret#FAKE_STATE\nnext','secret#FAKE_STATE\x00','secret#FAKE_STATE#extra',7,'x'.repeat(4097)])await assert.rejects(login.submitCode({code}));
 assert.deepEqual(writes,[]);
 const result=await login.submitCode({code:'FAKE_CODE_ONLY#FAKE_STATE'});
 assert.deepEqual(writes,['FAKE_CODE_ONLY#FAKE_STATE\n']);assert.equal(result.login.status,'running');assert.equal(result.login.codeSubmitted,true);
 assert.ok(!JSON.stringify(await login.status()).includes('FAKE_CODE_ONLY'));
 await assert.rejects(login.submitCode({code:'FAKE_CODE_ONLY#FAKE_STATE'}));assert.equal(writes.length,1);
 await login.cancel();await assert.rejects(login.submitCode({code:'FAKE_CODE_ONLY#FAKE_STATE'}));
});
test('login uses official subscription command, hides raw output and starts only explicitly',async()=>{
 let launches=0,args,options;
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);
 const login=createClaudeLogin({inspect:async()=>({available:false}),resolve:async()=>({command:'official',argsPrefix:[]}),spawnImpl:(c,a,o)=>{launches++;args=a;options=o;return child;}});
 assert.equal((await login.status()).login.status,'idle');assert.equal(launches,0);
 await Promise.all([login.start(),login.start()]);assert.equal(launches,1);assert.ok(args.includes('--claudeai'));assert.equal(options.windowsHide,true);assert.equal(options.shell,false);
 child.stdout.emit('data','secret=NEVER_SHOW https://evil.example/oauth?secret=bad\n');assert.equal((await login.status()).login.url,undefined);
 child.stdout.emit('data','https://claude.ai/oauth/authorize?state=abc\n');assert.match((await login.status()).login.url,/^https:\/\/claude.ai\//);
 assert.ok(!JSON.stringify(await login.status()).includes('NEVER_SHOW'));
 await login.cancel();assert.equal((await login.status()).login.status,'idle');
});

test('login start, completion, cancellation, and close invalidate Claude inspection',async()=>{
 const invalidations=[];
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);
 const login=createClaudeLogin({inspect:async()=>({available:false}),resolve:async()=>({command:'official',argsPrefix:[]}),spawnImpl:()=>child,invalidate:()=>invalidations.push('invalidate')});
 await login.start();assert.equal(invalidations.length,1);
 child.emit('close',0);assert.equal(invalidations.length,2);assert.equal((await login.status()).login.status,'complete');
 await login.start();assert.equal(invalidations.length,3);
 await login.cancel();assert.equal(invalidations.length,5);
 await login.close();assert.equal(invalidations.length,6);
});

test('an injected isolated environment is passed consistently to inspection and official login',async()=>{
 const supplied={PATH:'C:\\isolated\\bin',HOME:'C:\\isolated\\home',CLAUDE_CODE_OAUTH_TOKEN:'FAKE_ONLY',AWS_ACCESS_KEY_ID:'FAKE_ONLY'};
 const inspected=[],spawned=[];
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);
 const login=createClaudeLogin({cwd:'C:\\isolated\\work',env:supplied,
  inspect:async options=>{inspected.push(options);return {available:false};},
  resolve:async({env})=>{assert.equal(env.PATH,supplied.PATH);return {command:'isolated-claude',argsPrefix:[]};},
  spawnImpl:(command,args,options)=>{spawned.push({command,args,env:options.env});return child;},invalidate:()=>{},
 });
 await login.status();
 assert.equal(inspected[0].env.PATH,supplied.PATH);
 assert.equal(inspected[0].env.HOME,supplied.HOME);
 assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in inspected[0].env,false);
 await login.start();
 assert.deepEqual(spawned[0].env,inspected[0].env);
 assert.equal(spawned[0].command,'isolated-claude');
 await login.cancel();
});

test('isolated cancel waits for confirmed termination and retains a live child after stop failure',async()=>{
 let attempts=0,launches=0;
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 child.terminate=async()=>{attempts++;if(attempts===1)return {confirmed:false};child.emit('close',null,'SIGTERM');return {confirmed:true};};
 const login=createClaudeLogin({env:{PATH:'isolated'},inspect:async()=>({available:false}),resolve:async()=>({command:'isolated',argsPrefix:[]}),spawnImpl:()=>{launches++;return child;},invalidate:()=>{}});
 await login.start();
 const failed=await login.cancel();
 assert.equal(failed.login.status,'running');assert.match(failed.login.error,/仍保留/);
 await login.start();assert.equal(launches,1,'a possibly live login child must not be duplicated');
 const stopped=await login.cancel();assert.equal(stopped.login.status,'idle');assert.equal(attempts,2);
});

test('close reports incomplete shutdown if isolated login termination is unconfirmed',async()=>{
 let attempts=0;
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 child.terminate=async()=>{attempts++;if(attempts===1)return {confirmed:false};child.emit('close',null,'SIGTERM');return {confirmed:true};};
 const login=createClaudeLogin({env:{PATH:'isolated'},inspect:async()=>({available:false}),resolve:async()=>({command:'isolated',argsPrefix:[]}),spawnImpl:()=>child,invalidate:()=>{}});
 await login.start();
 await assert.rejects(login.close(),/shutdown is incomplete/);
 assert.equal((await login.status()).login.status,'running');
 assert.match((await login.status()).login.error,/仍保留/);
 assert.equal((await login.close()).login.status,'idle');assert.equal(attempts,2);
});
