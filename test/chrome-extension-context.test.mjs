import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {createChromeExtensionContext} from '../src/chrome-extension-context.mjs';

test('extension bridge requires exact extension origin and never silently changes mode',async()=>{
 const extensionId='abcdefghijklmnopabcdefghijklmnop';let socket,connectUrl,detached=false;
 const context={};
 const result=await createChromeExtensionContext({mode:'incognito',extensionId,
  protocolFactory:()=>({ready:async()=>{},handleExtensionEvent(){}}),
  openConnectPage:async url=>{
   connectUrl=new URL(url);const endpoint=connectUrl.searchParams.get('mcpRelayUrl');
   const rejected=new WebSocket(endpoint,{origin:'https://untrusted.example'});
   const [error]=await once(rejected,'error');assert.match(error.message,/403/);
   socket=new WebSocket(endpoint,{origin:`chrome-extension://${extensionId}`});await once(socket,'open');
  },
  connectBrowser:async(endpoint,options)=>{
   assert.match(endpoint,/^ws:\/\/127\.0\.0\.1:\d+\/cdp\/[a-f0-9]{64}$/);
   assert.match(options.headers.Authorization,/^Bearer [a-f0-9]{64}$/);
   return {on(){},contexts:()=>[context],close:async()=>{detached=true;}};
  },
 });
 assert.equal(connectUrl.searchParams.get('mode'),'incognito');assert.equal(connectUrl.searchParams.get('newTab'),'true');assert.equal(result,context);
 await result.close();assert(detached);
});

test('extension commands continue without a human-activity pause or resume message',async()=>{
 const extensionId='b'.repeat(32);let send,received=0;
 const context=await createChromeExtensionContext({mode:'regular',extensionId,
  protocolFactory:command=>{send=command;return {ready:async()=>{},handleExtensionEvent(){}};},
  openConnectPage:async url=>{const socket=new WebSocket(new URL(url).searchParams.get('mcpRelayUrl'),{origin:`chrome-extension://${extensionId}`});socket.on('message',data=>{received++;const {id}=JSON.parse(data);socket.send(JSON.stringify({id,result:{ok:true}}));});await once(socket,'open');},
  connectBrowser:async()=>({on(){},contexts:()=>[{}],close:async()=>{}}),
 });
 try{for(let i=0;i<3;i++)assert.deepEqual(await send('fake.command',{}),{ok:true});assert.equal(received,3);}finally{await context.close();}
});

test('extension bridge invalid mode and missing permission timeout fail closed',async()=>{
 await assert.rejects(createChromeExtensionContext({mode:'automatic'}),/explicitly/);
 await assert.rejects(createChromeExtensionContext({mode:'regular',extensionId:'a'.repeat(32),timeoutMs:30,protocolFactory:()=>({ready:async()=>{}}),openConnectPage:async()=>{}}),/逾時/);
});

function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}

async function waitFor(predicate,message){
 const end=Date.now()+1500;
 while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.fail(message);
}

test('Runtime.enable waits for its session frame tree response without blocking another session',async()=>{
 const extensionId='c'.repeat(32),forwarded=[],responses=new Map(),frameTree=deferred();
 let extensionSocket,cdpSocket;
 const context=await createChromeExtensionContext({mode:'regular',extensionId,
  protocolFactory:()=>({
   ready:async()=>{},
   handleExtensionEvent(){},
   connectOverCDP(){},
   async handleCDPCommand(){return undefined;},
   async forwardToExtension(method,params,sessionId){
    forwarded.push({method,sessionId});
    if(method==='Page.getFrameTree')return frameTree.promise;
    return {};
   },
  }),
  openConnectPage:async url=>{
   extensionSocket=new WebSocket(new URL(url).searchParams.get('mcpRelayUrl'),{origin:`chrome-extension://${extensionId}`});
   await once(extensionSocket,'open');
  },
  connectBrowser:async(endpoint,options)=>{
   cdpSocket=new WebSocket(endpoint,{headers:options.headers});
   cdpSocket.on('message',data=>{const message=JSON.parse(data.toString());responses.set(message.id,message);});
   await once(cdpSocket,'open');
   return {on(){},contexts:()=>[{}],close:async()=>{cdpSocket.close();}};
  },
 });
 try{
  cdpSocket.send(JSON.stringify({id:1,method:'Page.getFrameTree',params:{},sessionId:'session-a'}));
  await waitFor(()=>forwarded.some(item=>item.method==='Page.getFrameTree'&&item.sessionId==='session-a'),'Page.getFrameTree was not forwarded');
  cdpSocket.send(JSON.stringify({id:2,method:'Runtime.enable',params:{},sessionId:'session-a'}));
  cdpSocket.send(JSON.stringify({id:3,method:'Runtime.enable',params:{},sessionId:'session-b'}));

  await waitFor(()=>forwarded.some(item=>item.method==='Runtime.enable'&&item.sessionId==='session-b'),'Runtime.enable for the independent session was blocked');
  assert.equal(forwarded.some(item=>item.method==='Runtime.enable'&&item.sessionId==='session-a'),false,'same-session Runtime.enable must wait for Page.getFrameTree');
  await waitFor(()=>responses.has(3),'independent session did not receive its response');
  assert.equal(responses.get(3).sessionId,'session-b');

  frameTree.resolve({frameTree:{frame:{id:'main',url:'about:blank'}}});
  await waitFor(()=>responses.has(1)&&responses.has(2),'frame tree and delayed Runtime.enable responses did not arrive');
  assert.equal(responses.get(1).sessionId,'session-a');
  assert.equal(responses.get(2).sessionId,'session-a');
  assert.deepEqual(forwarded.map(({method,sessionId})=>[method,sessionId]),[
   ['Page.getFrameTree','session-a'],
   ['Runtime.enable','session-b'],
   ['Runtime.enable','session-a'],
  ]);
 }finally{
  await context.close();
  extensionSocket?.close();
 }
});
