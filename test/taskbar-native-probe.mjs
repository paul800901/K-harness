// Electron/Windows smoke test with a hidden candidate and fake work only.
// No formal K, provider, credentials, focus request, or real conversation.
import electron from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import {createElectronWorkbench} from '../src/electron-workbench.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
async function run(){
const output=path.resolve('.runtime/taskbar-attention-20261004/native');
mkdirSync(output,{recursive:true});electron.app.setPath('userData',path.join(output,'profile'));electron.app.setPath('sessionData',path.join(output,'profile'));
await electron.app.whenReady();
const overlays=[],flashes=[],windowCalls=[],errors=[];let notify,workbench;
const state={threadId:'fake-a',workspace:output,status:'completed',busy:false,title:'隔離工作列測試',model:'gpt-6.1-sol',messages:[],tools:[],questions:[],workers:[],artifacts:[],capabilities:{},completionAttention:{sequence:0,unread:[]}};
class HiddenWindow extends electron.BaseWindow{
 constructor(options){super({...options,show:false});}
 show(){windowCalls.push('startup-show-suppressed');}
 focus(){windowCalls.push('focus');}
 setOverlayIcon(icon,description){overlays.push({count:description,imageEmpty:icon?.isEmpty()??null});if(icon)void writeFile(path.join(output,'badge-'+overlays.length+'.png'),icon.toPNG());return super.setOverlayIcon(icon,description);}
 flashFrame(value){flashes.push(value);return super.flashFrame(value);}
}
const shim={...electron,BaseWindow:HiddenWindow,app:{setName(){},setAppUserModelId(){}}};
const idle=()=>({async close(){}});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 workbench=await createElectronWorkbench({electron:shim,servicesFactory:async()=>({app:await startDesktop({root:output,port:0,controllerFactory:options=>{
  notify=options.onChange;return {state,async models(){return {models:[]};},async sessions(){return {sessions:[]};},async usage(){return {};},markViewed(){throw Error('Hidden window must not mark completion read');},async close(){}};
 },claudeLoginFactory:idle,codexLoginFactory:idle,geminiLoginFactory:idle,localDictationFactory:idle})})});
 workbench.owner.webContents.on('console-message',(_event,details)=>{if(details.level==='error')errors.push(details.message);});
 for(let i=1;i<=3;i++){
  state.completionAttention={sequence:i,unread:Array.from({length:i},(_,j)=>({threadId:'fake-'+j,sequence:j+1}))};notify();await wait(100);
 }
 assert.equal(overlays.at(-1).count,'3 個未讀完成工作');assert.equal(overlays.at(-1).imageEmpty,false);
 assert.equal(flashes.filter(Boolean).length,3);
 await wait(3200);assert.equal(flashes.at(-1),false,'native flashing is stopped after the short interval');
 state.completionAttention={sequence:3,unread:[{threadId:'fake-2',sequence:3}]};notify();await wait(100);
 assert.equal(overlays.at(-1).count,'1 個未讀完成工作');assert.equal(flashes.filter(Boolean).length,3);
 state.completionAttention={sequence:3,unread:[]};notify();await wait(100);
 assert.equal(overlays.at(-1).imageEmpty,null);
 assert.deepEqual(windowCalls,['startup-show-suppressed'],'completion never calls show/focus');
 assert.equal(workbench.window.isFocused(),false);
 await workbench.close();assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'result.json'),JSON.stringify({platform:process.platform,electron:process.versions.electron,overlays,flashes,windowCalls,errors,visualTaskbarVerified:false,boundary:'Real Windows API calls, hidden isolated window; taskbar pixels not inspected.'},null,2));
 electron.app.exit(0);
}catch(error){await writeFile(path.join(output,'failure.txt'),error.stack);await workbench?.close().catch(()=>{});electron.app.exit(1);}
}
void run().catch(error=>{console.error(error);electron.app.exit(1);});
