import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, link } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createModelRuntime } from '../src/runtime.mjs';
import { createCodingTools, normalizeCoding } from '../src/coding.mjs';
import { MAX_TEXT_BYTES } from '../src/files.mjs';
import { runWorker, readTranscript } from '../src/worker.mjs';

const testRoot = fileURLToPath(new URL('../.runtime/tests/', import.meta.url));
await mkdir(testRoot, { recursive: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No network in offline coding tests.'); };
test.after(() => { globalThis.fetch = originalFetch; });
const broken = 'export const add = (a, b) => a - b;\n';
const fixed = 'export const add = (a, b) => a + b;\n';
const assertions = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './code.mjs';\ntest('addition', () => assert.equal(add(2, 3), 5));\n";
async function fixture({ code = broken, tests = assertions } = {}) {
  const directory = await mkdtemp(path.join(testRoot, 'coding-'));
  const workspace = path.join(directory, 'workspace');
  const jobDirectory = path.join(directory, 'evidence');
  await mkdir(workspace); await mkdir(jobDirectory);
  await writeFile(path.join(workspace, 'code.mjs'), code, { flag: 'wx' });
  await writeFile(path.join(workspace, 'checks.mjs'), tests, { flag: 'wx' });
  const readFiles = ['code.mjs', 'checks.mjs'];
  const coding = normalizeCoding({ editFiles: ['code.mjs'] }, readFiles, []);
  const tools = await createCodingTools(workspace, coding, readFiles, jobDirectory);
  return { directory, workspace, jobDirectory, readFiles, coding, tools, patch: tools[0] };
}

test('actual Pi coding loop edits approved code and retains preimage for parent validation',async()=>{
 const f=await fixture(),runtime=await createModelRuntime();
 const faux=fauxProvider({provider:'k-code-offline',models:[{id:'scripted',reasoning:false}]});
 faux.setResponses([fauxAssistantMessage(fauxToolCall('read_input',{path:'code.mjs'})),fauxAssistantMessage(fauxToolCall('replace_code',{path:'code.mjs',expectedText:broken,newText:fixed})),fauxAssistantMessage('已修正，待主代理跑測試驗收。')]);
 runtime.registerNativeProvider(faux.provider);
 const options={task:'Fix addition.',workspace:f.workspace,readFiles:f.readFiles,coding:f.coding,modelRuntime:runtime,model:faux.getModel(),stateDir:path.join(f.directory,'jobs'),jobId:'one-code-job'};
 const result=await runWorker(options);assert.equal(result.status,'completed',result.error);assert.equal(result.toolCalls,2);assert.equal(result.toolErrors,0);
 assert.equal(await readFile(path.join(f.workspace,'code.mjs'),'utf8'),fixed);assert.equal(await readFile(path.join(f.workspace,'checks.mjs'),'utf8'),assertions);
 const [backup]=await readdir(path.join(result.directory,'edits'));assert.equal(await readFile(path.join(result.directory,'edits',backup,'before.txt'),'utf8'),broken);
 assert.equal((await readTranscript(result.directory)).some(e=>e.message?.toolName==='run_tests'),false);
 await assert.rejects(runWorker(options),{code:'EEXIST'});assert.equal(faux.state.callCount,3);
});

test('edits reject unlisted files, stale preimages, no-ops and oversized code without changing originals', async () => {
  const f = await fixture();
  for (const [args, pattern] of [
    [{ path: 'checks.mjs', expectedText: assertions, newText: '' }, /not authorized/],
    [{ path: '../code.mjs', expectedText: broken, newText: fixed }, /not authorized/],
    [{ path: 'code.mjs', expectedText: 'old content', newText: fixed }, /stale/],
    [{ path: 'code.mjs', expectedText: broken, newText: broken }, /No code change/],
    [{ path: 'code.mjs', expectedText: broken, newText: 'x'.repeat(MAX_TEXT_BYTES + 1) }, /size limit/],
  ]) await assert.rejects(f.patch.execute('test', args), pattern);
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), broken);
  assert.equal(await readFile(path.join(f.workspace, 'checks.mjs'), 'utf8'), assertions);
  assert.deepEqual(await readdir(f.jobDirectory), []);
});

test('UTF-8/CRLF preimages are exact and shortening writes truncate correctly', async () => {
  const before = '// 正體中文\r\nexport const text = "long value";\r\n';
  const after = '// 臺灣\n';
  const f = await fixture({ code: before });
  await assert.rejects(f.patch.execute('test', { path: 'code.mjs', expectedText: before.replaceAll('\r\n', '\n'), newText: after }), /stale/);
  const result = await f.patch.execute('test', { path: 'code.mjs', expectedText: before, newText: after });
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), after);
  assert.equal(await readFile(path.join(f.jobDirectory, result.details.backup, 'before.txt'), 'utf8'), before);
});

test('a unique fragment preserves unmatched text and trailing newline; ambiguous fragments are rejected', async () => {
  const f = await fixture();
  await f.patch.execute('test', { path: 'code.mjs', expectedText: broken.trimEnd(), newText: fixed.trimEnd() });
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), fixed);
  await assert.rejects(f.patch.execute('test', { path: 'code.mjs', expectedText: 'a', newText: 'other' }), /ambiguous/);
  await assert.rejects(f.patch.execute('test', { path: 'code.mjs', expectedText: '', newText: 'other' }), /No code change/);
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), fixed);
});

test('policy rejects missing read grants and hard links',async()=>{
 const f=await fixture();assert.throws(()=>normalizeCoding(f.coding,[],[]),/approved input/);
 await link(path.join(f.workspace,'code.mjs'),path.join(f.directory,'hardlink.mjs'));
 await assert.rejects(createCodingTools(f.workspace,f.coding,f.readFiles,f.jobDirectory),/hard-linked/);
});

test('cancellation before a patch leaves code unchanged and creates no backup', async () => {
  const f = await fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.patch.execute('test', { path: 'code.mjs', expectedText: broken, newText: fixed }, controller.signal), { name: 'AbortError' });
  assert.equal(await readFile(path.join(f.workspace, 'code.mjs'), 'utf8'), broken);
  assert.deepEqual(await readdir(f.jobDirectory), []);
});
