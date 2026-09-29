import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

async function sourceBrowserModel(){
 const source=await readFile(new URL('../browser-extension/src/relay/browserModel.ts',import.meta.url),'utf8');
 const runtimeSource=source.replace("import { logUnhandledError } from './log';","const logUnhandledError = () => {};");
 const javascript=stripTypeScriptTypes(runtimeSource,{mode:'transform'});
 return await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

test('attaching a page enables only CDP focus emulation before announcing the target',async()=>{
 const {BrowserModel}=await sourceBrowserModel();const calls=[],events=[];
 const model=new BrowserModel(async(method,args)=>{calls.push({method,args});if(args[1]==='Target.getTargetInfo')return{targetInfo:{targetId:'target-1',type:'page'}};return{};});
 model.connectOverCDP(message=>events.push(message));model.onTabCreated({id:17,url:'http://127.0.0.1/fake'});await model.enableAutoAttach();
 assert.deepEqual(calls.map(c=>c.args[1]),['1.3','Target.getTargetInfo','Emulation.setFocusEmulationEnabled']);
 assert.deepEqual(calls.at(-1),{method:'chrome.debugger.sendCommand',args:[{tabId:17},'Emulation.setFocusEmulationEnabled',{enabled:true}]});
 assert.equal(events.length,1);assert.equal(events[0].method,'Target.attachedToTarget');assert.equal(events[0].params.targetInfo.targetId,'target-1');
 assert.equal(calls.some(c=>c.method==='chrome.tabs.update'||c.method==='chrome.windows.update'),false);
});

test('Page.bringToFront becomes same-tab logical focus emulation, not native activation',async()=>{
 const {BrowserModel}=await sourceBrowserModel();const calls=[];
 const model=new BrowserModel(async(method,args)=>{calls.push({method,args});if(args[1]==='Target.getTargetInfo')return{targetInfo:{targetId:'target-2',type:'page'}};return{ok:true};});
 model.onTabCreated({id:29,url:'http://127.0.0.1/fake'});await model.enableAutoAttach();calls.length=0;
 assert.deepEqual(await model.sendCommand('pw-tab-1','Page.bringToFront',{}),{ok:true});
 assert.deepEqual(calls,[{method:'chrome.debugger.sendCommand',args:[{tabId:29,sessionId:undefined},'Emulation.setFocusEmulationEnabled',{enabled:true}]}]);
 assert.equal(calls.some(c=>c.args?.[1]==='Page.bringToFront'||c.method==='chrome.tabs.update'||c.method==='chrome.windows.update'),false);
});
