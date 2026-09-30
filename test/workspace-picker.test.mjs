import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {startDesktop} from '../src/desktop-server.mjs';

async function fixture(pickWorkspace){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'folder-picker-'));
 const state={threadId:'keep-current',workspace:root,accessMode:'read-only'};
 const app=await startDesktop({root,port:0,pickWorkspace,controllerFactory:()=>({state,sessions:async()=>({sessions:[]}),close:async()=>{}})});
 const landing=await fetch(app.createLaunchUrl(),{redirect:'manual'}),cookie=landing.headers.get('set-cookie').split(';')[0];await landing.text();
 const headers={'Content-Type':'application/json','X-K-Request':'1',cookie,origin:app.origin};
 const pick=(options={})=>fetch(app.origin+'/api/pick-workspace',{method:'POST',headers,body:JSON.stringify({path:root}),...options});
 return {root,state,app,headers,pick};
}

test('native picker requires local request authority before opening a window',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;return {cancelled:true};});
 try {
  for(const headers of [{}, {...f.headers,cookie:''},{...f.headers,origin:'https://example.com'}, {...f.headers,'X-K-Request':''}])assert.equal((await f.pick({headers})).status,403);
  assert.equal(calls,0);
  assert.deepEqual(await (await f.pick()).json(),{cancelled:true});assert.equal(calls,1);
  assert.equal(f.state.threadId,'keep-current');assert.equal(f.state.accessMode,'read-only');
  await assert.rejects(readFile(path.join(f.root,'.runtime/projects.json')),{code:'ENOENT'});
 } finally {await f.app.close();}
});

test('choosing a folder returns the actual path without adding or switching workspaces',async()=>{
 let selected;const f=await fixture(async()=>({cancelled:false,path:selected}));
 try {
  selected=path.join(f.root,"中文 空白 ' $test");await mkdir(selected);
  const response=await f.pick();assert.equal(response.status,200);assert.deepEqual(await response.json(),{cancelled:false,path:selected});
  assert.equal(f.state.workspace,f.root);assert.equal(f.state.threadId,'keep-current');
  await assert.rejects(readFile(path.join(f.root,'.runtime/projects.json')),{code:'ENOENT'});
  selected=path.parse(f.root).root;assert.equal((await f.pick()).status,400);
  selected=path.join(f.root,'missing');assert.equal((await f.pick()).status,400);
 } finally {await f.app.close();}
});

test('one picker at a time; a disconnected request cancels it and permits the next request',async()=>{
 let opened,wasAborted=false;const didOpen=new Promise(resolve=>{opened=resolve;});
 let calls=0;
 const f=await fixture(({signal})=>{calls++;if(calls>1)return {cancelled:true};return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{wasAborted=true;reject(new Error('cancelled'));},{once:true});opened();});});
 const abort=new AbortController();
 try {
  const first=f.pick({signal:abort.signal}).catch(error=>error);await didOpen;
  const second=await f.pick();assert.equal(second.status,400);assert.match((await second.json()).error,/已開啟/);assert.equal(calls,1);
  abort.abort();await first;
  // Event barrier: the socket close handler aborts the injected picker.
  while(!wasAborted)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(await (await f.pick()).json(),{cancelled:true});assert.equal(calls,2);
 } finally {abort.abort();await f.app.close();}
});
