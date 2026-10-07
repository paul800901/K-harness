import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createExternalBrowserGateway} from '../src/external-browser-gateway.mjs';

test('browser operations continue without automatic human-yield hooks',async()=>{
 const f=await fixture();
 try{
  await f.call(1,'browser_session',{mode:'regular'});
  assert.equal(f.gateway.noteHumanActivity,undefined);
  assert.equal(f.gateway.resumeAfterUserMessage,undefined);
  for(const id of [2,3,4])assert.match(JSON.stringify(await f.call(id,'browser_navigate',{url:`https://example.invalid/${id}`})),/regular:browser_navigate/);
  assert.equal((await f.gateway.getState()).mode,'ai');
 }finally{await f.gateway.close();}
});

async function read(response){
  const text=await response.text();const data=text.split(/\r?\n/u).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean).join('\n');return JSON.parse(data||text);
}
async function fixture(settings={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'k-external-gateway-')),directory=path.join(root,'out'),profile=path.join(root,'profiles');
  await mkdir(directory);await mkdir(profile);
  const servers=[],created=[],launched=[];
  async function childFactory(childOptions){
    const childName=path.basename(childOptions.profile).replace('external-',''),mode=childName.split('-')[0];created.push({mode,options:childOptions});let human=false,busy=false;
    const secret=`child-secret-${mode}`;
    const server=createServer(async(req,res)=>{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const m=JSON.parse(Buffer.concat(chunks));
      const reply=message=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(message));};
      if(m.method==='initialize')return reply({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fake-child',version:'1'}}});
      if(m.method==='tools/list')return reply({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'browser_snapshot',description:'Snapshot. K automatically fits the right-side browser view to its panel. Choose the task viewport here; users do not need to adjust technical display settings.',inputSchema:{type:'object',properties:{}}},{name:'browser_navigate',description:'Navigate.',inputSchema:{type:'object',properties:{}}}]}});
      if(m.method==='tools/call'&&m.params.name==='browser_snapshot'){
        await childOptions.launchContext?.(childOptions.profile,{width:800,height:600});
        if(settings.warmDelayMs)await new Promise(resolve=>setTimeout(resolve,settings.warmDelayMs));
        if(res.destroyed)return;
        return reply(settings.failWarmMode===mode?{jsonrpc:'2.0',id:m.id,error:{code:-32000,message:'Chrome startup refused by test'}}:{jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:`connected ${mode}`}]}});
      }
      if(m.method==='tools/call'&&m.params.name==='hold'){
        busy=true;await new Promise(resolve=>setTimeout(resolve,120));busy=false;return reply({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'finished'}]}});
      }
      if(m.method==='tools/call')return reply({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:`${childName}:${m.params.name}`}]}});
      return reply({jsonrpc:'2.0',id:m.id,result:{}});
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
    const port=server.address().port;
    const gateway={aiMcpServer:{type:'http',url:`http://127.0.0.1:${port}/mcp`,headers:{Authorization:`Bearer ${secret}`}},async getState(){return {available:true,busy,mode:human?'human':'ai'};},getControlSnapshot(){return {available:true,busy,mode:human?'human':'ai'};},async humanRequest(){return new Response('{}');},async ownerPresentation(){return {}},async close(){created.at(-1).gatewayClosed=true;await new Promise(resolve=>server.close(resolve));},setHuman(value){human=value;}};
    created.at(-1).gateway=gateway;return gateway;
  }
  const gateway=await createExternalBrowserGateway({directory,profile,childGatewayFactory:childFactory,...(settings.profiles?{listExternalProfiles:async()=>structuredClone(settings.profiles)}:{}),launchExternalContext:async options=>{launched.push(options);return {};}});
  const send=(message)=>fetch(gateway.aiMcpServer.url,{method:'POST',headers:{...gateway.aiMcpServer.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(message)});
  const call=(id,name,args={})=>send({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}}).then(read);
  return {root,directory,profile,gateway,servers,created,launched,send,call};
}
async function closeFixture(f){await f.gateway.close();}

test('tool schemas are discoverable before mode selection without opening a browser; child credentials stay private',async()=>{
  const f=await fixture();
  try{
    await f.send({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}});
    const listed=await read(await f.send({jsonrpc:'2.0',id:1,method:'tools/list'}));
    assert.deepEqual(listed.result.tools.map(tool=>tool.name),['browser_snapshot','browser_navigate','browser_session']);
    assert.doesNotMatch(listed.result.tools[0].description,/automatically fits|right-side browser view/);
    assert.equal(f.created.length,1,'schema discovery creates only a dormant child');
    assert.equal(f.launched.length,0,'schema discovery must not open external Chrome');
    assert.equal((await f.gateway.getState()).selectedMode,null);
    assert.match(JSON.stringify(await f.call(2,'browser_navigate',{url:'https://example.invalid'})),/Select browser_session mode/);
    assert.equal(f.created.length,1);
    assert.equal(f.launched.length,0);
    const selected=await f.call(3,'browser_session',{mode:'regular'});
    assert.match(JSON.stringify(selected),/Selected external Chrome regular mode/);
    assert.equal(f.created.length,1);
    assert.equal(f.launched.length,1);assert.equal(f.launched[0].mode,'regular');
    const tools=await read(await f.send({jsonrpc:'2.0',id:4,method:'tools/list'}));
    assert.deepEqual(tools.result.tools.map(tool=>tool.name),['browser_snapshot','browser_navigate','browser_session']);
    assert.doesNotMatch(JSON.stringify({result:tools,config:f.gateway.aiMcpServer,state:await f.gateway.getState()}),/child-secret|external-regular/);
    assert.equal((await f.gateway.getState()).external,true);assert.equal((await f.gateway.getState()).browserMode,'regular');
    assert.match(JSON.stringify(await f.call(5,'browser_navigate')),/regular:browser_navigate/);
  }finally{await closeFixture(f);}
});

test('mode changes are refused during calls and human control, and close shuts down each opened child',async()=>{
  const f=await fixture();
  try{
    await f.call(1,'browser_session',{mode:'regular'});
    const pending=f.call(2,'hold');
    await new Promise(resolve=>setTimeout(resolve,25));
    const rejected=await f.call(3,'browser_session',{mode:'incognito'});
    assert.match(JSON.stringify(rejected),/operation is active/);
    assert.equal(f.created.length,1);
    await pending;
    f.created[0].gateway.setHuman(true);
    const rejectedHuman=await f.call(4,'browser_session',{mode:'regular'});
    assert.match(JSON.stringify(rejectedHuman),/human control/);
    assert.equal((await f.gateway.getState()).browserMode,'regular','a refused repeat selection preserves the active mode');
    f.created[0].gateway.setHuman(false);
    await f.call(5,'browser_session',{mode:'incognito'});
    assert.equal(f.created.length,2);
  }finally{await closeFixture(f);}
  assert.equal(f.servers.every(server=>!server.listening),true);
});

test('owner human state/action responses include external mode and empty state works before selection',async()=>{
  const f=await fixture();
  try{
    const empty=await f.gateway.humanRequest('/state');assert.deepEqual(await empty.json(),{available:false,busy:false,mode:'ai',external:true,browserMode:null});
    const noSelectionAction=await f.gateway.humanRequest('/action',{type:'takeover'});assert.equal(noSelectionAction.status,409);assert.equal((await noSelectionAction.json()).external,true);
    await f.call(1,'browser_session',{mode:'regular'});
    f.created[0].gateway.humanRequest=async route=>Response.json(route==='/state'?{available:true,busy:false,mode:'human'}:{available:true,mode:'ai'});
    for(const route of ['/state','/action']){const response=await f.gateway.humanRequest(route,{});const state=await response.json();assert.equal(state.external,true);assert.equal(state.browserMode,'regular');}
  }finally{await closeFixture(f);}
});

test('warm-up RPC errors are reported and failed child is closed with no fallback selection',async()=>{
  const f=await fixture({failWarmMode:'incognito'});
  try{
    const result=await f.call(1,'browser_session',{mode:'incognito'});
    assert.match(JSON.stringify(result),/Chrome startup refused by test/);
    assert.equal((await f.gateway.getState()).selectedMode,null);
    assert.equal(f.created[0].gatewayClosed,true);
  }finally{await closeFixture(f);}
});

test('MCP cancellation reaches a browser_session while its warm-up is queued',async()=>{
  const f=await fixture({warmDelayMs:500});
  try{
    const pending=f.call(41,'browser_session',{mode:'regular'});
    await new Promise(resolve=>setTimeout(resolve,40));
    const cancelled=await f.send({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:41}});
    assert.equal(cancelled.status,202);
    const result=await pending;
    assert.match(JSON.stringify(result),/Could not open external Chrome regular mode/);
    assert.equal((await f.gateway.getState()).selectedMode,null);
    assert.equal(f.created[0].gatewayClosed,true);
  }finally{await closeFixture(f);}
});

test('disconnected browser selection reports recovery rather than human takeover',async()=>{
 const f=await fixture();try{
  await f.call(1,'browser_session',{mode:'regular'});
  f.created[0].gateway.getState=async()=>({available:false,busy:false,mode:'human',recoveryRequired:true});
  const reply=await f.call(2,'browser_session',{mode:'regular'});
  assert.equal(reply.result.isError,true);assert.match(reply.result.content[0].text,/連線已中止/);assert.match(reply.result.content[0].text,/不會自動重送/);
 }finally{await closeFixture(f);}
});

test('profiles are discoverable on demand, ambiguous selection fails and four targets stay distinct and pinned',async()=>{
 const ids=['a','b','c','d'].map(c=>c.repeat(32));
 const profiles=ids.map(profileId=>({profileId,connected:true,modes:['regular','incognito']}));
 const f=await fixture({profiles});
 try{
  const listing=await f.call(1,'browser_profiles');assert.equal(JSON.parse(listing.result.content[0].text).profiles.length,4);assert.equal(f.created.length,0);
  assert.equal((await f.call(2,'browser_session',{mode:'regular'})).result.isError,true);assert.equal(f.created.length,0);
  for(let i=0;i<4;i++){
   const selected=await f.call(10+i*2,'browser_session',{mode:'regular',profileId:ids[i]});assert.match(selected.result.content[0].text,new RegExp(ids[i]));
   assert.match(JSON.stringify(await f.call(11+i*2,'browser_evaluate')),new RegExp(`regular-${ids[i]}:browser_evaluate`));
   assert.equal(f.launched.at(-1).profileId,ids[i]);assert.equal((await f.gateway.getState()).profileId,ids[i]);
  }
  profiles.push({profileId:'e'.repeat(32),connected:true,modes:['regular']});
  assert.match(JSON.stringify(await f.call(30,'browser_session',{mode:'regular'})),new RegExp(ids[3]));
  assert.equal(f.created.length,4,'new registration cannot silently retarget a working session');
  const failed=await f.call(31,'browser_session',{mode:'regular',profileId:'f'.repeat(32)});assert.equal(failed.result.isError,true);assert.equal((await f.gateway.getState()).selectedMode,null);
  assert.equal((await f.call(32,'browser_evaluate')).result.isError,true,'failed explicit selection leaves no prior implicit fallback');
  assert.ok((await f.call(33,'browser_session',{mode:'regular',profileId:'../../secret'})).error);
 }finally{await closeFixture(f);}
});
