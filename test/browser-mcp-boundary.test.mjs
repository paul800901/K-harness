import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {restrictedBrowserTransport} from '../src/browser-mcp-stdio.mjs';

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
