import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createGeminiController} from '../src/gemini-controller.mjs';
import {identifyBrowserServer} from '../src/browser-mcp-config.mjs';

const models=['gemini-3.8-flash-low'];
const loginFactory=()=>({status:async()=>({available:true,models,version:'fixture'})});
const finish=async c=>{for(let i=0;c.state.busy&&i<400;i++)await new Promise(r=>setTimeout(r,5));assert.equal(c.state.busy,false);};

async function fixture(options={}){
 const base=path.resolve('.runtime/tests');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'gemini-browser-')),events=[],configs=[],closed=[];
 let runImpl=async(_binary,args,params)=>{
  events.push({args,params});params.onStart(12345);const id=args.includes('--conversation')?args[args.indexOf('--conversation')+1]:randomUUID();
  for(const event of [{event:'init',conversation_id:id},{event:'step_update',step_update:{step_type:'agent_response',step_index:1,text_delta:'fixture response',state:'DONE'}},{event:'result',result:{conversation_id:id,status:'SUCCESS',response:'fixture response'}}])params.onChunk(Buffer.from(JSON.stringify(event)+'\n'));
  return {code:0,stderr:''};
 };
 const browserConfig=Object.hasOwn(options,'browserConfig')?options.browserConfig:async input=>{configs.push(input);return identifyBrowserServer({url:'http://127.0.0.1:45678/mcp',http_headers:{Authorization:'Bearer fake-test-only-secret'},startup_timeout_sec:30,tool_timeout_sec:120},input.conversationId);};
 const closeBrowser=options.closeBrowser??(async()=>{closed.push('close');});
 const opts={root,env:{LOCALAPPDATA:path.join(root,'local-app-data'),SystemRoot:process.env.SystemRoot??root,TEMP:path.join(root,'fake-temp'),API_KEY:'must-not-inherit',GEMINI_API_KEY:'must-not-inherit'},run:(...args)=>runImpl(...args),loginFactory,browserConfig,closeBrowser,timeoutMs:180000};
 return {root,events,configs,closed,opts,setRun:next=>{runImpl=next;},controller:createGeminiController({...opts,...options})};
}

const nativeSettings=async c=>JSON.parse(await readFile(path.join(c.opts.root,'agent-home','gemini','main',c.controller.state.threadId,'.gemini','antigravity-cli','settings.json'),'utf8'));
const nativeMcp=async c=>JSON.parse(await readFile(path.join(c.opts.root,'agent-home','gemini','main',c.controller.state.threadId,'.gemini','config','mcp_config.json'),'utf8'));

test('Gemini read-only and an unconfigured browser preserve the native no-browser path',async()=>{
 const f=await fixture({browserConfig:async()=>{throw Error('read-only must not create a browser');}}),c=f.controller;
 try{
  await c.open({model:'gemini-3.8-flash',accessMode:'read-only'});
  assert.equal(c.state.browserAccess.enabled,false);assert.equal(c.state.browserAccess.networkAccess,false);
  const config=await nativeMcp(f),settings=await nativeSettings(f);
  assert.deepEqual(Object.keys(config.mcpServers),[]);assert.ok(settings.permissions.deny.includes('mcp(*)'));
  assert.ok(settings.permissions.deny.includes('command(*)'));assert.ok(settings.permissions.deny.includes('unsandboxed(*)'));
  await c.send({text:'normal request'});await finish(c);assert.equal(f.events.length,1);assert.equal(f.events[0].args.includes('--dangerously-skip-permissions'),false);
  assert.equal(f.events[0].params.env.API_KEY,undefined);assert.equal(f.events[0].params.env.GEMINI_API_KEY,undefined);
 }finally{await c.close();}
});

test('Gemini without a browser helper keeps normal workspace-write execution',async()=>{
 const f=await fixture({browserConfig:undefined}),c=f.controller;
 try{
  await c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'});
  assert.equal(c.state.browserAccess.enabled,false);assert.deepEqual(Object.keys((await nativeMcp(f)).mcpServers),[]);
  assert.ok((await nativeSettings(f)).permissions.deny.includes('mcp(*)'));
  await c.send({text:'normal request'});await finish(c);assert.equal(f.events.length,1);
  assert.equal(f.events[0].params.env.API_KEY,undefined);assert.equal(f.events[0].params.env.GEMINI_API_KEY,undefined);
 }finally{await c.close();}
});

test('Gemini browser native profile exposes only k_browser endpoint and AI header; preserves non-browser denies',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  await c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'});
  assert.equal(f.configs.length,1);assert.equal(f.configs[0].provider,'gemini');assert.equal(f.configs[0].accessMode,'workspace-write');
  assert.equal(c.state.browserAccess.sessionKey,c.state.threadId);
  const config=await nativeMcp(f),settings=await nativeSettings(f);
  assert.deepEqual(Object.keys(config.mcpServers),['k_browser']);
  assert.equal(config.mcpServers.k_browser.serverUrl,'http://127.0.0.1:45678/mcp');
  assert.deepEqual(config.mcpServers.k_browser.headers,{Authorization:'Bearer fake-test-only-secret'});
  assert.doesNotMatch(JSON.stringify(config),/humanRequest|human-token|\/state|\/action/);
  assert.deepEqual(settings.permissions.allow,[`write_file(${f.opts.root})`,'mcp(k_browser/*)']);
  assert.ok(!settings.permissions.allow.some(rule=>/^mcp\((?!k_browser\/\*)/u.test(rule)));
  for(const rule of ['command(*)','unsandboxed(*)',`write_file(${f.opts.env.TEMP})`])assert.ok(settings.permissions.deny.includes(rule));
  assert.ok(!settings.permissions.deny.includes('mcp(*)'));
 }finally{await c.close();}
});

test('Gemini read-only mode change and stop close the browser, then clear MCP profile config',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  await c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'});const afterOpen=f.closed.length;
  await c.send({text:'switch to read only',accessMode:'read-only'});await finish(c);
  assert.equal(f.closed.length,afterOpen+1);assert.equal(c.state.browserAccess.enabled,false);
  assert.deepEqual(Object.keys((await nativeMcp(f)).mcpServers),[]);assert.ok((await nativeSettings(f)).permissions.deny.includes('mcp(*)'));
  // Re-open with browser permission, then stop an in-flight native call.
  await c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'});const beforeStop=f.closed.length;
  let started,release;const seen=new Promise(resolve=>{started=resolve;});
  f.setRun(async(_binary,_args,params)=>{params.onStart(12346);started(params);await new Promise(resolve=>{release=resolve;});return {code:null,reason:'cancelled'};});
  await c.send({text:'stop request'});const params=await seen;assert.equal(params.signal.aborted,false);
  const stopped=c.stop();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(params.signal.aborted,true);release();await stopped;
  assert.equal(c.state.browserAccess.enabled,false);assert.equal(f.closed.length,beforeStop+1);
 }finally{await c.close();}
});

test('Gemini thread switch keeps browser session ownership with the new thread',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  const first=await c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'}),key1=c.state.browserAccess.sessionKey,eventsBeforeSecond=f.closed.length;
  const second=await c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'}),key2=c.state.browserAccess.sessionKey;
  assert.notEqual(first.threadId,second.threadId);assert.equal(key1,first.threadId);assert.equal(key2,second.threadId);
  assert.ok(f.closed.length>eventsBeforeSecond);assert.deepEqual(f.configs.map(x=>x.conversationId),[first.threadId,second.threadId]);
 }finally{await c.close();}
});

test('Gemini failed model/access validation does not clear the existing browser connection',async()=>{
 const f=await fixture(),c=f.controller;
 try{
  await c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'});const before=f.closed.length;
  await assert.rejects(c.open({model:'not-a-native-model',accessMode:'workspace-write'}),/未換模/);
  assert.equal(f.closed.length,before);assert.equal(c.state.browserAccess.enabled,true);
 }finally{await c.close();}
});

test('Gemini open does not retry a browser close that failed once',async()=>{
 let failNext=false;const closes=[];const f=await fixture({closeBrowser:async()=>{closes.push('close');if(failNext){failNext=false;throw Error('close failed');}}}),c=f.controller;
 try{
  await c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'});
  const before=closes.length;failNext=true;
  await assert.rejects(c.open({model:'gemini-3.8-flash',accessMode:'workspace-write'}),/close failed/);
  assert.equal(closes.length,before+1,'a failed close is not immediately retried');
 }finally{await c.close().catch(()=>{});}
});
