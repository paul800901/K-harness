import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {atomicWrite} from '../src/atomic-write.mjs';
const save=(root,record)=>atomicWrite(path.join(root,'one.json'),JSON.stringify(record));

for(const code of ['EPERM','EACCES','EBUSY'])test(`metadata replacement retries transient ${code} without rewriting the snapshot`,async t=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'rename-transient-')),record={threadId:'one',model:'gpt-6-luna'};
 const target=await save(root,{...record,title:'old'}),old=await readFile(target,'utf8');
 const original=fs.rename,attempts=[];let snapshot;
 const mock=t.mock.method(fs,'rename',async(from,to)=>{
  if(to!==target)return original(from,to);
  attempts.push(from);const current=await readFile(from,'utf8');snapshot??=current;assert.equal(current,snapshot);
  assert.equal(await readFile(target,'utf8'),old);
  if(attempts.length<3)throw Object.assign(new Error('temporary reader holds target'),{code});
  return original(from,to);
 });
 syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 assert.equal(await save(root,{...record,title:'new'}),target);
 assert.equal(attempts.length,3);assert.equal(new Set(attempts).size,1);
 assert.equal(JSON.parse(await readFile(target,'utf8')).title,'new');
 assert.deepEqual(await readdir(path.dirname(target)),['one.json']);
});

test('metadata replacement stops after bounded lock retries and a later save still works',async t=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'rename-exhausted-')),record={threadId:'one',model:'gpt-6-luna'};
 const target=await save(root,{...record,title:'old'}),old=await readFile(target,'utf8');
 const original=fs.rename,attempts=[],error=Object.assign(new Error('target remains locked'),{code:'EPERM'});
 const mock=t.mock.method(fs,'rename',async(from,to)=>{if(to!==target)return original(from,to);attempts.push(from);throw error;});
 syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 await assert.rejects(save(root,{...record,title:'not committed'}),err=>err===error);
 assert.equal(attempts.length,21);assert.equal(new Set(attempts).size,1);
 assert.equal(await readFile(target,'utf8'),old);
 assert.equal(JSON.parse(await readFile(attempts[0],'utf8')).title,'not committed');
 mock.mock.restore();syncBuiltinESMExports();
 await save(root,{...record,title:'after lock released'});
 assert.equal(JSON.parse(await readFile(target,'utf8')).title,'after lock released');
});

test('metadata replacement propagates non-lock errors immediately and preserves the old record',async t=>{
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'rename-error-')),record={threadId:'one',model:'gpt-6-luna'};
 const target=await save(root,{...record,title:'old'}),old=await readFile(target,'utf8');
 const original=fs.rename,error=Object.assign(new Error('storage failure'),{code:'EIO'});let attempts=0;
 const mock=t.mock.method(fs,'rename',async(from,to)=>{if(to!==target)return original(from,to);attempts++;throw error;});
 syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 await assert.rejects(save(root,{...record,title:'not committed'}),err=>err===error);
 assert.equal(attempts,1);assert.equal(await readFile(target,'utf8'),old);
});
