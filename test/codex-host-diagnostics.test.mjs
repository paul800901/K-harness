import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtemp,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createCodexHostDiagnostics,classifyCodexStderrLine} from '../src/codex-host-diagnostics.mjs';
import {openCodexHost} from '../src/codex-host.mjs';

const diagnosticsPath=home=>path.join(home,'k-diagnostics','codex-host.jsonl');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));

test('stderr is classified across fragments and only fixed safe categories are persisted',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-codex-diagnostics-'));
 const home=path.join(root,'codex-home');await mkdir(home,{recursive:true});
 const diagnostics=createCodexHostDiagnostics({home,pid:321,executable:'C:\\K\\codex.exe'});
 diagnostics.stderr(Buffer.from('SQLite: database is lo'));
 diagnostics.stderr(Buffer.from('cked; prompt=secret-token-should-not-appear\n'));
 diagnostics.stderr(Buffer.from('unknown raw message with bearer secret\n'));
 diagnostics.warning({method:'warning',params:{message:"Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics."}});
 await diagnostics.flush();
 const raw=await readFile(diagnosticsPath(home),'utf8');
 const rows=raw.trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.map(x=>x.kind),['sqlite_busy_or_locked','logs_write_warning']);
 assert.equal(rows[1].nativeFlushClassification,'unknown');
 assert.equal(rows[0].pid,321);assert.equal(rows[0].executable,'C:\\K\\codex.exe');assert.equal(rows[0].codexHome,path.resolve(home));
 assert.ok(rows.every(x=>!('message'in x)&&!('stderr'in x)));
 assert.doesNotMatch(raw,/secret|private SQL|prompt=/i);
 assert.equal(classifyCodexStderrLine('database or disk is full'),'sqlite_full');
 assert.equal(classifyCodexStderrLine('attempt to write a readonly database'),'sqlite_readonly');
 assert.equal(classifyCodexStderrLine('disk I/O error'),'sqlite_io');
 assert.equal(classifyCodexStderrLine('process starting normally'),null);
});

test('per-host entry and byte caps and global ring cap are enforced',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-codex-diagnostics-caps-'));
 const home=path.join(root,'codex-home');await mkdir(home,{recursive:true});
 const first=createCodexHostDiagnostics({home,pid:7,executable:'codex'});
 for(let i=0;i<1000;i++)first.stderr(Buffer.from('SQLite database error unknown\n'));
 await first.flush();
 const file=diagnosticsPath(home),firstContents=await readFile(file,'utf8');
 assert.ok((firstContents.match(/\n/g)||[]).length<=64);
 assert.ok(Buffer.byteLength(firstContents)<=8*1024);
 for(let host=0;host<40;host++){
  const diagnostics=createCodexHostDiagnostics({home,pid:100+host,executable:'codex'});
  for(let i=0;i<100;i++)diagnostics.stderr(Buffer.from('SQLite database error unknown\n'));
  await diagnostics.flush();
 }
 const contents=await readFile(file,'utf8');
 assert.ok((contents.match(/\n/g)||[]).length>64);
 assert.ok((await stat(file)).size<=256*1024);
 assert.ok(contents.trim().split('\n').every(line=>{try{JSON.parse(line);return true;}catch{return false;}}));
});

test('same-process hosts sharing CODEX_HOME retain records without temp-name collisions',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-codex-diagnostics-hosts-'));
 const home=path.join(root,'codex-home');await mkdir(home,{recursive:true});
 const hosts=[1,2].map(pid=>createCodexHostDiagnostics({home,pid,executable:'codex'}));
 hosts[0].warning({method:'warning',params:{message:"Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics."}});
 hosts[1].stderr(Buffer.from('SQLite database is locked\n'));
 await Promise.all(hosts.map(host=>host.flush()));
 const rows=(await readFile(diagnosticsPath(home),'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.map(row=>row.pid),[1,2]);
 assert.deepEqual(rows.map(row=>row.kind),['logs_write_warning','sqlite_busy_or_locked']);
});

test('Codex warning is still delivered to onEvent while diagnostics write failure is non-fatal',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-codex-host-event-'));
 const blockedHome=path.join(root,'not-a-directory');await writeFile(blockedHome,'fixture');
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=89;
 child.stdin=new Writable({write(_chunk,_encoding,callback){callback();},final(callback){callback();setImmediate(()=>child.emit('close',0,null));}});
 child.kill=()=>true;child.terminate=async()=>{};
 const events=[];
 const host=openCodexHost({executable:'codex',cwd:os.tmpdir(),env:{CODEX_HOME:blockedHome},onEvent:event=>events.push(event),spawnImpl:()=>child});
 const warning={method:'warning',params:{message:"Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics."}};
 child.stdout.write(JSON.stringify(warning)+'\n');
 await tick();
 assert.deepEqual(events,[warning]);
 await host.close();
});

test('stderr flood cannot consume the unique native warning budget and repeated warning is recorded once',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'k-codex-reserve-'));await mkdir(root,{recursive:true});
 const diagnostics=createCodexHostDiagnostics({home:root,pid:9,executable:'codex'});
 for(let i=0;i<1000;i++)diagnostics.stderr('SQLite database is locked\n');
 const warning={method:'warning',params:{message:"Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics."}};
 diagnostics.warning(warning);diagnostics.warning(warning);await diagnostics.flush();
 const rows=(await readFile(diagnosticsPath(root),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(rows.filter(r=>r.kind==='logs_write_warning').length,1);
 assert.equal(rows.at(-1).evidenceSource,'app_server_warning');
 assert.equal(rows[0].evidenceSource,'stderr_text_match');
});
