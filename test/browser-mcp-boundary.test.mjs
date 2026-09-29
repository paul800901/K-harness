import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

import {pathToFileURL} from 'node:url';
import {restrictedBrowserTransport,validateBrowserFiles} from '../src/browser-mcp-stdio.mjs';
import {readBrowserMcpConfig} from '../src/browser-mcp-config.mjs';

test('MCP stdin EOF closes the live service and exits without client force-killing it',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-eof-'));
 const output=path.join(root,'output'),profile=path.join(root,'profile');await mkdir(output);await mkdir(profile);
 const child=spawn(process.execPath,[path.resolve('src/browser-mcp-stdio.mjs'),output,profile],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 let timer;
 try{
  let descriptor;
  for(let n=0;n<100;n++){
   try{descriptor=JSON.parse(await readFile(path.join(profile,'live.json'),'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;}
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert(descriptor,'the isolated live service should start before EOF');
  child.stdin.end();
  const result=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`MCP did not exit after EOF: ${stderr}`)),5000);})]);
  assert.deepEqual(result,{code:0,signal:null});
  await assert.rejects(fetch(`http://127.0.0.1:${descriptor.port}/state`));
 }finally{
  clearTimeout(timer);
  if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}
 }
});

test('browser permission gate excludes readonly, plan and unknown modes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-gate-'));await mkdir(path.join(root,'.runtime'));
 await writeFile(path.join(root,'.runtime/browser-mcp.json'),'{"enabled":true}');
 for(const [provider,accessMode] of [['codex','read-only'],['claude','claude-plan'],['codex','unknown'],['other','workspace-write']])assert.equal(await readBrowserMcpConfig({appRoot:root,conversationId:'test',provider,accessMode}),null);
});

test('browser_reload is exposed, reloads the selected same tab, and retains cancellation fail-closed behavior',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-reload-tool-'));
 const sent=[],reloads=[];let failClosed=0,ended=0,started=0,blockReload=false,resolveReload;
 const pages=[{id:'one',url:'https://fixture.invalid/one',title:'One'},{id:'two',url:'https://fixture.invalid/two',title:'Two'}];
 const liveSession={beginAiCall(){started++;return true;},endAiCall(){ended++;},async getState(){return {pages};},async reloadPageAtIndex(index){reloads.push(index);if(blockReload)await new Promise(resolve=>resolveReload=resolve);},async failClosed(){failClosed++;}};
 const raw={async start(){},async send(message){sent.push(message);},async close(){}};
 const transport=restrictedBrowserTransport(raw,root,liveSession);await transport.start();
 let currentIndex=1;
 transport.onmessage=message=>{if(message.method==='tools/call'&&message.params?.name==='browser_tabs'&&message.params?.arguments?.action==='list')void transport.send({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:`- ${currentIndex}: (current) [selected](https://fixture.invalid/${currentIndex===1?'two':'one'})`}]}});};
 await raw.onmessage({jsonrpc:'2.0',id:1,method:'tools/list'});
 await transport.send({jsonrpc:'2.0',id:1,result:{tools:[{name:'browser_tabs',description:'Manage tabs',inputSchema:{type:'object',properties:{action:{type:'string'}}}},{name:'browser_take_screenshot',description:'Capture a page',inputSchema:{type:'object',properties:{filename:{type:'string',description:'File name resolved against workspace root.'}}}}]}});
 const listed=sent.at(-1).result.tools;
 assert(listed.some(tool=>tool.name==='browser_reload'));
 const screenshot=listed.find(tool=>tool.name==='browser_take_screenshot');
 assert.match(screenshot.description,/conversation and selected browser mode output directory/);
 assert.match(screenshot.description,/Without a filename, the image is returned inline/);
 assert.match(screenshot.description,/in formal K this is the same conversation/);
 assert.match(screenshot.inputSchema.properties.filename.description,/conversation and selected browser mode output directory/);
 assert.match(screenshot.inputSchema.properties.filename.description,/returned inline/);
 assert.match(screenshot.inputSchema.properties.filename.description,/In formal K this is the same conversation/);
 await raw.onmessage({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'browser_tabs',arguments:{action:'select',index:1}}});
 await transport.send({jsonrpc:'2.0',id:2,result:{content:[{type:'text',text:'selected'}]}});
 await raw.onmessage({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'browser_reload',arguments:{}}});
 assert.deepEqual(reloads,[1],'reload follows upstream current-tab readback rather than inferred tab-management intent');
 assert.equal(sent.at(-1).id,3);
 assert.match(sent.at(-1).result.content[0].text,/same tab remains selected/);
 assert.equal(started,2);
 assert.equal(ended,2);

 blockReload=true;
 const pending=raw.onmessage({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'browser_reload',arguments:{}}});
 while(!resolveReload)await new Promise(resolve=>setTimeout(resolve,0));
 await raw.onmessage({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:4}});
 await new Promise(resolve=>setImmediate(resolve));
 resolveReload();await pending;
 assert.equal(failClosed,1);
 assert.deepEqual(reloads,[1,1],'cancellation does not replay the selected page reload');
 assert(!sent.some(message=>message.id===4),'cancelled reload is not reported as a successful replay');
});

test('tool results repair stale titles from the current page at the same index and URL',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-tabs-title-'));
 const sent=[],pages=[{id:'one',url:'https://fixture.invalid/a',title:'Live A'},{id:'two',url:'https://fixture.invalid/b',title:'Live B'}];
 const liveSession={beginAiCall(){return true;},endAiCall(){},async getState(){return {pages};}};
 const raw={async start(){},async send(message){sent.push(message);},async close(){}};
 const transport=restrictedBrowserTransport(raw,root,liveSession);await transport.start();
 await raw.onmessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'browser_evaluate',arguments:{function:'() => true'}}});
 await transport.send({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'- 0: (current) [](https://fixture.invalid/a)\n- 1: [wrong cache](https://fixture.invalid/other)'}]}});
 const text=sent.at(-1).result.content[0].text;
 assert.match(text,/\[Live A\]\(https:\/\/fixture\.invalid\/a\)/);
 assert.match(text,/\[wrong cache\]\(https:\/\/fixture\.invalid\/other\)/,'URL mismatch is not relabeled with a different page title');
});

test('real MCP entry rejects fake key upload/drop and unsafe code before any browser operation',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-boundary-'));
 const output=path.join(root,'output'),profile=path.join(root,'profile');await mkdir(output);await mkdir(profile);
 const fake=path.join(root,'.env.local'),allowed=path.join(output,'allowed.txt');
 await writeFile(fake,'FAKE_NOT_A_KEY');await writeFile(allowed,'ordinary fixture');
 await validateBrowserFiles(output,[allowed]);
 await assert.rejects(validateBrowserFiles(output,[fake]),/File access denied/);
 const client=new Client({name:'k-boundary-fixture',version:'1'},{capabilities:{roots:{listChanged:true}}});
 // A provider may advertise its full project root. It must not expand K's
 // dedicated browser directory, regardless of provider-specific defaults.
 client.setRequestHandler('roots/list',()=>({roots:[{uri:pathToFileURL(root).href}]}));
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('src/browser-mcp-stdio.mjs'),output,profile],cwd:root,stderr:'pipe'});
 let stderr='';transport.stderr.on('data',data=>stderr+=data);
 try{
  await client.connect(transport);
  const {tools}=await client.listTools();assert(tools.some(t=>t.name==='browser_file_upload'));assert(!tools.some(t=>t.name==='browser_run_code_unsafe'));
  for(const name of ['browser_file_upload','browser_drop']){
   const result=await client.callTool({name,arguments:{paths:[fake]}});
   assert.equal(result.isError,true);assert.match(JSON.stringify(result),/File access denied/);
  }
  const result=await client.callTool({name:'browser_run_code_unsafe',arguments:{code:'return 1'}});
  assert.equal(result.isError,true);assert.match(JSON.stringify(result),/not enabled/);
  assert.equal(stderr,'');
 }finally{await client.close();}
});

test('cancelling a running browser tool closes the browser session before releasing its AI lock',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-cancel-'));
 const output=path.join(root,'output'),profile=path.join(root,'profile');await mkdir(output);await mkdir(profile);
 const client=new Client({name:'k-browser-cancel-fixture',version:'1'},{capabilities:{roots:{listChanged:true}}});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('src/browser-mcp-stdio.mjs'),output,profile],cwd:root,stderr:'pipe'});
 try{
  await client.connect(transport);
  const {tools}=await client.listTools();assert(tools.some(t=>t.name==='browser_wait_for'));
  const initial=await client.callTool({name:'browser_snapshot',arguments:{}});assert.notEqual(initial.isError,true);
  const controller=new AbortController();
  const pending=client.callTool({name:'browser_wait_for',arguments:{time:30}},{signal:controller.signal});
  const descriptor=JSON.parse(await readFile(path.join(profile,'live.json'),'utf8'));
  const stateUrl=`http://127.0.0.1:${descriptor.port}/state`;
  let state;
  for(let attempt=0;attempt<100;attempt++){
   state=await fetch(stateUrl,{headers:{Authorization:`Bearer ${descriptor.token}`}}).then(response=>response.json());
   if(state.busy&&state.available)break;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(state?.busy,true,'browser wait should be active before cancellation');
  assert.equal(state.available,true,'real blank browser context must be open before cancellation');
  controller.abort(new Error('fixture cancellation'));
  await assert.rejects(pending);

  for(let attempt=0;attempt<100;attempt++){
   state=await fetch(stateUrl,{headers:{Authorization:`Bearer ${descriptor.token}`}}).then(response=>response.json());
   if(!state.available&&!state.busy)break;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(state.available,false,'cancelled browser context must be unavailable until MCP reconnect');
  assert.equal(state.busy,false,'AI lock is released only after session shutdown');
  assert.equal(state.mode,'human');
 }finally{await client.close();}
});



test('attached Open tabs titles are reconciled for evaluate, wait, and screenshot without changing image payloads',async()=>{
 const sent=[],image={type:'image',mimeType:'image/png',data:'fixture'};
 const raw={async start(){},async send(message){sent.push(message);},async close(){}};
 const live={beginAiCall(){return true;},endAiCall(){},async getState(){return {pages:[{url:'data:text/html,fake',title:'即時標題'}]};}};
 const transport=restrictedBrowserTransport(raw,process.cwd(),live);await transport.start();
 let id=100;
 for(const name of ['browser_evaluate','browser_wait_for','browser_take_screenshot']){
  await raw.onmessage({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{}}});
  await transport.send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'### Result\nunchanged\n### Open tabs\n- 0: (current) [](data:text/html,fake)'},image]}});
  assert.match(sent.at(-1).result.content[0].text,/\[即時標題\]/);assert.deepEqual(sent.at(-1).result.content[1],image);id++;
 }
});
