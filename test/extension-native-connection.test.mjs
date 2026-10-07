import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

async function nativeConnectionModule() {
  const source = await readFile(new URL('../browser-extension/source/nativeConnection.ts', import.meta.url), 'utf8');
  const javascript = stripTypeScriptTypes(source, { mode: 'transform' });
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

function event() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    emit(value) { for (const listener of listeners) listener(value); },
  };
}

function mockChrome({ windows = [], incognitoAllowed = true } = {}) {
  const ports = [];
  let port;
  const stored = {};
  const calls = { hellos: [], hosts: [], tabs: [], windows: [], windowQueries: [] };
  const chrome = {
    storage: {local:{async get(){return stored;},async set(value){Object.assign(stored,value);}}},
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      getURL: path => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${path}`,
      onStartup: event(),
      connectNative(host) {
        calls.hosts.push(host);
        const next = { onMessage: event(), onDisconnect: event(), messages: [], postMessage(message) { if(message.type==='profileHello')calls.hellos.push(message);else this.messages.push(message); } };
        ports.push(next);
        port ??= next;
        return next;
      },
    },
    extension: { async isAllowedIncognitoAccess() { return incognitoAllowed; } },
    windows: {
      async getAll(options) { calls.windowQueries.push(options); return windows; },
      async create(options) { calls.windows.push(options); return { id: 90 }; },
    },
    tabs: { async create(options) { calls.tabs.push(options); return { id: 91 }; } },
  };
  return { chrome, get port() { return port; }, ports, calls };
}

function connectUrl({ origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/connect.html', relay = 'ws://127.0.0.1:43127/extension/' + 'a'.repeat(64), mode = 'regular', newTab = 'true', protocolVersion = '2' } = {}) {
  const url = new URL(origin);
  url.searchParams.set('mcpRelayUrl', relay);
  url.searchParams.set('mode', mode);
  url.searchParams.set('newTab', newTab);
  url.searchParams.set('protocolVersion', protocolVersion);
  return url.href;
}

async function waitFor(predicate) {
  const end = Date.now() + 1000;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('native-message handler did not complete');
}

test('native handoff opens only a validated regular connection page in an inactive existing regular window', async () => {
  const { NativeConnection, K_NATIVE_HOST } = await nativeConnectionModule();
  const mock = mockChrome({ windows: [{ id: 4, incognito: true }, { id: 8, incognito: false }] });
  const connection = new NativeConnection(mock.chrome);

  assert.deepEqual(mock.calls.hosts, [K_NATIVE_HOST]);
  mock.port.onMessage.emit({ id: 'req-regular', type: 'openConnectPage', url: connectUrl() });
  await waitFor(() => mock.port.messages.length === 1);

  assert.deepEqual(mock.calls.windowQueries, [{ windowTypes: ['normal'] }]);
  assert.deepEqual(mock.calls.tabs, [{ url: connectUrl(), active: false, windowId: 8 }]);
  assert.deepEqual(mock.calls.windows, []);
  assert.deepEqual(mock.port.messages[0], { id: 'req-regular', ok: true });
  assert.equal(mock.calls.tabs.some(call => call.active === true), false);
  assert.equal(mock.calls.windows.some(call => call.focused === true), false);

  mock.port.onDisconnect.emit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mock.calls.hosts.length, 1, 'disconnect must not cause automatic reconnect');
  connection.reconnect();
  assert.equal(mock.calls.hosts.length, 2, 'an explicit extension action can request a retry');
});

test('native incognito handoff checks permission and opens an inactive selector tab in an existing regular window', async () => {
  const { NativeConnection } = await nativeConnectionModule();
  const mock = mockChrome({ windows: [{ id: 8, incognito: false }], incognitoAllowed: true });
  new NativeConnection(mock.chrome);
  const url = connectUrl({ mode: 'incognito' });
  mock.port.onMessage.emit({ id: 'req-incognito', type: 'openConnectPage', url });
  await waitFor(() => mock.port.messages.length === 1);

  assert.deepEqual(mock.calls.windows, []);
  assert.deepEqual(mock.calls.tabs, [{ url, active: false, windowId: 8 }]);
  assert.deepEqual(mock.port.messages[0], { id: 'req-incognito', ok: true });
});

test('native regular handoff refuses to create the first normal window', async () => {
  const { NativeConnection } = await nativeConnectionModule();
  const mock = mockChrome({ windows: [] });
  new NativeConnection(mock.chrome);
  mock.port.onMessage.emit({ id: 'req-no-window', type: 'openConnectPage', url: connectUrl() });
  await waitFor(() => mock.port.messages.length === 1);

  assert.deepEqual(mock.calls.tabs, []);
  assert.deepEqual(mock.calls.windows, []);
  assert.deepEqual(mock.port.messages[0], {
    id: 'req-no-window',
    ok: false,
    error: 'K could not open the validated background connection page.',
  });
});

test('native incognito handoff also requires an existing normal Chrome window', async () => {
  const { NativeConnection } = await nativeConnectionModule();
  const mock = mockChrome({ windows: [{ id: 7, incognito: true }], incognitoAllowed: true });
  new NativeConnection(mock.chrome);
  mock.port.onMessage.emit({ id: 'req-incognito-no-window', type: 'openConnectPage', url: connectUrl({ mode: 'incognito' }) });
  await waitFor(() => mock.port.messages.length === 1);

  assert.deepEqual(mock.calls.tabs, []);
  assert.deepEqual(mock.calls.windows, []);
  assert.equal(mock.port.messages[0].ok, false);
});

test('native handoff rejects non-K, non-loopback, malformed, and unauthorized incognito requests', async () => {
  const { NativeConnection } = await nativeConnectionModule();
  const mock = mockChrome({ windows: [{ id: 8, incognito: false }], incognitoAllowed: false });
  new NativeConnection(mock.chrome);
  const invalid = [
    connectUrl({ origin: 'https://example.test/connect.html' }),
    connectUrl({ origin: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/connect.html' }),
    connectUrl({ relay: 'ws://evil.test/extension/' + 'b'.repeat(64) }),
    connectUrl({ relay: 'ws://127.0.0.1:43127/cdp/' + 'c'.repeat(64) }),
    connectUrl({ mode: 'automatic' }),
    connectUrl({ newTab: 'false' }),
    connectUrl({ protocolVersion: '1' }),
    connectUrl({ mode: 'incognito' }),
  ];

  for (let i = 0; i < invalid.length; i++)
    mock.port.onMessage.emit({ id: `bad-${i}`, type: 'openConnectPage', url: invalid[i] });
  await waitFor(() => mock.port.messages.length === invalid.length);

  assert.deepEqual(mock.calls.tabs, []);
  assert.deepEqual(mock.calls.windows, []);
  assert.deepEqual(mock.port.messages.map(message => message.ok), invalid.map(() => false));
  for (const message of mock.port.messages) {
    assert.match(message.error, /validated background connection page/);
    assert.equal(message.error.includes('127.0.0.1'), false);
    assert.equal(message.error.includes('/extension/'), false);
  }
});

test('browser startup reconnects only when the native port is absent', async () => {
  const { NativeConnection, K_NATIVE_HOST } = await nativeConnectionModule();
  const mock = mockChrome();
  new NativeConnection(mock.chrome);

  assert.deepEqual(mock.calls.hosts, [K_NATIVE_HOST]);
  mock.port.onDisconnect.emit();
  mock.chrome.runtime.onStartup.emit();
  assert.deepEqual(mock.calls.hosts, [K_NATIVE_HOST, K_NATIVE_HOST]);
  mock.chrome.runtime.onStartup.emit();
  assert.deepEqual(mock.calls.hosts, [K_NATIVE_HOST, K_NATIVE_HOST], 'an existing port must not be duplicated');
});


test('one local identity persists across worker recreation, different profiles have different identities',async()=>{
 const {NativeConnection}=await nativeConnectionModule();
 const a=mockChrome(),b=mockChrome({incognitoAllowed:false});
 new NativeConnection(a.chrome);new NativeConnection(b.chrome);
 await waitFor(()=>a.calls.hellos.length===1&&b.calls.hellos.length===1);
 assert.match(a.calls.hellos[0].profileId,/^[a-f0-9]{32}$/);
 assert.notEqual(a.calls.hellos[0].profileId,b.calls.hellos[0].profileId);
 assert.equal(b.calls.hellos[0].incognitoAllowed,false);
 new NativeConnection(a.chrome);
 await waitFor(()=>a.calls.hellos.length===2);
 assert.equal(a.calls.hellos[0].profileId,a.calls.hellos[1].profileId);
});

test('failed local storage identity is not cached forever; explicit reconnect can register after recovery',async()=>{
 const {NativeConnection}=await nativeConnectionModule();const mock=mockChrome();let fail=true;
 const get=mock.chrome.storage.local.get;mock.chrome.storage.local.get=async(...args)=>{if(fail)throw Error('fake local storage unavailable');return get(...args);};
 const connection=new NativeConnection(mock.chrome);await new Promise(r=>setTimeout(r,20));assert.equal(mock.calls.hellos.length,0);
 mock.port.onDisconnect.emit();fail=false;connection.reconnect();await waitFor(()=>mock.calls.hellos.length===1);
 assert.match(mock.calls.hellos[0].profileId,/^[a-f0-9]{32}$/);assert.equal(mock.calls.hosts.length,2);
});
