import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {loadKBrowserAssistant} from '../src/k-browser-assistant.mjs';

test('external browser is opt-in through trusted owner configuration, no silent fallback',async()=>{
 const base=path.resolve('.runtime/k-browser-assistant-tests');await mkdir(base,{recursive:true});
 const vault=await mkdtemp(path.join(base,'vault-'));
 assert.equal(await loadKBrowserAssistant({vault}),undefined);
 await writeFile(path.join(vault,'k-browser-assistant.json'),JSON.stringify({enabled:true,extensionId:'invalid',chromeExecutable:process.execPath}));
 await assert.rejects(loadKBrowserAssistant({vault}),/設定無效/);
 await writeFile(path.join(vault,'k-browser-assistant.json'),JSON.stringify({enabled:true,extensionId:'a'.repeat(32),chromeExecutable:process.execPath}));
 assert.equal(typeof await loadKBrowserAssistant({vault}),'function');
});
