import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {createLunaBridge,lunaResult} from '../src/luna-bridge.mjs';
import {createLunaGateway} from '../src/luna-gateway.mjs';

const testRoot=path.resolve('.runtime','tests','worker-reconciliation',randomUUID());
const makePaths=async()=>{const root=path.join(testRoot,randomUUID()),workspace=path.join(root,'workspace'),parentId=`parent-${randomUUID()}`;await mkdir(workspace,{recursive:true});return {root,workspace,parentId};};
const legacyRecord=({requestId='legacy-gemini',parentId,workspace,provider='gemini',executionUnowned=true,settled=false,status='unresolved',...extra})=>({requestId,parentId,provider,model:provider==='gemini'?'gemini-3.8-flash':'gpt-6-luna',effort:'low',status,settled,executionUnowned,acceptance:'not-reviewed',task:'synthetic task: inspect result.txt',output:'',outputFiles:[],workspace,accessMode:'workspace-write',error:'original unresolved reason',...extra});
async function writeRecord({root,parentId,record}){const dir=path.join(root,'.runtime','luna-bridge',parentId);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,`${record.requestId}.json`),JSON.stringify(record,null,2));return path.join(dir,`${record.requestId}.json`);}
async function makeBridge({root,workspace,parentId,onChange=()=>{},geminiFactory=()=>({run:async()=>({status:'completed',settled:true,output:'synthetic result',outputFiles:[]})})}){
 return createLunaBridge({root,workspace,parentId,executable:'fake-codex',geminiOnly:true,geminiFactory,onChange});
}

test('historical unowned Gemini reconciliation is scoped, bounded, correctable/idempotent and survives inspect/list/reopen',async()=>{
 const paths=await makePaths(),record=legacyRecord(paths),recordPath=await writeRecord({...paths,record}),changes=[];
 const bridge=await makeBridge({...paths,onChange:row=>changes.push(row)});
 try{
  const before=await bridge.inspect({requestId:record.requestId});
  const invariant={status:before.status,settled:before.settled,error:before.error,output:before.output,acceptance:before.acceptance,requestId:before.requestId};
  const note=await bridge.reconcile({requestId:record.requestId,summary:'  已檢視指定成果  ',evidence:'  僅查核合成 result.txt  '});
  assert.deepEqual(note.reconciliation,{summary:'已檢視指定成果',evidence:'僅查核合成 result.txt',reviewedAt:note.reconciliation.reviewedAt});
  assert.doesNotThrow(()=>new Date(note.reconciliation.reviewedAt).toISOString());
  assert.deepEqual(Object.fromEntries(Object.keys(invariant).map(key=>[key,note[key]])),invariant,'reconciliation must not settle or rewrite the execution result');
  const same=await bridge.reconcile({requestId:record.requestId,summary:'已檢視指定成果',evidence:'僅查核合成 result.txt'});
  assert.equal(same.reconciliation.reviewedAt,note.reconciliation.reviewedAt,'identical retry is idempotent');
  const corrected=await bridge.reconcile({requestId:record.requestId,summary:'corrected review',evidence:'an earlier search failed; not verified'});
  assert.equal(corrected.reconciliation.evidence,'an earlier search failed; not verified');
  assert.deepEqual(Object.fromEntries(Object.keys(invariant).map(key=>[key,corrected[key]])),invariant);
  const restored=await bridge.reconcile({requestId:record.requestId,summary:note.reconciliation.summary,evidence:note.reconciliation.evidence});
  note.reconciliation=restored.reconciliation;
  for(const [summary,evidence] of [[' ','valid'],['valid','\n'],['x'.repeat(2001),'valid'],['valid','x'.repeat(4001)]])
   await assert.rejects(bridge.reconcile({requestId:record.requestId,summary,evidence}));
  await assert.rejects(bridge.reconcile({requestId:'missing',summary:'valid',evidence:'valid'}));
  const persisted=JSON.parse(await readFile(recordPath,'utf8'));
  assert.deepEqual(persisted.reconciliation,note.reconciliation);assert.equal(persisted.status,invariant.status);assert.equal(persisted.settled,false);assert.equal(persisted.error,invariant.error);assert.equal(persisted.output,invariant.output);assert.equal(persisted.acceptance,'not-reviewed');
  const projected=await bridge.inspect({requestId:record.requestId});
  assert.deepEqual(projected.reconciliation,note.reconciliation);
  const rows=await bridge.list(false);assert.deepEqual(rows.find(row=>row.requestId===record.requestId).reconciliation,note.reconciliation);
  const compact=await lunaResult(projected);assert.equal(compact.task,record.task);assert.deepEqual(compact.reconciliation,note.reconciliation);
  const startsBefore=changes.filter(row=>row.status==='starting'||row.status==='running').length;
  await assert.rejects(bridge.start({requestId:'new-after-unknown',task:'synthetic next work',model:'gemini-3.8-flash',effort:'low',handoffFrom:record.requestId}),/尚未確認停止|settled|停止/u);
  assert.equal(changes.filter(row=>row.status==='starting'||row.status==='running').length,startsBefore,'handoff rejection starts no new work');
  assert.equal((await bridge.inspect({requestId:record.requestId})).settled,false);
 }finally{await bridge.close();}
 const reopened=await makeBridge(paths);
 try{
  const inspect=await reopened.inspect({requestId:record.requestId});
  assert.deepEqual(inspect.reconciliation,(await reopened.list(false)).find(row=>row.requestId===record.requestId).reconciliation);
  assert.equal(inspect.status,'unresolved');assert.equal(inspect.settled,false);assert.equal(inspect.executionUnowned,true);
 }finally{await reopened.close();}
});

test('reconcile rejects non-Gemini, settled, and currently owned/live records',async()=>{
 const paths=await makePaths();
 await writeRecord({...paths,record:legacyRecord({...paths,requestId:'wrong-provider',provider:'codex',executionUnowned:true})});
 await writeRecord({...paths,record:legacyRecord({...paths,requestId:'settled-history',executionUnowned:true,settled:true,status:'completed'})});
 let finish;const gate=new Promise(resolve=>{finish=resolve;}),runs=[];
 const bridge=await makeBridge({...paths,geminiFactory:()=>({async run({onStart}){onStart(12345);await gate;runs.push('finished');return {status:'completed',settled:true,output:'synthetic',outputFiles:[]};}})});
 try{
  await assert.rejects(bridge.reconcile({requestId:'wrong-provider',summary:'reviewed',evidence:'synthetic'}));
  await assert.rejects(bridge.reconcile({requestId:'settled-history',summary:'reviewed',evidence:'synthetic'}));
  await bridge.start({requestId:'owned-live',task:'fake held task',model:'gemini-3.8-flash',effort:'low'});
  await assert.rejects(bridge.reconcile({requestId:'owned-live',summary:'reviewed',evidence:'synthetic'}));
  finish();
  const result=await bridge.wait({requestId:'owned-live',timeoutMs:1000});
  assert.equal(result.settled,true);assert.deepEqual(runs,['finished']);
 }finally{finish();await bridge.close();}
});

test('reconcile persistence failure leaves no in-memory or on-disk reconciliation note',async t=>{
 const paths=await makePaths(),record=legacyRecord(paths),recordPath=await writeRecord({...paths,record}),bridge=await makeBridge(paths);
 const target=recordPath,rename=fs.rename;
 const mock=t.mock.method(fs,'rename',async(from,to)=>{if(path.resolve(to)===path.resolve(target))throw Object.assign(Error('synthetic persistence failure'),{code:'EIO'});return rename(from,to);});syncBuiltinESMExports();
 try{
  await assert.rejects(bridge.reconcile({requestId:record.requestId,summary:'reviewed',evidence:'synthetic evidence'}),/synthetic persistence failure/u);
  assert.equal((await bridge.list(false)).find(row=>row.requestId===record.requestId).reconciliation,undefined);
  assert.equal(JSON.parse(await readFile(recordPath,'utf8')).reconciliation,undefined);
 }finally{mock.mock.restore();syncBuiltinESMExports();await bridge.close();}
});

async function post(url,token,message){return fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(message)});}
async function body(response){const text=await response.text();const data=text.split(/\r?\n/u).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');return JSON.parse(data||text);}

test('gateway exposes only the correct reconciliation prefix, scopes calls, excludes private fields and never result-notifies',async()=>{
 for(const {geminiOnly,prefix,server} of [{geminiOnly:true,prefix:'gemini',server:'k_gemini'},{geminiOnly:false,prefix:'luna',server:'k_luna'}]){
  const paths=await makePaths(),record=legacyRecord({...paths,accountEmail:'synthetic-private@example.invalid',pid:99999,apiKey:'synthetic-secret',token:'synthetic-token'}),calls=[],acks=[];
  const bridge={workerPolicy:{model:'auto',effort:'auto'},async start(){throw Error('unexpected start');},async inspect({requestId}){calls.push(['inspect',requestId]);return record;},async list(){return [record];},async wait(){throw Error('unexpected wait');},async cancel(){throw Error('unexpected cancel');},async reconcile(args){calls.push(['reconcile',args]);record.reconciliation={summary:args.summary.trim(),evidence:args.evidence.trim(),reviewedAt:'2026-10-07T00:00:00.000Z'};return record;},resultReady(){acks.push('unexpected');}};
  const gateway=await createLunaGateway({bridge,geminiOnly});
  try{
   const config=gateway.mcpConfig.mcpServers[server],token=config.headers.Authorization.slice(7);
   const rpc=async(id,method,params)=>body(await post(config.url,token,{jsonrpc:'2.0',id,method,params}));
   const tools=await rpc(1,'tools/list',{}),names=tools.result.tools.map(tool=>tool.name);
   assert(names.includes(`${prefix}_reconcile`));assert.equal(names.includes(`${prefix==='gemini'?'luna':'gemini'}_reconcile`),false);
   const tool=tools.result.tools.find(entry=>entry.name===`${prefix}_reconcile`);
   assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(),['evidence','requestId','summary']);assert.equal(tool.inputSchema.additionalProperties,false);
   const result=await rpc(2,'tools/call',{name:`${prefix}_reconcile`,arguments:{requestId:record.requestId,summary:' review summary ',evidence:' checked synthetic output '}});
   assert.notEqual(result.result.isError,true);assert.deepEqual(calls,[['reconcile',{requestId:record.requestId,summary:'review summary',evidence:'checked synthetic output'}]]);
   assert.equal(acks.length,0,'reconciliation is not a worker completion notification');
   const serialized=JSON.stringify(result.result.structuredContent??result.result.content);
   for(const privateValue of ['synthetic-secret','synthetic-token','99999'])assert.equal(serialized.includes(privateValue),false,`must not expose ${privateValue}`);
   const inspected=await rpc(3,'tools/call',{name:`${prefix}_inspect`,arguments:{requestId:record.requestId}});
   assert.equal(inspected.result.structuredContent.task,record.task);assert.equal(inspected.result.structuredContent.executionUnowned,true);assert.equal(inspected.result.structuredContent.settled,false);assert.equal(inspected.result.structuredContent.reconciliation.summary,'review summary');
   const listed=await rpc(4,'tools/call',{name:`${prefix}_list`,arguments:{}});
   const listRow=listed.result.structuredContent.workers.find(row=>row.requestId===record.requestId);
   assert.deepEqual(listRow.reconciliation,{summary:'review summary',reviewedAt:'2026-10-07T00:00:00.000Z'});assert.equal(listRow.settled,false);
   const override=await rpc(5,'tools/call',{name:`${prefix}_reconcile`,arguments:{requestId:record.requestId,summary:'x',evidence:'y',parentId:'another-parent'}});
   assert(override.error||override.result?.isError);assert.equal(calls.filter(([name])=>name==='reconcile').length,1);
   const wrongTool=await rpc(6,'tools/call',{name:`${prefix==='gemini'?'luna':'gemini'}_reconcile`,arguments:{requestId:record.requestId,summary:'x',evidence:'y'}});
   assert(wrongTool.error||wrongTool.result?.isError);assert.equal(calls.filter(([name])=>name==='reconcile').length,1);
  }finally{await gateway.close();}
 }
});
