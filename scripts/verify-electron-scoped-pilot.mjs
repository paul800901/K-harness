// Fake-data integration only. Inherited pipe handles never leave this process pair.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
const mode=process.argv[2];
const root=path.resolve('.runtime/electron-browser-pilot-20260926',mode==='workbench'?'.':`scoped-${Date.now()}`);
await mkdir(root,{recursive:true});
async function run(phase){
const env={...process.env,K_ELECTRON_PILOT_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
if(phase)env.K_ELECTRON_PERSISTENCE_PHASE=phase;
const script=mode==='workbench'?'scripts/electron-workbench-pilot.cjs':'scripts/electron-scoped-pilot.cjs';
const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),[path.resolve(script),'--remote-debugging-pipe'],{env,windowsHide:true,stdio:['ignore','pipe','pipe','pipe','pipe','ipc']});
let buffer=Buffer.alloc(0),stderr='',result;const pending=new Map();
child.stderr.on('data',data=>{stderr+=data;});
child.stdout.on('data',data=>process.stdout.write(data));
child.stdio[3].on('error',error=>{stderr+=`\npipe write: ${error.message}`;});
child.stdio[4].on('data',data=>{
 buffer=Buffer.concat([buffer,data]);let end;
 while((end=buffer.indexOf(0))!==-1){const message=JSON.parse(buffer.subarray(0,end).toString());buffer=buffer.subarray(end+1);if(message.id)pending.delete(message.id);if(child.connected)child.send({type:'cdp-receive',message});}
});
child.on('message',message=>{
 if(message.type==='cdp-send'){pending.set(message.message.id,message.message.method);child.stdio[3].write(JSON.stringify(message.message)+'\0');}
 if(message.type==='result'){result=message.result;console.log(JSON.stringify(result,null,2));}
 if(message.type==='progress')console.log(message.name);
});
// A bounded fake-only child; never touches or kills an existing K process.
const timer=setTimeout(()=>{stderr+='\nCandidate exceeded 120 second test limit';child.kill();},120000);
const [code,signal]=await once(child,'exit');clearTimeout(timer);
await writeFile(path.join(root,`pipe-run-${Date.now()}.json`),JSON.stringify({code,signal,result,stderr},null,2));
if(code!==0||!result)process.exitCode=1;
console.log(JSON.stringify({code,signal,stderr,pending:[...pending.values()]}));
return code===0&&result;
}
if(await run('write')&&mode!=='workbench')await run('read');
