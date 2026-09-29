import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {browserSessionKey,toClaudeBrowserMcpServer} from '../src/browser-mcp-config.mjs';
import {createOwnerBrowserRegistry} from '../src/owner-browser-registry.mjs';

async function fixture(options={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'k-owner-registry-'));
  const vault=path.join(root,'vault'),outputRoot=path.join(root,'output');
  await mkdir(vault);await mkdir(outputRoot);
  const calls=[];let next=0;
  const registry=createOwnerBrowserRegistry({vault,outputRoot,...options,gatewayFactory:async options=>{
    const id=++next,call={id,...options,closed:0,closeError:null,request:null};calls.push(call);
    return {aiMcpServer:{type:'http',url:`http://127.0.0.1:${40000+id}/mcp`,headers:{Authorization:`Bearer AI-${id}`}},
      async humanRequest(route,body){call.request?.(route,body);return call.response??new Response(JSON.stringify({available:true,mode:'human',id}));},
      async ownerPresentation(pageId){return {page:{owner:id,pageId},control:{mode:'human',aiCalls:0,busy:false,available:true,selectedPageId:pageId,humanInputAllowed:true}};},
      getControlSnapshot(){return {mode:'human',aiCalls:0,busy:false,available:true,selectedPageId:'page-owner',humanInputAllowed:true};},
      async close(){call.closed++;if(call.closeError)throw call.closeError;},
    };
  }});
  return {root,vault,outputRoot,calls,registry};
}
const config=(controller,conversationId,accessMode='workspace-write',provider='codex')=>controller.config({conversationId,accessMode,provider});

test('owner selects the test-only notice without exposing owner authority to the model',async()=>{
 for(const options of [{},{testOnly:false}]){
  const f=await fixture(options),session=f.registry.session();
  try{
   const server=await config(session,'conversation-a');
   assert.equal(server.testOnly,undefined);
   const state={threadId:'thread-a',browserAccess:{enabled:true,sessionKey:'conversation-a'}};
   for(const route of ['/state','/action'])assert.equal((await f.registry.request({},state,'thread-a',route)).testOnly,options.testOnly!==false);
  }finally{await session.close();await f.registry.close();}
 }
});

test('owner profiles are per conversation and provider config exposes only AI HTTP authority',async()=>{
  const f=await fixture(),session=f.registry.session();
  try{
    const server=await config(session,'conversation-a');
    assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].profile,path.join(f.vault,'conversation-a'));
    assert.equal(f.calls[0].directory,path.join(f.outputRoot,'conversation-a'));
    assert.equal(server.url,'http://127.0.0.1:40001/mcp');
    assert.deepEqual(server.http_headers,{Authorization:'Bearer AI-1'});
    assert.equal(browserSessionKey(server),'conversation-a');
    assert.doesNotMatch(JSON.stringify(server),/conversation-a|vault|live\.json|human|browser-profile/);
    const claude=toClaudeBrowserMcpServer(server);
    assert.deepEqual(claude,{type:'http',url:server.url,headers:{Authorization:'Bearer AI-1'}});
    assert.equal(browserSessionKey(claude),'conversation-a');
    assert.doesNotMatch(JSON.stringify(claude),/conversation-a|vault|human/);
  }finally{await session.close();await f.registry.close();}
});

test('native presentation is owner-only and validates current thread and browser session scope',async()=>{
  const changes=[],f=await fixture({onControlChange:state=>changes.push(state)}),session=f.registry.session();
  try{
    const server=await config(session,'conversation-a');
    const state={threadId:'thread-a',browserAccess:{enabled:true,sessionKey:'conversation-a'}};
    assert.equal(f.calls[0].onControlChange instanceof Function,true,'trusted native callback is injected only into the owner gateway factory');
    assert.deepEqual(await f.registry.presentation(state,'thread-a','page-1'),{
      page:{owner:1,pageId:'page-1'},
      control:{mode:'human',aiCalls:0,busy:false,available:true,selectedPageId:'page-1',humanInputAllowed:true},
    });
    assert.deepEqual(f.registry.controlSnapshot(state,'thread-a'),{mode:'human',aiCalls:0,busy:false,available:true,selectedPageId:'page-owner',humanInputAllowed:true});
    await assert.rejects(f.registry.presentation(state,'thread-b','page-1'),/對話已切換/u);
    await assert.rejects(f.registry.presentation({...state,browserAccess:{enabled:false,sessionKey:'conversation-a'}},'thread-a','page-1'),/尚未啟用/u);
    await assert.rejects(f.registry.presentation({...state,browserAccess:{enabled:true,sessionKey:'conversation-b'}},'thread-a','page-1'),/連線已結束/u);
    assert.doesNotMatch(JSON.stringify(server),/ownerPresentation|controlSnapshot|humanInputAllowed/);
    assert.equal(changes.length,0,'registry passes through rather than invoking native callback on behalf of Electron');
  }finally{await session.close();await f.registry.close();}
});

test('read-only reconfiguration closes the previous owner gateway before disabling it',async()=>{
  const f=await fixture(),session=f.registry.session();
  try{
    await config(session,'conversation-a');
    const disabled=await config(session,'conversation-a','read-only');
    assert.equal(disabled,null);assert.equal(f.calls[0].closed,1);
    const reopened=await config(session,'conversation-a','workspace-write');
    assert.ok(reopened);assert.equal(f.calls.length,2);
  }finally{await session.close();await f.registry.close();}
});

test('a conversation profile cannot be owned by two live sessions',async()=>{
  const f=await fixture(),first=f.registry.session(),second=f.registry.session();
  try{
    await config(first,'same-conversation');
    await assert.rejects(config(second,'same-conversation'),/already owned/);
    assert.equal(f.calls.length,1);
  }finally{await first.close();await second.close();await f.registry.close();}
});

test('a delayed browser response is discarded after its connection is replaced',async()=>{
  const f=await fixture(),session=f.registry.session();
  try{
    await config(session,'conversation-a');
    let finish;
    f.calls[0].response=new Promise(resolve=>finish=resolve);
    const state={threadId:'thread-a',browserAccess:{enabled:true,sessionKey:'conversation-a'}};
    const pending=f.registry.request({},state,'thread-a','/state');
    await new Promise(resolve=>setTimeout(resolve,0));
    await config(session,'conversation-a');
    finish(new Response(JSON.stringify({available:true,mode:'human'})));
    await assert.rejects(pending,/連線已變更/);
    assert.equal(f.calls[0].closed,1);assert.equal(f.calls.length,2);
  }finally{await session.close();await f.registry.close();}
});

test('a failed owner close retains the per-conversation lease',async()=>{
  const f=await fixture(),first=f.registry.session(),second=f.registry.session();
  try{
    await config(first,'conversation-a');
    f.calls[0].closeError=new Error('close not confirmed');
    await assert.rejects(first.close(),/close not confirmed/);
    await assert.rejects(config(second,'conversation-a'),/already owned/);
    f.calls[0].closeError=null;
    await first.close();
    assert.equal(f.calls[0].closed,2);
    assert.ok(await config(second,'conversation-a'));
  }finally{f.calls[0].closeError=null;await first.close();await second.close();await f.registry.close();}
});

test('close waits for a deferred gateway open, deduplicates concurrent closes, and only then releases the profile',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'k-owner-registry-open-'));
  const vault=path.join(root,'vault'),outputRoot=path.join(root,'output');await mkdir(vault);await mkdir(outputRoot);
  const opening=Promise.withResolvers(),entered=Promise.withResolvers();let factoryCalls=0,closeCalls=0;
  const registry=createOwnerBrowserRegistry({vault,outputRoot,gatewayFactory:async()=>{
    factoryCalls++;
    if(factoryCalls===1){entered.resolve();return opening.promise;}
    return {aiMcpServer:{url:'http://127.0.0.1:45002/mcp',headers:{Authorization:'Bearer NEXT'}},close:async()=>{closeCalls++;}};
  }});
  const first=registry.session(),second=registry.session();
  try{
    const configuring=config(first,'conversation-a');await entered.promise;
    let finished=false;
    const closeA=first.close().then(()=>{finished=true;});
    const closeB=first.close();
    await assert.rejects(config(second,'conversation-a'),/already owned/);
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(finished,false,'close must wait until the opening factory settles');
    const firstGateway={aiMcpServer:{url:'http://127.0.0.1:45001/mcp',headers:{Authorization:'Bearer FIRST'}},close:async()=>{closeCalls++;}};
    opening.resolve(firstGateway);
    await Promise.all([closeA,closeB]);
    await assert.rejects(configuring,/closed while opening/);
    assert.equal(closeCalls,1,'concurrent close calls must close the opened gateway once');
    assert.ok(await config(second,'conversation-a'),'the profile may be reused after close is confirmed');
    assert.equal(factoryCalls,2);
  }finally{await first.close();await second.close();await registry.close();}
});
