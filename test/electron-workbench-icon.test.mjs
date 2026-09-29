import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createElectronWorkbench} from '../src/electron-workbench.mjs';

test('native workbench uses the existing K ICO instead of the Electron executable icon',async()=>{
 let options;
 const captured=new Error('window options captured');
 class BaseWindow{constructor(value){options=value;throw captured;}}
 await assert.rejects(createElectronWorkbench({electron:{BaseWindow}}),error=>error===captured);
 assert.equal(options.icon,fileURLToPath(new URL('../frontend/assets/k-logo.ico',import.meta.url)));
 const ico=await readFile(options.icon);
 assert.equal(ico.readUInt16LE(0),0);
 assert.equal(ico.readUInt16LE(2),1);
 assert.ok(ico.readUInt16LE(4)>0);
});
