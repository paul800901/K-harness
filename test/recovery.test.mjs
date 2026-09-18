import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRecovery } from '../src/recovery.mjs';

const base = fileURLToPath(new URL('../.runtime/tests/', import.meta.url));
await mkdir(base, { recursive: true });
async function fixture() {
  const directory = await mkdtemp(path.join(base, 'recovery-'));
  const workspace = path.join(directory, 'workspace'); await mkdir(workspace);
  await writeFile(path.join(workspace, 'checkpoint.json'), '{"accepted":false}\n', { flag: 'wx' });
  const job = { version:1, directory, workspace, status:'running', task:'Preserve duplicates; do not invent owners; create checkpoint then report.',
    readFiles:[], outputFiles:['checkpoint.json','report.md'], sessionFile:null, output:'', provider:'test',model:'test' };
  await writeFile(path.join(directory, 'job.json'), JSON.stringify(job), { flag:'wx' });
  return { directory, workspace, job };
}
test('recovery reports unconfirmed present files and missing outputs without assuming acceptance or replaying', async () => {
  const f = await fixture(); const before = await readFile(path.join(f.directory,'job.json'));
  const report = await inspectRecovery(f.directory);
  assert.equal(report.status,'unresolved'); assert.equal(report.recovery,'inspection-only');
  assert.equal(report.originalTask,f.job.task); assert.equal(report.acceptance,'not-reviewed');
  assert.equal(report.files[0].observation,'present'); assert.equal(report.files[0].recordedSuccessfulWrite,false);
  assert.equal(report.files[1].observation,'missing');
  assert.deepEqual(await readFile(path.join(f.directory,'job.json')),before);
  assert.equal(await readFile(path.join(f.workspace,'checkpoint.json'),'utf8'),'{"accepted":false}\n');
});
test('recorded write success remains distinct from current artifact presence', async () => {
  const f = await fixture();
  f.job.sessionFile='session.jsonl';
  await writeFile(path.join(f.directory,'session.jsonl'),JSON.stringify({type:'message',message:{role:'toolResult',toolName:'write_output',isError:false,details:{path:'report.md'}}})+'\n',{flag:'wx'});
  await writeFile(path.join(f.directory,'job.json'),JSON.stringify(f.job));
  const result=await inspectRecovery(f.directory);
  assert.equal(result.files[1].recordedSuccessfulWrite,true);assert.equal(result.files[1].observation,'missing');
});
test('unavailable or escaped paths are not read and do not masquerade as missing outputs', async () => {
  const f=await fixture();
  const outside=path.join(f.directory,'outside');await mkdir(outside);
  await symlink(outside,path.join(f.workspace,'escape'),process.platform==='win32'?'junction':'dir');
  f.job.outputFiles=['../private.txt','escape/private.txt'];
  await writeFile(path.join(f.directory,'job.json'),JSON.stringify(f.job));
  const result=await inspectRecovery(f.directory);
  assert.ok(result.files.every(file=>file.observation==='unavailable'));
});
