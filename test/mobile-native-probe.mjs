// Explicit opt-in real subscription probe, isolated fake workspace and K records.
// Never run as part of npm test. Does not touch formal K conversations.
// Gemini is opt-in: first confirm formal K/account work has stopped, because
// the official CLI uses the Windows login even with an isolated profile.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {startDesktop} from '../src/desktop-server.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {createClaudeController} from '../src/claude-controller.mjs';
import {createGeminiController} from '../src/gemini-controller.mjs';
import {geminiProcess,geminiStream} from '../src/gemini-worker.mjs';
import {openCodexHost} from '../src/codex-host.mjs';
import {inspectClaude,openClaudeHost} from '../src/claude-host.mjs';
import {remoteKeyHash} from '../src/remote-access.mjs';

const base=process.env.K_NATIVE_PROBE_BASE;
if(!base||!path.isAbsolute(base))throw Error('Explicit K_NATIVE_PROBE_BASE is required; no provider or billing fallback.');
const providers=(process.env.K_NATIVE_PROBE_PROVIDERS??'codex,claude').split(',');
if(!providers.length||new Set(providers).size!==providers.length||providers.some(p=>!['codex','claude','gemini'].includes(p)))throw Error('Select explicit codex, claude and/or gemini providers.');
const resultPrefix=process.env.K_NATIVE_PROBE_PROVIDERS?`native-${providers.join('-')}`:'native';
const out=path.resolve('.runtime/mobile-remote');await mkdir(out,{recursive:true});
const root=await mkdtemp(path.join(out,'native-')),selected=JSON.parse(await readFile(path.join(base,'trusted-providers/selected-cores.json'),'utf8'));
const executable=path.join(base,'trusted-providers',selected.codex.file),commandSpec={command:path.join(base,'trusted-providers',selected.claude.file),argsPrefix:[]};
if(providers.includes('gemini')&&!selected.gemini?.file)throw Error('No selected K Gemini executable; no fallback.');
const geminiExecutable=providers.includes('gemini')?path.join(base,'trusted-providers',selected.gemini.file):undefined;
const env={...process.env,CODEX_HOME:path.join(base,'agent-home/.codex'),CLAUDE_CONFIG_DIR:path.join(base,'agent-home/.claude'),DISABLE_AUTOUPDATER:'1'};
for(const k of Object.keys(env))if(/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|^(ANTHROPIC_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_USE_|AWS_|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_CLOUD_|CLOUD_ML_|AZURE_)/i.test(k))delete env[k];
const remotePort=54834,origin='https://native-mobile-test.ts.net',key=randomBytes(32).toString('hex');
await mkdir(path.join(root,'.local'));await writeFile(path.join(root,'.local/remote-access.json'),JSON.stringify({port:remotePort,origin,login:'probe@example.invalid',keyHash:remoteKeyHash(key)}));
const calls=[],observations=[],results=[];let app,finish;
const service=()=>({close:async()=>{}});
const factory=options=>createConversationController({...options,inspect:({signal})=>inspectClaude({commandSpec,cwd:root,env,signal}),
 codexFactory:opts=>createDesktopController({...opts,executable,hostFactory:params=>{const host=openCodexHost({...params,env}),request=host.request.bind(host);host.request=async(method,data,...rest)=>{if(['thread/start','thread/resume','turn/start'].includes(method))calls.push({provider:'codex',method,threadId:data.threadId,model:data.model});return request(method,data,...rest);};return host;}}),
 claudeFactory:opts=>createClaudeController({...opts,executable,commandSpec,hostFactory:async params=>{const host=await openClaudeHost({...params,env});calls.push({provider:'claude',method:'open',sessionId:params.sessionId,resume:params.resume,model:params.model});const start=host.start.bind(host);host.start=async(...args)=>{calls.push({provider:'claude',method:'start',sessionId:params.sessionId});return start(...args);};return host;}}),
 geminiFactory:opts=>createGeminiController({...opts,env,geminiExecutable,run:async(binary,args,options)=>{
  const at=args.indexOf('--conversation'),call={provider:'gemini',method:'turn',nativeSessionId:at<0?null:args[at+1],model:args[args.indexOf('--model')+1],returnedSessionIds:[]};calls.push(call);
  const parser=geminiStream(event=>{const id=event.conversation_id??event.init?.conversation_id??event.result?.conversation_id;if(id&&!call.returnedSessionIds.includes(id))call.returnedSessionIds.push(id);});
  try{return await geminiProcess(binary,args,{...options,onChunk:chunk=>{parser.write(chunk);options.onChunk?.(chunk);}});}finally{parser.end();}
 }}),
});
async function start(){app=await startDesktop({root,executable,port:0,controllerFactory:factory,claudeLoginFactory:service,codexLoginFactory:service,geminiLoginFactory:service,localDictationFactory:()=>({close:async()=>{}})});app.onStateChange(state=>{observations.push({threadId:state.threadId,status:state.status,busy:state.busy,messages:state.messages?.length});if(finish&&!state.busy&&['completed','failed','error','uncertain'].includes(state.status)){finish();finish=null;}});}
async function request(route,data,cookie){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:remotePort,path:route,method:data===undefined?'GET':'POST',headers:{Host:new URL(origin).host,Origin:origin,'Tailscale-User-Login':'probe@example.invalid','X-K-Request':'1','X-K-Command':randomUUID(),'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{let value;try{value=JSON.parse(body);}catch{value=body;}if(res.statusCode!==200)return reject(Error(JSON.stringify(value)));resolve({value,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});});});req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));});}
let cookie;
async function send(threadId,text){let timer;const done=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>{finish=null;reject(Error('Native test turn unconfirmed; no replay'));},120000);});try{await request('/api/send',{threadId,text},cookie);await done;assert.equal(app.controller.state.status,'completed',app.controller.state.error);return app.controller.state.messages.filter(m=>m.role==='assistant').at(-1)?.text??'';}finally{clearTimeout(timer);}}
try{
 for(const [provider,model,accessMode]of [['codex','gpt-6-luna','read-only'],['claude','claude-opus-5-5','claude-plan'],['gemini','gemini-3.8-flash','read-only']].filter(([provider])=>providers.includes(provider))){
  await start();cookie=(await request('/api/remote/login',{key})).cookie;
  const opened=(await request('/api/open',{model,effort:'low',workspace:root,accessMode},cookie)).value;
  const threadId=opened.threadId,marker=`K_REMOTE_${provider.toUpperCase()}_${randomBytes(4).toString('hex')}`;
  const first=await send(threadId,`This is an isolated transport verification. Reply exactly ${marker}. No tools, agents, goals, file changes or commands. End after replying.`);assert(first.includes(marker));
  assert.equal(app.controller.state.tools?.length??0,0,'Native history probe must not use tools or read the saved marker');
  const nativeSessionId=provider==='gemini'?JSON.parse(await readFile(path.join(root,'.runtime/gemini-sessions',`${threadId}.json`),'utf8')).nativeSessionId:null;
  if(provider==='gemini')assert.match(nativeSessionId,/^[0-9a-f-]{36}$/u);
  const localBootstrap=await fetch(app.createLaunchUrl(),{redirect:'manual'}),localCookie=localBootstrap.headers.get('set-cookie').split(';')[0];
  const desktop=await(await fetch(app.origin+'/api/state',{headers:{Cookie:localCookie}})).json();assert.equal(desktop.threadId,threadId);assert(desktop.messages.some(m=>m.text?.includes(marker)));
  await app.close();app=null;
  await start();cookie=(await request('/api/remote/login',{key})).cookie;await request('/api/open',{threadId,model},cookie);
  assert.equal(app.controller.state.threadId,threadId);assert.equal(app.controller.state.accessMode,accessMode);
  const second=await send(threadId,'Reply exactly the verification marker you returned in your previous answer. Do not use tools, agents, goals, commands or files.');assert(second.includes(marker));
  assert.equal(app.controller.state.tools?.length??0,0,'Native history probe must not use tools or read the saved marker');
  if(provider==='gemini'){
   const resumed=JSON.parse(await readFile(path.join(root,'.runtime/gemini-sessions',`${threadId}.json`),'utf8'));
   assert.equal(resumed.nativeSessionId,nativeSessionId);
   assert.equal(calls.filter(c=>c.provider==='gemini').length,2);
   assert.equal(calls.filter(c=>c.provider==='gemini').at(-1).nativeSessionId,nativeSessionId);
   for(const call of calls.filter(c=>c.provider==='gemini'))assert.deepEqual(call.returnedSessionIds,[nativeSessionId],'Both native turns must report the same actual conversation ID');
  }
  results.push({provider,model,threadId,...(nativeSessionId?{nativeSessionId}:{}),accessMode,first,second,sameNativeHistory:true});
  await app.close();app=null;
 }
 await writeFile(path.join(out,`${resultPrefix}-result.json`),JSON.stringify({passed:true,root,results,calls,observations,notRun:['codex','claude','gemini'].filter(p=>!providers.includes(p))},null,2));console.log(JSON.stringify({passed:true,providers:results.map(r=>r.provider)}));
}catch(error){await writeFile(path.join(out,`${resultPrefix}-failure.json`),JSON.stringify({error:error.stack,root,results,calls,observations,state:app?{status:app.controller.state.status,error:app.controller.state.error}:null},null,2));throw error;}
finally{if(app){if(app.controller.state.busy)await app.controller.stop({threadId:app.controller.state.threadId});await app.close();}}
