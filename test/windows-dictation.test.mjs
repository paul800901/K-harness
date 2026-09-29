import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const helper=fileURLToPath(new URL('../scripts/Invoke-KWindowsDictation.ps1',import.meta.url));

test('Windows dictation helper probe compiles native INPUT layout without sending a hotkey', {skip:process.platform!=='win32'},()=>{
 const output=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Mode','Probe'],{encoding:'utf8',windowsHide:true});
 const result=JSON.parse(output.trim());
 assert.deepEqual(result,{ok:true,mode:'Probe',inputSize:40,hotkeySent:false,note:'未送出快捷鍵'});
 const bytes=readFileSync(helper);
 assert.deepEqual([...bytes.subarray(0,3)],[0xef,0xbb,0xbf]);
});
