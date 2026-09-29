import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {browserLiveRequest} from '../src/browser-live-proxy.mjs';

test('browser proxy rejects stale threads and disabled browser without contacting endpoints',async()=>{
  let calls=0;const fetcher=()=>{calls++;throw Error('unexpected');};
  const state={threadId:'thread-a',browserAccess:{enabled:false}};
  await assert.rejects(browserLiveRequest('unused',state,'other','/state',undefined,fetcher),/對話已切換/);
  assert.equal((await browserLiveRequest('unused',state,'thread-a','/state',undefined,fetcher)).available,false);
  assert.equal(calls,0);
});

test('browser proxy takes loopback endpoint only from active session profile and never exposes token',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-proxy-'));
  const dir=path.join(root,'.runtime','browser-profiles','session-1');await mkdir(dir,{recursive:true});
  const token='a'.repeat(64);await writeFile(path.join(dir,'live.json'),JSON.stringify({port:12345,token}));
  const state={threadId:'t',browserAccess:{enabled:true,sessionKey:'session-1'}};
  const result=await browserLiveRequest(root,state,'t','/state',undefined,async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:12345/state');assert.equal(options.headers.Authorization,`Bearer ${token}`);
    assert.equal(options.redirect,'error');return new Response(JSON.stringify({available:true,mode:'human'}));
  });
  assert.deepEqual(result,{available:true,mode:'human'});
  await assert.rejects(browserLiveRequest(root,state,'t','/evil'),/無效/);
  state.browserAccess.sessionKey='../escape';await assert.rejects(browserLiveRequest(root,state,'t','/state'),/識別無效/);
});

test('download proxy validates identifier and returns safe attachment bytes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-download-proxy-'));
 const dir=path.join(root,'.runtime','browser-profiles','session-1');await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'live.json'),JSON.stringify({port:12345,token:'b'.repeat(64)}));
 const state={threadId:'t',browserAccess:{enabled:true,sessionKey:'session-1'}};
 const route='/download?id=12345678-1234-1234-1234-123456789abc';
 const result=await browserLiveRequest(root,state,'t',route,undefined,async()=>new Response('fake file',{headers:{'content-disposition':"attachment; filename*=UTF-8''test.txt"}}));
 assert.equal(result.downloadName,'test.txt');assert.equal(result.bytes.toString(),'fake file');
 await assert.rejects(browserLiveRequest(root,state,'t','/download?id=../secret'),/無效/);
 await assert.rejects(browserLiveRequest(root,state,'t',route,undefined,async()=>new Response('x',{headers:{'content-disposition':"attachment; filename*=UTF-8''..%2Fsecret"}})),/檔名無效/);
});

test('download proxy bounds response size including missing Content-Length and rechecks the active session',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-browser-size-'));
 const dir=path.join(root,'.runtime','browser-profiles','session-1');await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'live.json'),JSON.stringify({port:12345,token:'b'.repeat(64)}));
 const state={threadId:'t',browserAccess:{enabled:true,sessionKey:'session-1'}};
 const route='/download?id=12345678-1234-1234-1234-123456789abc';
 await assert.rejects(browserLiveRequest(root,state,'t',route,undefined,async()=>new Response('x',{headers:{'content-length':String(64*1024*1024+1)}})),/64 MiB/);
 let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
 await assert.rejects(browserLiveRequest(root,state,'t',route,undefined,async()=>new Response(body)),/64 MiB/);
 assert.equal(cancelled,true);
 await assert.rejects(browserLiveRequest(root,state,'t',route,undefined,async()=>{state.threadId='changed';return new Response('x');}),/對話已切換/);
});
