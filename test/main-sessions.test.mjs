import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,utimes} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';
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
