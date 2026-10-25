import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

async function connectReportModule() {
  const source = await readFile(
    new URL('../browser-extension/source/ui/connectReport.ts', import.meta.url),
    'utf8'
  );
  const javascript = stripTypeScriptTypes(source, {mode: 'transform'});
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

class MockWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.readyState = 0;
    MockWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  simulateError(err) {
    this.onerror?.(err);
  }
}

const nonce = 'a'.repeat(64);
const validRelay = `ws://127.0.0.1:43127/extension/${nonce}`;

test('replaces /extension/ with /status/ in relay URL', async () => {
  const {createConnectReporter} = await connectReportModule();
  MockWebSocket.instances = [];
  createConnectReporter(validRelay, MockWebSocket);
  assert.equal(MockWebSocket.instances.length, 1);
  assert.equal(MockWebSocket.instances[0].url, `ws://127.0.0.1:43127/status/${nonce}`);
});

test('queues messages before open and sends them sequentially after open', async () => {
  const {createConnectReporter} = await connectReportModule();
  MockWebSocket.instances = [];
  const reporter = createConnectReporter(validRelay, MockWebSocket);
  const ws = MockWebSocket.instances[0];

  reporter.stage('連線頁已開啟');
  reporter.stage('等待擴充背景程式驗證連線要求');
  reporter.fail('出錯');
  assert.deepEqual(ws.sent, []);

  ws.simulateOpen();
  assert.deepEqual(ws.sent, [
    JSON.stringify({stage: '連線頁已開啟'}),
    JSON.stringify({stage: '等待擴充背景程式驗證連線要求'}),
    JSON.stringify({error: '出錯'})
  ]);

  reporter.stage('後續進度');
  assert.deepEqual(ws.sent, [
    JSON.stringify({stage: '連線頁已開啟'}),
    JSON.stringify({stage: '等待擴充背景程式驗證連線要求'}),
    JSON.stringify({error: '出錯'}),
    JSON.stringify({stage: '後續進度'})
  ]);
});

test('close waits for queued messages to be sent before closing socket', async () => {
  const {createConnectReporter} = await connectReportModule();
  // Case A: close called before open
  MockWebSocket.instances = [];
  const reporterA = createConnectReporter(validRelay, MockWebSocket);
  const wsA = MockWebSocket.instances[0];
  reporterA.stage('關閉前排隊訊息');
  reporterA.close();
  assert.equal(wsA.closed, false);
  assert.deepEqual(wsA.sent, []);

  wsA.simulateOpen();
  assert.deepEqual(wsA.sent, [JSON.stringify({stage: '關閉前排隊訊息'})]);
  assert.equal(wsA.closed, true);

  // Case B: close called after open
  MockWebSocket.instances = [];
  const reporterB = createConnectReporter(validRelay, MockWebSocket);
  const wsB = MockWebSocket.instances[0];
  wsB.simulateOpen();
  reporterB.stage('已開啟時的訊息');
  reporterB.close();
  assert.deepEqual(wsB.sent, [JSON.stringify({stage: '已開啟時的訊息'})]);
  assert.equal(wsB.closed, true);
});

test('swallows constructor exceptions, onerror and send exceptions without throwing or retrying', async () => {
  const {createConnectReporter} = await connectReportModule();

  // Constructor throws
  const ThrowingWs = class {
    constructor() {
      throw new Error('WebSocket creation failed');
    }
  };
  assert.doesNotThrow(() => {
    const reporter = createConnectReporter(validRelay, ThrowingWs);
    reporter.stage('test');
    reporter.fail('test');
    reporter.close();
  });

  // onerror does not throw and disables further sending
  MockWebSocket.instances = [];
  const reporter2 = createConnectReporter(validRelay, MockWebSocket);
  const ws2 = MockWebSocket.instances[0];
  assert.doesNotThrow(() => {
    ws2.simulateError(new Error('socket error'));
  });
  reporter2.stage('after error');
  ws2.simulateOpen();
  assert.deepEqual(ws2.sent, []);

  // send throws
  MockWebSocket.instances = [];
  const reporter3 = createConnectReporter(validRelay, MockWebSocket);
  const ws3 = MockWebSocket.instances[0];
  ws3.send = () => {
    throw new Error('send exception');
  };
  assert.doesNotThrow(() => {
    reporter3.stage('will fail send');
    ws3.simulateOpen();
  });
});

test('does not open connection and becomes no-op when relay path does not match', async () => {
  const {createConnectReporter} = await connectReportModule();
  const invalidUrls = [
    `ws://127.0.0.1:43127/cdp/${nonce}`,
    'ws://127.0.0.1:43127/extension/shortnonce',
    `ws://127.0.0.1:43127/extension/${nonce}/extra`,
    'not-a-valid-url',
    ''
  ];

  for (const invalid of invalidUrls) {
    MockWebSocket.instances = [];
    const reporter = createConnectReporter(invalid, MockWebSocket);
    assert.equal(MockWebSocket.instances.length, 0, `must not connect for ${invalid}`);
    assert.doesNotThrow(() => {
      reporter.stage('test');
      reporter.fail('test');
      reporter.close();
    });
  }
});
