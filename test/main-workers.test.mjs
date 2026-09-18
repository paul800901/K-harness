import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWorkerIds,checkMainWorkers} from '../src/main-workers.mjs';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
test('artifact inventory distinguishes present, missing and invalid without accepting work',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const workspace=await mkdtemp(path.join(base,'artifacts-'));await writeFile(path.join(workspace,'partial.txt'),'partial');
 const host={request:async()=>({structuredContent:{status:'unresolved',outputFiles:['partial.txt','absent.txt','../escape']}})};
 const [result]=await checkMainWorkers(host,'thread',['known'],{workspace});
 assert.deepEqual(result.artifacts.map(a=>a.observation),['present','missing','unavailable']);
 assert.equal(result.acceptance,'not-reviewed');assert.equal(result.settled,false);
});
test('abrupt MCP process exit leaves unresolved job; fresh host finds output without replay', {timeout:30000},async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));const base=path.join(root,'.runtime/tests');await mkdir(base,{recursive:true});
 const dir=await mkdtemp(path.join(base,'main-crash-'));const workspace=path.join(dir,'workspace');await mkdir(workspace);
 await writeFile(path.join(workspace,'input.txt'),'preserve crash output');
 const connect=async mode=>{
  const client=new Client({name:'k-crash-test',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'test/fixtures/mcp-worker.mjs'),workspace,path.join(dir,'jobs'),mode],stderr:'pipe'});
  transport.stderr.on('data',()=>{});await client.connect(transport);return client;
 };
 const first=await connect('crash');let closed;const exited=new Promise(resolve=>{closed=resolve;});first.onclose=closed;
 try {await first.callTool({name:'k_worker_start',arguments:{requestId:'crash-once',task:'Copy input.',readFiles:['input.txt'],outputFiles:['output.txt']}});await exited;}finally{await first.close();}
 const next=await connect('normal');const calls=[];
 try{
  const bridge={request:async(_method,p)=>{calls.push(p.tool);return next.callTool({name:p.tool,arguments:p.arguments});}};
  const [result]=await checkMainWorkers(bridge,'reopened',['crash-once'],{stop:true,workspace});
  assert.equal(result.status,'unresolved');assert.equal(result.settled,false);assert.equal(result.acceptance,'not-reviewed');
  assert.deepEqual(result.artifacts,[{path:'output.txt',observation:'present'}]);
  assert.deepEqual(calls,['k_worker_inspect']);
  assert.equal(await readFile(path.join(workspace,'output.txt'),'utf8'),'preserve crash output');
 }finally{await next.close();}
});
test('worker scope uses only exact k_flash start items and valid IDs',()=>{
 const item={type:'mcpToolCall',server:'k_flash',tool:'k_worker_start',arguments:{requestId:'known'}};
 assert.deepEqual(collectWorkerIds([item,item,{...item,server:'other'},{...item,arguments:{requestId:'../escape'}},{type:'agentMessage',text:'job-anything'}]),['known']);
});
test('stop inspects first, cancels running worker once and waits; never restarts or accepts outputs',async()=>{
 const calls=[];
 const host={request:async(method,p)=>{calls.push([method,p.tool,p.arguments]);return {structuredContent:{status:p.tool==='k_worker_wait'?'cancelled':'running',outputFiles:['partial.txt']}};}};
 const result=await checkMainWorkers(host,'thread',['known'],{stop:true});
 assert.deepEqual(calls.map(c=>c[1]),['k_worker_inspect','k_worker_cancel','k_worker_wait']);
 assert.equal(result[0].settled,true);assert.equal(result[0].acceptance,'not-reviewed');
});
test('unknown prior-host state and completed jobs are inspected, never adopted, cancelled or replayed',async()=>{
 for(const status of ['unresolved','completed']){
  let count=0;const host={request:async()=>{count++;return {structuredContent:{status}};}};
  const [result]=await checkMainWorkers(host,'thread',['known'],{stop:true});
  assert.equal(count,1);assert.equal(result.settled,status==='completed');
 }
 const [failure]=await checkMainWorkers({request:async()=>{throw new Error('offline');}},'thread',['known'],{stop:true});
 assert.equal(failure.status,'unavailable');assert.equal(failure.settled,false);
});
test('actual stdio Pi worker is cancelled after its write, preserving output through host stop logic', {timeout:30000}, async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const base=path.join(root,'.runtime/tests');await mkdir(base,{recursive:true});
 const dir=await mkdtemp(path.join(base,'main-stop-'));const workspace=path.join(dir,'workspace');await mkdir(workspace);
 await writeFile(path.join(workspace,'input.txt'),'keep this completed write');
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'test/fixtures/mcp-worker.mjs'),workspace,path.join(dir,'jobs'),'hold'],stderr:'pipe'});
 let release;const wrote=new Promise(resolve=>{release=resolve;});
 transport.stderr.on('data',chunk=>{if(chunk.toString().includes('FIXTURE_WAITING_AFTER_WRITE'))release();});
 const client=new Client({name:'k-stop-test',version:'1'});
 try {
  await client.connect(transport);
  await client.callTool({name:'k_worker_start',arguments:{requestId:'stop-once',task:'Copy input.',readFiles:['input.txt'],outputFiles:['output.txt']}});
  await wrote;
  const bridge={request:async(method,p)=>{
   assert.equal(method,'mcpServer/tool/call');assert.equal(p.threadId,'test-thread');assert.equal(p.server,'k_flash');
   return client.callTool({name:p.tool,arguments:p.arguments});
  }};
  const [result]=await checkMainWorkers(bridge,'test-thread',['stop-once'],{stop:true});
  assert.equal(result.status,'cancelled');assert.equal(result.settled,true);
  assert.equal(await readFile(path.join(workspace,'output.txt'),'utf8'),'keep this completed write');
  const [again]=await checkMainWorkers(bridge,'test-thread',['stop-once']);assert.equal(again.status,'cancelled');
 }finally{await client.close();}
});
