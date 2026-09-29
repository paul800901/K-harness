import test from 'node:test';
import assert from 'node:assert/strict';

import { restrictedBrowserTransport } from '../src/browser-mcp-stdio.mjs';

function harness(liveSession = null) {
  const forwarded = [];
  const sent = [];
  const raw = {
    onmessage: null,
    async start() {},
    async send(message) { sent.push(message); },
    async close() {},
    async receive(message) { return this.onmessage(message); },
  };
  const transport = restrictedBrowserTransport(raw, process.cwd(), liveSession);
  transport.onmessage = message => forwarded.push(message);
  return { raw, transport, forwarded, sent };
}

function navigate(id, url = 'data:text/html,<title>fake</title>') {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'browser_navigate', arguments: { url } },
  };
}

function response(id, text = 'Tab selected.') {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
}

test('data navigation opens a new page, forwards select with the original id, and explains the preserved page', async () => {
  const calls = [];
  const live = {
    beginAiCall: () => true,
    endAiCall: () => calls.push('end'),
    openDataPage: async url => { calls.push(['open', url]); return 3; },
  };
  const h = harness(live);
  await h.transport.start();
  const original = navigate(41);

  await h.raw.receive(original);

  assert.deepEqual(calls, [['open', 'data:text/html,<title>fake</title>']]);
  assert.deepEqual(h.forwarded, [{
    jsonrpc: '2.0',
    id: 41,
    method: 'tools/call',
    params: { name: 'browser_tabs', arguments: { action: 'select', index: 3 } },
  }]);
  await h.transport.send(response(41));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].id, 41);
  assert.match(h.sent[0].result.content[0].text, /data URL was opened in a new tab/);
  assert.match(h.sent[0].result.content[0].text, /previous tab is unchanged/);
  assert.equal(h.sent[0].result.content[1].text, 'Tab selected.');
  assert.deepEqual(calls.at(-1), 'end');
});

test('ordinary HTTP navigation is forwarded unchanged and does not create a data page', async () => {
  let openCalls = 0;
  const h = harness({
    beginAiCall: () => true,
    endAiCall() {},
    async openDataPage() { openCalls++; return 2; },
  });
  await h.transport.start();
  const original = navigate(42, 'http://127.0.0.1:4321/fake');

  await h.raw.receive(original);

  assert.deepEqual(h.forwarded, [original]);
  assert.equal(openCalls, 0);
});

test('native browser context returning null keeps data navigation on the original MCP tool', async () => {
  let openCalls = 0;
  const h = harness({
    beginAiCall: () => true,
    endAiCall() {},
    async openDataPage() { openCalls++; return null; },
  });
  await h.transport.start();
  const original = navigate(43);

  await h.raw.receive(original);

  assert.deepEqual(h.forwarded, [original]);
  assert.equal(openCalls, 1);
});

test('data page creation exception returns a tool error and releases the AI call', async () => {
  const calls = [];
  const h = harness({
    beginAiCall: () => true,
    endAiCall: () => calls.push('end'),
    async openDataPage() { throw new Error('new data page failed'); },
  });
  await h.transport.start();

  await h.raw.receive(navigate(44));

  assert.deepEqual(h.forwarded, []);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].id, 44);
  assert.equal(h.sent[0].result.isError, true);
  assert.match(h.sent[0].result.content[0].text, /new data page failed/);
  assert.deepEqual(calls, ['end']);
});

test('human-control rejection does not attempt to open a data page', async () => {
  let openCalls = 0;
  let endCalls = 0;
  const h = harness({
    beginAiCall: () => false,
    endAiCall: () => endCalls++,
    async openDataPage() { openCalls++; return 0; },
  });
  await h.transport.start();

  await h.raw.receive(navigate(45));

  assert.deepEqual(h.forwarded, []);
  assert.equal(openCalls, 0);
  assert.equal(endCalls, 0);
  assert.equal(h.sent[0].result.isError, true);
  assert.match(h.sent[0].result.content[0].text, /human-control mode/);
});

test('cancellation during data-page creation must not continue with tab selection', async () => {
  let resolvePage;
  let markOpenStarted;
  const openStarted = new Promise(resolve => { markOpenStarted = resolve; });
  let endCalls = 0;
  const h = harness({
    beginAiCall: () => true,
    endAiCall: () => endCalls++,
    failClosed: async () => {},
    openDataPage() {
      markOpenStarted();
      return new Promise(resolve => { resolvePage = resolve; });
    },
  });
  await h.transport.start();
  const pending = h.raw.receive(navigate(46));
  await openStarted;

  await h.raw.receive({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 46 },
  });
  await new Promise(resolve => setImmediate(resolve));
  resolvePage(5);
  await pending;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(
    h.forwarded.some(message => message.method === 'tools/call'),
    false,
    'cancelled data navigation must not select the new tab',
  );
  assert.equal(h.forwarded.some(message => message.method === 'notifications/cancelled'), true);
  assert.equal(endCalls, 1, 'the browser call lock is released after fail-closed cancellation');
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function cancelled(id) {
  return { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } };
}

function lockedSession({ pagePromise, failPromise, markOpenStarted, markFailStarted }) {
  let locked = false;
  let endCalls = 0;
  const live = {
    beginAiCall() { if (locked) return false; locked = true; return true; },
    endAiCall() { endCalls++; locked = false; },
    failClosed() { markFailStarted(); return failPromise; },
    openDataPage() { markOpenStarted(); return pagePromise; },
  };
  return { live, isLocked: () => locked, endCalls: () => endCalls };
}

test('data resolve before slow fail-closed keeps the lock until fail-closed and never selects', async () => {
  const page = deferred(), fail = deferred();
  let openStartedResolve, failStartedResolve;
  const openStarted = new Promise(resolve => { openStartedResolve = resolve; });
  const failStarted = new Promise(resolve => { failStartedResolve = resolve; });
  const session = lockedSession({ pagePromise: page.promise, failPromise: fail.promise, markOpenStarted: openStartedResolve, markFailStarted: failStartedResolve });
  const h = harness(session.live);
  await h.transport.start();
  const pending = h.raw.receive(navigate(47));
  await openStarted;
  await h.raw.receive(cancelled(47));
  await failStarted;

  page.resolve(7);
  await pending;
  assert.equal(h.forwarded.some(message => message.method === 'tools/call'), false);
  assert.equal(session.isLocked(), true, 'a successful page result must not unlock before fail-closed completes');
  assert.equal(session.endCalls(), 0);

  fail.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.isLocked(), false);
  assert.equal(session.endCalls(), 1);
});

test('data rejection before slow fail-closed keeps the lock until fail-closed and suppresses the error', async () => {
  const page = deferred(), fail = deferred();
  let openStartedResolve, failStartedResolve;
  const openStarted = new Promise(resolve => { openStartedResolve = resolve; });
  const failStarted = new Promise(resolve => { failStartedResolve = resolve; });
  const session = lockedSession({ pagePromise: page.promise, failPromise: fail.promise, markOpenStarted: openStartedResolve, markFailStarted: failStartedResolve });
  const h = harness(session.live);
  await h.transport.start();
  const pending = h.raw.receive(navigate(48));
  await openStarted;
  await h.raw.receive(cancelled(48));
  await failStarted;

  page.reject(new Error('late data navigation failure'));
  await pending;
  assert.equal(h.forwarded.some(message => message.method === 'tools/call'), false);
  assert.equal(h.sent.length, 0, 'a canceled request should not receive a late tool error');
  assert.equal(session.isLocked(), true);
  assert.equal(session.endCalls(), 0);

  fail.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.isLocked(), false);
  assert.equal(session.endCalls(), 1);
});

test('fail-closed may finish before data rejection without reopening selection or releasing twice', async () => {
  const page = deferred(), fail = deferred();
  let openStartedResolve, failStartedResolve;
  const openStarted = new Promise(resolve => { openStartedResolve = resolve; });
  const failStarted = new Promise(resolve => { failStartedResolve = resolve; });
  const session = lockedSession({ pagePromise: page.promise, failPromise: fail.promise, markOpenStarted: openStartedResolve, markFailStarted: failStartedResolve });
  const h = harness(session.live);
  await h.transport.start();
  const pending = h.raw.receive(navigate(49));
  await openStarted;
  await h.raw.receive(cancelled(49));
  await failStarted;

  fail.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.isLocked(), false);
  assert.equal(session.endCalls(), 1);

  page.reject(new Error('data navigation failed after fail-closed'));
  await pending;
  assert.equal(h.forwarded.some(message => message.method === 'tools/call'), false);
  assert.equal(h.sent.length, 0);
  assert.equal(session.endCalls(), 1, 'the later rejection must not release the lock a second time');
});
