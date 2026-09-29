import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

async function backgroundModule(){
 const source=await readFile(new URL('../browser-extension/source/background.ts',import.meta.url),'utf8');
 const runtimeSource=source
  .replace(/^import[\s\S]*?;\r?\n/gm,'')
  .replace('class PlaywrightExtension {','export class PlaywrightExtension {')
  .replace(/\nnew PlaywrightExtension\(\);\s*$/,'\n');
 const javascript=stripTypeScriptTypes(runtimeSource,{mode:'transform'});
 return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

async function withChrome(chrome,run){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'chrome');
 Object.defineProperty(globalThis,'chrome',{configurable:true,writable:true,value:chrome});
 try{return await run();}
 finally{
  if(previous)Object.defineProperty(globalThis,'chrome',previous);
  else delete globalThis.chrome;
 }
}

function harness(windows,mode){
 const calls={windowQueries:[],tabs:[],windowsCreated:[],permissionChecks:0};
 const chrome={
  extension:{async isAllowedIncognitoAccess(){calls.permissionChecks++;return true;}},
  windows:{
   async getAll(options){calls.windowQueries.push(options);return windows;},
   async create(options){calls.windowsCreated.push(options);return{tabs:[{id:500,incognito:mode==='incognito'}]};}
  },
  tabs:{async create(options){calls.tabs.push(options);return{id:501,windowId:options.windowId,incognito:mode==='incognito'};}}
 };
 return{chrome,calls};
}

function backgroundFor(PlaywrightExtension,mode){
 const background=Object.create(PlaywrightExtension.prototype);
 background._validateConnectPage=async()=>{};
 background._pendingConnections={matches:()=>true};
 return background;
}

for(const mode of ['regular','incognito']){
 test(`${mode} work tab uses only an existing matching-mode window and stays inactive`,async()=>{
  const {PlaywrightExtension}=await backgroundModule();
  const expectedIncognito=mode==='incognito';
  const matchingId=expectedIncognito?22:11;
  const {chrome,calls}=harness([
   {id:10,incognito:!expectedIncognito},
   {id:matchingId,incognito:expectedIncognito},
   {id:undefined,incognito:expectedIncognito}
  ],mode);
  await withChrome(chrome,async()=>{
   const tab=await backgroundFor(PlaywrightExtension,mode)._connectToNewTab(7,'client',mode);
   assert.deepEqual(tab,{id:501,windowId:matchingId,incognito:expectedIncognito});
  });
  assert.deepEqual(calls.windowQueries,[{windowTypes:['normal']}]);
  assert.deepEqual(calls.tabs,[{url:'about:blank',windowId:matchingId,active:false}]);
  assert.deepEqual(calls.windowsCreated,[]);
  assert.equal(calls.tabs.some(({active})=>active===true),false);
  assert.equal(calls.windowsCreated.some(({focused})=>focused===true),false);
  assert.equal(calls.permissionChecks,expectedIncognito?1:0);
 });
}

for(const mode of ['regular','incognito']){
 test(`${mode} work-tab request fails clearly without an existing matching-mode window`,async()=>{
  const {PlaywrightExtension}=await backgroundModule();
  const mismatchedOnly=[{id:33,incognito:mode!=='incognito'}];
  const {chrome,calls}=harness(mismatchedOnly,mode);
  await withChrome(chrome,async()=>{
   await assert.rejects(
    backgroundFor(PlaywrightExtension,mode)._connectToNewTab(7,'client',mode),
    new RegExp(mode==='incognito'?'請先開啟無痕 Chrome 視窗':'請先開啟一般 Chrome 視窗')
   );
  });
  assert.deepEqual(calls.tabs,[]);
  assert.deepEqual(calls.windowsCreated,[]);
  assert.equal(calls.permissionChecks,mode==='incognito'?1:0);
 });
}
