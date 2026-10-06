import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createElectronWorkbench} from '../src/electron-workbench.mjs';

test('failed safe shutdown leaves the window reopenable and attention attached, without forcing a stop',async()=>{
 class Window extends EventEmitter{
  constructor(){super();this.contentView={addChildView(){}};this.shown=0;this.destroyed=false;}
  setAppDetails(){} setMenu(){} getContentSize(){return [1000,800];}
  isFocused(){return false;} isVisible(){return true;} isMinimized(){return false;}
  setOverlayIcon(){} flashFrame(){} show(){this.shown++;} focus(){} hide(){}
  isDestroyed(){return this.destroyed;} destroy(){this.destroyed=true;}
 }
 class Contents extends EventEmitter{
  isDestroyed(){return !!this.destroyed;} send(){} setWindowOpenHandler(){}
  async loadURL(){} close(){this.destroyed=true;}
 }
 class View{constructor(){this.webContents=new Contents();}setBounds(){}}
 const listeners=new Set();let calls=0;
 const services={app:{origin:'http://127.0.0.1:1',createLaunchUrl:()=>'',onStateChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},async close(){calls++;if(calls===1)throw Error('child stop is unconfirmed');}}};
 const session={setPermissionRequestHandler(){},setPermissionCheckHandler(){},setDisplayMediaRequestHandler(){}};
 const electron={BaseWindow:Window,WebContentsView:View,app:{setName(){},setAppUserModelId(){}},session:{fromPartition:()=>session},shell:{},nativeImage:{createFromBitmap(){}}};
 const workbench=await createElectronWorkbench({electron,servicesFactory:async()=>services});
 const focusListeners=workbench.window.listenerCount('focus');
 await assert.rejects(workbench.close(),/unconfirmed/);
 assert.equal(workbench.window.isDestroyed(),false);
 assert.equal(workbench.window.listenerCount('focus'),focusListeners);
 workbench.show();assert.equal(workbench.window.shown,2);
 assert.equal(calls,1,'reopening does not force or retry shutdown');
 await workbench.close();assert.equal(calls,2);assert.equal(workbench.window.isDestroyed(),true);
 assert.equal(listeners.size,0);assert.equal(workbench.window.listenerCount('focus'),0);
});
