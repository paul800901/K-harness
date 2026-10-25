import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {createChromeExtensionContext} from '../src/chrome-extension-context.mjs';

test('extension bridge requires exact extension origin and never silently changes mode', async () => {
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  let socket,
    connectUrl,
    detached = false;
  const context = {};
  const result = await createChromeExtensionContext({
    mode: 'incognito',
    extensionId,
    protocolFactory: () => ({ready: async () => {}, handleExtensionEvent() {}}),
    openConnectPage: async url => {
      connectUrl = new URL(url);
      const endpoint = connectUrl.searchParams.get('mcpRelayUrl');
      const rejected = new WebSocket(endpoint, {origin: 'https://untrusted.example'});
      const [error] = await once(rejected, 'error');
      assert.match(error.message, /403/);
      socket = new WebSocket(endpoint, {origin: `chrome-extension://${extensionId}`});
      await once(socket, 'open');
    },
    connectBrowser: async (endpoint, options) => {
      assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/cdp\/[a-f0-9]{64}$/);
      assert.match(options.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
      return {
        on() {},
        contexts: () => [context],
        close: async () => {
          detached = true;
        }
      };
    }
  });
  assert.equal(connectUrl.searchParams.get('mode'), 'incognito');
  assert.equal(connectUrl.searchParams.get('newTab'), 'true');
  assert.equal(result, context);
  await result.close();
  assert(detached);
});

test('extension commands continue without a human-activity pause or resume message', async () => {
  const extensionId = 'b'.repeat(32);
  let send,
    received = 0;
  const context = await createChromeExtensionContext({
    mode: 'regular',
    extensionId,
    protocolFactory: command => {
      send = command;
      return {ready: async () => {}, handleExtensionEvent() {}};
    },
    openConnectPage: async url => {
      const socket = new WebSocket(new URL(url).searchParams.get('mcpRelayUrl'), {
        origin: `chrome-extension://${extensionId}`
      });
      socket.on('message', data => {
        received++;
        const {id} = JSON.parse(data);
        socket.send(JSON.stringify({id, result: {ok: true}}));
      });
      await once(socket, 'open');
    },
    connectBrowser: async () => ({on() {}, contexts: () => [{}], close: async () => {}})
  });
  try {
    for (let i = 0; i < 3; i++) assert.deepEqual(await send('fake.command', {}), {ok: true});
    assert.equal(received, 3);
  } finally {
    await context.close();
  }
});

test('extension bridge invalid mode and missing permission timeout fail closed', async () => {
  await assert.rejects(createChromeExtensionContext({mode: 'automatic'}), /explicitly/);
  await assert.rejects(
    createChromeExtensionContext({
      mode: 'regular',
      extensionId: 'a'.repeat(32),
      timeoutMs: 30,
      protocolFactory: () => ({ready: async () => {}}),
      openConnectPage: async () => {}
    }),
    /逾時/
  );
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

async function waitFor(predicate, message) {
  const end = Date.now() + 1500;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test('Runtime.enable waits for its session frame tree response without blocking another session', async () => {
  const extensionId = 'c'.repeat(32),
    forwarded = [],
    responses = new Map(),
    frameTree = deferred();
  let extensionSocket, cdpSocket;
  const context = await createChromeExtensionContext({
    mode: 'regular',
    extensionId,
    protocolFactory: () => ({
      ready: async () => {},
      handleExtensionEvent() {},
      connectOverCDP() {},
      async handleCDPCommand() {
        return undefined;
      },
      async forwardToExtension(method, params, sessionId) {
        forwarded.push({method, sessionId});
        if (method === 'Page.getFrameTree') return frameTree.promise;
        return {};
      }
    }),
    openConnectPage: async url => {
      extensionSocket = new WebSocket(new URL(url).searchParams.get('mcpRelayUrl'), {
        origin: `chrome-extension://${extensionId}`
      });
      await once(extensionSocket, 'open');
    },
    connectBrowser: async (endpoint, options) => {
      cdpSocket = new WebSocket(endpoint, {headers: options.headers});
      cdpSocket.on('message', data => {
        const message = JSON.parse(data.toString());
        responses.set(message.id, message);
      });
      await once(cdpSocket, 'open');
      return {
        on() {},
        contexts: () => [{}],
        close: async () => {
          cdpSocket.close();
        }
      };
    }
  });
  try {
    cdpSocket.send(JSON.stringify({id: 1, method: 'Page.getFrameTree', params: {}, sessionId: 'session-a'}));
    await waitFor(
      () => forwarded.some(item => item.method === 'Page.getFrameTree' && item.sessionId === 'session-a'),
      'Page.getFrameTree was not forwarded'
    );
    cdpSocket.send(JSON.stringify({id: 2, method: 'Runtime.enable', params: {}, sessionId: 'session-a'}));
    cdpSocket.send(JSON.stringify({id: 3, method: 'Runtime.enable', params: {}, sessionId: 'session-b'}));

    await waitFor(
      () => forwarded.some(item => item.method === 'Runtime.enable' && item.sessionId === 'session-b'),
      'Runtime.enable for the independent session was blocked'
    );
    assert.equal(
      forwarded.some(item => item.method === 'Runtime.enable' && item.sessionId === 'session-a'),
      false,
      'same-session Runtime.enable must wait for Page.getFrameTree'
    );
    await waitFor(() => responses.has(3), 'independent session did not receive its response');
    assert.equal(responses.get(3).sessionId, 'session-b');

    frameTree.resolve({frameTree: {frame: {id: 'main', url: 'about:blank'}}});
    await waitFor(
      () => responses.has(1) && responses.has(2),
      'frame tree and delayed Runtime.enable responses did not arrive'
    );
    assert.equal(responses.get(1).sessionId, 'session-a');
    assert.equal(responses.get(2).sessionId, 'session-a');
    assert.deepEqual(
      forwarded.map(({method, sessionId}) => [method, sessionId]),
      [
        ['Page.getFrameTree', 'session-a'],
        ['Runtime.enable', 'session-b'],
        ['Runtime.enable', 'session-a']
      ]
    );
  } finally {
    await context.close();
    extensionSocket?.close();
  }
});

test('status connection error rejects createChromeExtensionContext immediately without waiting for timeout', async () => {
  const extensionId = 'd'.repeat(32);
  const start = Date.now();
  await assert.rejects(
    createChromeExtensionContext({
      mode: 'regular',
      extensionId,
      timeoutMs: 60000,
      protocolFactory: () => ({ready: async () => {}}),
      openConnectPage: async url => {
        const connectUrl = new URL(url);
        const relayUrl = new URL(connectUrl.searchParams.get('mcpRelayUrl'));
        const statusUrl = new URL(relayUrl);
        statusUrl.pathname = statusUrl.pathname.replace('/extension/', '/status/');
        const socket = new WebSocket(statusUrl.href, {origin: `chrome-extension://${extensionId}`});
        await once(socket, 'open');
        socket.send(JSON.stringify({error: '擴充背景程式分頁建立失敗'}));
      }
    }),
    /K 瀏覽器助手回報連線失敗：擴充背景程式分頁建立失敗/
  );
  assert.ok(Date.now() - start < 5000, 'must not wait for 60s timeout');
});

test('status stage is included in timeout message', async () => {
  const extensionId = 'e'.repeat(32);
  await assert.rejects(
    createChromeExtensionContext({
      mode: 'regular',
      extensionId,
      timeoutMs: 50,
      protocolFactory: () => ({ready: async () => {}}),
      openConnectPage: async url => {
        const connectUrl = new URL(url);
        const relayUrl = new URL(connectUrl.searchParams.get('mcpRelayUrl'));
        const statusUrl = new URL(relayUrl);
        statusUrl.pathname = statusUrl.pathname.replace('/extension/', '/status/');
        const socket = new WebSocket(statusUrl.href, {origin: `chrome-extension://${extensionId}`});
        await once(socket, 'open');
        socket.send(JSON.stringify({stage: '等待擴充背景程式驗證連線要求'}));
      }
    }),
    error => {
      assert.match(error.message, /逾時/);
      assert.match(error.message, /最後停在：等待擴充背景程式驗證連線要求/);
      return true;
    }
  );
});

test('timeout without status reports indicates no progress reported', async () => {
  const extensionId = 'f'.repeat(32);
  await assert.rejects(
    createChromeExtensionContext({
      mode: 'regular',
      extensionId,
      timeoutMs: 50,
      protocolFactory: () => ({ready: async () => {}}),
      openConnectPage: async () => {}
    }),
    error => {
      assert.match(error.message, /逾時/);
      assert.match(error.message, /沒有回報任何進度/);
      return true;
    }
  );
});

test('status connection requires matching origin and only allows a single connection', async () => {
  const extensionId = 'g'.repeat(32);
  let statusWs;
  await assert.rejects(
    createChromeExtensionContext({
      mode: 'regular',
      extensionId,
      timeoutMs: 80,
      protocolFactory: () => ({ready: async () => {}}),
      openConnectPage: async url => {
        const connectUrl = new URL(url);
        const relayUrl = new URL(connectUrl.searchParams.get('mcpRelayUrl'));
        const statusUrl = new URL(relayUrl);
        statusUrl.pathname = statusUrl.pathname.replace('/extension/', '/status/');

        const badOriginWs = new WebSocket(statusUrl.href, {origin: 'https://untrusted.example'});
        const [badErr] = await once(badOriginWs, 'error');
        assert.match(badErr.message, /403/);

        statusWs = new WebSocket(statusUrl.href, {origin: `chrome-extension://${extensionId}`});
        await once(statusWs, 'open');

        const secondWs = new WebSocket(statusUrl.href, {origin: `chrome-extension://${extensionId}`});
        const [secondErr] = await once(secondWs, 'error');
        assert.match(secondErr.message, /403/);
      }
    }),
    /逾時/
  );
});

test('a failing or closed status channel neither crashes K nor disconnects the bridge', async () => {
  const extensionId = 'h'.repeat(32);
  let send, statusWs, extensionWs;
  const context = await createChromeExtensionContext({
    mode: 'regular',
    extensionId,
    protocolFactory: command => {
      send = command;
      return {ready: async () => {}, handleExtensionEvent() {}};
    },
    openConnectPage: async url => {
      const relayUrl = new URL(new URL(url).searchParams.get('mcpRelayUrl'));
      const statusUrl = new URL(relayUrl);
      statusUrl.pathname = statusUrl.pathname.replace('/extension/', '/status/');
      statusWs = new WebSocket(statusUrl.href, {origin: `chrome-extension://${extensionId}`});
      await once(statusWs, 'open');
      extensionWs = new WebSocket(relayUrl.href, {origin: `chrome-extension://${extensionId}`});
      extensionWs.on('message', data => {
        const {id} = JSON.parse(data);
        extensionWs.send(JSON.stringify({id, result: {ok: true}}));
      });
      await once(extensionWs, 'open');
    },
    connectBrowser: async () => ({on() {}, contexts: () => [{}], close: async () => {}})
  });
  try {
    // An invalid UTF-8 text frame makes the server-side socket emit 'error'.
    statusWs.on('error', () => {});
    statusWs.send(Buffer.from([0xff, 0xfe]), {binary: false});
    await once(statusWs, 'close');
    assert.deepEqual(await send('after.status.failure', {}), {ok: true});
  } finally {
    await context.close();
  }
});

test('extension closing with reason includes reason in pending command errors', async () => {
  const extensionId = 'i'.repeat(32);
  let send, extensionWs;
  const context = await createChromeExtensionContext({
    mode: 'regular',
    extensionId,
    protocolFactory: command => {
      send = command;
      return {ready: async () => {}, handleExtensionEvent() {}};
    },
    openConnectPage: async url => {
      extensionWs = new WebSocket(new URL(url).searchParams.get('mcpRelayUrl'), {
        origin: `chrome-extension://${extensionId}`
      });
      await once(extensionWs, 'open');
    },
    connectBrowser: async () => ({on() {}, contexts: () => [{}], close: async () => {}})
  });

  const pendingPromise = send('some.pending.command', {});
  extensionWs.close(1000, 'Tab was manually closed by user');
  await assert.rejects(pendingPromise, error => {
    assert.match(error.message, /Tab was manually closed by user/);
    assert.match(error.message, /K browser extension disconnected: Tab was manually closed by user\./);
    return true;
  });
  await context.close();
});
