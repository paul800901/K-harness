import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,lstat,rename,symlink,utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {deleteArchived} from '../src/archive-delete.mjs';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';

async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'k-archive-delete-'));
 const runtime=path.join(root,'.runtime');
 for(const name of ['main-sessions','claude-sessions','input-queues'])await mkdir(path.join(runtime,name),{recursive:true});
 const add=async(id,{archived=true,versions=1,projection=false,queue=false}={})=>{
  for(let i=1;i<=versions;i++)await writeFile(path.join(runtime,'main-sessions',`${id}-${i}.json`),JSON.stringify({threadId:id,archived:archived||i<versions,saveOrder:i}));
  if(projection)await writeFile(path.join(runtime,'claude-sessions',`${id}.json`),'{"messages":[]}');
  if(queue)await writeFile(path.join(runtime,'input-queues',`${id}.json`),'{"rows":[]}');
 };
 return {root,runtime,add};
}

for(const scenario of [
 {name:'R2-only archived conversation can be deleted',archived:true},
 {name:'R2 archive supersedes a legacy unarchived record when deleting',legacyArchived:false,archived:true},
 {name:'R2 unarchive supersedes a legacy archived record and preserves all conversation files',legacyArchived:true,archived:false},
])test(scenario.name,async()=>{
 const f=await fixture(),threadId='archive-regression';
 const mainDir=path.join(f.runtime,'main-sessions');
 const record={threadId,model:'gpt-6-luna',workspace:f.root};
 const sources=[];
 if(scenario.legacyArchived!==undefined){
  const legacy=path.join(mainDir,`${threadId}-1-legacy.json`);
  await writeFile(legacy,JSON.stringify({...record,archived:scenario.legacyArchived,saveOrder:1}));
  await utimes(legacy,new Date(0),new Date(0));sources.push(legacy);
 }
 sources.push(await saveMainSession(f.root,{...record,archived:scenario.archived}));
 for(const name of ['claude-sessions','input-queues']){
  const file=path.join(f.runtime,name,`${threadId}.json`);
  await writeFile(file,JSON.stringify({threadId,fake:true}));sources.push(file);
 }
 const untouched=await saveMainSession(f.root,{...record,threadId:'keep-active',archived:false});
 const untouchedBytes=await readFile(untouched,'utf8');
 const before=await Promise.all(sources.map(file=>readFile(file,'utf8')));
 assert.equal((await listMainSessions(f.root)).sessions.find(row=>row.threadId===threadId).archived,scenario.archived);
 let recycleCalls=0,manifest;
 const result=await deleteArchived({root:f.root,threadIds:[threadId],confirmed:true,recycler:async bundle=>{
  recycleCalls++;manifest=JSON.parse(await readFile(path.join(bundle,'K-restore-manifest.json'),'utf8'));
  await rename(bundle,path.join(f.runtime,'test-recycle-bin'));
 }});
 if(scenario.archived){
  assert.deepEqual(result,{deletedIds:[threadId],failed:[]});assert.equal(recycleCalls,1);
  assert.deepEqual(manifest.files.map(file=>file.originalPath).sort(),sources.map(file=>path.relative(f.runtime,file)).sort());
  for(const file of sources)await assert.rejects(lstat(file),{code:'ENOENT'});
  assert.equal((await listMainSessions(f.root)).sessions.some(row=>row.threadId===threadId),false);
 }else{
  assert.deepEqual(result.deletedIds,[]);assert.equal(result.failed.length,1);
  assert.match(result.failed[0].error,/只能刪除已封存/);assert.equal(recycleCalls,0);
  assert.deepEqual(await Promise.all(sources.map(file=>readFile(file,'utf8'))),before);
  assert.equal((await listMainSessions(f.root)).sessions.find(row=>row.threadId===threadId).archived,false);
 }
 assert.equal(await readFile(untouched,'utf8'),untouchedBytes);
});

test('explicit confirmed archived K records are bundled to the injected recycler, including every append-only version and K projections/queue',async()=>{
 const f=await fixture();await f.add('claude_a',{versions:3,projection:true,queue:true});
 const recycled=[];
 let manifest;
 const result=await deleteArchived({root:f.root,threadIds:['claude_a'],confirmed:true,recycler:async bundle=>{recycled.push((await readdir(bundle)).sort());manifest=JSON.parse(await readFile(path.join(bundle,'K-restore-manifest.json'),'utf8'));await rename(bundle,path.join(f.runtime,'test-recycle-bin'));}});
 assert.deepEqual(result,{deletedIds:['claude_a'],failed:[]});
 assert.equal(recycled.length,1);assert.equal(recycled[0].length,6);assert.equal(manifest.files.length,5);assert.equal(manifest.files.find(x=>x.stagedName.endsWith('claude_a-1.json')).originalPath,path.join('main-sessions','claude_a-1.json'));
 assert.deepEqual(await readdir(path.join(f.runtime,'main-sessions')),[]);
 assert.equal((await readdir(path.join(f.runtime,'test-recycle-bin'))).length,6);
});

test('refuses missing confirmation, invalid IDs, current conversation and non-archived records without moving files',async()=>{
 const f=await fixture();await f.add('active',{archived:false});await f.add('current');
 await assert.rejects(deleteArchived({root:f.root,threadIds:['current'],confirmed:false}),/確認/);
 await assert.rejects(deleteArchived({root:f.root,threadIds:['../outside'],confirmed:true}),/threadIds/);
 const result=await deleteArchived({root:f.root,threadIds:['active','current'],confirmed:true,currentThreadId:'current',recycler:async()=>{throw Error('must not run');}});
 assert.equal(result.failed.length,2);assert.match(result.failed[0].error,/封存/);assert.match(result.failed[1].error,/目前開啟/);
 assert.equal((await readdir(path.join(f.runtime,'main-sessions'))).length,2);
});

test('a recycle-bin failure restores each source to its original K path',async()=>{
 const f=await fixture();await f.add('restore_me',{versions:2,projection:true,queue:true});
 const result=await deleteArchived({root:f.root,threadIds:['restore_me'],confirmed:true,recycler:async()=>{throw new Error('recycle failed');}});
 assert.equal(result.deletedIds.length,0);assert.match(result.failed[0].error,/recycle failed/);
 assert.equal((await readdir(path.join(f.runtime,'main-sessions'))).length,2);
 await readFile(path.join(f.runtime,'claude-sessions','restore_me.json'));
 await readFile(path.join(f.runtime,'input-queues','restore_me.json'));
 const staging=(await readdir(f.runtime)).find(n=>n.startsWith('.archive-delete-'));
 assert.ok(staging,'failed staging remains recoverable instead of being permanently removed');
 assert.ok(JSON.parse(await readFile(path.join(f.runtime,staging,'K-restore-manifest.json'),'utf8')).files.length===4);
});

test('a recycler that returns success without moving staging is not reported as deletion',async()=>{
 const f=await fixture();await f.add('still_here');
 const result=await deleteArchived({root:f.root,threadIds:['still_here'],confirmed:true,recycler:async()=>{}});
 assert.equal(result.deletedIds.length,0);assert.match(result.failed[0].error,/暫存仍在原位置/);
 await readFile(path.join(f.runtime,'main-sessions','still_here-1.json'));
});

test('batch returns clear per-thread results when one archived ID cannot be recycled',async()=>{
 const f=await fixture();await f.add('good');await f.add('bad');
 const result=await deleteArchived({root:f.root,threadIds:['good','bad'],confirmed:true,recycler:async bundle=>{
  if((await readdir(bundle)).some(name=>name.includes('bad')))throw Error('blocked by recycle bin');
  await rename(bundle,path.join(f.runtime,'test-recycle-'+(await readdir(f.runtime)).length));
 }});
 assert.deepEqual(result.deletedIds,['good']);assert.equal(result.failed.length,1);assert.equal(result.failed[0].threadId,'bad');
 assert.equal((await readdir(path.join(f.runtime,'main-sessions'))).length,1);
 await readFile(path.join(f.runtime,'main-sessions','bad-1.json'));
});

test('rejects a linked K storage directory before inspecting or moving data',async()=>{
 const f=await fixture();await f.add('linked');
 const actual=path.join(f.runtime,'main-sessions'),away=path.join(f.runtime,'sessions-away');
 await rename(actual,away);
 try{await symlink(away,actual,process.platform==='win32'?'junction':'dir');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code))return;throw error;}
 await assert.rejects(deleteArchived({root:f.root,threadIds:['linked'],confirmed:true,recycler:async()=>{}}),/拒絕非一般目錄/);
 assert.equal((await readdir(away)).length,1);
});
