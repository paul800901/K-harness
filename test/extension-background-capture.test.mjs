import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

async function loadRelayConnection(){
 const source=await readFile(new URL('../browser-extension/source/relayConnection.ts',import.meta.url),'utf8');
 const javascript=stripTypeScriptTypes(source,{mode:'transform'});
 return await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

async function withChrome(chrome,run){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'chrome');
 Object.defineProperty(globalThis,'chrome',{configurable:true,writable:true,value:chrome});
 try{return await run();}
 finally{
  if(previous)Object.defineProperty(globalThis,'chrome',previous);
  else delete globalThis.chrome;
 }
}

function connectionFor(RelayConnection,attachedTabs=[]){
 const connection=Object.create(RelayConnection.prototype);
 connection._attachedTabs=new Set(attachedTabs);
 connection._mode='regular';
 connection._targetWindowId=4;
 return connection;
}

test('capture activates only its attached tab before forwarding unchanged CDP arguments',async()=>{
 const {RelayConnection}=await loadRelayConnection();
 const calls=[];const params={format:'png',quality:72,clip:{x:1,y:2,width:30,height:40,scale:1}};
 const chrome={
  tabs:{update:async(...args)=>{calls.push({api:'tabs.update',args});return{id:17};}},
  debugger:{sendCommand:async(...args)=>{calls.push({api:'debugger.sendCommand',args});return{data:'image'};}}
 };
 await withChrome(chrome,async()=>{
  const result=await connectionFor(RelayConnection,[17])._handleCommand({
   id:1,method:'chrome.debugger.sendCommand',params:[{tabId:17},'Page.captureScreenshot',params]
  });
  assert.deepEqual(result,{data:'image'});
 });
 assert.deepEqual(calls.map(call=>call.api),['tabs.update','debugger.sendCommand']);
 assert.deepEqual(calls[0].args,[17,{active:true}]);
 assert.deepEqual(calls[1].args,[{tabId:17},'Page.captureScreenshot',params]);
 assert.strictEqual(calls[1].args[2],params);
});

test('capture rejects tabs not explicitly attached without activating or sending',async()=>{
 const {RelayConnection}=await loadRelayConnection();
 const calls=[];
 const chrome={
  tabs:{update:async(...args)=>{calls.push(['tabs.update',...args]);}},
  debugger:{sendCommand:async(...args)=>{calls.push(['debugger.sendCommand',...args]);}}
 };
 await withChrome(chrome,async()=>{
  await assert.rejects(
   connectionFor(RelayConnection,[18])._handleCommand({
    id:2,method:'chrome.debugger.sendCommand',params:[{tabId:17},'Page.captureScreenshot',{format:'jpeg'}]
   }),
   /explicitly attached tabs/
  );
 });
 assert.deepEqual(calls,[]);
});

test('non-screenshot debugger commands do not activate a tab',async()=>{
 const {RelayConnection}=await loadRelayConnection();
 const calls=[];const params={expression:'2 + 2',returnByValue:true};
 const chrome={
  tabs:{update:async(...args)=>{calls.push({api:'tabs.update',args});}},
  debugger:{sendCommand:async(...args)=>{calls.push({api:'debugger.sendCommand',args});return{result:{value:4}};}}
 };
 await withChrome(chrome,async()=>{
  const result=await connectionFor(RelayConnection,[17])._handleCommand({
   id:3,method:'chrome.debugger.sendCommand',params:[{tabId:17},'Runtime.evaluate',params]
  });
  assert.deepEqual(result,{result:{value:4}});
 });
 assert.deepEqual(calls,[{api:'debugger.sendCommand',args:[{tabId:17},'Runtime.evaluate',params]}]);
});

test('data tabs activate only inside the selected window after creation',async()=>{
 const {RelayConnection}=await loadRelayConnection();
 const calls=[];
 const timeline=[];
 const updatedListeners=new Set();
 const chrome={
  tabs:{
   create:async(...args)=>{timeline.push('create');calls.push({api:'tabs.create',args});return{id:31,windowId:4,incognito:false,url:args[0].url};},
   update:async(...args)=>{timeline.push('activate');calls.push({api:'tabs.update',args});for(const listener of updatedListeners)listener(31,{status:'complete'},{id:31,windowId:4,incognito:false,url:'data:text/html,fixture'});return{id:31,windowId:4,incognito:false};},
   onUpdated:{addListener:listener=>{timeline.push('listen');updatedListeners.add(listener);},removeListener:listener=>{timeline.push('unlisten');updatedListeners.delete(listener);}}
  }
 };
 await withChrome(chrome,async()=>{
  const result=await connectionFor(RelayConnection)._handleCommand({
   id:4,method:'chrome.tabs.create',params:[{url:'data:text/html,fixture',windowId:4,active:true}]
  });
  assert.deepEqual(result,{id:31,windowId:4,incognito:false,url:'data:text/html,fixture'});
 });
 assert.deepEqual(calls,[
  {api:'tabs.create',args:[{url:'data:text/html,fixture',windowId:4,active:false}]},
  {api:'tabs.update',args:[31,{active:true}]}
 ]);
 assert.deepEqual(timeline,['listen','create','activate','unlisten']);
 assert.equal(updatedListeners.size,0,'the one-shot data readiness listener must be removed');
});

test('ordinary new tabs remain inactive and do not get an activation update',async()=>{
 const {RelayConnection}=await loadRelayConnection();
 const calls=[];
 const chrome={tabs:{
  create:async(...args)=>{calls.push({api:'tabs.create',args});return{id:32,windowId:4,incognito:false,url:args[0].url};},
  update:async(...args)=>{calls.push({api:'tabs.update',args});}
 }};
 await withChrome(chrome,async()=>{
  await connectionFor(RelayConnection)._handleCommand({
   id:5,method:'chrome.tabs.create',params:[{url:'https://example.invalid/fake',windowId:4}]
  });
 });
 assert.deepEqual(calls,[{api:'tabs.create',args:[{url:'https://example.invalid/fake',windowId:4,active:false}]}]);
});
