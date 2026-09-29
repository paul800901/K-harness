import path from 'node:path';
import {PassThrough,Writable} from 'node:stream';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startElectronIsolatedLauncher} from '../src/electron-isolated-launcher.mjs';
const runtime=path.resolve('.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/native-candidate-20260926');
const input=new PassThrough(),events=[];let tail='';
const output=new Writable({write(chunk,encoding,done){tail+=chunk;let end;while((end=tail.indexOf('\n'))>=0){events.push(JSON.parse(tail.slice(0,end)));tail=tail.slice(end+1);}done();}});
const wait=async check=>{for(let n=0;n<300;n++){if(check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Native entry probe condition timed out.');};
const run=await startElectronIsolatedLauncher({paths:{trustedRuntime:runtime,electronExecutable:path.join(runtime,'node_modules/electron/dist/electron.exe')},mainPath:path.join(runtime,'scripts/electron-entry-pilot.cjs'),input,output});
const exit=once(run.child,'exit');const messages=[];run.child.on('message',message=>{if(message.type.startsWith('test-'))messages.push(message);});
const result={scope:'fake-services-real-entry',checks:[],productionChanged:false};
try{
 await wait(()=>messages.some(m=>m.type==='test-ui-ready')||messages.some(m=>m.type==='test-failed'));
 assert(!messages.some(m=>m.type==='test-failed'),JSON.stringify(messages));assert.equal(messages.find(m=>m.type==='test-ui-ready').visible,true);
 assert.equal(events[0].type,'ready');assert.equal(events[0].pid,process.pid);assert.equal(events[0].presentation,'native');assert(!events.some(e=>'launchUrl' in e));
 result.checks.push('Real parent and child entry handshake over private pipe; visible UI; no bootstrap URL emitted');
 input.write('close\n');await wait(()=>events.some(e=>e.code==='active-work'));assert.equal(run.child.exitCode,null);
 result.checks.push('Busy fake conversation refuses shutdown without killing the child');
 run.child.send({type:'test-idle'});await wait(()=>messages.some(m=>m.type==='test-idle-ready'));
 input.write('open\n');await wait(()=>events.some(e=>e.type==='open'));
 result.checks.push('Private open command shows existing workbench');
 input.write('close\n');await run.protocol.done;
 const [code]=await exit;assert.equal(code,0);assert(events.some(e=>e.type==='closed'&&e.confirmed===true));
 result.checks.push('Idle shutdown confirmed and Electron process exits successfully');result.status='passed';
}catch(error){result.status='failed';result.error=error.stack;process.exitCode=1;input.write('close\n');}
finally{result.events=events;result.evidence=messages.find(m=>m.type==='test-ui-ready')?.run;await writeFile(path.resolve(`.runtime/electron-browser-pilot-20260926/entry-${Date.now()}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));input.destroy();}
