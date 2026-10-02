import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createElectronWorkbench} from '../src/electron-workbench.mjs';

test('native workbench uses the existing K ICO instead of the Electron executable icon',async()=>{
 let options,appName,appId,details;
 const captured=new Error('window options captured');
 class BaseWindow{
  constructor(value){options=value;}
  setAppDetails(value){details=value;throw captured;}
  setMenu(){throw captured;}
 }
 const app={setName(value){appName=value;},setAppUserModelId(value){appId=value;}};
 const relaunchExecutable='C:\\K-harness\\local-launcher\\dist\\K桌面啟動器.exe';
 await assert.rejects(createElectronWorkbench({electron:{app,BaseWindow},relaunchExecutable}),error=>error===captured);
 assert.equal(appName,'K 執行中樞');
 if(process.platform==='win32'){
  assert.equal(appId,'K.Harness.Desktop');
  assert.deepEqual(details,{appId,appIconPath:options.icon,relaunchCommand:`"${relaunchExecutable}"`,relaunchDisplayName:appName});
 }
 assert.equal(options.icon,fileURLToPath(new URL('../frontend/assets/k-logo.ico',import.meta.url)));
 const ico=await readFile(options.icon);
 assert.equal(ico.readUInt16LE(0),0);
 assert.equal(ico.readUInt16LE(2),1);
 assert.ok(ico.readUInt16LE(4)>0);
});
