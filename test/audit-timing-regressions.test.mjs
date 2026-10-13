// Regressions for the 2026-10-14 worker / browser / server timing audit (docs/k-audit-20261014.md).
// Each test is a reproduction that failed before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {createGeminiAccounts} from '../src/gemini-accounts.mjs';
import {createLunaBridge} from '../src/luna-bridge.mjs';
import {createBrowserLiveSession} from '../src/browser-live-session.mjs';
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

test('a tab stuck in alert() does not hang browser state or human actions', async () => {
  const makePage = (url, hang = false) => ({
    url: () => url,
    isClosed: () => false,
    on() {},
    evaluate: () => (hang ? new Promise(() => {}) : Promise.resolve('title of ' + url)),
    reload: async () => {},
    close: async () => {},
    viewportSize: () => ({width: 1024, height: 768})
  });
  const pages = [makePage('https://a.example/'), makePage('https://b.example/alert', true)];
  const context = {
    pages: () => pages,
    on() {},
    newPage: async () => {
      const page = makePage('about:blank');
      pages.push(page);
      return page;
    },
    newCDPSession: async () => ({send: async () => ({currentIndex: 0, entries: [{}]}), detach: async () => {}}),
    close: async () => {}
  };
  const dir = await mkdtemp(path.join(scratchBase, 'audit-browser-'));
  const live = await createBrowserLiveSession(dir, {
    launchContext: async () => context,
    downloadDirectory: path.join(dir, 'dl')
  });
  await live.contextGetter();
  const within = (promise, ms) => Promise.race([promise.then(() => true), sleep(ms).then(() => false)]);
  assert.equal(await within(live.humanRequest('/state'), 4000), true, 'state read must not hang');
  assert.equal(await within(live.humanRequest('/action', {type: 'newPage'}), 4000), true, 'actions must not hang');
  await live.close?.();
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
