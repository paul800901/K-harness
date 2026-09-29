import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,utimes,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';

for(const code of ['EPERM','EACCES','EBUSY'])test(`metadata replacement retries transient ${code} without rewriting the snapshot`,async t=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'rename-transient-')),record={threadId:'one',model:'gpt-6-luna'};
 const target=await saveMainSession(root,{...record,title:'old'}),old=await readFile(target,'utf8');
 const original=fs.rename,attempts=[];let snapshot;
 const mock=t.mock.method(fs,'rename',async(from,to)=>{
  if(to!==target)return original(from,to);
  attempts.push(from);const current=await readFile(from,'utf8');snapshot??=current;assert.equal(current,snapshot);
  assert.equal(await readFile(target,'utf8'),old);
  if(attempts.length<3)throw Object.assign(new Error('temporary reader holds target'),{code});
  return original(from,to);
 });
 syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 assert.equal(await saveMainSession(root,{...record,title:'new'}),target);
 assert.equal(attempts.length,3);assert.equal(new Set(attempts).size,1);
 assert.equal(JSON.parse(await readFile(target,'utf8')).title,'new');
 assert.deepEqual(await readdir(path.dirname(target)),['one-current.json']);
});

test('metadata replacement stops after bounded lock retries and a later save still works',async t=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'rename-exhausted-')),record={threadId:'one',model:'gpt-6-luna'};
 const target=await saveMainSession(root,{...record,title:'old'}),old=await readFile(target,'utf8');
 const original=fs.rename,attempts=[],error=Object.assign(new Error('target remains locked'),{code:'EPERM'});
 const mock=t.mock.method(fs,'rename',async(from,to)=>{if(to!==target)return original(from,to);attempts.push(from);throw error;});
 syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 await assert.rejects(saveMainSession(root,{...record,title:'not committed'}),err=>err===error);
 assert.equal(attempts.length,21);assert.equal(new Set(attempts).size,1);
 assert.equal(await readFile(target,'utf8'),old);
 assert.equal(JSON.parse(await readFile(attempts[0],'utf8')).title,'not committed');
 mock.mock.restore();syncBuiltinESMExports();
 await saveMainSession(root,{...record,title:'after lock released'});
 assert.equal((await listMainSessions(root)).sessions[0].title,'after lock released');
});

test('metadata replacement propagates non-lock errors immediately and preserves the old record',async t=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'rename-error-')),record={threadId:'one',model:'gpt-6-luna'};
 const target=await saveMainSession(root,{...record,title:'old'}),old=await readFile(target,'utf8');
 const original=fs.rename,error=Object.assign(new Error('storage failure'),{code:'EIO'});let attempts=0;
 const mock=t.mock.method(fs,'rename',async(from,to)=>{if(to!==target)return original(from,to);attempts++;throw error;});
 syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 await assert.rejects(saveMainSession(root,{...record,title:'not committed'}),err=>err===error);
 assert.equal(attempts,1);assert.equal(await readFile(target,'utf8'),old);
});

test('1000 metadata saves coexist with continuous real listing of 150 conversations',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'rename-listing-')),record={threadId:'active',model:'gpt-6-luna'};
 const target=await saveMainSession(root,{...record,title:'initial'}),directory=path.dirname(target);
 for(let i=0;i<149;i++)await writeFile(path.join(directory,`other-${i}-legacy.json`),JSON.stringify({threadId:`other-${i}`,model:'gpt-6-luna',workspace:root,title:`unchanged-${i}`}));
 let stop=false,listings=0,readError;
 const reader=(async()=>{do{
  const result=await listMainSessions(root);assert.equal(result.unreadable,0);assert.equal(result.sessions.length,150);listings++;
 }while(!stop);})().catch(error=>{readError=error;});
 try{for(let i=0;i<1000;i++)await saveMainSession(root,{...record,title:`saved-${i}`});}
 finally{stop=true;await reader;}
 if(readError)throw readError;
 assert.ok(listings>1);assert.equal(JSON.parse(await readFile(target,'utf8')).title,'saved-999');
 assert.equal((await readdir(directory)).length,150);
 const result=await listMainSessions(root);assert.equal(result.unreadable,0);
 for(let i=0;i<149;i++)assert.equal(result.sessions.find(row=>row.threadId===`other-${i}`).title,`unchanged-${i}`);
});

test('metadata updates use one atomic file per conversation and concurrent calls retain call order',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'bounded-sessions-'));
 const record={threadId:'one',model:'gpt-6-luna'};
 await saveMainSession(root,{...record,parentThreadId:'parent',parentTitle:'Original',browserSessionKey:'keep-browser'});
 await Promise.all(Array.from({length:30},(_,i)=>saveMainSession(root,{...record,title:`title-${i}`})));
 const names=await readdir(path.join(root,'.runtime/main-sessions'));
 assert.deepEqual(names,['one-current.json']);
 const {sessions,unreadable}=await listMainSessions(root);
 assert.equal(unreadable,0);assert.equal(sessions[0].title,'title-29');
 assert.equal(sessions[0].parentThreadId,'parent');assert.equal(sessions[0].browserSessionKey,'keep-browser');
 await assert.rejects(saveMainSession(root,{...record,model:''}));
 await saveMainSession(root,{...record,title:'after failure'});
 assert.equal((await listMainSessions(root)).sessions[0].title,'after failure');
});

test('legacy snapshots stay intact and their lineage survives fixed-file updates',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'legacy-sessions-')),dir=path.join(root,'.runtime/main-sessions');await mkdir(dir,{recursive:true});
 const old=JSON.stringify({threadId:'legacy',model:'gpt-6-luna',workspace:root,title:'old',parentThreadId:'parent',parentTitle:'Original',browserSessionKey:'legacy-browser',saveOrder:1});
 const oldPath=path.join(dir,'legacy-1-snapshot.json');await writeFile(oldPath,old);await utimes(oldPath,new Date(0),new Date(0));
 await writeFile(path.join(dir,'other-broken.json'),'{invalid');
 await saveMainSession(root,{threadId:'legacy',model:'gpt-6-luna',title:'updated'});
 const one=await listMainSessions(root,{threadId:'legacy'});
 assert.equal(one.unreadable,0);assert.equal(one.sessions.length,1);
 assert.equal(one.sessions[0].title,'updated');assert.equal(one.sessions[0].parentThreadId,'parent');
 assert.equal(one.sessions[0].browserSessionKey,'legacy-browser');
 assert.equal(await readFile(oldPath,'utf8'),old);
 assert.equal((await listMainSessions(root)).unreadable,1);
});
test('Claude native permission modes survive common metadata readback without changing Codex modes',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'native-permissions-'));
 const modes=['manual','acceptEdits','auto','bypassPermissions','dontAsk','plan'];
 for(const mode of modes)await saveMainSession(root,{threadId:`claude-${mode}`,model:'claude-opus-5-5',accessMode:`claude-${mode}`});
 await saveMainSession(root,{threadId:'codex-mode',model:'gpt-6-luna',accessMode:'workspace-write'});
 const {sessions,unreadable}=await listMainSessions(root);
 assert.equal(unreadable,0);
 for(const mode of modes)assert.equal(sessions.find(s=>s.threadId===`claude-${mode}`).accessMode,`claude-${mode}`);
 assert.equal(sessions.find(s=>s.threadId==='codex-mode').accessMode,'workspace-write');
});
test('Claude metadata uses its own provider while legacy Codex records retain subscription identity',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'provider-sessions-'));
 const target=await saveMainSession(root,{threadId:'claude-example',model:'claude-opus-5-5'});
 const raw=JSON.parse(await readFile(target,'utf8'));
 assert.equal(raw.provider,'claude');assert.equal(raw.accountType,'claude.ai');
 await saveMainSession(root,{threadId:'codex-example',model:'gpt-6-luna'});
 const {sessions}=await listMainSessions(root);
 assert.equal(sessions.find(s=>s.threadId==='claude-example').provider,'claude');
 assert.equal(sessions.find(s=>s.threadId==='codex-example').provider,'codex');
});
test('saved main sessions survive reopen; listing deduplicates and preserves invalid records',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'sessions-'));
 assert.deepEqual(await listMainSessions(root),{sessions:[],unreadable:0});
 const workspace=path.join(root,'selected');await mkdir(workspace);
 const saved=await saveMainSession(root,{threadId:'thread-one',model:'gpt-5.6-terra',workspace});
 const record=JSON.parse(await readFile(saved,'utf8'));assert.equal(record.threadId,'thread-one');
 assert.equal(record.workspace,workspace);
 const dir=path.dirname(saved);
 const newer=path.join(dir,'newer.json');await writeFile(newer,JSON.stringify({...record,model:'gpt-5.6-sol'}));
 await utimes(newer,new Date('2030-01-01'),new Date('2030-01-01'));
 await writeFile(path.join(dir,'broken.json'),'{partial');
 await writeFile(path.join(dir,'foreign.json'),JSON.stringify({...record,model:'gpt-5.6-luna',workspace:path.parse(root).root}));
 const result=await listMainSessions(root);
 assert.equal(result.sessions.length,1);assert.equal(result.sessions[0].model,'gpt-5.6-sol');assert.equal(result.sessions[0].workspace,workspace);assert.equal(result.unreadable,2);
 assert.equal(await readFile(path.join(dir,'broken.json'),'utf8'),'{partial');
 await assert.rejects(saveMainSession(root,{threadId:'../escape',model:'gpt-6-astra'}));
});

test('saved sessions retain every legal picker model even when catalog state changes',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'all-model-sessions-'));
 for(const [index,model] of ['gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-5.3-codex-spark'].entries()){
  await saveMainSession(root,{threadId:`thread-${index}`,model});
 }
 const result=await listMainSessions(root);
 assert.deepEqual(new Set(result.sessions.map(item=>item.model)),new Set(['gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-5.3-codex-spark']));
});

test('user branch lineage survives subsequent ordinary metadata saves',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'branch-lineage-'));
 await saveMainSession(root,{threadId:'child',model:'gpt-6-sol',parentThreadId:'parent',parentTitle:'Original',branchType:'user'});
 await saveMainSession(root,{threadId:'child',model:'gpt-6-sol',title:'Renamed'});
 const child=(await listMainSessions(root)).sessions[0];assert.equal(child.parentThreadId,'parent');assert.equal(child.parentTitle,'Original');assert.equal(child.branchType,'user');assert.equal(child.title,'Renamed');
});

test('owner browser session key round-trips and survives ordinary metadata saves',async()=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'browser-session-key-'));
 await saveMainSession(root,{threadId:'browser-owned',model:'gpt-6-sol',browserSessionKey:'owner-session-01'});
 let session=(await listMainSessions(root)).sessions.find(item=>item.threadId==='browser-owned');
 assert.equal(session.browserSessionKey,'owner-session-01');
 await saveMainSession(root,{threadId:'browser-owned',model:'gpt-6-sol',title:'Updated title'});
 session=(await listMainSessions(root)).sessions.find(item=>item.threadId==='browser-owned');
 assert.equal(session.title,'Updated title');assert.equal(session.browserSessionKey,'owner-session-01');
});
