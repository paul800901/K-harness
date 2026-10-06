import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {startDesktop} from '../src/desktop-server.mjs';
import {remoteKeyHash} from '../src/remote-access.mjs';

const request = (url, {method='GET', headers={}, body,commandId}={}) => new Promise((resolve,reject)=>{
 const requestHeaders={...headers};
 const hasCommandHeader=Object.keys(requestHeaders).some(name=>name.toLowerCase()==='x-k-command');
 if(method==='POST'&&!hasCommandHeader&&commandId!==null)requestHeaders['x-k-command']=commandId??randomUUID();
 const req=http.request(url,{method,headers:requestHeaders},res=>{
  const chunks=[];res.on('data',chunk=>chunks.push(chunk));
  res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,headers:new Headers(res.headers),text:async()=>text,json:async()=>JSON.parse(text)});});
 });
 req.on('error',reject);
 if(body!==undefined)req.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));else req.end();
});
const openEventStream = (url,headers) => {
 let resolveConnected, rejectConnected, resolveClosed;
 const connected=new Promise((resolve,reject)=>{resolveConnected=resolve;rejectConnected=reject;});
 const closed=new Promise(resolve=>{resolveClosed=resolve;});
 const req=http.get(url,{headers},res=>{
  if(res.statusCode!==200){res.resume();rejectConnected(new Error(`SSE status ${res.statusCode}`));return;}
  res.once('data',resolveConnected);
  res.once('end',resolveClosed);
 });
 req.once('error',rejectConnected);
 return {connected,closed,close:()=>req.destroy()};
};
const freePort = async () => {
 const probe=http.createServer();
 await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
 const {port}=probe.address();
 await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
 return port;
};
const service = () => ({status:async()=>({}),progress:()=>({}),start:async()=>({}),cancel:async()=>({}),submitCode:async()=>({}),close:async()=>{}});

test('local and remote HTTP servers disable only the fixed request-body timeout for streamed attachments',async()=>{
 const base=path.resolve('.runtime/mobile-remote-tests');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'stream-timeout-'));
 const remotePort=await freePort(),localDir=path.join(root,'.local');await mkdir(localDir,{recursive:true});
 await writeFile(path.join(localDir,'remote-access.json'),JSON.stringify({enabled:true,origin:'https://k-mobile-timeout.ts.net',login:'owner@example.ts.net',keyHash:remoteKeyHash(randomBytes(32).toString('hex')),port:remotePort}));
 const original=http.createServer,servers=[];http.createServer=function(...args){const server=Reflect.apply(original,this,args);servers.push(server);return server;};let app;
 try{app=await startDesktop({root,port:0,controllerFactory:()=>({state:{},close:async()=>{}}),claudeLoginFactory:service,codexLoginFactory:service,geminiLoginFactory:service,localDictationFactory:()=>({transcribe:async()=>({}),close:async()=>{}})});}
 finally{http.createServer=original;}
 try{
  assert.equal(servers.length,2);for(const server of servers){assert.equal(server.requestTimeout,0);assert.equal(server.headersTimeout,60_000);}
 }finally{await app.close();}
});

test('desktop remote access keeps local bootstrap isolated and gates the remote listener', async t=>{
 const base=path.resolve('.runtime/mobile-remote-tests');
 await mkdir(base,{recursive:true});
 const defaultRoot=await mkdtemp(path.join(base,'default-'));
 const defaultController={state:{threadId:null,workspace:null},close:async()=>{}};
 const defaultApp=await startDesktop({root:defaultRoot,executable:'fake-executable',port:0,controllerFactory:()=>defaultController,
  claudeLoginFactory:service,codexLoginFactory:service,geminiLoginFactory:service,
  localDictationFactory:()=>({transcribe:async()=>({}),close:async()=>{}})});
 t.after(()=>defaultApp.close());
 assert.equal(defaultApp.remoteOrigin,null,'remote listener is absent without a config');

 const root=await mkdtemp(path.join(base,'case-'));
 const localDir=path.join(root,'.local');
 await mkdir(localDir,{recursive:true});
 const remoteFile=path.join(localDir,'remote-access.json');
 const login='owner@example.ts.net',key=randomBytes(32).toString('hex');
 const remotePort=await freePort();
 const remoteOrigin='https://k-mobile-test.ts.net';
 await writeFile(remoteFile,JSON.stringify({enabled:true,origin:remoteOrigin,login,keyHash:remoteKeyHash(key),port:remotePort}));
 const calls=[];
 let controllerFactoryCalls=0;
 const controller={
  state:{threadId:'thread-current',workspace:'fake-workspace',tools:[{id:'tool-1',output:'EXACT_TOOL_OUTPUT',details:{source:'native'},patchChanges:[{path:'fake.txt',diff:'EXACT_PATCH'}]}],turnDiffs:[{turnId:'turn-1',diff:'EXACT_TURN_DIFF'}]}, concurrentConversations:true,
  sessions:async()=>({sessions:[]}), projects:async()=>({projects:[]}), models:async()=>({models:[]}),
  usage:async()=>({}), directories:async()=>({directories:[]}),
  send:async data=>{calls.push(['send',data]);return {ok:true,threadId:data.threadId};},
  answer:async data=>{calls.push(['answer',data]);return {ok:true,threadId:data.threadId};},
  stop:async data=>{calls.push(['stop',data]);return {ok:true,threadId:data.threadId};},
  upload:async data=>{calls.push(['upload',data]);return {ok:true,threadId:data.threadId};},
  uploadStream:async (data,stream)=>{let size=0;for await(const chunk of stream)size+=chunk.length;calls.push(['uploadStream',data,size]);return {ok:true,threadId:data.threadId,size};},
  artifact:async (artifactPath,context)=>{calls.push(['artifact',artifactPath,context]);return {name:'fake.txt',contentType:'text/plain',isText:true,bytes:Buffer.from('fake artifact')};},
  close:async()=>{},
 };
 const app=await startDesktop({root,executable:'fake-executable',port:0,geminiAccounts:{refreshAll:async()=>{calls.push(['refresh-all']);return {accounts:[],activeAccountId:null};}},controllerFactory:()=>{controllerFactoryCalls++;return controller;},
  claudeLoginFactory:()=>({...service(),status:async()=>({available:true,auth:{loggedIn:true,authMethod:'fake',apiProvider:'fake',subscriptionType:'fake',email:'sensitive@example.test',accessToken:'fake-access-token',credential:'fake-credential'}})}),
  codexLoginFactory:service,geminiLoginFactory:service,
  localDictationFactory:()=>({transcribe:async()=>({}),close:async()=>{}})});
 t.after(()=>app.close());

 // A single-use local launcher token still opens only the local listener.
 assert.equal(app.remoteOrigin,remoteOrigin);
 assert.equal(controllerFactoryCalls,1);
 const launch=app.createLaunchUrl();
 const boot=await request(launch,{method:'GET',headers:{host:new URL(app.origin).host}});
 assert.equal(boot.status,303);
 const localCookie=boot.headers.get('set-cookie').split(';')[0];
 assert.equal((await request(launch,{headers:{host:new URL(app.origin).host}})).status,403);
 assert.equal((await request(`${app.origin}/api/state`,{headers:{host:new URL(app.origin).host}})).status,403);
 assert.equal((await request(`${app.origin}/api/state`,{headers:{host:new URL(app.origin).host,cookie:localCookie}})).status,200);
 assert.equal((await request(`${app.origin}/api/state`,{headers:{host:new URL(app.origin).host,cookie:localCookie,origin:'https://attacker.example'}})).status,403,'existing local cross-origin protection');
 assert.equal((await request(`${app.origin}/api/send`,{method:'POST',commandId:null,headers:{host:new URL(app.origin).host,cookie:localCookie,origin:app.origin,'x-k-request':'1','content-type':'application/json'},body:{threadId:'local-thread'}})).status,200,'local POST does not require X-K-Command');
 calls.length=0;

 const remoteUrl=path=>`http://127.0.0.1:${remotePort}${path}`;
 const identityHeaders={host:new URL(remoteOrigin).host,'tailscale-user-login':login};
 const remoteHeaders={...identityHeaders,origin:remoteOrigin,'x-k-request':'1','content-type':'application/json'};
 const remoteGetHeaders={...identityHeaders,origin:remoteOrigin};
 const assertDenied=async(name,getHeaders,postHeaders)=>{
  assert.equal((await request(remoteUrl('/api/state'),{headers:getHeaders})).status,403,`${name}: state`);
  for(const route of ['/api/send','/api/answer'])
   assert.equal((await request(remoteUrl(route),{method:'POST',headers:postHeaders,body:{threadId:'explicit-thread-42'}})).status,403,`${name}: ${route}`);
 };
 const noIdentityGet={host:identityHeaders.host,origin:remoteOrigin};
 const noIdentityPost={...noIdentityGet,'x-k-request':'1','content-type':'application/json'};
 const wrongIdentityGet={...remoteGetHeaders,'tailscale-user-login':'other@example.ts.net'};
 const wrongIdentityPost={...remoteHeaders,'tailscale-user-login':'other@example.ts.net'};
 await assertDenied('missing identity',noIdentityGet,noIdentityPost);
 await assertDenied('wrong identity',wrongIdentityGet,wrongIdentityPost);
 await assertDenied('no remote cookie',remoteGetHeaders,remoteHeaders);
 await assertDenied('local cookie is not remote auth',{...remoteGetHeaders,cookie:localCookie},{...remoteHeaders,cookie:localCookie});
 const loginBody={key};
 assert.equal((await request(remoteUrl('/api/remote/login'),{method:'POST',headers:{...identityHeaders,'x-k-request':'1','content-type':'application/json'},body:loginBody})).status,403,'login requires Origin');
 assert.equal((await request(remoteUrl('/api/remote/login'),{method:'POST',headers:{...identityHeaders,origin:remoteOrigin,'content-type':'application/json'},body:loginBody})).status,403,'login requires X-K-Request');
 assert.equal((await request(remoteUrl('/api/remote/login'),{method:'POST',headers:remoteHeaders,body:{key:'wrong-key'}})).status,403,'wrong key');
 const loginResponse=await request(remoteUrl('/api/remote/login'),{method:'POST',headers:remoteHeaders,body:loginBody});
 assert.equal(loginResponse.status,200,await loginResponse.text());
 const remoteCookie=loginResponse.headers.get('set-cookie').split(';')[0];
 assert.match(remoteCookie,/^__Host-k_remote=/);
 assert.equal((await request(`${app.origin}/api/state`,{headers:{host:new URL(app.origin).host,cookie:remoteCookie}})).status,403,'remote cookie must not authorize local');
 const authenticatedHeaders={...remoteGetHeaders,cookie:remoteCookie};
 const authenticatedPost={...remoteHeaders,cookie:remoteCookie};
 assert.equal((await request(remoteUrl('/api/gemini/accounts/refresh-all'),{method:'POST',headers:remoteHeaders,body:{}})).status,403);
 const quotaCommand=randomUUID();
 assert.equal((await request(remoteUrl('/api/gemini/accounts/refresh-all'),{method:'POST',headers:authenticatedPost,commandId:quotaCommand,body:{}})).status,200);
 assert.equal((await request(remoteUrl('/api/gemini/accounts/refresh-all'),{method:'POST',headers:authenticatedPost,commandId:quotaCommand,body:{}})).status,409);
 assert.deepEqual(calls,[['refresh-all']]);calls.length=0;

 const rawHeaders={...authenticatedPost,'content-type':'application/octet-stream','x-k-thread-id':'thread-current','x-k-file-name':encodeURIComponent('synthetic.m4a')};
 assert.equal((await request(remoteUrl('/api/upload'),{method:'POST',headers:{...remoteHeaders,'content-type':'application/octet-stream','x-k-thread-id':'thread-current','x-k-file-name':'synthetic.m4a'},body:Buffer.from('not authenticated')})).status,403,'raw upload requires remote auth before body dispatch');
 assert.equal(calls.length,0);
 assert.equal((await request(remoteUrl('/api/upload'),{method:'POST',headers:rawHeaders,commandId:null,body:Buffer.from('missing command')})).status,400,'raw upload does not bypass X-K-Command');
 const uploadCommand=randomUUID(),raw=Buffer.from('synthetic raw attachment');
 const rawUploaded=await request(remoteUrl('/api/upload'),{method:'POST',headers:rawHeaders,commandId:uploadCommand,body:raw});
 assert.equal(rawUploaded.status,200);assert.deepEqual(await rawUploaded.json(),{ok:true,threadId:'thread-current',size:raw.length});
 assert.deepEqual(calls,[['uploadStream',{threadId:'thread-current',name:'synthetic.m4a'},raw.length]]);
 assert.equal((await request(remoteUrl('/api/upload'),{method:'POST',headers:rawHeaders,commandId:uploadCommand,body:raw})).status,409,'raw upload honors exact-once command IDs');
 assert.equal(calls.length,1);
 calls.length=0;


 const expired=await request(remoteUrl('/api/sessions'),{headers:{...remoteGetHeaders,cookie:'__Host-k_remote=expired-before-restart'}});
 assert.equal(expired.status,403);
 assert.equal((await expired.json()).code,'K_REMOTE_AUTH_REQUIRED');
 const wrongIdentity=await request(remoteUrl('/api/sessions'),{headers:{...authenticatedHeaders,'tailscale-user-login':'different@example.test'}});
 assert.equal(wrongIdentity.status,403);
 assert.equal((await wrongIdentity.json()).code,undefined,'wrong private network identity is not misreported as an expired K login');
 for(const [route,id,field,expected]of [['tool','tool-1','tool',controller.state.tools[0]],['turn-diff','turn-1','diff',controller.state.turnDiffs[0]]]){
  const url=remoteUrl(`/api/${route}?threadId=thread-current&id=${id}`);
  assert.equal((await request(url,{headers:remoteGetHeaders})).status,403);
  const result=await request(url,{headers:authenticatedHeaders});assert.equal(result.status,200);assert.deepEqual((await result.json())[field],expected);
  assert.equal((await request(remoteUrl(`/api/${route}?threadId=other-room&id=${id}`),{headers:authenticatedHeaders})).status,409);
  assert.equal((await request(remoteUrl(`/api/${route}?threadId=thread-current&id=missing`),{headers:authenticatedHeaders})).status,404);
 }
 assert.equal(calls.length,0,'lazy record reads never open, send, stop or mutate work');

 assert.equal((await request(remoteUrl('/api/state'),{headers:authenticatedHeaders})).status,200);
 for(const route of ['/api/send','/api/answer']){
  assert.equal((await request(remoteUrl(route),{method:'POST',commandId:null,headers:authenticatedPost,body:{threadId:'explicit-thread-42'}})).status,400,`${route} requires X-K-Command`);
  assert.equal(calls.length,0,`${route} without command ID does not reach controller`);
  const commandId=randomUUID();
  const first=await request(remoteUrl(route),{method:'POST',commandId,headers:authenticatedPost,body:{threadId:'explicit-thread-42',payload:'first'}});
  assert.equal(first.status,200,`${route} initial command`);
  assert.equal(calls.length,1,`${route} initial command reaches controller once`);
  const duplicate=await request(remoteUrl(route),{method:'POST',commandId,headers:authenticatedPost,body:{threadId:'explicit-thread-42',payload:'duplicate'}});
  assert.equal(duplicate.status,409,`${route} duplicate command is not replayed`);
  assert.equal(calls.length,1,`${route} duplicate does not invoke controller again`);
  calls.length=0;
 }
 const claudeAuth=await request(remoteUrl('/api/claude/auth'),{headers:authenticatedHeaders});
 assert.equal(claudeAuth.status,200);
 assert.deepEqual(await claudeAuth.json(),{available:true,auth:{loggedIn:true,authMethod:'fake',apiProvider:'fake',subscriptionType:'fake'}});
 assert.doesNotMatch(await claudeAuth.text(),/email|credential|accessToken|sensitive@example\.test|fake-access-token|fake-credential/i);
 const threadId='explicit-thread-42';
 for(const [route,operation] of [['/api/send','send'],['/api/answer','answer'],['/api/stop','stop'],['/api/upload','upload']]){
  const response=await request(remoteUrl(route),{method:'POST',headers:authenticatedPost,body:{threadId,payload:`fake-${operation}`}});
  assert.equal(response.status,200,route);
  assert.equal((await response.json()).threadId,threadId,route);
 }
 const artifact=await request(remoteUrl(`/api/artifact?path=${encodeURIComponent('fake-artifact.txt')}&threadId=${threadId}&download=1`),{headers:authenticatedHeaders});
 assert.equal(artifact.status,200);
 assert.equal(await artifact.text(),'fake artifact');
 assert.deepEqual(calls.map(call=>call[0]),['send','answer','stop','upload','artifact']);
 for(const [,data] of calls.slice(0,4))assert.equal(data.threadId,threadId);
 assert.deepEqual(calls[4].slice(1),['fake-artifact.txt',{threadId}]);

 for(const [route,method,body] of [
  ['/api/codex/login','POST',{}],['/api/core-update','POST',{}],['/api/shutdown','POST',{}],
  ['/api/browser/action','POST',{threadId}],['/api/pick-workspace','POST',{}],
 ]) assert.equal((await request(remoteUrl(route),{method,headers:authenticatedPost,body})).status,403,route);
 assert.equal((await request(remoteUrl('/api/state'),{headers:{...authenticatedHeaders,origin:'https://attacker.example'}})).status,403,'cross-origin remote read');

 const rotatedKey=randomBytes(32).toString('hex');
 await writeFile(remoteFile,JSON.stringify({enabled:true,origin:remoteOrigin,login,keyHash:remoteKeyHash(rotatedKey),port:remotePort}));
 assert.equal((await request(remoteUrl('/api/state'),{headers:authenticatedHeaders})).status,403,'key rotation invalidates old cookie');
 assert.equal((await request(remoteUrl('/api/remote/login'),{method:'POST',headers:remoteHeaders,body:loginBody})).status,403,'old key cannot log in after rotation');
 const rotatedLogin=await request(remoteUrl('/api/remote/login'),{method:'POST',headers:remoteHeaders,body:{key:rotatedKey}});
 assert.equal(rotatedLogin.status,200,'new key can log in');
 const rotatedCookie=rotatedLogin.headers.get('set-cookie').split(';')[0];
 const rotatedGet={...remoteGetHeaders,cookie:rotatedCookie},rotatedPost={...remoteHeaders,cookie:rotatedCookie};
 assert.equal((await request(remoteUrl('/api/state'),{headers:rotatedGet})).status,200);
 const logout=await request(remoteUrl('/api/remote/logout'),{method:'POST',headers:rotatedPost});
 assert.equal(logout.status,200);
 assert.match(logout.headers.get('set-cookie'),/__Host-k_remote=;/);
 assert.equal((await request(remoteUrl('/api/state'),{headers:rotatedGet})).status,403,'logout revokes the cookie session');

 const finalLogin=await request(remoteUrl('/api/remote/login'),{method:'POST',headers:remoteHeaders,body:{key:rotatedKey}});
 assert.equal(finalLogin.status,200);
 const finalCookie=finalLogin.headers.get('set-cookie').split(';')[0];
 const finalHeaders={...remoteGetHeaders,cookie:finalCookie};
 const sse=openEventStream(remoteUrl('/api/events'),finalHeaders);
 await sse.connected;
 await writeFile(remoteFile,JSON.stringify({enabled:false,origin:remoteOrigin,login,keyHash:remoteKeyHash(rotatedKey),port:remotePort}));
 assert.equal((await request(remoteUrl('/api/state'),{headers:finalHeaders})).status,403,'revoked config denies existing session');
 const ended=await Promise.race([sse.closed.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),25000))]);
 if(!ended)sse.close();
 assert.equal(ended,true,'existing SSE connection closes on the next auth heartbeat within 25 seconds');
});

test('malformed remote config and an occupied remote port leave local bootstrap and state usable',async t=>{
 const base=path.resolve('.runtime/mobile-remote-tests');
 await mkdir(base,{recursive:true});
 const startLocal=async (root)=>startDesktop({root,executable:'fake-executable',port:0,
  controllerFactory:()=>({state:{threadId:null,workspace:'fake'},close:async()=>{}}),
  claudeLoginFactory:service,codexLoginFactory:service,geminiLoginFactory:service,
  localDictationFactory:()=>({transcribe:async()=>({}),close:async()=>{}})});
 const verifyLocal=async app=>{
  assert.equal(app.remoteOrigin,null);
  assert.ok(app.remoteError);
  const boot=await request(app.createLaunchUrl());
  assert.equal(boot.status,303);
  const cookie=boot.headers.get('set-cookie').split(';')[0];
  const state=await request(`${app.origin}/api/state`,{headers:{host:new URL(app.origin).host,cookie}});
  assert.equal(state.status,200);
 };

 const malformedRoot=await mkdtemp(path.join(base,'malformed-'));
 await mkdir(path.join(malformedRoot,'.local'),{recursive:true});
 await writeFile(path.join(malformedRoot,'.local','remote-access.json'),'{malformed json');
 const malformedApp=await startLocal(malformedRoot);t.after(()=>malformedApp.close());
 await verifyLocal(malformedApp);

 const busyRoot=await mkdtemp(path.join(base,'busy-port-'));
 await mkdir(path.join(busyRoot,'.local'),{recursive:true});
 const remotePort=await freePort();
 const busyServer=http.createServer((_req,res)=>res.end('fake busy listener'));
 await new Promise((resolve,reject)=>{busyServer.once('error',reject);busyServer.listen(remotePort,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>busyServer.close(()=>resolve())));
 await writeFile(path.join(busyRoot,'.local','remote-access.json'),JSON.stringify({enabled:true,origin:'https://k-busy-test.ts.net',login:'owner@example.ts.net',keyHash:remoteKeyHash(randomBytes(32).toString('hex')),port:remotePort}));
 const busyApp=await startLocal(busyRoot);t.after(()=>busyApp.close());
 await verifyLocal(busyApp);
});

test('remembered phone HTTP restart, durable no-replay, storage failure and disable revoke',async t=>{
 const {readFile,rename}=await import('node:fs/promises');
 const base=path.resolve('.runtime/mobile-remote-tests');await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'remember-http-'));await mkdir(path.join(root,'.local'));
 const remotePort=await freePort(),origin='https://remember.test.ts.net',login='fake@example.test',key='fake-key';
 const file=path.join(root,'.local/remote-access.json'),store=path.join(root,'.local/remote-sessions.json');
 const config={enabled:true,origin,login,port:remotePort,keyHash:remoteKeyHash(key)};await writeFile(file,JSON.stringify(config));
 let sends=0;const controller={state:{threadId:'fake'},send:async()=>{sends++;return{ok:true};},close:async()=>{}};
 const start=()=>startDesktop({root,executable:'fake',port:0,controllerFactory:()=>controller,claudeLoginFactory:service,codexLoginFactory:service,geminiLoginFactory:service,localDictationFactory:()=>({close:async()=>{}})});
 let app=await start();t.after(()=>app.close());
 const headers={host:new URL(origin).host,'tailscale-user-login':login,origin,'x-k-request':'1','content-type':'application/json'};
 const url=route=>`http://127.0.0.1:${remotePort}${route}`;
 const signed=await request(url('/api/remote/login'),{method:'POST',headers,body:{key}});assert.equal(signed.status,200);
 headers.cookie=signed.headers.get('set-cookie').split(';')[0];
 const commandId='http-restart-command';assert.equal((await request(url('/api/send'),{method:'POST',headers,body:{threadId:'fake',text:'fake'},commandId})).status,200);assert.equal(sends,1);
 await app.close();app=await start();assert.equal((await request(url('/api/state'),{headers})).status,200);
 assert.equal((await request(url('/api/send'),{method:'POST',headers,body:{threadId:'fake',text:'fake'},commandId})).status,409);assert.equal(sends,1);
 await app.close();const saved=JSON.parse(await readFile(store,'utf8'));saved.sessions[0].expires-=2*24*60*60*1000;await writeFile(store,JSON.stringify(saved));app=await start();
 // Load without authenticating, so the aged session is not renewed before the failure.
 assert.equal((await request(url('/api/state'),{headers:{...headers,cookie:''}})).status,403);await rename(store,store+'.held');await mkdir(store);
 const failed=await request(url('/api/send'),{method:'POST',headers,body:{threadId:'fake',text:'not sent'}});assert.equal(failed.status,503);assert.equal(sends,1);assert.doesNotMatch(await failed.text(),/EPERM|EISDIR|Users|remote-sessions/);
 const readable=await request(url('/api/state'),{headers});assert.equal(readable.status,200,'read-only state remains available when renewal cannot persist');assert.equal(readable.headers.get('set-cookie'),null,'failed renewal does not claim a renewed cookie');
 await app.close();await rename(store,store+'.failed-target');await rename(store+'.held',store);
 await writeFile(file,JSON.stringify({...config,enabled:false}));app=await start();assert.equal(app.remoteOrigin,null);await app.close();
 await writeFile(file,JSON.stringify(config));app=await start();assert.equal((await request(url('/api/state'),{headers})).status,403,'disable at startup permanently revokes remembered login');
});


test('remote dictation uses only authenticated audio requests, preserves dedup and redacts diagnostics', async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-remote-dictation-'));
 await mkdir(path.join(root,'.local'));
 const origin='https://dictation-test.ts.net',login='owner@example.invalid',key=randomBytes(32).toString('hex'),port=await freePort();
 await writeFile(path.join(root,'.local/remote-access.json'),JSON.stringify({origin,login,keyHash:remoteKeyHash(key),port}));
 let calls=0,fail=false;
 const app=await startDesktop({root,port:0,controllerFactory:()=>({state:{},close:async()=>{}}),
  claudeLoginFactory:service,codexLoginFactory:service,geminiLoginFactory:service,
  localDictationFactory:()=>({close:async()=>{},transcribe:async audio=>{calls++;if(fail)throw Object.assign(Error('private path'),{diagnostic:'C:/private/whisper',statusCode:503});return {ok:true,text:audio==='FAKE_WAV'?'手機聽寫測試':''};}})});
 t.after(()=>app.close());
 const url=route=>`http://127.0.0.1:${port}${route}`,route='/api/dictation/transcribe',body={audioBase64:'FAKE_WAV'};
 const headers={host:new URL(origin).host,'tailscale-user-login':login,origin,'x-k-request':'1','content-type':'application/json'};
 assert.equal((await request(url(route),{method:'POST',headers,body})).status,403);
 const signed=await request(url('/api/remote/login'),{method:'POST',headers,body:{key}});
 const authenticated={...headers,cookie:signed.headers.get('set-cookie').split(';')[0]};
 for(const bad of [{origin:'https://wrong.test'},{'tailscale-user-login':'not-owner'},{'x-k-request':'0'},{cookie:'bad'}])
  assert.equal((await request(url(route),{method:'POST',headers:{...authenticated,...bad},body})).status,403);
 assert.equal((await request(url(route),{method:'POST',headers:authenticated,commandId:null,body})).status,400);
 assert.equal((await request(url(route),{method:'POST',headers:authenticated,body:{...body,path:'forbidden'}})).status,400);
 assert.equal((await request(url(route),{method:'POST',headers:authenticated,body:{audioBase64:'a'.repeat(16*1024*1024)}})).status,413);
 assert.equal(calls,0);
 const commandId=randomUUID();
 const response=await request(url(route),{method:'POST',headers:authenticated,commandId,body});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,text:'手機聽寫測試'});
 assert.equal((await request(url(route),{method:'POST',headers:authenticated,commandId,body})).status,409);
 assert.equal(calls,1);
 fail=true;
 const failed=await request(url(route),{method:'POST',headers:authenticated,body});
 assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{ok:false,error:'轉錄要求無法處理。',code:'INVALID_REQUEST'});
 assert.equal(calls,2);
 for(const route of ['/api/codex/login','/api/shutdown','/api/core-update','/api/browser/action'])
  assert.equal((await request(url(route),{method:'POST',headers:authenticated,body:{}})).status,403);
});
