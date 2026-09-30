import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {createBrowserOwnerGateway} from '../src/browser-owner-gateway.mjs';

async function fixture(options={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'k-owner-browser-'));
  const directory=path.join(root,'output'),profile=path.join(root,'private-profile');
  await mkdir(directory);await mkdir(profile);
  const gateway=await createBrowserOwnerGateway({directory,profile,launchContext:async(profile,viewport)=>chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport}),...options});
  const config=gateway.aiMcpServer;
  const send=(message,extra={})=>fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...extra.headers},body:JSON.stringify(message),...('signal' in extra?{signal:extra.signal}:{})});
  const call=(id,name,args={})=>send({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}}).then(body);
  const init=()=>send({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'owner-pilot',version:'1'}}}).then(body);
  return {root,directory,profile,gateway,config,send,call,init};
}
async function body(response){
  assert.equal(response.status,200);
  const text=await response.text();
  const data=text.split(/\r?\n/u).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean).join('\n');
  return JSON.parse(data||text);
}
async function waitFor(read,predicate){
  for(let n=0;n<200;n++){
    const state=await read();if(predicate(state))return state;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.fail('Browser did not reach expected state.');
}

test('owner gateway gives AI only MCP authority and never writes a human token file',async()=>{
  const f=await fixture();
  try{
    const origin=new URL(f.config.url).origin;
    const anonymous=await fetch(origin);
    assert.equal(anonymous.status,401);assert.equal(anonymous.headers.get('set-cookie'),null);
    assert.equal((await fetch(`${origin}/action`,{method:'POST',headers:f.config.headers,body:'{"type":"release"}'})).status,404);
    assert.equal((await f.send({jsonrpc:'2.0',id:1,method:'tools/list'},{headers:{Origin:'https://untrusted.invalid'}})).status,403);
    await f.init();
    const tools=await body(await f.send({jsonrpc:'2.0',id:2,method:'tools/list'}));
    assert(tools.result.tools.some(tool=>tool.name==='browser_navigate'));
    assert(!tools.result.tools.some(tool=>tool.name==='browser_run_code_unsafe'));
    assert.doesNotMatch(JSON.stringify(f.config),/private-profile|live\.json|command|args/);
    await assert.rejects(readFile(path.join(f.profile,'live.json')),error=>error.code==='ENOENT');
    const fake=path.join(f.root,'fake-cookie.txt');await writeFile(fake,'FAKE_COOKIE_ONLY');
    assert.match(JSON.stringify(await f.call(3,'browser_file_upload',{paths:[fake]})),/File access denied/);
    assert.match(JSON.stringify(await f.call(30,'browser_drop',{paths:[fake]})),/File access denied/);
    assert.match(JSON.stringify(await f.call(4,'browser_run_code_unsafe',{code:'return 1'})),/not enabled/);
    assert.equal((await f.gateway.getState()).busy,false);
  }finally{await f.gateway.close();}
});

test('owner takeover survives AI reconnect; real browser page is shared and returns to AI',async()=>{
  const site=createServer((req,res)=>res.end('<!doctype html><title>Owner pilot</title><label>Name<input aria-label="Name"></label>'));
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
  const f=await fixture();
  try{
    await f.init();
    const navigation=await f.call(1,'browser_navigate',{url:`http://127.0.0.1:${site.address().port}/`});
    assert.notEqual(navigation.result.isError,true);
    const originalFetch=globalThis.fetch;let loopbackFetches=0;
    globalThis.fetch=(...args)=>{if(String(args[0]).startsWith('http://127.0.0.1:')){loopbackFetches++;throw new Error('human control must not fetch localhost');}return originalFetch(...args);};
    let control;
    try{control=await f.gateway.humanRequest('/action',{type:'takeover'}).then(r=>r.json());}finally{globalThis.fetch=originalFetch;}
    assert.equal(loopbackFetches,0);
    assert.equal(control.mode,'human');assert.equal(control.available,true);
    assert.equal(typeof f.gateway.getControlSnapshot,'function');
    const shot=await f.gateway.humanRequest(`/frame?pageId=${control.selectedPageId}`);
    assert.equal(shot.headers.get('Content-Type'),'image/jpeg');assert((await shot.arrayBuffer()).byteLength>100);
    await f.init(); // Simulates a new CLI connection, not a new owner session.
    assert.match(JSON.stringify(await f.call(2,'browser_snapshot')),/human-control/);
    const unauthorized=await fetch(new URL('/action',f.config.url),{method:'POST',headers:f.config.headers,body:'{"type":"release"}'});
    assert.equal(unauthorized.status,404);
    assert.equal((await f.gateway.getState()).mode,'human');
    await f.gateway.humanRequest('/action',{type:'key',key:'Tab'});
    await f.gateway.humanRequest('/action',{type:'text',text:'人工假資料'});
    assert.equal((await f.gateway.humanRequest('/action',{type:'release'}).then(r=>r.json())).mode,'ai');
    const result=await f.call(3,'browser_snapshot');
    assert.notEqual(result.result.isError,true);assert.match(JSON.stringify(result),/人工假資料/);
    await assert.rejects(readFile(path.join(f.profile,'live.json')),error=>error.code==='ENOENT');
  }finally{await f.gateway.close();await new Promise(resolve=>site.close(resolve));}
});

test('AI HTTP disconnect cancels safely and duplicate request IDs cannot release a busy lock',async()=>{
  const f=await fixture();
  try{
    await f.init();assert.notEqual((await f.call(1,'browser_snapshot')).result.isError,true);
    const abort=new AbortController();
    const response=await f.send({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'browser_wait_for',arguments:{time:30}}},{signal:abort.signal});
    const pending=response.text();pending.catch(()=>{});
    await waitFor(f.gateway.getState,state=>state.busy);
    const collision=await f.send({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'browser_snapshot',arguments:{}}});
    assert.equal(collision.status,409);
    assert.equal((await f.gateway.getState()).busy,true);
    abort.abort();await assert.rejects(pending);
    const final=await waitFor(f.gateway.getState,state=>state.recoveryRequired&&!state.busy);
    assert.equal(final.available,false);assert.equal(final.mode,'human');
    assert.match(JSON.stringify(await f.call(6,'browser_snapshot')),/unavailable/);
  }finally{await f.gateway.close();}
});

test('owner gateway rejects storing human profile within AI browser files',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'k-owner-overlap-'));
  const profile=path.join(root,'profile');await mkdir(profile);
  await assert.rejects(createBrowserOwnerGateway({directory:root,profile}),/outside AI browser files/);
});

function jpegDimensions(bytes){
  for(let i=2;i<bytes.length;){
    if(bytes[i++]!==0xff)continue;
    let marker=bytes[i++];while(marker===0xff)marker=bytes[i++];
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:bytes.readUInt16BE(i+3),width:bytes.readUInt16BE(i+5)};
    if(marker===0xd8||marker===0xd9||(marker>=0xd0&&marker<=0xd7))continue;
    const length=bytes.readUInt16BE(i);if(!length)break;i+=length;
  }
  throw new Error('JPEG frame dimensions were not found.');
}

test('Edge MCP resize, CSS zoom, page-coordinate click, takeover guard, and AI tab selection stay distinct',async()=>{
  const site=createServer((req,res)=>{
    const page=req.url==='/two'?'<title>PAGE_TWO</title><h1>PAGE_TWO</h1>':'<title>PAGE_ONE</title><h1>PAGE_ONE</h1><input id="target" aria-label="fake input" style="position:absolute;left:420px;top:260px;width:240px;height:52px">';
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${page}`);
  });
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
  let edgeContext;
  const f=await fixture({launchContext:async(profile,viewport)=>{
    edgeContext=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport});return edgeContext;
  }});
  let id=10;
  const tool=async(name,args={})=>f.call(id++,name,args);
  try{
    await f.init();
    const listed=await body(await f.send({jsonrpc:'2.0',id:9,method:'tools/list'}));
    for(const name of ['browser_resize','browser_evaluate','browser_tabs'])assert(listed.result.tools.some(item=>item.name===name));
    assert.match(listed.result.tools.find(item=>item.name==='browser_resize').description,/automatically fits/u);
    assert.match(listed.result.tools.find(item=>item.name==='browser_evaluate').description,/documentElement\.style\.zoom/u);
    assert.match(listed.result.tools.find(item=>item.name==='browser_tabs').description,/select the intended AI tab explicitly/u);
    const origin=`http://127.0.0.1:${site.address().port}`;
    assert.notEqual((await tool('browser_navigate',{url:`${origin}/one`})).result.isError,true);
    assert.notEqual((await tool('browser_tabs',{action:'new',url:`${origin}/two`})).result.isError,true);
    assert.notEqual((await tool('browser_tabs',{action:'list'})).result.isError,true);
    assert.equal(edgeContext.pages().length,2);
    assert.notEqual((await tool('browser_tabs',{action:'select',index:0})).result.isError,true);
    assert.match(await edgeContext.pages()[0].evaluate(()=>navigator.userAgent),/Edg\//,'the persistent context is a real Microsoft Edge session');

    // The native MCP call changes the real Edge viewport, not just a UI model.
    const resized=await tool('browser_resize',{width:1440,height:900});
    assert.notEqual(resized.result.isError,true,JSON.stringify(resized));
    assert.deepEqual(edgeContext.pages()[0].viewportSize(),{width:1440,height:900});
    const zoomed=await tool('browser_evaluate',{function:'() => { document.documentElement.style.zoom="0.8"; return document.documentElement.style.zoom; }'});
    assert.notEqual(zoomed.result.isError,true,JSON.stringify(zoomed));
    assert.equal(await edgeContext.pages()[0].evaluate(()=>document.documentElement.style.zoom),'0.8');
    const zoomReset=await tool('browser_evaluate',{function:'() => { document.documentElement.style.zoom="1"; return document.documentElement.style.zoom; }'});
    assert.notEqual(zoomReset.result.isError,true,JSON.stringify(zoomReset));
    assert.equal(await edgeContext.pages()[0].evaluate(()=>document.documentElement.style.zoom),'1');
    await tool('browser_evaluate',{function:'() => { document.documentElement.style.zoom="0.8"; return document.documentElement.style.zoom; }'});
    const zoomedRect=await edgeContext.pages()[0].locator('#target').boundingBox();
    assert(zoomedRect&&zoomedRect.width>0&&zoomedRect.height>0);

    // A letterboxed 650x500 panel represents the screenshot without changing its viewport.
    const mapped={x:zoomedRect.x+zoomedRect.width/2,y:zoomedRect.y+zoomedRect.height/2};
    const frameState=await f.gateway.getState();
    const firstPage=frameState.pages.find(page=>page.url.endsWith('/one'));
    assert(firstPage);
    const frameResponse=await f.gateway.humanRequest(`/frame?pageId=${firstPage.id}`);
    assert.equal(frameResponse.headers.get('Content-Type'),'image/jpeg');
    assert.deepEqual(jpegDimensions(Buffer.from(await frameResponse.arrayBuffer())),{width:1440,height:900});

    const human=await f.gateway.humanRequest('/action',{type:'takeover'}).then(response=>response.json());
    assert.equal(human.mode,'human');
    const pageTwo=human.pages.find(page=>page.url.endsWith('/two'));
    await f.gateway.humanRequest('/action',{type:'selectPage',pageId:pageTwo.id});
    assert.equal((await f.gateway.getState()).selectedPageId,pageTwo.id,'human preview selection changes the UI preview target');
    await f.gateway.humanRequest('/action',{type:'selectPage',pageId:firstPage.id});

    for(const [name,args] of [['browser_resize',{width:1280,height:720}],['browser_evaluate',{function:'() => { document.documentElement.style.zoom="1"; }'}]]){
      const denied=await tool(name,args);assert.equal(denied.result.isError,true,JSON.stringify(denied));
      assert.match(JSON.stringify(denied),/human-control mode/);
    }
    await f.gateway.humanRequest('/action',{type:'click',pageId:firstPage.id,...mapped});
    await f.gateway.humanRequest('/action',{type:'text',pageId:firstPage.id,text:'EDGE_FAKE_INPUT'});
    assert.equal(await edgeContext.pages()[0].locator('#target').inputValue(),'EDGE_FAKE_INPUT');
    await f.gateway.humanRequest('/action',{type:'release'});
    assert.equal((await f.gateway.getState()).mode,'ai');
    assert.match(JSON.stringify(await tool('browser_snapshot')),/PAGE_TWO/,'human preview switching did not change the AI-selected native tab');
    const aiSelectFirst=await tool('browser_tabs',{action:'select',index:0});
    assert.notEqual(aiSelectFirst.result.isError,true,JSON.stringify(aiSelectFirst));
    assert.match(JSON.stringify(await tool('browser_snapshot')),/PAGE_ONE/);
    const resetAfterHandoff=await tool('browser_evaluate',{function:'() => { document.documentElement.style.zoom="1"; return document.documentElement.style.zoom; }'});
    assert.notEqual(resetAfterHandoff.result.isError,true,JSON.stringify(resetAfterHandoff));
    assert.equal(await edgeContext.pages()[0].evaluate(()=>document.documentElement.style.zoom),'1');
    assert.equal((await f.gateway.getState()).busy,false);
  }finally{await f.gateway.close();await new Promise(resolve=>site.close(resolve));}
});
