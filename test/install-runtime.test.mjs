import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,writeFile,readFile,stat} from 'node:fs/promises';
import {activateRuntime,rollbackRuntime,installationPaths,readSettings} from '../scripts/install-runtime.mjs';

const checkStopped=async()=>{};
async function file(name,value){await mkdir(path.dirname(name),{recursive:true});await writeFile(name,value);}
async function fixture(){
 const base=fileURLToPath(new URL('../.runtime/install-tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'可搬-')),p=installationPaths(root);
 await file(path.join(p.runtime,'src/electron-isolated-launcher.mjs'),'old');
 await file(path.join(p.runtime,'dist-ui/index.html'),'old-ui');
 await file(p.launcher,'old-launcher');await file(p.entry,'old-entry');
 await file(path.join(p.candidate,'agent-home/.codex/fake-login'),'DO NOT CHANGE');
 await file(path.join(p.candidate,'vault/private-state/fake-chat'),'KEEP CHAT');
 const prepared=path.join(p.candidate,'prepared');
 for(const [name,value] of [['src/electron-isolated-launcher.mjs','new'],['dist-ui/index.html','new-ui'],['local-launcher/dist/K桌面啟動器.exe','new-launcher'],['Start-K-Desktop.ps1','new-entry']])await file(path.join(prepared,name),value);
 return {root,p,prepared};
}
test('install exchanges only code; rollback also works for legacy runtime without embedded launcher',async()=>{
 const {root,p,prepared}=await fixture();
 const result=await activateRuntime({root,prepared,version:'new-commit',settings:{nodeExecutable:process.execPath,dictationModel:'local-model'},checkStopped});
 assert.equal(await readFile(p.launcher,'utf8'),'new-launcher');
 assert.equal((await readSettings(root)).version,'new-commit');
 assert.equal(await readFile(path.join(result.previous,'runtime/src/electron-isolated-launcher.mjs'),'utf8'),'old');
 await rollbackRuntime(root,{checkStopped});
 assert.equal(await readFile(p.launcher,'utf8'),'old-launcher');assert.equal(await readFile(p.entry,'utf8'),'old-entry');
 assert.equal(await readFile(path.join(p.runtime,'src/electron-isolated-launcher.mjs'),'utf8'),'old');
 assert.equal(await readFile(path.join(p.candidate,'agent-home/.codex/fake-login'),'utf8'),'DO NOT CHANGE');
 assert.equal(await readFile(path.join(p.candidate,'vault/private-state/fake-chat'),'utf8'),'KEEP CHAT');
});
test('running work prevents activation, preserving existing code and candidate',async()=>{
 const {root,p,prepared}=await fixture();
 await assert.rejects(activateRuntime({root,prepared,version:'new',checkStopped:async()=>{throw Error('running');}}),/running/);
 assert.equal(await readFile(p.launcher,'utf8'),'old-launcher');assert.ok(await stat(prepared));
 await assert.rejects(stat(path.join(p.candidate,'agent-home/.codex/config.toml')),{code:'ENOENT'});
});

test('activation creates the missing K Codex Windows sandbox config',async()=>{
 const {root,p,prepared}=await fixture();
 await activateRuntime({root,prepared,version:'windows-config',checkStopped});
 assert.equal(await readFile(path.join(p.candidate,'agent-home/.codex/config.toml'),'utf8'),'[windows]\nsandbox = "unelevated"\n');
});

test('activation leaves an existing Codex config byte for byte unchanged',async()=>{
 const {root,p,prepared}=await fixture(),config=path.join(p.candidate,'agent-home/.codex/config.toml');
 const existing='# user choice\r\n[windows]\r\nsandbox = "elevated"\r\n';await writeFile(config,existing);
 await activateRuntime({root,prepared,version:'preserve-config',checkStopped});
 assert.equal(await readFile(config,'utf8'),existing);
});
test('missing build output does not replace the current runtime',async()=>{
 const {root,p}=await fixture();const prepared=path.join(p.candidate,'incomplete');await mkdir(prepared);
 await assert.rejects(activateRuntime({root,prepared,version:'broken',checkStopped}));
 assert.equal(await readFile(path.join(p.runtime,'dist-ui/index.html'),'utf8'),'old-ui');
});
test('path outside this installation cannot be activated',async()=>{
 const {root}=await fixture();
 await assert.rejects(activateRuntime({root,prepared:path.resolve(root,'../unrelated'),version:'x',checkStopped}),/版本路徑/);
});
