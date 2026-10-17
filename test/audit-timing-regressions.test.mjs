// Regressions for the 2026-10-14 worker / browser / server timing audit (docs/k-audit-20261014.md).
// Each test is a reproduction that failed before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {createGeminiAccounts} from '../src/gemini-accounts.mjs';
import {createLunaBridge} from '../src/luna-bridge.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {scratchBase} from './scratch.mjs';

const A = 'a'.repeat(32),
  B = 'b'.repeat(32);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fakeVault = (now, remainingPercent, resetsAt) => {
  let current = {accountId: A, email: 'a@x'};
  return {
    use(account) {
      current = account;
    },
    current: async () => ({...current}),
    capture: async () => ({...current}),
    activate: async id => (current = {accountId: id, email: id === A ? 'a@x' : 'b@x'}),
    prepareLogin: async () => ({previousAccountId: null}),
    assertIdle: async () => true,
    queryQuota: async id => ({
      accountId: id,
      auth: {status: 'authenticated', checkedAt: new Date(now - 1000).toISOString()},
      quota: {
        status: 'ready',
        checkedAt: new Date(now - 1000).toISOString(),
        windows: [
          {key: 'five_hour', remainingPercent, resetsAt},
          {key: 'seven_day', remainingPercent: 50, resetsAt: resetsAt + 86400}
        ]
      }
    })
  };
};

test('an unconfirmed worker stop stays unsettled when the account registry save fails', async () => {
  const now = Date.now();
  const root = await mkdtemp(path.join(scratchBase, 'audit-release-'));
  const accounts = createGeminiAccounts({
    root,
    login: {start: async () => {}},
    vault: fakeVault(now, 50, (now + 3600000) / 1000),
    enabled: true
  });
  await accounts.capture();
  const file = path.join(root, '.runtime', 'gemini-accounts.json');
  await rm(file);
  await mkdir(file); // the release save fails
  const workspace = path.join(root, 'ws');
  await mkdir(workspace, {recursive: true});
  const bridge = await createLunaBridge({
    root,
    workspace,
    parentId: 'parent',
    geminiOnly: true,
    geminiOptions: {accounts},
    geminiFactory: () => ({
      run: options =>
        accounts.run(
          {
            accountId: options.accountId,
            worker: true,
            parentId: options.parentId,
            requestId: options.requestId,
            onHandoff: options.onHandoff,
            handoffCurrent: options.handoffCurrent,
            signal: options.signal
          },
          async lease => {
            options.onAccount?.(lease);
            return {status: 'unresolved', settled: false, error: 'agy tree stop unconfirmed', outputFiles: []};
          }
        )
    })
  });
  await bridge.start({requestId: 'job', task: 'bounded', model: 'gemini-3.8-flash', effort: null});
  const result = await bridge.wait({requestId: 'job', timeoutMs: 2000});
  assert.equal(result.settled, false);
  assert.notEqual(result.status, 'failed');
  await assert.rejects(bridge.close(), 'a room must not close over a worker whose stop is unconfirmed');
});

test('an all-accounts-exhausted wait reaches the room with its reason and next recheck time', async () => {
  const now = Date.parse('2026-10-14T05:00:00Z'),
    reset = (now + 3 * 3600000) / 1000;
  const vault = fakeVault(now, 0, reset);
  const root = await mkdtemp(path.join(scratchBase, 'audit-exhausted-'));
  const accounts = createGeminiAccounts({
    root,
    login: {start: async () => {}},
    vault,
    enabled: true,
    clock: () => now,
    setTimer: () => 1,
    clearTimer: () => {}
  });
  await accounts.capture();
  vault.use({accountId: B, email: 'b@x'});
  await accounts.capture();
  await accounts.activate({accountId: A});
  const events = [];
  await assert.rejects(
    accounts.run(
      {worker: true, parentId: 'room', requestId: 'job-1', onHandoff: e => events.push(e), handoffCurrent: () => true},
      async () => {
        throw Error('must not run');
      }
    ),
    {code: 'GEMINI_ACCOUNTS_EXHAUSTED'}
  );
  await sleep(100);
  const last = events.at(-1);
  assert.equal(last.status, 'waiting');
  assert.equal(last.nextQueryAt, reset * 1000);
  assert.match(last.reason, /無可用額度/);
});

test('cancelling a Claude worker answers its pending approval and clears the waiting marker', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'audit-approval-'));
  const workspace = path.join(root, 'ws');
  await mkdir(workspace, {recursive: true});
  let decision;
  const bridge = await createLunaBridge({
    root,
    workspace,
    parentId: 'parent',
    geminiOnly: true,
    onRequest: () => new Promise(() => {}), // the human never answers
    claudeFactory: () => ({
      async run({signal, onPermission}) {
        decision = onPermission({toolName: 'Write', input: {file_path: 'a.txt'}});
        await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
        return {status: 'cancelled', settled: true, outputFiles: []};
      }
    })
  });
  await bridge.start({requestId: 'job', task: 'bounded', model: 'claude-opus-5-5', effort: 'high'});
  await sleep(50);
  assert.equal((await bridge.inspect({requestId: 'job'})).waitingForApproval, 1);
  const after = await bridge.cancel({requestId: 'job'});
  await sleep(50);
  assert.equal(after.settled, true);
  assert.equal((await bridge.inspect({requestId: 'job'})).waitingForApproval, undefined);
  assert.equal((await decision).behavior, 'deny');
  await bridge.close();
});

test('a settled worker whose last save failed recovers once the disk is healthy', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'audit-persist-'));
  const workspace = path.join(root, 'ws');
  await mkdir(workspace, {recursive: true});
  let release;
  const bridge = await createLunaBridge({
    root,
    workspace,
    parentId: 'parent',
    geminiOnly: true,
    geminiFactory: () => ({run: () => new Promise(resolve => (release = resolve))})
  });
  await bridge.start({requestId: 'job', task: 'bounded', model: 'gemini-3.8-flash', effort: null});
  await sleep(50);
  const file = path.join(root, '.runtime', 'luna-bridge', 'parent', 'job.json');
  await rm(file);
  await mkdir(file); // the final save fails
  release({status: 'completed', settled: true, output: 'done', outputFiles: []});
  await sleep(300);
  await rm(file, {recursive: true}); // disk healthy again
  assert.equal((await bridge.wait({requestId: 'job', timeoutMs: 0})).status, 'completed');
  assert.equal((await bridge.wait({requestId: 'job', timeoutMs: 0})).status, 'completed');
  await bridge.close();
});

test('a new event-stream client does not swallow a change other screens have not received yet', async () => {
  const root = await mkdtemp(path.join(scratchBase, 'audit-sse-'));
  const stubLogin = () => ({
    status: async () => ({}),
    progress: () => ({}),
    start: async () => ({}),
    cancel: async () => ({}),
    submitCode: async () => ({}),
    close: async () => {}
  });
  let onChange;
  const state = {threadId: 't1', status: 'ready', busy: false, messages: [], tools: []};
  const app = await startDesktop({
    root,
    executable: 'x',
    port: 0,
    controllerFactory: options => {
      onChange = options.onChange;
      return {
        concurrentConversations: true,
        historyVersion: 1,
        state,
        sessions: async () => ({sessions: []}),
        close: async () => {}
      };
    },
    claudeLoginFactory: stubLogin,
    codexLoginFactory: stubLogin,
    geminiLoginFactory: stubLogin,
    localDictationFactory: () => ({transcribe: async () => ({}), close: async () => {}})
  });
  const boot = await fetch(app.createLaunchUrl(), {redirect: 'manual'});
  const cookie = boot.headers.get('set-cookie').split(';')[0];
  const url = new URL('/api/events', app.origin);
  const connect = () =>
    new Promise(resolve => {
      const frames = [];
      const req = http.get({host: url.hostname, port: url.port, path: url.pathname, headers: {cookie}}, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => {
          for (const line of chunk.split('\n')) if (line.startsWith('data:')) frames.push(JSON.parse(line.slice(5)));
        });
        resolve({frames, req});
      });
    });
  const view = client => client.frames.reduce((s, e) => (e.type === 'snapshot' ? e.state : {...s, ...e.changes}), {});
  const first = await connect();
  await sleep(100);
  state.busy = true; // changed in place; onChange not yet called (as in send() before attachments load)
  const second = await connect();
  await sleep(50);
  onChange();
  await sleep(200);
  try {
    assert.equal(view(first).busy, true);
    assert.equal(view(second).busy, true);
  } finally {
    first.req.destroy();
    second.req.destroy();
    await app.close();
  }
});

// A desktop server with a stub controller whose state the test changes directly.
async function streamApp(options) {
  const root = await mkdtemp(path.join(scratchBase, 'audit-sse-slow-'));
  const stubLogin = () => ({
    status: async () => ({}),
    progress: () => ({}),
    start: async () => ({}),
    cancel: async () => ({}),
    submitCode: async () => ({}),
    close: async () => {}
  });
  let onChange;
  const state = {threadId: 't1', status: 'ready', busy: false, messages: [], tools: []};
  const app = await startDesktop({
    root,
    executable: 'x',
    port: 0,
    ...options,
    controllerFactory: options => {
      onChange = options.onChange;
      return {
        concurrentConversations: true,
        historyVersion: 1,
        state,
        sessions: async () => ({sessions: []}),
        close: async () => {}
      };
    },
    claudeLoginFactory: stubLogin,
    codexLoginFactory: stubLogin,
    geminiLoginFactory: stubLogin,
    localDictationFactory: () => ({transcribe: async () => ({}), close: async () => {}})
  });
  const boot = await fetch(app.createLaunchUrl(), {redirect: 'manual'});
  const cookie = boot.headers.get('set-cookie').split(';')[0];
  return {app, state, cookie, url: new URL('/api/events', app.origin), change: () => onChange()};
}

test('a screen that stops reading is disconnected instead of buffering events without bound', async () => {
  const {
    app,
    state,
    cookie,
    url,
    change: onChange
  } = await streamApp({maxPendingEventBytes: 256 * 1024, maxBehindMs: 500});
  // A raw socket that never reads models a stalled phone: the TCP window fills and the server's buffer grows.
  const stalled = net.connect(Number(url.port), url.hostname);
  stalled.on('error', () => {});
  await new Promise(resolve => stalled.once('connect', resolve));
  stalled.write(`GET /api/events HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${cookie}\r\n\r\n`);
  stalled.pause();
  let frames = 0;
  const healthy = await new Promise(resolve => {
    const req = http.get({host: url.hostname, port: url.port, path: url.pathname, headers: {cookie}}, res => {
      res.on('data', () => frames++);
      resolve(req);
    });
  });
  try {
    await sleep(100);
    for (let i = 0; i < 40; i++) {
      state.note = `${i}`.padEnd(1024 * 1024, 'x');
      onChange();
      await sleep(80);
    }
    // Reading now drains what was sent before the server gave up on this screen, then reaches the close.
    let head = '';
    stalled.on('data', chunk => {
      if (head.length < 64) head += chunk.toString('latin1');
    });
    const closed = new Promise(resolve => stalled.once('close', () => resolve(true)));
    stalled.resume();
    assert.equal(await Promise.race([closed, sleep(3000).then(() => false)]), true, 'the stalled screen was cut off');
    assert.match(head, /^HTTP\/1\.1 200/, 'the stalled screen had a live event stream');
    assert.equal(healthy.destroyed, false, 'a screen that keeps reading stays connected');
    assert.ok(frames > 1);
  } finally {
    stalled.destroy();
    healthy.destroy();
    await app.close();
  }
});

test('a screen briefly behind by more than the limit is not cut off once it catches up', async () => {
  const {app, state, cookie, url, change} = await streamApp({maxPendingEventBytes: 256 * 1024, maxBehindMs: 3000});
  // A raw socket so that pausing really stops reading, as a browser busy parsing a big update does.
  const screen = net.connect(Number(url.port), url.hostname);
  screen.on('error', () => {});
  await new Promise(resolve => screen.once('connect', resolve));
  let received = '',
    closed = false;
  screen.on('data', chunk => (received = (received + chunk.toString('latin1')).slice(-4096)));
  screen.once('close', () => (closed = true));
  screen.write(`GET /api/events HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${cookie}\r\n\r\n`);
  try {
    await sleep(100);
    screen.pause();
    // A big update is still on its way while later ones queue behind it, past the limit for a moment.
    state.note = 'big'.padEnd(32 * 1024 * 1024, 'x');
    change();
    await sleep(100);
    for (let i = 0; i < 8; i++) {
      state.note = `mid-${i}`.padEnd(200 * 1024, 'x');
      change();
      await sleep(100);
    }
    state.note = 'small-4';
    change();
    await sleep(100);
    screen.resume();
    while (!received.includes('small-4') && !closed) await sleep(20);
    assert.equal(closed, false, 'the screen kept its connection');
  } finally {
    screen.destroy();
    await app.close();
  }
});
