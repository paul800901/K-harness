import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import {isExpectedFakeUpload} from '../scripts/browser-probe-permission.mjs';
const exec=promisify(execFile);

test('fake upload classification compares decoded Windows paths, not escaped JSON',()=>{
  const file='D:\\K-harness\\.runtime\\probe\\.env.local';
  const input=JSON.parse(JSON.stringify({paths:[file]}));
  assert.equal(isExpectedFakeUpload('mcp__k_browser__browser_file_upload',input,file),true);
  for(const invalid of [{paths:[file+'x']},{paths:[file,file]},{paths:file},{text:file},null])assert.equal(isExpectedFakeUpload('browser_file_upload',invalid,file),false);
  assert.equal(isExpectedFakeUpload('unrelated_browser_file_upload',input,file),false);
});

test('native approval probe defaults to a no-model, no-fixture dry run for each pending mode',async()=>{
  for(const mode of ['codex-manual','claude-manual','claude-auto']){
    const {stdout}=await exec(process.execPath,['scripts/browser-approval-probe.mjs',mode]);
    const plan=JSON.parse(stdout);
    assert.equal(plan.dryRun,true);
    assert.equal(plan.mode,mode);
    assert.match(plan.prompt,/ToolSearch/);
    assert.match(plan.prompt,/exactly one browser tool call/);
    assert.match(plan.prompt,/FAKE_NOT_A_KEY/);
    await assert.rejects(access(plan.workspace),{code:'ENOENT'});
  }
});

test('native approval probe rejects unspecified modes without starting a host',async()=>{
  await assert.rejects(exec(process.execPath,['scripts/browser-approval-probe.mjs']),error=>error.code===2&&error.stderr.includes('Usage:'));
});
