import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHistoryTools, normalizeHistory } from '../src/history.mjs';
const base = fileURLToPath(new URL('../.runtime/tests/', import.meta.url));
await mkdir(base, { recursive: true });
async function fixture() {
  const root = await mkdtemp(path.join(base, 'history-'));
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  const jobs = path.join(root, 'jobs'); await mkdir(jobs);
  await mkdir(path.join(jobs, 'old'));
  const job = { version: 1, workspace, task: 'title OLD', startedAt: '2026-01-01', sessionFile: 'session.jsonl' };
  await writeFile(path.join(jobs, 'old/job.json'), JSON.stringify(job));
  await writeFile(path.join(jobs, 'old/session.jsonl'), JSON.stringify({type:'message', timestamp:'2026-01-02',message:{role:'toolResult',toolName:'read_input',content:[{type:'text',text:'Approved update: title NEW'}]}}));
  return { root, workspace, jobs, job };
}
test('history returns provenance, preserves conflicts and reports no match without guesses', async () => {
  const f=await fixture(); const [tool]=await createHistoryTools(f.workspace,f.jobs,['old']);
  const result=(await tool.execute('x',{query:'title'})).details;
  assert.equal(result.totalMatches,2); assert.equal(result.results[0].role,'submitted-task');
  assert.equal(result.results[1].toolName,'read_input'); assert.equal(result.results[1].source,'line:1');
  assert.equal((await tool.execute('x',{query:'NONEXISTENT'})).details.totalMatches,0);
  await assert.rejects(()=>tool.execute('x',{query:''}));
  assert.deepEqual(await createHistoryTools(f.workspace,f.jobs,[]),[]);
});
test('history denies unknown IDs, traversal, cross-workspace and symlink records', async () => {
  const f=await fixture(); assert.throws(()=>normalizeHistory(['../old']));
  await assert.rejects(()=>createHistoryTools(f.workspace,f.jobs,['unknown']));
  await assert.rejects(()=>createHistoryTools(f.root,f.jobs,['old']),/mismatch/);
  await symlink(path.join(f.jobs,'old'),path.join(f.jobs,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>createHistoryTools(f.workspace,f.jobs,['link']),/links|junctions/);
  f.job.sessionFile='../private.txt'; await writeFile(path.join(f.jobs,'old/job.json'),JSON.stringify(f.job));
  await assert.rejects(()=>createHistoryTools(f.workspace,f.jobs,['old']),/path/);
});
test('history paginates, marks truncated excerpts, and snapshots only approved records', async () => {
  const f=await fixture();
  await writeFile(path.join(f.jobs,'old/session.jsonl'),Array.from({length:7},(_,i)=>JSON.stringify({type:'message',message:{role:'user',content:[{type:'text',text:`needle ${i} ${'x'.repeat(4500)}`}]}})).join('\n'));
  const [tool]=await createHistoryTools(f.workspace,f.jobs,['old']);
  await writeFile(path.join(f.jobs,'old/session.jsonl'),'corrupt later change');
  const a=(await tool.execute('x',{query:'needle'})).details;
  assert.equal(a.results.length,5);assert.equal(a.nextOffset,5);assert.equal(a.results[0].truncated,true);
  const b=(await tool.execute('x',{query:'needle',offset:a.nextOffset})).details;
  assert.equal(b.results.length,2);assert.equal(b.nextOffset,null);
});
