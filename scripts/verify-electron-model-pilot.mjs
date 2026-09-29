import path from 'node:path';
import {spawn} from 'node:child_process';
import {PassThrough,Writable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {startElectronIsolatedLauncher} from '../src/electron-isolated-launcher.mjs';

// One-shot candidate runner. Model turns are never replayed on failure.
const runtime=path.resolve('.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee/trusted-runtime/native-candidate-20260926');
let mainPath=path.join(runtime,'scripts/electron-model-pilot.cjs');
if(process.argv[2]==='claude'){
 mainPath=path.join(runtime,'scripts/electron-model-claude-pilot.cjs');
 await writeFile(mainPath,'process.argv.push("--only-claude");require("./electron-model-pilot.cjs");\n');
}
const input=new PassThrough(),events=[],messages=[];
let tail='',child,resolveResult,resolveExit;
const resultReady=new Promise(resolve=>{resolveResult=resolve;});
const exited=new Promise(resolve=>{resolveExit=resolve;});
const output=new Writable({write(chunk,_encoding,done){
 tail+=chunk;let end;
 while((end=tail.indexOf('\n'))>=0){events.push(JSON.parse(tail.slice(0,end)));tail=tail.slice(end+1);}
 done();
}});
const result={scope:'candidate-real-providers-fake-page',productionChanged:false};
let timeout;
try{
 const run=await startElectronIsolatedLauncher({paths:{trustedRuntime:runtime,electronExecutable:path.join(runtime,'node_modules/electron/dist/electron.exe')},
  mainPath,input,output,
  spawnImpl(...args){
   child=spawn(...args);
   child.on('message',message=>{
    if(!message?.type?.startsWith('test-'))return;
    messages.push(message);console.log(JSON.stringify(message));
    if(message.type==='test-result')resolveResult(message);
   });
   child.once('exit',(code,signal)=>{resolveExit({code,signal});resolveResult({ok:false,errorCode:'child-exited-before-result'});});
   return child;
  },
 });
 const outcome=await Promise.race([resultReady,new Promise(resolve=>{timeout=setTimeout(()=>resolve({ok:false,errorCode:'overall-timeout'}),850000);})]);
 clearTimeout(timeout);
 result.outcome=outcome;
 if(!outcome.ok){child.send({type:'test-cancel'});await new Promise(resolve=>setTimeout(resolve,3000));}
 input.write('close\n');
 const close=await Promise.race([exited,new Promise(resolve=>{timeout=setTimeout(()=>resolve(null),45000);})]);
 clearTimeout(timeout);
 result.exit=close;result.events=events;
 if(!close)throw Error('Candidate shutdown not confirmed; no force termination attempted.');
 result.status=outcome.ok&&close.code===0&&events.some(event=>event.type==='closed'&&event.confirmed===true)?'passed':'failed';
 if(result.status!=='passed')process.exitCode=1;
}catch(error){result.status='failed';result.error=error.message;process.exitCode=1;
 if(child?.connected)child.send({type:'test-cancel'});
 input.write('close\n');
}finally{
 clearTimeout(timeout);result.messages=messages;result.events=events;
 const evidence=path.resolve(`.runtime/electron-browser-pilot-20260926/model-parent-${Date.now()}.json`);
 await writeFile(evidence,JSON.stringify(result,null,2));
 console.log(JSON.stringify({status:result.status,evidence,error:result.error,exit:result.exit}));
 if(child?.exitCode!==null)input.destroy();
}
