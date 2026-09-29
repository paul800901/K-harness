import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {isolatedAgentEnvironment, parseSandboxiePids, createSandboxieBoxControl} from '../src/sandboxie-control.mjs';

test('isolated environment never inherits owner auth or injection settings', () => {
  const home=path.resolve('.runtime/fake-home');
  const env=isolatedAgentEnvironment({home,source:{Path:'tools',SystemRoot:'OS',HOME:'owner',CODEX_HOME:'owner-codex',
    ANTHROPIC_API_KEY:'fake',DEEPSEEK_API_KEY:'fake',K_TOKEN:'fake',NODE_OPTIONS:'--require bad',CLAUDE_CONFIG_DIR:'owner-claude'}});
  assert.equal(env.PATH,'tools');assert.equal(env.HOME,home);assert.equal(env.CODEX_HOME,path.join(home,'.codex'));
  assert.equal(env.CLAUDE_CONFIG_DIR,path.join(home,'.claude'));
  assert.equal(JSON.stringify(env).includes('fake"'),false);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.K_TOKEN,undefined);
  assert.throws(()=>isolatedAgentEnvironment({home:'relative'}),/absolute/);
});

test('box readback requires complete valid PID list, not empty/malformed output', () => {
  assert.deepEqual(parseSandboxiePids('0\r\n'),[]);assert.deepEqual(parseSandboxiePids('2\r\n123\r\n456\r\n'),[123,456]);
  for (const text of ['', '1', '0\n123','2\n123\n123','1\n0','1\n9x','hello','1\n9007199254740993']) assert.throws(()=>parseSandboxiePids(text));
});

test('shutdown terminates only dedicated box and reads back until empty', async () => {
  const calls=[];let reads=0;
  const control=createSandboxieBoxControl({startExe:path.resolve('Start.exe'),boxName:'KFake',pollMs:1,
    captureImpl:async(exe,args)=>{calls.push(args);return {stdout:args[1]==='/listpids'?(++reads===1?'1\n123\n':'0\n'):''};}});
  assert.deepEqual(await control.stopBox(),{confirmed:true});
  assert.deepEqual(calls,[['/box:KFake','/terminate'],['/box:KFake','/listpids'],['/box:KFake','/listpids']]);
  await control.assertIdle();
});

test('shutdown and occupied box fail closed on unconfirmed or erroneous state', async () => {
  const opts={startExe:path.resolve('Start.exe'),boxName:'KFake',timeoutMs:2,pollMs:1};
  const busy=createSandboxieBoxControl({...opts,captureImpl:async()=>({stdout:'1\n123\n'})});
  await assert.rejects(busy.assertIdle(),/active/);await assert.rejects(busy.stopBox(),/not confirmed/);
  const broken=createSandboxieBoxControl({...opts,captureImpl:async()=>{throw new Error('service unavailable');}});
  await assert.rejects(broken.stopBox(),/service unavailable/);
  assert.throws(()=>createSandboxieBoxControl({...opts,boxName:'DefaultBox'}),/dedicated/);
  assert.throws(()=>createSandboxieBoxControl({...opts,boxName:'KFake /terminate_all'}),/dedicated/);
});
