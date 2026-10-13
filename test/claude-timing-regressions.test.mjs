// Regressions for the 2026-10-14 Claude-path timing audit (docs/k-audit-20261014.md). Each test is a
// reproduction that failed before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {listMainSessions} from '../src/main-sessions.mjs';
import {claudeTimingFixture as fixture, tick, settledWithin} from './fixtures/claude-timing-fixture.mjs';

const recordOf = async (f, threadId) =>
  JSON.parse(await fs.readFile(path.join(f.root, '.runtime/claude-sessions', threadId + '.json'), 'utf8'));
const mainTitle = async (f, threadId) =>
  (await listMainSessions(f.root)).sessions.find(s => s.threadId === threadId).title;

test('a rename is not reverted by a background save queued while it is being written', async () => {
  const f = await fixture();
  const {threadId} = await f.controller.open({});
  await f.controller.send({text: 'first question'});
  f.hostOptions.onMessage({type: 'result', is_error: false});
  await f.controller.close();
  await f.controller.open({threadId});
  await f.controller.send({text: 'second question'});
  const rename = f.controller.metadata({threadId, title: 'renamed'});
  f.hostOptions.onMessage({type: 'result', is_error: false}); // queues saveCurrent() behind the rename
  await rename;
  await f.controller.close();
  assert.equal(f.controller.state.title, 'renamed');
  assert.equal((await recordOf(f, threadId)).title, 'renamed');
  assert.equal(await mainTitle(f, threadId), 'renamed');
});

test('late events from an interrupted turn cannot revive a room whose stop was not confirmed', async () => {
  const f = await fixture({
    bridgeOverrides: {
      async wait() {
        return {settled: false};
      },
      async inspect() {
        return {settled: false};
      }
    }
  });
  await f.controller.open({});
  await f.controller.send({text: 'work'});
  await f.gatewayOptions.bridge.start({requestId: 'w1', model: 'gpt-5', task: 't'});
  f.bridge.records = [{requestId: 'w1', settled: false, parentId: f.controller.state.threadId}];
  await assert.rejects(f.controller.stop());
  assert.equal(f.controller.state.status, 'uncertain');
  f.hostOptions.onMessage({type: 'system', subtype: 'status', status: 'requesting'});
  f.hostOptions.onMessage({type: 'result', is_error: false});
  assert.equal(f.controller.state.status, 'uncertain');
  assert.equal(f.controller.state.busy, false);
  await assert.rejects(f.controller.send({text: 'again'}));
  assert.equal(f.host.startCalls.length, 1);
});

test('a host that exits during open is not reported ready, and a send to it is known unsent', async () => {
  const f = await fixture({
    afterHost: host => {
      host.resolveClosed();
      host.start = async () => {
        throw Object.assign(new Error('Claude Code host is closed.'), {notSent: true});
      };
    }
  });
  await assert.rejects(f.controller.open({}), /開啟過程中已結束/);
  assert.notEqual(f.controller.state.status, 'ready');
  await f.controller.close().catch(() => {});
});

test('a send rejected before reaching Claude Code leaves no phantom queued message', async () => {
  const f = await fixture();
  const {threadId} = await f.controller.open({});
  await assert.rejects(f.controller.send({text: 'with bad attachment', attachmentIds: ['nope']}), error => {
    assert.equal(error.notSent, true);
    return true;
  });
  assert.deepEqual(f.controller.state.messages, []);
  assert.equal(f.controller.state.status, 'ready');
  f.hostOptions.onMessage({type: 'system', subtype: 'compact_boundary', uuid: 'cb1', session_id: threadId.slice(7)});
  await f.controller.close();
  assert.deepEqual((await recordOf(f, threadId)).messages, []);
});

test('switching permission mode cannot overwrite a rename made meanwhile, even if the restart fails', async () => {
  let hostCalls = 0;
  const f = await fixture({
    waitForHost: async () => {
      if (++hostCalls === 3) throw new Error('restart failed (simulated)');
    }
  });
  const {threadId} = await f.controller.open({});
  await f.controller.send({text: 'first question'});
  f.hostOptions.onMessage({type: 'result', is_error: false});
  await f.controller.close();
  await f.controller.open({threadId});
  const file = path.resolve(f.root, '.runtime/claude-sessions', threadId + '.json');
  const originalRename = fs.rename;
  let release,
    seen = false;
  const stall = new Promise(resolve => {
    release = resolve;
  });
  fs.rename = async (from, to) => {
    if (!seen && path.resolve(to) === file) {
      seen = true;
      await stall;
    }
    return originalRename(from, to);
  };
  syncBuiltinESMExports();
  try {
    const sending = f.controller.send({text: 'second question', accessMode: 'claude-acceptEdits'});
    while (!seen) await new Promise(resolve => setTimeout(resolve, 5));
    const renaming = f.controller.metadata({threadId, title: 'renamed'});
    await new Promise(resolve => setTimeout(resolve, 50));
    release();
    await assert.rejects(sending, /restart failed/);
    await renaming;
  } finally {
    fs.rename = originalRename;
    syncBuiltinESMExports();
  }
  assert.equal((await recordOf(f, threadId)).title, 'renamed');
  assert.equal(await mainTitle(f, threadId), 'renamed');
});

test('changing model restarts the host without reporting an interruption', async () => {
  const seen = [];
  const models = [
    {model: 'claude-opus-5-5', displayName: 'A', supportedReasoningEfforts: [{reasoningEffort: 'high'}]},
    {model: 'claude-b', displayName: 'B', supportedReasoningEfforts: []}
  ];
  const f = await fixture({models, onChange: s => seen.push(s.status)});
  const {threadId} = await f.controller.open({model: 'claude-opus-5-5'});
  await f.controller.send({text: 'q'});
  f.hostOptions.onMessage({type: 'result', is_error: false});
  seen.length = 0;
  await f.controller.selectModel({threadId, model: 'claude-b'});
  assert.equal(seen.includes('offline'), false, seen.join(' > '));
  assert.equal(f.controller.state.status, 'ready');
  await f.controller.close();
});

test('close() during open cancels it, closes the new host and refuses later sends', async () => {
  let release, entered;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const started = new Promise(resolve => {
    entered = resolve;
  });
  const f = await fixture({
    waitForHost: async () => {
      entered();
      await gate;
    }
  });
  const opening = f.controller.open({});
  await started;
  const closing = f.controller.close();
  await tick();
  release();
  await assert.rejects(opening);
  await closing;
  assert.equal(f.controller.state.status, 'offline');
  assert.equal(await settledWithin(f.host.closed), true, 'the host created during open must be closed');
  await assert.rejects(f.controller.send({text: 'after close'}));
  assert.equal(f.host.startCalls.length, 0);
});
