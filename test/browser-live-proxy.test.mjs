import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeBrowserResponse} from '../src/browser-live-proxy.mjs';

test('download proxy validates identifier and returns safe attachment bytes',async()=>{
 const state={threadId:'t',browserAccess:{enabled:true,sessionKey:'session-1'}};
 const route='/download?id=12345678-1234-1234-1234-123456789abc';
 const result=await consumeBrowserResponse(new Response('fake file',{headers:{'content-disposition':"attachment; filename*=UTF-8''test.txt"}}),state,'t','session-1',route);
 assert.equal(result.downloadName,'test.txt');assert.equal(result.bytes.toString(),'fake file');
 await assert.rejects(consumeBrowserResponse(new Response('x',{headers:{'content-disposition':"attachment; filename*=UTF-8''..%2Fsecret"}}),state,'t','session-1',route),/檔名無效/);
});

test('download proxy bounds response size including missing Content-Length and rechecks the active session',async()=>{
 const state={threadId:'t',browserAccess:{enabled:true,sessionKey:'session-1'}};
 const route='/download?id=12345678-1234-1234-1234-123456789abc';
 await assert.rejects(consumeBrowserResponse(new Response('x',{headers:{'content-length':String(64*1024*1024+1)}}),state,'t','session-1',route),/64 MiB/);
 let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
 await assert.rejects(consumeBrowserResponse(new Response(body),state,'t','session-1',route),/64 MiB/);
 assert.equal(cancelled,true);
 state.threadId='changed';await assert.rejects(consumeBrowserResponse(new Response('x'),state,'t','session-1',route),/對話已切換/);
});
