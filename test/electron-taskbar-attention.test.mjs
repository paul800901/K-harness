import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createTaskbarAttentionController,createWindowFocusNotifier} from '../src/taskbar-attention.mjs';

class FakeWindow extends EventEmitter{
 constructor(){super();this.focused=false;this.visible=true;this.overlays=[];this.flashes=[];}
 isFocused(){return this.focused;}
 isVisible(){return this.visible;}
 setOverlayIcon(icon,description){this.overlays.push({icon,description});}
 flashFrame(value){this.flashes.push(value);}
}
function harness({snapshot={completionAttention:{sequence:0,unread:[]}},focused=false}={}){
 const window=new FakeWindow();window.focused=focused;
 const app={listeners:new Set(),onStateChange(listener){this.listeners.add(listener);listener(snapshot);return()=>this.listeners.delete(listener);},emit(state){for(const listener of this.listeners)listener(state);}};
 const bitmapCalls=[],timers=new Map(),cleared=[];let nextTimer=0;
 const electron={nativeImage:{createFromBitmap(buffer,options){const image={buffer,options};bitmapCalls.push(image);return image;}}};
 const controller=createTaskbarAttentionController({window,electron,app,platform:'win32',flashDurationMs:2500,setTimeoutFn(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeoutFn(id){cleared.push(id);timers.delete(id);}});
 return {window,app,controller,bitmapCalls,timers,cleared,fire(id){const timer=timers.get(id);timers.delete(id);timer?.fn();}};
}

test('initial subscription paints unread count but never flashes a completion from the snapshot',()=>{
 const f=harness({snapshot:{completionAttention:{sequence:8,unread:[{threadId:'old',sequence:8}]}}});
 assert.equal(f.window.overlays.length,1);
 assert.ok(f.window.overlays[0].icon);
 assert.equal(f.window.overlays[0].description,'1 個未讀完成工作');
 assert.deepEqual(f.window.flashes,[]);
 f.controller.dispose();
});

test('new completion updates overlay count, flashes only while unfocused, and rapid events refresh timer',()=>{
 const f=harness();
 f.app.emit({completionAttention:{sequence:1,unread:[{threadId:'a',sequence:1}]}});
 assert.equal(f.window.flashes.at(-1),true);
 assert.equal(f.window.overlays.at(-1).description,'1 個未讀完成工作');
 const firstTimer=[...f.timers.keys()][0];
 f.app.emit({completionAttention:{sequence:2,unread:[{threadId:'a',sequence:1},{threadId:'b',sequence:2}]}});
 assert.equal(f.window.overlays.at(-1).description,'2 個未讀完成工作');
 assert.deepEqual(f.cleared,[firstTimer]);
 assert.equal(f.timers.size,1);
 assert.equal([...f.timers.values()][0].ms,2500);
 const two=[...f.timers.keys()][0];f.fire(two);
 assert.equal(f.window.flashes.at(-1),false);
 f.controller.dispose();
});

test('focused completion and sequence-stable or cleared state do not trigger attention',()=>{
 const f=harness({focused:true});
 f.app.emit({completionAttention:{sequence:1,unread:[{threadId:'a',sequence:1}]}});
 assert.equal(f.window.overlays.at(-1).description,'1 個未讀完成工作');
 assert.deepEqual(f.window.flashes,[]);
 f.window.focused=false;
 f.app.emit({completionAttention:{sequence:1,unread:[{threadId:'a',sequence:1}]}});
 assert.deepEqual(f.window.flashes,[],'same sequence is not a new completion');
 f.app.emit({completionAttention:{sequence:1,unread:[]}});
 assert.equal(f.window.overlays.at(-1).icon,null);
 assert.equal(f.window.overlays.at(-1).description,'');
 assert.deepEqual(f.window.flashes,[],'mark-read clear does not flash');
 f.controller.dispose();
});

test('a newer sequence does not flash when unread contains only older completion items',()=>{
 const f=harness({snapshot:{completionAttention:{sequence:4,unread:[{threadId:'old',sequence:2}]}}});
 f.app.emit({completionAttention:{sequence:5,unread:[{threadId:'old',sequence:2}]}});
 assert.deepEqual(f.window.flashes,[]);
 f.controller.dispose();
});

test('overlay is redrawn only when the unread count changes',()=>{
 const f=harness();
 assert.equal(f.window.overlays.length,1,'initial zero count clears any stale overlay');
 f.app.emit({completionAttention:{sequence:1,unread:[{threadId:'a',sequence:1}]}});
 assert.equal(f.window.overlays.length,2);
 f.app.emit({completionAttention:{sequence:2,unread:[{threadId:'b',sequence:2}]}});
 assert.equal(f.window.overlays.length,2,'same count with a different completion does not rebuild the bitmap');
 f.app.emit({completionAttention:{sequence:2,unread:[]}});
 assert.equal(f.window.overlays.length,3);
 f.controller.dispose();
});

test('overlay count uses native bitmap and caps its readable label at 9+',()=>{
 const f=harness();
 f.app.emit({completionAttention:{sequence:1,unread:Array.from({length:12},(_,i)=>({threadId:String(i),sequence:i+1}))}});
 assert.equal(f.window.overlays.at(-1).description,'12 個未讀完成工作');
 assert.equal(f.bitmapCalls.at(-1).options.width,32);
 assert.equal(f.bitmapCalls.at(-1).buffer.length,32*32*4);
 assert.equal(f.bitmapCalls.at(-1).buffer.some(value=>value!==0),true);
 const white=[];
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const offset=(y*32+x)*4;
  if(f.bitmapCalls.at(-1).buffer[offset]===255&&f.bitmapCalls.at(-1).buffer[offset+1]===255&&f.bitmapCalls.at(-1).buffer[offset+2]===255)white.push([x,y]);
 }
 assert.equal(Math.max(...white.map(([x])=>x))-Math.min(...white.map(([x])=>x))+1,24,'9+ occupies a large centered glyph');
 assert.equal(Math.max(...white.map(([,y])=>y))-Math.min(...white.map(([,y])=>y))+1,15);
 f.controller.dispose();
});

test('single-digit bitmap text is enlarged fourfold and vertically centered',()=>{
 const f=harness();
 f.app.emit({completionAttention:{sequence:1,unread:[{threadId:'one',sequence:1}]}});
 const bitmap=f.bitmapCalls.at(-1).buffer,white=[];
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const offset=(y*32+x)*4;
  if(bitmap[offset]===255&&bitmap[offset+1]===255&&bitmap[offset+2]===255)white.push([x,y]);
 }
 assert.equal(Math.max(...white.map(([,y])=>y))-Math.min(...white.map(([,y])=>y))+1,20);
 assert.equal(Math.min(...white.map(([,y])=>y)),6);
 assert.equal(Math.max(...white.map(([,y])=>y)),25);
 f.controller.dispose();
});

test('focus stops the timer, disposal unsubscribes and clears attention state',()=>{
 const f=harness();
 f.app.emit({completionAttention:{sequence:1,unread:[{threadId:'a',sequence:1}]}});
 const timer=[...f.timers.keys()][0];
 f.window.focused=true;f.window.emit('focus');
 assert.ok(f.cleared.includes(timer));
 assert.equal(f.window.flashes.at(-1),false);
 f.controller.dispose();
 assert.equal(f.app.listeners.size,0);
 assert.equal(f.window.listenerCount('focus'),0);
 assert.equal(f.window.overlays.at(-1).icon,null);
 assert.equal(f.timers.size,0);
});

test('focus notifications are read-only, reflect native focused and visible state, and can unsubscribe',async()=>{
 const f=harness(),messages=[],webContents={isDestroyed:()=>false,send:(channel,data)=>messages.push({channel,data})};
 const notifier=createWindowFocusNotifier(f.window,webContents);
 notifier.notify();
 f.window.focused=true;f.window.emit('focus');
 f.window.visible=false;f.window.emit('hide');
 assert.deepEqual(messages.map(x=>x.data.focused),[false,true,false]);
 assert.ok(messages.every(x=>x.channel==='k-native-window-focus'));
 notifier.dispose();f.window.focused=false;f.window.emit('blur');
 assert.equal(messages.length,3);

 const source=await readFile(new URL('../src/electron-owner-preload.cjs',import.meta.url),'utf8');
 let api;const ipcListeners=new Map(),ipc={on(channel,listener){ipcListeners.set(channel,listener);},removeListener(channel,listener){if(ipcListeners.get(channel)===listener)ipcListeners.delete(channel);}};
 vm.runInNewContext(source,{require:id=>id==='electron'?{contextBridge:{exposeInMainWorld(_name,value){api=value;}},ipcRenderer:ipc}:null});
 assert.equal(typeof api.onWindowFocusChanged,'function');
 assert.deepEqual(Object.keys(api).sort(),['onPageChanged','onWindowFocusChanged','onWindowHidden']);
 assert.equal('focus' in api,false,'renderer receives observation only, never a window-control method');
 const seen=[];ipcListeners.get('k-native-window-focus')({}, {focused:false});
 const unsubscribe=api.onWindowFocusChanged(value=>seen.push(value.focused));
 assert.deepEqual(seen,[false],'cached native focus state is delivered to late subscribers');
 ipcListeners.get('k-native-window-focus')({}, {focused:true});
 assert.deepEqual(seen,[false,true]);
 unsubscribe();ipcListeners.get('k-native-window-focus')({}, {focused:false});
 assert.deepEqual(seen,[false,true],'unsubscribed renderer callback is no longer called');
});
