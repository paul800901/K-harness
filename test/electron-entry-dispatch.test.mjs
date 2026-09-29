import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const source=await readFile(new URL('../src/electron-isolated-main.cjs',import.meta.url),'utf8');

function loadMain({argvEntry,mainFilename,connected=true,platform='win32'}){
 const moduleFilename=path.resolve('D:/candidate/src/electron-isolated-main.cjs');
 const app={quitCalls:0,quit(){this.quitCalls++;},on(){},whenReady(){return Promise.resolve();},setPath(){}};
 const runtimeRequire=id=>{
  if(id==='electron')return {app};
  if(id==='playwright-core')return {chromium:{}};
  throw Error(`Unexpected runtime require: ${id}`);
 };
 const requireFunction=id=>{
  if(id==='node:path')return path;
  if(id==='node:module')return {createRequire:()=>runtimeRequire};
  if(id==='node:fs/promises')return {mkdir:async()=>{},realpath:async value=>value,stat:async()=>({isDirectory:()=>true})};
  if(id==='node:url')return {pathToFileURL:value=>new URL(`file:///${String(value).replaceAll('\\','/')}`)};
  throw Error(`Unexpected require: ${id}`);
 };
 requireFunction.main={filename:mainFilename};
 const events=new EventEmitter(),messages=[];
 let connectedReads=0;
 const fakeProcess=Object.assign(events,{argv:[process.execPath,argvEntry],platform,send(message){messages.push(message);},exitCode:undefined});
 Object.defineProperty(fakeProcess,'connected',{get(){connectedReads++;return connected;}});
 const commonJsModule={exports:{}};
 const imports=[];
 const context={require:requireFunction,module:commonJsModule,process:fakeProcess,__filename:moduleFilename,
  __dirname:path.dirname(moduleFilename),setImmediate,clearImmediate,setTimeout,clearTimeout,URL};
 new vm.Script(source,{filename:moduleFilename,importModuleDynamically:async specifier=>{
  imports.push(specifier);
  throw Error('Stubbed startup import for dispatch-only test.');
 }}).runInNewContext(context);
 return {app,events:fakeProcess,messages,imports,exports:commonJsModule.exports,moduleFilename,context,mainFilename,get connectedReads(){return connectedReads;}};
}

async function waitFor(predicate,diagnostic=''){
 for(let i=0;i<100;i++){
  if(predicate())return;
  await new Promise(resolve=>setImmediate(resolve));
 }
 assert.fail(`Expected lifecycle action was not observed. ${diagnostic}`);
}

test('direct Electron entry dispatches by argv path even when Electron owns require.main',async()=>{
 const main=loadMain({argvEntry:'d:/CANDIDATE/SRC/ELECTRON-ISOLATED-MAIN.CJS',mainFilename:'electron',connected:false});
 assert.notEqual(main.mainFilename,main.moduleFilename,'Electron owns require.main rather than the application entry module.');
 assert.equal(vm.runInContext("path.resolve(process.argv[1]).toLowerCase()===path.resolve(__filename).toLowerCase()",main.context),true);
 assert.equal(typeof main.exports.startNativeOwner,'function');
 await waitFor(()=>main.app.quitCalls>=1&&main.events.exitCode===1);
 assert.equal(main.imports.length,0,'Disconnected startup must stop before importing or creating owner services.');
 assert.equal(main.connectedReads,2,'One start invocation checks connection once, then its failure handler checks it once.');
 assert.equal(main.app.quitCalls,2,'One startup invocation quits once on early disconnect and once during fail-closed shutdown.');
 assert.equal(main.events.exitCode,1,'Stubbed startup failure is reported as unsuccessful.');
});

test('entry path matching remains case-sensitive off Windows',async()=>{
 const main=loadMain({argvEntry:'D:/CANDIDATE/SRC/ELECTRON-ISOLATED-MAIN.CJS',mainFilename:'electron',connected:false,platform:'linux'});
 assert.equal(vm.runInContext('path.resolve(process.argv[1])===path.resolve(__filename)',main.context),false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(main.connectedReads,0);
 assert.equal(main.app.quitCalls,0);
 assert.equal(main.imports.length,0);
});

test('requiring the entry from a fixture does not auto-start, and uninitialized close quits Electron',async()=>{
 const fixturePath='D:/candidate/scripts/electron-entry-pilot.cjs';
 const main=loadMain({argvEntry:fixturePath,mainFilename:fixturePath});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(main.imports.length,0);
 assert.equal(main.app.quitCalls,0);
 assert.equal(typeof main.exports.startNativeOwner,'function');
 main.events.emit('message',{type:'owner-request',id:1,method:'close'});
 await waitFor(()=>main.app.quitCalls===1);
 assert.equal(main.messages.at(-1)?.type,'owner-response');
 assert.equal(main.messages.at(-1)?.ok,true);
 assert.equal(main.messages.at(-1)?.value?.closed,true);
});

test('uninitialized supervisor disconnect quits Electron',async()=>{
 const fixturePath='D:/candidate/scripts/electron-entry-pilot.cjs';
 const main=loadMain({argvEntry:fixturePath,mainFilename:fixturePath});
 main.events.emit('disconnect');
 await waitFor(()=>main.app.quitCalls===1);
 assert.equal(main.imports.length,0);
});
